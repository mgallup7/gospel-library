// web/lib/markdown.js: Ask's answers (with citation buttons and the quotation check) and the
// Markdown pages in My studies (page mode). The expected HTML is what ask.js and studies.js
// rendered with their own copies before the renderer moved here.
import test from "node:test";
import assert from "node:assert/strict";
import { markdown, quoteFound, unverifiedQuotes } from "../../web/lib/markdown.js";

const passages = () => [
  { n: 1, doc_id: 11, pid: "p21", label: "Alma 32:21", citation: "Alma 32:21", collection: "scriptures", text: "And now as I said concerning faith, faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true." },
  { n: 2, doc_id: 22, pid: null, label: "April 2024 General Conference", author: "Elder Neil L. Andersen", collection: "general-conference", plain: "The Savior's love reaches us wherever we are, and his grace is sufficient.", text: "<b>x</b>" },
];
// A stand-in for ask.js's button renderer: a known passage becomes <c>n</c>, an unknown one stays [n].
const answer = (src) => {
  const ps = passages();
  return markdown(src, { passages: ps, cite: (n) => (ps.some((p) => p.n === Number(n)) ? `<c>${n}</c>` : `[${n}]`) });
};
const page = (src) => markdown(src, { page: true });

test("answer: a paragraph, escaped", () => {
  assert.equal(answer("Plain words."), "<p>Plain words.</p>");
  assert.equal(answer('Missing [9] and <tag> & "amp".'), "<p>Missing [9] and &lt;tag&gt; &amp; &quot;amp&quot;.</p>");
});

test("answer: headings sit one level down, emphasis and citations inline", () => {
  assert.equal(answer("# Faith\nIt is **hope** in *things* not seen [1]."), "<h2>Faith</h2>\n<p>It is <b>hope</b> in <i>things</i> not seen <c>1</c>.</p>");
  assert.equal(answer("#### Deep\nline one\nline two  \n\n> not a quote here\n---"), "<h5>Deep</h5>\n<p>line one line two</p>\n<p>&gt; not a quote here ---</p>");
});

test("answer: bullet and numbered lists", () => {
  assert.equal(answer("- one\n- two [2]\n\n1. first\n2) second"), "<ul>\n<li>one</li>\n<li>two <c>2</c></li>\n</ul>\n<ol>\n<li>first</li>\n<li>second</li>\n</ol>");
  assert.equal(answer("* star item\n• bullet item\nafter"), "<ul>\n<li>star item</li>\n<li>bullet item</li>\n</ul>\n<p>after</p>");
});

test("answer: a quotation found word for word is left alone", () => {
  assert.equal(answer("Alma says “faith is not to have a perfect knowledge of things” [1]."), "<p>Alma says “faith is not to have a perfect knowledge of things” <c>1</c>.</p>");
  assert.equal(answer("“The Savior's love reaches us … his grace is sufficient” [2]"), "<p>“The Savior's love reaches us … his grace is sufficient” <c>2</c></p>");
});

test("answer: a quotation that is in no passage is marked", () => {
  assert.equal(answer("He said “faith is a perfect knowledge of all things here” once."), '<p>He said “<span class="unverified" title="Not word for word in any passage found">faith is a perfect knowledge of all things here</span>” once.</p>');
  assert.equal(answer('Short “two words” quote and "a b c".'), "<p>Short “two words” quote and &quot;a b c&quot;.</p>");
});

test("the quotation check on its own", () => {
  assert.deepEqual(unverifiedQuotes("“faith is not to have a perfect knowledge” and “nobody said these words here” twice “nobody said these words here”", passages()), ["nobody said these words here"]);
  assert.equal(quoteFound("two words", []), true);
  assert.equal(quoteFound("hope for things which are not seen", passages()), true);
});

test("page: headings at their own level, and only three of them", () => {
  assert.equal(page("# Title\n## Sub\n### Third\n#### Fourth"), '<h1 id="title">Title</h1>\n<h2 id="sub">Sub</h2>\n<h3 id="third">Third</h3>\n<p>#### Fourth</p>');
  assert.equal(page("Para one\n  continues here\n\nPara two"), "<p>Para one continues here</p>\n<p>Para two</p>");
});

test("page: block quotes, lists and rules", () => {
  assert.equal(page("> quoted line\n> more\nafter"), "<blockquote>quoted line more</blockquote>\n<p>after</p>");
  assert.equal(page("- a\n- b\n1. c"), "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<ol>\n<li>c</li>\n</ol>");
  assert.equal(page("---\n***"), "<hr>\n<hr>");
});

test("page: code, emphasis and links to the web or the site only", () => {
  assert.equal(page("Use `code **x**` and **bold** and *it*."), "<p>Use <code>code <b>x</b></code> and <b>bold</b> and <i>it</i>.</p>");
  assert.equal(page("[link](https://example.com/a?b=1&c=2) and [rel](/x) and [bad](javascript:alert(1)) and [x](foo.html)"), '<p><a href="https://example.com/a?b=1&amp;c=2">link</a> and <a href="/x">rel</a> and bad) and x</p>');
});

test("page: Windows line ends, no citations, no quotation check, nothing unescaped", () => {
  assert.equal(page("line\r\nnext\r\n\r\nnew"), "<p>line next</p>\n<p>new</p>");
  assert.equal(page("Quote “like this one here” stays plain [3]."), "<p>Quote “like this one here” stays plain [3].</p>");
  assert.equal(page("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
});

test("page: headings get ids from their words, and [x](#id) links to them", () => {
  assert.equal(page("## Faith & Hope, 1830\n## The *Second* Coming\n## Faith & Hope, 1830\nSee [the coming](#the-second-coming)."),
    '<h2 id="faith--hope-1830">Faith &amp; Hope, 1830</h2>\n<h2 id="the-second-coming">The <i>Second</i> Coming</h2>\n<h2 id="faith--hope-1830-1">Faith &amp; Hope, 1830</h2>\n<p>See <a href="#the-second-coming">the coming</a>.</p>');
  assert.equal(page("# Alma’s [sermon](https://example.com/x)"), '<h1 id="almas-sermon">Alma’s <a href="https://example.com/x">sermon</a></h1>');
  assert.equal(page("# !!!"), '<h1 id="section">!!!</h1>');
  // an answer's headings keep no ids, and an answer reads no links
  assert.equal(answer("# Faith\n[x](#faith)"), "<h2>Faith</h2>\n<p>[x](#faith)</p>");
});

test("page: a fenced code block is kept as written, escaped, and not read as Markdown", () => {
  assert.equal(page("Before\n```\n# not a heading\n<b>Alma 32:21</b> **x**\n```\nAfter"), "<p>Before</p>\n<pre><code># not a heading\n&lt;b&gt;Alma 32:21&lt;/b&gt; **x**</code></pre>\n<p>After</p>");
  assert.equal(page("```js\nunclosed"), "<pre><code>unclosed</code></pre>");
});

test("answer: a quotation from a web search is marked as such, and is not counted as unverified", async () => {
  const { webQuotes } = await import("../../web/lib/markdown.js");
  const ps = passages();
  const web = [{ plain: 'The temple was dedicated in 1893, and a report of the day said "the crowd filled the block from end to end" before noon.' }];
  const src = 'Alma says "faith is not to have a perfect knowledge of things" [1]. A report said "the crowd filled the block from end to end". He never said "this line is in neither place at all".';
  const html = markdown(src, { passages: ps, web });
  assert.ok(html.includes("&quot;faith is not to have a perfect knowledge of things&quot;"), "a library quotation is left plain");
  assert.ok(html.includes('<span class="from-web" title="From the web, not checked against your library">the crowd filled the block from end to end</span>&quot;<sup class="from-web-tag" title="From the web, not checked against your library">web</sup>'), html);
  assert.ok(html.includes('<span class="unverified" title="Not word for word in any passage found">this line is in neither place at all</span>'), "an invented quotation is still underlined");
  assert.deepEqual(unverifiedQuotes(src, ps, web), ["this line is in neither place at all"]);
  assert.deepEqual(webQuotes(src, ps, web), ["the crowd filled the block from end to end"]);
  // with no web search there is no web mark: the same words are plainly unverified
  assert.deepEqual(unverifiedQuotes(src, passages()), ["the crowd filled the block from end to end", "this line is in neither place at all"]);
  assert.deepEqual(webQuotes(src, passages()), []);
  assert.ok(!markdown(src, { passages: passages() }).includes("from-web"));
  // a quotation the library holds is the library's, even when a web stretch repeats it
  assert.deepEqual(webQuotes('"faith is not to have a perfect knowledge of things"', passages(), [{ plain: "faith is not to have a perfect knowledge of things" }]), []);
});
