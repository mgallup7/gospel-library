// The error log: the last 200 things that went wrong on this device, kept so the owner can
// copy them out. An iPad has no console to open, and a failure that is caught and swallowed
// (a database that will not open, a tool that threw) otherwise looks like "nothing there".
// Three ways in: an error nothing caught, a promise nothing caught, and GLLog.note(where, err)
// from a catch that carries on with a fallback. The log lives in memory and in sessionStorage
// (so a reload keeps it; closing the app ends it) and goes nowhere unless he copies it.
// The API key and the library passphrase never enter it: anything shaped like a key, and the
// stored key and passphrase themselves, are struck out of every line before it is kept.

const MAX = 200;
const KEY = "gospel.errorLog";

/** text with anything like an API key, and each of the given secrets, struck out. */
export function scrub(text, secrets = []) {
  let s = String(text ?? "").replace(/sk-ant-[A-Za-z0-9_-]*/g, "[key]");
  for (const x of secrets) if (typeof x === "string" && x.length >= 4) s = s.split(x).join("[secret]");
  return s;
}

/**
 * A log. storage: where it is kept between reloads (sessionStorage, or nothing);
 * secrets(): the strings that must never be written (the stored key and passphrase).
 */
export function makeLog({ storage = null, secrets = () => [], now = () => Date.now(), max = MAX } = {}) {
  let list = [];
  try {
    const kept = JSON.parse((storage && storage.getItem(KEY)) || "[]");
    if (Array.isArray(kept)) list = kept.filter((e) => e && typeof e.what === "string" && typeof e.where === "string").slice(-max);
  } catch (_) { list = []; }
  const save = () => { try { if (storage) storage.setItem(KEY, JSON.stringify(list)); } catch (_) {} };
  const clean = (t, n) => { let hide = []; try { hide = secrets() || []; } catch (_) {} return scrub(t, hide).slice(0, n); };

  // where: the part of the app ("marks.forDoc"); err: an Error, or anything that was thrown
  function note(where, err) {
    try {
      const e = err && typeof err === "object" ? err : null;
      const name = e && e.name && e.name !== "Error" ? `${e.name}: ` : "";
      const what = e ? `${name}${e.message || String(e)}${e.status ? ` (status ${e.status})` : ""}` : String(err);
      const stack = e && typeof e.stack === "string" ? e.stack.split("\n").slice(1, 4).map((l) => l.trim()).join(" | ") : "";
      const entry = { at: now(), where: clean(where, 80), what: clean(what, 600), stack: clean(stack, 600), n: 1 };
      const last = list[list.length - 1];
      // the same failure again (a database that stays shut) is counted, not listed 200 times
      if (last && last.where === entry.where && last.what === entry.what) { last.n = (last.n || 1) + 1; last.at = entry.at; }
      else { list.push(entry); if (list.length > max) list = list.slice(-max); }
      save();
    } catch (_) {}
  }
  const count = () => list.length;
  const entries = () => list.map((e) => ({ ...e }));
  function clear() { list = []; save(); }
  // The log as text to paste into a message: newest last, one entry to a line, its place in the code under it
  function text(about = "") {
    const head = `Gospel Library error log: ${list.length} ${list.length === 1 ? "entry" : "entries"}, copied ${new Date(now()).toISOString()}${about ? `\n${about}` : ""}`;
    if (!list.length) return `${head}\nNothing has gone wrong since the app was opened.`;
    return [head, ...list.map((e) => `${new Date(e.at).toISOString()}  ${e.where}: ${e.what}${e.n > 1 ? ` (${e.n} times)` : ""}${e.stack ? `\n    ${e.stack}` : ""}`)].join("\n");
  }
  return { note, count, entries, clear, text };
}

// In the app: one log on window, fed by whatever nothing else caught.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const stored = (k) => { try { const v = JSON.parse(localStorage.getItem(k)); return typeof v === "string" ? v : ""; } catch (_) { return ""; } };
  let session = null;
  try { session = window.sessionStorage; } catch (_) { session = null; }
  const log = makeLog({ storage: session, secrets: () => [stored("gospel.apiKey"), stored("gospel.passphrase")] });
  window.addEventListener("error", (e) => {
    if (e.error || e.message) log.note("window", e.error || `${e.message}${e.filename ? ` at ${String(e.filename).split("/").pop()}:${e.lineno}` : ""}`);
  });
  window.addEventListener("unhandledrejection", (e) => log.note("promise", e.reason === undefined ? "a promise was rejected with no reason" : e.reason));
  // something the page's policy refused (index.html): a request to another host, a script that is not the app's
  document.addEventListener("securitypolicyviolation", (e) => log.note("policy", `${e.violatedDirective} refused ${e.blockedURI || "inline"}`));
  // The whole log to the clipboard; resolves true when it got there.
  async function copy() {
    const body = log.text(navigator.userAgent);
    try { await navigator.clipboard.writeText(body); return true; } catch (_) {}
    try { // an older Safari, or a page without the clipboard permission
      const t = document.createElement("textarea");
      t.value = body; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.append(t); t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return !!ok;
    } catch (_) { return false; }
  }
  window.GLLog = { note: log.note, count: log.count, text: () => log.text(navigator.userAgent), clear: log.clear, copy };
}
