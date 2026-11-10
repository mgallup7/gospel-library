import fs from "node:fs";
// deck-undo: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
// An add from the selection bar can be undone from its toast; the header shows the count; an empty
// deck shows only how to add a passage, and the themes and actions come with the first one.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-undo/";
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 300)}`); });
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const shot = (l) => page.screenshot({ path: `${OUT}${name}-${l}.png` });
    const visible = (sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((n) => n.offsetParent !== null), sel);
    const badge = () => page.evaluate(() => document.querySelector("#deckBtn .deck-count")?.textContent || "");
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForTimeout(600);

    // the empty deck: one sentence, no themes, no Download
    await page.click("#deckBtn");
    await page.waitForSelector(".board .board-empty", { timeout: 10000 });
    await page.waitForTimeout(300);
    check(!(await visible(".board .themes")), "the empty deck should not show the theme chooser");
    check(!(await page.evaluate(() => [...document.querySelectorAll(".board button")].some((b) => /Download|Present/.test(b.textContent) && b.offsetParent !== null))), "the empty deck should not show Download or Present");
    check(await visible(".board .board-empty p"), "the empty deck should say how to add a passage");
    check(!(await visible(".board .deck-hint")), "the empty deck should show one message, not a second hint");
    await shot("01-empty");

    async function openAndSelect() {
      await page.fill("#q", "Alma 32:21"); await page.press("#q", "Enter");
      await page.waitForTimeout(800);
      const jump = await page.$("#list .jump");
      if (jump && viewport.width < 760 && await jump.isVisible()) await jump.click(); // Enter opens the page on the phone too
      await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
      await page.waitForTimeout(400);
      await page.click("#reader .doc #p21");
      await page.waitForSelector("#reader .select-bar .add-deck");
    }
    await openAndSelect();
    // on a phone the selection bar stays on one row: dots, Note, + Deck, Copy, clear
    if (viewport.width < 760) {
      const rows = await page.evaluate(() => {
        const kids = [...document.querySelectorAll("#reader .select-bar > *")].filter((n) => n.offsetParent !== null);
        return new Set(kids.map((n) => Math.round(n.getBoundingClientRect().top + n.getBoundingClientRect().height / 2))).size;
      });
      check(rows === 1, `the selection bar should fit on one row at 393px (${rows} rows)`);
    }
    await shot("02-selected");
    await page.click("#reader .select-bar .add-deck");
    await page.waitForTimeout(150);
    check(await page.evaluate(() => window.Deck.count()) === 1, "one passage should be on the deck");
    check(await badge() === "1", `the header should show 1 (shows "${await badge()}")`);
    const undo = await page.$(".toast[role=status] button.toast-action");
    check(!!undo && (await undo.textContent()) === "Undo", "the toast should carry an Undo button");
    await shot("03-toast");
    if (undo) {
      await undo.click();
      await page.waitForTimeout(150);
      check(await page.evaluate(() => window.Deck.count()) === 0, "Undo should take the passage off");
      check(await badge() === "", "the header should drop the count after Undo");
      check(await page.evaluate(() => document.querySelector("#deckBtn").textContent.trim()) === "Deck", "the header button should read Deck again");
    }

    // add it again: the themes and the actions appear
    await page.click("#reader .doc #p21");
    await page.waitForSelector("#reader .select-bar .add-deck");
    await page.click("#reader .select-bar .add-deck");
    await page.waitForTimeout(150);
    check(await badge() === "1", "the header should show 1 after adding again");
    // a toast after the toast's own time is gone, so the Undo does not linger (the pointer moves off it:
    // a pointer resting on the toast holds it, by design)
    await page.mouse.move(5, 5);
    await page.waitForTimeout(5600);
    check(!(await page.$(".toast.show")), "the toast should go after about five seconds");
    await page.click("#deckBtn");
    await page.waitForSelector(".board .bcard", { timeout: 10000 });
    await page.waitForTimeout(300);
    check(await visible(".board .themes"), "the theme chooser should show once a passage is on");
    check(await page.evaluate(() => [...document.querySelectorAll(".board .board-row button")].some((b) => /PowerPoint/.test(b.textContent) && b.offsetParent !== null)), "Download PowerPoint should show once a passage is on");
    check(await page.evaluate(() => !!document.querySelector(".bcard .bc-grip svg") && !!document.querySelector(".bcard .bc-tools .bc-more svg")), "the card's handle and its more button should be drawn as icons");
    await shot("04-board");
    // remove from the board: the header count follows at once
    await page.click(".bcard .bc-more");
    await page.click(".bcard .bc-menu button:has-text('Remove from the deck')");
    await page.waitForTimeout(150);
    check(await badge() === "", "removing on the board should clear the header count");
    await ctx.close();
  }
  return errors;
}
