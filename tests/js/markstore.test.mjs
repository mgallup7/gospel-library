// web/lib/markstore.js: the rules two devices follow when they trade their marks. Each device
// here is a Map with its own clock, written to as marks.js writes (a change is dated by stamp,
// a removal leaves a tombstone) and merged as marks.js merges (mergeRecords). Whatever is done
// on either, in either order, both hold the same records once each has had the other's.
import test from "node:test";
import assert from "node:assert/strict";
import { clean, wins, mergeRecords, stale, stamp, TOMB_MS } from "../../web/lib/markstore.js";

function device(clock) {
  const rows = new Map();
  const d = {
    now: clock,
    write(fields) { d.now += 10; const old = rows.get(clean({ ...fields, updated: 1 }).id); const rec = { ...clean({ ...fields, updated: 1 }), updated: stamp(old, d.now) }; rows.set(rec.id, rec); return rec; },
    remove(id) { d.now += 10; const old = rows.get(id); if (old && !old.deleted) rows.set(id, { id, deleted: true, updated: stamp(old, d.now) }); },
    dump() { return [...rows.values()].map((r) => ({ ...r })); },
    merge(records) { const put = mergeRecords(rows, records, d.now); for (const r of put) rows.set(r.id, r); return { changed: put.length }; },
    live() { return d.dump().filter((r) => !r.deleted).sort((a, b) => (a.id < b.id ? -1 : 1)); },
    all() { return d.dump().sort((a, b) => (a.id < b.id ? -1 : 1)); },
  };
  return d;
}
// each takes the other's, one way round or the other
function trade(a, b, aFirst = true) {
  if (aFirst) { b.merge(a.dump()); a.merge(b.dump()); } else { a.merge(b.dump()); b.merge(a.dump()); }
}
const verse = (pid, more) => ({ uri: "/scriptures/bofm/alma/32", pid, kind: "verse", verse: Number(pid.slice(1)), text: "words", citation: `Alma 32:${pid.slice(1)}`, ...more });
const phrase = (pid, start, end, color) => ({ uri: "/scriptures/bofm/alma/32", pid, kind: "phrase", start, end, color, text: "some words", citation: "Alma 32:21" });
const word = (seq, color) => ({ id: `orig:rev.3.16.${seq}:gr`, kind: "word", color, text: "χλιαρός lukewarm", citation: "Revelation 3:16", strongs: "G5513", uri: "/scriptures/nt/rev/3", pid: "p16" });

for (const aFirst of [true, false]) {
  test(`two devices converge under add, edit, recolor, remove and re-add (${aFirst ? "the iPad" : "the iPhone"} goes first)`, () => {
    const ipad = device(1000000), iphone = device(1000500); // the clocks need not agree
    // add on each, different marks
    ipad.write(verse("p21", { color: "y" }));
    iphone.write(phrase("p21", 3, 6, "g"));
    iphone.write(word(4, "b"));
    trade(ipad, iphone, aFirst);
    assert.deepEqual(ipad.all(), iphone.all());
    assert.equal(ipad.live().length, 3);
    // edit (a note) on one, recolor on the other, of different marks
    ipad.write(verse("p21", { color: "y", note: "faith is not a perfect knowledge" }));
    iphone.write(phrase("p21", 3, 6, "p"));
    trade(ipad, iphone, aFirst);
    assert.deepEqual(ipad.all(), iphone.all());
    assert.equal(ipad.live().find((r) => r.kind === "verse").note, "faith is not a perfect knowledge");
    assert.equal(ipad.live().find((r) => r.kind === "phrase").color, "p");
    // remove on one: the other loses it too, and keeps the tombstone to pass on
    iphone.remove("orig:rev.3.16.4:gr");
    trade(ipad, iphone, aFirst);
    assert.deepEqual(ipad.all(), iphone.all());
    assert.equal(ipad.live().length, 2);
    assert.equal(ipad.all().filter((r) => r.deleted).length, 1);
    // re-add on the device that did not remove it: the mark is back on both
    ipad.write(word(4, "y"));
    trade(ipad, iphone, aFirst);
    assert.deepEqual(ipad.all(), iphone.all());
    assert.equal(iphone.live().find((r) => r.kind === "word").color, "y");
    // the same mark changed on both before they meet: the later change stands on both
    ipad.now = 2000000; iphone.now = 2000000;
    ipad.write(verse("p21", { color: "g" }));
    iphone.now += 50;
    iphone.remove("/scriptures/bofm/alma/32#p21");
    trade(ipad, iphone, aFirst);
    assert.deepEqual(ipad.all(), iphone.all());
    assert.equal(ipad.live().some((r) => r.kind === "verse"), false, "the later removal wins over the earlier recolor");
    // a second trade changes nothing
    assert.equal(ipad.merge(iphone.dump()).changed, 0);
    assert.equal(iphone.merge(ipad.dump()).changed, 0);
  });
}

test("a change at the very same instant still ends the same on both", () => {
  const a = device(5000), b = device(5000);
  a.write(verse("p3", { color: "y" }));
  b.write(verse("p3", { color: "b" }));
  trade(a, b, true);
  assert.deepEqual(a.all(), b.all());
  const c = device(5000), d = device(5000);
  c.write(verse("p3", { color: "y" }));
  d.write(verse("p3", { color: "b" }));
  trade(c, d, false);
  assert.deepEqual(c.all(), a.all(), "and the same whichever went first");
  // a removal and a change at one instant: the removal
  assert.equal(wins({ id: "x", deleted: true, updated: 7 }, { id: "x", color: "y", updated: 7 }), true);
  assert.equal(wins({ id: "x", color: "y", updated: 7 }, { id: "x", deleted: true, updated: 7 }), false);
});

test("a change made here is always later than the record it changes", () => {
  assert.equal(stamp({ updated: 900 }, 500), 901, "the other device's clock ran ahead");
  assert.equal(stamp({ updated: 100 }, 500), 500);
  assert.equal(stamp(null, 500), 500);
});

test("records are checked field by field, whatever sent them", () => {
  assert.equal(clean(null), null);
  assert.equal(clean({ uri: "/a", pid: "p1" }), null, "neither color nor note");
  assert.deepEqual(clean({ id: "anything", deleted: true, updated: 5, color: "y" }), { id: "anything", deleted: true, updated: 5 });
  assert.equal(clean({ deleted: true, updated: 5 }), null);
  const v = clean({ uri: "/a", pid: "p1", color: "y", note: " n ", pid_end: "p9\"><img>", verse_end: "x", junk: 1, updated: 3 });
  assert.equal(v.id, "/a#p1");
  assert.equal(v.kind, "verse");
  assert.equal(v.note, "n");
  assert.equal(v.pid_end, null);
  assert.equal("junk" in v, false);
  assert.equal(clean({ uri: "/a", pid: "p1", color: "red", note: "" }), null);
  const p = clean({ id: "made up", uri: "/a", pid: "p1", kind: "phrase", start: 2, end: 4, color: "g", text: "x".repeat(900), updated: 3 });
  assert.equal(p.id, "/a#p1~2-4", "the id is made from the fields, not taken on trust");
  assert.equal(p.text.length, 400);
  assert.equal(clean({ uri: "/a", pid: "p1", kind: "phrase", start: 4, end: 2, color: "g" }), null);
  assert.equal(clean({ uri: "/a", pid: "p1", kind: "phrase", start: 1.5, end: 2, color: "g" }), null);
  assert.equal(clean({ uri: "/a", pid: "p1", kind: "phrase", start: 1, end: 2 }), null, "a phrase has a color");
  const w = clean({ id: "orig:rev.3.16.4:gr", kind: "word", color: "b", text: "χλιαρός lukewarm", strongs: "G5513", updated: 3 });
  assert.equal(w.lang, "gr");
  assert.equal(w.strongs, "G5513");
  assert.equal(clean({ id: "orig:rev.3.16.4:xx", kind: "word", color: "b" }), null);
  assert.equal(clean({ id: "orig:rev.3.16.4:gr\"><img>", kind: "word", color: "b" }), null);
  assert.equal(clean({ id: "orig:rev.3.16.4:gr", kind: "word" }), null);
});

test("old records load: one from before phrases and tombstones merges as a verse mark", () => {
  const mine = new Map([["/a#p1", { id: "/a#p1", uri: "/a", pid: "p1", kind: "verse", color: "y", note: null, text: "t", citation: "c", title: "", doc_id: 4, verse: 1, created: 10, updated: 10 }]]);
  // the same record come back from another device, in its checked shape: nothing to write
  assert.equal(mergeRecords(mine, [{ ...mine.get("/a#p1") }]).length, 0);
  assert.equal(mergeRecords(mine, [{ ...mine.get("/a#p1"), color: "g", updated: 11 }]).length, 1);
  assert.equal(mergeRecords(mine, [{ ...mine.get("/a#p1"), color: "g", updated: 9 }]).length, 0);
  assert.equal(mergeRecords(mine, [{ nonsense: true }, null, 7, "x"]).length, 0);
  assert.equal(mergeRecords(mine, "not a list").length, 0);
});

test("a tombstone is kept 180 days, then dropped and no longer taken", () => {
  const now = 1e12;
  assert.equal(stale({ id: "x", deleted: true, updated: now - TOMB_MS - 1 }, now), true);
  assert.equal(stale({ id: "x", deleted: true, updated: now - TOMB_MS + 1 }, now), false);
  assert.equal(stale({ id: "x", color: "y", updated: 1 }, now), false, "a mark is never dropped for its age");
  assert.equal(mergeRecords(new Map(), [{ id: "x", deleted: true, updated: now - TOMB_MS - 1 }], now).length, 0);
  assert.equal(mergeRecords(new Map(), [{ id: "x", deleted: true, updated: now - 5 }], now).length, 1);
});
