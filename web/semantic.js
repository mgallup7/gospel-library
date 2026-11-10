// Search by meaning, on the device. The nightly job embeds every paragraph
// with a small sentence model (gospel_library/embed.py); the bundle carries
// the sign bits of those vectors. Here the query is embedded with the same
// model, running in this worker on ONNX Runtime, and scored against the bits:
// for each paragraph, the sum of the query's components where the paragraph's
// bit is set (an asymmetric score that ranks close to the full dot product).
import { WordPiece } from "./lib/wordpiece.js";

export const MODEL = {
  name: "bge-small-en-v1.5",
  dims: 384,
  prefix: "Represent this sentence for searching relevant passages: ",
  maxTokens: 256,
  pooling: "cls",
};

let ort = null, session = null, tokenizer = null, loading = null, failure = null;

export function ready() { return !!session; }
export function failed() { return failure; }

// Loads the runtime, the vocabulary and the model (35 MB the first time; the
// service worker keeps them after that). onProgress({loaded, total}) reports the download.
export function load({ base, onProgress } = {}) {
  if (session) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    try {
      const vendor = new URL("vendor/ort/", base).href;
      const mod = await import(/* webpackIgnore: true */ vendor + "ort.wasm.min.mjs");
      ort = mod.default && mod.default.InferenceSession ? mod.default : mod;
      ort.env.wasm.wasmPaths = vendor;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const vocabRes = await fetch(new URL("model/vocab.txt", base).href);
      if (!vocabRes.ok) throw new Error(`vocabulary ${vocabRes.status}`);
      tokenizer = new WordPiece(await vocabRes.text(), { maxLength: MODEL.maxTokens });
      const bytes = await fetchBytes(new URL("model/model_quantized.onnx", base).href, onProgress);
      session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      return true;
    } catch (err) {
      failure = err;
      loading = null;
      throw err;
    }
  })();
  return loading;
}

async function fetchBytes(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model ${res.status}`);
  const total = Number(res.headers.get("Content-Length")) || 0;
  if (!res.body || !onProgress) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0, last = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.byteLength;
    if (loaded - last > 1 << 20) { last = loaded; onProgress({ loaded, total }); }
  }
  onProgress({ loaded, total: total || loaded });
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

// The unit vector of a text. Queries get the model's retrieval prefix.
export async function embed(text, { query = true } = {}) {
  if (!session) throw new Error("the search model is not loaded");
  const ids = tokenizer.encode((query ? MODEL.prefix : "") + String(text || ""));
  const L = ids.length;
  const big = new BigInt64Array(L);
  for (let i = 0; i < L; i++) big[i] = BigInt(ids[i]);
  const ones = new BigInt64Array(L).fill(1n);
  const feeds = { input_ids: new ort.Tensor("int64", big, [1, L]), attention_mask: new ort.Tensor("int64", ones, [1, L]) };
  if (session.inputNames.includes("token_type_ids")) feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(L), [1, L]);
  const out = await session.run(feeds);
  const h = out[session.outputNames[0]];
  const dims = h.dims[h.dims.length - 1];
  const v = new Float32Array(dims);
  if (MODEL.pooling === "cls") { for (let d = 0; d < dims; d++) v[d] = h.data[d]; }
  else { for (let t = 0; t < L; t++) for (let d = 0; d < dims; d++) v[d] += h.data[t * dims + d]; for (let d = 0; d < dims; d++) v[d] /= L; }
  let n = 0;
  for (let d = 0; d < dims; d++) n += v[d] * v[d];
  n = Math.sqrt(n) || 1;
  for (let d = 0; d < dims; d++) v[d] /= n;
  return v;
}
export function tokens(text) { return tokenizer ? tokenizer.tokens(text) : []; }

// The paragraphs' sign bits, and the scoring against them.
export class BitIndex {
  constructor(ids, bits, dims) {
    this.ids = ids;          // Int32Array of paragraph rowids
    this.bits = bits;        // Uint8Array, dims/8 bytes per paragraph, packed most significant bit first
    this.dims = dims;
    this.bytes = dims >> 3;
    this.n = ids.length;
  }
  get size() { return this.n; }
  // The k best paragraphs for a query vector: [{id, score}] with score in [-1, 1] (the
  // asymmetric estimate of the dot product). allow(i) may rule entries out by position.
  topK(q, k = 300, allow = null) {
    const B = this.bytes, n = this.n, bits = this.bits;
    // table[j*256 + byte] = sum of q over the set bits of that byte at byte position j
    const table = new Float32Array(B * 256);
    let total = 0;
    for (let d = 0; d < this.dims; d++) total += q[d];
    for (let j = 0; j < B; j++) {
      const base = j * 256;
      for (let b = 1; b < 256; b++) {
        const low = b & -b;                       // lowest set bit
        const rest = b ^ low;
        const bit = 31 - Math.clz32(low);        // 0..7 (bit value), MSB-first packing: bit 7 is dim 8j
        table[base + b] = table[base + rest] + q[8 * j + (7 - bit)];
      }
    }
    // a bounded min-heap of the best k
    const hk = Math.min(k, n);
    const hs = new Float32Array(hk), hi = new Int32Array(hk);
    let count = 0;
    const push = (s, i) => {
      if (count < hk) {
        let c = count++;
        hs[c] = s; hi[c] = i;
        while (c > 0) { const p = (c - 1) >> 1; if (hs[p] <= hs[c]) break; [hs[p], hs[c]] = [hs[c], hs[p]]; [hi[p], hi[c]] = [hi[c], hi[p]]; c = p; }
      } else if (s > hs[0]) {
        hs[0] = s; hi[0] = i;
        let c = 0;
        for (;;) {
          const l = 2 * c + 1, r = l + 1;
          let m = c;
          if (l < hk && hs[l] < hs[m]) m = l;
          if (r < hk && hs[r] < hs[m]) m = r;
          if (m === c) break;
          [hs[m], hs[c]] = [hs[c], hs[m]]; [hi[m], hi[c]] = [hi[c], hi[m]]; c = m;
        }
      }
    };
    for (let i = 0; i < n; i++) {
      if (allow && !allow(i)) continue;
      let s = 0;
      const off = i * B;
      for (let j = 0; j < B; j++) s += table[j * 256 + bits[off + j]];
      push(s, i);
    }
    const out = [];
    for (let c = 0; c < count; c++) out.push({ id: this.ids[hi[c]], score: 2 * hs[c] - total });
    out.sort((a, b) => b.score - a.score);
    return out;
  }
}

// The index as one file, so a launch reads it whole instead of stepping through every vector
// row: a 16-byte prefix (the letters GLMI, the format, the header's length, a byte-order mark),
// a JSON header padded to 8 bytes, then the paragraph rowids, each one's document, the
// document of every paragraph rowid (rowDocs), and the bits. `key` names the library and the
// model the file was made from. packIndex gives the pieces to write, the head first;
// unpackIndex gives the arrays back as views on the buffer, or null for anything that is not
// exactly a file made by packIndex for this key (another library, a cut-off write, a stray byte order).
const FILE_MAGIC = 0x494d4c47, FILE_FORMAT = 1, FILE_ORDER = 0x01020304;
const asBytes = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
export function packIndex({ key, dims, ids, docs, rowDocs, bits }) {
  const n = ids.length;
  if (docs.length !== n || bits.length !== n * (dims >> 3)) throw new Error("the index's parts do not fit together");
  const header = { key, dims, n, rows: rowDocs.length, length: 0 };
  const json = (h) => new TextEncoder().encode(JSON.stringify(h));
  const body = 4 * n + 4 * n + 4 * rowDocs.length + bits.length;
  // the header holds the file's own length, whose digits change the header's length: settle it
  let text = json(header), at = 0;
  for (let i = 0; i < 4; i++) { at = (16 + text.length + 7) & ~7; header.length = at + body; text = json(header); if (((16 + text.length + 7) & ~7) === at) break; }
  const head = new Uint8Array(at);
  new Uint32Array(head.buffer, 0, 4).set([FILE_MAGIC, FILE_FORMAT, text.length, FILE_ORDER]);
  head.set(text, 16);
  return { parts: [head, asBytes(ids), asBytes(docs), asBytes(rowDocs), asBytes(bits)], length: header.length };
}
export function unpackIndex(buffer, key) {
  try {
    if (!buffer || buffer.byteLength < 16) return null;
    const [magic, format, hlen, order] = new Uint32Array(buffer, 0, 4);
    if (magic !== FILE_MAGIC || format !== FILE_FORMAT || order !== FILE_ORDER || 16 + hlen > buffer.byteLength) return null;
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 16, hlen)));
    const at = (16 + hlen + 7) & ~7, bytes = h.dims >> 3;
    if (h.key !== key || !(h.n > 0) || !(h.rows >= 0) || !(bytes > 0) || h.length !== buffer.byteLength || at + 8 * h.n + 4 * h.rows + h.n * bytes !== buffer.byteLength) return null;
    return {
      dims: h.dims,
      ids: new Int32Array(buffer, at, h.n),
      docs: new Int32Array(buffer, at + 4 * h.n, h.n),
      rowDocs: new Int32Array(buffer, at + 8 * h.n, h.rows),
      bits: new Uint8Array(buffer, at + 8 * h.n + 4 * h.rows, h.n * bytes),
    };
  } catch (_) { return null; }
}
