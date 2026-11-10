import fs from "node:fs";
// papers-cite: on a Joseph Smith Papers page, Copy puts the same citation under the words that
// Cite copies (the paper's title, the manuscript page from the page markers, the Papers' address),
// never the shelf. Run by tests/js/browser/run.mjs, which hands over the browser, the address and the passphrase.
// Copy and Clear sit in the selection bar where it has room, and behind its "more" button where it has not (a phone)
const barDo = async (page, sel, item) => {
  const b = page.locator(`#reader .select-bar ${sel}`).first();
  if (await b.isVisible()) return b.click();
  await page.click("#reader .select-bar .sel-more-btn");
  await page.click(`#reader .select-bar .size-menu >> text=${item}`);
};
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "papers/";
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
    const page = await ctx.newPage();
    const check = (cond, msg) => { if (!cond) errors.push(`${name}: ${msg}`); };
    page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e}`));
    try {
      await page.goto(BASE);
      await page.fill("div.setup input", PASS);
      await page.press("div.setup input", "Enter");
      await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
      const open = async (uri) => {
        const id = await page.evaluate(async (u) => (await GL.api("doc", { uri: u })).id, uri);
        await page.evaluate((i) => GL.openDoc(i, null), id);
        await page.waitForSelector("#reader:not([hidden]) .doc h1", { timeout: 10000 });
        await page.waitForTimeout(400);
      };
      const clip = () => page.evaluate(() => navigator.clipboard.readText());
      // selected by keyboard (Enter on the paragraph), since a tap could land on a name's link
      const select = async (pids) => { for (const p of pids) { await page.focus(`#reader .doc #${p}`); await page.keyboard.press("Enter"); } await page.waitForSelector("#reader .select-bar"); };

      // the letter: one document, two manuscript pages marked [p. 56] and [p. 57]
      await open("/paper-summary/letter-to-emma-smith-4-june-1834");
      const pids = await page.$$eval("#reader .doc .body-block > p[id]", (ps) => ps.map((p) => p.id));
      const markers = await page.$$eval("#reader .doc .jsp-page", (ms) => ms.map((m) => m.textContent));
      check(markers.join(" ") === "[p. 56] [p. 57]", `letter markers: ${markers}`);
      await select([pids[0]]);
      await barDo(page, ".fold:has-text('Copy')", "Copy with the citation");
      await page.waitForTimeout(300);
      let text = await clip();
      check(/^On the banks of the Mississippi/.test(text) && /\n\n“Letter to Emma Smith, 4 June 1834,” p\. 56, The Joseph Smith Papers, accessed [A-Z][a-z]+ \d+, \d{4}, https:\/\/www\.josephsmithpapers\.org\/paper-summary\/letter-to-emma-smith-4-june-1834$/.test(text), `Copy on the letter: ${text}`);
      check(!/Joseph Smith Papers: Journals/.test(text), "Copy still cites the shelf");
      await page.screenshot({ path: `${OUT}${name}-01-letter-selected.png` });
      // Cite with the same paragraph selected gives the same citation
      const cite = { click: () => readerTool(page, "Cite", "#reader .reader-bar .cite-btn") }; // a button in the bar on an iPad, in its menu on a phone
      await cite.click();
      await page.waitForTimeout(300);
      const cited = await clip();
      check(text.endsWith(cited), `Cite and Copy differ: ${cited}`);
      // a paragraph on the second page, and both pages at once
      const last = pids[pids.length - 1];
      await barDo(page, ".clear-sel", "Clear selection");
      await select([last]);
      await cite.click(); await page.waitForTimeout(300);
      check(/” p\. 57,/.test(await clip()), `Cite on the second page: ${await clip()}`);
      await select([pids[0]]);
      await barDo(page, ".fold:has-text('Copy')", "Copy with the citation"); await page.waitForTimeout(300);
      check(/” pp\. 56–57,/.test(await clip()), `Copy over both pages: ${await clip()}`);
      await barDo(page, ".clear-sel", "Clear selection");

      // the December 1841 journal as this test library files it: no page markers, so no page
      await open("/paper-summary/journal-1832-1834");
      check(await page.locator("#reader .doc .jsp-page").count() === 0, "doc 1583 has page markers after all");
      await select(["p2"]);
      await barDo(page, ".fold:has-text('Copy')", "Copy with the citation"); await page.waitForTimeout(300);
      text = await clip();
      check(/\n\n“Journal, December 1841–December 1842,” The Joseph Smith Papers, accessed /.test(text), `Copy on the journal: ${text}`);
      await page.screenshot({ path: `${OUT}${name}-02-journal.png` });
    } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); await page.screenshot({ path: `${OUT}${name}-failed.png` }).catch(() => {}); }
    await ctx.close();
  }
  return errors;
}
