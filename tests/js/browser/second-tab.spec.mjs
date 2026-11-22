// second-tab: the library in more than one window. One window holds the database and answers for
// the others (app.js, the engine section): a second window opens the library too, searches and
// reads, and when the holder closes, or goes out of sight while another is in view, the next takes
// over without a tap and without losing a call that was on its way.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const role = (p) => p.evaluate(() => window.GL.engineRole());
  const search = (p, q) => p.evaluate(async (q) => { try { const s = await GL.api("search", { q, limit: 5 }); return `${s.hits?.length} ${s.hits?.[0]?.citation || ""}`; } catch (e) { return "error " + e.message; } }, q);
  const open = async (name) => {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await p.goto(BASE);
    return p;
  };
  const first = await open("first");
  await first.fill("div.setup input", PASS);
  await first.press("div.setup input", "Enter");
  await first.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  check((await role(first)) === "holder", `the first window holds the library (it is ${await role(first)})`);

  // a second window: no passphrase, no notice, the library is there
  const second = await open("second");
  let clicks = 0;
  await second.exposeFunction("__clicked", () => { clicks++; });
  await second.addInitScript(() => document.addEventListener("click", (e) => { if (e.isTrusted) window.__clicked(); }, true));
  const t0 = Date.now();
  const ready = await second.waitForFunction(() => window.GL?.ready && !!document.querySelector("#homeBody .shelf-grid"), null, { timeout: 30000 }).catch(() => null);
  check(!!ready, `the second window should open the library (it shows: ${(await second.evaluate(() => document.body.innerText.slice(0, 120))).replace(/\s+/g, " ")})`);
  check(!ready || (Date.now() - t0) / 1000 < 8, `and within a few seconds (took ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  check((await role(second)) === "asker" && (await role(first)) === "holder", `the second asks the first (second: ${await role(second)}, first: ${await role(first)})`);
  check(/^[1-9]\d* 3 Nephi 23:1/.test(await search(second, "great are the words of isaiah")), `search in the second window: ${await search(second, "great are the words of isaiah")}`);
  check(/^[1-9]/.test(await search(first, "faith")), `search in the first still works: ${await search(first, "faith")}`);
  // a page opens in the second, by the real search box
  await second.fill("#q", "Alma 32:21"); await second.press("#q", "Enter");
  await second.waitForSelector("#reader .doc #p21", { timeout: 15000 }).catch(() => {});
  check(!!(await second.$("#reader .doc #p21")), "a chapter opens in the second window");
  await second.screenshot({ path: SHOTS + "second-window.png" });
  // many calls at once from both, none lost or crossed
  const both = await Promise.all([
    second.evaluate(() => Promise.all(["faith", "charity", "hope", "repentance", "baptism"].map(async (q) => `${q}:${(await GL.api("search", { q, limit: 3, light: true })).query}`))),
    first.evaluate(() => Promise.all(["mercy", "grace", "prayer", "covenant", "sabbath"].map(async (q) => `${q}:${(await GL.api("search", { q, limit: 3, light: true })).query}`))),
  ]);
  check(both.flat().every((x) => { const [a, b] = x.split(":"); return a === b; }), `answers came back to the call that asked: ${both.flat().join(" ")}`);

  // the holder goes out of sight while the second is in view: the second takes over
  await first.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const handed = await second.waitForFunction(() => window.GL.engineRole() === "holder", null, { timeout: 15000 }).catch(() => null);
  check(!!handed, `the window in view should take over from the one out of sight (second: ${await role(second)}, first: ${await role(first)})`);
  check((await role(first)) === "asker", `the one out of sight asks the other now (it is ${await role(first)})`);
  check(/^[1-9]\d* 3 Nephi 23:1/.test(await search(second, "great are the words of isaiah")), `search after taking over: ${await search(second, "great are the words of isaiah")}`);
  check(/^[1-9]/.test(await search(first, "faith")), `the window out of sight still gets answers: ${await search(first, "faith")}`);
  await first.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });

  // a call on its way when the holder closes is answered by the next holder
  const third = await open("third");
  await third.waitForFunction(() => window.GL?.ready, null, { timeout: 30000 }).catch(() => {});
  check((await role(third)) === "asker", `a third window asks too (it is ${await role(third)})`);
  const slow = third.evaluate(async () => { const out = []; for (const q of ["faith hope and charity", "the lord is my shepherd", "men are that they might have joy"]) { try { out.push((await GL.api("search", { q, limit: 3 })).hits.length); } catch (e) { out.push("error " + e.message); } } return out.join(","); });
  await second.close();
  const answered = await Promise.race([slow, new Promise((r) => setTimeout(() => r("no answer in 30 s"), 30000))]);
  check(/^[1-9]\d*,[1-9]\d*,[1-9]\d*$/.test(answered), `calls on their way when the holder closed: ${answered}`);
  const roles = [await role(first), await role(third)].sort().join(",");
  check(roles === "asker,holder", `one of the two left holds, the other asks (${roles})`);
  check(clicks === 0, `no tap was needed in the second window (${clicks})`);

  // the last one standing, after a reload, holds and opens by itself
  await first.close();
  await third.waitForFunction(() => window.GL.engineRole() === "holder", null, { timeout: 15000 }).catch(() => {});
  check((await role(third)) === "holder", `the last window holds (it is ${await role(third)})`);
  await third.reload();
  const again = await third.waitForFunction(() => window.GL?.ready, null, { timeout: 30000 }).catch(() => null);
  check(!!again && /^[1-9]/.test(await search(third, "faith")), "after a reload the last window opens the library and searches");
  await ctx.close();
  return errors;
}
