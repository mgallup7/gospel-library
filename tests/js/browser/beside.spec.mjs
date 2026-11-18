import fs from "node:fs";
import { readerTool } from "./helpers.mjs";
// beside: a second page next to the reader on an iPad (web/beside.js). Run by tests/js/browser/run.mjs.
// "Open beside" in the passage sheet, two scrollers that do not move each other, the pane's own
// arrows and Back, the reader's marks drawn in it, the divider (snaps, the edge, the saved pair
// across a reload), Swap, close, portrait stacked, and nothing of it on a phone.
// Split in the reader's bar (where the bar has room) and in the rail (always): its one-time line, the picker (a typed reference, words, Recent, a
// walk down the shelves, this chapter in Greek), the pane's menu, the reference card in Search.
// The test scriptures carry no footnotes, so a cross-reference is planted in a verse, as links.spec does.
const HEB = "/study/scriptures/nt/heb/11?lang=eng&id=p1#p1";

export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "beside/";
  fs.mkdirSync(OUT, { recursive: true });
  const check = (cond, msg) => { if (!cond) errors.push(msg); };
  async function boot(viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror (${viewport.width}): ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    const ids = await page.evaluate(async () => ({
      alma: (await GL.api("resolve", { href: "/study/scriptures/bofm/alma/32" })).doc_id,
      heb: (await GL.api("resolve", { href: "/study/scriptures/nt/heb/11" })).doc_id,
    }));
    return { ctx, page, ids };
  }
  const h1 = (page, pane) => page.evaluate((p) => document.querySelector(`${p} .doc h1`)?.textContent || "", pane);
  const waitTitle = (page, pane, re) => page.waitForFunction(([p, s]) => new RegExp(s).test(document.querySelector(`${p} .doc h1`)?.textContent || ""), [pane, re.source], { timeout: 8000 }).then(() => true, () => false);
  const openMain = async (page, id, pid, re) => { await page.evaluate(([id, pid]) => GL.openDoc(id, pid), [id, pid]); await waitTitle(page, "#reader", re); };
  const plant = (page) => page.evaluate((h) => { document.querySelector("#inj")?.remove(); const a = document.createElement("a"); a.id = "inj"; a.setAttribute("href", h); a.textContent = "LINK "; document.querySelector("#reader .doc #p21").prepend(a); document.querySelector("#inj").scrollIntoView({ block: "center" }); }, HEB);
  const layout = (page) => page.evaluate(() => {
    const box = (s) => { const n = document.querySelector(s); if (!n || n.offsetParent === null) return null; const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
    return { open: document.body.classList.contains("beside-open"), list: box("#list"), reader: box("#reader"), beside: box("#beside"), main: box("main"), saved: GL.store.get("beside") };
  });
  const share = (l, axis) => (axis === "w" ? l.reader.w / (l.reader.w + l.beside.w) : l.reader.h / (l.reader.h + l.beside.h));
  const near = (a, b, by = 0.02) => Math.abs(a - b) <= by;
  const grip = (page) => page.evaluate(() => { const r = document.querySelector(".bs-grip").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const shown = (page, sel) => page.evaluate((s) => { const n = document.querySelector(s); return !!n && n.offsetParent !== null; }, sel);
  const pressed = (page) => page.evaluate(() => document.querySelector("#reader .bs-split")?.getAttribute("aria-pressed"));
  const texts = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null).map((n) => n.textContent.trim()), sel);
  // a row of the pane's title menu, by its words
  async function menuRow(page, re) {
    await page.tap("#beside .bs-title");
    await page.waitForSelector("#beside .bs-menu .bs-act", { timeout: 5000 });
    const i = (await texts(page, "#beside .bs-menu .bs-act")).findIndex((t) => re.test(t));
    if (i < 0) return false;
    await page.tap(`#beside .bs-menu .bs-act >> nth=${i}`);
    return true;
  }
  // a finger on the grip, through the browser's own touch input (so touch-action is honored)
  async function drag(page, to, { hold = null } = {}) {
    const cdp = await page.context().newCDPSession(page);
    const from = await grip(page);
    const pt = (x, y) => [{ x: Math.round(x), y: Math.round(y), id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(from.x, from.y) });
    for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8) }); await page.waitForTimeout(20); }
    await page.waitForTimeout(120);
    if (hold) await hold();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(350);
  }

  // ---- the iPad, landscape ---------------------------------------------------
  {
    const { ctx, page, ids } = await boot({ width: 1180, height: 820 });
    await openMain(page, ids.heb, null, /Hebrews 11/);
    await openMain(page, ids.alma, "p21", /Alma 32/);

    // Split in the reader's bar: there to be seen, with its word and, once, a line that says what it is for
    const sb = await page.evaluate(() => { const b = document.querySelector("#reader .reader-bar .bs-split"); if (!b || b.offsetParent === null) return null; const r = b.getBoundingClientRect(), w = b.querySelector(".w"); const aa = document.querySelector("#reader .reader-bar .size-btns, #reader .reader-bar .size-pop"); return { w: r.width, h: r.height, word: w && w.offsetParent !== null ? w.textContent : "", beforeAa: !!aa && !!(b.compareDocumentPosition(aa) & Node.DOCUMENT_POSITION_FOLLOWING) }; });
    check(sb && sb.word === "Split" && sb.w >= 40 && sb.h >= 40 && sb.beforeAa, `the Split button in the reader's bar: ${JSON.stringify(sb)}`);
    check((await pressed(page)) === "false", "Split shows as pressed with no second pane");
    // the same button in the rail, under Ask, whatever the bar has room for
    const rail = await page.evaluate(() => { const b = document.querySelector("#tabs .bs-rail"), ask = document.querySelector("#askBtn"); if (!b || b.offsetParent === null) return null; const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, word: b.querySelector(".tab-lb").textContent, underAsk: r.top >= ask.getBoundingClientRect().bottom, pressed: b.getAttribute("aria-pressed") }; });
    check(rail && rail.word === "Split" && rail.w >= 44 && rail.h >= 44 && rail.underAsk && rail.pressed === "false", `the Split button in the rail: ${JSON.stringify(rail)}`);
    await page.waitForSelector(".bs-coach", { timeout: 5000 }).catch(() => {});
    const line = await page.evaluate(() => { const n = document.querySelector(".bs-coach"), b = document.querySelector("#reader .bs-split"); if (!n || n.hidden) return null; const r = n.getBoundingClientRect(), br = b.getBoundingClientRect(); return { text: n.textContent, under: r.top >= br.bottom && r.top - br.bottom < 30 && r.right > br.left && r.left < br.right }; });
    check(line && line.text === "New: tap Split to read two books side by side" && line.under, `the first-run line under the Split button: ${JSON.stringify(line)}`);
    await page.screenshot({ path: OUT + "00-split-button.png" });
    // Split: the pane opens with the picker in place of a page; the line goes for good
    await page.tap("#reader .bs-split");
    await page.waitForSelector("#beside .bs-pick .bs-q", { timeout: 5000 }).catch(() => check(false, "Split did not open the picker"));
    await page.waitForSelector("#beside .bs-pick .bs-row .go", { timeout: 5000 }).catch(() => check(false, "the picker did not list the shelves"));
    let pl = await layout(page);
    check(pl.open && pl.beside && pl.reader && !pl.list && !(await page.$("#beside .doc")), "Split: the pane with the picker and no page, beside the reader");
    check((await pressed(page)) === "true" && (await page.evaluate(() => document.querySelector("#tabs .bs-rail").getAttribute("aria-pressed"))) === "true", "Split does not show as pressed while the pane is open");
    // the reader's bar, now half as wide, folds as it would without the button and does not overflow
    check((await page.evaluate(() => { const b = document.querySelector("#reader .reader-bar"); return b.scrollWidth - b.clientWidth; })) <= 1, "the reader's bar overflows beside the pane");
    check(!(await page.$(".bs-coach")) && (await page.evaluate(() => GL.store.get("besideCoach"))) === 1, "the first-run line stayed after a tap");
    check(/Alma 32/.test(await h1(page, "#reader")), "Split moved the reader");
    // Recent: the places read, the page in the reader left out
    const rec = await texts(page, "#beside .bs-home .bs-row .t");
    check(rec.includes("Hebrews 11") && !rec.includes("Alma 32") && rec.includes("Scriptures"), `the picker's Recent and shelves read ${JSON.stringify(rec)}`);
    check(!(await page.$("#beside .bs-lang")), "This chapter in Greek is offered for a chapter that is not in the Bible");
    await page.screenshot({ path: OUT + "00b-picker.png" });
    // a reference typed: the card, and the chapter beside at that verse
    await page.fill("#beside .bs-q", "Hebrews 11:3");
    await page.waitForSelector("#beside .bs-found .bs-jump", { timeout: 8000 }).catch(() => check(false, "a typed reference did not give its card"));
    check(/Hebrews 11:3/.test((await texts(page, "#beside .bs-jump")).join("")), "the picker's card does not name the reference");
    await page.tap("#beside .bs-found .bs-jump");
    check(await waitTitle(page, "#beside", /Hebrews 11/), "the reference card did not open Hebrews 11 beside");
    check(await page.evaluate(() => document.querySelector("#beside .doc #p3")?.classList.contains("is-target")), "the typed verse is not marked in the pane");
    check(!(await page.$("#beside .bs-pick")) && /Alma 32/.test(await h1(page, "#reader")), "the picker stayed, or the reader moved, after a choice");
    // Open something else, from the pane's title: the picker over the page, and a way back to it
    check(await menuRow(page, /Open something else/), "the pane's menu has no Open something else");
    await page.waitForSelector("#beside .bs-pick .bs-up", { timeout: 5000 }).catch(() => check(false, "Open something else did not raise the picker"));
    check(/Back to Hebrews 11/.test((await texts(page, "#beside .bs-pick .bs-up")).join("")), "the picker over a page does not offer the way back to it");
    await page.tap("#beside .bs-pick .bs-up");
    check(!(await page.$("#beside .bs-pick")) && /Hebrews 11/.test(await h1(page, "#beside")), "Back in the picker did not return to the page");
    // a walk down the shelves: Scriptures, a book, a chapter, each one tap
    await menuRow(page, /Open something else/);
    await page.waitForSelector("#beside .bs-home .bs-row .go", { timeout: 5000 });
    const si = (await texts(page, "#beside .bs-home .bs-row .t")).indexOf("Scriptures");
    await page.tap(`#beside .bs-home .bs-row >> nth=${si}`);
    await page.waitForSelector("#beside .bs-pick .chip", { timeout: 5000 }).catch(() => check(false, "the Scriptures shelf did not list its books"));
    const ei = (await texts(page, "#beside .bs-pick .chip")).indexOf("Ether");
    await page.tap(`#beside .bs-pick .chip >> nth=${ei}`);
    await page.waitForSelector("#beside .bs-pick .chapters button", { timeout: 5000 }).catch(() => check(false, "a book did not list its chapters"));
    check(/Scriptures/.test((await texts(page, "#beside .bs-pick .bs-up")).join("")), "a book's chapters have no chevron back to the shelf");
    await page.tap("#beside .bs-pick .chapters button >> nth=11");
    check(await waitTitle(page, "#beside", /Ether 12/), "a chapter chosen from the shelves did not open beside");
    check(!!(await page.$("#beside .bs-back")), "a page chosen over another left no Back in the pane");
    await page.screenshot({ path: OUT + "00c-two-books.png" });
    // Split again (the rail's, which is always there): one pane, the list back, nothing saved
    await page.tap("#tabs .bs-rail");
    await page.waitForTimeout(400);
    pl = await layout(page);
    check(!pl.open && !pl.beside && pl.list && pl.reader && pl.saved === null && (await pressed(page)) === "false", "Split with the pane open did not return to one pane");
    // the page that was closed is first in Recent the next time
    await page.tap("#reader .bs-split");
    await page.waitForSelector("#beside .bs-home .bs-row .go", { timeout: 5000 });
    check((await texts(page, "#beside .bs-home .bs-row .t"))[0] === "Ether 12", "the page closed is not first in Recent");
    await page.tap("#beside .bs-close");
    await page.waitForTimeout(400);

    const before = await layout(page);
    check(!before.open && before.list && !before.beside, "before: the list and the reader, no second pane");
    // the way in: a cross-reference, its sheet, Open beside
    await plant(page);
    await page.tap("#inj");
    await page.waitForSelector("#sheet .peek-row .primary", { timeout: 8000 });
    const row = await page.evaluate(() => [...document.querySelectorAll("#sheet .peek-row > *")].filter((n) => n.offsetParent !== null).map((n) => n.textContent.trim()));
    check(row[0] === "Open Hebrews 11" && row[1] === "Open beside", `the passage sheet's row is ${JSON.stringify(row)}`);
    await page.screenshot({ path: OUT + "01-sheet.png" });
    await page.tap("#sheet .peek-row .beside-btn");
    check(await waitTitle(page, "#beside", /Hebrews 11/), "Open beside did not show Hebrews 11 in the second pane");
    await page.waitForSelector("#sheet", { state: "hidden", timeout: 5000 }).catch(() => check(false, "the sheet stayed up after Open beside"));
    await page.waitForTimeout(300);
    let l = await layout(page);
    check(l.open && !l.list && l.reader && l.beside, "split: the list gives way, the reader and the pane show");
    check(l.beside && l.reader && l.beside.x > l.reader.x && near(share(l, "w"), 0.5), `split: the two share the width evenly (${l.reader && l.beside ? share(l, "w").toFixed(3) : "-"})`);
    check(/Alma 32/.test(await h1(page, "#reader")), "the reader kept Alma 32");
    check(await page.evaluate(() => document.querySelector("#beside .doc #p1")?.classList.contains("is-target")), "the verse the link named is marked in the pane");
    check(await page.evaluate(() => document.querySelector("#tabs").getBoundingClientRect().width > 40), "the rail stays");
    check(l.saved && l.saved.id === ids.heb && l.saved.ratio === 0.5, `the pair is saved (${JSON.stringify(l.saved)})`);
    await page.screenshot({ path: OUT + "02-split.png" });

    // two scrollers, each its own
    const tops = () => page.evaluate(() => [document.querySelector("#reader").scrollTop, document.querySelector("#beside .bs-scroll").scrollTop]);
    await page.evaluate(() => { document.querySelector("#reader").scrollTop = 0; document.querySelector("#beside .bs-scroll").scrollTop = 0; });
    await page.evaluate(() => { document.querySelector("#beside .bs-scroll").scrollTop = 400; });
    await page.waitForTimeout(200);
    let t = await tops();
    check(t[0] === 0 && t[1] === 400, `scrolling the pane moved the reader (${t})`);
    await page.evaluate(() => { document.querySelector("#reader").scrollTop = 300; });
    await page.waitForTimeout(200);
    t = await tops();
    check(t[0] === 300 && t[1] === 400, `scrolling the reader moved the pane (${t})`);

    // its own arrows and its own Back; the reader and the address are left alone
    const hash = await page.evaluate(() => location.hash);
    const entries = await page.evaluate(() => history.length);
    check(!(await page.$("#beside .bs-back")), "the pane has no Back before it has moved");
    await page.tap("#beside .bs-chap >> nth=1");
    check(await waitTitle(page, "#beside", /Hebrews 12/), "next in the pane did not open Hebrews 12");
    check(/Alma 32/.test(await h1(page, "#reader")) && (await page.evaluate(() => location.hash)) === hash && (await page.evaluate(() => history.length)) === entries, "next in the pane moved the reader, the address or the history");
    check((await tops())[0] === 300, "next in the pane scrolled the reader");
    check(!!(await page.$("#beside .bs-back")), "the pane's Back did not appear after it moved");
    await page.tap("#beside .bs-back");
    check(await waitTitle(page, "#beside", /Hebrews 11/), "the pane's Back did not return to Hebrews 11");
    check(!(await page.$("#beside .bs-back")), "the pane's Back stayed with nowhere to go");
    // the chapters under the title
    await page.tap("#beside .bs-title");
    await page.waitForSelector("#beside .bs-menu .chapters button", { timeout: 5000 });
    await page.tap("#beside .bs-menu .chapters button >> nth=2");
    check(await waitTitle(page, "#beside", /Hebrews 3/), "a chapter chosen under the title did not open in the pane");
    check(/Alma 32/.test(await h1(page, "#reader")), "a chapter chosen in the pane moved the reader");
    // a link in the pane opens in the pane
    await page.evaluate(() => { const a = document.createElement("a"); a.id = "inj2"; a.setAttribute("href", "/study/scriptures/bofm/alma/32?lang=eng&id=p5#p5"); a.textContent = "LINK "; document.querySelector("#beside .doc .verse").prepend(a); });
    await page.tap("#inj2");
    check(await waitTitle(page, "#beside", /Alma 32/), "a link in the pane did not open in the pane");
    check(await page.evaluate(() => document.querySelector("#sheet").hidden), "a link in the pane raised the reader's sheet");
    // an outside link leaves the usual way: the app's toast
    await page.evaluate(() => { const a = document.createElement("a"); a.id = "inj3"; a.setAttribute("href", "https://example.com/elsewhere"); a.textContent = "OUT "; document.querySelector("#beside .doc .verse").prepend(a); });
    await page.tap("#inj3");
    await page.waitForSelector("#toast.show", { timeout: 5000 }).catch(() => {});
    check(/leaves the library/.test(await page.textContent("#toast").catch(() => "")), "an outside link in the pane did not get the app's toast");
    await page.evaluate(() => document.querySelector("#inj3")?.remove());

    // the same chapter on both sides: a highlight made in the reader shows in the pane
    await page.evaluate(() => { document.querySelector("#reader .doc #p5").scrollIntoView({ block: "center" }); });
    await page.tap("#reader .doc #p5");
    await page.waitForSelector("#reader .select-bar .hl-dot.hl-g", { timeout: 5000 });
    await page.tap("#reader .select-bar .hl-dot.hl-g");
    const drawn = await page.waitForFunction(() => document.querySelector("#beside .doc #p5")?.classList.contains("hl-g"), null, { timeout: 5000 }).then(() => true, () => false);
    check(drawn, "a highlight made in the reader did not appear in the pane");
    // a verse tapped in the pane is not selected; the hint says why, once
    await page.evaluate(() => { document.querySelector("#beside .doc #p5").scrollIntoView({ block: "center" }); });
    await page.tap("#beside .doc #p5");
    await page.waitForTimeout(200);
    check((await page.evaluate(() => document.querySelectorAll("#beside .sel").length)) === 0 && !(await page.$("#beside .select-bar")), "a verse was selected in the pane");
    check(await page.evaluate(() => { const h = document.querySelector("#beside .bs-hint"); return !h.hidden && h.textContent === "Reading copy. Swap to mark this side."; }), "the hint did not show on the first verse tapped in the pane");
    await page.screenshot({ path: OUT + "03-same-chapter.png" });

    // the divider: held, the stops are named; let go, it snaps; the pair comes back after a reload
    l = await layout(page);
    const g = await grip(page);
    check((await page.evaluate(() => getComputedStyle(document.querySelector(".bs-grab")).touchAction)) === "none" && (await page.evaluate(() => getComputedStyle(document.querySelector("#beside .bs-scroll")).touchAction)) !== "none", "touch-action: none belongs to the divider alone");
    let named = null;
    await drag(page, { x: l.main.x + l.main.w * 0.63, y: g.y }, { hold: async () => { named = await page.evaluate(() => [...document.querySelectorAll(".bs-track:not([hidden]) .bs-stop b")].map((b) => b.textContent + (b.parentElement.classList.contains("at") ? "*" : ""))); await page.screenshot({ path: OUT + "04-drag.png" }); } });
    check(named && named.join("|") === "One third|Half|Two thirds*|Close Alma 32", `while dragging the stops read ${JSON.stringify(named)}`);
    l = await layout(page);
    check(near(share(l, "w"), 2 / 3) && near(l.saved.ratio, 2 / 3, 0.001), `the divider did not snap to two thirds (${share(l, "w").toFixed(3)}, saved ${l.saved.ratio})`);
    check(await page.evaluate(() => !document.querySelector(".bs-track") || document.querySelector(".bs-track").hidden), "the stops stayed after the divider was let go");
    await page.evaluate(() => { document.querySelector("#beside .bs-scroll").scrollTop = 500; });
    await page.waitForTimeout(500);
    const kept = (await layout(page)).saved;
    await page.reload();
    await page.waitForSelector("#beside .doc h1", { timeout: 60000 }).catch(() => check(false, "the pair did not come back after a reload"));
    await page.waitForTimeout(600);
    l = await layout(page);
    check(l.open && l.beside && near(share(l, "w"), 2 / 3) && /Alma 32/.test(await h1(page, "#beside")), "after a reload: the same page beside, at two thirds");
    const back = await page.evaluate(() => { const sc = document.querySelector("#beside .bs-scroll"); for (const u of sc.querySelectorAll("p.verse")) { const r = u.getBoundingClientRect(); if (r.bottom > sc.getBoundingClientRect().top + 1) return u.id; } return null; });
    check(kept.pid && back === kept.pid, `after a reload the pane is at ${back}, it was at ${kept.pid}`);
    check(/Alma 32/.test(await h1(page, "#reader")), "after a reload the reader lost its page");
    // two taps on the grip even the panes out
    const g2 = await grip(page);
    await page.touchscreen.tap(g2.x, g2.y); await page.waitForTimeout(90); await page.touchscreen.tap(g2.x, g2.y);
    await page.waitForTimeout(350);
    l = await layout(page);
    check(near(share(l, "w"), 0.5) && l.saved.ratio === 0.5, `a double tap did not even the panes (${share(l, "w").toFixed(3)})`);
    // toward the reader's edge nothing closes: the reader keeps a third
    await drag(page, { x: l.main.x + 30, y: g2.y });
    l = await layout(page);
    check(l.open && l.reader && near(share(l, "w"), 1 / 3), "the divider run to the reader's edge should stop at one third and close nothing");

    // Swap: the pane's page to the reader by the app's own open, the reader's page to the pane
    await page.evaluate((id) => Beside.open(id, "p1"), ids.heb);
    await waitTitle(page, "#beside", /Hebrews 11/);
    await page.tap("#beside .bs-swap");
    check((await waitTitle(page, "#reader", /Hebrews 11/)) && (await waitTitle(page, "#beside", /Alma 32/)), `Swap: the reader has ${await h1(page, "#reader")}, the pane ${await h1(page, "#beside")}`);
    check((await page.evaluate(() => GL.reading.doc.id)) === ids.heb && (await layout(page)).saved.id === ids.alma, "Swap: the app and the saved pair do not agree with the screen");
    // Back acts on the reader, as ever; the pane stays
    await page.goBack();
    check(await waitTitle(page, "#reader", /Alma 32/), "Back after Swap did not return the reader to Alma 32");
    check((await layout(page)).open, "Back closed the pane");

    // Present fills the window and returns to the pair; Settings opens over it
    await readerTool(page, "Present", '#reader .reader-bar [aria-label="Present"]');
    await page.waitForSelector("#stage:not([hidden])", { timeout: 5000 }).catch(() => check(false, "Present did not start with the pane open"));
    check(await page.evaluate(() => { const r = document.querySelector("#stage").getBoundingClientRect(); return r.width === innerWidth && r.height === innerHeight; }), "the stage does not fill the window over the pair");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#stage", { state: "hidden", timeout: 5000 }).catch(() => check(false, "the stage did not close"));
    await page.waitForTimeout(300);
    l = await layout(page);
    check(l.open && l.beside && l.reader, "after Present the pair is not back");
    await page.tap("#settingsBtn");
    await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 }).catch(() => check(false, "Settings did not open with the pane open"));
    await page.keyboard.press("Escape");
    await page.waitForSelector("#sheet", { state: "hidden", timeout: 5000 }).catch(() => {});
    check((await layout(page)).open, "Settings closed the pane");

    // X: one pane again, the list's column back, the pair forgotten
    await page.tap("#beside .bs-close");
    await page.waitForTimeout(400);
    l = await layout(page);
    check(!l.open && !l.beside && l.list && l.reader && l.saved === null, "X did not return to one pane with the list back and nothing saved");
    check(near(l.list.w, before.list.w, 1.5) && near(l.reader.w, before.reader.w, 1.5) && near(l.reader.x, before.reader.x, 1.5), "after X the list and the reader are not where they were");
    await page.screenshot({ path: OUT + "05-closed.png" });

    // the divider run to the pane's own edge closes it, and the toast offers it back
    await page.evaluate((id) => Beside.open(id, "p1"), ids.heb);
    await waitTitle(page, "#beside", /Hebrews 11/);
    await page.waitForTimeout(300);
    l = await layout(page);
    const g3 = await grip(page);
    await drag(page, { x: l.main.x + l.main.w - 30, y: g3.y });
    l = await layout(page);
    check(!l.open && l.reader && l.list && l.saved === null, "the divider run to the edge did not close the pane");
    check(/Hebrews 11 closed/.test(await page.textContent("#toast").catch(() => "")), "closing by the edge did not offer the pane back");
    await page.tap("#toast .toast-action");
    check(await waitTitle(page, "#beside", /Hebrews 11/), "Open beside again did not bring the pane back");
    // The rail. Search puts the list where the page was, so the pane simply stays beside it;
    // the Deck keeps a pane of its own up and asks for the list as well, so the pane gives way to it.
    await page.tap("#searchTab");
    await page.waitForTimeout(500);
    l = await layout(page);
    check(l.open && l.list && l.beside && !l.reader && l.beside.x > l.list.x, "Search with the pane open: the list should take the reader's place beside it");
    await page.screenshot({ path: OUT + "05b-search-beside.png" });
    await openMain(page, ids.alma, "p21", /Alma 32/);
    await page.waitForTimeout(300);
    l = await layout(page);
    check(l.open && l.reader && !l.list, "a page opened from Search did not return to the pair");
    await page.tap("#deckBtn");
    await page.waitForTimeout(700);
    l = await layout(page);
    check(!l.open && !l.beside && l.saved === null, "the Deck tab did not close the pane");
    // Search: the reference card has Open beside under it
    await page.tap("#searchTab");
    await page.fill("#q", "Hebrews 11:1");
    await page.waitForSelector("#list .jump + .bs-jump-beside", { timeout: 8000 }).catch(() => check(false, "the reference card in Search has no Open beside"));
    await page.tap("#list .bs-jump-beside");
    check(await waitTitle(page, "#beside", /Hebrews 11/), "Open beside under the reference card did not open the pane");
    check(await page.evaluate(() => document.querySelector("#beside .doc #p1")?.classList.contains("is-target")), "the card's verse is not marked in the pane");
    await ctx.close();
  }

  // ---- the iPad, portrait: one over the other ----------------------------------
  {
    const { ctx, page, ids } = await boot({ width: 820, height: 1180 });
    // Split, portrait: this chapter in Greek under the English one, words typed, the pane's page to the reader
    await openMain(page, ids.heb, null, /Hebrews 11/);
    check(await shown(page, "#tabs .bs-rail"), "portrait: no Split button in the rail");
    await page.tap("#tabs .bs-rail");
    await page.waitForSelector("#beside .bs-lang", { timeout: 8000 }).catch(() => check(false, "portrait: the picker does not offer this chapter in Greek"));
    check(/This chapter in Greek/.test((await texts(page, "#beside .bs-lang")).join("")), "portrait: the Greek row is misnamed");
    let pl = await layout(page);
    check(pl.open && pl.beside && pl.reader && pl.beside.y > pl.reader.y, "portrait: the picker's pane is not under the reader");
    await page.tap("#beside .bs-lang");
    check(await waitTitle(page, "#beside", /Hebrews 11/), "portrait: this chapter in Greek did not open the chapter beside");
    await page.waitForSelector("#beside .doc .orig", { timeout: 8000 }).catch(() => check(false, "portrait: the Greek tiles did not show in the pane"));
    check((await page.evaluate(() => document.querySelectorAll("#reader .doc .orig").length)) === 0 && (await page.evaluate(() => GL.store.get("orig"))) !== true, "the pane's Greek turned the reader's on");
    await page.screenshot({ path: OUT + "06a-greek-beside.png" });
    check(await menuRow(page, /Hide the Greek here/), "the pane's menu has no switch for the Greek");
    await page.waitForFunction(() => !document.querySelector("#beside .doc .orig"), null, { timeout: 5000 }).catch(() => check(false, "Hide the Greek here left the tiles"));
    // words: the first few passages, one of them opened beside
    await menuRow(page, /Open something else/);
    await page.fill("#beside .bs-q", "faith hope charity");
    await page.waitForSelector("#beside .bs-found .bs-hit", { timeout: 8000 }).catch(() => check(false, "words typed in the picker found no passages"));
    const nHits = await page.evaluate(() => document.querySelectorAll("#beside .bs-found .bs-hit").length);
    check(nHits >= 1 && nHits <= 5, `the picker shows ${nHits} passages for words`);
    const cite = (await texts(page, "#beside .bs-found .bs-hit .cite"))[0] || "";
    await page.tap("#beside .bs-found .bs-hit >> nth=0");
    const chap = cite.replace(/:\d+.*$/, "");
    check(await waitTitle(page, "#beside", new RegExp(chap.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))), `a passage chosen (${cite}) did not open beside`);
    // Open in the main page: the reader takes the pane's page, the pane stays
    check(await menuRow(page, /Open in the main page/), "the pane's menu has no Open in the main page");
    check(await waitTitle(page, "#reader", new RegExp(chap.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))), "Open in the main page did not bring the page to the reader");
    check((await layout(page)).open, "Open in the main page closed the pane");
    await page.tap("#tabs .bs-rail");
    await page.waitForTimeout(400);
    pl = await layout(page);
    check(!pl.open && pl.saved === null, "portrait: Split did not close the pane");

    await openMain(page, ids.alma, "p21", /Alma 32/);
    await plant(page);
    await page.tap("#inj");
    await page.waitForSelector("#sheet .peek-row .beside-btn", { timeout: 8000 }).catch(() => check(false, "portrait: no Open beside in the sheet"));
    await page.tap("#sheet .peek-row .beside-btn");
    check(await waitTitle(page, "#beside", /Hebrews 11/), "portrait: Open beside did not open the pane");
    await page.waitForTimeout(400);
    let l = await layout(page);
    check(l.open && !l.list && l.beside.y > l.reader.y && near(l.beside.w, l.reader.w, 1.5) && near(share(l, "h"), 0.5), "portrait: the panes are not stacked evenly, full width");
    await page.screenshot({ path: OUT + "06-portrait.png" });
    const g = await grip(page);
    await drag(page, { x: g.x, y: l.main.y + l.main.h * 0.36 });
    l = await layout(page);
    check(near(share(l, "h"), 1 / 3) && near(l.saved.ratio, 1 / 3, 0.001), `portrait: the divider did not snap to one third (${share(l, "h").toFixed(3)})`);
    await page.reload();
    await page.waitForSelector("#beside .doc h1", { timeout: 60000 }).catch(() => check(false, "portrait: the pair did not come back after a reload"));
    await page.waitForTimeout(600);
    l = await layout(page);
    check(l.open && l.beside && near(share(l, "h"), 1 / 3), "portrait: the ratio did not persist");
    const g2 = await grip(page);
    await drag(page, { x: g2.x, y: l.main.y + l.main.h - 30 });
    l = await layout(page);
    check(!l.open && l.saved === null && l.list && l.reader, "portrait: the divider run to the bottom did not close the pane");
    await ctx.close();
  }

  // ---- the phone: nothing of it --------------------------------------------------
  {
    const { ctx, page, ids } = await boot({ width: 393, height: 852 });
    await openMain(page, ids.alma, "p21", /Alma 32/);
    await plant(page);
    await page.tap("#inj");
    await page.waitForSelector("#sheet .peek-row .primary", { timeout: 8000 });
    check(!(await page.$("#sheet .beside-btn")), "the phone's passage sheet offers Open beside");
    check((await page.evaluate((id) => Beside.open(id, "p1"), ids.heb)) === false, "Beside.open should refuse on a phone");
    check(!(await shown(page, ".bs-split")) && !(await shown(page, ".bs-split-wrap")) && !(await shown(page, ".bs-rail")) && !(await page.$(".bs-coach")), "the phone shows the Split button or its line");
    check((await page.evaluate(() => Beside.pick())) === false && (await page.evaluate((id) => Beside.jumpButton({ doc_id: id, label: "Hebrews 11" }), ids.heb)) === null, "the picker or the card's Open beside is offered on a phone");
    await page.waitForTimeout(300);
    check(!(await page.$("#beside")) && !(await page.evaluate(() => document.body.classList.contains("beside-open"))), "something of the second pane shows on the phone");
    // a pair saved on this device at iPad size does not show at phone size either
    await page.keyboard.press("Escape");
    await page.evaluate((id) => GL.store.set("beside", { id, pid: "p1", off: 0, ratio: 0.5, title: "Hebrews 11" }), ids.heb);
    await page.reload();
    await page.waitForSelector("#reader .doc h1", { timeout: 60000 });
    await page.waitForTimeout(800);
    check(!(await page.$("#beside")) && !(await page.evaluate(() => document.body.classList.contains("beside-open"))), "a saved pair opened a pane on the phone");
    await page.screenshot({ path: OUT + "07-phone.png" });
    await ctx.close();
  }
  return errors;
}
