// trail: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  async function run(name, viewport) {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 160)}`); });
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    const back = () => page.evaluate(() => { const b = [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null); return b ? b.querySelector(".lb").textContent : null; });
    const where = () => page.evaluate(() => ({ hash: decodeURIComponent(location.hash), n: history.state?.n, reader: !document.querySelector("#reader").hidden, list: !document.querySelector("#list").hidden, title: document.querySelector("#reader .doc h1")?.textContent?.trim() || null, board: !!document.querySelector("#panel") && !document.querySelector("#panel").hidden, fab: !document.querySelector(".fab-think")?.hidden, fabText: document.querySelector(".fab-think .lb")?.textContent }));
    // each step says where it should land: the address, and what Back should say
    const wide = viewport.width >= 760;
    const expect = {
      shelf: { hash: /^#scriptures$/, back: "Library", reader: false },
      book: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures", reader: false },
      chapter: { hash: /^#scriptures\?b\.book=alma&doc=\d+$/, back: "Alma", reader: true, list: wide },
      // on the iPad the page stays beside the new results, so Back changes the list only and names the list it brings back
      type: { hash: wide ? /^#search\?q=faith\+hope&scope=scriptures&doc=\d+$/ : /^#search\?q=faith\+hope&scope=scriptures$/, back: wide ? "Alma" : "Alma 32" },
      enter: { hash: wide ? /^#search\?q=faith\+hope&scope=scriptures&doc=\d+$/ : /^#search\?q=faith\+hope&scope=scriptures$/, back: wide ? "Alma" : "Alma 32" },
      back1: { hash: /^#scriptures\?b\.book=alma&doc=\d+$/, back: "Alma", reader: true },
      back2: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures", reader: false },
      ask: { hash: /^#ask$/, back: "Alma" },
      back3: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures" },
      reload: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures" },
      back4: { hash: /^#scriptures$/, back: "Library", reader: false },
      // a shelf crumb goes up without a new entry: here the entry before is the shelf, so it is Back
      book2: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures", reader: false },
      crumb: { hash: /^#scriptures$/, back: "Library", reader: false },
      // Ask opened from the Deck takes the Deck's place in the trail: Back from either leads to the chapter
      chapter2: { hash: /^#scriptures\?b\.book=alma&doc=\d+$/, back: "Alma", reader: true },
      deck: { hash: wide ? /^#deck\?doc=\d+$/ : /^#deck$/, back: "Alma 32" },
      askFromDeck: { hash: wide ? /^#ask\?doc=\d+$/ : /^#ask$/, back: "Alma 32" },
      askAgain: { hash: wide ? /^#ask\?doc=\d+$/ : /^#ask$/, back: "Alma 32" },
      backFromTabs: { hash: /^#scriptures\?b\.book=alma&doc=\d+$/, back: "Alma", reader: true },
    };
    const step = async (label, fn) => {
      await fn(); await page.waitForTimeout(700);
      const w = await where(), b = await back(), e = expect[label];
      if (!e.hash.test(w.hash)) errors.push(`${name} ${label}: address ${w.hash}`);
      if (b !== e.back) errors.push(`${name} ${label}: Back says ${b}, not ${e.back}`);
      if (e.reader !== undefined && w.reader !== e.reader) errors.push(`${name} ${label}: reader ${w.reader ? "shown" : "hidden"}`);
      if (e.list !== undefined && w.list !== e.list) errors.push(`${name} ${label}: list ${w.list ? "shown" : "hidden"}`);
      if (e.board !== undefined && w.board !== e.board) errors.push(`${name} ${label}: board ${w.board ? "shown" : "hidden"}`);
      return w;
    };
    await step("shelf", () => page.click("#homeBody .shelf-tile:has-text('Scriptures')"));
    await step("book", () => page.click("#homeBody .chip:has-text('Alma')"));
    const chapter = async () => { await page.click("#homeBody .chapters button:text-is('32')"); await page.waitForSelector("#reader .reader-bar .trail-back", { timeout: 15000 }); };
    await step("chapter", chapter);
    await step("type", async () => { await page.fill("#q", "faith"); await page.waitForTimeout(500); await page.fill("#q", "faith hope"); await page.waitForFunction(() => location.hash.includes("faith+hope"), null, { timeout: 5000 }).catch(() => {}); });
    await step("enter", () => page.press("#q", "Enter"));
    await step("back1", () => page.evaluate(() => document.querySelector(".trail-back") ? [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click() : history.back()));
    await step("back2", () => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click()));
    await step("ask", () => page.click("#askBtn"));
    await step("back3", () => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click()));
    await step("reload", () => page.reload({ waitUntil: "load" }).then(() => page.waitForTimeout(2500)));
    const top = await step("back4", () => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click()));
    await step("book2", () => page.click("#homeBody .chip:has-text('Alma')"));
    const up = await step("crumb", () => page.click("#homeBody .crumbs button:has-text('Scriptures')"));
    if (up.n !== top.n) errors.push(`${name} crumb: the step up made a new entry (depth ${up.n}, the shelf was ${top.n})`);
    await page.click("#homeBody .chip:has-text('Alma')"); await page.waitForTimeout(500);
    await step("chapter2", chapter);
    await step("deck", () => page.click("#deckBtn"));
    const onDeck = await page.evaluate(() => history.state?.n);
    const onAsk = await step("askFromDeck", () => page.click("#askBtn"));
    const again = await step("askAgain", () => page.click("#askBtn"));
    if (onAsk.n !== onDeck || again.n !== onDeck) errors.push(`${name}: Deck then Ask then Ask made new entries (depth ${onDeck}, ${onAsk.n}, ${again.n})`);
    await step("backFromTabs", () => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click()));
    await page.context().close();
  }
  await run("ipad", { width: 1180, height: 820 });
  await run("iphone", { width: 393, height: 852 });
  return errors;
}
