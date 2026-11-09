import fs from "node:fs";
// reader: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
// Focus and keyboard in the reader: one Tab stop for the verses, the selection bar next in order,
// focus back on the page after the bar goes, and on the list row after Back on the phone.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "reader/";
  fs.mkdirSync(OUT, { recursive: true });
  async function session(name, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const shot = (l) => page.screenshot({ path: `${OUT}${name}-${l}.png` });
    const active = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; });
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForTimeout(400);
    await page.fill("#q", "faith knowledge"); await page.press("#q", "Enter");
    await page.waitForSelector("#list button.hit[data-pid]", { timeout: 15000 });
    const row = await page.$("#list button.hit[data-pid]");
    const rowDoc = await row.getAttribute("data-doc"), rowPid = await row.getAttribute("data-pid");
    await row.click();
    await page.waitForSelector(`#reader .doc #${rowPid}`, { timeout: 15000 });
    await page.waitForTimeout(400);
    // one Tab stop: only the verse you came for is in the Tab order
    const stops = await page.evaluate(() => [...document.querySelectorAll("#reader .doc p.verse")].filter((p) => p.tabIndex === 0).map((p) => p.id));
    check(stops.length === 1 && stops[0] === rowPid, `one verse in the Tab order, the target: ${stops}`);
    await page.focus(`#reader .doc #${rowPid}`);
    await page.keyboard.press("ArrowDown");
    const moved = await active();
    check(moved !== rowPid && /^p\d+/.test(moved), `ArrowDown moves to the next verse (${moved})`);
    await page.keyboard.press("Enter");
    check(await page.evaluate((id) => document.getElementById(id).classList.contains("sel"), moved), "Enter selects it");
    // the bar follows the reader bar in the document
    check(await page.evaluate(() => document.querySelector("#reader .reader-bar").nextElementSibling?.classList.contains("select-bar")), "the selection bar comes right after the reader bar");
    const barBottom = await page.evaluate(() => { const b = document.querySelector("#reader .select-bar").getBoundingClientRect(); return Math.round(b.bottom); });
    check(barBottom > viewport.height - 160, `the selection bar is still drawn at the bottom (${barBottom})`);
    // on a phone, one way to the deck while the bar is up: its + Deck, not the bottom bar's Add to deck too
    if (viewport.width < 760) {
      const shown = await page.evaluate(() => [...document.querySelectorAll("#reader .select-bar .add-deck, #reader .reader-foot .foot-btn")].filter((b) => b.offsetParent && /deck/i.test(b.getAttribute("aria-label") || b.textContent)).length);
      check(shown === 1, `one Add to deck control with a selection on the phone (${shown})`);
      check(await page.isVisible("#reader .reader-foot .foot-btn[aria-label='Present']"), "Present stays in the bottom bar");
    }
    await shot("01-selected");
    // after a color the focus stays on the dot; after Add to deck it returns to the verse
    await page.focus("#reader .select-bar .hl-dot.hl-g");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    check(/hl-dot/.test(await active()), `focus stays on the dot after a color (${await active()})`);
    await page.focus("#reader .select-bar .add-deck");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    check((await active()) === moved, `focus returns to the verse after Add to deck (${await active()})`);
    // one toast element, a live region; Ctrl+Z presses its Undo
    check(await page.evaluate(() => document.querySelectorAll(".toast").length === 1 && document.querySelector("#toast").getAttribute("role") === "status"), "one persistent toast live region");
    check(await page.evaluate(() => window.Deck.count()) === 1, "one passage on the deck");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.Deck.count()) === 0, "Ctrl+Z undoes the add while the toast shows");
    check(await page.evaluate(() => document.querySelectorAll(".toast").length === 1 && /Taken off/.test(document.querySelector("#toast").textContent)), "the same toast says what Undo did");
    // Esc with words typed in a note keeps them; Cancel lets them go
    await page.click(`#reader .doc #${moved}`);
    await page.click("#reader .select-bar button:has-text('Note')");
    await page.waitForSelector("#sheet:not([hidden]) .note-text");
    await page.fill("#sheet .note-text", "Half a thought");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => !document.querySelector("#sheet").hidden && document.querySelector("#sheet .note-text").value === "Half a thought"), "Esc keeps a note with words in it");
    check((await page.evaluate(() => getComputedStyle(document.querySelector("#sheet .note-text")).fontSize)) === "16px", "the note field is 16px, so Safari does not zoom");
    check(await page.evaluate(() => document.querySelector("#sheet").getAttribute("aria-modal") === "true" && document.querySelector("main").inert && document.querySelector("header.bar").inert && !document.querySelector("#toast").inert), "the sheet is modal: the page behind is inert, the toast is not");
    await shot("02-note-sheet");
    await page.click("#sheet .peek-row button:has-text('Cancel')");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.querySelector("#sheet").hidden), "Cancel closes it");
    check(await page.evaluate(() => !document.querySelector("main").inert && !document.querySelector("header.bar").inert), "the page is live again when the sheet closes");
    await page.click("#reader .select-bar .clear-sel");
    // Back on the phone lands on the row of the page just left
    if (viewport.width < 760) {
      await page.click("#reader .reader-bar .trail-back");
      await page.waitForSelector("#list:not([hidden]) button.hit", { timeout: 10000 });
      await page.waitForTimeout(500);
      const f = await page.evaluate(() => { const a = document.activeElement; return a ? `${a.dataset.doc || ""}/${a.dataset.pid || ""}/${a.className}` : null; });
      check(f === `${rowDoc}/${rowPid}/hit` || /trail-back/.test(f || ""), `after Back the focus is on the row left (${f})`);
      await shot("02-after-back");
    }
    await ctx.close();
  }
  for (const [name, vp] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    try { await session(name, vp); } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); }
  }
  return errors;
}
