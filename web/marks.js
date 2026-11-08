/* Highlights and notes: a teacher's marks on the library, kept on this device.

   One record per paragraph marked (its page's address and paragraph id, which outlast a
   rebuild of the library): the highlight color, if any, and the note, if any, with the
   passage's words and citation so the list of marks reads on its own. The records live in
   the browser's database (IndexedDB), apart from the library, so updates leave them alone;
   Export writes them to a file for safekeeping or another device, Import reads one back. */
(() => {
  "use strict";
  const DB = "gospel-marks", STORE = "marks";
  const COLORS = ["y", "g", "b", "p"];
  const COLOR_NAME = { y: "yellow", g: "green", b: "blue", p: "pink" };

  function openDb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        const s = r.result.objectStoreNames.contains(STORE) ? r.transaction.objectStore(STORE) : r.result.createObjectStore(STORE, { keyPath: "id" });
        if (!s.indexNames.contains("uri")) s.createIndex("uri", "uri", { unique: false });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("the marks database did not open"));
    });
  }
  async function tx(mode, work) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = work(t.objectStore(STORE));
      t.oncomplete = () => { db.close(); resolve(req ? req.result : undefined); };
      t.onerror = () => { db.close(); reject(t.error || new Error("the marks database failed")); };
      t.onabort = () => { db.close(); reject(t.error || new Error("the marks database failed")); };
    });
  }
  const idFor = (uri, pid) => `${uri}#${pid}`;
  const forDoc = async (uri) => { try { return (await tx("readonly", (s) => s.index("uri").getAll(uri))) || []; } catch (_) { return []; } };
  const all = async () => { try { return ((await tx("readonly", (s) => s.getAll())) || []).sort((a, b) => b.updated - a.updated); } catch (_) { return []; } };
  const count = async () => (await all()).length;
  const get = (uri, pid) => tx("readonly", (s) => s.get(idFor(uri, pid)));

  // Sets the color and/or the note of one paragraph; a mark with neither is removed.
  async function set({ uri, pid, doc_id = null, verse = null, color, note, text = "", citation = "", title = "", kind = "verse" }) {
    const old = (await get(uri, pid)) || null;
    const now = Date.now();
    const rec = {
      id: idFor(uri, pid), uri, pid, doc_id: doc_id ?? old?.doc_id ?? null, verse: verse ?? old?.verse ?? null, kind,
      color: color === undefined ? old?.color ?? null : color,
      note: note === undefined ? old?.note ?? null : (note && note.trim() ? note.trim() : null),
      text: (text || old?.text || "").slice(0, 400), citation: citation || old?.citation || "", title: title || old?.title || "",
      created: old?.created || now, updated: now,
    };
    if (!rec.color && !rec.note) { if (old) await tx("readwrite", (s) => s.delete(rec.id)); return null; }
    await tx("readwrite", (s) => s.put(rec));
    return rec;
  }
  const remove = (uri, pid) => tx("readwrite", (s) => s.delete(idFor(uri, pid)));

  async function exportJson() {
    return JSON.stringify({ app: "gospel-library", kind: "marks", exported: new Date().toISOString(), marks: await all() }, null, 1);
  }
  // Marks from a file: newer wins where both sides have the same paragraph
  async function importJson(textOrObj) {
    const data = typeof textOrObj === "string" ? JSON.parse(textOrObj) : textOrObj;
    const list = Array.isArray(data) ? data : data && Array.isArray(data.marks) ? data.marks : null;
    if (!list) throw new Error("That file does not hold highlights and notes.");
    let added = 0;
    for (const m of list) {
      if (!m || typeof m.uri !== "string" || typeof m.pid !== "string") continue;
      const rec = { ...m, id: idFor(m.uri, m.pid), color: COLORS.includes(m.color) ? m.color : null, note: typeof m.note === "string" && m.note.trim() ? m.note.trim() : null };
      if (!rec.color && !rec.note) continue;
      const old = await get(m.uri, m.pid);
      if (old && (old.updated || 0) >= (rec.updated || 0)) continue;
      rec.updated = rec.updated || Date.now(); rec.created = rec.created || rec.updated;
      await tx("readwrite", (s) => s.put(rec));
      added++;
    }
    return added;
  }

  window.Marks = { COLORS, COLOR_NAME, forDoc, all, count, get, set, remove, exportJson, importJson };
})();
