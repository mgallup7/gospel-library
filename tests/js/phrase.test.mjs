// web/lib/phrase.js, the arithmetic half: a paragraph's words, the words a run of characters
// touches, where a kept phrase is now, and which phrase has the words two of them share. The
// half that reads and marks the page is driven in a real browser (browser/marks.spec.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { wordSpans, wordsIn, phraseText, locate, paint } from "../../web/lib/phrase.js";

const T = "And now as I said concerning faith, faith is not to have a perfect knowledge of things;";
const S = wordSpans(T);

test("words are what whitespace divides, punctuation and all", () => {
  assert.equal(S.length, 17);
  assert.equal(T.slice(S[6].s, S[6].e), "faith,");
  assert.deepEqual(wordSpans("  two\n words here "), [{ s: 2, e: 5 }, { s: 7, e: 12 }, { s: 13, e: 17 }], "a line break and a no-break space divide words too");
  assert.equal(wordSpans("").length, 0);
  assert.equal(wordSpans(null).length, 0);
});

test("a run of characters gives the words it touches, a word caught in part counting whole", () => {
  assert.deepEqual(wordsIn(S, 0, 3), { start: 0, end: 0 });
  assert.deepEqual(wordsIn(S, 1, 2), { start: 0, end: 0 }, "inside one word");
  assert.deepEqual(wordsIn(S, S[5].s + 2, S[7].s + 1), { start: 5, end: 7 });
  assert.deepEqual(wordsIn(S, S[5].e, S[6].s), null, "only the space between two words");
  assert.deepEqual(wordsIn(S, S[5].e, S[6].s + 1), { start: 6, end: 6 }, "the space and one letter");
  assert.equal(phraseText(T, S, 5, 7), "concerning faith, faith");
});

test("a kept phrase is found where its words are", () => {
  const rec = { start: 5, end: 7, text: "concerning faith, faith" };
  assert.deepEqual(locate(T, S, rec), { start: 5, end: 7 });
  // the verse gained two words before it: the phrase is found where its words went
  const T2 = "Yea, verily, " + T;
  assert.deepEqual(locate(T2, wordSpans(T2), rec), { start: 7, end: 9 });
  // of two places the same words stand, the nearer to where it was
  const T3 = "a perfect knowledge and then a perfect knowledge again";
  assert.deepEqual(locate(T3, wordSpans(T3), { start: 5, end: 7, text: "a perfect knowledge" }), { start: 5, end: 7 });
  assert.deepEqual(locate(T3, wordSpans(T3), { start: 4, end: 6, text: "a perfect knowledge" }), { start: 5, end: 7 });
  assert.deepEqual(locate(T3, wordSpans(T3), { start: 1, end: 3, text: "a perfect knowledge" }), { start: 0, end: 2 });
  // its words are gone: nowhere, so nothing is drawn on the wrong words
  assert.equal(locate("Another verse altogether, with other words in it", wordSpans("Another verse altogether, with other words in it"), rec), null);
  assert.equal(locate("short", wordSpans("short"), rec), null);
  // a record with no words kept is trusted while its indexes fit
  assert.deepEqual(locate(T, S, { start: 1, end: 2, text: "" }), { start: 1, end: 2 });
  assert.equal(locate(T, S, { start: 1, end: 40, text: "" }), null);
});

test("where phrases overlap the later one has the shared words", () => {
  const a = { id: "a", start: 2, end: 6, color: "y", updated: 10 };
  const b = { id: "b", start: 5, end: 8, color: "g", updated: 20 };
  assert.deepEqual(paint([a, b]), [{ id: "a", start: 2, end: 4, color: "y" }, { id: "b", start: 5, end: 8, color: "g" }]);
  assert.deepEqual(paint([b, a]), paint([a, b]), "whatever order they are handed in");
  // the older one changed since: now it has them
  assert.deepEqual(paint([{ ...a, updated: 30 }, b]), [{ id: "a", start: 2, end: 6, color: "y" }, { id: "b", start: 7, end: 8, color: "g" }]);
  // a later phrase in the middle of an older one leaves it in two runs
  assert.deepEqual(paint([{ id: "a", start: 0, end: 9, color: "y", updated: 1 }, { id: "c", start: 3, end: 4, color: "p", updated: 2 }]),
    [{ id: "a", start: 0, end: 2, color: "y" }, { id: "c", start: 3, end: 4, color: "p" }, { id: "a", start: 5, end: 9, color: "y" }]);
  // two that touch but do not overlap stay two
  assert.deepEqual(paint([{ id: "a", start: 0, end: 1, color: "y", updated: 1 }, { id: "b", start: 2, end: 3, color: "y", updated: 2 }]).length, 2);
  assert.deepEqual(paint([]), []);
});
