/* Gospel Library — personal edition. Plain JavaScript, no build step.
   The library lives on this device; engine.js (a Web Worker) holds it and
   answers searches. This file is the interface. */
import { shortTitle as shortTitleOf, chapterOf } from "./lib/cite.js";

(() => {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) if (c !== null && c !== undefined) node.append(c);
    return node;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const wide = () => window.matchMedia("(min-width: 760px)").matches; // two panes from an iPad in portrait up (app.css agrees)
  const monthName = (m) => (m === 4 ? "April" : m === 10 ? "October" : "");
  const mb = (n) => n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(n > 50 * 1048576 ? 0 : 1)} MB`;
  const BASE = new URL(".", document.baseURI);
  const MANIFEST_URL = new URL("data/manifest.json", BASE).href;
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem("gospel." + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem("gospel." + k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { localStorage.removeItem("gospel." + k); } catch (_) {} },
  };

  // ------------------------------------------------------------ engine ----
  const worker = new Worker(new URL("engine.js", BASE), { type: "module" });
  const pending = new Map();
  let seq = 0;
  worker.onmessage = (e) => {
    const { id, result, error, progress } = e.data;
    const p = pending.get(id);
    if (!p) return;
    if (progress) { p.onProgress && p.onProgress(progress); return; }
    pending.delete(id);
    if (error) p.reject(Object.assign(new Error(error.message), { name: error.name }));
    else p.resolve(result);
  };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || "the library engine stopped")); pending.clear(); };
  function call(method, params = {}, onProgress = null) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, method, params });
    });
  }
  const api = (method, params) => call(method, params);
  // The search model gets a worker of its own; the engine and it share a channel.
  (() => {
    try {
      const modelWorker = new Worker(new URL("model-worker.js", BASE), { type: "module" });
      modelWorker.onerror = (e) => { console.warn("the search model's worker failed:", e?.message); call("detachModel", { why: e?.message || "worker error" }).catch(() => {}); };
      const channel = new MessageChannel();
      modelWorker.postMessage({ port: channel.port1 }, [channel.port1]);
      const id = ++seq;
      pending.set(id, { resolve: () => {}, reject: () => {}, onProgress: null });
      worker.postMessage({ id, method: "attachModel", params: { port: channel.port2 } }, [channel.port2]);
    } catch (err) { console.warn("the model runs inside the engine:", err?.message); }
  })();

  // ------------------------------------------------------------- state ----
  const state = {
    q: "", scope: "all", speaker: "", from: "", to: "", book: "", group: "passages",
    docId: null, pid: null, studyId: null, terms: [], offset: 0, lastSearch: null, browse: null, ready: false, asTyped: false, view: null,
  };
  let searchSeq = 0;
  let typeTimer = null;

  const listPane = $("#list");
  const readerPane = $("#reader");
  const input = $("#q");
  const filters = $("#filters");
  const mainEl = $("main");
  // On a wide screen the deck board has a pane of its own beside the reader, in the same place:
  // one of the two shows at a time, and the other stays mounted, so the page keeps its scroll and
  // its selection while the board is up, and the board keeps its state while the page is.
  const panelPane = el("section", { id: "panel", class: "pane", hidden: true });
  readerPane.after(panelPane);

  // ----------------------------------------------------------- routing ----
  // Hash routes, so the app works from any static host. Every place has an address:
  //   #                       the library (home)
  //   #scriptures?b.book=alma a shelf, with how far into it you are
  //   #search?q=faith&scope=… results
  //   #ask  #deck             the two tabs
  // and the page open in the reader rides along on any of them as &doc=123&p=p21, or one of
  // your own pages as &s=<id> (an old #read/123 address still opens). On a phone the page
  // covers the list.
  const BROWSE_KEYS = ["year", "all", "bookUri", "book", "series"];
  function urlFor() {
    const p = new URLSearchParams();
    let base = "";
    if (state.q.trim()) {
      base = "search";
      p.set("q", state.q);
      if (state.scope !== "all") p.set("scope", state.scope);
      for (const k of ["speaker", "from", "to", "book"]) if (state[k]) p.set(k, state[k]);
      if (state.group !== "passages") p.set("group", state.group);
      if (state.view) p.set("view", state.view);
    } else if (state.browse?.tab) {
      base = state.browse.tab;
      for (const k of BROWSE_KEYS) if (state.browse[k]) p.set(`b.${k}`, String(state.browse[k]));
    }
    if (state.docId) { p.set("doc", String(state.docId)); if (state.pid) p.set("p", state.pid); }
    else if (state.studyId) p.set("s", state.studyId);
    const qs = p.toString();
    return base || qs ? `#${base}${qs ? "?" + qs : ""}` : "#";
  }
  function readUrl() {
    const h = location.hash.replace(/^#/, "");
    const qi = h.indexOf("?");
    let base = qi >= 0 ? h.slice(0, qi) : h;
    const p = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : "");
    const legacy = base.match(/^read\/(\d+)$/);
    if (legacy) { p.set("doc", legacy[1]); base = p.get("q") ? "search" : ""; }
    const searching = base === "search";
    state.q = searching ? p.get("q") || "" : "";
    state.scope = p.get("scope") || "all";
    state.speaker = searching ? p.get("speaker") || "" : "";
    state.from = searching ? p.get("from") || "" : "";
    state.to = searching ? p.get("to") || "" : "";
    state.book = searching ? p.get("book") || "" : "";
    state.group = p.get("group") || "passages";
    state.view = searching && p.get("view") === "all" ? "all" : null;
    if (!searching && /^[a-z][\w-]*$/.test(base)) {
      state.browse = { tab: base };
      for (const k of BROWSE_KEYS) { const v = p.get(`b.${k}`); if (v !== null) state.browse[k] = k === "year" ? Number(v) : k === "all" ? v === "true" : v; }
      if (!p.get("scope") && TAB_SCOPE[base]) state.scope = TAB_SCOPE[base];
    } else state.browse = null;
    state.docId = p.get("doc") ? Number(p.get("doc")) : null;
    state.pid = p.get("p") || null;
    state.studyId = !state.docId && p.get("s") ? p.get("s") : null;
  }

  // The trail. Every place you go is a history entry; history.state carries its depth within
  // this visit (n), its own name, and the name of the one before it, so the Back button can say
  // where it leads ("‹ Alma 32", "‹ Results") and work in the home-screen app, where there is no
  // browser Back, and still know its way after a reload. Each entry also remembers how far you
  // had scrolled, so coming back lands where you were.
  function here() { return history.state && Number.isInteger(history.state.n) ? history.state.n : 0; }
  function labelNow() {
    if (state.docId) return currentDoc && currentDoc.id === state.docId ? shortTitleOf(currentDoc) : "Back";
    if (state.studyId) return currentStudy && currentStudy.id === state.studyId ? shortTitleOf(currentStudy) : "Back";
    if (state.q.trim().length >= 2) return state.view === "all" ? "Every match" : "Results";
    const tab = state.browse?.tab;
    if (tab === "ask") return "Ask";
    if (tab === "deck") return "Deck";
    if (tab) return TAB_TITLE[tab] || "Shelf";
    return "Library";
  }
  function setEntry(patch) {
    const cur = history.state || {};
    history.replaceState({ n: here(), label: cur.label || null, prev: cur.prev || null, scroll: cur.scroll || null, place: cur.place || null, ...patch }, "", location.href);
  }
  // Each view names its entry once it has settled, so the next push knows what it is leaving.
  function nameEntry(label = labelNow()) { if (label !== "Back") setEntry({ label }); }
  // Where the view was scrolled, kept on the entry being left. A path that redraws before it pushes
  // calls this first; push() then keeps that reading instead of measuring the new view.
  let leavingScroll = null;
  function rememberScroll() { leavingScroll = { list: listPane.scrollTop, reader: readerPane.scrollTop, win: window.scrollY, study: studyScroll, at: Date.now() }; setEntry({ scroll: leavingScroll }); }
  // place: the kind of entry, so typing in the same place refines it instead of stacking entries
  function placeNow() { return state.q.trim() ? (state.view === "all" ? "concordance" : "search") : state.browse?.tab || "home"; }
  function push(replace = false) {
    const url = urlFor();
    if (location.hash === url || (url === "#" && !location.hash)) return;
    if (replace) { leavingScroll = null; history.replaceState({ ...(history.state || {}), n: here(), label: labelNow(), place: history.state?.place || null }, "", url); refreshTrailButtons(); return; }
    const fromOverlay = !!history.state?.overlay;
    if (!fromOverlay && (!leavingScroll || Date.now() - leavingScroll.at > 2000)) rememberScroll(); // a reading older than the move it was taken for is stale
    leavingScroll = null;
    const prev = history.state?.label || "Library";
    // leaving from inside a sheet or the stage: its marker entry becomes the new place, so Back
    // from there returns to the page under it, not to a sheet that is no longer open
    if (fromOverlay) { overlay = null; history.replaceState({ n: here() + 1, label: null, prev, scroll: null, place: null }, "", url); }
    else history.pushState({ n: here() + 1, label: null, prev, scroll: null, place: null }, "", url);
    nameEntry();
    refreshTrailButtons();
  }
  // Overlays (a sheet, the stage) sit over a place without being one. Opening one puts a marker
  // entry in history at the same address, so Back closes the overlay and nothing else; closing it
  // by hand pops that marker. The place's scroll is kept on its own entry before the marker goes on.
  let overlay = null;          // "sheet" or "stage" while one is open with a marker entry
  let poppingOverlay = false;  // a Back we asked for, to pop a marker: nothing to render on it
  function openOverlay(kind) {
    if (overlay) return;
    rememberScroll(); leavingScroll = null;
    overlay = kind;
    history.pushState({ ...(history.state || {}), overlay: kind }, "", location.href);
  }
  function dropOverlay(kind) {
    if (overlay !== kind) return;
    overlay = null;
    if (history.state?.overlay === kind) { poppingOverlay = true; history.back(); }
  }
  function backLabel() { return here() > 0 ? history.state?.prev || "Back" : null; }
  function goBack() {
    if (here() > 0) history.back();
    else goHome();
  }
  function goHome() {
    rememberScroll();
    leaveSearch();
    state.q = ""; state.docId = null; state.pid = null; state.studyId = null; state.browse = null; state.scope = "all";
    syncControls(); renderHome(); showList(); push();
  }
  // A step within the shelves (a book, a year, a volume): a place of its own, so Back retraces it
  function go(browse) { rememberScroll(); state.browse = browse; renderHome(); push(); }
  // Edge swipes in the home-screen app, where iOS keeps its own gesture for itself: in from the
  // left edge goes back, in from the right edge goes forward. In Safari the system gesture does
  // this already, so the app stays out of its way there.
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (standalone) {
    const EDGE = 28, NEED = 80;
    let swipe = null;
    document.addEventListener("touchstart", (e) => {
      swipe = null;
      if (e.touches.length !== 1 || show || !state.ready) return;
      const t = e.touches[0];
      if (e.target.closest(".board, .port, .scopes, .shelf, .chapters, input, textarea, .stage, .sheet, .dsheet")) return;
      if (t.clientX <= EDGE) swipe = { dir: -1, x: t.clientX, y: t.clientY };
      else if (t.clientX >= window.innerWidth - EDGE) swipe = { dir: 1, x: t.clientX, y: t.clientY };
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (!swipe) return;
      const t = e.touches[0];
      if (Math.abs(t.clientY - swipe.y) > 50) swipe = null; // a scroll, not a swipe
    }, { passive: true });
    document.addEventListener("touchend", (e) => {
      if (!swipe) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - swipe.x;
      const go = swipe;
      swipe = null;
      if (Math.abs(t.clientY - go.y) > 50) return;
      if (go.dir < 0 && dx >= NEED) { goBack(); }
      else if (go.dir > 0 && dx <= -NEED) { history.forward(); }
    }, { passive: true });
  }
  // What Back says, wherever it is drawn
  function trailButton() {
    const label = backLabel();
    return el("button", { type: "button", class: "trail-back", "aria-label": label ? `Back to ${label}` : "Library", title: label ? `Back to ${label}` : "Library", onclick: goBack }, [
      el("span", { class: "chev", text: "‹" }), el("span", { class: "lb", text: label || "Library" })]);
  }
  function refreshTrailButtons() { for (const b of document.querySelectorAll(".trail-back")) b.replaceWith(trailButton()); }
  // On a phone every list view carries Back at the top; on a wide screen the reader bar has it
  function listTrail() { return backLabel() ? el("div", { class: "list-trail" }, [trailButton()]) : null; }
  window.addEventListener("popstate", () => {
    if (!state.ready) return;
    if (poppingOverlay) { poppingOverlay = false; return; } // our own pop of a marker, already closed
    if (overlay && !history.state?.overlay) { // Back with a sheet or the stage open: close it, stay where you are
      const kind = overlay; overlay = null;
      if (kind === "sheet") hideNote(); else if (!stage.hidden) stopPresenting();
      return;
    }
    if (history.state?.overlay) history.replaceState({ ...history.state, overlay: null }, "", location.href); // a marker reached from elsewhere is its place
    overlay = null;
    hideNote(); if (!stage.hidden) stopPresenting();
    const left = { doc: state.docId, pid: state.pid };
    readUrl(); syncControls(); render({ restore: history.state?.scroll || null }).then(() => focusAfterBack(left), () => {});
  });
  // On a phone Back swaps the whole screen and the focus went with it: it lands on the row of the
  // page just left when the list has one, else on the list's own Back.
  function focusAfterBack(left) {
    if (wide() || !left.doc || state.docId === left.doc) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.isConnected && ae.offsetParent !== null) return; // something already has it
    let target = null;
    if (!state.docId && !listPane.hidden) {
      target = (left.pid && listPane.querySelector(`[data-doc="${left.doc}"][data-pid="${CSS.escape(left.pid)}"]`)) || listPane.querySelector(`[data-doc="${left.doc}"]`) || listPane.querySelector(".trail-back");
    } else if (!readerPane.hidden) target = readerPane.querySelector(".trail-back");
    if (target) { try { target.focus({ preventScroll: true }); } catch (_) {} }
  }

  // The shelf a home tab opens is the shelf the search box searches, until All is chosen again.
  const TAB_SCOPE = { conference: "conference", scriptures: "scriptures", "preach-my-gospel": "pmg", "missionary-standards": "standards", "come-follow-me": "cfm", handbook: "handbook", manuals: "manuals", "study-helps": "helps", jsp: "jsp" };
  const SCOPE_NAME = { scriptures: "the scriptures", conference: "general conference", pmg: "Preach My Gospel", standards: "Missionary Standards", handbook: "the handbook", cfm: "Come, Follow Me", manuals: "the manuals", helps: "the study helps", jsp: "the Joseph Smith Papers" };
  function syncControls() {
    input.value = state.q;
    for (const b of document.querySelectorAll(".scopes button")) { const on = b.dataset.scope === state.scope; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }
    const on = $(".scopes button.on");
    if (on && on.scrollIntoView) { try { on.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (_) {} }
    input.placeholder = state.scope && state.scope !== "all" ? `Search ${SCOPE_NAME[state.scope] || state.scope}…` : wide() ? "Search, or type a reference like Alma 32:21" : "Search, or a reference";
    $("#fSpeaker").value = state.speaker;
    $("#fFrom").value = state.from;
    $("#fTo").value = state.to;
    $("#fBook").value = state.book;
    for (const b of document.querySelectorAll("#fGroup button")) b.classList.toggle("on", b.dataset.group === state.group);
    const active = !!(state.speaker || state.from || state.to || state.book || state.group !== "passages");
    $("#filterBtn").classList.toggle("on", active);
    $("#filterBtn").setAttribute("aria-pressed", String(active));
    // which tab is open shows in the header
    const tab = state.browse?.tab;
    $("#askBtn").classList.toggle("on", tab === "ask");
    $("#deckBtn").classList.toggle("on", tab === "deck");
    $("#askBtn").setAttribute("aria-pressed", String(tab === "ask"));
    $("#deckBtn").setAttribute("aria-pressed", String(tab === "deck"));
    document.body.classList.toggle("tab-open", tab === "ask" || tab === "deck");
  }

  // ------------------------------------------------------------ render ----
  async function render({ restore = null } = {}) {
    const searching = state.q.trim().length >= 2;
    if (searching && !state.terms.length) state.terms = termsFrom(state.q);
    const listWork = searching ? runSearch({ typeahead: false, silent: true, restore }) : (state.lastSearch = null, renderHome());
    const boardFirst = wide() && !searching && state.browse?.tab === "deck";
    // #deck with a page open shows the board, and the page loads behind it for the switch to offer
    if (boardFirst) paneView = "board";
    else if (state.docId || state.studyId) paneView = "page";
    if (state.docId || state.studyId) {
      const pageWork = state.docId ? openDoc(state.docId, state.pid, { push: false, scroll: !restore && !boardFirst }) : openStudy(state.studyId, { push: false, scroll: restore?.study || 0 });
      // on a phone the page is what you see, and the list behind it catches up on its own
      if (wide()) await Promise.all([listWork, pageWork]); else { await pageWork; listWork.catch(() => {}); }
    } else {
      await listWork;
      showList();
    }
    if (restore) {
      listPane.scrollTop = restore.list || 0;
      readerPane.scrollTop = restore.reader || 0;
      window.scrollTo(0, restore.win || 0);
    }
    nameEntry();
    refreshTrailButtons();
  }
  function showList() {
    listPane.hidden = false;
    if (wide()) placePanes(); else { readerPane.hidden = true; panelPane.hidden = true; window.scrollTo(0, 0); } // a list starts at its top (a restore puts it back after)
    document.body.classList.toggle("reading", !wide() && !readerPane.hidden);
    syncControls();
    updateThinkFab();
  }
  function showReader() {
    listPane.hidden = !wide();
    if (wide()) placePanes(); else { readerPane.hidden = false; panelPane.hidden = true; }
    document.body.classList.toggle("reading", !wide());
    window.scrollTo(0, 0);
    updateThinkFab();
    measureBar();
  }
  // The header's real height, for what must sit just under it (the phone's reader bar)
  function measureBar() { requestAnimationFrame(() => { const h = $("header.bar")?.offsetHeight; if (h) document.documentElement.style.setProperty("--bar-real", h + "px"); }); }
  window.addEventListener("resize", measureBar);

  // ------------------------------------------------------------- setup ----
  // The library is downloaded once per device and unlocked with the passphrase.
  // The engine keeps the library in OPFS through sync access handles in a worker, which iOS has
  // from 16.4. Returns [major, minor] on an iPhone or iPad, else null. iPadOS asks for desktop
  // pages and reports itself as a Mac, so a Mac with a touch screen is read by its Safari version.
  function iosVersion(ua, touch) {
    let m = /(?:iPhone|iPad|iPod)[^)]*? OS (\d+)(?:_(\d+))?/.exec(ua);
    if (!m && touch && /Macintosh/.test(ua)) m = /Version\/(\d+)(?:\.(\d+))?.*Safari\//.exec(ua);
    return m ? [Number(m[1]), Number(m[2] || 0)] : null;
  }
  const iosTooOld = (v) => !!v && (v[0] < 16 || (v[0] === 16 && v[1] < 4));
  const IOS_UPDATE = "To update, open Settings, then General, then Software Update. Meanwhile it works in Safari on a Mac.";
  function showTooOld(v) {
    readerPane.hidden = true;
    listPane.hidden = false;
    document.body.classList.add("first-run");
    listPane.replaceChildren(el("div", { class: "setup" }, [
      el("h1", { text: "Update this iPhone or iPad first" }),
      el("p", { class: "lede", text: `This app needs iOS 16.4 or later to keep the library on the device; this one has iOS ${v[0]}.${v[1]}.` }),
      el("p", { class: "lede", text: IOS_UPDATE }),
    ]));
  }

  async function ensureLibrary() {
    const ios = iosVersion(navigator.userAgent, "ontouchend" in document);
    if (iosTooOld(ios)) { showTooOld(ios); return false; }
    const active = store.get("active");
    let status;
    try { status = await call("open", { slot: active?.slot }); }
    catch (err) { showFatal(`The library engine could not start: ${err.message}`); return false; }
    if (status.hasLibrary) {
      store.set("active", { slot: status.slot, version: status.version, builtAt: status.builtAt, mode: status.mode });
      return true;
    }
    if (status.locked && active) {
      listPane.replaceChildren(el("div", { class: "setup" }, [
        el("h1", { text: "Open in another tab" }),
        el("p", { class: "lede", text: "The library is open in another tab or window of this browser, and only one can hold it at a time. Close it there; this tab opens the library as soon as it is free." }),
        el("button", { type: "button", class: "primary", text: "Try again", onclick: () => location.reload() }),
      ]));
      // the other tab may close any moment: keep trying quietly
      const again = setInterval(async () => {
        let s2 = null;
        try { s2 = await call("open", { slot: active?.slot }); } catch (_) { return; }
        if (s2 && s2.hasLibrary) { clearInterval(again); location.reload(); }
      }, 3000);
      return false;
    }
    return new Promise((resolve) => renderSetup(status, resolve));
  }

  async function renderSetup(status, done) {
    readerPane.hidden = true;
    listPane.hidden = false;
    document.body.classList.add("first-run");
    const box = el("div", { class: "setup" });
    const head = el("h1", { text: "Your library" });
    const lede = el("p", { class: "lede", text: "Loading what is available…" });
    const form = el("form", { class: "unlock" });
    const pass = el("input", { type: "password", placeholder: "Library passphrase", autocomplete: "current-password", autocapitalize: "off", autocorrect: "off", spellcheck: "false", "aria-label": "Library passphrase" });
    const btn = el("button", { type: "submit", class: "primary", text: "Download library" });
    const msg = el("p", { class: "msg" });
    const bar = el("div", { class: "progress", hidden: true }, [el("div", { class: "fill" })]);
    const note = el("p", { class: "fine" });
    form.append(pass, btn);
    box.append(head, lede, form, bar, msg, note);
    listPane.replaceChildren(box);
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    if (status.mode !== "opfs") {
      note.textContent = "This browser cannot keep the library between visits, so it downloads each time you open the app. Adding it to the home screen fixes that on iPhone and iPad.";
    } else if (!standalone && /iPhone|iPad|Macintosh/.test(navigator.userAgent) && "ontouchend" in document) {
      // Safari and a home-screen app keep separate copies: set up where it will be used
      note.textContent = "Using this on an iPhone or iPad? Add it to the home screen first (Share, then Add to Home Screen) and open it from there, so the library downloads once, into the app you will use.";
    }
    const saved = store.get("passphrase");
    if (saved) pass.value = saved;
    let manifest = null;
    const ready = (async () => {
      try {
        manifest = await call("manifest", { manifestUrl: MANIFEST_URL });
        const built = new Date(manifest.built_at);
        lede.textContent = `${manifest.verses.toLocaleString()} verses, ${manifest.talks.toLocaleString()} talks, ${manifest.documents.toLocaleString()} pages in all, built ${built.toLocaleDateString([], { month: "long", day: "numeric" })}. One download of ${mb(manifest.bundle_size)}, then everything works on this device, offline too.`;
      } catch (err) {
        lede.textContent = "The library file is not published yet. Once the nightly job has run on GitHub, reload this page.";
        btn.disabled = true;
      }
    })();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!pass.value) { pass.focus(); return; }
      btn.disabled = true; pass.disabled = true; msg.textContent = ""; bar.hidden = false;
      await ready; // Return pressed while the manifest was still loading waits for it
      if (!manifest) { bar.hidden = true; pass.disabled = false; msg.textContent = "The library file is not published yet."; return; }
      const fill = $(".fill", bar);
      try {
        const result = await call("install", { passphrase: pass.value, manifestUrl: MANIFEST_URL, slot: "/library-a.sqlite" }, (p) => {
          const pct = p.total ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
          fill.style.width = pct + "%";
          msg.textContent = p.phase === "download" ? `Downloading… ${mb(p.loaded)} of ${mb(p.total)}` : `Unpacking… ${pct}%`;
        });
        store.set("passphrase", pass.value);
        store.set("active", { slot: result.slot, version: result.version, builtAt: result.builtAt, mode: result.mode });
        document.body.classList.remove("first-run");
        done(true);
      } catch (err) {
        bar.hidden = true;
        msg.textContent = err.message;
        btn.disabled = false; pass.disabled = false; pass.focus();
      }
    });
    pass.focus();
  }

  function showFatal(text) {
    // on an iPhone or iPad the likeliest cause is an iOS without what the engine needs
    const ios = iosVersion(navigator.userAgent, "ontouchend" in document);
    const hint = ios ? el("p", { class: "fine", text: `This app needs iOS 16.4 or later. ${IOS_UPDATE}` }) : null;
    listPane.replaceChildren(el("div", { class: "setup" }, [el("h1", { text: "Something is wrong" }), el("p", { class: "lede", text }), hint].filter(Boolean)));
  }

  // A newer library on the server? Offer it. When the server has a delta from this device's
  // build, only what changed is downloaded and applied in place; otherwise, or if that fails,
  // the whole library is installed into the other slot and the app switches to it.
  async function checkForUpdate() {
    if (!navigator.onLine) return;
    const active = store.get("active");
    let manifest;
    try { manifest = await call("manifest", { manifestUrl: MANIFEST_URL }); } catch (_) { return; }
    if (!active || manifest.version === active.version) return;
    const delta = (manifest.deltas || []).find((d) => d.from === active.version && d.size < manifest.bundle_size * 0.6) || null;
    const when = new Date(manifest.built_at).toLocaleDateString([], { month: "short", day: "numeric" });
    const banner = el("div", { class: "banner" }, [
      el("span", { text: delta
        ? `A newer library is available (built ${when}): ${delta.documents_changed} ${delta.documents_changed === 1 ? "page" : "pages"} changed, ${mb(delta.size)} to download.`
        : `A newer library is available (built ${when}, ${mb(manifest.bundle_size)}).` }),
      el("button", { class: "text-btn", text: "Update now", onclick: () => updateNow(banner, manifest, delta) }),
      el("button", { class: "icon-btn", "aria-label": "Later", text: "×", onclick: () => banner.remove() }),
    ]);
    $("header.bar").after(banner);
  }
  async function updateNow(banner, manifest, delta = null) {
    const active = store.get("active");
    const passphrase = store.get("passphrase");
    const label = $("span", banner);
    for (const b of banner.querySelectorAll("button")) b.disabled = true;
    const onProgress = (whole) => (p) => {
      const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
      label.textContent = p.phase === "download" ? `Downloading ${whole ? "the new library" : "what changed"}… ${pct}%` : whole ? `Unpacking… ${pct}%` : "Applying…";
    };
    let result = null;
    if (delta && active?.version === delta.from) {
      try { result = await call("applyDelta", { passphrase, manifestUrl: MANIFEST_URL }, onProgress(false)); }
      catch (err) {
        // the small update did not take: the whole library is the way on, but it is a big download, so ask first
        console.warn("delta update failed:", err?.message);
        label.textContent = `The small update did not apply (${err?.message || "unknown reason"}). Download the whole library instead (${mb(manifest.bundle_size)})?`;
        const go = banner.querySelector(".text-btn");
        if (go) { go.textContent = "Download it"; go.onclick = () => updateNow(banner, manifest, null); }
        for (const b of banner.querySelectorAll("button")) b.disabled = false;
        return;
      }
    }
    try {
      if (!result) {
        const slot = active?.slot === "/library-a.sqlite" ? "/library-b.sqlite" : "/library-a.sqlite";
        result = await call("install", { passphrase, manifestUrl: MANIFEST_URL, slot }, onProgress(true));
        if (active?.slot && active.slot !== result.slot) call("forget", { slot: active.slot }).catch(() => {});
      }
      store.set("active", { slot: result.slot, version: result.version, builtAt: result.builtAt, mode: result.mode });
      banner.remove();
      // the page redraws from the new library where it was: the same scroll, and the verses that
      // were selected still selected if the page still has them
      const keep = { list: listPane.scrollTop, reader: readerPane.scrollTop, win: window.scrollY, study: studyScroll };
      const selected = [...readerPane.querySelectorAll(".doc .sel")].map((n) => n.id).filter(Boolean);
      currentDoc = null;
      statsCache = null;
      try { window.dispatchEvent(new CustomEvent("library:change")); } catch (_) {}
      await render({ restore: keep }).catch(() => {}); // the library is updated either way
      const body = $(".doc", readerPane);
      if (body && selected.length) { for (const pid of selected) body.querySelector(`#${CSS.escape(pid)}`)?.classList.add("sel"); updateSelectBar(); }
      setTimeout(loadSemantic, 1500);
      if (result.applied) toast(`Library updated: ${result.applied.changed} ${result.applied.changed === 1 ? "page" : "pages"} changed.`);
    } catch (err) {
      label.textContent = `Update failed: ${err.message}`;
      for (const b of banner.querySelectorAll("button")) b.disabled = false;
    }
  }

  // ------------------------------------------------------------ search ----
  function scheduleSearch() {
    clearTimeout(typeTimer);
    typeTimer = setTimeout(() => runSearch({ typeahead: true }), 120);
  }
  // Leaving the results (home, a shelf, Ask, Deck): a search still in flight is dropped, and the reader stops marking its words.
  function leaveSearch() {
    clearTimeout(typeTimer);
    searchSeq++;
    state.lastSearch = null;
    state.terms = [];
  }

  // Typing: one search in the worker at a time, the latest keystroke waiting its turn, and no
  // search at all for a prefix of one or two letters or a line of nothing but common words.
  let typeBusy = false, typeAgain = false;
  const COMMON = new Set("the a an of and to in is that it for with as be on he his they unto shall i ye my thee thou them him not but which all their by have this from were was me we you your are at or had said so if there what who when how did does do".split(" "));
  function worthTyping(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const last = words[words.length - 1] || "";
    if (last.length < 3 && !/\d/.test(last) && !/["'\u05d0-\u05ea\u0370-\u03ff]/.test(q)) return false;
    return !words.every((w) => COMMON.has(w));
  }
  async function runSearch({ typeahead = false, silent = false, more = false, restore = null } = {}) {
    const q = state.q.trim();
    if (q.length < 2) { leaveSearch(); renderHome(); if (!silent) push(true); return; }
    if (typeahead) {
      if (!worthTyping(q)) return;
      if (typeBusy) { typeAgain = true; return; }
      typeBusy = true;
    }
    // "Show more" under a list that came from typing is a fresh, full search: the pages must come from one ranking
    if (more && (!state.lastSearch || state.lastSearch.typeahead)) more = false;
    if (!more) state.offset = 0;
    const mySeq = ++searchSeq;
    try {
      const asTyped = !!state.asTyped; state.asTyped = false;
      const data = await api("search", {
        q, scope: state.scope, typeahead, limit: 40, offset: state.offset, asTyped,
        speaker: state.speaker, from: state.from, to: state.to, book: state.book, group: state.group,
      });
      if (mySeq !== searchSeq) return;
      // a reference typed and entered opens the chapter itself on a wide screen; the list keeps the card
      // a reference pressed opens its chapter on a wide screen; a re-render (Back, a reload) never navigates
      if (!typeahead && !more && !silent && data.jump?.doc_id && wide() && state.docId !== data.jump.doc_id) setTimeout(() => { if (mySeq === searchSeq) openDoc(data.jump.doc_id, data.jump.pid); }, 0);
      data.typeahead = typeahead;
      if (more && state.lastSearch) {
        const prev = state.lastSearch;
        data.hits = prev.hits.slice(0, prev.hits.length - (prev.extra || 0)).concat(data.hits);
        data.documents = prev.documents.concat(data.documents);
        data.titles = prev.titles;
        data.jump = prev.jump;
      }
      state.lastSearch = data;
      state.terms = data.smart?.terms?.length ? data.smart.terms.flatMap((t) => t.split(" ")) : termsFrom(q);
      if (state.view === "all" && !typeahead) await renderConcordance(data, { restore }); else renderResults(data);
      if (!silent) { push(history.state?.place === placeNow()); setEntry({ place: placeNow(), label: labelNow() }); } // a new search from elsewhere is a move; refining one is not
      if (!typeahead && !more && data.smart && window.Ask?.hasKey() && navigator.onLine) widenWithClaude(q, data, mySeq);
    } catch (e) {
      if (mySeq !== searchSeq) return;
      listPane.replaceChildren(el("div", { class: "status error", text: `Search failed: ${e.message}` }));
    } finally {
      if (typeahead) {
        typeBusy = false;
        if (typeAgain) { typeAgain = false; if (state.q.trim().length >= 2 && state.q.trim() !== q) runSearch({ typeahead: true }); }
      }
    }
  }

  // On return, with an API key, Claude proposes a few more searches for a
  // question and their results are folded in under the local ones.
  async function widenWithClaude(q, data, mySeq) {
    const note = $(".smart-line", listPane);
    if (note) note.append(el("span", { class: "widening", text: " · asking Claude for more…" }));
    let plan;
    try { plan = await window.Ask.plan(q); } catch (_) { $(".widening", listPane)?.remove(); return; }
    if (mySeq !== searchSeq) return;
    const have = new Set(data.hits.map((h) => h.paragraph_id));
    const extra = new Map();
    for (const [i, pq] of (plan.queries || []).entries()) {
      if (pq.q.trim().toLowerCase() === q.trim().toLowerCase()) continue;
      try {
        const r = await api("search", { q: pq.q, scope: pq.scope && pq.scope !== "all" ? pq.scope : state.scope, limit: 10, light: true, speaker: state.speaker, from: state.from, to: state.to, book: state.book });
        r.hits.forEach((h, rank) => { if (!have.has(h.paragraph_id)) { const prev = extra.get(h.paragraph_id); const score = 1 / (rank + 2 + i); if (prev) prev.score += score; else extra.set(h.paragraph_id, { hit: h, score }); } });
      } catch (_) {}
    }
    if (mySeq !== searchSeq) return;
    $(".widening", listPane)?.remove();
    const added = [...extra.values()].sort((a, b) => b.score - a.score).slice(0, 20).map((x) => x.hit);
    if (!added.length) return;
    data.hits = data.hits.concat(added);
    data.extra = added.length;
    data.widened = (plan.queries || []).map((x) => x.q);
    state.lastSearch = data;
    renderResults(data);
  }

  function termsFrom(q) {
    return q.replace(/\b(speaker|by|year|book|in|scope):("[^"]*"|\S+)/gi, " ")
      .replace(/[^\w\s'’-]/g, " ")
      .split(/\s+/).filter((w) => w && !/^(or|and|not)$/i.test(w) && !w.startsWith("-") && w.length > 1);
  }

  function renderResults(data) {
    setOverview(false);
    const frag = document.createDocumentFragment();
    const lt = listTrail(); if (lt) frag.append(lt);
    if (data.error) frag.append(el("div", { class: "status error", text: data.error }));
    if (data.jump) {
      const j = data.jump;
      frag.append(el("button", { class: "jump", onclick: () => j.doc_id ? openDoc(j.doc_id, j.pid) : null }, [
        el("div", {}, [el("b", { text: j.label }), " ", el("span", { text: j.doc_id ? "Open" : "Not in the library yet" })]),
        el("span", { text: j.doc_id ? "›" : "" }),
      ]));
    }
    if (data.smart) {
      const sm = data.smart;
      const bits = [];
      if (sm.terms?.length) bits.push(sm.terms.join(", "));
      if (sm.speaker) bits.push(`by ${sm.speaker}`);
      if (sm.book) bits.push(`in ${sm.book.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace("Sections", "D&C")}`);
      if (sm.scope) bits.push(`in ${SCOPE_NAME[sm.scope] || sm.scope}`);
      if (sm.years) bits.push(sm.years[0] && sm.years[1] ? (sm.years[0] === sm.years[1] ? String(sm.years[0]) : `${sm.years[0]} to ${sm.years[1]}`) : sm.years[0] ? `${sm.years[0]} on` : `up to ${sm.years[1]}`);
      if (sm.corrected?.length) bits.push(sm.corrected.map((c) => `${c.from} → ${c.to}`).join(", "));
      if (!sm.scope && !sm.book && state.scope === "all") bits.push("all shelves");
      const asTypedBtn = sm.corrected?.length ? el("button", { type: "button", class: "text-btn small", text: `Search “${sm.corrected.map((c) => c.from).join(" ")}” as typed`, onclick: () => { state.asTyped = true; runSearch({ typeahead: false }); } }) : null;
      const how = `${sm.exact ? "Exact phrase found, then " : ""}${sm.semantic ? "by words and meaning" : "by words"}`;
      const line = el("div", { class: "smart-line" }, [
        el("span", { text: `${how.charAt(0).toUpperCase() + how.slice(1)}: ${bits.join(" · ") || data.query}` }),
        /^".*"$/.test(data.query.trim()) ? null : el("button", { type: "button", class: "text-btn small", text: "Only exact words", onclick: () => { state.q = `"${data.query.trim().replace(/"/g, "")}"`; syncControls(); runSearch({ typeahead: false }); } }),
        asTypedBtn,
      ]);
      if (data.widened) line.append(el("span", { class: "widened", text: ` · Claude also searched: ${data.widened.join("; ")}` }));
      frag.append(line);
    }
    if (data.original) { const line = window.Original?.resultsHeader(data.original); if (line) frag.append(line); }
    if (data.original_hint) { const line = window.Original?.hintLine(data.original_hint); if (line) frag.append(line); }
    if (data.titles && data.titles.length) {
      frag.append(el("div", { class: "group-title", text: "By title" }));
      for (const d of data.titles) frag.append(docRow(d));
    }
    const total = data.total || 0;
    if (data.hits.length || data.documents.length) {
      const lexAll = data.lexical_total > 0 && data.lexical_match && state.group !== "documents" && !data.typeahead;
      const line = el("div", { class: "group-title", role: "status", "aria-live": "polite", text: state.group === "documents" ? `${total.toLocaleString()} talks and chapters` : `${data.smart?.semantic ? "Top " : ""}${total.toLocaleString()} ${total === 1 ? "passage" : "passages"}` });
      if (lexAll) line.append(el("span", { text: " · " }), el("button", { type: "button", class: "text-btn small inline", text: `${data.lexical_total.toLocaleString()} with these words`, title: "Every match, in reading order", onclick: () => { state.view = "all"; runSearch({ typeahead: false }); } }));
      frag.append(line);
    } else if (data.typeahead && !data.jump && !(data.titles || []).length) {
      frag.append(el("div", { class: "empty" }, [el("div", { text: "Keep typing, or press return to search more widely." })]));
    } else if (!data.jump && !(data.titles || []).length) {
      frag.append(el("div", { class: "empty" }, [
        el("div", { text: `Nothing matches “${data.query}”${scopeLabel()}. Try fewer words, a different spelling, or ask the question instead:` }),
        el("button", { type: "button", class: "text-btn", text: "Ask Claude", onclick: () => { state.browse = { tab: "ask" }; state.q = ""; syncControls(); renderHome(); setTimeout(() => { const ta = $(".ask-input"); if (ta) { ta.value = data.query; ta.focus(); } }, 50); } }),
      ]));
    }
    if (state.group === "documents") for (const d of data.documents) frag.append(docRow(d, d.hits));
    else {
      const sm = data.smart || {};
      const first = data.hits[0];
      // a best match is one the words found (exact, or words and meaning together), never one found by
      // meaning alone, and not when the search was really a Hebrew or Greek word (the hint line leads then)
      const strong = first && !data.original && !data.original_hint && (first.before || first.after || first.why === "exact")
        && (first.why === "exact" || first.why === "both" || (first.why === "words" && !sm.natural));
      if (first && !strong && sm.natural && window.Ask?.hasKey() && !data.typeahead) frag.append(el("div", { class: "ask-line" }, [
        el("span", { text: "A question: the passages below share its words; " }),
        el("button", { type: "button", class: "text-btn small", text: "ask Claude to answer it", onclick: () => { rememberScroll(); state.browse = { tab: "ask", question: data.query }; state.q = ""; syncControls(); renderHome(); showList(); push(); } }),
      ]));
      data.hits.forEach((h, i) => frag.append(i === 0 && strong ? bestCard(h) : hitRow(h)));
    }
    const shown = state.group === "documents" ? data.documents.length : data.hits.length - (data.extra || 0);
    if (shown < total) {
      frag.append(el("button", { class: "more", text: data.typeahead ? `All ${total.toLocaleString()}` : `Show more (${(total - shown).toLocaleString()} left)`, onclick: () => { state.offset = shown; runSearch({ more: true, silent: true }); } }));
    }
    listPane.replaceChildren(frag);
    listPane.scrollTop = 0;
    markActive();
    updateThinkFab();
  }
  function scopeLabel() { return state.scope === "all" ? "" : ` in ${SCOPE_NAME[state.scope] || state.scope}`; }

  // The best hit, in its place: the passage before and after it, and what to do with it.
  function bestCard(h) {
    const card = el("div", { class: "best", "data-doc": h.doc_id }, [
      el("div", { class: "best-head" }, [el("span", { class: "best-label", text: h.why === "exact" ? "Best match · the phrase as typed" : "Best match" }), el("span", { class: "best-where", text: whereOf(h) })]),
      h.before ? el("div", { class: "ctx", text: `${h.before.verse ? h.before.verse + " " : ""}${h.before.text}` }) : null,
      el("div", { class: "best-text" }, [el("b", { class: "best-cite", text: h.citation }), el("span", { html: h.snippet })]),
      h.after ? el("div", { class: "ctx", text: `${h.after.verse ? h.after.verse + " " : ""}${h.after.text}` }) : null,
      el("div", { class: "best-actions" }, [
        el("button", { type: "button", class: "primary", text: h.collection === "scriptures" ? "Open the chapter" : "Open", onclick: () => openDoc(h.doc_id, h.pid) }),
        el("button", { type: "button", class: "text-btn", "data-deck-doc": String(h.doc_id), "data-deck-pid": h.pid, text: window.Deck?.has(h.doc_id, h.pid) ? "On the deck" : "Add to deck", onclick: (e) => addHit(h, e.currentTarget) }),
        el("button", { type: "button", class: "text-btn", text: "Present", onclick: () => startPresentingUnits([{ text: h.text, kind: h.kind, where: h.citation, doc_id: h.doc_id }]) }),
        h.more && h.more.length ? moreToggle(h) : null,
      ]),
    ]);
    return card;
  }
  function whereOf(h) { return h.collection === "general-conference" ? [h.session, h.label].filter(Boolean).join(", ") : h.label; }
  // "4 more in Alma 32": the other hits from the same chapter or talk, shown on request.
  function moreToggle(h) {
    const n = Math.max(h.more.length, (h.more_total || 0) - 1);
    const label = `${n} more in ${shortTitle(h)} ›`;
    const btn = el("button", { type: "button", class: "text-btn more-in", text: label });
    btn.addEventListener("click", () => {
      const holder = btn.closest(".hit-row, .best");
      let list = holder.nextElementSibling;
      if (list && list.classList.contains("more-list")) { list.remove(); btn.textContent = label; return; }
      list = el("div", { class: "more-list" }, h.more.map((m) => hitRow(m, { nested: true })));
      if (n > h.more.length) list.append(el("button", { type: "button", class: "text-btn more-in all-in", text: `All ${n + 1} in ${shortTitle(h)}: open it with the matches marked ›`, onclick: () => openDoc(h.doc_id, h.pid) }));
      holder.after(list);
      btn.textContent = `Hide these ⌃`;
    });
    return btn;
  }
  function shortTitle(h) {
    if (h.collection === "scriptures") return chapterOf(h.citation);
    if (h.collection === "general-conference") return "this talk";
    return h.title.length > 36 ? "this page" : h.title;
  }
  async function addHit(h, btn) {
    if (window.Deck?.has(h.doc_id, h.pid)) { window.Deck.remove(h.doc_id, h.pid); btn.textContent = btn.classList.contains("add") ? "+" : "Add to deck"; btn.setAttribute("aria-pressed", "false"); toast("Taken off the deck."); return; }
    // The snippet is a search excerpt; the deck wants the whole verse or paragraph.
    let text = h.text || el("div", { html: h.snippet }).textContent, verses = null;
    try {
      const ctx = await api("context", { doc_id: h.doc_id, pid: h.pid, before: 0, after: 0 });
      if (ctx?.paragraphs?.length) {
        text = ctx.paragraphs.map((x) => x.text).join(" ");
        const vs = ctx.paragraphs.filter((x) => x.kind === "verse" && x.verse);
        if (vs.length) verses = vs.map((x) => ({ n: x.verse, text: x.text }));
      }
    } catch (_) { /* the text will do */ }
    // on a wide screen the board opens beside the results; on a phone a toast says so and the results stay
    window.Deck?.addPassage({ doc_id: h.doc_id, pid: h.pid, kind: h.kind, verse: h.verse, text, verses, citation: h.citation, label: h.label, author: h.author, title: h.title, collection: h.collection }, { show: wide() });
    btn.textContent = btn.classList.contains("add") ? "\u2713" : "On the deck";
    btn.setAttribute("aria-pressed", "true");
    if (!wide()) deckToast(1, "On the deck.");
  }
  // Every passage with the words, in the order of the books, each chapter or talk with its count:
  // a concordance, for the teacher who wants to see them all rather than the best.
  async function renderConcordance(data, { restore = null } = {}) {
    const terms = (data.smart?.terms || []).flatMap((t) => t.split(" ")).filter((w) => w.length > 1);
    const phrase = /^".*"$/.test(data.query.trim()) ? data.query.trim().replace(/"/g, "") : null;
    listPane.replaceChildren(el("div", { class: "status", text: "Gathering every match…" }));
    let all;
    try {
      // the same match and filters the count above the results used, so the two agree
      all = data.lexical_match
        ? await api("concordance", { match: data.lexical_match, filters: data.filters || {}, limit: 600 })
        : await api("matches", phrase ? { phrase, scope: state.scope, limit: 600 } : { words: terms.join(" "), mode: "all", scope: state.scope, limit: 600 });
    } catch (e) { listPane.replaceChildren(el("div", { class: "status error", text: `Could not gather the matches (${e.message}).` })); return; }
    if (state.view !== "all") return;
    const frag = document.createDocumentFragment();
    const t = listTrail(); if (t) frag.append(t);
    frag.append(el("div", { class: "conc-head" }, [
      el("h2", { text: phrase ? `“${phrase}”` : terms.join(", ") }),
      el("div", { class: "conc-sub", text: `${all.total.toLocaleString()} ${all.total === 1 ? "passage" : "passages"} in ${(all.by_document || []).length.toLocaleString()} ${(all.by_document || []).length === 1 ? "chapter or talk" : "chapters and talks"}${scopeLabel()}, in reading order${all.passages.length < all.total ? ` · the first ${all.passages.length.toLocaleString()} shown` : ""}` }),
    ]));
    const terms2 = phrase ? phrase.split(/\s+/) : terms;
    const re = terms2.length ? new RegExp("\\b(" + terms2.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*").join("|") + ")", "gi") : null;
    let lastDoc = null;
    for (const p of all.passages) {
      if (p.doc_id !== lastDoc) {
        lastDoc = p.doc_id;
        const n = (all.by_document || []).find((d) => d.doc_id === p.doc_id || (d.title === p.title && d.book_title === p.book_title))?.n;
        frag.append(el("button", { type: "button", class: "conc-doc", "data-doc": p.doc_id, onclick: () => openDoc(p.doc_id, null) }, [
          el("span", { class: "t", text: p.collection === "scriptures" ? chapterOf(p.citation) : p.title }),
          el("span", { class: "m", text: [p.collection !== "scriptures" ? whereOf(p) : p.label, n ? `${n} ${n === 1 ? "match" : "matches"}` : null].filter(Boolean).join(" · ") }),
        ]));
      }
      const snip = re ? esc(p.text).replace(re, "<mark>$1</mark>") : esc(p.text);
      frag.append(el("button", { type: "button", class: "conc-row", "data-doc": p.doc_id, "data-pid": p.pid, onclick: () => openDoc(p.doc_id, p.pid) }, [
        p.verse ? el("span", { class: "vn", text: String(p.verse) }) : null,
        el("span", { class: "snip", html: snip }),
      ].filter(Boolean)));
    }
    if (!all.passages.length) frag.append(el("div", { class: "empty", text: "No passage has these words." }));
    listPane.replaceChildren(frag);
    listPane.scrollTop = restore ? restore.list || 0 : 0;
    if (restore) window.scrollTo(0, restore.win || 0);
    markActive();
    updateThinkFab();
  }

  function hitRow(h, { nested = false } = {}) {
    const row = el("div", { class: "hit-row" + (nested ? " nested" : "") }, [
      el("div", { class: "hit-main" }, [
        el("button", { class: "hit", "data-doc": h.doc_id, "data-pid": h.pid, onclick: () => openDoc(h.doc_id, h.pid) }, [
          el("div", { class: "cite" }, [el("span", { text: h.citation }), el("span", { class: "where", text: h.why === "meaning" ? `by meaning · ${whereOf(h)}` : whereOf(h) })]),
          el("div", { class: "snip", html: h.snippet }),
        ]),
        h.more && h.more.length && !nested ? moreToggle(h) : null,
      ]),
      el("button", { class: "add", "data-deck-doc": String(h.doc_id), "data-deck-pid": h.pid, "aria-label": "On the deck", "aria-pressed": String(!!window.Deck?.has(h.doc_id, h.pid)), title: "Add to deck", text: window.Deck?.has(h.doc_id, h.pid) ? "\u2713" : "+", onclick: (e) => { e.stopPropagation(); addHit(h, e.currentTarget); } }),
    ]);
    return row;
  }
  function docRow(d, hits) {
    const meta = [];
    if (d.author) meta.push(el("b", { text: d.author }));
    if (d.label) meta.push(meta.length ? `, ${d.label}` : d.label);
    if (hits) meta.push(` (${hits} ${hits === 1 ? "passage" : "passages"})`);
    return el("button", { class: "doc-row", "data-doc": d.doc_id, onclick: () => openDoc(d.doc_id, null) }, [
      el("div", { class: "t", text: d.title }),
      el("div", { class: "m" }, meta),
    ]);
  }
  function markActive() {
    for (const b of listPane.querySelectorAll("[data-doc]")) b.classList.toggle("on", Number(b.dataset.doc) === state.docId);
  }

  // -------------------------------------------------------------- home ----
  // The shelf a tile stands for, and what it says underneath.
  // [key, title, what it says underneath on a wide screen, and on a phone]
  const SHELVES = [
    ["scriptures", "Scriptures", (st) => `${st.verses.toLocaleString()} verses, with footnotes${st.originals ? "; Hebrew and Greek under every Bible verse" : ""}`, (st) => st.originals ? "With Hebrew and Greek" : "With footnotes"],
    ["conference", "General Conference", (st) => st.talks ? `${st.talks.toLocaleString()} talks, 1971 to ${latestName(st)}` : "Arrives with the nightly build", (st) => st.talks ? `1971 to ${latestName(st, true)}` : "Arriving nightly"],
    ["preach-my-gospel", "Preach My Gospel", () => "2023 edition", () => "2023 edition"],
    ["missionary-standards", "Missionary Standards", () => "The booklet, its supplement, the service missionary edition", () => "All three editions"],
    ["handbook", "General Handbook", (st) => `${count(st, "handbook")} chapters`, (st) => `${count(st, "handbook")} chapters`],
    ["come-follow-me", "Come, Follow Me", () => "This year and last", () => "This year and last"],
    ["manuals", "Manuals", (st) => `${count(st, "manuals")} pages`, (st) => `${count(st, "manuals")} pages`],
    ["study-helps", "Study helps", () => "Topical Guide, Bible Dictionary, Guide to the Scriptures", () => "Topical Guide and more"],
    ["jsp", "Joseph Smith Papers", (st) => { const n = jspPages(st); return n ? `${n.toLocaleString()} pages: journals, revelations, histories, documents` : "Arriving, a series a night"; }, (st) => jspPages(st) ? "Journals, revelations…" : "Arriving nightly"],
    ["studies", "My studies", (st) => [st.studies ? `${st.studies} ${st.studies === 1 ? "page" : "pages"} of your own` : "Pages of your own", st.marks ? `${st.marks} ${st.marks === 1 ? "highlight or note" : "highlights and notes"}` : "your highlights and notes"].join(", ") + ", kept on this device", (st) => st.studies || st.marks ? [st.studies ? `${st.studies} ${st.studies === 1 ? "page" : "pages"}` : null, st.marks ? `${st.marks} marks` : null].filter(Boolean).join(", ") : "Pages, highlights, notes"],
  ];
  function jspPages(st) { return st.collections.filter((c) => c.slug.startsWith("jsp-")).reduce((a, c) => a + c.docs, 0); }
  function latestName(st, short = false) {
    const l = st.latest_conference;
    if (!l) return "today";
    const m = monthName(l.month);
    return `${short ? m.slice(0, 3) : m} ${l.year}`;
  }
  function count(st, slug) { return (st.collections.find((c) => c.slug === slug) || {}).docs || 0; }
  // a shelf with nothing on it yet stays off the home screen (the conference shelf and the Papers say what is coming)
  function hasShelf(st, key) {
    if (key === "jsp") return st.collections.some((c) => c.slug.startsWith("jsp-") && c.docs > 0);
    if (key === "conference" || key === "studies") return true;
    return count(st, key) > 0;
  }
  const TAB_TITLE = Object.fromEntries(SHELVES.map(([k, t]) => [k, t]));

  let statsCache = null;
  async function libraryStats() { if (!statsCache) statsCache = await api("stats"); return statsCache; }

  async function renderHome() {
    const tab = state.browse?.tab || null;
    setOverview(!tab);
    const frag = document.createDocumentFragment();
    const body = el("div", { id: "homeBody", class: "home" + (tab ? "" : " overview") });
    frag.append(body);
    listPane.replaceChildren(frag);
    let st;
    try { st = await libraryStats(); }
    catch (e) { body.append(el("div", { class: "status error", text: `The library is not answering (${e.message}).` })); return; }
    if (!tab && window.Studies) { try { st = { ...st, studies: (await window.Studies.list()).length, marks: window.Marks ? await window.Marks.count() : 0 }; } catch (_) {} }
    nameEntry();
    try {
      if (!tab) return renderOverview(body, st);
      if (tab === "ask") { const { question, think } = state.browse; state.browse = { tab: "ask" }; const t = listTrail(); if (t) body.append(t); const host = el("div"); body.append(host); window.Ask?.render(host, { question, think }); updateThinkFab(); return; }
      if (tab === "deck") { const t = listTrail(); if (t) body.append(t); const host = el("div"); body.append(host); window.Deck?.render(host); return; }
      body.append(el("div", { class: "home-head" }, [
        backLabel() ? trailButton() : el("button", { type: "button", class: "text-btn home-back", text: "Library", onclick: () => goHome() }),
        el("h2", { text: TAB_TITLE[tab] || tab }),
      ]));
      if (tab === "conference") await browseConference(body);
      else if (tab === "scriptures") await browseScriptures(body);
      else if (tab === "jsp") await browseJsp(body);
      else if (tab === "studies") await renderStudies(body);
      else await browseCollection(body, tab);
    } catch (e) {
      body.append(el("div", { class: "status error", text: e.message }));
    }
  }
  function setOverview(on) { document.body.classList.toggle("overview", !!on); }
  function openShelf(key) {
    rememberScroll();
    leaveSearch();
    state.q = ""; syncControls();
    state.browse = { tab: key };
    if (TAB_SCOPE[key]) { state.scope = TAB_SCOPE[key]; syncControls(); }
    renderHome();
    push();
  }

  // The home screen: where you were, the shelves, the latest conference, a word about Ask.
  async function renderOverview(body, st) {
    const last = store.get("lastRead");
    const deckN = window.Deck?.count ? window.Deck.count() : 0;
    if (last || deckN) {
      const sec = el("section", { class: "home-sec sec-continue" }, [el("h2", { text: "Continue" })]);
      if (last) sec.append(el("button", { type: "button", class: "home-card", onclick: () => openDoc(last.id, last.pid || null) }, [
        el("span", { class: "hc-main" }, [el("span", { class: "hc-t", text: last.title }), el("span", { class: "hc-s", text: [last.where, last.verse ? `at verse ${last.verse}` : null].filter(Boolean).join(" · ") })]), el("span", { class: "hc-go", text: "›" })]));
      if (deckN) sec.append(el("button", { type: "button", class: "home-card", onclick: () => go({ tab: "deck" }) }, [
        el("span", { class: "hc-main" }, [el("span", { class: "hc-t", text: `Deck: ${window.Deck.state?.title || "untitled"}` }), el("span", { class: "hc-s", text: `${deckN} ${deckN === 1 ? "passage" : "passages"}${window.Deck.state?.links?.length ? `, ${window.Deck.state.links.length} ${window.Deck.state.links.length === 1 ? "connection" : "connections"}` : ""}` })]), el("span", { class: "hc-go", text: "Open" })]));
      body.append(sec);
    }
    // Come, Follow Me: the lesson for this week, one tap away
    try {
      const wk = count(st, "come-follow-me") ? await api("thisWeek", {}) : null;
      if (wk && wk.lesson) {
        const l = wk.lesson;
        const sec = el("section", { class: "home-sec sec-week" }, [el("div", { class: "home-sec-head" }, [el("h2", { text: "Come, Follow Me this week" }), wk.next ? el("button", { type: "button", class: "text-btn small", text: "Next week", title: wk.next.title, onclick: () => openDoc(wk.next.id, null) }) : null].filter(Boolean))]);
        sec.append(el("button", { type: "button", class: "home-card week-card", onclick: () => openDoc(l.id, null) }, [
          el("span", { class: "hc-main" }, [el("span", { class: "hc-t", text: l.title }), el("span", { class: "hc-s", text: (l.book_title || "Come, Follow Me").replace(/^Come, Follow Me—?/i, "Come, Follow Me: ").replace(/\s+/g, " ").trim() })]),
          el("span", { class: "hc-go", text: "Open" })]));
        body.append(sec);
      }
    } catch (_) { /* no lesson, no card */ }
    const shelves = el("section", { class: "home-sec sec-shelves" }, [el("div", { class: "home-sec-head" }, [el("h2", { text: "Shelves" }), el("span", { class: "hint", text: "Open one to browse it; the search box then searches only that shelf" })])]);
    const grid = el("div", { class: "shelf-grid" });
    for (const [key, title, sub, short] of SHELVES) {
      if (!hasShelf(st, key) && key !== "jsp") continue;
      grid.append(el("button", { type: "button", class: "shelf-tile", onclick: () => openShelf(key) }, [el("span", { class: "st-t", text: title }), el("span", { class: "st-s", text: (wide() ? sub : short)(st) })]));
    }
    shelves.append(grid);
    body.append(shelves);
    try {
      const latest = await api("recent");
      if (latest.conference && latest.talks.length) {
        const sec = el("section", { class: "home-sec sec-latest" }, [el("div", { class: "home-sec-head" }, [el("h2", { text: `Latest conference · ${latest.conference.title}` }), el("button", { type: "button", class: "text-btn small", text: "All sessions", onclick: () => openShelf("conference") })])]);
        const list = el("div", { class: "home-list" });
        for (const t of latest.talks.slice(0, 6)) list.append(el("button", { class: "toc-row", "data-doc": t.id, onclick: () => openDoc(t.id, null) }, [el("div", { class: "t", text: t.title }), el("div", { class: "s", text: [t.author, t.session].filter(Boolean).join(" · ") })]));
        if (latest.talks.length > 6) list.append(el("button", { class: "toc-row more-talks", onclick: () => openShelf("conference") }, [el("div", { class: "t", text: `All ${latest.talks.length} talks ›` })]));
        sec.append(list);
        body.append(sec);
      }
    } catch (_) { /* no conference yet */ }
    if (window.Ask) {
      const q = el("input", { type: "text", class: "ask-teaser-q", placeholder: "What have the prophets taught about covenants and identity?", "aria-label": "A question for the library" });
      const go = () => { rememberScroll(); state.browse = { tab: "ask", question: q.value.trim() }; state.q = ""; syncControls(); renderHome(); showList(); push(); };
      q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      body.append(el("section", { class: "home-sec sec-ask ask-teaser" }, [
        el("div", { class: "hc-t", text: "Ask the library" }),
        el("div", { class: "hc-s", text: "A question or a draft: Claude searches these shelves itself and answers with the passages, which you can open, present, or put on the deck." }),
        el("div", { class: "ask-teaser-row" }, [q, el("button", { type: "button", class: "primary", text: "Ask", onclick: go })]),
      ]));
    }
    const built = st.meta?.bundle?.built_at ? new Date(st.meta.bundle.built_at) : null;
    const sem = await semanticNote();
    body.append(el("div", { class: "home-foot", id: "homeStatus", text: `${built ? `Library built ${built.toLocaleDateString([], { month: "short", day: "numeric" })} · ` : ""}${st.documents.toLocaleString()} pages on this device · works offline${sem ? ` · ${sem}` : ""}` }));
  }

  async function browseConference(body) {
    const b = state.browse || {};
    if (b.bookUri) return renderBookToc(body, b.bookUri, () => go({ tab: "conference", year: b.year, all: true }));
    const data = await api("browse", { collection: "general-conference" });
    const books = data.books.filter((x) => x.docs > 0);
    if (!books.length) { body.append(el("div", { class: "empty", text: "No conference talks in this library yet. They arrive with the nightly build, newest conference first." })); return; }
    if (!b.year && !b.all) {
      const latest = await api("recent");
      if (latest.conference) {
        body.append(el("h2", { text: latest.conference.title }));
        let session = null;
        for (const t of latest.talks) {
          if (t.session && t.session !== session) { session = t.session; body.append(el("div", { class: "toc-row section" }, [el("div", { class: "t", text: session })])); }
          body.append(el("button", { class: "toc-row", "data-doc": t.id, onclick: () => openDoc(t.id, null) }, [el("div", { class: "t", text: t.title }), el("div", { class: "s", text: t.author || "" })]));
        }
      }
      body.append(el("h2", { text: "All conferences" }));
    }
    const years = [...new Set(books.map((x) => x.year))].filter(Boolean).sort((a, c) => c - a);
    const shelf = el("div", { class: "shelf" });
    for (const y of years) shelf.append(el("button", { class: "chip" + (b.year === y ? " on" : ""), text: String(y), onclick: () => go({ tab: "conference", year: y, all: true }) }));
    body.append(shelf);
    if (b.year) {
      for (const bk of books.filter((x) => x.year === b.year)) {
        body.append(el("button", { class: "toc-row", onclick: () => go({ tab: "conference", year: b.year, bookUri: bk.uri }) }, [
          el("div", { class: "t", text: `${monthName(bk.month)} ${bk.year}` }), el("div", { class: "s", text: `${bk.docs} talks` })]));
      }
    }
  }

  async function browseScriptures(body) {
    const b = state.browse || {};
    const shelf = await api("scriptures");
    if (!b.book) {
      for (const vol of shelf.volumes) {
        body.append(el("h2", { text: vol.name }));
        const row = el("div", { class: "shelf" });
        for (const bk of vol.books) row.append(el("button", { class: "chip", text: bk.name.replace("JST, ", ""), onclick: () => go({ tab: "scriptures", book: bk.slug }) }));
        body.append(row);
      }
      return;
    }
    const bk = shelf.volumes.flatMap((v) => v.books).find((x) => x.slug === b.book);
    body.append(el("div", { class: "crumbs" }, [el("button", { text: "Scriptures", onclick: () => go({ tab: "scriptures" }) }), el("span", { text: bk.name })]));
    const grid = el("div", { class: "chapters" });
    for (const c of bk.chapters) grid.append(el("button", { text: String(c.n), disabled: !c.doc_id, onclick: () => openDoc(c.doc_id, null) }));
    body.append(grid);
    if (!bk.chapters.some((c) => c.doc_id)) body.append(el("div", { class: "empty", text: "Not in this library yet. It arrives with a later build." }));
  }

  async function browseCollection(body, slug) {
    const b = state.browse || {};
    if (b.bookUri) return renderBookToc(body, b.bookUri, () => go({ tab: slug }));
    const data = await api("browse", { collection: slug });
    const books = data.books.filter((x) => x.docs > 0);
    if (!books.length) { body.append(el("div", { class: "empty", text: "Nothing here yet. It arrives with a later nightly build." })); return; }
    if (books.length === 1) return renderBookToc(body, books[0].uri, null);
    for (const bk of books) body.append(el("button", { class: "toc-row", onclick: () => go({ tab: slug, bookUri: bk.uri }) }, [el("div", { class: "t", text: bk.title }), el("div", { class: "s", text: `${bk.docs} pages` })]));
  }

  // The Joseph Smith Papers: a series (journals, revelations, histories…), then its volumes, then the papers.
  async function browseJsp(body) {
    const b = state.browse || {};
    const all = (await api("browse", {})).collections.filter((c) => c.slug.startsWith("jsp-"));
    if (!all.length) { body.append(el("div", { class: "empty", text: "The Joseph Smith Papers arrive with the nightly builds, a series at a time: journals first, then revelations and translations, histories, and the documents." })); return; }
    const chips = el("div", { class: "shelf" });
    const series = b.series || all[0].slug;
    for (const c of all) chips.append(el("button", { class: "chip" + (series === c.slug ? " on" : ""), text: c.title.replace(/^Joseph Smith Papers: /, "") + (c.docs ? "" : " (soon)"), onclick: () => go({ tab: "jsp", series: c.slug }) }));
    body.append(chips);
    if (b.bookUri) return renderBookToc(body, b.bookUri, () => go({ tab: "jsp", series }));
    const data = await api("browse", { collection: series });
    const books = data.books.filter((x) => x.docs > 0);
    if (!books.length) { body.append(el("div", { class: "empty", text: "Nothing from this series yet. It arrives with a later nightly build." })); return; }
    for (const bk of books) body.append(el("button", { class: "toc-row", onclick: () => go({ tab: "jsp", series, bookUri: bk.uri }) }, [el("div", { class: "t", text: bk.title }), el("div", { class: "s", text: `${bk.docs} ${bk.docs === 1 ? "page" : "pages"}` })]));
    body.append(el("p", { class: "deck-hint", text: "Transcriptions, source notes and historical introductions from josephsmithpapers.org (The Church Historian’s Press, © Intellectual Reserve, Inc.), for personal study. Tap a name in a paper for who or where it is." }));
  }

  async function renderBookToc(body, uri, back) {
    const book = await api("book", { uri });
    if (back) body.append(el("div", { class: "crumbs" }, [el("button", { text: "Back", onclick: back }), el("span", { text: book.title })]));
    else body.append(el("h2", { text: book.title }));
    for (const n of book.nodes || []) {
      if (n.kind === "section") body.append(el("div", { class: "toc-row section" }, [el("div", { class: "t", text: n.title })]));
      else body.append(el("button", { class: "toc-row" + (n.depth > 1 ? " sub" : ""), disabled: !n.doc_id, "data-doc": n.doc_id, onclick: () => n.doc_id && openDoc(n.doc_id, null) }, [
        el("div", { class: "t", text: n.title }), el("div", { class: "s", text: n.subtitle || "" })]));
    }
  }

  // ------------------------------------------------------------ reader ----
  let currentDoc = null;
  async function openDoc(id, pid, { push: doPush = true, scroll = true } = {}) {
    if (!id) return;
    state.docId = id; state.pid = pid || null; state.studyId = null; currentStudy = null;
    if (doPush) { push(); paneView = "page"; } // a page chosen now is what the pane should show
    markActive();
    showReader();
    if (!currentDoc || currentDoc.id !== id) {
      readerPane.replaceChildren(el("div", { class: "status", text: "Opening…" }));
      try { currentDoc = await api("doc", { id }); }
      catch (e) { readerPane.replaceChildren(el("div", { class: "status error", text: `Could not open that page (${e.message}).` })); return; }
      if (!currentDoc) { readerPane.replaceChildren(el("div", { class: "status error", text: "That page is not in the library." })); return; }
      if (state.docId !== id) return; // another page was opened while this one loaded
      renderDoc(currentDoc);
    }
    nameEntry(shortTitleOf(currentDoc));
    refreshTrailButtons();
    focusParagraph(state.pid, { scroll });
    updateThinkFab();
    // on a phone the page replaces the list, so the way back is what a keyboard or VoiceOver user meets first
    if (!wide() && doPush) { const back = readerPane.querySelector(".trail-back"); if (back) try { back.focus({ preventScroll: true }); } catch (_) {} }
    const verse = currentDoc.collection === "scriptures" && /^p\d+$/.test(state.pid || "") ? Number(state.pid.slice(1)) : null;
    store.set("lastRead", { id: currentDoc.id, title: currentDoc.title, where: crumbFor(currentDoc), pid: state.pid || null, verse });
  }

  function renderDoc(doc) {
    const bar = el("div", { class: "reader-bar" }, [
      trailButton(),
      el("div", { class: "crumb", text: crumbFor(doc) }),
      el("div", { class: "spacer" }),
      el("button", { class: "icon-btn", "aria-label": "Smaller text", title: "Smaller text", onclick: () => resize(-1), html: "<span style='font-size:14px;font-weight:600'>A</span>" }),
      el("button", { class: "icon-btn", "aria-label": "Larger text", title: "Larger text", onclick: () => resize(1), html: "<span style='font-size:20px;font-weight:600'>A</span>" }),
      el("button", { class: "icon-btn", "aria-label": "Present", title: "Present on a big screen", onclick: () => startPresenting(), html: ICON_PRESENT }),
      doc.collection && doc.collection.startsWith("jsp-") ? el("button", { class: "text-btn", text: "Cite", title: "Copy a citation for this page", onclick: () => citePapers(doc) }) : null,
      el("a", { class: "icon-btn", href: doc.source_url, target: "_blank", rel: "noopener", title: doc.collection && doc.collection.startsWith("jsp-") ? "Open on josephsmithpapers.org" : "Open on churchofjesuschrist.org", "aria-label": doc.collection && doc.collection.startsWith("jsp-") ? "Open on josephsmithpapers.org" : "Open on churchofjesuschrist.org", html: ICON_OUT }),
      el("span", { class: "pane-switch-slot" }),
    ].filter(Boolean));
    const body = sanitize(el("article", { class: "doc", html: doc.body_html || "" }));
    if (doc.footnotes && doc.footnotes.length) {
      const notes = el("section", { class: "notes" }, [el("h2", { text: "Footnotes" })]);
      const ol = el("ol");
      for (const n of doc.footnotes) ol.append(el("li", { id: `fn-${n.note_id}` }, [el("b", { text: n.marker || "" }), sanitize(el("span", { html: n.html || esc(n.text) }))]));
      notes.append(ol);
      body.append(notes);
    }
    const nav = el("div", { class: "doc-nav" }, [
      doc.prev ? el("button", { text: `‹ ${doc.prev.title}`, onclick: () => openDoc(doc.prev.id, null) }) : el("span"),
      doc.next ? el("button", { text: `${doc.next.title} ›`, onclick: () => openDoc(doc.next.id, null) }) : el("span"),
    ]);
    const foot = el("div", { class: "doc-foot", text: doc.fetched_at ? `Copied from churchofjesuschrist.org ${new Date(doc.fetched_at).toLocaleDateString()}. Text and study helps are the Church's; this copy is for personal study.` : "" });
    // On a phone the tools sit at the bottom, under the thumb; the top bar keeps the way back and the crumb.
    const sizeRow = el("div", { class: "size-row", hidden: true }, [
      el("span", { text: "Text size" }),
      el("button", { type: "button", "aria-label": "Smaller text", onclick: () => resize(-1), html: "<span style='font-size:14px;font-weight:600'>A</span>" }),
      el("button", { type: "button", "aria-label": "Larger text", onclick: () => resize(1), html: "<span style='font-size:20px;font-weight:600'>A</span>" }),
    ]);
    const rfoot = el("div", { class: "reader-foot" }, [
      footBtn("Present", ICON_PRESENT, () => startPresenting()),
      el("span", { class: "slot-orig" }),
      footBtn("Text size", "<span class='glyph' style='font-size:20px;font-weight:700'>A</span>", (e) => { sizeRow.hidden = !sizeRow.hidden; e.currentTarget.classList.toggle("on", !sizeRow.hidden); }),
      doc.collection && doc.collection.startsWith("jsp-") ? footBtn("Cite", "<span class='glyph' style='font-size:18px;font-weight:700'>“”</span>", () => citePapers(doc)) : null,
      footBtn("Add to deck", "<span class='glyph' style='font-size:24px'>+</span>", () => {
        const units = selectedUnits();
        if (!units.length) { toast("Tap a verse or paragraph to select it first."); return; }
        const first = $(".doc .sel", readerPane);
        const added = window.Deck?.addFromDoc(currentDoc, units);
        clearSelection();
        focusUnit(first);
        deckToast(added, added === 1 ? "On the deck." : `${added} passages on the deck.`);
      }),
      el("a", { class: "foot-btn", href: doc.source_url, target: "_blank", rel: "noopener", "aria-label": "Open on the Church's site" }, [el("span", { class: "ic", html: ICON_OUT }), el("span", { class: "lb", text: "Site" })]),
    ]);
    readerPane.replaceChildren(bar, body, nav, foot, sizeRow, rfoot);
    readerPane.classList.remove("has-study");
    releaseStudyUrl();
    readerPane.scrollTop = 0;
    unseen = readerPane.hidden; // drawn behind the board: it finds its verse when it is first shown
    refreshSwitches();
    body.addEventListener("click", onBodyClick);
    body.addEventListener("click", onSelectClick);
    // The verses are one Tab stop (the one last visited): ArrowUp and ArrowDown move between them,
    // Enter or Space selects, instead of a Tab for every verse before the selection bar.
    const units = [...body.querySelectorAll(UNIT_SEL)];
    units.forEach((u, i) => { u.tabIndex = i === 0 ? 0 : -1; });
    body.addEventListener("focusin", (e) => { if (e.target.matches?.(UNIT_SEL)) rove(e.target); });
    body.addEventListener("keydown", (e) => {
      const unit = e.target.closest(UNIT_SEL);
      if (!unit || e.target !== unit || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const all = [...body.querySelectorAll(UNIT_SEL)];
        const next = all[all.indexOf(unit) + (e.key === "ArrowDown" ? 1 : -1)];
        e.preventDefault();
        if (next) { focusUnit(next); next.scrollIntoView({ block: "nearest" }); }
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      unit.classList.toggle("sel");
      updateSelectBar();
    });
    window.Original?.attach(doc, body, bar);
    body.addEventListener("dblclick", (e) => {
      const unit = e.target.closest("p, h2, h3, li");
      if (unit && unit.id) { e.preventDefault(); window.getSelection()?.removeAllRanges(); startPresenting(unit.id); }
    });
    highlightTerms(body);
    applyMarks(doc, body);
  }

  // A citation for a Joseph Smith Papers page, in the Papers' own form, with the manuscript page
  // when the page is known (the title carries it, or the selection sits under a page marker).
  function pageOf(doc) { const m = /, page (\d+[a-z]?)$/i.exec(doc.title || ""); return m ? m[1] : null; }
  function citePapers(doc) {
    const sel = $(".doc .sel", readerPane);
    let page = pageOf(doc);
    if (!page && sel) { let n = sel; while (n && n !== readerPane) { let prev = n.previousElementSibling; while (prev) { if (prev.classList?.contains("jsp-page")) { const m = /\[p\.\s*([^\]]+)\]/.exec(prev.textContent || ""); if (m) page = m[1].trim(); break; } prev = prev.previousElementSibling; } if (page) break; n = n.parentElement; } }
    const title = (doc.title || "").replace(/, page \d+[a-z]?$/i, "");
    const when = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const text = `“${title},” ${page ? `p. ${page}, ` : ""}The Joseph Smith Papers, accessed ${when}, ${doc.source_url}`;
    navigator.clipboard?.writeText(text).then(() => toast("Citation copied."), () => {
      const bodyEl = $(".sheet-body", sheet);
      bodyEl.replaceChildren(el("div", { class: "nm", text: "Citation" }), el("p", { class: "note-passage", text }));
      openSheet("Citation");
    });
  }

  // ---- Highlights and notes -------------------------------------------------
  // A teacher's marks on the page: a color behind a verse or paragraph, a note at its end.
  // They are kept on the device by page address and paragraph id (marks.js), so they outlast
  // library updates and come back whenever the page is opened.
  let docMarks = new Map(); // pid -> mark, for the page open now
  async function applyMarks(doc, body) {
    docMarks = new Map();
    if (!window.Marks || !doc?.uri) return;
    let list = [];
    try { list = await window.Marks.forDoc(doc.uri); } catch (_) { return; }
    if (!currentDoc || currentDoc.id !== doc.id || !body.isConnected) return;
    for (const m of list) { docMarks.set(m.pid, m); drawMark(body, m); }
    drawRanges(body);
  }
  function drawMark(body, m) {
    const unit = body.querySelector(`#${CSS.escape(m.pid)}`);
    if (!unit) return;
    for (const c of window.Marks.COLORS) unit.classList.remove(`hl-${c}`);
    unit.classList.toggle("hl", !!m.color);
    if (m.color) unit.classList.add(`hl-${m.color}`);
    unit.querySelector(".note-mark")?.remove();
    if (m.note) {
      unit.classList.add("noted");
      // the marker sits on the first verse of the note's range; the label says how far it reaches
      const over = m.pid_end && m.citation ? ` on ${m.citation}` : "";
      unit.append(el("button", { type: "button", class: "note-mark", title: m.note.length > 80 ? m.note.slice(0, 78) + "…" : m.note, "aria-label": `Note${over}: ${m.note.slice(0, 80)}`, html: ICON_NOTE, onclick: (e) => { e.preventDefault(); e.stopPropagation(); editNote(unitInfo(unit)); } }));
    } else unit.classList.remove("noted");
  }
  // The passages from one paragraph to another, in reading order (a note's range, a selection's span)
  const UNIT_SEL = "p.verse, .body-block p[id], .body-block li[id]";
  // The one verse in the page that Tab reaches (a roving tabindex), and focus put back on the page
  // after a control that held it goes away (the selection bar after Add to deck)
  function rove(unit) {
    const body = unit?.closest(".doc");
    if (!body) return;
    for (const n of body.querySelectorAll("[tabindex='0']")) if (n !== unit && n.matches(UNIT_SEL)) n.tabIndex = -1;
    unit.tabIndex = 0;
  }
  function focusUnit(unit) {
    if (!unit || !unit.isConnected) return;
    rove(unit);
    try { unit.focus({ preventScroll: true }); } catch (_) {}
  }
  function unitsBetween(body, fromPid, toPid) {
    const all = [...body.querySelectorAll(UNIT_SEL)];
    const a = all.findIndex((n) => n.id === fromPid), b = all.findIndex((n) => n.id === toPid);
    if (a < 0) return [];
    return b < a ? [all[a]] : all.slice(a, b + 1);
  }
  // A note over several verses: a light bracket in the margin from its first verse to its last
  function drawRanges(body) {
    if (!body) return;
    for (const n of body.querySelectorAll(".note-range")) n.classList.remove("note-range", "note-range-start", "note-range-end");
    for (const m of docMarks.values()) {
      if (!m.note || !m.pid_end) continue;
      const span = unitsBetween(body, m.pid, m.pid_end);
      if (span.length < 2) continue;
      for (const n of span) n.classList.add("note-range");
      span[0].classList.add("note-range-start");
      span[span.length - 1].classList.add("note-range-end");
    }
  }
  function undrawMark(body, pid) {
    const unit = body.querySelector(`#${CSS.escape(pid)}`);
    if (!unit) return;
    unit.classList.remove("hl", "noted", ...window.Marks.COLORS.map((c) => `hl-${c}`));
    unit.querySelector(".note-mark")?.remove();
  }
  function unitInfo(n) {
    const c = n.cloneNode(true);
    for (const junk of c.querySelectorAll("sup.marker, .verse-number, .page-break, .note-mark")) junk.remove();
    const num = n.querySelector(".verse-number");
    const verse = num ? parseInt(num.textContent, 10) : null;
    return { pid: n.id, kind: n.classList.contains("verse") ? "verse" : "para", verse: Number.isFinite(verse) ? verse : null, text: c.textContent.replace(/\s+/g, " ").trim() };
  }
  function citeUnit(x) { return x.kind === "verse" && currentDoc?.citation ? `${chapterOf(currentDoc.citation)}:${x.verse}` : crumbFor(currentDoc) || currentDoc?.title || ""; }
  // Color the selected paragraphs; the same color again takes it off
  async function highlightSelection(color) {
    if (!currentDoc || !window.Marks) return;
    const units = selectedUnits();
    if (!units.length) return;
    const body = $(".doc", readerPane);
    const page = currentDoc; // the page as it is now: a move while the marks save must not send them to another page
    const allSame = units.every((u) => docMarks.get(u.pid)?.color === color);
    for (const u of units) {
      try {
        const ranged = !!docMarks.get(u.pid)?.pid_end; // a verse that opens a note's range keeps the range's words and citation
        const rec = await window.Marks.set({ uri: page.uri, doc_id: page.id, pid: u.pid, verse: u.verse, kind: u.kind, color: allSame ? null : color, text: ranged ? undefined : u.text, citation: ranged ? undefined : citeUnit(u), title: page.title });
        if (currentDoc !== page) return;
        if (rec) { docMarks.set(u.pid, rec); drawMark(body, rec); } else { docMarks.delete(u.pid); undrawMark(body, u.pid); }
      } catch (_) { toast("Could not save that mark."); return; }
    }
    // the verses stay selected and the bar stays up (focus with it), so a note or Add to deck can
    // follow without selecting them again; the dot shows the color they now carry
    updateSelectBar();
    toast(allSame ? "Highlight removed." : units.length === 1 ? "Highlighted." : `${units.length} highlighted.`);
  }
  // A note on a passage, written in the sheet: one verse or paragraph, or a run of them (end is the
  // last; an existing note brings its own range back). The note is kept on the first.
  function editNote(unit, end = null) {
    if (!currentDoc || !window.Marks || !unit) return;
    const old = docMarks.get(unit.pid) || null;
    const existing = old?.note || "";
    const body = $(".doc", readerPane);
    if (!end && old?.pid_end) { const n = body?.querySelector(`#${CSS.escape(old.pid_end)}`); if (n) end = unitInfo(n); }
    const span = end && end.pid !== unit.pid && body ? unitsBetween(body, unit.pid, end.pid).map(unitInfo) : [unit];
    const last = span[span.length - 1];
    const ranged = span.length > 1;
    const cite = ranged && unit.kind === "verse" && last.kind === "verse" && currentDoc.citation ? `${chapterOf(currentDoc.citation)}:${unit.verse}-${last.verse}` : citeUnit(unit);
    const words = span.map((x) => x.text).join(" ");
    const page = currentDoc;
    const bodyEl = $(".sheet-body", sheet);
    const ta = el("textarea", { class: "note-text", rows: 5, placeholder: ranged ? "Your note on these passages…" : "Your note on this passage…", "aria-label": `Note on ${cite}` });
    ta.value = existing;
    const save = async () => {
      try {
        const keep = !!ta.value.trim();
        const rec = await window.Marks.set({ uri: page.uri, doc_id: page.id, pid: unit.pid, verse: unit.verse, kind: unit.kind, note: ta.value,
          pid_end: keep && ranged ? last.pid : null, verse_end: keep && ranged ? last.verse : null,
          text: keep ? words : unit.text, citation: keep ? cite : citeUnit(unit), title: page.title });
        if (currentDoc !== page) { closeSheet(); return; }
        const b = $(".doc", readerPane);
        if (rec) { docMarks.set(unit.pid, rec); if (b) drawMark(b, rec); } else { docMarks.delete(unit.pid); if (b) undrawMark(b, unit.pid); }
        drawRanges(b);
        closeSheet(); updateSelectBar(); // the selection stays, for a color or Add to deck after the note
        toast(keep ? "Note saved." : "Note removed.");
      } catch (_) { toast("Could not save the note."); }
    };
    bodyEl.replaceChildren(
      el("div", { class: "nm", text: `Note on ${cite}` }),
      el("p", { class: "note-passage", text: words.length > 180 ? words.slice(0, 178) + "…" : words }),
      ta,
      el("div", { class: "peek-row" }, [
        el("button", { type: "button", class: "primary", text: "Save", onclick: save }),
        existing ? el("button", { type: "button", class: "text-btn danger", text: "Delete", onclick: () => { ta.value = ""; save(); } }) : null,
        el("button", { type: "button", class: "text-btn", text: "Cancel", onclick: closeSheet }),
      ].filter(Boolean)),
    );
    openSheet("Note");
    sheetKeep = () => ta.value.trim() !== existing.trim(); // Esc or a tap outside keeps words not yet saved
    ta.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); save(); } });
    setTimeout(() => ta.focus(), 50);
  }
  const ICON_NOTE = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>';

  // ---- My studies: your own pages in the reader ------------------------------
  // A study opens in a frame of its own (its look and its scripts intact, sandboxed away from
  // the app); its links come back to the app, which opens the local copy.
  let currentStudy = null, studyScroll = 0, studyUrl = null;
  function releaseStudyUrl() { if (studyUrl) { try { URL.revokeObjectURL(studyUrl); } catch (_) {} studyUrl = null; } }
  async function openStudy(id, { push: doPush = true, scroll = 0 } = {}) {
    if (!id || !window.Studies) return;
    state.docId = null; state.pid = null; state.studyId = id;
    currentDoc = null;
    if (doPush) { push(); paneView = "page"; }
    markActive();
    showReader();
    if (!currentStudy || currentStudy.id !== id) {
      readerPane.replaceChildren(el("div", { class: "status", text: "Opening…" }));
      let rec = null;
      try { rec = await window.Studies.get(id); } catch (_) { rec = null; }
      if (state.studyId !== id) return;
      if (!rec) { readerPane.replaceChildren(el("div", { class: "status error", text: "That page is no longer on this device." })); return; }
      currentStudy = rec;
      renderStudy(rec, scroll);
    }
    nameEntry(shortTitleOf(currentStudy));
    refreshTrailButtons();
    updateThinkFab();
  }
  function renderStudy(rec, scroll = 0) {
    studyScroll = scroll || 0;
    const bar = el("div", { class: "reader-bar" }, [
      trailButton(),
      el("div", { class: "crumb", text: `My studies · added ${new Date(rec.added).toLocaleDateString([], { month: "short", day: "numeric" })}` }),
      el("div", { class: "spacer" }),
      el("span", { class: "pane-switch-slot" }),
    ]);
    const frame = el("iframe", { class: "study-frame", title: rec.title, sandbox: "allow-scripts allow-forms" });
    // a blob address rather than srcdoc, so the page's own #links and hash navigation work as they
    // do anywhere; the address stays valid while the page is open (its #links need it)
    releaseStudyUrl();
    studyUrl = URL.createObjectURL(new Blob([window.Studies.frameHtml(rec)], { type: "text/html;charset=utf-8" }));
    frame.src = studyUrl;
    frame.addEventListener("load", () => { if (studyScroll) frame.contentWindow?.postMessage({ type: "gospel:scrollTo", y: studyScroll }, "*"); });
    readerPane.replaceChildren(bar, frame);
    readerPane.classList.add("has-study");
    refreshSwitches();
    fitStudyFrame();
  }
  // the frame fills what is left of the pane under the bar
  function fitStudyFrame() {
    const frame = readerPane.querySelector(".study-frame");
    if (!frame) { readerPane.classList.remove("has-study"); return; }
    const top = frame.getBoundingClientRect().top;
    const bottom = wide() ? readerPane.getBoundingClientRect().bottom : window.innerHeight;
    frame.style.height = Math.max(240, Math.floor(bottom - top)) + "px";
  }
  window.addEventListener("resize", fitStudyFrame);
  window.addEventListener("message", (e) => {
    const frame = readerPane.querySelector(".study-frame");
    if (!frame || e.source !== frame.contentWindow || !e.data || typeof e.data !== "object") return;
    if (e.data.type === "gospel:link" && typeof e.data.href === "string") followLink(e.data.href);
    else if (e.data.type === "gospel:scroll") studyScroll = Number(e.data.y) || 0;
  });
  // The shelf: the pages on this device, and a way to add one
  async function renderStudies(body) {
    const list = window.Studies ? await window.Studies.list() : [];
    const pick = el("input", { type: "file", accept: ".html,.htm,.md,.markdown,.txt,text/html,text/markdown,text/plain", hidden: true, "aria-hidden": "true" });
    pick.addEventListener("change", async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      try {
        const rec = await window.Studies.add(file);
        toast(`Added “${rec.title}”.`);
        await renderHome();
        openStudy(rec.id);
      } catch (err) { toast(err.message || "That file could not be added."); }
      pick.value = "";
    });
    body.append(pick);
    const intro = el("p", { class: "lede studies-lede", text: list.length
      ? "Pages of your own, kept on this device. Links to the scriptures and to talks open the library's copy."
      : "Pages of your own, kept on this device: a study you built, a lesson, notes. Add an HTML, Markdown or text file from Files; it opens here, offline, and its links to the scriptures and to talks open the library's copy." });
    body.append(intro);
    body.append(el("div", { class: "studies-add" }, [el("button", { type: "button", class: "primary", text: list.length ? "Add a page" : "Add a page from Files", onclick: () => pick.click() })]));
    if (!list.length) { await renderMarks(body); return; }
    const rows = el("div", { class: "study-list" });
    for (const rec of list) {
      rows.append(el("div", { class: "study-row" + (state.studyId === rec.id ? " on" : "") }, [
        el("button", { type: "button", class: "study-open", onclick: () => openStudy(rec.id) }, [
          el("span", { class: "t", text: rec.title }),
          el("span", { class: "s", text: `${rec.kind === "html" ? "Page" : rec.kind === "md" ? "Markdown" : "Text"} · added ${new Date(rec.added).toLocaleDateString([], { month: "short", day: "numeric" })} · ${window.Studies.mb(rec.size)}` }),
        ]),
        el("button", { type: "button", class: "icon-btn study-remove", "aria-label": `Remove ${rec.title}`, title: "Remove from this device", text: "×", onclick: async () => {
          if (!confirm(`Remove “${rec.title}” from this device?`)) return;
          try { await window.Studies.remove(rec.id); } catch (_) { toast("Could not remove it just now."); return; }
          if (state.studyId === rec.id) { currentStudy = null; state.studyId = null; releaseStudyUrl(); readerPane.replaceChildren(); readerPane.classList.remove("has-study"); push(true); }
          toast("Removed.");
          renderHome(); showList();
        } }),
      ]));
    }
    body.append(rows);
    await renderMarks(body);
  }

  // Highlights and notes across the library, newest first (the latest few, or all of them on request),
  // with a way to keep them safe
  let allMarksShown = false;
  async function renderMarks(body) {
    if (!window.Marks) return;
    let marks = [];
    try { marks = await window.Marks.all(); } catch (_) { marks = []; }
    const sec = el("section", { class: "marks-sec" });
    const head = el("div", { class: "home-sec-head" }, [el("h2", { text: marks.length ? `Highlights and notes · ${marks.length}` : "Highlights and notes" }),
      marks.length > 10 ? el("button", { type: "button", class: "text-btn small", text: allMarksShown ? "Latest only" : `All ${marks.length}`, onclick: () => { allMarksShown = !allMarksShown; sec.replaceWith(el("div")); renderMarks(body); } }) : null].filter(Boolean));
    sec.append(head);
    if (!marks.length) {
      sec.append(el("p", { class: "studies-lede", text: "Tap a verse or paragraph while reading, then a color or Note: your marks come back whenever the page opens, and are listed here." }));
    } else {
      const list = el("div", { class: "mark-list" });
      for (const m of marks.slice(0, allMarksShown ? 1000 : 10)) {
        list.append(el("button", { type: "button", class: `mark-row${m.color ? ` hl-${m.color}` : ""}`, onclick: async () => {
          let id = m.doc_id;
          try { const res = await api("resolve", { href: m.uri }); if (res.found && res.doc_id) id = res.doc_id; } catch (_) {}
          if (id) openDoc(id, m.pid); else toast("That page is not in the library now.");
        } }, [
          el("span", { class: "mk-cite", text: m.citation || m.title || m.uri }),
          el("span", { class: "mk-text", text: (m.text || "").length > 140 ? m.text.slice(0, 138) + "…" : (m.text || "") }),
          m.note ? el("span", { class: "mk-note" }, [el("span", { class: "ic", html: ICON_NOTE }), document.createTextNode(m.note.length > 160 ? m.note.slice(0, 158) + "…" : m.note)]) : null,
        ].filter(Boolean)));
      }
      sec.append(list);
    }
    const pick = el("input", { type: "file", accept: ".json,application/json", hidden: true, "aria-hidden": "true" });
    pick.addEventListener("change", async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      try { const n = await window.Marks.importJson(await file.text()); toast(n ? `${n} ${n === 1 ? "mark" : "marks"} brought in.` : "Nothing new in that file."); renderHome(); }
      catch (err) { toast(err.message || "That file could not be read."); }
      pick.value = "";
    });
    sec.append(el("div", { class: "marks-tools" }, [
      marks.length ? el("button", { type: "button", class: "text-btn", text: "Export", title: "Save your highlights and notes to a file", onclick: async () => {
        try {
          const blob = new Blob([await window.Marks.exportJson()], { type: "application/json" });
          const a = el("a", { href: URL.createObjectURL(blob), download: `gospel-marks-${new Date().toISOString().slice(0, 10)}.json` });
          document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        } catch (_) { toast("Could not export just now."); }
      } }) : null,
      el("button", { type: "button", class: "text-btn", text: "Import", title: "Bring in highlights and notes from a file", onclick: () => pick.click() }),
      pick,
    ].filter(Boolean)));
    body.append(sec);
  }

  // ---- Think it through, from anywhere ------------------------------------
  // A floating button over the page being read, or over the results: the page (with anything
  // selected) or the search goes to Claude on the Ask tab, which comes back with what the
  // library holds that connects to it, each passage a card for the deck.
  let thinkFab = null;
  function updateThinkFab() {
    if (!thinkFab) {
      thinkFab = el("button", { type: "button", class: "fab-think", hidden: true, title: "Think it through with Claude", "aria-label": "Think it through with Claude", onclick: () => thinkHere() }, [
        el("span", { class: "ic", html: ICON_THINK }), el("span", { class: "lb", text: "Think it through" })]);
      document.body.append(thinkFab);
    }
    const askOpen = state.browse?.tab === "ask" && !listPane.hidden;
    const page = !!(state.docId && currentDoc && currentDoc.id === state.docId && !readerPane.hidden) || !!(state.studyId && currentStudy && currentStudy.id === state.studyId && !readerPane.hidden);
    const results = !page && !listPane.hidden && !!(state.lastSearch && state.lastSearch.hits && state.lastSearch.hits.length) && state.q.trim().length >= 2;
    thinkFab.hidden = !(page || results) || (askOpen && !page) || !stage.hidden;
    thinkFab.classList.toggle("over-reader", page);
    $(".lb", thinkFab).textContent = page ? "Think it through" : "Think these through";
  }
  function thinkHere() {
    if (!window.Ask) return;
    rememberScroll();
    const page = state.docId && currentDoc && currentDoc.id === state.docId;
    const study = !page && state.studyId && currentStudy && currentStudy.id === state.studyId;
    const subject = page
      ? window.Ask.subjectFor({ doc: currentDoc, selection: selectedUnits(), marks: [...docMarks.values()] })
      : study ? window.Ask.subjectFor({ doc: { title: currentStudy.title, body_html: `<p>${esc(window.Studies.plainText(currentStudy))}</p>`, collection: "studies", collection_title: "My studies" } })
      : window.Ask.subjectFor({ query: state.q.trim(), hits: state.lastSearch?.hits || [] });
    if (!window.Ask.hasKey()) toast("Thinking it through needs your Claude API key: add it under Ask.");
    leaveSearch();
    state.q = ""; syncControls();
    if (!wide()) { state.docId = null; state.pid = null; state.studyId = null; } // on a phone the page gives way to the thinking; Back returns to it
    state.browse = { tab: "ask", think: window.Ask.hasKey() ? subject : null };
    renderHome(); showList(); push();
  }

  function footBtn(label, icon, onclick) {
    return el("button", { type: "button", class: "foot-btn", "aria-label": label, onclick }, [el("span", { class: "ic", html: icon }), el("span", { class: "lb", text: label })]);
  }

  // Tap a verse or paragraph to select it for the deck; a bar offers what to do with the selection.
  function onSelectClick(e) {
    if (e.defaultPrevented || e.target.closest("a, button, .notes, header, .orig")) return;
    const unit = e.target.closest("p.verse, .body-block p, .body-block li, p[id]");
    if (!unit || !unit.id || !unit.closest(".doc")) return;
    unit.classList.toggle("sel");
    updateSelectBar();
  }
  function selectedUnits() {
    const body = $(".doc", readerPane);
    if (!body) return [];
    return [...body.querySelectorAll(".sel")].map((n) => {
      const c = n.cloneNode(true);
      for (const junk of c.querySelectorAll("sup.marker, .verse-number, .page-break, .note-mark")) junk.remove();
      const num = n.querySelector(".verse-number");
      const verse = num ? parseInt(num.textContent, 10) : null;
      return { pid: n.id, kind: n.classList.contains("verse") ? "verse" : "para", verse: Number.isFinite(verse) ? verse : null, text: c.textContent.replace(/\s+/g, " ").trim() };
    });
  }
  function clearSelection() {
    for (const n of readerPane.querySelectorAll(".sel")) n.classList.remove("sel");
    updateSelectBar();
  }
  function updateSelectBar() {
    let bar = $(".select-bar", readerPane);
    const n = readerPane.querySelectorAll(".sel").length;
    if (!n) { bar?.remove(); return; }
    if (!bar) {
      bar = el("div", { class: "select-bar" }, [
        el("span", { class: "n" }),
        window.Marks ? el("span", { class: "hl-dots", role: "group", "aria-label": "Highlight" }, window.Marks.COLORS.map((c) => el("button", { type: "button", class: `hl-dot hl-${c}`, "data-color": c, "aria-pressed": "false", "aria-label": `Highlight ${window.Marks.COLOR_NAME[c]}`, title: `Highlight ${window.Marks.COLOR_NAME[c]}`, onclick: () => highlightSelection(c) }))) : null,
        window.Marks ? el("button", { type: "button", class: "text-btn", text: "Note", title: "A note on the selected passages, first to last", onclick: () => { const u = selectedUnits(); if (u.length) editNote(u[0], u.length > 1 ? u[u.length - 1] : null); } }) : null,
        el("button", { type: "button", class: "primary add-deck", "aria-label": "Add to deck", onclick: () => {
          const first = $(".doc .sel", readerPane);
          const added = window.Deck?.addFromDoc(currentDoc, selectedUnits());
          clearSelection(); // the bar goes, and focus with it: back to the first verse that was selected
          focusUnit(first);
          deckToast(added, added === 1 ? "On the deck. Tap Deck to highlight and link." : `${added} passages on the deck. Tap Deck to highlight and link.`);
        } }, [el("span", { class: "long", text: "Add to deck" }), el("span", { class: "short", text: "+ Deck" })]),
        el("button", { type: "button", class: "text-btn only-wide", text: "Present", onclick: () => { const u = selectedUnits(); startPresentingUnits(u.map((x) => ({ text: x.text, kind: x.kind, where: x.kind === "verse" && currentDoc ? `${chapterOf(currentDoc.citation)}:${x.verse}` : crumbFor(currentDoc) }))); } }),
        el("button", { type: "button", class: "text-btn", text: "Copy", title: "Copy with the citation", onclick: () => {
          const cite = (x) => x.kind === "verse" && currentDoc ? `${chapterOf(currentDoc.citation)}:${x.verse}` : crumbFor(currentDoc) || currentDoc?.title || "";
          const text = selectedUnits().map((x) => `${x.text} (${cite(x)})`).join("\n\n");
          navigator.clipboard?.writeText(text).then(() => toast("Copied, with the citation."), () => toast("Could not copy here."));
        } }),
        el("button", { type: "button", class: "text-btn clear-sel", "aria-label": "Clear selection", title: "Clear selection", onclick: () => { const f = $(".doc .sel", readerPane); clearSelection(); focusUnit(f); } }, [el("span", { class: "long", text: "Clear" }), el("span", { class: "short", text: "×", "aria-hidden": "true" })]),
      ]);
      // right after the reader bar in the order Tab and VoiceOver follow; app.css draws it at the bottom
      const rb = $(".reader-bar", readerPane);
      if (rb) rb.after(bar); else readerPane.prepend(bar);
    }
    $(".n", bar).textContent = `${n} selected`;
    // a dot is pressed when every selected passage carries its color (pressing it again takes it off)
    const pids = [...readerPane.querySelectorAll(".doc .sel")].map((u) => u.id);
    for (const d of bar.querySelectorAll(".hl-dot")) d.setAttribute("aria-pressed", String(!!pids.length && pids.every((pid) => docMarks.get(pid)?.color === d.dataset.color)));
  }
  // toast(text, { action: "Undo", onAction }) adds a button and stays about five seconds, long
  // enough to reach it; the plain toast still goes after two. A newer toast replaces an older one.
  // There is one toast element, a live region made once and kept: VoiceOver reads a change to its
  // words, where a status element created already filled is often missed. Cmd+Z or Ctrl+Z presses
  // its Undo while it shows (VoiceOver cannot reach the button in five seconds).
  let toastEl = null, toastTimer = null, toastAct = null;
  function toastClose() { clearTimeout(toastTimer); toastAct = null; toastEl?.classList.remove("show"); }
  function toastArm(ms) { clearTimeout(toastTimer); toastTimer = setTimeout(toastClose, ms); }
  function toast(text, { action, onAction } = {}) {
    if (!toastEl) {
      toastEl = el("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite", "aria-atomic": "true" });
      // a finger or the focus on its button keeps it from going away under them
      toastEl.addEventListener("pointerenter", () => { if (toastAct) clearTimeout(toastTimer); });
      toastEl.addEventListener("pointerleave", () => { if (toastAct) toastArm(2500); });
      toastEl.addEventListener("focusin", () => { if (toastAct) clearTimeout(toastTimer); });
      toastEl.addEventListener("focusout", () => { if (toastAct) toastArm(2500); });
      document.body.append(toastEl);
      void toastEl.offsetWidth; // laid out hidden first, so the first toast slides in like the rest
    }
    const t = toastEl;
    toastAct = action ? () => { toastClose(); try { onAction?.(); } catch (_) {} } : null;
    t.className = "toast show" + (action ? " has-action" : "");
    t.replaceChildren(...[el("span", { text }), action ? el("button", { type: "button", class: "toast-action", text: action, onclick: () => toastAct?.() }) : null].filter(Boolean));
    toastArm(action ? 5000 : 1800);
  }
  document.addEventListener("keydown", (e) => {
    if (!toastAct || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || (e.key !== "z" && e.key !== "Z")) return;
    const a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return; // a field's own undo comes first
    e.preventDefault();
    toastAct();
  });
  // The toast after an add, with an Undo that takes off exactly what that add put on.
  function deckToast(added, text) {
    const ids = added ? window.Deck?.lastAdded?.() || [] : [];
    if (!ids.length) { toast(added === 0 ? "Already on the deck." : text); return; }
    toast(text, { action: "Undo", onAction: () => { window.Deck.removeIds(ids); toast(ids.length === 1 ? "Taken off the deck." : `${ids.length} passages taken off the deck.`); } });
  }
  // The + and Add to deck buttons on results follow the deck, whatever changed it: an undo, the board's remove, another tab.
  function syncHitButtons() {
    for (const b of document.querySelectorAll("button[data-deck-pid]")) {
      const on = !!window.Deck?.has(Number(b.dataset.deckDoc), b.dataset.deckPid);
      if (b.classList.contains("add")) { b.textContent = on ? "\u2713" : "+"; b.setAttribute("aria-pressed", String(on)); }
      else b.textContent = on ? "On the deck" : "Add to deck";
    }
  }
  window.addEventListener("deck:change", syncHitButtons);

  // The library's HTML is the Church's own and the scraper already drops scripts;
  // this is cheap insurance against anything that could run or leave the app.
  function sanitize(root) {
    for (const bad of root.querySelectorAll("script, style, iframe, object, embed, link, meta, form")) bad.remove();
    for (const n of root.querySelectorAll("*")) {
      for (const a of [...n.attributes]) {
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        else if (/^(href|src|xlink:href|formaction)$/i.test(a.name) && /^\s*(javascript|vbscript|data):/i.test(a.value)) n.removeAttribute(a.name);
      }
    }
    return root;
  }

  function crumbFor(doc) {
    if (doc.collection === "general-conference") return [doc.author, doc.session, doc.label].filter(Boolean).join(", ");
    const path = (doc.section_path || []).join(", ");
    if (doc.collection && doc.collection.startsWith("jsp-")) return path || doc.label;
    return [doc.label !== doc.title ? doc.label : null, path].filter(Boolean).join(", ") || doc.collection_title;
  }

  async function onBodyClick(e) {
    const a = e.target.closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    if (a.classList.contains("study-note-ref") || /^#note/.test(href) || a.dataset.scrollId) {
      e.preventDefault();
      showNote(a.dataset.scrollId || href.split("#").pop());
      return;
    }
    if (href.startsWith("#")) { e.preventDefault(); focusParagraph(href.slice(1)); return; }
    if (href.startsWith("/") || /^https?:/i.test(href)) { e.preventDefault(); followLink(href); }
  }
  // Every link goes through here: the library's own copy when it holds the page (a verse shows
  // in a sheet first, a page or a book opens), the web otherwise.
  const CHURCH = /^https?:\/\/([a-z0-9-]+\.)*(churchofjesuschrist\.org|lds\.org)(\/|$)/i;
  async function followLink(href) {
    const url = href.startsWith("/") ? "https://www.churchofjesuschrist.org" + href : href;
    if (!CHURCH.test(url)) { openOutside(url); return; }
    let res = null;
    try { res = await api("resolve", { href: url }); } catch (_) { res = null; }
    if (!res || !res.found) { openOutside(url); return; }
    if (res.kind === "book") { openBook(res); return; }
    if (res.pid && /^p\d+$/.test(res.pid) && res.collection === "scriptures" && !(currentDoc && currentDoc.id === res.doc_id && state.docId === res.doc_id)) { peekPassage(res); return; }
    hideNote();
    openDoc(res.doc_id, res.pid);
  }
  const TAB_OF = { "general-conference": "conference", scriptures: "scriptures", "preach-my-gospel": "preach-my-gospel", "missionary-standards": "missionary-standards", handbook: "handbook", "come-follow-me": "come-follow-me", manuals: "manuals", "study-helps": "study-helps" };
  function openBook(res) {
    hideNote();
    rememberScroll();
    const tab = TAB_OF[res.collection] || (res.collection.startsWith("jsp-") ? "jsp" : "manuals");
    const browse = res.book_slug ? { tab, book: res.book_slug } : { tab, bookUri: res.book_uri };
    if (tab === "jsp") browse.series = res.collection.replace(/^jsp-/, "");
    leaveSearch(); state.q = ""; if (!wide()) { state.docId = null; state.pid = null; state.studyId = null; }
    if (TAB_SCOPE[tab]) state.scope = TAB_SCOPE[tab];
    syncControls(); state.browse = browse; renderHome(); showList(); push();
  }
  // A verse someone linked to, read where you are; Open goes to the chapter.
  async function peekPassage(res) {
    const bodyEl = $(".sheet-body", sheet);
    bodyEl.replaceChildren(el("div", { class: "status", text: "Opening…" }));
    openSheet("Passage");
    let ctx = null;
    const start = Number(res.pid.slice(1)), end = res.pid_end && /^p\d+$/.test(res.pid_end) ? Number(res.pid_end.slice(1)) : start;
    try { ctx = await api("context", { doc_id: res.doc_id, pid: res.pid, before: 0, after: Math.max(0, Math.min(12, end - start)) }); } catch (_) { ctx = null; }
    if (sheet.hidden) return;
    if (!ctx) { hideNote(); openDoc(res.doc_id, res.pid); return; }
    const open = () => { hideNote(); openDoc(res.doc_id, res.pid); };
    const verses = ctx.paragraphs.filter((x) => x.kind !== "heading");
    bodyEl.replaceChildren(
      el("div", { class: "nm", text: ctx.citation || res.title }),
      el("div", { class: "peek" }, verses.map((x) => el("p", { class: x.kind === "verse" ? "verse" : "para" }, [x.verse ? el("span", { class: "vn", text: String(x.verse) }) : null, document.createTextNode(x.text)].filter(Boolean)))),
      el("div", { class: "peek-row" }, [
        el("button", { type: "button", class: "primary", text: `Open ${res.title}`, onclick: open }),
        window.Deck ? el("button", { type: "button", class: "text-btn", text: "Add to deck", onclick: async () => {
          try {
            const doc = await api("doc", { id: res.doc_id });
            const units = verses.filter((x) => x.kind === "verse" || x.kind === "para").map((x) => ({ pid: x.pid, kind: x.kind, verse: x.verse, text: x.text }));
            const added = window.Deck.addFromDoc(doc, units);
            deckToast(added, added === 1 ? "On the deck." : `${added} passages on the deck.`);
          } catch (_) { toast("Could not add that just now."); }
        } }) : null,
      ].filter(Boolean)),
    );
  }
  // A page the library does not hold: on the web, if there is a web
  function openOutside(url) {
    if (!/^https?:\/\//i.test(String(url || ""))) return; // only a web address leaves the app (a study page could hand over anything)
    if (!navigator.onLine) { toast("That page is not in the library, and you are offline."); return; }
    window.open(url, "_blank", "noopener");
  }

  function focusParagraph(pid, { scroll = true } = {}) {
    if (!pid || !currentDoc) return;
    const body = $(".doc", readerPane);
    if (!body) return;
    for (const t of body.querySelectorAll(".is-target")) t.classList.remove("is-target");
    let target = body.querySelector(`#${CSS.escape(pid)}`);
    if (!target && /^p\d+$/.test(pid)) target = body.querySelector(`.verse:nth-of-type(${pid.slice(1)})`);
    if (!target) return;
    target.classList.add("is-target");
    if (target.matches(UNIT_SEL)) rove(target); // Tab into the page lands on the verse you came for
    if (scroll) requestAnimationFrame(() => target.scrollIntoView({ block: "center", behavior: "auto" }));
  }

  function highlightTerms(body) {
    if (!state.terms.length) return;
    const stems = state.terms.map((t) => t.toLowerCase().replace(/'s$/, "")).filter((t) => t.length >= 3);
    if (!stems.length) return;
    const re = new RegExp("\\b(" + stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\w*").join("|") + ")", "gi");
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => { re.lastIndex = 0; return (n.parentElement.closest("script, style, .notes") || !re.test(n.nodeValue)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    for (const n of nodes) {
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = re.exec(n.nodeValue))) {
        frag.append(document.createTextNode(n.nodeValue.slice(last, m.index)));
        frag.append(el("mark", { class: "hl", text: m[0] }));
        last = m.index + m[0].length;
        count++;
      }
      frag.append(document.createTextNode(n.nodeValue.slice(last)));
      n.replaceWith(frag);
    }
    if (!count) return;
    const marks = [...body.querySelectorAll("mark.hl")];
    let i = -1;
    const label = el("span", { text: `${count} match${count === 1 ? "" : "es"}` });
    const go = (d) => { i = (i + d + marks.length) % marks.length; marks[i].scrollIntoView({ block: "center" }); label.textContent = `${i + 1} of ${count}`; };
    const nav = el("span", { class: "matchnav" }, [label, el("button", { text: "↑", "aria-label": "Previous match", onclick: () => go(-1) }), el("button", { text: "↓", "aria-label": "Next match", onclick: () => go(1) })]);
    $(".reader-bar .spacer", readerPane).replaceWith(nav, el("div", { class: "spacer" }));
  }

  function resize(delta) {
    const sizes = [15, 16, 17, 18, 19, 21, 23, 26, 30, 34];
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--reading-size")) || 17;
    let i = Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(cur) + delta));
    if (sizes.indexOf(cur) === -1) i = delta > 0 ? 3 : 1;
    document.documentElement.style.setProperty("--reading-size", sizes[i] + "px");
    store.set("readingSize", sizes[i]);
  }
  // The reading size: the one chosen here, or else the one the system asks for (iOS Larger Text)
  // The system size is read again whenever the app comes back to the front, since Larger Text may
  // have changed in Settings meanwhile; the accessibility sizes reach 34px.
  function applyReadingSize() { const s = store.get("readingSize"); if (s) document.documentElement.style.setProperty("--reading-size", s + "px"); else { const sys = systemTextSize(); if (sys) document.documentElement.style.setProperty("--reading-size", Math.max(15, Math.min(34, Math.round(sys))) + "px"); } }
  applyReadingSize();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") applyReadingSize(); });
  window.addEventListener("pageshow", (e) => { if (e.persisted) applyReadingSize(); });
  function systemTextSize() {
    // only on a touch screen: a Mac answers with its 13px body size, which is not a reading preference
    if (!(navigator.maxTouchPoints > 0)) return null;
    try {
      const wrap = el("div", { style: "position:absolute;visibility:hidden;font-size:11px" }, [el("span", { style: "font: -apple-system-body" })]);
      document.body.append(wrap);
      const px = parseFloat(getComputedStyle(wrap.firstChild).fontSize);
      wrap.remove();
      return Number.isFinite(px) && px !== 11 && px >= 12 ? px : null; // 11px means the browser does not know the system font
    } catch (_) { return null; }
  }

  // ------------------------------------------------------------ present ----
  // One paragraph or verse at a time, large, on a plain background: for a
  // projector, a TV over AirPlay, or a tablet turned toward the room.
  const stage = $("#stage");
  let show = null; // { units: [{pid, kind, html, verse}], i, doc }

  function presentUnits(doc) {
    const scratch = el("div", { html: doc.body_html || "" });
    const units = [];
    const jsp = !!(doc.collection && doc.collection.startsWith("jsp-"));
    let page = jsp ? pageOf(doc) : null; // the manuscript page a paragraph is on, kept with it on the stage
    const take = (node, kind) => {
      const c = node.cloneNode(true);
      for (const junk of c.querySelectorAll("sup.marker, .page-break, a.study-note-ref sup")) junk.remove();
      for (const a of c.querySelectorAll("a")) a.replaceWith(...a.childNodes);
      const html = c.innerHTML.trim();
      const text = c.textContent.replace(/\s+/g, " ").trim();
      if (!text) return;
      units.push({ pid: node.id || null, kind, html, text, where: page ? `${doc.title.replace(/, page \d+[a-z]?$/i, "")}, p. ${page}` : "" });
    };
    for (const node of scratch.querySelectorAll("h1, h2, h3, p, li, figcaption, .jsp-page")) {
      if (node.classList.contains("jsp-page")) { const m = /\[p\.\s*([^\]]+)\]/.exec(node.textContent || ""); if (m) page = m[1].trim(); continue; }
      if (node.closest("nav, video, audio, .byline, footer, .notes")) continue;
      if (node.tagName === "LI" && node.querySelector("p, li")) continue;
      const cls = node.classList;
      if (cls.contains("author-name") || cls.contains("author-role")) continue;
      take(node, cls.contains("verse") ? "verse" : node.tagName === "H1" ? "title" : /^H/.test(node.tagName) ? "heading" : cls.contains("kicker") ? "kicker" : "para");
    }
    return units;
  }

  function startPresenting(fromPid) {
    if (!currentDoc) return;
    const units = presentUnits(currentDoc);
    if (!units.length) return;
    const pid = fromPid || state.pid || $(".doc .is-target", readerPane)?.id || null;
    let i = pid ? units.findIndex((u) => u.pid === pid) : 0;
    if (i < 0) i = 0;
    openStage({ units, i, doc: currentDoc });
  }

  // A hand-picked list of passages (from Ask or the deck), each with its own
  // citation. opts.theme = {bg, fg, accent, muted} colors the stage like the deck.
  function startPresentingUnits(units, opts = {}) {
    if (!units || !units.length) return;
    openStage({ units: units.map((u) => ({ kind: u.kind || "para", html: u.html || esc(u.text || ""), text: u.text || "", where: u.where || "", pid: null, doc_id: u.doc_id || null })), i: 0, doc: null, theme: opts.theme || null });
  }

  // The controls show on a touch, then fade: what the room sees is the words, not the buttons.
  let controlsTimer = null;
  function wakeControls() {
    stage.classList.add("show-controls");
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => stage.classList.remove("show-controls"), 2500);
  }
  // A mouse moving wakes the controls; a touch wakes them only in the top-right corner, where
  // they live, so taps that turn the page leave the room looking at the words alone.
  stage.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") wakeControls(); }, { passive: true });
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") { wakeControls(); return; }
    const r = stage.getBoundingClientRect();
    if (e.clientY - r.top < 120 && r.right - e.clientX < 220) wakeControls();
  }, { passive: true });
  // The elapsed time since Present began, for the speaker only: it sits in the controls and
  // keeps counting while the screen is blanked. Tapping it starts it again from 0:00.
  let stageClock = null, stageT0 = 0;
  const stageTimer = $(".stage-timer", stage);
  function tickStage() {
    const s = Math.max(0, Math.floor((Date.now() - stageT0) / 1000));
    stageTimer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function resetStageClock() {
    stageT0 = Date.now();
    tickStage();
    clearInterval(stageClock);
    stageClock = setInterval(tickStage, 1000);
  }
  stageTimer.addEventListener("click", () => { resetStageClock(); wakeControls(); });
  // The first words of a passage, for the "Next:" line: plain text, without a verse's number.
  function firstWords(u, n = 6) {
    let t = u.text || new DOMParser().parseFromString(u.html || "", "text/html").body.textContent || "";
    t = t.replace(/\s+/g, " ").trim();
    if (u.kind === "verse") t = t.replace(/^\d+\s+/, "");
    const words = t.split(" ").filter(Boolean);
    return words.slice(0, n).join(" ") + (words.length > n ? "…" : "");
  }
  let stageOpener = null;
  function openStage(next) {
    show = { ...next, scale: store.get("stageScale", 1) };
    openOverlay("stage");
    resetStageClock();
    stageOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    document.body.classList.add("presenting");
    wakeControls();
    stage.classList.toggle("themed", !!next.theme);
    for (const k of ["bg", "fg", "accent", "muted"]) stage.style.setProperty(`--stage-${k}`, next.theme?.[k] || "");
    stage.hidden = false;
    updateThinkFab();
    renderStage();
    stage.tabIndex = -1;
    try { stage.focus({ preventScroll: true }); } catch (_) {}
    if (stage.requestFullscreen && !document.fullscreenElement) stage.requestFullscreen().catch(() => {});
    try { navigator.wakeLock?.request("screen").then((l) => { show.lock = l; }).catch(() => {}); } catch (_) {}
  }

  function stopPresenting() {
    if (!show) return;
    const atPid = show.doc ? show.units[show.i]?.pid : null;
    show.lock?.release?.();
    show = null;
    clearInterval(stageClock); stageClock = null;
    stage.hidden = true;
    stage.classList.remove("blank");
    updateThinkFab();
    stage.classList.remove("themed");
    document.body.classList.remove("presenting");
    if (atPid) focusParagraph(atPid);
    // focus goes back to what opened the stage, once the screen is out of full-screen (nothing outside it can take focus before)
    const back = stageOpener && stageOpener.isConnected ? stageOpener : (atPid ? readerPane.querySelector(`#${CSS.escape(atPid)}`) : null);
    stageOpener = null;
    const restore = () => { if (back && back.isConnected) { try { back.focus({ preventScroll: true }); } catch (_) {} } };
    if (document.fullscreenElement) { const p = document.exitFullscreen?.(); if (p && p.then) p.then(restore, restore); else restore(); }
    else restore();
    dropOverlay("stage"); // closed by hand: its marker goes too (Back closing it has already cleared overlay)
  }

  function renderStage() {
    if (!show) return;
    const u = show.units[show.i];
    const d = show.doc;
    let where = u.where || "";
    if (d && !(u.where && d.collection && d.collection.startsWith("jsp-"))) {
      const ref = u.kind === "verse" && d.book_slug && u.pid ? `${chapterOf(d.citation)}:${u.pid.replace(/^p/, "")}` : null;
      where = d.collection === "general-conference" ? [d.author, d.title, d.label.replace(" General Conference", "")].filter(Boolean).join("  \u00b7  ") : (ref || d.citation);
    }
    const body = $(".stage-body", stage);
    body.style.setProperty("--stage-scale", show.scale);
    body.classList.toggle("is-title", u.kind === "title");
    body.classList.toggle("is-question", u.kind === "question");
    body.classList.toggle("is-note", u.kind === "note");
    body.classList.toggle("is-wide", u.kind === "link" || u.kind === "map");
    $(".stage-text", stage).innerHTML = u.kind === "verse" ? u.html.replace(/<span class="verse-number">[^<]*<\/span>/, "") : u.html;
    $(".stage-ref", stage).textContent = where;
    $(".stage-count", stage).textContent = `${show.i + 1} / ${show.units.length}`;
    $(".stage-prev", stage).disabled = show.i === 0;
    $(".stage-next", stage).disabled = show.i === show.units.length - 1;
    const after = show.units[show.i + 1];
    const peek = after ? firstWords(after) : "";
    $(".stage-upnext", stage).textContent = peek ? `Next: ${peek}` : "";
    fitStage();
  }

  // Shrink the type until the passage fits the screen, so nothing scrolls.
  function fitStage() {
    const body = $(".stage-body", stage);
    const text = $(".stage-text", stage);
    let size = 7.2 * (show?.scale || 1);
    text.style.fontSize = size + "vmin";
    let guard = 24;
    while (guard-- && (text.scrollHeight > body.clientHeight * 0.92 || text.scrollWidth > body.clientWidth) && size > 2.2) {
      size *= 0.92;
      text.style.fontSize = size + "vmin";
    }
  }

  function stageStep(delta) {
    stage.classList.remove("blank");
    if (!show) return;
    const n = show.i + delta;
    if (n < 0 || n >= show.units.length) return;
    show.i = n;
    renderStage();
  }
  function stageScale(delta) {
    if (!show) return;
    show.scale = Math.max(0.6, Math.min(1.8, Math.round((show.scale + delta) * 10) / 10));
    store.set("stageScale", show.scale);
    renderStage();
  }

  $(".stage-prev", stage).addEventListener("click", () => stageStep(-1));
  $(".stage-next", stage).addEventListener("click", () => stageStep(1));
  $(".stage-close", stage).addEventListener("click", stopPresenting);
  $(".stage-smaller", stage).addEventListener("click", () => stageScale(-0.1));
  $(".stage-larger", stage).addEventListener("click", () => stageScale(0.1));
  $(".stage-theme", stage).addEventListener("click", () => {
    // From a deck's own colors, the first tap goes to plain light or dark.
    if (stage.classList.contains("themed")) { stage.classList.remove("themed"); return; }
    const dark = stage.classList.toggle("dark");
    store.set("stageDark", dark);
  });
  if (store.get("stageDark", true)) stage.classList.add("dark");
  // Tap the right half to advance, the left half to go back; swipe works too.
  let touchX = null;
  $(".stage-body", stage).addEventListener("click", (e) => {
    if (e.target.closest("button") || pressed) return;
    const r = stage.getBoundingClientRect();
    stageStep(e.clientX - r.left > r.width / 2 ? 1 : -1);
  });
  let pressTimer = null, pressed = false;
  stage.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX;
    // a long press on the words blanks the screen (and brings it back), the way B does from a keyboard
    pressed = false;
    clearTimeout(pressTimer);
    if (!e.target.closest("button")) pressTimer = setTimeout(() => { pressed = true; stage.classList.toggle("blank"); }, 600);
  }, { passive: true });
  stage.addEventListener("touchmove", () => { clearTimeout(pressTimer); }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    clearTimeout(pressTimer);
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (pressed) { pressed = false; return; }
    if (Math.abs(dx) > 60) stageStep(dx < 0 ? 1 : -1);
  }, { passive: true });
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && show) stopPresenting(); });
  window.addEventListener("resize", () => { if (show) fitStage(); });

  // ---------------------------------------------------------- footnotes ----
  const sheet = $("#sheet");
  function showNote(noteId) {
    if (!currentDoc) return;
    const n = (currentDoc.footnotes || []).find((x) => x.note_id === noteId) || null;
    const bodyEl = $(".sheet-body", sheet);
    if (!n) {
      const inline = readerPane.querySelector(`#${CSS.escape(noteId)}`);
      if (inline) { inline.scrollIntoView({ block: "center" }); return; }
      bodyEl.replaceChildren(el("div", { text: "That note is not in the local copy." }));
    } else {
      bodyEl.replaceChildren(...[n.marker ? el("div", { class: "nm", text: `Note ${n.marker}` }) : null, sanitize(el("div", { html: n.html || esc(n.text) }))].filter(Boolean));
    }
    openSheet("Footnote");
  }
  let sheetOpener = null;
  function openSheet(label) {
    sheet.setAttribute("aria-label", label);
    const wasHidden = sheet.hidden;
    sheet.hidden = false;
    if (wasHidden) {
      sheetOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null; setTimeout(() => { const first = sheet.querySelector("textarea, input, .peek-row button, .close"); try { (first || sheet).focus({ preventScroll: true }); } catch (_) {} }, 30); openOverlay("sheet");
      const vv = window.visualViewport;
      if (vv) { vv.addEventListener("resize", liftSheet); vv.addEventListener("scroll", liftSheet); }
      liftSheet();
      inertBehind(sheet, true);
    }
    if (!$("#scrim")) { const scrim = el("div", { class: "scrim", onclick: () => { if (!keepTyped()) closeSheet(); } }); scrim.id = "scrim"; document.body.append(scrim); }
    $(".sheet-body", sheet).onclick = (e) => {
      const a = e.target.closest("a");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href") || "";
      if (href.startsWith("#")) { closeSheet(); focusParagraph(href.slice(1)); return; }
      followLink(href);
    };
  }
  // hideNote takes the sheet down and leaves history alone: for the moment before a move, whose
  // push() takes over the marker. closeSheet is the user closing it: the marker is popped as well.
  function hideNote() {
    const wasOpen = !sheet.hidden;
    sheet.hidden = true; $("#scrim")?.remove();
    inertBehind(sheet, false); // before the focus goes back to what opened it
    sheetKeep = null;
    const vv = window.visualViewport;
    if (vv) { vv.removeEventListener("resize", liftSheet); vv.removeEventListener("scroll", liftSheet); }
    sheet.style.bottom = ""; sheet.style.maxHeight = "";
    if (wasOpen && sheetOpener && sheetOpener.isConnected) { try { sheetOpener.focus({ preventScroll: true }); } catch (_) {} }
    sheetOpener = null;
  }
  function closeSheet() { const had = overlay === "sheet"; hideNote(); if (had) dropOverlay("sheet"); }
  // A dialog over the page (the sheet, the stage) is modal: aria-modal on it, and everything else
  // in the body inert while it is open, so VoiceOver and Tab stay inside it. The toast stays live
  // (its Undo must stay reachable). inertBehind(node, false) undoes exactly what it did; the stage
  // calls it from openStage and stopPresenting.
  const inertSets = new Map(); // dialog -> the elements it made inert
  function inertBehind(node, on) {
    if (!node) return;
    if (on) {
      if (inertSets.has(node)) return;
      node.setAttribute("aria-modal", "true");
      const list = [...document.body.children].filter((n) => n !== node && !n.contains(node) && !n.inert && n.id !== "scrim" && n.id !== "toast" && n.tagName !== "SCRIPT");
      for (const n of list) n.inert = true;
      inertSets.set(node, list);
    } else {
      const list = inertSets.get(node);
      if (!list) return;
      for (const n of list) n.inert = false;
      inertSets.delete(node);
    }
  }
  // The iPhone keyboard covers the bottom of the layout viewport, and the sheet with it: while it
  // is up the sheet sits on top of it (the visual viewport's bottom), so Save stays in reach.
  function liftSheet() {
    const vv = window.visualViewport;
    if (!vv || sheet.hidden) return;
    const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    sheet.style.bottom = covered > 40 ? covered + "px" : "";
    sheet.style.maxHeight = covered > 40 ? Math.max(160, Math.round(vv.height * 0.9)) + "px" : "";
  }
  // A sheet holding typed words (a note not yet saved) does not go on Esc or a tap outside:
  // sheetKeep says whether it holds any; Save or Cancel decide.
  let sheetKeep = null;
  function keepTyped() {
    if (!sheetKeep || !sheetKeep()) return false;
    toast("Your note is not saved yet: Save it, or Cancel to let it go.");
    const ta = sheet.querySelector("textarea");
    if (ta) { try { ta.focus({ preventScroll: true }); } catch (_) {} }
    return true;
  }
  sheet.tabIndex = -1;
  sheet.addEventListener("keydown", (e) => { // Tab stays within the sheet while it is open
    if (e.key !== "Tab") return;
    const focusables = [...sheet.querySelectorAll("button, [href], input, textarea, select, [tabindex]:not([tabindex='-1'])")].filter((n) => !n.disabled && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheet)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $(".close", sheet).addEventListener("click", closeSheet);

  // ----------------------------------------------------------- controls ----
  input.addEventListener("input", () => {
    if (!state.ready) return;
    state.q = input.value; state.view = null;
    if (!wide() && !readerPane.hidden) { state.docId = null; state.pid = null; state.studyId = null; showList(); }
    scheduleSearch();
  });
  $("#searchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!state.ready) return;
    clearTimeout(typeTimer);
    input.blur();
    // A deck in progress: ask what this search should do with it before going on.
    if (window.Deck?.shouldAsk() && state.q.trim().length >= 2) {
      const choice = await window.Deck.askAboutDeck({ kind: "search" });
      if (choice === "cancel") return;
    }
    runSearch({ typeahead: false });
  });
  $(".clear").addEventListener("click", () => { if (!state.ready) return; input.value = ""; state.q = ""; input.focus(); runSearch(); });
  for (const b of document.querySelectorAll(".scopes button")) {
    b.addEventListener("click", () => { if (!state.ready) return; state.scope = b.dataset.scope; syncControls(); runSearch({ typeahead: false }); });
  }
  $("#homeBtn").addEventListener("click", () => { if (state.ready) goHome(); });
  $("#filterBtn").addEventListener("click", () => { filters.hidden = !filters.hidden; mainEl.classList.toggle("filters-open", !filters.hidden); });
  function openTab(tab) {
    if (!state.ready) return;
    rememberScroll();
    leaveSearch();
    state.q = "";
    if (!wide()) { state.docId = null; state.pid = null; state.studyId = null; }
    state.browse = { tab };
    syncControls(); renderHome(); showList(); push();
  }
  $("#askBtn").addEventListener("click", () => openTab("ask"));
  $("#deckBtn").addEventListener("click", () => openTab("deck"));
  const applyFilters = () => {
    if (!state.ready) return;
    state.speaker = $("#fSpeaker").value.trim(); state.from = $("#fFrom").value.trim(); state.to = $("#fTo").value.trim(); state.book = $("#fBook").value.trim();
    syncControls(); runSearch({ typeahead: false });
  };
  for (const id of ["#fSpeaker", "#fFrom", "#fTo", "#fBook"]) $(id).addEventListener("change", applyFilters);
  for (const b of document.querySelectorAll("#fGroup button")) b.addEventListener("click", () => { state.group = b.dataset.group; applyFilters(); });
  $("#fClear").addEventListener("click", () => { state.speaker = state.from = state.to = state.book = ""; state.group = "passages"; syncControls(); runSearch({ typeahead: false }); });
  window.addEventListener("resize", () => { if (!state.ready) return; if (state.docId) showReader(); else showList(); });
  document.addEventListener("keydown", (e) => {
    if (show) {
      if ((e.key === " " || e.key === "Enter") && e.target && e.target.closest && e.target.closest(".stage-controls button")) return; // the button takes it
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown" || e.key === "ArrowDown") { e.preventDefault(); stageStep(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "ArrowUp" || e.key === "Backspace") { e.preventDefault(); stageStep(-1); }
      else if (e.key === "Escape") stopPresenting();
      else if (e.key === "+" || e.key === "=") stageScale(0.1);
      else if (e.key === "-") stageScale(-0.1);
      else if (e.key === "b" || e.key === "B" || e.key === ".") { e.preventDefault(); stage.classList.toggle("blank"); } // a blank screen while the teacher talks
      return;
    }
    // Single-key shortcuts never fire while typing in any field (the Ask box, a deck title, a label).
    const a = document.activeElement;
    const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
    if (e.key === "Escape") { if (!sheet.hidden) { if (!keepTyped()) closeSheet(); } else if (typing) a.blur(); return; }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "/" && !document.body.classList.contains("setup")) { e.preventDefault(); input.focus(); input.select(); }
    if ((e.key === "p" || e.key === "P") && currentDoc && !readerPane.hidden) { e.preventDefault(); startPresenting(); }
  });

  const ICON_THINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V17h5v-1.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/></svg>';
  const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_PRESENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
  const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register(new URL("sw.js", BASE)).catch(() => {});

  // Search by meaning: the model (35 MB, once) and the paragraphs' vectors load
  // quietly after the library is open; until then search goes by words alone.
  let semState = null;
  async function semanticNote() {
    try { semState = await api("semanticStatus", {}); } catch (_) { return ""; }
    return semState.available && semState.ready ? "search by meaning is on" : "";
  }
  async function loadSemantic() {
    try { semState = await api("semanticStatus", {}); } catch (_) { return; }
    if (!semState.available || (semState.ready && semState.loaded)) return; // model and index both in place
    // the home screen's footer line shows the download, then that meaning search is on
    const note = (text) => {
      const f = $("#homeStatus"); if (!f) return;
      const base = f.textContent.replace(/ · (search by meaning is on|getting the search model[^·]*|preparing search by meaning…)$/, "");
      f.textContent = text ? `${base} · ${text}` : base;
    };
    try {
      await call("loadSemantic", { base: new URL("./", BASE).href }, (p) => {
        if (p.phase === "model" && p.total) note(`getting the search model (${mb(p.loaded)} of ${mb(p.total)}, once)…`);
        else if (p.phase === "index") note("preparing search by meaning…");
      });
      semState = await api("semanticStatus", {});
      note(semState.ready ? "search by meaning is on" : "");
    } catch (err) {
      note("");
      console.warn("search by meaning is off:", err?.message);
    }
  }

  // The owner's private writing skills, published sealed beside the library
  // and unlocked with the same passphrase; kept on the device until the
  // published copy changes.
  async function loadSkills() {
    try {
      const m = await (await fetch(MANIFEST_URL, { cache: "no-store" })).json();
      const entry = m.skills;
      const cached = store.get("skills");
      if (!entry) { if (cached) store.del("skills"); return; }
      if (cached && cached.sha256 === entry.sha256) return;
      const passphrase = store.get("passphrase");
      if (!passphrase) return;
      const text = await call("unseal", { url: new URL("data/" + entry.file + "?v=" + entry.sha256.slice(0, 12), BASE).href, passphrase });
      store.set("skills", { sha256: entry.sha256, data: JSON.parse(text) });
      window.dispatchEvent(new CustomEvent("skills:change"));
    } catch (_) { /* offline, or none published: whatever is on the device stands */ }
  }

  // What ask.js needs from the app.
  // The deck board's pane on wide screens. deck.js calls show() with its board; lastEl says the
  // board has been opened this session, which is when the Page | Deck switch appears. Which of
  // the two panes shows is paneView; the switch only changes that, never the address or the trail.
  let paneView = "page", unseen = false;
  const panel = {
    lastEl: null, lastTitle: "",
    show(node, title) {
      panel.lastEl = node; panel.lastTitle = title || "";
      if (!wide()) return;
      if (!panelPane.contains(node)) { // mounted once; later calls only bring it forward
        panelPane.replaceChildren(el("div", { class: "reader-bar" }, [trailButton(), el("div", { class: "crumb", text: panel.lastTitle }), el("div", { class: "spacer" }), el("span", { class: "pane-switch-slot" })]), node);
        panelPane.scrollTop = 0;
      }
      paneView = "board";
      placePanes();
    },
    restore() { if (panel.lastEl) panel.show(panel.lastEl, panel.lastTitle); },
    page() {
      paneView = "page";
      placePanes();
      if (unseen && !readerPane.hidden) { unseen = false; focusParagraph(state.pid); }
      if (state.studyId) fitStudyFrame();
    },
  };
  function pageOpen() {
    return !!((state.docId && currentDoc && currentDoc.id === state.docId) || (state.studyId && currentStudy && currentStudy.id === state.studyId));
  }
  // Wide screens only: the board when it was asked for, otherwise the page if there is one.
  function placePanes() {
    const board = paneView === "board" && !!panel.lastEl;
    panelPane.hidden = !(board && panelPane.contains(panel.lastEl));
    readerPane.hidden = board || !(state.docId || state.studyId);
    refreshSwitches();
    updateThinkFab();
  }
  function refreshSwitches() {
    const on = wide() && !!panel.lastEl && pageOpen();
    const boardUp = !panelPane.hidden;
    const hadFocus = document.activeElement && document.activeElement.closest(".pane-switch") ? document.activeElement.textContent : null;
    for (const slot of document.querySelectorAll(".pane-switch-slot")) {
      if (!on) { slot.replaceChildren(); continue; }
      const seg = (label, active, go) => el("button", { type: "button", class: active ? "on" : "", "aria-pressed": String(active), text: label, onclick: () => { if (!active) go(); } });
      slot.replaceChildren(el("div", { class: "pane-switch", role: "group", "aria-label": "Show in this pane" }, [
        seg("Page", !boardUp, () => panel.page()),
        seg("Deck", boardUp, () => panel.restore()),
      ]));
    }
    // a switch that had focus keeps it on the pane now showing
    if (hadFocus) { const visible = [...document.querySelectorAll(".pane-switch button")].find((b) => b.offsetParent !== null && b.classList.contains("on")); if (visible) { try { visible.focus({ preventScroll: true }); } catch (_) {} } }
  }

  function searchFor(q) {
    rememberScroll();
    state.q = q; state.offset = 0;
    if (!wide()) { state.docId = null; state.pid = null; }
    syncControls(); showList(); runSearch({ typeahead: false });
  }
  window.GL = {
    api, el, esc, store, openDoc, startPresentingUnits, toast, panel, search: searchFor, openSheet, hideSheet: hideNote, closeSheet,
    get ready() { return state.ready; },
    get skills() { return store.get("skills")?.data || null; },
    get wide() { return wide(); },
  };

  // ------------------------------------------------------------- start ----
  (async () => {
    readUrl();
    if (!history.state || !Number.isInteger(history.state.n)) history.replaceState({ n: 0, label: null, prev: null }, "", location.href);
    syncControls();
    const ok = await ensureLibrary();
    if (!ok) return;
    state.ready = true;
    try { navigator.storage?.persist?.().catch(() => {}); } catch (_) {} // 150 MB that should not be evicted
    api("speakers", {}).then((rows) => { const dl = $("#speakerList"); for (const r of rows) dl.append(el("option", { value: r.name })); }).catch(() => {});
    await render();
    if (!state.q && !state.docId && wide()) input.focus();
    setTimeout(checkForUpdate, 1500);
    setTimeout(loadSkills, 400);
    setTimeout(loadSemantic, 2500);
  })();
})();
