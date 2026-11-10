// basics: what QA asked to see pinned down. Typeahead never says "nothing matches" where
// Return decides; a footnote opens in the sheet and Back closes it; a second tab is told the
// library is open elsewhere; an empty deck says so and the first passage changes that.
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

  // typeahead vs return
  await box(page, "zzqx nothing");
  await page.waitForTimeout(900);
  const typed = await page.textContent("#list");
  check(!/Nothing matches/.test(typed), "typeahead should not say nothing matches");
  await page.press("#q", "Enter");
  await page.waitForTimeout(900);
  check(/Nothing matches/.test(await page.textContent("#list")), "Return should say nothing matches for nonsense");

  // a footnote in the sheet, closed by Back. Alma 32 has footnotes in the full library; the
  // test library's scriptures have none, so a Papers journal stands in.
  const opened = await page.evaluate(async () => {
    for (const uri of ["/scriptures/bofm/alma/32", "/paper-summary/journal-1832-1834"]) {
      const d = await window.GL.api("doc", { uri }).catch(() => null);
      if (d && d.footnotes.length && /study-note-ref/.test(d.body_html)) { window.GL.openDoc(d.id); return uri; }
    }
    return null;
  });
  const marker = opened && await page.waitForSelector("#reader .doc a.study-note-ref", { timeout: 15000 }).catch(() => null);
  if (marker) {
    await marker.click();
    await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
    check(!!(await page.$("#scrim")), "a scrim behind the sheet");
    await page.screenshot({ path: SHOTS + "basics-footnote.png" });
    await page.goBack();
    await page.waitForTimeout(500);
    check(await page.evaluate(() => document.querySelector("#sheet").hidden), "Back should close the footnote sheet");
    check(!(await page.$("#scrim")), "and remove the scrim");
  } else errors.push(`no footnote marker found (${opened || "no page with footnotes"})`);

  // a second tab: the engine waits about 2.5 s for the storage before it calls it taken
  const second = await ctx.newPage();
  const t0 = Date.now();
  await second.goto(BASE);
  const told = await second.waitForFunction(() => /another tab/i.test(document.querySelector(".setup")?.textContent || ""), null, { timeout: 30000 }).catch(() => null);
  const text = (await second.textContent(".setup").catch(() => "")) || "";
  check(!!told, `second tab should be told the library is open elsewhere: ${text.slice(0, 80)}`);
  const waited = (Date.now() - t0) / 1000;
  check(!told || waited < 8, `the second tab should be told within a few seconds (took ${waited.toFixed(1)} s)`);
  await second.screenshot({ path: SHOTS + "basics-second-tab.png" });
  await second.close();

  // the deck at 0 and 1. A reload restores the page it was on, not the shelves, so wait
  // for the app to be ready rather than for the home screen; it must not offer Try again.
  await page.evaluate(() => window.Deck.reset());
  await page.reload();
  const ready = await page.waitForFunction(() => window.GL?.ready || document.querySelector(".setup"), null, { timeout: 30000 }).then(() => page.evaluate(() => !!window.GL?.ready)).catch(() => false);
  if (!ready) {
    await page.screenshot({ path: SHOTS + "basics-reload.png" });
    errors.push("after reload: " + (await page.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\s+/g, " "));
    await ctx.close();
    return errors;
  }
  await page.click("#deckBtn");
  await page.waitForSelector(".board", { timeout: 10000 });
  await page.waitForTimeout(300);
  check(!!(await page.$(".board .board-empty")) && /add a passage/i.test(await page.textContent(".board")), "an empty deck says how to add a passage");
  await box(page, "Alma 32:21"); await page.press("#q", "Enter");
  await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
  await page.click("#reader .doc #p21");
  await page.click("#reader .select-bar .add-deck");
  await page.waitForTimeout(500);
  const n = await page.evaluate(() => window.Deck.count());
  check(n === 1, `one passage on the deck (got ${n})`);

  // a tab that starts while the first still holds the storage, and gets it when the first
  // closes inside the engine's wait (what a reload does): it opens the library, not "another tab"
  const next = await ctx.newPage();
  next.on("pageerror", (e) => errors.push(`pageerror (next tab): ${e}`));
  await next.goto(BASE);
  await next.waitForTimeout(600);
  await page.close();
  const took = await next.waitForFunction(() => window.GL?.ready || /another tab/i.test(document.querySelector(".setup")?.textContent || ""), null, { timeout: 30000 }).then(() => next.evaluate(() => !!window.GL?.ready)).catch(() => false);
  check(took, "a tab whose predecessor closes during the wait should open the library: " + (await next.evaluate(() => document.body.innerText.slice(0, 120))).replace(/\s+/g, " "));
  await ctx.close();
  return errors;
}
