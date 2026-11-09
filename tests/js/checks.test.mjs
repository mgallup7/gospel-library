// web/lib/checks.js: which update the banner offers (a delta, or the whole library), and when
// setup says "Update this iPhone or iPad first".
import test from "node:test";
import assert from "node:assert/strict";
import { pickDelta, DELTA_MAX_BYTES, looksLikeIos, iosVersion, needsNewerIos } from "../../web/lib/checks.js";

const UA = {
  iphone163: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
  iphone17: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  ipadSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  ipadHomeScreen: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  chromeIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};
const CAN = { syncAccess: true, syncMethods: true };

test("iosVersion reads the iOS of an iPhone, or an iPad's Safari, and nothing else", () => {
  assert.deepEqual(iosVersion(UA.iphone163, true), [16, 3]);
  assert.deepEqual(iosVersion(UA.chromeIos, true), [17, 0]);
  assert.deepEqual(iosVersion(UA.ipadSafari, true), [17, 0]);
  assert.equal(iosVersion(UA.ipadHomeScreen, true), null);
  assert.equal(iosVersion(UA.ipadSafari, false), null);
  assert.equal(iosVersion(UA.chromeMac, false), null);
});

test("looksLikeIos takes a touch Mac for an iPad, even with no version", () => {
  assert.equal(looksLikeIos(UA.ipadHomeScreen, true), true);
  assert.equal(looksLikeIos(UA.iphone17, true), true);
  assert.equal(looksLikeIos(UA.ipadSafari, false), false);
  assert.equal(looksLikeIos(UA.chromeMac, false), false);
  assert.equal(looksLikeIos(undefined, false), false);
});

test("needsNewerIos goes by the engine's report, never by the user agent alone", () => {
  // the iPad home-screen app that names no version, without sync access handles: the message
  assert.equal(needsNewerIos({ syncAccess: false, syncMethods: false }, UA.ipadHomeScreen, true), true);
  // the older WebKit whose handles return promises
  assert.equal(needsNewerIos({ syncAccess: true, syncMethods: false }, UA.iphone163, true), true);
  // a browser that passes never sees it, whatever its user agent says
  for (const ua of Object.values(UA)) assert.equal(needsNewerIos(CAN, ua, true), false);
  assert.equal(needsNewerIos({ syncAccess: true, syncMethods: null }, UA.iphone163, true), false);
  // no report: the engine tries
  assert.equal(needsNewerIos(null, UA.iphone163, true), false);
  // not an iPhone or iPad: the engine keeps the library in memory as before
  assert.equal(needsNewerIos({ syncAccess: false, syncMethods: false }, UA.chromeMac, false), false);
});

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
