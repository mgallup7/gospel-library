// errlog: the error log the owner can copy (lib/log.js). A marks database that will not open
// still reads as an empty list, but is noted, so "no highlights" can be told from "could not
// be read"; an error and a rejected promise that nothing caught are noted; the key and the
// passphrase are never in it; Ask's settings copy it whole.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const KEY = "sk-ant-test-not-a-key-0123456789";
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await ctx.addInitScript((key) => { try { localStorage.setItem("gospel.apiKey", JSON.stringify(key)); } catch (_) {} }, KEY);
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  check(await page.evaluate(() => typeof window.GLLog?.note === "function" && typeof window.GLLog.copy === "function" && typeof window.GLLog.count === "function"), "window.GLLog is missing");
  const before = await page.evaluate(() => window.GLLog.count());
  check(before === 0, `the app starts with ${before} errors noted: ${await page.evaluate(() => window.GLLog.text())}`);

  // the marks database refuses to open: the list is empty, and the log says why
  const marks = await page.evaluate(async () => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (name, ...rest) { if (name === "gospel-marks") throw new DOMException("the browser refused the database", "InvalidStateError"); return open.call(this, name, ...rest); };
    try { return { forDoc: await Marks.forDoc("/scriptures/bofm/alma/32"), all: await Marks.all(), studies: await Studies.list() }; }
    finally { IDBFactory.prototype.open = open; }
  });
  check(Array.isArray(marks.forDoc) && marks.forDoc.length === 0 && Array.isArray(marks.all) && marks.all.length === 0, "a failing marks database did not read as an empty list");
  let text = await page.evaluate(() => window.GLLog.text());
  check(/marks\.forDoc: InvalidStateError: the browser refused the database/.test(text) && /marks\.all: /.test(text), `the marks failure was not noted: ${text}`);
  check(!/studies\.list/.test(text), "the studies shelf, which opened, was noted as failing");

  // what nothing caught: an error, a rejected promise that carries both secrets, a refused request
  await page.evaluate(async (pass) => {
    setTimeout(() => { throw new Error("thrown where nothing catches it"); }, 0);
    Promise.reject(new Error(`rejected with ${JSON.parse(localStorage.getItem("gospel.apiKey"))} and ${pass}`));
    await fetch("https://example.com/elsewhere").catch(() => {});
  }, PASS);
  await page.waitForFunction(() => window.GLLog.count() >= 5, null, { timeout: 5000 }).catch(() => {});
  text = await page.evaluate(() => window.GLLog.text());
  check(/window: thrown where nothing catches it/.test(text), `an uncaught error was not noted: ${text}`);
  check(/promise: rejected with \[key\] and \[secret\]/.test(text), `a rejected promise was not noted with its secrets struck out: ${text}`);
  check(/policy: connect-src refused https:\/\/example\.com/.test(text), `a request the policy refused was not noted: ${text}`);
  check(!text.includes("sk-ant-") && !text.includes(PASS), "the log holds the key or the passphrase");
  check(!(await page.evaluate(() => sessionStorage.getItem("gospel.errorLog") || "")).includes("sk-ant-"), "the kept copy of the log holds the key");

  // a reload keeps it; Ask's settings copy it
  await page.reload();
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  check((await page.evaluate(() => window.GLLog.count())) >= 5, "the log did not survive a reload");
  await page.click("#askBtn");
  await page.waitForSelector(".ask-gear", { timeout: 10000 });
  await page.click(".ask-gear");
  await page.waitForSelector(".ask-settings .ask-errlog button", { timeout: 5000 });
  check(/errors noted/.test(await page.textContent(".ask-settings .ask-errlog")), "settings do not say how many errors are noted");
  await page.locator(".ask-settings .ask-errlog button").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}errlog-settings.png` });
  await page.click(".ask-settings .ask-errlog button");
  await page.waitForFunction(() => /Copied|could not/.test(document.querySelector(".ask-settings .ask-errlog")?.textContent || ""), null, { timeout: 5000 }).catch(() => {});
  check(/Copied/.test(await page.textContent(".ask-settings .ask-errlog")), `Copy error log said: ${await page.textContent(".ask-settings .ask-errlog")}`);
  const pasted = await page.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (pasted !== null) check(/^Gospel Library error log: \d+ entries/.test(pasted) && /marks\.forDoc/.test(pasted) && !pasted.includes("sk-ant-"), `what was copied: ${String(pasted).slice(0, 200)}`);

  await ctx.close();
  return errors;
}
