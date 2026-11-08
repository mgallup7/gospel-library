import fs from "node:fs";
// marks: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "marks/";
  fs.mkdirSync(OUT, { recursive: true });
  async function session(name, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") { errors.push(`${name} console: ${m.text().slice(0, 300)}`); console.log(name, "console:", m.text().slice(0, 300)); } });
    page.on("pageerror", (e) => console.log(name, "pageerror:", String(e.stack || e).slice(0, 400)));
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const shot = (l) => page.screenshot({ path: `${OUT}${name}-${l}.png` });
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForTimeout(600);
    await page.fill("#q", "Alma 32:21"); await page.press("#q", "Enter");
    await page.waitForTimeout(800);
    const jump = await page.$("#list .jump");
    if (jump && viewport.width < 760) await jump.click();
    await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
    await page.waitForTimeout(500);
    // select two verses, highlight yellow
    await page.click("#reader .doc #p21");
    await page.click("#reader .doc #p22");
    await page.waitForSelector("#reader .select-bar .hl-dot.hl-y");
    await shot("01-selected");
    await page.click("#reader .select-bar .hl-dot.hl-y");
    await page.waitForTimeout(500);
    check(await page.evaluate(() => document.querySelector("#reader .doc #p21").classList.contains("hl-y") && document.querySelector("#reader .doc #p22").classList.contains("hl-y")), "both verses should be yellow");
    check(!(await page.$("#reader .select-bar")), "selection should clear after highlighting");
    await shot("02-highlighted");
    // a note on verse 23
    await page.click("#reader .doc #p23");
    await page.click("#reader .select-bar button:has-text('Note')");
    await page.waitForSelector("#sheet:not([hidden]) .note-text");
    await page.fill("#sheet .note-text", "Faith grows by experiment: plant the word.");
    await shot("03-note-sheet");
    await page.click("#sheet .peek-row .primary");
    await page.waitForTimeout(500);
    check(!!(await page.$("#reader .doc #p23 .note-mark")), "verse 23 should carry a note marker");
    check(await page.evaluate(() => document.querySelector("#sheet").hidden), "sheet closes after saving");
    // the same color again removes the highlight on verse 22
    await page.click("#reader .doc #p22");
    await page.click("#reader .select-bar .hl-dot.hl-y");
    await page.waitForTimeout(400);
    check(await page.evaluate(() => !document.querySelector("#reader .doc #p22").classList.contains("hl-y")), "verse 22 highlight should toggle off");
    // reload: marks come back
    await page.reload();
    for (let i = 0; i < 5; i++) { // the old worker may still hold the storage for a moment: the app offers Try again
      const again = await page.waitForSelector("#reader .doc #p21, .setup button:has-text('Try again')", { timeout: 30000 });
      if ((await again.textContent()) === "Try again") { await page.waitForTimeout(800); await again.click(); continue; }
      break;
    }
    await page.waitForSelector("#reader .doc #p21", { timeout: 30000 });
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => document.querySelector("#reader .doc #p21").classList.contains("hl-y")), "highlight should survive a reload");
    check(!!(await page.$("#reader .doc #p23 .note-mark")), "note should survive a reload");
    await shot("04-after-reload");
    // the marker opens the note for editing
    await page.click("#reader .doc #p23 .note-mark");
    await page.waitForSelector("#sheet:not([hidden]) .note-text");
    check((await page.inputValue("#sheet .note-text")) === "Faith grows by experiment: plant the word.", "note text should load into the sheet");
    await page.click("#sheet .peek-row button:has-text('Cancel')");
    // the shelf lists the marks
    await page.click("#homeBtn");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 10000 });
    await page.waitForTimeout(400);
    const sub = await page.textContent("#homeBody .shelf-tile:has-text('My studies') .st-s");
    check(/2/.test(sub), `tile should count 2 marks: ${sub}`);
    await page.click("#homeBody .shelf-tile:has-text('My studies')");
    await page.waitForSelector("#homeBody .mark-row", { timeout: 10000 });
    check((await page.locator("#homeBody .mark-row").count()) === 2, "two marks listed");
    check(/Alma 32:23/.test(await page.textContent("#homeBody .mark-row >> nth=0")), "newest mark first (verse 23)");
    await shot("05-marks-list");
    // tapping a mark opens the verse
    await page.click("#homeBody .mark-row >> nth=1");
    await page.waitForSelector("#reader .doc .is-target", { timeout: 10000 });
    check((await page.getAttribute("#reader .doc .is-target", "id")) === "p21", "mark row should open its verse");
    await ctx.close();
  }
  for (const [name, vp] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    try { await session(name, vp); } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); }
  }
  return errors;
}
