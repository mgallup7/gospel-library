/* Ask: Claude on top of the library.
   Retrieval happens on this device (the library's own full-text index); only
   the question and the passages it turns up go to Claude, using the person's
   own API key, which is stored here and sent nowhere but api.anthropic.com. */
(() => {
  "use strict";

  const API_URL = "https://api.anthropic.com/v1/messages";
  const API_VERSION = "2023-06-01";
  const MODELS = [
    ["claude-sonnet-5-5", "Sonnet 5.5 (recommended)"],
    ["claude-opus-5-5", "Opus 5.5 (deeper, slower, costs more)"],
    ["claude-haiku-5-5", "Haiku 5.5 (fastest, cheapest)"],
  ];
  const PLANNER_MODEL = "claude-haiku-5-5";
  const MAX_PASSAGES = 22;
  const MAX_TURNS = 8;

  const LIBRARY = `The library holds: the standard works (KJV Old and New Testament, Book of Mormon, Doctrine and Covenants, Pearl of Great Price, with footnotes), every general conference talk from 1971 to today, Preach My Gospel (2023), Come, Follow Me, the General Handbook, and the study helps (Topical Guide, Bible Dictionary, Guide to the Scriptures). It is searched with the tools below; nothing outside it is available, and nothing should be quoted from memory.`;

  const TOOLS_GUIDE = `Tools:
- search: ranked full-text search (SQLite FTS5 with stemming). Use distinctive words; put exact phrases in double quotes; separate true synonyms with OR; scope narrows to scriptures, conference, pmg, handbook, cfm, or helps. Run several searches with different vocabulary (scriptural and modern) before concluding something is not there.
- find_all_verses: every scripture verse containing any of the given words (prefix-matched, canonical order, with counts per volume). This is the tool for "all the verses about…", "every time the scriptures say…", or any list meant to be complete. Give it the word family: "redeem redeemed redemption redeemer".
- read: a passage in context (the paragraphs around a verse or paragraph you have already seen), or a whole chapter or talk by reference ("Alma 32", "D&C 76", "3 Nephi 11").

Search until the question is answered or the list is complete; a dozen tool calls is fine. Every passage a tool returns carries a number like [12]; cite with those numbers and only those. Then write the answer.`;

  const SYSTEM_ASK = `You are a study assistant inside a personal library belonging to an experienced Latter-day Saint leader; speak to him as a peer. ${LIBRARY}

${TOOLS_GUIDE}

Writing the answer: open with the answer, not a restatement of the question. Quote scripture exactly as returned. Cite every quotation and every claim a passage supports with [n]. For a list, give every item, grouped by volume or book in canonical order, each with its reference and the exact text or the key clause; do not summarize a list the person asked for in full. Plain prose, short paragraphs, headings only when the answer is long, no bullet lists of one-line fragments, no em dashes. When the library does not settle the question, say so in a sentence.`;

  const SYSTEM_DRAFT = `You compose talks, lessons, trainings, letters and outlines for an experienced Latter-day Saint leader. ${LIBRARY}

${TOOLS_GUIDE}

Build the piece from passages the tools returned; quote scripture exactly and cite every quotation and paraphrase as [n]. Follow the requested form and length closely. Voice: warm, direct, doctrinally careful, concrete. No em dashes. No filler openings. Headings only when the form calls for them (an outline, a lesson plan). If the passages are thin for part of the request, write that part briefly and say which searches would strengthen it.`;

  const TOOLS = [
    { name: "search", description: "Ranked full-text search of the whole library. Returns the best passages with their numbers for citing.",
      input_schema: { type: "object", properties: {
        query: { type: "string", description: "Words to search. Exact phrases in double quotes. OR between true synonyms." },
        scope: { type: "string", enum: ["all", "scriptures", "conference", "pmg", "handbook", "cfm", "helps"], description: "Where to look. Default all." },
        speaker: { type: "string", description: "Surname of a conference speaker, to limit to their talks." },
        year_from: { type: "integer" }, year_to: { type: "integer" },
        limit: { type: "integer", description: "How many passages, 5 to 30. Default 12." },
      }, required: ["query"] } },
    { name: "find_all_verses", description: "Every scripture verse containing any of the given words, in canonical order, with counts per volume. For complete lists.",
      input_schema: { type: "object", properties: {
        words: { type: "string", description: "The word family, space-separated, e.g. 'redeem redeemed redemption redeemer'. Each is prefix-matched." },
        volume: { type: "string", enum: ["all", "ot", "nt", "bofm", "dc", "pgp"], description: "One volume, or all." },
        limit: { type: "integer", description: "Up to 600. Default 400." },
      }, required: ["words"] } },
    { name: "read", description: "Read in context: either the paragraphs around a passage you have (by its number), or a chapter or talk by reference.",
      input_schema: { type: "object", properties: {
        passage: { type: "integer", description: "The [n] of a passage already returned." },
        reference: { type: "string", description: "A chapter or verse reference such as 'Alma 32' or 'D&C 76:22-24', or a talk title." },
        before: { type: "integer", description: "Paragraphs before, default 2" }, after: { type: "integer", description: "Paragraphs after, default 2" },
      } } },
  ];
  const MAX_TOOL_CALLS = 14;

  const PLANNER = `You plan searches against a full-text index (SQLite FTS5, porter stemming) of: the standard works, general conference talks 1971 to today, Preach My Gospel, Come Follow Me, the General Handbook, and the Topical Guide, Bible Dictionary and Guide to the Scriptures.

Given the request (and any earlier turns), return JSON only, no prose:
{"queries":[{"q":"...","scope":"all"}], "references":["Alma 32:21"]}

Rules for queries: 3 to 7 of them. Use distinctive words, not stop words. Put exact phrases in double quotes. Vary vocabulary between scriptural wording ("endure to the end") and modern wording ("perseverance"). Separate alternatives with OR inside one query when they are true synonyms. scope is one of: all, scriptures, conference, pmg, handbook, cfm, helps. Prefer conference when the request asks what prophets or apostles have said, scriptures for doctrine and quotations, pmg for missionary teaching, handbook for policy. "references" lists scripture citations the request names or clearly alludes to, or [] if none.`;

  const GL = () => window.GL;
  const { el, esc, store } = window.GL || {};
  const $ = (sel, root = document) => root.querySelector(sel);

  let thread = [];     // [{role, content}] for the model, text only
  let view = null;     // container element
  let busy = false;
  let lastPassages = []; // passages shown with the latest answer
  let log = null;      // the answers so far; kept when the tab is left and returned to

  // ------------------------------------------------------------ settings --
  const settings = {
    get key() { return store.get("apiKey", ""); },
    set key(v) { v ? store.set("apiKey", v) : store.del("apiKey"); },
    get model() { return store.get("askModel", MODELS[0][0]); },
    set model(v) { store.set("askModel", v); },
    get planner() { return store.get("askPlanner", true); },
    set planner(v) { store.set("askPlanner", !!v); },
  };

  // --------------------------------------------------------------- render --
  function render(container) {
    view = container;
    container.replaceChildren();
    if (!settings.key) { renderKeySetup(container); return; }
    const box = el("div", { class: "ask" });
    const modes = el("div", { class: "seg ask-mode" }, [
      el("button", { type: "button", "data-mode": "ask", class: "on", text: "Ask" }),
      el("button", { type: "button", "data-mode": "draft", text: "Draft" }),
    ]);
    const input = el("textarea", { class: "ask-input", rows: 3, placeholder: "What have the prophets said about covenants and identity?", "aria-label": "Your question or request" });
    const go = el("button", { type: "button", class: "primary ask-go", text: "Ask" });
    const gear = el("button", { type: "button", class: "icon-btn", "aria-label": "Settings", title: "Settings", html: "&#9881;" });
    const hint = el("div", { class: "ask-hint", text: "Ask a question, or switch to Draft and describe what to write (a talk, a lesson, a training, a letter). Claude searches your library; every passage it finds becomes a card you can tick onto the deck." });
    if (!log) log = el("div", { class: "ask-log" });
    for (const b of modes.querySelectorAll("button")) {
      b.addEventListener("click", () => {
        for (const x of modes.querySelectorAll("button")) x.classList.toggle("on", x === b);
        const draft = b.dataset.mode === "draft";
        go.textContent = draft ? "Draft" : "Ask";
        input.placeholder = draft ? "A 10-minute zone conference training on obedience, with four scriptures and two conference quotes" : "What have the prophets said about covenants and identity?";
      });
    }
    go.addEventListener("click", () => submit(input, modes, log));
    input.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(input, modes, log); } });
    gear.addEventListener("click", () => renderSettings(container));
    box.append(el("div", { class: "ask-top" }, [modes, gear]), input, el("div", { class: "ask-actions" }, [go, el("button", { type: "button", class: "text-btn", text: "New thread", onclick: () => { thread = []; log.replaceChildren(); } })]), hint, log);
    container.append(box);
    if (GL().wide) input.focus();
  }

  function renderKeySetup(container) {
    const box = el("div", { class: "ask setup-key" });
    const input = el("input", { type: "password", placeholder: "Paste your Claude API key", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "API key" });
    const save = el("button", { type: "button", class: "primary", text: "Save on this device" });
    const msg = el("p", { class: "msg" });
    save.addEventListener("click", () => {
      const v = input.value.trim();
      if (!/^sk-ant-/.test(v)) { msg.textContent = "That does not look like a Claude API key (they begin with sk-ant-)."; return; }
      settings.key = v;
      render(container);
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") save.click(); });
    box.append(
      el("h2", { text: "Ask Claude about your library" }),
      el("p", { class: "lede", text: "Questions and drafts are answered from the passages in this library, with citations you can open or present. This runs on your own Claude account, so it needs an API key." }),
      el("ol", { class: "steps" }, [
        el("li", { html: "Sign in at <b>console.anthropic.com</b> and add a payment method (pay as you go; a question costs a few cents)." }),
        el("li", { text: "Create an API key and paste it below. It stays on this device and is sent only to Anthropic." }),
      ]),
      el("div", { class: "unlock" }, [input, save]),
      msg,
    );
    container.replaceChildren(box);
    input.focus();
  }

  function renderSettings(container) {
    const box = el("div", { class: "ask settings" });
    const model = el("select", { "aria-label": "Model" });
    for (const [id, label] of MODELS) model.append(el("option", { value: id, text: label, selected: id === settings.model }));
    const planner = el("input", { type: "checkbox", checked: settings.planner });
    const key = el("input", { type: "password", value: settings.key, autocomplete: "off", "aria-label": "API key" });
    box.append(
      el("h2", { text: "Ask settings" }),
      el("label", {}, ["Model for answers", model]),
      el("label", { class: "row-check" }, [planner, " Let a fast model plan the searches first (better recall, one extra cheap call)"]),
      el("label", {}, ["API key", key]),
      el("div", { class: "ask-actions" }, [
        el("button", { type: "button", class: "primary", text: "Save", onclick: () => { settings.model = model.value; settings.planner = planner.checked; settings.key = key.value.trim(); render(container); } }),
        el("button", { type: "button", class: "text-btn", text: "Cancel", onclick: () => render(container) }),
        el("button", { type: "button", class: "text-btn danger", text: "Remove key from this device", onclick: () => { settings.key = ""; thread = []; render(container); } }),
      ]),
    );
    container.replaceChildren(box);
  }

  // --------------------------------------------------------------- submit --
  async function submit(input, modes, log) {
    const text = input.value.trim();
    if (!text || busy) return;
    const mode = modes.querySelector("button.on")?.dataset.mode || "ask";
    if (!navigator.onLine) { log.prepend(el("div", { class: "status error", text: "Ask needs an internet connection. Search and reading work offline." })); return; }
    busy = true;
    input.value = "";
    const card = el("article", { class: "ask-card" });
    const q = el("div", { class: "ask-q", text: text });
    const status = el("div", { class: "ask-status", text: "Planning searches…" });
    const answer = el("div", { class: "ask-a" });
    const sources = el("div", { class: "ask-sources" });
    const tools = el("div", { class: "ask-tools" });
    const inline = el("div", { class: "ask-findings-inline" });
    card.append(q, status, answer, sources, tools, inline);
    log.prepend(card);
    try {
      const registry = new Registry();
      const findings = new Findings(registry.list, text);
      findings.mount(inline);
      // A head start: what the library's own search finds, before Claude asks for anything.
      status.textContent = "Searching the library…";
      const head = await registry.search({ query: text, limit: 10 });
      findings.refresh();
      status.textContent = head.length ? `${head.length} passages to start. Claude is searching further…` : "Claude is searching…";
      const reply = await agent(text, mode, registry, findings, status, answer);
      lastPassages = registry.list;
      thread.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (thread.length > MAX_TURNS * 2) thread = thread.slice(-MAX_TURNS * 2);
      status.remove();
      finish(answer, sources, tools, reply, registry.list);
      findings.setCited([...new Set([...reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]);
    } catch (err) {
      status.textContent = "";
      status.classList.add("error");
      status.textContent = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  function friendlyError(err) {
    const m = String(err?.message || err);
    if (/401|authentication|invalid x-api-key/i.test(m)) return "The API key was not accepted. Check it in settings (the gear).";
    if (/429|rate/i.test(m)) return "Claude is rate-limited right now; try again in a moment.";
    if (/402|credit|billing/i.test(m)) return "The Claude account has no credit. Add a payment method at console.anthropic.com.";
    if (/Failed to fetch|NetworkError|load failed/i.test(m)) return "Could not reach Claude. Check the connection.";
    return `Something went wrong: ${m}`;
  }

  // The search box uses this to widen a question with a few more queries.
  async function planQueries(text) {
    const history = thread.slice(-4).map((m) => `${m.role}: ${m.content.slice(0, 600)}`).join("\n");
    const user = (history ? `Earlier turns:\n${history}\n\n` : "") + `Request: ${text}`;
    const out = await complete({ model: PLANNER_MODEL, system: PLANNER, messages: [{ role: "user", content: user }], max_tokens: 400, stream: false });
    const m = out.match(/\{[\s\S]*\}/);
    const plan = JSON.parse(m ? m[0] : out);
    const queries = (plan.queries || []).filter((q) => q && q.q).slice(0, 7).map((q) => ({ q: String(q.q).slice(0, 120), scope: String(q.scope || "all") }));
    const references = (plan.references || []).filter((r) => typeof r === "string").slice(0, 6);
    return { queries, references };
  }

  // ------------------------------------------------------------- registry --
  // Every passage any tool returns gets a stable number; citations use them.
  class Registry {
    constructor() { this.list = []; this.byKey = new Map(); }
    add(p) {
      const key = `${p.doc_id}:${p.pid}`;
      const prev = this.byKey.get(key);
      if (prev) { for (const k of Object.keys(p)) if (prev[k] === undefined || prev[k] === null) prev[k] = p[k]; return prev; }
      const entry = { ...p, n: this.list.length + 1 };
      this.list.push(entry); this.byKey.set(key, entry);
      return entry;
    }
    async fromHit(hit, { before = 0, after = 0 } = {}) {
      const api = GL().api;
      const ctx = await api("context", { doc_id: hit.doc_id, pid: hit.pid, before, after });
      if (!ctx || !ctx.paragraphs.length) return null;
      const verses = ctx.paragraphs.filter((x) => x.kind === "verse" && x.verse).map((x) => ({ n: x.verse, text: x.text }));
      const plain = ctx.paragraphs.map((x) => x.text).join(" ");
      return this.add({ doc_id: hit.doc_id, pid: hit.pid, kind: hit.kind, citation: ctx.citation, label: sourceLabel(ctx), text: plain.slice(0, 1800), plain,
        verses: verses.length ? verses : null, author: ctx.author, title: ctx.title, collection: ctx.collection, conf: ctx.label });
    }
    async search({ query, scope = "all", speaker, year_from, year_to, limit = 12 }) {
      const api = GL().api;
      const r = await api("search", { q: query, scope: scope && scope !== "all" ? scope : null, limit: Math.max(5, Math.min(30, limit || 12)), speaker: speaker || null, from: year_from || null, to: year_to || null });
      const out = [];
      for (const h of r.hits) {
        const p = await this.fromHit(h, { before: h.kind === "verse" ? 1 : 0, after: h.kind === "verse" ? 1 : 0 });
        if (p) out.push(p);
      }
      if (r.jump?.doc_id && r.jump.pid) {
        const p = await this.fromHit({ doc_id: r.jump.doc_id, pid: r.jump.pid, kind: "verse" }, { before: 0, after: r.jump.verse_end ? Math.max(0, r.jump.verse_end - parseInt(r.jump.pid.slice(1), 10)) : 0 });
        if (p) out.unshift(p);
      }
      return out;
    }
    async verses({ words, volume = "all", limit = 400 }) {
      const r = await GL().api("verses", { words, volume, limit });
      const out = r.verses.map((v) => this.add({ doc_id: v.doc_id, pid: v.pid, kind: "verse", citation: v.citation, label: v.citation, text: v.text, plain: v.text, verses: [{ n: v.verse, text: v.text }], collection: "scriptures", volume: v.volume }));
      return { total: r.total, out, query: r.query, error: r.error };
    }
    async read({ passage, reference, before = 2, after = 2 }) {
      const api = GL().api;
      if (passage) {
        const p = this.list[passage - 1];
        if (!p) return { error: `no passage [${passage}]` };
        const ctx = await api("context", { doc_id: p.doc_id, pid: p.pid, before: Math.min(before, 12), after: Math.min(after, 12) });
        if (!ctx) return { error: "not found" };
        const out = [];
        for (const x of ctx.paragraphs) {
          if (x.kind === "verse" || x.kind === "para") out.push(this.add({ doc_id: p.doc_id, pid: x.pid, kind: x.kind, citation: x.kind === "verse" && x.verse ? `${(p.citation || "").replace(/:\d.*$/, "")}:${x.verse}` : p.citation, label: p.label, text: x.text, plain: x.text, verses: x.kind === "verse" && x.verse ? [{ n: x.verse, text: x.text }] : null, author: p.author, title: p.title, collection: p.collection, conf: p.conf }));
        }
        return { out };
      }
      if (reference) {
        const r = await api("search", { q: reference, limit: 3 });
        let docId = r.jump?.doc_id || r.titles?.[0]?.doc_id || null;
        let pid = r.jump?.pid || null;
        if (!docId) return { error: `nothing found for "${reference}"` };
        const doc = await api("doc", { id: docId });
        if (!doc) return { error: "not found" };
        const holder = el("div", { html: doc.body_html || "" });
        const out = [];
        const units = [...holder.querySelectorAll("p.verse, .body-block p, .body-block li")].filter((n) => n.id);
        let started = !pid;
        for (const n of units) {
          if (!started && n.id === pid) started = true;
          if (!started) continue;
          const num = n.querySelector(".verse-number");
          const c = n.cloneNode(true);
          for (const junk of c.querySelectorAll("sup.marker, .verse-number, .page-break")) junk.remove();
          const textU = c.textContent.replace(/\s+/g, " ").trim();
          if (!textU) continue;
          const verse = num ? parseInt(num.textContent, 10) : null;
          out.push(this.add({ doc_id: doc.id, pid: n.id, kind: verse ? "verse" : "para", citation: verse ? `${doc.citation.replace(/:\d.*$/, "")}:${verse}` : doc.citation, label: doc.label, text: textU, plain: textU, verses: verse ? [{ n: verse, text: textU }] : null, author: doc.author, title: doc.title, collection: doc.collection, conf: doc.label }));
          if (out.length >= 80) break;
        }
        return { out, title: doc.title };
      }
      return { error: "give a passage number or a reference" };
    }
  }

  function sourceLabel(d) {
    if (d.collection === "general-conference") return [d.author, `“${d.title}”`, d.label].filter(Boolean).join(", ");
    if (d.collection === "scriptures") return d.citation;
    return [d.title, d.label].filter(Boolean).join(", ");
  }
  function passageLine(p, max = 420) {
    const t = p.verses && p.verses.length ? p.verses.map((v) => `${v.n} ${v.text}`).join(" ") : (p.plain || p.text);
    return `[${p.n}] ${p.label}\n${t.length > max ? t.slice(0, max) + "…" : t}`;
  }

  // ------------------------------------------------------------------ agent --
  // Claude searches the library with tools until it is ready to answer; the
  // final text streams into the answer box.
  async function agent(text, mode, registry, findings, statusEl, answerEl) {
    const head = registry.list.map((p) => passageLine(p)).join("\n\n");
    const first = `${mode === "draft" ? "Request" : "Question"}: ${text}` + (head ? `\n\nPassages already found by a first search (cite by number; search for more as needed):\n\n${head}` : "");
    const messages = [...thread.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: first }];
    let calls = 0, finalText = "";
    for (let turn = 0; turn < MAX_TOOL_CALLS + 2; turn++) {
      let buffer = "", pending = false;
      const flush = () => { pending = false; answerEl.innerHTML = markdown(buffer, registry.list); };
      const res = await complete({
        model: settings.model, system: mode === "draft" ? SYSTEM_DRAFT : SYSTEM_ASK, messages, tools: calls < MAX_TOOL_CALLS ? TOOLS : undefined,
        max_tokens: mode === "draft" ? 8000 : 5000, stream: true,
        onDelta: (t) => { buffer += t; if (!pending) { pending = true; requestAnimationFrame(flush); } },
      });
      finalText = res.text;
      if (res.stop_reason !== "tool_use" || !res.tool_uses.length) { buffer = res.text; flush(); break; }
      // run the tools, show what is being searched, feed results back
      messages.push({ role: "assistant", content: res.blocks });
      const results = [];
      for (const tu of res.tool_uses) {
        calls++;
        let content = "";
        try {
          if (tu.name === "search") {
            statusEl.textContent = `Searching: ${tu.input.query}${tu.input.scope && tu.input.scope !== "all" ? ` (${tu.input.scope})` : ""}…`;
            const out = await registry.search(tu.input);
            content = out.length ? out.map((p) => passageLine(p)).join("\n\n") : "No passages matched. Try other words or a different scope.";
          } else if (tu.name === "find_all_verses") {
            statusEl.textContent = `Finding every verse with: ${tu.input.words}…`;
            const r = await registry.verses(tu.input);
            const byVol = {};
            for (const p of r.out) byVol[p.volume] = (byVol[p.volume] || 0) + 1;
            content = r.error ? `Error: ${r.error}` : `${r.total} verses match (${Object.entries(byVol).map(([k, v]) => `${k} ${v}`).join(", ")})${r.out.length < r.total ? `; showing the first ${r.out.length}. Call again one volume at a time for the rest.` : "."}\n\n` + r.out.map((p) => `[${p.n}] ${p.citation}: ${p.text.length > 300 ? p.text.slice(0, 300) + "…" : p.text}`).join("\n");
          } else if (tu.name === "read") {
            statusEl.textContent = `Reading ${tu.input.reference || `passage ${tu.input.passage}`}…`;
            const r = await registry.read(tu.input);
            content = r.error ? `Error: ${r.error}` : (r.title ? `${r.title}\n\n` : "") + r.out.map((p) => passageLine(p, 600)).join("\n\n");
          } else content = `Unknown tool ${tu.name}`;
        } catch (err) { content = `Error: ${err.message}`; }
        const cap = tu.name === "find_all_verses" ? 170000 : 60000;
        if (content.length > cap) content = content.slice(0, cap) + "\n…(truncated; ask for one volume at a time to see the rest)";
        results.push({ type: "tool_result", tool_use_id: tu.id, content });
        findings.refresh();
      }
      if (calls >= MAX_TOOL_CALLS) results.push({ type: "text", text: "That is the last search available; write the answer from what has been found." });
      messages.push({ role: "user", content: results });
      statusEl.textContent = `${registry.list.length} passages so far. Claude is thinking…`;
    }
    return finalText;
  }

  function finish(answerEl, sourcesEl, toolsEl, reply, passages) {
    toolsEl.append(el("button", { type: "button", class: "text-btn", text: "Copy answer", onclick: () => navigator.clipboard?.writeText(plainText(reply, passages)).catch(() => {}) }));
  }

  // ------------------------------------------------------------ findings --
  // The passages behind an answer, as cards under it. Ticking a card puts the
  // passage on the deck (the board on the right of a wide screen, the Deck
  // tab on a phone), where phrases are highlighted and linked.
  class Findings {
    constructor(passages, question) {
      this.passages = passages;
      this.question = question;
      this.cited = [];
      this.root = el("div", { class: "findings" });
      this.onDeck = () => this.sync();
      window.addEventListener("deck:change", this.onDeck);
    }
    mount(inlineHost) {
      this.inlineHost = inlineHost;
      this.draw();
      inlineHost.replaceChildren(this.root);
      if (GL().wide && window.Deck?.count()) window.Deck.showBoard();
    }
    refresh() { this.draw(); }
    setCited(nums) {
      this.cited = nums;
      this.draw();
    }
    inDeck(p) { return !!window.Deck?.has(p.doc_id, p.pid); }
    forDeck(p) { return { doc_id: p.doc_id, pid: p.pid, kind: p.kind, text: p.plain || p.text, verses: p.verses, citation: p.citation, label: p.conf || p.label, author: p.author, title: p.title, collection: p.collection }; }
    // The deck changed somewhere: keep the ticks honest without rebuilding the cards.
    sync() {
      if (!this.root.isConnected) { window.removeEventListener("deck:change", this.onDeck); return; }
      for (const card of this.root.querySelectorAll(".finding")) {
        const p = this.passages.find((x) => x.n === Number(card.dataset.n));
        if (!p) continue;
        const on = this.inDeck(p);
        card.classList.toggle("on", on);
        const cb = card.querySelector("input[type=checkbox]");
        if (cb) cb.checked = on;
      }
      const bar = this.root.querySelector(".findings-bar");
      if (bar) bar.replaceWith(this.bar());
    }
    order() {
      const cited = this.cited.map((n) => this.passages.find((p) => p.n === n)).filter(Boolean);
      const rest = this.passages.filter((p) => !this.cited.includes(p.n));
      return { cited, rest };
    }
    draw() {
      const { cited, rest } = this.order();
      const root = this.root;
      root.replaceChildren();
      root.append(el("div", { class: "findings-head" }, [
        el("div", { class: "findings-q", text: this.question }),
        this.bar(),
      ]));
      if (cited.length) {
        root.append(el("div", { class: "group-title", text: `Cited in the answer (${cited.length})` }));
        for (const p of cited) root.append(this.card(p, true));
      }
      if (rest.length) {
        root.append(el("div", { class: "group-title", text: cited.length ? `Also found (${rest.length})` : `Found (${rest.length})` }));
        const show = this.showAll ? rest : rest.slice(0, 60);
        for (const p of show) root.append(this.card(p, false));
        if (show.length < rest.length) root.append(el("button", { type: "button", class: "more", text: `Show all ${rest.length}`, onclick: () => { this.showAll = true; this.draw(); } }));
      }
      if (!this.passages.length) root.append(el("div", { class: "empty", text: "Nothing in the library matched. Try other words, or name a book or a speaker." }));
    }
    bar() {
      const mine = this.passages.filter((p) => this.inDeck(p));
      const n = mine.length;
      const total = window.Deck?.count() || 0;
      const bar = el("div", { class: "findings-bar" }, [
        el("span", { class: "n", text: n ? `${n} of these on the deck` : "Tick a passage to put it on the deck" }),
        el("button", { type: "button", class: "primary", text: total ? `Deck ${total}` : "Deck", disabled: !total, title: "Highlight and link the passages on the deck", onclick: () => window.Deck?.showBoard() }),
        el("button", { type: "button", class: "text-btn", text: "Present", disabled: !n, onclick: () => this.present(mine) }),
        el("button", { type: "button", class: "text-btn", text: n ? "Clear" : "Add all", onclick: () => {
          if (n) { for (const p of mine) window.Deck.remove(p.doc_id, p.pid); return; }
          const list = this.passages.slice(0, 40);
          for (const p of list) if (!this.inDeck(p)) window.Deck?.addPassage(this.forDeck(p));
          if (this.passages.length > list.length) GL().toast(`The first ${list.length} are on the deck; tick any others you want.`);
          if (GL().wide) window.Deck?.showBoard();
        } }),
      ]);
      return bar;
    }
    card(p, isCited) {
      const on = this.inDeck(p);
      const text = p.verses && p.verses.length
        ? p.verses.map((v) => `<span class="vn">${v.n}</span> ${esc(v.text)}`).join(" ")
        : esc(p.plain || p.text);
      return el("div", { class: "finding" + (on ? " on" : ""), "data-n": String(p.n) }, [
        el("label", { class: "pick", title: "On the deck" }, [el("input", { type: "checkbox", checked: on, "aria-label": `On the deck: ${p.label}`, onchange: () => {
          const added = window.Deck?.toggle(this.forDeck(p));
          if (added && GL().wide) window.Deck.showBoard();
        } })]),
        el("div", { class: "body" }, [
          el("div", { class: "cite" }, [isCited ? el("b", { class: "num", text: String(p.n) }) : null, el("span", { text: p.collection === "general-conference" ? (p.author || "") : p.citation })]),
          p.collection === "general-conference" ? el("div", { class: "src", text: [p.title ? `“${p.title}”` : "", p.conf || p.label].filter(Boolean).join(", ") }) : (p.label && p.label !== p.citation ? el("div", { class: "src", text: p.label }) : null),
          el("div", { class: "text", html: text }),
          el("div", { class: "acts" }, [
            el("button", { type: "button", class: "text-btn small", text: "Open", onclick: () => GL().openDoc(p.doc_id, p.pid) }),
            el("button", { type: "button", class: "text-btn small", text: "Present", onclick: () => this.present([p]) }),
          ]),
        ]),
      ]);
    }
    present(list) {
      GL().startPresentingUnits(list.map((p) => ({
        text: p.plain || p.text,
        html: p.verses && p.verses.length ? p.verses.map((v) => `<span class="vn">${v.n}</span> ${esc(v.text)}`).join(" ") : esc(p.plain || p.text),
        where: p.collection === "general-conference" ? [p.author, p.title ? `“${p.title}”` : "", p.conf || p.label].filter(Boolean).join("  ·  ") : p.citation,
        kind: p.kind === "verse" ? "verse" : "para", doc_id: p.doc_id,
      })));
    }
  }

  function plainText(reply, passages) {
    const cited = [...new Set([...reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
    const notes = cited.map((n) => { const p = passages.find((x) => x.n === n); return p ? `[${n}] ${p.label}` : null; }).filter(Boolean).join("\n");
    return reply + (notes ? `\n\nSources\n${notes}` : "");
  }

  // A small markdown renderer: paragraphs, headings, lists, bold, italic, and [n] citations.
  function markdown(src, passages) {
    const cite = (n) => {
      const p = passages.find((x) => x.n === Number(n));
      return p ? `<button type="button" class="cite" data-doc="${p.doc_id}" data-pid="${esc(p.pid || "")}" title="${esc(p.label)}">${esc(shortLabel(p))}</button>` : `[${n}]`;
    };
    const inline = (t) => esc(t)
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>")
      .replace(/\[(\d+)\]/g, (_, n) => cite(n));
    const lines = src.split("\n");
    const out = [];
    let list = null, para = [];
    const closePara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
    for (const raw of lines) {
      const line = raw.trimEnd();
      const h = line.match(/^(#{1,4})\s+(.*)$/);
      const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (!line.trim()) { closePara(); closeList(); continue; }
      if (h) { closePara(); closeList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
      if (li) {
        closePara();
        const kind = /^\s*\d/.test(line) ? "ol" : "ul";
        if (list !== kind) { closeList(); list = kind; out.push(`<${kind}>`); }
        out.push(`<li>${inline(li[1])}</li>`);
        continue;
      }
      closeList();
      para.push(line);
    }
    closePara(); closeList();
    return out.join("\n");
  }

  function shortLabel(p) {
    if (p.collection === "general-conference") {
      const surname = (p.author || "").replace(/^(President|Elder|Sister|Brother|Bishop)\s+/, "").split(" ").pop();
      const when = (p.conf || p.label || "").replace(" General Conference", "").replace(/^April /, "Apr ").replace(/^October /, "Oct ");
      return [surname, when].filter(Boolean).join(", ");
    }
    return p.citation || p.label;
  }

  document.addEventListener("click", (e) => {
    const c = e.target.closest("button.cite");
    if (c) GL().openDoc(Number(c.dataset.doc), c.dataset.pid || null);
  });

  // ------------------------------------------------------------ transport --
  async function complete({ model, system, messages, max_tokens, stream, onDelta, tools }) {
    const body = { model, system, messages, max_tokens, stream: !!stream };
    if (tools) body.tools = tools;
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.key,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json())?.error?.message || ""; } catch (_) {}
      throw new Error(`${r.status} ${detail}`.trim());
    }
    if (!stream) {
      const data = await r.json();
      const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      return tools ? { text, blocks: data.content || [], tool_uses: (data.content || []).filter((c) => c.type === "tool_use"), stop_reason: data.stop_reason } : text;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", text = "", stop_reason = null;
    const blocks = []; // in order, as the API sent them
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        let evt;
        try { evt = JSON.parse(dataLine.slice(5).trim()); } catch (_) { continue; }
        if (evt.type === "content_block_start") {
          const b = evt.content_block || {};
          blocks[evt.index] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, json: "", input: {} } : { type: "text", text: "" };
        } else if (evt.type === "content_block_delta") {
          const b = blocks[evt.index];
          if (evt.delta?.type === "text_delta") { text += evt.delta.text; if (b) b.text += evt.delta.text; onDelta && onDelta(evt.delta.text); }
          else if (evt.delta?.type === "input_json_delta" && b) b.json += evt.delta.partial_json;
        } else if (evt.type === "content_block_stop") {
          const b = blocks[evt.index];
          if (b && b.type === "tool_use") { try { b.input = b.json ? JSON.parse(b.json) : {}; } catch (_) { b.input = {}; } delete b.json; }
        } else if (evt.type === "message_delta") {
          if (evt.delta?.stop_reason) stop_reason = evt.delta.stop_reason;
        } else if (evt.type === "error") throw new Error(evt.error?.message || "stream error");
      }
    }
    const clean = blocks.filter(Boolean).map((b) => (b.type === "text" ? { type: "text", text: b.text } : { type: "tool_use", id: b.id, name: b.name, input: b.input })).filter((b) => b.type !== "text" || b.text);
    if (!tools) return text;
    return { text, blocks: clean, tool_uses: clean.filter((b) => b.type === "tool_use"), stop_reason };
  }

  window.Ask = { render, settings, plan: planQueries, hasKey: () => !!settings.key };
})();
