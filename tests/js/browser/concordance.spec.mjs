import fs from "node:fs";
// concordance: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "conc/";
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, vp] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 200)}`); });
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.fill("#q", "faith"); await page.press("#q", "Enter");
    await page.waitForSelector("#list .group-title", { timeout: 15000 });
    await page.waitForTimeout(600);
    const btn = await page.$("#list .group-title .text-btn.inline");
    check(!!btn, "the count button should be in the results header");
    const label = btn ? await btn.textContent() : "";
    await btn.click();
    await page.waitForSelector("#list .conc-row", { timeout: 20000 });
    await page.waitForTimeout(400);
    check(/view=all/.test(await page.evaluate(() => location.hash)), "address should carry view=all");
    const rows = await page.locator("#list .conc-row").count(), docs = await page.locator("#list .conc-doc").count();
    console.log(name, label, "->", rows, "rows in", docs, "chapters");
    check(rows > 100 && rows <= 600 && docs > 50, `rows ${rows} docs ${docs}`);
    check(/in reading order/.test(await page.textContent("#list .conc-sub")), "sub line");
    await page.screenshot({ path: `${OUT}${name}-01-conc.png` });
    // a row opens the verse
    await page.click("#list .conc-row >> nth=3");
    await page.waitForSelector("#reader .doc .is-target", { timeout: 10000 });
    await page.waitForTimeout(400);
    check((await page.textContent("#reader .trail-back .lb")) === "Every match", `back label from a row: ${await page.textContent("#reader .trail-back .lb")}`);
    await page.click("#reader .trail-back");
    await page.waitForSelector("#list .conc-row", { timeout: 10000 });
    // Back from the concordance returns to the results
    await page.waitForTimeout(300);
    await page.goBack();
    await page.waitForSelector("#list .group-title", { timeout: 10000 });
    await page.waitForTimeout(400);
    check(!(await page.$("#list .conc-row")), "Back should return to the ranked results");
    check(!/view=all/.test(await page.evaluate(() => location.hash)), "address back to results");
    await ctx.close();
  }
  return errors;
}
