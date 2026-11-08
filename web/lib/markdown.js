// A small Markdown renderer, shared by Ask's answers (ask.js) and the Markdown pages in My
// studies (studies.js). Paragraphs, headings, lists, bold, italic; for an answer, [n]
// citations and the quotation check; for a page of notes, block quotes, rules, code and links.
// Pure: it returns HTML and touches no DOM, so it runs the same in the sandboxed frame's
// source, in the app, and in node.

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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
export function unverifiedQuotes(src, passages) {
  const out = [];
  for (const m of src.matchAll(QUOTE_RE)) if (m[1].split(/\s+/).length >= 4 && !quoteFound(m[1], passages)) out.push(m[1]);
  return [...new Set(out)];
}

/**
 * Markdown to HTML.
 *   passages: the passages quotations are checked against (none: no check);
 *   cite(n): the HTML for a citation [n] (none: [n] stays as written);
 *   page: a page of notes rather than an answer: "#" is h1 (in an answer it is h2, since the
 *         answer sits under the app's own heading), and block quotes, rules, `code` and
 *         links to the web or to the site are read too.
 */
export function markdown(src, { passages = null, cite = null, page = false } = {}) {
  const quoted = (t) => {
    let html = "", last = 0;
    for (const m of t.matchAll(QUOTE_RE)) {
      html += esc(t.slice(last, m.index));
      const q = m[1], open = m[0][0], close = m[0][m[0].length - 1];
      const bad = !!passages && q.split(/\s+/).length >= 4 && !quoteFound(q, passages);
      html += esc(open) + (bad ? `<span class="unverified" title="Not word for word in any passage found">${esc(q)}</span>` : esc(q)) + esc(close);
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
    if (page) html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => /^(https?:\/\/|\/)/i.test(url) ? `<a href="${url.replace(/"/g, "%22")}">${text}</a>` : text);
    if (cite) html = html.replace(/\[(\d+)\]/g, (_, n) => cite(n));
    return html;
  };
  const HEADING = page ? /^(#{1,3})\s+(.*)$/ : /^(#{1,4})\s+(.*)$/;
  const shift = page ? 0 : 1;
  const out = [];
  let list = null, para = [], quote = [];
  const closePara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const closeQuote = () => { if (quote.length) { out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`); quote = []; } };
  for (const raw of src.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { closePara(); closeList(); closeQuote(); continue; }
    if ((m = line.match(HEADING))) { closePara(); closeList(); closeQuote(); out.push(`<h${m[1].length + shift}>${inline(m[2])}</h${m[1].length + shift}>`); continue; }
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
  return out.join("\n");
}
