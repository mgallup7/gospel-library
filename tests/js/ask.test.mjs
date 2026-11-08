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

function load(fetchImpl, saved = {}) {
  const data = { apiKey: "test-key", ...saved };
  const store = { get: (k, d) => (k in data ? data[k] : d), set: (k, v) => { data[k] = v; }, del: (k) => { delete data[k]; } };
  const calls = [];
  const fetch = (url, opts) => { calls.push({ url, body: JSON.parse(opts.body), signal: opts.signal }); return fetchImpl(opts); };
  const window = { GL: { el: () => ({}), esc: (s) => s, store } };
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
