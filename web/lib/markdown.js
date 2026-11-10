// A small Markdown renderer, shared by Ask's answers (ask.js) and the Markdown pages in My
// studies (studies.js). Paragraphs, headings, lists, bold, italic; for an answer, [n]
// citations and the quotation check; for a page of notes, block quotes, rules, code and links.
// Pure: it returns HTML and touches no DOM, so it runs the same in the sandboxed frame's
// source, in the app, and in node.

import { esc } from "./format.js";
import { findReferences } from "./refs.js";

// --------------------------------------------------------------- links --
// In an answer, a web address written out and a passage named in plain words ("Alma 32:21",
// "Heb. 11:1") become links, as they do in a study page; the app follows them to its own copy
// first. Worked on the finished HTML, between its tags: the words are read unescaped, and every
// piece goes back escaped. Nothing inside a link, a button (a citation) or code is touched.
const URL_RE = /\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;
const unesc = (t) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&");
export function linkWords(html) {
  let inside = 0;
  return html.replace(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>|[^<]+/gi, (m, close, tag) => {
    if (tag) { if (/^(a|button|code|pre)$/i.test(tag)) inside = Math.max(0, inside + (close ? -1 : 1)); return m; }
    if (inside) return m;
    const text = unesc(m), spans = [];
    for (const u of text.matchAll(URL_RE)) spans.push({ start: u.index, end: u.index + u[0].length, href: u[0], cls: "out" });
    for (const r of findReferences(text)) if (!spans.some((x) => r.start < x.end && x.start < r.end)) spans.push({ start: r.start, end: r.end, href: r.href, cls: "ref" });
    if (!spans.length) return m;
    spans.sort((a, b) => a.start - b.start);
    let out = "", last = 0;
    for (const x of spans) { out += esc(text.slice(last, x.start)) + `<a class="${x.cls}" href="${esc(x.href)}">${esc(text.slice(x.start, x.end))}</a>`; last = x.end; }
    return out + esc(text.slice(last));
  });
}

// ---------------------------------------------------------- quotations --
// Every quotation in an answer is checked, word for word, against the
// passages the tools returned. One that is not there is underlined, and
// the answer gets a note with a button that asks Claude to put it right.
export const normText = (t) => String(t || "").toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
export const QUOTE_RE = /[“"]([^”"]{12,}?)[”"]/g;
export function quoteFound(q, passages) {
  const parts = q.split(/\s*(?:\.\.\.|…)\s*/).map(normText).filter((x) => x.split(" ").length >= 3);
  if (!parts.length) return true;
  for (const p of passages) {
    if (p._norm === undefined) p._norm = " " + normText(p.plain || p.text) + " ";
    if (parts.every((x) => p._norm.includes(" " + x + " "))) return true;
  }
  return false;
}
// web: the stretches of an answer that Claude's web search stands behind ([{plain}], from the
// citations the API attaches). A quotation inside one is from the web: the library cannot
// check it, so it is left out of the list of unverified quotations and shown with its own mark.
export function unverifiedQuotes(src, passages, web = []) {
  const out = [];
  for (const m of src.matchAll(QUOTE_RE)) if (m[1].split(/\s+/).length >= 4 && !quoteFound(m[1], passages) && !(web.length && quoteFound(m[1], web))) out.push(m[1]);
  return [...new Set(out)];
}
/** The quotations that are from the web: not in any passage, and inside a stretch the web search stands behind. */
export function webQuotes(src, passages, web = []) {
  const out = [];
  if (web.length) for (const m of src.matchAll(QUOTE_RE)) if (m[1].split(/\s+/).length >= 4 && !quoteFound(m[1], passages) && quoteFound(m[1], web)) out.push(m[1]);
  return [...new Set(out)];
}

/**
 * Markdown to HTML.
 *   passages: the passages quotations are checked against (none: no check);
 *   web: the stretches of the answer that came from a web search ([{plain}]); a quotation in
 *        one, and in no passage, is marked "web" instead of underlined;
 *   cite(n): the HTML for a citation [n] (none: [n] stays as written);
 *   links: an answer whose Markdown links, web addresses and plain references are to be links
 *          (ask.js follows them through the app, its own copy first);
 *   page: a page of notes rather than an answer: "#" is h1 (in an answer it is h2, since the
 *         answer sits under the app's own heading), and block quotes, rules, `code`, fenced
 *         code blocks, and links to the web, to the site or to a heading of the page are read
 *         too; each heading gets an id from its words, so [x](#its-words) finds it.
 */
export function markdown(src, { passages = null, cite = null, page = false, web = null, links = false } = {}) {
  const quoted = (t) => {
    let html = "", last = 0;
    for (const m of t.matchAll(QUOTE_RE)) {
      html += esc(t.slice(last, m.index));
      const q = m[1], open = m[0][0], close = m[0][m[0].length - 1];
      const bad = !!passages && q.split(/\s+/).length >= 4 && !quoteFound(q, passages);
      const fromWeb = bad && !!web && web.length > 0 && quoteFound(q, web);
      html += fromWeb ? `${esc(open)}<span class="from-web" title="From the web, not checked against your library">${esc(q)}</span>${esc(close)}<sup class="from-web-tag" title="From the web, not checked against your library">web</sup>`
        : esc(open) + (bad ? `<span class="unverified" title="Not word for word in any passage found">${esc(q)}</span>` : esc(q)) + esc(close);
      last = m.index + m[0].length;
    }
    return html + esc(t.slice(last));
  };
  const inline = (t) => {
    let html = quoted(t);
    if (page) html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    if (page) html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => /^(https?:\/\/|\/|#)/i.test(url) ? `<a href="${url.replace(/"/g, "%22")}">${text}</a>` : text);
    // an answer's own links: to the web or to the site only (the text and the address are already escaped)
    else if (links) html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => /^(https?:\/\/|\/)/i.test(url) ? `<a class="out" href="${url.replace(/"/g, "%22")}">${text}</a>` : text);
    if (cite) html = html.replace(/\[(\d+)\]/g, (_, n) => cite(n));
    if (links) html = linkWords(html);
    return html;
  };
  const HEADING = page ? /^(#{1,3})\s+(.*)$/ : /^(#{1,4})\s+(.*)$/;
  const shift = page ? 0 : 1;
  const out = [];
  let list = null, para = [], quote = [], fence = null;
  const ids = new Map(); // a heading's id, numbered when two headings share their words
  const idFor = (text) => { const base = slugOf(text) || "section"; const n = ids.get(base) || 0; ids.set(base, n + 1); return n ? `${base}-${n}` : base; };
  const closePara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeQuote = () => { if (quote.length) { out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`); quote = []; } };
  for (const raw of src.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (page && /^\s*```/.test(line)) {
      if (fence) { out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`); fence = null; } else { closePara(); closeList(); closeQuote(); fence = []; }
      continue;
    }
    if (fence) { fence.push(raw.replace(/\r$/, "")); continue; }
    if (!line.trim()) { closePara(); closeList(); closeQuote(); continue; }
    if ((m = line.match(HEADING))) {
      closePara(); closeList(); closeQuote();
      const h = m[1].length + shift;
      out.push(page ? `<h${h} id="${esc(idFor(m[2]))}">${inline(m[2])}</h${h}>` : `<h${h}>${inline(m[2])}</h${h}>`);
      continue;
    }
    if (page && /^(-{3,}|\*{3,})$/.test(line.trim())) { closePara(); closeList(); closeQuote(); out.push("<hr>"); continue; }
    if (page && (m = line.match(/^\s*>\s?(.*)$/))) { closePara(); closeList(); quote.push(m[1]); continue; }
    if ((m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/))) {
      closePara(); closeQuote();
      const kind = /^\s*\d/.test(line) ? "ol" : "ul";
      if (list !== kind) { closeList(); list = kind; out.push(`<${kind}>`); }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    closeList(); closeQuote();
    para.push(page ? line.trim() : line);
  }
  closePara(); closeList(); closeQuote();
  if (fence) out.push(`<pre><code>${esc(fence.join("\n"))}</code></pre>`);
  return out.join("\n");
}

/** A heading's id, from its words as GitHub makes them: "Faith & Hope, 1830" -> "faith--hope-1830". */
export function slugOf(text) {
  return String(text ?? "").replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
}
