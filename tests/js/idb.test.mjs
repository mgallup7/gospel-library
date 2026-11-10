// web/lib/idb.js against a small stand-in for IndexedDB: the marks and the studies open for
// each piece of work and close after it, the deck holds one connection and lets go of it when
// another tab upgrades; a request's result comes back when the transaction completes; a
// failure rejects with the store's own words.
import test from "node:test";
import assert from "node:assert/strict";
import { database } from "../../web/lib/idb.js";

// Just enough of IndexedDB: open() with an upgrade the first time, one object store kind
// (a Map), transactions that complete on the next turn, and switches to make each step fail.
function fakeIdb({ failOpen = false, failTx = false, abortTx = false } = {}) {
  const stores = new Map();
  const seen = { opens: 0, closes: 0, upgrades: 0, modes: [], dbs: [] };
  const later = (fn) => setTimeout(fn, 0);
  return { seen, open(name, version) {
    seen.opens++;
    const r = { result: null, error: null, transaction: { upgrading: true } };
    later(() => {
      if (failOpen) { r.error = failOpen === "silent" ? null : new Error("blocked by the browser"); r.onerror && r.onerror(); return; }
      const db = { name, version, closed: false, onversionchange: null,
        objectStoreNames: { contains: (s) => stores.has(s) },
        createObjectStore(s) { stores.set(s, new Map()); return {}; },
        close() { this.closed = true; seen.closes++; },
        transaction(s, mode) {
          seen.modes.push(`${s}:${mode}`);
          const t = { error: null, objectStore: () => ({
            put(v, k) { const req = { result: undefined }; later(() => { stores.get(s).set(k ?? v.id, v); req.result = k ?? v.id; }); return req; },
            get(k) { const req = { result: undefined }; later(() => { req.result = stores.get(s).get(k); }); return req; },
            delete(k) { later(() => stores.get(s).delete(k)); },
          }) };
          later(() => later(() => {
            if (failTx) { t.error = failTx === "silent" ? null : new Error("quota exceeded"); t.onerror && t.onerror(); }
            else if (abortTx) t.onabort && t.onabort();
            else t.oncomplete && t.oncomplete();
          }));
          return t;
        } };
      seen.dbs.push(db);
      r.result = db;
      if (!stores.size) { seen.upgrades++; r.onupgradeneeded && r.onupgradeneeded(); }
      r.onsuccess && r.onsuccess();
    });
    return r;
  } };
}
const upgrade = (db, t) => { assert.ok(t && t.upgrading, "upgrade is handed the upgrade transaction"); if (!db.objectStoreNames.contains("marks")) db.createObjectStore("marks"); };

test("a store opened for each piece of work: the result comes back and the connection is closed", async () => {
  const idb = fakeIdb();
  const db = database({ name: "gospel-marks", label: "marks", upgrade, idb });
  assert.equal(await db.tx("marks", "readwrite", (s) => s.put({ id: "a#p1", color: "y" })), "a#p1");
  assert.deepEqual(await db.tx("marks", "readonly", (s) => s.get("a#p1")), { id: "a#p1", color: "y" });
  assert.equal(await db.tx("marks", "readwrite", (s) => { s.delete("a#p1"); }), undefined, "work that returns no request resolves with nothing");
  assert.equal(await db.tx("marks", "readonly", (s) => s.get("a#p1")), undefined);
  assert.equal(idb.seen.opens, 4);
  assert.equal(idb.seen.closes, 4);
  assert.equal(idb.seen.upgrades, 1);
  assert.deepEqual(idb.seen.modes, ["marks:readwrite", "marks:readonly", "marks:readwrite", "marks:readonly"]);
});

test("a store that keeps its connection: opened once, never closed, let go when another tab upgrades", async () => {
  const idb = fakeIdb();
  const db = database({ name: "gospel-decks", label: "decks", upgrade, keep: true, idb });
  await Promise.all([db.tx("marks", "readwrite", (s) => s.put({ title: "one" }, "deck")), db.tx("marks", "readonly", (s) => s.get("deck"))]);
  assert.deepEqual(await db.tx("marks", "readonly", (s) => s.get("deck")), { title: "one" });
  assert.equal(idb.seen.opens, 1);
  assert.equal(idb.seen.closes, 0);
  idb.seen.dbs[0].onversionchange();
  assert.equal(idb.seen.closes, 1, "the connection is closed for the other tab");
  await db.tx("marks", "readonly", (s) => s.get("deck"));
  assert.equal(idb.seen.opens, 2, "the next piece of work opens it again");
});

test("failures reject with the browser's error, or the store's own words when it gives none", async () => {
  await assert.rejects(database({ name: "x", label: "marks", upgrade, idb: fakeIdb({ failOpen: true }) }).tx("marks", "readonly", (s) => s.get(1)), /blocked by the browser/);
  await assert.rejects(database({ name: "x", label: "marks", upgrade, idb: fakeIdb({ failOpen: "silent" }) }).tx("marks", "readonly", (s) => s.get(1)), /the marks database did not open/);
  await assert.rejects(database({ name: "x", label: "studies", upgrade, idb: fakeIdb({ failTx: true }) }).tx("marks", "readwrite", (s) => s.put({ id: 1 })), /quota exceeded/);
  await assert.rejects(database({ name: "x", label: "studies", upgrade, idb: fakeIdb({ failTx: "silent" }) }).tx("marks", "readwrite", (s) => s.put({ id: 1 })), /the studies database failed/);
  const aborted = fakeIdb({ abortTx: true });
  await assert.rejects(database({ name: "x", label: "decks", upgrade, idb: aborted }).tx("marks", "readwrite", (s) => s.put({ id: 1 })), /the decks database failed/);
  assert.equal(aborted.seen.closes, 1, "a failed piece of work still closes its connection");
  // a kept connection that failed to open is tried afresh the next time
  let fail = true;
  const flaky = fakeIdb();
  const open = flaky.open.bind(flaky);
  flaky.open = (...a) => (fail ? fakeIdb({ failOpen: true }).open(...a) : open(...a));
  const db = database({ name: "x", label: "decks", upgrade, keep: true, idb: flaky });
  await assert.rejects(db.tx("marks", "readonly", (s) => s.get(1)), /blocked/);
  fail = false;
  assert.equal(await db.tx("marks", "readonly", (s) => s.get(1)), undefined);
});
