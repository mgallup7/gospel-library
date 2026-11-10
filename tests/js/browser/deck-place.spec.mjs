import fs from "node:fs";
// deck-place: where a new card goes, and that the owner is told. A section heading and the
// questions from Think it through (Deck.addSection and Deck.addQuestion, as ask.js calls them)
// go after the selected card; the passages added next go under that heading and above the
// questions; a passage added later, at the end, under a section he is not working in, says so
// in its toast, with Undo. Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-place/";
  fs.mkdirSync(OUT, { recursive: true });
  const text = "Faith is not to have a perfect knowledge of things, but a hope.";
  const passage = (i) => ({ id: `c${i}`, type: "passage", kind: "verse", doc_id: 8000 + i, pid: `p${i + 1}`, citation: `Alma 32:${i + 1}`, where: "", hl: [], text, verses: [{ n: i + 1, text }] });
  const seed = { id: "pl1", title: "Faith", subtitle: "", theme: "royal", themeSet: true, updated: Date.now(), chain: null, links: [],
    items: [passage(0), passage(1), passage(2), { id: "old", type: "section", title: "Charity" }, passage(3)] };
  const fresh = (n) => ({ doc_id: 8100 + n, pid: "p1", kind: "verse", verse: n, text, citation: `Ether 12:${n}` });
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 300)}`); });
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const settle = () => page.waitForTimeout(250);
    const order = () => page.evaluate(() => window.Deck.state.items.map((i) => (i.type === "passage" ? i.citation.replace("Alma 32:", "A").replace("Ether 12:", "E") : i.type === "section" ? `[${i.title}]` : `?${i.text}`)).join(" "));
    const toastText = () => page.evaluate(() => { const t = document.querySelector("#toast.show"); return t ? t.textContent : ""; });
    // an add as the app makes one: the passage, then the caller's own plain toast
    const add = (n) => page.evaluate((p) => { window.Deck.addPassage(p); window.GL.toast("On the deck."); }, fresh(n));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.evaluate((d) => localStorage.setItem("gospel.deck", JSON.stringify(d)), seed);
    await page.reload();
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 60000 });
    await page.evaluate(() => window.Deck.ready);
    await page.click("#deckBtn");
    await page.waitForSelector(".board .bcard", { timeout: 10000 });
    await settle();

    // ---- a passage added with nothing selected goes to the end, which is under "Charity": the toast says so
    await add(1);
    await settle();
    check(await order() === "A1 A2 A3 [Charity] A4 E1", `a passage should still go to the end: ${await order()}`);
    check(/Added at the end, under the section “Charity”\.\s*Undo/.test(await toastText()), `the toast should say it went under a section: ${await toastText()}`);
    await page.screenshot({ path: `${OUT}${name}-01-under-section.png` });
    await page.click("#toast.show .toast-action");
    await settle();
    check(await order() === "A1 A2 A3 [Charity] A4", `its Undo should take the passage off: ${await order()}`);
    // working in that section (its last card touched), the same add needs no telling
    await page.evaluate(() => document.querySelector(".bcard[data-id='c3']").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await add(1);
    await settle();
    check(await order() === "A1 A2 A3 [Charity] A4 E1" && /^On the deck\.$/.test(await toastText()), `an add where he is working should keep the plain toast: ${await toastText()}`);
    await page.evaluate(() => window.Deck.undo());
    await settle();

    // ---- Think it through, with the second card selected: its section goes after that card, not at the end
    await page.evaluate(() => document.querySelector(".bcard[data-id='c1']").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    check(await page.evaluate(() => document.querySelector(".bcard[data-id='c1']").classList.contains("selected")), "the touched card should be selected");
    await page.evaluate(() => { window.Deck.addSection("Faith as a seed"); window.Deck.addQuestion("What does the passage say?"); });
    await page.evaluate(() => window.Deck.addQuestion("What will you do?"));
    await settle();
    check(await order() === "A1 A2 [Faith as a seed] ?What does the passage say? ?What will you do? A3 [Charity] A4", `the section and its questions should follow the selected card, in order: ${await order()}`);
    // the passages for it: under the heading, above the questions, in the order added, and one toast says where
    await page.evaluate(([a, b]) => { window.Deck.addPassage(a); window.Deck.addPassage(b); window.GL.toast("2 passages on the deck."); }, [fresh(2), fresh(3)]);
    await settle();
    check(await order() === "A1 A2 [Faith as a seed] E2 E3 ?What does the passage say? ?What will you do? A3 [Charity] A4", `the passages should go under the heading and above the questions: ${await order()}`);
    check(/2 passages added under the section “Faith as a seed”\.\s*Undo/.test(await toastText()), `one toast should say where both went: ${await toastText()}`);
    await page.screenshot({ path: `${OUT}${name}-02-under-new-section.png` });
    check(await page.evaluate(() => { const c = document.querySelector(".bcard[data-id]:nth-child(4)").getBoundingClientRect(); return c.bottom > 0 && c.top < innerHeight; }), "the board should show where they went");
    // one more of each: the passage after the last passage, the question after the last question
    await add(4);
    await settle();
    check(/Added after Ether 12:3\.\s*Undo/.test(await toastText()), `the next passage should say what it follows: ${await toastText()}`);
    await page.evaluate(() => window.Deck.addQuestion("What does it teach?"));
    await settle();
    check(await order() === "A1 A2 [Faith as a seed] E2 E3 E4 ?What does the passage say? ?What will you do? ?What does it teach? A3 [Charity] A4", `and each should keep its order: ${await order()}`);
    // the toast's Undo takes off what it named
    await add(5);
    await settle();
    await page.click("#toast.show .toast-action");
    await settle();
    check(!(await order()).includes("E5") && (await order()).includes("E4"), `Undo should take off the passage the toast named: ${await order()}`);

    // ---- he touches another card: the next passage goes to the end again
    await page.evaluate(() => document.querySelector(".bcard[data-id='c3']").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await add(6);
    await settle();
    check((await order()).endsWith("[Charity] A4 E6") && /^On the deck\.$/.test(await toastText()), `after a touch elsewhere a passage should go to the end, with the plain toast: ${await order()} / ${await toastText()}`);

    // ---- the board's own Add section: after the selected card, and the toast says so
    await page.evaluate(() => document.querySelector(".bcard[data-id='c0']").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    await page.click(".board .board-row button:has-text('More')");
    await page.click(".board button:has-text('Add section')");
    await settle();
    check((await order()).startsWith("A1 [] A2") && /Section added after Alma 32:1\./.test(await toastText()), `Add section should go after the selected card and say so: ${await order()} / ${await toastText()}`);
    await ctx.close();
  }
  return errors;
}
