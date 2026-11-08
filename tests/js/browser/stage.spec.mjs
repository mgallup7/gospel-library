import fs from "node:fs";
// stage: the speaker's timer and the "Next:" line in the Present controls, and the plain
// message an iPhone older than iOS 16.4 gets in setup. Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "stage/";
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, vp, opener] of [
    ["ipad", { width: 1180, height: 820 }, "#reader button.icon-btn[aria-label='Present']"],
    ["iphone", { width: 393, height: 852 }, "#reader .reader-foot .foot-btn[aria-label='Present']"],
  ]) {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 200)}`); });
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.fill("#q", "Alma 32:21"); await page.press("#q", "Enter");
    await page.waitForTimeout(800);
    if (!(await page.isVisible("#reader .doc #p21"))) await page.click("#list .jump"); // on a phone the reference waits as a jump at the top of the list
    await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
    await page.waitForTimeout(400);
    await page.click(opener);
    await page.waitForSelector(".stage:not([hidden])");
    await page.mouse.move(vp.width / 2, vp.height / 2); // wake the controls for the screenshot
    const timer = () => page.textContent(".stage .stage-timer");
    const t1 = await timer();
    check(/^\d:\d\d$/.test(t1), `timer text: ${t1}`);
    await page.waitForTimeout(1200);
    const t2 = await timer();
    check(/^\d:\d\d$/.test(t2) && t2 !== t1, `timer should advance: ${t1} then ${t2}`);
    const peek = await page.textContent(".stage .stage-upnext");
    check(/^Next: \S/.test(peek), `Next line on the first slide: ${peek}`);
    check(!/^Next: \d/.test(peek), `Next line should drop the verse number: ${peek}`);
    await page.screenshot({ path: `${OUT}${name}-01-first.png` });
    // the timer keeps going while blanked, and a tap starts it again
    await page.keyboard.press("b");
    check(await page.evaluate(() => document.querySelector("#stage").classList.contains("blank")), "B should blank the screen");
    await page.keyboard.press("b");
    await page.click(".stage .stage-timer");
    check((await timer()) === "0:00", `tap should reset the timer: ${await timer()}`);
    // to the last slide
    for (let guard = 0; guard < 80 && !(await page.isDisabled(".stage .stage-next")); guard++) await page.keyboard.press("ArrowRight");
    check(await page.isDisabled(".stage .stage-next"), "should reach the last slide");
    const lastPeek = await page.textContent(".stage .stage-upnext");
    check(lastPeek === "", `no Next line on the last slide: ${lastPeek}`);
    check(!(await page.isVisible(".stage .stage-upnext")), "the empty Next line should not take space");
    await page.mouse.move(vp.width / 2 + 5, vp.height / 2);
    await page.screenshot({ path: `${OUT}${name}-02-last.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.querySelector("#stage").hidden), "Escape should close the stage");
    await ctx.close();
  }

  // An iPhone on iOS 16.1 gets a plain message instead of the download form.
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";
  const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`old ios pageerror: ${e}`));
  await page.goto(BASE);
  await page.waitForSelector("div.setup", { timeout: 30000 });
  await page.waitForTimeout(300);
  const text = await page.textContent("div.setup");
  if (!/16\.4/.test(text)) errors.push(`old ios: the setup box should mention 16.4: ${text.slice(0, 200)}`);
  if (!/Software Update/.test(text)) errors.push("old ios: the setup box should say how to update");
  if (await page.$("div.setup input")) errors.push("old ios: no passphrase form on an iOS that cannot keep the library");
  await page.screenshot({ path: `${OUT}old-ios.png` });
  await ctx.close();
  return errors;
}
