import fs from "node:fs";
// deck-stage: the board and the stage as the owner sees them, at iPad and phone sizes, light and
// dark. A highlighted phrase is one run; the empty deck hides its title fields; a question slide
// has its kicker and rule; the timer and Next line can be hidden and stay hidden; Close is away
// from the timer; the stage cleans the HTML it is given. Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-stage/";
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  const check = (c, m) => { if (!c) errors.push(m); };
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  await page.evaluate(() => window.Deck.ready);

  // the empty deck: no title or subtitle until the first card, or a tap on "Name this deck"
  await page.click("#deckBtn");
  await page.waitForSelector(".board .board-empty", { timeout: 10000 });
  check(!(await page.isVisible(".board .deck-title")) && !(await page.isVisible(".board .deck-subtitle")), "an empty deck should hide its title and subtitle");
  await page.screenshot({ path: OUT + "ipad-light-00-empty.png" });
  await page.click(".board button:has-text('Name this deck')");
  check(await page.isVisible(".board .deck-title"), "Name this deck should show the title field");
  check(await page.evaluate(() => document.activeElement?.classList.contains("deck-title")), "Name this deck should put the cursor in the title");

  // a deck with a highlighted phrase, a question and slide text
  await page.evaluate(async () => {
    const D = window.Deck;
    D.addPassage({ doc_id: 1316, pid: "p21", kind: "verse", verses: [{ n: 21, text: "And now as I said concerning faith faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true." }], citation: "Alma 32:21" });
    D.addPassage({ doc_id: 2, pid: "p1", kind: "verse", verses: [{ n: 1, text: "Now faith is the substance of things hoped for, the evidence of things not seen." }], citation: "Hebrews 11:1" });
    const [a, b] = D.state.items;
    D.setHighlight(a.id, 7, 12);
    D.state.title = "Faith Is a Seed"; D.state.subtitle = "Zone conference";
    D.state.items.push({ id: "q1", type: "question", text: "What has faith asked of you this transfer?", notes: "" });
    D.state.items.push({ id: "n1", type: "note", text: "Pause here. Let them answer.", notes: "" });
    D.link({ id: a.id, hl: D.state.items[0].hl[0].id }, { id: b.id, hl: null }, "defines");
    await D.flush();
  });

  for (const [vpName, vp] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${vpName}-${scheme}`;
      await page.setViewportSize(vp);
      await page.emulateMedia({ colorScheme: scheme });
      await page.click("#homeBtn").catch(() => {});
      await page.waitForTimeout(300);
      await page.click("#deckBtn");
      await page.waitForSelector(".board .bcard .w.hl", { timeout: 10000 });
      await page.waitForTimeout(400);
      // the phrase: one run with the spaces inside it
      const run = await page.evaluate(() => {
        const runs = [...document.querySelectorAll(".board .bcard .hl-run")];
        const r = runs[0];
        return { runs: runs.length, words: r ? r.querySelectorAll(".w").length : 0, text: r ? r.textContent : "", boxes: r ? r.getClientRects().length : 0 };
      });
      check(run.runs === 1 && run.words === 6, `${tag}: one run of six words, got ${JSON.stringify(run)}`);
      check(/faith is not to have a/.test(run.text), `${tag}: the run should hold the words with their spaces: ${run.text}`);
      await page.click(".board .bcard .hl-run .w >> nth=2");
      await page.waitForTimeout(200);
      check(await page.evaluate(() => !!document.querySelector(".board .bcard .hl-run.active")), `${tag}: the active phrase should outline the run`);
      await page.locator(".board .bcard").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}${tag}-01-board.png` });
      await page.locator(".board .board-foot").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}${tag}-02-foot.png` });
      await page.click(".board .hl-tools button:has-text('Done')").catch(() => {});

      // present, to the question slide
      await page.evaluate(() => window.Deck.present());
      await page.waitForSelector(".stage:not([hidden])", { timeout: 5000 });
      for (let i = 0; i < 12 && !(await page.evaluate(() => document.querySelector(".stage-body").classList.contains("is-question"))); i++) await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(2800); // the controls fade, as the room sees it
      check(await page.isVisible(".stage .stage-kicker"), `${tag}: the question slide should show its kicker`);
      await page.screenshot({ path: `${OUT}${tag}-03-question.png` });
      await page.mouse.move(vp.width / 2, vp.height / 2);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${OUT}${tag}-03-question-controls.png` });
      await page.keyboard.press("ArrowRight");
      check(await page.evaluate(() => document.querySelector(".stage .stage-kicker").hidden), `${tag}: slide text should not show the Question kicker`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
  }

  // the stage controls: 44 px, Close away from the timer, the speaker lines hidden and remembered
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.evaluate(() => window.Deck.present());
  await page.waitForSelector(".stage:not([hidden])", { timeout: 5000 });
  await page.mouse.move(600, 400);
  const geo = await page.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const small = [...document.querySelectorAll(".stage-controls button")].filter((b) => getComputedStyle(b).display !== "none" && (b.getBoundingClientRect().width < 44 || b.getBoundingClientRect().height < 44)).map((b) => b.className);
    const t = r(".stage-timer"), c = r(".stage-close");
    return { small, gap: Math.max(c.left - t.right, t.left - c.right) };
  });
  check(!geo.small.length, `stage controls under 44 px: ${geo.small.join(", ")}`);
  check(geo.gap > 150, `Close should sit well away from the timer (gap ${Math.round(geo.gap)} px)`);
  await page.click(".stage .stage-speaker");
  check(!(await page.isVisible(".stage .stage-timer")) && !(await page.isVisible(".stage .stage-upnext")), "the speaker toggle should hide the timer and the Next line");
  await page.screenshot({ path: OUT + "ipad-light-04-speaker-hidden.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForFunction(() => window.GL?.ready && window.Deck, null, { timeout: 60000 });
  await page.evaluate(() => window.Deck.ready);
  await page.evaluate(() => window.Deck.present());
  await page.waitForSelector(".stage:not([hidden])", { timeout: 5000 });
  await page.mouse.move(600, 400);
  check(!(await page.isVisible(".stage .stage-timer")), "the hidden timer should stay hidden after a reload");
  await page.click(".stage .stage-speaker");
  check(await page.isVisible(".stage .stage-timer"), "a second tap should bring the timer back");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // the stage cleans what it is handed
  const dirty = await page.evaluate(async () => {
    window.__ran = false;
    window.GL.startPresentingUnits([{ kind: "para", html: `Words <img src="data:image/gif;base64,R0lG" onerror="window.__ran = true"><a href="javascript:window.__ran=true">link</a><script>window.__ran = true</script>` }]);
    await new Promise((r) => setTimeout(r, 300));
    const t = document.querySelector(".stage-text");
    const out = { ran: window.__ran, onerror: !!t.querySelector("[onerror]"), js: !!t.querySelector("a[href^='javascript']"), script: !!t.querySelector("script") };
    return out;
  });
  check(!dirty.ran && !dirty.onerror && !dirty.js && !dirty.script, `the stage should sanitize its HTML: ${JSON.stringify(dirty)}`);
  await page.keyboard.press("Escape");
  await ctx.close();
  return errors;
}
