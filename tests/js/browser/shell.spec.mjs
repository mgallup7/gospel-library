import fs from "node:fs";
import http from "node:http";
// shell: the service worker serves the app's own files from its cache as one set, a second
// launch and an offline one come from that cache, and a newer set (sw.js with another SHELL)
// installs behind the page and is offered with "A new version is ready", which reloads into it.
// The app registers the worker over HTTPS only; gospel.sw in localStorage lets it run here.
// The browser fetches sw.js itself, past Playwright's routing, so the page is opened through a
// small proxy in front of BASE that can hand out the newer sw.js.
// Run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
export default async function run(browser, { BASE: UPSTREAM, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "shell/";
  fs.mkdirSync(OUT, { recursive: true });
  let nextShell = null;
  const proxy = http.createServer(async (req, res) => {
    try {
      const up = await fetch(new URL(req.url.replace(/^\//, ""), UPSTREAM));
      let body = Buffer.from(await up.arrayBuffer());
      if (nextShell && /\/sw\.js(\?|$)/.test(req.url)) body = Buffer.from(body.toString("utf8").replace(/gospel-shell-v\d+/, nextShell));
      res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/octet-stream", "cache-control": "no-cache" });
      res.end(body);
    } catch (err) { res.writeHead(502); res.end(String(err)); }
  });
  await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
  const BASE = `http://127.0.0.1:${proxy.address().port}/`;
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  try { await steps(); } finally { await ctx.close(); proxy.close(); }
  return errors;

  async function steps() {
    await ctx.addInitScript(() => { try { localStorage.setItem("gospel.sw", "true"); } catch (_) {} });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });

    // first launch: the worker installs the whole set and takes the page
    await page.goto(BASE);
    await page.waitForSelector("div.setup");
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
    const cached = await page.evaluate(async () => ({ keys: await caches.keys(), n: (await (await caches.open("gospel-shell-v31")).keys()).length }));
    if (!cached.keys.includes("gospel-shell-v31")) errors.push(`caches: ${cached.keys.join(", ")}`);
    if (cached.n < 24) errors.push(`only ${cached.n} shell files cached`);
    const preload = await page.evaluate(() => [...document.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.getAttribute("href")));
    if (preload.join(" ") !== "./app.js ./lib/cite.js ./lib/markdown.js ./lib/chunk.js ./lib/checks.js ./lib/step.js ./lib/refs.js") errors.push(`modulepreload: ${preload.join(" ")}`);

    // second launch: every shell file from the worker's cache
    const seen = new Map();
    const onResponse = (r) => { const u = new URL(r.url()); if (u.origin === new URL(BASE).origin && !u.pathname.includes("/data/")) seen.set(u.pathname, r.fromServiceWorker()); };
    page.on("response", onResponse);
    await page.reload();
    await page.waitForSelector("div.setup");
    await page.waitForTimeout(500);
    page.off("response", onResponse);
    for (const f of ["/", "/app.js", "/lib/cite.js", "/ask.js", "/app.css"]) if (seen.get(f) !== true) errors.push(`second load: ${f} ${seen.has(f) ? "from the network" : "not seen"}`);
    const viaWorker = await page.evaluate(() => performance.getEntriesByType("resource").filter((e) => /app\.js$|cite\.js$/.test(e.name)).map((e) => e.workerStart > 0));
    if (!viaWorker.length || viaWorker.includes(false)) errors.push(`performance entries: ${JSON.stringify(viaWorker)}`);

    // offline: the shell still opens, at once
    await ctx.setOffline(true);
    const t0 = Date.now();
    await page.reload();
    await page.waitForSelector("div.setup h1");
    if (Date.now() - t0 > 5000) errors.push(`offline launch took ${Date.now() - t0} ms`);
    await ctx.setOffline(false);

    // a newer shell: sw.js with another SHELL installs behind the page and is offered
    if (await page.$(".banner.shell-update")) errors.push("a notice showed before there was a new version");
    nextShell = "gospel-shell-vtest";
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    try { await page.waitForSelector(".banner.shell-update", { timeout: 20000 }); }
    catch (_) { errors.push("no notice for the new version"); return; }
    const text = await page.textContent(".banner.shell-update span");
    if (text !== "A new version is ready.") errors.push(`notice says: ${text}`);
    // the old set still answers until Reload is tapped
    if (!(await page.evaluate(async () => (await caches.keys()).includes("gospel-shell-v31")))) errors.push("the old shell was dropped before Reload");
    await page.screenshot({ path: OUT + "ipad-notice.png" });
    await page.setViewportSize({ width: 393, height: 852 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: OUT + "iphone-notice.png" });
    await Promise.all([page.waitForEvent("load", { timeout: 15000 }), page.click(".banner.shell-update .text-btn")]);
    await page.waitForSelector("div.setup");
    await page.waitForTimeout(500);
    const after = await page.evaluate(async () => ({ keys: await caches.keys(), notice: document.querySelectorAll(".banner.shell-update").length, controlled: !!navigator.serviceWorker.controller }));
    if (!after.keys.includes("gospel-shell-vtest") || after.keys.includes("gospel-shell-v31")) errors.push(`after Reload: ${after.keys.join(", ")}`);
    if (after.notice) errors.push("the notice is still there after Reload");
    if (!after.controlled) errors.push("the page is not controlled after Reload");
  }
}
