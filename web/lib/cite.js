// Short citations, the ones that fit on a button, a trail entry or a node of the deck's map.
// app.js (the trail), ask.js (citation buttons) and deck.js (the map) each name a passage or
// a document in a few characters; the pieces they share live here, so "Nelson, Apr 2024" and
// "Alma 32" come out the same way everywhere. Pure functions, no DOM.

const TITLES = /^(President|Elder|Sister|Brother|Bishop)\s+/;

/** "President Russell M. Nelson" -> "Nelson". */
export function surname(author) {
  return (author || "").replace(TITLES, "").split(" ").pop();
}

/** "April 2024 General Conference" -> "Apr 2024". */
export function conferenceShort(when) {
  return (when || "").replace(" General Conference", "").replace(/^April /, "Apr ").replace(/^October /, "Oct ");
}

/** A talk in a few words: "Nelson, Apr 2024", or whichever half is known. */
export function talkCitation(author, when) {
  return [surname(author), conferenceShort(when)].filter(Boolean).join(", ");
}

/** The chapter a citation or reference names: "Alma 32:21" -> "Alma 32"; one with no verse is itself. */
export function chapterOf(citation) {
  return String(citation ?? "").replace(/:\d.*$/, "");
}

/** A passage as Ask's citation button names it: a talk by speaker and conference, anything else by its citation. */
export function shortCitation(p) {
  if (p.collection === "general-conference") return talkCitation(p.author, p.conf || p.label);
  return p.citation || p.label;
}

/** The page a Joseph Smith Papers document is, when its title ends ", page 95". */
export function papersPageOf(title) {
  const m = /, page (\d+[a-z]?)$/i.exec(title || "");
  return m ? m[1] : null;
}

/**
 * A Joseph Smith Papers citation in the Papers' own form, the one Cite copies and Copy puts under
 * the words: “Letter to Emma Smith, 4 June 1834,” p. 56, The Joseph Smith Papers, accessed
 * November 8, 2026, https://www.josephsmithpapers.org/paper-summary/... . pages: the manuscript
 * pages, first to last (one, several, or none known); accessed: a Date.
 */
export function papersCitation({ title, pages = [], url, accessed = new Date() }) {
  const t = String(title ?? "").replace(/, page \d+[a-z]?$/i, "");
  const ps = [...new Set((pages || []).filter(Boolean))];
  const where = !ps.length ? "" : ps.length === 1 ? `p. ${ps[0]}, ` : `pp. ${ps[0]}–${ps[ps.length - 1]}, `;
  const when = accessed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return `“${t},” ${where}The Joseph Smith Papers, accessed ${when}, ${url || ""}`.trim().replace(/,$/, "");
}

/** A document as the trail names it: a chapter of scripture by its chapter, anything else by a title cut to fit. */
export function shortTitle(doc) {
  if (doc.collection === "scriptures") return doc.citation ? chapterOf(doc.citation) : doc.title;
  return doc.title.length > 28 ? doc.title.slice(0, 26).replace(/\s+\S*$/, "") + "…" : doc.title;
}
