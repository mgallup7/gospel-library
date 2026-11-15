// Words inside a verse or paragraph, for highlights laid on a phrase rather than the whole.
//
// A phrase is kept as two word indexes (first and last, counted from 0) in the paragraph's
// own text: its words split on whitespace, with the verse number, the footnote letters and
// the app's own controls left out, so the count is the same however the page is decorated.
// The first half here is arithmetic (node-tested); the second half reads and marks the page
// with the oldest, plainest DOM calls there are (childNodes, splitText, comparePoint,
// normalize), because it has to behave on an iPad's Safari that nobody can test from here.

// what in a paragraph is not its text
export const SKIP = "sup.marker, .verse-number, .page-break, .note-mark";

// where each word of a text starts and ends: [{ s, e }], e past the last character
export function wordSpans(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(String(text || "")))) out.push({ s: m.index, e: m.index + m[0].length });
  return out;
}

// the words a run of characters [a, b) touches: { start, end } word indexes, or null for none.
// A word caught in part counts whole, since a finger rarely lands on a letter's edge.
export function wordsIn(spans, a, b) {
  let start = -1, end = -1;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].s < b && spans[i].e > a) { if (start < 0) start = i; end = i; }
  }
  return start < 0 ? null : { start, end };
}

// the words of a phrase, as kept with its record (cut like the record's text is)
export function phraseText(text, spans, start, end) {
  if (!spans[start] || !spans[end]) return "";
  return String(text).slice(spans[start].s, spans[end].e).replace(/\s+/g, " ").slice(0, 400);
}

// Where a kept phrase is in the paragraph as it reads now. Its indexes, when the words there
// are still its words; else the nearest place the same words stand (an edition changed the
// verse before it); else nowhere, and it is not drawn rather than drawn on the wrong words.
export function locate(text, spans, rec) {
  const n = rec.end - rec.start + 1;
  const want = String(rec.text || "");
  if (!want) return rec.end < spans.length ? { start: rec.start, end: rec.end } : null;
  if (rec.end < spans.length && phraseText(text, spans, rec.start, rec.end) === want) return { start: rec.start, end: rec.end };
  let best = null;
  for (let i = 0; i + n <= spans.length; i++) {
    if (phraseText(text, spans, i, i + n - 1) !== want) continue;
    if (!best || Math.abs(i - rec.start) < Math.abs(best.start - rec.start)) best = { start: i, end: i + n - 1 };
  }
  return best;
}

// Several phrases on one paragraph, as runs to draw: where two overlap, the one changed later
// has the words they share. Each phrase is { id, start, end, color, updated }; the runs come
// back in reading order as { id, start, end, color }.
export function paint(phrases) {
  const owner = [];
  const byAge = [...phrases].sort((a, b) => (a.updated || 0) - (b.updated || 0) || (a.id < b.id ? -1 : 1));
  for (const p of byAge) for (let i = p.start; i <= p.end; i++) owner[i] = p;
  const runs = [];
  let run = null;
  for (let i = 0; i < owner.length; i++) {
    const p = owner[i];
    if (!p) { run = null; continue; }
    if (run && run.id === p.id && run.end === i - 1) run.end = i;
    else { run = { id: p.id, start: i, end: i, color: p.color }; runs.push(run); }
  }
  return runs;
}

// ---- the page

// The paragraph's text and the text nodes that make it up, each with where it starts in the text
export function unitText(unit) {
  const nodes = [];
  let text = "";
  (function walk(n) {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { nodes.push({ node: c, at: text.length }); text += c.nodeValue; }
      else if (c.nodeType === 1 && !c.matches(SKIP)) walk(c);
    }
  })(unit);
  return { text, nodes };
}

// The words of this paragraph that a selection (a DOM Range) covers: { start, end, text }, or
// null when it covers none of them.
export function rangeWords(unit, range) {
  const { text, nodes } = unitText(unit);
  let a = Infinity, b = -1;
  for (const { node, at } of nodes) {
    const len = node.nodeValue.length;
    if (!len) continue;
    let head, tail;
    try { head = range.comparePoint(node, 0); tail = range.comparePoint(node, len); } catch (_) { continue; }
    if (tail < 0 || head > 0) continue; // the whole node lies before the selection, or after it
    const s = head < 0 ? (node === range.startContainer ? range.startOffset : 0) : 0;
    const e = tail > 0 ? (node === range.endContainer ? range.endOffset : len) : len;
    if (e <= s) continue;
    a = Math.min(a, at + s); b = Math.max(b, at + e);
  }
  if (b < 0) return null;
  const spans = wordSpans(text);
  const w = wordsIn(spans, a, b);
  return w ? { start: w.start, end: w.end, text: phraseText(text, spans, w.start, w.end) } : null;
}

// Wraps the words start..end of the paragraph in <mark class="..."> (one mark per text node the
// words run through, so a footnote link in the middle is left whole). attrs are set on each.
export function wrapWords(unit, start, end, className, attrs) {
  const { text, nodes } = unitText(unit);
  const spans = wordSpans(text);
  if (!spans[start] || !spans[end] || end < start) return [];
  const a = spans[start].s, b = spans[end].e;
  const made = [];
  for (const { node, at } of nodes) {
    const len = node.nodeValue.length;
    const s = Math.max(a, at) - at, e = Math.min(b, at + len) - at;
    if (e <= s) continue;
    let part = node;
    if (s > 0) part = part.splitText(s);
    if (e - s < part.nodeValue.length) part.splitText(e - s);
    const mark = unit.ownerDocument.createElement("mark");
    mark.className = className;
    for (const k of Object.keys(attrs || {})) mark.setAttribute(k, attrs[k]);
    part.parentNode.insertBefore(mark, part);
    mark.appendChild(part);
    made.push(mark);
  }
  return made;
}

// Takes the phrase marks off a paragraph and leaves its text as it was
export function unwrapPhrases(unit, selector = "mark.hlp") {
  const marks = unit.querySelectorAll(selector);
  if (!marks.length) return;
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    while (m.firstChild) m.parentNode.insertBefore(m.firstChild, m);
    m.parentNode.removeChild(m);
  }
  unit.normalize();
}
