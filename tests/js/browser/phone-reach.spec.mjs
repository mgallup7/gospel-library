// phone-reach: on a phone nothing a person looks for is more than two taps off. Settings is
// reachable in a shelf of the Library, over a chapter (in the reader's menu) and over a study
// page; and the Search tab shows its search box even when it comes back to a page it kept, so
// the next search needs no way out of the page first.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  const settingsOpens = async (how, tap) => {
    await tap();
    const up = await page.waitForSelector("#sheet:not([hidden]) .settings", { timeout: 5000 }).catch(() => null);
    check(!!up, `Settings did not open ${how}`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  };
  // in a shelf of the Library: the gear beside the box
  await page.locator("#homeBody .shelf-tile:has-text('Scriptures')").click();
  await page.waitForTimeout(600);
  check(await page.isVisible("#barActs .gear-btn") && await page.isVisible("#q"), "no gear beside the search box in a shelf");
  await page.screenshot({ path: `${SHOTS}phone-reach-shelf.png` });
  await settingsOpens("from a shelf", () => page.click("#barActs .gear-btn"));
  // over a chapter: in the reader's menu
  const alma = await page.evaluate(async () => (await GL.api("search", { q: "Alma 32:1", limit: 1 })).jump.doc_id);
  await page.evaluate((id) => GL.openDoc(id), alma);
  await page.waitForSelector("#reader .doc .verse", { timeout: 10000 });
  await settingsOpens("from a chapter's menu", async () => { await page.click("#reader .reader-bar .size-pop-btn"); await page.click("#reader .size-menu .menu-settings"); });
  // Search keeps a page; another tab and back: the box is there, above the page, and a search from it shows results
  await page.click("#searchTab");
  await page.fill("#q", "faith"); await page.press("#q", "Enter");
  await page.waitForSelector("#list .hit", { timeout: 20000 });
  await page.click("#list .hit >> nth=0");
  await page.waitForSelector("#reader .doc .verse", { timeout: 10000 });
  await page.click("#deckBtn"); await page.waitForTimeout(500);
  await page.click("#searchTab"); await page.waitForTimeout(800);
  const kept = await page.evaluate(() => { const q = document.querySelector("#q").getBoundingClientRect(), bar = document.querySelector("#reader .reader-bar").getBoundingClientRect(); return { page: !!document.querySelector("#reader .doc") && !document.querySelector("#reader").hidden, scrolled: scrollY, box: q.width > 200 && q.height > 0 && q.top >= 0 && q.bottom < innerHeight, above: q.bottom <= bar.top + 1 && bar.top < 80, chap: [...document.querySelectorAll("#reader .reader-bar .chap")].filter((b) => b.offsetParent !== null).length, over: document.documentElement.scrollWidth - innerWidth }; });
  check(kept.page && kept.box && kept.above && kept.scrolled > 100, `Search came back to its page (scrolled to its match) without its box on the screen above it: ${JSON.stringify(kept)}`);
  check(kept.chap === 2 && kept.over <= 1, `the kept page's bar: ${JSON.stringify(kept)}`);
  await page.screenshot({ path: `${SHOTS}phone-reach-search.png` });
  await page.fill("#q", "charity"); await page.press("#q", "Enter");
  await page.waitForFunction(() => !document.querySelector("#list").hidden && !!document.querySelector("#list .hit") && /charity/i.test(document.querySelector("#list .hit").textContent), null, { timeout: 20000 }).catch(() => errors.push("a search typed above a kept page did not show its results"));
  await ctx.close();
  return errors;
}
