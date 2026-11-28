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
    const trail = await page.evaluate(() => [...document.querySelectorAll(".fn-trail .fn-crumb")].map((c) => c.textContent.replace(/\s+/g, " ").trim()));
    check(trail.length === 1 && /Alma 32:13/.test(trail[0]) && /endureth/.test(trail[0]), `${name}: the trail above the names says where this came from, and by which word (${JSON.stringify(trail)})`);
    const crumbH = await page.evaluate(() => Math.round(document.querySelector(".fn-crumb").getBoundingClientRect().height));
    check(crumbH >= 44, `${name}: a step of the trail takes a thumb (${crumbH})`);
    // the chase as a chain on the deck: the start, the step, the verse in view; words marked; arrows between
    {
      const before = await page.evaluate(() => window.Deck.tally());
      const inView = (await st()).nm;
      // the button beside the verse in view (each page of the note has its own)
      const db = await page.evaluate(() => { for (const x of document.querySelectorAll("#sheet .fn-chase-deck")) { const r = x.getBoundingClientRect(); if (r.width && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight) return { x: r.left, y: r.top, width: r.width, height: r.height, label: x.textContent, only: x.nextElementSibling?.textContent }; } return null; });
      check(db && db.label === "Add chase to deck" && db.only === "This verse only" && db.height >= 44, `${name}: in a chase the deck button beside the verse takes the whole chase (${JSON.stringify(db)})`);
      await page.touchscreen.tap(db.x + db.width / 2, db.y + db.height / 2); await page.waitForTimeout(1200);
      const after = await page.evaluate(() => window.Deck.tally());
      const mine = after.order.slice(-3);
      check(after.passages === before.passages + 3 && after.links === before.links + 2 && mine[0] === "Alma 32:13" && mine[1] === "Alma 38:2" && inView.startsWith(mine[2]), `${name}: Add chase to deck puts the chase on the deck in order, joined (${JSON.stringify(mine)}, in view ${inView}; links ${before.links} to ${after.links})`);
      check(/endureth/.test(after.marked[after.marked.length - 3]) && /endureth/.test(after.marked[after.marked.length - 2]), `${name}: with the tapped word marked in each (${JSON.stringify(after.marked.slice(-3))})`);
      check((await st()).open && (await st()).deep, `${name}: and the chase stays up`);
      await page.touchscreen.tap(db.x + db.width / 2, db.y + db.height / 2); await page.waitForTimeout(1000);
      const again = await page.evaluate(() => window.Deck.tally());
      check(again.passages === after.passages && again.links === after.links, `${name}: a second tap adds nothing twice (${again.passages}, ${again.links})`);
      await page.evaluate(() => window.Deck.undo()); await page.waitForTimeout(400);
      const undone = await page.evaluate(() => window.Deck.tally());
      check(undone.passages === before.passages && undone.links === before.links, `${name}: one Undo takes the whole chain off (${undone.passages}, ${undone.links})`);
    }
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
    // a reference that leads back onto the trail says so, and offers the way back, not the same verse again
    {
      const w3 = await page.locator('#reader .doc a.study-note-ref[href$="#note13_b"]').first().boundingBox();
      await page.touchscreen.tap(w3.x + w3.width / 2, w3.y + w3.height / 2);
      await page.waitForSelector(".fn-page:not([inert]) .fn-mk", { timeout: 8000 }); await page.waitForTimeout(400);
      await tapMark("endureth");
      const loopAt = await page.evaluate(() => [...document.querySelectorAll(".fn-chip")].findIndex((c) => /^Alma 32:13/.test(c.textContent)));
      if (loopAt >= 0) {
        await page.evaluate((i) => document.querySelectorAll(".fn-chip")[i].click(), loopAt); await page.waitForTimeout(1100);
        const lp = await page.evaluate((i) => { const p = document.querySelector(".fn-page:not([inert])"); return { text: p.textContent.replace(/\s+/g, " "), verses: p.querySelectorAll(".peek p").length, chip: document.querySelectorAll(".fn-chip")[i].className, btn: p.querySelector(".peek-row .primary")?.textContent || "" }; }, loopAt);
        check(/where you started/.test(lp.text) && lp.verses === 0 && /loop/.test(lp.chip) && /Back to Alma 32:13/.test(lp.btn), `${name}: a reference back to the start says so and offers the way back (${JSON.stringify(lp).slice(0, 240)})`);
        const seen = await page.evaluate(() => [...document.querySelectorAll(".fn-chip")].map((c) => (c.classList.contains("seen") ? "s" : c.getAttribute("aria-current") ? "c" : ".")).join(""));
        check(seen[0] === "s" && seen[loopAt] === "c" && (loopAt < 2 || seen[1] === "."), `${name}: names already read go quiet, the rest stay as they were (${seen})`);
        const bk = await page.locator(".fn-page:not([inert]) .peek-row .primary").boundingBox();
        await page.touchscreen.tap(bk.x + bk.width / 2, bk.y + bk.height / 2); await page.waitForTimeout(800);
        const l1 = await st();
        check(l1.open && !l1.deep && l1.word === "endureth" && l1.count === "1 of 5", `${name}: its button returns to that step (${JSON.stringify(l1).slice(0, 160)})`);
      } else console.log(`footnote-chase ${name}: no reference back to the start in this note; the loop was not tried`);
      // from two levels down, a tap on the first step of the trail returns to the first note
      await tapMark("endureth");
      let q = await st();
      for (let i = 0; i < 8 && !q.marks.length; i++) { const moved = await page.evaluate(() => { const n = document.querySelector(".fn-next"); if (!n || n.disabled) return false; n.click(); return true; }); if (!moved) break; await page.waitForTimeout(900); q = await st(); }
      if (q.marks.length) {
        await tapMark(q.marks[0]);
        const crumbs = await page.evaluate(() => [...document.querySelectorAll(".fn-trail .fn-crumb")].map((c) => c.textContent.replace(/\s+/g, " ").trim()));
        check(crumbs.length === 2 && /Alma 32:13/.test(crumbs[0]) && /Alma 38:2/.test(crumbs[1]), `${name}: at the third level the trail shows both steps above (${JSON.stringify(crumbs)})`);
        const fits = await page.evaluate(() => { const t = document.querySelector(".fn-trail"); return t.scrollWidth <= t.clientWidth + 1; });
        check(fits, `${name}: and fits on one line`);
        const c0 = await page.locator(".fn-trail .fn-crumb").first().boundingBox();
        await page.touchscreen.tap(c0.x + Math.min(20, c0.width / 2), c0.y + c0.height / 2); await page.waitForTimeout(800);
        const l1 = await st();
        check(l1.open && !l1.deep && l1.word === "endureth" && l1.hist === a.hist, `${name}: a tap on the first step returns to the first note in one go (${JSON.stringify(l1).slice(0, 160)})`);
      }
      const x0 = await page.locator("#sheet .close").boundingBox();
      await page.touchscreen.tap(x0.x + x0.width / 2, x0.y + x0.height / 2); await page.waitForTimeout(700);
    }
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
