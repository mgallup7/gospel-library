// ask-links: what Claude writes in an answer can be followed. A Markdown link, a web address
// written out and a passage named in plain words ("Alma 32:21", "Heb. 11:1") are links; a tap
// goes through the app (the library's own copy in a sheet or the reader, the web only as an
// offer); and markup in the answer is still shown as words.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {} });
  const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const ANSWER = "Read [the chapter](https://www.churchofjesuschrist.org/study/scriptures/bofm/alma/33?lang=eng) and https://example.com/history?x=1. Compare Alma 32:21 with Heb. 11:1. <img src=x onerror=\"window.__evil=1\">";
  const left = [];
  await ctx.route((u) => u.hostname !== new URL(BASE).hostname, (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (!req.url().startsWith("https://api.anthropic.com/")) { left.push(req.url()); return route.abort(); }
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || "{}");
    if (!body.stream) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: '{"queries":[],"references":[]}' }], stop_reason: "end_turn" }) });
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse([{ type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ANSWER } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }]) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  await page.click("#askBtn");
  await page.waitForSelector(".ask-input", { timeout: 10000 });
  await page.fill(".ask-input", "Where should I read?");
  await page.click(".ask-go");
  await page.waitForFunction(() => !!document.querySelector(".ask-card .ask-trail") && !document.querySelector(".ask-go.stop"), null, { timeout: 30000 }).catch(() => errors.push("the answer did not finish"));
  const links = await page.$$eval(".ask-card .ask-a a", (as) => as.map((a) => [a.textContent, a.getAttribute("href")]));
  check(links.length === 4 && links[0][0] === "the chapter" && links[1][0] === "https://example.com/history?x=1" && links[2][0] === "Alma 32:21" && links[3][0] === "Heb. 11:1", `the answer's links: ${JSON.stringify(links)}`);
  check(!(await page.$(".ask-card .ask-a img")) && /<img src=x/.test(await page.textContent(".ask-card .ask-a")) && (await page.evaluate(() => window.__evil)) === undefined, "markup in an answer was not shown as words");
  await page.screenshot({ path: `${SHOTS}ask-links.png` });
  // a plain reference: the verse in a sheet, from the library's own copy
  await page.click(".ask-card .ask-a a:has-text('Heb. 11:1')");
  await page.waitForSelector("#sheet:not([hidden]) .peek p", { timeout: 8000 }).catch(() => errors.push("a plain reference in an answer opened nothing"));
  check(/Hebrews 11:1/.test(await page.textContent("#sheet .nm").catch(() => "")), `the passage sheet says: ${await page.textContent("#sheet .nm").catch(() => "")}`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  // a web address: the offer, and nothing leaves until it is tapped
  await page.click(".ask-card .ask-a a:has-text('example.com')");
  await page.waitForFunction(() => /leaves the library/.test(document.querySelector("#toast.show")?.textContent || ""), null, { timeout: 5000 }).catch(() => errors.push("a web address in an answer was not offered in a toast"));
  check((await page.getAttribute("#toast a.toast-action", "href").catch(() => "")) === "https://example.com/history?x=1" && left.length === 0, `the web address was followed without the offer: ${left.join(", ")}`);
  // a Markdown link to a chapter the library holds opens it here
  await page.click(".ask-card .ask-a a:has-text('the chapter')");
  await page.waitForFunction(() => /Alma 33/.test(document.querySelector("#reader .doc h1, #panel .doc h1, .doc h1")?.textContent || document.title), null, { timeout: 8000 }).catch(() => errors.push(`a Markdown link to a chapter did not open it`));
  check(left.length === 0, `a request left the app: ${left.join(", ")}`);
  // the thread drawn again after a reload keeps its links
  await page.reload();
  await page.waitForSelector("#homeBody .shelf-grid, .ask-card, #reader .doc", { timeout: 120000 });
  await page.click("#askBtn");
  await page.waitForSelector(".ask-a", { timeout: 10000 }).catch(() => {});
  check((await page.locator(".ask-a a").count()) >= 4, "the links are gone from the thread after a reload");
  await page.evaluate(() => { try { localStorage.removeItem("gospel.askThread"); } catch (_) {} });
  await ctx.close();
  return errors;
}
