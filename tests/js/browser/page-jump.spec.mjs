// page-jump: the printed page. The reader shows where each page of the printed book begins, and
// "PMG p. 28" or "Book of Mormon page 290" in the search box opens the place that page starts.
// (Needs a test library whose pages carry the Church's page marks.)
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS); await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  const ask = (q) => page.evaluate(async (q) => { const s = await GL.api("search", { q, limit: 5 }); return s.jump ? { label: s.jump.label, title: s.jump.title, pid: s.jump.pid, named: !!s.jump.named } : null; }, q);
  const bom = await ask("Book of Mormon p. 290");
  if (!bom) { console.log("page-jump: skipped, the test library's pages carry no page marks"); await ctx.close(); return errors; }
  check(bom.title === "Alma 32" && bom.pid === "p27" && /Book of Mormon, page 290/.test(bom.label) && !bom.named, `a page of the Book of Mormon by its number: ${JSON.stringify(bom)}`);
  for (const [q, title] of [["book of mormon page 288", "Alma 32"], ["bom pg 290", "Alma 32"], ["Book of Mormon, p. 1", "1 Nephi 1"], ["BD p. 641", "Faith"]]) {
    const r = await ask(q);
    check(!!r && r.title === title, `${JSON.stringify(q)} opens ${title}: ${JSON.stringify(r)}`);
  }
  for (const q of ["page 5", "faith p. 3", "Book of Mormon p. 9999", "a page of scripture"]) check((await ask(q)) === null, `${JSON.stringify(q)} is not taken for a page: ${JSON.stringify(await ask(q))}`);
  const pmg = await ask("PMG p. 29");
  if (pmg) {
    check(/Preach My Gospel/.test(pmg.label) && /page 29/.test(pmg.label), `Preach My Gospel by its page: ${JSON.stringify(pmg)}`);
    for (const q of ["preach my gospel page 28", "pmg pg. 28", "PMG, p 28"]) check(!!(await ask(q)), `${JSON.stringify(q)} finds the page`);
  } else console.log("page-jump: Preach My Gospel is not in this test library; its pages were not tried");
  // through the box: Enter opens the place, with the page's mark in view
  if (!(await page.isVisible("#q"))) { const t = await page.locator("#searchTab").boundingBox(); await page.touchscreen.tap(t.x + t.width / 2, t.y + t.height / 2); }
  await page.fill("#q", "Book of Mormon p. 290"); await page.press("#q", "Enter");
  await page.waitForSelector("#reader .doc #p27", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const seen = await page.evaluate(() => {
    const mark = [...document.querySelectorAll("#reader .doc .page-break")].find((n) => n.dataset.page === "290");
    const r = mark?.getBoundingClientRect();
    return { shown: mark ? getComputedStyle(mark, "::before").content : null, inView: !!r && r.top > 0 && r.bottom < innerHeight, text: /p\. 290/.test(document.querySelector("#reader .doc").textContent) };
  });
  check(seen.shown === '"p. 290"' && seen.inView && !seen.text, `the page opens with its number showing where the page turns, drawn and not typed: ${JSON.stringify(seen)}`);
  await page.screenshot({ path: SHOTS + "page-jump.png" });
  // a tap on the number is a tap on its verse
  const b = await page.evaluate(() => { const n = [...document.querySelectorAll("#reader .doc .page-break")].find((x) => x.dataset.page === "290").getBoundingClientRect(); return { x: n.left + n.width / 2, y: n.top + n.height / 2 }; });
  await page.touchscreen.tap(b.x, b.y); await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelector("#reader .doc #p27").classList.contains("sel")), "a tap on the number selects its verse, like a tap on its words");
  await ctx.close();
  return errors;
}
