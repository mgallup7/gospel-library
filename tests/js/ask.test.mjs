// Ask's transport and the search box's planner, run in node: web/ask.js is evaluated in a
// context with a stand-in window (a settings store, no DOM) and a fetch that answers the way
// api.anthropic.com does, or does not answer at all. Timers run a thousand times faster
// than written, so the 60 s and 90 s limits take 60 and 90 ms here.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// ask.js is a module that imports from web/lib/; the context has no module loader, so each
// import line becomes a destructuring of that lib, loaded here and handed in as __lib.
const LIB = {
  "./lib/markdown.js": await import("../../web/lib/markdown.js"),
  "./lib/cite.js": await import("../../web/lib/cite.js"),
};
const source = fs.readFileSync(path.join(here, "..", "..", "web", "ask.js"), "utf8")
  .replace(/^import \{([^}]+)\} from "([^"]+)";$/gm, (_, names, from) => {
    assert.ok(LIB[from], `ask.js imports ${from}; add it to LIB`);
    return `const {${names.replace(/\bas\b/g, ":")}} = __lib[${JSON.stringify(from)}];`;
  });

function load(fetchImpl, saved = {}, gl = {}, win = {}) {
  const data = { apiKey: "test-key", ...saved };
  const store = { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, del: (k) => { delete data[k]; } };
  const calls = [];
  const fetch = (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), signal: opts.signal }); return fetchImpl(opts); };
  const window = { GL: { el: () => ({}), esc: (s) => s, store, ...gl }, addEventListener() {}, ...win };
  const ctx = {
    window, document: { addEventListener() {} }, navigator: { onLine: true }, fetch, console, __lib: LIB,
    setTimeout: (fn, ms) => setTimeout(fn, ms / 1000), clearTimeout,
    AbortController, TextDecoder, TextEncoder, Response, ReadableStream, Error, Promise, JSON,
  };
  vm.runInNewContext(source, ctx);
  return { Ask: window.Ask, calls, data };
}

// A stream that sends the given SSE events with a pause before each, then ends (or hangs).
function sse(events, { gap = 0, hang = false } = {}) {
  return ({ signal }) => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      async start(c) {
        signal.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        for (const e of events) {
          await new Promise((r) => setTimeout(r, gap));
          if (signal.aborted) return;
          c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        }
        if (!hang) c.close();
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  };
}
const textEvents = (words) => [
  { type: "message_start" },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  ...words.map((w) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: w } })),
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
  { type: "message_stop" },
];
const never = ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

test("with the planner setting off, the search box is not widened and Claude is not called", async () => {
  const { Ask, calls } = load(() => { throw new Error("should not be called"); }, { askPlanner: false });
  const plan = await Ask.plan("faith and works");
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), { queries: [], references: [] });
  assert.equal(calls.length, 0);
});

test("with the planner on (the default), the plan comes back from Claude's JSON", async () => {
  const reply = { content: [{ type: "text", text: 'Here: {"queries":[{"q":"faith works","scope":"scriptures"},{"q":""}],"references":["James 2:17", 5]}' }] };
  const { Ask, calls } = load(() => Promise.resolve(new Response(JSON.stringify(reply), { status: 200 })));
  const plan = await Ask.plan("faith and works");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.model, "claude-haiku-5-5");
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), { queries: [{ q: "faith works", scope: "scriptures" }], references: ["James 2:17"] });
});

test("a call that never answers times out with a plain error", async () => {
  const { Ask } = load(never);
  await assert.rejects(Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: false }), (err) => {
    assert.equal(err.name, "TimeoutError");
    assert.equal(err.message, "Claude did not answer in time; try again.");
    return true;
  });
});

test("a stream that goes quiet times out, after what it had sent", async () => {
  const { Ask } = load(sse(textEvents(["Faith "]).slice(0, 3), { hang: true }));
  let got = "";
  await assert.rejects(Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true, onDelta: (t) => { got += t; } }), { name: "TimeoutError" });
  assert.equal(got, "Faith ");
});

test("a slow stream that keeps sending is not cut off: each chunk restarts the clock", async () => {
  // 9 events 40 ms apart: 360 ms in all, four times the 90 ms stall limit
  const { Ask } = load(sse(textEvents(["Faith ", "is ", "a ", "principle."]), { gap: 40 }));
  const text = await Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true });
  assert.equal(text, "Faith is a principle.");
});

test("tool_choice is sent with tools, and only with tools", async () => {
  const { Ask, calls } = load(sse(textEvents(["ok"])));
  const res = await Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true, tools: [{ name: "search" }], tool_choice: { type: "none" } });
  assert.equal(res.text, "ok");
  assert.equal(res.stop_reason, "end_turn");
  assert.deepEqual(calls[0].body.tool_choice, { type: "none" });
  await Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true, tool_choice: { type: "none" } });
  assert.equal("tool_choice" in calls[1].body, false);
});

test("an API error still comes through as itself, not as a timeout", async () => {
  const { Ask } = load(() => Promise.resolve(new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })));
  await assert.rejects(Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: false }), /401 invalid x-api-key/);
});

test("Think it through asks for three kinds of question, labelled, the way Preach My Gospel teaches", () => {
  const { Ask } = load(() => { throw new Error("no call"); });
  const p = Ask.thinkPrompt;
  const q = p.slice(p.indexOf("## Questions"), p.indexOf("## For the deck"));
  assert.match(q, /Preach My Gospel/);
  for (const label of ["What it says:", "What it means:", "What you will do:"]) assert.ok(q.includes(label), `the prompt names ${label}`);
  assert.match(q, /commitment/);
  assert.doesNotMatch(p, /each one the page itself answers/, "the old recall-only wording is gone");
  // the headings still come in their order, For the deck last
  const order = ["## What this page teaches", "## Connections", "## In the original", "## Questions", "## For the deck"].map((h) => p.indexOf(h));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), "headings in order");
});

test("the questions of a Think it through are read back by kind, without their citations", () => {
  const { Ask } = load(() => { throw new Error("no call"); });
  const reply = `## What this page teaches\nFaith is a seed.\n\n## Questions\n- **What it says:** What does Alma compare the word to? [2]\n2. What it means: Why does Alma call faith an experiment rather than a certainty?\n* What will you do: What will you plant this week, and how will you nourish it?\n\n## For the deck\n"Faith as a seed" [1] [2]`;
  const qs = JSON.parse(JSON.stringify(Ask.thinkQuestions(reply)));
  assert.deepEqual(qs.map((x) => x.kind), ["says", "means", "do"]);
  assert.deepEqual(qs.map((x) => x.label), ["What it says", "What it means", "What you will do"]);
  assert.equal(qs[0].text, "What does Alma compare the word to?");
  assert.equal(qs[2].text, "What will you plant this week, and how will you nourish it?");
  // an older answer, unlabelled, still gives its questions; prose lines are left out
  const old = Ask.thinkQuestions("## Questions\nA few to ask.\n- Who planted the seed?\n- What grew there?\n\n## For the deck\nx");
  assert.deepEqual(JSON.parse(JSON.stringify(old)).map((x) => [x.kind, x.text]), [[null, "Who planted the seed?"], [null, "What grew there?"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(Ask.thinkQuestions("No headings at all."))), []);
});

// ---- what is sent: the system blocks, the same assembly for every mode ----
// The test library: the scriptures with Hebrew and Greek, a few pages of the Papers, no talks.
const STATS = {
  collections: [
    { slug: "scriptures", title: "Scriptures", docs: 1582 },
    { slug: "general-conference", title: "General Conference", docs: 0 },
    { slug: "jsp-journals", title: "Joseph Smith Papers: Journals", docs: 8 },
  ],
  talks: 0, latest_conference: null, originals: { verses: 31218, lexicon: 22717 },
};
const libraryApi = (stats = STATS, books = []) => async (method) => (method === "stats" ? stats : method === "browse" ? { books } : null);
const textOf = (blocks) => blocks.map((b) => b.text).join("\n\n");

test("the inventory says what this device holds, and names what it does not", () => {
  const { Ask } = load(() => { throw new Error("no call"); });
  const inv = Ask.inventoryText(STATS);
  assert.match(inv, /^On this device/);
  assert.match(inv, /the standard works[^\n]*: 1,582 chapters\. Search scope: scriptures\./);
  assert.match(inv, /Joseph Smith Papers[^\n]*Journals: 8 pages/);
  assert.match(inv, /Hebrew and Greek text word by word[^\n]*31,218 verses/);
  const missing = inv.slice(inv.indexOf("Not on this device"));
  for (const shelf of ["general conference talks", "Preach My Gospel", "Missionary Standards", "Come, Follow Me", "the General Handbook", "the study helps"]) assert.ok(missing.includes(shelf), `${shelf} is named as not here`);
  assert.doesNotMatch(inv, /1971/, "no claim about talks this device does not hold");
  assert.doesNotMatch(inv.slice(0, inv.indexOf("Not on this device")), /conference/, "talks are not listed as held");
  // with talks, the span comes from the conferences held, not from a constant
  const full = Ask.inventoryText({ ...STATS, talks: 70, collections: [...STATS.collections.filter((c) => c.slug !== "general-conference"), { slug: "general-conference", title: "General Conference", docs: 70 }], originals: null },
    [{ year: 2024, month: 10, docs: 35 }, { year: 2024, month: 4, docs: 35 }, { year: 2025, month: 4, docs: 0 }]);
  assert.match(full, /general conference talks: 70 talks from 2 conferences, April 2024 to October 2024/);
  assert.match(full, /Not on this device:[^\n]*the Hebrew and Greek text under the Bible/);
  // a library that cannot be read claims nothing
  assert.match(Ask.inventoryText(null), /could not be read/);
});

test("every mode sends the same core, his standing instructions and his notes, with one cache marker", async () => {
  const skills = { style: "STYLE-MARK", voice: "VOICE-MARK", skills: [{ kind: "mode", id: "letter", name: "Letter", text: "LETTER-MARK" }] };
  const { Ask } = load(() => { throw new Error("no call"); }, { askNotes: "2026-11-01: The zone conference theme is covenants." }, { api: libraryApi(), skills });
  const per = {};
  for (const mode of ["ask", "draft", "think", "skill:letter", "chain"]) per[mode] = JSON.parse(JSON.stringify(await Ask.system(mode, mode === "chain" ? "CHAIN-PARAGRAPH" : "")));
  for (const [mode, blocks] of Object.entries(per)) {
    const all = textOf(blocks);
    assert.equal(blocks[0].text, Ask.core, `${mode}: the core comes first`);
    assert.match(all, /My standing instructions[^\n]*\n\nNo em dashes, and nothing that sounds written by an AI\.\nStart from the Hebrew, Greek or Aramaic before Latter-day Saint canon\./, `${mode}: the starter instructions are sent`);
    assert.match(all, /What he has asked you to remember[^\n]*\n\n2026-11-01: The zone conference theme is covenants\./, `${mode}: the notes are sent`);
    assert.equal(blocks.filter((b) => b.cache_control).length, 1, `${mode}: one cache marker`);
    assert.doesNotMatch(all, /\u2014/, `${mode}: no em dash in what is sent`);
    assert.match(all, /The rule against em dashes governs what you write even where the instructions, the voice rules, the piece to write or their examples, below, contain em dashes themselves/, `${mode}: the prompt does not say the rule holds over his own text`);
    assert.doesNotMatch(all, /1971/, `${mode}: no shelf claimed that is not here`);
  }
  for (const mode of ["ask", "draft", "think", "skill:letter"]) {
    const blocks = per[mode];
    assert.ok(blocks.at(-1).cache_control, `${mode}: the marker is on the last block`);
    assert.match(blocks[2].text, /^On this device[\s\S]*Not on this device: general conference talks[\s\S]*\n\nTools:/, `${mode}: the inventory, then the tools`);
    assert.match(blocks[2].text, /When a Bible verse or word is in view, the first calls are original and lexicon/, `${mode}: original text first, in the tools guide`);
  }
  assert.match(per.ask[1].text, /^This turn is a question/);
  assert.match(per.draft[1].text, /read its Hebrew or Greek first/);
  assert.match(per.think[1].text, /read its key verses in the Hebrew or Greek first/);
  assert.match(textOf(per.ask), /STYLE-MARK/); assert.doesNotMatch(textOf(per.ask), /VOICE-MARK/);
  assert.match(textOf(per.draft), /VOICE-MARK/); assert.doesNotMatch(textOf(per.draft), /LETTER-MARK/);
  assert.match(textOf(per["skill:letter"]), /VOICE-MARK[\s\S]*LETTER-MARK/);
  // the deck's chain: its own paragraph, no tools guide, the date after the marker
  const chain = per.chain;
  assert.match(chain[1].text, /^CHAIN-PARAGRAPH\n\nThis call has no tools/);
  assert.doesNotMatch(textOf(chain), /\nTools:/);
  assert.match(textOf(chain), /On this device/); // the deck's call is told what the library holds, as the others are
  assert.match(textOf(chain), /STYLE-MARK/);
  assert.match(chain.at(-1).text, /^Today is \w+ \d+, \d{4}\.$/);
  assert.ok(chain.at(-2).cache_control && !chain.at(-1).cache_control);
});

test("standing instructions he has emptied are not sent, and his own replace the starter", async () => {
  const empty = load(() => { throw new Error("no call"); }, { askInstructions: "" }, { api: libraryApi() });
  assert.doesNotMatch(textOf(await empty.Ask.system("ask")), /My standing instructions \(/);
  const own = load(() => { throw new Error("no call"); }, { askInstructions: "Answer in outline form." }, { api: libraryApi() });
  const all = textOf(await own.Ask.system("draft"));
  assert.match(all, /My standing instructions[^\n]*\n\nAnswer in outline form\./);
  assert.doesNotMatch(all, /Talk to me as a peer/);
});

test("an answer joins the thread with each [n] replaced by the passage it meant", () => {
  const { Ask } = load(() => { throw new Error("no call"); });
  const passages = [{ n: 1, citation: "Hebrews 11:1", label: "Hebrews 11:1", collection: "scriptures" }, { n: 2, label: "Russell M. Nelson, \u201cChrist Is Risen\u201d, April 2021 General Conference", author: "Russell M. Nelson", collection: "general-conference" }];
  const out = Ask.withLabels('Faith is "the substance of things hoped for" [1]. A prophet said so too [2][7].\n[1] The definition.', passages);
  assert.equal(out, 'Faith is "the substance of things hoped for" (Hebrews 11:1). A prophet said so too (Russell M. Nelson, \u201cChrist Is Risen\u201d, April 2021 General Conference).\n(Hebrews 11:1) The definition.');
});

test("my_notes finds his notes and study pages by words, and gives the marked passage its number", async () => {
  const marks = [
    { uri: "/a", pid: "p21", doc_id: 5, kind: "verse", verse: 21, color: "y", note: "Faith is not a perfect knowledge: open the zone conference with this.", text: "And now as I said concerning faith", citation: "Alma 32:21", updated: Date.UTC(2026, 9, 1, 12) },
    { uri: "/b", pid: "p46", doc_id: null, kind: "verse", color: "g", note: null, text: "charity never faileth", citation: "Moroni 7:46", updated: Date.UTC(2026, 9, 2, 12) },
  ];
  const pages = { s1: { id: "s1", kind: "md", text: "# Covenant path\n" + "Filler sentence. ".repeat(60) + "The knowledge of a covenant comes by keeping it, and faith follows." } };
  const Marks = { all: async () => marks, COLOR_NAME: { y: "yellow", g: "green" } };
  const Studies = { list: async () => [{ id: "s1", title: "Covenant path", added: Date.UTC(2026, 8, 1, 12) }], get: async (id) => pages[id], plainText: (r) => r.text };
  const api = async (method) => (method === "context" ? { citation: "Alma 32:21", collection: "scriptures", paragraphs: [{ kind: "verse", verse: 21, pid: "p21", text: "And now as I said concerning faith, faith is not to have a perfect knowledge of things." }] } : null);
  const { Ask } = load(() => { throw new Error("no call"); }, {}, { api }, { Marks, Studies });
  const reg = new Ask.Registry();
  const r = await reg.myNotes({ query: "faith knowledge" });
  assert.equal(r.count, 2, "the note and the study page, not the unrelated highlight");
  assert.match(r.text, /His note on \[1\] Alma 32:21, 2026-10-01 \(highlighted yellow\)\nThe passage: And now as I said concerning faith, faith is not to have a perfect knowledge of things\.\nHis note: Faith is not a perfect knowledge/);
  assert.match(r.text, /His study page \u201cCovenant path\u201d, added 2026-09-01 \(from the middle\)\n\u2026 [\s\S]*The knowledge of a covenant comes by keeping it/);
  assert.equal(reg.list.length, 1, "the marked passage is a numbered passage");
  // his own words can be quoted without being flagged; the check runs against them too
  assert.equal(reg.checkable().length, 3);
  // no query: the most recent first
  const recent = await reg.myNotes({});
  assert.match(recent.text, /His highlight on Moroni 7:46[\s\S]*His note on \[1\] Alma 32:21/);
  // nothing matching says so, and names how much there is
  assert.match((await reg.myNotes({ query: "zebra" })).text, /Nothing in his 2 highlights and notes or his 1 study pages/);
});

// ---- when Claude is busy, when he presses Stop, and what the errors say ----
const busy = (status = 529, type = "overloaded_error") => new Response(JSON.stringify({ type: "error", error: { type, message: "Overloaded" } }), { status });

test("a busy server (529, 5xx) is tried twice more, then the error says the question is kept", async () => {
  let n = 0;
  const twice = load((opts) => (++n <= 2 ? Promise.resolve(busy()) : sse(textEvents(["ok"]))(opts)));
  const told = [];
  const res = await twice.Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true, onRetry: (k) => told.push(k) });
  assert.equal(res, "ok");
  assert.equal(twice.calls.length, 3);
  assert.deepEqual(told, [1, 2]);
  const always = load(() => Promise.resolve(busy(503, "api_error")));
  await assert.rejects(always.Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true }), (err) => {
    assert.equal(err.status, 503);
    assert.equal(always.Ask.friendlyError(err), "Claude is busy right now. Your question is kept; try again in a minute.");
    return true;
  });
  assert.equal(always.calls.length, 3, "one try and two more");
  // an error that is not the server's load is not tried again
  const bad = load(() => Promise.resolve(new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "max_tokens: too large" } }), { status: 400 })));
  await assert.rejects(bad.Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true }), /400 max_tokens/);
  assert.equal(bad.calls.length, 1);
});

test("an overload sent down the stream is tried again, unless words had already reached the page", async () => {
  const overloaded = { type: "error", error: { type: "overloaded_error", message: "Overloaded" } };
  let n = 0;
  const early = load((opts) => (++n === 1 ? sse([{ type: "message_start" }, overloaded])(opts) : sse(textEvents(["ok"]))(opts)));
  assert.equal(await early.Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true }), "ok");
  assert.equal(early.calls.length, 2);
  const late = load(sse([...textEvents(["Faith "]).slice(0, 3), overloaded]));
  let got = "";
  await assert.rejects(late.Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true, onDelta: (t) => { got += t; } }), (err) => err.status === 529 && /busy right now/.test(late.Ask.friendlyError(err)));
  assert.equal(got, "Faith ");
  assert.equal(late.calls.length, 1, "not run again over words already shown");
});

test("the planner does not wait on a busy server, and names every shelf and what is here", async () => {
  const stats = { collections: [{ slug: "scriptures", docs: 1582 }, { slug: "jsp-journals", docs: 8 }, { slug: "general-conference", docs: 0 }] };
  const { Ask, calls } = load(() => Promise.resolve(busy()), {}, { api: async () => stats });
  await assert.rejects(Ask.plan("faith and works"), /529/);
  assert.equal(calls.length, 1);
  const sys = calls[0].body.system;
  assert.match(sys, /standards \(Missionary Standards for Disciples of Jesus Christ/);
  assert.match(sys, /jsp \(the Joseph Smith Papers/);
  assert.match(sys, /scope is one of: all, scriptures, conference, pmg, standards, handbook, cfm, helps, jsp\./);
  assert.match(sys, /The original text comes first/);
  assert.match(sys, /\n\nOn this device: scriptures, jsp\. Not on this device: conference, pmg, standards, cfm, handbook, helps\.(\n\n|$)/);
  // his own instructions go with the plan too, in brief
  assert.match(sys, /\n\nHis standing instructions, for choosing what to search \(plan searches only; do not answer him\):\nNo em dashes/);
  assert.doesNotMatch(sys, /1971/);
});

test("Stop ends a call at once, and ends the wait before another try", async () => {
  const hung = load(never);
  const ctl = new AbortController();
  const p = hung.Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true, signal: ctl.signal });
  setTimeout(() => ctl.abort(), 5);
  await assert.rejects(p, { name: "StopError" });
  const waiting = load(() => Promise.resolve(busy()));
  const ctl2 = new AbortController();
  const p2 = waiting.Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true, signal: ctl2.signal, onRetry: () => ctl2.abort() });
  await assert.rejects(p2, { name: "StopError" });
  assert.equal(waiting.calls.length, 1);
});

test("errors are named by their status number, in plain words", () => {
  const { Ask } = load(() => { throw new Error("no call"); });
  const err = (status, message, extra = {}) => Object.assign(new Error(`${status} ${message}`.trim()), { status }, extra);
  assert.equal(Ask.friendlyError(err(404, "model: claude-old-1")), "That model is no longer offered. Pick another in settings.");
  assert.match(Ask.friendlyError(err(429, "Too many requests")), /rate-limited/);
  // words that merely contain "rate" or the digits 429 are not a rate limit
  assert.equal(Ask.friendlyError(new Error("could not generate request 4290")), "Something went wrong: could not generate request 4290");
  assert.match(Ask.friendlyError(err(401, "invalid x-api-key")), /key was not accepted/);
  assert.match(Ask.friendlyError(err(400, "Your credit balance is too low")), /no credit/);
  assert.match(Ask.friendlyError(err(500, "Internal server error")), /busy right now\. Your question is kept/);
});

test("the lexicon's lines reach the model without an em dash", async () => {
  const api = async (method) => (method === "lexicon" ? { strongs: "H2617", entry: { lemma: "\u05d7\u05e1\u05d3", translit: "chesed", gloss: "kindness" }, count: 1, verses_total: 1, books: [], glosses: [], credit: "STEP Bible",
    verses: [{ citation: "Genesis 19:19", verse: 19, text: "thou hast magnified thy mercy", doc_id: 3, pid: "p19", words: [{ word: "\u05d7\u05e1\u05d3", translit: "chesed", gloss: "kindness" }] }] } : null);
  const { Ask } = load(() => { throw new Error("no call"); }, {}, { api });
  const r = await new Ask.Registry().lexicon({ strongs: "H2617" });
  assert.match(r.text, /\[1\] Genesis 19:19: \S+ chesed \[kindness\] \(KJV: thou hast magnified thy mercy\)/);
  assert.doesNotMatch(r.text, /\u2014/);
});

// Web search (a server tool): the blocks it adds to a reply come back from the stream as the
// API sent them, since they must go back unchanged on the next request of the turn.
test("a reply with a web search in it keeps the search, its results and its citations as they came", async () => {
  const result = { type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [{ type: "web_search_result", url: "https://example.org/a", title: "A page", encrypted_content: "ENC", page_age: null }] };
  const cite = { type: "web_search_result_location", url: "https://example.org/a", title: "A page", encrypted_index: "IDX", cited_text: "the words cited" };
  const events = [
    { type: "message_start" },
    { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"a da' } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'te"}' } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: result },
    { type: "content_block_stop", index: 1 },
    { type: "content_block_start", index: 2, content_block: { type: "text", text: "", citations: [] } },
    { type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation: cite } },
    { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "It was in 1892." } },
    { type: "content_block_stop", index: 2 },
    { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 3, delta: { type: "text_delta", text: " Plain words." } },
    { type: "content_block_stop", index: 3 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ];
  const { Ask, calls } = load(sse(events));
  const searched = [];
  const res = await Ask.complete({ model: "m", messages: [], max_tokens: 10, stream: true, tools: [...Ask.tools, Ask.webTool], onServerTool: (b) => searched.push(b.input.query) });
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.deepEqual(plain(Ask.webTool), { type: "web_search_20250305", name: "web_search", max_uses: 3 });
  assert.deepEqual(calls[0].body.tools[calls[0].body.tools.length - 1], { type: "web_search_20250305", name: "web_search", max_uses: 3 });
  assert.equal(res.text, "It was in 1892. Plain words.");
  assert.deepEqual(plain(res.blocks), [
    { type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "a date" } },
    result,
    { type: "text", text: "It was in 1892.", citations: [cite] },
    { type: "text", text: " Plain words." },
  ]);
  assert.equal(res.tool_uses.length, 0, "a search the server ran is not a tool for this device to run");
  assert.deepEqual(searched, ["a date"]);
  // the registry keeps what the web brought apart from the library's passages
  const reg = new Ask.Registry(), trail = [];
  reg.noteWeb(res.blocks, trail);
  reg.noteWeb(res.blocks, trail);
  assert.equal(reg.list.length, 0);
  assert.deepEqual(plain(reg.web), [{ url: "https://example.org/a", title: "A page", age: "", cited: true }]);
  assert.deepEqual(plain(reg.webText), [{ plain: "It was in 1892." }, { plain: "the words cited" }]);
  assert.deepEqual(plain(trail), [{ tool: "web", what: "a date", found: 1 }]);
  // a search that failed says so on the trail, and a page with no web address is not listed
  const reg2 = new Ask.Registry(), trail2 = [];
  reg2.noteWeb([{ type: "server_tool_use", id: "s2", name: "web_search", input: { query: "q" } }, { type: "web_search_tool_result", tool_use_id: "s2", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } },
    { type: "text", text: "x", citations: [{ type: "web_search_result_location", url: "javascript:alert(1)", title: "bad" }] }], trail2);
  assert.equal(trail2[0].found, "failed: max_uses_exceeded");
  assert.equal(reg2.web.length, 0);
});

test("web search is off unless the setting is on, and a refusal of it is said plainly", async () => {
  const none = () => { throw new Error("no call"); };
  assert.equal(load(none).Ask.settings.web, false);
  assert.equal(load(none, { askWeb: true }).Ask.settings.web, true);
  assert.equal(load(none, { askWeb: "yes" }).Ask.settings.web, false, "only a plain true turns it on");
  const api = async (method) => (method === "stats" ? { collections: [] } : {});
  const { Ask } = load(none, {}, { api });
  const text = (blocks) => blocks.map((b) => b.text).join("\n");
  assert.doesNotMatch(text(await Ask.system("ask")), /Web search is on/);
  assert.match(text(await Ask.system("ask", "", { web: true })), /Web search is on[\s\S]*The library comes first[\s\S]*Say plainly in the answer that you used the web/);
  assert.doesNotMatch(text(await Ask.system("chain", "The chain.", { web: true })), /Web search is on/, "the deck's chain has no tools, so no web search");
  const err = Object.assign(new Error("400 tools.7: web_search_20250305 is not supported for this model"), { status: 400 });
  assert.match(Ask.friendlyError(err), /Web search was refused/);
});
