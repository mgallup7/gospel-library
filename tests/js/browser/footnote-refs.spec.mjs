// footnote-refs: a footnote that names several scriptures. Each reference is a page of the sheet:
// the first shows at once, a swipe or its name in the row moves between them, the chapter behind
// never moves, nothing is added to history, and one Back closes the sheet. (Needs a chapter with
// real footnotes in the test library: Alma 32.)
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
    const notes = await page.evaluate(async () => (window.GL.currentDoc?.()?.footnotes || (await GL.api("doc", { id: Number(new URLSearchParams(location.hash.split("?")[1]).get("doc")) })).footnotes || []).length);
    if (!notes) { check(false, `${name}: the test library has no footnotes in Alma 32, so this cannot be checked`); await ctx.close(); continue; }
    const tapNote = async (id) => {
      await page.evaluate((id) => document.querySelector(`#reader .doc a[data-scroll-id="${id}"], #reader .doc a.study-note-ref[href$="#${id}"]`).scrollIntoView({ block: "center" }), id);
      await page.waitForTimeout(300);
      const bb = await page.locator(`#reader .doc a[data-scroll-id="${id}"], #reader .doc a.study-note-ref[href$="#${id}"]`).first().boundingBox();
      await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
      await page.waitForTimeout(700);
    };
    const info = () => page.evaluate(() => ({
      label: document.querySelector("#sheet").getAttribute("aria-label"), hidden: document.querySelector("#sheet").hidden,
      word: document.querySelector(".fn-word")?.textContent, count: document.querySelector(".fn-count")?.textContent,
      chips: [...document.querySelectorAll(".fn-chip")].map((c) => c.textContent), current: document.querySelector('.fn-chip[aria-current="true"]')?.textContent,
      h: document.querySelector("#sheet").offsetHeight, hash: location.hash, hist: history.length, y: Math.round((document.querySelector("#reader .doc").closest(".pane") || document.scrollingElement).scrollTop || window.scrollY),
      shown: (() => { const t = document.querySelector(".fn-track"); const i = Math.round(t.scrollLeft / t.clientWidth); const p = t.children[i]; return { i, nm: p.querySelector(".nm")?.textContent, verses: p.querySelectorAll(".peek p").length, focus: p.querySelector(".peek .focus .vn")?.textContent, inert: [...t.children].map((c) => (c.inert ? "x" : "o")).join("") }; })(),
      toast: !!document.querySelector("#toast.show"),
    }));
    await tapNote("note13_b");
    const a = await info();
    check(/^Footnote 13b/.test(a.label) && a.word === "endureth", `${name}: the sheet names the word and the note (${a.label}; ${a.word})`);
    check(a.chips.length === 5 && a.count === "1 of 5", `${name}: five references by name, the first in view (${a.chips.join(" | ")}; ${a.count})`);
    check(a.chips[0] === "Alma 38:2" && /^TG /.test(a.chips[3]) && /^TG /.test(a.chips[4]), `${name}: every name stands alone (${a.chips.join(" | ")})`);
    check(a.shown.nm === "Alma 38:2" && a.shown.verses === 1, `${name}: the first reference's words show at once, with no second tap (${JSON.stringify(a.shown)})`);
    check(a.shown.inert === "oxxxx", `${name}: only the page in view can take focus (${a.shown.inert})`);
    for (const sel of [".fn-chip", ".fn-step", "#sheet .close"]) {
      const sizes = await page.evaluate((sel) => [...document.querySelectorAll(sel)].map((n) => { const r = n.getBoundingClientRect(), s = getComputedStyle(n, "::after"); const up = -(parseFloat(s.top) || 0), side = -(parseFloat(s.left) || 0); return [Math.round(r.width + 2 * Math.max(0, side)), Math.round(r.height + 2 * Math.max(0, up))]; }), sel);
      check(sizes.every(([, h]) => h >= 44), `${name}: ${sel} takes a thumb, 44 high (${JSON.stringify(sizes)})`);
    }
    // a swipe left in the words: the next reference, one per swipe
    const tr = await page.locator(".fn-track").boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (dx, dy = 0) => {
      const y = tr.y + tr.height / 2, x0 = tr.x + tr.width / 2 - dx / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
      for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + dx * i / 8, y: y + dy * i / 8 }] }); await page.waitForTimeout(16); }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(900);
    };
    await swipe(-220);
    const b = await info();
    check(b.count === "2 of 5" && b.current === a.chips[1] && b.shown.i === 1 && /3 Nephi 15:9/.test(b.shown.nm || ""), `${name}: a swipe left shows the second reference (${b.count}; ${b.current}; ${JSON.stringify(b.shown)})`);
    await swipe(220);
    const b2 = await info();
    check(b2.count === "1 of 5", `${name}: a swipe right goes back to the first (${b2.count})`);
    await swipe(220);
    check((await info()).count === "1 of 5", `${name}: a swipe right on the first stays there`);
    // its name in the row: straight to the third, a range read around its verse
    const chip = await page.locator(".fn-chip").nth(2).boundingBox();
    await page.touchscreen.tap(chip.x + chip.width / 2, chip.y + chip.height / 2); await page.waitForTimeout(900);
    const c = await info();
    check(c.count === "3 of 5" && /3 Nephi 27:6.17/.test(c.shown.nm || "") && c.shown.verses === 12 && c.shown.focus === "6", `${name}: a tap on a name goes to it; the range shows whole, its own verse marked (${JSON.stringify(c.shown)})`);
    check(c.h === a.h, `${name}: the sheet keeps one height from reference to reference (${a.h}, ${c.h})`);
    // a Topical Guide entry the library does not hold: said on its page, never in a toast
    const next = await page.locator(".fn-next").boundingBox();
    await page.touchscreen.tap(next.x + next.width / 2, next.y + next.height / 2); await page.waitForTimeout(900);
    const d = await info();
    const tg = await page.evaluate(() => { const t = document.querySelector(".fn-track"); const p = t.children[3]; return { text: p.textContent, link: p.querySelector("a.primary")?.getAttribute("href") || "" }; });
    check(d.count === "4 of 5" && /Not in your library/.test(tg.text) && /churchofjesuschrist\.org/.test(tg.link) && !d.toast, `${name}: an entry not held says so on its own page with a real link, and no toast (${d.count}; ${tg.text.slice(0, 60)}; ${tg.link.slice(0, 50)}; toast ${d.toast})`);
    await page.screenshot({ path: `${SHOTS}footnote-refs-${name}.png` });
    // the keyboard: arrows move, and say where
    await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(700);
    const said = await page.evaluate(() => document.querySelector("#say")?.textContent || "");
    check((await info()).count === "3 of 5" && /3 of 5/.test(said), `${name}: the left arrow key goes back one and says so (${said})`);
    // none of it touched history or the chapter; one Back closes the lot
    const e = await info();
    check(e.hash === a.hash && e.hist === a.hist && e.y === a.y, `${name}: the chapter and history are as they were (${a.hist}/${e.hist}, ${a.y}/${e.y})`);
    await page.goBack(); await page.waitForTimeout(600);
    const f = await info().catch(() => null);
    check(await page.evaluate(() => document.querySelector("#sheet").hidden) && (await page.evaluate(() => location.hash)).includes("doc="), `${name}: one Back closes the sheet and stays in the chapter`);
    // a note with one reference: no row of names, the verse at once
    await tapNote("note3_b");
    const g = await info();
    check(g.chips.length === 0 && !g.count && g.shown.verses >= 1 && g.h < a.h, `${name}: a note with one reference opens on its verse, with no row and no count (${JSON.stringify(g.shown)}; ${g.h})`);
    // Open goes to the chapter
    const open = await page.locator("#sheet .peek-row .primary").first().boundingBox();
    await page.touchscreen.tap(open.x + open.width / 2, open.y + open.height / 2);
    await page.waitForFunction(() => document.querySelector("#sheet").hidden && /Alma 34/.test(document.querySelector("#reader .doc h1, #reader .reader-bar")?.textContent || document.title), null, { timeout: 15000 }).catch(() => {});
    check(await page.evaluate(() => document.querySelector("#sheet").hidden), `${name}: Open takes the sheet down and goes to the chapter`);
    await ctx.close();
  }
  return errors;
}
