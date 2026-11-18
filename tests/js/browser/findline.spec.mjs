// Finding a line: 137 searches whose right verse is known (findline-battery.json), run through the
// engine by words alone. Exact quotations, near quotations and phone typing must lead with the
// verse; paraphrases and questions are counted and may only get better. The search that began
// this, "great are the words of isaiah" (3 Nephi 23:1), is the first of them.
import fs from "node:fs";
export default async function run(browser, { BASE, PASS }) {
  const errors = [];
  const check = (ok, msg) => { if (!ok) errors.push(msg); };
  const battery = JSON.parse(fs.readFileSync(new URL("./findline-battery.json", import.meta.url), "utf8"));
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.keyboard.press("Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  const norm = (c) => String(c || "").toLowerCase().replace(/^psalms /, "psalm ").replace(/\s+/g, " ").trim();
  const rankOf = (hits, expect) => {
    const want = new Set(expect.map(norm));
    for (let i = 0; i < hits.length; i++) if (want.has(norm(hits[i].citation)) || (hits[i].more || []).some((x) => want.has(norm(x.citation)))) return i + 1;
    return null;
  };
  const search = (q, typeahead) => page.evaluate(([q, typeahead]) => GL.api("search", { q, limit: 20, light: !typeahead, typeahead }), [q, typeahead]);
  const first = { a: 0, b: 0, c: 0, d: 0, e: 0 }, top3 = { c: 0, d: 0 }, of = { a: 0, b: 0, c: 0, d: 0, e: 0 };
  for (const item of battery) {
    const r = await search(item.q, false);
    const rank = rankOf(r.hits || [], item.expect);
    of[item.kind]++;
    if (rank === 1) first[item.kind]++;
    if (rank && rank <= 3 && top3[item.kind] !== undefined) top3[item.kind]++;
    if (item.kind === "a" || item.kind === "b") check(rank === 1, `${JSON.stringify(item.q)} should lead with ${item.expect[0]}, which is ${rank ? "at " + rank : "missing"}`);
    if (item.kind === "a") {
      // while it is typed, whole and with the last word cut short
      const t = rankOf((await search(item.q, true)).hits || [], item.expect);
      check(t === 1, `typing ${JSON.stringify(item.q)} should lead with ${item.expect[0]}, which is ${t ? "at " + t : "missing"}`);
      const cut = item.q.replace(/(\p{L}{3})\p{L}+$/u, "$1");
      const p = rankOf((await search(cut, true)).hits || [], item.expect);
      check(p === 1, `typing ${JSON.stringify(cut)} should lead with ${item.expect[0]}, which is ${p ? "at " + p : "missing"}`);
    }
  }
  // the counts when this was written; they may rise, never fall
  check(first.e >= 23, `phone typing: ${first.e} of ${of.e} lead with the verse (23 before)`);
  check(first.c >= 17 && top3.c >= 20, `paraphrases: ${first.c} first and ${top3.c} in the top three of ${of.c} (18 and 21 before)`);
  check(first.d >= 15 && top3.d >= 18, `questions: ${first.d} first and ${top3.d} in the top three of ${of.d} (17 and 19 before)`);
  // the search as he made it: Return, with the meaning search on
  const r = await page.evaluate(() => GL.api("search", { q: "great are the words of isaiah", limit: 10 }));
  check(r.hits[0]?.citation === "3 Nephi 23:1" && r.hits[0].why === "exact", `"great are the words of isaiah" leads with ${r.hits[0]?.citation} (${r.hits[0]?.why})`);
  check(!r.smart.book, "the word Isaiah was read as a book to search in");
  // one word off is still a best match, and is called close
  const near = await page.evaluate(() => GL.api("search", { q: "great is the words of isaiah", limit: 10 }));
  check(near.hits[0]?.citation === "3 Nephi 23:1" && near.hits[0].why === "close", `one word off leads with ${near.hits[0]?.citation} (${near.hits[0]?.why})`);
  // a place named with its cue still narrows, and a guess that leaves nothing is dropped
  const inAlma = await page.evaluate(() => GL.api("search", { q: "what is faith in alma", limit: 10 }));
  check(inAlma.smart.book === "alma" && inAlma.hits.length && inAlma.hits.every((h) => h.book_slug === "alma"), "\"in alma\" did not keep the search to Alma");
  const dropped = await page.evaluate(() => GL.api("search", { q: "the liahona in genesis", limit: 10 }));
  check(dropped.hits.length > 0, "a guessed book that left nothing was not dropped");
  // a passage asked for by its name is offered as a card, and plain words are not taken for names
  const named = await page.evaluate(() => GL.api("search", { q: "moroni's promise", limit: 5 }));
  check(named.jump?.named && /Moroni 10:3/.test(named.jump.label) && named.jump.pid === "p3", `"moroni's promise" offered ${JSON.stringify(named.jump)}`);
  const plain = await page.evaluate(() => GL.api("search", { q: "faith", limit: 5 }));
  check(!plain.jump, `"faith" was taken for a passage's name: ${JSON.stringify(plain.jump)}`);
  await page.fill("#q", "the beatitudes"); await page.press("#q", "Enter");
  await page.waitForSelector("#list .jump", { timeout: 8000 }).catch(() => {});
  check(/Beatitudes · Matthew 5:3/.test((await page.textContent("#list .jump").catch(() => "")) || ""), "the Beatitudes card is not on the results");
  // a book named in passing is offered, one tap, and the tap keeps the search to it
  const offer = await page.evaluate(() => GL.api("search", { q: "what did alma teach about faith", limit: 5 }));
  check(offer.smart.offer?.book === "alma" && offer.smart.offer.count > 0 && !offer.smart.book, `no "Only in Alma" offer: ${JSON.stringify(offer.smart)}`);
  await page.fill("#q", "what did alma teach about faith"); await page.press("#q", "Enter");
  await page.waitForSelector("#list .only-book", { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => document.querySelector("#list .only-book")?.click());
  await page.waitForFunction(() => /book:alma/.test(document.querySelector("#q").value), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const kept = await page.evaluate(() => ({ q: document.querySelector("#q").value, cites: [...document.querySelectorAll("#list .hit .cite span:first-child")].map((c) => c.textContent) }));
  check(kept.q === "faith book:alma" && kept.cites.length > 0 && kept.cites.every((c) => /^Alma \d/.test(c)), `"Only in Alma" gave ${JSON.stringify(kept).slice(0, 300)}`);
  // a line that runs over a verse's end is found as the pair of verses
  const pair = await page.evaluate(() => GL.api("search", { q: "search these things diligently for great are the words of isaiah for surely he spake as touching all things", limit: 5, light: true }));
  check(/^3 Nephi 23:1\u20132$/.test(pair.hits[0]?.citation || "") && pair.hits[0].why === "close", `a line over two verses leads with ${pair.hits[0]?.citation} (${pair.hits[0]?.why})`);
  // a chapter that quotes another says so, and one tap puts the two side by side
  const twin = await page.evaluate(async () => { const id = (await GL.api("search", { q: "2 Nephi 12", limit: 1 })).jump.doc_id; const d = await GL.api("doc", { id }); return { id, twins: d.twins }; });
  check(twin.twins?.length === 1 && twin.twins[0].label === "Isaiah 2" && twin.twins[0].how === "quotes", `2 Nephi 12's twin: ${JSON.stringify(twin.twins)}`);
  const back = await page.evaluate(async () => { const id = (await GL.api("search", { q: "Isaiah 53", limit: 1 })).jump.doc_id; return (await GL.api("doc", { id })).twins; });
  check(back?.[0]?.label === "Mosiah 14" && back[0].how === "is quoted in", `Isaiah 53's twin: ${JSON.stringify(back)}`);
  await page.evaluate((id) => GL.openDoc(id), twin.id);
  await page.waitForSelector("#reader .twin-line .twin-open", { timeout: 8000 }).catch(() => {});
  check(/This chapter quotes Isaiah 2\./.test((await page.textContent("#reader .twin-line").catch(() => "")) || ""), "2 Nephi 12 does not say it quotes Isaiah 2");
  await page.evaluate(() => document.querySelector("#reader .twin-open")?.click());
  await page.waitForFunction(() => document.body.classList.contains("beside-open") && /Isaiah 2/.test(document.querySelector("#beside .doc h1")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
  check(await page.evaluate(() => document.body.classList.contains("beside-open") && /Isaiah 2/.test(document.querySelector("#beside .doc h1")?.textContent || "")), "the twin did not open beside");
  await ctx.close();
  // a phone has no second pane: the twin opens in the reader
  {
    const phone = await browser.newContext({ viewport: { width: 393, height: 852 } });
    const pp = await phone.newPage();
    pp.on("pageerror", (e) => errors.push(`page error (phone): ${e.message}`));
    await pp.goto(BASE); await pp.fill("div.setup input", PASS); await pp.keyboard.press("Enter");
    await pp.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    const id = await pp.evaluate(async () => (await GL.api("search", { q: "Mosiah 14", limit: 1 })).jump.doc_id);
    await pp.evaluate((id) => GL.openDoc(id), id);
    await pp.waitForSelector("#reader .twin-open", { timeout: 8000 }).catch(() => {});
    check(/^Open Isaiah 53$/.test((await pp.textContent("#reader .twin-open").catch(() => "")) || ""), "on a phone the twin should offer to open Isaiah 53");
    const box = await pp.evaluate(() => { const r = document.querySelector("#reader .twin-line")?.getBoundingClientRect(); return r ? { l: r.left, r: r.right, w: innerWidth } : null; });
    check(box && box.l >= 0 && box.r <= box.w, `the twin line runs off the phone: ${JSON.stringify(box)}`);
    await pp.evaluate(() => document.querySelector("#reader .twin-open")?.click());
    await pp.waitForFunction(() => /Isaiah 53/.test(document.querySelector("#reader .doc h1")?.textContent || ""), null, { timeout: 8000 }).catch(() => {});
    check(/Isaiah 53/.test(await pp.evaluate(() => document.querySelector("#reader .doc h1")?.textContent || "")), "the twin did not open on the phone");
    await phone.close();
  }
  return errors;
}
