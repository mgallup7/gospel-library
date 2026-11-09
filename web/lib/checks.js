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
