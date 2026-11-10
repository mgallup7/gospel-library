// concordance-kept: the concordance keeps its grouping per (match, filters, mode) and, once the
// meaning index is in, counts from the full-text index alone. Whatever way it is counted, the
// answer must be the one the plain SQL join gives: totals, chips, chapters, rows and their order.
export default async function run(browser, { BASE, PASS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

  const compare = (label) => page.evaluate(async (label) => {
    const bad = [], seen = [];
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    for (const q of ["lord", "faith", "book:alma faith", "plan of salvation", "faith hope charity", "\"endure to the end\"", "redeem*", "scope:nt grace"]) {
      const s = await GL.api("search", { q });
      if (!s.lexical_match) { bad.push(`${q}: no match to count`); continue; }
      const p = { match: s.lexical_match, filters: s.filters || {}, limit: 600 };
      for (const exact of [false, true]) {
        const join = await GL.api("concordance", { ...p, exact, via: "join" });
        const first = await GL.api("concordance", { ...p, exact });
        const again = await GL.api("concordance", { ...p, exact });
        const fresh = await GL.api("concordance", { ...p, exact, via: "fresh" });
        const what = `${label} ${q}${exact ? " (exact)" : ""}`;
        if (join.error) bad.push(`${what}: ${join.error}`);
        if (!exact && join.total !== s.lexical_total && s.lexical_total !== undefined) bad.push(`${what}: the search counted ${s.lexical_total}, the concordance ${join.total}`);
        if (!same(join, first)) bad.push(`${what}: the first answer differs from the join (${first.total} vs ${join.total})`);
        if (!same(join, again)) bad.push(`${what}: the kept answer differs from the join`);
        if (!same(join, fresh)) bad.push(`${what}: the fresh count differs from the join`);
        if (join.by_book.reduce((a, b) => a + b.n, 0) !== join.total) bad.push(`${what}: the chips do not add up`);
        // every chip, twice: the kept grouping must not be worn by being read
        for (const b of join.by_book.slice(0, 6)) {
          const jb = await GL.api("concordance", { ...p, exact, book: b.key, via: "join" });
          const kb = await GL.api("concordance", { ...p, exact, book: b.key });
          const kb2 = await GL.api("concordance", { ...p, exact, book: b.key });
          if (jb.total !== b.n) bad.push(`${what} / ${b.key}: the chip says ${b.n}, the list ${jb.total}`);
          if (!same(jb, kb) || !same(jb, kb2)) bad.push(`${what} / ${b.key}: the kept chip differs from the join`);
        }
        const small = await GL.api("concordance", { ...p, exact, limit: 25 });
        if (!same(small.passages, join.passages.slice(0, 25)) || small.total !== join.total) bad.push(`${what}: a shorter list should be the head of the longer`);
        seen.push([q, exact, join.total]);
      }
    }
    const broken = await GL.api("concordance", { match: "AND (", filters: {} });
    if (!broken.error || broken.total !== 0) bad.push(`${label}: a match the index cannot read should come back as an error`);
    return { bad, seen };
  }, label);

  // straight after launch, when the meaning index may not have left its table of documents yet
  const early = await compare("early");
  early.bad.forEach((b) => errors.push(b));
  check(early.seen.length >= 14, `queries compared: ${early.seen.length}`);
  check(early.seen.some(([q, exact, n]) => q === "faith" && exact && n > 0) && early.seen.some(([q, exact, n]) => q === "lord" && !exact && n > 5000), "faith and lord should have been counted");
  const faith = early.seen.filter(([q]) => q === "faith").map((r) => r[2]);
  check(faith[1] < faith[0], `exact faith (${faith[1]}) should be fewer than the family (${faith[0]})`);

  // and with it: the same numbers, counted from the index
  await page.evaluate(() => GL.api("loadSemantic", { base: new URL("./", location.href).href }));
  const st = await page.evaluate(() => GL.api("semanticStatus", {}));
  check(st.loaded, "the meaning index should be loaded");
  const late = await compare("late");
  late.bad.forEach((b) => errors.push(b));
  check(JSON.stringify(late.seen) === JSON.stringify(early.seen), "the totals should be the same before and after the meaning index is in");
  console.log("concordance-kept:", early.seen.map(([q, e, n]) => `${q}${e ? " exact" : ""} ${n}`).join(", "));
  await ctx.close();
  return errors;
}
