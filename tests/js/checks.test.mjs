// web/lib/checks.js: which update the banner offers (a delta, or the whole library).
import test from "node:test";
import assert from "node:assert/strict";
import { pickDelta, DELTA_MAX_BYTES } from "../../web/lib/checks.js";

const MB = 1048576;
const manifest = (deltas, bundle = 220 * MB) => ({ version: "v9", bundle_size: bundle, deltas });

test("pickDelta takes the delta from this build when it is small", () => {
  const d = { from: "v8", size: 0.6 * MB };
  assert.equal(pickDelta(manifest([{ from: "v7", size: MB }, d]), "v8"), d);
});

test("pickDelta finds nothing for another build, or without a version", () => {
  assert.equal(pickDelta(manifest([{ from: "v7", size: MB }]), "v8"), null);
  assert.equal(pickDelta(manifest([{ from: "v8", size: MB }]), null), null);
  assert.equal(pickDelta({ bundle_size: 1 }, "v8"), null);
  assert.equal(pickDelta(null, "v8"), null);
});

test("pickDelta refuses a delta past 60 % of the bundle", () => {
  assert.equal(pickDelta(manifest([{ from: "v8", size: 7 * MB }], 10 * MB), "v8"), null);
  assert.ok(pickDelta(manifest([{ from: "v8", size: 5 * MB }], 10 * MB), "v8"));
});

test("pickDelta refuses a delta past 40 MB, however large the bundle", () => {
  assert.equal(DELTA_MAX_BYTES, 40 * MB);
  assert.ok(pickDelta(manifest([{ from: "v8", size: 40 * MB }]), "v8"));
  assert.equal(pickDelta(manifest([{ from: "v8", size: 40 * MB + 1 }]), "v8"), null);
  assert.equal(pickDelta(manifest([{ from: "v8", size: 130 * MB }], 400 * MB), "v8"), null);
});
