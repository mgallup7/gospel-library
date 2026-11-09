// What the second panel found and the fixes promise: the count on "N with these words" is the
// concordance's own count, filters included; Back with a sheet open closes only the sheet; a
// reference pressed on the iPad does not trap Back; an overlapping range adds the verses not yet
// on the deck; a marks file with a bad record still leaves the shelf usable.
export default async function run(browser, { BASE, PASS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  const hash = () => page.evaluate(() => decodeURIComponent(location.hash));

  // the concordance count equals its button, with and without a book filter, and for three words
  for (const q of ["faith", "book:alma faith", "faith hope charity"]) {
    await page.fill("#q", q); await page.press("#q", "Enter");
    await page.waitForSelector("#list .group-title", { timeout: 15000 });
    await page.waitForTimeout(500);
    const btn = await page.$("#list .group-title .text-btn.inline");
    check(!!btn, `${q}: the count button should show`);
    if (!btn) continue;
    const said = Number((await btn.textContent()).replace(/[^0-9]/g, ""));
    await btn.click();
    await page.waitForSelector("#list .conc-sub", { timeout: 20000 });
    const sub = await page.textContent("#list .conc-sub");
    const got = Number((sub.match(/^([\d,]+) passage/) || [])[1]?.replace(/,/g, ""));
    check(said === got, `${q}: button said ${said}, concordance has ${got}`);
    if (q === "book:alma faith") check(!/Genesis|Matthew|Psalm/.test(await page.textContent("#list")), "a book filter should hold in the concordance");
    await page.goBack();
    await page.waitForSelector("#list .group-title", { timeout: 15000 });
  }

  // a reference pressed on the iPad opens the chapter once; Back then leaves the results
  await page.fill("#q", ""); await page.click("#homeBtn");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 15000 });
  await page.fill("#q", "Alma 32:21"); await page.press("#q", "Enter");
  await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.click("#reader .trail-back");
  await page.waitForTimeout(900);
  const afterBack = await hash();
  check(!/doc=/.test(afterBack), `Back from the chapter should not reopen it (address ${afterBack})`);
  await page.goBack();
  await page.waitForTimeout(900);
  check(await hash() === "" || await hash() === "#", `a second Back should reach home (address ${await hash()})`);

  // Back with a sheet open closes the sheet and stays
  await page.fill("#q", "Alma 32:21"); await page.press("#q", "Enter");
  await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
  await page.waitForTimeout(400);
  const before = await hash();
  await page.click("#reader .doc #p21");
  await page.click("#reader .select-bar button:has-text('Note')");
  await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
  await page.goBack();
  await page.waitForTimeout(600);
  check(await page.evaluate(() => document.querySelector("#sheet").hidden), "Back should close the sheet");
  check(await hash() === before, `and stay on the page (${await hash()} vs ${before})`);
  check(!!(await page.$("#reader .doc #p21")), "the page is still open");
  // closing by hand leaves no stale entry: one Back now leaves the page
  await page.click("#reader .doc #p22");
  await page.click("#reader .select-bar button:has-text('Note')");
  await page.waitForSelector("#sheet:not([hidden])", { timeout: 5000 });
  await page.click("#sheet .close");
  await page.waitForTimeout(300);
  await page.goBack();
  await page.waitForTimeout(900);
  check(!/doc=/.test(await hash()), `Back after closing the sheet by hand leaves the page (${await hash()})`);

  // an overlapping range: 21 on the deck, then 21 to 23 adds 22 and 23
  await page.evaluate(() => { localStorage.removeItem("gospel.deck"); for (const n of document.querySelectorAll("#reader .doc .sel")) n.classList.remove("sel"); });
  await page.goto(BASE + "#scriptures?b.book=alma&doc=1316&p=p21");
  await page.reload();
  await page.waitForSelector("#reader .doc #p21", { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.click("#reader .doc #p21");
  await page.click("#reader .select-bar .add-deck");
  await page.waitForTimeout(400);
  for (const id of ["#p21", "#p22", "#p23"]) await page.click(`#reader .doc ${id}`);
  await page.click("#reader .select-bar .add-deck");
  await page.waitForTimeout(400);
  const items = await page.evaluate(() => window.Deck.state.items.map((i) => i.citation));
  check(items.length === 2, `21 then 21 to 23 should leave two items on the deck (21, and 22 to 23), got ${JSON.stringify(items)}`);

  // a bad marks record does not take the shelf down
  const imported = await page.evaluate(async () => window.Marks.importJson(JSON.stringify({ marks: [{ uri: "/scriptures/bofm/alma/32", pid: "p30", color: "y", updated: Date.now() }] })));
  check(imported === 1, "the record without text is still taken in");
  await page.click("#homeBtn");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 15000 });
  await page.click("#homeBody .shelf-tile:has-text('My studies')");
  await page.waitForSelector("#homeBody .marks-sec", { timeout: 10000 });
  check((await page.locator("#homeBody .mark-row").count()) >= 1, "the marks section renders with the bare record");
  await ctx.close();
  return errors;
}
