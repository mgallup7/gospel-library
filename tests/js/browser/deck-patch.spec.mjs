import fs from "node:fs";
// deck-patch: a change to one card redraws that card and the lines, not the board. Twelve passages
// and four connections; a highlight, a connection, a typed note, a move and an Undo are made, and
// the cards the board built for each are counted. A burst of saves tells the rest of the app once.
// Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-patch/";
  fs.mkdirSync(OUT, { recursive: true });
  const text = "And now as I said concerning faith, faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.";
  const seed = { id: "dp1", title: "Faith", subtitle: "", theme: "royal", themeSet: true, updated: Date.now(), chain: null, links: [], items: [] };
  for (let i = 0; i < 12; i++) seed.items.push({ id: `c${i}`, type: "passage", kind: "verse", doc_id: 5000 + i, pid: `p${i + 1}`, citation: `Alma 32:${i + 1}`, where: "", hl: [{ id: `h${i}`, s: 5, e: 7 }], text, verses: [{ n: i + 1, text }] });
  for (let k = 0; k < 4; k++) seed.links.push({ id: `l${k}`, type: "link", from: { id: `c${k * 3}`, hl: `h${k * 3}` }, to: { id: `c${k * 3 + 2}`, hl: `h${k * 3 + 2}` }, label: k % 2 ? "echoes" : "" });
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 300)}`); });
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
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
    await settle();
    await page.evaluate(() => {
      window.__built = []; window.__changes = 0;
      window.addEventListener("deck:change", () => { window.__changes++; });
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains("bcard")) window.__built.push(n.dataset.id); })
        .observe(document.querySelector(".board-cards"), { childList: true });
    });
    // the cards put into the list since the last call (a new card, or one moved to another place)
    const built = async () => { await settle(); return page.evaluate(() => { const b = window.__built; window.__built = []; return b; }); };
    const order = () => page.evaluate(() => [...document.querySelectorAll(".board-cards .bcard")].map((n) => n.dataset.id).join(" "));
    const model = () => page.evaluate(() => window.Deck.state.items.map((i) => i.id).join(" "));
    const word = (id, i) => `.bcard[data-id='${id}'] .w[data-i='${i}']`;

    // a first word, then the last: each redraws its own card only
    await page.click(word("c4", 18));
    let b = await built();
    check(b.join() === "c4", `a first word should redraw one card (${b.join()})`);
    await page.click(word("c4", 20));
    b = await built();
    check(b.join() === "c4", `a highlight should redraw one card (${b.join()})`);
    check(await page.evaluate(() => window.Deck.state.items[4].hl.length) === 2, "the phrase should be highlighted");
    check(await page.locator(".bcard[data-id='c4'] .hl-run").count() === 2, "and drawn on its card");

    // a connection by tap: the two cards it joins, and a new arrow
    await page.click(".bcard[data-id='c4'] .hl-tools button:has-text('Link to')");
    b = await built();
    check(b.join() === "c4", `Link to should redraw the card it starts from (${b.join()})`);
    await page.click(word("c7", 3));
    await page.waitForSelector(".bpop", { timeout: 3000 });
    b = await built();
    check(b.slice().sort().join() === "c4,c7", `a connection should redraw its two cards (${b.join()})`);
    check(await page.locator(".board-labels .blabel").count() === 5, "the new arrow should have its badge");
    check(await page.locator(".bcard[data-id='c7'] .link-chip").count() === 1 && await page.locator(".bcard[data-id='c4'] .link-chip").count() === 1, "both cards should name the connection");
    // a name for it: the cards stay while it is typed, and both follow when the editor closes
    await page.fill(".bpop input", "same word");
    b = await built();
    check(b.length === 0, `typing a label should redraw no card (${b.join()})`);
    await page.keyboard.press("Enter");
    b = await built();
    check(b.slice().sort().join() === "c4,c7", `a label should redraw the two cards that wear it (${b.join()})`);
    check(/same word/.test(await page.textContent(".bcard[data-id='c7'] .link-chip")), "the chip should say the label");
    await page.screenshot({ path: `${OUT}${name}-01-linked.png` });

    // speaker notes: no card is redrawn, the box stays open through a highlight on its own card, and the words are kept
    await page.click(".bcard[data-id='c9'] .notes-toggle");
    await page.keyboard.type("say this slowly");
    b = await built();
    check(b.length === 0, `typing a note should redraw no card (${b.join()})`);
    await page.click(word("c10", 1)); await page.click(word("c10", 2));
    b = await built();
    check(b.join() === "c10,c10", `a highlight on the next card should leave the note's card alone (${b.join()})`);
    check(await page.evaluate(() => { const t = document.querySelector(".bcard[data-id='c9'] .bc-notes-text"); return !t.hidden && t.value === "say this slowly"; }), "the open note should still be open, with its words");
    check(await page.evaluate(() => window.Deck.state.items[9].notes) === "say this slowly", "and they should be in the deck");

    // forty saves in one turn: the rest of the app hears once
    await page.evaluate(() => { window.__changes = 0; const t = document.querySelector(".bcard[data-id='c9'] .bc-notes-text"); for (let i = 0; i < 40; i++) { t.value += "x"; t.dispatchEvent(new Event("input", { bubbles: true })); } });
    await settle();
    const heard = await page.evaluate(() => window.__changes);
    check(heard === 1, `forty keys in one frame should send one deck:change (${heard})`);

    // Undo puts the whole deck back, and the board agrees with it
    await page.evaluate(() => { while (window.Deck.canUndo()) window.Deck.undo(); });
    await built();
    check(await order() === await model(), "after Undo the cards should be in the deck's order");
    check(await page.locator(".board-cards .hl-run").count() === 12 && await page.locator(".board-labels .blabel").count() === 4, "and show the deck as it was: twelve highlights, four arrows");
    check(await page.locator(".board-cards .bcard").count() === 12 && await page.locator(".board-cards .board-foot").count() === 1, "twelve cards and one foot");
    // a card with no connections, taken off from outside the board, goes, and the rest stay as they are
    await page.evaluate(() => window.Deck.remove(5010, "p11"));
    b = await built();
    check(b.length === 0 && await page.locator(".board-cards .bcard").count() === 11, `taking one card off should build none (${b.join()})`);
    await page.screenshot({ path: `${OUT}${name}-02-after.png` });
    await ctx.close();
  }
  return errors;
}
