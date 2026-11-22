// windows: the iPad app's "another window". The native piece is stood in for here (a browser has
// none): the control shows only when it says several windows are possible, a window that comes
// back without a place opens on the one it was left on, and each move is remembered.
export default async function run(browser, { BASE, PASS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const plain = await ctx.newPage();
  plain.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await plain.goto(BASE);
  await plain.fill("div.setup input", PASS); await plain.press("div.setup input", "Enter");
  await plain.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  check((await plain.evaluate(() => GL.windows)) === false, "a browser has no window control");
  const home = await plain.evaluate(async () => { const s = await GL.api("search", { q: "Alma 32:21", limit: 1 }); return s.jump?.doc_id || s.hits?.[0]?.doc_id; });

  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.addInitScript((docId) => {
    window.__calls = [];
    window.Capacitor = {
      isPluginAvailable: (n) => n === "Windows",
      nativePromise: async (plugin, method, params) => { window.__calls.push({ plugin, method, params }); return method === "current" ? { hash: `#?doc=${docId}&p=p21`, multiple: true } : {}; },
    };
  }, home);
  await page.goto(BASE);
  await page.waitForFunction(() => window.GL?.ready, null, { timeout: 30000 });
  await page.waitForSelector("#reader .doc", { timeout: 15000 }).catch(() => {});
  check(!!(await page.$("#reader .doc")), `a window that comes back opens on the page it was left on (hash ${await page.evaluate(() => location.hash)})`);
  check(await page.evaluate(() => GL.windows) === true, "the app knows more windows are possible");
  await page.click(".reader-bar .size-pop-btn");
  const item = await page.$(".size-menu .menu-window");
  check(!!item && await item.isVisible(), "the reader's menu offers a new window");
  await item?.click();
  const opened = await page.evaluate(() => window.__calls.filter((c) => c.method === "open"));
  check(opened.length === 1 && /^#/.test(opened[0].params.hash || ""), `it asks for a window on this page: ${JSON.stringify(opened)}`);
  await page.fill("#q", "faith"); await page.press("#q", "Enter");
  await page.waitForTimeout(1200);
  const told = await page.evaluate(() => window.__calls.filter((c) => c.method === "remember").map((c) => c.params.hash));
  check(told.length >= 1 && told[told.length - 1] === await page.evaluate(() => location.hash), `each move is remembered for this window: ${JSON.stringify(told)}`);
  await ctx.close();
  return errors;
}
