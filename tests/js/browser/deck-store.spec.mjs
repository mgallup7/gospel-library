import fs from "node:fs";
// deck-store: the deck and the saved decks live in IndexedDB (gospel-decks), not localStorage.
// A deck too big for localStorage comes back after a reload; a saved deck is listed after one,
// renamed and deleted; decks left in localStorage by an older version are taken in once; a full
// localStorage makes store.set say so. Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-store/";
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  const check = (c, m) => { if (!c) errors.push(m); };
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  const reload = async () => {
    await page.reload();
    await page.waitForFunction(() => window.GL?.ready && window.Deck, null, { timeout: 60000 });
    await page.evaluate(() => window.Deck.ready);
  };

  // 41 passages with long speaker notes: about 6 million characters, past what localStorage holds
  await page.evaluate(async () => {
    await window.Deck.ready;
    const notes = "Pause and let the room answer. ".repeat(4800);
    for (let n = 1; n <= 41; n++) window.Deck.addPassage({ doc_id: 1316, pid: `p${n}`, kind: "verse", verse: n, text: `Verse ${n} of the chapter.`, citation: `Alma 32:${n}` });
    for (const it of window.Deck.state.items) it.notes = notes;
    window.Deck.state.title = "Forty-one";
    await window.Deck.flush();
  });
  await reload();
  const back = await page.evaluate(() => ({ n: window.Deck.count(), title: window.Deck.state.title, notes: window.Deck.state.items[40]?.notes?.length || 0, ls: localStorage.getItem("gospel.deck") }));
  check(back.n === 41, `41 passages should come back after a reload, got ${back.n}`);
  check(back.title === "Forty-one", `the title should come back: ${back.title}`);
  check(back.notes > 100000, `the speaker notes should come back whole: ${back.notes}`);
  check(back.ls === null, "the deck should not be in localStorage");

  // save it to my decks, reload, it is listed; rename it; delete it
  await page.evaluate(async () => { const d = window.Deck.state; d.items.forEach((it) => { it.notes = ""; }); d.items.splice(3); await window.Deck.flush(); });
  await page.click("#deckBtn");
  await page.waitForSelector(".board .bcard", { timeout: 10000 });
  await page.click(".board-row button:has-text('More')");
  await page.click(".board button:has-text('Save to my decks')");
  await page.waitForTimeout(500);
  await reload();
  await page.click("#deckBtn");
  await page.waitForSelector(".board .bcard", { timeout: 10000 });
  await page.click(".board-row button:has-text('More')");
  await page.click(".board .deck-actions button:text-is('My decks')");
  await page.waitForSelector(".board-saved .deck-item", { timeout: 5000 });
  check(/Forty-one/.test(await page.textContent(".board-saved")), "the saved deck should be listed after a reload");
  await page.screenshot({ path: OUT + "01-my-decks.png" });
  page.once("dialog", (d) => d.accept("Faith, renamed"));
  await page.click(".board-saved .deck-item .rename");
  await page.waitForTimeout(300);
  await reload();
  const names = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("gospel-decks"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res) => { const r = db.transaction("saved").objectStore("saved").getAll(); r.onsuccess = () => res(r.result); });
    db.close();
    return all.map((d) => d.title);
  });
  check(names.includes("Faith, renamed"), `the rename should be kept: ${JSON.stringify(names)}`);
  await page.click("#deckBtn");
  await page.waitForSelector(".board .bcard", { timeout: 10000 });
  await page.click(".board-row button:has-text('More')");
  await page.click(".board .deck-actions button:text-is('My decks')");
  await page.waitForSelector(".board-saved .deck-item", { timeout: 5000 });
  page.once("dialog", (d) => d.accept());
  await page.click(".board-saved .deck-item .delete");
  await page.waitForTimeout(300);
  check((await page.locator(".board-saved .deck-item").count()) === 0, "the deleted deck should leave the list");

  // decks an older version left in localStorage are taken in, then leave it
  await page.evaluate(() => localStorage.setItem("gospel.decks", JSON.stringify([{ id: "old1", title: "From before", updated: 1, deck: { id: "old1", title: "From before", items: [], links: [] } }])));
  await reload();
  await page.click("#deckBtn");
  await page.waitForSelector(".board .bcard", { timeout: 10000 });
  await page.click(".board-row button:has-text('More')");
  await page.click(".board .deck-actions button:text-is('My decks')");
  await page.waitForSelector(".board-saved .deck-item", { timeout: 5000 });
  check(/From before/.test(await page.textContent(".board-saved")), "a saved deck from localStorage should be listed");
  check(await page.evaluate(() => localStorage.getItem("gospel.decks") === null), "the old saved decks should leave localStorage");

  // a full localStorage: store.set returns false and says so
  const full = await page.evaluate(async () => {
    const chunk = "x".repeat(512 * 1024);
    let i = 0;
    try { for (; i < 40; i++) localStorage.setItem(`gospel.filler${i}`, chunk); } catch (_) {}
    const ok = window.GL.store.set("deckProbe", chunk);
    await new Promise((r) => setTimeout(r, 50));
    const text = document.querySelector(".toast")?.textContent || "";
    for (let j = 0; j <= i; j++) localStorage.removeItem(`gospel.filler${j}`);
    return { ok, text };
  });
  check(full.ok === false, "store.set should return false when the store is full");
  check(/Storage is full\. The deck could not be saved\./.test(full.text), `a toast should say the store is full: ${full.text}`);
  await ctx.close();
  return errors;
}
