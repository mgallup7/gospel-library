// ask: the Claude layer against a stand-in for api.anthropic.com (the sandbox has no web).
// A model that only ever asks for more searches still ends in words: after the tool budget
// one last request goes out with tools off. And with "propose extra searches" off, Return in
// the search box asks Claude nothing.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-test-not-a-key")); } catch (_) {} });
  const requests = [];
  const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  await ctx.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || "{}");
    requests.push(body);
    if (!body.stream) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: '{"queries":[{"q":"faith hope","scope":"all"}],"references":[]}' }], stop_reason: "end_turn" }) });
    const last = body.tool_choice?.type === "none";
    // Think it through: the answer at once, under its headings, with the three kinds of question
    const think = JSON.stringify(body.system || "").includes("thinking a page through");
    if (think) {
      const text = THINK_REPLY;
      return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse([
        { type: "message_start" },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
      ]) });
    }
    const events = last ? [
      { type: "message_start" },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Faith is a hope in things not seen which are true [1]." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    ] : [ // never satisfied: always one more search, and no words
      { type: "message_start" },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `tu_${requests.length}`, name: "search", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: "faith hope", limit: 3 }) } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    ];
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse(events) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

  // the tool loop runs out, and the answer still comes
  await page.click("#askBtn");
  await page.waitForSelector(".ask-input", { timeout: 10000 });
  await page.fill(".ask-input", "What is faith?");
  await page.click(".ask-go");
  const answered = await page.waitForFunction(() => /hope in things not seen/.test(document.querySelector(".ask-card .ask-a")?.textContent || ""), null, { timeout: 60000 }).catch(() => null);
  check(!!answered, `the answer should end in words: ${(await page.textContent(".ask-card").catch(() => "")).replace(/\s+/g, " ").slice(0, 160)}`);
  const streamed = requests.filter((b) => b.stream);
  const final = streamed[streamed.length - 1] || {};
  check(final.tool_choice?.type === "none", `the last request should turn tools off (got ${JSON.stringify(final.tool_choice)})`);
  check(streamed.slice(0, -1).every((b) => !b.tool_choice), "only the last request turns tools off");
  check(JSON.stringify(final.tools) === JSON.stringify(streamed[0]?.tools), "the tools list stays the same on every request");
  const lastUser = final.messages?.[final.messages.length - 1];
  check(lastUser?.role === "user" && JSON.stringify(lastUser.content).includes("Write the answer now"), "the last request asks for the answer");
  check(!(await page.$(".ask-card .ask-status")), "the status line is gone once the answer is in");
  check(await page.evaluate(() => !document.querySelector(".ask-go").disabled), "Ask is ready for the next question");
  await page.screenshot({ path: SHOTS + "ask-capped.png" });

  // the settings checkbox says what it does
  await page.click(".ask .icon-btn[aria-label='Settings']");
  const label = await page.textContent(".ask.settings");
  check(/propose a few more searches/i.test(label), "the planner checkbox should say what it does");
  await page.screenshot({ path: SHOTS + "ask-settings.png" });

  // with it on (the default), Return in the search box asks for more searches; off, it sends nothing
  await page.click(".ask.settings .text-btn:has-text('Cancel')");
  let before = requests.length;
  await page.fill("#q", "what did the prophets teach about faith and hope");
  await page.press("#q", "Enter");
  await page.waitForTimeout(2500);
  check(requests.slice(before).some((b) => !b.stream), "with the setting on, Return should ask Claude for more searches");
  await page.evaluate(() => localStorage.setItem("gospel.askPlanner", "false"));
  await page.fill("#q", "");
  before = requests.length;
  await page.fill("#q", "what did the prophets teach about faith and hope");
  await page.press("#q", "Enter");
  await page.waitForTimeout(2500);
  check(requests.length === before, `no call to Claude with the setting off (got ${requests.length - before})`);
  check(!(await page.$(".widening")), "and no 'asking Claude' note left behind");

  // Think it through on a chapter: the three kinds of question, each a question card in one tap
  await page.evaluate(() => localStorage.removeItem("gospel.deck"));
  await page.evaluate(async () => { const s = await GL.api("search", { q: "Alma 32" }); GL.openDoc(s.jump.doc_id, "p21"); });
  await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
  await page.waitForSelector(".fab-think:not([hidden])", { timeout: 5000 });
  await page.click(".fab-think");
  await page.waitForSelector(".think-questions .tq", { timeout: 30000 }).catch(() => null);
  const tq = await page.$$eval(".think-questions .tq", (rs) => rs.map((r) => [r.dataset.kind, r.querySelector(".tq-kind").textContent, r.querySelector(".tq-text").textContent]));
  check(tq.length === 3, `three questions offered (got ${tq.length})`);
  check(JSON.stringify(tq.map((x) => x[0])) === JSON.stringify(["says", "means", "do"]), `one of each kind: ${tq.map((x) => x[0]).join(", ")}`);
  check(!/\[\d+\]/.test(tq.map((x) => x[2]).join(" ")), "the questions come without their [n]");
  const sys = JSON.stringify(requests.filter((b) => b.stream).at(-1)?.system || "");
  check(/What you will do:/.test(sys) && /Preach My Gospel/.test(sys), "the think prompt asks for the three kinds");
  await page.screenshot({ path: SHOTS + "ask-think-questions.png" });
  if (tq.length) {
    await page.click(".think-questions .tq[data-kind=means] button");
    await page.waitForTimeout(200);
    const items = await page.evaluate(() => window.Deck.state.items.map((i) => ({ type: i.type, text: i.text || "", title: i.title || "" })));
    const qCard = items.find((i) => i.type === "question");
    check(!!qCard && qCard.text === tq[1][2], `a question card with the question's words lands on the deck: ${JSON.stringify(items)}`);
    const sec = items.findIndex((i) => i.type === "section" && i.title === "Faith as a seed"), qi = items.findIndex((i) => i.type === "question");
    check(sec >= 0 && sec < qi, "the question sits under the section");
    check((await page.textContent(".think-questions .tq[data-kind=means] button")) === "On the deck", "its button says so");
    const undo = await page.$(".toast[role=status] button.toast-action");
    check(!!undo, "the add carries Undo");
    await page.screenshot({ path: SHOTS + "ask-think-question-added.png" });
    if (undo) {
      await undo.click();
      await page.waitForTimeout(150);
      check(!(await page.evaluate(() => window.Deck.state.items.some((i) => i.type === "question"))), "Undo takes the question card off");
    }
    // the passages button still builds the section, under the same heading (not a second one)
    const put = await page.$(".think-card .ask-tools .primary.small");
    if (put) {
      await put.click();
      await page.waitForTimeout(150);
      const secs = await page.evaluate(() => window.Deck.state.items.filter((i) => i.type === "section").length);
      check(secs === 1, `one section heading, not ${secs}`);
    }
  }
  await ctx.close();
  return errors;
}

const THINK_REPLY = `## What this page teaches
Alma compares the word to a seed: faith begins as a desire to believe and grows as it is nourished [1].

## Connections
[1] The seed and the experiment.

## Questions
- What it says: What does Alma compare the word to? [1]
- What it means: Why does Alma call faith an experiment rather than a perfect knowledge?
- What you will do: What one thing will you do this week to nourish the word in your heart?

## For the deck
"Faith as a seed" [1]`;
