/* Sync between devices: highlights and notes made on one device appear on the others.

   There is no server. The owner names a private repository on his own GitHub account and
   pastes an access token for it into Settings on each device; the app keeps one file there,
   marks.json.enc, read and written with GitHub's contents API straight from the browser.
   The file is sealed with the library passphrase the device already holds (AES-GCM, the key
   from PBKDF2), so GitHub stores it and cannot read it. Its form:

     { "v": 1, "salt": base64 of 16 bytes, "iv": base64 of 12 bytes, "data": base64 }

   and data, opened, is JSON with one list per store: { "marks": [ ...records ] }. A store is
   anything with dump(), merge(records) and onChange(fn) whose records carry an id and an
   updated time (a removal is a record too: { id, deleted: true, updated }); marks are the
   only one today, and Sync.register(name, store) takes another.

   A sync pulls the file, opens it, hands each list to its store's merge (newer wins, per
   id), and writes the file back only if this device holds something the file does not.
   GitHub refuses a write made against an older copy of the file; the answer to that is to
   pull again, merge and try again, so two devices writing at once both keep their marks.
   Nothing here ever replaces what a device holds: it only merges.

   Only long-supported browser APIs: fetch, WebCrypto, TextEncoder, btoa and atob. Nothing is
   compressed. The token is kept in localStorage (gospel.syncToken), is struck out of the
   error log (lib/log.js) and is in no export. */

export const FILE = "marks.json.enc";
export const ITERATIONS = 310000;
const API = "https://api.github.com";
const BACKOFF = [400, 1200, 3000]; // before the second, third and fourth attempt at a refused write

// ---- bytes and base64 -------------------------------------------------------
// In pieces, so a file of several megabytes does not become one function call's arguments.
export function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(text) {
  const s = atob(String(text).replace(/\s+/g, "")); // GitHub breaks its base64 into lines
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---- the seal -----------------------------------------------------------------
// A failure the owner can act on: code says which, message says it in plain words.
function problem(code, message) { return Object.assign(new Error(message), { code }); }

export async function deriveKey(passphrase, salt, subtle = globalThis.crypto.subtle) {
  const base = await subtle.importKey("raw", new TextEncoder().encode(String(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/**
 * text sealed with the passphrase, as the file's JSON. salt: the one the file already has
 * (so a device derives its key once), or none for a new one; the IV is new on every write.
 * keyFor(passphrase, salt) may hand back a key already derived.
 */
export async function seal(text, passphrase, { salt = null, keyFor = deriveKey, crypto = globalThis.crypto } = {}) {
  const s = salt || crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(passphrase, s);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)));
  return JSON.stringify({ v: 1, salt: toB64(s), iv: toB64(iv), data: toB64(data) });
}

/** The text inside a sealed file, and the salt it was sealed with. */
export async function unseal(fileText, passphrase, { keyFor = deriveKey, crypto = globalThis.crypto } = {}) {
  let f = null, salt, iv, data;
  try { f = JSON.parse(fileText); salt = fromB64(f.salt); iv = fromB64(f.iv); data = fromB64(f.data); } catch (_) { f = null; }
  if (!f || f.v !== 1 || salt.length !== 16 || iv.length !== 12) throw problem("format", `The file ${FILE} in that repository is not one this app wrote. Nothing was changed.`);
  const key = await keyFor(passphrase, salt);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data); }
  catch (_) { throw problem("passphrase", "The synced file was sealed with a different library passphrase than the one on this device, so it cannot be opened here. Nothing was changed."); }
  return { text: new TextDecoder().decode(plain), salt };
}

// ---- words --------------------------------------------------------------------
export function ago(then, now) {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "day" : "days"} ago`;
}

const live = (list) => (Array.isArray(list) ? list.filter((r) => r && !r.deleted).length : 0);
// what a store's list may hold: records with an id and a time, nothing else
const records = (list) => (Array.isArray(list) ? list.filter((r) => r && typeof r === "object" && typeof r.id === "string" && Number.isFinite(r.updated)) : []);

// ---- the engine of it ----------------------------------------------------------
/**
 * store: get(k, default), set(k, v), del(k) over the device's small settings (the app's own);
 * passphrase(): the library passphrase; fetch, crypto: the browser's; online(): false when the
 * device knows it has no network; wait(ms): the pause between attempts; log(where, err).
 */
export function makeSync({ store, passphrase, fetch: doFetch = globalThis.fetch, crypto = globalThis.crypto, online = () => true, now = () => Date.now(),
  wait = (ms) => new Promise((done) => setTimeout(done, ms)), log = () => {}, debounce = 5000 } = {}) {
  const stores = new Map();
  const listeners = new Set();
  let running = null, again = false, error = "", notice = "", lastTry = 0, timer = null;
  let seen = null; // the file as last read or written: { sha, data, salt }
  let keyKept = null; // one derived key, for the salt and passphrase it was made from

  const config = () => ({ owner: store.get("syncOwner", "") || "", repo: store.get("syncRepo", "") || "", token: store.get("syncToken", "") || "" });
  const connected = () => { const c = config(); return !!(c.owner && c.repo && c.token); };
  const emit = () => { for (const fn of [...listeners]) { try { fn(status()); } catch (_) {} } };

  function status() {
    const kept = store.get("syncState", null) || {};
    const st = { connected: connected(), syncing: !!running, at: kept.at || 0, count: kept.count || 0, error, notice };
    const n = `${st.count.toLocaleString("en-US")} ${st.count === 1 ? "highlight or note" : "highlights and notes"}`;
    st.text = !st.connected ? "Not connected. Highlights and notes stay on this device alone."
      : st.syncing ? "Syncing…"
      : error ? `${error}${st.at ? ` Last synced ${ago(st.at, now())}.` : ""}`
      : st.at ? `Synced ${ago(st.at, now())}, ${n}.${notice ? ` ${notice}` : ""}`
      : "Connected. Not synced yet.";
    return st;
  }

  async function keyFor(pass, salt) {
    const id = toB64(salt);
    if (keyKept && keyKept.id === id && keyKept.pass === pass) return keyKept.key;
    const key = await deriveKey(pass, salt, crypto.subtle);
    keyKept = { id, pass, key };
    return key;
  }

  // One call to GitHub. A refusal comes back as a problem in plain words; `missing` lets a 404
  // through to the caller, and `conflict` a write refused for being made against an old copy.
  async function gh(method, path, { body = null, raw = false, missing = false } = {}) {
    const { owner, repo, token } = config();
    const name = `${owner}/${repo}`;
    let res;
    try {
      res = await doFetch(`${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${path}`, {
        method, cache: "no-store", // GitHub lets a browser keep an answer for a minute; a sync needs the file as it is now
        headers: { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_) { throw problem("network", "Could not reach GitHub just now. It will try again the next time the app is opened or comes back online."); }
    if (res.ok) return res;
    const left = res.headers && res.headers.get ? res.headers.get("x-ratelimit-remaining") : null;
    if (res.status === 401) throw problem("token", "GitHub did not accept the token. It may have expired or been copied short. Make a new one and paste it here.");
    if (res.status === 429 || (res.status === 403 && (left === "0" || (res.headers && res.headers.get && res.headers.get("retry-after"))))) throw problem("rate", "GitHub asked this device to wait: too many requests in a short time. It will try again later.");
    if (res.status === 403) throw problem("forbidden", `GitHub refused. The token needs Contents set to "Read and write" for ${name}.`);
    if (res.status === 404 && missing) return res;
    if (res.status === 404) throw problem("repo", `GitHub has no repository ${name} that this token can see. Check the user name and the repository name, and that the token was given access to that repository.`);
    if ((res.status === 409 || res.status === 422) && method === "PUT") throw problem("conflict", "Another device wrote at the same moment. It will try again.");
    throw problem("github", `GitHub answered with an error (${res.status}). It will try again later.`);
  }

  // The file as it is now: { sha, data, salt }; sha null when there is no file yet.
  async function pull() {
    const res = await gh("GET", `/contents/${FILE}`, { missing: true });
    if (res.status === 404) {
      await gh("GET", ""); // the repository itself: gone, misnamed or out of the token's reach says so here
      return { sha: null, data: {}, salt: null };
    }
    const j = await res.json();
    if (seen && seen.sha && seen.sha === j.sha) return seen;
    // up to 1 MB the answer carries the file; past that it is fetched whole by its sha
    const text = j.encoding === "base64" && j.content ? new TextDecoder().decode(fromB64(j.content)) : j.size ? await (await gh("GET", `/git/blobs/${j.sha}`, { raw: true })).text() : "";
    if (!text.trim()) return (seen = { sha: j.sha, data: {}, salt: null }); // an empty file made by hand: filled on the first write
    const opened = await unseal(text, passphrase(), { keyFor, crypto });
    let data = null;
    try { data = JSON.parse(opened.text); } catch (_) { data = null; }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw problem("format", `The file ${FILE} in that repository is not one this app wrote. Nothing was changed.`);
    return (seen = { sha: j.sha, data, salt: opened.salt });
  }

  // Does this device hold a record the file lacks, or a newer one?
  function ahead(local, remote) {
    for (const name of Object.keys(local)) {
      const theirs = new Map(records(remote[name]).map((r) => [r.id, r.updated]));
      for (const r of local[name]) { const t = theirs.get(r.id); if (t === undefined || t < r.updated) return true; }
    }
    return false;
  }

  async function once() {
    if (!online()) { error = "Offline. It will sync when the device is online again."; return; }
    if (!passphrase()) { error = "The library passphrase is not on this device yet. Open the library first."; return; }
    lastTry = now();
    for (let attempt = 0; ; attempt++) {
      const remote = await pull();
      const local = {};
      for (const [name, s] of stores) {
        const theirs = records(remote.data[name]);
        if (theirs.length) await s.merge(theirs);
        local[name] = records(await s.dump());
      }
      if (remote.sha && remote.salt && !ahead(local, remote.data)) return done(local);
      // lists this device has no store for (a newer app on another device) go back as they came
      const body = { ...remote.data, ...local };
      const sealed = await seal(JSON.stringify(body), passphrase(), { salt: remote.salt, keyFor, crypto });
      try {
        const res = await gh("PUT", `/contents/${FILE}`, { body: { message: "Sync from a device", content: btoa(sealed), ...(remote.sha ? { sha: remote.sha } : {}) } });
        const j = await res.json().catch(() => null);
        const sha = j && j.content && j.content.sha;
        seen = sha ? { sha, data: body, salt: fromB64(JSON.parse(sealed).salt) } : null;
        return done(local);
      } catch (err) {
        seen = null;
        if (err.code !== "conflict" || attempt >= BACKOFF.length) throw err;
        await wait(BACKOFF[attempt] + Math.floor(Math.random() * 200));
      }
    }
  }
  function done(local) {
    error = "";
    const count = "marks" in local ? live(local.marks) : Object.values(local).reduce((n, l) => n + live(l), 0);
    store.set("syncState", { at: now(), count });
  }

  /** Pull, merge, push if needed. Never throws: the outcome is in status(). */
  function sync() {
    if (!connected()) return Promise.resolve(status());
    if (running) { again = true; return running; }
    if (timer) { clearTimeout(timer); timer = null; }
    running = (async () => {
      try {
        do {
          again = false;
          try { await once(); }
          catch (err) {
            error = err && err.code ? err.message : "Sync stopped on an error. It will try again later.";
            if (!err || err.code !== "network") log("sync", err);
          }
        } while (again && !error);
      } finally { running = null; }
      emit();
      return status();
    })();
    emit();
    return running;
  }

  /** A store joins: { dump, merge, onChange }. A local write is synced a few seconds after the last one. */
  function register(name, s) {
    if (!s || typeof s.dump !== "function" || typeof s.merge !== "function") return false;
    stores.set(name, s);
    if (typeof s.onChange === "function") s.onChange((e) => { if (!e || e.local !== false) changed(); });
    return true;
  }
  function changed() {
    if (!connected()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sync(); }, debounce);
  }
  /** The app came back to the front: at most one sync a minute this way. */
  function woke() { if (connected() && now() - lastTry >= 60000) sync(); }
  /** The app is leaving the front with a change not yet sent: send it now rather than in five seconds. */
  function flush() { if (timer) sync(); }

  /** The names and the token, as typed. A token left empty keeps the one already there. */
  async function connect({ owner, repo, token } = {}) {
    let o = String(owner || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/^@/, "");
    let r = String(repo || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
    if (r.includes("/")) { const parts = r.split("/").filter(Boolean); if (parts.length >= 2) { o = o || parts[0]; r = parts[1]; } }
    o = o.split("/")[0];
    const t = String(token || "").trim() || config().token;
    if (!o || !r || !t) { error = !t ? "Paste the token first." : "Fill in your GitHub user name and the repository's name first."; emit(); return status(); }
    if (/\s/.test(t)) { error = "That does not look like a token: it has a space in it."; emit(); return status(); }
    if (o !== config().owner || r !== config().repo) { store.del("syncState"); seen = null; }
    store.set("syncOwner", o); store.set("syncRepo", r); store.set("syncToken", t);
    error = ""; notice = "";
    if (running) await running;
    try {
      const info = await (await gh("GET", "")).json();
      if (info && info.private === false) notice = "That repository is public. The file is sealed, but make the repository private on github.com.";
    } catch (err) { error = err && err.code ? err.message : "Could not check the repository."; if (!err || err.code !== "network") log("sync", err); emit(); return status(); }
    return sync();
  }
  /** Forget the token. The marks stay on the device and in the file; the names stay for next time. */
  function disconnect() {
    if (timer) { clearTimeout(timer); timer = null; }
    store.del("syncToken"); store.del("syncState");
    error = ""; notice = ""; seen = null; keyKept = null;
    emit();
    return status();
  }
  const onStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  return { register, sync, connect, disconnect, status, onStatus, config, changed, woke, flush, stores: () => [...stores.keys()] };
}

// ---- in the app ----------------------------------------------------------------
if (typeof window !== "undefined" && typeof document !== "undefined") (() => {
  "use strict";
  const GL = window.GL;
  if (!GL || !GL.store) return;
  const { el } = GL;
  const sync = makeSync({
    store: GL.store,
    passphrase: () => (GL.passphrase ? GL.passphrase() : ""),
    fetch: (...a) => window.fetch(...a),
    online: () => navigator.onLine !== false,
    log: (where, err) => { window.GLLog?.note(where, err); },
  });
  let started = false;
  const joinMarks = () => { if (!sync.stores().includes("marks") && window.Marks) sync.register("marks", window.Marks); };

  // Called by app.js once the library is open (and from here, if the library opened first).
  function start() {
    joinMarks();
    if (started) return;
    started = true;
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") sync.woke(); else sync.flush(); });
    window.addEventListener("online", () => { sync.sync(); });
    sync.sync();
  }

  // The section of the Settings screen: what it is, the steps, three fields, three buttons, one line of status.
  function settingsBox() {
    const c = sync.config();
    const field = (label, input, sub) => el("label", {}, [el("span", { class: "lb", text: label }), input, sub ? el("span", { class: "sub", text: sub }) : null]);
    const plain = { autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false" };
    const owner = el("input", { type: "text", class: "sync-owner", value: c.owner, placeholder: "your-user-name", "aria-label": "GitHub user name", ...plain });
    const repo = el("input", { type: "text", class: "sync-repo", value: c.repo || "gospel-library-sync", "aria-label": "Repository name", ...plain });
    const token = el("input", { type: "password", class: "sync-token", "aria-label": "Access token", ...plain });
    const said = el("p", { class: "set-said sync-said", role: "status" });
    const connectBtn = el("button", { type: "button", class: "primary sync-connect", text: "Connect" });
    const nowBtn = el("button", { type: "button", class: "text-btn sync-now", text: "Sync now" });
    const offBtn = el("button", { type: "button", class: "text-btn sync-off", text: "Disconnect" });
    const steps = el("details", { class: "sync-steps" }, [
      el("summary", { text: "How to set it up (once, about five minutes)" }),
      el("ol", {}, [
        el("li", { text: "On github.com, create a new repository named gospel-library-sync and choose Private." }),
        el("li", { text: "Tap your picture, then Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token. Choose the longest expiration offered." }),
        el("li", { text: "Under Repository access, choose \"Only select repositories\" and pick that one repository." }),
        el("li", { text: "Under Permissions, Repository permissions, set Contents to \"Read and write\". Generate the token and copy it." }),
        el("li", { text: "Paste the token here with your GitHub user name and tap Connect. Do the same on each device; the same token works on all of them." }),
      ]),
      el("p", { class: "set-note", text: "When the token expires, this section says so. Make a new one the same way and paste it on each device; nothing is lost in between." }),
    ]);
    const draw = (st = sync.status()) => {
      if (!said.isConnected && said.dataset.drawn) return off();
      said.dataset.drawn = "1";
      said.textContent = st.text;
      said.classList.toggle("bad", !!st.error);
      token.placeholder = sync.config().token ? "Saved. Paste a new one to replace it." : "Paste the token";
      connectBtn.disabled = st.syncing; nowBtn.disabled = st.syncing || !st.connected; offBtn.disabled = !st.connected;
      nowBtn.hidden = offBtn.hidden = !st.connected;
    };
    const off = sync.onStatus(draw);
    connectBtn.addEventListener("click", async () => {
      said.textContent = "Connecting…"; said.classList.remove("bad"); connectBtn.disabled = true;
      const st = await sync.connect({ owner: owner.value, repo: repo.value, token: token.value });
      token.value = "";
      const now = sync.config();
      if (now.owner) owner.value = now.owner;
      if (now.repo) repo.value = now.repo;
      if (st.connected && !st.error) steps.open = false;
      draw();
    });
    nowBtn.addEventListener("click", async () => { await sync.sync(); draw(); });
    offBtn.addEventListener("click", () => { sync.disconnect(); token.value = ""; draw(); said.textContent = "Disconnected. The token was removed from this device; your highlights and notes are still here."; });
    steps.open = !sync.status().connected;
    draw();
    return el("div", { class: "sync-set" }, [
      el("p", { class: "set-note", text: "Highlights and notes made on one device appear on your others, a few seconds after you make them. They are kept in one file in a private repository on your own GitHub account, sealed with your library passphrase, so GitHub holds the file and cannot read it." }),
      steps,
      field("GitHub user name", owner),
      field("Repository", repo),
      field("Access token", token, "Kept on this device only. It is never in a backup file or in the error log."),
      el("div", { class: "set-acts" }, [connectBtn, nowBtn, offBtn]),
      said,
    ]);
  }

  window.Sync = { register: sync.register, start, syncNow: sync.sync, connect: sync.connect, disconnect: sync.disconnect, status: sync.status, onStatus: sync.onStatus, settingsBox };
  joinMarks();
  if (GL.ready) start();
})();
