// nav3: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
// Flows the second panel found broken, and the reader bar that came of it:
//   1. with an API key saved the concordance still shows; Back after "All verses with this word"
//      and after a reload under a sheet leaves in one step; Back on a phone keeps the scroll; Back
//      does not throw away a half-typed note;
//   2. Back says "Results" beside an open page; the tabs do not pile up Back steps;
//   3. the reader bar names the chapter, leads up to the book, and has the chapter arrows; keys;
//   4. the selection bar fits portrait; a highlight or a note taken off can be undone.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  async function start(name, viewport, { key = false } = {}) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    if (key) {
      await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-test-not-a-key")); } catch (_) {} });
      await ctx.route("https://api.anthropic.com/**", async (route) => {
        const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: '{"queries":[{"q":"charity never faileth","scope":"all"},{"q":"substance of things hoped for","scope":"all"}],"references":[]}' }], stop_reason: "end_turn" }) });
      });
    }
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForTimeout(300);
    return page;
  }
  const check = (name, c, m) => { if (!c) errors.push(`${name}: ${m}`); };
  const backLabel = (page) => page.evaluate(() => { const b = [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null); return b ? b.querySelector(".lb").textContent : null; });
  const tapBack = (page) => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click());
  const title = (page) => page.evaluate(() => document.querySelector("#reader:not([hidden]) .doc h1")?.textContent.trim() || null);
  const open = async (page, ref, h1 = ref) => {
    await page.fill("#q", ref); await page.press("#q", "Enter");
    await page.waitForFunction((t) => document.querySelector("#reader:not([hidden]) .doc h1")?.textContent.includes(t), h1, { timeout: 15000 });
    await page.waitForTimeout(500);
  };

  // 1a. A key is saved: the concordance shows, and stays once Claude's extra searches have come back
  {
    const name = "ipad key", page = await start(name, { width: 1180, height: 820 }, { key: true });
    await page.fill("#q", "faith hope charity"); await page.press("#q", "Enter");
    await page.waitForSelector("#list .group-title .text-btn.inline", { timeout: 10000 });
    await page.waitForFunction(() => !document.querySelector("#list .widening"), null, { timeout: 10000 }).catch(() => {});
    await page.click("#list .group-title .text-btn.inline");
    await page.waitForTimeout(2500);
    const c = await page.evaluate(() => ({ head: !!document.querySelector("#list .conc-head"), rows: document.querySelectorAll("#list .conc-row").length, ranked: document.querySelectorAll("#list .hit-row").length, hash: location.hash }));
    check(name, /view=all/.test(c.hash) && c.head && c.rows > 0 && !c.ranked, `the concordance did not show with a key saved: ${JSON.stringify(c)}`);
    await page.context().close();
  }

  // 1b to 1d, on the phone
  {
    const name = "iphone", page = await start(name, { width: 393, height: 852 });
    // a Hebrew word, All verses with this word, then one Back is the chapter again
    await open(page, "Genesis 1");
    if (!(await page.waitForSelector("#reader .orig .ow", { timeout: 3000 }).catch(() => null))) await page.click("#reader .reader-foot .foot-btn[aria-label='Hebrew']");
    await page.waitForSelector("#reader .orig .ow", { timeout: 15000 });
    const t = page.locator("#reader .orig .ow").nth(2);
    await t.scrollIntoViewIfNeeded(); await t.click();
    await page.waitForSelector("#sheet:not([hidden]) .ow-section", { timeout: 8000 });
    await page.waitForTimeout(400);
    await page.click("#sheet .deck-actions .primary");
    await page.waitForFunction(() => /#search/.test(location.hash) && document.querySelector("#list .hit-row, #list .best"), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
    check(name, /#search/.test(await page.evaluate(() => location.hash)), "All verses with this word did not search");
    await tapBack(page); await page.waitForTimeout(900);
    check(name, (await title(page)) === "Genesis 1", `one Back after All verses with this word shows ${await title(page)} at ${await page.evaluate(() => location.hash)}`);

    // Back keeps a note that is half typed; Cancel lets it go
    await open(page, "Alma 32");
    await page.click("#reader .doc #p21"); await page.click("#reader .select-bar >> text=Note");
    await page.waitForSelector("#sheet:not([hidden]) textarea");
    await page.fill("#sheet textarea", "half a thought");
    await page.evaluate(() => history.back()); await page.waitForTimeout(600);
    const kept = await page.evaluate(() => ({ open: !document.querySelector("#sheet").hidden, text: document.querySelector("#sheet textarea")?.value, marker: !!history.state?.overlay }));
    check(name, kept.open && kept.text === "half a thought" && kept.marker, `Back threw the note away: ${JSON.stringify(kept)}`);
    await page.click("#sheet >> text=Cancel"); await page.waitForTimeout(500);
    check(name, (await title(page)) === "Alma 32" && !(await page.evaluate(() => history.state?.overlay)), "Cancel after a kept note left the page or its marker");

    // a reload under a sheet: the first Back leaves the chapter
    await page.click("#reader .select-bar >> text=Note");
    await page.waitForSelector("#sheet:not([hidden]) textarea");
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#reader:not([hidden]) .doc h1"), null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const before = await page.evaluate(() => location.hash);
    await tapBack(page); await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({ hash: location.hash, reader: !document.querySelector("#reader").hidden }));
    check(name, after.hash !== before && !after.reader, `after a reload under a sheet the first Back did nothing (${before} then ${after.hash})`);

    // Back from Deck, Ask and Home to a chapter lands where it was scrolled
    await open(page, "Alma 32");
    for (const [tab, sel] of [["Deck", "#deckBtn"], ["Ask", "#askBtn"], ["Home", "#homeBtn"]]) {
      await page.evaluate(() => window.scrollTo(0, 700)); await page.waitForTimeout(200);
      await page.click(sel); await page.waitForTimeout(600);
      await page.evaluate(() => history.back()); await page.waitForTimeout(900); // the home screen has no Back of its own: the swipe
      const y = await page.evaluate(() => Math.round(window.scrollY));
      check(name, Math.abs(y - 700) < 5 && (await title(page)) === "Alma 32", `Back from ${tab} landed at ${y}, not 700`);
    }
    await page.context().close();
  }
  return errors;
}
