// newcomer: the labels a first-time reader meets. On a phone, after a search, the chapter
// arrows stay in the reader bar and the match stepper has a strip of its own that says
// "N matches"; Greek and "Aa" are in the bar; a double tap on a verse does not start Present.
// The way to every match is a button that says so. The scope chips are spelled out, the gear
// is at the top of every tab on a phone, the lamp carries its name, the stage's Close is last
// and is a word. The empty deck says what a deck is, the cards' dots are named "Link", a line
// says how to connect two phrases until the first link is made, and Download PowerPoint keeps
// its name once the file is built.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  for (const [name, viewport] of [["phone", { width: 393, height: 852 }], ["ipad", { width: 1180, height: 820 }]]) {
    const phone = name === "phone";
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

    // the empty deck explains the word
    await page.click("#deckBtn");
    await page.waitForSelector(".board .board-empty", { timeout: 10000 });
    check(/Your deck: the passages you collect for a talk or lesson\. Add verses with \+ Deck while reading, then present them or download a PowerPoint\./.test(await page.textContent(".board .board-empty")), `the empty deck says: ${(await page.textContent(".board .board-empty")).slice(0, 140)}`);
    if (phone) for (const t of ["#homeBtn", "#searchTab", "#deckBtn", "#askBtn"]) { await page.click(t); await page.waitForTimeout(250); check(await page.isVisible("#barActs .gear-btn"), `no gear at the top of ${t}`); }
    if (phone) {
      await page.click("#deckBtn"); await page.waitForTimeout(250);
      const clash = await page.evaluate(() => { const g = document.querySelector("#barActs .gear-btn").getBoundingClientRect(), m = document.querySelector(".board .my-decks").getBoundingClientRect(); return m.right > g.left + 1 && m.left < g.right && m.bottom > g.top && m.top < g.bottom; });
      check(!clash, "the gear lies over My decks");
    }

    // results: the chips spelled out, the door to every match
    if (!(await page.isVisible("#q"))) await page.click("#searchTab");
    const chips = await page.$$eval(".scopes button", (bs) => bs.map((b) => b.textContent));
    check(["Preach My Gospel", "Missionary Standards", "Joseph Smith Papers"].every((c) => chips.includes(c)) && !chips.some((c) => /^(PMG|Standards|JS Papers)$/.test(c)), `the scope chips: ${chips.join(" | ")}`);
    await page.fill("#q", "faith"); await page.press("#q", "Enter");
    await page.waitForSelector("#list .group-title .see-all", { timeout: 20000 });
    const door = await page.textContent("#list .group-title .see-all");
    check(/^See all [\d,]+, book by book/.test(door), `the way to every match reads: ${door}`);
    check(await page.evaluate(() => { const b = document.querySelector("#list .group-title .see-all"), cs = getComputedStyle(b); return cs.backgroundColor !== "rgba(0, 0, 0, 0)" && b.getBoundingClientRect().height >= 28; }), "the way to every match does not look like a button");
    await page.screenshot({ path: `${SHOTS}newcomer-${name}-results.png` });

    // the reader after a search, in a chapter with Greek under it
    await page.fill("#q", "Hebrews 11 faith"); await page.press("#q", "Enter");
    await page.waitForTimeout(900);
    const heb = await page.evaluate(async () => (await GL.api("search", { q: "Hebrews 11:1", limit: 1 })).jump.doc_id);
    await page.fill("#q", "faith"); await page.press("#q", "Enter");
    await page.waitForSelector("#list .hit", { timeout: 20000 });
    await page.evaluate((id) => GL.openDoc(id), heb);
    await page.waitForSelector("#reader .matchnav", { timeout: 10000 });
    await page.waitForTimeout(900);
    const bar = await page.evaluate(() => {
      const vis = (n) => !!n && n.getBoundingClientRect().width > 0 && getComputedStyle(n).visibility !== "hidden";
      const b = document.querySelector("#reader .reader-bar"), nav = document.querySelector("#reader .matchnav"), lamp = b.querySelector(".think-btn");
      return { chap: [...b.querySelectorAll(".chap")].filter(vis).length, navInBar: b.contains(nav), strip: !!nav.closest(".match-strip"), label: nav.firstChild.textContent, labelSeen: vis(nav.firstChild),
        stripUnderBar: nav.closest(".match-strip") ? Math.round(nav.closest(".match-strip").getBoundingClientRect().top - b.getBoundingClientRect().bottom) : null,
        orig: vis(b.querySelector(".orig-btn")) ? b.querySelector(".orig-btn").textContent : null, aa: vis(b.querySelector(".size-pop-btn .aa")) || vis(b.querySelector(".size-btns")),
        lamp: lamp ? [lamp.getAttribute("aria-label"), lamp.title, !!lamp.querySelector(".think-word")] : null, over: b.scrollWidth - b.clientWidth };
    });
    check(bar.chap === 2, `the chapter arrows are not both in the bar after a search: ${JSON.stringify(bar)}`);
    check(/^\d+ matches$/.test(bar.label) && bar.labelSeen, `the match stepper does not say how many matches: ${JSON.stringify(bar)}`);
    check(bar.strip ? !bar.navInBar && bar.stripUnderBar === 0 : !phone && bar.navInBar, `the match stepper is in the wrong place: ${JSON.stringify(bar)}`);
    check(bar.orig === "Greek" && bar.aa, `Greek and the text size are not in the bar: ${JSON.stringify(bar)}`);
    check(bar.lamp && bar.lamp[0] === "Think it through with Claude" && bar.lamp[1] === "Think it through with Claude" && bar.lamp[2], `the lamp's name: ${JSON.stringify(bar.lamp)}`);
    check(bar.over <= 1, `the reader bar overflows by ${bar.over}`);
    await page.click("#reader .matchnav button[aria-label='Next match']");
    check(/^1 of \d+$/.test(await page.evaluate(() => document.querySelector("#reader .matchnav").firstChild.textContent)), "stepping to a match does not say which one it is");
    await page.screenshot({ path: `${SHOTS}newcomer-${name}-reader.png` });
    // a double tap on a verse selects and lets go; it does not start Present
    await page.locator("#reader .doc p.verse").nth(1).dblclick();
    await page.waitForTimeout(400);
    check(await page.evaluate(() => document.querySelector("#stage").hidden), "a double tap on a verse started Present");
    await page.keyboard.press("Escape");
    // the lamp wears its word where there is room for it
    if (!phone) {
      await page.setViewportSize({ width: 1700, height: 900 }); await page.waitForTimeout(500);
      check(await page.evaluate(() => { const w = document.querySelector("#reader .reader-bar .think-word"); return !!w && w.getBoundingClientRect().width > 0 && w.textContent === "Think"; }), "on a wide bar the lamp does not say Think");
      await page.setViewportSize(viewport); await page.waitForTimeout(400);
    }

    // the deck: two passages, the dots named, the line that says how, and Link by tap
    await page.evaluate(async () => {
      const add = async (q) => { const j = (await GL.api("search", { q, limit: 1 })).jump; const c = await GL.api("context", { doc_id: j.doc_id, pid: j.pid, before: 0, after: 0 }); const p = c.paragraphs[0]; window.Deck.addPassage({ doc_id: j.doc_id, pid: j.pid, kind: "verse", citation: q, text: p.text, verses: [{ n: p.verse, text: p.text, pid: p.pid }] }); };
      GL.store.del("deckLinkHintDone");
      await add("Alma 32:21"); await add("Hebrews 11:1");
    });
    if (phone) await page.click("#deckBtn"); else await page.evaluate(() => window.Deck.showBoard());
    await page.waitForSelector(".bcard[data-type='passage'] .port-word", { timeout: 8000 }).catch(() => check(false, "the cards' dots have no Link beside them"));
    check((await page.locator(".bcard .port-word").count()) === 2 && (await page.textContent(".bcard .port-word")) === "Link", "each card's dot should be named Link");
    check(await page.locator(".board .link-hint").isHidden(), "the line about connecting shows before there are two phrases");
    for (const k of [0, 1]) { const card = page.locator(".bcard[data-type='passage']").nth(k); await card.locator(".w").nth(2).click(); await card.locator(".w").nth(4).click(); await page.waitForTimeout(250); }
    check(await page.locator(".board .link-hint").isVisible() && (await page.textContent(".board .link-hint")) === "Drag a dot to another phrase to connect them, or tap Link.", "two highlighted phrases do not bring the line that says how to connect them");
    check(await page.evaluate(() => [...document.querySelectorAll(".bcard .w.hl-e + .port, .bcard .hl-run .port, .bcard .bc-text .port")].every((p) => /^Link /.test(p.getAttribute("aria-label") || ""))), "a phrase's dot has no accessible name");
    await page.screenshot({ path: `${SHOTS}newcomer-${name}-deck.png` });
    check((await page.textContent(".board-row .primary")) === "Download PowerPoint", "the download button's name");
    await page.hover(".board-row .primary");
    await page.waitForFunction(() => document.querySelector(".board-row .primary").classList.contains("ready"), null, { timeout: 15000 }).catch(() => {});
    check((await page.textContent(".board-row .primary")) === "Download PowerPoint", "Download PowerPoint changed its name once the file was built");
    await page.locator(".bcard .port-word").first().click();
    await page.waitForSelector(".board-banner .bb", { timeout: 5000 }).catch(() => check(false, "Link did not start a link"));
    await page.locator(".bcard[data-type='passage']").nth(1).locator(".bc-src, .bc-cite").first().evaluate((n) => n.closest(".bcard").querySelector(".w").click());
    await page.waitForTimeout(500);
    check((await page.evaluate(() => window.Deck.state.links.length)) === 1, "tapping Link and then the other passage made no connection");
    check(await page.locator(".board .link-hint").isHidden(), "the line about connecting stays after the first link");

    // the stage: Close is last, and a word; the half circle says what it does
    await page.evaluate(() => window.Deck.present());
    await page.waitForSelector(".stage:not([hidden])", { timeout: 5000 });
    const ctl = await page.evaluate(() => { const bs = [...document.querySelectorAll(".stage .stage-controls button")].filter((b) => b.offsetParent).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left); const last = bs[bs.length - 1], th = document.querySelector(".stage-theme"); return { last: last.className, text: last.textContent, label: last.getAttribute("aria-label"), theme: [th.title, th.getAttribute("aria-label")], rows: new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size }; });
    check(ctl.last === "stage-close" && ctl.text === "Close" && /stop presenting/i.test(ctl.label) && ctl.rows === 1, `the stage's Close: ${JSON.stringify(ctl)}`);
    check(ctl.theme[0] === "Light or dark background" && ctl.theme[1] === "Light or dark background", `the half circle's name: ${JSON.stringify(ctl.theme)}`);
    await page.click(".stage .stage-close");
    check(await page.evaluate(() => document.querySelector("#stage").hidden), "Close did not stop presenting");
    await page.evaluate(async () => { while (window.Deck.canUndo && window.Deck.canUndo() && window.Deck.state.items.length) window.Deck.undo(); for (const it of [...window.Deck.state.items]) if (it.doc_id) window.Deck.remove(it.doc_id, it.pid); await window.Deck.flush(); });
    await ctx.close();
  }
  return errors;
}
