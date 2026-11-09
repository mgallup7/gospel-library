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
