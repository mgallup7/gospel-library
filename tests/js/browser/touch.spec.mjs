// touch.js: a flick turns the chapter (reader and the page beside), two fingers step the text
// size, a phone's reader bar steps aside while reading down, and Settings turns them all off.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (ok, msg) => { if (!ok) errors.push(msg); };
  const OUT = SHOTS + "touch-";
  const touches = async (cdp, type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
  const flick = async (cdp, x1, y, x2) => {
    await touches(cdp, "touchStart", [[x1, y]]);
    for (let i = 1; i <= 4; i++) await touches(cdp, "touchMove", [[x1 + ((x2 - x1) * i) / 4, y]]);
    await touches(cdp, "touchEnd", []);
  };
  const h1 = (page, root) => page.evaluate((r) => document.querySelector(r === "#beside" ? "#beside .bs-title:not(.bs-title-plain)" : `${r} .reader-bar .crumb`)?.textContent || "", root);
  const waitH1 = (page, root, re) => page.waitForFunction(([r, s]) => new RegExp(s).test(document.querySelector(r === "#beside" ? "#beside .bs-title:not(.bs-title-plain)" : `${r} .reader-bar .crumb`)?.textContent || ""), [root, re.source], { timeout: 8000 }).then(() => true, () => false);
  const firstVisit = async (page, BASE, PASS) => {
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.keyboard.press("Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  };
  const size = (page) => page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue("--reading-size")));

  // an iPad: the reader and the page beside
  {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
    await firstVisit(page, BASE, PASS);
    const id = await page.evaluate(async () => (await GL.api("resolve", { href: "https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?lang=eng" })).doc_id);
    await page.evaluate((id) => GL.openDoc(id), id);
    check(await waitH1(page, "#reader", /Alma 32/), "Alma 32 did not open");
    const cdp = await ctx.newCDPSession(page);
    const box = await page.evaluate(() => { const r = document.querySelector("#reader .doc").getBoundingClientRect(); return { x: r.left, w: r.width }; });
    check(await page.evaluate(() => document.body.classList.contains("gest") && getComputedStyle(document.querySelector("#reader .doc")).touchAction === "pan-y"), "the page still takes the browser's own pinch");
    await flick(cdp, box.x + box.w * 0.75, 400, box.x + box.w * 0.25);
    check(await waitH1(page, "#reader", /Alma 33/), "a flick to the left did not open the next chapter");
    await flick(cdp, box.x + box.w * 0.25, 400, box.x + box.w * 0.75);
    check(await waitH1(page, "#reader", /Alma 32/), "a flick to the right did not open the chapter before");
    // a slow drag and a slanted one are not flicks
    await touches(cdp, "touchStart", [[box.x + box.w * 0.75, 400]]);
    await page.waitForTimeout(350);
    await touches(cdp, "touchMove", [[box.x + box.w * 0.4, 400]]);
    await touches(cdp, "touchEnd", []);
    await touches(cdp, "touchStart", [[box.x + box.w * 0.75, 300]]);
    await touches(cdp, "touchMove", [[box.x + box.w * 0.4, 380]]);
    await touches(cdp, "touchEnd", []);
    await page.waitForTimeout(500);
    check(/Alma 32/.test(await h1(page, "#reader")), "a press that rested, or a slanted drag, turned the chapter");
    // two fingers: spread for larger, pinch for smaller
    const s0 = await size(page);
    const cx = box.x + box.w / 2;
    await touches(cdp, "touchStart", [[cx - 40, 400], [cx + 40, 400]]);
    await touches(cdp, "touchMove", [[cx - 55, 400], [cx + 55, 400]]);
    await touches(cdp, "touchEnd", []);
    const s1 = await size(page);
    check(s1 > s0, `spreading two fingers did not enlarge the text (${s0} to ${s1})`);
    await touches(cdp, "touchStart", [[cx - 60, 400], [cx + 60, 400]]);
    await touches(cdp, "touchMove", [[cx - 45, 400], [cx + 45, 400]]);
    await touches(cdp, "touchEnd", []);
    check((await size(page)) === s0, `pinching two fingers did not bring the text back (${await size(page)}, was ${s0})`);
    // the page beside turns on its own
    await page.evaluate((id) => window.Beside.open(id), id);
    await page.waitForSelector("#beside .bs-title:not(.bs-title-plain)", { timeout: 10000 });
    const bb = await page.evaluate(() => { const r = document.querySelector("#beside .bs-scroll").getBoundingClientRect(); return { x: r.left, w: r.width }; });
    await flick(cdp, bb.x + bb.w * 0.8, 400, bb.x + bb.w * 0.2);
    check(await waitH1(page, "#beside", /Alma 33/), "a flick in the page beside did not turn its chapter");
    check(/Alma 32/.test(await h1(page, "#reader")), "a flick in the page beside moved the reader");
    await page.screenshot({ path: OUT + "ipad.png" });
    // Settings turns them off
    await page.evaluate(() => { window.Beside.close(); GL.openSettings(); });
    await page.waitForSelector("#sheet .set-gestures", { timeout: 5000 });
    await page.evaluate(() => document.querySelector("#sheet .set-gestures").click());
    await page.evaluate(() => GL.closeSheet());
    await page.waitForTimeout(400);
    const rb = await page.evaluate(() => { const r = document.querySelector("#reader .doc").getBoundingClientRect(); return { x: r.left, w: r.width }; });
    await flick(cdp, rb.x + rb.w * 0.75, 400, rb.x + rb.w * 0.25);
    await page.waitForTimeout(600);
    check(/Alma 32/.test(await h1(page, "#reader")), "with gestures off a flick still turned the chapter");
    check(await page.evaluate(() => !document.body.classList.contains("gest")), "with gestures off the page still holds off the browser's pinch");
    await ctx.close();
  }
  // a phone: the bar steps aside going down and comes back going up
  {
    const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
    await firstVisit(page, BASE, PASS);
    const id = await page.evaluate(async () => (await GL.api("resolve", { href: "https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/32?lang=eng" })).doc_id);
    await page.evaluate((id) => GL.openDoc(id), id);
    await page.waitForSelector("#reader .reader-bar .crumb", { timeout: 10000 });
    await page.waitForTimeout(400);
    const top = () => page.evaluate(() => document.querySelector("#reader > .reader-bar").getBoundingClientRect().bottom);
    for (const y of [150, 300, 450, 600]) { await page.evaluate((y) => window.scrollTo(0, y), y); await page.waitForTimeout(120); }
    await page.waitForTimeout(400);
    check(await page.evaluate(() => document.body.classList.contains("bar-away")) && (await top()) <= 1, `reading down did not move the bar aside (its foot is at ${await top()})`);
    await page.screenshot({ path: OUT + "phone-away.png" });
    await page.evaluate(() => window.scrollTo(0, 560)); await page.waitForTimeout(120);
    await page.evaluate(() => window.scrollTo(0, 520)); await page.waitForTimeout(450);
    check(!(await page.evaluate(() => document.body.classList.contains("bar-away"))) && (await top()) > 30, "pulling the page back did not return the bar");
    await ctx.close();
  }
  return errors;
}
