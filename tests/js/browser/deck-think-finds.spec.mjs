// deck-think-finds: the deck's Think it through looks in the library for what the chain is
// missing. With Alma 40:11 and 2 Nephi 9:38 on the deck, the verse that says nearly the same and
// settles it (2 Nephi 9:26, "restored to that God who gave them breath, which is the Holy One of
// Israel") is found by the app itself and put in front of Claude, which may search further; what
// it chooses is offered as one Add, with its highlight and its arrow, and one Undo takes it off.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {} });
  const requests = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
  const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  await ctx.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || "{}");
    requests.push(body);
    const said = JSON.stringify(body.messages || []);
    const stream = (events) => route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse([{ type: "message_start" }, ...events, { type: "message_stop" }]) });
    if (!/tool_result/.test(said)) return stream([ // first it follows the second step: who judges
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu_1", name: "search", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: "appear before the judgment-seat of the Holy One of Israel" }) } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ]);
    const num = (cite) => Number((said.match(new RegExp(`\\[L(\\d+)\\] ${cite}`)) || [])[1] || 0);
    const reply = JSON.stringify({
      add: [
        { library: num("2 Nephi 9:26"), words: "restored to that God who gave them breath", to: { passage: 1, words: "taken home to that God who gave them life" }, label: "proves it is Christ", why: "It names the God to whom they return: the Holy One of Israel." },
        { library: num("2 Nephi 9:15"), words: "the judgment-seat of the Holy One of Israel", to: { library: num("2 Nephi 9:26"), words: "the Holy One of Israel" }, label: "echoes", why: "The same title, at the judgment." },
        { library: 999, words: "not there", to: { passage: 1 }, label: "x", why: "a number that is not in the list" },
      ],
      caption: "All return to the God who gave them life, and he is the Holy One of Israel.",
      labels: [], connections: [], key_phrases: [], notes: "",
    });
    return stream([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: reply } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]);
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS); await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  await page.evaluate(() => window.Deck.ready);
  const put = (ref) => page.evaluate(async (ref) => {
    const s = await GL.api("search", { q: ref, limit: 1 });
    const c = await GL.api("context", { doc_id: s.jump.doc_id, pid: s.jump.pid, before: 0, after: 0 });
    const v = c.paragraphs.find((x) => x.pid === s.jump.pid);
    return !!window.Deck.addPassage({ doc_id: s.jump.doc_id, pid: v.pid, kind: "verse", verse: v.verse, text: v.text, citation: c.citation, collection: c.collection });
  }, ref);
  check(await put("Alma 40:11") && await put("2 Nephi 9:38"), "two passages go on the deck");
  await page.evaluate(() => window.Deck.showBoard());
  await page.waitForSelector(".bcard", { timeout: 10000 });
  await page.locator(".board-row button", { hasText: /^More$/ }).first().click();
  await page.locator(".deck-actions button", { hasText: "Think it through" }).first().click();
  await page.waitForSelector(".think-list .think-row", { timeout: 60000 }).catch(() => {});
  check(requests.length === 2, `Claude is asked, searches once, and answers (${requests.length} requests)`);
  const first = requests[0] || {};
  const user = JSON.stringify((first.messages || [])[0] || "");
  check(/\[L\d+\] 2 Nephi 9:26/.test(user), `the app itself puts 2 Nephi 9:26 in front of Claude: ${(user.match(/\[L\d+\] [^\\(]{3,24}/g) || []).slice(0, 12).join(", ")}`);
  check(/2 Nephi 9:26 \(shares the words [^)]*god who gave them[^)]*Alma 40:11/.test(user), "and says why: the run of words it shares with Alma 40:11");
  check(/restored to that God who gave them breath/.test(user), "with its words");
  check(!/\[L\d+\] (Alma 40:11|2 Nephi 9:38)\b/.test(user), "what is already on the deck is not offered again");
  check((first.tools || []).map((t) => t.name).join(",") === "search,read" && !/This call has no tools/.test(JSON.stringify(first.system || "")), `Claude may search and read (${(first.tools || []).map((t) => t.name)})`);
  check(/look for what the chain is missing/.test(JSON.stringify(first.system || "")), "and is told to look for what the chain is missing");
  const second = JSON.stringify((requests[1] || {}).messages || []);
  check(/tool_result/.test(second) && /\[L\d+\] 2 Nephi 9:15/.test(second), "its own search is answered from the library, with numbers it can add by");
  const rows = await page.$$eval(".think-list .think-row", (ns) => ns.map((n) => n.textContent));
  check(rows.some((t) => /^Add 2 Nephi 9:26/.test(t) && /Alma 40:11/.test(t) && /proves it is Christ/.test(t)), `the verse is offered, with what it joins: ${rows.map((t) => t.slice(0, 70)).join(" | ")}`);
  check(rows.filter((t) => /^Add /.test(t)).length === 2, "a number that is not in the library's list offers nothing");
  await page.screenshot({ path: SHOTS + "deck-think-finds.png" });
  const state = () => page.evaluate(() => { const d = JSON.parse(JSON.stringify(window.Deck.peek ? window.Deck.peek() : null)); return d; });
  const cards = () => page.$$eval(".bcard .bc-cite, .bcard [class*=cite]", (ns) => ns.map((n) => n.textContent.trim()).filter(Boolean));
  const before = await page.locator(".bcard").count();
  const addRow = page.locator(".think-list .think-row", { hasText: "Add 2 Nephi 9:26" }).locator("button");
  await addRow.click({ timeout: 5000 }).catch((e) => errors.push("no Add row to tap: " + String(e).slice(0, 80))); await page.waitForTimeout(500);
  const after = await page.locator(".bcard").count();
  const order = await page.$$eval(".bcard", (ns) => ns.map((n) => (n.textContent.match(/(Alma 40:11|2 Nephi 9:38|2 Nephi 9:26|2 Nephi 9:15)/) || [""])[0]));
  check(after === before + 1 && order.join(",") === "Alma 40:11,2 Nephi 9:26,2 Nephi 9:38", `one tap puts it on the deck after the passage it answers (${order.join(", ")})`);
  const marks = await page.evaluate(() => [...document.querySelectorAll(".bcard")].map((c) => [...c.querySelectorAll(".hl-run, .w.hl, [class*=hl]")].map((x) => x.textContent).join(" ").replace(/\s+/g, " ").trim().slice(0, 60)));
  check(/that God who gave them life/.test(marks[0] || "") && /that God who gave them breath/.test(marks[1] || ""), `both phrases are highlighted (${JSON.stringify(marks)})`);
  check(await page.evaluate(() => window.Deck.canUndo()), "and it can be taken back");
  // the second step joins the one just added
  await page.locator(".think-list .think-row", { hasText: "Add 2 Nephi 9:15" }).locator("button").click({ timeout: 5000 }).catch((e) => errors.push("no second Add row: " + String(e).slice(0, 80))); await page.waitForTimeout(500);
  const order2 = await page.$$eval(".bcard", (ns) => ns.map((n) => (n.textContent.match(/(Alma 40:11|2 Nephi 9:38|2 Nephi 9:26|2 Nephi 9:15)/) || [""])[0]));
  check(order2.join(",") === "Alma 40:11,2 Nephi 9:26,2 Nephi 9:15,2 Nephi 9:38", `a second step goes after the verse it follows from (${order2.join(", ")})`);
  await page.screenshot({ path: SHOTS + "deck-think-finds-added.png" });
  await page.evaluate(() => window.Deck.undo()); await page.waitForTimeout(300);
  await page.evaluate(() => window.Deck.undo()); await page.waitForTimeout(300);
  check(await page.locator(".bcard").count() === before, `Undo twice takes both off again (${await page.locator(".bcard").count()})`);
  await ctx.close();
  return errors;
}
