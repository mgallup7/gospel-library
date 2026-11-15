/* Highlights and notes: a teacher's marks on the library, kept on this device.

   One record per paragraph marked (its page's address and paragraph id, which outlast a
   rebuild of the library): the highlight color, if any, and the note, if any, with the
   passage's words and citation so the list of marks reads on its own. A note written over
   several verses (Alma 32:26-28) is kept on the first, with pid_end and verse_end naming the
   last; records from before ranges simply have none. The records live in
   the browser's database (IndexedDB), apart from the library, so updates leave them alone;
   Export writes them to a file for safekeeping or another device, Import reads one back.

   Two more kinds of record sit beside those: some words inside a verse (kind "phrase") and a
   Hebrew or Greek word (kind "word"), each with a color. And a mark taken off leaves a small
   record that says so (a tombstone), so that the removal reaches his other devices: dump()
   hands every record over, merge() takes another device's and keeps the later of each
   (lib/markstore.js has the rules), onChange() tells whoever carries them between devices. */
import { database } from "./lib/idb.js";
import { COLORS, clean, mergeRecords, stale, stamp } from "./lib/markstore.js";

(() => {
  "use strict";
  const DB = "gospel-marks", STORE = "marks";
  const COLOR_NAME = { y: "yellow", g: "green", b: "blue", p: "pink" };

  // lib/idb.js opens the database for each piece of work and closes it after
  const db = database({ name: DB, label: "marks", upgrade(d, t) {
    const s = d.objectStoreNames.contains(STORE) ? t.objectStore(STORE) : d.createObjectStore(STORE, { keyPath: "id" });
    if (!s.indexNames.contains("uri")) s.createIndex("uri", "uri", { unique: false });
  } });
  const tx = (mode, work) => db.tx(STORE, mode, work);
  const idFor = (uri, pid) => `${uri}#${pid}`;
  const live = (r) => !!r && !r.deleted;
  const whole = (r) => live(r) && r.kind !== "phrase" && r.kind !== "word"; // a verse or paragraph mark, the only kind there was
  // A database that will not open reads as an empty list, so the page still shows; it is also
  // written to the error log, so "no highlights" can be told from "the highlights could not be read".
  const failed = (where, err) => { window.GLLog?.note(where, err); return []; };
  const ofDoc = async (uri, where) => { try { return (await tx("readonly", (s) => s.index("uri").getAll(uri))) || []; } catch (err) { return failed(where, err); } };
  // forDoc is what it always was: the verse and paragraph marks of one page. The newer kinds
  // have their own readers, so code written before them never meets a record it does not know.
  const forDoc = async (uri) => (await ofDoc(uri, "marks.forDoc")).filter(whole);
  const phrases = async (uri) => (await ofDoc(uri, "marks.phrases")).filter((r) => live(r) && r.kind === "phrase");
  const words = async (uri) => (await ofDoc(uri, "marks.words")).filter((r) => live(r) && r.kind === "word");
  const all = async () => { try { return ((await tx("readonly", (s) => s.getAll())) || []).filter(live).sort((a, b) => b.updated - a.updated); } catch (err) { return failed("marks.all", err); } };
  const count = async () => (await all()).length;
  const raw = (id) => tx("readonly", (s) => s.get(id));
  const getId = async (id) => { const r = await raw(id); return live(r) ? r : null; };
  const get = (uri, pid) => getId(idFor(uri, pid));

  // Whoever carries the marks between devices is told of each change: local for one made here
  // (to send), not local for one that came in (already theirs). Open pages hear the same as a
  // window event and draw again.
  const listeners = [];
  function onChange(fn) {
    if (typeof fn === "function") listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }
  function changed(local) {
    for (const fn of listeners.slice()) { try { fn({ local }); } catch (err) { window.GLLog?.note("marks.onChange", err); } }
    try { window.dispatchEvent(new CustomEvent("marks:change", { detail: { local } })); } catch (_) {}
  }
  // a mark taken off: its id and when, kept so the removal can be told to another device
  async function bury(id) {
    const old = await raw(id);
    if (!old || old.deleted) return false;
    await tx("readwrite", (s) => s.put({ id, deleted: true, updated: stamp(old) }));
    return true;
  }

  // Sets the color and/or the note of one paragraph; a mark with neither is removed. pid_end and
  // verse_end (left out: kept as they were) give the last paragraph a note covers; a range goes
  // when its note does.
  async function set({ uri, pid, doc_id = null, verse = null, color, note, text = "", citation = "", title = "", kind = "verse", pid_end, verse_end }) {
    const was = (await raw(idFor(uri, pid))) || null; // what the row holds, a tombstone included: the new time must pass it
    const old = live(was) ? was : null;
    const now = stamp(was);
    const rec = {
      id: idFor(uri, pid), uri, pid, doc_id: doc_id ?? old?.doc_id ?? null, verse: verse ?? old?.verse ?? null, kind,
      color: color === undefined ? old?.color ?? null : color,
      note: note === undefined ? old?.note ?? null : (note && note.trim() ? note.trim() : null),
      pid_end: pid_end === undefined ? old?.pid_end ?? null : pid_end || null,
      verse_end: verse_end === undefined ? old?.verse_end ?? null : Number.isFinite(verse_end) ? verse_end : null,
      text: (text || old?.text || "").slice(0, 400), citation: citation || old?.citation || "", title: title || old?.title || "",
      created: old?.created || now, updated: now,
    };
    if (!rec.note || rec.pid_end === pid) { rec.pid_end = null; rec.verse_end = null; }
    if (!rec.color && !rec.note) { if (old && await bury(rec.id)) changed(true); return null; }
    await tx("readwrite", (s) => s.put(rec));
    changed(true);
    return rec;
  }
  const removeId = async (id) => { if (await bury(id)) changed(true); };
  const remove = (uri, pid) => removeId(idFor(uri, pid));

  // A phrase or a word mark, written whole: { kind: "phrase", uri, pid, start, end, color, ... }
  // or { kind: "word", id, color, ... }. The fields are checked as a file's would be; what is
  // not a mark is refused.
  async function save(fields) {
    const draft = clean({ ...fields, updated: 1 });
    if (!draft || draft.deleted || whole(draft)) throw new Error("That is not a phrase or word mark.");
    const was = (await raw(draft.id)) || null;
    const now = stamp(was);
    const rec = { ...draft, created: (live(was) && was.created) || now, updated: now };
    await tx("readwrite", (s) => s.put(rec));
    changed(true);
    return rec;
  }

  // The file, from a list already read (so a share can start inside the tap that asked for it)
  function exportJsonOf(marks) {
    return JSON.stringify({ app: "gospel-library", kind: "marks", exported: new Date().toISOString(), marks: (marks || []).filter(live) }, null, 1);
  }
  async function exportJson() { return exportJsonOf(await all()); }
  // Marks from a file: newer wins where both sides have the same mark. A file is his own doing,
  // so a mark he took off here comes back from it, dated now so the other devices take it back too.
  async function importJson(textOrObj) {
    const data = typeof textOrObj === "string" ? JSON.parse(textOrObj) : textOrObj;
    const list = Array.isArray(data) ? data : data && Array.isArray(data.marks) ? data.marks : null;
    if (!list) throw new Error("That file does not hold highlights and notes.");
    let added = 0;
    for (const m of list) {
      const rec = clean(m);
      if (!rec || rec.deleted) continue;
      const old = await raw(rec.id);
      if (live(old) && (old.updated || 0) >= (rec.updated || 0)) continue;
      if (old && old.deleted) rec.updated = stamp(old);
      rec.updated = rec.updated || Date.now(); rec.created = rec.created || rec.updated;
      await tx("readwrite", (s) => s.put(rec));
      added++;
    }
    if (added) changed(true);
    return added;
  }

  // The whole store put back as a list had it (records from all(), as they were): for the Undo of
  // an import. What the list does not have is taken off, and what it has differently is written
  // again, each dated now, so the other devices follow the Undo as they followed the import.
  async function replaceAll(list) {
    const keep = new Map();
    for (const rec of Array.isArray(list) ? list : []) if (rec && typeof rec.id === "string" && !rec.deleted) keep.set(rec.id, rec);
    const held = await dump();
    const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
    const put = [];
    for (const r of held) if (!r.deleted && !keep.has(r.id)) put.push({ id: r.id, deleted: true, updated: stamp(r) });
    const byId = new Map(held.map((r) => [r.id, r]));
    for (const rec of keep.values()) {
      const now = byId.get(rec.id);
      if (!now || now.deleted || !same(now, rec)) put.push({ ...rec, updated: stamp(now) });
    }
    if (!put.length) return;
    await tx("readwrite", (s) => { for (const r of put) s.put(r); });
    changed(true);
  }

  // ---- for the sync between devices
  // every record, tombstones included
  async function dump() { return (await tx("readonly", (s) => s.getAll())) || []; }
  // records from another device: per id the later change is kept (a removal wins the same way)
  async function merge(records) {
    const mine = new Map((await dump()).map((r) => [r.id, r]));
    const put = mergeRecords(mine, records);
    if (put.length) {
      await tx("readwrite", (s) => { for (const r of put) s.put(r); });
      changed(false);
    }
    return { changed: put.length };
  }
  // at open: tombstones past their time are dropped
  (async () => {
    try {
      const old = (await dump()).filter((r) => stale(r));
      if (old.length) await tx("readwrite", (s) => { for (const r of old) s.delete(r.id); });
    } catch (err) { window.GLLog?.note("marks.tidy", err); }
  })();

  window.Marks = { COLORS, COLOR_NAME, forDoc, phrases, words, all, count, get, getId, set, save, remove, removeId, exportJson, exportJsonOf, importJson, replaceAll, dump, merge, onChange };
})();
