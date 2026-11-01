// The library engine: runs in a Web Worker, keeps the SQLite file in the
// browser's private storage (OPFS), and answers the same questions the Python
// server does: search, document, resolve, browse. Mirrors gospel_library/search.py.
import sqlite3InitModule from "./vendor/sqlite3.mjs";
import * as S from "./lib/scriptures.js";
import { compileQuery, ftsPhrase, isNatural, naturalQuery, scopeCollections } from "./lib/query.js";

const HL_OPEN = "\u0001", HL_CLOSE = "\u0002";
const LABELS = { handbook: "General Handbook", "come-follow-me": "Come, Follow Me", "preach-my-gospel": "Preach My Gospel", manuals: "Manual", "study-helps": "Study Helps", scriptures: "Scriptures" };

let sqlite3 = null;
let pool = null;      // OPFS SAH pool util, when available
let db = null;
let mode = "none";    // "opfs" | "memory"
let current = null;   // { slot, version, builtAt }

// ------------------------------------------------------------------ rpc ----
self.onmessage = async (e) => {
  const { id, method, params } = e.data;
  const progress = (p) => self.postMessage({ id, progress: p });
  try {
    const fn = methods[method];
    if (!fn) throw new Error(`unknown method ${method}`);
    const result = await fn(params || {}, progress);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: { message: err?.message || String(err), name: err?.name } });
  }
};

async function boot() {
  if (sqlite3) return;
  sqlite3 = await sqlite3InitModule({ print: () => {}, printErr: (m) => console.warn("[sqlite]", m) });
  if (typeof sqlite3.installOpfsSAHPoolVfs === "function") {
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: "gospel-library", initialCapacity: 6 });
      mode = "opfs";
    } catch (err) {
      console.warn("OPFS not available, library will live in memory for this session:", err?.message);
      pool = null;
      mode = "memory";
    }
  } else {
    mode = "memory";
  }
}

const methods = {
  async open({ slot }) {
    await boot();
    if (db) { try { db.close(); } catch (_) {} db = null; }
    if (mode === "opfs" && slot && pool.getFileNames().includes(slot)) {
      db = new pool.OpfsSAHPoolDb(slot);
      tune(db);
      const bundle = metaValue("bundle") || {};
      current = { slot, version: bundle.version || null, builtAt: bundle.built_at || null };
      return { hasLibrary: true, mode, ...current };
    }
    current = null;
    return { hasLibrary: false, mode, files: mode === "opfs" ? pool.getFileNames() : [] };
  },

  async install({ passphrase, manifestUrl, slot }, progress) {
    await boot();
    const manifest = await (await fetch(manifestUrl, { cache: "no-store" })).json();
    const fileUrl = new URL(manifest.file + "?v=" + encodeURIComponent(manifest.version), manifestUrl).href;
    const resp = await fetch(fileUrl, { cache: "no-store" });
    if (!resp.ok) throw new Error(`could not download the library (${resp.status})`);
    const total = manifest.bundle_size || Number(resp.headers.get("Content-Length")) || 0;
    const reader = new ByteReader(resp.body, total, (loaded) => progress({ phase: "download", loaded, total }));

    const magic = new TextDecoder().decode(await reader.exact(6));
    if (magic !== "GLIB1\n") throw new Error("that file is not a library bundle");
    const hlen = new DataView((await reader.exact(4)).buffer).getUint32(0);
    const header = JSON.parse(new TextDecoder().decode(await reader.exact(hlen)));
    const key = await deriveKey(passphrase, header);
    const prefix = b64(header.nonce_prefix);

    // Decrypt chunk by chunk into a gzip inflater; the inflated stream is fed
    // straight into the database file.
    const inflater = new DecompressionStream("gzip");
    const writer = inflater.writable.getWriter();
    const out = inflater.readable.getReader();
    let producerError = null;
    const producer = (async () => {
      try {
        for (let i = 0; i < header.chunks; i++) {
          const clen = new DataView((await reader.exact(4)).buffer).getUint32(0);
          const ct = await reader.exact(clen);
          const iv = new Uint8Array(12);
          iv.set(prefix, 0);
          new DataView(iv.buffer).setUint32(8, i);
          let plain;
          try {
            plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: u32(i) }, key, ct);
          } catch (_) {
            throw new Error(i === 0 ? "That passphrase does not unlock this library." : "The download was damaged; try again.");
          }
          await writer.write(new Uint8Array(plain));
        }
        await writer.close();
      } catch (err) {
        producerError = err;
        try { await writer.abort(err); } catch (_) {}
      }
    })();

    const chunks = [];
    let written = 0;
    const next = async () => {
      const { value, done } = await out.read();
      if (producerError) throw producerError;
      if (done) return undefined;
      written += value.byteLength;
      progress({ phase: "install", loaded: written, total: header.plain_size || 0 });
      return value;
    };

    if (db) { try { db.close(); } catch (_) {} db = null; }
    if (mode === "opfs") {
      const target = slot || "/library-a.sqlite";
      if (pool.getFileNames().includes(target)) pool.unlink(target);
      try {
        await pool.importDb(target, next);
      } catch (err) {
        await producer;
        throw producerError || err;
      }
      await producer;
      if (producerError) { try { pool.unlink(target); } catch (_) {} throw producerError; }
      db = new pool.OpfsSAHPoolDb(target);
      tune(db);
      current = { slot: target, version: manifest.version, builtAt: manifest.built_at };
    } else {
      let chunk;
      while ((chunk = await next()) !== undefined) chunks.push(chunk);
      await producer;
      if (producerError) throw producerError;
      const bytes = concat(chunks);
      db = new sqlite3.oo1.DB();
      const p = sqlite3.wasm.allocFromTypedArray(bytes);
      const rc = sqlite3.capi.sqlite3_deserialize(db.pointer, "main", p, bytes.length, bytes.length,
        sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE);
      if (rc) throw new Error("could not load the library into memory");
      tune(db);
      current = { slot: null, version: manifest.version, builtAt: manifest.built_at };
    }
    const check = value("SELECT COUNT(*) FROM documents");
    if (!check) throw new Error("the downloaded library is empty");
    return { hasLibrary: true, mode, ...current, manifest };
  },

  async manifest({ manifestUrl }) {
    const r = await fetch(manifestUrl, { cache: "no-store" });
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    return r.json();
  },

  async forget({ slot }) {
    if (!slot || (current && current.slot === slot)) {
      if (db) { try { db.close(); } catch (_) {} db = null; }
      current = null;
    }
    if (mode === "opfs" && slot && pool.getFileNames().includes(slot)) pool.unlink(slot);
    return { ok: true };
  },

  async stats() { need(); return stats(); },
  // A small sealed file published beside the library (the owner's private
  // writing skills), unlocked with the same passphrase and returned as text.
  async unseal({ url, passphrase }) {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) throw new Error(`could not download (${resp.status})`);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const dv = new DataView(buf.buffer);
    if (new TextDecoder().decode(buf.subarray(0, 6)) !== "GLIB1\n") throw new Error("not a sealed file");
    const hlen = dv.getUint32(6);
    const header = JSON.parse(new TextDecoder().decode(buf.subarray(10, 10 + hlen)));
    const key = await deriveKey(passphrase, header);
    const prefix = b64(header.nonce_prefix);
    let pos = 10 + hlen;
    const parts = [];
    for (let i = 0; i < header.chunks; i++) {
      const clen = dv.getUint32(pos); pos += 4;
      const ct = buf.subarray(pos, pos + clen); pos += clen;
      const iv = new Uint8Array(12); iv.set(prefix, 0); new DataView(iv.buffer).setUint32(8, i);
      try { parts.push(new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: u32(i) }, key, ct))); }
      catch (_) { throw new Error("That passphrase does not unlock this file."); }
    }
    let plain = new Blob(parts);
    if (header.compressed) plain = new Blob([await new Response(plain.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()]);
    return await plain.text();
  },
  async search(params) { need(); return search(params); },
  async doc({ id, uri }) { need(); return document(id, uri); },
  async resolve({ href }) { need(); return resolve(href); },
  async speakers({ q }) { need(); return speakers(q); },
  async browse({ collection }) { need(); return browse(collection); },
  async book({ uri, id }) { need(); return bookToc(uri, id); },
  async recent() { need(); return recent(); },
  async scriptures() { need(); return shelf(); },
  async context({ doc_id, pid, before = 1, after = 1 }) { need(); return context(Number(doc_id), pid, before, after); },
  async verses({ words, volume = "all", limit = 400 }) { need(); return allVerses(words, volume, limit); },
  async matches(params) { need(); return allMatches(params || {}); },
};

function need() { if (!db) throw new Error("no library is loaded yet"); }
function tune(d) { d.exec("PRAGMA temp_store=MEMORY; PRAGMA cache_size=-16000;"); }

// --------------------------------------------------------------- helpers ----
class ByteReader {
  constructor(stream, total, onProgress) {
    this.reader = stream.getReader();
    this.buf = new Uint8Array(0);
    this.loaded = 0;
    this.total = total;
    this.onProgress = onProgress;
    this.lastReport = 0;
  }
  async exact(n) {
    while (this.buf.length < n) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error("the download ended early");
      this.loaded += value.byteLength;
      if (this.loaded - this.lastReport > 262144) { this.lastReport = this.loaded; this.onProgress(this.loaded); }
      const merged = new Uint8Array(this.buf.length + value.byteLength);
      merged.set(this.buf, 0); merged.set(value, this.buf.length);
      this.buf = merged;
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }
}

async function deriveKey(passphrase, header) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64(header.salt), iterations: header.iterations || 310000, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
function b64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; }
function concat(chunks) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}
async function inflate(blob) {
  if (!blob) return "";
  if (typeof blob === "string") return blob;
  const ds = new DecompressionStream("deflate");
  return new Response(new Blob([blob]).stream().pipeThrough(ds)).text();
}
function esc(s) { return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
function rows(sql, bind = []) { return bind.length ? db.selectObjects(sql, bind) : db.selectObjects(sql); }
function row(sql, bind = []) { return (bind.length ? db.selectObject(sql, bind) : db.selectObject(sql)) || null; }
function value(sql, bind = []) { return bind.length ? db.selectValue(sql, bind) : db.selectValue(sql); }
function metaValue(key) { const r = row("SELECT value FROM meta WHERE key=?", [key]); return r ? JSON.parse(r.value) : null; }

// ------------------------------------------------------------- labelling ----
function docLabel(r) {
  const coll = r.collection;
  if (coll === "general-conference" && r.year) return `${r.month === 4 ? "April" : "October"} ${r.year} General Conference`;
  if (r.volume) return r.volume;
  return LABELS[coll] || coll || "";
}
function citation(r, verse = null) {
  if (r.book_slug) {
    const b = S.book(r.book_slug);
    if (b) {
      let chapter = r.chapter;
      if (chapter !== null && chapter !== undefined && /^\d+$/.test(String(chapter))) chapter = parseInt(chapter, 10);
      return chapter !== null && chapter !== undefined ? S.citation(b, chapter, verse) : S.citation(b);
    }
  }
  if (r.collection === "general-conference") {
    const when = r.year ? `${r.month === 4 ? "Apr" : "Oct"} ${r.year}` : "";
    return [r.author || "", `“${r.title}”`, when].filter(Boolean).join(", ");
  }
  return r.title;
}
function summary(r) {
  return {
    doc_id: r.id ?? r.document_id, uri: r.uri, title: r.title, author: r.author, year: r.year, month: r.month,
    session: r.session, collection: r.collection, book_slug: r.book_slug, book_name: r.book_name,
    chapter: r.chapter, volume: r.volume, label: docLabel(r),
  };
}
function highlight(snip) { return esc(snip).replaceAll(HL_OPEN, "<mark>").replaceAll(HL_CLOSE, "</mark>"); }
function markTerms(text, terms) {
  const escaped = esc(text);
  const stems = [...new Set(terms.map((t) => t.toLowerCase()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!stems.length) return escaped;
  const re = new RegExp("\\b(" + stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*").join("|") + ")", "gi");
  return escaped.replace(re, "<mark>$1</mark>");
}

// ----------------------------------------------------------------- search ----
// Surnames of conference speakers, for recognising "what did Nelson say".
let speakerIndex = null;
function speakersBySurname() {
  if (speakerIndex) return speakerIndex;
  const rows_ = rows("SELECT author AS name, COUNT(*) AS n FROM documents WHERE author IS NOT NULL AND author != '' GROUP BY author HAVING n >= 2");
  const bySurname = new Map();
  for (const r of rows_) {
    const surname = r.name.replace(/^(President|Elder|Sister|Brother|Bishop)\s+/, "").trim().split(/\s+/).pop().toLowerCase().replace(/[^a-z]/g, "");
    if (surname.length < 3) continue;
    const prev = bySurname.get(surname);
    if (!prev || r.n > prev.n) bySurname.set(surname, { name: r.name, n: r.n });
  }
  // Use the surname alone as the filter so every form of the name matches ("Russell M. Nelson", "President Russell M. Nelson").
  speakerIndex = [...bySurname.entries()].map(([surname, v]) => ({ surname, name: surname.charAt(0).toUpperCase() + surname.slice(1), full: v.name }));
  return speakerIndex;
}

function search({ q, scope = null, typeahead = false, limit = 40, offset = 0, speaker = null, from = null, to = null, book = null, group = "passages" }) {
  const out = { query: q, hits: [], total: 0, documents: [], jump: null, titles: [] };
  const t0 = performance.now();
  if (isNatural(q) && group === "passages") {
    const r = naturalSearch(q, { scope, limit, offset, speaker, from, to, book });
    if (r) { r.ms = Math.round((performance.now() - t0) * 10) / 10; return r; }
  }
  const cq = compileQuery(q, { typeahead, scope });
  if (speaker) cq.speaker = speaker;
  if (from) cq.yearFrom = Number(from);
  if (to) cq.yearTo = Number(to);
  if (book) { const ref = S.parseReference(book); if (ref) cq.bookSlug = ref.book.slug; }

  if (!(cq.speaker || cq.yearFrom || cq.collections.length)) {
    const ref = S.parseReference(q);
    if (ref) {
      const r = row("SELECT id, title FROM documents WHERE uri=?", [ref.uri]);
      out.jump = { label: ref.label, uri: ref.uri, pid: ref.pid, doc_id: r ? r.id : null, title: r ? r.title : S.citation(ref.book, ref.chapter), verse_end: ref.verseEnd };
    }
  }
  if (!cq.match) return out;

  const where = ["paragraphs MATCH ?"];
  const params = [cq.match];
  if (cq.collections.length) { where.push(`c.slug IN (${cq.collections.map(() => "?").join(",")})`); params.push(...cq.collections); }
  if (cq.speaker) { where.push("d.author LIKE ?"); params.push(`%${cq.speaker}%`); }
  if (cq.yearFrom) { where.push("d.year >= ?"); params.push(cq.yearFrom); }
  if (cq.yearTo) { where.push("d.year <= ?"); params.push(cq.yearTo); }
  if (cq.bookSlug) { where.push("d.book_slug = ?"); params.push(cq.bookSlug); }
  const base = ` FROM paragraphs p JOIN documents d ON d.id = p.document_id JOIN collections c ON c.id = d.collection_id WHERE ${where.join(" AND ")}`;

  try {
    if (group === "documents") {
      const rs = rows(`SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name, d.chapter, d.volume,
                              c.slug AS collection, COUNT(*) AS hits, MIN(p.rank) AS best ${base} GROUP BY d.id ORDER BY best LIMIT ? OFFSET ?`,
        [...params, limit, offset]);
      out.documents = rs.map((r) => ({ ...summary(r), hits: r.hits }));
      out.total = value(`SELECT COUNT(DISTINCT d.id) ${base}`, params);
      out.ms = Math.round((performance.now() - t0) * 10) / 10;
      return out;
    }
    const rs = rows(`SELECT p.rowid AS paragraph_id, p.document_id, p.pid, p.kind, p.verse, p.text,
                            snippet(paragraphs, 0, ?, ?, ' … ', 48) AS snip, bm25(paragraphs) AS rank,
                            d.uri, d.title, d.author, d.author_role, d.year, d.month, d.session, d.date,
                            d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection
                     ${base} ORDER BY rank LIMIT ? OFFSET ?`,
      [HL_OPEN, HL_CLOSE, ...params, limit, offset]);
    out.total = value(`SELECT COUNT(*) ${base}`, params);
    for (const r of rs) {
      out.hits.push({
        ...summary(r), paragraph_id: r.paragraph_id, doc_id: r.document_id, pid: r.pid, kind: r.kind, verse: r.verse,
        snippet: r.kind === "verse" ? markTerms(r.text, cq.terms) : highlight(r.snip),
        citation: citation(r, r.verse),
      });
    }
  } catch (err) {
    out.error = `could not run that query (${err.message})`;
    return out;
  }

  if (offset === 0 && cq.terms.length) {
    const titleMatch = cq.terms.map((t) => ftsPhrase(t)).filter(Boolean).join(" ");
    const tw = ["documents_fts MATCH ?"];
    const tp = [`title : (${titleMatch})`];
    if (cq.collections.length) { tw.push(`c.slug IN (${cq.collections.map(() => "?").join(",")})`); tp.push(...cq.collections); }
    if (cq.speaker) { tw.push("d.author LIKE ?"); tp.push(`%${cq.speaker}%`); }
    try {
      const trs = rows(`SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection
                         FROM documents_fts f JOIN documents d ON d.id=f.rowid JOIN collections c ON c.id=d.collection_id
                        WHERE ${tw.join(" AND ")} ORDER BY bm25(documents_fts) LIMIT 6`, tp);
      out.titles = trs.map(summary);
    } catch (_) { /* a malformed title query is not worth failing the search for */ }
  }
  out.ms = Math.round((performance.now() - t0) * 10) / 10;
  return out;
}

// A question, answered in tiers: the exact phrase first, then passages with
// every idea, then passages with any of them, best matches first within each.
function naturalSearch(q, { scope, limit, offset, speaker, from, to, book }) {
  const fixed = correctTypos(q);
  const n = naturalQuery(fixed.text, speakersBySurname());
  if (!n.terms.length) return null;
  const cq = { collections: scopeCollections(n.scope || scope || "all"), speaker: speaker || n.speaker, yearFrom: from ? Number(from) : n.yearFrom, yearTo: to ? Number(to) : n.yearTo, bookSlug: n.bookSlug, terms: n.terms };
  if (book) { const ref = S.parseReference(book); if (ref) cq.bookSlug = ref.book.slug; }
  const out = { query: q, hits: [], total: 0, documents: [], jump: null, titles: [], smart: { terms: n.terms, speaker: cq.speaker, scope: n.scope, book: cq.bookSlug, years: n.yearFrom ? [n.yearFrom, n.yearTo] : null, corrected: fixed.changes } };
  const seen = new Set();
  const want = limit + offset;
  const tiers = [n.phrase, n.strict, n.loose].filter(Boolean).filter((m, i, arr) => arr.indexOf(m) === i);
  let collected = [];
  for (const match of tiers) {
    if (collected.length >= want) break;
    let rs;
    try { rs = passageRows(match, cq, want - collected.length + seen.size, 0); } catch (_) { continue; }
    for (const r of rs) {
      if (seen.has(r.paragraph_id)) continue;
      seen.add(r.paragraph_id);
      collected.push(r);
    }
  }
  const last = tiers[tiers.length - 1];
  try { out.total = Math.max(collected.length, last ? value(`SELECT COUNT(*) ${baseSql(cq)}`, [last, ...whereParams(cq)]) : 0); } catch (_) { out.total = collected.length; }
  // Show a corrected word as it is written in the text, not as the index stores it ("charity", not "chariti").
  for (const c of fixed.changes) {
    for (const r of collected.slice(0, 30)) {
      const w = (r.text || "").split(/[^\p{L}'’]+/u).find((x) => x.length >= 3 && stem(x.toLowerCase()) === c.to);
      if (w) { c.to = w.toLowerCase(); break; }
    }
  }
  for (const r of collected.slice(offset, offset + limit)) {
    out.hits.push({ ...summary(r), paragraph_id: r.paragraph_id, doc_id: r.document_id, pid: r.pid, kind: r.kind, verse: r.verse,
      snippet: r.kind === "verse" ? markTerms(r.text, expandTerms(n.terms)) : highlight(r.snip), citation: citation(r, r.verse) });
  }
  if (offset === 0) out.titles = titleMatches(n.terms, cq);
  return out;
}
// A word the library has never seen ("spirt") is swapped for the nearest
// word it has, measured against the index's own vocabulary; everything else
// is left exactly as typed.
let vocab = null;
function loadVocab() {
  if (vocab) return vocab;
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.vocab USING fts5vocab(main, 'paragraphs', 'row')");
    vocab = rows("SELECT term, cnt FROM temp.vocab WHERE cnt >= 2 AND length(term) >= 3").map((r) => [r.term, r.cnt]);
  } catch (_) { vocab = []; }
  return vocab;
}
function editDistance(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// The index's own stemmer, applied to one word (so "charty" is compared as
// "charti", the way "charity" is stored).
let stemReady = false;
function stem(w) {
  try {
    if (!stemReady) {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp.stemq USING fts5(w, tokenize='porter unicode61 remove_diacritics 2'); CREATE VIRTUAL TABLE IF NOT EXISTS temp.stemv USING fts5vocab(temp, 'stemq', 'row')");
      stemReady = true;
    }
    db.exec("DELETE FROM temp.stemq");
    db.exec({ sql: "INSERT INTO temp.stemq(w) VALUES (?)", bind: [w] });
    return value("SELECT term FROM temp.stemv LIMIT 1") || w;
  } catch (_) { return w; }
}
function correctTypos(q) {
  const changes = [];
  if (!db || /["']|\w+:/.test(q)) return { text: q, changes };
  const text = q.replace(/\b([A-Za-z][a-z]{2,})\b/g, (word) => {
    const w = word.toLowerCase();
    if (QUESTION_WORDS_LOCAL.has(w)) return word;
    let known = true;
    try { known = !!row("SELECT rowid FROM paragraphs WHERE paragraphs MATCH ? LIMIT 1", [`"${w}"`]); } catch (_) { return word; }
    if (known) return word;
    const sw = stem(w);
    const limit = sw.length >= 6 ? 2 : 1;
    let best = null, bestD = limit + 1, bestCnt = 0;
    for (const [term, cnt] of loadVocab()) {
      if (term[0] !== sw[0] || Math.abs(term.length - sw.length) > limit) continue;
      const d = editDistance(sw, term);
      if (d < bestD || (d === bestD && cnt > bestCnt)) { best = term; bestD = d; bestCnt = cnt; }
    }
    if (!best) return word;
    changes.push({ from: word, to: best });
    return best;
  });
  return { text, changes };
}
const QUESTION_WORDS_LOCAL = new Set("what when where which who whom whose why how does do did the and for with from that this these those have has had can could should would will shall may might must about all any some every each pull give show find list get bring tell say said".split(" "));
function expandTerms(terms) {
  const out = [];
  for (const t of terms) { out.push(t); for (const w of t.split(" ")) if (w.length > 3) out.push(w); }
  return out;
}
function whereParts(cq) {
  const where = [];
  const params = [];
  if (cq.collections.length) { where.push(`c.slug IN (${cq.collections.map(() => "?").join(",")})`); params.push(...cq.collections); }
  if (cq.speaker) { where.push("d.author LIKE ?"); params.push(`%${cq.speaker}%`); }
  if (cq.yearFrom) { where.push("d.year >= ?"); params.push(cq.yearFrom); }
  if (cq.yearTo) { where.push("d.year <= ?"); params.push(cq.yearTo); }
  if (cq.bookSlug) { where.push("d.book_slug = ?"); params.push(cq.bookSlug); }
  return { where, params };
}
function whereParams(cq) { return whereParts(cq).params; }
function baseSql(cq) {
  const { where } = whereParts(cq);
  return ` FROM paragraphs p JOIN documents d ON d.id = p.document_id JOIN collections c ON c.id = d.collection_id WHERE ${["paragraphs MATCH ?", ...where].join(" AND ")}`;
}
function passageRows(match, cq, limit, offset) {
  return rows(`SELECT p.rowid AS paragraph_id, p.document_id, p.pid, p.kind, p.verse, p.text,
                      snippet(paragraphs, 0, ?, ?, ' \u2026 ', 48) AS snip, bm25(paragraphs) AS rank,
                      d.uri, d.title, d.author, d.author_role, d.year, d.month, d.session, d.date,
                      d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection
               ${baseSql(cq)} ORDER BY rank LIMIT ? OFFSET ?`, [HL_OPEN, HL_CLOSE, match, ...whereParams(cq), limit, offset]);
}
function titleMatches(terms, cq) {
  const titleMatch = terms.map((t) => ftsPhrase(t)).filter(Boolean).join(" OR ");
  if (!titleMatch) return [];
  const { where, params } = whereParts(cq);
  try {
    return rows(`SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection
                   FROM documents_fts f JOIN documents d ON d.id=f.rowid JOIN collections c ON c.id=d.collection_id
                  WHERE ${["documents_fts MATCH ?", ...where].join(" AND ")} ORDER BY bm25(documents_fts) LIMIT 6`, [`title : (${titleMatch})`, ...params]).map(summary);
  } catch (_) { return []; }
}

// --------------------------------------------------------------- document ----
async function document(id, uri) {
  const sql = "SELECT d.*, c.slug AS collection, c.title AS collection_title FROM documents d JOIN collections c ON c.id=d.collection_id WHERE ";
  const r = id !== undefined && id !== null ? row(sql + "d.id=?", [Number(id)]) : row(sql + "d.uri=?", [uri]);
  if (!r) return null;
  const doc = { ...r };
  delete doc.content_hash;
  doc.body_html = await inflate(r.body_html);
  doc.section_path = r.section_path ? JSON.parse(r.section_path) : [];
  doc.label = docLabel(r);
  doc.citation = citation(r);
  doc.footnotes = rows("SELECT note_id, marker, pid, html, text, refs FROM footnotes WHERE document_id=? ORDER BY id", [r.id])
    .map((n) => ({ ...n, refs: n.refs ? JSON.parse(n.refs) : [] }));
  doc.book = r.book_id ? row("SELECT id, uri, title FROM books WHERE id=?", [r.book_id]) : null;
  if (r.book_id !== null && r.book_id !== undefined) {
    const sk = r.sort_key || 0;
    doc.next = row("SELECT id, title, uri FROM documents WHERE book_id=? AND (sort_key > ? OR (sort_key = ? AND id > ?)) ORDER BY sort_key, id LIMIT 1", [r.book_id, sk, sk, r.id]);
    doc.prev = row("SELECT id, title, uri FROM documents WHERE book_id=? AND (sort_key < ? OR (sort_key = ? AND id < ?)) ORDER BY sort_key DESC, id DESC LIMIT 1", [r.book_id, sk, sk, r.id]);
  } else {
    doc.next = doc.prev = null;
  }
  doc.source_url = `https://www.churchofjesuschrist.org/study${r.uri}?lang=eng`;
  return doc;
}

// Every scripture verse containing any of the given words (prefix-matched, so
// "redeem" also finds redeemed and redeemer), in canonical order. For the
// complete lists a keyword search ranked by relevance cannot give.
const VOLUMES = { ot: "Old Testament", nt: "New Testament", bofm: "Book of Mormon", dc: "Doctrine and Covenants", pgp: "Pearl of Great Price" };
// Every passage in a scope with a word family or an exact phrase, in reading
// order: the tool for "all the references to…" in any part of the library.
function allMatches({ words, phrase, scope = "all", limit = 400 }) {
  let match;
  if (phrase && String(phrase).trim()) match = `"${String(phrase).trim().replace(/"/g, " ")}"`;
  else {
    const terms = String(words || "").toLowerCase().split(/[\s,]+|\bor\b/).map((w) => w.replace(/[^\p{L}\p{N}'’*]/gu, "")).filter((w) => w.length > 1);
    if (!terms.length) return { total: 0, passages: [], query: "" };
    match = terms.map((t) => (t.endsWith("*") ? `"${t.slice(0, -1)}"*` : `"${t}"*`)).join(" OR ");
  }
  const where = ["paragraphs MATCH ?", "p.kind IN ('verse','para')"];
  const params = [match];
  if (VOLUMES[scope]) { where.push("c.slug = 'scriptures'", "d.volume = ?"); params.push(VOLUMES[scope]); }
  else if (scope === "scriptures") where.push("c.slug = 'scriptures'");
  else { const colls = scopeCollections(scope); if (colls.length) { where.push(`c.slug IN (${colls.map(() => "?").join(",")})`); params.push(...colls); } }
  const base = ` FROM paragraphs p JOIN documents d ON d.id = p.document_id JOIN collections c ON c.id = d.collection_id WHERE ${where.join(" AND ")}`;
  let total = 0, rs = [], byDoc = [];
  try {
    total = value(`SELECT COUNT(*) ${base}`, params);
    byDoc = rows(`SELECT d.title AS title, d.volume AS volume, c.slug AS collection, COUNT(*) AS n ${base} GROUP BY d.id ORDER BY d.sort_key`, params);
    rs = rows(`SELECT p.rowid AS paragraph_id, p.document_id, p.pid, p.kind, p.verse, p.text, d.uri, d.title, d.author, d.year, d.month, d.session,
                      d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection ${base} ORDER BY d.sort_key, p.seq LIMIT ?`, [...params, Math.min(limit, 600)]);
  } catch (err) {
    return { total: 0, passages: [], query: match, error: err.message };
  }
  return { total, query: match, by_document: byDoc, passages: rs.map((r) => ({ ...summary(r), paragraph_id: r.paragraph_id, doc_id: r.document_id, pid: r.pid, kind: r.kind, verse: r.verse, text: r.text, citation: citation(r, r.verse) })) };
}

function allVerses(words, volume, limit) {
  const terms = String(words || "").toLowerCase().split(/[\s,]+|\bor\b/).map((w) => w.replace(/[^\p{L}\p{N}'’*]/gu, "")).filter((w) => w.length > 1);
  if (!terms.length) return { total: 0, verses: [], query: "" };
  const match = terms.map((t) => (t.endsWith("*") ? `"${t.slice(0, -1)}"*` : `"${t}"*`)).join(" OR ");
  const where = ["paragraphs MATCH ?", "p.kind = 'verse'", "c.slug = 'scriptures'"];
  const params = [match];
  if (volume && VOLUMES[volume]) { where.push("d.volume = ?"); params.push(VOLUMES[volume]); }
  const base = ` FROM paragraphs p JOIN documents d ON d.id = p.document_id JOIN collections c ON c.id = d.collection_id WHERE ${where.join(" AND ")}`;
  let total = 0, rs = [];
  try {
    total = value(`SELECT COUNT(*) ${base}`, params);
    rs = rows(`SELECT p.rowid AS paragraph_id, p.document_id, p.pid, p.kind, p.verse, p.text, d.uri, d.title, d.author, d.year, d.month, d.session,
                      d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection ${base} ORDER BY d.sort_key, p.seq LIMIT ?`, [...params, Math.min(limit, 600)]);
  } catch (err) {
    return { total: 0, verses: [], query: match, error: err.message };
  }
  return { total, query: match, verses: rs.map((r) => ({ ...summary(r), paragraph_id: r.paragraph_id, doc_id: r.document_id, pid: r.pid, kind: r.kind, verse: r.verse, text: r.text, citation: citation(r, r.verse) })) };
}

// The paragraphs around one hit, for giving Claude a little more than a verse.
function context(docId, pid, before, after) {
  const d = row("SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name, d.chapter, d.volume, d.par_first, d.par_last, c.slug AS collection FROM documents d JOIN collections c ON c.id=d.collection_id WHERE d.id=?", [docId]);
  if (!d || d.par_first === null) return null;
  const anchor = row("SELECT seq FROM paragraphs WHERE rowid BETWEEN ? AND ? AND pid=?", [d.par_first, d.par_last, pid]);
  if (!anchor) return null;
  const rs = rows("SELECT rowid AS paragraph_id, seq, pid, kind, verse, text FROM paragraphs WHERE rowid BETWEEN ? AND ? AND seq BETWEEN ? AND ? AND kind IN ('verse','para','summary','heading') ORDER BY seq",
    [d.par_first, d.par_last, anchor.seq - before, anchor.seq + after]);
  const verses = rs.filter((r) => r.kind === "verse").map((r) => r.verse).filter((v) => v !== null);
  let cite = citation(d);
  if (verses.length && d.book_slug) {
    const b = S.book(d.book_slug);
    const ch = /^\d+$/.test(String(d.chapter)) ? parseInt(d.chapter, 10) : d.chapter;
    cite = b ? S.citation(b, ch, verses[0], verses[verses.length - 1]) : cite;
  }
  return { ...summary(d), citation: cite, anchor_pid: pid, paragraphs: rs };
}

function normalizeUri(uri) {
  uri = uri.trim();
  if (uri.startsWith("http")) { try { uri = new URL(uri).pathname; } catch (_) {} }
  uri = uri.split("?")[0].split("#")[0];
  if (uri.startsWith("/study/")) uri = uri.slice(6);
  if (uri.startsWith("/eng/")) uri = uri.slice(4);
  if (!uri.startsWith("/")) uri = "/" + uri;
  return uri.replace(/\/+$/, "") || "/";
}

function resolve(href) {
  let u;
  try { u = new URL(href, "https://www.churchofjesuschrist.org"); } catch (_) { return { found: false, href }; }
  const uri = normalizeUri(u.pathname);
  let pid = null;
  const idp = u.searchParams.get("id");
  if (idp) pid = idp.split(",")[0].split("-")[0];
  if (!pid && u.hash) pid = u.hash.slice(1);
  const r = row("SELECT d.id, d.uri, d.title, c.slug AS collection FROM documents d JOIN collections c ON c.id=d.collection_id WHERE d.uri=?", [uri]);
  if (!r) return { found: false, href };
  return { found: true, doc_id: r.id, uri: r.uri, title: r.title, pid, collection: r.collection };
}

function speakers(prefix) {
  let where = "WHERE c.slug='general-conference' AND d.author IS NOT NULL AND d.author != ''";
  const params = [];
  if (prefix) { where += " AND d.author LIKE ?"; params.push(`%${prefix}%`); }
  return rows(`SELECT d.author AS name, COUNT(*) AS talks, MIN(d.year) AS first_year, MAX(d.year) AS last_year
                 FROM documents d JOIN collections c ON c.id=d.collection_id ${where}
                GROUP BY d.author ORDER BY talks DESC, name LIMIT 300`, params);
}

// ----------------------------------------------------------------- browse ----
function stats() {
  const out = { collections: rows(`SELECT c.slug, c.title, c.kind, COUNT(d.id) AS docs, COALESCE(SUM(d.word_count), 0) AS words, MAX(d.fetched_at) AS last_fetched
                                     FROM collections c LEFT JOIN documents d ON d.collection_id=c.id GROUP BY c.id ORDER BY c.sort`) };
  out.documents = out.collections.reduce((n, c) => n + c.docs, 0);
  const counts = metaValue("counts") || { paragraphs: 0, verses: 0 };
  out.paragraphs = counts.paragraphs; out.verses = counts.verses;
  out.talks = value("SELECT COUNT(*) FROM documents d JOIN collections c ON c.id=d.collection_id WHERE c.slug='general-conference'");
  out.last_run = row("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1");
  out.latest_conference = row("SELECT year, month FROM documents d JOIN collections c ON c.id=d.collection_id WHERE c.slug='general-conference' AND year IS NOT NULL ORDER BY year DESC, month DESC LIMIT 1");
  out.meta = Object.fromEntries(rows("SELECT key, value FROM meta").map((r) => [r.key, JSON.parse(r.value)]));
  out.engine = { mode, ...(current || {}) };
  return out;
}

function browse(slug) {
  if (!slug) return { collections: rows("SELECT c.slug, c.title, c.kind, COUNT(d.id) AS docs FROM collections c LEFT JOIN documents d ON d.collection_id=c.id GROUP BY c.id ORDER BY c.sort") };
  const order = slug === "general-conference" ? "b.sort DESC, b.id" : "b.sort, b.id";
  return { collection: slug, books: rows(`SELECT b.id, b.uri, b.title, b.year, b.month, b.entry_count, b.status, b.sort,
                                                   (SELECT COUNT(*) FROM documents d WHERE d.book_id=b.id) AS docs
                                              FROM books b JOIN collections c ON c.id=b.collection_id WHERE c.slug=? ORDER BY ${order}`, [slug]) };
}

function bookToc(uri, id) {
  const b = id !== undefined && id !== null ? row("SELECT * FROM books WHERE id=?", [Number(id)]) : row("SELECT * FROM books WHERE uri=?", [normalizeUri(uri || "")]);
  if (!b) return { error: "no such book" };
  const docs = new Map(rows("SELECT id, uri, title, author FROM documents WHERE book_id=?", [b.id]).map((d) => [d.uri, d]));
  const nodes = b.toc_json ? JSON.parse(b.toc_json) : [];
  for (const n of nodes) {
    const d = docs.get(n.uri);
    n.doc_id = d ? d.id : null;
    if (d && !n.subtitle && d.author) n.subtitle = d.author;
  }
  return { id: b.id, uri: b.uri, title: b.title, year: b.year, month: b.month, nodes, status: b.status };
}

function recent() {
  const latest = row(`SELECT b.id, b.uri, b.title, b.year, b.month FROM books b JOIN collections c ON c.id=b.collection_id
                       WHERE c.slug='general-conference' AND b.status='ok' AND EXISTS (SELECT 1 FROM documents d WHERE d.book_id=b.id)
                       ORDER BY b.year DESC, b.month DESC LIMIT 1`);
  if (!latest) return { conference: null, talks: [] };
  return { conference: latest, talks: rows("SELECT id, uri, title, author, author_role, session, description FROM documents WHERE book_id=? ORDER BY sort_key, id", [latest.id]) };
}

function shelf() {
  const have = new Map(rows("SELECT d.uri, d.id FROM documents d JOIN collections c ON c.id=d.collection_id WHERE c.slug='scriptures'").map((r) => [r.uri, r.id]));
  const volumes = new Map();
  for (const b of S.books) {
    if (!volumes.has(b.volume_slug)) volumes.set(b.volume_slug, { slug: b.volume_slug, name: b.volume_name, books: [] });
    volumes.get(b.volume_slug).books.push({
      slug: b.slug, name: b.name, abbrev: b.abbrev, uri: b.uri, group: b.group,
      chapters: b.chapters.map((c) => ({ n: c, uri: `${b.uri}/${c}`, doc_id: have.get(`${b.uri}/${c}`) ?? null })),
    });
  }
  return { volumes: [...volumes.values()], have: have.size };
}
