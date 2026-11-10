// focus: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  await box(page, "Alma 32:21"); await page.press("#q", "Enter");
  // Enter on a reference opens the chapter at the verse on the phone too
  await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.className);
  check(/trail-back/.test(focused), `Back should have focus on the phone after opening a page (got ${focused})`);
  // keyboard selection
  await page.focus("#reader .doc #p22");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector("#reader .doc #p22").classList.contains("sel")), "Enter should select a verse");
  // a sheet takes focus and gives it back
  await page.click("#reader .select-bar button:has-text('Note')");
  await page.waitForSelector("#sheet:not([hidden])");
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.activeElement?.classList.contains("note-text")), "the note sheet should focus its textarea");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector("#sheet").hidden), "Escape closes the sheet");
  const after = await page.evaluate(() => document.activeElement?.textContent?.trim());
  check(after === "Note", `focus should return to the Note button (got ${after})`);
  // the stage
  await readerTool(page, "Present", "#reader .reader-bar .icon-btn[aria-label='Present']"); // in the bar's menu on a phone
  await page.waitForSelector(".stage:not([hidden])");
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.activeElement?.id === "stage"), "the stage should take focus");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.activeElement && /^(Present|Text size and more)$/.test(document.activeElement.getAttribute("aria-label") || "")), `focus returns to Present, or to the menu that held it (${await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 80))})`);
  return errors;
}
