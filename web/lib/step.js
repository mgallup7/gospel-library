// The STEP Bible's strings, read for people: the glosses and the grammar examples that come
// with the Hebrew and Greek words (original.js). Pure functions, no DOM, so node tests them.

// A Hebrew word carries its little words with it: "and", "the", "in", "to", "like" at the
// front, "my", "your", "his" at the end. STEP glosses each piece in the Hebrew order, so
// "covenant loyalty his" and "and the covenant loyalty" are one word in several forms.
// A Greek word's gloss carries its case and its article the same way ("of faith", "the
// assurance", "a sign"), and STEP leaves the sentence's punctuation on it ("faith,", "of faith?").
const PREFIX = /^(?:and|but|or|then|so|the|a|an|of|in|on|at|by|to|for|from|with|like|as|according to|when|that|which|who|from the|to the|in the|on the|for the|like the|as the|with the)\s+/i;
const SUFFIX = /\s+(?:my|your|his|her|its|our|their|me|you|him|us|them|it|thee|thy|ye|of)$/i;

/** One gloss down to its stem: "according to covenant loyalty your" -> "covenant loyalty", "of faith?" -> "faith". */
export function glossStem(g) {
  let t = String(g || "").replace(/[<>[\]{}.,;:?!¿"“”\u2014]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  for (let i = 0; i < 4; i++) {
    const next = t.replace(PREFIX, "").replace(SUFFIX, "").trim();
    if (!next || next === t) break;
    t = next;
  }
  return t;
}

/** The "Rendered:" list with each word's forms folded to their stem, counts added, commonest first. */
export function foldGlosses(list) {
  const by = new Map();
  for (const g of list || []) {
    const stem = glossStem(g.gloss);
    if (!stem) continue;
    const have = by.get(stem);
    if (have) have.n += g.n || 0; else by.set(stem, { gloss: stem, n: g.n || 0 });
  }
  return [...by.values()].sort((a, b) => b.n - a.n);
}

// The Greek lexicon (Abbott-Smith, as STEP carries it) marks its numbered senses in the
// running text: "<BR /> __1. a support <BR /> __2. substance <BR />__(a) ...". The marks are
// I. II., then 1. 2., then (a) (b) or (1) (2), then α β, in whatever order an entry nests them.
// "(with)" is a "(c)" that an abbreviation pass upstream expanded (c. is Latin cum, "with").
const MARK = /(?:<br\s*\/?>\s*)*__\s*(\((?:[a-z]{1,4}|\d+|[α-ω])\)|[IVX]+\.|\d+\.?|[α-ω]\.?)?\s*/gi;
function markKind(mark) {
  if (/^[IVX]+\.$/.test(mark)) return "roman";
  if (/^\d/.test(mark)) return "number";
  if (/^\(\d/.test(mark)) return "paren-number";
  if (/^\([a-z]/i.test(mark)) return "letter";
  return "greek";
}
/**
 * A definition as an outline: the text before the first mark, the marked senses in order,
 * each with its mark and how deep it sits, and what follows the last sense (the source's
 * initials, the synonyms). A kind of mark seen for the first time sits under the sense before
 * it; one seen before returns to its own depth. The pieces are still STEP's HTML.
 */
export function outlineOf(definition) {
  const text = String(definition ?? "");
  const items = [];
  const kinds = [];
  let lead = null, last = 0, open = null, m;
  const close = (end) => {
    const piece = text.slice(last, end);
    if (lead === null) lead = piece; else if (open) open.html += piece;
  };
  MARK.lastIndex = 0;
  while ((m = MARK.exec(text))) {
    close(m.index);
    last = MARK.lastIndex;
    if (!m[1]) continue; // a bare "__" is only a line break in the source
    const mark = /^\(with\)$/i.test(m[1]) ? "(c)" : m[1];
    const kind = markKind(mark);
    const at = kinds.indexOf(kind);
    if (at < 0) kinds.push(kind); else kinds.length = at + 1;
    open = { mark, level: kinds.length - 1, html: "" };
    items.push(open);
  }
  close(text.length);
  if (!items.length) return { lead: text, items, tail: "" };
  // what follows the last sense on a line of its own belongs to the entry, not to that sense
  let tail = "";
  const cut = /<br\s*\/?>/i.exec(open.html);
  if (cut) { tail = open.html.slice(cut.index + cut[0].length); open.html = open.html.slice(0, cut.index); }
  const trim = (h) => h.replace(/^(?:\s|<br\s*\/?>)+|(?:\s|<br\s*\/?>)+$/gi, "");
  for (const it of items) it.html = trim(it.html);
  return { lead: trim(lead || ""), items, tail: trim(tail) };
}

/**
 * STEP's example for a grammar code, as a phrase to show. The data has several shapes:
 *   "a _woman_ giving teachings"                  (Greek: the sentence, the word underlined)
 *   giving to‚ rich _and_ poor": "and             (the sentence, then the word, quotes half kept)
 *   _of‚ from‚ by‚ in_": "_of‚ to, from‚ in_      (two lists of renderings)
 *   a (female) person (or thing)                  (parentheses that belong to the example; not the sex)
 *   ( )                                           (no English word at all)
 *   Example: he/it did or does rise
 * The low comma (U+201A) STEP uses inside lists is an ordinary comma here.
 */
export function exampleOf(ex) {
  let t = String(ex ?? "").replace(/\u201a/g, ",").replace(/\s+/g, " ").trim();
  t = t.replace(/^(?:example|e\.g\.)\s*:?\s*/i, "");
  // the sentence and the word it illustrates: keep the sentence, the part before `": "`
  const pair = /^"?(.*?)"\s*:\s*"(.*?)"?$/.exec(t);
  if (pair) t = pair[1];
  // STEP writes a form's gender into its example as a sex: "a (female) person (or thing)",
  // "you (a male) did rise", "a rising female". The gender is the word's, not the thing's
  // (grammarMeaning says it), so the example goes without it.
  t = t.replace(/\((?:an? )?(?:fe)?males?\)\s*/gi, "").replace(/\((?:fe)?male /gi, "(")
    .replace(/\ban? (?:fe)?male\b/gi, "one").replace(/\b(?:fe)?males\b/gi, "ones").replace(/\b(?:fe)?male\b/gi, "one");
  t = t.replace(/^"+|"+$/g, "").replace(/_([^_]*)_/g, "$1").replace(/_/g, "").replace(/\s+([,;])/g, "$1").replace(/\s+/g, " ").trim();
  return /[A-Za-z]/.test(t) ? t : "";
}

// STEP's plain-English meaning for a grammar code speaks of the thing where it means the word:
// a feminine noun is "a female PERSON OR THING", a masculine verb is done "by a male person
// or thing". Faith and a city are not female; the word for them is feminine. The meaning is
// kept, the sex taken out of it, and the gender said once at the end as grammar.
const GENDER = { male: "masculine", female: "feminine", neuter: "neuter", "male or female": "masculine or feminine" };
export function grammarMeaning(meaning) {
  let t = String(meaning ?? "").replace(/‚/g, ",").replace(/\s+/g, " ").trim();
  const seen = [];
  // "a female PERSON", "male PEOPLE", "a male a person" (STEP's slip), "a male individual"
  t = t.replace(/\b(an? )?(male or female|male|female|neuter) (?:an? )?(?=(\w))/gi, (m, article, gender, next) => {
    const g = GENDER[gender.toLowerCase()];
    if (!seen.includes(g)) seen.push(g);
    return article ? (/[aeiou]/i.test(next) ? "an " : "a ") : "";
  });
  return seen.length ? `${t} (${seen.join(" and ")} in grammar)` : t;
}
