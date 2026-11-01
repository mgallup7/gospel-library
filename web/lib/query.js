// Query compilation (mirror of gospel_library/search.py compile_query).
import { parseReference } from "./scriptures.js";

const SCOPES = {
  scriptures: ["scriptures"], scripture: ["scriptures"],
  conference: ["general-conference"], talks: ["general-conference"], gc: ["general-conference"],
  handbook: ["handbook"], cfm: ["come-follow-me"], pmg: ["preach-my-gospel"], standards: ["missionary-standards"], "missionary-standards": ["missionary-standards"],
  manuals: ["manuals", "come-follow-me", "handbook", "preach-my-gospel", "missionary-standards"], manual: ["manuals", "come-follow-me", "handbook", "preach-my-gospel", "missionary-standards"],
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

// ---------------------------------------------------------------------------
// Natural-language queries. "what did nelson say about covenants and identity"
// becomes: speaker Nelson, terms covenant + identity (with synonyms), ranked so
// that passages matching more of the words come first.
// ---------------------------------------------------------------------------

const QUESTION_WORDS = new Set(("what when where which who whom whose why how does do did is are was were be been being have has had " +
  "can could should would will shall may might must the a an and or but if then than so of to in on at by for from with without into onto over under " +
  "about around through during before after between among against up down out off again further once here there this that these those it its " +
  "i me my mine we us our you your he him his she her they them their one ones any some all each every both few more most other such no not only " +
  "own same too very just also ever never always often sometimes something anything nothing everything someone anyone everyone " +
  "say said says saying tell told tells teach taught teaches teaching talk talked talks talking speak spoke spoken speaks mention mentioned " +
  "find show give me list quote quotes quoted verse verses scripture scriptures passage passages reference references about regarding concerning " +
  "pull pulls pulled get gets bring brings fetch grab collect gather compile please mentions mention mentioned cite cites cited citation citations " +
  "places place time times use uses used using word words phrase phrases line lines anywhere everywhere whenever " +
  "need want like look looking search for best good great favorite examples example mean means meaning think thinks thought " +
  "lord's god's").split(/\s+/));

// Scriptural vocabulary that people phrase several ways. Each entry expands a
// typed word into alternatives inside one OR group.
const SYNONYMS = {
  happiness: ["joy", "rejoice", "happy"], joy: ["happiness", "rejoice", "glad"], happy: ["joy", "happiness"],
  obey: ["obedience", "obedient", "keep the commandments", "hearken"], obedience: ["obey", "obedient", "keep the commandments"],
  commandments: ["commandment", "statutes", "law"], sin: ["sins", "iniquity", "transgression", "wickedness"], sins: ["sin", "iniquity", "transgression"],
  repent: ["repentance", "turn"], repentance: ["repent", "turn unto"], forgive: ["forgiveness", "forgiven", "remission"], forgiveness: ["forgive", "forgiven", "remission of sins"],
  faith: ["believe", "belief", "trust"], believe: ["faith", "belief"], hope: ["hope"], charity: ["love", "pure love of christ"], love: ["charity", "loved", "loveth"],
  jesus: ["christ", "savior", "redeemer", "lord"], christ: ["jesus", "savior", "redeemer", "messiah"], savior: ["christ", "jesus", "redeemer"], saviour: ["savior", "christ", "redeemer"],
  "holy ghost": ["spirit", "holy spirit", "comforter"], spirit: ["holy ghost", "comforter"],
  temple: ["house of the lord", "temples", "endowment", "ordinances"], covenant: ["covenants", "covenant path", "promise"], covenants: ["covenant", "covenant path"],
  tithing: ["tithe", "tithes", "offerings"], tithe: ["tithing", "tithes"], prayer: ["pray", "prayed", "praying", "supplication"], pray: ["prayer", "praying", "ask"],
  scripture: ["scriptures", "word of god", "words of christ"], scriptures: ["scripture", "word of god"], missionary: ["missionaries", "preach", "proclaim", "gospel"], missionaries: ["missionary", "preach"],
  gather: ["gathering", "gathered", "israel"], gathering: ["gather", "gathered", "israel"], zion: ["zion", "new jerusalem"], atonement: ["atone", "atoning", "redeem", "redemption"],
  grace: ["grace", "mercy"], mercy: ["merciful", "grace"], justice: ["just", "judgment"], peace: ["peace", "peaceable", "rest"], fear: ["fear", "afraid", "courage"], courage: ["courageous", "fear not", "be of good cheer"],
  family: ["families", "parents", "children", "home"], marriage: ["marry", "married", "husband", "wife"], children: ["child", "little ones", "youth"], youth: ["young", "children", "rising generation"],
  death: ["die", "died", "resurrection", "spirit world"], resurrection: ["resurrected", "rise again", "immortality"], heaven: ["celestial", "kingdom of god", "eternal life"],
  priesthood: ["priesthood", "keys", "ordain"], revelation: ["reveal", "revealed", "inspiration", "spirit"], prophet: ["prophets", "seer", "revelator"], prophets: ["prophet", "seers"],
  trial: ["trials", "affliction", "adversity", "tribulation"], trials: ["trial", "afflictions", "adversity", "tribulation"], suffering: ["suffer", "affliction", "pain"],
  humble: ["humility", "meek", "lowly"], humility: ["humble", "meek", "lowly of heart"], pride: ["proud", "lifted up", "haughty"], service: ["serve", "serving", "minister"], serve: ["service", "minister", "ministering"],
  sabbath: ["sabbath day", "lord's day", "sunday"], sacrament: ["sacrament", "bread and water", "remembrance"], baptism: ["baptize", "baptized", "born again"], endure: ["endure to the end", "endured", "press forward"],
  identity: ["child of god", "who you are", "divine nature", "children of god"], testimony: ["testify", "witness", "know"], agency: ["choose", "free to choose", "liberty"],
};

const BOOK_WORDS = new Map([
  ["nephi", "1-nephi"], ["alma", "alma"], ["mosiah", "mosiah"], ["helaman", "helaman"], ["moroni", "moroni"], ["mormon", "mormon"], ["ether", "ether"], ["jacob", "jacob"], ["enos", "enos"],
  ["isaiah", "isaiah"], ["jeremiah", "jeremiah"], ["ezekiel", "ezekiel"], ["daniel", "daniel"], ["genesis", "genesis"], ["exodus", "exodus"], ["deuteronomy", "deuteronomy"], ["joshua", "joshua"],
  ["psalms", "psalms"], ["psalm", "psalms"], ["proverbs", "proverbs"], ["matthew", "matthew"], ["luke", "luke"], ["romans", "romans"], ["corinthians", "1-corinthians"], ["hebrews", "hebrews"],
  ["revelation", "revelation"], ["moses", "moses"], ["abraham", "abraham"], ["d&c", "sections"], ["dc", "sections"],
]);
const SCOPE_WORDS = { conference: "conference", talks: "conference", talk: "conference", scriptures: "scriptures", scripture: "scriptures", handbook: "handbook", pmg: "pmg", "preach my gospel": "pmg", "come follow me": "cfm", "topical guide": "helps", "bible dictionary": "helps", "missionary standards": "standards", "the standards": "standards", "msdjc": "standards" };

export function isNatural(raw) {
  const t = raw.trim();
  if (/[":()*]|(^|\s)-\w|\b(OR|AND|NOT)\b|\w+:\S/.test(t)) return false; // explicit syntax wins
  const words = t.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length < 3) return false;
  return words.some((w) => QUESTION_WORDS.has(w));
}

/** Turn a question into search parts. speakers: [{name, surname}] from the library. */
// The entry a wording belongs to ("holy spirit" is listed under "holy ghost").
let SYN_REVERSE = null;
function synonymKey(wording) {
  if (!SYN_REVERSE) { SYN_REVERSE = new Map(); for (const [k, alts] of Object.entries(SYNONYMS)) for (const a of alts) if (!SYN_REVERSE.has(a)) SYN_REVERSE.set(a, k); }
  return SYN_REVERSE.get(wording) || null;
}

export function naturalQuery(raw, speakers = []) {
  let text = raw.trim().toLowerCase().replace(/[?.!,;]+/g, " ").replace(/’/g, "'");
  const out = { speaker: null, scope: null, bookSlug: null, yearFrom: null, yearTo: null, terms: [], phrase: null, strict: null, loose: null };

  for (const [phrase, scope] of Object.entries(SCOPE_WORDS)) {
    if (text.includes(" " + phrase + " ") || text.startsWith(phrase + " ") || text.endsWith(" " + phrase)) { out.scope = scope; text = text.replace(phrase, " "); break; }
  }
  text = text.replace(/\b(19[7-9]\d|20[0-4]\d)s?\b/g, (m) => { const y = parseInt(m, 10); out.yearFrom = out.yearFrom ? Math.min(out.yearFrom, y) : y; out.yearTo = out.yearTo ? Math.max(out.yearTo, y) : y; if (m.endsWith("s")) out.yearTo = y + 9; return " "; });

  // Two-word ideas first ("holy ghost", "covenant path"), so they stay together.
  for (const key of Object.keys(SYNONYMS).filter((k) => k.includes(" "))) {
    if (text.includes(key)) text = text.replace(key, key.replace(" ", "_"));
  }
  let words = text.split(/\s+/).filter(Boolean).map((w) => w.replace(/_/g, " "));
  // speakers: a surname that the library knows, in a question that asks what someone said
  const asksWho = /\b(say|said|says|teach|taught|teaches|talk|talks|talked|quote|quotes|elder|president|sister|brother|bishop|speak|spoke|think|thinks|according)\b/.test(text);
  if (speakers.length && asksWho) {
    for (const w of words) {
      const hit = speakers.find((s) => s.surname === w);
      if (hit) { out.speaker = hit.name; words = words.filter((x) => x !== w); break; }
    }
  }
  // a scripture book named in passing: "in alma", "from the psalms"
  for (const w of words) {
    if (BOOK_WORDS.has(w) && words.length > 2) { out.bookSlug = BOOK_WORDS.get(w); words = words.filter((x) => x !== w); if (out.bookSlug === "1-nephi") out.bookSlug = null; break; }
  }
  const trim = (list) => {
    let a = 0, b = list.length - 1;
    while (a <= b && QUESTION_WORDS.has(list[a])) a++;
    while (b >= a && QUESTION_WORDS.has(list[b])) b--;
    return list.slice(a, b + 1);
  };
  const group = (w) => {
    const alts = [w, ...(SYNONYMS[w] || [])].map((a) => phrase(a)).filter(Boolean);
    return alts.length > 1 ? `(${alts.join(" OR ")})` : alts[0];
  };

  // "holy spirit or spirit of god": each side of an "or" is one idea, and a
  // side of several words is searched as the phrase it is.
  if (words.includes("or")) {
    const sides = [];
    let cur = [];
    for (const w of words) { if (w === "or") { sides.push(cur); cur = []; } else cur.push(w); }
    sides.push(cur);
    const alts = [], terms = [];
    for (const side of sides) {
      const core = trim(side);
      const content = core.filter((w) => !QUESTION_WORDS.has(w) && w.length > 1 && /[a-z]/.test(w));
      if (!content.length) continue;
      terms.push(...content);
      const joined = core.join(" ");
      const known = SYNONYMS[joined] ? joined : synonymKey(joined);
      alts.push(known ? group(known) : core.length >= 2 && core.length <= 6 ? phrase(joined) : group(content[0]));
    }
    if (alts.length >= 2) {
      out.terms = [...new Set(terms)];
      out.strict = alts.join(" OR ");
      out.loose = alts.length > 1 ? alts.join(" OR ") : null;
      return out;
    }
  }

  const content = words.filter((w) => !QUESTION_WORDS.has(w) && w.length > 1 && /[a-z]/.test(w));
  const uniq = [...new Set(content)];
  if (!uniq.length) return out;
  out.terms = uniq;

  // The words as typed, trimmed of leading and trailing filler: an exact phrase
  // such as "plan of happiness" should beat any clever expansion.
  const core = trim(words);
  if (core.length >= 2 && core.length <= 7 && core.some((w) => !QUESTION_WORDS.has(w))) out.phrase = phrase(core.join(" "));

  const groups = uniq.map(group);
  out.strict = groups.join(" AND ");
  out.loose = groups.length > 1 ? groups.join(" OR ") : null;
  return out;
}
