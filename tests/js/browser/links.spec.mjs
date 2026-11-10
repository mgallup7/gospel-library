import fs from "node:fs";
// links: every link opens the library's copy when it holds the page, and offers the web when it
// does not. Run by tests/js/browser/run.mjs. Built from the links reviewer's table: addresses
// through resolve, then clicks from an HTML study, a Markdown study, a chapter and a footnote.
// The test library holds the scriptures and nine Joseph Smith Papers pages: no talks or manuals.
const SITE = "https://www.churchofjesuschrist.org";
const ALMA32 = "page /scriptures/bofm/alma/32";
// [address, what resolve should say]: "page <uri> [pid[-end]] [n listed]", "book <slug or uri>",
// "shelf <collection>", "out", "out near <title>"
const TABLE = [
  [`${SITE}/study/scriptures/bofm/alma/32?lang=eng&id=p21#p21`, `${ALMA32} p21`],
  ["/study/scriptures/bofm/alma/32?lang=eng#p21", `${ALMA32} p21`],
  ["/study/scriptures/bofm/alma/32?id=p21-p27", `${ALMA32} p21-p27`],
  ["/study/scriptures/bofm/alma/32.21-27?lang=eng", `${ALMA32} p21-p27`],
  ["/study/scriptures/bofm/alma/32.21,23-25?lang=eng", `${ALMA32} p21 4 listed`],
  ["/study/scriptures/bofm/alma/32?id=p21,p23-p25", `${ALMA32} p21 4 listed`],
  ["/scriptures/bofm/alma/32", ALMA32],
  ["/study/eng/scriptures/bofm/alma/32", ALMA32],
  ["https://churchofjesuschrist.org/study/scriptures/bofm/alma/32", ALMA32],
  ["http://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32/", ALMA32],
  ["https://abn.churchofjesuschrist.org/study/scriptures/bofm/alma/32", ALMA32],
  ["/study/scriptures/bofm/alma/32?lang=spa", ALMA32],
  ["https://www.lds.org/scriptures/bofm/alma/32.21?lang=eng#20", `${ALMA32} p21`],
  ["https://www.lds.org/scriptures/ot/mal/3.1?lang=eng#0", "page /scriptures/ot/mal/3 p1"],
  ["//www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?id=p21", `${ALMA32} p21`],
  ["https://scriptures.lds.org/en/alma/32/21", `${ALMA32} p21`],
  ["https://scriptures.lds.org/en/1_ne/3/7-8", "page /scriptures/bofm/1-ne/3 p7-p8"],
  ["https://scriptures.lds.org/en/dc/76", "page /scriptures/dc-testament/dc/76"],
  ["https://scriptures.lds.org/en/alma", "book alma"],
  ["/study/scriptures/nt/1-thes/4?lang=eng", "page /scriptures/nt/1-thes/4"],
  ["/study/scriptures/dc-testament/dc/76.22-24", "page /scriptures/dc-testament/dc/76 p22-p24"],
  ["/study/scriptures/pgp/js-h/1?lang=eng&id=p17#p17", "page /scriptures/pgp/js-h/1 p17"],
  ["/study/scriptures/bofm/alma?lang=eng", "book alma"],
  ["/study/scriptures/bofm?lang=eng", "book /scriptures/bofm"],
  ["/study/scriptures?lang=eng", "shelf scriptures"],
  ["https://www.josephsmithpapers.org/paper-summary/journal-1832-1834", "page /paper-summary/journal-1832-1834"],
  ["https://www.josephsmithpapers.org/paper-summary/journal-1832-1834/1", "page /paper-summary/journal-1832-1834"],
  ["https://josephsmithpapers.org/paper-summary/journal-1835-1836/12", "page /paper-summary/journal-1835-1836"],
  ["https://www.josephsmithpapers.org/paper-summary/letter-to-emma-smith-4-june-1834/1#source-note", "page /paper-summary/letter-to-emma-smith-4-june-1834/source-note"],
  ["/paper-summary/journal-1832-1834", "page /paper-summary/journal-1832-1834"],
  // a page the library lacks in a book it holds: out, with the book as a hint
  ["/study/scriptures/bofm/alma/99?lang=eng", "out near Alma"],
  ["/study/scriptures/dc-testament/od/1?lang=eng", "out near Doctrine and Covenants"],
  ["/study/scriptures/bofm/introduction?lang=eng", "out near Book of Mormon"],
  // not in this copy at all
  [`${SITE}/study/general-conference/2024/04/15nelson?lang=eng&id=p12#p12`, "out"],
  ["/general-conference/2024/04/15nelson", "out"],
  ["/study/general-conference", "out"],
  ["/study/manual/preach-my-gospel-2023/06-chapter-3?lang=eng&id=p12#p12", "out"],
  [`${SITE}/study/manual/general-handbook/38-church-policies-and-guidelines?lang=eng&id=title_number87#title_number87`, "out"],
  [`${SITE}/study/manual/gospel-topics/faith-in-jesus-christ?lang=eng`, "out"],
  [`${SITE}/media/video/2011-10-0001-x`, "out"],
  ["/study/scriptures/bd/faith?lang=eng", "out"],
  [`${SITE}/study`, "out"],
  ["https://scriptures.lds.org/en/nobook/1/1", "out"],
  ["https://www.josephsmithpapers.org/paper-summary/not-held/2", "out"],
  ["https://www.josephsmithpapers.org/scriptures/bofm/alma/32", "out"], // a Church path on the Papers' site is not the Church's page
  [`${SITE}/paper-summary/journal-1832-1834`, "out"],
  ["https://newsroom.churchofjesuschrist.org/article/x", "out"],
  ["https://speeches.byu.edu/talks/x", "out"],
  ["https://example.com/elsewhere", "out"],
  ["mailto:someone@example.com", "out"],
  ["javascript:alert(1)", "out"],
];
const TALK = `${SITE}/study/general-conference/2024/04/15nelson?lang=eng&id=p12#p12`;
const STUDY = `<!doctype html><html><head><meta charset="utf-8"><title>Every link</title><style>.x::after{content:"Alma 32:21"}</style></head><body>
<h1>Every link</h1>
<p><a id="verse" href="${SITE}/study/scriptures/bofm/alma/32?lang=eng&amp;id=p21#p21">verse</a>
<a id="comma" href="/study/scriptures/bofm/alma/32.21,23-25?lang=eng">list</a>
<a id="protorel" href="//www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?id=p22">protocol-relative</a>
<a id="oldest" href="https://scriptures.lds.org/en/alma/32/23">scriptures.lds.org</a>
<a id="jsp" href="https://www.josephsmithpapers.org/paper-summary/journal-1832-1834/1">papers</a>
<a id="shelf" href="/study/scriptures?lang=eng">shelf</a>
<a id="missing" href="/study/scriptures/bofm/alma/99?lang=eng">missing chapter</a>
<a id="talk" href="${TALK.replace(/&/g, "&amp;")}" target="_blank">talk</a>
<a id="web" href="https://example.com/elsewhere?a=1&amp;b=2#frag">web</a>
<a id="relative" href="../alma/33">relative</a>
<a id="mail" href="mailto:someone@example.com?subject=Hello">mail</a>
<a id="tel" href="tel:+13035551212">phone</a>
<a id="inpage" href="#bottom">in page</a></p>
<p id="plain">Plain words: see Alma 32:27 and D&amp;C 76:22-24. <a id="own" href="https://example.com/own">My own link to Alma 32:28</a></p>
<script>window.note = "Alma 32:29";</script>
<div style="height:1500px"></div><p id="bottom">bottom</p></body></html>`;
const MD = `# Markdown links\n\nSee Alma 32:26 and [a verse](${SITE}/study/scriptures/bofm/alma/32?lang=eng&id=p21#p21) and [a talk](${TALK}).\n\nBare: https://example.com/bare?x=1 here.\n`;

export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "links/";
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + "every.html", STUDY);
  fs.writeFileSync(OUT + "links.md", MD);
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
  // the sandbox has no web: the sites answer here, or do not (dead), as the test says
  let dead = false;
  const asked = [];
  await ctx.route((u) => u.hostname !== new URL(BASE).hostname, (route) => { asked.push(`${route.request().method()} ${route.request().url()}`); return dead ? route.abort("internetdisconnected") : route.fulfill({ status: 200, contentType: "text/html", body: "<title>the web</title>" }); });
  // window.open is never the way out: any call is recorded, with whether a tap was still live
  await ctx.addInitScript(() => {
    if (window.top !== window) return;
    window.__opens = [];
    window.open = (...a) => { window.__opens.push(String(a[0])); return null; };
    // mail and phone links: which were clicked, and whether the app stopped the browser acting on them
    window.__mail = [];
    window.addEventListener("click", (e) => { const a = e.target.closest?.("a[href]"); if (a && /^(mailto|tel):/.test(a.getAttribute("href"))) { window.__mail.push(`${a.getAttribute("href")} ${e.defaultPrevented ? "stopped" : "acts"}`); e.preventDefault(); } });
  });
  const popups = [];
  const page = await ctx.newPage();
  ctx.on("page", (p) => popups.push(p));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

  // ---- 1. the table, through resolve ---------------------------------------
  const got = await page.evaluate(async (hrefs) => {
    const out = [];
    for (const h of hrefs) {
      const r = await GL.api("resolve", { href: h }).catch((e) => ({ error: String(e) }));
      if (r.error) out.push(`error ${r.error}`);
      else if (!r.found) out.push(r.near ? `out near ${r.near.title}` : "out");
      else if (r.kind === "page") out.push(`page ${r.uri}${r.pid ? ` ${r.pid}${r.pid_end ? `-${r.pid_end}` : ""}` : ""}${r.pids ? ` ${r.pids.length} listed` : ""}`);
      else out.push(`${r.kind} ${r.book_slug || r.book_uri || r.collection}`);
    }
    return out;
  }, TABLE.map((t) => t[0]));
  TABLE.forEach(([href, want], i) => check(got[i] === want, `resolve ${href}: ${got[i]}, expected ${want}`));
  check(TABLE.length >= 40, "the table is short");

  // ---- helpers --------------------------------------------------------------
  const toastNow = () => page.evaluate(() => { const t = document.querySelector("#toast.show"); return t ? { text: t.querySelector("span").textContent, links: [...t.querySelectorAll("a.toast-action")].map((a) => ({ href: a.href, target: a.target, rel: a.rel, text: a.textContent })), buttons: [...t.querySelectorAll("button.toast-action")].map((b) => b.textContent) } : null; });
  const clearToast = () => page.evaluate(() => document.querySelector("#toast")?.classList.remove("show"));
  // the outside toast for a click: its words, and one real link with exactly this address
  async function expectOut(label, href, words) {
    await page.waitForFunction((h) => document.querySelector("#toast.show a.toast-action")?.href === h, href, { timeout: 5000 }).catch(() => {});
    const t = await toastNow();
    const a = t && t.links[0];
    check(a && a.href === href && a.target === "_blank" && a.rel === "noopener", `${label}: toast link ${JSON.stringify(t)}, expected ${href}`);
    check(t && words.test(t.text + " " + (a ? a.text : "")), `${label}: toast says ${JSON.stringify(t)}`);
    return t;
  }
  const frame = () => page.frameLocator("#reader .study-frame");
  const peekTitle = async () => { await page.waitForSelector("#sheet:not([hidden]) .peek p", { timeout: 8000 }); return page.textContent("#sheet .nm"); };
  const closeSheet = async () => { await page.click("#sheet .close"); await page.waitForSelector("#sheet", { state: "hidden" }); };
  const backToStudy = async () => { await page.goBack(); await page.waitForSelector("#reader .study-frame", { timeout: 8000 }); await page.waitForTimeout(250); };
  async function addStudy(file) {
    await page.evaluate(() => { location.hash = "#studies"; });
    await page.waitForSelector("#homeBody input[type=file]", { state: "attached", timeout: 8000 });
    await page.setInputFiles("#homeBody input[type=file]", OUT + file);
    await page.waitForSelector("#reader .study-frame", { timeout: 20000 });
    await page.waitForTimeout(500);
  }

  // ---- 2. an HTML study ------------------------------------------------------
  await addStudy("every.html");
  check((await frame().locator("h1").textContent()) === "Every link", "the study did not render");
  await frame().locator("#verse").click();
  check(/Alma 32:21/.test(await peekTitle()), "study verse: no passage sheet");
  await closeSheet();
  await frame().locator("#comma").click();
  let nm = await peekTitle();
  check(/Alma 32:21, 23–25/.test(nm) && (await page.locator("#sheet .peek p").count()) === 4, `study list: ${nm}, ${await page.locator("#sheet .peek p").count()} verses`);
  await page.click("#sheet .peek-row .primary");
  await page.waitForFunction(() => document.querySelectorAll("#reader .doc .is-target").length === 4, null, { timeout: 8000 }).catch(() => {});
  check((await page.evaluate(() => [...document.querySelectorAll("#reader .doc .is-target")].map((v) => v.id).join())) === "p21,p23,p24,p25", "study list: the listed verses are not all marked in the chapter");
  await page.screenshot({ path: OUT + "01-list-marked.png" });
  await backToStudy();
  await frame().locator("#protorel").click();
  check(/Alma 32:22/.test(await peekTitle()), "study protocol-relative: no passage sheet");
  await closeSheet();
  await frame().locator("#oldest").click();
  check(/Alma 32:23/.test(await peekTitle()), "study scriptures.lds.org: no passage sheet");
  await closeSheet();
  await frame().locator("#jsp").click();
  await page.waitForSelector("#reader .doc", { timeout: 8000 });
  check(/doc=\d+/.test(await page.evaluate(() => location.hash)) && /josephsmithpapers/.test(await page.getAttribute("#reader .reader-bar a[target=_blank]", "href")), "study Papers link did not open the local page");
  await backToStudy();
  await frame().locator("#shelf").click();
  await page.waitForFunction(() => /^#scriptures/.test(location.hash), null, { timeout: 8000 }).catch(() => {});
  check(/^#scriptures/.test(await page.evaluate(() => location.hash)), "study shelf link did not open the shelf");
  await backToStudy();
  // out: the toast, with the address exact
  await frame().locator("#talk").click();
  await expectOut("study talk", TALK, /Not in your library.*churchofjesuschrist\.org/);
  await page.screenshot({ path: OUT + "02-outside-toast.png" });
  await frame().locator("#web").click();
  await expectOut("study web", "https://example.com/elsewhere?a=1&b=2#frag", /example\.com/);
  await frame().locator("#missing").click();
  let t = await expectOut("study missing chapter", `${SITE}/study/scriptures/bofm/alma/99?lang=eng`, /Not in your library.*Open on the web/);
  check(t && t.buttons.join() === "Open Alma contents", `study missing chapter: buttons ${JSON.stringify(t && t.buttons)}`);
  await page.screenshot({ path: OUT + "03-missing-chapter.png" });
  await page.click("#toast button.toast-action");
  await page.waitForSelector("#homeBody .chapters", { timeout: 8000 }).catch(() => check(false, "Open Alma contents did not open the book"));
  await backToStudy();
  // a relative link no longer blanks the frame
  await frame().locator("#relative").click();
  await page.waitForFunction(() => /beside this page/.test(document.querySelector("#toast.show")?.textContent || ""), null, { timeout: 5000 }).catch(() => check(false, "study relative link: no message"));
  check((await frame().locator("h1").textContent().catch(() => "")) === "Every link", "study relative link blanked the frame");
  // mail and phone from a study page are offered, not started: the page could have sent the link with no tap
  await frame().locator("#mail").click();
  await page.waitForFunction(() => /start an email to someone@example\.com/.test(document.querySelector("#toast.show")?.textContent || ""), null, { timeout: 5000 }).catch(() => check(false, "study mail link: no offer"));
  check((await page.evaluate(() => window.__mail.length)) === 0, "a study page's mail link acted with no tap in the app");
  check((await page.getAttribute("#toast a.toast-action", "href").catch(() => "")) === "mailto:someone@example.com?subject=Hello", "the offer does not carry the mail link");
  await frame().locator("#tel").click();
  await page.waitForFunction(() => /call \+13035551212/.test(document.querySelector("#toast.show")?.textContent || ""), null, { timeout: 5000 }).catch(() => check(false, "study phone link: no offer"));
  await page.click("#toast a.toast-action");
  await page.waitForFunction(() => window.__mail.length >= 1, null, { timeout: 5000 }).catch(() => {});
  check((await page.evaluate(() => window.__mail.join(" | "))) === "tel:+13035551212 acts", `study phone link, tapped in the offer: ${await page.evaluate(() => window.__mail.join(" | "))}`);
  check((await frame().locator("h1").textContent().catch(() => "")) === "Every link", "study mail link blanked the frame");
  await frame().locator("#inpage").click();
  check((await page.frames().find((f) => /study-frame\.html/.test(f.url())).evaluate(() => scrollY)) > 300, "study #anchor did not scroll within the page");
  // plain references in an HTML study are links; a link, a script and a style keep their words
  const plain = await page.frames().find((f) => /study-frame\.html/.test(f.url())).evaluate(() => ({ refs: [...document.querySelectorAll("#plain a:not(#own)")].map((a) => a.textContent), own: document.querySelector("#own").innerHTML, note: window.note, style: document.querySelector("style").textContent }));
  check(plain.refs.join("|") === "Alma 32:27|D&C 76:22-24" && plain.own === "My own link to Alma 32:28" && plain.note === "Alma 32:29" && /content:"Alma 32:21"/.test(plain.style), `study plain references: ${JSON.stringify(plain)}`);
  await frame().locator("#plain a").first().click();
  check(/Alma 32:27/.test(await peekTitle()), "study plain reference: no passage sheet");
  await closeSheet();

  // ---- 3. a Markdown study ---------------------------------------------------
  await clearToast();
  await addStudy("links.md");
  await frame().locator("a", { hasText: "a verse" }).click();
  check(/Alma 32:21/.test(await peekTitle()), "markdown verse: no passage sheet");
  await closeSheet();
  await frame().locator("a", { hasText: "Alma 32:26" }).click();
  check(/Alma 32:26/.test(await peekTitle()), "markdown plain reference: no passage sheet");
  await closeSheet();
  await frame().locator("a", { hasText: "a talk" }).click();
  await expectOut("markdown talk", TALK, /Not in your library/);
  await frame().locator("a", { hasText: "example.com/bare" }).click();
  await expectOut("markdown bare address", "https://example.com/bare?x=1", /example\.com/);
  // the toast's link is a real one: the tap on it opens the page, with no help from window.open
  await page.click("#toast a.toast-action");
  await page.waitForTimeout(500);
  check(popups.length === 1 && popups[0].url() === "https://example.com/bare?x=1", `the toast's link opened ${popups.map((p) => p.url())}`);
  for (const p of popups.splice(0)) await p.close();

  // ---- 4. links in a chapter -------------------------------------------------
  const alma30 = await page.evaluate(() => GL.api("resolve", { href: "/study/scriptures/bofm/alma/30" }));
  async function inChapter(href) {
    await clearToast();
    await page.evaluate((id) => GL.openDoc(id), alma30.doc_id);
    await page.waitForFunction(() => /Alma 30/.test(document.querySelector("#reader .doc h1")?.textContent || ""), null, { timeout: 8000 });
    await page.evaluate((h) => { document.querySelector("#inj")?.remove(); const a = document.createElement("a"); a.id = "inj"; a.setAttribute("href", h); a.textContent = "LINK "; document.querySelector("#reader .doc .verse").prepend(a); }, href);
    await page.click("#inj");
  }
  const docTitle = (re) => page.waitForFunction((s) => new RegExp(s).test(document.querySelector("#reader .doc h1")?.textContent || ""), re.source, { timeout: 8000 }).then(() => true, () => false);
  await inChapter("../alma/33"); // against the chapter's own address: /study/scriptures/bofm/alma/33
  check(await docTitle(/Alma 33/), "chapter relative link did not open Alma 33");
  check((await page.evaluate(() => location.pathname)) === new URL(BASE).pathname, `chapter relative link moved the app to ${await page.evaluate(() => location.pathname)}`);
  await inChapter("34?lang=eng&id=p2#p2");
  check(/Alma 34:2/.test(await peekTitle()), "chapter relative verse link: no passage sheet");
  await closeSheet();
  await inChapter("https://www.josephsmithpapers.org/paper-summary/journal-1835-1836/3");
  check(await docTitle(/Journal/), "chapter Papers link did not open the local page");
  await inChapter(TALK);
  await expectOut("chapter talk", TALK, /Not in your library.*churchofjesuschrist\.org/);
  await inChapter("//example.com/elsewhere?q=1#top");
  await expectOut("chapter web", "https://example.com/elsewhere?q=1#top", /example\.com/);
  await inChapter("mailto:someone@example.com");
  check((await page.evaluate(() => window.__mail[window.__mail.length - 1])) === "mailto:someone@example.com acts", "chapter mail link was stopped");
  // the network plainly dead though the device says online. The page's policy lets it reach
  // only its own files and Claude, so it cannot ask the site; the toast makes no claim about
  // it, keeps the link, and no request leaves the page
  dead = true;
  await inChapter(TALK);
  await page.waitForTimeout(600);
  await expectOut("dead network", TALK, /Not in your library/);
  check(!/not answering/.test(await page.evaluate(() => document.querySelector("#toast")?.textContent || "")), "dead network: the toast blamed the site, which the page cannot ask");
  dead = false;
  // offline: the message, no link; the reader's own link to the site says the same
  await ctx.setOffline(true);
  await inChapter(TALK);
  await page.waitForFunction(() => /you are offline/.test(document.querySelector("#toast.show")?.textContent || ""), null, { timeout: 5000 }).catch(() => check(false, "offline: no message for a page the library lacks"));
  t = await toastNow();
  check(t && !t.links.length, `offline: the toast still offers the web: ${JSON.stringify(t)}`);
  await page.screenshot({ path: OUT + "04-offline.png" });
  await clearToast();
  await page.evaluate(() => document.querySelector("#reader .reader-bar a[target=_blank]").click()); // in the bar or its menu, by width
  await page.waitForFunction(() => /you are offline/.test(document.querySelector("#toast.show")?.textContent || ""), null, { timeout: 5000 }).catch(() => check(false, "offline: the reader's site link gave no message"));
  check(popups.length === 0, "offline: the reader's site link opened a tab");
  await ctx.setOffline(false);

  // ---- 5. a footnote, the verse it links to, and Back ------------------------
  const jsp = await page.evaluate(() => GL.api("resolve", { href: "https://www.josephsmithpapers.org/paper-summary/journal-1832-1834" }));
  await clearToast();
  await page.evaluate((id) => GL.openDoc(id), jsp.doc_id);
  await docTitle(/Journal/);
  const marker = page.locator("#reader .doc a.study-note-ref, #reader .doc a[href^='#note'], #reader .doc a[data-scroll-id]").first();
  if (await marker.count()) {
    await marker.click();
    await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
    const note = await page.textContent("#sheet .sheet-body");
    await page.evaluate(() => { const b = document.querySelector("#sheet .sheet-body"); const a = document.createElement("a"); a.id = "fn"; a.setAttribute("href", "https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?lang=eng&id=p21#p21"); a.textContent = " Alma 32:21"; const m = document.createElement("a"); m.id = "fnmail"; m.setAttribute("href", "mailto:note@example.com"); m.textContent = " write"; b.append(a, m); });
    await page.click("#fnmail");
    check((await page.evaluate(() => window.__mail[window.__mail.length - 1])) === "mailto:note@example.com acts", "sheet mail link was stopped");
    await page.click("#fn");
    check(/Alma 32:21/.test(await peekTitle()), "footnote link: no passage sheet");
    await page.goBack();
    await page.waitForFunction(() => document.querySelector("#sheet").getAttribute("aria-label") === "Footnote", null, { timeout: 5000 }).catch(() => {});
    check(!(await page.evaluate(() => document.querySelector("#sheet").hidden)) && (await page.textContent("#sheet .sheet-body")).startsWith(note), "Back from the verse did not return to the footnote");
    await page.goBack();
    await page.waitForSelector("#sheet", { state: "hidden", timeout: 5000 }).catch(() => check(false, "the second Back did not close the footnote"));
    check(await docTitle(/Journal/), "Back from the footnote left the page");
  } else check(false, "no footnote marker in the Papers page to test with");

  // ---- never window.open ------------------------------------------------------
  check((await page.evaluate(() => window.__opens.length)) === 0, `window.open was called: ${await page.evaluate(() => window.__opens.join())}`);
  check(popups.length === 0, `tabs opened by themselves: ${popups.map((p) => p.url())}`);
  check(!asked.some((a) => !a.startsWith("HEAD ") && !/example\.com\/bare/.test(a)), `the web was fetched without a tap: ${asked.filter((a) => !a.startsWith("HEAD "))}`);
  await ctx.close();
  return errors;
}
