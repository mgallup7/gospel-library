// Text cut to fit a slide. A slide holds about MAX_CHARS of scripture comfortably; longer
// passages are split at verse or sentence boundaries, and the label says "1 of 2". Used by the
// deck (its board, its presenter and the PowerPoint file); pure, so the stage can use it too.
import { chapterOf } from "./cite.js";

export const MAX_CHARS = 430;

/** A passage ({verses: [{n, text}]} or {text}) as the pieces its slides show, each with its label. */
export function chunksOf(it, max = MAX_CHARS) {
  const out = [];
  if (it.verses && it.verses.length) {
    let cur = [], len = 0;
    for (const v of it.verses) {
      if (cur.length && len + v.text.length > max) { out.push({ verses: cur }); cur = []; len = 0; }
      if (v.text.length > max * 1.4) {
        // one very long verse: split its sentences, keep the number on the first piece
        const parts = sentences(v.text, max);
        if (cur.length) { out.push({ verses: cur }); cur = []; len = 0; }
        parts.forEach((p, i) => out.push({ verses: [{ n: i === 0 ? v.n : null, text: p }] }));
        continue;
      }
      cur.push(v); len += v.text.length;
    }
    if (cur.length) out.push({ verses: cur });
  } else {
    for (const p of sentences(it.text, max)) out.push({ text: p });
  }
  out.forEach((c, i) => {
    let label = (it.kind === "verse" || !it.label) ? (it.citation || "") : it.label;
    if (c.verses && it.verses && out.length > 1) {
      const ns = c.verses.map((v) => v.n).filter((n) => n !== null);
      if (ns.length) label = `${chapterOf(label)}:${ns[0]}${ns.length > 1 ? "–" + ns[ns.length - 1] : ""}`;
    }
    c.label = out.length > 1 ? `${label} (${i + 1} of ${out.length})` : label;
  });
  return out;
}

/** Text in pieces of at most max characters, broken at sentences, then commas. */
export function sentences(text, max) {
  const paras = text.split(/\n\n+/);
  const pieces = [];
  for (const para of paras) {
    const sents = para.match(/[^.!?;:]+[.!?;:]+["’”)]?\s*|[^.!?;:]+$/g) || [para];
    let cur = "";
    for (const s of sents) {
      if (cur && (cur + s).length > max) { pieces.push(cur.trim()); cur = ""; }
      if (s.length > max) {
        // a run-on sentence: split on commas, then hard-wrap as a last resort
        for (const bit of s.split(/(?<=,)\s+/)) {
          if (cur && (cur + bit).length > max) { pieces.push(cur.trim()); cur = ""; }
          cur += bit + " ";
        }
        continue;
      }
      cur += s;
    }
    if (cur.trim()) pieces.push(cur.trim());
  }
  return pieces.length ? pieces : [text];
}

/** The point size a passage of this many characters starts at on a slide (the fitting may go smaller). */
export function fontSize(len) {
  if (len <= 90) return 40;
  if (len <= 170) return 36;
  if (len <= 260) return 32;
  if (len <= 350) return 28;
  return 26;
}
