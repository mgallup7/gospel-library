// Query compilation (mirror of gospel_library/search.py compile_query).
import { parseReference } from "./scriptures.js";

const SCOPES = {
  scriptures: ["scriptures"], scripture: ["scriptures"],
  conference: ["general-conference"], talks: ["general-conference"], gc: ["general-conference"],
  handbook: ["handbook"], cfm: ["come-follow-me"], pmg: ["preach-my-gospel"],
  manuals: ["manuals", "come-follow-me", "handbook", "preach-my-gospel"], manual: ["manuals", "come-follow-me", "handbook", "preach-my-gospel"],
  helps: ["study-helps"], all: [],
};
const FILTER = /(speaker|by|year|book|in|scope):("[^"]+"|\S+)/gi;
const TOKEN = /"([^"]*)"|(\S+)/g;

function words(text) {
  return text.replace(/’/g, "'").split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
}
function phrase(text) {
  const w = words(text);
  if (!w.length) return "";
  return '"' + w.join(" ").replace(/"/g, '""') + '"';
}

export function scopeCollections(scope) {
  return SCOPES[scope] ? [...SCOPES[scope]] : [];
}

/** Returns {match, collections, speaker, yearFrom, yearTo, bookSlug, terms}. */
export function compileQuery(raw, { typeahead = false, scope = null } = {}) {
  const q = { raw, match: null, collections: scopeCollections(scope), speaker: null, yearFrom: null, yearTo: null, bookSlug: null, terms: [] };
  let text = raw.trim();
  text = text.replace(FILTER, (_, key, val) => {
    key = key.toLowerCase(); val = val.replace(/^"|"$/g, "");
    if (key === "speaker" || key === "by") q.speaker = val;
    else if (key === "year") {
      const parts = val.split(/[-–]/);
      const a = parseInt(parts[0], 10);
      if (!isNaN(a)) { q.yearFrom = a; q.yearTo = parts.length > 1 && parts[1] ? parseInt(parts[1], 10) : a; }
    } else if (key === "book") {
      const ref = parseReference(val);
      if (ref) q.bookSlug = ref.book.slug;
    } else if ((key === "in" || key === "scope") && SCOPES[val.toLowerCase()]) q.collections = [...SCOPES[val.toLowerCase()]];
    return " ";
  });
  const endsWithSpace = raw.endsWith(" ");
  const pieces = [];
  const negatives = [];
  const tokens = [...text.matchAll(TOKEN)];
  tokens.forEach((m, i) => {
    const last = i === tokens.length - 1;
    const [, ph, word] = m;
    if (ph !== undefined && ph !== "") {
      const p = phrase(ph);
      if (p) { pieces.push(p); q.terms.push(ph); }
      return;
    }
    if (ph === "") return;
    if (word === "OR" || word === "AND" || word === "NOT") { if (word === "OR" && pieces.length) pieces.push("OR"); return; }
    const negate = word.startsWith("-") && word.length > 1;
    const core = negate ? word.slice(1) : word;
    const ws = words(core);
    if (!ws.length) return;
    if (negate) { negatives.push(phrase(ws.join(" "))); return; }
    q.terms.push(...ws);
    let expr = phrase(ws.join(" "));
    if (typeahead && last && !endsWithSpace && ws[ws.length - 1].length >= 2) expr += "*";
    pieces.push(expr);
  });
  while (pieces.length && pieces[pieces.length - 1] === "OR") pieces.pop();
  while (pieces.length && pieces[0] === "OR") pieces.shift();
  if (pieces.length) {
    let match = pieces.join(" ");
    for (const n of negatives) match = `(${match}) NOT ${n}`;
    q.match = match;
  }
  return q;
}

export { phrase as ftsPhrase, words as ftsWords };
