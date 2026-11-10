import fs from "node:fs";
// deck-open: a card's citation opens its chapter at the verse (in the Page pane on an iPad, with
// the switch back to the deck; on a phone Back returns to the deck), and the PowerPoint is built
// when Download is about to be pressed, not a few seconds after every edit.
// Run by tests/js/browser/run.mjs.
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-open/";
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 300)}`); });
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const wide = viewport.width >= 760;
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.evaluate(() => window.Deck.ready);

    // a real passage: Alma 32:21 from the reader, then another page, so the citation has somewhere to go
    await box(page, "Alma 32:21"); await page.press("#q", "Enter");
    await page.waitForTimeout(800);
    const jump = await page.$("#list .jump");
    if (jump && !wide && await jump.isVisible()) await jump.click();
    await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.click("#reader .doc #p21");
    await page.click("#reader .select-bar .add-deck");
    await page.waitForTimeout(200);
    await box(page, "Ether 12:6"); await page.press("#q", "Enter");
    await page.waitForTimeout(800);
    const jump2 = await page.$("#list .jump");
    if (jump2 && !wide && await jump2.isVisible()) await jump2.click();
    await page.waitForSelector("#reader .doc #p6", { timeout: 15000 });
    await page.click("#deckBtn");
    await page.waitForSelector(".board .bcard .bc-cite", { timeout: 10000 });
    check(await page.evaluate(() => document.querySelector(".board").offsetParent !== null), "the board should be showing");

    // the citation is a button, and opens Alma 32 at verse 21
    check(await page.evaluate(() => document.querySelector(".board .bcard .bc-cite").tagName === "BUTTON"), "a card's citation should be a button");
    await page.click(".board .bcard .bc-cite");
    await page.waitForFunction(() => { const r = document.querySelector("#reader"); return r && !r.hidden && /Alma 32/.test(r.textContent) && !!r.querySelector(".doc #p21"); }, null, { timeout: 15000 });
    await page.waitForTimeout(500);
    const at = await page.evaluate(() => { const p = document.querySelector("#reader .doc #p21"); const r = p.getBoundingClientRect(); return { inView: r.top >= 0 && r.top < window.innerHeight, hash: location.hash }; });
    check(at.inView, "the chapter should open at the verse");
    check(/p21/.test(at.hash), `the address should name the verse: ${at.hash}`);
    await page.screenshot({ path: `${OUT}${name}-01-opened.png` });
    if (wide) {
      check(await page.evaluate(() => document.querySelector("#panel").hidden), "on an iPad the page should take the pane from the board");
      await page.click(".pane-switch button:has-text('Deck')");
      await page.waitForTimeout(200);
      check(await page.evaluate(() => document.querySelector(".board").offsetParent !== null), "the Page | Deck switch should bring the board back");
    } else {
      await page.goBack();
      await page.waitForSelector(".board .bcard", { timeout: 10000 });
      check(await page.evaluate(() => document.querySelector(".board").offsetParent !== null), "Back should return to the deck on a phone");
    }

    // while linking, the citation of another card is a place to link to, not a way out
    if (wide) {
      await page.evaluate(() => { const d = window.Deck.state; const a = d.items[0]; window.Deck.setHighlight(a.id, 2, 4); });
      await page.evaluate(async () => { const doc = await window.GL.api("doc", { id: window.Deck.state.items[0].doc_id }); window.Deck.addFromDoc(doc, [{ pid: "p26", kind: "verse", verse: 26, text: "Now, as I said concerning faith, that it was not a perfect knowledge, even so it is with my words." }]); });
      await page.waitForTimeout(300);
      await page.click(".board .bcard .hl-run .w");
      await page.click(".board .bcard .hl-tools button:has-text('Link to')");
      await page.click(".board .bcard:nth-of-type(2) .bc-cite");
      await page.waitForTimeout(400);
      const linked = await page.evaluate(() => ({ links: window.Deck.state.links.length, whole: window.Deck.state.links[0]?.to.hl === null, board: document.querySelector(".board").offsetParent !== null }));
      check(linked.links === 1 && linked.whole && linked.board, `a tap on another card's citation while linking should link the whole passage and stay on the board: ${JSON.stringify(linked)}`);
      await page.keyboard.press("Escape");

      // the PowerPoint is not built behind an edit; it is built as the pointer comes to Download
      await page.waitForTimeout(4600);
      check((await page.textContent(".board-row .primary")) === "Download PowerPoint", "the file should not be built a few seconds after an edit");
      await page.hover(".board-row .primary");
      await page.waitForFunction(() => document.querySelector(".board-row .primary").textContent === "Save PowerPoint", null, { timeout: 15000 }).catch(() => {});
      check((await page.textContent(".board-row .primary")) === "Save PowerPoint", "the file should be built when the pointer comes to Download");
    }
    await ctx.close();
  }
  return errors;
}
