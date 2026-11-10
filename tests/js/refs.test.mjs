// web/lib/refs.js: the scripture references in a page of notes, found so a study can link them.
import test from "node:test";
import assert from "node:assert/strict";
import { findReferences } from "../../web/lib/refs.js";

const found = (text) => findReferences(text).map((r) => [text.slice(r.start, r.end), r.label]);

test("references in running text, with the words before them left out", () => {
  assert.deepEqual(found("In Alma 32:21 we read, and see 1 Nephi 3:7 and D&C 76:22-24."), [["Alma 32:21", "Alma 32:21"], ["1 Nephi 3:7", "1 Nephi 3:7"], ["D&C 76:22-24", "D&C 76:22–24"]]);
  assert.deepEqual(found("Doctrine and Covenants 88:118; JS\u2014H 1:17; Moroni 10:4–5"), [["Doctrine and Covenants 88:118", "D&C 88:118"], ["JS\u2014H 1:17", "Joseph Smith\u2014History 1:17"], ["Moroni 10:4–5", "Moroni 10:4–5"]]);
  assert.deepEqual(found("1 Ne. 3:7, Hel. 5:12 and Rev. 21:4 (Ether 12:6)"), [["1 Ne. 3:7", "1 Nephi 3:7"], ["Hel. 5:12", "Helaman 5:12"], ["Rev. 21:4", "Revelation 21:4"], ["Ether 12:6", "Ether 12:6"]]);
});

test("not every number with a colon is a reference", () => {
  assert.deepEqual(found("At 10:30 we met. Chapter 3:2 is not one. Mark 5 is a word, and so is Job 3."), []);
  assert.deepEqual(found(""), []);
});

test("each reference carries the address the study frame hands to the app", () => {
  const [one, range] = findReferences("Alma 32:21 and Alma 32:21-27");
  assert.equal(one.href, "https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?lang=eng&id=p21#p21");
  assert.equal(range.href, "https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32.21-27?lang=eng");
  assert.equal(findReferences("Psalm 23:1")[0].href, "https://www.churchofjesuschrist.org/study/scriptures/ot/ps/23?lang=eng&id=p1#p1");
});

test("the words of an HTML page: references beside punctuation, and none made from part of another", () => {
  // studies.js hands each text node of a page here once its markup is parsed (so &amp; is already &)
  assert.deepEqual(found("(See Alma 32:21.) Then D&C 76:22-24; then \u201cMoses 1:39\u201d, and 2 Nephi 2:25!"), [["Alma 32:21", "Alma 32:21"], ["D&C 76:22-24", "D&C 76:22\u201324"], ["Moses 1:39", "Moses 1:39"], ["2 Nephi 2:25", "2 Nephi 2:25"]]);
  // a list of verses of one chapter is one link to all of them
  assert.deepEqual(found("Alma 32:21, 23-25"), [["Alma 32:21, 23-25", "Alma 32:21"]]);
  // a time, a ratio, a chapter that does not exist, a range written backwards
  assert.deepEqual(found("Meet at 7:30pm. Odds of 3:1. Jude 4:2."), []);
  assert.deepEqual(findReferences("Alma 32:27-21").map((r) => [r.verse, r.verseEnd]), [[27, null]]);
});

test("positions are exact, so the text around a link is kept as written", () => {
  const text = "Read 1 Ne. 3:7 first, then Mosiah 2:17.";
  const parts = findReferences(text);
  let rebuilt = "", last = 0;
  for (const r of parts) { rebuilt += text.slice(last, r.start) + "[" + text.slice(r.start, r.end) + "]"; last = r.end; }
  assert.equal(rebuilt + text.slice(last), "Read [1 Ne. 3:7] first, then [Mosiah 2:17].");
  assert.ok(parts.every((r) => r.href.startsWith("https://www.churchofjesuschrist.org/study/scriptures/")));
});

test("more verses after a comma, and chapters named with no verse", () => {
  const [ether] = findReferences("See Ether 12:6, 27 and then rest.");
  assert.equal(ether.href, "https://www.churchofjesuschrist.org/study/scriptures/bofm/ether/12.6,27?lang=eng");
  assert.deepEqual(found("Alma 32:21, 5 years on; Alma 32:21, 33:1"), [["Alma 32:21", "Alma 32:21"], ["Alma 32:21", "Alma 32:21"]]);
  assert.equal(findReferences("Alma 32:21, 23-25, 27")[0].href, "https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32.21,23-25,27?lang=eng");
  // a chapter alone, when the book is written out and its name is not an ordinary word
  assert.deepEqual(found("Read Alma 32, Psalm 23 and Official Declaration 2. Also 1 John 3, D&C 76 and Doctrine and Covenants 4."),
    [["Alma 32", "Alma 32"], ["Psalm 23", "Psalm 23"], ["Official Declaration 2", "Official Declaration 2"], ["1 John 3", "1 John 3"], ["D&C 76", "D&C 76"], ["Doctrine and Covenants 4", "D&C 4"]]);
  assert.equal(findReferences("Alma 32")[0].href, "https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?lang=eng");
  // not: ordinary words and names, abbreviations, a chapter that is not there, a decimal, a range, a one-chapter book
  assert.deepEqual(found("Mark 5 boxes, Job 3, John 12 years old, Hel. 5, Alma 99, Alma 3.5, Alma 32-34, Enos 3, Acts 2."), []);
  // a chapter with a verse is still the verse, once
  assert.deepEqual(found("Alma 32:21 and Alma 32"), [["Alma 32:21", "Alma 32:21"], ["Alma 32", "Alma 32"]]);
});
