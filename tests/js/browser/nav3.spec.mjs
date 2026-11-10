// nav3: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
// Flows the second panel found broken, and the reader bar that came of it:
//   1. with an API key saved the concordance still shows; Back after "All verses with this word"
//      and after a reload under a sheet leaves in one step; Back on a phone keeps the scroll; Back
//      does not throw away a half-typed note;
//   2. Back says "Results" beside an open page; the tabs do not pile up Back steps;
//   3. the reader bar names the chapter, leads up to the book, and has the chapter arrows; keys;
//   4. the selection bar fits portrait; a highlight or a note taken off can be undone; Cmd+Z is the app's.
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  async function start(name, viewport, { key = false } = {}) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    if (key) {
      await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-test-not-a-key")); } catch (_) {} });
      await ctx.route("https://api.anthropic.com/**", async (route) => {
        const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: '{"queries":[{"q":"charity never faileth","scope":"all"},{"q":"substance of things hoped for","scope":"all"}],"references":[]}' }], stop_reason: "end_turn" }) });
      });
    }
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForTimeout(300);
    return page;
  }
  const check = (name, c, m) => { if (!c) errors.push(`${name}: ${m}`); };
  const backLabel = (page) => page.evaluate(() => { const b = [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null); return b ? b.querySelector(".lb").textContent : null; });
  const tapBack = async (page) => { await page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click()); await page.waitForTimeout(700); };
  const title = (page) => page.evaluate(() => document.querySelector("#reader:not([hidden]) .doc h1")?.textContent.trim() || null);
  const titled = (page, t) => page.waitForFunction((x) => document.querySelector("#reader:not([hidden]) .doc h1")?.textContent.trim() === x, t, { timeout: 15000 }).catch(() => {});
  const depth = (page) => page.evaluate(() => history.state.n);
  const open = async (page, ref) => { await box(page, ref); await page.press("#q", "Enter"); await titled(page, ref); await page.waitForTimeout(400); };

  // ---- iPad in landscape, with an API key saved (the owner's everyday state) ----
  {
    const name = "ipad", page = await start(name, { width: 1180, height: 820 }, { key: true });
    await page.click("#searchTab"); await page.waitForTimeout(400); // Search's own trail from its top, so its depths stay as counted
    // 1a. the concordance shows, and stays once Claude's extra searches have come back
    await box(page, "faith hope charity"); await page.press("#q", "Enter");
    await page.waitForSelector("#list .group-title .text-btn.inline", { timeout: 10000 });
    await page.click("#list .group-title .text-btn.inline");
    await page.waitForSelector("#list .conc-row", { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const c = await page.evaluate(() => ({ head: !!document.querySelector("#list .conc-head"), rows: document.querySelectorAll("#list .conc-row").length, ranked: document.querySelectorAll("#list .hit-row").length, hash: location.hash }));
    check(name, /view=all/.test(c.hash) && c.head && c.rows > 0 && !c.ranked, `the concordance did not show with a key saved: ${JSON.stringify(c)}`);

    // 2. beside an open page a new search changes the list only, and Back says so
    await open(page, "Alma 33");
    await box(page, "faith hope"); await page.press("#q", "Enter"); await page.waitForTimeout(1000);
    check(name, (await backLabel(page)) === "Results", `beside Alma 33, after a new search, Back says ${await backLabel(page)}`);
    await tapBack(page);
    const b = await page.evaluate(() => ({ q: document.querySelector("#q").value, t: document.querySelector("#reader:not([hidden]) .doc h1")?.textContent.trim() }));
    check(name, b.q === "Alma 33" && b.t === "Alma 33", `Back from the new results gave ${JSON.stringify(b)}`);
    // the Deck and Ask are places of their own: no step is made, no Back leads out of them, and the
    // page is where it was when its own tab is tapped again
    const n0 = await depth(page);
    const pageTab = await page.evaluate(() => "#" + document.querySelector("#tabs .tab.on").id);
    await page.click("#deckBtn"); await page.waitForTimeout(500);
    const show = await page.evaluate(() => ({ board: !document.querySelector("#panel").hidden, list: document.querySelector("#list").offsetParent !== null, summary: !!document.querySelector(".deck-summary") }));
    check(name, show.board && !show.list && !show.summary, `the Deck tab should be the board alone: ${JSON.stringify(show)}`);
    for (const sel of ["#askBtn", "#askBtn", "#deckBtn"]) { await page.click(sel); await page.waitForTimeout(350); }
    check(name, (await depth(page)) === 0 && (await backLabel(page)) === null, `Deck, Ask, Ask, Deck: depth ${await depth(page)}, Back ${await backLabel(page)}`);
    check(name, !(await page.$(".fab-think")) && !(await page.evaluate(() => [...document.querySelectorAll(".think-btn")].some((x) => x.offsetParent !== null))), "the lamp or the old pill shows over the board");
    await page.click(pageTab); await page.waitForTimeout(700);
    check(name, (await title(page)) === "Alma 33" && (await depth(page)) === n0, `the page's own tab did not return to the page (${await title(page)}, depth ${await depth(page)} of ${n0})`);
    check(name, await page.evaluate(() => { const x = document.querySelector("#reader .reader-bar .think-btn"); return !!x && x.offsetParent !== null && /Think it through/.test(x.getAttribute("aria-label")); }), "the lamp is missing from the reader bar");

    // 3. the bar: the chapter by name, previous and next in place, the keys, up to the book
    // the shelves to search belong to Search: there beside an open page, nowhere in the Library
    const scopes = () => page.evaluate(() => getComputedStyle(document.querySelector(".scope-row")).display);
    const crumb = await page.evaluate(() => { const x = document.querySelector("#reader .reader-bar .crumb"), cs = getComputedStyle(x); return { text: x.textContent, tag: x.tagName, size: cs.fontSize, weight: cs.fontWeight }; });
    check(name, crumb.text === "Alma 33" && crumb.tag === "BUTTON" && crumb.size === "15px" && Number(crumb.weight) >= 600, `the crumb is ${JSON.stringify(crumb)}`);
    check(name, ((await scopes()) === "none") === (pageTab !== "#searchTab"), `the scope row should show in Search alone (${pageTab}: ${await scopes()})`);
    const back0 = await backLabel(page);
    await page.click("#reader .reader-bar .chap[data-dir=next]"); await titled(page, "Alma 34"); await page.waitForTimeout(200);
    let at = await page.evaluate(() => ({ t: document.querySelector("#reader .doc h1")?.textContent.trim(), n: history.state.n, crumb: document.querySelector("#reader .reader-bar .crumb").textContent, focus: document.activeElement?.dataset?.dir || null }));
    check(name, at.t === "Alma 34" && at.crumb === "Alma 34" && at.n === n0 && at.focus === "next", `the next arrow gave ${JSON.stringify(at)} (depth was ${n0})`);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press("ArrowLeft"); await titled(page, "Alma 33");
    await page.keyboard.press("ArrowLeft"); await titled(page, "Alma 32");
    check(name, (await title(page)) === "Alma 32" && (await depth(page)) === n0 && (await backLabel(page)) === back0, `Left twice gave ${await title(page)} at depth ${await depth(page)}, Back ${await backLabel(page)} (was ${n0}, ${back0})`);
    await page.screenshot({ path: `${SHOTS}nav3-ipad-bar.png` });
    await page.keyboard.press("Control+k");
    check(name, await page.evaluate(() => document.activeElement?.id === "q"), "Cmd+K did not focus the search box");
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(250);
    check(name, (await title(page)) === "Alma 32", "an arrow in the search box turned the chapter");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+f");
    check(name, await page.evaluate(() => document.activeElement?.id === "q"), "Cmd+F did not focus the search box");
    await page.keyboard.press("Escape");
    await page.click("#reader .reader-bar .crumb"); await page.waitForSelector("#homeBody .chapters", { timeout: 8000 }).catch(() => {});
    at = await page.evaluate(() => ({ hash: decodeURIComponent(location.hash), grid: document.querySelectorAll("#homeBody .chapters button").length, t: document.querySelector("#reader:not([hidden]) .doc h1")?.textContent.trim(), n: history.state.n }));
    check(name, /^#scriptures\?b\.book=alma&doc=\d+$/.test(at.hash) && at.grid === 63 && at.t === "Alma 32" && at.n === n0 + 1, `the crumb led to ${JSON.stringify(at)}`);
    await page.keyboard.press("Control+["); await page.waitForTimeout(700);
    at = await page.evaluate(() => ({ hash: decodeURIComponent(location.hash), n: history.state.n }));
    check(name, at.n === n0 && /^#search/.test(at.hash), `Cmd+[ went to ${JSON.stringify(at)}`);

    // 4. in landscape the selection bar shows everything; a highlight and a note taken off can be undone
    const vis = (sel) => page.evaluate((s) => { const x = document.querySelector(s); return !!x && x.offsetParent !== null; }, sel);
    await page.click("#reader .doc #p21"); await page.click("#reader .doc #p22");
    check(name, (await vis("#reader .select-bar .clear-sel")) && !(await vis("#reader .select-bar .sel-more-btn")), "in landscape the selection bar should show Clear and no more button");
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("Escape"); await page.waitForTimeout(150);
    check(name, !(await page.$("#reader .select-bar")) && !(await page.$("#reader .doc .sel")), "Escape did not clear the selection");
    await page.click("#reader .doc #p21");
    const uri = await page.evaluate(async () => (await window.GL.api("doc", { id: Number(new URLSearchParams(location.hash.split("?")[1]).get("doc")) })).uri);
    const mark = () => page.evaluate(async (u) => { const m = await window.Marks.get(u, "p21"); const x = document.querySelector("#reader .doc #p21"); return { color: m?.color || null, note: m?.note || null, drawn: x.classList.contains("hl-y"), noted: x.classList.contains("noted") }; }, uri);
    await page.click("#reader .select-bar .hl-dot.hl-y"); await page.waitForTimeout(300);
    await page.click("#reader .select-bar .hl-dot.hl-y"); await page.waitForTimeout(300);
    let m = await mark();
    const undo = await page.$(".toast.show .toast-action");
    check(name, !m.color && !m.drawn && !!undo, `yellow twice: ${JSON.stringify(m)}, Undo ${!!undo}`);
    if (undo) await undo.click();
    await page.waitForTimeout(400);
    m = await mark();
    check(name, m.color === "y" && m.drawn, `Undo did not put the highlight back: ${JSON.stringify(m)}`);
    // with no Undo showing, Cmd+Z outside a field is still the app's: the deck's undo when it has one
    const z = await page.evaluate(() => {
      const had = window.Deck.undo; let calls = 0;
      document.activeElement?.blur();
      window.Deck.undo = () => { calls++; };
      const withUndo = new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(withUndo);
      delete window.Deck.undo;
      const without = new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true });
      document.dispatchEvent(without);
      if (had) window.Deck.undo = had;
      return { prevented: withUndo.defaultPrevented, calls, bare: without.defaultPrevented };
    });
    check(name, z.prevented && z.calls === 1 && z.bare, `Cmd+Z with no toast: ${JSON.stringify(z)}`);
    await page.click("#reader .select-bar >> text=Note"); await page.waitForSelector("#sheet:not([hidden]) textarea");
    await page.fill("#sheet textarea", "the seed is the word"); await page.click("#sheet .peek-row .primary"); await page.waitForTimeout(400);
    await page.click("#reader .select-bar >> text=Note"); await page.waitForSelector("#sheet:not([hidden]) textarea");
    await page.click("#sheet .peek-row .danger"); await page.waitForTimeout(400);
    m = await mark();
    check(name, !m.note && !m.noted && m.color === "y" && !!(await page.$(".toast.show .toast-action")), `Delete on the note: ${JSON.stringify(m)}`);
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press("Control+z"); await page.waitForTimeout(400);
    m = await mark();
    check(name, m.note === "the seed is the word" && m.noted && m.color === "y", `Cmd+Z did not put the note back: ${JSON.stringify(m)}`);
    await page.context().close();
  }

  // ---- iPad in portrait: the selection bar on one row, the rest behind "more" ----
  {
    const name = "portrait", page = await start(name, { width: 820, height: 1180 });
    await open(page, "Alma 32");
    await page.click("#reader .doc #p21"); await page.click("#reader .doc #p22"); await page.waitForTimeout(200);
    const bar = await page.evaluate(() => {
      const x = document.querySelector("#reader .select-bar"), r = x.getBoundingClientRect();
      const kids = [...x.children].filter((k) => k.offsetParent !== null);
      const shown = (s) => { const k = x.querySelector(s); return !!k && k.offsetParent !== null; };
      return { over: x.scrollWidth - x.clientWidth, out: kids.filter((k) => k.getBoundingClientRect().right > r.right + 1 || k.getBoundingClientRect().left < r.left - 1).length,
        rows: new Set(kids.map((k) => Math.round(k.getBoundingClientRect().top + k.getBoundingClientRect().height / 2))).size, lines: Math.round(x.querySelector(".n").getBoundingClientRect().height),
        dots: [...x.querySelectorAll(".hl-dot")].filter((k) => k.offsetParent !== null).length, note: shown(".text-btn:not(.fold)"), add: shown(".add-deck"), more: shown(".sel-more-btn"), clear: shown(".clear-sel") };
    });
    check(name, bar.over <= 1 && !bar.out && bar.rows === 1 && bar.lines < 30 && bar.dots === 4 && bar.note && bar.add && bar.more && !bar.clear, `the selection bar in portrait: ${JSON.stringify(bar)}`);
    await page.click("#reader .select-bar .sel-more-btn"); await page.waitForTimeout(150);
    const items = await page.evaluate(() => [...document.querySelectorAll("#reader .select-bar .size-menu:not([hidden]) [role=menuitem]")].map((x) => x.textContent.trim()));
    check(name, items.join("|") === "Present|Copy with the citation|Clear selection", `the more menu holds ${items.join("|")}`);
    await page.screenshot({ path: `${SHOTS}nav3-portrait-more.png` });
    await page.click("#reader .select-bar .size-menu >> text=Clear selection"); await page.waitForTimeout(200);
    check(name, !(await page.$("#reader .doc .sel")) && !(await page.$("#reader .select-bar")), "Clear selection in the more menu did not clear");
    await page.context().close();
  }

  // ---- iPhone ----
  {
    const name = "iphone", page = await start(name, { width: 393, height: 852 });
    // 3. opened from the book's grid: the previous arrow takes the chapter's place; the name goes back to the grid
    await page.click("#homeBody .shelf-tile:has-text('Scriptures')"); await page.waitForSelector("#homeBody .chip:text-is('Genesis')");
    await page.click("#homeBody .chip:text-is('Genesis')"); await page.waitForSelector("#homeBody .chapters");
    await page.click("#homeBody .chapters button:text-is('2')"); await titled(page, "Genesis 2"); await page.waitForTimeout(300);
    let n0 = await depth(page);
    await page.click("#reader .reader-bar .chap[data-dir=prev]"); await titled(page, "Genesis 1"); await page.waitForTimeout(300);
    const bar = await page.evaluate(() => { const x = document.querySelector("#reader .reader-bar"); return { over: x.scrollWidth - x.clientWidth, crumb: x.querySelector(".crumb").textContent, n: history.state.n, y: Math.round(scrollY) }; });
    check(name, bar.crumb === "Genesis 1" && bar.n === n0 && bar.over <= 1 && bar.y === 0, `after the previous arrow: ${JSON.stringify(bar)}`);
    check(name, await page.evaluate(() => { const b = document.querySelector("#reader .reader-bar"), lamp = b.querySelector(".think-btn"); return (!!lamp && lamp.offsetParent !== null) || (b.classList.contains("tightest") && !!b.querySelector(".size-menu .menu-think")); }) && !(await page.$(".fab-think")), "the phone's reader bar has no Think (as a lamp or in its menu), or the pill is back");
    await page.screenshot({ path: `${SHOTS}nav3-iphone-bar.png` });
    await page.click("#reader .reader-bar .crumb"); await page.waitForTimeout(700);
    const up = await page.evaluate(() => ({ hash: decodeURIComponent(location.hash), n: history.state.n, grid: !!document.querySelector("#homeBody .chapters"), reader: !document.querySelector("#reader").hidden }));
    check(name, up.hash === "#scriptures?b.book=genesis" && up.n === n0 - 1 && up.grid && !up.reader, `the crumb on a phone led to ${JSON.stringify(up)}`);

    // 1b. a Hebrew word, All verses with this word, then one Back is the chapter again
    await page.click("#homeBody .chapters button:text-is('1')"); await titled(page, "Genesis 1");
    if (!(await page.waitForSelector("#reader .orig .ow", { timeout: 3000 }).catch(() => null))) await readerTool(page, "Hebrew", "#reader .reader-bar .orig-btn");
    await page.waitForSelector("#reader .orig .ow", { timeout: 15000 });
    const t = page.locator("#reader .orig .ow").nth(2);
    await t.scrollIntoViewIfNeeded(); await t.click();
    await page.waitForSelector("#sheet:not([hidden]) .deck-actions .primary", { timeout: 8000 });
    await page.click("#sheet .deck-actions .primary");
    await page.waitForFunction(() => /#search/.test(location.hash) && document.querySelector("#list .hit-row, #list .best"), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(400);
    check(name, /#search/.test(await page.evaluate(() => location.hash)), "All verses with this word did not search");
    await tapBack(page);
    check(name, (await title(page)) === "Genesis 1", `one Back after All verses with this word shows ${await title(page)} at ${await page.evaluate(() => location.hash)}`);

    // 1d. Back keeps a note that is half typed; Cancel lets it go
    await open(page, "Alma 32");
    await page.click("#reader .doc #p21"); await page.click("#reader .select-bar >> text=Note");
    await page.waitForSelector("#sheet:not([hidden]) textarea");
    await page.fill("#sheet textarea", "half a thought");
    await page.evaluate(() => history.back()); await page.waitForTimeout(500);
    const kept = await page.evaluate(() => ({ open: !document.querySelector("#sheet").hidden, text: document.querySelector("#sheet textarea")?.value, marker: !!history.state?.overlay }));
    check(name, kept.open && kept.text === "half a thought" && kept.marker, `Back threw the note away: ${JSON.stringify(kept)}`);
    if (kept.open) await page.click("#sheet >> text=Cancel");
    await page.waitForTimeout(400);
    check(name, (await title(page)) === "Alma 32" && !(await page.evaluate(() => history.state?.overlay)), "Cancel after a kept note left the page or its marker");

    // 1b. a reload under a sheet: the first Back leaves the chapter
    await page.click("#reader .select-bar >> text=Note");
    await page.waitForSelector("#sheet:not([hidden]) textarea");
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#reader:not([hidden]) .doc h1"), null, { timeout: 30000 });
    await page.waitForTimeout(600);
    const before = await page.evaluate(() => location.hash);
    await tapBack(page);
    const after = await page.evaluate(() => ({ hash: location.hash, reader: !document.querySelector("#reader").hidden }));
    check(name, after.hash !== before && !after.reader, `after a reload under a sheet the first Back did nothing (${before} then ${after.hash})`);

    // 1c and 2. the tabs are places, not steps, and the chapter's own tab lands where it was scrolled
    await open(page, "Alma 32");
    const readTab = await page.evaluate(() => "#" + document.querySelector("#tabs .tab.on").id);
    for (const [tab, taps] of [["Deck", ["#deckBtn"]], ["Ask", ["#askBtn", "#askBtn"]], ["the tabs", ["#deckBtn", "#askBtn", "#deckBtn"]]]) {
      await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(150);
      for (const sel of taps) { await page.click(sel); await page.waitForTimeout(350); }
      check(name, (await depth(page)) === 0 && (await backLabel(page)) === null, `${tab}: ${taps.length} taps left depth ${await depth(page)} and Back ${await backLabel(page)}`);
      await page.click(readTab); await page.waitForTimeout(800);
      const y = await page.evaluate(() => Math.round(window.scrollY));
      check(name, Math.abs(y - 700) < 5 && (await title(page)) === "Alma 32", `back from ${tab} by the chapter's tab landed at ${y}, not 700 (${await title(page)})`);
    }
    await page.context().close();
  }
  return errors;
}
