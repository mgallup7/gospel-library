import fs from "node:fs";
// words: the Hebrew tiles' legend, a word's grammar line, its counts, and the word as a deck note.
// Run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "words/";
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const check = (cond, msg) => { if (!cond) errors.push(`${name}: ${msg}`); };
    page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 200)}`); });
    try {
      await page.goto(BASE);
      await page.fill("div.setup input", PASS);
      await page.press("div.setup input", "Enter");
      await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
      const chapter = async (ref) => {
        await box(page, ref); await page.press("#q", "Enter");
        await page.waitForTimeout(700);
        const jump = await page.$("#list .jump"); if (jump && await jump.isVisible()) await jump.click();
        await page.waitForFunction((t) => document.querySelector("#reader .doc h1")?.textContent.includes(t), ref, { timeout: 15000 });
        // the tiles come back by themselves once shown (the choice is remembered); give them a moment first
        if (!(await page.waitForSelector("#reader .orig .ow", { timeout: 3000 }).catch(() => null))) {
          const top = await page.$("#reader .reader-bar .orig-btn");
          if (top && await top.isVisible()) await top.click(); else { await page.click("#reader .reader-bar .size-pop-btn"); await page.click("#reader .reader-bar .size-menu .menu-orig"); } // Hebrew or Greek, in the bar's menu on a phone
        }
        await page.waitForSelector("#reader .orig .ow", { timeout: 15000 });
      };
      const tile = async (translit) => {
        const t = page.locator("#reader .orig .ow", { has: page.locator(".t", { hasText: new RegExp(`^${translit}$`) }) }).first();
        await t.scrollIntoViewIfNeeded(); await t.click();
        await page.waitForSelector("#sheet:not([hidden]) .ow-section", { timeout: 8000 });
        await page.waitForTimeout(500);
        return page.textContent("#sheet .ow-details");
      };

      // Genesis 1:1: the preposition's example is one list, the object marker has none
      await chapter("Genesis 1");
      let text = await tile("be.re.Shit");
      check(/Preposition: a relationship[^,]*, as in “of, from, by, in”/i.test(text), `be.re.Shit grammar: ${text.slice(0, 200)}`);
      const grammar = await page.textContent("#sheet .ow-section");
      check(!/":|\(\(|\)\)/.test(grammar), `be.re.Shit grammar still garbled: ${grammar}`);
      await page.screenshot({ path: `${OUT}${name}-01-grammar.png` });
      await page.click("#sheet .close");
      text = await tile("'et");
      check(/Object indicator/.test(text) && !/\( \)|\(\(/.test(text), `'et grammar: ${text.slice(0, 160)}`);
      await page.click("#sheet .close");

      // the legend names the marks the tiles use
      const legendBtn = page.locator("#reader .orig-legend-btn");
      await legendBtn.scrollIntoViewIfNeeded(); await legendBtn.click();
      await page.waitForSelector("#sheet:not([hidden]) .legend li");
      const legend = await page.textContent("#sheet .legend");
      for (const want of ["<angle brackets>", "<obj.>", "rest<s>", "be.re.Shit", "glossers", "aleph", "ayin", "shepherd my"]) check(legend.includes(want), `legend lacks ${want}`);
      check(!/translators supplied|be\.re\.SHIT/.test(legend), "legend keeps the old wording");
      await page.screenshot({ path: `${OUT}${name}-02-legend.png` });
      await page.click("#sheet .close");

      // Psalm 51:1, hesed: each count named, the forms folded, the word onto the deck as a note
      await chapter("Psalm 51");
      text = await tile("ke.chas.De.kha");
      const counts = await page.textContent("#sheet .ow-counts");
      check(/245 occurrences of this sense \(H2617A\) in 239 verses; 247 occurrences of H2617 in all its senses, in 241 verses/.test(counts), `counts: ${counts}`);
      check(/Rendered: covenant loyalty \(\d+\)/.test(counts) && !/covenant loyalty (his|your)/.test(counts), `rendered: ${counts}`);
      await page.screenshot({ path: `${OUT}${name}-03-counts.png` });
      const before = await page.evaluate(() => window.Deck.state.items.length);
      await page.click("#sheet .ow-to-deck button");
      await page.waitForTimeout(300);
      const card = await page.evaluate(() => window.Deck.state.items.at(-1));
      check(card && card.type === "note" && /ke\.chas\.De\.kha/.test(card.text) && /H2617A/.test(card.text) && /covenant loyalty/.test(card.text), `note card: ${JSON.stringify(card)}`);
      await page.screenshot({ path: `${OUT}${name}-04-note-toast.png` });
      await page.click(".toast button");
      await page.waitForTimeout(300);
      check(await page.evaluate(() => window.Deck.state.items.length) === before, "Undo left the note on the deck");
    } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); await page.screenshot({ path: `${OUT}${name}-failed.png` }).catch(() => {}); }
    await ctx.close();
  }
  return errors;
}
