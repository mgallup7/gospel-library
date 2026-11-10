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
          if (top && await top.isVisible()) await top.click(); else { await page.click("#reader .reader-bar .size-pop-btn"); await page.click("#reader .reader-bar .size-menu .menu-orig"); } // in the bar's menu on a phone
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
      // its glosses fold as the Hebrew ones do, and its lexicon entry is an outline with no raw marks
      const counts = await page.textContent("#sheet .ow-counts");
      check(/Rendered: confidence \(2\), assurance \(2\), substance \(1\)\./.test(counts), `hupostasis rendered: ${counts}`);
      const def = await page.evaluate(() => ({ text: document.querySelector("#sheet .ow-def").textContent, marks: [...document.querySelectorAll("#sheet .ow-outline > li > .ow-mark")].map((b) => b.textContent),
        refs: document.querySelectorAll("#sheet .ow-outline a.oref").length, tail: document.querySelector("#sheet .ow-def-tail")?.textContent }));
      check(!def.text.includes("__"), `raw marks in the definition: ${def.text.slice(0, 200)}`);
      check(def.marks.join(" ") === "1. 2. 3." && def.refs >= 3 && def.tail === "(AS)", `hupostasis outline: ${JSON.stringify(def.marks)} refs ${def.refs} tail ${def.tail}`);
      await page.screenshot({ path: `${OUT}${name}-01-hupostasis.png` });
      await page.evaluate(() => document.querySelector("#sheet .ow-def").scrollIntoView({ block: "center" }));
      await page.screenshot({ path: `${OUT}${name}-01b-outline.png` });
      await page.click("#sheet .close");

      // Habakkuk 2:4, emunah with its preposition and its suffix
      await chapter("Hab.2.4", "Habakkuk 2", "Hebrew");
      text = await tile(".g", /faithfulness his/);
      grammar = await page.textContent("#sheet .ow-section");
      check(/\(feminine in grammar\)/.test(grammar) && /Lexicon, Strong's H0530/.test(text), `emunah grammar: ${grammar}`);
      check(!/\b(fe)?males?\b/i.test(grammar), `emunah is still called female: ${grammar}`);
      await page.screenshot({ path: `${OUT}${name}-02-emunah.png` });
      await page.click("#sheet .close");

      // an English word offers its Hebrew and Greek: the engine's count, then the line and the sheet
      const behind = (word) => page.evaluate((w) => window.GL.api("originalsFor", { word: w }), word);
      const names = (r) => r.words.map((w) => `${w.word}: ${w.lemmas.map((l) => `${l.name} ${l.strongs} ${l.lang}`).join(", ")}`).join(" | ");
      const faith = await behind("faith");
      check(names(faith) === "faith: pistis G4102 gr, pistos G4103 gr, oligopistos G3640 gr, emet H0571 he, emunah H0530 he, chasid H2623 he", `originalsFor faith: ${names(faith)}`);
      const pistis = faith.words[0].lemmas[0];
      check(pistis.n === 241 && pistis.occurrences === 243 && pistis.lemma.normalize("NFC") === "πίστις".normalize("NFC") && pistis.language === "Greek", `pistis: ${JSON.stringify(pistis)}`);
      check(names(await behind("Covenant")) === "covenant: diatheke G1242 gr, berit H1285 he, chesed H2617 he", `originalsFor covenant: ${names(await behind("covenant"))}`);
      const life = await behind("eternal life");
      check(life.words.length === 2 && life.words[0].lemmas[0].name === "aionios" && life.words[1].lemmas[0].name === "zoe", `originalsFor eternal life: ${names(life)}`);
      // the article is glossed "the son" a few times in twenty thousand: not the word behind "son"
      check(/^son: uhios G5207 gr, teknon G5043 gr, uhiothesia G5206 gr, ben H1121 he/.test(names(await behind("son"))), `originalsFor son: ${names(await behind("son"))}`);
      for (const none of ["the", "and it came", "John 3:16", "H2617", "faith hope charity", "\"faith\"", "אמונה", "zzzq", "", "o'"]) {
        const r = await behind(none);
        check(r && r.words.length === 0, `originalsFor ${JSON.stringify(none)} should offer nothing: ${names(r)}`);
      }
      // the line under the search, where renderResults puts it, and the word's sheet from it
      if (!(await page.isVisible("#q"))) { await page.click("#searchTab"); await page.waitForTimeout(400); }
      await page.fill("#q", "faith"); await page.press("#q", "Enter");
      await page.waitForSelector("#list .orig-behind-slot .orig-behind", { timeout: 15000 });
      check(await page.locator("#list .orig-behind").count() === 1, "one search should draw the offer once");
      await page.evaluate(() => window.Original.offerFor("faith", document.createElement("div"))); // off the page: nothing, no error
      const line = await page.textContent("#list .orig-behind-slot .orig-behind");
      check(line === "Behind this word: pistis (Greek, 241),pistos (Greek, 49),oligopistos (Greek, 5),emet (Hebrew, 73),emunah (Hebrew, 46),chasid (Hebrew, 33)", `the offer: ${line}`);
      await page.screenshot({ path: `${OUT}${name}-03-behind.png` });
      await page.click("#list .orig-behind-slot button:has-text('emunah')");
      await page.waitForSelector("#sheet:not([hidden]) .ow-section", { timeout: 8000 });
      await page.waitForTimeout(400);
      const sheetText = await page.textContent("#sheet .sheet-body");
      check(/אֱמוּנָה/.test(sheetText) && /Read as “faith” \(or a form of it\) in 46 of its 49 occurrences/.test(sheetText) && /Lexicon, Strong's H0530/.test(sheetText) && /All 49 verses with this word/.test(sheetText), `emunah's sheet from the offer: ${sheetText.slice(0, 300)}`);
      await page.screenshot({ path: `${OUT}${name}-04-behind-sheet.png` });
      await page.click("#sheet .close");
    } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); await page.screenshot({ path: `${OUT}${name}-failed.png` }).catch(() => {}); }
    await ctx.close();
  }
  return errors;
}
