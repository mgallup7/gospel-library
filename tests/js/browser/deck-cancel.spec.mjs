import fs from "node:fs";
// deck-cancel: every change on the board can be taken back, and every mode can be left.
// A connection is made by tap and by drag (real pointer events) and cancelled each way; a link, a
// removed card (its notes and links) and an opened saved deck are undone. iPad and phone sizes.
// Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-cancel/";
  fs.mkdirSync(OUT, { recursive: true });
  const seed = { id: "dc1", title: "Faith", subtitle: "", theme: "royal", themeSet: true, updated: Date.now(), chain: null, links: [], items: [
    { id: "a", type: "passage", kind: "verse", doc_id: 1316, pid: "p21", citation: "Alma 32:21", where: "", hl: [], text: "And now as I said concerning faith faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.", verses: [{ n: 21, text: "And now as I said concerning faith faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true." }] },
    { id: "b", type: "passage", kind: "verse", doc_id: 2, pid: "p1", citation: "Hebrews 11:1", where: "", hl: [], text: "Now faith is the substance of things hoped for, the evidence of things not seen.", verses: [{ n: 1, text: "Now faith is the substance of things hoped for, the evidence of things not seen." }] },
    { id: "c", type: "passage", kind: "verse", doc_id: 3, pid: "p6", citation: "Ether 12:6", where: "", hl: [], text: "And now, I, Moroni, would speak somewhat concerning these things; I would show unto the world that faith is things which are hoped for and not seen; wherefore, dispute not because ye see not, for ye receive no witness until after the trial of your faith.", verses: [{ n: 6, text: "And now, I, Moroni, would speak somewhat concerning these things; I would show unto the world that faith is things which are hoped for and not seen; wherefore, dispute not because ye see not, for ye receive no witness until after the trial of your faith." }] },
  ] };
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 300)}`); });
    page.on("dialog", (d) => { errors.push(`${name}: a browser dialog appeared: ${d.message()}`); d.dismiss().catch(() => {}); });
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const shot = (l) => page.screenshot({ path: `${OUT}${name}-${l}.png` });
    const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.Deck.state)));
    const toastText = () => page.evaluate(() => { const t = document.querySelector("#toast.show"); return t ? t.textContent : ""; });
    const undoToast = async () => { await page.click("#toast.show .toast-action"); await page.waitForTimeout(250); };
    const settle = () => page.waitForTimeout(250);
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
    check(!(await page.evaluate(() => window.Deck.canUndo())), "a deck just loaded has nothing to undo");

    // ---- a highlight, then a connection by tap; the toast's Undo takes the connection back
    const word = (id, i) => `.bcard[data-id='${id}'] .w[data-i='${i}']`;
    await page.click(word("a", 9)); await page.click(word("a", 13));
    await settle();
    check(/Highlighted/.test(await toastText()), `a highlight should say so, with Undo: ${await toastText()}`);
    check((await state()).items[0].hl.length === 1, "the phrase should be highlighted");
    const tapLink = async (toWord) => {
      if (!(await page.locator(".bcard[data-id='a'] .hl-tools").count())) await page.click(".bcard[data-id='a'] .hl-run .w");
      await page.click(".bcard[data-id='a'] .hl-tools button:has-text('Link to')");
      await page.click(word("b", toWord));
      await page.waitForSelector(".bpop", { timeout: 3000 });
    };
    await tapLink(4);
    let s = await state();
    check(s.links.length === 1 && s.items[1].hl.length === 1, `a tap on a plain word should link to it: ${s.links.length} links, ${s.items[1].hl.length} highlights`);
    check(/Linked/.test(await toastText()) && (await page.locator("#toast.show .toast-action").count()) === 1, "Linked should offer Undo");
    await shot("01-linked");
    await undoToast();
    s = await state();
    check(s.links.length === 0, "Undo should take the connection back");
    check(s.items[1].hl.length === 0, "and the one-word highlight the link made");
    check(s.items[0].hl.length === 1, "the phrase highlighted before the link stays");
    check((await page.locator(".bpop").count()) === 0, "the label editor should close when its link is undone");

    // ---- Remove link takes the one-word highlight it made, and Undo brings both back
    await tapLink(4);
    await page.click(".bpop button:has-text('Remove link')");
    await settle();
    s = await state();
    check(s.links.length === 0 && s.items[1].hl.length === 0, `Remove link should leave no stray highlight: ${s.items[1].hl.length}`);
    check(/Connection removed/.test(await toastText()), "Remove link should say so");
    await undoToast();
    s = await state();
    check(s.links.length === 1 && s.items[1].hl.length === 1, "Undo should bring the connection and its highlight back");

    // ---- a card removed: its speaker notes and its connection come back
    await page.click(".bcard[data-id='a'] .notes-toggle");
    await page.fill(".bcard[data-id='a'] .bc-notes-text", "Read slowly.");
    await page.click(".bcard[data-id='a'] .bc-tools button[aria-label='Remove from the deck']");
    await settle();
    s = await state();
    check(s.items.length === 2 && s.links.length === 0, "the card and its connection should go");
    check(/Removed Alma 32:21, with its 1 connection and speaker notes/.test(await toastText()), `the toast should say what went with the card: ${await toastText()}`);
    await shot("02-card-removed");
    await undoToast();
    s = await state();
    check(s.items.length === 3 && s.items[0].id === "a" && s.items[0].notes === "Read slowly." && s.links.length === 1, "Undo should bring the card back in its place, with its notes and its connection");

    // ---- a move, and Cmd+Z once the toast has gone
    await page.click(".bcard[data-id='b'] .bc-tools button[aria-label='Move down']");
    await settle();
    check((await state()).items.map((i) => i.id).join("") === "acb" && /Moved down/.test(await toastText()), "Move down should move the card and say so");
    await page.evaluate(() => window.Deck.undo());
    check((await state()).items.map((i) => i.id).join("") === "abc", "Deck.undo() should put the card back");

    // ---- a saved deck opened over unsaved work asks first, and Undo brings the work back
    await page.click(".board-row button:has-text('More')");
    await page.click(".board button:has-text('Save to my decks')");
    await settle();
    await page.click(".board .board-foot button:has-text('+ Question')");
    await page.fill(".bcard.question textarea", "What has faith asked of you?");
    await page.click(".board .deck-actions button:text-is('My decks')");
    await page.waitForSelector(".board-saved .deck-item", { timeout: 5000 });
    await page.click(".board-saved .deck-item .preview");
    await page.waitForSelector(".dsheet", { timeout: 3000 });
    check(/not in My decks as it stands/.test(await page.textContent(".dsheet")), "opening a saved deck over unsaved work should ask in the app's own sheet");
    await shot("03-open-saved-asks");
    await page.click(".dsheet button:has-text('Cancel')");
    check((await state()).items.length === 4, "Cancel should leave the deck alone");
    await page.click(".board-saved .deck-item .preview");
    await page.click(".dsheet button:has-text('Go on without saving it')");
    await settle();
    s = await state();
    check(s.items.length === 3 && !s.items.some((i) => i.type === "question"), "the saved deck should replace the one in progress");
    check(/Opened/.test(await toastText()), "opening a deck should say so, with Undo");
    await undoToast();
    s = await state();
    check(s.items.length === 4 && s.items.some((i) => i.type === "question" && /faith asked/.test(i.text)), "Undo should bring the unsaved deck back");

    // ---- Start a new deck: the same question, and the empty board offers Undo
    await page.click(".board .deck-actions button:has-text('Start a new deck')");
    await page.click(".dsheet button:has-text('Go on without saving it')");
    await settle();
    check((await state()).items.length === 0, "Start a new deck should empty the deck");
    await page.waitForTimeout(5600); // the toast has gone; the board's own Undo is still there
    await shot("04-new-deck");
    await page.click(".board-empty button:has-text('Undo the last change')");
    await settle();
    check((await state()).items.length === 4, "the board's Undo should bring the deck back after the toast has gone");

    await ctx.close();
  }
  return errors;
}
