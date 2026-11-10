// tabs: the four places (Library, Search, Deck, Ask) as a bottom bar on a phone and a rail on an
// iPad. Each is reached and named at three sizes; each keeps its place while another is in front;
// a tap on the tab you are in goes to its top; Back never crosses from one place into another;
// Settings opens from the gear and closes by Back and by Escape; Export everything hands over a
// file without the API key or the passphrase; nothing overflows sideways; and neither a toast nor
// the selection bar sits on the tab bar.
import fs from "node:fs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const KEY = "sk-ant-test-key-that-must-not-leave";
  for (const [name, viewport] of [["iphone", { width: 393, height: 852 }], ["portrait", { width: 820, height: 1180 }], ["ipad", { width: 1180, height: 820 }]]) {
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const phone = viewport.width < 760;
    const ctx = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.evaluate((k) => { localStorage.setItem("gospel.apiKey", JSON.stringify(k)); return window.Deck.reset(); }, KEY);
    const at = () => page.evaluate(() => ({
      hash: location.hash, tab: document.body.dataset.tab, n: history.state?.n ?? null, title: document.title,
      h1: (() => { const h = document.querySelector("#placeTitle"); return h && h.offsetParent !== null ? h.textContent : null; })(),
      current: [...document.querySelectorAll("#tabs .tab[aria-current=page]")].map((b) => b.dataset.tab).join(","),
      back: [...document.querySelectorAll(".trail-back:not(.none) .lb, .home-back")].filter((b) => b.offsetParent !== null).map((b) => b.textContent).join("|"),
      over: document.documentElement.scrollWidth - window.innerWidth,
      y: Math.round(getComputedStyle(document.querySelector("#reader")).overflowY === "auto" ? document.querySelector("#reader").scrollTop : window.scrollY),
    }));
    const tap = async (id) => { await page.click(id); await page.waitForTimeout(450); return at(); };

    // ---- the four places, each marked, named and without sideways overflow
    const bar = await page.evaluate(() => { const r = document.querySelector("#tabs").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, tabs: [...document.querySelectorAll("#tabs .tab[data-tab]")].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()), gear: document.querySelector("#settingsBtn").offsetParent !== null }; });
    check(bar.tabs.join(",") === "Library,Search,Deck,Ask", `the tab bar should hold Library, Search, Deck, Ask: ${bar.tabs}`);
    if (phone) check(bar.h >= 49 && Math.abs(bar.y + bar.h - bar.vh) <= 1 && bar.w === bar.vw && !bar.gear, `a bar along the bottom, 49pt or more: ${JSON.stringify(bar)}`);
    else check(bar.x === 0 && bar.w >= 72 && bar.w <= 100 && bar.h === bar.vh && bar.gear, `a rail down the left, about 72px, with the gear: ${JSON.stringify(bar)}`);
    for (const [id, tab, word] of [["#searchTab", "search", "Search"], ["#deckBtn", "deck", "Deck"], ["#askBtn", "ask", "Ask"], ["#homeBtn", "library", "Library"]]) {
      const s = await tap(id);
      check(s.tab === tab && s.current === tab && s.h1 === word && s.title === word, `${word} should be current, named in an h1 and in the title: ${JSON.stringify(s)}`);
      check(s.over <= 0, `${word} overflows sideways by ${s.over}px`);
      check(!s.back || (tab === "library" && !s.back), `${word}'s top should have no Back: ${s.back}`);
    }
    await page.screenshot({ path: `${SHOTS}tabs-${name}-library.png` });

    // ---- each place keeps its own: the Library deep in a chapter, Search on its results
    await page.click("#homeBody .shelf-tile:has-text('Scriptures')"); await page.waitForTimeout(400);
    await page.evaluate(async () => { const d = await window.GL.api("doc", { uri: "/scriptures/bofm/alma/32" }); window.GL.openDoc(d.id, "p21"); });
    await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const r = document.querySelector("#reader"); if (getComputedStyle(r).overflowY === "auto") r.scrollTop = 640; else window.scrollTo(0, 640); });
    await page.waitForTimeout(150);
    const deep = await at();
    check(deep.tab === "library" && /doc=\d+/.test(deep.hash) && deep.n === 2 && deep.title === "Alma 32" && Math.abs(deep.y - 640) < 4, `the Library, two steps in, on Alma 32: ${JSON.stringify(deep)}`);
    check(deep.over <= 0, `the reader overflows sideways by ${deep.over}px`);
    let s = await tap("#searchTab");
    check(s.tab === "search" && s.hash === "#search" && s.n === 0, `the Search tab should open Search's own top, not a step on the Library's trail: ${JSON.stringify(s)}`);
    check(await page.evaluate(() => document.activeElement?.id === "q"), "an empty Search should have the cursor in the box");
    // Back does not cross: at the top of Search there is no Back, and Cmd+[ goes nowhere
    check(!s.back, `Search's top should offer no Back to the Library: ${s.back}`);
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Control+BracketLeft"); await page.waitForTimeout(300);
    check((await at()).hash === "#search", "Cmd+[ at the top of Search should not cross into the Library");
    await page.fill("#q", "faith"); await page.press("#q", "Enter");
    await page.waitForSelector("#list .hit", { timeout: 15000 }); await page.waitForTimeout(600);
    s = await at();
    check(s.tab === "search" && /^#search\?q=faith/.test(s.hash) && s.n === 0, `the search should refine Search's own entry: ${JSON.stringify(s)}`);
    check(s.over <= 0, `the results overflow sideways by ${s.over}px`);
    if (!phone) check(/doc=\d+/.test(s.hash) && await page.isVisible("#reader .doc"), "on an iPad the best match should open beside the results");
    const sbox = await page.evaluate(() => { const q = document.querySelector("#q").getBoundingClientRect(), row = document.querySelector(".scope-row"), sc = document.querySelector(".scopes"); return { q: q.width, vw: innerWidth, row: row.offsetParent !== null, fade: /gradient/.test(getComputedStyle(sc).maskImage || getComputedStyle(sc).webkitMaskImage || ""), filters: document.querySelector("#filterBtn").offsetParent !== null }; });
    check(sbox.row && sbox.fade && sbox.filters, `the shelves and Filters should be one row under the box, fading at the edge: ${JSON.stringify(sbox)}`);
    if (phone) check(sbox.q >= sbox.vw - 40, `the box should have the phone's whole width: ${sbox.q} of ${sbox.vw}`);
    const searchHash = s.hash;
    s = await tap("#askBtn");
    check(s.tab === "ask" && s.hash === "#ask", `Ask: ${JSON.stringify(s)}`);
    check(await page.evaluate(() => document.querySelector(".scope-row").offsetParent === null && document.querySelector("#q").offsetParent === null), "the shelves and the box belong to Search, not to Ask");
    s = await tap("#homeBtn");
    check(s.tab === "library" && s.hash === deep.hash && s.n === 2 && Math.abs(s.y - 640) < 6, `the Library should come back to Alma 32 where it was scrolled: ${JSON.stringify(s)}`);
    check(/Genesis|Scriptures|Alma/.test(s.back), `and Back there should still walk the Library's trail: ${s.back}`);
    s = await tap("#searchTab");
    check(s.hash === searchHash && (await page.locator("#list .hit").count()) > 0 && await page.inputValue("#q") === "faith", `Search should come back to its results: ${JSON.stringify(s)}`);
    // a tap on the tab you are in goes to its top
    s = await tap("#searchTab");
    check(s.hash === "#search" && await page.inputValue("#q") === "" && await page.evaluate(() => document.activeElement?.id === "q"), `a second tap on Search should empty it and focus the box: ${JSON.stringify(s)}`);
    s = await tap("#homeBtn");
    check(s.hash === deep.hash, `the Library still on its chapter: ${s.hash}`);
    // Back inside the Library walks the Library: one step, to the shelf
    await page.click(".trail-back:not(.none):visible"); await page.waitForTimeout(500);
    s = await at();
    check(s.tab === "library" && s.hash === "#scriptures" && s.n === 1, `Back in the Library should lead to the shelf: ${JSON.stringify(s)}`);
    s = await tap("#homeBtn");
    check((s.hash === "" || s.hash === "#") && s.n === 0 && await page.isVisible("#homeBody.overview"), `a tap on Library while in it should go to the shelves: ${JSON.stringify(s)}`);
    // the Library's own search field steps into Search, and that step has a Back
    await page.click("#q"); await page.waitForTimeout(350);
    s = await at();
    check(s.tab === "search" && s.n === 1 && /Library/.test(s.back) && await page.evaluate(() => document.activeElement?.id === "q"), `the Library's field should step into Search with the cursor in the box: ${JSON.stringify(s)}`);
    await tap("#homeBtn");

    // ---- the rows that were hidden
    check(await page.isVisible("#homeBody .own-row:has-text('My studies')") && await page.isVisible("#homeBody .own-row:has-text('Highlights and notes')"), "the Library should list My studies and Highlights and notes");
    await page.click("#homeBody .own-row:has-text('Highlights and notes')"); await page.waitForTimeout(400);
    check((await at()).hash === "#marks" && await page.isVisible(".marks-sec"), "Highlights and notes should be a place of its own");
    await tap("#homeBtn");

    // ---- Settings: the gear, Back, Escape
    const gear = phone ? "#barActs .gear-btn" : "#settingsBtn";
    const before = (await at()).hash;
    await page.click(gear);
    await page.waitForSelector("#sheet:not([hidden]) .settings", { timeout: 5000 });
    const secs = await page.evaluate(() => [...document.querySelectorAll("#sheet .set-sec h3")].map((h) => h.textContent).join(","));
    check(secs === "Claude,Reading,Library,Backup,Keyboard,About", `Settings should hold Claude, Reading, Library, Backup, Keyboard, About: ${secs}`);
    check(await page.evaluate(() => !!document.querySelector("#sheet .ask-settings textarea.ask-instructions") && document.querySelector("#tabs").inert), "Claude's part is ask.js's own box, and the tabs are inert under the sheet");
    await page.waitForFunction(() => /Kept|Not promised|does not say/.test(document.querySelector("#set-library")?.textContent || ""), null, { timeout: 5000 }).catch(() => errors.push(`${name}: Settings should say whether storage is persisted`));
    check((await at()).over <= 0, "Settings overflows sideways");
    await page.screenshot({ path: `${SHOTS}tabs-${name}-settings.png` });
    await page.goBack(); await page.waitForTimeout(400);
    check(await page.evaluate(() => document.querySelector("#sheet").hidden) && (await at()).hash === before, "Back should close Settings and stay where it was");
    await page.click(gear);
    await page.waitForSelector("#sheet:not([hidden]) .settings");
    await page.waitForTimeout(150);
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    check(await page.evaluate(() => document.querySelector("#sheet").hidden && !document.querySelector("#tabs").inert), "Escape should close Settings");

    // ---- Export everything: one file, without the key or the passphrase
    if (name === "ipad") {
      await page.evaluate(() => window.Marks.set({ uri: "/scriptures/bofm/alma/32", pid: "p21", doc_id: null, verse: 21, kind: "verse", color: "y", note: "kept in the backup", text: "And now as I said concerning faith", citation: "Alma 32:21", title: "Alma 32" }).catch(() => null));
      await page.click(gear);
      await page.waitForSelector("#sheet:not([hidden]) .settings");
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click("#sheet .settings button:text-is('Export everything')")]);
      const text = fs.readFileSync(await download.path(), "utf8");
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}
      check(/^gospel-library-backup-.*\.json$/.test(download.suggestedFilename()), `the file's name: ${download.suggestedFilename()}`);
      check(data && data.kind === "backup" && Array.isArray(data.marks) && Array.isArray(data.studies) && data.decks && Array.isArray(data.decks.saved) && data.ask && typeof data.ask.instructions === "string" && typeof data.ask.notes === "string", "the file should hold marks, studies, decks, instructions and notes");
      check(!text.includes(KEY) && !text.includes(PASS) && !/apiKey|passphrase/i.test(Object.keys(data || {}).join(",")), "the file must not hold the API key or the passphrase");
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    }

    // ---- the tab bar under a selection and a toast; gone under the stage
    await page.evaluate(async () => { const d = await window.GL.api("doc", { uri: "/scriptures/bofm/alma/32" }); window.GL.openDoc(d.id, "p21"); });
    await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
    await page.click("#reader .doc #p21");
    await page.waitForSelector("#reader .select-bar");
    await page.evaluate(() => window.GL.toast("A line to say something was done.", { action: "Undo", onAction: () => {} }));
    await page.waitForTimeout(450);
    const g = await page.evaluate(() => { const r = (q) => { const b = document.querySelector(q).getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }; return { tabs: r("#tabs"), sel: r("#reader .select-bar"), toast: r("#toast"), tabsShown: document.querySelector("#tabs").offsetParent !== null || getComputedStyle(document.querySelector("#tabs")).position === "fixed" }; });
    if (phone) {
      check(g.sel.b <= g.tabs.t + 1 && g.toast.b <= g.tabs.t, `the selection bar and the toast should sit above the tab bar: ${JSON.stringify(g)}`);
      check(await page.isVisible("#tabs .tab.on") && await page.isVisible("#reader .reader-bar .size-pop-btn"), "the tab bar stays while reading, and the reader's tools are in its bar's menu");
    } else check(g.toast.l >= g.tabs.r && g.sel.l >= g.tabs.r, `neither should sit on the rail: ${JSON.stringify(g)}`);
    check(g.toast.b <= g.sel.t + 1, `the toast should clear the selection bar: ${JSON.stringify(g)}`);
    await page.click("#reader .select-bar .add-deck"); await page.waitForTimeout(300);
    check((await page.textContent("#deckBtn .deck-count")) === "1", "the Deck tab should carry the count");
    await page.screenshot({ path: `${SHOTS}tabs-${name}-reader.png` });
    await page.keyboard.press("p"); await page.waitForSelector("#stage:not([hidden])", { timeout: 5000 });
    check(await page.evaluate(() => getComputedStyle(document.querySelector("#tabs")).display === "none"), "the tab bar should hide while the stage is up");
    await page.waitForTimeout(700); // let the screen finish going full before it is asked to leave
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#stage").hidden && !document.fullscreenElement, null, { timeout: 8000 }).catch(() => {}); // the screen takes a moment to leave full screen
    await page.waitForTimeout(300);
    s = await tap("#deckBtn");
    check(s.tab === "deck" && s.over <= 0 && await page.isVisible(".board .bcard") && await page.isVisible(".board .deck-actions button:text-is('My decks')"), `the Deck: the board, with My decks in its head: ${JSON.stringify(s)}`);
    if (!phone) check(await page.evaluate(() => { const b = document.querySelector("#panel").getBoundingClientRect(); return document.querySelector("#list").offsetParent === null && b.width > innerWidth - 110; }), "on an iPad the board should have the place's full width");
    await page.screenshot({ path: `${SHOTS}tabs-${name}-deck.png` });
    await page.evaluate(() => window.Deck.reset());
    await ctx.close();
  }
  return errors;
}
