// Scripture references written as plain words in a page of notes ("see Alma 32:21",
// "1 Ne. 3:7", "D&C 76:22-24", "Ether 12:6, 27"), found so a study or an answer can link them
// to the library's copy. The book names are lib/scriptures.js's (every name and abbreviation
// it parses). A chapter with a verse always counts. A chapter alone ("Alma 32", "Psalm 23",
// "Official Declaration 2", "1 John 3") counts only when the book is written out in full and
// its name is not also an ordinary word or a common given name: "Mark 5" or "Job 3" alone are
// too often not scripture at all.
// Pure: text in, positions out; studies.js and lib/markdown.js do the linking.
import { parseReference } from "./scriptures.js";

// a run of up to five words that could name a book (a number, then capitalized words, with
// "of", "and" or "the" between them), then chapter:verse, maybe -verse, and maybe more verses
// of the same chapter after commas ("12:6, 27", "32:21, 23-25")
const NAME = "((?:[1-4]\\s?)?[A-Z][\\w&'’.\\u2014\\u2013-]*(?:\\s+(?:of|and|the|[A-Z][\\w&'’.\\u2014\\u2013-]*)){0,4}?)";
const CANDIDATE = new RegExp(`(?<![\\w&])${NAME}\\s+(\\d{1,3})\\s?:\\s?(\\d{1,3})(?:\\s?[-–]\\s?(\\d{1,3}))?((?:\\s?,\\s?\\d{1,3}(?:\\s?[-–]\\s?\\d{1,3})?(?![\\d:]))*)(?![\\d:])`, "g");
// a book and a chapter with no verse; what follows must not make it a verse, a range or a decimal
const CHAPTER_ONLY = new RegExp(`(?<![\\w&])${NAME}\\s+(\\d{1,3})(?![\\d:]|\\s?[:.–-]\\s?\\d)`, "g");
// names that are too often something else when no verse follows
const AMBIGUOUS = new Set("mark job acts numbers judges ruth john james luke matthew peter jude daniel esther joel amos titus timothy jacob moses abraham kings chronicles samuel joshua jonah micah nahum ezra mormon enos omni jarom revelation".split(" "));

/** The library address a reference opens: the Church's form, which the study frame hands to the app. */
export function hrefOf(r) {
  const base = `https://www.churchofjesuschrist.org/study${r.uri}`;
  if (r.verse === null || r.verse === undefined) return `${base}?lang=eng`;
  if (r.verses && r.verses.length > 1) return `${base}.${r.verses.join(",")}?lang=eng`; // 32.21,23-25: opens at the first, with each one marked
  if (r.verseEnd && r.verseEnd !== r.verse) return `${base}.${r.verse}-${r.verseEnd}?lang=eng`;
  return `${base}?lang=eng&id=p${r.verse}#p${r.verse}`;
}

// The longest run of a candidate's words that names a book, tried with what follows it:
// "In Alma 32:21" is Alma, "1 Nephi 3:7" is 1 Nephi. Returns { name, i, r } or null.
function bookIn(words, tail, ok) {
  for (let i = 0; i < words.length; i++) {
    if (/^(of|and|the)$/.test(words[i])) continue;
    const name = words.slice(i).join(" ");
    const r = parseReference(`${name.replace(/[.,]+$/, "")} ${tail}`);
    if (r && ok(r, name)) return { name, i, r };
  }
  return null;
}

/** Every reference in a text: [{start, end, label, uri, verse, verseEnd, href}], in order. */
export function findReferences(text) {
  const out = [];
  const s = String(text || "");
  for (const m of s.matchAll(CANDIDATE)) {
    const words = m[1].split(/\s+/);
    const tail = `${m[2]}:${m[3]}${m[4] ? `-${m[4]}` : ""}`;
    const hit = bookIn(words, tail, (r) => r.verse !== null);
    if (!hit) continue;
    const { name, i, r } = hit;
    if (r.verseEnd !== null && r.verseEnd < r.verse) r.verseEnd = null;
    const start = m.index + m[0].indexOf(name, i ? words.slice(0, i).join(" ").length : 0);
    // more verses of the chapter, as long as they go on upward ("12:6, 27"; not "32:21, 5 years on")
    let end = m.index + m[0].length - (m[5] || "").length, top = r.verseEnd || r.verse;
    const verses = [r.verseEnd ? `${r.verse}-${r.verseEnd}` : String(r.verse)];
    for (const x of (m[5] || "").matchAll(/\s?,\s?(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?/g)) {
      const from = Number(x[1]), to = x[2] ? Number(x[2]) : null;
      if (from <= top || (to !== null && to <= from)) break;
      verses.push(to ? `${from}-${to}` : String(from));
      top = to || from; end += x[0].length;
    }
    const ref = { start, end, label: r.label, uri: r.uri, verse: r.verse, verseEnd: r.verseEnd, verses: verses.length > 1 ? verses : null };
    ref.href = hrefOf(ref);
    out.push(ref);
  }
  // chapters named with no verse, where nothing above already covers the words
  CHAPTER_ONLY.lastIndex = 0;
  for (let m; (m = CHAPTER_ONLY.exec(s)); ) {
    const words = m[1].split(/\s+/);
    const whole = (r, name) => {
      if (r.verse !== null || r.chapter === null) return false; // "Enos 3" is a verse of a one-chapter book; a book alone is not a chapter
      const n = name.replace(/[.,]+$/, "").toLowerCase(), book = r.label.replace(/\s+\d+$/, "").toLowerCase();
      if (n !== book && n !== r.book.name.toLowerCase() && n !== "doctrine and covenants") return false; // written out, not abbreviated
      return !AMBIGUOUS.has(n);
    };
    const hit = bookIn(words, m[2], whole);
    // no book here: look again from the next word ("Also 1 John 3" is not "Also 1")
    if (!hit) { CHAPTER_ONLY.lastIndex = m.index + Math.max(1, words[0].length); continue; }
    const start = m.index + m[0].indexOf(hit.name, hit.i ? words.slice(0, hit.i).join(" ").length : 0), end = m.index + m[0].length;
    if (out.some((o) => start < o.end && o.start < end)) continue;
    const ref = { start, end, label: hit.r.label, uri: hit.r.uri, verse: null, verseEnd: null, verses: null };
    ref.href = hrefOf(ref);
    out.push(ref);
  }
  return out.sort((a, b) => a.start - b.start);
}
