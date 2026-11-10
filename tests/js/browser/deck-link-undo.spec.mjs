// deck-link-undo: Cmd+Z (or Ctrl+Z) straight after a link takes the link back, though the
// focus is in the label box that has just opened; once something is typed there, the key is
// the box's own again. And on a phone, while linking by tap, a touch in the gap between two
// cards or in the margin beside one cancels the link; only a phrase or a card's body links.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["phone", { width: 393, height: 852 }]]) {
    const phone = name === "phone";
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const ctx = await browser.newContext({ viewport, hasTouch: phone });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.evaluate(async () => {
      const add = async (q) => { const j = (await GL.api("search", { q, limit: 1 })).jump; const c = await GL.api("context", { doc_id: j.doc_id, pid: j.pid, before: 0, after: 0 }); const p = c.paragraphs[0]; window.Deck.addPassage({ doc_id: j.doc_id, pid: j.pid, kind: "verse", citation: q, text: p.text, verses: [{ n: p.verse, text: p.text, pid: p.pid }] }); };
      await add("Alma 32:21"); await add("Hebrews 11:1"); await add("Ether 12:6");
    });
    await page.click("#deckBtn");
    await page.waitForSelector(".bcard[data-type='passage'] .port-word", { timeout: 8000 });
    const links = () => page.evaluate(() => window.Deck.state.links.length);
    const startLink = async () => { await page.locator(".bcard .port-word").first().click(); await page.waitForSelector(".board-banner .bb", { timeout: 5000 }); };
    if (!phone) {
      await startLink();
      await page.locator(".bcard[data-type='passage']").nth(1).locator(".w").nth(3).click();
      await page.waitForSelector(".bpop input", { timeout: 5000 });
      await page.waitForFunction(() => document.activeElement?.matches?.(".bpop input"), null, { timeout: 3000 }).catch(() => {});
      check((await links()) === 1, "the link was not made");
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(400);
      check((await links()) === 0 && !(await page.$(".bpop")), `Ctrl+Z in the untouched label box should take the link back (links ${await links()})`);
      // typed in: the key is the box's own
      await startLink();
      await page.locator(".bcard[data-type='passage']").nth(1).locator(".w").nth(3).click();
      await page.waitForSelector(".bpop input", { timeout: 5000 });
      await page.keyboard.type("leads to");
      await page.keyboard.press("Control+z");
      await page.waitForTimeout(300);
      check((await links()) === 1, "Ctrl+Z after typing a label removed the link");
      await page.keyboard.press("Escape");
      await page.evaluate(() => { while (window.Deck.canUndo() && window.Deck.state.links.length) window.Deck.undo(); });
    } else {
      // the gap between the first two cards, and the margin beside one
      const spots = async () => page.evaluate(() => { const cs = [...document.querySelectorAll(".bcard[data-type='passage']")].map((c) => c.getBoundingClientRect()); return { gap: { x: Math.round(cs[1].left + cs[1].width / 2), y: Math.round((cs[0].bottom + cs[1].top) / 2), h: Math.round(cs[1].top - cs[0].bottom) }, margin: { x: Math.max(1, Math.round(cs[1].left / 2)), y: Math.round(cs[1].top + cs[1].height / 2), w: Math.round(cs[1].left) } }; });
      for (const where of ["gap", "margin"]) {
        await startLink();
        const s = (await spots())[where];
        await page.touchscreen.tap(s.x, s.y);
        await page.waitForTimeout(500);
        check((await links()) === 0, `a touch in the ${where} (${JSON.stringify(s)}) linked to the neighbor`);
        check(!(await page.$(".board-banner .bb")), `a touch in the ${where} did not cancel the link`);
        await page.evaluate(() => { while (window.Deck.state.links.length && window.Deck.canUndo()) window.Deck.undo(); });
        await page.keyboard.press("Escape"); await page.waitForTimeout(200);
      }
      // a touch on a card's body still links
      await startLink();
      const b = await page.locator(".bcard[data-type='passage']").nth(1).locator(".w").nth(3).boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForTimeout(500);
      check((await links()) === 1, "a touch on a word of another card should link");
    }
    await page.evaluate(async () => { for (const it of [...window.Deck.state.items]) if (it.doc_id) window.Deck.remove(it.doc_id, it.pid); await window.Deck.flush(); });
    await ctx.close();
  }
  return errors;
}
