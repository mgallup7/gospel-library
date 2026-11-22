// fix-a: the small touch fixes from the every-tap review, each walked with a finger (touch
// contexts at the iPhone and iPad sizes).
//  1. Present: faded controls take no taps, the first touch only wakes them; Present opens on
//     the verse on screen and closing puts the chapter back where it was.
//  2. A return to results does not ask Claude again and keeps the list's place; the phone's
//     "Ask Claude what else it can mean" keeps its answer through a tab change and a reload.
//  3. A tap in a search box that holds the last search selects it; Continue remembers the
//     verse reached by scrolling.
//  4. A tap outside an open menu only closes it.
//  5. The edge swipe back: 16pt, 400 ms, never with a selection.
//  6. Results: "See all" on typed results, "Only exact words" keeps its scope, a reference
//     paints no hits, the concordance's books sit under their volumes.
//  7. The phone's selection bar has a visible clear; neighbours added together say so and split.
//  8. The phrase bar adds to the deck with the phrase marked, and stays after a color.
const STEPS = [];
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const only = process.env.FIXA ? process.env.FIXA.split(",") : null;
  const open = async (viewport, { key = false } = {}) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true });

    // a stand-in for api.anthropic.com: plan requests (not streamed) are counted apart from answers
    const calls = { plan: 0, answer: 0 };
    await ctx.route("https://api.anthropic.com/**", async (route) => {
      const req = route.request();
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      const body = JSON.parse(req.postData() || "{}");
      if (!body.stream) { calls.plan++; return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: '{"queries":[{"q":"hope charity","scope":"all"}],"references":[]}' }], stop_reason: "end_turn" }) }); }
      calls.answer++;
      const events = [{ type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ANSWER-MARK the word leans on trust." } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }];
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("") });
    });
    if (key) await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {} });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

    return { ctx, page, calls };
  };
  const docOf = (page, ref) => page.evaluate(async (r) => (await GL.api("search", { q: r, limit: 1 })).jump.doc_id, ref);
  const read = async (page, ref, pid = null) => {
    const id = await docOf(page, ref);
    await page.evaluate(([i, p]) => GL.openDoc(i, p), [id, pid]);
    await page.waitForSelector("#reader .doc .verse", { timeout: 10000 });
    await page.waitForTimeout(300);
    return id;
  };
  // scroll the chapter so a verse sits at the top of the page, under the bars
  const scrollToVerse = (page, n) => page.evaluate((n) => {
    const v = document.querySelector(`#reader .doc #p${n}`), bar = document.querySelector("#reader .reader-bar");
    const pane = document.querySelector("#reader");
    const by = v.getBoundingClientRect().top - bar.getBoundingClientRect().bottom - 4;
    if (pane.scrollHeight > pane.clientHeight + 4 && getComputedStyle(pane).overflowY !== "visible") pane.scrollTop += by; else window.scrollBy(0, by);
  }, n);
  const place = (page) => page.evaluate(() => ({ reader: document.querySelector("#reader").scrollTop, win: window.scrollY }));
  const tapOn = async (page, sel) => { const b = await page.locator(sel).first().boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
  const tapVerse = async (page, n) => { await page.evaluate((n) => document.querySelector(`#reader .doc #p${n}`).scrollIntoView({ block: "center" }), n); await page.waitForTimeout(120); const b = await page.locator(`#reader .doc #p${n}`).boundingBox(); await page.touchscreen.tap(b.x + 70, b.y + 12); await page.waitForTimeout(150); };
  const step = (name, fn) => STEPS.push([name, fn]);
  STEPS.length = 0;

  step("1", async () => {
    for (const viewport of [{ width: 393, height: 852 }, { width: 1180, height: 820 }]) {
      const tag = viewport.width < 700 ? "phone" : "ipad";
      const { ctx, page } = await open(viewport);
      await read(page, "Alma 32:1");
      await scrollToVerse(page, 16);
      await page.waitForTimeout(200);
      const before = await place(page);
      await page.keyboard.press("p");
      await page.waitForSelector("#stage:not([hidden])");
      const first = await page.textContent("#stage .stage-ref");
      check(/32:16$/.test(first), `${tag}: Present should open on the verse on screen (16), opened on "${first}"`);
      // let the controls fade, then tap where Close sits: it must only wake them
      await page.waitForTimeout(2900);
      const faded = await page.evaluate(() => { const c = document.querySelector("#stage .stage-controls"); return { pe: getComputedStyle(c).pointerEvents, shown: document.querySelector("#stage").classList.contains("show-controls") }; });
      check(faded.pe === "none" && !faded.shown, `${tag}: faded controls should take no taps: ${JSON.stringify(faded)}`);
      const count = await page.textContent("#stage .stage-count");
      await tapOn(page, "#stage .stage-close");
      await page.waitForTimeout(300);
      const woke = await page.evaluate(() => ({ open: !document.querySelector("#stage").hidden, shown: document.querySelector("#stage").classList.contains("show-controls"), count: document.querySelector("#stage .stage-count").textContent }));
      check(woke.open && woke.shown && woke.count === count, `${tag}: the first touch on the corner should only wake the controls: ${JSON.stringify(woke)} (was ${count})`);
      if (tag === "phone") await page.screenshot({ path: `${SHOTS}fix-a-stage-phone.png` });
      // the second tap is a real one
      await tapOn(page, "#stage .stage-close");
      await page.waitForTimeout(500);
      check(await page.evaluate(() => document.querySelector("#stage").hidden), `${tag}: a second tap on Close should close the stage`);
      const after = await place(page);
      check(Math.abs(after.reader - before.reader) < 3 && Math.abs(after.win - before.win) < 3, `${tag}: closing Present should leave the chapter where it was: ${JSON.stringify(before)} then ${JSON.stringify(after)}`);
      // a selection is where Present begins
      await page.evaluate(() => document.querySelector("#reader .doc #p20").scrollIntoView({ block: "center" }));
      await tapOn(page, "#reader .doc #p20");
      await page.keyboard.press("p");
      await page.waitForSelector("#stage:not([hidden])");
      const sel = await page.textContent("#stage .stage-ref");
      check(/32:20$/.test(sel), `${tag}: Present should open on the selected verse, opened on "${sel}"`);
      await page.keyboard.press("Escape");
      await ctx.close();
    }
  });

  step("2", async () => {
    // iPad: one paid request for the search he made, none for the returns to it
    {
      const { ctx, page, calls } = await open({ width: 1180, height: 820 }, { key: true });
      await tapOn(page, "#searchTab");
      await page.fill("#q", "faith and works"); await page.press("#q", "Enter");
      await page.waitForSelector("#list .hit", { timeout: 20000 });
      await page.waitForFunction(() => !!document.querySelector("#list .widened") || !document.querySelector("#list .widening"), null, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(600);
      check(calls.plan === 1, `a search just made should ask Claude once for more, asked ${calls.plan} times`);
      await page.evaluate(() => { document.querySelector("#list").scrollTop = 700; });
      await page.waitForTimeout(700); // the place is written a moment after the scroll rests
      await tapOn(page, "#deckBtn"); await page.waitForTimeout(500);
      await tapOn(page, "#searchTab");
      await page.waitForSelector("#list .hit", { timeout: 20000 }); await page.waitForTimeout(900);
      const back = await page.evaluate(() => document.querySelector("#list").scrollTop);
      check(calls.plan === 1, `a tab return to results should not ask Claude again (${calls.plan} requests)`);
      check(Math.abs(back - 700) < 5, `the list should keep its place through a tab return, at ${back}`);
      await page.reload();
      await page.waitForSelector("#list .hit", { timeout: 60000 }); await page.waitForTimeout(1200);
      const reloaded = await page.evaluate(() => document.querySelector("#list").scrollTop);
      check(calls.plan === 1, `a reload on results should not ask Claude again (${calls.plan} requests)`);
      check(Math.abs(reloaded - 700) < 5, `the list should keep its place through a reload, at ${reloaded}`);
      // into a hit and Back: still one
      await page.evaluate(() => { document.querySelector("#list").scrollTop = 0; });
      await tapOn(page, "#list .hit"); await page.waitForTimeout(600);
      await page.goBack(); await page.waitForTimeout(900);
      check(calls.plan === 1, `Back to results should not ask Claude again (${calls.plan} requests)`);
      await ctx.close();
    }
    // iPhone: a question handed to Ask from a page keeps its answer
    {
      const { ctx, page, calls } = await open({ width: 393, height: 852 }, { key: true });
      await read(page, "John 1:1");
      await page.evaluate(() => GL.ask("What else can logos mean here?"));
      await page.waitForFunction(() => /ANSWER-MARK/.test(document.querySelector(".ask-log")?.textContent || ""), null, { timeout: 15000 }).catch(() => errors.push("phone: the handed question got no answer"));
      check(!/doc=/.test(await page.evaluate(() => location.hash)), `phone: the page should leave the address when a question goes to Ask: ${await page.evaluate(() => location.hash)}`);
      const shows = () => page.evaluate(() => { const log = document.querySelector(".ask-log"); const r = log?.getBoundingClientRect(); return { answer: /ANSWER-MARK/.test(log?.textContent || "") && !!r && r.height > 0, page: !document.querySelector("#reader").hidden }; });
      await tapOn(page, "#homeBtn"); await page.waitForTimeout(500);
      await tapOn(page, "#askBtn"); await page.waitForTimeout(900);
      let s = await shows();
      check(s.answer && !s.page, `phone: leaving Ask and returning should show the answer, not the page: ${JSON.stringify(s)}`);
      await page.reload();
      await page.waitForSelector(".ask-log", { timeout: 60000 }); await page.waitForTimeout(900);
      s = await shows();
      check(s.answer && !s.page, `phone: a reload on Ask should show the answer, not the page: ${JSON.stringify(s)}`);
      check(calls.answer === 1, `phone: the question should be asked once, asked ${calls.answer} times`);
      await page.screenshot({ path: `${SHOTS}fix-a-ask-phone.png` });
      await ctx.close();
    }
  });

  step("3", async () => {
    const { ctx, page } = await open({ width: 393, height: 852 });
    await tapOn(page, "#searchTab");
    await page.fill("#q", "alma 32 21"); await page.press("#q", "Enter");
    await page.waitForSelector("#reader .doc .verse", { timeout: 15000 });
    await page.waitForTimeout(400);
    // back on Search the box holds the last search and has lost the cursor
    await page.goBack(); await page.waitForTimeout(700);
    await page.evaluate(() => document.querySelector("#q").blur());
    await tapOn(page, "#q"); await page.waitForTimeout(200);
    const sel = await page.evaluate(() => { const q = document.querySelector("#q"); return { v: q.value, a: q.selectionStart, b: q.selectionEnd, focused: document.activeElement === q }; });
    check(sel.focused && sel.v.length > 0 && sel.a === 0 && sel.b === sel.v.length, `a tap in the box should select the last search: ${JSON.stringify(sel)}`);
    await page.keyboard.type("d&c 4 2");
    check((await page.inputValue("#q")) === "d&c 4 2", `typing should replace the last search, the box reads "${await page.inputValue("#q")}"`);
    // a second tap in a box that has the cursor leaves the text unselected
    await tapOn(page, "#q"); await page.waitForTimeout(200);
    const again = await page.evaluate(() => { const q = document.querySelector("#q"); return q.selectionEnd - q.selectionStart; });
    check(again < 7, "a tap in a box that already has the cursor should not select it all again");
    // Continue: the verse reached by scrolling
    await read(page, "Alma 5:1");
    await scrollToVerse(page, 16);
    await page.waitForTimeout(1400);
    const last = await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.lastRead")));
    check(last && last.verse === 16 && last.pid === "p16", `Continue should remember the verse reached by scrolling: ${JSON.stringify(last)}`);
    await tapOn(page, "#homeBtn"); await page.waitForTimeout(700);
    if (!(await page.isVisible(".sec-continue"))) { await tapOn(page, "#homeBtn"); await page.waitForTimeout(700); }
    const card = await page.textContent(".sec-continue .home-card").catch(() => "");
    check(/Alma 5/.test(card) && /at verse 16/.test(card), `the Continue card should say the verse: "${card}"`);
    await page.screenshot({ path: `${SHOTS}fix-a-continue-phone.png` });
    await tapOn(page, ".sec-continue .home-card");
    await page.waitForSelector("#reader .doc .verse", { timeout: 10000 }); await page.waitForTimeout(600);
    const seen = await page.evaluate(() => { const r = document.querySelector("#reader .doc #p16").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    check(seen, "Continue should open the chapter with that verse on screen");
    await ctx.close();
  });

  step("4", async () => {
    const { ctx, page } = await open({ width: 393, height: 852 });
    await read(page, "Alma 32:1");
    // the reader's Aa menu, closed by a tap on a verse: the verse is not selected
    await tapOn(page, "#reader .reader-bar .size-pop-btn");
    await page.waitForSelector("#reader .reader-bar .size-menu:not([hidden])");
    await page.screenshot({ path: `${SHOTS}fix-a-menu-phone.png` });
    const spot = await page.evaluate(() => { const m = document.querySelector("#reader .size-menu").getBoundingClientRect(); const v = [...document.querySelectorAll("#reader .doc .verse")].find((n) => n.getBoundingClientRect().top > m.bottom + 10); const r = v.getBoundingClientRect(); return { x: r.left + 60, y: r.top + 12, id: v.id }; });
    await page.touchscreen.tap(spot.x, spot.y); await page.waitForTimeout(300);
    let got = await page.evaluate(() => ({ menu: !document.querySelector("#reader .size-menu").hidden, sel: document.querySelectorAll("#reader .doc .sel").length }));
    check(!got.menu && got.sel === 0, `a tap outside the Aa menu should only close it: ${JSON.stringify(got)}`);
    // the next tap is an ordinary one
    await page.touchscreen.tap(spot.x, spot.y); await page.waitForTimeout(300);
    check((await page.locator("#reader .doc .sel").count()) === 1, "the tap after the menu closed should select the verse");
    // the selection's more menu, closed by a tap on another verse: the selection is unchanged
    await tapOn(page, "#reader .select-bar .sel-more-btn");
    await page.waitForSelector("#reader .select-bar .size-menu:not([hidden])");
    const other = await page.evaluate((id) => { const v = [...document.querySelectorAll("#reader .doc .verse")].find((n) => n.id !== id && n.getBoundingClientRect().top > 140 && !n.classList.contains("sel")); const r = v.getBoundingClientRect(); return { x: r.left + 60, y: r.top + 12 }; }, spot.id);
    await page.touchscreen.tap(other.x, other.y); await page.waitForTimeout(300);
    got = await page.evaluate(() => ({ menu: !document.querySelector("#reader .select-bar .size-menu").hidden, sel: document.querySelectorAll("#reader .doc .sel").length }));
    check(!got.menu && got.sel === 1, `a tap outside the selection's menu should only close it: ${JSON.stringify(got)}`);
    // a deck card's menu, closed by a tap on another card's Remove: nothing is removed
    await page.evaluate(() => { for (const n of document.querySelectorAll("#reader .doc .sel")) n.click(); });
    for (const n of [3, 9, 15]) await tapVerse(page, n);
    await tapOn(page, "#reader .select-bar .add-deck"); await page.waitForTimeout(250);
    await tapOn(page, "#deckBtn"); await page.waitForTimeout(700);
    const cards = await page.locator(".bcard").count();
    if (cards >= 2) {
      await tapOn(page, ".bcard >> nth=0 >> .bc-more");
      await page.waitForSelector(".bcard .bc-menu", { timeout: 3000 });
      const under = await page.evaluate(() => { const m = document.querySelector(".bcard .bc-menu").getBoundingClientRect(); const c = [...document.querySelectorAll(".bcard .bc-text, .bcard .bc-body, .bcard p")].find((n) => { const r = n.getBoundingClientRect(); return r.top > m.bottom + 8 && r.top < innerHeight - 120; }); if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.left + 30, y: r.top + 10 }; });
      if (under) {
        const before = await page.evaluate(() => JSON.stringify(window.Deck.state));
        await page.touchscreen.tap(under.x, under.y); await page.waitForTimeout(400);
        const after = await page.evaluate(() => ({ menu: !!document.querySelector(".bcard .bc-menu"), same: null, st: JSON.stringify(window.Deck.state), picking: !!document.querySelector(".bcard .picking, .board.linking, .w.picked, .w.sel") }));
        check(!after.menu && after.st === before && !after.picking, `a tap outside a card's menu should only close it: menu ${after.menu}, deck changed ${after.st !== before}, picking ${after.picking}`);
      } else errors.push("deck: no card text under the open menu to tap");
    } else errors.push(`deck: expected cards to test the menu on, found ${cards}`);
    await ctx.close();
  });

  step("5", async () => {
    // the edge swipe lives in the home-screen app: the test says it is one
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true });
    await ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true }); } catch (_) {} });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (x0, y, x1, { ms = 120, rest = 0 } = {}) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
      if (rest) await page.waitForTimeout(rest);
      const steps = 4;
      for (let k = 1; k <= steps; k++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * k) / steps, y }] }); await page.waitForTimeout(ms / steps); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(500);
    };
    const at = () => page.evaluate(() => location.hash);
    // Library, Scriptures (the book chips), Alma (the chapter grid), Alma 32
    await page.locator("#homeBody .shelf-tile:has-text('Scriptures')").tap(); await page.waitForSelector("#homeBody .shelf .chip", { timeout: 5000 });
    const books = await at();
    await page.locator("#homeBody .shelf .chip", { hasText: /^Alma$/ }).tap(); await page.waitForSelector("#homeBody .chapters button", { timeout: 5000 });
    const grid = await at();
    await page.locator("#homeBody .chapters button", { hasText: /^32$/ }).tap();
    await page.waitForSelector("#reader .doc .verse", { timeout: 10000 }); await page.waitForTimeout(300);
    const chapter = await at();
    // from 24pt in: not the edge any more
    await swipe(24, 400, 200);
    check((await at()) === chapter, "a swipe that starts 24pt in should not go back");
    // a press that rests, then drags (selecting a phrase): not a swipe
    await swipe(8, 400, 200, { rest: 500 });
    check((await at()) === chapter, "a long press dragged right should not go back");
    // a slow drag: over 400 ms
    await swipe(8, 400, 200, { ms: 700 });
    check((await at()) === chapter, "a slow drag from the edge should not go back");
    // words selected: no swipe
    await page.evaluate(() => { const v = document.querySelector("#reader .doc .verse"); const r = document.createRange(); r.selectNodeContents(v); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    await swipe(8, 400, 200);
    check((await at()) === chapter, "a swipe while words are selected should not go back");
    await page.evaluate(() => getSelection().removeAllRanges()); await page.waitForTimeout(700);
    // a quick one from the edge goes back: to the chapter grid, then the book chips, then the shelf
    await swipe(8, 400, 200);
    check((await at()) === grid, `a quick swipe from the edge should go back to the chapter grid: ${await at()}`);
    const y = await page.evaluate(() => { const r = document.querySelector("#homeBody .chapters").getBoundingClientRect(); return r.top + 30; });
    await swipe(6, y, 200);
    check((await at()) === books, `the edge swipe should work on the chapter grid: ${await at()}`);
    await page.waitForSelector("#homeBody .shelf .chip", { timeout: 5000 });
    const y2 = await page.evaluate(() => { const r = document.querySelector("#homeBody .shelf").getBoundingClientRect(); return r.top + 20; });
    await swipe(6, y2, 200);
    check((await at()) !== books && !!(await page.$("#homeBody .shelf-grid")), `the edge swipe should work on the book chips: ${await at()}`);
    // the Deck: a page opened from a card, then the Deck again by its Back; a swipe from the board's edge goes back to the page
    await read(page, "Alma 32:1");
    await tapVerse(page, 3);
    await tapOn(page, "#reader .select-bar .add-deck"); await page.waitForTimeout(300);
    await tapOn(page, "#deckBtn"); await page.waitForSelector(".board .bcard", { timeout: 5000 });
    await page.locator(".board .bcard .bc-cite").first().tap(); await page.waitForTimeout(700);
    const fromDeck = await at();
    if (/doc=/.test(fromDeck)) {
      await page.goBack(); await page.waitForSelector(".board .bcard", { timeout: 5000 }); await page.waitForTimeout(300);
      const onDeck = await at();
      await page.goForward(); await page.waitForTimeout(600);
      await page.goBack(); await page.waitForSelector(".board .bcard", { timeout: 5000 }); await page.waitForTimeout(300);
      const yb = await page.evaluate(() => { const r = document.querySelector(".board .bcard").getBoundingClientRect(); return r.top + 40; });
      await swipe(387, yb, 200); // in from the right edge: forward, to the page again
      check((await at()) === fromDeck, `the edge swipe should work on the Deck (forward from its right edge): ${await at()} (deck ${onDeck})`);
    } else errors.push(`deck: a card's citation should open its page: ${fromDeck}`);
    await ctx.close();
  });

  step("6", async () => {
    const { ctx, page } = await open({ width: 393, height: 852 });
    await tapOn(page, "#searchTab");
    // typed, not entered: the results say that all of them can be seen
    await page.locator("#q").pressSequentially("faith", { delay: 30 });
    await page.waitForSelector("#list .hit", { timeout: 20000 }); await page.waitForTimeout(500);
    const typed = await page.evaluate(() => document.querySelector("#list .group-title .see-all")?.textContent || "");
    check(/^See all, book by book/.test(typed), `typed results should offer "See all, book by book": "${typed}"`);
    await page.screenshot({ path: `${SHOTS}fix-a-typed-phone.png` });
    await tapOn(page, "#list .group-title .see-all");
    await page.waitForSelector("#list .conc-books .chip", { timeout: 30000 });
    // the concordance's books under their volumes, in the shelf's order, each still one tap
    const vols = await page.evaluate(() => [...document.querySelectorAll("#list .conc-books .conc-vol")].map((v) => ({ name: v.querySelector(".conc-vol-name").textContent, books: [...v.querySelectorAll(".chip")].map((c) => c.dataset.book) })));
    const names = vols.map((v) => v.name);
    check(names.join("|") === ["Old Testament", "New Testament", "Book of Mormon", "Doctrine and Covenants", "Pearl of Great Price"].filter((n) => names.includes(n)).join("|") + (names.includes("Other books") ? "|Other books" : "") && names.length >= 4, `the book chips should sit under their volumes in order: ${JSON.stringify(names)}`);
    const bom = vols.find((v) => v.name === "Book of Mormon");
    check(!!bom && bom.books.includes("alma") && bom.books.indexOf("alma") < 12, `Alma should be a few chips into the Book of Mormon: ${JSON.stringify(bom?.books)}`);
    await page.screenshot({ path: `${SHOTS}fix-a-volumes-phone.png` });
    await page.evaluate(() => document.querySelector("#list .conc-books .chip[data-book=alma]").scrollIntoView({ inline: "center", block: "center" }));
    await page.waitForTimeout(200);
    await tapOn(page, "#list .conc-books .chip[data-book=alma]");
    await page.waitForSelector("#list .conc-books .chip.on[data-book=alma]", { timeout: 15000 });
    const seen = await page.evaluate(() => { const r = document.querySelector("#list .conc-books .chip.on").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    check(seen, "the chip that is on should be in sight in its row");
    // "Only exact words" on a search with its scope in the sentence
    await page.fill("#q", "faith in Alma"); await page.press("#q", "Enter");
    await page.waitForSelector("#list .exact-words", { timeout: 20000 });
    const family = await page.evaluate(async () => (await GL.api("search", { q: "faith in Alma", limit: 5 })).smart);
    await tapOn(page, "#list .exact-words");
    await page.waitForFunction(() => /^"/.test(document.querySelector("#q").value), null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const exact = await page.evaluate(() => ({ q: document.querySelector("#q").value, hits: document.querySelectorAll("#list .hit").length, empty: document.querySelector("#list .empty")?.textContent || "", line: document.querySelector("#list .smart-line")?.textContent || "", again: !!document.querySelector("#list .exact-words") }));
    check(exact.q === '"faith" book:alma', `"Only exact words" should quote only the words and keep Alma: ${exact.q} (the search read ${JSON.stringify(family?.book)})`);
    check(exact.hits > 0 && !exact.empty && /in Alma/.test(exact.line), `the exact search should find passages in Alma: ${JSON.stringify(exact)}`);
    check(!exact.again, "a search already in exact words should not offer it again");
    const outside = await page.evaluate(() => [...document.querySelectorAll("#list .hit")].map((h) => h.textContent).filter((t) => !/Alma \d/.test(t)).length);
    check(outside === 0, `${outside} results of the exact search are not in Alma`);
    // a reference is a place: the page it opens shows no match strip and no painted hits
    await page.fill("#q", "alma 32 21"); await page.press("#q", "Enter");
    await page.waitForSelector("#reader .doc .verse", { timeout: 15000 }); await page.waitForTimeout(700);
    let paint = await page.evaluate(() => ({ marks: document.querySelectorAll("#reader .doc mark.hl").length, strip: !!document.querySelector("#reader .match-strip, #reader .matchnav"), target: document.querySelector("#reader .doc .is-target")?.id }));
    check(paint.marks === 0 && !paint.strip && paint.target === "p21", `a reference should open its verse with no hits painted: ${JSON.stringify(paint)}`);
    await page.screenshot({ path: `${SHOTS}fix-a-reference-phone.png` });
    await page.reload();
    await page.waitForSelector("#reader .doc .verse", { timeout: 60000 }); await page.waitForTimeout(1200);
    paint = await page.evaluate(() => ({ marks: document.querySelectorAll("#reader .doc mark.hl").length, strip: !!document.querySelector("#reader .match-strip, #reader .matchnav") }));
    check(paint.marks === 0 && !paint.strip, `after a reload the reference should still paint nothing: ${JSON.stringify(paint)}`);
    // and a search for words still paints them
    await page.goBack(); await page.waitForTimeout(600);
    if (!(await page.isVisible("#q"))) { await tapOn(page, "#searchTab"); await page.waitForTimeout(500); }
    await page.fill("#q", "charity never faileth"); await page.press("#q", "Enter");
    await page.waitForFunction(() => /charity/i.test(document.querySelector("#list .hit")?.textContent || ""), null, { timeout: 20000 }); // this search's results, not the list it replaces
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector("#list .hit").scrollIntoView({ block: "center" })); await page.waitForTimeout(200); // clear of the bar at the foot of the phone
    await tapOn(page, "#list .hit"); await page.waitForSelector("#reader .doc .verse", { timeout: 10000 }); await page.waitForTimeout(600);
    check((await page.locator("#reader .doc mark.hl").count()) > 0, "a search for words should still mark them on the page");
    await ctx.close();
    // the iPad's concordance: the same groups, wrapped
    const pad = await open({ width: 1180, height: 820 });
    await tapOn(pad.page, "#searchTab");
    await pad.page.fill("#q", "faith"); await pad.page.press("#q", "Enter");
    await pad.page.waitForSelector("#list .group-title .see-all", { timeout: 20000 });
    await tapOn(pad.page, "#list .group-title .see-all");
    await pad.page.waitForSelector("#list .conc-books .conc-vol .chip", { timeout: 30000 });
    await pad.page.screenshot({ path: `${SHOTS}fix-a-volumes-ipad.png` });
    await pad.ctx.close();
  });

  step("7", async () => {
    const { ctx, page } = await open({ width: 393, height: 852 });
    await read(page, "Alma 32:1");
    await tapVerse(page, 5);
    const x = await page.evaluate(() => { const b = document.querySelector("#reader .select-bar .sel-x"); const r = b?.getBoundingClientRect(); const bar = document.querySelector("#reader .select-bar").getBoundingClientRect(); const kids = [...document.querySelector("#reader .select-bar").children].filter((c) => c.offsetParent).map((c) => c.getBoundingClientRect()); return r ? { w: r.width, h: r.height, inBar: r.left >= bar.left && r.right <= bar.right, fits: kids.every((k) => k.left >= bar.left - 1 && k.right <= bar.right + 1), label: b.getAttribute("aria-label") } : null; });
    check(!!x && x.w >= 44 && x.h >= 44 && x.inBar && x.fits && x.label === "Clear selection", `the phone's selection bar should show a 44pt clear and still fit: ${JSON.stringify(x)}`);
    await page.screenshot({ path: `${SHOTS}fix-a-selbar-phone.png` });
    await tapOn(page, "#reader .select-bar .sel-x"); await page.waitForTimeout(250);
    const cleared = await page.evaluate(() => ({ sel: document.querySelectorAll("#reader .doc .sel").length, bar: !!document.querySelector("#reader .select-bar") }));
    check(cleared.sel === 0 && !cleared.bar, `the x should clear the selection: ${JSON.stringify(cleared)}`);
    // two neighbours and one apart: two cards, said as such, and Split makes three
    for (const n of [22, 23, 27]) await tapVerse(page, n);
    await tapOn(page, "#reader .select-bar .add-deck"); await page.waitForTimeout(300);
    let t = await page.evaluate(() => ({ text: document.querySelector("#toast span")?.textContent, acts: [...document.querySelectorAll("#toast .toast-action")].map((b) => b.textContent), n: window.Deck.count(), box: (() => { const r = document.querySelector("#toast").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })() }));
    check(/^Added as 2 cards/.test(t.text || "") && t.acts.includes("Split") && t.acts.includes("Undo") && t.n === 2 && t.box, `neighbours added together should say so and offer Split and Undo: ${JSON.stringify(t)}`);
    await page.screenshot({ path: `${SHOTS}fix-a-split-phone.png` });
    await page.locator("#toast .toast-action", { hasText: "Split" }).tap(); await page.waitForTimeout(400);
    t = await page.evaluate(() => ({ text: document.querySelector("#toast span")?.textContent, acts: [...document.querySelectorAll("#toast .toast-action")].map((b) => b.textContent), n: window.Deck.count(), refs: window.Deck.state.items.map((i) => i.citation || i.label || "") }));
    check(t.n === 3 && /3 separate cards/.test(t.text || "") && t.acts.includes("Undo"), `Split should make a card for each verse, with an Undo: ${JSON.stringify(t)}`);
    await page.locator("#toast .toast-action", { hasText: "Undo" }).tap(); await page.waitForTimeout(400);
    check((await page.evaluate(() => window.Deck.count())) === 0, "Undo after Split should take the three cards off");
    // one run alone: "Added as one card"
    for (const n of [22, 23]) await tapVerse(page, n);
    await tapOn(page, "#reader .select-bar .add-deck"); await page.waitForTimeout(300);
    t = await page.evaluate(() => ({ text: document.querySelector("#toast span")?.textContent, n: window.Deck.count() }));
    check(t.text === "Added as one card." && t.n === 1, `two neighbours should say "Added as one card.": ${JSON.stringify(t)}`);
    await page.locator("#toast .toast-action", { hasText: "Undo" }).tap(); await page.waitForTimeout(300);
    check((await page.evaluate(() => window.Deck.count())) === 0, "Undo should take the one card off");
    await ctx.close();
    // the iPad keeps Clear in words and has no x
    const pad = await open({ width: 1180, height: 820 });
    await read(pad.page, "Alma 32:1");
    await tapVerse(pad.page, 5);
    const words = await pad.page.evaluate(() => ({ x: !!document.querySelector("#reader .select-bar .sel-x")?.offsetParent, clear: !!document.querySelector("#reader .select-bar .clear-sel")?.offsetParent }));
    check(!words.x && words.clear, `the iPad's bar should keep Clear in words: ${JSON.stringify(words)}`);
    await pad.ctx.close();
  });

  step("8", async () => {
    const selectWords = (page, pid, words) => page.evaluate(([pid, words]) => {
      const unit = document.querySelector(`#reader .doc #${pid}`);
      const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
      let node, text = "";
      const nodes = [];
      while ((node = walker.nextNode())) { if (node.parentElement.closest(".verse-number, sup")) continue; nodes.push({ node, at: text.length }); text += node.nodeValue; }
      const a = text.indexOf(words), b = a + words.length;
      const find = (off) => { const n = [...nodes].reverse().find((x) => x.at <= off); return [n.node, off - n.at]; };
      const r = document.createRange(); r.setStart(...find(a)); r.setEnd(...find(b));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }, [pid, words]);
    for (const viewport of [{ width: 393, height: 852 }, { width: 1180, height: 820 }]) {
      const tag = viewport.width < 700 ? "phone" : "ipad";
      const { ctx, page } = await open(viewport);
      const id = await read(page, "Alma 32:21", "p21");
      await selectWords(page, "p21", "hope for things which are not seen");
      await page.waitForSelector("#reader .phrase-bar", { timeout: 5000 });
      const bar = await page.evaluate(() => { const b = document.querySelector("#reader .phrase-bar"); const n = b.querySelector(".n"); const shown = n.offsetParent !== null && n.getBoundingClientRect().width > 0; return { fits: b.scrollWidth <= b.clientWidth + 1, label: shown ? n.textContent : null, cut: shown && n.scrollWidth > n.clientWidth + 1 && n.clientWidth < 100, deck: !!b.querySelector(".ph-deck")?.offsetParent, deckH: b.querySelector(".ph-deck")?.getBoundingClientRect().height }; });
      check(bar.fits && bar.deck && bar.deckH >= 44, `${tag}: the phrase bar should fit on one row with + Deck in it: ${JSON.stringify(bar)}`);
      check(!bar.cut, `${tag}: the bar's words should be readable or absent, never a stub: ${JSON.stringify(bar)}`);
      if (tag === "ipad") check(/hope for things which are not seen/.test(bar.label || ""), `ipad: the bar should name the words: ${JSON.stringify(bar)}`);
      await page.screenshot({ path: `${SHOTS}fix-a-phrase-${tag}.png` });
      // a color: the words are marked and the bar stays, on them
      await tapOn(page, "#reader .phrase-bar .hl-dot.hl-g"); await page.waitForTimeout(500);
      const after = await page.evaluate(() => { const b = document.querySelector("#reader .phrase-bar"); return { bar: !!b, pressed: b?.querySelector(".hl-dot.hl-g")?.getAttribute("aria-pressed"), remove: !!b?.querySelector(".ph-remove"), fits: !!b && b.scrollWidth <= b.clientWidth + 1, mark: document.querySelector("#reader .doc #p21 mark.hlp.hl-g")?.textContent }; });
      check(after.bar && after.pressed === "true" && after.remove && after.fits && /hope for things which are not seen/.test(after.mark || ""), `${tag}: after a color the bar should stay on the marked words and still fit: ${JSON.stringify(after)}`);
      await page.screenshot({ path: `${SHOTS}fix-a-phrase-kept-${tag}.png` });
      // + Deck: the verse goes on with the phrase as its card's highlight, once
      await tapOn(page, "#reader .phrase-bar .ph-deck"); await page.waitForTimeout(400);
      const card = await page.evaluate((id) => { const it = window.Deck.state.items.find((i) => i.doc_id === id && i.pid === "p21"); const words = it ? (it.verses ? it.verses.flatMap((v) => v.text.split(/\s+/)) : it.text.split(/\s+/)).filter(Boolean) : []; return { n: window.Deck.count(), hl: (it?.hl || []).map((h) => words.slice(h.s, h.e + 1).join(" ")), toast: document.querySelector("#toast span")?.textContent, undo: !!document.querySelector("#toast .toast-action"), bar: !!document.querySelector("#reader .phrase-bar") }; }, id);
      check(card.n === 1 && card.hl.length === 1 && /^hope for things which are not seen/.test(card.hl[0]) && /words marked/.test(card.toast || "") && card.undo && !card.bar, `${tag}: + Deck should add the verse with the phrase highlighted on its card: ${JSON.stringify(card)}`);
      // again on the same words: no second card and no second highlight
      const spot = await page.evaluate(() => { const r = document.querySelector("#reader .doc #p21 mark.hlp").getClientRects()[0]; return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }; }); // a mark can wrap: its first line, not the middle of its box
      await page.touchscreen.tap(spot.x, spot.y); await page.waitForSelector("#reader .phrase-bar .ph-deck", { timeout: 3000 });
      await tapOn(page, "#reader .phrase-bar .ph-deck"); await page.waitForTimeout(400);
      const twice = await page.evaluate((id) => ({ n: window.Deck.count(), hl: (window.Deck.state.items.find((i) => i.doc_id === id && i.pid === "p21")?.hl || []).length, toast: document.querySelector("#toast span")?.textContent }), id);
      check(twice.n === 1 && twice.hl === 1 && /Already on the deck/.test(twice.toast || ""), `${tag}: the same words added again should not be marked twice: ${JSON.stringify(twice)}`);
      // the board shows the highlight on the card
      await tapOn(page, "#deckBtn"); await page.waitForSelector(".board .bcard", { timeout: 5000 }); await page.waitForTimeout(300);
      const onCard = await page.evaluate(() => [...document.querySelectorAll(".board .bcard .w.hl, .board .bcard mark, .board .bcard .hl")].map((n) => n.textContent.trim()).join(" "));
      check(/hope/.test(onCard) && /seen/.test(onCard), `${tag}: the card on the board should show the phrase highlighted: "${onCard.slice(0, 80)}"`);
      await page.screenshot({ path: `${SHOTS}fix-a-phrase-card-${tag}.png` });
      await ctx.close();
    }
  });

  for (const [name, fn] of STEPS) {
    if (only && !only.includes(name)) continue;
    try { await fn(); } catch (err) { errors.push(`item ${name} aborted: ${String(err.message).split("\n")[0]}`); }
  }
  return errors;
}
