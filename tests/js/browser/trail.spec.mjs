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
    const where = () => page.evaluate(() => ({ hash: decodeURIComponent(location.hash), n: history.state?.n, reader: !document.querySelector("#reader").hidden, list: !document.querySelector("#list").hidden, title: document.querySelector("#reader .doc h1")?.textContent?.trim() || null, fab: !document.querySelector(".fab-think")?.hidden, fabText: document.querySelector(".fab-think .lb")?.textContent }));
    // each step says where it should land: the address, and what Back should say
    const wide = viewport.width >= 760;
    const expect = {
      shelf: { hash: /^#scriptures$/, back: "Library", reader: false },
      book: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures", reader: false },
      chapter: { hash: /^#scriptures\?b\.book=alma&doc=\d+$/, back: "Scriptures", reader: true, list: wide },
      type: { hash: wide ? /^#search\?q=faith\+hope&scope=scriptures&doc=\d+$/ : /^#search\?q=faith\+hope&scope=scriptures$/, back: "Alma 32" },
      enter: { hash: wide ? /^#search\?q=faith\+hope&scope=scriptures&doc=\d+$/ : /^#search\?q=faith\+hope&scope=scriptures$/, back: "Alma 32" },
      back1: { hash: /^#scriptures\?b\.book=alma&doc=\d+$/, back: "Scriptures", reader: true },
      back2: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures", reader: false },
      ask: { hash: /^#ask$/, back: "Scriptures" },
      back3: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures" },
      reload: { hash: /^#scriptures\?b\.book=alma$/, back: "Scriptures" },
      back4: { hash: /^#scriptures$/, back: "Library", reader: false },
    };
    const step = async (label, fn) => {
      await fn(); await page.waitForTimeout(700);
      const w = await where(), b = await back(), e = expect[label];
      if (!e.hash.test(w.hash)) errors.push(`${name} ${label}: address ${w.hash}`);
      if (b !== e.back) errors.push(`${name} ${label}: Back says ${b}, not ${e.back}`);
      if (e.reader !== undefined && w.reader !== e.reader) errors.push(`${name} ${label}: reader ${w.reader ? "shown" : "hidden"}`);
      if (e.list !== undefined && w.list !== e.list) errors.push(`${name} ${label}: list ${w.list ? "shown" : "hidden"}`);
    };
    await step("shelf", () => page.click("#homeBody .shelf-tile:has-text('Scriptures')"));
    await step("book", () => page.click("#homeBody .chip:has-text('Alma')"));
    await step("chapter", () => page.click("#homeBody .chapters button:text-is('32')"));
    await step("type", async () => { await page.fill("#q", "faith"); await page.waitForTimeout(500); await page.fill("#q", "faith hope"); });
    await step("enter", () => page.press("#q", "Enter"));
    await step("back1", () => page.evaluate(() => document.querySelector(".trail-back") ? [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click() : history.back()));
    await step("back2", () => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click()));
    await step("ask", () => page.click("#askBtn"));
    await step("back3", () => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click()));
    await step("reload", () => page.reload({ waitUntil: "load" }).then(() => page.waitForTimeout(2500)));
    await step("back4", () => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((x) => x.offsetParent !== null)?.click()));
    await page.context().close();
  }
  await run("ipad", { width: 1180, height: 820 });
  await run("iphone", { width: 393, height: 852 });
  return errors;
}
