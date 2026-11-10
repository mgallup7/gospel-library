import fs from "node:fs";
// deck-reorder: a card is dragged to another place by its handle, with real pointer events (the
// mouse on the iPad size, a finger through the browser's touch input on the phone size). The
// cards it passes make room, the drop says where it went and its Undo puts it back, Escape and a
// drop outside the board cancel, the pane scrolls when the pointer nears its edge, and a press
// on the words or on a dot never starts it. The keyboard has the handle's arrow keys and the
// "more" menu. Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-reorder/";
  fs.mkdirSync(OUT, { recursive: true });
  const text = "Faith is not to have a perfect knowledge of things, but a hope.";
  const seed = { id: "dr1", title: "Faith", subtitle: "", theme: "royal", themeSet: true, updated: Date.now(), chain: null, links: [], items: [] };
  for (let i = 0; i < 9; i++) seed.items.push({ id: `c${i}`, type: "passage", kind: "verse", doc_id: 6000 + i, pid: `p${i + 1}`, citation: `Alma 32:${i + 1}`, where: "", hl: i < 2 ? [{ id: `h${i}`, s: 4, e: 6 }] : [], text, verses: [{ n: i + 1, text }] });
  seed.items.splice(3, 0, { id: "q", type: "question", text: "What do you hope for?", notes: "" });
  seed.links.push({ id: "l0", type: "link", from: { id: "c0", hl: "h0" }, to: { id: "c1", hl: "h1" }, label: "echoes" });
  for (const [name, viewport, touch] of [["ipad", { width: 1180, height: 820 }, false], ["iphone", { width: 393, height: 852 }, true]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 300)}`); });
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const shot = (l) => page.screenshot({ path: `${OUT}${name}-${l}.png` });
    const settle = () => page.waitForTimeout(250);
    const order = () => page.evaluate(() => window.Deck.state.items.map((i) => i.id).join(" "));
    const shown = () => page.evaluate(() => [...document.querySelectorAll(".board-cards .bcard")].map((n) => n.dataset.id).join(" "));
    const toastText = () => page.evaluate(() => { const t = document.querySelector("#toast.show"); return t ? t.textContent : ""; });
    const START = "c0 c1 c2 q c3 c4 c5 c6 c7 c8";
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

    // The pointer: the mouse, or one finger (CDP touch input, which the browser turns into pointer events of type "touch").
    const cdp = touch ? await ctx.newCDPSession(page) : null;
    const pointer = {
      down: async (x, y) => { if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); else { await page.mouse.move(x, y); await page.mouse.down(); } },
      move: async (x, y) => { if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] }); else await page.mouse.move(x, y); },
      up: async () => { if (touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); else await page.mouse.up(); },
    };
    const centre = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, top: r.top, bottom: r.bottom, h: r.height }; }, sel);
    const glide = async (x, y0, y1, steps = 8) => { for (let i = 1; i <= steps; i++) { await pointer.move(x, y0 + ((y1 - y0) * i) / steps); await page.waitForTimeout(20); } };
    const grip = (id) => `.bcard[data-id='${id}'] .bc-grip`;
    // a card's handle, brought to the middle of what shows first, so the drag has room either way
    const handle = async (id) => { await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: "center" }), grip(id)); await page.waitForTimeout(120); return centre(grip(id)); };

    // ---- the head of a card: a handle and one more button, each a 44px tap, and no row of grey squares
    const head = await page.evaluate(() => {
      const card = document.querySelector(".bcard[data-id='c0']");
      const tap = (n) => { const r = n.getBoundingClientRect(), b = getComputedStyle(n, "::before"); const grow = -parseFloat(b.top) || 0; return Math.min(r.width, r.height) + 2 * grow; };
      return { buttons: card.querySelectorAll(".bc-head button:not(.port):not(.port-word):not(.bc-cite)").length, grip: tap(card.querySelector(".bc-grip")), more: tap(card.querySelector(".bc-more")), touch: getComputedStyle(card.querySelector(".bc-grip")).touchAction };
    });
    check(head.buttons === 2, `a card's head should hold the handle and one more button (${head.buttons})`);
    check(head.grip >= 44 && head.more >= 44, `the handle and the more button should take a 44px tap (${head.grip}, ${head.more})`);
    check(head.touch === "none", "the handle should take the touch itself, so a finger drags the card and does not scroll the page");
    await shot("01-board");

    // ---- drag the first card down past two: the cards make room while it is held, and the drop puts it there
    let g = await centre(grip("c0"));
    // far enough that its foot is past the middle of the second card below it, and no further
    const c0 = await centre(".bcard[data-id='c0']"), c2 = await centre(".bcard[data-id='c2']");
    await pointer.down(g.x, g.y);
    await glide(g.x, g.y, g.y + (c2.y - c0.bottom) + 10);
    await page.waitForTimeout(250);
    const held = await page.evaluate(() => ({
      lifted: document.querySelector(".bcard[data-id='c0']").classList.contains("lifted"),
      shift: ["c1", "c2", "q"].map((id) => Math.round(new DOMMatrix(getComputedStyle(document.querySelector(`.bcard[data-id='${id}']`)).transform).m42)),
      room: Math.round(document.querySelector(".bcard[data-id='c0']").offsetHeight + 12),
      lines: getComputedStyle(document.querySelector(".board-lines")).visibility,
    }));
    check(held.lifted, "the card should be lifted while it is dragged");
    check(held.shift[0] === -held.room && held.shift[1] === -held.room && held.shift[2] === 0, `the two cards it passed should step up by its height, the next stay (${held.shift.join(", ")} for ${held.room})`);
    check(held.lines === "hidden", "the arrows should wait while the cards are shifted");
    check(await order() === START, "nothing in the deck should change until the drop");
    await shot("02-dragging");
    await pointer.up();
    await settle();
    check(await order() === "c1 c2 c0 q c3 c4 c5 c6 c7 c8", `the drop should put the card after the two it passed: ${await order()}`);
    check(await shown() === await order(), "and the board should show the deck's order");
    check(/Moved Alma 32:1 after Alma 32:3/.test(await toastText()), `the toast should say where it went: ${await toastText()}`);
    check(await page.evaluate(() => !document.querySelector(".board").classList.contains("reordering") && ![...document.querySelectorAll(".bcard")].some((c) => c.style.transform)), "the board should be at rest after the drop");
    check(await page.locator(".board-lines path.blink").count() === 1 && await page.evaluate(() => getComputedStyle(document.querySelector(".board-lines")).visibility) === "visible", "the arrow should be back, drawn for the new order");
    await shot("03-dropped");
    // Undo in the toast puts it back
    await page.click("#toast.show .toast-action");
    await settle();
    check(await order() === START && await shown() === START, `Undo should put the card back: ${await order()}`);

    // ---- drag a card up: the question goes above the two passages before it
    g = await handle("q");
    const qc = await centre(".bcard[data-id='q']"), c1 = await centre(".bcard[data-id='c1']");
    await pointer.down(g.x, g.y);
    await glide(g.x, g.y, g.y - (qc.top - c1.y) - 10);
    await pointer.up();
    await settle();
    check(await order() === "c0 q c1 c2 c3 c4 c5 c6 c7 c8", `a drag upward should put the card above the ones it passed: ${await order()}`);
    check(/Moved the question after Alma 32:1/.test(await toastText()), `and say so: ${await toastText()}`);
    check(await page.evaluate(() => window.Deck.undo()) && await order() === START, "the deck's own Undo should put it back too");
    await settle();

    // ---- Escape while dragging: nothing moves
    g = await handle("c1");
    await pointer.down(g.x, g.y);
    await glide(g.x, g.y, g.y + 220);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    check(await page.evaluate(() => !document.querySelector(".board").classList.contains("reordering") && ![...document.querySelectorAll(".bcard")].some((c) => c.style.transform)), "Escape should put every card back where it was");
    await pointer.up();
    await settle();
    check(await order() === START && await shown() === START, `Escape should cancel the move: ${await order()}`);
    check(/Not moved/.test(await toastText()), `and say so: ${await toastText()}`);

    // ---- a drop outside the board cancels (the other pane on a wide screen, far above the cards on a phone)
    g = await handle("c1");
    await pointer.down(g.x, g.y);
    await glide(g.x, g.y, g.y + 180);
    if (viewport.width >= 760) { const left = await page.evaluate(() => document.querySelector(".board-canvas").getBoundingClientRect().left); await pointer.move(left - 40, g.y + 180); await pointer.move(left - 60, g.y + 180); }
    else { const box = await page.evaluate(() => document.querySelector("header.bar")?.getBoundingClientRect().bottom || 0); await glide(g.x, g.y + 180, Math.max(2, box - 70)); }
    await page.waitForTimeout(80);
    const outNow = await page.evaluate(() => document.querySelector(".bcard[data-id='c1']").classList.contains("out"));
    await pointer.up();
    await settle();
    if (outNow) check(await order() === START && /Not moved/.test(await toastText()), `a drop outside the board should cancel: ${await order()}, ${await toastText()}`);
    else if (viewport.width >= 760) check(false, "the card should show that a drop outside the board will cancel");
    await page.evaluate(() => { while (window.Deck.canUndo()) window.Deck.undo(); }); // a phone with no room above the cards has just moved it; put it back
    await settle();
    check(await order() === START, "back at the start");

    // ---- the pane scrolls when the pointer nears its bottom edge, so a card can go past what shows
    const scrollTop = () => page.evaluate(() => { for (let n = document.querySelector(".board-canvas").parentElement; n; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n.scrollTop; } return document.scrollingElement.scrollTop; });
    const before = await scrollTop();
    g = await centre(grip("c0"));
    await pointer.down(g.x, g.y);
    await glide(g.x, g.y, viewport.height - 12);
    await page.waitForTimeout(900);
    await pointer.move(g.x, viewport.height - 14);
    const scrolled = (await scrollTop()) - before;
    check(scrolled > 150, `the pane should scroll while the card is held near its bottom edge (${scrolled}px)`);
    await pointer.up();
    await settle();
    const at = (await order()).split(" ").indexOf("c0");
    check(at >= 4, `the card should land further down than the screen showed at the start (place ${at + 1})`);
    await page.click("#toast.show .toast-action");
    await settle();
    check(await order() === START, "Undo should bring it back from there");
    await page.evaluate(() => { for (let n = document.querySelector(".board-canvas").parentElement; n; n = n.parentElement) n.scrollTop = 0; window.scrollTo(0, 0); });
    await settle();

    // ---- a press that begins on the words marks a phrase, and one on a dot draws a link: neither moves a card
    const w = await centre(".bcard[data-id='c2'] .w[data-i='4']");
    await pointer.down(w.x, w.y);
    await glide(w.x, w.y, w.y + 220);
    check(!(await page.evaluate(() => document.querySelector(".board").classList.contains("reordering"))), "a drag that starts on the words should not lift the card");
    await pointer.up();
    await settle();
    check(await order() === START, "and should not move it");
    const dot = await centre(".bcard[data-id='c0'] .bc-text .port");
    await pointer.down(dot.x, dot.y);
    await glide(dot.x, dot.y, dot.y + 60, 4);
    const linkDrag = await page.evaluate(() => ({ dragging: document.querySelector(".board").classList.contains("dragging"), reordering: document.querySelector(".board").classList.contains("reordering") }));
    check(linkDrag.dragging && !linkDrag.reordering, "a drag from a dot should draw a link, not move the card");
    await page.keyboard.press("Escape");
    await pointer.up();
    await settle();
    check(await order() === START, "and the order should stand");
    await page.evaluate(() => { while (window.Deck.canUndo()) window.Deck.undo(); });
    await settle();

    // ---- the keyboard: the handle's arrow keys, with the focus staying on the handle
    await page.focus(grip("c2"));
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await settle();
    check(await order() === "c2 c0 c1 q c3 c4 c5 c6 c7 c8", `two presses of the up arrow should move the card up two: ${await order()}`);
    check(await page.evaluate(() => document.activeElement === document.querySelector(".bcard[data-id='c2'] .bc-grip")), "the focus should stay on the moved card's handle");
    await page.keyboard.press("ArrowDown");
    await settle();
    check(await order() === "c0 c2 c1 q c3 c4 c5 c6 c7 c8", "the down arrow should move it down");
    // ---- the more menu: Move up twice without leaving it, Move to the end, Remove; Escape closes it
    await page.click(".bcard[data-id='q'] .bc-more");
    check(await page.locator(".bcard[data-id='q'] .bc-menu [role=menuitem]").count() === 5, "the menu should hold four moves and Remove");
    await shot("04-menu");
    await page.keyboard.press("Enter"); // the focus is on Move up
    await page.keyboard.press("Enter");
    await settle();
    check(await order() === "c0 q c2 c1 c3 c4 c5 c6 c7 c8", `Move up, twice from the keyboard, should move the card twice: ${await order()}`);
    check(await page.evaluate(() => document.activeElement?.textContent) === "Move up", "the menu should stay open with Move up in focus");
    await page.keyboard.press("Escape");
    await settle();
    check(await page.locator(".bc-menu").count() === 0 && await page.evaluate(() => document.activeElement === document.querySelector(".bcard[data-id='q'] .bc-more")), "Escape should close the menu and give the focus back to its button");
    await page.click(".bcard[data-id='c0'] .bc-more");
    await page.click(".bcard[data-id='c0'] .bc-menu button:has-text('Move to the end')");
    await settle();
    check((await order()).endsWith("c8 c0") && /Moved Alma 32:1 after Alma 32:9/.test(await toastText()), `Move to the end should say where it went: ${await toastText()}`);
    check(await page.evaluate(() => { const b = [...document.querySelectorAll(".bcard[data-id='c0'] .bc-menu button")]; return b[1].disabled && b[3].disabled && !b[0].disabled; }), "at the end, Move down and Move to the end should be off");
    await page.click(".bcard[data-id='c3'] .w[data-i='2']"); // a tap elsewhere closes the menu
    await settle();
    check(await page.locator(".bc-menu").count() === 0, "a tap outside the menu should close it");
    await page.click(".bcard[data-id='c8'] .bc-more");
    await page.click(".bcard[data-id='c8'] .bc-menu button:has-text('Remove from the deck')");
    await settle();
    check(!(await order()).includes("c8") && /Removed Alma 32:9/.test(await toastText()), "Remove, from the menu, should take the card off and say so");
    await ctx.close();
  }
  return errors;
}
