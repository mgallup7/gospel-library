// web/semantic.js: the meaning index as a file. What is unpacked must be what was packed, rank
// the same, and anything that is not exactly that file for that library must be refused.
import test from "node:test";
import assert from "node:assert/strict";
import { BitIndex, packIndex, unpackIndex } from "../../web/semantic.js";

const DIMS = 384, BYTES = DIMS >> 3;
// a small index of made-up bits, and a query; the same numbers every run
function sample(n = 500, rows = 1700) {
  let x = 12345;
  const next = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0);
  const ids = new Int32Array(n).map((_, i) => 3 * i + 2);
  const docs = new Int32Array(n).map((_, i) => 1 + (i >> 4));
  const rowDocs = new Int32Array(rows).map((_, r) => 1 + Math.floor(r / 48));
  const bits = new Uint8Array(n * BYTES).map(() => next() >>> 24);
  const q = new Float32Array(DIMS).map(() => (next() / 2 ** 32) - 0.5);
  return { ids, docs, rowDocs, bits, q };
}
function fileOf(packed) {
  const out = new Uint8Array(packed.length);
  let at = 0;
  for (const p of packed.parts) { out.set(p, at); at += p.byteLength; }
  assert.equal(at, packed.length, "the parts add up to the length the header states");
  return out;
}

test("an index packed and unpacked is the same index", () => {
  const s = sample();
  const bytes = fileOf(packIndex({ key: "abc|bge|384", dims: DIMS, ...s }));
  const u = unpackIndex(bytes.buffer, "abc|bge|384");
  assert.ok(u);
  assert.equal(u.dims, DIMS);
  assert.deepEqual(Array.from(u.ids), Array.from(s.ids));
  assert.deepEqual(Array.from(u.docs), Array.from(s.docs));
  assert.deepEqual(Array.from(u.rowDocs), Array.from(s.rowDocs));
  assert.deepEqual(Array.from(u.bits), Array.from(s.bits));
  const a = new BitIndex(s.ids, s.bits, DIMS).topK(s.q, 40), b = new BitIndex(u.ids, u.bits, u.dims).topK(s.q, 40);
  assert.deepEqual(b, a, "the same ranking and the same scores");
  const odd = (i) => i % 3 !== 0;
  assert.deepEqual(new BitIndex(u.ids, u.bits, u.dims).topK(s.q, 40, odd), new BitIndex(s.ids, s.bits, DIMS).topK(s.q, 40, odd));
});

test("an index built on part of a larger buffer packs its own part", () => {
  const s = sample(64, 300);
  const wide = new Int32Array(200); wide.set(s.ids, 10);
  const wideBits = new Uint8Array(64 * BYTES + 100); wideBits.set(s.bits, 7);
  const bytes = fileOf(packIndex({ key: "k", dims: DIMS, ids: wide.subarray(10, 74), docs: s.docs, rowDocs: s.rowDocs, bits: wideBits.subarray(7, 7 + 64 * BYTES) }));
  const u = unpackIndex(bytes.buffer, "k");
  assert.deepEqual(Array.from(u.ids), Array.from(s.ids));
  assert.deepEqual(Array.from(u.bits), Array.from(s.bits));
});

test("headers of different lengths still line the arrays up", () => {
  const s = sample(20, 90);
  for (const key of ["", "a", "ab", "abc", "abcd", "abcde", "abcdef", "abcdefg", "x".repeat(97)]) {
    const bytes = fileOf(packIndex({ key, dims: DIMS, ...s }));
    const u = unpackIndex(bytes.buffer, key);
    assert.ok(u, `key of ${key.length} characters`);
    assert.deepEqual(Array.from(u.ids), Array.from(s.ids));
  }
});

test("anything but the whole file for this library is refused", () => {
  const s = sample();
  const bytes = fileOf(packIndex({ key: "abc|bge|384", dims: DIMS, ...s }));
  assert.equal(unpackIndex(bytes.buffer, "abd|bge|384"), null, "another library");
  assert.equal(unpackIndex(bytes.buffer, "abc|other|384"), null, "another model");
  assert.equal(unpackIndex(bytes.buffer.slice(0, bytes.length - 1), "abc|bge|384"), null, "a byte short");
  assert.equal(unpackIndex(bytes.buffer.slice(0, 4096), "abc|bge|384"), null, "cut off");
  const longer = new Uint8Array(bytes.length + 1); longer.set(bytes);
  assert.equal(unpackIndex(longer.buffer, "abc|bge|384"), null, "a byte long");
  const headless = bytes.slice(); headless.fill(0, 0, 16);
  assert.equal(unpackIndex(headless.buffer, "abc|bge|384"), null, "a write that never reached its head");
  const swapped = bytes.slice(); swapped.subarray(12, 16).reverse();
  assert.equal(unpackIndex(swapped.buffer, "abc|bge|384"), null, "the other byte order");
  assert.equal(unpackIndex(null, "abc|bge|384"), null);
  assert.equal(unpackIndex(new ArrayBuffer(0), "abc|bge|384"), null);
  assert.equal(unpackIndex(new ArrayBuffer(64), "abc|bge|384"), null);
  assert.throws(() => packIndex({ key: "k", dims: DIMS, ids: s.ids, docs: s.docs.subarray(1), rowDocs: s.rowDocs, bits: s.bits }));
});
