import fs from "node:fs";
// tiles-legend: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "legend/";
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  await box(page, "Psalm 23"); await page.press("#q", "Enter");
  await page.waitForTimeout(800);
  const jump = await page.$("#list .jump"); if (jump && await jump.isVisible()) await jump.click(); // Enter opens it on both sizes now
  await page.waitForSelector("#reader .doc", { timeout: 15000 });
  await readerTool(page, "Hebrew", "#reader .reader-bar .orig-btn"); // in the bar's menu on a phone
  await page.waitForSelector("#reader .orig .ow", { timeout: 15000 });
  await page.waitForTimeout(500);
  // the legend
  const legend = await page.$("#reader .orig-credit .orig-legend-btn");
  if (!legend) errors.push("legend button missing");
  await legend.scrollIntoViewIfNeeded(); await legend.click();
  await page.waitForSelector("#sheet:not([hidden]) .legend li", { timeout: 5000 });
  if ((await page.locator("#sheet .legend li").count()) < 5) errors.push("legend too short");
  await page.screenshot({ path: OUT + "01-legend.png" });
  await page.click("#sheet .close");
  // a tile: the stress note
  await page.click("#reader .orig .ow >> nth=0");
  await page.waitForSelector("#sheet:not([hidden]) .ow-head", { timeout: 5000 });
  await page.waitForTimeout(800);
  const translit = await page.textContent("#sheet .ow-translit");
  const stress = await page.$("#sheet .ow-stress");
  if (/[A-Z]/.test(translit) && !stress) errors.push(`stress note missing for ${translit}`);
  await page.screenshot({ path: OUT + "02-word.png" });
  console.log("translit:", translit, "| helps:", await page.locator("#sheet .ow-helps .chip").count());
  await ctx.close(); 
  return errors;
}
