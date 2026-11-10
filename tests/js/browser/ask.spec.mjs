// ask: the Claude layer against a stand-in for api.anthropic.com (the sandbox has no web).
// A model that only ever asks for more searches still ends in words: after the tool budget
// one last request goes out with tools off. And with "propose extra searches" off, Return in
// the search box asks Claude nothing. Settings open over Ask as a sheet (Back and Escape close
// them, the typed question stays), hold his standing instructions and his notes, and a note
// Claude proposes is saved only when he taps Save.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {} });
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
    const said = JSON.stringify(body.messages || []);
    const text = (t) => [{ type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }];
    const tool = (name, input) => [{ type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `tu_${requests.length}`, name, input: {} } }, { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" }];
    const stream = (events) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse(events) });
    // a question that states a preference: Claude proposes a note, then answers
    if (/REMEMBER-TEST/.test(said)) return stream(/tool_result/.test(said) ? text("Noted for this answer.") : tool("remember", { note: "Zone conference talks run twelve minutes." }));
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

  // every request carries his standing instructions (the neutral starter until he edits them),
  // an inventory of this library, which has no talks, and today's date at the top of the turn
  const sysOf = (b) => (b.system || []).map((x) => x.text).join("\n\n");
  check(/My standing instructions[^\n]*\n\nNo em dashes, and nothing that sounds written by an AI\./.test(sysOf(streamed[0] || {})), "Ask sends the standing instructions");
  check(/On this device[\s\S]*Not on this device: general conference talks/.test(sysOf(streamed[0] || {})) && !/1971/.test(sysOf(streamed[0] || {})), "the inventory says the talks are not here");
  check(/^Today is \w+ \d+, \d{4}\.\n\nQuestion: What is faith\?/.test(streamed[0]?.messages?.[0]?.content || ""), `the date opens the turn: ${String(streamed[0]?.messages?.[0]?.content).slice(0, 60)}`);
  check(JSON.stringify(streamed[0]?.system) === JSON.stringify(final.system), "the system blocks stay the same through the turn");

  // settings: a sheet over Ask. Escape and Back close it, and a question being typed stays.
  await page.fill(".ask-input", "a question half typed");
  await page.click(".ask .icon-btn[aria-label='Settings']");
  await page.waitForSelector("#sheet:not([hidden]) .ask-settings", { timeout: 5000 });
  const label = await page.textContent("#sheet .ask-settings");
  check(/propose a few more searches/i.test(label), "the planner checkbox should say what it does");
  check(/How I want Claude to answer/.test(label) && /What Claude should remember/.test(label), "settings hold the standing instructions and the notes");
  check((await page.inputValue("#sheet .ask-instructions")).startsWith("No em dashes, and nothing that sounds written by an AI."), "the instructions start from the neutral starter");
  await page.screenshot({ path: SHOTS + "ask-settings.png" });
  await page.keyboard.press("Escape");
  await page.waitForSelector("#sheet", { state: "hidden", timeout: 5000 }).catch(() => null);
  check(await page.evaluate(() => document.querySelector("#sheet").hidden), "Escape closes settings");
  check((await page.inputValue(".ask-input")) === "a question half typed", "the typed question is still there after settings");
  await page.click(".ask .icon-btn[aria-label='Settings']");
  await page.waitForSelector("#sheet:not([hidden]) .ask-settings");
  await page.goBack();
  await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector("#sheet").hidden && !!document.querySelector(".ask-input")), "Back closes settings and stays on Ask");
  check((await page.inputValue(".ask-input")) === "a question half typed", "and the typed question is still there");
  // Save checks the key the way setup does, and keeps his own instructions
  await page.click(".ask .icon-btn[aria-label='Settings']");
  await page.waitForSelector("#sheet:not([hidden]) .ask-settings");
  await page.fill("#sheet .ask-instructions", "OWN-INSTRUCTION: answer in two paragraphs.");
  await page.fill("#sheet .ask-settings input[type=password]", "not a key");
  await page.click("#sheet .ask-settings .primary");
  check(/does not look like a Claude API key/.test(await page.textContent("#sheet .ask-settings .msg")), "Save refuses a key that cannot be one");
  check(await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.apiKey")) === "sk-ant-test-not-a-key"), "and the good key is not overwritten");
  await page.fill("#sheet .ask-settings input[type=password]", "sk-ant-test-not-a-key");
  await page.click("#sheet .ask-settings .primary");
  await page.waitForSelector("#sheet", { state: "hidden", timeout: 5000 }).catch(() => null);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.askInstructions") || '""').startsWith("OWN-INSTRUCTION")), "his instructions are kept on the device");

  // a note Claude proposes: shown under the answer, saved only on Save
  await page.fill(".ask-input", "REMEMBER-TEST my zone conference talks run twelve minutes");
  await page.click(".ask-go");
  await page.waitForSelector(".ask-card .remember", { timeout: 30000 }).catch(() => null);
  check(/Remember this\? Zone conference talks run twelve minutes\./.test(await page.textContent(".ask-card .remember").catch(() => "")), "the proposal shows under the answer");
  check(await page.evaluate(() => !JSON.parse(localStorage.getItem("gospel.askNotes") || '""')), "nothing is saved until he says so");
  const remReq = requests.filter((b) => b.stream && /REMEMBER-TEST/.test(JSON.stringify(b.messages))).at(-1) || {};
  check(/OWN-INSTRUCTION: answer in two paragraphs\./.test(sysOf(remReq)) && !/Talk to me as a peer/.test(sysOf(remReq)), "his own instructions replace the starter in what is sent");
  check((remReq.tools || []).some((t) => t.name === "remember"), "the remember tool is offered");
  await page.screenshot({ path: SHOTS + "ask-remember.png" });
  await page.click(".ask-card .remember button:has-text('Save')");
  check(await page.evaluate(() => /^\d{4}-\d\d-\d\d: Zone conference talks run twelve minutes\.$/.test(JSON.parse(localStorage.getItem("gospel.askNotes") || '""'))), "Save keeps the note, dated");
  await page.evaluate(() => { localStorage.removeItem("gospel.askInstructions"); });

  // with it on (the default), Return in the search box asks for more searches; off, it sends nothing
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
  await page.evaluate(() => window.Deck.reset());
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
  const thinkReq = requests.filter((b) => b.stream).at(-1) || {};
  check(/My standing instructions/.test(sysOf(thinkReq)) && /What he has asked you to remember[^\n]*\n\n\d{4}-\d\d-\d\d: Zone conference talks/.test(sysOf(thinkReq)), "Think it through sends the standing instructions and the saved note");
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
