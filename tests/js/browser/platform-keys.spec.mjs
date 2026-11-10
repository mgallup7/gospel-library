// platform-keys: VoiceOver and the keyboard. A selection is said through a live region ("3 verses
// selected") and each selected verse carries it; the stage says each slide; the four places are
// a nav with the current one marked; "?" and a row in Settings show the keyboard shortcuts in a
// sheet that Escape closes.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  for (const [name, viewport] of [["iphone", { width: 393, height: 852 }], ["ipad", { width: 1180, height: 820 }]]) {
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.evaluate(() => window.Deck.reset());
    const wait = (ms = 400) => page.waitForTimeout(ms);
    const openDoc = async (uri, pid) => { await page.evaluate(async ([u, p]) => { const d = await window.GL.api("doc", { uri: u }); await window.GL.openDoc(d.id, p); }, [uri, pid]); await page.waitForSelector(`#reader .doc #${pid}`, { timeout: 15000 }); await wait(); };
    const said = () => page.evaluate(() => document.querySelector("#say").textContent);

    // ---- the four places: a nav, the current one marked
    const nav = await page.evaluate(() => { const n = document.querySelector("#tabs"); return { tag: n.tagName, label: n.getAttribute("aria-label"), current: [...n.querySelectorAll("[aria-current]")].map((b) => `${b.dataset.tab}=${b.getAttribute("aria-current")}`).join(",") }; });
    check(nav.tag === "NAV" && !!nav.label && nav.current === "library=page", `the tab bar should be a labelled nav with the Library current: ${JSON.stringify(nav)}`);
    const live = await page.evaluate(() => { const s = document.querySelector("#say"); const r = s.getBoundingClientRect(); return { live: s.getAttribute("aria-live"), w: r.width, h: r.height, inert: s.inert }; });
    check(live.live === "polite" && live.w <= 1 && live.h <= 1, `the live region should be polite and unseen: ${JSON.stringify(live)}`);

    // ---- a selection is said, and each verse carries it
    await openDoc("/scriptures/bofm/alma/32", "p21");
    for (const pid of ["p21", "p22", "p23"]) await page.click(`#reader .doc #${pid}`);
    await wait(200);
    check(await said() === "3 verses selected", `three verses picked should be said: "${await said()}"`);
    const marks = await page.evaluate(() => ({
      described: [...document.querySelectorAll("#reader .doc [aria-describedby='selSay']")].map((n) => n.id).join(","),
      words: document.querySelector("#selSay")?.textContent,
      alt: getComputedStyle(document.querySelector("#reader .doc #p21"), "::before").content,
    }));
    check(marks.described === "p21,p22,p23" && marks.words === "Selected", `each selected verse should be described as selected: ${JSON.stringify(marks)}`);
    await page.click("#reader .doc #p23"); await wait(200);
    check(await said() === "2 verses selected", `one let go should be said: "${await said()}"`);
    check(await page.evaluate(() => !document.querySelector("#reader .doc #p23").hasAttribute("aria-describedby")), "a verse let go should lose its description");
    await page.keyboard.press("Escape"); await wait(200);
    check(await said() === "Selection cleared" && await page.evaluate(() => !document.querySelector("#reader .doc [aria-describedby]")), `Escape clears the selection and says so: "${await said()}"`);
    // by the keyboard: Enter on the verse that has the focus
    await page.focus("#reader .doc #p21"); await page.keyboard.press("Enter"); await wait(200);
    check(await said() === "1 verse selected", `Enter on a verse should select it and say so: "${await said()}"`);
    await page.keyboard.press("Enter"); await wait(200);

    // ---- the stage says each slide
    await page.evaluate(() => window.GL.startPresentingUnits([{ text: "Faith is not to have a perfect knowledge of things.", kind: "verse", where: "Alma 32:21" }, { text: "God is merciful unto all who believe on his name.", kind: "verse", where: "Alma 32:22" }]));
    await wait();
    const slide = () => page.evaluate(() => { const s = document.querySelector("#stage .stage-say"); return { text: s.textContent, live: s.getAttribute("aria-live"), w: s.getBoundingClientRect().width }; });
    let s1 = await slide();
    check(s1.text === "Alma 32:21, 1 of 2" && s1.live === "polite" && s1.w <= 1, `the stage should say its first slide in a polite, unseen region: ${JSON.stringify(s1)}`);
    await page.keyboard.press("ArrowRight"); await wait(200);
    s1 = await slide();
    check(s1.text === "Alma 32:22, 2 of 2", `the stage should say the next slide: ${JSON.stringify(s1)}`);
    await page.keyboard.press("Escape"); await wait(600);
    check(await page.evaluate(() => document.querySelector("#stage").hidden), "Escape should close the stage");

    // ---- "?" shows the shortcuts; Escape closes them; Settings has a row that leads there and back
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("?"); await wait();
    const keys = await page.evaluate(() => { const s = document.querySelector("#sheet"); return { open: !s.hidden, label: s.getAttribute("aria-label"), modal: s.getAttribute("aria-modal"), h: s.querySelector("h2")?.textContent, rows: s.querySelectorAll(".key-list dt").length, text: s.textContent, over: s.scrollWidth - s.clientWidth }; });
    check(keys.open && keys.label === "Keyboard shortcuts" && keys.modal === "true" && keys.h === "Keyboard shortcuts" && keys.rows >= 12, `? should open the shortcut list in a sheet: ${JSON.stringify({ ...keys, text: undefined })}`);
    check(/Previous and next chapter/.test(keys.text) && /Blank the screen/.test(keys.text) && /Undo/.test(keys.text), "the list should name the reader's, the stage's and the undo keys");
    check(keys.over <= 0, `the shortcut list overflows its sheet sideways by ${keys.over}px`);
    await page.screenshot({ path: `${SHOTS}platform-${name}-shortcuts.png` });
    await page.keyboard.press("Escape"); await wait();
    check(await page.evaluate(() => document.querySelector("#sheet").hidden), "Escape should close the shortcut list");
    if (await page.isVisible("#q")) { // typed in a field, "?" is a character
      await page.focus("#q"); await page.keyboard.press("?"); await wait(200);
      check(await page.evaluate(() => document.querySelector("#sheet").hidden && document.querySelector("#q").value === "?"), "? typed in the search box should go in the box, not open the list");
      await page.fill("#q", "");
    }
    await page.evaluate(() => { document.activeElement?.blur(); window.GL.openSettings(); }); await wait();
    await page.click("#sheet #set-keys button"); await wait();
    check(await page.evaluate(() => document.querySelector("#sheet h2")?.textContent === "Keyboard shortcuts" && !document.querySelector("#sheet").hidden), "the row in Settings should show the shortcut list");
    await page.click("#sheet .keys-back"); await wait();
    check(await page.evaluate(() => document.querySelector("#sheet h2")?.textContent === "Settings"), "the list should lead back to Settings");
    await page.keyboard.press("Escape"); await wait();
    check(await page.evaluate(() => document.querySelector("#sheet").hidden && !document.body.classList.contains("sheet-page") && !history.state?.overlay), "Escape should close Settings and leave no marker behind");
    await ctx.close();
  }
  return errors;
}
