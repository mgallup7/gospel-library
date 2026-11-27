// footnote-entry: a Topical Guide entry named in a footnote is read inside the sheet. Its lines
// are rows; a row (or its reference) shows the verse in place of the entry, with a way back to the
// entry at the place it was left; "See also" goes to that entry the same way; an entry the library
// lacks says so there. The chapter, the count and history never move. (Needs a test library with
// real footnotes in Alma 32 and the Topical Guide entry "Perseverance".)
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  for (const [name, viewport] of [["phone", { width: 393, height: 852 }], ["ipad", { width: 1180, height: 820 }]]) {
    const ctx = await browser.newContext({ viewport, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS); await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    const held = await page.evaluate(async () => !!(await GL.api("resolve", { href: "https://www.churchofjesuschrist.org/study/scriptures/tg/perseverance?lang=eng" })).found);
    if (!held) { console.log(`footnote-entry ${name}: skipped, the test library has no Topical Guide`); await ctx.close(); continue; }
    if (!(await page.isVisible("#q"))) { const t = await page.locator("#searchTab").boundingBox(); await page.touchscreen.tap(t.x + t.width / 2, t.y + t.height / 2); }
    await page.fill("#q", "Alma 32:13"); await page.press("#q", "Enter");
    await page.waitForSelector("#reader .doc .verse", { timeout: 20000 }); await page.waitForTimeout(900);
    await page.evaluate(() => document.querySelector('#reader .doc a.study-note-ref[href$="#note13_b"]').scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    const w = await page.locator('#reader .doc a.study-note-ref[href$="#note13_b"]').first().boundingBox();
    await page.touchscreen.tap(w.x + w.width / 2, w.y + w.height / 2);
    await page.waitForSelector("#sheet:not([hidden]) .fn-chip", { timeout: 5000 });
    const start = await page.evaluate(() => ({ hash: location.hash, hist: history.length }));
    await page.evaluate(() => [...document.querySelectorAll(".fn-chip")].find((c) => /TG Perseverance/.test(c.textContent)).click());
    await page.waitForSelector(".fn-page:not([inert]) p.entry", { timeout: 8000 }).catch(() => {});
    const cur = () => page.evaluate(() => { const p = document.querySelector(".fn-page:not([inert])"); return { nm: p.querySelector(".nm")?.textContent || "", rows: p.querySelectorAll("p.entry").length, back: p.querySelector(".fn-back")?.textContent || null, verses: p.querySelectorAll(".peek p").length, top: Math.round(p.scrollTop), count: document.querySelector(".fn-count").textContent, hash: location.hash, hist: history.length, toast: !!document.querySelector("#toast.show") }; });
    const tapIn = async (loc, dx = null) => { const b = await loc.boundingBox(); await page.touchscreen.tap(dx === null ? b.x + b.width / 2 : b.x + dx, b.y + b.height / 2); await page.waitForTimeout(900); };
    const a = await cur();
    check(/Topical Guide/.test(a.nm) && /Perseverance/.test(a.nm) && a.rows >= 10 && !a.back, `${name}: the entry is read in the sheet, a row to a line (${JSON.stringify(a)})`);
    const rowH = await page.$$eval(".fn-page:not([inert]) p.entry", (ns) => Math.min(...ns.map((n) => Math.round(n.getBoundingClientRect().height))));
    check(rowH >= 44, `${name}: every row takes a thumb (${rowH})`);
    // scroll the entry a little, then a tap on the words of a row (not on its reference)
    await page.evaluate(() => { document.querySelector(".fn-page:not([inert])").scrollTop = 60; }); await page.waitForTimeout(200);
    await tapIn(page.locator(".fn-page:not([inert]) p.entry").nth(2), 50);
    const b = await cur();
    check(b.verses >= 1 && /Luke 18:1/.test(b.nm) && b.back === "Perseverance", `${name}: a tap on a line shows its verse, with the way back named (${JSON.stringify(b)})`);
    check(b.count === a.count && b.hash === start.hash && b.hist === start.hist && !b.toast, `${name}: the count, the chapter and history stay put, and no toast (${b.count}, ${b.hist})`);
    await page.screenshot({ path: `${SHOTS}footnote-entry-${name}.png` });
    await tapIn(page.locator(".fn-page:not([inert]) .fn-back"), 30);
    const c = await cur();
    check(c.rows === a.rows && !c.back && c.top === 60, `${name}: back returns to the entry where it was left (${JSON.stringify(c)})`);
    // See also: another entry the library holds, then one it does not
    await page.evaluate(() => { document.querySelector(".fn-page:not([inert])").scrollTop = 0; }); await page.waitForTimeout(200);
    await tapIn(page.locator(".fn-page:not([inert]) p.title a", { hasText: "Steadfastness" }));
    const d = await cur();
    check(/Steadfastness/.test(d.nm) && d.rows > 0 && d.back === "Perseverance", `${name}: See also opens that entry here (${JSON.stringify(d)})`);
    await tapIn(page.locator(".fn-page:not([inert]) p.title a").first());
    const e = await cur();
    const said = await page.evaluate(() => document.querySelector(".fn-page:not([inert])").textContent);
    // (a library with the whole Topical Guide holds it; a small one says it is not here)
    check((e.rows > 0 || /Not in your library/.test(said)) && /Steadfastness/.test(e.back || "") && !e.toast, `${name}: the next entry opens here too, or says it is not in the library, with the way back (${said.replace(/\s+/g, " ").slice(0, 70)})`);
    await tapIn(page.locator(".fn-page:not([inert]) .fn-back"), 30);
    await tapIn(page.locator(".fn-page:not([inert]) .fn-back"), 30);
    const f = await cur();
    check(f.rows === a.rows && !f.back, `${name}: two backs return to the first entry (${JSON.stringify(f)})`);
    // the swipe to the next reference still works from an entry, and Back closes the sheet
    await page.evaluate(() => document.querySelector(".fn-next").click()); await page.waitForTimeout(900);
    check((await cur()).count === "5 of 5", `${name}: the next reference is still one step away`);
    await page.goBack(); await page.waitForTimeout(600);
    check(await page.evaluate(() => document.querySelector("#sheet").hidden && location.hash.includes("doc=")), `${name}: one Back closes the sheet and stays in the chapter`);
    await ctx.close();
  }
  return errors;
}
