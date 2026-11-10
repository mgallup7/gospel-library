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

    // ---- the arrow: it runs clear of every word and card tool, wears its name once it has one,
    // and its badge takes a 44px tap
    const arrow = () => page.evaluate(() => {
      const c = document.querySelector(".board-canvas").getBoundingClientRect();
      const boxes = [...document.querySelectorAll(".bcard .w, .bcard .bc-tools button, .bcard .vn")].map((n) => n.getBoundingClientRect());
      let over = 0, n = 0;
      for (const p of document.querySelectorAll(".board-lines path.blink")) {
        const len = p.getTotalLength();
        for (let d = 0; d <= len; d += 3) { const pt = p.getPointAtLength(d); const x = pt.x + c.left, y = pt.y + c.top; n++; if (boxes.some((r) => x > r.left + 0.5 && x < r.right - 0.5 && y > r.top + 2 && y < r.bottom - 2)) over++; }
      }
      const b = document.querySelector(".blabel");
      const r = b.getBoundingClientRect(), inset = parseFloat(getComputedStyle(b, "::before").top) || 0;
      return { n, over, badge: b.className, text: b.textContent, hit: [Math.round(r.width - 2 * inset), Math.round(r.height - 2 * inset)], h: Math.round(r.height) };
    });
    await page.waitForTimeout(100);
    let ar = await arrow();
    check(ar.n > 20 && ar.over === 0, `the arrow should not cross a word, a verse number or a card tool: ${ar.over} of ${ar.n} points do`);
    check(ar.hit[0] >= 44 && ar.hit[1] >= 44 && ar.h === 22, `the badge should be a 22px circle with a 44px hit area: ${JSON.stringify(ar)}`);
    await page.click(".bcard[data-id='b'] .link-chip");
    await page.click(".bpop .shelf button:has-text('defines')");
    await page.waitForTimeout(150);
    ar = await arrow();
    check(/named/.test(ar.badge) && /defines/.test(ar.text), `a named connection should show its name on the arrow: ${JSON.stringify(ar)}`);
    check(ar.over === 0 && ar.hit[1] >= 44, "and still run clear of the words");
    await shot("01b-arrow-named");

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

    // ---- link mode can always be left: the banner stays in view, and Cancel, Escape, a tap on
    // empty board and Back each leave it, with no connection made
    const linking = () => page.evaluate(() => !!document.querySelector(".board-banner:not([hidden]) .bb"));
    const inView = (sel) => page.evaluate((s) => { const n = document.querySelector(s); if (!n) return false; const r = n.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth && (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest(s) === n); }, sel);
    const startLink = async () => {
      await page.evaluate(() => document.querySelector(".bcard[data-id='a']").scrollIntoView({ block: "start" }));
      if (!(await page.locator(".bcard[data-id='a'] .hl-tools").count())) await page.click(".bcard[data-id='a'] .hl-run .w");
      await page.click(".bcard[data-id='a'] .hl-tools button:has-text('Link to')");
      await settle();
    };
    const hashBefore = await page.evaluate(() => location.hash);
    await startLink();
    check(await linking(), "Link to… should show the banner");
    check((await page.locator(".bcard[data-id='a'] .hl-run.src").count()) === 1 && (await page.locator(".bcard.link-src").count()) === 1, "the source phrase and its card should be marked while linking");
    await page.evaluate(() => document.querySelector(".bcard[data-id='c']").scrollIntoView({ block: "end" }));
    await page.evaluate(() => { const b = document.querySelector(".board"); const sc = b.closest(".pane") && getComputedStyle(b.closest(".pane")).overflowY === "auto" ? b.closest(".pane") : document.scrollingElement; sc.scrollTop = sc.scrollHeight; });
    await settle();
    check(await inView(".board-banner .bb"), "the banner should stay in view when the board has scrolled to its end");
    check(await inView(".board-banner .bb button"), "and its Cancel with it");
    await shot("05-linking-scrolled");
    await page.click(".board-banner .bb button:has-text('Cancel')");
    await settle();
    check(!(await linking()) && (await state()).links.length === 1, "Cancel should leave link mode with nothing linked");
    await startLink();
    await page.keyboard.press("Escape");
    await settle();
    check(!(await linking()), "Escape should leave link mode");
    await startLink();
    await page.click(word("a", 24));
    await settle();
    check(!(await linking()) && (await state()).links.length === 1, "a tap on the source card should leave link mode");
    check((await page.locator(".bcard .w.first").count()) === 0, "and start no highlight");
    await startLink();
    await page.click(".board > .deck-hint");
    await settle();
    check(!(await linking()), "a tap on empty board should leave link mode");
    await startLink();
    await page.goBack();
    await settle();
    check(!(await linking()), "Back should leave link mode");
    check((await page.evaluate(() => location.hash)) === hashBefore && (await page.locator(".board .bcard").count()) >= 3 && (await page.evaluate(() => document.querySelector(".board").offsetParent !== null)), "and stay on the deck");
    check((await state()).links.length === 1, "no connection should have been made by any of the ways out");

    // ---- the first word of a phrase: Escape or a tap elsewhere drops it
    await page.click(word("c", 3));
    check((await page.locator(".bcard[data-id='c'] .w.first").count()) === 1, "the first word should be marked");
    await page.keyboard.press("Escape");
    check((await page.locator(".bcard .w.first").count()) === 0 && (await page.locator(".bc-hint.first-word").count()) === 0, "Escape should drop the first word");
    await page.click(word("c", 3));
    await page.click(".board .deck-title");
    check((await page.locator(".bcard .w.first").count()) === 0, "a tap outside the passage should drop the first word");
    check((await state()).items[2].hl.length === 0, "and nothing is highlighted");

    // ---- a connection by drag, with real pointer events; then each way of cancelling a drag
    const center = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const dragFrom = async (to, { release = true, esc = false } = {}) => {
      await page.evaluate(() => document.querySelector(".bcard[data-id='a']").scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -140)); // out from under the phone's header
      await settle();
      const from = await center(".bcard[data-id='a'] .bc-text .port");
      const dest = typeof to === "string" ? await center(to) : to(from);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 8, from.y + 12, { steps: 2 });
      await page.mouse.move(dest.x, dest.y, { steps: 8 });
      await page.waitForTimeout(80);
      const mid = await page.evaluate(() => ({ src: !!document.querySelector(".bcard.drag-src"), banner: !!document.querySelector(".board-banner:not([hidden]) .bb"), line: !!document.querySelector(".board-lines .temp") }));
      if (esc) await page.keyboard.press("Escape");
      if (release) await page.mouse.up();
      await settle();
      return mid;
    };
    let mid = await dragFrom(word("c", 1));
    check(mid.src && mid.banner && mid.line, `while dragging, the source card and the banner should say how to cancel: ${JSON.stringify(mid)}`);
    s = await state();
    check(s.links.length === 2 && s.links[1].from.id === "a" && s.links[1].to.id === "c", `a drag onto a word should link to it: ${s.links.length}`);
    await page.waitForSelector(".bpop", { timeout: 3000 });
    await shot("06-drag-linked");
    await undoToast();
    s = await state();
    check(s.links.length === 1 && s.items[2].hl.length === 0, "Undo should take the dragged connection back, and the highlight it made");
    mid = await dragFrom(word("c", 1), { esc: true });
    check((await state()).links.length === 1, "Escape during a drag should cancel it, even with the finger let go over a target");
    check(!(await page.evaluate(() => !!document.querySelector(".board.dragging, .bcard.drag-src, .board-lines .temp, .board-banner:not([hidden]) .bb"))), "and leave no trace of the drag");
    await dragFrom(".bcard[data-id='a'] .bc-cite");
    check((await state()).links.length === 1, "a release over its own card should cancel the drag");
    check(/Nothing linked/.test(await toastText()), "and say so");
    await dragFrom(".board > .deck-hint");
    check((await state()).links.length === 1, "a release over empty space should cancel the drag");
    await page.click(word("c", 1)); await page.keyboard.press("Escape");
    check((await page.locator(".bcard .w.first").count()) === 0, "the board should still take taps after cancelled drags");

    // ---- the label editor: inside the screen, Remove link beside Done, Escape and Back close it
    await page.evaluate(() => { const b = document.querySelector(".board"); const sc = b.closest(".pane") && getComputedStyle(b.closest(".pane")).overflowY === "auto" ? b.closest(".pane") : document.scrollingElement; sc.scrollTop = 0; });
    await page.evaluate(() => document.querySelector(".bcard[data-id='b'] .link-chip").scrollIntoView({ block: "end" }));
    await settle();
    await page.click(".bcard[data-id='b'] .link-chip");
    await page.waitForSelector(".bpop", { timeout: 3000 });
    check((await inView(".bpop .deck-actions .danger")) && (await inView(".bpop .bpop-t")), "the label editor should be inside the screen when its chip is at the bottom");
    const row = await page.evaluate(() => [...document.querySelectorAll(".bpop .deck-actions button")].map((b) => b.textContent));
    check(row[0] === "Done" && row[1] === "Remove link", `Remove link should sit beside Done: ${row.join(", ")}`);
    await shot("07-editor-low");
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press("Escape");
    await settle();
    check((await page.locator(".bpop").count()) === 0, "Escape should close the label editor with no field in focus");
    await page.click(".bcard[data-id='b'] .link-chip");
    await page.waitForSelector(".bpop", { timeout: 3000 });
    await page.goBack();
    await settle();
    check((await page.locator(".bpop").count()) === 0 && (await page.evaluate(() => location.hash)) === hashBefore, "Back should close the label editor and stay on the deck");
    check((await state()).links.length === 1, "closing the editor keeps the connection");

    // ---- the Markdown sheet and My decks: focus inside, the page behind inert, Escape and Back close them
    if (!(await page.locator(".board .deck-actions.secondary:not([hidden])").count())) await page.click(".board-row button:has-text('More')");
    await page.click(".board .deck-actions button:has-text('Markdown')");
    await page.waitForSelector(".dsheet", { timeout: 3000 });
    const md = await page.evaluate(() => ({ focus: !!document.activeElement.closest(".dsheet"), inert: document.querySelector("main").inert }));
    check(md.focus && md.inert, `the Markdown sheet should take the focus and make the page inert: ${JSON.stringify(md)}`);
    await page.keyboard.press("Escape");
    await settle();
    check((await page.locator(".dsheet").count()) === 0 && !(await page.evaluate(() => document.querySelector("main").inert)), "Escape should close the Markdown sheet and free the page");
    await page.click(".board .deck-actions button:has-text('Markdown')");
    await page.waitForSelector(".dsheet", { timeout: 3000 });
    await page.goBack();
    await settle();
    check((await page.locator(".dsheet").count()) === 0 && (await page.evaluate(() => location.hash)) === hashBefore && (await page.evaluate(() => document.querySelector(".board").offsetParent !== null)), "Back should close the Markdown sheet and stay on the deck");
    await page.click(".board .deck-actions button:text-is('My decks')");
    await page.waitForSelector(".board-saved .saved", { timeout: 3000 });
    check(await page.evaluate(() => !!document.activeElement.closest(".board-saved")), "My decks should take the focus");
    await page.goBack();
    await settle();
    check((await page.locator(".board-saved .saved").count()) === 0 && (await page.locator(".board .bcard").count()) >= 3 && (await page.evaluate(() => location.hash)) === hashBefore, "Back should close My decks and show the cards again");
    await page.click(".board .deck-actions button:text-is('My decks')");
    await page.waitForSelector(".board-saved .saved", { timeout: 3000 });
    await page.keyboard.press("Escape");
    await settle();
    check((await page.locator(".board-saved .saved").count()) === 0, "Escape should close My decks");
    await page.click(".board-row button:has-text('More')"); // closed again, as the next part expects

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
    await shot("04-new-deck"); // the board's own Undo is there for when the toast has gone
    await page.click(".board-empty button:has-text('Undo the last change')");
    await settle();
    check((await state()).items.length === 4, "the board's Undo should bring the deck back");

    // ---- a redraw in the middle of a drag (a passage added from the other pane) ends the drag
    // and leaves the board taking taps
    await dragFrom(word("c", 1), { release: false });
    await page.evaluate(() => { window.added = window.Deck.addQuestion("Added while a dot was being dragged").id; });
    await page.mouse.up();
    await settle();
    check(!(await page.evaluate(() => !!document.querySelector(".board.dragging, .board-lines .temp"))), "a redraw during a drag should end the drag");
    await page.evaluate(() => window.Deck.removeIds([window.added]));
    await page.click(word("c", 2));
    check((await page.locator(".bcard[data-id='c'] .w.first").count()) === 1, "the board should take taps after a drag that a redraw ended");
    await page.keyboard.press("Escape");

    if (name === "ipad") {
      // ---- an edit survives a reload that follows it at once, and so does steady typing
      const reload = async () => { await page.reload(); await page.waitForFunction(() => window.GL?.ready && window.Deck, null, { timeout: 60000 }); await page.evaluate(() => window.Deck.ready); };
      const before = (await state()).items.length;
      await page.click(".board .board-foot button:has-text('+ Slide text')");
      await reload();
      check((await state()).items.length === before + 1, `a card added just before a reload should be kept: ${(await state()).items.length} of ${before + 1}`);
      await page.click("#deckBtn");
      await page.waitForSelector(".board .bcard.note textarea", { timeout: 10000 });
      await page.click(".bcard.note .bc-card-text");
      await page.keyboard.type("Typed steadily, with no pause long enough for the old wait to end.", { delay: 35 });
      await reload();
      check((await state()).items.some((i) => i.type === "note" && /old wait to end\.$/.test(i.text || "")), "words typed steadily up to a reload should be kept");
      check(await page.evaluate(() => localStorage.getItem("gospel.deck") === null), "the copy made as the page went away should be taken in and cleared");

      // ---- a stored deck that cannot be read is set aside, and the deck is still saved afterwards
      await page.evaluate(async () => {
        await window.Deck.flush();
        const db = await new Promise((res, rej) => { const r = indexedDB.open("gospel-decks"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        await new Promise((res, rej) => { const t = db.transaction("current", "readwrite"); t.objectStore("current").put({ id: "bad", items: [null], links: [] }, "deck"); t.oncomplete = res; t.onerror = rej; });
        db.close();
      });
      await reload();
      await page.evaluate(async () => { window.Deck.addQuestion("Still saved?"); await window.Deck.flush(); });
      const kept = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => { const r = indexedDB.open("gospel-decks"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const get = (k) => new Promise((res) => { const r = db.transaction("current").objectStore("current").get(k); r.onsuccess = () => res(r.result); });
        const out = { deck: await get("deck"), aside: await get("deck-unreadable") };
        db.close();
        return out;
      });
      check(kept.aside && kept.aside.id === "bad", "an unreadable deck should be kept aside under its own key");
      check(kept.deck && kept.deck.items.some((i) => i && i.text === "Still saved?"), "and the deck should be written again after it");
    }

    await ctx.close();
  }
  return errors;
}
