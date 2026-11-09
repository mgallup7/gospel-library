// web/lib/cite.js: the short citations of the trail (app.js), Ask's citation buttons (ask.js)
// and the deck's map (deck.js). The expected values are what each caller's own copy returned
// before the three were brought together here.
import test from "node:test";
import assert from "node:assert/strict";
import { surname, conferenceShort, talkCitation, chapterOf, shortCitation, shortTitle, papersPageOf, papersCitation } from "../../web/lib/cite.js";

test("surname drops the title and keeps the last name", () => {
  assert.equal(surname("President Russell M. Nelson"), "Nelson");
  assert.equal(surname("Bishop Gérald Caussé"), "Caussé");
  assert.equal(surname("Brother Bradley R. Wilcox"), "Wilcox");
  assert.equal(surname(""), "");
  assert.equal(surname(null), "");
});

test("conferenceShort shortens the month and drops the words", () => {
  assert.equal(conferenceShort("April 2024 General Conference"), "Apr 2024");
  assert.equal(conferenceShort("October 2023 General Conference"), "Oct 2023");
  assert.equal(conferenceShort("Preach My Gospel"), "Preach My Gospel");
  assert.equal(conferenceShort(undefined), "");
});

test("talkCitation joins whichever halves are known", () => {
  assert.equal(talkCitation("Elder Jeffrey R. Holland", "October 2023 General Conference"), "Holland, Oct 2023");
  assert.equal(talkCitation("Sister Camille N. Johnson", ""), "Johnson");
  assert.equal(talkCitation("", "Preach My Gospel"), "Preach My Gospel");
  assert.equal(talkCitation(undefined, undefined), "");
});

test("chapterOf drops the verse and anything after it", () => {
  assert.equal(chapterOf("Alma 32:21"), "Alma 32");
  assert.equal(chapterOf("Psalm 23:1–6"), "Psalm 23");
  assert.equal(chapterOf("D&C 76"), "D&C 76");
  assert.equal(chapterOf(""), "");
  assert.equal(chapterOf(null), "");
});

test("shortCitation (Ask's buttons): a talk by speaker and conference", () => {
  assert.equal(shortCitation({ collection: "general-conference", author: "President Dallin H. Oaks", conf: "April 2024 General Conference", label: "x" }), "Oaks, Apr 2024");
  assert.equal(shortCitation({ collection: "general-conference", author: "Brother Bradley R. Wilcox", label: "October 2021 General Conference" }), "Wilcox, Oct 2021");
  assert.equal(shortCitation({ collection: "general-conference", author: "", label: "" }), "");
});

test("shortCitation (Ask's buttons): anything else by citation, then label", () => {
  assert.equal(shortCitation({ collection: "scriptures", citation: "Moroni 10:4", label: "Moroni 10" }), "Moroni 10:4");
  assert.equal(shortCitation({ collection: "manuals", citation: null, label: "Gospel Principles, Chapter 3" }), "Gospel Principles, Chapter 3");
  assert.equal(shortCitation({ collection: "jsp", citation: "", label: "Revelation, July 1828" }), "Revelation, July 1828");
});

test("shortTitle (the trail): scripture by its chapter", () => {
  assert.equal(shortTitle({ collection: "scriptures", citation: "Alma 32:21", title: "Alma 32" }), "Alma 32");
  assert.equal(shortTitle({ collection: "scriptures", citation: "D&C 76", title: "Doctrine and Covenants 76" }), "D&C 76");
  assert.equal(shortTitle({ collection: "scriptures", citation: null, title: "Title Page" }), "Title Page");
  assert.equal(shortTitle({ collection: "scriptures", citation: "Psalm 23:1–6", title: "Psalms 23" }), "Psalm 23");
});

test("shortTitle (the trail): a long title cut at a word, with an ellipsis", () => {
  assert.equal(shortTitle({ collection: "general-conference", title: "The Power of Godliness" }), "The Power of Godliness");
  assert.equal(shortTitle({ collection: "general-conference", title: "Our Relationship with God and the Plan of Salvation" }), "Our Relationship with God…");
  assert.equal(shortTitle({ collection: "manuals", title: "Lesson 12: The Atonement of Jesus Christ" }), "Lesson 12: The Atonement…");
  assert.equal(shortTitle({ collection: "manuals", title: "Exactly twenty-eight chars!" }), "Exactly twenty-eight chars!");
  assert.equal(shortTitle({ collection: "manuals", title: "Supercalifragilisticexpialidocious words" }), "Supercalifragilisticexpial…");
});

test("the deck's map: a talk card keeps the speaker in citation and the conference in label", () => {
  // deck.js shortCitation is talkCitation(it.citation, it.label) for anything but a verse
  assert.equal(talkCitation("President Russell M. Nelson", "April 2024 General Conference"), "Nelson, Apr 2024");
  assert.equal(talkCitation("Bishop Gérald Caussé", "October 2019 General Conference"), "Caussé, Oct 2019");
});

// The Joseph Smith Papers: the form Cite copies and Copy puts under the words (app.js citePapers, copyText)
test("papersPageOf reads the page a Papers document is", () => {
  assert.equal(papersPageOf("Journal, December 1841–December 1842, page 95"), "95");
  assert.equal(papersPageOf("Revelation Book 1, page 12a"), "12a");
  assert.equal(papersPageOf("Letter to Emma Smith, 4 June 1834"), null);
  assert.equal(papersPageOf(undefined), null);
});

test("papersCitation: the paper's title, the pages, the Papers, the day, the address", () => {
  const accessed = new Date(2026, 10, 8);
  const url = "https://www.josephsmithpapers.org/paper-summary/letter-to-emma-smith-4-june-1834";
  assert.equal(papersCitation({ title: "Letter to Emma Smith, 4 June 1834", pages: ["56"], url, accessed }),
    `“Letter to Emma Smith, 4 June 1834,” p. 56, The Joseph Smith Papers, accessed November 8, 2026, ${url}`);
  assert.equal(papersCitation({ title: "Letter to Emma Smith, 4 June 1834", pages: ["56", "56", "57"], url, accessed }),
    `“Letter to Emma Smith, 4 June 1834,” pp. 56–57, The Joseph Smith Papers, accessed November 8, 2026, ${url}`);
  assert.equal(papersCitation({ title: "Journal, December 1841–December 1842, page 95", pages: ["95"], url: "https://www.josephsmithpapers.org/paper-summary/journal-december-1841-december-1842/26", accessed }),
    "“Journal, December 1841–December 1842,” p. 95, The Joseph Smith Papers, accessed November 8, 2026, https://www.josephsmithpapers.org/paper-summary/journal-december-1841-december-1842/26");
  // no page known: none named, and never the shelf ("Joseph Smith Papers: Journals, ...")
  assert.equal(papersCitation({ title: "Journal, December 1841–December 1842", pages: [null], url: "u", accessed }), "“Journal, December 1841–December 1842,” The Joseph Smith Papers, accessed November 8, 2026, u");
});
