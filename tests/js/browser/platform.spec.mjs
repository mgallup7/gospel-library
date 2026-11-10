// platform: what the accessibility and Apple platform lens asked for after the tab bar.
// The layout classes on the body say what the :has() rules they replaced said, on every screen.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  for (const [name, viewport] of [["iphone", { width: 393, height: 852 }], ["ipad", { width: 1180, height: 820 }]]) {
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const phone = viewport.width < 760;
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {} });
    await ctx.route("https://api.anthropic.com/**", (r) => r.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.evaluate(() => window.Deck.reset());
    const wait = (ms = 400) => page.waitForTimeout(ms);
    const openDoc = async (uri, pid) => { await page.evaluate(async ([u, p]) => { const d = await window.GL.api("doc", { uri: u }); await window.GL.openDoc(d.id, p); }, [uri, pid]); await page.waitForSelector(`#reader .doc #${pid}`, { timeout: 15000 }); await wait(); };

    // ---- the classes app.js keeps on the body and the panes, against the :has() rules they stand for
    const classes = async (where) => {
      const bad = await page.evaluate(() => {
        const out = [], q = (s) => !!document.querySelector(s), b = document.body.classList;
        const eq = (was, now, what) => { if (was !== now) out.push(`${what} (the page says ${was}, the class ${now})`); };
        eq(q("main:has(#reader[hidden]):not(:has(#panel:not([hidden])))"), b.contains("list-only"), "list-only");
        eq(q("main:has(.search-home)"), b.contains("search-top"), "search-top");
        eq(q("#list:has(.ask-page)"), b.contains("ask-up"), "ask-up");
        eq(q("#list:has(.ask-page) > .home > div:has(> .ask-page)"), q("body.ask-up #list > .home > .ask-host"), "ask-host");
        eq(q(".bar:has(.bar-acts:empty)"), q(".bar.no-acts"), "no-acts");
        eq(q("body:has(.sheet.page:not([hidden]))"), b.contains("sheet-page"), "sheet-page");
        eq(q("#reader:has(> .select-bar)"), q("#reader.selecting"), "selecting");
        eq(q("main:has(#reader:not([hidden]) .select-bar)"), b.contains("sel-up"), "sel-up");
        eq(q("#panel > .reader-bar:has(> .trail-back.none):not(:has(.pane-switch))"), q("#panel > .reader-bar.idle"), "idle");
        for (const bar of document.querySelectorAll(".reader-bar")) eq(bar.matches(":has(.orig-btn)"), bar.classList.contains("has-orig"), "has-orig");
        for (const a of document.querySelectorAll(".ask-page")) eq(a.matches(":has(.ask-dock)"), !a.classList.contains("setup-key"), "the Ask page's dock");
        return out;
      });
      check(!bad.length, `${where}: a layout class is out of step: ${bad.join("; ")}`);
    };
    await classes("the Library");
    await page.click("#homeBody .shelf-tile:has-text('Scriptures')"); await wait(); await classes("a shelf");
    await openDoc("/scriptures/bofm/alma/32", "p21"); await classes("a chapter");
    await page.click("#reader .doc #p21"); await page.click("#reader .doc #p22"); await wait(200); await classes("a selection");
    await page.click("#reader .select-bar .add-deck"); await wait(); await classes("after Add to deck");
    await openDoc("/scriptures/ot/gen/1", "p1"); await page.click("#reader .doc #p1"); await wait(200); await classes("Genesis 1 with a verse selected");
    await openDoc("/scriptures/ot/gen/2", "p1"); await classes("a chapter drawn over a selection");
    await page.click("#searchTab"); await wait(); await classes("Search before a word");
    await page.fill("#q", "faith"); await page.press("#q", "Enter"); await page.waitForSelector("#list .hit", { timeout: 20000 }); await wait(600); await classes("results");
    await page.click("#deckBtn"); await wait(); await classes("the Deck");
    await page.click("#askBtn"); await wait(); await classes("Ask");
    await page.evaluate(() => window.GL.openSettings()); await wait(); await classes("Settings");
    await page.keyboard.press("Escape"); await wait(); await classes("Settings closed");
    await page.click("#homeBtn"); await wait(); await classes("the Library again");
    const left = await page.evaluate(() => { let n = 0; const walk = (rules) => { for (const r of rules) { if (r.cssRules && r.cssRules.length) walk(r.cssRules); if (r.selectorText && /(^|,)\s*(body|main|#list|#reader|#panel)[^,]*:has\(/.test(r.selectorText)) n++; } }; for (const s of document.styleSheets) { try { walk(s.cssRules); } catch (_) {} } return n; });
    check(left === 0, `${left} :has() rules still hang on the body, main or a pane`);
    await ctx.close();
  }
  return errors;
}
