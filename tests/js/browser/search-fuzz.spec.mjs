// search-fuzz: forty odd queries, through the engine and through the box. None may throw on the
// page or make the engine refuse; every way of writing a reference finds its chapter, keeps its
// jump card as it is typed, and opens the chapter on Return.
const ODD = [
  "", " ", "a", "z", "?", "!", ".", ",", ";", ":", "-", "--", "*", "\"", "'", "\"\"", "a\"b", "\"unclosed phrase", "faith\"", "(faith", "faith)", "[x]", "{}", "\\", "/", "%", "_", "NEAR(faith hope)", "faith AND OR NOT", "-faith", "speaker:", "year:abc",
  "חסד", "אֱלֹהִים", "πίστις", "H2617", "G4102", "🙏", "faith 🙏 hope",
  "And now as I said concerning faith, faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true, and now behold I say unto you, and I would that ye should remember, that God is merciful unto all who believe on his name; therefore he desireth, in the first place, that ye should believe.",
];
// each with the verse it should land on (null: the chapter itself). A trailing dash is a range still
// being typed: the engine finds no reference in it, and the app keeps the card it had (runSearch).
const REFS = [["Alma 32:21", "p21"], ["Alma 32;21", "p21"], ["alma32:21", "p21"], ["Alma 32:21-", "p21"], ["alma 32:21-23", "p21"], ["Alma 32", null]];

export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

  // the engine: every query answers, typed or returned
  const refused = await page.evaluate(async (qs) => {
    const out = [];
    for (const q of qs) for (const typeahead of [true, false]) {
      try { await GL.api("search", { q, typeahead }); } catch (err) { out.push(`${JSON.stringify(q.slice(0, 40))}${typeahead ? " (typed)" : ""}: ${err?.message || err}`); }
    }
    return out;
  }, [...ODD, ...REFS.map((r) => r[0])]);
  for (const r of refused) errors.push(`engine refused ${r}`);
  const jumps = await page.evaluate(async (refs) => {
    const out = {};
    for (const [q] of refs) { const s = await GL.api("search", { q }).catch(() => null); out[q] = s?.jump ? { uri: s.jump.uri || null, doc: s.jump.doc_id, pid: s.jump.pid || null } : null; }
    return out;
  }, REFS);
  const alma32 = jumps["Alma 32"]?.doc;
  for (const [q, pid] of REFS) {
    if (q.endsWith("-")) continue;
    const j = jumps[q];
    check(j && j.doc === alma32 && (pid === null || j.pid === pid), `${q}: the engine's jump is ${JSON.stringify(j)}`);
  }

  // the box: typed, then Return. A query of a letter or none leaves no list, so only page errors count.
  for (const q of ODD) {
    await page.fill("#q", q);
    await page.waitForTimeout(120);
    await page.press("#q", "Enter");
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + "search-fuzz-odd.png" });
  for (const [q, pid] of REFS) {
    await page.fill("#q", "");
    await page.waitForTimeout(150);
    await page.type("#q", q, { delay: 10 });
    const card = await page.waitForSelector("#list .jump", { timeout: 5000 }).catch(() => null);
    check(!!card, `${q}: no jump card while typing`);
    await page.press("#q", "Enter");
    const at = pid ? `#reader .doc #${pid}` : "#reader .doc";
    const opened = await page.waitForFunction((id) => window.location.hash.includes(`doc=${id}`), alma32, { timeout: 8000 }).catch(() => null);
    check(!!opened && !!(await page.waitForSelector(at, { timeout: 5000 }).catch(() => null)), `${q}: Return did not open Alma 32 (${await page.evaluate(() => location.hash)})`);
  }
  await page.screenshot({ path: SHOTS + "search-fuzz-refs.png" });
  await ctx.close();
  return errors;
}
