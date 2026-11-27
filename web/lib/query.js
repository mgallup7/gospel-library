// Query compilation (mirror of gospel_library/search.py compile_query).
import { parseReference } from "./scriptures.js";

const SCOPES = {
  scriptures: ["scriptures"], scripture: ["scriptures"],
  conference: ["general-conference"], talks: ["general-conference"], gc: ["general-conference"],
  handbook: ["handbook"], cfm: ["come-follow-me"], pmg: ["preach-my-gospel"], standards: ["missionary-standards"], "missionary-standards": ["missionary-standards"],
  manuals: ["manuals", "come-follow-me", "handbook", "preach-my-gospel", "missionary-standards"], manual: ["manuals", "come-follow-me", "handbook", "preach-my-gospel", "missionary-standards"],
  helps: ["study-helps"], hymns: ["hymns"], hymn: ["hymns"], all: [],
  jsp: ["jsp-journals", "jsp-revelations", "jsp-histories", "jsp-documents", "jsp-administrative", "jsp-legal", "jsp-financial"], papers: ["jsp-journals", "jsp-revelations", "jsp-histories", "jsp-documents", "jsp-administrative", "jsp-legal", "jsp-financial"], "joseph-smith-papers": ["jsp-journals", "jsp-revelations", "jsp-histories", "jsp-documents", "jsp-administrative", "jsp-legal", "jsp-financial"],
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
    const core = (negate ? word.slice(1) : word).replace(/['’]s$/i, ""); // moroni's: the name
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
// How much a passage looks like the line that was typed: its words, in their
// order, close together, the rare ones counting most. This is what lets a
// half-remembered verse lead the passages that merely share a word with it.
// ---------------------------------------------------------------------------

// Words too common to anchor a search on (they still count, lightly, in the score).
export const TINY = new Set("the a an of and to in that is are was were be it for with as unto i ye he his my me we they them our your not but or shall will this have had by on at from so if then all which who".split(" "));
// The King James form and the modern one are one word: hath/has, saith/says, ye/you, knoweth/knows.
const FOLD = { hath: "has", doth: "do", doeth: "do", does: "do", saith: "say", says: "say", sayeth: "say", ye: "you", thee: "you", thou: "you", thy: "your", thine: "your", unto: "to", art: "are", wilt: "will", shalt: "shall", hast: "has", dost: "do", didst: "did", whither: "where", spake: "spoke" };
export function foldWord(word) {
  let w = String(word).toLowerCase();
  if (FOLD[w]) return FOLD[w];
  if (w.length >= 5 && w.endsWith("eth")) { const base = w.slice(0, -3); w = base.length >= 3 ? base : w.slice(0, -2); }
  else if (w.length >= 7 && w.endsWith("est")) w = w.slice(0, -3);
  else if (w.length >= 4 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  if (w.length >= 6 && w.endsWith("our")) w = w.slice(0, -3) + "or";
  return w;
}
// The words of a typed line or of a passage, as the score compares them.
export function quoteWords(text) {
  return String(text || "").toLowerCase().replace(/[’']s\b/g, "").replace(/[’']/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
// The other spellings a typed word may have in the text (knows: knoweth; armor: armour; you: ye).
const ALSO = { you: ["ye", "thee", "thou"], your: ["thy", "thine"], has: ["hath"], says: ["saith"], say: ["saith"], does: ["doth"], do: ["doth"], spoke: ["spake"], where: ["whither"], wherever: ["whither", "whithersoever"], savior: ["saviour"] };
export function alsoSpelled(word) {
  const w = String(word).toLowerCase(), out = [...(ALSO[w] || [])];
  if (w.length >= 4 && /[^s]s$/.test(w)) { const base = w.endsWith("es") && w.length > 4 && !/(ss|sh|ch|x|z)es$/.test(w) ? w.slice(0, -1) : w.slice(0, -1); out.push(base.endsWith("e") ? base + "th" : base + "eth"); }
  if (w.length >= 5 && w.endsWith("or")) out.push(w.slice(0, -2) + "our");
  return out;
}
/** 0 to 1. typed: the words as typed (quoteWords). weights: one per word. text: the passage.
    prefixLast: the last word is still being typed, so it matches any word it begins. */
export function quoteScore(typed, weights, text, prefixLast = false) {
  const n = typed.length;
  if (!n) return 0;
  const q = typed.map(foldWord);
  const p = quoteWords(text).map(foldWord);
  if (!p.length) return 0;
  const lastRaw = prefixLast ? typed[n - 1] : null;
  const same = (i, tok) => q[i] === tok || (lastRaw !== null && i === n - 1 && tok.startsWith(lastRaw));
  let total = 0;
  for (const w of weights) total += w;
  if (!(total > 0)) return 0;
  // which typed words each word of the passage answers to
  const at = p.map((tok) => { const hits = []; for (let i = 0; i < n; i++) if (same(i, tok)) hits.push(i); return hits; });
  // 1. how many of the typed words are here at all
  const seen = new Uint8Array(n);
  for (const hits of at) for (const i of hits) seen[i] = 1;
  let cover = 0;
  for (let i = 0; i < n; i++) if (seen[i]) cover += weights[i];
  if (!cover) return 0;
  // 2. how many are here in the order typed (the heaviest common subsequence)
  let prev = new Float64Array(n + 1), cur = new Float64Array(n + 1), order = 0;
  for (let j = 0; j < p.length; j++) {
    cur[0] = 0;
    for (let i = 1; i <= n; i++) {
      let v = prev[i] > cur[i - 1] ? prev[i] : cur[i - 1];
      if (at[j].length && at[j].includes(i - 1) && prev[i - 1] + weights[i - 1] > v) v = prev[i - 1] + weights[i - 1];
      cur[i] = v;
    }
    order = cur[n];
    const t = prev; prev = cur; cur = t;
  }
  // 3. how many sit together: the best stretch of the passage about as long as the line
  const span = n + 2, inWin = new Int16Array(n);
  let near = 0, sum = 0;
  const add = (j, d) => { for (const i of at[j]) { if (d > 0) { if (inWin[i]++ === 0) sum += weights[i]; } else if (--inWin[i] === 0) sum -= weights[i]; } };
  for (let j = 0; j < p.length; j++) { add(j, 1); if (j >= span) add(j - span, -1); if (sum > near) near = sum; }
  return (0.25 * cover + 0.35 * order + 0.4 * near) / total;
}

// ---------------------------------------------------------------------------
// Natural-language queries. "what did nelson say about covenants and identity"
// becomes: speaker Nelson, terms covenant + identity (with synonyms), ranked so
// that passages matching more of the words come first.
// ---------------------------------------------------------------------------

export const QUESTION_WORDS = new Set(("what when where which who whom whose why how does do did is are was were be been being have has had " +
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

export const BOOK_WORDS = new Map([
  ["nephi", "1-nephi"], ["alma", "alma"], ["mosiah", "mosiah"], ["helaman", "helaman"], ["moroni", "moroni"], ["mormon", "mormon"], ["ether", "ether"], ["jacob", "jacob"], ["enos", "enos"],
  ["isaiah", "isaiah"], ["jeremiah", "jeremiah"], ["ezekiel", "ezekiel"], ["daniel", "daniel"], ["genesis", "genesis"], ["exodus", "exodus"], ["deuteronomy", "deuteronomy"], ["joshua", "joshua"],
  ["psalms", "psalms"], ["psalm", "psalms"], ["proverbs", "proverbs"], ["matthew", "matthew"], ["luke", "luke"], ["romans", "romans"], ["corinthians", "1-corinthians"], ["hebrews", "hebrews"],
  ["revelation", "revelation"], ["moses", "moses"], ["abraham", "abraham"], ["d&c", "sections"], ["dc", "sections"],
]);
const SCOPE_WORDS = { "general conference": "conference", "in conference": "conference", "conference talks": "conference", "conference talk": "conference", handbook: "handbook", pmg: "pmg", "preach my gospel": "pmg", "come follow me": "cfm", "topical guide": "helps", "bible dictionary": "helps", "missionary standards": "standards", "the standards": "standards", "msdjc": "standards", "joseph smith papers": "jsp", "the papers": "jsp", "jsp": "jsp" };

const PEOPLE = { benjamin: "mosiah", abinadi: "mosiah", lehi: "nephi", paul: null, jesus: null, peter: null, mormon: null, amulek: "alma", ammon: "alma", samuel: null };
// What a thumb leaves out: "whats", "dont". Spelled out before anything else reads the words.
const SHORT = { whats: "what is", wheres: "where is", whos: "who is", thats: "that is", dont: "do not", doesnt: "does not", didnt: "did not", cant: "cannot", wont: "will not", isnt: "is not", arent: "are not", wasnt: "was not", im: "i am", ive: "i have", youre: "you are", theyre: "they are" };
export function spellOut(text) {
  return String(text).replace(/\b([A-Za-z]+)[’']?([a-z]+)?\b/g, (m) => { const k = m.toLowerCase().replace(/[’']/g, ""); return Object.prototype.hasOwnProperty.call(SHORT, k) && (m.length === k.length || /[’']/.test(m)) && !/^(wont|cant)$/.test(m.toLowerCase()) ? SHORT[k] : m; });
}
const LEAD_IN = /^(?:(?:who|which prophet|which apostle) (?:said|says|wrote|taught)|where (?:does|did|do) (?:it|he|she|they|the lord|the savior|jesus|christ|[a-z]+) (?:say|teach)|where (?:is|was) it (?:written|said)|(?:where is|what is|which is|find|show me|give me) (?:the |that |a )?(?:verse|scripture|passage|quote|line)(?: that (?:says|said|reads)| which (?:says|reads)| where (?:it says|he says)| saying)|(?:what|which) (?:verse|scripture|passage) (?:says|said|reads))\s+(?:that\s+)?/;

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
  let text = spellOut(raw.trim().toLowerCase().replace(/[?.!,;]+/g, " ").replace(/’/g, "'"));
  const out = { speaker: null, scope: null, bookSlug: null, boostBook: null, yearFrom: null, yearTo: null, terms: [], phrase: null, strict: null, loose: null, quote: null };
  // "who said I will go and do", "where does it say ...": what follows is the line being looked for
  const lead = LEAD_IN.exec(text);
  if (lead && text.slice(lead[0].length).trim().split(/\s+/).length >= 2) { text = text.slice(lead[0].length).trim(); out.quote = text; }

  for (const [phrase, scope] of Object.entries(SCOPE_WORDS)) {
    if (text.includes(" " + phrase + " ") || text.startsWith(phrase + " ") || text.endsWith(" " + phrase)) { out.scope = scope; text = text.replace(phrase, " "); break; }
  }
  // a year is a filter only when the words say so ("in 1999", "since 2015"); "the 2000 young men" is a quotation
  text = text.replace(/\b(?:in|from|since|during|to|through)\s+(?:the\s+)?(19[7-9]\d|20[0-4]\d)s?\b/g, (whole, m) => { m = whole.slice(whole.search(/\d/)); const y = parseInt(m, 10); out.yearFrom = out.yearFrom ? Math.min(out.yearFrom, y) : y; out.yearTo = out.yearTo ? Math.max(out.yearTo, y) : y; if (m.endsWith("s")) out.yearTo = y + 9; return " "; });

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
  // A book of scripture is a place to look only when the words say so: "faith in alma", "from the
  // psalms", "in the book of mosiah". A name anywhere else is a word like any other ("great are the
  // words of isaiah", "waters of mormon"), except in a question about what someone taught, where it
  // leaves the words and only raises that book's passages ("what did alma teach about faith").
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== "in" && words[i] !== "from" && words[i] !== "within") continue;
    let j = i + 1;
    if (words[j] === "the") j++;
    if ((words[j] === "book" || words[j] === "books") && words[j + 1] === "of") j += 2;
    const slug = BOOK_WORDS.get(words[j]);
    if (!slug || /^\d/.test(words[j + 1] || "")) continue;
    if (words.length - (j + 1 - i) < 1) break;
    if (slug === "1-nephi" || slug === "1-corinthians") out.boostBook = words[j]; else out.bookSlug = slug;
    words = [...words.slice(0, i), ...words.slice(j + 1)];
    break;
  }
  // someone named in a question about what he taught is not a word the verse must hold
  if (asksWho) {
    const who = words.findIndex((w) => w in PEOPLE);
    if (who >= 0 && words.length > 2) {
      if (PEOPLE[words[who]] && !out.bookSlug) out.boostBook = PEOPLE[words[who]];
      words = words.filter((w, k) => k !== who && !(k === who - 1 && (w === "king" || w === "captain" || w === "prophet" || w === "apostle")));
    }
  }
  if (!out.bookSlug && !out.boostBook && asksWho) {
    const at = words.findIndex((w) => BOOK_WORDS.has(w));
    if (at >= 0 && words.length > 2) { const slug = BOOK_WORDS.get(words[at]); out.boostBook = slug === "1-nephi" || slug === "1-corinthians" ? words[at] : slug; words = words.filter((_, k) => k !== at); }
  }
  out.rest = words.join(" "); // the line itself, once any place, speaker or year named around it is taken off
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
  out.core = core.join(" ");
  if (core.length >= 2 && core.length <= 14 && core.some((w) => !QUESTION_WORDS.has(w))) out.phrase = phrase(core.join(" "));

  const groups = uniq.map(group);
  out.strict = groups.join(" AND ");
  out.loose = groups.length > 1 ? groups.join(" OR ") : null;
  return out;
}

// The longest run of the typed line's words that a passage has word for word, small words and
// all: { len, at } (at: where the run starts in the line). "that God who gave them life" and
// "that God who gave them breath" share five words running, which no weighing of single words
// shows, since the words that differ are the heavy ones.
export function sharedRun(typed, text) {
  const q = typed.map(foldWord), p = quoteWords(text).map(foldWord);
  let best = { len: 0, at: 0 };
  if (!q.length || !p.length) return best;
  let prev = new Uint16Array(p.length + 1), cur = new Uint16Array(p.length + 1);
  for (let i = 1; i <= q.length; i++) {
    for (let j = 1; j <= p.length; j++) {
      cur[j] = q[i - 1] === p[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best.len) best = { len: cur[j], at: i - cur[j] };
    }
    const t = prev; prev = cur; cur = t; cur.fill(0);
  }
  return best;
}
