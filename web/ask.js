/* Ask: Claude on top of the library.
   Retrieval happens on this device (the library's own full-text index); only
   the question and the passages it turns up go to Claude, using the person's
   own API key, which is stored here and sent nowhere but api.anthropic.com. */
import { markdown as renderMarkdown, unverifiedQuotes } from "./lib/markdown.js";
import { shortCitation, chapterOf } from "./lib/cite.js";

(() => {
  "use strict";

  const API_URL = "https://api.anthropic.com/v1/messages";
  const API_VERSION = "2023-06-01";
  const MODELS = [
    ["claude-fable-5-1", "Fable 5.1 (the newest and most capable; the model behind Claude's own chat)"],
    ["claude-opus-5-5", "Opus 5.5 (deep, slower, costs more)"],
    ["claude-sonnet-5-5", "Sonnet 5.5 (quick and good; the default)"],
    ["claude-haiku-5-5", "Haiku 5.5 (fastest, cheapest)"],
  ];
  const DEFAULT_MODEL = "claude-sonnet-5-5";
  const PLANNER_MODEL = "claude-haiku-5-5";
  const MAX_PASSAGES = 22;
  const MAX_TURNS = 8;

  const LIBRARY = `The library holds: the standard works (KJV Old and New Testament, Book of Mormon, Doctrine and Covenants, Pearl of Great Price, with footnotes), every general conference talk from 1971 to today, Preach My Gospel (2023), Missionary Standards for Disciples of Jesus Christ (the booklet, its supplement, and the service missionary edition), Come, Follow Me, the General Handbook, and the study helps (Topical Guide, Bible Dictionary, Guide to the Scriptures); and under every verse of the Bible, the Hebrew and Greek text word by word (STEP Bible data: the Leningrad Codex, and the Greek of NA28 together with the Textus Receptus behind the KJV), each word with its transliteration, gloss, Strong's number and grammar, with the lexicon behind the numbers; and the Joseph Smith Papers as the nightly builds bring them in (scope jsp): the journals, the revelations and translations, the histories, and the documents, each with its editors' source note and historical introduction and footnotes. It is searched with the tools below. Think with everything you know: the scriptures in their original languages, Church history, doctrine, the way these teachings fit together, and good judgment. The library is where the words come from: quote only passages the tools returned, and let them settle what a source actually says. When something you know is not among the passages found, say so plainly rather than quoting it from memory.`;

  const TOOLS_GUIDE = `Tools:
- search: ranked full-text search (SQLite FTS5 with stemming). Use distinctive words; put exact phrases in double quotes; separate true synonyms with OR; scope narrows to scriptures, conference, pmg, standards (Missionary Standards), handbook, cfm, helps, or jsp (the Joseph Smith Papers); speaker and years narrow conference talks; edition and exclude_edition keep to, or keep out, one edition or volume by words in its title.
- find_all: every passage in a scope that contains a word family (prefix-matched) or an exact phrase, in reading order, with the total and a count per chapter or talk. Scope is scriptures, ot, nt, bofm, dc, pgp, pmg, standards, conference, handbook, cfm, helps, jsp, or all; edition and exclude_edition as above.

Editions. Some shelves hold several editions or volumes, and every passage's label names the one it is from: the Missionary Standards shelf holds the booklet for full-time missionaries ("Missionary Standards for Disciples of Jesus Christ"), its supplement, and the service missionary edition (its title says "Service Missionaries"); Come, Follow Me has a volume per year; the study helps are the Topical Guide, the Bible Dictionary and the Guide to the Scriptures. When the person includes or excludes one, search with edition or exclude_edition, and before writing check the label of every passage you use against what was asked. A passage from an excluded edition is never quoted, cited, or summarized, not even to say it was set aside.
- read: a passage in context (the paragraphs around a verse or paragraph you have already seen), or a whole chapter or talk by reference ("Alma 32", "D&C 76", "3 Nephi 11", a talk title).
- original: the Hebrew or Greek of a Bible verse or short passage, word by word, each word with its transliteration, English gloss, Strong's number and grammar, beside the KJV. Use it whenever a question turns on what a word means, how a verse is built, or which word the KJV rendered; Psalm titles are verse 0.
- lexicon: a Strong's number's dictionary entry (lemma, gloss, definition), the senses the data tells apart, how often it occurs and in which books, with its first occurrences and the KJV's verses. For the meaning of a word across the Bible, not just in one verse. The search tool also takes Hebrew or Greek letters, a Strong's number ("H2617", "G26") or "translit: chesed", and returns every verse with that word.

How to search. Work the way a careful researcher works in a library, not the way a search box works:
1. Decide what a complete answer needs before the first search: a list (then every item), a doctrine (then the defining passages and what the prophets have taught about them), a quotation (then the exact words and their setting), a comparison (then both sides in their own words).
2. Search more than once, with different vocabulary: the scriptural wording and the modern wording ("endure to the end" and "perseverance"; "Holy Ghost", "Holy Spirit", "Spirit of God", "the Comforter"), the phrase and the word family, and each scope in turn when the question spans scripture, conference, and the manuals. One search is never enough. A substantive question takes six to twelve tool calls; the limit is fourteen, so spend them on different wordings, not repeats.
3. For anything meant to be complete ("all", "every", "each time", "how many"), use find_all once per wording and per scope, and count. Never estimate a list from a ranked sample.
4. Read before you quote. When a passage will be quoted or interpreted, read it in context so the meaning is the author's and not the snippet's: the verses around it, the paragraphs around a line of a talk, the heading of the chapter.
5. Follow the thread. A passage that names another, a scripture a speaker quotes, a doctrine a verse assumes, is a lead; look it up.
6. Prefer the primary source: for what a prophet said, his own talk and not a manual's summary; for doctrine, the scripture first, then the prophets' teaching about it; for what a Bible word means, the Hebrew or Greek itself (original, then lexicon) before the Bible Dictionary.
7. Check your memory against the library. If you recall a passage the tools have not returned, search for it before using it; if it is not there, say so rather than quoting it.
8. Stop when further searches return nothing new, then write. Before writing, read the question once more for its conditions (what to include, what to exclude, "exact quotes", "all", a scope, a speaker, a date) and check the answer against each one; then make sure every quotation you will use is on the list of passages returned, word for word.

Every passage a tool returns carries a number like [12]; cite with those numbers and only those.`;

  const SYSTEM_ASK = `You are Claude, studying inside a personal library that belongs to an experienced Latter-day Saint leader (a mission president); speak to him as a peer and bring your full understanding to the question, the way you would in an ordinary conversation, with the library as your source of quotations. ${LIBRARY}

${TOOLS_GUIDE}

Writing the answer: open with the answer, not a restatement of the question. Reason in the open where it helps: connections between passages, what a prophet was responding to, where the texts are in tension. When a question turns on what a word or verse means, start from the original-language text (Hebrew, Greek, Aramaic) and the KJV rendering, then bring in the Restoration scriptures and the prophets. Quotation marks are a promise: anything inside them must be word for word from a passage the tools returned in this conversation, followed by its [n]. Never quote from memory, never smooth or modernize the wording, never run two verses together as one quotation. If you want to bring in a passage that has not been returned, search for it first; if it cannot be found, name it without quotation marks and say it was not in the library. Cite every claim a passage supports with [n]. For a list, give every item, grouped by volume or book in canonical order, each with its reference and the exact text or the key clause; do not summarize a list the person asked for in full. Plain prose, short paragraphs, headings only when the answer is long, no bullet lists of one-line fragments, no em dashes. When the library does not settle the question, say so in a sentence and give your own best judgment, marked as such.`;

  const SYSTEM_DRAFT = `You are Claude, composing talks, lessons, trainings, letters and outlines for an experienced Latter-day Saint leader (a mission president), with the library as your source of quotations. ${LIBRARY}

${TOOLS_GUIDE}

Build the piece from passages the tools returned. Quotation marks are a promise: anything inside them must be word for word from a passage the tools returned, followed by its [n]; never quote from memory or smooth the wording, and search first for any passage you want to use. Cite every paraphrase as [n] too. Follow the requested form and length closely. Voice: warm, direct, doctrinally careful, concrete. No em dashes. No filler openings. Headings only when the form calls for them (an outline, a lesson plan). If the passages are thin for part of the request, write that part briefly and say which searches would strengthen it.`;

  // Think it through: the page being read (or the search being looked at) handed over whole,
  // so Claude can study it and go looking for what connects to it.
  const SYSTEM_THINK = `You are Claude, thinking a page through beside an experienced Latter-day Saint leader (a mission president) who is preparing to teach from it. He is reading the page given below: a chapter of scripture, a Come, Follow Me lesson, a conference talk, a manual page, or a page of the Joseph Smith Papers, and he may have selected some verses or paragraphs in it. ${LIBRARY}

${TOOLS_GUIDE}

Study the page the way a careful teacher would: what it teaches in its own words, what it assumes, where it is going. Then go looking, with the tools, for what connects to it across the library: the scriptures it quotes or echoes, the talks that expound it, Preach My Gospel or the handbook where it bears on missionary work, the Hebrew or Greek behind a key word when it is a Bible chapter (use original, then lexicon), and the Joseph Smith Papers when they bear on it (scope jsp). Six to ten tool calls is about right. If a deck in progress is described, favor connections that build on it.

Write the answer under exactly these headings, in this order, with nothing before the first:

## What this page teaches
Two or three sentences. The doctrine, in plain words, as the page itself puts it. If verses or paragraphs were selected, this is about them first.

## Connections
Five to eight passages from across the library, strongest first, one line each: the [n] number, then why it connects (the shared word, the promise and its keeping, the doctrine this page assumes, the example that shows it). Mix the sources: at least one general conference talk and at least one other scripture, and the Papers when they bear on it. Only passages the tools returned, cited by their numbers.

## In the original
Only for a Bible chapter: one or two words worth knowing, each with the Hebrew or Greek word, its transliteration, what it means here, and where else it appears. Leave this heading out for any other page.

## Questions
Three or four questions a teacher could ask a zone or a class, each one the page itself answers.

## For the deck
One line: a title for a deck section built from this page (six words at most, in quotation marks), then the [n] numbers of the connections to put on it, in teaching order.

Plain, warm, doctrinally precise prose; no em dashes; no preamble, no closing remarks. Quotation marks are a promise: anything inside them is word for word from a passage the tools returned.`;

  const TOOLS = [
    { name: "search", description: "Ranked full-text search of the whole library. Returns the best passages with their numbers for citing.",
      input_schema: { type: "object", properties: {
        query: { type: "string", description: "Words to search. Exact phrases in double quotes. OR between true synonyms." },
        scope: { type: "string", enum: ["all", "scriptures", "conference", "pmg", "standards", "handbook", "cfm", "helps", "jsp"], description: "Where to look. Default all. jsp is the Joseph Smith Papers." },
        speaker: { type: "string", description: "Surname of a conference speaker, to limit to their talks." },
        year_from: { type: "integer" }, year_to: { type: "integer" },
        edition: { type: "string", description: "Only the edition or volume whose title contains these words, e.g. 'Service Missionaries', 'Supplement', 'Old Testament 2026', 'Topical Guide'." },
        exclude_edition: { type: "string", description: "Leave out the edition or volume whose title contains these words." },
        limit: { type: "integer", description: "How many passages, 5 to 30. Default 12." },
      }, required: ["query"] } },
    { name: "find_all", description: "Every passage in a scope containing a word family or an exact phrase, in reading order, with the total and counts per chapter or talk. For complete lists.",
      input_schema: { type: "object", properties: {
        words: { type: "string", description: "A word family, space-separated, each prefix-matched: 'redeem redeemed redemption redeemer'. Use this or phrase." },
        phrase: { type: "string", description: "An exact phrase, words in order: 'Holy Ghost', 'Spirit of God'." },
        scope: { type: "string", enum: ["all", "scriptures", "ot", "nt", "bofm", "dc", "pgp", "pmg", "standards", "conference", "handbook", "cfm", "helps", "jsp"], description: "Where to look. Default all. jsp is the Joseph Smith Papers." },
        edition: { type: "string", description: "Only the edition or volume whose title contains these words." },
        exclude_edition: { type: "string", description: "Leave out the edition or volume whose title contains these words." },
        limit: { type: "integer", description: "Up to 600. Default 400." },
      } } },
    { name: "read", description: "Read in context: either the paragraphs around a passage you have (by its number), or a chapter or talk by reference.",
      input_schema: { type: "object", properties: {
        passage: { type: "integer", description: "The [n] of a passage already returned." },
        reference: { type: "string", description: "A chapter or verse reference such as 'Alma 32' or 'D&C 76:22-24', or a talk title." },
        before: { type: "integer", description: "Paragraphs before, default 2" }, after: { type: "integer", description: "Paragraphs after, default 2" },
      } } },
    { name: "original", description: "The Hebrew or Greek text of a Bible verse or short passage, word by word: each word with its transliteration, English gloss, Strong's number and grammar, beside the KJV's verse.",
      input_schema: { type: "object", properties: {
        reference: { type: "string", description: "A verse or range within one chapter: 'Genesis 1:1', 'John 1:1-5', 'Isaiah 53:4-6', 'Psalm 23'. Psalm titles are verse 0." },
      }, required: ["reference"] } },
    { name: "lexicon", description: "A Strong's number's lexicon entry: lemma, transliteration, gloss, definition, the senses told apart, how often it occurs and in which books, with its first occurrences in the KJV.",
      input_schema: { type: "object", properties: {
        strongs: { type: "string", description: "A Strong's number such as H2617, G26 or H7307G (a letter suffix picks one sense)." },
        limit: { type: "integer", description: "How many occurrences to list, default 40, up to 200." },
      }, required: ["strongs"] } },
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
    get model() { const m = store.get("askModel", DEFAULT_MODEL); return MODELS.some(([id]) => id === m) ? m : DEFAULT_MODEL; },
    set model(v) { store.set("askModel", v); },
    get think() { return store.get("askThink", true); },
    set think(v) { store.set("askThink", !!v); },
    get planner() { return store.get("askPlanner", true); },
    set planner(v) { store.set("askPlanner", !!v); },
  };

  // --------------------------------------------------------------- render --
  let handed = null;  // a question typed on the home screen, asked as soon as the tab can
  let handedPage = null; // a page to think through, from the floating button
  function render(container, { question = null, think = null } = {}) {
    view = container;
    container.replaceChildren();
    if (question) handed = question;
    if (think) handedPage = think;
    if (!settings.key) { renderKeySetup(container); return; }
    const box = el("div", { class: "ask" });
    const modes = el("div", { class: "seg ask-mode" }, [
      el("button", { type: "button", "data-mode": "ask", class: "on", text: "Ask" }),
      el("button", { type: "button", "data-mode": "draft", text: "Draft" }),
      ...modeSkills().map((k) => el("button", { type: "button", "data-mode": `skill:${k.id}`, text: k.name, title: k.description || "" })),
    ]);
    const input = el("textarea", { class: "ask-input", rows: 3, placeholder: "What have the prophets said about covenants and identity?", "aria-label": "Your question or request" });
    const go = el("button", { type: "button", class: "primary ask-go", text: "Ask" });
    const gear = el("button", { type: "button", class: "icon-btn", "aria-label": "Settings", title: "Settings", html: "&#9881;" });
    const modelName = MODELS.find(([id]) => id === settings.model)?.[1].split(" (")[0] || settings.model;
    const hint = el("div", { class: "ask-hint", text: `Ask a question, or switch to Draft and describe what to write (a talk, a lesson, a training, a letter). ${modelName}${settings.think ? ", thinking first," : ""} searches your library the way a researcher would, several searches deep; every passage it finds becomes a card you can tick onto the deck.` + (GL().skills?.voice ? " Drafts are written in your voice." : "") });
    if (!log) log = el("div", { class: "ask-log" });
    for (const b of modes.querySelectorAll("button")) {
      b.addEventListener("click", () => {
        for (const x of modes.querySelectorAll("button")) x.classList.toggle("on", x === b);
        const m = b.dataset.mode;
        const k = m.startsWith("skill:") ? modeSkills().find((x) => `skill:${x.id}` === m) : null;
        go.textContent = m === "ask" ? "Ask" : k ? "Write" : "Draft";
        input.placeholder = k ? (k.placeholder || `What to write: ${k.description || k.name}`) : m === "draft" ? "A 10-minute zone conference training on obedience, with four scriptures and two conference quotes" : "What have the prophets said about covenants and identity?";
      });
    }
    window.addEventListener("skills:change", () => { if (view === container && container.isConnected) render(container); }, { once: true });
    go.addEventListener("click", () => submit(input, modes, log));
    input.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); submit(input, modes, log); } });
    gear.addEventListener("click", () => renderSettings(container));
    box.append(el("div", { class: "ask-top" }, [modes, gear]), input, el("div", { class: "ask-actions" }, [go, el("button", { type: "button", class: "text-btn", text: "New thread", onclick: () => { thread = []; log.replaceChildren(); } })]), hint, log);
    container.append(box);
    if (handed) { input.value = handed; handed = null; submit(input, modes, log); return; }
    if (handedPage) { const page = handedPage; handedPage = null; submit(input, modes, log, page); return; }
    if (GL().wide) input.focus();
  }

  // The floating button's work: the page (or the search) as Claude will see it.
  // {doc, selection} for a page; {query, hits} for a search.
  function subjectFor({ doc = null, selection = [], marks = [], query = null, hits = [] } = {}) {
    if (doc) {
      const label = doc.collection === "general-conference" ? `${doc.title} (${[doc.author, doc.label].filter(Boolean).join(", ")})` : doc.citation || doc.title;
      const plain = el("div", { html: doc.body_html || "" });
      for (const junk of plain.querySelectorAll("sup.marker, .page-break, .notes, .note-mark, script, style")) junk.remove();
      let body = plain.textContent.replace(/\s+/g, " ").trim();
      if (body.length > 24000) body = body.slice(0, 24000) + " …(the page continues)";
      const sel = selection.length ? "\n\nHe has selected these, so think about them first:\n" + selection.map((u) => `${u.verse ? `${u.verse} ` : ""}${u.text}`).join("\n") : "";
      const marked = marks.filter((m) => m.color || m.note);
      const his = marked.length ? "\n\nHis own marks on this page (earlier study; build on them, and answer his notes where they ask something):\n" + marked.map((m) => `${m.verse ? `${m.verse} ` : ""}${m.color ? `[highlighted] ` : ""}${(m.text || "").slice(0, 200)}${m.note ? `\n  His note: ${m.note}` : ""}`).join("\n") : "";
      const deck = deckHint();
      return { label, content: `The page: ${label}${doc.author && doc.collection !== "general-conference" ? `, ${doc.author}` : ""}${doc.collection ? ` (${doc.collection_title || doc.collection})` : ""}.\n\n${body}${sel}${his}${deck}` };
    }
    const label = `the search “${query}”`;
    const top = hits.slice(0, 8).map((h) => `${h.citation}: ${(h.text || "").replace(/\s+/g, " ").slice(0, 300)}`).join("\n");
    return { label, content: `He searched the library for: ${query}\n\nThe best passages the search found:\n${top}${deckHint()}\n\nThink through what he is likely looking for and what connects to it; the "page" here is the search and its best passages.` };
  }
  function deckHint() {
    const d = window.Deck?.state;
    const items = (d?.items || []).filter((i) => i.type === "passage");
    if (!items.length) return "";
    return `\n\nThe deck in progress${d.title ? ` (“${d.title}”)` : ""} already has: ${items.slice(0, 12).map((i) => i.citation).join("; ")}${items.length > 12 ? "; and more" : ""}.`;
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
    const think = el("input", { type: "checkbox", checked: settings.think });
    const key = el("input", { type: "password", value: settings.key, autocomplete: "off", "aria-label": "API key" });
    box.append(
      el("h2", { text: "Ask settings" }),
      el("label", {}, ["Model for answers", model]),
      el("label", { class: "row-check" }, [think, " Let it think before it answers (you see the thinking as it goes; slower, uses more tokens)"]),
      el("label", { class: "row-check" }, [planner, " When you press Return in the search box, let Claude propose a few more searches and add what they find (one quick, cheap call)"]),
      el("label", {}, ["API key", key]),
      el("div", { class: "ask-actions" }, [
        el("button", { type: "button", class: "primary", text: "Save", onclick: () => { settings.model = model.value; settings.planner = planner.checked; settings.think = think.checked; settings.key = key.value.trim(); render(container); } }),
        el("button", { type: "button", class: "text-btn", text: "Cancel", onclick: () => render(container) }),
        el("button", { type: "button", class: "text-btn danger", text: "Remove key from this device", onclick: () => { settings.key = ""; thread = []; render(container); } }),
      ]),
    );
    container.replaceChildren(box);
  }

  // --------------------------------------------------------------- submit --
  // subject: for "think it through", {label, content, deckHint}: the page as the card's title line, the text sent to Claude
  async function submit(input, modes, log, subject = null) {
    const text = subject ? subject.content : input.value.trim();
    if (!text || busy) return;
    const mode = subject ? "think" : modes.querySelector("button.on")?.dataset.mode || "ask";
    if (!navigator.onLine) { log.prepend(el("div", { class: "status error", text: "Ask needs an internet connection. Search and reading work offline." })); return; }
    // A deck in progress: ask what this question should do with it first (thinking a page through builds on it)
    if (!subject && window.Deck?.shouldAsk()) {
      const choice = await window.Deck.askAboutDeck({ kind: mode === "ask" ? "question" : "request" });
      if (choice === "cancel" || busy) return;
    }
    busy = true;
    if (!subject) input.value = "";
    const card = el("article", { class: "ask-card" + (subject ? " think-card" : "") });
    const q = el("div", { class: "ask-q", text: subject ? `Thinking it through: ${subject.label}` : text });
    const status = el("div", { class: "ask-status", text: subject ? `${modelName()} is reading the page…` : "Planning searches…" });
    const answer = el("div", { class: "ask-a" });
    const sources = el("div", { class: "ask-sources" });
    const tools = el("div", { class: "ask-tools" });
    const inline = el("div", { class: "ask-findings-inline" });
    // The passages first, the answer under them.
    card.append(q, status, inline, answer, sources, tools);
    log.prepend(card);
    try {
      const registry = new Registry();
      const findings = new Findings(registry.list, subject ? subject.label : text);
      findings.mount(inline);
      if (!subject) {
        // A head start: what the library's own search finds, before Claude asks for anything.
        status.textContent = "Searching the library…";
        const head = await registry.search({ query: text, limit: 10 });
        findings.refresh();
        status.textContent = head.length ? `${head.length} passages to start. Claude is searching further…` : "Claude is searching…";
      }
      const trail = [];
      const reply = await agent(text, mode, registry, findings, status, answer, trail);
      lastPassages = registry.list;
      if (!subject) {
        thread.push({ role: "user", content: text }, { role: "assistant", content: reply });
        if (thread.length > MAX_TURNS * 2) thread = thread.slice(-MAX_TURNS * 2);
      } else {
        // the page is now part of the conversation, so a follow-up question can refer to it
        thread.push({ role: "user", content: `(I thought this page through with you: ${subject.label}.)` }, { role: "assistant", content: reply });
        if (thread.length > MAX_TURNS * 2) thread = thread.slice(-MAX_TURNS * 2);
      }
      status.remove();
      finish(answer, sources, tools, reply, registry.list, input, modes, log, trail);
      findings.setCited([...new Set([...reply.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))]);
      if (subject) offerSection(tools, reply, registry.list, findings);
    } catch (err) {
      status.textContent = "";
      status.classList.add("error");
      status.textContent = friendlyError(err);
    } finally {
      busy = false;
    }
  }

  // "For the deck" names a section and the passages for it; one tap builds it.
  function offerSection(toolsEl, reply, passages, findings) {
    const m = String(reply).match(/##\s*For the deck\s*\n([\s\S]*?)(?:\n##|$)/i);
    if (!m) return;
    const line = m[1].trim();
    const title = (line.match(/[“"]([^”"]{2,80})[”"]/) || [])[1] || "";
    const nums = [...new Set([...line.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1])))].filter((n) => passages[n - 1]);
    if (!nums.length || !window.Deck) return;
    const btn = el("button", { type: "button", class: "primary small", text: `Put ${nums.length === 1 ? "it" : `these ${nums.length}`} on the deck${title ? ` as “${title}”` : ""}`, onclick: () => {
      if (title) window.Deck.addSection(title);
      let added = 0;
      for (const n of nums) { const p = passages[n - 1]; if (p && !window.Deck.has(p.doc_id, p.pid)) { window.Deck.addPassage(findings.forDeck(p)); added++; } }
      findings.sync();
      btn.textContent = added ? `On the deck${title ? ` under “${title}”` : ""}` : "Already on the deck";
      btn.disabled = true;
      GL().toast(added ? `${added} ${added === 1 ? "passage" : "passages"} on the deck.` : "Already on the deck.");
      if (GL().wide) window.Deck.showBoard();
    } });
    toolsEl.prepend(btn);
  }

  function friendlyError(err) {
    const m = String(err?.message || err);
    if (/401|authentication|invalid x-api-key/i.test(m)) return "The API key was not accepted. Check it in settings (the gear).";
    if (/429|rate/i.test(m)) return "Claude is rate-limited right now; try again in a moment.";
    if (/402|credit|billing/i.test(m)) return "The Claude account has no credit. Add a payment method at console.anthropic.com.";
    if (err?.name === "TimeoutError") return m;
    if (/Failed to fetch|NetworkError|load failed/i.test(m)) return "Could not reach Claude. Check the connection.";
    return `Something went wrong: ${m}`;
  }

  // The search box uses this to widen a question with a few more queries.
  // With the setting off it asks Claude nothing and proposes nothing.
  async function planQueries(text) {
    if (!settings.planner) return { queries: [], references: [] };
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
    async search({ query, scope = "all", speaker, year_from, year_to, edition, exclude_edition, limit = 12 }) {
      const api = GL().api;
      const r = await api("search", { q: query, scope: scope && scope !== "all" ? scope : null, limit: Math.max(5, Math.min(30, limit || 12)), speaker: speaker || null, from: year_from || null, to: year_to || null, edition: edition || null, exclude_edition: exclude_edition || null });
      const out = [];
      for (const h of r.hits) {
        if (!h.doc_id || !h.pid) continue;
        const p = await this.fromHit(h, { before: h.kind === "verse" && !r.original ? 1 : 0, after: h.kind === "verse" && !r.original ? 1 : 0 });
        if (!p) continue;
        // a Hebrew, Greek or Strong's search: say which word in the verse answered
        if (r.original && h.words && h.words.length) p.original = h.words.map((w) => `${w.word} ${w.translit || ""} [${(w.gloss || "").replace(/\s+/g, " ").trim()}] ${w.strongs || ""}`.trim()).join("; ");
        out.push(p);
      }
      if (r.jump?.doc_id && r.jump.pid) {
        const p = await this.fromHit({ doc_id: r.jump.doc_id, pid: r.jump.pid, kind: "verse" }, { before: 0, after: r.jump.verse_end ? Math.max(0, r.jump.verse_end - parseInt(r.jump.pid.slice(1), 10)) : 0 });
        if (p) out.unshift(p);
      }
      if (r.original) {
        const o = r.original;
        const lex = o.lexicon ? `${o.lexicon.lemma} ${o.lexicon.translit || ""}, "${o.lexicon.gloss || ""}", Strong's ${o.lexicon.strongs}` : (o.tokens || []).join(" ");
        out.note = `${o.language} search: ${lex}. ${o.total.toLocaleString()} ${o.total === 1 ? "verse" : "verses"} in all${out.length < o.total ? `; the first ${out.length} follow (raise limit, or narrow with scope ot/nt, for more)` : ""}.${o.all_forms && o.all_forms > o.total ? ` Every form of ${o.strongs} occurs in ${o.all_forms.toLocaleString()} verses: search "${o.strongs}" for all of them.` : ""} Each passage's line names the word that answered.`;
      }
      return out;
    }
    async matches({ words, phrase, scope = "all", limit = 400, edition, exclude_edition }) {
      const r = await GL().api("matches", { words, phrase, scope, limit, edition: edition || null, exclude_edition: exclude_edition || null });
      const out = (r.passages || []).map((v) => this.add({ doc_id: v.doc_id, pid: v.pid, kind: v.kind, citation: v.citation, label: v.collection === "scriptures" ? v.citation : sourceLabel({ ...v, citation: v.citation }), text: v.text, plain: v.text,
        verses: v.kind === "verse" && v.verse ? [{ n: v.verse, text: v.text }] : null, author: v.author, title: v.title, collection: v.collection, conf: v.label, volume: v.volume }));
      return { total: r.total, out, query: r.query, error: r.error, by_document: r.by_document || [] };
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
          if (x.kind === "verse" || x.kind === "para") out.push(this.add({ doc_id: p.doc_id, pid: x.pid, kind: x.kind, citation: x.kind === "verse" && x.verse ? `${chapterOf(p.citation)}:${x.verse}` : p.citation, label: p.label, text: x.text, plain: x.text, verses: x.kind === "verse" && x.verse ? [{ n: x.verse, text: x.text }] : null, author: p.author, title: p.title, collection: p.collection, conf: p.conf }));
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
          out.push(this.add({ doc_id: doc.id, pid: n.id, kind: verse ? "verse" : "para", citation: verse ? `${chapterOf(doc.citation)}:${verse}` : doc.citation, label: doc.label, text: textU, plain: textU, verses: verse ? [{ n: verse, text: textU }] : null, author: doc.author, title: doc.title, collection: doc.collection, conf: doc.label }));
          if (out.length >= 80) break;
        }
        return { out, title: doc.title };
      }
      return { error: "give a passage number or a reference" };
    }
  }

  Registry.prototype.original = async function ({ reference }) {
    const api = GL().api;
    const r = await api("original", { chapter: reference, parse: true, max_words: 1500 });
    if (!r || !r.available) return { text: "The original-language text is not in this library yet (it arrives with the next nightly build).", verses: [] };
    if (r.error) return { text: `Error: ${r.error}`, verses: [] };
    if (!r.verses.length) return { text: `No Hebrew or Greek text for "${reference}". Give a Bible chapter or verse; the other standard works have no original-language text here.`, verses: [] };
    const lines = [`${r.book_name} ${r.chapter}, ${r.language}${r.truncated ? " (long chapter: the first verses only; ask for a verse range for the rest)" : ""}. Each word: the ${r.language} word, its transliteration, its gloss in [brackets], its Strong's number and grammar.`];
    for (const v of r.verses) {
      let cite = v.citation || `${r.book_name} ${r.chapter}:${v.verse}`;
      if (v.text && r.doc_id && v.pid) { const p = this.add({ doc_id: r.doc_id, pid: v.pid, kind: "verse", citation: cite, label: cite, text: v.text, plain: v.text, verses: [{ n: v.verse, text: v.text }], collection: "scriptures" }); cite = `[${p.n}] ${cite}`; }
      lines.push(`\n${cite}${v.text ? ` (KJV: ${v.text})` : v.verse === 0 ? " (the psalm's title)" : ""}`);
      lines.push(v.words.map((w, i) => `${i + 1}. ${w.word} ${w.translit || ""} [${(w.gloss || "").replace(/\s+/g, " ").trim()}] ${w.strongs || ""}${w.grammar ? ` ${w.grammar}` : w.morph ? ` ${w.morph}` : ""}${w.flags && /^[KkO(]/.test(w.flags) && !/[nN]/.test(w.flags) ? " {in the KJV's Greek, not NA28}" : w.flags && /[nN]/.test(w.flags) && !/[kK]/.test(w.flags) ? " {in NA28, not the KJV's Greek}" : /Q/.test(w.flags || "") ? " {qere}" : ""}`).join("\n"));
    }
    lines.push(`\n${r.credit}`);
    return { text: lines.join("\n"), verses: r.verses, language: r.language };
  };
  Registry.prototype.lexicon = async function ({ strongs, limit }) {
    const api = GL().api;
    const r = await api("lexicon", { strongs, limit: Math.max(1, Math.min(200, limit || 40)) });
    if (!r) return { text: `Nothing in the lexicon for "${strongs}". Strong's numbers look like H2617 or G26.` };
    const e = r.entry;
    const lines = [];
    if (e) lines.push(`${r.strongs} ${e.lemma} (${e.translit}), "${e.gloss}"${e.type ? `, ${e.type}` : ""}.${e.definition ? ` Definition: ${String(e.definition).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}` : ""}${e.relation ? ` (${e.relation})` : ""}`);
    else lines.push(`${r.strongs}: no dictionary entry, but the number is used in the text.`);
    if (r.senses && r.senses.length > 1) lines.push(`Senses told apart: ${r.senses.map((x) => `${x.strongs} "${x.gloss}"`).join("; ")}.`);
    lines.push(`Occurs ${r.count.toLocaleString()} times in ${r.verses_total.toLocaleString()} verses${r.books && r.books.length ? `: ${r.books.map((b) => `${b.name} ${b.n}`).join(", ")}` : ""}.`);
    if (r.glosses && r.glosses.length) lines.push(`Rendered in the gloss as: ${r.glosses.map((g) => `${g.gloss} (${g.n})`).join(", ")}.`);
    if (r.verses && r.verses.length) {
      lines.push(`\nOccurrences${r.verses.length < r.verses_total ? ` (the first ${r.verses.length})` : ""}, with the KJV's text:`);
      for (const v of r.verses) {
        let cite = v.citation;
        if (v.text && v.doc_id && v.pid) { const p = this.add({ doc_id: v.doc_id, pid: v.pid, kind: "verse", citation: cite, label: cite, text: v.text, plain: v.text, verses: [{ n: v.verse, text: v.text }], collection: "scriptures" }); cite = `[${p.n}] ${cite}`; }
        lines.push(`${cite}: ${v.words.map((w) => `${w.word} ${w.translit || ""} [${(w.gloss || "").trim()}]`).join("; ")}${v.text ? ` — ${v.text}` : ""}`);
      }
    }
    lines.push(`\n${r.credit}`);
    return { text: lines.join("\n"), count: r.count };
  };

  function sourceLabel(d) {
    if (d.collection === "general-conference") return [d.author, `“${d.title}”`, d.label].filter(Boolean).join(", ");
    if (d.collection === "scriptures") return d.citation;
    return [d.title, d.label].filter(Boolean).join(", ");
  }
  // The whole passage, never cut short: a truncated verse invites the model
  // to finish it from memory, and that is how a quotation goes wrong.
  function passageLine(p, max = 2400) {
    const t = p.verses && p.verses.length ? p.verses.map((v) => `${v.n} ${v.text}`).join(" ") : (p.plain || p.text);
    return `[${p.n}] ${p.label}${p.original ? ` · ${p.original}` : ""}\n${t.length > max ? t.slice(0, max) + " […]" : t}`;
  }

  // The owner's private skills (published sealed with the library, unlocked
  // on the device): a voice to write every draft in, a house style for
  // answers, and whole pieces to write (a weekly letter) as modes of their own.
  function modeSkills() { return (GL().skills?.skills || []).filter((k) => k && k.kind === "mode" && k.id && k.text); }
  function modeSkill(mode) { return mode.startsWith("skill:") ? modeSkills().find((k) => `skill:${k.id}` === mode) || null : null; }
  function systemFor(mode) {
    const sk = GL().skills || {};
    const blocks = [];
    if (mode === "ask") {
      blocks.push(SYSTEM_ASK);
      if (sk.style) blocks.push(`House style for answers, from the person you are writing for:\n\n${sk.style}`);
    } else if (mode === "think") {
      blocks.push(SYSTEM_THINK);
      if (sk.style) blocks.push(`House style for answers, from the person you are writing for:\n\n${sk.style}`);
    } else {
      blocks.push(SYSTEM_DRAFT);
      if (sk.voice) blocks.push(`The voice to write in. These rules were written by the person you write for, from his own edits; they outrank anything a draft could do:\n\n${sk.voice}`);
      const k = modeSkill(mode);
      if (k) blocks.push(`The piece to write, and how:\n\n${k.text}`);
    }
    // The last block carries the cache marker, so the tool loop and the next
    // question reuse the prompt instead of paying for it each turn.
    return blocks.map((text, i) => ({ type: "text", text, ...(i === blocks.length - 1 ? { cache_control: { type: "ephemeral" } } : {}) }));
  }
  // The week and date a weekly piece is for, from the skill's first week.
  function weekLine(k) {
    if (!k || !k.week1) return "";
    const today = new Date();
    const sunday = new Date(today); sunday.setDate(today.getDate() - today.getDay());
    const first = new Date(k.week1 + "T12:00:00");
    const n = Math.round((sunday - first) / (7 * 86400000)) + 1;
    const fmt = (d) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    return `Today is ${fmt(today)}. Unless the request says otherwise this is Week ${n}, dated Sunday ${fmt(sunday)}.`;
  }

  // ------------------------------------------------------------------ agent --
  // Claude searches the library with tools until it is ready to answer; the
  // final text streams into the answer box.
  async function agent(text, mode, registry, findings, statusEl, answerEl, trail = []) {
    const head = registry.list.map((p) => passageLine(p)).join("\n\n");
    const k = modeSkill(mode);
    const lead = [weekLine(k)].filter(Boolean).join(" ");
    const first = mode === "think"
      ? text
      : (lead ? lead + "\n\n" : "") + `${mode === "ask" ? "Question" : "Request"}: ${text}` + (head ? `\n\nPassages already found by a first search (cite by number; search for more as needed):\n\n${head}` : "");
    // thinking a page through starts fresh: the page is the whole context
    const messages = [...(mode === "think" ? [] : thread).map((m) => ({ role: m.role, content: m.content })), { role: "user", content: first }];
    let calls = 0, finalText = "";
    const ask = (tool_choice) => {
      let buffer = "", pending = false, thought = "";
      const flush = () => { pending = false; answerEl.innerHTML = markdown(buffer, registry.list); };
      return complete({
        // The tools list must be the same on every request of a turn: a thinking
        // block is bound to the tools it was made with, and a changed list is a 400.
        model: settings.model, system: systemFor(mode), messages, tools: TOOLS, tool_choice,
        max_tokens: mode === "ask" ? 16000 : 20000, stream: true, thinking: settings.think,
        onDelta: (t) => { buffer += t; if (!pending) { pending = true; requestAnimationFrame(flush); } },
        onThinking: (t) => { thought = (thought + t).slice(-2000); statusEl.textContent = `Thinking: ${thought.replace(/\s+/g, " ").trim().slice(-160)}`; },
      }).then((res) => { buffer = res.text; flush(); return res; });
    };
    for (let turn = 0; turn < MAX_TOOL_CALLS + 4; turn++) {
      const res = await ask();
      finalText = res.text;
      if (res.stop_reason !== "tool_use" || !res.tool_uses.length) break;
      // run the tools, show what is being searched, feed results back
      messages.push({ role: "assistant", content: res.blocks });
      const results = [];
      for (const tu of res.tool_uses) {
        if (calls >= MAX_TOOL_CALLS) {
          results.push({ type: "tool_result", tool_use_id: tu.id, content: "The search budget for this question is spent. Write the answer now from the passages already found, and do not call a tool again." });
          continue;
        }
        calls++;
        let content = "";
        const step = { tool: tu.name, what: "", found: null };
        trail.push(step);
        try {
          if (tu.name === "search") {
            step.what = `${tu.input.query}${tu.input.scope && tu.input.scope !== "all" ? ` (${tu.input.scope})` : ""}${tu.input.speaker ? `, ${tu.input.speaker}` : ""}${tu.input.year_from || tu.input.year_to ? `, ${tu.input.year_from || ""}–${tu.input.year_to || ""}` : ""}${tu.input.edition ? `, in “${tu.input.edition}”` : ""}${tu.input.exclude_edition ? `, not “${tu.input.exclude_edition}”` : ""}`;
            statusEl.textContent = `Searching: ${step.what}…`;
            const out = await registry.search(tu.input);
            step.found = out.length;
            content = out.length ? (out.note ? out.note + "\n\n" : "") + out.map((p) => passageLine(p)).join("\n\n") : (out.note ? out.note : "No passages matched. Try other words or a different scope.");
          } else if (tu.name === "find_all" || tu.name === "find_all_verses") {
            const what = tu.input.phrase ? `“${tu.input.phrase}”` : tu.input.words;
            step.what = `every passage with ${what}${tu.input.scope && tu.input.scope !== "all" ? ` in ${tu.input.scope}` : ""}`;
            statusEl.textContent = `Finding ${step.what}…`;
            step.what += `${tu.input.edition ? `, in “${tu.input.edition}”` : ""}${tu.input.exclude_edition ? `, not “${tu.input.exclude_edition}”` : ""}`;
            const r = await registry.matches({ words: tu.input.words, phrase: tu.input.phrase, scope: tu.input.scope || tu.input.volume || "all", limit: tu.input.limit, edition: tu.input.edition, exclude_edition: tu.input.exclude_edition });
            step.found = r.total;
            const where = r.by_document.map((d) => `${d.title}${d.book_title ? ` [${d.book_title}]` : d.volume ? ` (${d.volume})` : ""} ${d.n}`).join("; ");
            content = r.error ? `Error: ${r.error}` : `${r.total} passages match${where ? ` (${where})` : ""}${r.out.length < r.total ? `; showing the first ${r.out.length}. Narrow the scope or the wording for the rest.` : "."}\n\n` + r.out.map((p) => `[${p.n}] ${p.label}: ${p.text}`).join("\n");
          } else if (tu.name === "read") {
            step.what = `read ${tu.input.reference || `passage [${tu.input.passage}] in context`}`;
            statusEl.textContent = `Reading ${tu.input.reference || `passage ${tu.input.passage}`}…`;
            const r = await registry.read(tu.input);
            step.found = r.out ? r.out.length : null;
            content = r.error ? `Error: ${r.error}` : (r.title ? `${r.title}\n\n` : "") + r.out.map((p) => passageLine(p, 600)).join("\n\n");
          } else if (tu.name === "original") {
            step.what = `the original of ${tu.input.reference}`;
            statusEl.textContent = `Reading the Hebrew or Greek of ${tu.input.reference}…`;
            const r = await registry.original(tu.input);
            step.found = r.verses ? r.verses.length : null;
            if (r.language && step.what.startsWith("the original")) step.what = `the ${r.language} of ${tu.input.reference}`;
            content = r.text;
          } else if (tu.name === "lexicon") {
            step.what = `lexicon ${tu.input.strongs}`;
            statusEl.textContent = `Looking up ${tu.input.strongs}…`;
            const r = await registry.lexicon(tu.input);
            step.found = r.count ?? null;
            content = r.text;
          } else content = `Unknown tool ${tu.name}`;
        } catch (err) { content = `Error: ${err.message}`; }
        const cap = tu.name === "find_all" || tu.name === "find_all_verses" ? 170000 : 60000;
        if (content.length > cap) content = content.slice(0, cap) + "\n…(truncated; ask for one volume at a time to see the rest)";
        results.push({ type: "tool_result", tool_use_id: tu.id, content });
        findings.refresh();
      }
      if (calls >= MAX_TOOL_CALLS) results.push({ type: "text", text: "That was the last search available for this question; write the answer from what has been found." });
      messages.push({ role: "user", content: results });
      statusEl.textContent = `${registry.list.length} passages so far. Claude is thinking…`;
    }
    // The loop can end on a turn that only asked for tools, or one with no
    // words in it; then one more request, with tools off, so the reply always
    // ends in an answer.
    if (!finalText.trim()) {
      statusEl.textContent = `${registry.list.length} passages found. Claude is writing the answer…`;
      nudge(messages, "Write the answer now from the passages already found. No more searches are available.");
      finalText = (await ask({ type: "none" })).text;
    }
    return finalText;
  }

  // Adds a line of instruction to the last user turn (a tool-result turn or the
  // question), so the request still alternates user and assistant.
  function nudge(messages, note) {
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") { messages.push({ role: "user", content: note }); return messages; }
    if (typeof last.content === "string") last.content = [{ type: "text", text: last.content }];
    last.content = [...last.content, { type: "text", text: note }];
    return messages;
  }

  function finish(answerEl, sourcesEl, toolsEl, reply, passages, input, modes, log, trail = []) {
    // The trail: what was searched, read, and counted, so the work can be checked.
    const model = MODELS.find(([id]) => id === settings.model)?.[1].split(" (")[0] || settings.model;
    const trailEl = el("details", { class: "ask-trail" }, [
      el("summary", { text: `${trail.length ? `${trail.length} ${trail.length === 1 ? "search" : "searches"}, ${passages.length} passages` : `${passages.length} passages`} · ${model}${settings.think ? ", thinking" : ""}` }),
      trail.length ? el("ol", {}, trail.map((t) => el("li", { text: `${t.tool === "search" ? "Searched: " : t.tool === "read" ? "" : t.tool === "original" ? "Read " : t.tool === "lexicon" ? "Looked up " : "Counted: "}${t.what.replace(/^read /, "Read ").replace(/^lexicon /, "")}${t.found !== null && t.found !== undefined ? ` (${t.found})` : ""}` }))) : null,
    ]);
    sourcesEl.append(trailEl);
    const bad = unverifiedQuotes(reply, passages);
    if (bad.length) {
      sourcesEl.append(el("div", { class: "quote-note" }, [
        el("span", { text: `${bad.length === 1 ? "One quotation is" : `${bad.length} quotations are`} not word for word in any passage found (underlined). ` }),
        el("button", { type: "button", class: "text-btn small", text: "Ask Claude to fix them", onclick: () => {
          input.value = `In your last answer these quotations are not word for word in any passage the tools returned: ${bad.map((q) => `“${q}”`).join("; ")}. Search for the right passages, then give the answer again with every quotation exactly as returned and cited, or without quotation marks where you are paraphrasing.`;
          submit(input, modes, log);
        } }),
      ]));
    }
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

  // Answers are rendered by lib/markdown.js, which also checks every quotation word for
  // word against the passages (QUOTE_RE, quoteFound, unverifiedQuotes); here a citation [n]
  // becomes a button that opens the passage.
  function markdown(src, passages) {
    const cite = (n) => {
      const p = passages.find((x) => x.n === Number(n));
      return p ? `<button type="button" class="cite" data-doc="${p.doc_id}" data-pid="${esc(p.pid || "")}" title="${esc(p.label)}">${esc(shortCitation(p))}</button>` : `[${n}]`;
    };
    return renderMarkdown(src, { passages, cite });
  }

  document.addEventListener("click", (e) => {
    const c = e.target.closest("button.cite");
    if (c) GL().openDoc(Number(c.dataset.doc), c.dataset.pid || null);
  });

  // ------------------------------------------------------------ transport --
  // How long to wait: a whole answer that does not stream, or a stream that
  // goes quiet (it sends pings while it thinks, so silence means it is stuck).
  const CALL_TIMEOUT_MS = 60000;
  const STALL_TIMEOUT_MS = 90000;
  function timeoutError() {
    const e = new Error("Claude did not answer in time; try again.");
    e.name = "TimeoutError";
    return e;
  }

  async function complete({ model, system, messages, max_tokens, stream, onDelta, onThinking, tools, tool_choice, thinking }) {
    const body = { model, system, messages, max_tokens, stream: !!stream };
    if (tools) body.tools = tools;
    if (tools && tool_choice) body.tool_choice = tool_choice;
    // Adaptive thinking: the model reasons before it answers and between tool
    // calls, as much as the question needs. max_tokens caps thinking and
    // answer together. Its thinking blocks come back signed and must be
    // returned unchanged on the next turn of a tool loop.
    if (thinking) { body.thinking = { type: "adaptive", display: "summarized" }; body.output_config = { effort: "high" }; }
    // One timer: for a plain call it runs once; for a stream it starts again
    // with every chunk that arrives.
    const ctl = new AbortController();
    let timer = null, timedOut = false;
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort(); }, stream ? STALL_TIMEOUT_MS : CALL_TIMEOUT_MS); };
    arm();
    try {
      return await send(body, ctl.signal, stream ? arm : () => {}, { stream, onDelta, onThinking, tools });
    } catch (err) {
      throw timedOut ? timeoutError() : err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function send(body, signal, alive, { stream, onDelta, onThinking, tools }) {
    const r = await fetch(API_URL, {
      signal,
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
      alive();
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
          blocks[evt.index] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, json: "", input: {} }
            : b.type === "thinking" ? { type: "thinking", thinking: "", signature: "" }
            : b.type === "redacted_thinking" ? { type: "redacted_thinking", data: b.data }
            : { type: "text", text: "" };
        } else if (evt.type === "content_block_delta") {
          const b = blocks[evt.index];
          if (evt.delta?.type === "text_delta") { text += evt.delta.text; if (b) b.text += evt.delta.text; onDelta && onDelta(evt.delta.text); }
          else if (evt.delta?.type === "input_json_delta" && b) b.json += evt.delta.partial_json;
          else if (evt.delta?.type === "thinking_delta" && b) { b.thinking += evt.delta.thinking; onThinking && onThinking(evt.delta.thinking); }
          else if (evt.delta?.type === "signature_delta" && b) b.signature += evt.delta.signature;
        } else if (evt.type === "content_block_stop") {
          const b = blocks[evt.index];
          if (b && b.type === "tool_use") { try { b.input = b.json ? JSON.parse(b.json) : {}; } catch (_) { b.input = {}; } delete b.json; }
        } else if (evt.type === "message_delta") {
          if (evt.delta?.stop_reason) stop_reason = evt.delta.stop_reason;
        } else if (evt.type === "error") throw new Error(evt.error?.message || "stream error");
      }
    }
    const clean = blocks.filter(Boolean).map((b) => (
      b.type === "text" ? { type: "text", text: b.text }
        : b.type === "thinking" ? { type: "thinking", thinking: b.thinking, signature: b.signature }
        : b.type === "redacted_thinking" ? { type: "redacted_thinking", data: b.data }
        : { type: "tool_use", id: b.id, name: b.name, input: b.input }
    )).filter((b) => b.type !== "text" || b.text);
    if (!tools) return text;
    return { text, blocks: clean, tool_uses: clean.filter((b) => b.type === "tool_use"), stop_reason };
  }

  function modelName() { return MODELS.find(([id]) => id === settings.model)?.[1].split(" (")[0] || settings.model; }
  window.Ask = { render, settings, plan: planQueries, hasKey: () => !!settings.key, complete, modelName, subjectFor };
})();
