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

  const SYSTEM_ASK = `You are a study assistant inside a personal library of the standard works, every general conference talk since 1971, Preach My Gospel, Come, Follow Me, the General Handbook, and the study helps. The person is an experienced Latter-day Saint leader; speak to them as a peer.

Answer from the numbered passages supplied with the question. After any sentence a passage supports, cite it as [n]. Cite only passages that were supplied, never from memory. When the passages do not settle the question, say so in a sentence and say what you would search next, rather than filling the gap from general knowledge. Quote scripture exactly as given.

Write plainly: short paragraphs, no headings unless the answer is long, no bullet lists of one-line fragments, no em dashes. Open with the answer, not with a restatement of the question.`;

  const SYSTEM_DRAFT = `You compose talks, lessons, trainings, letters and outlines for an experienced Latter-day Saint leader, drawing on a personal library of the standard works, general conference talks since 1971, Preach My Gospel, Come, Follow Me, the General Handbook, and the study helps.

Build the piece from the numbered passages supplied; quote scripture exactly as given and cite every quotation and paraphrase as [n]. Cite only passages that were supplied. Follow the requested form and length closely. If the passages are thin for part of the request, write that part briefly and say which searches would strengthen it.

Voice: warm, direct, doctrinally careful, concrete. No em dashes. No filler openings. Use headings only when the form calls for them (an outline, a lesson plan).`;

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
    const hint = el("div", { class: "ask-hint", text: "Ask a question, or switch to Draft and describe what to write (a talk, a lesson, a training, a letter). Answers come from your library with tappable citations." });
    const log = el("div", { class: "ask-log" });
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
    card.append(q, status, answer, sources, tools);
    log.prepend(card);
    try {
      const passages = await retrieve(text, mode, status);
      lastPassages = passages;
      if (!passages.length) status.textContent = "Nothing in the library matched the searches; answering from the request alone.";
      else status.textContent = `${passages.length} passages found. Writing…`;
      const reply = await answerWith(text, mode, passages, answer);
      thread.push({ role: "user", content: text }, { role: "assistant", content: reply });
      if (thread.length > MAX_TURNS * 2) thread = thread.slice(-MAX_TURNS * 2);
      status.remove();
      finish(answer, sources, tools, reply, passages);
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

  // ------------------------------------------------------------- retrieval --
  async function retrieve(text, mode, status) {
    const api = GL().api;
    let plan = { queries: [], references: [] };
    if (settings.planner) {
      try { plan = await planQueries(text); } catch (err) { console.warn("planner failed, using the request itself", err); }
    }
    if (!plan.queries.length) plan.queries = fallbackQueries(text);
    status.textContent = `Searching the library (${plan.queries.length} searches)…`;

    const seen = new Map();
    const add = (hit, weight) => {
      const key = hit.paragraph_id || `${hit.doc_id}:${hit.pid}`;
      const prev = seen.get(key);
      if (prev) prev.score += weight; else seen.set(key, { hit, score: weight });
    };
    for (const [i, q] of plan.queries.entries()) {
      try {
        const r = await api("search", { q: q.q, scope: q.scope && q.scope !== "all" ? q.scope : null, limit: 10 });
        r.hits.forEach((h, rank) => add(h, (1 / (rank + 3)) * (i === 0 ? 1.2 : 1)));
      } catch (_) { /* a bad query is skipped */ }
    }
    for (const ref of plan.references || []) {
      try {
        const r = await api("search", { q: ref, limit: 1 });
        if (r.jump?.doc_id && r.jump.pid) add({ doc_id: r.jump.doc_id, pid: r.jump.pid, kind: "verse", citation: r.jump.label, collection: "scriptures" }, 2);
      } catch (_) {}
    }
    const ranked = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, MAX_PASSAGES);
    const passages = [];
    for (const { hit } of ranked) {
      try {
        const ctx = await api("context", { doc_id: hit.doc_id, pid: hit.pid, before: hit.kind === "verse" ? 1 : 0, after: hit.kind === "verse" ? 1 : 0 });
        if (!ctx || !ctx.paragraphs.length) continue;
        const body = ctx.paragraphs.map((p) => (p.kind === "verse" && p.verse ? `${p.verse} ${p.text}` : p.text)).join(" ");
        const verses = ctx.paragraphs.filter((p) => p.kind === "verse" && p.verse).map((p) => ({ n: p.verse, text: p.text }));
        passages.push({ n: passages.length + 1, doc_id: hit.doc_id, pid: hit.pid, citation: ctx.citation, label: sourceLabel(ctx), text: body.slice(0, 1600), kind: hit.kind,
          verses: verses.length ? verses : null, plain: ctx.paragraphs.map((p) => p.text).join(" "), author: ctx.author, title: ctx.title, collection: ctx.collection, conf: ctx.label });
      } catch (_) {}
    }
    return passages;
  }

  function sourceLabel(d) {
    if (d.collection === "general-conference") return [d.author, `“${d.title}”`, d.label].filter(Boolean).join(", ");
    if (d.collection === "scriptures") return d.citation;
    return [d.title, d.label].filter(Boolean).join(", ");
  }

  function fallbackQueries(text) {
    const words = text.replace(/[^\p{L}\p{N}\s'’-]/gu, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w.toLowerCase()));
    const uniq = [...new Set(words.map((w) => w.toLowerCase()))].slice(0, 8);
    const qs = [];
    if (uniq.length) qs.push({ q: uniq.join(" OR "), scope: "all" });
    if (uniq.length > 1) qs.push({ q: uniq.slice(0, 3).join(" "), scope: "all" });
    return qs;
  }
  const STOP = new Set("what when where which who whom whose about does have has had been being this that these those with from into onto over under than then them they their there here were will would could should shall might must very much more most some such only also just like give gives said says talk talks write draft lesson training minute minutes please make find show tell want need".split(" "));

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

  // ---------------------------------------------------------------- answer --
  async function answerWith(text, mode, passages, answerEl) {
    const block = passages.map((p) => `[${p.n}] ${p.label}\n${p.text}`).join("\n\n");
    const user = `${mode === "draft" ? "Request" : "Question"}: ${text}\n\nPassages from the library:\n\n${block || "(none found)"}`;
    const messages = [...thread.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: user }];
    let buffer = "";
    let pending = false;
    const flush = () => { pending = false; answerEl.innerHTML = markdown(buffer, passages); };
    const reply = await complete({
      model: settings.model, system: mode === "draft" ? SYSTEM_DRAFT : SYSTEM_ASK, messages,
      max_tokens: mode === "draft" ? 3000 : 1200, stream: true,
      onDelta: (t) => { buffer += t; if (!pending) { pending = true; requestAnimationFrame(flush); } },
    });
    buffer = reply;
    flush();
    return reply;
  }

  function finish(answerEl, sourcesEl, toolsEl, reply, passages) {
    const cited = [...new Set([...reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].map((n) => passages.find((p) => p.n === n)).filter(Boolean);
    if (cited.length) {
      sourcesEl.append(el("div", { class: "group-title", text: "Sources" }));
      for (const p of cited) {
        sourcesEl.append(el("button", { type: "button", class: "src", onclick: () => GL().openDoc(p.doc_id, p.pid) }, [
          el("b", { text: `${p.n}` }), el("span", { text: ` ${p.label}` }),
        ]));
      }
      toolsEl.append(el("button", { type: "button", class: "text-btn", text: "Present these passages", onclick: () => GL().startPresentingUnits(cited.map((p) => ({ text: p.text.replace(/^\d+ /, ""), where: p.citation || p.label, kind: p.kind === "verse" ? "verse" : "para", doc_id: p.doc_id }))) }));
      toolsEl.append(el("button", { type: "button", class: "text-btn", text: "Add to deck", onclick: (e) => {
        for (const p of cited) window.Deck?.addPassage({ doc_id: p.doc_id, pid: p.pid, kind: p.kind, text: p.plain || p.text, verses: p.verses, citation: p.citation, label: p.conf || p.label, author: p.author, title: p.title, collection: p.collection });
        GL().toast(`Added ${cited.length} passages to the deck.`);
        e.currentTarget.disabled = true;
      } }));
    }
    toolsEl.append(el("button", { type: "button", class: "text-btn", text: "Copy", onclick: () => navigator.clipboard?.writeText(plainText(reply, passages)).catch(() => {}) }));
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
      return p ? `<button type="button" class="cite" data-doc="${p.doc_id}" data-pid="${esc(p.pid || "")}" title="${esc(p.label)}">${n}</button>` : `[${n}]`;
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

  document.addEventListener("click", (e) => {
    const c = e.target.closest("button.cite");
    if (c) GL().openDoc(Number(c.dataset.doc), c.dataset.pid || null);
  });

  // ------------------------------------------------------------ transport --
  async function complete({ model, system, messages, max_tokens, stream, onDelta }) {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.key,
        "anthropic-version": API_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, system, messages, max_tokens, stream: !!stream }),
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json())?.error?.message || ""; } catch (_) {}
      throw new Error(`${r.status} ${detail}`.trim());
    }
    if (!stream) {
      const data = await r.json();
      return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "", text = "";
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
        if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") { text += evt.delta.text; onDelta && onDelta(evt.delta.text); }
        else if (evt.type === "error") throw new Error(evt.error?.message || "stream error");
      }
    }
    return text;
  }

  window.Ask = { render, settings };
})();
