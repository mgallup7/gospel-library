// Small decisions the interface makes about the device and the library update, kept apart
// so they can be tested in node (tests/js/checks.test.mjs).

// A delta is worth it only when it is much smaller than the whole library, and never past an
// absolute size: the engine holds the delta in memory while it applies it, which an iPhone
// cannot spare for a hundred megabytes. Above either line the whole library is installed.
export const DELTA_MAX_SHARE = 0.6;
export const DELTA_MAX_BYTES = 40 * 1048576;
export function pickDelta(manifest, version) {
  if (!manifest || !version) return null;
  return (manifest.deltas || []).find((d) => d.from === version && d.size < manifest.bundle_size * DELTA_MAX_SHARE && d.size <= DELTA_MAX_BYTES) || null;
}

// The engine keeps the library in OPFS through sync access handles in a worker, which iOS has
// from 16.4. Whether this browser has them is the engine's report (engine.js features); the
// user agent only says whether this is an iPhone or iPad, and which iOS, for the wording.
// iPadOS asks for desktop pages and reports itself as a Mac, so a Mac with a touch screen
// counts as an iPad; its home-screen app may name no Safari version at all.
export function looksLikeIos(ua, touch) {
  return /iPhone|iPad|iPod/.test(ua || "") || (!!touch && /Macintosh/.test(ua || ""));
}
// [major, minor] on an iPhone or iPad when the user agent says, else null
export function iosVersion(ua, touch) {
  let m = /(?:iPhone|iPad|iPod)[^)]*? OS (\d+)(?:_(\d+))?/.exec(ua || "");
  if (!m && touch && /Macintosh/.test(ua || "")) m = /Version\/(\d+)(?:\.(\d+))?.*Safari\//.exec(ua);
  return m ? [Number(m[1]), Number(m[2] || 0)] : null;
}
// The "update iOS first" page shows only on an iPhone or iPad whose engine reported that it
// cannot keep the library; a browser that passes the check never sees it, whatever its user
// agent says, and a report that never came (null) lets the engine try.
export function needsNewerIos(features, ua, touch) {
  if (!features) return false;
  if (features.syncAccess && features.syncMethods !== false) return false;
  return looksLikeIos(ua, touch);
}
