import fs from "node:fs";
// studies-and-links: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "studies/";
  fs.mkdirSync(OUT, { recursive: true });
  const ATTACH = OUT + "links.html"; // any HTML page serves; the links page stands in for a real study
  // a small page with every link shape the Church site uses
  const LINKS = `<!doctype html><html><head><meta charset="utf-8"><title>Link shapes</title></head><body>
  <h1>Link shapes</h1>
  <p><a id="l1" href="https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?lang=eng&amp;id=p21#p21">Alma 32:21 (id param)</a></p>
  <p><a id="l2" href="/study/scriptures/bofm/alma/32.21-27?lang=eng">Alma 32:21-27 (dotted)</a></p>
  <p><a id="l3" href="https://www.churchofjesuschrist.org/study/scriptures/bofm/alma?lang=eng">Alma (the book)</a></p>
  <p><a id="l4" href="https://www.churchofjesuschrist.org/study/scriptures/nt/1-thes/4?lang=eng">1 Thessalonians 4 (chapter)</a></p>
  <p><a id="l5" href="https://www.lds.org/scriptures/ot/mal/3.1?lang=eng#0">Malachi 3:1 (old site)</a></p>
  <p><a id="l6" href="https://www.churchofjesuschrist.org/study/manual/preach-my-gospel-2023?lang=eng">Preach My Gospel (not in this test library)</a></p>
  <p><a id="l7" href="https://example.com/elsewhere">Elsewhere on the web</a></p>
  <p><a id="l8" href="#l1">Within the page</a></p>
  </body></html>`;
  fs.writeFileSync(OUT + "links.html", LINKS);

  let popups = [];
  async function session(name, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e} :: ${String(e.stack || "").split("\n").slice(0, 3).join(" | ")} :: at ${page.url()} step=${step}`));
    let step = "start";
    page.on("framenavigated", (f) => { if (f !== page.mainFrame()) console.log(name, "frame navigated to", f.url().slice(0, 80), "step", step); });
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text()}`); });
    ctx.on("page", (p) => popups.push(p.url()));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForTimeout(600);
    const shot = (label) => page.screenshot({ path: `${OUT}${name}-${label}.png` });
    const check = (cond, msg) => { if (!cond) errors.push(`${name}: ${msg}`); };

    // the tile and the empty shelf
    const tile = page.locator("#homeBody .shelf-tile:has-text('My studies')");
    check(await tile.count() === 1, "My studies tile missing");
    await tile.click();
    await page.waitForSelector(".studies-add .primary");
    await shot("01-empty");
    // add the link-shapes page
    await page.setInputFiles("#homeBody input[type=file]", OUT + "links.html");
    await page.waitForSelector("#reader .study-frame", { timeout: 20000 });
    await page.waitForTimeout(800);
    await shot("02-links-page");
    check(location(await page.evaluate(() => location.hash)).startsWith("#studies?s="), `hash after open: ${await page.evaluate(() => location.hash)}`);
    const frame = page.frameLocator("#reader .study-frame");
    check((await frame.locator("h1").textContent()) === "Link shapes", "frame did not render");

    // l1: a verse with id -> the sheet shows Alma 32:21
    await frame.locator("#l1").click();
    await page.waitForSelector("#sheet:not([hidden]) .peek p", { timeout: 8000 });
    let nm = await page.textContent("#sheet .nm");
    check(/Alma 32:21/.test(nm), `l1 sheet says ${nm}`);
    check((await page.locator("#sheet .peek p").count()) === 1, "l1 should show one verse");
    await shot("03-peek-verse");
    // Open goes to the chapter, and Back returns to the study
    await page.click("#sheet .peek-row .primary");
    await page.waitForSelector("#reader .doc", { timeout: 8000 });
    await page.waitForTimeout(400);
    check(/Alma 32/.test(await page.textContent("#reader .reader-bar .crumb") + " " + await page.textContent("#reader")), "chapter did not open");
    const back = await page.textContent("#reader .trail-back .lb");
    check(back === "Link shapes", `back label after open: ${back}`);
    await shot("04-chapter-from-peek");
    await page.click("#reader .trail-back");
    await page.waitForSelector("#reader .study-frame", { timeout: 8000 });
    await page.waitForTimeout(600);
    check(!!(await page.$("#reader .study-frame")), "Back did not return to the study");

    // l2: dotted range -> the sheet with 7 verses
    await page.frameLocator("#reader .study-frame").locator("#l2").click();
    await page.waitForSelector("#sheet:not([hidden]) .peek p", { timeout: 8000 });
    await page.waitForTimeout(300);
    nm = await page.textContent("#sheet .nm");
    const n = await page.locator("#sheet .peek p").count();
    check(/Alma 32:21/.test(nm) && n === 7, `l2 sheet: ${nm}, ${n} verses`);
    await shot("05-peek-range");
    await page.click("#sheet .close");
    await page.waitForTimeout(200);

    // l3: the book -> the chapter grid of Alma
    await page.frameLocator("#reader .study-frame").locator("#l3").click();
    await page.waitForSelector("#homeBody .chapters", { timeout: 8000 });
    await page.waitForTimeout(300);
    check(/Alma/.test(await page.textContent("#homeBody .crumbs")), "l3 did not open the book");
    await shot("06-book");
    await page.goBack();
    await page.waitForSelector("#reader .study-frame", { timeout: 8000 });
    await page.waitForTimeout(500);

    // l4: a whole chapter -> opens in the reader (no sheet)
    await page.frameLocator("#reader .study-frame").locator("#l4").click();
    await page.waitForSelector("#reader .doc", { timeout: 8000 });
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.querySelector("#sheet").hidden), "l4 should open, not peek");
    check(/Thessalonians/.test(await page.textContent("#reader")), "l4 did not open 1 Thes 4");
    await page.goBack();
    await page.waitForSelector("#reader .study-frame", { timeout: 8000 });
    await page.waitForTimeout(500);

    // l5: lds.org with #0 -> Malachi 3:1
    await page.frameLocator("#reader .study-frame").locator("#l5").click();
    await page.waitForSelector("#sheet:not([hidden]) .peek p", { timeout: 8000 });
    nm = await page.textContent("#sheet .nm");
    check(/Malachi 3:1\b/.test(nm), `l5 sheet says ${nm}`);
    await page.click("#sheet .close");

    // l6 and l7: not in the library -> a toast that says so, with a real link to the web
    // (nothing opens by itself: the tap inside the frame is not a gesture the app can spend)
    step = "l6"; popups = [];
    await page.frameLocator("#reader .study-frame").locator("#l6").click();
    await page.waitForSelector("#toast.show a.toast-action", { timeout: 5000 });
    let out = await page.evaluate(() => { const a = document.querySelector("#toast a.toast-action"); return { href: a.href, target: a.target, rel: a.rel, text: document.querySelector("#toast").textContent }; });
    check(out.href === "https://www.churchofjesuschrist.org/study/manual/preach-my-gospel-2023?lang=eng" && out.target === "_blank" && out.rel === "noopener", `l6 toast link: ${JSON.stringify(out)}`);
    check(/Not in your library/.test(out.text) && /churchofjesuschrist\.org/.test(out.text), `l6 toast says: ${out.text}`);
    check(popups.length === 0, `l6 popups: ${popups}`);
    await page.frameLocator("#reader .study-frame").locator("#l7").click();
    await page.waitForFunction(() => document.querySelector("#toast.show a.toast-action")?.href === "https://example.com/elsewhere", null, { timeout: 5000 }).catch(() => check(false, "l7 toast link missing"));
    out = await page.evaluate(() => document.querySelector("#toast").textContent);
    check(/example\.com/.test(out), `l7 toast says: ${out}`);
    check(popups.length === 0, `l7 popups: ${popups}`);
    // l8 stays inside the page and scrolls to its target
    popups = [];
    const fr0 = page.frames().find((f) => /study-frame\.html/.test(f.url()));
    await fr0.evaluate(() => { document.body.style.paddingTop = "3000px"; window.scrollTo(0, 2500); });
    await page.frameLocator("#reader .study-frame").locator("#l8").click();
    await page.waitForTimeout(400);
    const y = await fr0.evaluate(() => window.scrollY);
    check(!popups.length && await page.evaluate(() => document.querySelector("#sheet").hidden) && y > 2600, `l8 should scroll within the page (y=${y})`);

    // the real page
    step = "real"; await page.click("#reader .trail-back");
    await page.waitForTimeout(800);
    await shot("06b-after-back");
    console.log(name, "after back:", await page.evaluate(() => ({ hash: location.hash, list: document.querySelector("#list").hidden, reader: document.querySelector("#reader").hidden, home: !!document.querySelector("#homeBody"), add: !!document.querySelector(".studies-add .primary"), body: document.body.className })));
    await page.waitForSelector(".studies-add .primary", { timeout: 8000 });
    await page.setInputFiles("#homeBody input[type=file]", ATTACH);
    await page.waitForSelector("#reader .study-frame", { timeout: 20000 });
    await page.waitForTimeout(1500);
    await shot("07-second-coming");
    const title = await page.textContent("#reader .trail-back .lb").catch(() => "");
    const fr = page.frameLocator("#reader .study-frame");
    const h = await fr.locator("h1").first().textContent().catch(() => "");
    check(/Link shapes/.test(h), `second page h1: ${h}`);
    // a scripture link inside it
    await fr.locator("#l5").click();
    await page.waitForSelector("#sheet:not([hidden]) .peek p", { timeout: 8000 });
    nm = await page.textContent("#sheet .nm");
    check(/Malachi 3:1\b/.test(nm), `second page link sheet: ${nm}`);
    await page.click("#sheet .close");
    // reload keeps the place
    step = "reload"; await page.reload();
    await page.waitForSelector("#reader .study-frame", { timeout: 30000 });
    await page.waitForTimeout(800);
    check(!!(await page.$("#reader .study-frame")), "reload lost the study");
    // the shelf lists both; home tile says 2
    await page.click("#homeBtn");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 8000 });
    await page.waitForTimeout(300);
    const sub = await page.textContent("#homeBody .shelf-tile:has-text('My studies') .st-s");
    check(/2/.test(sub), `tile says: ${sub}`);
    await shot("09-home");
    await page.click("#homeBody .shelf-tile:has-text('My studies')");
    await page.waitForSelector("#homeBody .study-row", { timeout: 8000 });
    check((await page.locator("#homeBody .study-row").count()) === 2, "shelf should list two pages");
    await shot("10-shelf");
    // remove the small one
    page.once("dialog", (d) => d.accept());
    await page.click("#homeBody .study-row >> nth=1 >> .study-remove");
    await page.waitForTimeout(600);
    check((await page.locator("#homeBody .study-row").count()) === 1, "remove should leave one page");
    // think it through from a study: the Ask tab opens with the page as subject
    await page.click("#homeBody .study-row >> nth=0 >> .study-open");
    await page.waitForSelector("#reader .study-frame", { timeout: 8000 });
    await page.waitForTimeout(500);
    check(await page.evaluate(() => { const b = document.querySelector("#reader .reader-bar .think-btn"); return !!b && b.offsetParent !== null; }), "think button should show in a study's bar");
    await ctx.close();
  }
  function location(h) { return h || ""; }

  // Markdown and text studies in the library's flow: plain references become links (not in code),
  // #anchors and heading ids work, a .txt links its addresses, an empty file is refused, a search
  // finds a study's words and opens it at the nearest heading, and a chapter a study links to says so.
  const filler = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the notes, kept here so the page is long enough to scroll.`).join("\n\n");
  fs.writeFileSync(OUT + "faith-notes.md", `# Faith notes\n\n## The seed\nAlma compares the word to a seed in Alma 32:28, and see [the harvest](#the-harvest).\n\n\`\`\`\nAlma 32:21 inside a code block\n\`\`\`\n\n${filler}\n\n## The harvest\nNourish the tree with patience, Alma 32:41-43.\n\n${filler}\n`);
  fs.writeFileSync(OUT + "plain-notes.txt", "Plain notes\n\nRead Moroni 10:4 tonight.\nThe chapter: https://www.churchofjesuschrist.org/study/scriptures/bofm/moro/10?lang=eng\n");
  fs.writeFileSync(OUT + "empty.txt", "  \n");
  async function notes(name, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const check = (cond, msg) => { if (!cond) errors.push(`${name} notes: ${msg}`); };
    page.on("pageerror", (e) => errors.push(`${name} notes: ${e}`));
    const shot = (label) => page.screenshot({ path: `${OUT}${name}-notes-${label}.png` });
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.click("#homeBody .shelf-tile:has-text('My studies')");
    await page.waitForSelector(".studies-add .primary");
    // an empty file is refused, with a word why
    await page.setInputFiles("#homeBody input[type=file]", OUT + "empty.txt");
    await page.waitForSelector(".toast", { timeout: 5000 });
    check(/empty/.test(await page.textContent(".toast")), `empty file toast: ${await page.textContent(".toast")}`);
    check(await page.evaluate(async () => (await window.Studies.list()).length) === 0, "the empty file was kept");
    // the Markdown study
    await page.setInputFiles("#homeBody input[type=file]", OUT + "faith-notes.md");
    await page.waitForSelector("#reader .study-frame", { timeout: 20000 });
    await page.waitForTimeout(800);
    const fr = page.frameLocator("#reader .study-frame");
    check(await fr.locator("h2#the-seed").count() === 1 && await fr.locator("h2#the-harvest").count() === 1, "headings have no ids");
    check(await fr.locator("a", { hasText: /^Alma 32:28$/ }).count() === 1, "Alma 32:28 is not a link");
    check(await fr.locator("a", { hasText: /^Alma 32:41-43$/ }).count() === 1, "Alma 32:41-43 is not a link");
    check(await fr.locator("pre a").count() === 0, "a reference inside a code block was linked");
    check(await fr.locator('a[href="#the-harvest"]').count() === 1, "the #anchor link was dropped");
    await shot("01-markdown");
    await fr.locator("a", { hasText: /^Alma 32:28$/ }).click();
    await page.waitForSelector("#sheet:not([hidden]) .peek p", { timeout: 8000 });
    check(/Alma 32:28/.test(await page.textContent("#sheet .nm")), `reference opened ${await page.textContent("#sheet .nm")}`);
    await shot("02-reference-peek");
    await page.click("#sheet .close");
    const frame = page.frames().find((f) => /study-frame\.html/.test(f.url()));
    await fr.locator('a[href="#the-harvest"]').click();
    await page.waitForTimeout(400);
    check(await frame.evaluate(() => window.scrollY) > 400, "the #anchor did not scroll");
    // the text study: its address and its reference are links, its lines kept
    await page.click("#homeBtn");
    await page.waitForSelector("#homeBody .shelf-grid");
    await page.click("#homeBody .shelf-tile:has-text('My studies')");
    await page.waitForSelector(".studies-add .primary");
    await page.setInputFiles("#homeBody input[type=file]", OUT + "plain-notes.txt");
    await page.waitForSelector("#reader .study-frame", { timeout: 20000 });
    await page.waitForTimeout(800);
    const tf = page.frameLocator("#reader .study-frame");
    check(await tf.locator("pre.plain a").count() === 2, `text study links: ${await tf.locator("pre.plain a").count()}`);
    await shot("03-text");
    // a search finds the study's words and opens it at the nearest heading
    await box(page, "nourish patience"); await page.press("#q", "Enter");
    await page.waitForSelector("#list .studies-hits .study-hit", { timeout: 8000 });
    const where = await page.textContent("#list .studies-hits .study-hit .where");
    check(/The harvest/.test(where), `study hit says ${where}`);
    check(/<b>Nourish<\/b>/i.test(await page.innerHTML("#list .studies-hits .study-hit .snip")), "the words are not marked in the snippet");
    await shot("04-search");
    await page.click("#list .studies-hits .study-hit");
    await page.waitForSelector("#reader .study-frame", { timeout: 8000 });
    await page.waitForTimeout(1200);
    const f2 = page.frames().find((f) => /study-frame\.html/.test(f.url()));
    const top = await f2.evaluate(() => document.getElementById("the-harvest").getBoundingClientRect().top);
    check(Math.abs(top) < 60, `the study did not open at The harvest (top ${top})`);
    await shot("05-opened-at-heading");
    // the chapter the study links to says so under its title
    await box(page, "Alma 32"); await page.press("#q", "Enter");
    await page.waitForTimeout(700);
    const jump = await page.$("#list .jump"); if (jump && await jump.isVisible()) await jump.click();
    await page.waitForSelector("#reader .doc .in-studies", { timeout: 10000 });
    check(/In your studies: Faith notes/.test(await page.textContent("#reader .doc .in-studies")), `chapter line: ${await page.textContent("#reader .doc .in-studies")}`);
    await shot("06-chapter-line");
    await page.click("#reader .doc .in-studies button");
    await page.waitForSelector("#reader .study-frame", { timeout: 8000 });
    await ctx.close();
  }

  for (const [name, vp] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    try { await session(name, vp); } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); }
    try { await notes(name, vp); } catch (e) { errors.push(`${name} notes aborted: ${e.message.split("\n")[0]}`); }
  }
  return errors;
}
