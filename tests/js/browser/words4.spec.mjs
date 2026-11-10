import fs from "node:fs";
// words4: the word sheet says gender as grammar (hupostasis in Hebrews 11:1, emunah in Habakkuk 2:4).
// Run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "words4/";
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
      // a chapter by its reference through the engine, then its Hebrew or Greek tiles
      const chapter = async (ref, title, lang) => {
        const at = await page.evaluate((r) => window.GL.api("locate", { ref: r }), ref);
        await page.evaluate((d) => window.GL.openDoc(d.doc_id, d.pid), at);
        await page.waitForFunction((t) => document.querySelector("#reader .doc h1")?.textContent.includes(t), title, { timeout: 15000 });
        if (!(await page.waitForSelector("#reader .orig .ow", { timeout: 3000 }).catch(() => null))) {
          const top = await page.$("#reader .reader-bar .orig-btn");
          if (top && await top.isVisible()) await top.click(); else await page.click(`#reader .reader-foot .foot-btn[aria-label='${lang}']`);
        }
        await page.waitForSelector("#reader .orig .ow", { timeout: 15000 });
      };
      const tile = async (part, pattern) => {
        const t = page.locator("#reader .orig .ow", { has: page.locator(part, { hasText: pattern }) }).first();
        await t.scrollIntoViewIfNeeded(); await t.click();
        await page.waitForSelector("#sheet:not([hidden]) .ow-section", { timeout: 8000 });
        await page.waitForTimeout(500);
        return page.textContent("#sheet .ow-details");
      };

      // Hebrews 11:1, hupostasis: a feminine noun is feminine in grammar, nothing is called female
      await chapter("Heb.11.1", "Hebrews 11", "Greek");
      let text = await tile(".t", /^hupostasis$/);
      let grammar = await page.textContent("#sheet .ow-section");
      check(/Noun Nominative Singular Feminine: a person or thing that is doing something \(feminine in grammar\)/.test(grammar), `hupostasis grammar: ${grammar}`);
      check(!/\b(fe)?male\b/i.test(grammar), `hupostasis is still called female: ${grammar}`);
      await page.screenshot({ path: `${OUT}${name}-01-hupostasis.png` });
      await page.click("#sheet .close");

      // Habakkuk 2:4, emunah with its preposition and its suffix
      await chapter("Hab.2.4", "Habakkuk 2", "Hebrew");
      text = await tile(".g", /faithfulness his/);
      grammar = await page.textContent("#sheet .ow-section");
      check(/\(feminine in grammar\)/.test(grammar) && /Lexicon, Strong's H0530/.test(text), `emunah grammar: ${grammar}`);
      check(!/\b(fe)?males?\b/i.test(grammar), `emunah is still called female: ${grammar}`);
      await page.screenshot({ path: `${OUT}${name}-02-emunah.png` });
      await page.click("#sheet .close");
    } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); await page.screenshot({ path: `${OUT}${name}-failed.png` }).catch(() => {}); }
    await ctx.close();
  }
  return errors;
}
