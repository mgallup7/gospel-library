// The rules of the marks store, apart from the database, so they can be tested in node and so
// two devices that trade their marks agree on what each ends up holding.
//
// A record is one of four kinds, each with an id and the time it was last changed (updated, ms):
//   verse, para   a whole verse or paragraph: id "<uri>#<pid>", a color and/or a note
//   phrase        some words inside one: id "<uri>#<pid>~<start>-<end>" (word indexes), a color
//   word          a Hebrew or Greek word: id "orig:<book>.<chapter>.<verse>.<seq>:<he|gr>", a color
// or a tombstone { id, deleted: true, updated }: what a removed mark leaves behind, so the
// removal reaches the other devices. Between two records with one id the later change wins.

export const COLORS = ["y", "g", "b", "p"];
export const TOMB_MS = 180 * 24 * 60 * 60 * 1000; // a tombstone is kept this long, then dropped
const WORD_ID = /^orig:[A-Za-z0-9_-]{1,40}\.\d{1,3}\.\d{1,3}\.\d{1,7}:(he|gr)$/;

const str = (v, max) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)).slice(0, max);
const num = (v) => (Number.isFinite(v) ? v : null);
const when = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

// One record as the store will hold it, whatever it came from (a file, another device, this
// page): known fields only, each checked; null for anything that is not a mark.
export function clean(m) {
  if (!m || typeof m !== "object") return null;
  if (m.deleted === true) {
    return typeof m.id === "string" && m.id && m.id.length <= 600 ? { id: m.id, deleted: true, updated: when(m.updated) } : null;
  }
  const color = COLORS.includes(m.color) ? m.color : null;
  const common = { doc_id: num(m.doc_id), verse: num(m.verse), text: str(m.text, 400), citation: str(m.citation, 200), title: str(m.title, 200), created: when(m.created), updated: when(m.updated) };
  if (m.kind === "word") {
    if (typeof m.id !== "string" || !WORD_ID.test(m.id) || !color) return null;
    return { id: m.id, uri: str(m.uri, 400), pid: typeof m.pid === "string" ? m.pid.slice(0, 80) : null, kind: "word", color, note: null,
      strongs: str(m.strongs, 24), lang: m.id.slice(-2), ...common };
  }
  if (typeof m.uri !== "string" || typeof m.pid !== "string" || !m.uri || !m.pid) return null;
  if (m.kind === "phrase") {
    const start = m.start, end = m.end;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > 100000 || !color) return null;
    return { id: `${m.uri}#${m.pid}~${start}-${end}`, uri: m.uri, pid: m.pid, kind: "phrase", start, end, color, note: null, ...common };
  }
  const note = typeof m.note === "string" && m.note.trim() ? m.note.trim().slice(0, 4000) : null;
  if (!color && !note) return null;
  // a range is an id like the pid (letters, digits, - and _) and only rides on a note; records from before ranges have none
  const pidEnd = typeof m.pid_end === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(m.pid_end) && m.pid_end !== m.pid && note ? m.pid_end : null;
  return { id: `${m.uri}#${m.pid}`, uri: m.uri, pid: m.pid, kind: m.kind === "para" ? "para" : "verse", color, note,
    pid_end: pidEnd, verse_end: pidEnd && Number.isFinite(m.verse_end) ? m.verse_end : null, ...common };
}

// the same record always reads the same, whatever order its fields were written in
function canon(r) { return JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]])); }

// Does a take b's place? The later change does; at the very same instant a removal does, and
// past that the choice is arbitrary but the same on every device.
export function wins(a, b) {
  if (!b) return true;
  const ua = a.updated || 0, ub = b.updated || 0;
  if (ua !== ub) return ua > ub;
  if (!!a.deleted !== !!b.deleted) return !!a.deleted;
  return canon(a) > canon(b);
}

// What to write so this device holds the later of each record: mine is a Map of id to the
// record held now, theirs a list from another device. Returns the records to put.
export function mergeRecords(mine, theirs, now = Date.now()) {
  const put = new Map();
  for (const raw of Array.isArray(theirs) ? theirs : []) {
    const rec = clean(raw);
    if (!rec) continue;
    if (rec.deleted && rec.updated < now - TOMB_MS) continue; // too old to matter, and it would only be dropped again
    const held = put.get(rec.id) || mine.get(rec.id) || null;
    const local = held ? clean(held) || held : null;
    if (local && (canon(local) === canon(rec) || !wins(rec, local))) continue;
    put.set(rec.id, rec);
  }
  return [...put.values()];
}

// a tombstone that has outlived its use
export function stale(rec, now = Date.now()) { return !!rec && rec.deleted === true && (rec.updated || 0) < now - TOMB_MS; }

// the time to write on a change made here: now, and always later than the record it changes
// (another device's clock may run ahead of this one's)
export function stamp(old, now = Date.now()) { return Math.max(now, ((old && old.updated) || 0) + 1); }
