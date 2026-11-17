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

  for (const [name, fn] of STEPS) {
    if (only && !only.includes(name)) continue;
    try { await fn(); } catch (err) { errors.push(`item ${name} aborted: ${String(err.message).split("\n")[0]}`); }
  }
  return errors;
}
