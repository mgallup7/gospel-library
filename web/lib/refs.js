// Scripture references written as plain words in a page of notes ("see Alma 32:21",
// "1 Ne. 3:7", "D&C 76:22-24"), found so a study can link them to the library's copy.
// The book names are lib/scriptures.js's (every name and abbreviation it parses). Only a
// chapter with a verse counts: "Mark 5" or "Job 3" alone are too often ordinary words.
// Pure: text in, positions out; studies.js does the linking.
import { parseReference } from "./scriptures.js";

// a run of up to five words that could name a book (a number, then capitalized words, with
// "of", "and" or "the" between them), then chapter:verse and maybe -verse
const CANDIDATE = /(?<![\w&])((?:[1-4]\s?)?[A-Z][\w&'’.—–-]*(?:\s+(?:of|and|the|[A-Z][\w&'’.—–-]*)){0,4}?)\s+(\d{1,3})\s?:\s?(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?(?![\d:])/g;

/** The library address a reference opens: the Church's form, which the study frame hands to the app. */
export function hrefOf(r) {
  const base = `https://www.churchofjesuschrist.org/study${r.uri}`;
  if (r.verseEnd && r.verseEnd !== r.verse) return `${base}.${r.verse}-${r.verseEnd}?lang=eng`;
  return `${base}?lang=eng&id=p${r.verse}#p${r.verse}`;
}

/** Every reference in a text: [{start, end, label, uri, verse, verseEnd, href}], in order. */
export function findReferences(text) {
  const out = [];
  const s = String(text || "");
  for (const m of s.matchAll(CANDIDATE)) {
    const words = m[1].split(/\s+/);
    const tail = `${m[2]}:${m[3]}${m[4] ? `-${m[4]}` : ""}`;
    // the longest run of words that is a book: "In Alma 32:21" is Alma, "1 Nephi 3:7" is 1 Nephi
    for (let i = 0; i < words.length; i++) {
      if (/^(of|and|the)$/.test(words[i])) continue;
      const name = words.slice(i).join(" ");
      const r = parseReference(`${name.replace(/[.,]+$/, "")} ${tail}`);
      if (!r || r.verse === null) continue;
      if (r.verseEnd !== null && r.verseEnd < r.verse) r.verseEnd = null;
      const start = m.index + m[0].indexOf(name, i ? words.slice(0, i).join(" ").length : 0);
      out.push({ start, end: m.index + m[0].length, label: r.label, uri: r.uri, verse: r.verse, verseEnd: r.verseEnd, href: hrefOf(r) });
      break;
    }
  }
  return out;
}
