// second-tab: the library open in one tab, a second is told it is open elsewhere; once the first
// closes, the second opens the library by itself within a few seconds, with no tap (the
// three-second retry in openLibrary). basics.spec covers the message; this covers what follows.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const first = await ctx.newPage();
  first.on("pageerror", (e) => errors.push(`first: pageerror: ${e}`));
  await first.goto(BASE);
  await first.fill("div.setup input", PASS);
  await first.press("div.setup input", "Enter");
  await first.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

  const second = await ctx.newPage();
  second.on("pageerror", (e) => errors.push(`second: pageerror: ${e}`));
  let clicks = 0;
  await second.exposeFunction("__clicked", () => { clicks++; });
  await second.addInitScript(() => document.addEventListener("click", (e) => { if (e.isTrusted) window.__clicked(); }, true));
  await second.goto(BASE);
  const told = await second.waitForFunction(() => /another tab/i.test(document.querySelector(".setup")?.textContent || ""), null, { timeout: 30000 }).catch(() => null);
  check(!!told, "the second tab should be told the library is open elsewhere");
  await second.screenshot({ path: SHOTS + "second-tab-waiting.png" });

  await first.close();
  const t0 = Date.now();
  const opened = await second.waitForFunction(() => window.GL?.ready && !!document.querySelector("#homeBody .shelf-grid"), null, { timeout: 20000 }).catch(() => null);
  const took = (Date.now() - t0) / 1000;
  // (the runner drops any message that says "another tab", so this one names the screen otherwise)
  check(!!opened, `the second tab should open the library once the first closes (ready: ${await second.evaluate(() => !!window.GL?.ready)}, still waiting: ${!!(await second.$(".setup"))})`);
  check(!opened || took < 10, `it should open within a few seconds (took ${took.toFixed(1)} s)`);
  check(clicks === 0, `with no tap (${clicks} clicks)`);
  const n = await second.evaluate(async () => { try { const s = await GL.api("search", { q: "faith" }); return `${s.hits?.length} ${Object.keys(s).join(",")}`; } catch (e) { return "error " + e.message; } });
  check(/^[1-9]/.test(n), `and search there works (${n})`);
  await second.screenshot({ path: SHOTS + "second-tab-opened.png" });
  await ctx.close();
  return errors;
}
