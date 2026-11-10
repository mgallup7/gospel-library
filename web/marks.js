/* Highlights and notes: a teacher's marks on the library, kept on this device.

   One record per paragraph marked (its page's address and paragraph id, which outlast a
   rebuild of the library): the highlight color, if any, and the note, if any, with the
   passage's words and citation so the list of marks reads on its own. A note written over
   several verses (Alma 32:26-28) is kept on the first, with pid_end and verse_end naming the
   last; records from before ranges simply have none. The records live in
   the browser's database (IndexedDB), apart from the library, so updates leave them alone;
   Export writes them to a file for safekeeping or another device, Import reads one back. */
import { database } from "./lib/idb.js";

(() => {
  "use strict";
  const DB = "gospel-marks", STORE = "marks";
  const COLORS = ["y", "g", "b", "p"];
  const COLOR_NAME = { y: "yellow", g: "green", b: "blue", p: "pink" };

  // lib/idb.js opens the database for each piece of work and closes it after
  const db = database({ name: DB, label: "marks", upgrade(d, t) {
    const s = d.objectStoreNames.contains(STORE) ? t.objectStore(STORE) : d.createObjectStore(STORE, { keyPath: "id" });
    if (!s.indexNames.contains("uri")) s.createIndex("uri", "uri", { unique: false });
  } });
  const tx = (mode, work) => db.tx(STORE, mode, work);
  const idFor = (uri, pid) => `${uri}#${pid}`;
  // A database that will not open reads as an empty list, so the page still shows; it is also
  // written to the error log, so "no highlights" can be told from "the highlights could not be read".
  const failed = (where, err) => { window.GLLog?.note(where, err); return []; };
  const forDoc = async (uri) => { try { return (await tx("readonly", (s) => s.index("uri").getAll(uri))) || []; } catch (err) { return failed("marks.forDoc", err); } };
  const all = async () => { try { return ((await tx("readonly", (s) => s.getAll())) || []).sort((a, b) => b.updated - a.updated); } catch (err) { return failed("marks.all", err); } };
  const count = async () => (await all()).length;
  const get = (uri, pid) => tx("readonly", (s) => s.get(idFor(uri, pid)));

  // Sets the color and/or the note of one paragraph; a mark with neither is removed. pid_end and
  // verse_end (left out: kept as they were) give the last paragraph a note covers; a range goes
  // when its note does.
  async function set({ uri, pid, doc_id = null, verse = null, color, note, text = "", citation = "", title = "", kind = "verse", pid_end, verse_end }) {
    const old = (await get(uri, pid)) || null;
    const now = Date.now();
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
    if (!rec.color && !rec.note) { if (old) await tx("readwrite", (s) => s.delete(rec.id)); return null; }
    await tx("readwrite", (s) => s.put(rec));
    return rec;
  }
  const remove = (uri, pid) => tx("readwrite", (s) => s.delete(idFor(uri, pid)));

  // The file, from a list already read (so a share can start inside the tap that asked for it)
  function exportJsonOf(marks) {
    return JSON.stringify({ app: "gospel-library", kind: "marks", exported: new Date().toISOString(), marks }, null, 1);
  }
  async function exportJson() { return exportJsonOf(await all()); }
  // Marks from a file: newer wins where both sides have the same paragraph
  async function importJson(textOrObj) {
    const data = typeof textOrObj === "string" ? JSON.parse(textOrObj) : textOrObj;
    const list = Array.isArray(data) ? data : data && Array.isArray(data.marks) ? data.marks : null;
    if (!list) throw new Error("That file does not hold highlights and notes.");
    let added = 0;
    for (const m of list) {
      if (!m || typeof m.uri !== "string" || typeof m.pid !== "string") continue;
      const str = (v, max) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)).slice(0, max);
      const rec = { id: idFor(m.uri, m.pid), uri: m.uri, pid: m.pid, doc_id: Number.isFinite(m.doc_id) ? m.doc_id : null, verse: Number.isFinite(m.verse) ? m.verse : null,
        kind: m.kind === "para" ? "para" : "verse", color: COLORS.includes(m.color) ? m.color : null, note: typeof m.note === "string" && m.note.trim() ? m.note.trim().slice(0, 4000) : null,
        text: str(m.text, 400), citation: str(m.citation, 200), title: str(m.title, 200),
        created: Number.isFinite(m.created) ? m.created : 0, updated: Number.isFinite(m.updated) ? m.updated : 0 };
      // a range is an id like the pid (letters, digits, - and _) and only rides on a note; files from before ranges have none
      const end = typeof m.pid_end === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(m.pid_end) && m.pid_end !== m.pid && rec.note ? m.pid_end : null;
      rec.pid_end = end;
      rec.verse_end = end && Number.isFinite(m.verse_end) ? m.verse_end : null;
      if (!rec.color && !rec.note) continue;
      const old = await get(m.uri, m.pid);
      if (old && (old.updated || 0) >= (rec.updated || 0)) continue;
      rec.updated = rec.updated || Date.now(); rec.created = rec.created || rec.updated;
      await tx("readwrite", (s) => s.put(rec));
      added++;
    }
    return added;
  }

  window.Marks = { COLORS, COLOR_NAME, forDoc, all, count, get, set, remove, exportJson, exportJsonOf, importJson };
})();
