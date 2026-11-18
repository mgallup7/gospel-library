// web/lib/query.js: how a typed search is read, and how a passage is scored against a typed line.
import test from "node:test";
import assert from "node:assert/strict";
import { naturalQuery, isNatural, quoteWords, quoteScore, foldWord, alsoSpelled, spellOut, TINY } from "../../web/lib/query.js";

test("a name in a remembered line is a word, not a place to look", () => {
  for (const q of ["great are the words of isaiah", "words of mormon", "moses lifted up the serpent", "the spirit of revelation", "alma and amulek"]) {
    const n = naturalQuery(q);
    assert.equal(n.bookSlug, null, q);
    assert.equal(n.boostBook, null, q);
  }
  assert.ok(naturalQuery("great are the words of isaiah").terms.includes("isaiah"));
  assert.ok(naturalQuery("moses lifted up the serpent").terms.includes("moses"));
});

test("a book is a place only when the words say so", () => {
  assert.equal(naturalQuery("faith in alma").bookSlug, "alma");
  assert.equal(naturalQuery("charity from the book of moroni").bookSlug, "moroni");
  const n = naturalQuery("what did alma teach about faith");
  assert.equal(n.bookSlug, null);
  assert.equal(n.boostBook, "alma");
  assert.deepEqual(n.terms, ["faith"]);
});

test("a year and a shelf need their cue", () => {
  const n = naturalQuery("the 2000 young men");
  assert.equal(n.yearFrom, null);
  assert.equal(naturalQuery("what was said in 2018 about covenants").yearFrom, 2018);
  assert.equal(naturalQuery("what verse talks about charity").scope, null);
  assert.equal(naturalQuery("what was taught in general conference about charity").scope, "conference");
});

test("the question around a remembered line is taken off", () => {
  assert.equal(naturalQuery("who said I will go and do").quote, "i will go and do");
  assert.equal(naturalQuery("where does it say men are that they might have joy").quote, "men are that they might have joy");
  assert.equal(naturalQuery("what did alma teach about faith").quote, null);
});

test("someone named in a question is not a word the verse must hold", () => {
  const n = naturalQuery("what did king benjamin say about service");
  assert.deepEqual(n.terms, ["service"]);
  assert.equal(n.boostBook, "mosiah");
});

test("what a thumb leaves out is spelled out", () => {
  assert.equal(spellOut("whats the verse"), "what is the verse");
  assert.equal(spellOut("dont you know"), "do not you know");
  assert.equal(spellOut("I wont go"), "I wont go");
  assert.ok(isNatural("whats the verse about faith"));
});

test("King James and modern forms fold to one word", () => {
  for (const [a, b] of [["knoweth", "knows"], ["seeth", "sees"], ["giveth", "gives"], ["hath", "has"], ["saith", "says"], ["ye", "you"], ["thy", "your"], ["armour", "armor"], ["words", "word"]]) assert.equal(foldWord(a), foldWord(b), `${a} / ${b}`);
  assert.notEqual(foldWord("rest"), foldWord("r"));
  assert.deepEqual(alsoSpelled("knows"), ["knoweth"]);
  assert.deepEqual(alsoSpelled("sees"), ["seeth"]);
});

test("a passage is scored by how much it looks like the line typed", () => {
  const typed = quoteWords("great are the words of isaiah");
  const w = typed.map((x) => (TINY.has(x) ? 0.15 : 1));
  const verse = "And now, behold, I say unto you, that ye ought to search these things. Yea, a commandment I give unto you that ye search these things diligently; for great are the words of Isaiah.";
  const scattered = "Isaiah was a prophet in the days of the kings of Judah, and many years afterward the people were taught that the works of the Lord are great, in words that they could understand.";
  const none = "And it came to pass that he departed into the wilderness.";
  assert.equal(quoteScore(typed, w, verse), 1);
  assert.ok(quoteScore(typed, w, scattered) < 0.75);
  assert.ok(quoteScore(typed, w, none) < 0.1);
  // one word wrong still scores as a near quotation
  const near = quoteWords("men are so they might have joy");
  assert.ok(quoteScore(near, near.map((x) => (TINY.has(x) ? 0.15 : 1)), "Adam fell that men might be; and men are, that they might have joy.") >= 0.8);
  // modern wording against the King James text
  const modern = quoteWords("the lord sees not as man sees");
  assert.ok(quoteScore(modern, modern.map((x) => (TINY.has(x) ? 0.15 : 1)), "for the Lord seeth not as man seeth; for man looketh on the outward appearance") >= 0.95);
  // a word still being typed matches the word it begins
  const half = quoteWords("search these thi");
  assert.ok(quoteScore(half, [1, 1, 1], "that ye search these things diligently", true) > quoteScore(half, [1, 1, 1], "that ye search these things diligently", false));
});
