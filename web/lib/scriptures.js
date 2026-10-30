// Scripture structure, citations and reference parsing (mirror of gospel_library/scriptures.py).
import DATA from "./scriptures-data.js";

export const books = DATA.books;
const bySlug = new Map(books.map((b) => [b.slug, b]));
const aliases = DATA.aliases;

export function book(slug) {
  return bySlug.get(slug) || null;
}

export function shortName(b) {
  if (b.slug === "sections") return "D&C";
  if (b.slug === "official-declarations") return "Official Declaration";
  return b.name;
}

export function citation(b, chapter, verse, verseEnd) {
  let name = shortName(b);
  if (chapter === null || chapter === undefined) return name;
  if (b.slug === "psalms") name = "Psalm";
  let out = `${name} ${chapter}`;
  if (verse !== null && verse !== undefined) {
    out += `:${verse}`;
    if (verseEnd !== null && verseEnd !== undefined && verseEnd !== verse) out += `–${verseEnd}`;
  }
  return out;
}

export function bookForUri(uri) {
  uri = uri.split("?")[0];
  for (const b of books) {
    if (uri === b.uri) return { book: b, chapter: null };
    if (uri.startsWith(b.uri + "/")) {
      const rest = uri.slice(b.uri.length + 1);
      if (rest.includes("/")) return null;
      return { book: b, chapter: rest };
    }
  }
  return null;
}

function norm(text) {
  text = text.toLowerCase().replace(/—|–/g, "-").replace(/’/g, "'");
  text = text.replace(/&/g, " & ");
  text = text.replace(/[.\s_]+/g, " ").trim();
  text = text.replace(/\s*-\s*/g, "-");
  text = text.replace(/\s*&\s*/g, "&");
  text = text.replace(/-/g, " ");
  text = text.replace(/^(first|1st|i)\s/, "1 ");
  text = text.replace(/^(second|2nd|ii)\s/, "2 ");
  text = text.replace(/^(third|3rd|iii)\s/, "3 ");
  text = text.replace(/^(fourth|4th|iv)\s/, "4 ");
  text = text.replace(/^([1-4])([a-z])/, "$1 $2");
  return text.trim();
}

const REF = /^\s*((?:[1-4]|i{1,3}|iv|first|second|third|fourth)?\s*[a-z][a-z&.\-—'’ ]*?)[\s.,]*(\d{1,3})(?:\s*[:.\s]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?)?\s*$/i;
const BOOK_ONLY = /^\s*((?:[1-4]|first|second|third|fourth)?\s*[a-z][a-z&.\-—'’ ]*?)\s*$/i;

/** Returns {book, chapter, verse, verseEnd, uri, pid, label} or null. */
export function parseReference(query) {
  const q = (query || "").trim();
  if (!q || q.length > 60) return null;
  let m = REF.exec(q);
  if (m) {
    const slug = aliases[norm(m[1])];
    if (!slug) return null;
    const b = bySlug.get(slug);
    let chapter = parseInt(m[2], 10);
    let verse = m[3] ? parseInt(m[3], 10) : null;
    let verseEnd = m[4] ? parseInt(m[4], 10) : null;
    if (b.chapters.length === 1 && chapter !== 1 && verse === null) {
      return make(b, b.chapters[0], chapter, null); // "Enos 3" means Enos 1:3
    }
    if (b.chapters.length && !b.chapters.map(String).includes(String(chapter))) return null;
    return make(b, chapter, verse, verseEnd);
  }
  m = BOOK_ONLY.exec(q);
  if (m) {
    const key = norm(m[1]);
    const slug = aliases[key];
    if (slug && key.length >= 3) return make(bySlug.get(slug), null, null, null);
  }
  return null;
}

function make(b, chapter, verse, verseEnd) {
  const ch = chapter === null ? (b.chapters.length ? b.chapters[0] : null) : chapter;
  return {
    book: b, chapter, verse, verseEnd,
    uri: ch === null ? b.uri : `${b.uri}/${ch}`,
    pid: verse !== null ? `p${verse}` : null,
    label: citation(b, ch, verse, verseEnd),
  };
}
