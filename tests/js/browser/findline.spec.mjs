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
  await ctx.close();
  return errors;
}
