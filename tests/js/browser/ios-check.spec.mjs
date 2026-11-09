import fs from "node:fs";
// ios-check: "Update this iPhone or iPad first" follows the engine's report of sync access
// handles, not the user agent. The iPad's home-screen app (a touch Mac with no Version token)
// gets it when the engine has none; an iPhone whose user agent says 16.3 but whose engine has
// them does not; a desktop browser without them keeps the library in memory as before.
// The engine's worker is served with the handles taken away to stand for an older iOS.
// Run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
const UA = {
  ipadHomeScreen: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  iphone163: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
};
const TOO_OLD = "Update this iPhone or iPad first";

export default async function run(browser, { BASE, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "ios-check/";
  fs.mkdirSync(OUT, { recursive: true });
  const cases = [
    { name: "ipad-home-screen-old", ua: UA.ipadHomeScreen, touch: true, take: true, viewport: { width: 1180, height: 820 }, want: "old" },
    { name: "iphone-old", ua: UA.iphone163, touch: true, take: true, viewport: { width: 393, height: 852 }, want: "old", version: "16.3" },
    { name: "ipad-home-screen-new", ua: UA.ipadHomeScreen, touch: true, take: false, viewport: { width: 1180, height: 820 }, want: "setup" },
    { name: "iphone-ua-old-engine-new", ua: UA.iphone163, touch: true, take: false, viewport: { width: 393, height: 852 }, want: "setup" },
    { name: "desktop-without-handles", ua: null, touch: false, take: true, viewport: { width: 1180, height: 820 }, want: "setup" },
  ];
  for (const c of cases) {
    const ctx = await browser.newContext({ viewport: c.viewport, deviceScaleFactor: 1, hasTouch: c.touch, ...(c.ua ? { userAgent: c.ua } : {}) });
    if (c.take) await ctx.route(/\/engine\.js(\?.*)?$/, async (route) => {
      const res = await route.fetch();
      route.fulfill({ response: res, body: "delete self.FileSystemSyncAccessHandle;\n" + (await res.text()) });
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${c.name} pageerror: ${e}`));
    await page.goto(BASE);
    await page.waitForSelector("div.setup h1", { timeout: 30000 });
    const h1 = await page.textContent("div.setup h1");
    const lede = await page.$$eval("div.setup .lede", (ps) => ps.map((p) => p.textContent).join(" "));
    const feat = await page.evaluate(() => GL.api("features", {}));
    if (c.want === "old") {
      if (h1 !== TOO_OLD) errors.push(`${c.name}: expected the update message, got "${h1}"`);
      if (feat.syncAccess) errors.push(`${c.name}: the engine still reports sync access handles`);
      if (c.version && !lede.includes(`iOS ${c.version}`)) errors.push(`${c.name}: wording lacks the version: ${lede}`);
      if (!c.version && !lede.includes("an earlier version")) errors.push(`${c.name}: wording: ${lede}`);
    } else {
      if (h1 === TOO_OLD) errors.push(`${c.name}: showed the update message`);
      if (!c.take && !(feat.syncAccess && feat.syncMethods === true)) errors.push(`${c.name}: features ${JSON.stringify(feat)}`);
      if (!(await page.$("div.setup input"))) errors.push(`${c.name}: no passphrase field`);
    }
    await page.screenshot({ path: OUT + `${c.name}.png` });
    await ctx.close();
  }
  return errors;
}
