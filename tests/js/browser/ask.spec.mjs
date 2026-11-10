// ask: the Claude layer against a stand-in for api.anthropic.com (the sandbox has no web).
// A model that only ever asks for more searches still ends in words: after the tool budget
// one last request goes out with tools off. And with "propose extra searches" off, Return in
// the search box asks Claude nothing. Settings open over Ask as a sheet (Back and Escape close
// them, the typed question stays), hold his standing instructions and his notes, and a note
// Claude proposes is saved only when he taps Save. Ask and Draft carry one line of context (the
// page open, what is selected, the deck); his own notes are reachable with a tool; the thread
// survives a reload, and New thread can be undone. Stop ends an answer and keeps its passages;
// a busy server is tried twice more and the question goes back in the box; an answer cut off
// by max_tokens says so and continues. Ask has the full width with one centred column, the box
// docked at the foot, the hint only while the thread is empty, and the question printed once.
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
    // the question of this turn (earlier turns ride along as history and must not pick the reply)
    const now = [...(body.messages || [])].reverse().find((m) => m.role === "user" && typeof m.content === "string" && /\n\n(Question|Request): /.test(m.content))?.content || "";
    const text = (t) => [{ type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" }];
    const tool = (name, input) => [{ type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `tu_${requests.length}`, name, input: {} } }, { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } }, { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" }];
    const stream = (events) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse(events) });
    // never answers: for Stop
    if (/STOP-TEST/.test(now)) return;
    // always overloaded
    if (/BUSY-TEST/.test(now)) return route.fulfill({ status: 529, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }) });
    // out of room mid-answer, then the rest when asked to continue
    if (/CUT-TEST/.test(now)) return stream(/Continue from exactly where you stopped/.test(said) ? text(" and the second half.") : text("The first half").map((e) => (e.type === "message_delta" ? { type: "message_delta", delta: { stop_reason: "max_tokens" } } : e)));
    // a question about his own notes: Claude looks in them, then quotes one
    if (/NOTES-TEST/.test(now)) return stream(/tool_result/.test(said) ? text('Your note says "NOTE-MARK faith is not a perfect knowledge of things".') : tool("my_notes", { query: "faith knowledge" }));
    // a question that states a preference: Claude proposes a note, then answers
    if (/REMEMBER-TEST/.test(now)) return stream(/tool_result/.test(said) ? text("Noted for this answer.") : tool("remember", { note: "Zone conference talks run twelve minutes." }));
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
  // the layout: the whole width, a 680px column in the middle, the box at the foot, a hint while empty
  const layout = () => page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); const c = r(".ask-page"), d = r(".ask-dock"); return { list: Math.round(r("#list").width), w: Math.round(c.width), left: Math.round(c.left), foot: Math.round(d.bottom), hint: getComputedStyle(document.querySelector(".ask-hint")).display !== "none", gear: !!document.querySelector(".ask-gear svg"), scroll: document.documentElement.scrollWidth }; });
  const empty = await layout();
  check(empty.list === 1180 && empty.w === 680 && empty.left === 250, `Ask has the full width and a centred 680px column: ${JSON.stringify(empty)}`);
  check(empty.foot === 820, `the box is docked at the foot (bottom at ${empty.foot})`);
  check(empty.hint && empty.gear, "an empty thread shows the hint, and the gear is an icon");
  await page.screenshot({ path: SHOTS + "ask-empty.png" });
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
  check(await page.evaluate(() => !document.querySelector(".ask-go").disabled && document.querySelector(".ask-go").textContent === "Ask"), "Ask is ready for the next question");
  // the loop's cost: one cache marker on the system prompt, one on the newest tool result
  const marked = (final.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.cache_control);
  const lastResults = (final.messages?.at(-1)?.content || []).filter((b) => b.type === "tool_result");
  check(marked.length === 1 && marked[0] === lastResults.at(-1), `one cache marker in the messages, on the newest tool result (got ${marked.length})`);
  check((final.system || []).filter((b) => b.cache_control).length === 1, "and one on the system prompt");
  await page.screenshot({ path: SHOTS + "ask-capped.png" });
  const after = await layout();
  check(!after.hint && after.foot === 820 && after.scroll === 1180, `with an answer the hint is gone and the box stays at the foot: ${JSON.stringify(after)}`);
  check((await page.textContent(".ask-card")).split("What is faith?").length === 2, "the question is printed once");

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

  // Stop: the button turns into Stop while an answer is on its way; pressing it ends the answer,
  // keeps the passages found, and puts the question back
  await page.fill(".ask-input", "STOP-TEST faith and hope");
  await page.click(".ask-go");
  await page.waitForFunction(() => document.querySelector(".ask-go")?.textContent === "Stop" && /Claude is searching/.test(document.querySelector(".ask-log")?.textContent || ""), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + "ask-stop.png" });
  await page.click(".ask-go");
  await page.waitForFunction(() => /Stopped\./.test(document.querySelector(".ask-log")?.textContent || ""), null, { timeout: 5000 }).catch(() => null);
  const stopCard = await page.evaluate(() => { const c = [...document.querySelectorAll(".ask-card")].find((x) => /STOP-TEST/.test(x.textContent)); return c ? { status: c.querySelector(".ask-status")?.textContent || "", found: c.querySelectorAll(".finding").length } : null; });
  check(!!stopCard && /^Stopped\. The \d+ passages found so far are kept\. Your question is back in the box\.$/.test(stopCard.status) && stopCard.found > 0, `Stop keeps the passages and says so: ${JSON.stringify(stopCard)}`);
  check((await page.inputValue(".ask-input")) === "STOP-TEST faith and hope" && (await page.textContent(".ask-go")) === "Ask", "the question is back in the box and the button is Ask again");

  // a busy server: two more tries, then a plain line, and the question is kept
  await page.fill(".ask-input", "BUSY-TEST faith");
  let before = requests.length;
  await page.click(".ask-go");
  await page.waitForFunction(() => /Claude is busy right now\. Your question is kept; try again in a minute\./.test(document.querySelector(".ask-log")?.textContent || ""), null, { timeout: 20000 }).catch(() => null);
  check(/Claude is busy right now\. Your question is kept/.test(await page.textContent(".ask-log")), "529 ends in a plain line");
  check(requests.length - before === 3, `one try and two more (got ${requests.length - before})`);
  check((await page.inputValue(".ask-input")) === "BUSY-TEST faith", "and the question is back in the box");

  // an answer that runs out of room says so, and Continue finishes it in place
  await page.fill(".ask-input", "CUT-TEST faith");
  await page.click(".ask-go");
  await page.waitForSelector(".ask-card .ask-cut", { timeout: 20000 }).catch(() => null);
  check(/ran out of room before it ended/.test(await page.textContent(".ask-card .ask-cut").catch(() => "")), "a cut-off answer says so");
  await page.click(".ask-card .ask-cut button").catch(() => {});
  await page.waitForFunction(() => /The first half and the second half\./.test(document.querySelector(".ask-log")?.textContent || ""), null, { timeout: 20000 }).catch(() => null);
  check(/The first half and the second half\./.test(await page.textContent(".ask-log")) && !(await page.$(".ask-card .ask-cut")), "Continue finishes the answer in place");
  check(await page.evaluate(() => { const t = JSON.parse(localStorage.getItem("gospel.askThread") || "[]"); return t.filter((m) => /CUT-TEST/.test(m.content)).length === 1 && t.at(-1).content === "The first half and the second half."; }), "and the thread holds the whole answer once");

  // library HTML is parsed inertly: nothing in it runs
  check(await page.evaluate(async () => { const s = window.Ask.subjectFor({ doc: { title: "x", body_html: '<p>one</p><img src="x" onerror="window.__ran = 1"><p>two</p>' } }); await new Promise((r) => setTimeout(r, 300)); return !window.__ran && /one\ntwo/.test(s.content); }), "an onerror in a page's HTML does not run");

  // the page he has open, what he selected in it and his own note on it go along
  await page.evaluate(async () => { const s = await GL.api("search", { q: "Alma 32" }); GL.openDoc(s.jump.doc_id, "p21"); });
  await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
  await page.evaluate(async () => { const d = GL.reading.doc; await window.Marks.set({ uri: d.uri, doc_id: d.id, pid: "p21", verse: 21, kind: "verse", note: "NOTE-MARK faith is not a perfect knowledge of things", text: "And now as I said concerning faith", citation: "Alma 32:21", title: d.title }); });
  await page.click("#reader .doc #p21");
  await page.fill(".ask-input", "NOTES-TEST what did I note about faith");
  await page.click(".ask-go");
  await page.waitForFunction(() => /Your note says/.test(document.querySelector(".ask-log")?.textContent || ""), null, { timeout: 30000 }).catch(() => null);
  const notesReqs = requests.filter((b) => b.stream && /NOTES-TEST/.test(JSON.stringify(b.messages)));
  const firstTurn = String(notesReqs[0]?.messages?.at(-1)?.content || "");
  check(/^Today is [^\n]+\nContext, for reference only[^\n]*He has this page open: Alma 32 \(Scriptures\)\./.test(firstTurn), `Ask sends what he is reading: ${firstTurn.slice(0, 200)}`);
  check(/Selected in it: verse 21: And now as I said concerning faith/.test(firstTurn), `and what he selected: ${firstTurn.slice(0, 260)}`);
  const noteResult = JSON.stringify(notesReqs.at(-1)?.messages?.at(-1)?.content || "");
  check(/His note on \[\d+\] Alma 32:21/.test(noteResult) && /NOTE-MARK faith is not a perfect knowledge/.test(noteResult), `my_notes returns his note with its passage: ${noteResult.slice(0, 200)}`);
  check(!(await page.evaluate(() => [...document.querySelectorAll(".ask-card")].find((c) => /NOTES-TEST/.test(c.textContent))?.querySelector(".quote-note"))), "a quotation from his own note is not flagged");
  await page.click("#reader .doc #p21"); // unselect

  // the thread is kept on the device with each [n] replaced by its passage, and comes back after a reload
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.askThread") || "[]"));
  check(kept.length === 8 && kept[0].content === "What is faith?", `the exchanges that finished are kept (got ${kept.length})`);
  check(!/\[\d+\]/.test(kept[1]?.content || "") && /true \([^)]+\d\)\.$/.test(kept[1]?.content || ""), `the old [n] became its passage: ${kept[1]?.content}`);
  await page.goto(BASE + "#");
  await page.reload();
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 60000 });
  await page.click("#askBtn");
  await page.waitForSelector(".ask-input", { timeout: 10000 });
  check((await page.$$(".ask-card.kept")).length === 4, `the answers are back after a reload (got ${(await page.$$(".ask-card.kept")).length})`);
  check(/What is faith\?/.test(await page.textContent(".ask-log")), "with their questions");
  // New thread clears them, and Undo brings them back
  await page.click(".ask .text-btn:has-text('New thread')");
  check((await page.$$(".ask-card")).length === 0 && await page.evaluate(() => !localStorage.getItem("gospel.askThread")), "New thread clears the answers and the stored thread");
  await page.click(".toast .toast-action");
  check((await page.$$(".ask-card")).length === 4 && await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.askThread") || "[]").length === 8), "Undo brings the thread back");

  // with it on (the default), Return in the search box asks for more searches; off, it sends nothing
  before = requests.length;
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
  const thinkTurn = String(thinkReq.messages?.[0]?.content || "");
  check(/^Today is /.test(thinkTurn) && /\n20: [^\n]+\n21: And now as I said concerning faith[^\n]+\n22: /.test(thinkTurn), `the page goes one verse to a line, its number apart: ${thinkTurn.slice(0, 120)}`);
  check(/His note: NOTE-MARK/.test(thinkTurn), "with his note on it");
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
