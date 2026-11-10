// Shared steps for the browser specs.

// Type in the search box. The box lives in the Library's head and in Search; from the Deck, Ask
// or a page open on a phone, Search is one tap on its tab away, which is what a person would do.
export async function box(page, text) {
  if (!(await page.isVisible("#q"))) { await page.click("#searchTab"); await page.waitForTimeout(400); }
  await page.fill("#q", text);
}

// A tool of the reader: a button in its bar where there is room, else an item of the bar's menu
// (a phone keeps Back, the name and the arrows in the bar, and folds the rest into the menu).
export async function readerTool(page, label, barSelector = null) {
  const direct = barSelector ? await page.$(barSelector) : null;
  if (direct && await direct.isVisible()) { await direct.click(); return; }
  await page.click("#reader .reader-bar .size-pop-btn");
  await page.click(`#reader .reader-bar .size-menu [role=menuitem]:has-text("${label}")`);
}
