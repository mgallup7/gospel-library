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

function load(fetchImpl, saved = {}, gl = {}) {
  const data = { apiKey: "test-key", ...saved };
  const store = { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, del: (k) => { delete data[k]; } };
  const calls = [];
  const fetch = (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), signal: opts.signal }); return fetchImpl(opts); };
  const window = { GL: { el: () => ({}), esc: (s) => s, store, ...gl }, addEventListener() {} };
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
