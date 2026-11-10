// reload-place: a reload keeps the place, not only the page. A chapter scrolled far down comes
// back at the same verse at every size; and on an iPad a page opened from a deck card comes
// back as the page (the switch on Page), not as the board with a Back to the Deck on itself.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["portrait", { width: 820, height: 1180 }], ["phone", { width: 393, height: 852 }]]) {
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    const alma = await page.evaluate(async () => (await GL.api("search", { q: "Alma 32:1", limit: 1 })).jump.doc_id);
    await page.evaluate((id) => GL.openDoc(id), alma);
    await page.waitForSelector("#reader .doc .verse", { timeout: 10000 });
    // the verse nearest the top of what shows
    const topVerse = () => page.evaluate(() => { const bar = document.querySelector("#reader .reader-bar").getBoundingClientRect().bottom; const v = [...document.querySelectorAll("#reader .doc p.verse")].find((p) => p.getBoundingClientRect().bottom > bar + 4); return v ? v.id : null; });
    await page.evaluate(() => document.querySelector("#reader .doc #p37").scrollIntoView({ block: "start" }));
    await page.waitForTimeout(900); // the place is written a moment after the scroll comes to rest
    const was = await topVerse();
    check(/^p3[5-9]$/.test(was || ""), `the test did not scroll to verse 37 (${was})`);
    await page.reload();
    await page.waitForSelector("#reader .doc .verse", { timeout: 120000 });
    await page.waitForTimeout(900);
    check((await topVerse()) === was, `after a reload the chapter is at ${await topVerse()}, not ${was}`);
    check(/Alma 32/.test(await page.title()), `after a reload the page is ${await page.title()}`);
    await page.screenshot({ path: `${SHOTS}reload-place-${name}.png` });
    if (name !== "phone") {
      // from a deck card to its page, then a reload: the page is what shows
      await page.evaluate(async () => { const j = (await GL.api("search", { q: "Hebrews 11:1", limit: 1 })).jump; const c = await GL.api("context", { doc_id: j.doc_id, pid: j.pid, before: 0, after: 0 }); const p = c.paragraphs[0]; window.Deck.addPassage({ doc_id: j.doc_id, pid: j.pid, kind: "verse", citation: "Hebrews 11:1", text: p.text, verses: [{ n: p.verse, text: p.text, pid: p.pid }] }); await window.Deck.flush(); });
      await page.click("#deckBtn");
      await page.waitForSelector(".bcard .bc-cite", { timeout: 8000 });
      await page.click(".bcard button.bc-cite");
      await page.waitForFunction(() => /Hebrews 11/.test(document.querySelector("#reader .doc h1")?.textContent || "") && document.querySelector("#reader").offsetParent !== null, null, { timeout: 8000 }).catch(() => check(false, "the card's citation did not open its page"));
      const seen = () => page.evaluate(() => ({ hash: location.hash, page: !!document.querySelector("#reader .doc") && document.querySelector("#reader").offsetParent !== null && !document.querySelector("#reader").hidden, board: !!document.querySelector("#panel .board") && !document.querySelector("#panel").hidden, on: [...document.querySelectorAll(".pane-switch button.on")].filter((b) => b.offsetParent !== null).map((b) => b.textContent).join(","), back: [...document.querySelectorAll(".trail-back")].filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()).join("|") }));
      await page.waitForTimeout(900);
      const before = await seen();
      await page.reload();
      await page.waitForSelector("#reader .doc .verse", { timeout: 20000 }).catch(() => check(false, "after the reload no page came back"));
      await page.waitForTimeout(900);
      const after = await seen();
      check(after.hash === before.hash && after.page && !after.board && after.on === "Page", `after a reload on a page opened from a deck card: ${JSON.stringify(after)} (before: ${JSON.stringify(before)})`);
      check(after.back === before.back, `Back reads ${after.back} after the reload, ${before.back} before it`);
      await page.evaluate(async () => { for (const it of [...window.Deck.state.items]) if (it.doc_id) window.Deck.remove(it.doc_id, it.pid); await window.Deck.flush(); });
    }
    await ctx.close();
  }
  return errors;
}
