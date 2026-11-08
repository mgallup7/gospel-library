// web/lib/chunk.js: passages cut to fit a slide. The expected pieces and labels are what
// deck.js's own chunksOf, sentences and fontSize returned before they moved here.
import test from "node:test";
import assert from "node:assert/strict";
import { chunksOf, sentences, fontSize, MAX_CHARS } from "../../web/lib/chunk.js";

const S = "Behold, I say unto you, that faith is a thing hoped for.";
const long = Array(12).fill(S).join(" ");
const three = Array(3).fill(S).join(" ");
const verse = (n) => ({ n, text: Array(10).fill(`Verse ${n} text`).join(" ") });
const six = [1, 2, 3, 4, 5, 6].map(verse);

test("a slide holds 430 characters", () => assert.equal(MAX_CHARS, 430));

test("sentences: short text is one piece", () => {
  assert.deepEqual(sentences("One. Two! Three?", 430), ["One. Two! Three?"]);
  assert.deepEqual(sentences("", 100), [""]);
});

test("sentences: long text breaks between sentences", () => {
  assert.deepEqual(sentences(long, 200), [three, three, three, three]);
});

test("sentences: paragraphs, semicolons and colons all end a piece when they must", () => {
  assert.deepEqual(sentences("First para here.\n\nSecond para; with a clause: and more.", 20), ["First para here.", "Second para;", "with a clause:", "and more."]);
  assert.deepEqual(sentences("He said, “Come.” Then he left. And so on", 15), ["He said,", "“Come.”", "Then he left.", "And so on"]);
});

test("sentences: a run-on sentence breaks at commas", () => {
  const commas = Array.from({ length: 60 }, (_, i) => `word${i} more words`).join(", ") + ".";
  const got = sentences(commas, 120);
  assert.equal(got.length, 10);
  assert.equal(got[0], "word0 more words, word1 more words, word2 more words, word3 more words, word4 more words, word5 more words,");
  assert.equal(got[9], "word54 more words, word55 more words, word56 more words, word57 more words, word58 more words, word59 more words.");
});

test("chunksOf: prose in pieces, labelled 1 of n", () => {
  const got = chunksOf({ kind: "para", text: long, citation: "Elder X", label: "Oct 2020" }, 300);
  assert.deepEqual(got.map((c) => c.label), ["Oct 2020 (1 of 3)", "Oct 2020 (2 of 3)", "Oct 2020 (3 of 3)"]);
  assert.equal(got[2].text, `${S} ${S}`);
});

test("chunksOf: prose that fits keeps its citation when it has no label", () => {
  assert.deepEqual(chunksOf({ kind: "para", text: "Short.", citation: "Elder X", label: "" }), [{ text: "Short.", label: "Elder X" }]);
});

test("chunksOf: verses grouped, each slide labelled with its own verses", () => {
  const got = chunksOf({ kind: "verse", verses: six, citation: "Alma 32:1–6" }, 300);
  assert.deepEqual(got.map((c) => c.label), ["Alma 32:1–2 (1 of 3)", "Alma 32:3–4 (2 of 3)", "Alma 32:5–6 (3 of 3)"]);
  assert.deepEqual(got[1].verses.map((v) => v.n), [3, 4]);
});

test("chunksOf: verses that fit stay on one slide under the passage's citation", () => {
  assert.deepEqual(chunksOf({ kind: "verse", verses: six.slice(0, 2), citation: "Alma 32:1–2" }), [{ verses: six.slice(0, 2), label: "Alma 32:1–2" }]);
});

test("chunksOf: one very long verse splits, the number on its first piece only", () => {
  const got = chunksOf({ kind: "verse", verses: [{ n: 1, text: "a" }, { n: 2, text: long }], citation: "Moro 7:1–2" }, 200);
  assert.deepEqual(got.map((c) => c.label), ["Moro 7:1 (1 of 5)", "Moro 7:2 (2 of 5)", "Moro 7:1–2 (3 of 5)", "Moro 7:1–2 (4 of 5)", "Moro 7:1–2 (5 of 5)"]);
  assert.deepEqual(got.map((c) => c.verses[0].n), [1, 2, null, null, null]);
  assert.equal(got[1].verses[0].text, three);
});

test("chunksOf: a paragraph with verses and a label of its own builds on the label", () => {
  const got = chunksOf({ kind: "para", verses: six, citation: "Alma 32", label: "Chapter heading" }, 300);
  assert.deepEqual(got.map((c) => c.label), ["Chapter heading:1–2 (1 of 3)", "Chapter heading:3–4 (2 of 3)", "Chapter heading:5–6 (3 of 3)"]);
});

test("fontSize steps down with length", () => {
  assert.deepEqual([0, 90, 91, 170, 171, 260, 261, 350, 351, 2000].map(fontSize), [40, 40, 36, 36, 32, 32, 28, 28, 26, 26]);
});
