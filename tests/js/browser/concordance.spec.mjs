import fs from "node:fs";
// concordance: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
import { box, readerTool } from "./helpers.mjs";
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
    const num = (s) => Number(String(s || "").replace(/,/g, "").match(/\d+/)?.[0] ?? NaN);
    const hash = () => page.evaluate(() => decodeURIComponent(location.hash));
    const sub = async () => num(await page.textContent("#list .conc-sub"));
    // a search, its "N with these words", and the concordance it opens: the two numbers must agree
    const search = async (q) => {
      await box(page, q); await page.press("#q", "Enter");
      await page.waitForSelector("#list .group-title", { timeout: 15000 });
      await page.waitForTimeout(600);
    };
    const openConc = async (what) => {
      const btn = await page.$("#list .group-title .text-btn.inline");
      check(!!btn, `${what}: the count button should be in the results header`);
      if (!btn) return NaN;
      const label = await btn.textContent();
      await btn.click();
      await page.waitForSelector("#list .conc-row", { timeout: 20000 });
      await page.waitForTimeout(300);
      const total = await sub();
      check(num(label) === total, `${what}: the button says ${label}, the concordance ${total}`);
      return total;
    };
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await search("faith");
    const faithTotal = await openConc("faith");
    check(/view=all/.test(await hash()), "address should carry view=all");
    const rows = await page.locator("#list .conc-row").count(), docs = await page.locator("#list .conc-doc").count();
    console.log(name, "faith ->", faithTotal, "passages,", rows, "rows in", docs, "chapters");
    check(rows > 100 && rows <= 600 && docs > 50, `rows ${rows} docs ${docs}`);
    check(/in reading order/.test(await page.textContent("#list .conc-sub")), "sub line");
    // the book chips add up to the total, and the family is the default
    const chips = await page.$$eval("#list .conc-books .chip", (bs) => bs.map((b) => ({ key: b.dataset.book, n: Number(b.querySelector("b").textContent.replace(/\D/g, "")), text: b.textContent })));
    check(chips.length > 5, `book chips: ${chips.length}`);
    check(chips.reduce((a, c) => a + c.n, 0) === faithTotal, "the book chips should add up to the total");
    check((await page.textContent("#list .conc-seg button.on")) === "Word family", "Word family should be the default");
    await page.screenshot({ path: `${OUT}${name}-01-conc.png` });

    // a chip narrows the list to that book; the address keeps it through a reload
    const alma = chips.find((c) => c.key === "alma");
    check(!!alma, "an Alma chip");
    if (alma) {
      await page.click("#list .conc-books .chip[data-book=alma]");
      await page.waitForSelector("#list .conc-books .chip.on[data-book=alma]", { timeout: 10000 });
      check(await sub() === alma.n, `the Alma chip says ${alma.n}, the list ${await sub()}`);
      const heads = await page.$$eval("#list .conc-doc .t", (ts) => ts.map((t) => t.textContent));
      check(heads.length > 0 && heads.every((t) => /^Alma \d/.test(t)), `chapters under the Alma chip: ${heads.slice(0, 3).join(", ")}`);
      check(/cbook=alma/.test(await hash()), "address should carry the book chip");
      await page.screenshot({ path: `${OUT}${name}-02-alma.png` });
      if (vp.width >= 760) { // once is enough: a reload costs the library's open
        await page.reload();
        await page.waitForSelector("#list .conc-books .chip.on[data-book=alma]", { timeout: 60000 });
        check(await sub() === alma.n, "the chip should survive a reload");
      }
      await page.click("#list .conc-books .chip[data-book=alma]");
      await page.waitForFunction(() => !document.querySelector("#list .conc-books .chip.on"), null, { timeout: 10000 });
      check(await sub() === faithTotal, "tapping the chip again should clear it");
      check(!/cbook=/.test(await hash()), "the address drops the chip");
    }

    // exact words: faith and not faithful
    await page.click("#list .conc-seg button:has-text('Exact words')");
    await page.waitForSelector("#list .conc-seg button.on:has-text('Exact words')", { timeout: 10000 });
    await page.waitForTimeout(200);
    const exactTotal = await sub();
    const leak = await page.$$eval("#list .conc-row .snip", (ss) => ss.filter((s) => !/\bfaith\b/i.test(s.textContent)).map((s) => s.textContent.slice(0, 60)));
    const marked = await page.$$eval("#list .conc-row .snip mark", (ms) => [...new Set(ms.map((m) => m.textContent.toLowerCase()))]);
    check(exactTotal > 0 && exactTotal < faithTotal, `exact ${exactTotal} should be fewer than the family ${faithTotal}`);
    check(!leak.length, `exact mode should not list a verse without the word itself: ${leak[0]}`);
    check(marked.length === 1 && marked[0] === "faith", `exact mode marks only faith: ${marked.join(", ")}`);
    check(/words=exact/.test(await hash()), "address should carry exact words");
    await page.screenshot({ path: `${OUT}${name}-03-exact.png` });
    await page.click("#list .conc-seg button:has-text('Word family')");
    await page.waitForSelector("#list .conc-seg button.on:has-text('Word family')", { timeout: 10000 });

    // "+" on a row puts the passage on the deck, with the results' Undo toast and Deck count
    await page.evaluate(() => window.Deck.reset());
    const before = await page.evaluate(() => window.Deck.count());
    await page.click("#list .conc-line >> nth=2 >> button.add");
    await page.waitForFunction((n) => window.Deck.count() === n + 1, before, { timeout: 10000 });
    check((await page.textContent("#list .conc-line >> nth=2 >> button.add")) === "✓", "the + should turn to a tick");
    check((await page.textContent("#deckBtn .deck-count")) === String(before + 1), "the Deck count should rise");
    if (vp.width < 760) {
      const undo = await page.waitForSelector(".toast[role=status] button.toast-action", { timeout: 3000 }).catch(() => null);
      check(!!undo && (await undo.textContent()) === "Undo", "the toast should carry Undo");
      await page.screenshot({ path: `${OUT}${name}-04-added.png` });
      if (undo) { await undo.click(); await page.waitForTimeout(200); check(await page.evaluate(() => window.Deck.count()) === before, "Undo takes it off"); }
    } else {
      await page.screenshot({ path: `${OUT}${name}-04-added.png` });
      await page.evaluate(() => { window.Deck.removeIds(window.Deck.lastAdded()); });
      // the board opened beside the list; come back to the page side for what follows
      const pageBtn = await page.$(".pane-switch button:has-text('Page')");
      if (pageBtn) await pageBtn.click();
    }

    // a row opens the verse. On an iPad the best match is already open beside the list, so Back
    // from the row's page names that page; on a phone it names the list.
    const openBefore = await page.evaluate(() => { const r = document.querySelector("#reader"); return r.hidden || r.offsetParent === null ? null : r.querySelector(".crumb")?.textContent || null; });
    await page.click("#list .conc-row >> nth=3");
    await page.waitForSelector("#reader .doc .is-target", { timeout: 10000 });
    await page.waitForTimeout(400);
    check((await page.textContent("#reader .trail-back .lb")) === (openBefore || "Every match"), `back label from a row: ${await page.textContent("#reader .trail-back .lb")} (a page was open: ${openBefore})`);
    await page.click("#reader .trail-back");
    await page.waitForSelector("#list .conc-row", { timeout: 10000 });
    // Back from the concordance returns to the results
    await page.waitForTimeout(300);
    await page.goBack();
    await page.waitForSelector("#list .group-title", { timeout: 10000 });
    await page.waitForTimeout(400);
    check(!(await page.$("#list .conc-row")), "Back should return to the ranked results");
    check(!/view=all/.test(await hash()), "address back to results");

    // the button and the list agree under a book filter and under a scope chip
    await search("book:alma faith");
    const almaTotal = await openConc("book:alma faith");
    check(almaTotal === 83 || almaTotal > 0, `book:alma faith: ${almaTotal}`);
    if (vp.width >= 760) {
      await box(page, "faith");
      await page.click(".scopes button[data-scope=scriptures]");
      await page.press("#q", "Enter");
      await page.waitForSelector("#list .group-title", { timeout: 15000 });
      await page.waitForTimeout(600);
      check(/scope=scriptures/.test(await hash()), "the scope chip should be on");
      await openConc("faith in the scriptures chip");
    }
    await ctx.close();
  }
  return errors;
}
