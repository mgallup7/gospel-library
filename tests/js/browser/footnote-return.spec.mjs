// footnote-return: leaving the footnote sheet and coming back. Open, from a reference, goes to
// that chapter; Back returns to the chapter you were in WITH the note up again at the reference
// you left. Forward after a sheet was closed does not land on an empty step. A tap outside the
// sheet on another footnoted word shows that note in one tap. (Needs real footnotes in Alma 32.)
export default async function run(browser, { BASE, PASS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  for (const [name, viewport] of [["phone", { width: 393, height: 852 }], ["ipad", { width: 1180, height: 820 }]]) {
    const ctx = await browser.newContext({ viewport, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS); await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    if (!(await page.isVisible("#q"))) { const t = await page.locator("#searchTab").boundingBox(); await page.touchscreen.tap(t.x + t.width / 2, t.y + t.height / 2); }
    await page.fill("#q", "Alma 32:13"); await page.press("#q", "Enter");
    await page.waitForSelector("#reader .doc .verse", { timeout: 20000 }); await page.waitForTimeout(900);
    if (!(await page.locator('#reader .doc a.study-note-ref[href$="#note13_b"]').count())) { console.log(`footnote-return ${name}: skipped, the test library has no footnotes in Alma 32`); await ctx.close(); continue; }
    const scrollOf = () => page.evaluate(() => Math.round((document.querySelector("#reader .doc").closest(".pane")?.scrollTop || 0) + window.scrollY));
    const tapWord = async (id) => {
      const a = page.locator(`#reader .doc a.study-note-ref[href$="#${id}"]`).first();
      const b = await a.boundingBox();
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(800);
    };
    const sheet = () => page.evaluate(() => { const s = document.querySelector("#sheet"); return { open: !s.hidden, word: document.querySelector(".fn-word")?.textContent || "", mark: document.querySelector(".fn-mark")?.textContent || "", count: document.querySelector(".fn-count")?.textContent || "", hash: location.hash, hist: history.length }; });
    await page.evaluate(() => document.querySelector('#reader .doc a.study-note-ref[href$="#note13_b"]').scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    const y0 = await scrollOf();
    await tapWord("note13_b");
    await page.evaluate(() => document.querySelectorAll(".fn-chip")[1].click()); await page.waitForTimeout(900);
    const a = await sheet();
    check(a.open && a.count === "2 of 5", `${name}: the second reference is up (${JSON.stringify(a)})`);
    // Open: the chapter of that reference, sheet down
    const open = await page.locator(".fn-page:not([inert]) .peek-row .primary").boundingBox();
    await page.touchscreen.tap(open.x + open.width / 2, open.y + open.height / 2);
    await page.waitForFunction(() => document.querySelector("#sheet").hidden && /3 Nephi 15|3-ne/.test(document.title + location.hash + (document.querySelector("#reader .reader-bar")?.textContent || "")), null, { timeout: 15000 }).catch(() => {});
    const b = await sheet();
    check(!b.open && b.hash !== a.hash, `${name}: Open goes to the chapter (${b.hash})`);
    // Back: the first chapter, at its place, with the note up at the reference left
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector("#sheet").hidden && document.querySelector(".fn-count")?.textContent === "2 of 5", null, { timeout: 15000 }).catch(() => {});
    const c = await sheet();
    check(c.open && c.word === "endureth" && c.count === "2 of 5" && c.hash === a.hash, `${name}: Back returns to the chapter with the note up at 2 of 5 (${JSON.stringify(c)})`);
    check(Math.abs((await scrollOf()) - y0) < 40, `${name}: and the chapter is where it was (${y0}, ${await scrollOf()})`);
    await page.waitForSelector(".fn-page:not([inert]) .nm", { timeout: 8000 }).catch(() => {});
    const shown = await page.evaluate(() => document.querySelector(".fn-page:not([inert]) .nm")?.textContent || "");
    check(/3 Nephi 15:9/.test(shown), `${name}: the reference itself is showing (${shown})`);
    // Back again closes the sheet and stays; it does not come up a second time
    await page.goBack(); await page.waitForTimeout(700);
    const d = await sheet();
    check(!d.open && d.hash === a.hash, `${name}: the next Back closes the sheet and stays in the chapter (${JSON.stringify(d)})`);
    // Forward after the close: not onto an empty step
    await page.goForward(); await page.waitForTimeout(700);
    const e = await sheet();
    await page.goBack(); await page.waitForTimeout(700);
    const f = await sheet();
    check(!e.open && e.hash === a.hash && e.hist === d.hist, `${name}: Forward after the close leaves the chapter as it is (${JSON.stringify(e)})`);
    check(f.hash !== a.hash || !f.open, `${name}: and the next Back is a real step (${JSON.stringify(f)})`);
    // a tap outside, on another footnoted word: that note, in one tap
    await page.goto(BASE + a.hash); await page.waitForSelector("#reader .doc .verse", { timeout: 20000 }); await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector('#reader .doc a.study-note-ref[href$="#note12_a"]').scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    await tapWord("note12_a");
    const g = await sheet();
    check(g.open, `${name}: a note is up (${JSON.stringify(g)})`);
    // another footnoted word still in view outside the sheet
    const spot = await page.evaluate(() => {
      const s = document.querySelector("#sheet").getBoundingClientRect();
      const bar = document.querySelector("#reader .reader-bar")?.getBoundingClientRect().bottom || 0;
      for (const a of document.querySelectorAll("#reader .doc a.study-note-ref")) {
        if (/#note12_a$/.test(a.getAttribute("href"))) continue;
        const r = a.getBoundingClientRect();
        const clear = r.top > bar + 8 && (r.bottom < s.top - 8 || r.right < s.left - 8) && r.left > 0;
        if (clear) return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: a.getAttribute("href").split("#").pop() };
      }
      return null;
    });
    if (spot) {
      await page.touchscreen.tap(spot.x, spot.y); await page.waitForTimeout(800);
      const h = await sheet();
      const now = await page.evaluate(() => document.querySelector("#sheet").getAttribute("aria-label"));
      check(h.open && h.mark !== g.mark && h.hist === g.hist, `${name}: a tap on another footnoted word (${spot.id}) shows its note at once, with no new step (${JSON.stringify(g)} then ${JSON.stringify(h)}; ${now})`);
    } else console.log(`footnote-return ${name}: no other footnoted word in view outside the sheet; not tapped`);
    // a tap outside on plain text closes it
    await page.touchscreen.tap(viewport.width < 760 ? 200 : 300, 300); await page.waitForTimeout(600);
    check(!(await sheet()).open, `${name}: a tap outside on plain words closes the sheet`);
    await ctx.close();
  }
  return errors;
}
