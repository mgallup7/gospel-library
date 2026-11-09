// The STEP Bible's strings, read for people: the glosses and the grammar examples that come
// with the Hebrew and Greek words (original.js). Pure functions, no DOM, so node tests them.

// A Hebrew word carries its little words with it: "and", "the", "in", "to", "like" at the
// front, "my", "your", "his" at the end. STEP glosses each piece in the Hebrew order, so
// "covenant loyalty his" and "and the covenant loyalty" are one word in several forms.
const PREFIX = /^(?:and|but|or|then|so|the|in|on|at|by|to|for|from|with|like|as|according to|when|that|which|who|from the|to the|in the|on the|for the|like the|as the|with the)\s+/i;
const SUFFIX = /\s+(?:my|your|his|her|its|our|their|me|you|him|us|them|it|thee|thy|ye|of)$/i;

/** One gloss down to its stem: "according to covenant loyalty your" -> "covenant loyalty". */
export function glossStem(g) {
  let t = String(g || "").replace(/[<>[\]]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
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

/**
 * STEP's example for a grammar code, as a phrase to show. The data has several shapes:
 *   "a _woman_ giving teachings"                  (Greek: the sentence, the word underlined)
 *   giving to‚ rich _and_ poor": "and             (the sentence, then the word, quotes half kept)
 *   _of‚ from‚ by‚ in_": "_of‚ to, from‚ in_      (two lists of renderings)
 *   a (female) person (or thing)                  (parentheses that belong to the example)
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
  t = t.replace(/^"+|"+$/g, "").replace(/_([^_]*)_/g, "$1").replace(/_/g, "").replace(/\s+([,;])/g, "$1").replace(/\s+/g, " ").trim();
  return /[A-Za-z]/.test(t) ? t : "";
}
