import fs from "node:fs";
import { readerTool } from "./helpers.mjs";
// beside: a second page next to the reader on an iPad (web/beside.js). Run by tests/js/browser/run.mjs.
// "Open beside" in the passage sheet, two scrollers that do not move each other, the pane's own
// arrows and Back, the reader's marks drawn in it, the divider (snaps, the edge, the saved pair
// across a reload), Swap, close, portrait stacked, and nothing of it on a phone.
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
    await openMain(page, ids.alma, "p21", /Alma 32/);
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
    await ctx.close();
  }

  // ---- the iPad, portrait: one over the other ----------------------------------
  {
    const { ctx, page, ids } = await boot({ width: 820, height: 1180 });
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
