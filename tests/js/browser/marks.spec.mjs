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
    if (jump && viewport.width < 760 && await jump.isVisible()) await jump.click(); // Enter opens the page on the phone too
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
    // the selection and the bar stay, and the yellow dot says the verses carry it
    check((await page.locator("#reader .doc .sel").count()) === 2, "both verses stay selected after a color");
    check((await page.getAttribute("#reader .select-bar .hl-dot.hl-y", "aria-pressed")) === "true", "the yellow dot is pressed");
    check((await page.getAttribute("#reader .select-bar .hl-dot.hl-g", "aria-pressed")) === "false", "the green dot is not pressed");
    await shot("02-highlighted");
    // a note on the two, kept selected after it saves
    await page.click("#reader .select-bar button:has-text('Note')");
    await page.waitForSelector("#sheet:not([hidden]) .note-text");
    await page.fill("#sheet .note-text", "Two verses, one note.");
    await page.click("#sheet .peek-row .primary");
    await page.waitForTimeout(500);
    check((await page.locator("#reader .doc .sel").count()) === 2, "the selection stays after a note saves");
    // the note covers both: its marker on 21, a bracket from 21 to 22
    check(!!(await page.$("#reader .doc #p21 .note-mark")) && !(await page.$("#reader .doc #p22 .note-mark")), "the range note's marker sits on the first verse");
    check(await page.evaluate(() => document.querySelector("#reader .doc #p21").classList.contains("note-range-start") && document.querySelector("#reader .doc #p22").classList.contains("note-range-end")), "the range is bracketed 21 to 22");
    await shot("02b-range-note");
    // still selected: Add to deck carries the color and the note
    await page.click("#reader .select-bar .add-deck");
    await page.waitForTimeout(600);
    const card = await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("gospel.deck") || "{}"); return (d.items || []).find((i) => i.pid === "p21") || null; });
    check(card && card.color === "y", `the card should carry the reader's yellow: ${card && card.color}`);
    check(card && /Two verses, one note\./.test(card.notes || ""), `the range note should be the card's speaker note: ${card && card.notes}`);
    check(card && Array.isArray(card.hl) && card.hl.length === 0, "the card's phrase highlights (and so the PowerPoint) are unchanged");
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
    await page.click("#reader .select-bar .clear-sel");
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
    check(/Alma 32:21-22/.test(await page.textContent("#homeBody .mark-row >> nth=1")), "the range note is listed as Alma 32:21-22");
    const exported = await page.evaluate(async () => JSON.parse(await window.Marks.exportJson()).marks.find((m) => m.pid === "p21"));
    check(exported && exported.pid_end === "p22" && exported.verse_end === 22 && exported.citation === "Alma 32:21-22", "the export carries the range");
    // import: the new fields are checked, a bad one is dropped, an old record without them still loads
    const imp = await page.evaluate(async () => {
      const n = await window.Marks.importJson({ marks: [
        { uri: "/x/old", pid: "p1", note: "old record", updated: 1 },
        { uri: "/x/bad", pid: "p1", note: "bad end", pid_end: "p9\"><img>", verse_end: "x", updated: 1 },
        { uri: "/x/ok", pid: "p1", note: "good end", pid_end: "p3", verse_end: 3, updated: 1 },
      ] });
      const all = await window.Marks.all();
      const f = (u) => all.find((m) => m.uri === u);
      const out = { n, old: f("/x/old")?.pid_end, bad: f("/x/bad")?.pid_end, ok: f("/x/ok")?.pid_end, okv: f("/x/ok")?.verse_end };
      for (const u of ["/x/old", "/x/bad", "/x/ok"]) await window.Marks.remove(u, "p1");
      return out;
    });
    // Export: no touch screen here, so the file downloads (an iPhone or iPad takes the share sheet)
    const dl = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.click("#homeBody .marks-tools button:has-text('Export')")]).then(([d]) => d).catch(() => null);
    check(dl && /^gospel-marks-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), `Export downloads the marks file (${dl && dl.suggestedFilename()})`);
    check(imp.n === 3 && imp.old === null && imp.bad === null && imp.ok === "p3" && imp.okv === 3, `import sanitizes the range: ${JSON.stringify(imp)}`);
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
