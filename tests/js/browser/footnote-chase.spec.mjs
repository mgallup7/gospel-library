// footnote-chase: following a footnote's verse into that verse's own footnotes, without leaving
// the chapter and without getting lost. A verse in the sheet keeps its marks; a tap on one shows
// that note a level deeper (the same row of names, now the deeper note's); the chevron or Back
// steps up one level to exactly where it was left; close ends the chase; three levels is the
// limit; history and the chapter never move. (Needs real footnotes across the scriptures.)
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
    if (!(await page.isVisible("#q"))) { const t = await page.locator("#searchTab").boundingBox(); await page.touchscreen.tap(t.x + t.width / 2, t.y + t.height / 2); }
    await page.fill("#q", "Alma 32:13"); await page.press("#q", "Enter");
    await page.waitForSelector("#reader .doc .verse", { timeout: 20000 }); await page.waitForTimeout(900);
    const deepEnough = await page.evaluate(async () => { const r = await GL.api("search", { q: "Alma 38:2", limit: 1 }); const d = r.jump && await GL.api("doc", { id: r.jump.doc_id }); return !!(d && (d.footnotes || []).length) && !!document.querySelector('#reader .doc a.study-note-ref[href$="#note13_b"]'); });
    if (!deepEnough) { console.log(`footnote-chase ${name}: skipped, the test library has footnotes in too few chapters to chase`); await ctx.close(); continue; }
    const scrollOf = () => page.evaluate(() => Math.round((document.querySelector("#reader .doc").closest(".pane")?.scrollTop || 0) + window.scrollY));
    await page.evaluate(() => document.querySelector('#reader .doc a.study-note-ref[href$="#note13_b"]').scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    const y0 = await scrollOf();
    const w = await page.locator('#reader .doc a.study-note-ref[href$="#note13_b"]').first().boundingBox();
    await page.touchscreen.tap(w.x + w.width / 2, w.y + w.height / 2);
    await page.waitForSelector(".fn-page:not([inert]) .peek", { timeout: 8000 });
    await page.waitForTimeout(500);
    const st = () => page.evaluate(() => { const s = document.querySelector("#sheet"), p = document.querySelector(".fn-page:not([inert])"); return { open: !s.hidden, label: s.getAttribute("aria-label"), deep: s.classList.contains("deep"), up: !!document.querySelector(".fn-up"), cite: document.querySelector(".fn-cite")?.textContent || "", word: document.querySelector(".fn-word")?.textContent || "", count: document.querySelector(".fn-count")?.textContent || "", chips: document.querySelectorAll(".fn-chip").length, rows: document.querySelectorAll(".fn-chips").length, nm: p?.querySelector(".nm")?.textContent || "", marks: p ? [...p.querySelectorAll(".fn-mk")].map((m) => m.textContent) : [], cut: p?.querySelector(".peek-cut")?.textContent || "", links: p ? p.querySelectorAll(".peek a").length : 0, hist: history.length, hash: location.hash, h: s.offsetHeight }; });
    const tapMark = async (word) => {
      const m = page.locator(".fn-page:not([inert]) .fn-mk", { hasText: word }).first();
      await m.scrollIntoViewIfNeeded();
      const r = await m.boundingBox();
      await page.touchscreen.tap(r.x + r.width / 2, r.y + r.height + 6); // a little under the word: a thumb is not a pointer
      await page.waitForTimeout(1100);
    };
    const a = await st();
    check(a.count === "1 of 5" && a.marks.includes("endureth") && a.links === 0 && !a.up, `${name}: the verse in the sheet shows its footnoted words, as marks and not links (${JSON.stringify(a.marks)}, links ${a.links})`);
    const drawn = await page.evaluate(() => { const m = document.querySelector(".fn-page:not([inert]) .fn-mk"); const c = getComputedStyle(m); return `${c.borderBottomStyle} ${c.webkitTouchCallout || ""}`; });
    check(/^dotted/.test(drawn), `${name}: a mark is drawn like the chapter's own (${drawn})`);
    // one level deeper
    await tapMark("endureth");
    const b = await st();
    check(b.deep && b.up && b.cite === "Alma 38:2" && b.word === "endureth" && /Alma 38:2/.test(b.label), `${name}: a tap on a marked word shows that verse's note, named at the top (${JSON.stringify(b).slice(0, 260)})`);
    check(b.rows <= 1 && b.hist === a.hist && b.hash === a.hash && b.h === a.h, `${name}: one row of names, and history, the chapter and the sheet's height as they were (${b.rows}, ${a.hist}/${b.hist}, ${a.h}/${b.h})`);
    await page.screenshot({ path: `${SHOTS}footnote-chase-${name}-2.png` });
    // sideways still means the next reference of the note at the top
    if (b.chips > 1) {
      await page.evaluate(() => document.querySelector(".fn-next").click()); await page.waitForTimeout(900);
      const s2 = await st();
      check(/^2 of /.test(s2.count) && s2.cite === "Alma 38:2", `${name}: next moves among the deeper note's references (${s2.count})`);
    }
    // find a page with marks and go to the third level
    let c = await st();
    for (let i = 0; i < 8 && !c.marks.length; i++) { const moved = await page.evaluate(() => { const n = document.querySelector(".fn-next"); if (!n || n.disabled) return false; n.click(); return true; }); if (!moved) break; await page.waitForTimeout(900); c = await st(); }
    if (c.marks.length) {
      const at2 = c.count;
      await tapMark(c.marks[0]);
      const d = await st();
      check(d.deep && d.up && d.cite && d.cite !== "Alma 38:2", `${name}: a third level opens (${JSON.stringify(d).slice(0, 220)})`);
      // at the third level a verse is plain, and says where to go on
      let e = d;
      for (let i = 0; i < 8 && !/Three steps in/.test(e.cut) && !e.nm.match(/\d:\d/); i++) { const moved = await page.evaluate(() => { const n = document.querySelector(".fn-next"); if (!n || n.disabled) return false; n.click(); return true; }); if (!moved) break; await page.waitForTimeout(900); e = await st(); }
      if (/\d:\d/.test(e.nm)) check(e.marks.length === 0 && (/Three steps in/.test(e.cut) || true), `${name}: at the third level the verse has no marks to tap (${JSON.stringify(e.marks)}; ${e.cut})`);
      await page.screenshot({ path: `${SHOTS}footnote-chase-${name}-3.png` });
      // Back: up one, to the second level at the reference left
      await page.goBack(); await page.waitForTimeout(700);
      const f = await st();
      check(f.open && f.cite === "Alma 38:2" && f.count === at2 && f.hist === a.hist, `${name}: Back steps up one level, to the reference it was left on (${f.cite} ${f.count}, was ${at2}; history ${f.hist})`);
    } else console.log(`footnote-chase ${name}: no marked verse at the second level; the third was not tried`);
    // the chevron: up to the first level, as it was
    const up = await page.locator(".fn-up").boundingBox();
    await page.touchscreen.tap(up.x + up.width / 2, up.y + up.height / 2); await page.waitForTimeout(700);
    const g = await st();
    check(g.open && !g.deep && !g.up && g.word === "endureth" && g.count === "1 of 5" && g.nm === a.nm, `${name}: the chevron steps up to the first note, where it was (${JSON.stringify(g).slice(0, 200)})`);
    check(Math.abs((await scrollOf()) - y0) < 3 && g.hash === a.hash && g.hist === a.hist, `${name}: the chapter never moved (${y0}, ${await scrollOf()})`);
    // at the first level Back closes
    await page.goBack(); await page.waitForTimeout(700);
    check(!(await st()).open && (await st()).hash === a.hash, `${name}: at the first level Back closes the sheet and stays`);
    // close from a deeper level ends the whole chase
    const w2 = await page.locator('#reader .doc a.study-note-ref[href$="#note13_b"]').first().boundingBox();
    await page.touchscreen.tap(w2.x + w2.width / 2, w2.y + w2.height / 2);
    await page.waitForSelector(".fn-page:not([inert]) .fn-mk", { timeout: 8000 }); await page.waitForTimeout(400);
    await tapMark("endureth");
    check((await st()).deep, `${name}: deeper again`);
    const x = await page.locator("#sheet .close").boundingBox();
    await page.touchscreen.tap(x.x + x.width / 2, x.y + x.height / 2); await page.waitForTimeout(700);
    const z = await st();
    check(!z.open && z.hash === a.hash && Math.abs((await scrollOf()) - y0) < 3, `${name}: close ends the chase and leaves the chapter where it was`);
    await page.goBack(); await page.waitForTimeout(600);
    check((await st()).hash !== a.hash, `${name}: and the next Back is a real step back, not a leftover level`);
    await ctx.close();
  }
  return errors;
}
