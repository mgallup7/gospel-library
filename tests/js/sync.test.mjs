// Sync between devices (web/sync.js): the seal opens with the passphrase that made it and with
// no other; two devices against one fake GitHub (a file with a sha, a write refused when made
// against an old one) end up with the same marks, removals included; a write that loses a race
// pulls, merges and tries again; a refusal is said in plain words and writes nothing.
import test from "node:test";
import assert from "node:assert/strict";
import { makeSync, seal, unseal, toB64, fromB64, ago, FILE, ITERATIONS } from "../../web/sync.js";

const PASS = "correct horse battery staple test";
const TOKEN = "github_pat_TESTONLY_not_a_token_0123456789";

// A tiny marks store to the contract marks.js keeps: id and updated on every record, a removal
// is a tombstone, merge keeps the newer per id, onChange hears local writes and merges that changed something.
function fakeMarks() {
  const recs = new Map();
  const fns = [];
  const tell = (local) => { for (const fn of fns) fn({ local }); };
  return {
    dump: async () => [...recs.values()].map((r) => ({ ...r })),
    merge: async (list) => { let changed = 0; for (const r of list) { const old = recs.get(r.id); if (!old || old.updated < r.updated) { recs.set(r.id, { ...r }); changed++; } } if (changed) tell(false); return { changed }; },
    onChange: (fn) => { fns.push(fn); },
    set: (id, note, updated) => { recs.set(id, { id, note, updated }); tell(true); },
    remove: (id, updated) => { recs.set(id, { id, deleted: true, updated }); tell(true); },
    live: () => [...recs.values()].filter((r) => !r.deleted).map((r) => `${r.id}=${r.note}`).sort(),
    all: () => [...recs.values()],
  };
}

// GitHub's contents API for one repository, in memory.
function fakeGitHub({ owner = "someone", repo = "gospel-library-sync" } = {}) {
  const gh = { file: null, n: 0, calls: [], puts: 0, failNext: null, beforePut: null, big: false, isPrivate: true, tokens: new Set([TOKEN]), headersSeen: [] };
  const answer = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });
  gh.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    gh.calls.push(`${method} ${url.replace("https://api.github.com", "")}`);
    gh.headersSeen.push(init.headers || {});
    if (gh.failNext) { const f = gh.failNext; gh.failNext = null; if (f === "network") throw new TypeError("Failed to fetch"); return answer(f.status, { message: "no" }, f.headers || {}); }
    const auth = String((init.headers || {}).Authorization || "").replace(/^Bearer /, "");
    if (!gh.tokens.has(auth)) return answer(401, { message: "Bad credentials" });
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    if (!url.startsWith(base)) return answer(404, { message: "Not Found" });
    const path = url.slice(base.length);
    if (path === "") return answer(200, { private: gh.isPrivate });
    if (path === `/contents/${FILE}` && method === "GET") {
      if (!gh.file) return answer(404, { message: "Not Found" });
      // past 1 MB the real API leaves content empty; `big` plays that
      return answer(200, gh.big ? { sha: gh.file.sha, size: gh.file.text.length, content: "", encoding: "none" } : { sha: gh.file.sha, size: gh.file.text.length, encoding: "base64", content: btoa(gh.file.text).replace(/(.{60})/g, "$1\n") });
    }
    if (path.startsWith("/git/blobs/") && method === "GET") return gh.file && path.endsWith(gh.file.sha) ? answer(200, gh.file.text) : answer(404, {});
    if (path === `/contents/${FILE}` && method === "PUT") {
      if (gh.beforePut) { const f = gh.beforePut; gh.beforePut = null; await f(); }
      const body = JSON.parse(init.body);
      if (gh.file && !body.sha) return answer(422, { message: "sha wasn't supplied" });
      if (gh.file && body.sha !== gh.file.sha) return answer(409, { message: "is at another sha" });
      if (!gh.file && body.sha) return answer(409, { message: "no such file" });
      gh.file = { sha: `sha${++gh.n}`, text: atob(body.content) };
      gh.puts++;
      return answer(gh.n === 1 ? 201 : 200, { content: { sha: gh.file.sha } });
    }
    return answer(404, { message: "Not Found" });
  };
  return gh;
}

function device(gh, { pass = PASS, token = TOKEN, online = () => true, fetch = gh.fetch } = {}) {
  const kv = new Map();
  const store = { get: (k, d = null) => (kv.has(k) ? kv.get(k) : d), set: (k, v) => { kv.set(k, v); return true; }, del: (k) => kv.delete(k) };
  const marks = fakeMarks();
  const logged = [];
  const sync = makeSync({ store, passphrase: () => pass, fetch, online, wait: async () => {}, log: (w, e) => logged.push(`${w}: ${e && e.message}`), debounce: 20 });
  sync.register("marks", marks);
  const connect = () => sync.connect({ owner: "someone", repo: "gospel-library-sync", token });
  return { sync, marks, store, kv, logged, connect };
}
const opened = async (gh, pass = PASS) => JSON.parse((await unseal(gh.file.text, pass)).text);

test("what is sealed opens with the same passphrase, and the file is the form the header says", async () => {
  const text = JSON.stringify({ marks: [{ id: "/scriptures/bofm/alma/32#p21", note: "faith is not to have a perfect knowledge, ✓ é 信", updated: 5 }] });
  const file = await seal(text, PASS);
  const f = JSON.parse(file);
  assert.deepEqual(Object.keys(f).sort(), ["data", "iv", "salt", "v"]);
  assert.equal(f.v, 1);
  assert.equal(fromB64(f.salt).length, 16);
  assert.equal(fromB64(f.iv).length, 12);
  assert.ok(!file.includes("alma") && !file.includes("perfect knowledge"), "the words are readable in the file");
  assert.ok(ITERATIONS >= 310000);
  const back = await unseal(file, PASS);
  assert.equal(back.text, text);
  // a second write: the same salt when it is handed in, never the same IV
  const again = JSON.parse(await seal(text, PASS, { salt: back.salt }));
  assert.equal(again.salt, f.salt);
  assert.notEqual(again.iv, f.iv);
  assert.notEqual(again.data, f.data);
  assert.notEqual(JSON.parse(await seal(text, PASS)).salt, f.salt);
});

test("another passphrase, or a file this app did not write, is refused in plain words", async () => {
  const file = await seal("{}", PASS);
  await assert.rejects(unseal(file, "another passphrase entirely"), (e) => e.code === "passphrase" && /different library passphrase/.test(e.message));
  const f = JSON.parse(file);
  const bent = fromB64(f.data); bent[0] ^= 1;
  await assert.rejects(unseal(JSON.stringify({ ...f, data: toB64(bent) }), PASS), (e) => e.code === "passphrase");
  await assert.rejects(unseal("hello", PASS), (e) => e.code === "format");
  await assert.rejects(unseal(JSON.stringify({ v: 2, salt: f.salt, iv: f.iv, data: f.data }), PASS), (e) => e.code === "format");
});

test("base64 survives GitHub's line breaks and a large file", () => {
  const big = new Uint8Array(300000).map((_, i) => (i * 31) % 256);
  const b = toB64(big);
  assert.deepEqual(fromB64(b.replace(/(.{60})/g, "$1\n")), big);
});

test("connect makes the file; a mark made on one device reaches the other, and a removal too", async () => {
  const gh = fakeGitHub();
  const a = device(gh), b = device(gh);
  a.marks.set("alma32#p21", "faith", 100);
  let st = await a.connect();
  assert.equal(st.error, "");
  assert.ok(gh.file, "connect did not create the file");
  assert.match(st.text, /^Synced just now, 1 highlight or note\.$/);
  assert.ok(!gh.file.text.includes("faith") && !gh.file.text.includes(TOKEN), "the file is readable, or holds the token");
  assert.deepEqual((await opened(gh)).marks.map((m) => m.id), ["alma32#p21"]);

  // the second device has a mark of its own: first connect merges, both ways
  b.marks.set("moroni10#p4", "ask", 150);
  st = await b.connect();
  assert.deepEqual(b.marks.live(), ["alma32#p21=faith", "moroni10#p4=ask"]);
  assert.match(st.text, /2 highlights and notes/);
  await a.sync.sync();
  assert.deepEqual(a.marks.live(), ["alma32#p21=faith", "moroni10#p4=ask"]);

  // nothing new anywhere: a sync reads and does not write
  const puts = gh.puts;
  await a.sync.sync(); await b.sync.sync();
  assert.equal(gh.puts, puts, "a sync with nothing new wrote the file");

  // a newer edit wins over an older one, whichever device syncs first
  a.marks.set("alma32#p21", "faith, edited on a", 300);
  b.marks.set("alma32#p21", "faith, older edit on b", 200);
  await b.sync.sync(); await a.sync.sync(); await b.sync.sync();
  assert.deepEqual(a.marks.live(), b.marks.live());
  assert.ok(a.marks.live().includes("alma32#p21=faith, edited on a"));

  // a removal is a record too, and it travels
  a.marks.remove("moroni10#p4", 400);
  await a.sync.sync(); await b.sync.sync();
  assert.deepEqual(b.marks.live(), ["alma32#p21=faith, edited on a"]);
  assert.match(b.sync.status().text, /1 highlight or note/);
  assert.ok((await opened(gh)).marks.some((m) => m.id === "moroni10#p4" && m.deleted), "the file lost the removal");
});

test("a write that loses the race pulls, merges and tries again; both devices keep their marks", async () => {
  const gh = fakeGitHub();
  const a = device(gh), b = device(gh);
  await a.connect(); await b.connect();
  a.marks.set("a#1", "from a", 10);
  b.marks.set("b#1", "from b", 20);
  // b writes while a is between its read and its write
  gh.beforePut = async () => { await b.sync.sync(); };
  const st = await a.sync.sync();
  assert.equal(st.error, "");
  await b.sync.sync();
  assert.deepEqual(a.marks.live(), ["a#1=from a", "b#1=from b"]);
  assert.deepEqual(b.marks.live(), ["a#1=from a", "b#1=from b"]);
  assert.deepEqual((await opened(gh)).marks.map((m) => m.id).sort(), ["a#1", "b#1"]);

  // refused every time: three more attempts, then it says so and stops
  let tries = 0, refuse = true;
  const c = device(gh, { fetch: async (url, init = {}) => { if (refuse && init.method === "PUT") { tries++; return { ok: false, status: 409, headers: { get: () => null }, json: async () => ({}) }; } return gh.fetch(url, init); } });
  c.marks.set("c#1", "again", 30);
  const lost = await c.connect();
  assert.equal(tries, 4);
  assert.match(lost.error, /Another device wrote at the same moment/);
  assert.deepEqual(c.marks.live(), ["a#1=from a", "b#1=from b", "c#1=again"]);
  refuse = false;
  await c.sync.sync();
  assert.ok((await opened(gh)).marks.some((m) => m.id === "c#1"), "the mark was not sent on the next sync");
});

test("disconnect forgets the token and keeps the marks; reconnecting neither doubles nor loses them", async () => {
  const gh = fakeGitHub();
  const a = device(gh);
  a.marks.set("x#1", "one", 1); a.marks.set("x#2", "two", 2);
  await a.connect();
  a.sync.disconnect();
  assert.equal(a.kv.has("syncToken"), false);
  assert.equal(a.sync.status().connected, false);
  assert.deepEqual(a.marks.live(), ["x#1=one", "x#2=two"]);
  a.marks.set("x#3", "made while disconnected", 3);
  const calls = gh.calls.length;
  await a.sync.sync();
  assert.equal(gh.calls.length, calls, "a disconnected device called GitHub");
  await a.connect();
  assert.deepEqual(a.marks.live(), ["x#1=one", "x#2=two", "x#3=made while disconnected"]);
  assert.equal(a.marks.all().length, 3);
  assert.equal((await opened(gh)).marks.length, 3);
});

test("a device with another passphrase is told so, and the file is left as it was", async () => {
  const gh = fakeGitHub();
  const a = device(gh), b = device(gh, { pass: "not the same passphrase" });
  a.marks.set("x#1", "one", 1);
  await a.connect();
  const before = gh.file.text;
  b.marks.set("y#1", "other", 2);
  const st = await b.connect();
  assert.match(st.error, /different library passphrase/);
  assert.equal(gh.file.text, before);
  assert.deepEqual(b.marks.live(), ["y#1=other"]);
});

test("refusals are said plainly, write nothing, and never carry the token", async () => {
  const gh = fakeGitHub();
  const a = device(gh);
  await a.connect();
  a.marks.set("x#1", "one", 1);
  const cases = [
    [{ status: 401 }, /did not accept the token/],
    [{ status: 403, headers: { "x-ratelimit-remaining": "0" } }, /asked this device to wait/],
    [{ status: 403 }, /Contents set to "Read and write" for someone\/gospel-library-sync/],
    [{ status: 500 }, /answered with an error \(500\)/],
    ["network", /Could not reach GitHub/],
  ];
  for (const [fail, says] of cases) {
    gh.failNext = fail;
    const puts = gh.puts;
    const st = await a.sync.sync();
    assert.match(st.error, says);
    assert.equal(gh.puts, puts);
    assert.ok(!st.text.includes(TOKEN));
  }
  assert.ok(!a.logged.join("\n").includes(TOKEN), "the token reached the log");
  // the next trigger goes through
  const st = await a.sync.sync();
  assert.equal(st.error, "");
  assert.equal((await opened(gh)).marks.length, 1);

  // a bad token, a wrong repository name, and no network at all
  const bad = device(gh, { token: "github_pat_wrong" });
  assert.match((await bad.connect()).error, /did not accept the token/);
  const lost = device(gh);
  assert.match((await lost.sync.connect({ owner: "someone", repo: "no-such", token: TOKEN })).error, /no repository someone\/no-such/);
  const calls = gh.calls.length;
  const off = device(gh, { online: () => false });
  off.store.set("syncOwner", "someone"); off.store.set("syncRepo", "gospel-library-sync"); off.store.set("syncToken", TOKEN);
  assert.match((await off.sync.sync()).error, /^Offline/);
  assert.equal(gh.calls.length, calls, "an offline device called GitHub");
});

test("every request carries only the headers GitHub lets a browser send", async () => {
  const gh = fakeGitHub();
  const a = device(gh);
  await a.connect();
  for (const h of gh.headersSeen) assert.deepEqual(Object.keys(h).filter((k) => !["Accept", "Authorization", "Content-Type"].includes(k)), []);
  assert.ok(gh.headersSeen.every((h) => /^application\/vnd\.github(\.raw)?\+json$/.test(h.Accept)));
});

test("a file past 1 MB is read by its sha; a repository address typed whole is understood; a public repository is remarked on", async () => {
  const gh = fakeGitHub();
  const a = device(gh), b = device(gh);
  a.marks.set("x#1", "one", 1);
  await a.connect();
  gh.big = true; gh.isPrivate = false;
  const st = await b.sync.connect({ owner: "", repo: "https://github.com/someone/gospel-library-sync.git", token: `  ${TOKEN}\n` });
  assert.equal(st.error, "");
  assert.match(st.text, /repository is public/);
  assert.deepEqual(b.marks.live(), ["x#1=one"]);
  assert.ok(gh.calls.some((c) => c.includes("/git/blobs/")));
  assert.deepEqual(b.sync.config(), { owner: "someone", repo: "gospel-library-sync", token: TOKEN });
});

test("a list this device has no store for goes back as it came", async () => {
  const gh = fakeGitHub();
  const a = device(gh);
  await a.connect();
  const salt = (await unseal(gh.file.text, PASS)).salt;
  gh.file = { sha: "byhand", text: await seal(JSON.stringify({ marks: [], studies: [{ id: "s1", updated: 9, title: "kept" }] }), PASS, { salt }) };
  a.marks.set("x#1", "one", 1);
  await a.sync.sync();
  const data = await opened(gh);
  assert.deepEqual(data.studies, [{ id: "s1", updated: 9, title: "kept" }]);
  assert.equal(data.marks.length, 1);
});

test("a local change is sent a moment after the last one; a merge from the file is not sent back", async () => {
  const gh = fakeGitHub();
  const a = device(gh), b = device(gh);
  await a.connect(); await b.connect();
  const puts = gh.puts;
  a.marks.set("x#1", "o", 1); a.marks.set("x#1", "on", 2); a.marks.set("x#1", "one", 3);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(gh.puts, puts + 1, "three quick edits were not one write");
  await b.sync.sync();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(gh.puts, puts + 1, "a device wrote back what it had just been given");
  assert.deepEqual(b.marks.live(), ["x#1=one"]);
});

test("how long ago, in words", () => {
  assert.equal(ago(0, 30000), "just now");
  assert.equal(ago(0, 60000), "1 minute ago");
  assert.equal(ago(0, 2 * 60000), "2 minutes ago");
  assert.equal(ago(0, 3 * 3600000), "3 hours ago");
  assert.equal(ago(0, 49 * 3600000), "2 days ago");
});
