// The error log (web/lib/log.js): it keeps the last 200, counts a repeat instead of listing
// it again, survives a reload through the storage it is given, and never holds the API key
// or the passphrase, however they reach it.
import test from "node:test";
import assert from "node:assert/strict";
import { makeLog, scrub } from "../../web/lib/log.js";

const memory = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m }; };

test("an error is kept with where it happened, its message and the top of its stack", () => {
  const log = makeLog({ now: () => Date.UTC(2026, 10, 10, 12) });
  const err = new TypeError("the marks database did not open");
  log.note("marks.forDoc", err);
  const [e] = log.entries();
  assert.equal(e.where, "marks.forDoc");
  assert.equal(e.what, "TypeError: the marks database did not open");
  assert.ok(e.stack.length > 0 && !e.stack.includes("the marks database did not open"), "the stack is the frames, not the message again");
  assert.match(log.text(), /2026-11-10T12:00:00\.000Z {2}marks\.forDoc: TypeError: the marks database did not open/);
  log.note("ask", "a plain string");
  assert.equal(log.entries()[1].what, "a plain string");
  const withStatus = Object.assign(new Error("529 Overloaded"), { status: 529 });
  log.note("ask", withStatus);
  assert.equal(log.entries()[2].what, "529 Overloaded (status 529)");
});

test("the same failure again is counted, and only the last 200 are kept", () => {
  const log = makeLog();
  for (let i = 0; i < 5; i++) log.note("marks.all", new Error("shut"));
  assert.equal(log.count(), 1);
  assert.equal(log.entries()[0].n, 5);
  assert.match(log.text(), /marks\.all: shut \(5 times\)/);
  for (let i = 0; i < 250; i++) log.note("x", new Error(`failure ${i}`));
  assert.equal(log.count(), 200);
  assert.equal(log.entries()[199].what, "failure 249");
  assert.equal(log.entries()[0].what, "failure 50");
});

test("the API key and the passphrase never enter the log", () => {
  const store = memory();
  const pass = "correct horse battery staple test";
  const log = makeLog({ storage: store, secrets: () => ["sk-ant-api03-REALKEY_abc-123", pass] });
  log.note("ask sk-ant-api03-REALKEY_abc-123", new Error(`401 invalid x-api-key sk-ant-api03-REALKEY_abc-123, passphrase ${pass}`));
  log.note("engine", { message: `could not unlock with "${pass}"`, stack: `Error: x\n    at unlock (${pass})\n    at sk-ant-other-key-999` });
  log.note("promise", `key=sk-ant-zzz999 pass=${pass}`);
  const all = JSON.stringify(log.entries()) + log.text() + [...store.raw.values()].join("");
  assert.ok(!all.includes("sk-ant-"), "a key is in the log");
  assert.ok(!all.includes(pass) && !all.includes("battery staple"), "the passphrase is in the log");
  assert.match(log.entries()[0].what, /401 invalid x-api-key \[key\], passphrase \[secret\]/);
  // a stored key that does not look like one is struck out by its value
  assert.equal(scrub("sent oddkey-12345 away", ["oddkey-12345"]), "sent [secret] away");
  assert.equal(scrub("nothing secret here", ["", null, "abc"]), "nothing secret here");
});

test("the log comes back after a reload, and a damaged copy starts it empty", () => {
  const store = memory();
  makeLog({ storage: store }).note("studies.list", new Error("the studies database failed"));
  const again = makeLog({ storage: store });
  assert.equal(again.count(), 1);
  assert.equal(again.entries()[0].where, "studies.list");
  again.clear();
  assert.equal(makeLog({ storage: store }).count(), 0);
  store.setItem("gospel.errorLog", "{not json");
  assert.equal(makeLog({ storage: store }).count(), 0);
  // a storage that refuses the write loses nothing in memory
  const full = makeLog({ storage: { getItem: () => null, setItem: () => { throw new Error("full"); } } });
  full.note("x", new Error("y"));
  assert.equal(full.count(), 1);
  assert.match(makeLog().text(), /Nothing has gone wrong/);
});
