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
        await page.waitForFunction((t) => document.querySelector("#reader .reader-bar .crumb")?.textContent.includes(t), ref, { timeout: 15000 });
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
      if (!(await page.evaluate(() => document.querySelector("#sheet").hidden))) await page.click("#sheet .close");

      // Revelation 3:16, lukewarm: a color on the Greek word, kept with his marks under the word's own place
      await chapter("Revelation 3");
      const luke = page.locator("#reader .orig .ow", { has: page.locator(".t", { hasText: /^chliaros$/ }) }).first();
      await luke.scrollIntoViewIfNeeded(); await luke.click();
      await page.waitForSelector("#sheet:not([hidden]) .ow-colors", { timeout: 8000 });
      check((await page.getAttribute("#sheet .ow-colors .ow-none", "aria-pressed")) === "true", "a word with no color has None pressed");
      await page.screenshot({ path: `${OUT}${name}-05-word-colors.png` });
      await page.click("#sheet .ow-colors .hl-dot.hl-g");
      await page.waitForTimeout(400);
      check((await page.getAttribute("#sheet .ow-colors .hl-dot.hl-g", "aria-pressed")) === "true" && (await page.getAttribute("#sheet .ow-colors .ow-none", "aria-pressed")) === "false", "the chosen color is pressed in the sheet");
      const tileClass = () => luke.evaluate((t) => t.className);
      check(/\bhl-g\b/.test(await tileClass()), `the tile takes the color: ${await tileClass()}`);
      const wrec = await page.evaluate(async () => (await window.Marks.words(window.GL.reading.doc.uri))[0]);
      check(wrec && /^orig:revelation\.3\.16\.\d+:gr$/.test(wrec.id) && wrec.kind === "word" && wrec.color === "g" && /^χλιαρ.ς lukewarm/.test(wrec.text) && wrec.citation === "Revelation 3:16" && /^G\d+/.test(wrec.strongs), `the word's record: ${JSON.stringify(wrec)}`);
      check((await page.locator("#reader .orig .ow.marked").count()) === 1, "only that one tile is colored");
      await page.click("#sheet .close");
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}${name}-06-word-colored.png` });
      // reload: the tiles come back with their colors
      await page.reload();
      for (let i = 0; i < 5; i++) { // the old worker may still hold the storage for a moment: the app offers Try again
        const again = await page.waitForSelector("#reader .orig .ow, .setup button:has-text('Try again')", { timeout: 30000 });
        if ((await again.textContent()) === "Try again") { await page.waitForTimeout(800); await again.click(); continue; }
        break;
      }
      await page.waitForSelector("#reader .orig .ow.marked", { timeout: 30000 });
      check(/\bhl-g\b/.test(await tileClass()), `the color survives a reload: ${await tileClass()}`);
      // a change from another device is drawn on the tiles at once
      await page.evaluate(async (rec) => { await window.Marks.merge([{ ...rec, color: "p", updated: rec.updated + 5 }]); }, wrec);
      await page.waitForTimeout(400);
      check(/\bhl-p\b/.test(await tileClass()) && !/\bhl-g\b/.test(await tileClass()), `a merge recolors the tile: ${await tileClass()}`);
      // the list of marks names the word, and its row opens the chapter at the verse with the Greek showing,
      // though the Greek was put away meanwhile
      await page.evaluate(() => document.querySelector("#reader .reader-bar .orig-btn").click());
      await page.waitForFunction(() => !document.querySelector("#reader .orig"), null, { timeout: 5000 });
      await page.click("#homeBtn");
      await page.waitForSelector("#homeBody .shelf-grid", { timeout: 10000 });
      await page.waitForTimeout(400);
      await page.click("#homeBody .own-row:has-text('Highlights and notes')");
      await page.waitForSelector("#homeBody .mark-row.mk-word", { timeout: 10000 });
      const rowText = await page.evaluate(() => { const r = document.querySelector("#homeBody .mark-row.mk-word"); return [r.querySelector(".mk-cite").textContent, r.querySelector(".mk-text").textContent, r.className]; });
      check(/^Revelation 3:16, χλιαρ.ς lukewarm$/.test(rowText[0]) && rowText[1] === "Greek word, Strong's G5513" && /hl-p/.test(rowText[2]), `the word's row: ${JSON.stringify(rowText)}`);
      await page.screenshot({ path: `${OUT}${name}-07-word-in-list.png` });
      await page.click("#homeBody .mark-row.mk-word");
      await page.waitForSelector("#reader .doc .is-target", { timeout: 10000 });
      check((await page.getAttribute("#reader .doc .is-target", "id")) === "p16", "the word's row opens its verse");
      await page.waitForSelector("#reader .orig .ow.marked", { timeout: 10000 }).catch(() => {});
      check(/\bhl-p\b/.test(await tileClass().catch(() => "")), "and the Greek is showing again, the word colored");
      // None takes it off
      await luke.scrollIntoViewIfNeeded(); await luke.click();
      await page.waitForSelector("#sheet:not([hidden]) .ow-colors", { timeout: 8000 });
      await page.waitForTimeout(300);
      check((await page.getAttribute("#sheet .ow-colors .hl-dot.hl-p", "aria-pressed")) === "true", "the sheet shows the word's color");
      await page.click("#sheet .ow-colors .ow-none");
      await page.waitForTimeout(400);
      check(!/\bhl-|marked/.test(await tileClass()) && (await page.evaluate(async () => (await window.Marks.words(window.GL.reading.doc.uri)).length)) === 0, `None takes the color off: ${await tileClass()}`);
      await page.click("#sheet .close");
    } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); await page.screenshot({ path: `${OUT}${name}-failed.png` }).catch(() => {}); }
    await ctx.close();
  }
  return errors;
}
