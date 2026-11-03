// The library engine: runs in a Web Worker, keeps the SQLite file in the
// browser's private storage (OPFS), and answers the same questions the Python
// server does: search, document, resolve, browse. Mirrors gospel_library/search.py.
import sqlite3InitModule from "./vendor/sqlite3.mjs";
import * as S from "./lib/scriptures.js";
import { compileQuery, ftsPhrase, isNatural, naturalQuery, scopeCollections } from "./lib/query.js";

const HL_OPEN = "\u0001", HL_CLOSE = "\u0002";
const LABELS = { handbook: "General Handbook", "come-follow-me": "Come, Follow Me", "preach-my-gospel": "Preach My Gospel", "missionary-standards": "Missionary Standards", manuals: "Manual", "study-helps": "Study Helps", scriptures: "Scriptures" };

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
  // The Hebrew Bible and Greek New Testament, word by word.
  async originalsInfo() { need(); return haveOriginals() ? metaValue("originals") : null; },
  async original(params) { need(); return originalWords(params || {}); },
  async lexicon({ strongs, limit = 80 }) { need(); return lexiconEntry(strongs, limit); },
  async morph({ code }) { need(); return morphCodes(code); },
  async originalSearch(params) { need(); return originalSearch(params || {}); },
  async locate(params) { need(); return locate(params || {}); },
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
  if (coll && coll.startsWith("jsp-")) return `Joseph Smith Papers${r.book_title ? `, ${r.book_title}` : ""}`;
  if (r.volume) return r.volume;
  // A manual's own title names the edition or volume (the service missionary
  // edition of the Missionary Standards, this year's Come, Follow Me, the
  // Topical Guide), which the collection name alone would hide.
  if (r.book_title && coll !== "scriptures") return r.book_title;
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
    chapter: r.chapter, volume: r.volume, book_title: r.book_title || null, label: docLabel(r),
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

function search({ q, scope = null, typeahead = false, limit = 40, offset = 0, speaker = null, from = null, to = null, book = null, edition = null, exclude_edition = null, group = "passages" }) {
  const out = { query: q, hits: [], total: 0, documents: [], jump: null, titles: [] };
  const t0 = performance.now();
  // Hebrew or Greek letters, or a Strong's number, search the original texts.
  if (group === "passages" && originalKind(q) && haveOriginals()) {
    const r = originalSearch({ q, limit, offset, scope });
    r.ms = Math.round((performance.now() - t0) * 10) / 10;
    return r;
  }
  if (isNatural(q) && group === "passages") {
    const r = naturalSearch(q, { scope, limit, offset, speaker, from, to, book, edition, exclude_edition });
    if (r) { r.ms = Math.round((performance.now() - t0) * 10) / 10; return r; }
  }
  const cq = compileQuery(q, { typeahead, scope });
  if (speaker) cq.speaker = speaker;
  if (from) cq.yearFrom = Number(from);
  if (to) cq.yearTo = Number(to);
  if (book) { const ref = S.parseReference(book); if (ref) cq.bookSlug = ref.book.slug; }
  if (edition) cq.edition = edition;
  if (exclude_edition) cq.excludeEdition = exclude_edition;

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
  if (cq.edition) { where.push("b.title LIKE ?"); params.push(`%${cq.edition}%`); }
  if (cq.excludeEdition) { where.push("(b.title IS NULL OR b.title NOT LIKE ?)"); params.push(`%${cq.excludeEdition}%`); }
  const base = ` FROM paragraphs p JOIN documents d ON d.id = p.document_id JOIN collections c ON c.id = d.collection_id LEFT JOIN books b ON b.id = d.book_id WHERE ${where.join(" AND ")}`;

  try {
    if (group === "documents") {
      const rs = rows(`SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name, d.chapter, d.volume,
                              c.slug AS collection, b.title AS book_title, COUNT(*) AS hits, MIN(p.rank) AS best ${base} GROUP BY d.id ORDER BY best LIMIT ? OFFSET ?`,
        [...params, limit, offset]);
      out.documents = rs.map((r) => ({ ...summary(r), hits: r.hits }));
      out.total = value(`SELECT COUNT(DISTINCT d.id) ${base}`, params);
      out.ms = Math.round((performance.now() - t0) * 10) / 10;
      return out;
    }
    const rs = rows(`SELECT p.rowid AS paragraph_id, p.document_id, p.pid, p.kind, p.verse, p.text,
                            snippet(paragraphs, 0, ?, ?, ' … ', 48) AS snip, bm25(paragraphs) AS rank,
                            d.uri, d.title, d.author, d.author_role, d.year, d.month, d.session, d.date,
                            d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection, b.title AS book_title
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

  if (offset === 0 && !typeahead && !out.jump) out.original_hint = transliterationHint(q);
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
function naturalSearch(q, { scope, limit, offset, speaker, from, to, book, edition, exclude_edition }) {
  const fixed = correctTypos(q);
  const n = naturalQuery(fixed.text, speakersBySurname());
  if (!n.terms.length) return null;
  const cq = { collections: scopeCollections(n.scope || scope || "all"), speaker: speaker || n.speaker, yearFrom: from ? Number(from) : n.yearFrom, yearTo: to ? Number(to) : n.yearTo, bookSlug: n.bookSlug, terms: n.terms, edition: edition || null, excludeEdition: exclude_edition || null };
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
  if (offset === 0) out.original_hint = transliterationHint(q);
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
  // An edition or volume by words in its title ("Service Missionaries", "Supplement", "Old Testament 2026").
  if (cq.edition) { where.push("b.title LIKE ?"); params.push(`%${cq.edition}%`); }
  if (cq.excludeEdition) { where.push("(b.title IS NULL OR b.title NOT LIKE ?)"); params.push(`%${cq.excludeEdition}%`); }
  return { where, params };
}
function whereParams(cq) { return whereParts(cq).params; }
function baseSql(cq) {
  const { where } = whereParts(cq);
  return ` FROM paragraphs p JOIN documents d ON d.id = p.document_id JOIN collections c ON c.id = d.collection_id LEFT JOIN books b ON b.id = d.book_id WHERE ${["paragraphs MATCH ?", ...where].join(" AND ")}`;
}
function passageRows(match, cq, limit, offset) {
  return rows(`SELECT p.rowid AS paragraph_id, p.document_id, p.pid, p.kind, p.verse, p.text,
                      snippet(paragraphs, 0, ?, ?, ' \u2026 ', 48) AS snip, bm25(paragraphs) AS rank,
                      d.uri, d.title, d.author, d.author_role, d.year, d.month, d.session, d.date,
                      d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection, b.title AS book_title
               ${baseSql(cq)} ORDER BY rank LIMIT ? OFFSET ?`, [HL_OPEN, HL_CLOSE, match, ...whereParams(cq), limit, offset]);
}
function titleMatches(terms, cq) {
  const titleMatch = terms.map((t) => ftsPhrase(t)).filter(Boolean).join(" OR ");
  if (!titleMatch) return [];
  const { where, params } = whereParts(cq);
  try {
    return rows(`SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection, b.title AS book_title
                   FROM documents_fts f JOIN documents d ON d.id=f.rowid JOIN collections c ON c.id=d.collection_id LEFT JOIN books b ON b.id = d.book_id
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
  doc.source_url = r.collection && r.collection.startsWith("jsp-")
    ? `https://www.josephsmithpapers.org${r.uri.replace(/\/(source-note|introduction)$/, "/1")}`
    : `https://www.churchofjesuschrist.org/study${r.uri}?lang=eng`;
  return doc;
}

// Every scripture verse containing any of the given words (prefix-matched, so
// "redeem" also finds redeemed and redeemer), in canonical order. For the
// complete lists a keyword search ranked by relevance cannot give.
const VOLUMES = { ot: "Old Testament", nt: "New Testament", bofm: "Book of Mormon", dc: "Doctrine and Covenants", pgp: "Pearl of Great Price" };
// Every passage in a scope with a word family or an exact phrase, in reading
// order: the tool for "all the references to…" in any part of the library.
function allMatches({ words, phrase, scope = "all", limit = 400, edition = null, exclude_edition = null }) {
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
  if (edition) { where.push("b.title LIKE ?"); params.push(`%${edition}%`); }
  if (exclude_edition) { where.push("(b.title IS NULL OR b.title NOT LIKE ?)"); params.push(`%${exclude_edition}%`); }
  const base = ` FROM paragraphs p JOIN documents d ON d.id = p.document_id JOIN collections c ON c.id = d.collection_id LEFT JOIN books b ON b.id = d.book_id WHERE ${where.join(" AND ")}`;
  let total = 0, rs = [], byDoc = [];
  try {
    total = value(`SELECT COUNT(*) ${base}`, params);
    byDoc = rows(`SELECT d.title AS title, d.volume AS volume, b.title AS book_title, c.slug AS collection, COUNT(*) AS n ${base} GROUP BY d.id ORDER BY d.sort_key`, params);
    rs = rows(`SELECT p.rowid AS paragraph_id, p.document_id, p.pid, p.kind, p.verse, p.text, d.uri, d.title, d.author, d.year, d.month, d.session,
                      d.book_slug, d.book_name, d.chapter, d.volume, c.slug AS collection, b.title AS book_title ${base} ORDER BY d.sort_key, p.seq LIMIT ?`, [...params, Math.min(limit, 600)]);
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
  const d = row("SELECT d.id, d.uri, d.title, d.author, d.year, d.month, d.session, d.book_slug, d.book_name, d.chapter, d.volume, d.par_first, d.par_last, c.slug AS collection, b.title AS book_title FROM documents d JOIN collections c ON c.id=d.collection_id LEFT JOIN books b ON b.id = d.book_id WHERE d.id=?", [docId]);
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
  out.originals = haveOriginals() ? metaValue("originals") : null;
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
    // a long paper of the Joseph Smith Papers is stored one document per page; the entry opens its first page
    const d = docs.get(n.uri) || (n.uri ? docs.get(n.uri + "/1") : undefined);
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

// -------------------------------------------------------------- originals ----
// The Hebrew Bible and the Greek New Testament, word by word (STEP Bible data,
// Tyndale House, CC BY 4.0), keyed to the KJV's chapters and verses. Psalm
// titles are verse 0. Mirrors gospel_library/originals.py.
let originalsKnown = null;
function haveOriginals() {
  if (originalsKnown === null) {
    try { originalsKnown = !!value("SELECT 1 FROM sqlite_master WHERE name='original_words'") && !!metaValue("originals"); }
    catch (_) { originalsKnown = false; }
  }
  return originalsKnown;
}
const HEBREW_RE = /[֐-׿]/, GREEK_RE = /[Ͱ-Ͽἀ-῿]/;
const STRONGS_RE = /^\s*(?:strongs?\s*:?\s*)?([HGhg])\s*0*(\d{1,4})\s*([A-Za-z]?)\s*$/;
// Letters only, the way the index stores them: Hebrew without points or
// cantillation, Greek without accents or breathings and with one sigma.
function plainText(text, lang) {
  if (lang === "he") return text.replace(/[֑-ֽֿ-ׇ]/g, "").replace(/־/g, " ").replace(/׃/g, "").replace(/׀/g, " ").replace(/\s+/g, " ").trim();
  return text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").replace(/ς/g, "σ").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function asciiTranslit(t) { return String(t || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^A-Za-z]/g, "").toLowerCase(); }
function normStrongs(x) {
  const m = STRONGS_RE.exec(String(x || ""));
  return m ? m[1].toUpperCase() + m[2].padStart(4, "0") + m[3].toUpperCase() : null;
}
// What kind of original-language query this is, if any.
function originalKind(q) {
  const t = String(q || "").trim();
  if (!t) return null;
  if (HEBREW_RE.test(t)) return "hebrew";
  if (GREEK_RE.test(t)) return "greek";
  if (STRONGS_RE.test(t)) return "strongs";
  if (/^translit(?:eration)?\s*:/i.test(t)) return "translit";
  return null;
}
function bookOrder(slug) { const b = S.book(slug); return b ? b.book_index ?? S.books.indexOf(b) : 999; }
function langOf(slug) { const b = S.book(slug); return b && b.volume_slug === "new-testament" ? "gr" : "he"; }
function langName(lang) { return lang === "gr" ? "Greek" : "Hebrew"; }
const wordOut = (r) => ({ seq: r.seq, word: r.word, translit: r.translit, gloss: r.gloss, strongs: r.strongs, morph: r.morph, flags: r.flags, tags: r.tags || "" });

function originalWords({ doc_id = null, book = null, chapter = null, verse = null, verse_to = null, parse = false, max_words = 0 }) {
  if (!haveOriginals()) return { available: false };
  if (doc_id !== null && doc_id !== undefined && !book) {
    const d = row("SELECT book_slug, chapter FROM documents WHERE id=?", [Number(doc_id)]);
    if (d) { book = d.book_slug; chapter = d.chapter; }
  }
  if (!book && typeof chapter === "string") {
    const ref = S.parseReference(chapter);
    if (ref) { book = ref.book.slug; chapter = ref.chapter; if (ref.verse && verse === null) { verse = ref.verse; verse_to = ref.verseEnd || ref.verse; } }
  }
  const ch = parseInt(chapter, 10);
  if (!book || !Number.isFinite(ch)) return { available: true, verses: [], lang: null, error: "give a Bible chapter or verse" };
  const where = ["book = ?", "chapter = ?"];
  const params = [book, ch];
  if (verse !== null && verse !== undefined) { where.push("verse BETWEEN ? AND ?"); params.push(Number(verse), Number(verse_to ?? verse)); }
  const rs = rows(`SELECT verse, seq, lang, word, translit, gloss, strongs, root, morph, tags, flags FROM original_words WHERE ${where.join(" AND ")} ORDER BY verse, seq`, params);
  const verses = [];
  let cur = null, truncated = false;
  for (const [i, r] of rs.entries()) {
    if (max_words && i >= max_words) { truncated = true; break; }
    if (!cur || cur.verse !== r.verse) { cur = { verse: r.verse, lang: r.lang, words: [] }; verses.push(cur); }
    const w = wordOut(r);
    if (parse) w.grammar = morphShort(r.morph);
    cur.words.push(w);
  }
  if (truncated && verses.length > 1) verses.pop();
  // the KJV's text of each verse, from the library's own chapter
  const b = S.book(book);
  const d = row("SELECT id, par_first, par_last FROM documents WHERE book_slug=? AND chapter=?", [book, String(ch)]);
  if (d && d.par_first !== null) {
    const texts = new Map(rows("SELECT verse, pid, text FROM paragraphs WHERE rowid BETWEEN ? AND ? AND kind='verse'", [d.par_first, d.par_last]).map((r) => [r.verse, r]));
    for (const v of verses) { const t = texts.get(v.verse); if (t) { v.text = t.text; v.pid = t.pid; } }
    for (const v of verses) v.citation = b ? (v.verse ? S.citation(b, ch, v.verse) : `${S.citation(b, ch)} (title)`) : `${book} ${ch}:${v.verse}`;
  }
  const lang = verses[0]?.lang || langOf(book);
  return { available: true, book, book_name: b ? b.name : book, chapter: ch, doc_id: d ? d.id : null, lang, language: langName(lang), verses, truncated, credit: ORIGINALS_CREDIT };
}
// A grammar code in a few words, for a line of text ("preposition + noun, singular feminine, absolute").
const morphCache = new Map();
function morphShort(code) {
  if (!code) return "";
  if (morphCache.has(code)) return morphCache.get(code);
  const parts = morphCodes(code).map((m) => (m.short || m.code).replace(/^"|"$/g, "").replace(/\s+/g, " ").trim());
  const out = parts.join(" + ");
  morphCache.set(code, out);
  return out;
}
// Where a verse is in the library: for opening it from a lexicon's references.
const STEP_BOOKS = { Gen: "genesis", Exo: "exodus", Lev: "leviticus", Num: "numbers", Deu: "deuteronomy", Jos: "joshua", Jdg: "judges", Rut: "ruth", "1Sa": "1-samuel", "2Sa": "2-samuel", "1Ki": "1-kings", "2Ki": "2-kings", "1Ch": "1-chronicles", "2Ch": "2-chronicles", Ezr: "ezra", Neh: "nehemiah", Est: "esther", Job: "job", Psa: "psalms", Pro: "proverbs", Ecc: "ecclesiastes", Sng: "song-of-solomon", Isa: "isaiah", Jer: "jeremiah", Lam: "lamentations", Ezk: "ezekiel", Dan: "daniel", Hos: "hosea", Jol: "joel", Amo: "amos", Oba: "obadiah", Jon: "jonah", Mic: "micah", Nam: "nahum", Hab: "habakkuk", Zep: "zephaniah", Hag: "haggai", Zec: "zechariah", Mal: "malachi", Mat: "matthew", Mrk: "mark", Luk: "luke", Jhn: "john", Act: "acts", Rom: "romans", "1Co": "1-corinthians", "2Co": "2-corinthians", Gal: "galatians", Eph: "ephesians", Php: "philippians", Col: "colossians", "1Th": "1-thessalonians", "2Th": "2-thessalonians", "1Ti": "1-timothy", "2Ti": "2-timothy", Tit: "titus", Phm: "philemon", Heb: "hebrews", Jas: "james", "1Pe": "1-peter", "2Pe": "2-peter", "1Jn": "1-john", "2Jn": "2-john", "3Jn": "3-john", Jud: "jude", Rev: "revelation" };
function locate({ ref = null, book = null, chapter = null, verse = null }) {
  if (ref) {
    const m = /^([1-3]?[A-Za-z]{2,3})\.(\d+)(?:[.:](\d+))?/.exec(String(ref).trim());
    if (!m) return { found: false };
    book = STEP_BOOKS[m[1]] || null; chapter = Number(m[2]); verse = m[3] ? Number(m[3]) : null;
  }
  if (!book) return { found: false };
  const d = row("SELECT id, par_first, par_last, title FROM documents WHERE book_slug=? AND chapter=?", [book, String(parseInt(chapter, 10))]);
  if (!d) return { found: false };
  let pid = null;
  if (verse && d.par_first !== null) { const p = row("SELECT pid FROM paragraphs WHERE rowid BETWEEN ? AND ? AND kind='verse' AND verse=?", [d.par_first, d.par_last, Number(verse)]); pid = p ? p.pid : null; }
  const b = S.book(book);
  return { found: true, doc_id: d.id, pid, title: d.title, citation: b ? S.citation(b, parseInt(chapter, 10), verse || undefined) : d.title };
}
const ORIGINALS_CREDIT = "STEP Bible data from Tyndale House, Cambridge (CC BY 4.0), www.STEPBible.org";

// A Strong's number: its lexicon entry, the senses the data tells apart, how
// often it occurs and where, with the KJV's verse beside each occurrence.
function lexiconEntry(strongs, limit = 80) {
  if (!haveOriginals()) return null;
  const key = normStrongs(strongs);
  if (!key) return null;
  let entry = row("SELECT * FROM original_lexicon WHERE strongs=?", [key]);
  if (!entry) entry = row("SELECT * FROM original_lexicon WHERE base=? ORDER BY strongs LIMIT 1", [key.slice(0, 5)]);
  const exact = /[A-Z]$/.test(key);
  const cond = exact ? "strongs = ?" : "strongs >= ? AND strongs < ?";
  const cp = exact ? [key] : [key, key + "~"];
  const count = value(`SELECT COUNT(*) FROM original_words WHERE ${cond}`, cp) || 0;
  if (!entry && !count) return null;
  const glosses = rows(`SELECT gloss, COUNT(*) AS n FROM original_words WHERE ${cond} GROUP BY gloss ORDER BY n DESC LIMIT 12`, cp)
    .map((g) => ({ gloss: (g.gloss || "").replace(/[<>\[\]]/g, "").trim(), n: g.n })).filter((g) => g.gloss);
  const senses = entry ? rows("SELECT strongs, lemma, translit, type, gloss FROM original_lexicon WHERE base=? AND strongs != base ORDER BY strongs", [entry.base]) : [];
  const books = rows(`SELECT book, COUNT(*) AS n FROM original_words WHERE ${cond} GROUP BY book`, cp)
    .sort((a, b) => bookOrder(a.book) - bookOrder(b.book)).map((r) => ({ book: r.book, name: S.book(r.book)?.name || r.book, n: r.n }));
  const occ = limit > 0 ? occurrences(cond, cp, limit) : { verses: [], total: value(`SELECT COUNT(DISTINCT book || '/' || chapter || '/' || verse) FROM original_words WHERE ${cond}`, cp) || 0 };
  const lang = entry ? entry.lang : (key[0] === "G" ? "gr" : "he");
  return { strongs: key, lang, language: langName(lang), entry: entry || null, senses, count, glosses, books, verses: occ.verses, verses_total: occ.total, credit: ORIGINALS_CREDIT };
}
// Verses holding words that satisfy a condition on original_words, in the
// order of the books, each with the KJV's text and the words in question.
function occurrences(cond, cp, limit) {
  const rs = rows(`SELECT w.book, w.chapter, w.verse, w.seq, w.lang, w.word, w.translit, w.gloss, w.strongs, w.morph, w.flags, w.tags,
                          d.id AS doc_id, d.uri, d.title, d.sort_key, d.volume, d.book_slug, d.book_name, p.pid, p.text
                     FROM original_words w
                     LEFT JOIN documents d ON d.book_slug = w.book AND d.chapter = CAST(w.chapter AS TEXT)
                     LEFT JOIN paragraphs p ON p.rowid BETWEEN d.par_first AND d.par_last AND p.verse = w.verse AND p.kind = 'verse'
                    WHERE ${cond} ORDER BY d.sort_key, w.chapter, w.verse, w.seq`, cp);
  const verses = [];
  const byKey = new Map();
  for (const r of rs) {
    const k = `${r.book}/${r.chapter}/${r.verse}`;
    let v = byKey.get(k);
    if (!v) {
      if (verses.length >= limit) { byKey.set(k, { skip: true }); continue; }
      v = { ...verseHit(r), words: [] };
      byKey.set(k, v); verses.push(v);
    }
    if (!v.skip) v.words.push(wordOut(r));
  }
  return { verses, total: byKey.size };
}
function verseHit(r) {
  const b = S.book(r.book);
  const cite = b ? (r.verse ? S.citation(b, r.chapter, r.verse) : `${S.citation(b, r.chapter)} (title)`) : `${r.book} ${r.chapter}:${r.verse}`;
  const lang = r.lang || langOf(r.book);
  return { doc_id: r.doc_id ?? null, uri: r.uri || null, pid: r.pid || null, kind: "verse", book: r.book, chapter: r.chapter, verse: r.verse, lang,
           title: r.title || cite, collection: "scriptures", book_slug: r.book, book_name: r.book_name || (b ? b.name : r.book), volume: r.volume || (b ? b.volume_name : null),
           label: r.volume || (b ? b.volume_name : langName(lang)), citation: cite, text: r.text || "" };
}

// What a grammar code means, part by part ("HR/Ncfsa" is a preposition and a noun).
function morphCodes(code) {
  if (!haveOriginals() || !code) return [];
  const parts = String(code).split("/");
  const lang = /^[HA]/.test(parts[0]) && !parts[0].includes("-") ? parts[0][0] : null;
  const out = [];
  for (const [i, raw] of parts.entries()) {
    const c = lang && i > 0 ? lang + raw : raw;
    const r = row("SELECT code, parse, short, meaning, example FROM original_morph WHERE code=?", [c]);
    out.push(r || { code: c, parse: "", short: c, meaning: "", example: "" });
  }
  return out;
}

// Search the original texts: Hebrew or Greek letters (with or without points
// and accents), a Strong's number, or a transliteration ("translit: chesed").
function originalSearch({ q, limit = 40, offset = 0, scope = null, kind = null }) {
  const out = { query: q, hits: [], total: 0, documents: [], jump: null, titles: [], original: null };
  if (!haveOriginals()) return out;
  const t = String(q || "").trim();
  kind = kind || originalKind(t);
  if (!kind) return out;
  let cond = null, cp = [], lang = null, info = { kind };
  if (kind === "strongs") {
    const key = normStrongs(t);
    const exact = /[A-Z]$/.test(key);
    cond = exact ? "w.strongs = ?" : "w.strongs >= ? AND w.strongs < ?";
    cp = exact ? [key] : [key, key + "~"];
    lang = key[0] === "G" ? "gr" : "he";
    const lex = row("SELECT strongs, base, lemma, translit, gloss, type FROM original_lexicon WHERE strongs=?", [key]) || row("SELECT strongs, base, lemma, translit, gloss, type FROM original_lexicon WHERE base=? ORDER BY strongs LIMIT 1", [key.slice(0, 5)]);
    info = { kind, strongs: key, lang, lexicon: lex };
  } else {
    let column, tokens;
    if (kind === "translit") { column = "translit"; tokens = t.replace(/^translit(?:eration)?\s*:/i, "").split(/\s+/).map(asciiTranslit).filter(Boolean); }
    else { lang = kind === "hebrew" ? "he" : "gr"; column = "plain"; tokens = plainText(t, lang).split(/\s+/).filter(Boolean); }
    if (!tokens.length) return out;
    const match = `${column} : (${tokens.map((x) => `"${x.replace(/"/g, "")}"`).join(" ")})`;
    info = { kind, lang, tokens, match };
    // the verses the index finds, then every word of each (the ones carrying the query are kept)
    cond = "w.id IN (SELECT w2.id FROM original_verses v JOIN original_verse_refs r ON r.id = v.rowid JOIN original_words w2 ON w2.book = r.book AND w2.chapter = r.chapter AND w2.verse = r.verse WHERE original_verses MATCH ?)";
    cp = [match];
    const wanted = new Set(tokens);
    let occ;
    try { occ = occurrences(cond, cp, 100000); } catch (err) { out.error = `could not run that query (${err.message})`; return out; }
    for (const v of occ.verses) {
      v.words = v.words.filter((w) => kind === "translit" ? wanted.has(asciiTranslit(w.translit)) : plainText(w.word, v.lang).split(/\s+/).some((x) => wanted.has(x)));
    }
    if (!info.lang && occ.verses.length) info.lang = occ.verses[0].lang;
    return finishOriginal(out, occ, info, limit, offset, scope);
  }
  const occ = occurrences(cond, cp, 100000);
  return finishOriginal(out, occ, info, limit, offset, scope);
}
function finishOriginal(out, occ, info, limit, offset, scope) {
  let verses = occ.verses;
  if (scope && VOLUMES[scope]) verses = verses.filter((v) => v.volume === VOLUMES[scope]);
  out.total = verses.length;
  out.original = { ...info, total: verses.length, language: langName(info.lang || (verses[0] && verses[0].lang) || "he") };
  // The word behind the hits (the commonest Strong's number among them), so
  // the results can offer every form of it and its lexicon entry.
  if (!out.original.lexicon) {
    const tally = new Map();
    for (const v of verses.slice(0, 200)) for (const w of v.words) if (w.strongs) tally.set(w.strongs, (tally.get(w.strongs) || 0) + 1);
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      const key = top[0];
      out.original.strongs = key;
      out.original.lexicon = row("SELECT strongs, base, lemma, translit, gloss, type FROM original_lexicon WHERE strongs=?", [key]) || row("SELECT strongs, base, lemma, translit, gloss, type FROM original_lexicon WHERE base=? ORDER BY strongs LIMIT 1", [key.slice(0, 5)]);
      out.original.all_forms = value("SELECT COUNT(DISTINCT book || '/' || chapter || '/' || verse) FROM original_words WHERE strongs >= ? AND strongs < ?", [key.slice(0, 5), key.slice(0, 5) + "~"]) || 0;
    }
  }
  for (const v of verses.slice(offset, offset + limit)) {
    const shown = v.words.length ? v.words : [];
    const lead = shown.map((w) => `<span class="ow-inline" lang="${v.lang === "he" ? "he" : "el"}">${esc(w.word)}</span> <i>${esc(w.translit || "")}</i>${w.gloss ? `, ${esc(w.gloss.replace(/[<>\[\]]/g, ""))}` : ""}`).join("; ");
    out.hits.push({ ...v, paragraph_id: null, snippet: `${lead ? `<span class="ow-lead">${lead}</span> ` : ""}${esc(v.text)}` });
  }
  return out;
}
// "chesed" or "agape" typed into an ordinary search: the lexicon entry it
// transliterates, so the results can offer the original word.
let translitMap = null;
function transliterationHint(q) {
  if (!haveOriginals() || /\d|["':]/.test(String(q || ""))) return null;
  const words = String(q || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  if (words.length !== 1) return null;
  if (!translitMap) {
    translitMap = new Map();
    try {
      // the commonest word wins a transliteration several share ("hesed" is the covenant word, not the rare name)
      const counts = new Map(rows("SELECT substr(strongs, 1, 5) AS b, COUNT(*) AS n FROM original_words WHERE strongs != '' GROUP BY b").map((r) => [r.b, r.n]));
      for (const r of rows("SELECT strongs, base, lang, lemma, translit, gloss FROM original_lexicon WHERE strongs = base AND translit != ''")) {
        const k = asciiTranslit(r.translit);
        if (!k || k.length < 3) continue;
        const prev = translitMap.get(k);
        if (!prev || (counts.get(r.base) || 0) > (counts.get(prev.base) || 0)) translitMap.set(k, r);
      }
    } catch (_) { translitMap = new Map(); }
  }
  const w = words[0];
  const r = translitMap.get(w) || translitMap.get(w.replace(/^h/, "ch")) || translitMap.get(w.replace(/^ch/, "h")) || translitMap.get(w.replace(/k/g, "q")) || translitMap.get(w.replace(/ts/g, "tz"));
  if (!r) return null;
  const count = value("SELECT COUNT(*) FROM original_words WHERE strongs >= ? AND strongs < ?", [r.base, r.base + "~"]) || 0;
  if (!count) return null;
  return { strongs: r.base, lang: r.lang, language: langName(r.lang), lemma: r.lemma, translit: r.translit, gloss: r.gloss, count };
}
