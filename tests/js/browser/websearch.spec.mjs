// websearch: web search inside Ask, against a stand-in for api.anthropic.com. Off by default:
// no web tool goes out and the prompt does not mention it. Turned on in settings (which say
// what it costs and where the search goes), the documented tool is added with a small
// max_uses and no beta header, and the prompt is told to prefer the library. What the search
// returns goes back to the API exactly as it came on the next request of the turn. Its pages
// are listed apart from the library's passages; a quotation from the web is marked "web" and
// left out of the library's quotation check, while an invented one is still underlined. A
// paused turn is sent back and carries on.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {} });
  const requests = [], headers = [];
  const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const RESULT = { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [
    { type: "web_search_result", url: "https://example.org/temple-history", title: "Temple history", encrypted_content: "ENC-ONE", page_age: "April 6, 2024" },
    { type: "web_search_result", url: "https://www.example.net/other", title: "Another page", encrypted_content: "ENC-TWO", page_age: null },
  ] };
  const CITE = { type: "web_search_result_location", url: "https://example.org/temple-history", title: "Temple history", encrypted_index: "IDX-ONE", cited_text: "The capstone was laid before a crowd of thousands on April 6, 1892..." };
  await ctx.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || "{}");
    requests.push(body); headers.push(req.headers());
    if (!body.stream) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: '{"queries":[],"references":[]}' }], stop_reason: "end_turn" }) });
    const stream = (events) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse(events) });
    const now = [...(body.messages || [])].reverse().find((m) => m.role === "user" && typeof m.content === "string" && /\n\n(Question|Request): /.test(m.content))?.content || "";
    const last = body.messages[body.messages.length - 1];
    const start = (i, content_block) => ({ type: "content_block_start", index: i, content_block });
    const stop = (i) => ({ type: "content_block_stop", index: i });
    const words = (i, t) => [start(i, { type: "text", text: "" }), { type: "content_block_delta", index: i, delta: { type: "text_delta", text: t } }, stop(i)];
    const end = (stop_reason) => [{ type: "message_delta", delta: { stop_reason } }, { type: "message_stop" }];
    const searching = (i, query) => [start(i, { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} }), { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query }) } }, stop(i)];
    if (/PAUSE-TEST/.test(now)) {
      // first the search is begun and the turn pauses; sent back, it ends in words
      if (last.role === "assistant") return stream([{ type: "message_start" }, start(0, RESULT), stop(0), ...words(1, "after the pause."), ...end("end_turn")]);
      return stream([{ type: "message_start" }, ...words(0, "Before the pause, "), ...searching(1, "paused search"), ...end("pause_turn")]);
    }
    if (/WEB-TEST/.test(now) && body.tools.some((t) => t.name === "web_search")) {
      // round two (the library search has answered): the answer, part from the library, part from the web
      if (JSON.stringify(last.content || "").includes("tool_result")) return stream([{ type: "message_start" },
        ...words(0, 'Alma teaches that "faith is not to have a perfect knowledge of things" [1]. I also searched the web for the date. '),
        start(1, { type: "text", text: "", citations: [] }),
        { type: "content_block_delta", index: 1, delta: { type: "citations_delta", citation: CITE } },
        { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: 'A history page says "the capstone was laid before a crowd of thousands" in 1892.' } },
        stop(1),
        ...words(2, ' Someone also wrote "this quotation is found in no place at all".'),
        ...end("end_turn")]);
      // round one: a web search (run on the server, its results in the same reply), then a library search
      return stream([{ type: "message_start" }, ...searching(0, "salt lake temple capstone date"), start(1, RESULT), stop(1),
        start(2, { type: "tool_use", id: "toolu_lib", name: "search", input: {} }), { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: "Alma 32:21", limit: 5 }) } }, stop(2),
        ...end("tool_use")]);
    }
    return stream([{ type: "message_start" }, ...words(0, "A plain answer from the library."), ...end("end_turn")]);
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  await page.click("#askBtn");
  await page.waitForSelector(".ask-input", { timeout: 10000 });
  const ask = async (text) => {
    const cards = await page.locator(".ask-card").count();
    await page.fill(".ask-input", text);
    await page.click(".ask-go");
    await page.waitForFunction((n) => { const c = document.querySelectorAll(".ask-card"); return c.length > n && !!c[c.length - 1].querySelector(".ask-trail") && !document.querySelector(".ask-go.stop"); }, cards, { timeout: 30000 }).catch(() => errors.push(`"${text}" did not finish`));
    return page.locator(".ask-card").last();
  };
  const streamed = () => requests.filter((r) => r.stream);

  // off by default: no web tool, no word of it in the prompt
  await ask("WEB-TEST faith and knowledge, with the setting off");
  const off = streamed()[0];
  check(!!off && !off.tools.some((t) => t.name === "web_search" || /web_search/.test(t.type || "")), "the web tool went out with the setting off");
  check(!!off && !/Web search is on/.test(JSON.stringify(off.system)), "the prompt speaks of web search with the setting off");
  check((await page.evaluate(() => localStorage.getItem("gospel.askWeb"))) === null && (await page.evaluate(() => window.Ask.settings.web)) === false, "web search is not off by default");

  // the setting: unticked, and it says what it costs and where the search goes
  await page.click(".ask-gear");
  await page.waitForSelector(".ask-settings .ask-web-on", { timeout: 5000 });
  check(!(await page.isChecked(".ask-settings .ask-web-on")), "the web search box is ticked before he ticks it");
  const label = await page.locator(".ask-settings label:has(.ask-web-on)").textContent();
  check(/Let Claude search the web/.test(label) && /bills each search/.test(label) && /go to Anthropic/.test(label), `the setting does not say what it costs and where it goes: ${label}`);
  await page.check(".ask-settings .ask-web-on");
  await page.locator(".ask-settings label:has(.ask-web-on)").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}websearch-settings.png` });
  await page.click(".ask-settings .ask-actions .primary");
  await page.waitForFunction(() => window.Ask.settings.web === true, null, { timeout: 5000 }).catch(() => errors.push("Save did not turn web search on"));

  // on: the documented tool, a small max_uses, no beta header, and the prompt prefers the library
  const before = streamed().length;
  const card = await ask("WEB-TEST when was the capstone laid, and what does Alma say of faith");
  const [first, second] = streamed().slice(before);
  const tool = first?.tools.find((t) => t.name === "web_search");
  check(JSON.stringify(tool) === JSON.stringify({ type: "web_search_20250305", name: "web_search", max_uses: 3 }), `the web tool sent: ${JSON.stringify(tool)}`);
  check(first && first.tools.filter((t) => t.input_schema).length === (off ? off.tools.length : -1), "the library's own tools changed when web search was turned on");
  check(!headers.some((h) => "anthropic-beta" in h), "a beta header was sent");
  const system = JSON.stringify(first?.system || "");
  check(/Web search is on/.test(system) && /The library comes first/.test(system) && /Say plainly in the answer that you used the web/.test(system), "the prompt does not tell Claude to prefer the library and to say when it used the web");
  // the search and its results go back exactly as they came, beside the library tool's result
  const sentBack = second?.messages.find((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "web_search_tool_result"));
  check(!!sentBack, "the web results were not sent back on the next request");
  if (sentBack) {
    check(JSON.stringify(sentBack.content.find((b) => b.type === "web_search_tool_result")) === JSON.stringify(RESULT), "the web results were changed on the way back");
    check(JSON.stringify(sentBack.content.find((b) => b.type === "server_tool_use")) === JSON.stringify({ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "salt lake temple capstone date" } }), `the server's search went back as ${JSON.stringify(sentBack.content.find((b) => b.type === "server_tool_use"))}`);
    const results = second.messages[second.messages.length - 1].content.filter((b) => b.type === "tool_result");
    check(results.length === 1 && results[0].tool_use_id === "toolu_lib", "the server's search was answered as if it were the library's tool");
  }
  check(JSON.stringify(second?.tools) === JSON.stringify(first?.tools), "the tools changed within the turn");

  // on the screen: web sources apart from the passages, the web quotation marked, the invented one underlined
  const webQ = await card.locator(".ask-a .from-web").allTextContents();
  check(webQ.join("|") === "the capstone was laid before a crowd of thousands", `marked as from the web: ${webQ.join("|")}`);
  check((await card.locator(".ask-a sup.from-web-tag").count()) === 1 && (await card.locator(".ask-a sup.from-web-tag").first().isVisible()), "the web quotation carries no visible mark");
  const bad = await card.locator(".ask-a .unverified").allTextContents();
  check(bad.join("|") === "this quotation is found in no place at all", `underlined as unverified: ${bad.join("|")}`);
  check((await card.locator(".ask-a button.cite").count()) === 1, "the library citation is not a button");
  const note = await card.locator(".ask-web-note").textContent().catch(() => "");
  check(/One quotation is from the web, not checked against your library/.test(note), `the web note says: ${note}`);
  check(/^One quotation is not word for word/.test((await card.locator(".quote-note:not(.ask-web-note):not(.ask-cut)").first().textContent().catch(() => "")) || ""), "the invented quotation was not reported, or the web one was counted with it");
  const links = await card.locator(".ask-web a").evaluateAll((as) => as.map((a) => `${a.textContent} ${a.href} ${a.target} ${a.rel}`));
  check(links.length === 2 && links[0] === "Temple history https://example.org/temple-history _blank noopener noreferrer", `web sources: ${links.join(" ; ")}`);
  check(/From the web, not checked against your library \(2 pages\)/.test(await card.locator(".ask-web summary").textContent()), "the web sources are not headed as from the web");
  check(/example\.net \(found, not cited\)/.test(await card.locator(".ask-web").textContent()), "a page found but not cited is not told apart");
  check((await card.locator(".finding").count()) > 0 && !/example\.org|Temple history/.test(await card.locator(".findings").textContent()), "a web page was listed among the library's passages");
  check(/Searched the web: salt lake temple capstone date \(2\)/.test(await card.locator(".ask-trail:not(.ask-web)").evaluate((d) => d.textContent)), "the web search is not on the trail");
  await card.locator(".ask-web").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}websearch-answer.png` });
  // "Ask Claude to fix them" names the invented quotation only
  await card.locator(".quote-note:not(.ask-web-note) button").first().click();
  await page.waitForFunction(() => !document.querySelector(".ask-go.stop"), null, { timeout: 20000 }).catch(() => {});
  const fix = streamed()[streamed().length - 1].messages.filter((m) => m.role === "user" && typeof m.content === "string").pop().content;
  check(/this quotation is found in no place at all/.test(fix) && !/capstone was laid before/.test(fix), "the fix request named the web quotation");

  // a turn the server pauses is sent back as it came, and goes on
  const n = streamed().length;
  const paused = await ask("PAUSE-TEST a long search");
  const [p1, p2] = streamed().slice(n);
  const lastSent = p2?.messages[p2.messages.length - 1];
  check(!!p2 && lastSent.role === "assistant" && lastSent.content.some((b) => b.type === "server_tool_use" && b.input.query === "paused search"), "a paused turn was not sent back as it came");
  check(/Before the pause, after the pause\./.test(await paused.locator(".ask-a").textContent()), `a paused answer reads: ${await paused.locator(".ask-a").textContent()}`);
  check(!!p1 && JSON.stringify(p1.tools) === JSON.stringify(p2.tools), "the tools changed across a pause");

  // phone width: the sources and the note fit
  await page.setViewportSize({ width: 393, height: 852 });
  await page.waitForTimeout(400);
  await card.locator(".ask-web").scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${SHOTS}websearch-phone.png` });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the page scrolls sideways at phone width");

  await ctx.close();
  return errors;
}
