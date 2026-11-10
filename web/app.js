/* Gospel Library, personal edition. Plain JavaScript, no build step.
   The library lives on this device; engine.js (a Web Worker) holds it and
   answers searches. This file is the interface. */
import { shortTitle as shortTitleOf, chapterOf, papersCitation, papersPageOf } from "./lib/cite.js";
import { pickDelta, looksLikeIos, iosVersion, needsNewerIos } from "./lib/checks.js";
import { esc, mb } from "./lib/format.js";

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
  // two panes from an iPad in portrait up; a phone on its side is wide enough but far too short, so it keeps the phone's layout (app.css agrees)
  const wide = () => window.matchMedia("(min-width: 760px) and (min-height: 500px)").matches;
  const monthName = (m) => (m === 4 ? "April" : m === 10 ? "October" : "");
  const BASE = new URL(".", document.baseURI);
  const MANIFEST_URL = new URL("data/manifest.json", BASE).href;
  // Small preferences in localStorage. set returns false when the write did not take (the store
  // is full, or the browser refuses it) and says so once in a while, so nothing is lost unheard.
  let storeWarned = 0;
  const store = {
    get(k, d = null) { try { const v = localStorage.getItem("gospel." + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) {
      try { localStorage.setItem("gospel." + k, JSON.stringify(v)); return true; }
      catch (_) {
        if (Date.now() - storeWarned > 10000) { storeWarned = Date.now(); try { toast(/^deck/.test(k) ? "Storage is full. The deck could not be saved." : "Storage is full. The setting could not be saved."); } catch (__) {} }
        return false;
      }
    },
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
    cbook: "", exact: false, // the concordance's book chip and its Exact words switch
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

  // What changed, said aloud: one polite live region that is never seen, made before anything
  // happens so VoiceOver is already listening to it ("3 verses selected"). The toast is the other
  // live region; this one is for changes that need no words on the screen.
  const sayEl = el("div", { id: "say", class: "vh", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  document.body.append(sayEl, el("div", { id: "selSay", hidden: true, text: "Selected" })); // the second: what a selected verse is described by
  let sayTimer = null;
  function say(text) { clearTimeout(sayTimer); sayEl.textContent = ""; sayTimer = setTimeout(() => { sayEl.textContent = text; }, 60); } // emptied first, so the same words twice are read twice

  // ----------------------------------------------------------- routing ----
  // Hash routes, so the app works from any static host. Every place has an address:
  //   #                       the library (home)
  //   #scriptures?b.book=alma a shelf, with how far into it you are
  //   #search?q=faith&scope=… results
  //   #search                 Search with an empty box (its scope rides along)
  //   #ask  #deck             Ask and the Deck
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
      if (state.view === "all" && state.cbook) p.set("cbook", state.cbook);
      if (state.view === "all" && state.exact) p.set("words", "exact");
    } else if (state.browse?.tab) {
      base = state.browse.tab;
      for (const k of BROWSE_KEYS) if (state.browse[k]) p.set(`b.${k}`, String(state.browse[k]));
      if (base === "search" && state.scope !== "all") p.set("scope", state.scope);
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
    state.cbook = state.view ? p.get("cbook") || "" : "";
    state.exact = !!state.view && p.get("words") === "exact";
    if (!searching && /^[a-z][\w-]*$/.test(base)) {
      state.browse = { tab: base };
      for (const k of BROWSE_KEYS) { const v = p.get(`b.${k}`); if (v !== null) state.browse[k] = k === "year" ? Number(v) : k === "all" ? v === "true" : v; }
      if (!p.get("scope") && TAB_SCOPE[base]) state.scope = TAB_SCOPE[base];
    } else state.browse = searching ? { tab: "search" } : null; // Search is where an emptied box comes back to
    state.docId = p.get("doc") ? Number(p.get("doc")) : null;
    state.pid = p.get("p") || null;
    state.studyId = !state.docId && p.get("s") ? p.get("s") : null;
  }

  // Each of the four places keeps a trail of its own. The browser has one history, so it holds
  // the trail of the place in front and no other: a tap on another tab puts this trail away (its
  // entries, with their names and their scroll), steps the browser back to where the trails
  // begin, and lays the other place's trail down there. Back then walks the place you are in, as
  // it always did, and never crosses into another. To put a trail away its entries must be known,
  // and the browser shows only the current one, so every push and replace is mirrored here by
  // position (each entry carries its own as i). The mirror and the trails put away live in
  // sessionStorage, so a reload finds them.
  const TAB_TOP = { library: "#", search: "#search", deck: "#deck", ask: "#ask" };
  const tabOfUrl = (u) => { const b = String(u || "").replace(/^[^#]*#?/, "").split("?")[0]; return b === "search" || b === "deck" || b === "ask" ? b : "library"; };
  let pos = Number.isInteger(history.state?.i) ? history.state.i : 0; // where the browser's history is
  let floor = pos;   // where the trails begin: nothing below it is the app's to rewrite
  let mirror = [];   // position -> { url, state }
  let kept = {};     // place -> the trail it was left with
  try {
    const t = JSON.parse(sessionStorage.getItem("gospel.trail") || "null");
    if (t && Array.isArray(t.mirror) && t.mirror[pos]?.url === (location.hash || "#") && t.floor <= pos) { mirror = t.mirror; floor = t.floor; kept = t.kept || {}; }
  } catch (_) {}
  const rawPush = history.pushState.bind(history), rawReplace = history.replaceState.bind(history);
  let trailTimer = null;
  function writeTrail() { clearTimeout(trailTimer); try { sessionStorage.setItem("gospel.trail", JSON.stringify({ floor, mirror: mirror.slice(0, pos + 1), kept })); } catch (_) {} }
  const noteEntry = () => { mirror[pos] = { url: location.hash || "#", state: history.state }; clearTimeout(trailTimer); trailTimer = setTimeout(writeTrail, 200); };
  history.pushState = (st, title, url) => { pos += 1; rawPush({ ...(st || {}), i: pos }, title, url); mirror.length = pos; noteEntry(); };
  history.replaceState = (st, title, url) => { rawReplace({ ...(st || {}), i: pos }, title, url); noteEntry(); };
  window.addEventListener("popstate", () => { if (Number.isInteger(history.state?.i)) pos = history.state.i; if (pos < floor) floor = pos; noteEntry(); }, true);
  window.addEventListener("pagehide", writeTrail);
  // The trail in front, as the place `tab` should find it again: nothing of a sheet's marker, and
  // nothing of the place a step came in from (a search typed in the Library begins at the search).
  function trailFor(tab) {
    let live = mirror.slice(floor, pos + 1);
    const hole = live.map((e) => !e).lastIndexOf(true); // entries from before a reload that lost the mirror
    if (hole >= 0) live = live.slice(hole + 1);
    live = live.filter((e) => !e.state?.overlay);
    const first = live.findIndex((e) => tabOfUrl(e.url) === tab);
    if (first < 0) return null;
    if (first === 0) return live;
    const base = live[first].state?.n || 0;
    return live.slice(first).map((e, k) => ({ url: e.url, state: { ...e.state, n: Math.max(0, (e.state?.n || 0) - base), ...(k ? {} : { prev: null, prevUrl: null, prevList: null }) } }));
  }
  let tabJump = false; // a step back to where the trails begin, asked for by a tab: nothing to render on it
  function jumpBy(delta) {
    return new Promise((done) => {
      tabJump = true;
      const end = () => { clearTimeout(timer); window.removeEventListener("popstate", end); tabJump = false; done(); };
      const timer = setTimeout(end, 1000);
      window.addEventListener("popstate", end);
      history.go(delta);
    });
  }
  // A tab. Another place comes back as it was left, at its own scroll; the place you are in goes
  // to its top (the shelves, an empty Search with the cursor in the box, the board, the thread).
  let switching = false;
  async function switchTab(to, { top = false } = {}) {
    if (!state.ready || switching || !TAB_TOP[to]) return;
    if (overlay === "sheet" || overlay === "stage") return; // a sheet or the stage is answered first (the tabs are inert under them)
    const from = tabNow();
    const same = to === from;
    if (same && pos === floor && !pageNow() && !state.q.trim() && (location.hash || "#").split("?")[0] === TAB_TOP[to]) { // already at its top
      window.scrollTo(0, 0); listPane.scrollTop = 0;
      if (to === "search") focusBox();
      if (to === "deck" && wide() && panelPane.hidden) panel.restore();
      return;
    }
    switching = true;
    try {
      rememberScroll(); leavingScroll = null;
      if (!same) { const mine = trailFor(from); if (mine) kept[from] = mine; }
      const back = !same && !top && kept[to]?.length ? kept[to] : null;
      const trail = back || [{ url: TAB_TOP[to], state: { n: 0, label: null, prev: null, place: to === "search" ? "search" : null } }];
      overlay = null; noteUnder = null;
      if (pos > floor) await jumpBy(floor - pos);
      trail.forEach((e, k) => (k ? history.pushState : history.replaceState)(e.state, "", e.url));
      leaveSearch(); typedLeft = null;
      readUrl();
      paneView = to === "deck" ? "board" : "page"; // the board is the Deck's; elsewhere it shows only when the switch asks
      syncControls();
      mainEl.classList.remove("tab-in"); void mainEl.offsetWidth; mainEl.classList.add("tab-in"); // a quick fade in (app.css; none under reduced motion)
      await render({ restore: back ? history.state?.scroll || null : null });
      if (!back) { window.scrollTo(0, 0); listPane.scrollTop = 0; }
      if (to === "search" && !state.q.trim() && !pageNow()) focusBox();
    } finally { switching = false; }
  }

  // The trail. Every place you go is a history entry; history.state carries its depth within
  // this visit (n), its own name, and the name of the one before it, so the Back button can say
  // where it leads ("‹ Alma 32", "‹ Results") and work in the home-screen app, where there is no
  // browser Back, and still know its way after a reload. Each entry also remembers how far you
  // had scrolled, so coming back lands where you were.
  function here() { return history.state && Number.isInteger(history.state.n) ? history.state.n : 0; }
  // The label is the place Back returns to, so it names what that entry shows: Ask or the Deck when
  // one of them was up (on a wide screen the page beside it is not what Back brings back first), the
  // page when one covers the list, and inside a shelf the book or year you were at ("Alma", "2024").
  // labelNow(true) names the list alone, whatever page is open beside it: on a wide screen a move
  // that leaves the page where it is (a new search) is undone by Back in the list only, so Back
  // says "Results" or "Alma" then, not the page still in view (push chooses between the two).
  function labelNow(list = false) {
    const tab = state.browse?.tab;
    const paged = !list && !!(state.docId || state.studyId);
    if ((tab === "ask" || tab === "deck") && !state.q.trim() && (wide() || !paged)) return tab === "ask" ? "Ask" : "Deck";
    if (paged && state.docId) return currentDoc && currentDoc.id === state.docId ? shortTitleOf(currentDoc) : "Back";
    if (paged && state.studyId) return currentStudy && currentStudy.id === state.studyId ? shortTitleOf(currentStudy) : "Back";
    if (state.q.trim().length >= 2) return state.view === "all" ? "Every match" : "Results";
    if (tab === "ask") return "Ask";
    if (tab === "deck") return "Deck";
    if (tab === "search") return "Search";
    if (tab) return (shelfDepth(state.browse) && shelfNamed?.key === browseKey(state.browse) && shelfNamed.name) || TAB_TITLE[tab] || "Shelf";
    return "Library";
  }
  // A depth inside a shelf names itself once its data has come (a book's name, a year), since only
  // then is it known; until then the entry carries the shelf's name.
  let shelfNamed = null;
  const browseKey = (b) => JSON.stringify([b?.tab || null, ...BROWSE_KEYS.map((k) => b?.[k] ?? null)]);
  const shelfDepth = (b) => !!(b && (b.year || b.bookUri || b.book || b.series));
  function nameShelf(name) { shelfNamed = { key: browseKey(state.browse), name }; nameEntry(); }
  function setEntry(patch) {
    const cur = history.state || {};
    // a marker entry (a sheet or the stage over a place) stays one: push() reads the flag to know it is leaving from an overlay
    history.replaceState({ n: here(), label: cur.label || null, prev: cur.prev || null, prevUrl: cur.prevUrl || null, scroll: cur.scroll || null, place: cur.place || null, overlay: cur.overlay || null, list: cur.list || null, prevList: cur.prevList || null, ...patch }, "", location.href);
    syncTitle();
  }
  // Each view names its entry once it has settled, so the next push knows what it is leaving.
  function nameEntry(label = labelNow()) { if (label !== "Back") setEntry({ label, list: labelNow(true) }); else syncTitle(); }
  // Where the view was scrolled, kept on the entry being left. A path that redraws before it pushes
  // calls this first; push() then keeps that reading instead of measuring the new view.
  let leavingScroll = null;
  function rememberScroll() { leavingScroll = { list: listPane.scrollTop, reader: readerPane.scrollTop, win: window.scrollY, study: studyScroll, at: Date.now() }; setEntry({ scroll: leavingScroll }); }
  // place: the kind of entry, so typing in the same place refines it instead of stacking entries
  function placeNow() { return state.q.trim() ? (state.view === "all" ? "concordance" : "search") : state.browse?.tab || "home"; }
  function push(replace = false) {
    const url = urlFor();
    if (location.hash === url || (url === "#" && !location.hash)) { settleOverlay(); return; }
    // a move from inside a sheet is never a refinement of the entry under it: the marker becomes the new place
    if (replace && !history.state?.overlay) { leavingScroll = null; history.replaceState({ ...(history.state || {}), n: here(), label: labelNow(), list: labelNow(true), place: history.state?.place || null }, "", url); refreshTrailButtons(); syncPlace(); return; }
    const fromOverlay = !!history.state?.overlay;
    if (!fromOverlay && (!leavingScroll || Date.now() - leavingScroll.at > 2000)) rememberScroll(); // a reading older than the move it was taken for is stale
    leavingScroll = null;
    const prevUrl = location.hash || "#";
    // the same page before and after, beside a list that changes: Back names the list it brings back
    // (the Deck's board covers the page, so Back from there names the page)
    const pageIn = (u) => (/[?&](doc|s)=[^&]+/.exec(u) || [null])[0]?.slice(1) || null;
    const listOnly = wide() && !!pageIn(prevUrl) && pageIn(prevUrl) === pageIn(url) && !(state.browse?.tab === "deck" && !state.q.trim());
    const prev = (listOnly && history.state?.list) || history.state?.label || "Library"; // so a step up can tell when Back would get there (a marker has its place's address)
    // leaving from inside a sheet or the stage: its marker entry becomes the new place, so Back
    // from there returns to the page under it, not to a sheet that is no longer open
    const prevList = history.state?.list || null; // for the Deck's entry once its pane is switched back to the page (backLabel)
    // a step that crosses into another place (a search typed in the Library, Think it through from a
    // page) leaves the place it came from as it was: its tab comes back to this
    const leftTab = tabOfUrl(prevUrl);
    if (leftTab !== tabOfUrl(url)) { const t = trailFor(leftTab); if (t) kept[leftTab] = t; }
    if (fromOverlay) { overlay = null; history.replaceState({ n: here() + 1, label: null, prev, prevUrl, prevList, scroll: null, place: null }, "", url); }
    else history.pushState({ n: here() + 1, label: null, prev, prevUrl, prevList, scroll: null, place: null }, "", url);
    nameEntry();
    refreshTrailButtons();
    syncPlace(); // a step can cross into another place (words typed in the Library's field are Search)
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
  // A sheet taken down for a move that went nowhere new (the same address): its marker would be a
  // Back that does nothing, so it goes now.
  function settleOverlay() {
    if (!overlay || !history.state?.overlay || !sheet.hidden || !stage.hidden) return;
    overlay = null; poppingOverlay = true; history.back();
  }
  function backLabel() {
    if (here() <= 0) return null;
    // on the Deck's entry with the pane switched to Page, the page is in view again and Back would change the list only
    const s = history.state || {};
    if (s.prevList && wide() && state.browse?.tab === "deck" && !state.q.trim() && paneView === "page" && pageOpen()) return s.prevList;
    return s.prev || "Back";
  }
  // Where a trail begins there is no step to take back. In the Library that is home; in the other
  // places on a phone a page that covers the list closes, and the button says what is under it.
  function floorLabel() {
    if (tabNow() === "library") return "Library";
    return !wide() && pageNow() ? labelNow(true) : null;
  }
  function goBack() {
    if (here() > 0) history.back();
    else if (tabNow() === "library") goHome();
    else if (pageNow()) { state.docId = null; state.pid = null; state.studyId = null; render().then(() => push(true), () => {}); }
  }
  // The four places. Which one this is follows from the address: words in the box (or the empty
  // Search) are Search, #deck and #ask are themselves, and everything else, shelves and pages, is
  // the Library.
  const TAB_NAME = { library: "Library", search: "Search", deck: "Deck", ask: "Ask" };
  function tabNow() {
    const t = state.browse?.tab;
    return state.q.trim() || t === "search" ? "search" : t === "deck" || t === "ask" ? t : "library";
  }
  // Home, Ask and the Deck are destinations, not steps: going from one to another takes its place
  // in the trail, so Back from any of them still leads to where you were before the first. A page
  // the move closes or covers is a step all the same: Back must bring it back.
  const atTab = () => !state.q.trim() && (!state.browse?.tab || state.browse.tab === "ask" || state.browse.tab === "deck" || state.browse.tab === "search");
  const pageNow = () => (state.docId ? `d${state.docId}` : state.studyId ? `s${state.studyId}` : null);
  const tabLeft = () => ({ top: atTab(), page: pageNow(), shown: !readerPane.hidden });
  function tabStep(from) {
    const covers = wide() && state.browse?.tab === "deck" && !!from.page && from.shown;
    if (from.top && from.page === pageNow() && !covers && !history.state?.overlay) { push(true); setEntry({ scroll: null }); }
    else push();
  }
  function goHome() {
    if (atTab() && !state.browse?.tab && !pageNow() && $("#homeBody.overview")) return; // already there
    const from = tabLeft();
    rememberScroll();
    leaveSearch();
    state.q = ""; state.docId = null; state.pid = null; state.studyId = null; state.browse = null; state.scope = "all";
    syncControls(); renderHome(); showList(); tabStep(from);
  }
  // A step within the shelves (a book, a year, a volume): a place of its own, so Back retraces it
  function go(browse) { rememberScroll(); state.browse = browse; renderHome(); push(); }
  // Up a level within the shelves (the crumbs): no new entry. When the entry before is that level,
  // it is Back; otherwise this entry becomes the level, so Back still leads where it led.
  function goUp(browse) {
    const was = state.browse;
    state.browse = browse;
    const url = urlFor();
    if (here() > 0 && history.state?.prevUrl === url) { state.browse = was; history.back(); return; }
    renderHome(); push(true);
  }
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
    const label = backLabel() || floorLabel();
    if (!label) return el("span", { class: "trail-back none", hidden: true }); // the top of Search, the Deck or Ask: the tab bar is the way out
    return el("button", { type: "button", class: "trail-back", "aria-label": `Back to ${label}`, title: `Back to ${label}`, onclick: goBack }, [
      el("span", { class: "chev", text: "‹" }), el("span", { class: "lb", text: label })]);
  }
  function refreshTrailButtons() {
    for (const b of document.querySelectorAll(".trail-back")) if (!b.closest(".head-back")) b.replaceWith(trailButton());
    syncPanelBar();
    for (const s of document.querySelectorAll(".head-back")) s.replaceChildren(headBack());
  }
  // A shelf's own heading: Back, except beside an open page or the board on a wide screen, where that
  // pane's bar has Back and the heading would say it twice ("‹ My studies  My studies"); there the
  // heading is the shelf's name alone (the header's home button is still there).
  function headBack() {
    if (wide() && (state.docId || state.studyId || !panelPane.hidden)) return "";
    return backLabel() ? trailButton() : el("button", { type: "button", class: "text-btn home-back", text: "Library", onclick: () => goHome() });
  }
  // On a phone every list view carries Back at the top; on a wide screen the reader bar has it
  function listTrail() { return backLabel() ? el("div", { class: "list-trail" }, [trailButton()]) : null; }
  window.addEventListener("popstate", () => {
    if (!state.ready) return;
    if (tabJump) return; // a tab's step back to where the trails begin: switchTab draws what follows
    if (poppingOverlay) { poppingOverlay = false; return; } // our own pop of a marker, already closed
    if (overlay && !history.state?.overlay) { // Back with a sheet or the stage open: close it, stay where you are
      const kind = overlay;
      // a note half typed is not thrown away by Back, any more than by Escape: the sheet stays, and its marker goes back on
      if (kind === "sheet" && !sheet.hidden && keepTyped()) { history.pushState({ ...(history.state || {}), overlay: "sheet" }, "", location.href); return; }
      overlay = null;
      if (kind === "sheet") hideNote(); else if (!stage.hidden) stopPresenting();
      return;
    }
    if (history.state?.overlay) history.replaceState({ ...history.state, overlay: null }, "", location.href); // a marker reached from elsewhere is its place
    overlay = null;
    hideNote(); if (!stage.hidden) stopPresenting();
    const left = { doc: state.docId, pid: state.pid };
    readUrl(); syncControls();
    if (typedLeft !== null) { input.value = typedLeft; typedLeft = null; } // a letter still in the box after a search too short to run
    render({ restore: history.state?.scroll || null }).then(() => focusAfterBack(left), () => {});
  });
  let typedLeft = null;
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
    input.placeholder = state.scope && state.scope !== "all" ? `Search ${SCOPE_NAME[state.scope] || state.scope}…` : wide() && tabNow() === "search" ? "Search, or type a reference like Alma 32:21" : "Search, or a reference";
    $("#fSpeaker").value = state.speaker;
    $("#fFrom").value = state.from;
    $("#fTo").value = state.to;
    $("#fBook").value = state.book;
    for (const b of document.querySelectorAll("#fGroup button")) b.classList.toggle("on", b.dataset.group === state.group);
    const active = !!(state.speaker || state.from || state.to || state.book || state.group !== "passages");
    $("#filterBtn").classList.toggle("on", active);
    $("#filterBtn").setAttribute("aria-label", active ? "Filters, some set" : "Filters");
    syncPlace();
  }
  // Which of the four places is current: marked in the tab bar, named in the head (a real h1) and
  // in the document's title, and on the body for app.css, which shows each place its own head.
  const ICON_GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-2-3.4-2.3.9a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.3-.9-2 3.4 1.9 1.5a7.6 7.6 0 0 0 0 3l-1.9 1.5 2 3.4 2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9 2-3.4z"/></svg>';
  let actsFor = null;
  function syncPlace() {
    const tab = tabNow();
    document.body.dataset.tab = tab;
    for (const b of document.querySelectorAll("#tabs .tab[data-tab]")) {
      const on = b.dataset.tab === tab;
      b.classList.toggle("on", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    }
    const shelf = tab === "library" ? state.browse?.tab || null : null;
    document.body.classList.toggle("deep", !!shelf); // in a shelf its own heading leads, with Back beside it
    document.body.classList.toggle("shelf-studies", shelf === "studies");
    $("#placeTitle").textContent = TAB_NAME[tab];
    measureBar();
    // what sits at the end of the head: Settings, on a phone, in every tab (the rail has the gear on an iPad)
    const want = !wide() ? "gear" : "";
    if (want !== actsFor) {
      actsFor = want;
      $("header.bar").classList.toggle("no-acts", want !== "gear"); // app.css: the box runs to the edge when nothing sits at the end of the head
      $("#barActs").replaceChildren(...(want === "gear" ? [el("button", { type: "button", class: "icon-btn gear-btn", "aria-label": "Settings", title: "Settings", html: ICON_GEAR, onclick: () => openSettings() })] : []));
    }
    syncTitle();
  }
  // The document's title: the page in front by name, else the place ("Search: faith", "Library")
  function syncTitle() {
    const tab = tabNow();
    const paged = (state.docId && currentDoc && currentDoc.id === state.docId) || (state.studyId && currentStudy && currentStudy.id === state.studyId);
    const page = paged && (!wide() || !readerPane.hidden) ? shortTitleOf(state.docId ? currentDoc : currentStudy) : "";
    const shelf = tab === "library" && state.browse?.tab ? TAB_TITLE[state.browse.tab] || "" : "";
    const title = page || (tab === "search" && state.q.trim() ? `Search: ${state.q.trim()}` : shelf || TAB_NAME[tab]);
    if (document.title !== title) document.title = title;
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
    if (wide()) placePanes(); else { readerPane.hidden = true; panelPane.hidden = true; syncPanes(); window.scrollTo(0, 0); } // a list starts at its top (a restore puts it back after)
    document.body.classList.toggle("reading", !wide() && !readerPane.hidden);
    syncControls();
  }
  function showReader() {
    listPane.hidden = !wide();
    if (wide()) placePanes(); else { readerPane.hidden = false; panelPane.hidden = true; syncPanes(); }
    document.body.classList.toggle("reading", !wide());
    window.scrollTo(0, 0);
    measureBar();
  }
  // The header's real height, for what must sit just under it (the phone's reader bar)
  function measureBar() { requestAnimationFrame(() => { const h = $("header.bar")?.offsetHeight; if (h) document.documentElement.style.setProperty("--bar-real", h + "px"); }); }
  window.addEventListener("resize", measureBar);

  // ------------------------------------------------------------- setup ----
  // The library is downloaded once per device and unlocked with the passphrase.
  // The engine keeps the library in OPFS through sync access handles in a worker, which iOS has
  // from 16.4. The engine says whether this browser has them (lib/checks.js needsNewerIos); the
  // user agent only words the message, since the iPad's home-screen app may not name its version.
  const IOS_UPDATE = "To update, open Settings, then General, then Software Update. Meanwhile it works in Safari on a Mac.";
  let engineCapable = null; // the engine's report: true when it can keep the library here
  function showTooOld(v) {
    readerPane.hidden = true;
    listPane.hidden = false;
    syncPanes();
    document.body.classList.add("first-run");
    listPane.replaceChildren(el("div", { class: "setup" }, [
      el("h1", { text: "Update this iPhone or iPad first" }),
      el("p", { class: "lede", text: v
        ? `This app needs iOS 16.4 or later to keep the library on the device; this one has iOS ${v[0]}.${v[1]}.`
        : "This app needs iOS 16.4 or later to keep the library on the device, and this one has an earlier version." }),
      el("p", { class: "lede", text: IOS_UPDATE }),
    ]));
  }

  async function ensureLibrary() {
    // Asked before the engine opens its storage; no answer in 15 s and the engine simply tries
    const ua = navigator.userAgent, touch = "ontouchend" in document;
    let features = null;
    try { features = await Promise.race([call("features"), new Promise((r) => setTimeout(() => r(null), 15000))]); }
    catch (err) {
      // the engine's worker could not even start: on an iPhone or iPad, an iOS too old to run it,
      // unless the user agent names one new enough (then it is some other fault)
      const v = iosVersion(ua, touch);
      if (looksLikeIos(ua, touch) && !(v && (v[0] > 16 || (v[0] === 16 && v[1] >= 4)))) { showTooOld(v); return false; }
      showFatal(`The library engine could not start: ${err.message}`); return false;
    }
    if (features) engineCapable = !!features.syncAccess && features.syncMethods !== false;
    if (needsNewerIos(features, ua, touch)) { showTooOld(iosVersion(ua, touch)); return false; }
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
    syncPanes();
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
    // (never on a browser whose engine said it can keep the library)
    const ios = engineCapable !== true && looksLikeIos(navigator.userAgent, "ontouchend" in document);
    const hint = ios ? el("p", { class: "fine", text: `This app needs iOS 16.4 or later. ${IOS_UPDATE}` }) : null;
    listPane.replaceChildren(el("div", { class: "setup" }, [el("h1", { text: "Something is wrong" }), el("p", { class: "lede", text }), hint].filter(Boolean)));
  }

  // A newer library on the server? Offer it. When the server has a delta from this device's
  // build, only what changed is downloaded and applied in place; otherwise, or if that fails,
  // the whole library is installed into the other slot and the app switches to it.
  // asked: Settings' "Check for an update", which says what it found; the check at start is silent
  async function checkForUpdate(asked = false) {
    if (!navigator.onLine) { if (asked) toast("This device is offline; the library on it is the one in use."); return "offline"; }
    const active = store.get("active");
    let manifest;
    try { manifest = await call("manifest", { manifestUrl: MANIFEST_URL }); } catch (_) { if (asked) toast("Could not reach the library's server just now."); return "failed"; }
    if (!active || manifest.version === active.version) { if (asked) toast("The library is up to date."); return "current"; }
    if ($(".banner.library-update")) return "found";
    const delta = pickDelta(manifest, active.version);
    const when = new Date(manifest.built_at).toLocaleDateString([], { month: "short", day: "numeric" });
    const banner = el("div", { class: "banner library-update" }, [
      el("span", { text: delta
        ? `A newer library is available (built ${when}): ${delta.documents_changed} ${delta.documents_changed === 1 ? "page" : "pages"} changed, ${mb(delta.size)} to download.`
        : `A newer library is available (built ${when}, ${mb(manifest.bundle_size)}).` }),
      el("button", { class: "text-btn", text: "Update now", onclick: () => updateNow(banner, manifest, delta) }),
      el("button", { class: "icon-btn", "aria-label": "Later", text: "×", onclick: () => banner.remove() }),
    ]);
    $("header.bar").after(banner);
    return "found";
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
    let q = state.q.trim();
    // too short to search: back where the search began, and the address with it (no #search?q=a left behind)
    if (q.length < 2) {
      leaveSearch(); state.q = ""; state.view = null;
      // the search was a step from that place: step back to it rather than leave it in history twice
      if (!silent && here() > 0 && history.state?.place === "search" && history.state?.prevUrl === urlFor()) { typedLeft = input.value; history.back(); return; }
      renderHome(); if (!silent) { push(true); setEntry({ place: placeNow(), label: labelNow(), list: labelNow(true) }); }
      return;
    }
    // a reference half typed ("Alma 32:21-", "Alma 32:21,", "Alma 32:") keeps its card: the separator
    // waiting for its second half is left off until it has one
    if (/\d\s*[-\u2013\u2014,:;]\s*$/.test(q)) q = q.replace(/\s*[-\u2013\u2014,:;]\s*$/, "");
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
      // "Alma 32:999": the chapter is there and the verse is not, so the card offers the chapter and says so
      if (data.jump?.doc_id && /^p\d+$/.test(data.jump.pid || "")) {
        let there = true;
        try { there = !!(await api("context", { doc_id: data.jump.doc_id, pid: data.jump.pid, before: 0, after: 0 })); } catch (_) { there = true; }
        if (mySeq !== searchSeq) return;
        if (!there) data.jump = { ...data.jump, label: data.jump.title || data.jump.label, missing: data.jump.pid.slice(1), pid: null, verse_end: null };
      }
      // a reference typed and entered opens the chapter at the verse, on the phone as on the iPad; the
      // list keeps the card, so Back comes to it; a re-render (Back, a reload) never navigates
      if (!typeahead && !more && !silent && data.jump?.doc_id && state.docId !== data.jump.doc_id) setTimeout(() => { if (mySeq === searchSeq) openDoc(data.jump.doc_id, data.jump.pid); }, 0);
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
      // an empty board has nothing to offer fresh results: the right pane goes back to the page (or rests empty)
      if (wide() && paneView === "board" && !window.Deck?.count?.()) panel.page();
      if (!silent) { push(history.state?.place === placeNow()); setEntry({ place: placeNow(), label: labelNow(), list: labelNow(true) }); // a new search from elsewhere is a move; refining one is not
        // results drawn at the start of the trail had no Back to show; now that the search is a step, they do
        const lt = !$(".list-trail", listPane) && listTrail(); if (lt) listPane.prepend(lt);
      }
      // on a wide screen the pane beside fresh results is not left blank: the best match opens in it,
      // in this same entry, so Back still leaves the search in one step. A page already open stays.
      if (!typeahead && !more && !silent && wide() && tabNow() === "search" && state.view !== "all" && state.group !== "documents" && !data.jump
        && data.hits.length && !state.docId && !state.studyId && panelPane.hidden) {
        const h = data.hits[0];
        openDoc(h.doc_id, h.pid, { replace: true });
      }
      // the concordance is every match already: Claude's extra searches belong to the ranked list, and would redraw it over this one
      if (!typeahead && !more && state.view !== "all" && data.smart && window.Ask?.hasKey() && navigator.onLine) widenWithClaude(q, data, mySeq);
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
    if (!added.length || state.view === "all" || state.lastSearch !== data) return;
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
        el("div", {}, [el("b", { text: j.label }), " ", el("span", { text: !j.doc_id ? "Not in the library yet" : j.missing ? `Open · it has no verse ${j.missing}` : "Open" })]),
        el("span", { text: j.doc_id ? "›" : "" }),
      ]));
    }
    // a book: filter (typed, or in Filters) that names no book is said, since the search went on without it
    const askedBook = (/\bbook:("[^"]*"|\S+)/i.exec(data.query || "") || [])[1]?.replace(/"/g, "") || state.book;
    if (askedBook && data.filters && !data.filters.bookSlug && !data.filters.volume) frag.append(el("div", { class: "status no-book", role: "status", text: `No book of scripture is called “${askedBook}”, so this search is not kept to one book.` }));
    // how the search was read is said only over something found; over nothing, the empty line speaks alone
    const found = !!(data.jump || data.hits.length || data.documents.length || (data.titles || []).length);
    if (data.smart && found) {
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
    // an English word on its own: the Hebrew and Greek most often read that way, filled in when the engine answers
    if (!data.original && !data.original_hint && !data.typeahead) { const slot = el("div", { class: "orig-behind-slot" }); frag.append(slot); window.Original?.offerFor(data.query, slot); }
    if (data.titles && data.titles.length) {
      frag.append(el("div", { class: "group-title", text: "By title" }));
      for (const d of data.titles) frag.append(docRow(d));
    }
    const total = data.total || 0;
    if (data.hits.length || data.documents.length) {
      const lexAll = data.lexical_total > 0 && data.lexical_match && state.group !== "documents" && !data.typeahead;
      const line = el("div", { class: "group-title", role: "status", "aria-live": "polite", text: state.group === "documents" ? `${total.toLocaleString()} talks and chapters` : `${data.smart?.semantic ? "Top " : ""}${total.toLocaleString()} ${total === 1 ? "passage" : "passages"}` });
      if (lexAll) line.append(el("span", { text: " · " }), el("button", { type: "button", class: "text-btn small see-all", text: data.lexical_total === 1 ? "See the 1 with these words, in its book" : `See all ${data.lexical_total.toLocaleString()}, book by book \u203a`, title: "Every passage with these words, in the order of the books", onclick: () => { state.view = "all"; state.cbook = ""; state.exact = false; runSearch({ typeahead: false }); } }));
      // the results as a whole, handed to Claude (the floating pill's other job)
      if (data.hits.length && window.Ask) line.append(el("span", { text: " · " }), el("button", { type: "button", class: "text-btn small inline think-these", text: "Think these through", title: "Think these through with Claude", onclick: () => thinkHere() }));
      frag.append(line);
    } else if (data.typeahead && !data.jump && !(data.titles || []).length) {
      frag.append(el("div", { class: "empty" }, [el("div", { text: "Keep typing, or press return to search more widely." })]));
    } else if (!data.jump && !(data.titles || []).length) {
      frag.append(el("div", { class: "empty" }, [
        el("div", { text: `Nothing matches “${data.query}”${scopeLabel()}. Try fewer words, a different spelling, or ask the question instead:` }),
        el("button", { type: "button", class: "text-btn", text: "Ask Claude", onclick: () => { rememberScroll(); leaveSearch(); state.browse = { tab: "ask" }; state.q = ""; syncControls(); renderHome(); showList(); push(); setTimeout(() => { const ta = $(".ask-input"); if (ta) { ta.value = data.query; ta.focus(); } }, 50); } }),
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
    studiesInResults(data);
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
    // as Add to deck does in the reader: the pane stays where it is, and the toast (with Undo) and
    // the count on the Deck button say it went on
    window.Deck?.addPassage({ doc_id: h.doc_id, pid: h.pid, kind: h.kind, verse: h.verse, text, verses, citation: h.citation, label: h.label, author: h.author, title: h.title, collection: h.collection }, { show: false });
    btn.textContent = btn.classList.contains("add") ? "\u2713" : "On the deck";
    btn.setAttribute("aria-pressed", "true");
    deckToast(1, "On the deck.");
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
        ? await api("concordance", { match: data.lexical_match, filters: data.filters || {}, limit: 600, book: state.cbook || null, exact: state.exact })
        : await api("matches", phrase ? { phrase, scope: state.scope, limit: 600 } : { words: terms.join(" "), mode: "all", scope: state.scope, limit: 600 });
    } catch (e) { listPane.replaceChildren(el("div", { class: "status error", text: `Could not gather the matches (${e.message}).` })); return; }
    if (state.view !== "all") return;
    // a chip the library no longer has (a rebuilt book) falls away rather than showing nothing
    if (state.cbook && data.lexical_match && all.book !== state.cbook) { state.cbook = ""; push(true); }
    const redo = () => { push(true); renderConcordance(data); };
    const books = all.by_book || [];
    const chipBook = books.find((b) => b.key === state.cbook);
    const frag = document.createDocumentFragment();
    const t = listTrail(); if (t) frag.append(t);
    frag.append(el("div", { class: "conc-head" }, [
      el("h2", { text: phrase ? `“${phrase}”` : terms.join(", ") }),
      el("div", { class: "conc-sub", text: `${all.total.toLocaleString()} ${all.total === 1 ? "passage" : "passages"} in ${(all.by_document || []).length.toLocaleString()} ${(all.by_document || []).length === 1 ? "chapter or talk" : "chapters and talks"}${chipBook ? ` in ${bookChipName(chipBook.name)}` : scopeLabel()}, in reading order${all.passages.length < all.total ? ` · the first ${all.passages.length.toLocaleString()} shown` : ""}` }),
      // the words as typed, or each with its family (faith, faithful, faithfulness: the index keeps them as one)
      data.lexical_match && !all.error ? el("div", { class: "conc-tools" }, [
        el("div", { class: "conc-seg", role: "group", "aria-label": "Which words" }, [
          ["exact", "Exact words"], ["family", "Word family"],
        ].map(([k, label]) => el("button", { type: "button", class: (k === "exact") === state.exact ? "on" : "", "aria-pressed": String((k === "exact") === state.exact), text: label,
          onclick: () => { if ((k === "exact") === state.exact) return; state.exact = k === "exact"; redo(); } }))),
      ]) : null,
      // how many in each book, as filters on the list: tap one to see that book, again to see them all
      books.length > 1 || chipBook ? el("div", { class: "conc-books", role: "group", "aria-label": "Matches by book" }, books.map((b) =>
        el("button", { type: "button", class: "chip small" + (b.key === state.cbook ? " on" : ""), "data-book": b.key, "aria-pressed": String(b.key === state.cbook),
          onclick: () => { state.cbook = b.key === state.cbook ? "" : b.key; redo(); } }, [bookChipName(b.name), el("b", { text: ` ${b.n.toLocaleString()}` })]))) : null,
    ].filter(Boolean)));
    if (all.exact === false && state.exact && data.lexical_match) frag.append(el("div", { class: "status", text: "This search cannot be narrowed to the exact words; showing each word with its family." }));
    // the words the match holds (a natural question brings its synonyms), marked whole or with their endings
    const terms2 = all.words?.length ? all.words : phrase ? phrase.split(/\s+/) : terms;
    const tail = all.exact ? "(?![\\p{L}\\p{N}])" : "[\\p{L}\\p{N}]*";
    const re = terms2.length ? new RegExp("(?<![\\p{L}\\p{N}])(" + [...terms2].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + tail).join("|") + ")", "giu") : null;
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
      const on = !!window.Deck?.has(p.doc_id, p.pid);
      // the + is the results' own: the same add, the same Undo toast, the same count on Deck
      frag.append(el("div", { class: "conc-line" }, [
        el("button", { type: "button", class: "conc-row", "data-doc": p.doc_id, "data-pid": p.pid, onclick: () => openDoc(p.doc_id, p.pid) }, [
          p.verse ? el("span", { class: "vn", text: String(p.verse) }) : null,
          el("span", { class: "snip", html: snip }),
        ].filter(Boolean)),
        el("button", { type: "button", class: "add", "data-deck-doc": String(p.doc_id), "data-deck-pid": p.pid, "aria-label": `Add ${p.citation} to the deck`, "aria-pressed": String(on), title: "Add to deck", text: on ? "✓" : "+",
          onclick: (e) => { e.stopPropagation(); addHit(p, e.currentTarget); } }),
      ]));
    }
    if (!all.passages.length) frag.append(el("div", { class: "empty", text: state.exact ? "No passage has these exact words." : "No passage has these words." }));
    listPane.replaceChildren(frag);
    // the chip that is on stays in sight in its own row (sideways on a phone, down on the iPad)
    const onChip = $(".conc-books .chip.on", listPane);
    if (onChip) { const row = onChip.parentElement; row.scrollLeft = onChip.offsetLeft - 16; row.scrollTop = onChip.offsetTop - 4; }
    listPane.scrollTop = restore ? restore.list || 0 : 0;
    if (restore) window.scrollTo(0, restore.win || 0);
    markActive();
  }

  // A book's name on a concordance chip: the Doctrine and Covenants keeps its sections under "Sections".
  function bookChipName(name) { return name === "Sections" ? "D&C" : name || "Other"; }

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
    ["conference", "General Conference", (st) => st.talks ? `${st.talks.toLocaleString()} talks, 1971 to ${latestName(st)}` : "Not downloaded yet", (st) => st.talks ? `1971 to ${latestName(st, true)}` : "Not downloaded yet"],
    ["preach-my-gospel", "Preach My Gospel", () => "2023 edition", () => "2023 edition"],
    ["missionary-standards", "Missionary Standards", () => "The booklet, its supplement, the service missionary edition", () => "All three editions"],
    ["handbook", "General Handbook", (st) => `${count(st, "handbook")} chapters`, (st) => `${count(st, "handbook")} chapters`],
    ["come-follow-me", "Come, Follow Me", () => "This year and last", () => "This year and last"],
    ["manuals", "Manuals", (st) => `${count(st, "manuals")} pages`, (st) => `${count(st, "manuals")} pages`],
    ["study-helps", "Study helps", () => "Topical Guide, Bible Dictionary, Guide to the Scriptures", () => "Topical Guide and more"],
    ["jsp", "Joseph Smith Papers", (st) => { const n = jspPages(st); return n ? `${n.toLocaleString()} pages: journals, revelations, histories, documents` : "Not downloaded yet"; }, (st) => jspPages(st) ? "Journals, revelations…" : "Not downloaded yet"],
    // the two that are his own: rows under the shelves, not tiles among them
    ["studies", "My studies", (st) => st.studies ? `${st.studies} ${st.studies === 1 ? "page" : "pages"} of your own, kept on this device` : "Pages of your own, added from Files", (st) => st.studies ? `${st.studies} ${st.studies === 1 ? "page" : "pages"} of your own` : "Pages of your own"],
    ["marks", "Highlights and notes", (st) => st.marks ? `${st.marks} ${st.marks === 1 ? "passage" : "passages"} marked, kept on this device` : "Tap a verse while reading, then a color or Note", (st) => st.marks ? `${st.marks} ${st.marks === 1 ? "passage" : "passages"} marked` : "None yet"],
  ];
  const OWN = new Set(["studies", "marks"]);
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
    if (key === "conference" || OWN.has(key)) return true;
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
    syncList();
    let st;
    try { st = await libraryStats(); }
    catch (e) { body.append(el("div", { class: "status error", text: `The library is not answering (${e.message}).` })); return; }
    if (!tab && window.Studies) { try { st = { ...st, studies: (await window.Studies.list()).length, marks: window.Marks ? await window.Marks.count() : 0 }; } catch (_) {} }
    nameEntry();
    try {
      if (!tab) return renderOverview(body, st);
      if (tab === "search") return renderSearchHome(body);
      if (tab === "ask") { const { question, think } = state.browse; state.browse = { tab: "ask" }; const t = listTrail(); if (t) body.append(t); const host = el("div", { class: "ask-host" }); body.append(host); window.Ask?.render(host, { question, think }); return; }
      if (tab === "deck") { const t = listTrail(); if (t) body.append(t); const host = el("div"); body.append(host); window.Deck?.render(host); return; }
      body.append(el("div", { class: "home-head" }, [
        el("span", { class: "head-back" }, [headBack()]),
        el("h2", { text: TAB_TITLE[tab] || tab }),
      ]));
      if (tab === "conference") await browseConference(body);
      else if (tab === "scriptures") await browseScriptures(body);
      else if (tab === "jsp") await browseJsp(body);
      else if (tab === "studies") await renderStudies(body);
      else if (tab === "marks") await renderMarks(body);
      else await browseCollection(body, tab);
    } catch (e) {
      body.append(el("div", { class: "status error", text: e.message }));
    } finally { syncList(); }
  }
  function setOverview(on) { document.body.classList.toggle("overview", !!on); }
  // What the list holds and which panes are up, said as classes on the body beside "overview" and
  // "pane-up", for app.css to lay the place out by. They stood as :has() rules on main and body,
  // which the browser checked again on every change anywhere in the page (a connection drawn on a
  // deck with links cost ten times what it does without them).
  function syncList() {
    const b = document.body.classList;
    b.toggle("ask-up", !!listPane.querySelector(".ask-page"));
    b.toggle("search-top", !!listPane.querySelector(".search-home"));
  }
  let saidSel = 0; // the count last said aloud (updateSelectBar)
  function syncPanes() {
    const b = document.body.classList;
    b.toggle("list-only", readerPane.hidden && panelPane.hidden);
    const bar = !!readerPane.querySelector(":scope > .select-bar");
    readerPane.classList.toggle("selecting", bar); // the pane is a column while the bar is up, the bar ordered last
    b.toggle("sel-up", bar && !readerPane.hidden);
    if (!bar) saidSel = 0; // a page drawn over a selection: the next one is said from nothing
  }
  // the list emptied or refilled by a search, the concordance or the setup screens
  new MutationObserver(syncList).observe(listPane, { childList: true });
  // Search with nothing in the box yet: what the box takes, in a line, and the last few searches
  // entered (kept on this device), each one tap away.
  const ICON_RECENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.500V12l3 2"/></svg>'.replace("7.500", "7.5");
  function rememberSearch(q) {
    q = String(q || "").trim();
    if (q.length < 2) return;
    const was = store.get("recentSearches", []);
    store.set("recentSearches", [q, ...(Array.isArray(was) ? was : []).filter((x) => x !== q)].slice(0, 8));
  }
  function renderSearchHome(body) {
    const t = listTrail(); if (t) body.append(t);
    const box = el("div", { class: "search-home" }, [
      el("p", { class: "search-lede", text: "Words, a phrase in quotes, a question, or a reference like Alma 32:21." }),
    ]);
    const recent = store.get("recentSearches", []);
    if (Array.isArray(recent) && recent.length) {
      box.append(el("div", { class: "home-sec-head recent-head" }, [el("h2", { text: "Recent" }), el("button", { type: "button", class: "text-btn small", text: "Clear", onclick: () => { store.del("recentSearches"); renderHome(); } })]));
      const list = el("div", { class: "recent-list" });
      for (const q of recent) list.append(el("button", { type: "button", class: "recent-row", onclick: () => { state.q = q; syncControls(); rememberSearch(q); runSearch({ typeahead: false }); } }, [el("span", { class: "ic", html: ICON_RECENT }), el("span", { class: "t", text: q })]));
      box.append(list);
    }
    body.append(box);
  }
  function openShelf(key) {
    rememberScroll();
    leaveSearch();
    state.q = "";
    state.browse = { tab: key };
    if (TAB_SCOPE[key]) state.scope = TAB_SCOPE[key];
    syncControls();
    renderHome();
    push();
  }

  // The home screen: where you were, the shelves, the latest conference, a word about Ask.
  async function renderOverview(root, st) {
    // two groups: the shelves and what is yours, then what is new and Ask. Side by side on a wide
    // screen, one after the other on a phone (app.css).
    const body = el("div", { class: "home-col" }), side = el("div", { class: "home-col home-side" });
    root.append(body, side);
    const last = store.get("lastRead");
    const deckN = window.Deck?.count ? window.Deck.count() : 0;
    if (last || deckN) {
      const sec = el("section", { class: "home-sec sec-continue" }, [el("h2", { text: "Continue" })]);
      if (last) sec.append(el("button", { type: "button", class: "home-card", onclick: () => openDoc(last.id, last.pid || null) }, [
        el("span", { class: "hc-main" }, [el("span", { class: "hc-t", text: last.title }), el("span", { class: "hc-s", text: [last.where, last.verse ? `at verse ${last.verse}` : null].filter(Boolean).join(" · ") })]), el("span", { class: "hc-go", text: "›" })]));
      if (deckN) sec.append(el("button", { type: "button", class: "home-card", onclick: () => switchTab("deck") }, [
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
    const yours = el("div", { class: "own-list" });
    for (const [key, title, sub, short] of SHELVES) {
      if (!hasShelf(st, key) && key !== "jsp") continue;
      if (OWN.has(key)) yours.append(el("button", { type: "button", class: "shelf-tile own-row", onclick: () => openShelf(key) }, [el("span", { class: "own-main" }, [el("span", { class: "st-t", text: title }), el("span", { class: "st-s", text: (wide() ? sub : short)(st) })]), el("span", { class: "hc-go", "aria-hidden": "true", text: "›" })]));
      else grid.append(el("button", { type: "button", class: "shelf-tile", onclick: () => openShelf(key) }, [el("span", { class: "st-t", text: title }), el("span", { class: "st-s", text: (wide() ? sub : short)(st) })]));
    }
    shelves.append(grid);
    body.append(shelves);
    body.append(el("section", { class: "home-sec sec-yours" }, [el("h2", { text: "Yours" }), yours]));
    try {
      const latest = await api("recent");
      if (latest.conference && latest.talks.length) {
        const sec = el("section", { class: "home-sec sec-latest" }, [el("div", { class: "home-sec-head" }, [el("h2", { text: `Latest conference · ${latest.conference.title}` }), el("button", { type: "button", class: "text-btn small", text: "All sessions", onclick: () => openShelf("conference") })])]);
        const list = el("div", { class: "home-list" });
        for (const t of latest.talks.slice(0, 6)) list.append(el("button", { class: "toc-row", "data-doc": t.id, onclick: () => openDoc(t.id, null) }, [el("div", { class: "t", text: t.title }), el("div", { class: "s", text: [t.author, t.session].filter(Boolean).join(" · ") })]));
        if (latest.talks.length > 6) list.append(el("button", { class: "toc-row more-talks", onclick: () => openShelf("conference") }, [el("div", { class: "t", text: `All ${latest.talks.length} talks ›` })]));
        sec.append(list);
        side.append(sec);
      }
    } catch (_) { /* no conference yet */ }
    if (window.Ask) {
      const q = el("input", { type: "text", class: "ask-teaser-q", placeholder: "What have the prophets taught about covenants and identity?", "aria-label": "A question for the library" });
      const go = () => { rememberScroll(); state.browse = { tab: "ask", question: q.value.trim() }; state.q = ""; syncControls(); renderHome(); showList(); push(); };
      q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      side.append(el("section", { class: "home-sec sec-ask ask-teaser" }, [
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
    if (b.bookUri) return renderBookToc(body, b.bookUri, () => goUp({ tab: "conference", year: b.year, all: true }), b.year ? String(b.year) : "General Conference");
    const data = await api("browse", { collection: "general-conference" });
    const books = data.books.filter((x) => x.docs > 0);
    if (!books.length) { body.append(el("div", { class: "empty", text: "No conference talks are downloaded yet. They come in on their own, some each night, newest conference first." })); return; }
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
      nameShelf(String(b.year));
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
    nameShelf(bk.name.replace("JST, ", ""));
    body.append(el("div", { class: "crumbs" }, [el("button", { text: "Scriptures", onclick: () => goUp({ tab: "scriptures" }) }), el("span", { text: bk.name })]));
    const grid = el("div", { class: "chapters" });
    for (const c of bk.chapters) grid.append(el("button", { text: String(c.n), disabled: !c.doc_id, onclick: () => openDoc(c.doc_id, null) }));
    body.append(grid);
    if (!bk.chapters.some((c) => c.doc_id)) body.append(el("div", { class: "empty", text: "Not in this library yet. It arrives with a later build." }));
  }

  async function browseCollection(body, slug) {
    const b = state.browse || {};
    if (b.bookUri) return renderBookToc(body, b.bookUri, () => goUp({ tab: slug }), TAB_TITLE[slug] || "Back");
    const data = await api("browse", { collection: slug });
    const books = data.books.filter((x) => x.docs > 0);
    if (!books.length) { body.append(el("div", { class: "empty", text: "Not downloaded yet. It comes in on its own, on a later night." })); return; }
    if (books.length === 1) return renderBookToc(body, books[0].uri, null);
    for (const bk of books) body.append(el("button", { class: "toc-row", onclick: () => go({ tab: slug, bookUri: bk.uri }) }, [el("div", { class: "t", text: bk.title }), el("div", { class: "s", text: `${bk.docs} pages` })]));
  }

  // The Joseph Smith Papers: a series (journals, revelations, histories…), then its volumes, then the papers.
  async function browseJsp(body) {
    const b = state.browse || {};
    const all = (await api("browse", {})).collections.filter((c) => c.slug.startsWith("jsp-"));
    if (!all.length) { body.append(el("div", { class: "empty", text: "The Joseph Smith Papers are not downloaded yet. They come in on their own, a series at a time over several nights: journals first, then revelations and translations, histories, and the documents." })); return; }
    const chips = el("div", { class: "shelf" });
    const series = b.series || all[0].slug;
    const seriesName = (c) => c.title.replace(/^Joseph Smith Papers: /, "");
    for (const c of all) chips.append(el("button", { class: "chip" + (series === c.slug ? " on" : ""), text: seriesName(c) + (c.docs ? "" : " (soon)"), onclick: () => go({ tab: "jsp", series: c.slug }) }));
    body.append(chips);
    const cur = all.find((c) => c.slug === series);
    if (b.series && cur && !b.bookUri) nameShelf(seriesName(cur));
    if (b.bookUri) return renderBookToc(body, b.bookUri, () => goUp({ tab: "jsp", series }), cur ? seriesName(cur) : "Back");
    const data = await api("browse", { collection: series });
    const books = data.books.filter((x) => x.docs > 0);
    if (!books.length) { body.append(el("div", { class: "empty", text: "Nothing from this series is downloaded yet. It comes in on its own, on a later night." })); return; }
    for (const bk of books) body.append(el("button", { class: "toc-row", onclick: () => go({ tab: "jsp", series, bookUri: bk.uri }) }, [el("div", { class: "t", text: bk.title }), el("div", { class: "s", text: `${bk.docs} ${bk.docs === 1 ? "page" : "pages"}` })]));
    body.append(el("p", { class: "deck-hint", text: "Transcriptions, source notes and historical introductions from josephsmithpapers.org (The Church Historian’s Press, © Intellectual Reserve, Inc.), for personal study. Tap a name in a paper for who or where it is." }));
  }

  // up: the crumb that goes a level up, and the name of that level
  async function renderBookToc(body, uri, up, upName = "Back") {
    const book = await api("book", { uri });
    if (up) nameShelf(book.title);
    if (up) body.append(el("div", { class: "crumbs" }, [el("button", { text: upName, onclick: up }), el("span", { text: book.title })]));
    else body.append(el("h2", { text: book.title }));
    for (const n of book.nodes || []) {
      if (n.kind === "section") body.append(el("div", { class: "toc-row section" }, [el("div", { class: "t", text: n.title })]));
      else body.append(el("button", { class: "toc-row" + (n.depth > 1 ? " sub" : ""), disabled: !n.doc_id, "data-doc": n.doc_id, onclick: () => n.doc_id && openDoc(n.doc_id, null) }, [
        el("div", { class: "t", text: n.title }), el("div", { class: "s", text: n.subtitle || "" })]));
    }
  }

  // ------------------------------------------------------------ reader ----
  let currentDoc = null;
  // replace: the page takes the place of the one open (the next chapter), where a plain open is a step of its own
  async function openDoc(id, pid, { push: doPush = true, scroll = true, replace = false } = {}) {
    if (!id) return;
    state.docId = id; state.pid = pid || null; state.studyId = null; currentStudy = null;
    if (doPush) { push(replace); if (replace) setEntry({ scroll: null }); paneView = "page"; } // a page chosen now is what the pane should show
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
    nameEntry(); // the page's title, or Ask or the Deck when the page rides beside one
    refreshTrailButtons();
    focusParagraph(state.pid, { scroll });
    // on a phone the page replaces the list, so the way back is what a keyboard or VoiceOver user meets first
    if (!wide() && doPush && !replace) { const back = readerPane.querySelector(".trail-back"); if (back) try { back.focus({ preventScroll: true }); } catch (_) {} }
    const verse = currentDoc.collection === "scriptures" && /^p\d+$/.test(state.pid || "") ? Number(state.pid.slice(1)) : null;
    store.set("lastRead", { id: currentDoc.id, title: currentDoc.title, where: crumbFor(currentDoc), pid: state.pid || null, verse });
  }

  function renderDoc(doc) {
    const bar = el("div", { class: "reader-bar" }, [
      trailButton(),
      titleCrumb(doc),
      chapNav(doc),
      el("div", { class: "spacer" }),
      ...sizeTools(doc),
      el("button", { class: "icon-btn bar-extra", "aria-label": "Present", title: "Present on a big screen", onclick: () => startPresenting(), html: ICON_PRESENT }),
      thinkBtn(),
      doc.collection && doc.collection.startsWith("jsp-") ? el("button", { class: "text-btn cite-btn", text: "Cite", title: "Copy a citation for this page", onclick: () => citePapers(doc) }) : null,
      el("a", { class: "icon-btn bar-extra", href: doc.source_url, target: "_blank", rel: "noopener", onclick: (e) => outside(e, doc.source_url), title: doc.collection && doc.collection.startsWith("jsp-") ? "Open on josephsmithpapers.org" : "Open on churchofjesuschrist.org", "aria-label": doc.collection && doc.collection.startsWith("jsp-") ? "Open on josephsmithpapers.org" : "Open on churchofjesuschrist.org", html: ICON_OUT }),
      el("span", { class: "pane-switch-slot" }),
    ].filter(Boolean));
    const body = el("article", { class: "doc" }, [sanitize(doc.body_html || "")]);
    if (doc.footnotes && doc.footnotes.length) {
      const notes = el("section", { class: "notes" }, [el("h2", { text: "Footnotes" })]);
      const ol = el("ol");
      for (const n of doc.footnotes) ol.append(el("li", { id: `fn-${n.note_id}` }, [el("b", { text: n.marker || "" }), el("span", {}, [sanitize(n.html || esc(n.text))])]));
      notes.append(ol);
      body.append(notes);
    }
    const nav = el("div", { class: "doc-nav" }, [
      doc.prev ? el("button", { text: `‹ ${doc.prev.title}`, onclick: () => stepChapter(doc.prev) }) : el("span"),
      doc.next ? el("button", { text: `${doc.next.title} ›`, onclick: () => stepChapter(doc.next) }) : el("span"),
    ]);
    const foot = el("div", { class: "doc-foot", text: doc.fetched_at ? `Copied from churchofjesuschrist.org ${new Date(doc.fetched_at).toLocaleDateString()}. Text and study helps are the Church's; this copy is for personal study.` : "" });
    readerPane.replaceChildren(bar, body, nav, foot);
    readerPane.classList.remove("has-study");
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
    highlightTerms(body);
    applyMarks(doc, body);
    showInStudies(doc, body);
  }

  // The reader's "open on the site" controls leave the way every other link does (openOutside): one
  // new tab online, and offline a line that says so instead of a dead tab.
  function outside(e, url) { e.preventDefault(); openOutside(url); }
  // The reader bar says where you are: the chapter or the page by name ("Alma 32"), and a tap on
  // the name leads up to what holds it, the book's chapters or the manual's contents.
  function titleCrumb(doc) {
    const name = doc.collection === "scriptures" && doc.citation ? chapterOf(doc.citation) : doc.title;
    const up = doc.collection === "scriptures" ? doc.book_name : doc.book?.title;
    const can = doc.collection === "scriptures" ? !!doc.book_slug : !!doc.book?.uri;
    return el("button", { type: "button", class: "crumb", disabled: !can, title: can ? `${up || "Contents"}: all of it` : crumbFor(doc),
      "aria-label": can ? `${name}. Open ${up || "the contents"}` : name, onclick: () => openContents(doc) }, [el("span", { text: name })]);
  }
  function openContents(doc) {
    const c = doc.collection || "";
    const tab = TAB_OF[c] || (c.startsWith("jsp-") ? "jsp" : "manuals");
    const browse = c === "scriptures" && doc.book_slug ? { tab, book: doc.book_slug } : { tab, bookUri: doc.book.uri };
    if (tab === "jsp") browse.series = c;
    if (tab === "conference" && doc.year) browse.year = doc.year;
    openList(browse);
  }
  // A shelf, or a depth in one, opened from the page: the list on a wide screen, the whole screen on
  // a phone. When the entry before is that very place (the book the chapter was opened from), it is Back.
  function openList(browse) {
    rememberScroll();
    const was = { browse: state.browse, q: state.q, doc: state.docId, pid: state.pid, study: state.studyId };
    state.q = ""; state.browse = browse;
    if (!wide()) { state.docId = null; state.pid = null; state.studyId = null; }
    if (here() > 0 && history.state?.prevUrl === urlFor()) { state.browse = was.browse; state.q = was.q; state.docId = was.doc; state.pid = was.pid; state.studyId = was.study; leavingScroll = null; history.back(); return; }
    leaveSearch();
    if (TAB_SCOPE[browse.tab]) state.scope = TAB_SCOPE[browse.tab];
    syncControls(); renderHome(); showList(); push();
  }
  // Previous and next, in the bar: the neighbour takes this page's place in the trail, so a run of
  // chapters is one step and Back still leads to where the reading began. Left and Right do the same.
  const ICON_FWD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
  function chapNav(doc) {
    if (!doc.prev && !doc.next) return null;
    const b = (to, dir, word, icon) => el("button", { type: "button", class: "chap", "data-dir": dir, disabled: !to, "aria-label": to ? `${word}: ${to.title}` : word, title: to ? to.title : word, html: icon, onclick: () => stepChapter(to, dir) });
    return el("span", { class: "chap-nav", role: "group", "aria-label": "Previous and next" }, [b(doc.prev, "prev", "Previous", ICON_BACK), b(doc.next, "next", "Next", ICON_FWD)]);
  }
  async function stepChapter(to, dir = null) {
    if (!to) return;
    const had = dir && document.activeElement?.closest?.(".chap-nav");
    await openDoc(to.id, null, { replace: true });
    // the bar was drawn again: the arrow that was pressed keeps the focus, for the next press
    const again = had ? $(`.reader-bar .chap[data-dir="${dir}"]`, readerPane) : null;
    if (again && !again.disabled) { try { again.focus({ preventScroll: true }); } catch (_) {} }
  }

  // A citation for a Joseph Smith Papers page, in the Papers' own form, with the manuscript page
  // when the page is known (the title carries it, or the selection sits under a page marker).
  function pageOf(doc) { return papersPageOf(doc.title); }
  // the manuscript page a paragraph is on: the page marker ("[p. 56]") before it, or the page the document is
  function markerPageOf(doc, node) {
    for (let n = node; n && n !== readerPane; n = n.parentElement) {
      for (let prev = n.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (prev.classList?.contains("jsp-page")) { const m = /\[p\.\s*([^\]]+)\]/.exec(prev.textContent || ""); if (m) return m[1].trim(); }
      }
    }
    return pageOf(doc);
  }
  const isPapers = (doc) => !!(doc && doc.collection && doc.collection.startsWith("jsp-"));
  function papersCitationFor(doc, nodes) {
    return papersCitation({ title: doc.title, pages: nodes.length ? nodes.map((n) => markerPageOf(doc, n)) : [pageOf(doc)], url: doc.source_url });
  }
  // Copy with the citation: a verse or paragraph each with its own; on a Papers page, the words and
  // then the citation Cite copies, with the pages they are on
  function copyText(units) {
    if (isPapers(currentDoc)) {
      const nodes = units.map((x) => $(`.doc #${CSS.escape(x.pid)}`, readerPane)).filter(Boolean);
      return `${units.map((x) => x.text).join("\n\n")}\n\n${papersCitationFor(currentDoc, nodes)}`;
    }
    const cite = (x) => x.kind === "verse" && currentDoc ? `${chapterOf(currentDoc.citation)}:${x.verse}` : crumbFor(currentDoc) || currentDoc?.title || "";
    return units.map((x) => `${x.text} (${cite(x)})`).join("\n\n");
  }
  function citePapers(doc) {
    const text = papersCitationFor(doc, [...readerPane.querySelectorAll(".doc .sel")]);
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
    const before = units.map((u) => ({ pid: u.pid, rec: docMarks.get(u.pid) || null })); // for Undo, when the color comes off
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
    if (allSame) toast(units.length === 1 ? "Highlight removed." : `${units.length} highlights removed.`, { action: "Undo", onAction: () => restoreMarks(page, before, units.length === 1 ? "Highlight put back." : "Highlights put back.") });
    else toast(units.length === 1 ? "Highlighted." : `${units.length} highlighted.`);
  }
  // Marks put back as they were (the record each paragraph had, or none): what the Undo on
  // "Highlight removed" and "Note removed" does. The page may have changed meanwhile; the store is
  // put right either way, and the page only if it is still the one open.
  async function restoreMarks(page, before, said) {
    for (const { pid, rec } of before) {
      try {
        let back = null;
        if (rec) back = await window.Marks.set({ uri: rec.uri, pid: rec.pid, doc_id: rec.doc_id, verse: rec.verse, kind: rec.kind, color: rec.color || null, note: rec.note || "", pid_end: rec.pid_end || null, verse_end: rec.verse_end, text: rec.text, citation: rec.citation, title: rec.title });
        else await window.Marks.remove(page.uri, pid);
        if (currentDoc !== page) continue;
        const b = $(".doc", readerPane);
        if (back) { docMarks.set(pid, back); if (b) drawMark(b, back); } else { docMarks.delete(pid); if (b) undrawMark(b, pid); }
      } catch (_) { toast("Could not put that back."); return; }
    }
    if (currentDoc === page) { drawRanges($(".doc", readerPane)); updateSelectBar(); }
    toast(said);
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
        // a note deleted can be had back: the toast holds the record as it was when the sheet opened
        if (!keep && old?.note) toast("Note removed.", { action: "Undo", onAction: () => restoreMarks(page, [{ pid: unit.pid, rec: old }], "Note put back.") });
        else toast(keep ? "Note saved." : "Note removed.");
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
  let currentStudy = null, studyScroll = 0;
  let studyAnchor = null; // a heading to open the study at (from a match in the results), once
  async function openStudy(id, { push: doPush = true, scroll = 0, anchor = null } = {}) {
    if (!id || !window.Studies) return;
    const frameNow = currentStudy && currentStudy.id === id ? readerPane.querySelector(".study-frame") : null;
    if (anchor && frameNow) frameNow.contentWindow?.postMessage({ type: "gospel:anchor", id: anchor }, "*");
    studyAnchor = frameNow ? null : anchor;
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
    nameEntry();
    refreshTrailButtons();
  }
  function renderStudy(rec, scroll = 0) {
    studyScroll = scroll || 0;
    const bar = el("div", { class: "reader-bar" }, [
      trailButton(),
      el("button", { type: "button", class: "crumb", title: "My studies: all of them", "aria-label": `${rec.title}. Open My studies`, onclick: () => openList({ tab: "studies" }) }, [el("span", { text: rec.title })]),
      el("div", { class: "spacer" }),
      thinkBtn(" on-phone"), // a study has no bottom bar on a phone, so the lamp stays up here
      el("span", { class: "pane-switch-slot" }),
    ]);
    const frame = el("iframe", { class: "study-frame", title: rec.title, sandbox: "allow-scripts" }); // no forms: a study page is read, and has nothing to submit to
    // the frame goes to study-frame.html, which asks for the page and writes it into itself: the
    // app's own page is pinned by a policy that a blob or srcdoc page would inherit
    window.Studies.mount(frame, rec);
    frame.addEventListener("load", () => {
      if (studyAnchor) { frame.contentWindow?.postMessage({ type: "gospel:anchor", id: studyAnchor }, "*"); studyAnchor = null; }
      else if (studyScroll) frame.contentWindow?.postMessage({ type: "gospel:scrollTo", y: studyScroll }, "*");
    });
    // a study can draw anything, a sign-in screen included; this line is the app's, outside the frame, and always there
    const own = el("div", { class: "study-own", role: "note", text: "Your own page. It is not part of the app; never type a passphrase or key into it." });
    readerPane.replaceChildren(bar, own, frame);
    readerPane.classList.add("has-study");
    refreshSwitches();
    fitStudyFrame();
  }
  // the frame fills what is left of the pane under the bar
  function fitStudyFrame() {
    const frame = readerPane.querySelector(".study-frame");
    if (!frame) { readerPane.classList.remove("has-study"); return; }
    const top = frame.getBoundingClientRect().top;
    const bottom = wide() ? readerPane.getBoundingClientRect().bottom : window.innerHeight - ($("#tabs")?.offsetHeight || 0); // a phone: down to the tab bar
    frame.style.height = Math.max(240, Math.floor(bottom - top)) + "px";
  }
  window.addEventListener("resize", fitStudyFrame);
  window.addEventListener("message", (e) => {
    const frame = readerPane.querySelector(".study-frame");
    if (!frame || e.source !== frame.contentWindow || !e.data || typeof e.data !== "object") return;
    if (e.data.type === "gospel:link" && typeof e.data.href === "string") {
      // a link with no site in it ("other.html", "../alma/33") pointed at a file beside the page
      // where it was written; nothing here knows where that was
      const h = e.data.href.trim();
      if (h && !/^[a-z][a-z0-9+.-]*:/i.test(h) && !h.startsWith("/")) toast("That link leads to a file beside this page, which is not on this device.");
      // mail, phone and message links start something on the device. A page's script can send
      // this message with no tap at all, so the link is offered and the tap on the offer starts it.
      else if (/^(mailto|tel|sms):/i.test(h)) {
        const kind = h.split(":")[0].toLowerCase(), rest = h.slice(kind.length + 1).split("?")[0];
        let to = rest; try { to = decodeURIComponent(rest); } catch (_) {}
        to = to.slice(0, 60);
        toast(kind === "mailto" ? `This page wants to start an email to ${to}.` : kind === "tel" ? `This page wants to call ${to}.` : `This page wants to start a message to ${to}.`, { action: kind === "mailto" ? "Write it" : kind === "tel" ? "Call" : "Message", href: h });
      }
      else if (h) followLink(h);
    }
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
    if (!list.length) return;
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
          if (state.studyId === rec.id) { currentStudy = null; state.studyId = null; readerPane.replaceChildren(); readerPane.classList.remove("has-study"); push(true); }
          toast("Removed.");
          renderHome(); showList();
        } }),
      ]));
    }
    body.append(rows);
  }

  // ---- My studies in the library's flow ---------------------------------------
  // The studies are read once (their words, headings and links, studies.js index) and kept in
  // memory until one is added or removed: a search looks in their words, and a chapter one of
  // them links to says so under its title.
  let studyIndexP = null, studyLinksP = null;
  window.addEventListener("studies:change", () => { studyIndexP = null; studyLinksP = null; });
  function studiesIndex() {
    if (!studyIndexP) studyIndexP = (async () => {
      const out = [];
      for (const m of (window.Studies ? await window.Studies.list() : [])) {
        try { const rec = await window.Studies.get(m.id); if (rec) { const x = window.Studies.index(rec); x.lower = x.text.toLowerCase(); out.push(x); } } catch (_) {}
      }
      return out;
    })();
    return studyIndexP;
  }
  const nearestAnchor = (s, at) => { let a = null; for (const x of s.anchors) { if (x.at <= at) a = x; else break; } return a; };
  // Results: up to three studies that have every word typed, each with the words around the first
  // match, opening at the heading nearest it.
  async function studiesInResults(data) {
    if (!window.Studies || data.typeahead && state.q.trim().length < 3) return;
    // the words as typed come first: a study may have a word the library lacks ("zone conference" is
    // read as zion, conference for the library, and is still what the study says); then the words
    // the search settled on (a question's key words, a corrected spelling)
    const clean = (list) => [...new Set(list.map((t) => t.toLowerCase().replace(/^["'(]+|["')]+$/g, "")).filter((t) => t.length >= 2))];
    const typed = clean(termsFrom(data.query || state.q || "")), read = clean(state.terms);
    const sets = [typed, read].filter((ts, i, a) => ts.length && (i === 0 || ts.join(" ") !== a[0].join(" ")));
    if (!sets.length) return;
    let idx;
    try { idx = await studiesIndex(); } catch (_) { return; }
    if (!idx.length || state.lastSearch !== data || state.view === "all") return;
    const wordAt = (lower, t, from = 0) => { const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "giu"); re.lastIndex = from; const m = re.exec(lower); return m ? m.index + m[1].length : -1; };
    const found = [];
    for (const s of idx) {
      const terms = sets.find((ts) => ts.every((t) => wordAt(s.lower, t) >= 0));
      if (!terms) continue;
      const first = terms.map((t) => wordAt(s.lower, t));
      let n = 0;
      for (const t of terms) { let i = -1, k = 0; while (k < 50 && (i = wordAt(s.lower, t, i + 1)) >= 0) { n++; k++; } }
      found.push({ s, at: Math.min(...first), n, terms });
    }
    if (!found.length) return;
    found.sort((a, b) => b.n - a.n);
    const mark = (text, terms) => { let h = esc(text); for (const t of terms) h = h.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\p{L}\\p{N}]*)`, "giu"), "$1<b>$2</b>"); return h; };
    const group = el("div", { class: "studies-hits" }, [el("div", { class: "group-title", text: "In your studies" })]);
    for (const { s, at, terms } of found.slice(0, 3)) {
      const a = nearestAnchor(s, at);
      const from = Math.max(0, s.text.lastIndexOf(" ", Math.max(0, at - 70)) + 1), to = Math.min(s.text.length, at + 130);
      const snip = (from > 0 ? "…" : "") + s.text.slice(from, to).replace(/\s+\S*$/, "") + (to < s.text.length ? "…" : "");
      group.append(el("button", { type: "button", class: "hit study-hit", onclick: () => openStudy(s.id, { anchor: a ? a.id : null }) }, [
        el("div", { class: "cite" }, [el("span", { text: s.title }), el("span", { class: "where", text: a ? `My studies · ${a.label}` : "My studies" })]),
        el("div", { class: "snip", html: mark(snip, terms) }),
      ]));
    }
    if (state.lastSearch !== data || !listPane.isConnected) return;
    listPane.querySelector(".studies-hits")?.remove();
    // after the title matches, before the passages
    const before = [...listPane.querySelectorAll(".group-title, .empty, .best, .hit-row, .more")].find((n) => n.textContent !== "By title" && !n.closest(".studies-hits"));
    if (before) before.before(group); else listPane.append(group);
  }
  // Chapters the studies link to: each study's links resolved once, as the library resolves a link
  // pressed in the study, to the page that would open.
  function studyLinks() {
    if (!studyLinksP) studyLinksP = (async () => {
      const map = new Map(), seen = new Map();
      for (const s of await studiesIndex()) {
        const mine = new Set();
        for (const l of s.links.slice(0, 800)) {
          const url = l.href.startsWith("/") ? "https://www.churchofjesuschrist.org" + l.href : l.href;
          if (!CHURCH.test(url)) continue;
          const key = url.replace(/[?#].*$/, "").replace(/\.\d+(-\d+)?$/, "");
          let r = seen.get(key);
          if (r === undefined) { try { r = await api("resolve", { href: url }); } catch (_) { r = null; } seen.set(key, r); }
          if (!r || !r.found || !r.doc_id || mine.has(r.doc_id)) continue;
          mine.add(r.doc_id);
          const a = nearestAnchor(s, l.at);
          (map.get(r.doc_id) || map.set(r.doc_id, []).get(r.doc_id)).push({ id: s.id, title: s.title, anchor: a ? a.id : null });
        }
      }
      return map;
    })();
    return studyLinksP;
  }
  // "In your studies: The Second Coming" under the title of a chapter a study links to
  async function showInStudies(doc, body) {
    if (!window.Studies || !doc) return;
    let list;
    try { list = (await studyLinks()).get(doc.id); } catch (_) { return; }
    if (!list || !body.isConnected || currentDoc?.id !== doc.id || body.querySelector(".in-studies")) return;
    const line = el("p", { class: "subtitle in-studies" }, [el("span", { text: "In your studies: " })]);
    list.slice(0, 4).forEach((s, i) => line.append(i ? ", " : "", el("button", { type: "button", class: "text-btn small inline", text: s.title, onclick: () => openStudy(s.id, { anchor: s.anchor }) })));
    if (list.length > 4) line.append(` and ${list.length - 4} more`);
    const head = body.querySelector("header");
    if (head) head.append(line); else body.prepend(line);
  }

  // Highlights and notes across the library, newest first (the latest few, or all of them on request),
  // with a way to keep them safe
  // The list can be searched (words, citation, note) and narrowed to one color; it shows the latest
  // ten of what matches, or all of it, under a heading per book when more than one book is in it.
  let allMarksShown = false;
  const marksFilter = { q: "", color: null };
  // a verse's book ("Alma 32:21" is Alma, "D&C 4:2" is D&C); any other mark goes under its page
  function markBook(m) { const v = /^(.+?)\s+\d+:\d+/.exec(m.citation || ""); return v ? v[1] : m.title || m.citation || "Other"; }
  async function renderMarks(body) {
    if (!window.Marks) return;
    let marks = [];
    try { marks = await window.Marks.all(); } catch (_) { marks = []; }
    const sec = el("section", { class: "marks-sec" });
    const allBtn = el("button", { type: "button", class: "text-btn small", hidden: true, onclick: () => { allMarksShown = !allMarksShown; draw(); } });
    sec.append(el("div", { class: "home-sec-head" }, [el("h3", { class: "marks-count", text: marks.length ? `${marks.length} ${marks.length === 1 ? "passage" : "passages"} marked` : "Nothing marked yet" }), allBtn]));
    const list = el("div", { class: "mark-list" });
    const row = (m) => el("button", { type: "button", class: `mark-row${m.color ? ` hl-${m.color}` : ""}`, onclick: async () => {
      let id = m.doc_id;
      try { const res = await api("resolve", { href: m.uri }); if (res.found && res.doc_id) id = res.doc_id; } catch (_) {}
      if (id) openDoc(id, m.pid); else toast("That page is not in the library now.");
    } }, [
      el("span", { class: "mk-cite", text: m.citation || m.title || m.uri }),
      el("span", { class: "mk-text", text: (m.text || "").length > 140 ? m.text.slice(0, 138) + "…" : (m.text || "") }),
      m.note ? el("span", { class: "mk-note" }, [el("span", { class: "ic", html: ICON_NOTE }), document.createTextNode(m.note.length > 160 ? m.note.slice(0, 158) + "…" : m.note)]) : null,
    ].filter(Boolean));
    function draw() {
      const words = marksFilter.q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = marks.filter((m) => (!marksFilter.color || m.color === marksFilter.color)
        && words.every((w) => [m.text, m.citation, m.title, m.note].some((f) => (f || "").toLowerCase().includes(w))));
      const shown = hits.slice(0, allMarksShown ? hits.length : 10);
      allBtn.hidden = hits.length <= 10;
      allBtn.textContent = allMarksShown ? "Latest only" : `All ${hits.length}`;
      if (!shown.length) { list.replaceChildren(el("p", { class: "studies-lede mk-none", text: "No highlight or note matches." })); return; }
      const books = new Map();
      for (const m of shown) { const b = markBook(m); if (!books.has(b)) books.set(b, []); books.get(b).push(m); }
      if (books.size < 2) { list.replaceChildren(...shown.map(row)); return; }
      list.replaceChildren(...[...books].flatMap(([b, ms]) => [el("h3", { class: "mk-book", text: b }), ...ms.map(row)]));
    }
    if (!marks.length) {
      sec.append(el("p", { class: "studies-lede", text: "Tap a verse or paragraph while reading, then a color or Note: your marks come back whenever the page opens, and are listed here." }));
    } else {
      if (marks.length > 3) {
        const find = el("input", { type: "search", class: "mk-find", placeholder: "Find in your marks", "aria-label": "Find in your highlights and notes", value: marksFilter.q });
        find.addEventListener("input", () => { marksFilter.q = find.value; draw(); });
        const dot = (c, name) => el("button", { type: "button", class: `mk-dot${c ? ` hl-${c}` : " all"}`, "aria-pressed": String(marksFilter.color === c), "aria-label": c ? `Only ${name}` : "All colors", title: c ? `Only ${name}` : "All colors", text: c ? "" : "All", onclick: (e) => {
          marksFilter.color = c;
          for (const d of e.currentTarget.parentElement.children) d.setAttribute("aria-pressed", String(d === e.currentTarget));
          draw();
        } });
        sec.append(el("div", { class: "mk-filter" }, [find, el("div", { class: "mk-colors", role: "group", "aria-label": "Color" }, [dot(null, "All"), ...(window.Marks.COLORS || []).map((c) => dot(c, window.Marks.COLOR_NAME?.[c] || c))])]));
      }
      sec.append(list);
      draw();
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
          // built from the marks already listed, with no wait, so the share sheet opens inside the tap
          const name = `gospel-marks-${new Date().toISOString().slice(0, 10)}.json`;
          const text = window.Marks.exportJsonOf ? window.Marks.exportJsonOf(marks) : await window.Marks.exportJson();
          await saveFile(name, text, "Highlights and notes");
        } catch (_) { toast("Could not export just now."); }
      } }) : null,
      el("button", { type: "button", class: "text-btn", text: "Import", title: "Bring in highlights and notes from a file", onclick: () => pick.click() }),
      pick,
    ].filter(Boolean)));
    body.append(sec);
  }

  // A JSON file handed to the device. On an iPhone or iPad the share sheet (Save to Files,
  // AirDrop) is the dependable way out of a home-screen app, as it is for the deck; a download
  // link is the way elsewhere.
  async function saveFile(name, text, title) {
    if (navigator.maxTouchPoints > 0 && typeof File === "function") {
      const file = new File([text], name, { type: "application/json" });
      let can = false;
      try { can = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (_) {}
      if (can) {
        try { await navigator.share({ files: [file], title }); return; }
        catch (err) { if (err && err.name === "AbortError") return; } // anything else: the download below
      }
    }
    const blob = new Blob([text], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- Settings: one screen behind the gear ---------------------------------
  // The gear (the rail's foot on an iPad, the top of every tab on a phone, and the one on Ask)
  // opens one screen, in the app's sheet, so Back and Escape close it: Claude (ask.js draws its
  // own part), Reading, Library, Backup, About.
  async function backupData() {
    const out = { app: "gospel-library", kind: "backup", version: 1, exported: new Date().toISOString() };
    out.marks = window.Marks ? await window.Marks.all() : [];
    out.studies = window.Studies?.exportAll ? await window.Studies.exportAll() : [];
    out.decks = window.Deck?.backup ? window.Deck.backup() : null;
    // his words to Claude and what it was asked to remember; never the API key or the passphrase
    out.ask = { instructions: window.Ask?.settings.instructions || "", notes: window.Ask?.settings.notes || "" };
    out.reading = { size: store.get("readingSize") };
    return out;
  }
  async function restoreBackup(text) {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object") throw new Error("That file is not a backup from this app.");
    if (data.kind === "marks" || Array.isArray(data)) { const n = await window.Marks.importJson(data); return n ? [`${n} ${n === 1 ? "mark" : "marks"}`] : []; }
    if (data.app !== "gospel-library" || data.kind !== "backup") throw new Error("That file is not a backup from this app.");
    const got = [];
    if (Array.isArray(data.marks) && window.Marks) { const n = await window.Marks.importJson({ marks: data.marks }); if (n) got.push(`${n} ${n === 1 ? "mark" : "marks"}`); }
    if (Array.isArray(data.studies) && window.Studies?.importAll) { const n = await window.Studies.importAll(data.studies); if (n) got.push(`${n} study ${n === 1 ? "page" : "pages"}`); }
    if (data.decks && window.Deck?.restore) { const n = await window.Deck.restore(data.decks); if (n) got.push(`${n} ${n === 1 ? "deck" : "decks"} in My decks`); }
    // His words to Claude are not taken in here: they would be part of every question from
    // then on, and a file can come from anyone. What the file would add is handed back, to be
    // shown and accepted (or not) by the screen that asked for the import.
    const words = data.ask && window.Ask?.incoming ? window.Ask.incoming(data.ask) : null;
    if (words && (words.instructions || words.notes.length)) got.ask = { from: data.ask, ...words };
    return got;
  }
  // The keys the app answers to, as a list: "?" shows it, and so does a row in Settings (which
  // it then leads back to). The same sheet as Settings, so Escape, Back and the scrim close it.
  const KEYS = [
    ["Anywhere", [["/  or  ⌘F  or  ⌘K", "Search"], ["⌘[", "Back"], ["⌘Z", "Undo (the last add, mark or deck change)"], ["Esc", "Close a sheet, leave a field, let a selection go"], ["?", "This list"]]],
    ["Reading", [["←  →", "Previous and next chapter"], ["Tab", "To the verses, then on to the bars"], ["↑  ↓", "From verse to verse"], ["Return  or  Space", "Select the verse, or let it go"], ["P", "Present from here"]]],
    ["Presenting", [["→  Space  ↓", "Next"], ["←  ↑  Delete", "Previous"], ["+  −", "Larger and smaller"], ["B  or  .", "Blank the screen, and bring it back"], ["Esc", "Stop presenting"]]],
  ];
  function openShortcuts(fromSettings = false) {
    if (!state.ready || (overlay && !fromSettings)) return;
    const head = el("h2", { text: "Keyboard shortcuts", tabindex: "-1" });
    const box = el("div", { class: "settings keys" }, [
      fromSettings ? el("button", { type: "button", class: "text-btn keys-back", text: "‹ Settings", onclick: () => openSettings(true) }) : null,
      head,
      el("p", { class: "set-note", text: "With a keyboard attached. On other keyboards Ctrl stands in for ⌘." }),
      ...KEYS.map(([title, rows]) => el("section", { class: "set-sec" }, [el("h3", { text: title }), el("dl", { class: "key-list" }, rows.flatMap(([k, what]) => [el("dt", {}, k.split("  ").map((part) => (part === "or" ? el("span", { class: "or", text: "or" }) : el("kbd", { text: part })))), el("dd", { text: what })]))])),
    ].filter(Boolean));
    $(".sheet-body", sheet).replaceChildren(box);
    sheet.classList.add("page");
    sheet.scrollTop = 0;
    openSheet("Keyboard shortcuts");
    setTimeout(() => { try { head.focus({ preventScroll: true }); } catch (_) {} }, 60);
  }
  function openSettings(again = false) {
    if (!state.ready || (overlay && !again)) return;
    const head = el("h2", { text: "Settings", tabindex: "-1" });
    const box = el("div", { class: "settings" }, [head]);
    const sec = (id, title, kids) => { const s = el("section", { class: "set-sec", id: `set-${id}` }, [el("h3", { text: title }), ...[].concat(kids).filter(Boolean)]); box.append(s); return s; };
    const row = (label, value) => el("div", { class: "set-row" }, [el("span", { class: "set-lb", text: label }), typeof value === "string" ? el("span", { class: "set-val", text: value }) : value]);
    if (window.Ask?.settingsBox) sec("claude", "Claude", window.Ask.settingsBox({ close: closeSheet }));
    // Reading
    const sizeNow = () => `${parseInt(getComputedStyle(document.documentElement).getPropertyValue("--reading-size")) || 17} px`;
    const sizeLb = el("span", { class: "set-size-now", "aria-live": "polite", text: sizeNow() });
    const step = (d) => { resize(d); sizeLb.textContent = sizeNow(); };
    sec("reading", "Reading", [
      row("Text size", el("span", { class: "set-size" }, [
        el("button", { type: "button", "aria-label": "Smaller text", onclick: () => step(-1), html: "<span style='font-size:14px;font-weight:600'>A</span>" }),
        sizeLb,
        el("button", { type: "button", "aria-label": "Larger text", onclick: () => step(1), html: "<span style='font-size:21px;font-weight:600'>A</span>" }),
      ])),
      el("p", { class: "set-sample", text: "For behold, this life is the time for men to prepare to meet God." }),
    ]);
    // Library: filled in as the answers come
    const libRows = el("div", { class: "set-rows" }, [row("On this device", "Counting…")]);
    const checkBtn = el("button", { type: "button", class: "text-btn", text: "Check for an update", onclick: async () => {
      checkBtn.disabled = true; checkBtn.textContent = "Checking…";
      const found = await checkForUpdate(true);
      checkBtn.disabled = false; checkBtn.textContent = "Check for an update";
      if (found === "found") closeSheet(); // the offer is on the page under this screen
    } });
    sec("library", "Library", [libRows, el("div", { class: "set-acts" }, [checkBtn])]);
    (async () => {
      const rows = [];
      try {
        const st = await libraryStats();
        const active = store.get("active") || {};
        const built = st.meta?.bundle?.built_at || active.builtAt;
        rows.push(row("Version", [built ? `Built ${new Date(built).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}` : "", active.version ? `version ${String(active.version).slice(0, 12)}` : ""].filter(Boolean).join(", ") || "Unknown"));
        const sem = await semanticNote();
        rows.push(row("On this device", [`${st.documents.toLocaleString()} pages`, st.verses ? `${st.verses.toLocaleString()} verses` : "", st.talks ? `${st.talks.toLocaleString()} talks` : "", st.originals ? "Hebrew and Greek" : "", sem ? "search by meaning" : ""].filter(Boolean).join(", ")));
      } catch (_) { rows.push(row("On this device", "The library is not answering.")); }
      try { const e = await navigator.storage?.estimate?.(); if (e && e.usage) rows.push(row("Size", `${mb(e.usage)} used on this device`)); } catch (_) {}
      const keepRow = el("div", { class: "set-row" });
      const drawKeep = async () => {
        let kept = null;
        try { kept = navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch (_) {}
        keepRow.replaceChildren(el("span", { class: "set-lb", text: "Storage" }), el("span", { class: "set-val" }, [
          kept === null ? "This browser does not say whether it keeps the library." : kept ? "Kept: the system will not clear the library or your marks to make room." : "May be cleared: when the device runs short of space, the system may remove the library and your marks. Adding the app to the Home Screen helps. ",
          kept === false ? el("button", { type: "button", class: "text-btn inline", text: "Ask again", onclick: async () => { try { await navigator.storage.persist(); } catch (_) {} drawKeep(); } }) : null,
        ].filter(Boolean)));
      };
      await drawKeep();
      rows.push(keepRow);
      libRows.replaceChildren(...rows);
    })();
    // Backup
    const pick = el("input", { type: "file", accept: ".json,application/json", hidden: true, "aria-hidden": "true" });
    const said = el("p", { class: "set-said", role: "status" });
    // the file's words for Claude, shown in full before they are accepted
    const offer = el("div", { class: "set-incoming", hidden: true });
    const offerWords = (ask) => {
      const done = (text) => { offer.hidden = true; offer.replaceChildren(); said.textContent = text; };
      offer.replaceChildren(...[
        el("h4", { text: "This file also carries words for Claude" }),
        el("p", { class: "set-note", text: "They would go with every question you ask from now on. Read them, and accept them only if they are yours." }),
        ask.instructions ? el("div", { class: "lb", text: "How I want Claude to answer" }) : null,
        ask.instructions ? el("pre", { class: "incoming-text", tabindex: "0", text: ask.instructions }) : null,
        ask.notes.length ? el("div", { class: "lb", text: "What Claude should remember" }) : null,
        ask.notes.length ? el("pre", { class: "incoming-text", tabindex: "0", text: ask.notes.join("\n") }) : null,
        el("div", { class: "set-acts" }, [
          el("button", { type: "button", class: "primary", text: "Accept these", onclick: () => { const got = window.Ask.restore(ask.from); done(got.length ? `Brought in: ${got.join(", ")}.` : "Nothing new in them."); } }),
          el("button", { type: "button", class: "text-btn", text: "Leave them out", onclick: () => done("Left out. Nothing was changed in what Claude is told.") }),
        ]),
      ].filter(Boolean));
      offer.hidden = false;
    };
    pick.addEventListener("change", async () => {
      const file = pick.files && pick.files[0];
      if (!file) return;
      offer.hidden = true;
      try { const got = await restoreBackup(await file.text()); said.textContent = got.length ? `Brought in: ${got.join(", ")}.` : got.ask ? "" : "Nothing new in that file."; if (got.ask) offerWords(got.ask); statsCache = null; if (tabNow() === "library" && sheet.hidden === false && !state.q.trim()) renderHome(); }
      catch (err) { said.textContent = err instanceof SyntaxError ? "That file could not be read." : err.message || "That file could not be read."; }
      pick.value = "";
    });
    sec("backup", "Backup", [
      el("p", { class: "set-note", text: "One file with your highlights and notes, your study pages, your decks, your instructions to Claude and what it was asked to remember. The API key and the library passphrase are never in it." }),
      el("div", { class: "set-acts" }, [
        el("button", { type: "button", class: "primary", text: "Export everything", onclick: async () => {
          try { await saveFile(`gospel-library-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await backupData(), null, 1), "Gospel Library backup"); said.textContent = "Exported. Keep the file somewhere other than this device."; }
          catch (_) { said.textContent = "Could not export just now."; }
        } }),
        el("button", { type: "button", class: "text-btn", text: "Import", onclick: () => pick.click() }),
        pick,
      ]),
      said,
      offer,
    ]);
    sec("keys", "Keyboard", [
      el("p", { class: "set-note", text: "With a keyboard attached, the app answers to a few keys. Press ? at any time for the list." }),
      el("div", { class: "set-acts" }, [el("button", { type: "button", class: "text-btn", text: "Keyboard shortcuts", onclick: () => openShortcuts(true) })]),
    ]);
    // About
    const ver = el("p", { class: "set-note" });
    // the error log (lib/log.js): what has gone wrong on this device since the app was opened,
    // copied whole so it can be pasted into a message. It never holds the key or the passphrase.
    let errLog = null;
    if (window.GLLog) {
      const n = window.GLLog.count();
      const errSaid = el("p", { class: "set-said", role: "status", text: n ? `${n} ${n === 1 ? "error" : "errors"} noted since the app was opened. The log never holds your key or passphrase.` : "Nothing has gone wrong since the app was opened." });
      errLog = el("div", { class: "set-errlog" }, [
        el("div", { class: "set-acts" }, [el("button", { type: "button", class: "text-btn", text: `Copy error log (${n})`, onclick: async () => { errSaid.textContent = (await window.GLLog.copy()) ? "Copied. Paste it into a message." : "The log could not be copied here."; } })]),
        errSaid,
      ]);
    }
    sec("about", "About", [
      el("p", { class: "set-note", text: "A personal copy of the scriptures, general conference and the manuals, kept on this device and searched here; it works offline. The text and study helps are the Church's, copied from churchofjesuschrist.org and josephsmithpapers.org for personal study." }),
      ver,
      errLog,
    ]);
    try { caches.keys().then((keys) => { const k = keys.find((x) => /^gospel-shell-v\d+/.test(x)); if (k) ver.textContent = `App files: ${k.replace("gospel-shell-", "")}.`; }, () => {}); } catch (_) {}
    $(".sheet-body", sheet).replaceChildren(box);
    sheet.classList.add("page");
    sheet.scrollTop = 0;
    openSheet("Settings");
    // the sheet puts the cursor in its first field; here that would raise the keyboard over the
    // settings before anything is read, so the heading takes the focus instead
    setTimeout(() => { try { head.focus({ preventScroll: true }); } catch (_) {} }, 60);
  }

  // ---- Think it through, from anywhere ------------------------------------
  // A lamp in the reader bar (in its menu on a phone) for the page being read, and "Think
  // these through" on the line above a set of results: the page (with anything selected) or the
  // search goes to Claude on the Ask tab, which comes back with what the library holds that
  // connects to it, each passage a card for the deck. It was a floating pill once, and sat on
  // the words and on the link to the next chapter.
  function thinkBtn(cls = "") {
    return el("button", { type: "button", class: "icon-btn think-btn" + cls, title: "Think it through with Claude", "aria-label": "Think it through with Claude", html: ICON_THINK + '<span class="think-word" aria-hidden="true">Think</span>', onclick: () => thinkHere() }); // the lamp wears its word where the bar has room
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
    const picked = [...readerPane.querySelectorAll(".doc .sel")];
    const n = picked.length;
    // Each selected verse says so to VoiceOver: by its description (and the check mark's own words,
    // app.css). A role that carries aria-selected or aria-pressed (option, button) would make the
    // verse one flat label and hide the footnote links inside it, so the verse keeps its own role.
    for (const u of readerPane.querySelectorAll(".doc [aria-describedby='selSay']")) if (!u.classList.contains("sel")) u.removeAttribute("aria-describedby");
    for (const u of picked) u.setAttribute("aria-describedby", "selSay");
    if (n !== saidSel) {
      const noun = picked.every((u) => u.classList.contains("verse")) ? (n === 1 ? "verse" : "verses") : (n === 1 ? "passage" : "passages");
      say(n ? `${n} ${noun} selected` : "Selection cleared");
      saidSel = n;
    }
    if (!n) { bar?.remove(); syncPanes(); return; }
    if (!bar) {
      const present = () => { const u = selectedUnits(); startPresentingUnits(u.map((x) => ({ text: x.text, kind: x.kind, where: x.kind === "verse" && currentDoc ? `${chapterOf(currentDoc.citation)}:${x.verse}` : crumbFor(currentDoc) }))); };
      const copy = () => {
        const text = copyText(selectedUnits());
        navigator.clipboard?.writeText(text).then(() => toast("Copied, with the citation."), () => toast("Could not copy here."));
      };
      const clear = () => { const f = $(".doc .sel", readerPane); clearSelection(); focusUnit(f); };
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
        // these three fold behind "more" when the bar has no room for them (fitSelectBar)
        el("button", { type: "button", class: "text-btn only-wide fold", text: "Present", onclick: present }),
        el("button", { type: "button", class: "text-btn fold", text: "Copy", title: "Copy with the citation", onclick: copy }),
        el("button", { type: "button", class: "text-btn clear-sel fold", "aria-label": "Clear selection", title: "Clear selection", onclick: clear }, [el("span", { class: "long", text: "Clear" }), el("span", { class: "short", text: "×", "aria-hidden": "true" })]),
        popMenu({ class: "sel-more-btn", "aria-label": "More: Present, Copy, Clear", title: "More", html: ICON_MORE }, [
          ["Present", ICON_PRESENT, present], ["Copy with the citation", ICON_COPY, copy], ["Clear selection", ICON_CLEAR, clear],
        ], "sel-more"),
      ]);
      // right after the reader bar in the order Tab and VoiceOver follow; app.css draws it at the bottom
      const rb = $(".reader-bar", readerPane);
      if (rb) rb.after(bar); else readerPane.prepend(bar);
      syncPanes();
    }
    $(".n", bar).textContent = `${n} selected`;
    // a dot is pressed when every selected passage carries its color (pressing it again takes it off)
    const pids = [...readerPane.querySelectorAll(".doc .sel")].map((u) => u.id);
    for (const d of bar.querySelectorAll(".hl-dot")) d.setAttribute("aria-pressed", String(!!pids.length && pids.every((pid) => docMarks.get(pid)?.color === d.dataset.color)));
    fitSelectBar();
  }
  // The bar on one row: when the dots, Note, Add to deck and the rest do not fit (an iPad in
  // portrait, a phone), Present, Copy and Clear go behind one "more" button. Measured with nothing
  // allowed to shrink, as the reader bar is.
  function fitSelectBar() {
    const bar = $(".select-bar", readerPane);
    if (!bar || bar.offsetParent === null) return;
    // two folds: Present, Copy and Clear behind "more"; then, still too full (an iPad in portrait
    // beside the rail), the count goes and Add to deck is "+ Deck", as on a phone
    bar.classList.remove("compact", "snug", "close");
    for (const level of ["compact", "snug", "close"]) { // close: the largest type on a phone, where the first two are not enough
      bar.classList.add("measuring");
      const over = overflows(bar);
      bar.classList.remove("measuring");
      if (!over) break;
      bar.classList.add(level);
    }
  }
  window.addEventListener("resize", fitSelectBar);
  // A small menu on a button, the pattern of the reader bar's Aa: a tap opens it, a tap elsewhere
  // or Escape closes it (focus back on the button), and a choice closes it and acts.
  const ICON_MORE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
  const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/></svg>';
  const ICON_CLEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function popMenu(btnAttrs, items, cls) {
    const menu = el("div", { class: "size-menu", role: "menu", hidden: true }, items.map(([label, icon, act]) =>
      el("button", { type: "button", role: "menuitem", onclick: () => { shut(); act(); } }, [el("span", { class: "g", html: icon }), label])));
    const btn = el("button", { type: "button", "aria-haspopup": "menu", "aria-expanded": "false", ...btnAttrs, onclick: (e) => { e.stopPropagation(); if (menu.hidden) open(); else shut(); } });
    const wrap = el("span", { class: cls }, [btn, menu]);
    const away = (e) => { if (!wrap.contains(e.target)) shut(); };
    menu.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); btn.focus(); } });
    function open() { menu.hidden = false; btn.setAttribute("aria-expanded", "true"); document.addEventListener("pointerdown", away, true); menu.querySelector("button")?.focus({ preventScroll: true }); }
    function shut() { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); document.removeEventListener("pointerdown", away, true); }
    return wrap;
  }
  // toast(text, { action: "Undo", onAction }) adds a button and stays about five seconds, long
  // enough to reach it; the plain toast still goes after two. A newer toast replaces an older one.
  // There is one toast element, a live region made once and kept: VoiceOver reads a change to its
  // words, where a status element created already filled is often missed. Cmd+Z or Ctrl+Z presses
  // its Undo while it shows (VoiceOver cannot reach the button in five seconds).
  let toastEl = null, toastTimer = null, toastAct = null;
  function toastClose() { clearTimeout(toastTimer); toastAct = null; toastEl?.classList.remove("show"); }
  function toastArm(ms) { clearTimeout(toastTimer); toastTimer = setTimeout(toastClose, ms); }
  // With href the action is a real link to the web in a new tab: the tap on it is its own gesture,
  // which Safari wants before it opens anything. more: [{ action, onAction or href }] adds others.
  function toast(text, { action, onAction, href, more } = {}) {
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
    const press = (fn) => () => { toastClose(); try { fn?.(); } catch (_) {} };
    toastAct = action ? press(href ? null : onAction) : null;
    const control = (a, first) => a.href
      ? el("a", { class: "toast-action", href: a.href, target: "_blank", rel: "noopener", text: a.action, onclick: () => setTimeout(toastClose, 0) })
      : el("button", { type: "button", class: "toast-action", text: a.action, onclick: first ? () => toastAct?.() : press(a.onAction) });
    const extra = action && Array.isArray(more) ? more.filter((a) => a && a.action) : [];
    t.className = "toast show" + (action ? " has-action" : "") + (extra.length ? " has-more" : "");
    t.replaceChildren(...[el("span", { text }), action ? control({ action, href }, true) : null, ...extra.map((a) => control(a, false))].filter(Boolean));
    placeToast(); requestAnimationFrame(placeToast); // again once the tap that raised it has redrawn the page
    toastArm(action ? (href || extra.length ? 8000 : 5000) : 1800);
  }
  // The toast never lies on the tab bar, the selection bar or Ask's box: it sits just above the
  // highest of whichever of them holds the bottom of the screen at that moment.
  function placeToast() {
    if (!toastEl) return;
    const vh = window.innerHeight;
    let top = vh;
    for (const n of [wide() ? null : $("#tabs"), $(".select-bar", readerPane), listPane.querySelector(".ask-dock")]) {
      if (!n || n.offsetParent === null && getComputedStyle(n).position !== "fixed") continue;
      const r = n.getBoundingClientRect();
      if (r.height > 0 && r.bottom > vh - 120 && r.top < vh) top = Math.min(top, r.top);
    }
    toastEl.style.bottom = top < vh ? `${Math.round(vh - top + 12)}px` : "";
  }
  // Outside a field Cmd+Z is always the app's: the toast's Undo while one shows, else the deck's own
  // undo. Left to the browser it would rewind the search box, and a search would run from nowhere.
  document.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || (e.key !== "z" && e.key !== "Z") || e.defaultPrevented) return;
    const a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return; // a field's own undo comes first
    e.preventDefault();
    // a toast whose action is a link to the web has nothing to undo
    if (toastAct && !toastEl?.querySelector("a.toast-action")) toastAct();
    else if (window.Deck && window.Deck.undo && window.Deck.undo()) toast("Undone."); // deck.js listens too, and stands down once this has taken the key
  });
  // The toast after an add, with an Undo that takes off exactly what that add put on.
  function deckToast(added, text) {
    if (added && window.Deck?.saysWhere?.()) return; // the deck says where it went, with an Undo of its own: one toast, not two
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

  // The library's HTML is the Church's own and the build already scrubs it (parse.py), but a
  // page of it is still text from outside the app. It is read into a document of its own that
  // runs nothing and loads nothing (DOMParser), and only what a page of reading is made of is
  // carried over: the tags below, with their class, id, data- and aria- attributes, a link's
  // address, a picture from the app's own files. Everything else is left behind: scripts and
  // styles, forms and their controls, frames, video, a base, every handler, every style
  // attribute (a page could draw itself over the app with one), a link's target. A tag that is
  // not known is opened and its words kept. The result is new nodes of this page, so nothing
  // from outside is ever parsed in it.
  const SAFE_TAGS = new Set("p span a sup sub em i b strong u s del ins small mark abbr cite q br hr wbr div section article header footer aside h1 h2 h3 h4 h5 h6 ul ol li dl dt dd blockquote pre code table caption colgroup col thead tbody tfoot tr td th img figure figcaption ruby rt rp time bdi bdo".split(" "));
  // these go with everything inside them; any other unknown tag is unwrapped
  const DROPPED_WHOLE = new Set("script style iframe frame frameset object embed applet link meta base form input button select textarea option optgroup datalist output video audio source track canvas svg math template noscript title head dialog".split(" "));
  const SAFE_ATTRS = { a: ["href"], img: ["src", "alt", "width", "height"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan", "scope"], ol: ["start", "type"], li: ["value"], col: ["span"], colgroup: ["span"], time: ["datetime"] };
  const SAFE_GLOBAL = /^(class|id|lang|dir|title|role|data-[\w.-]+|aria-[\w-]+)$/;
  function safeHref(v) {
    const t = String(v || "").replace(/[\u0000-\u0020]+/g, "");
    return !/^[a-z][a-z0-9+.-]*:/i.test(t) || /^(https?|mailto|tel|sms):/i.test(t);
  }
  function safeSrc(v) {
    const t = String(v || "").trim();
    if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(t)) return true;
    try { return new URL(t, BASE).origin === location.origin; } catch (_) { return false; }
  }
  // The chain on the stage is a drawing the deck makes itself (deck.js mapUnits). It is held to
  // the same rule: these shapes, these attributes, numbers and plain words for values.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const DRAW_TAGS = new Set(["svg", "defs", "marker", "path", "polyline", "rect", "text"]);
  const DRAW_ATTRS = new Set("class id viewBox x y width height rx points d fill stroke stroke-width stroke-linejoin marker-end opacity text-anchor font-size font-weight refX refY markerWidth markerHeight orient".split(" "));
  function cleanDrawing(from, into) {
    for (const c of from.childNodes) {
      if (c.nodeType === 3) { into.append(document.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1 || c.namespaceURI !== SVG_NS || !DRAW_TAGS.has(c.localName)) continue;
      const node = document.createElementNS(SVG_NS, c.localName);
      for (const a of c.attributes) {
        if (!DRAW_ATTRS.has(a.name)) continue;
        if (a.name === "marker-end" ? !/^url\(#[\w-]+\)$/.test(a.value) : !/^[\w\s.,()%#-]*$/.test(a.value) || /url/i.test(a.value)) continue;
        node.setAttribute(a.name, a.value);
      }
      cleanDrawing(c, node);
      into.append(node);
    }
    return into;
  }
  function cleanInto(from, into, drawing = false) {
    for (const c of from.childNodes) {
      if (c.nodeType === 3) { into.append(document.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.localName;
      if (drawing && tag === "svg" && c.namespaceURI === SVG_NS) { cleanDrawing({ childNodes: [c] }, into); continue; }
      if (c.namespaceURI !== "http://www.w3.org/1999/xhtml" || DROPPED_WHOLE.has(tag)) continue;
      if (!SAFE_TAGS.has(tag)) { cleanInto(c, into, drawing); continue; }
      if (tag === "img" && !safeSrc(c.getAttribute("src"))) continue;
      const node = document.createElement(tag);
      const own = SAFE_ATTRS[tag] || [];
      for (const a of c.attributes) {
        const name = a.name.toLowerCase();
        if (!SAFE_GLOBAL.test(name) && !own.includes(name)) continue;
        if (name === "href" && !safeHref(a.value)) continue;
        node.setAttribute(name, a.value);
      }
      cleanInto(c, node, drawing);
      into.append(node);
    }
    return into;
  }
  // sanitize(html) gives the cleaned page as a fragment, ready to be a child of el(); nothing
  // made from library or study text goes through el({ html }).
  function sanitize(html, { drawing = false } = {}) {
    // (a base is renamed first: even in a document that shows nothing, the browser reports one against the app's policy)
    const inert = new DOMParser().parseFromString(`<!doctype html><body>${String(html ?? "").replace(/<base(?=[\s>/])/gi, "<x-base")}`, "text/html");
    return cleanInto(inert.body, document.createDocumentFragment(), drawing);
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
    // every web link, a relative one too (read against the page's own address on its site, not the
    // app's, which would reload the app somewhere it has no page); mail and phone links are the browser's
    const u = href.trim() ? linkUrl(href, currentDoc && currentDoc.source_url) : null;
    if (u && /^https?:$/.test(u.protocol)) { e.preventDefault(); followLink(u.href); }
  }
  // Every link goes through here: the library's own copy when it holds the page (a verse shows
  // in a sheet first, a page or a book opens), the web otherwise.
  // The sites the library copies: the Church's, its old addresses, and the Joseph Smith Papers.
  const CHURCH = /^https?:\/\/([a-z0-9-]+\.)*(churchofjesuschrist\.org|lds\.org|josephsmithpapers\.org)(\/|$)/i;
  const CHURCH_SITE = "https://www.churchofjesuschrist.org/";
  // Every shape of address becomes a whole one the same way (/study/..., //www..., http:...): a
  // path with no site is the Church's, which is where the library's pages and most notes point.
  function linkUrl(href, base) {
    try { return new URL(String(href || "").trim(), base || CHURCH_SITE); } catch (_) { return null; }
  }
  async function followLink(href, base) {
    const u = linkUrl(href, base);
    if (!u) return;
    // mail and phone links belong to the device. The link was tapped where it cannot act (a
    // study's frame is shut in), so a real link is clicked here in its place, at once.
    if (/^(mailto|tel|sms):$/.test(u.protocol)) { const a = el("a", { href: u.href, hidden: true }); document.body.append(a); a.click(); a.remove(); return; }
    if (!/^https?:$/.test(u.protocol)) return;
    const url = u.href;
    if (toastEl?.querySelector("a.toast-action")) toastClose(); // the offer for the link before this one
    if (!CHURCH.test(url)) { openOutside(url); return; }
    let res = null;
    try { res = await api("resolve", { href: url }); } catch (_) { res = null; }
    if (!res || !res.found) { openOutside(url, true, res && res.near); return; }
    if (res.kind === "book" || res.kind === "shelf") { openBook(res); return; }
    if (res.pid && /^p\d+$/.test(res.pid) && res.collection === "scriptures" && !(currentDoc && currentDoc.id === res.doc_id && state.docId === res.doc_id)) { peekPassage(res); return; }
    hideNote();
    await openDoc(res.doc_id, res.pid);
    markListed(res);
  }
  // A link that lists verses (32.21,23-25) opens at the first with every one of them marked
  function markListed(res) {
    if (!res.pids || !currentDoc || currentDoc.id !== res.doc_id || state.docId !== res.doc_id) return;
    const body = $(".doc", readerPane);
    for (const pid of res.pids) {
      const v = body && (body.querySelector(`#${CSS.escape(pid)}`) || body.querySelector(`.verse:nth-of-type(${pid.slice(1)})`));
      if (v) v.classList.add("is-target");
    }
  }
  const TAB_OF = { "general-conference": "conference", scriptures: "scriptures", "preach-my-gospel": "preach-my-gospel", "missionary-standards": "missionary-standards", handbook: "handbook", "come-follow-me": "come-follow-me", manuals: "manuals", "study-helps": "study-helps" };
  function openBook(res) {
    hideNote();
    rememberScroll();
    const tab = TAB_OF[res.collection] || (res.collection.startsWith("jsp-") ? "jsp" : "manuals");
    const browse = res.kind === "shelf" ? { tab } : res.book_slug ? { tab, book: res.book_slug } : { tab, bookUri: res.book_uri };
    if (tab === "jsp") browse.series = res.collection.replace(/^jsp-/, "");
    leaveSearch(); state.q = ""; if (!wide()) { state.docId = null; state.pid = null; state.studyId = null; }
    if (TAB_SCOPE[tab]) state.scope = TAB_SCOPE[tab];
    syncControls(); state.browse = browse; renderHome(); showList(); push();
  }
  // ["p21","p23","p24","p25"] as it is written in a reference: 21, 23–25
  function verseList(pids) {
    const ns = pids.map((p) => Number(p.slice(1))), out = [];
    for (let i = 0; i < ns.length; i++) {
      let j = i;
      while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
      out.push(j > i ? `${ns[i]}–${ns[j]}` : String(ns[i]));
      i = j;
    }
    return out.join(", ");
  }
  // A verse someone linked to, read where you are; Open goes to the chapter.
  // When the verse takes the place of a footnote in the sheet, Back returns to the note (and the
  // next Back closes the sheet). The note is kept here. Back with the sheet up pops its marker
  // entry and the listener above closes it; this one puts the note back with a marker of its
  // own. Browsers differ on which of the two hears Back first, so it answers either way.
  let noteUnder = null;
  window.addEventListener("popstate", () => {
    const n = noteUnder; noteUnder = null;
    if (!n || n.url !== location.href || history.state?.overlay || sheet.getAttribute("aria-label") !== "Passage") return;
    if (!sheet.hidden && overlay === "sheet") { // heard first: the sheet stays up, and the other listener leaves this Back alone
      $(".sheet-body", sheet).replaceChildren(...n.nodes);
      sheet.setAttribute("aria-label", n.label);
      history.pushState({ ...(history.state || {}), overlay: "sheet" }, "", location.href);
      poppingOverlay = true;
    } else if (sheet.hidden && !overlay) { // heard second: the sheet has just been closed, and opens again on the note
      $(".sheet-body", sheet).replaceChildren(...n.nodes);
      openSheet(n.label);
    }
  }, true);
  async function peekPassage(res) {
    const bodyEl = $(".sheet-body", sheet);
    noteUnder = !sheet.hidden && sheet.getAttribute("aria-label") === "Footnote" ? { label: "Footnote", url: location.href, nodes: [...bodyEl.childNodes] } : null;
    bodyEl.replaceChildren(el("div", { class: "status", text: "Opening…" }));
    openSheet("Passage");
    let ctx = null;
    // a list of verses (21, 23-25) shows those and no others; a range shows the run
    const listed = res.pids && res.pids.length ? res.pids : null;
    const from = listed ? listed[0] : res.pid;
    const start = Number(from.slice(1)), end = listed ? Number(listed[listed.length - 1].slice(1)) : res.pid_end && /^p\d+$/.test(res.pid_end) ? Number(res.pid_end.slice(1)) : start;
    try { ctx = await api("context", { doc_id: res.doc_id, pid: from, before: 0, after: Math.max(0, Math.min(listed ? 40 : 12, end - start)) }); } catch (_) { ctx = null; }
    if (sheet.hidden) return;
    const open = async () => { noteUnder = null; hideNote(); await openDoc(res.doc_id, res.pid); markListed(res); };
    if (!ctx) { open(); return; }
    const verses = ctx.paragraphs.filter((x) => x.kind !== "heading" && (!listed || listed.includes(x.pid)));
    bodyEl.replaceChildren(
      el("div", { class: "nm", text: listed ? `${res.title}:${verseList(listed)}` : ctx.citation || res.title }),
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
  // A page the library does not hold. Nothing is opened from here: by the time the library has
  // answered, the tap is over (a tap inside a study's frame never reached this window at all),
  // and Safari, the home-screen app above all, quietly refuses a window opened after it. The
  // toast says the page is not here, names the site, and carries a real link: that tap opens it.
  // church: the address is on one of the sites the library copies, so it could have been held.
  const OFFLINE = "That page is not in the library, and you are offline.";
  // near: the book or conference the library does hold around a page it lacks; its contents are
  // offered beside the way out, and are all there is to offer offline.
  function openOutside(url, church = false, near = null) {
    let u = null;
    try { u = new URL(String(url || "")); } catch (_) { return; }
    if (!/^https?:$/.test(u.protocol)) return; // only a web address leaves the app (a study page could hand over anything)
    const contents = near && near.title ? { action: `Open ${near.title} contents`, onAction: () => openBook(near) } : null;
    if (!navigator.onLine) { toast(OFFLINE, contents || {}); return; }
    const host = u.hostname.replace(/^www\./, "");
    const say = (text, action) => toast(text, { action: contents ? "Open on the web" : action, href: u.href, more: contents ? [contents] : null });
    say(church ? "Not in your library." : "That link leaves the library.", `Open on ${host}`);
    // The link is simply offered: the page's policy lets it reach its own files and Claude and
    // nothing else, so it cannot ask the site first whether it is answering.
  }
  // The reader's own links to the source site are real links, which a tap opens with no help.
  // Offline they would open a dead tab, so the tap gets the message instead; the toast's link too.
  document.addEventListener("click", (e) => {
    if (navigator.onLine) return;
    const a = e.target.closest?.('a[target="_blank"][href^="http"]');
    if (!a || a.closest(".doc, .sheet-body")) return; // a link in the words of a page goes through followLink
    e.preventDefault(); e.stopPropagation();
    toast(OFFLINE);
  }, true);

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
    const nav = el("span", { class: "matchnav", role: "group", "aria-label": "Matches in this page" }, [label, el("button", { text: "↑", "aria-label": "Previous match", title: "Previous match", onclick: () => go(-1) }), el("button", { text: "↓", "aria-label": "Next match", title: "Next match", onclick: () => go(1) })]);
    $(".reader-bar .spacer", readerPane).before(nav);
    placeMatchNav();
  }
  // Where the match stepper sits: in the bar while the bar has room for it with its words, and
  // otherwise (always on a phone) in a slim strip of its own under the bar, so it never takes
  // the place of the chapter arrows or the lamp and is never a pair of arrows with no name.
  // Asked again when the window changes shape or something joins the bar.
  function placeMatchNav() {
    const bar = $(".reader-bar", readerPane), nav = $(".matchnav", readerPane);
    let strip = $(".match-strip", readerPane);
    if (!bar || !nav) { strip?.remove(); return; }
    const toStrip = () => {
      if (!strip) { strip = el("div", { class: "match-strip" }); bar.after(strip); }
      if (nav.parentElement !== strip) strip.append(nav);
      strip.style.top = bar.offsetHeight + "px"; // it holds its place under the bar as the page scrolls
    };
    if (wide()) {
      if (nav.parentElement !== bar) $(".spacer", bar)?.before(nav);
  window.addEventListener("resize", placeMatchNav);
      fitReaderBar(bar);
      if (bar.classList.contains("tight")) { toStrip(); fitReaderBar(bar); } else if (strip) { strip.remove(); strip = null; }
    } else toStrip();
  }

  function resize(delta) {
    const sizes = [15, 16, 17, 18, 19, 21, 23, 26, 30, 34];
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--reading-size")) || 17;
    let i = Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(cur) + delta));
    if (sizes.indexOf(cur) === -1) i = delta > 0 ? 3 : 1;
    document.documentElement.style.setProperty("--reading-size", sizes[i] + "px");
    store.set("readingSize", sizes[i]);
    fitReaderBars(); fitSelectBar(); measureBar(); // the bars' words grew or shrank with it: what folds away is worked out again
  }
  // The reader bar's text sizes: two buttons where there is room, one "Aa" that opens Smaller and
  // Larger where there is not (an iPad in portrait with the Hebrew and the Page | Deck switch). In
  // the narrowest case the menu also takes Present and the Church's site, so Back and the crumb keep theirs.
  function sizeTools(doc) {
    const glyph = (px) => `<span style='font-size:${px}px;font-weight:600'>A</span>`;
    const jsp = doc.collection && doc.collection.startsWith("jsp-");
    const menu = el("div", { class: "size-menu", role: "menu", hidden: true }, [
      el("button", { type: "button", role: "menuitem", onclick: () => resize(-1) }, [el("span", { class: "g", html: glyph(14) }), "Smaller text"]),
      el("button", { type: "button", role: "menuitem", onclick: () => resize(1) }, [el("span", { class: "g", html: glyph(20) }), "Larger text"]),
      el("button", { type: "button", role: "menuitem", class: "menu-extra", onclick: () => { shut(); btn.focus(); startPresenting(); } }, [el("span", { class: "g", html: ICON_PRESENT }), "Present"]), // the menu's button is what the stage gives the focus back to
      el("a", { role: "menuitem", class: "menu-extra", href: doc.source_url, target: "_blank", rel: "noopener", onclick: (e) => { shut(); outside(e, doc.source_url); } }, [el("span", { class: "g", html: ICON_OUT }), jsp ? "josephsmithpapers.org" : "churchofjesuschrist.org"]),
      el("button", { type: "button", role: "menuitem", class: "menu-think", onclick: () => { shut(); thinkHere(); } }, [el("span", { class: "g", html: ICON_THINK }), "Think it through"]),
      // the Hebrew or Greek switch (original.js puts it in the bar) when the bar has no room for it
      el("button", { type: "button", role: "menuitem", class: "menu-orig", onclick: (e) => { const ob = e.currentTarget.closest(".reader-bar")?.querySelector(".orig-btn"); shut(); ob?.click(); } }, [el("span", { class: "g", html: "<b></b>" }), el("span", { class: "orig-name", text: "" })]),
      jsp ? el("button", { type: "button", role: "menuitem", class: "menu-cite", onclick: () => { shut(); citePapers(doc); } }, [el("span", { class: "g", html: "<b>“”</b>" }), "Cite this page"]) : null,
    ].filter(Boolean));
    // "Aa" always, since the sizes are always in it; three dots beside it once Present and the rest have folded in
    const btn = el("button", { type: "button", class: "icon-btn size-pop-btn", "aria-label": "Text size and more", title: "Text size and more", "aria-haspopup": "menu", "aria-expanded": "false", onclick: (e) => { e.stopPropagation(); if (menu.hidden) openMenu(); else shut(); } }, [el("span", { class: "aa", text: "Aa" }), el("span", { class: "dots", html: ICON_MORE })]);
    const away = (e) => { if (!wrap.contains(e.target)) shut(); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); shut(); btn.focus(); } };
    function openMenu() {
      const ob = wrap.closest(".reader-bar")?.querySelector(".orig-btn"), item = menu.querySelector(".menu-orig");
      if (ob && item) { item.querySelector(".orig-name").textContent = ob.classList.contains("on") ? `Hide the ${ob.textContent}` : ob.textContent; item.querySelector(".g b").textContent = /Greek/.test(ob.textContent) ? "α" : "א"; }
      menu.hidden = false; btn.setAttribute("aria-expanded", "true"); document.addEventListener("pointerdown", away, true); menu.addEventListener("keydown", key); menu.querySelector("button")?.focus({ preventScroll: true }); }
    function shut() { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); document.removeEventListener("pointerdown", away, true); }
    const wrap = el("span", { class: "size-pop" }, [btn, menu]);
    return [
      el("span", { class: "size-btns" }, [
        el("button", { class: "icon-btn", "aria-label": "Smaller text", title: "Smaller text", onclick: () => resize(-1), html: glyph(14) }),
        el("button", { class: "icon-btn", "aria-label": "Larger text", title: "Larger text", onclick: () => resize(1), html: glyph(20) }),
      ]),
      wrap,
    ];
  }
  // How much of the bar folds away: none, the lamp's word, the sizes into Aa, then a tighter
  // switch, then Present and the site into the menu (its button
  // still says Aa, with dots beside it), then the lamp and Cite. After that an iPad and a phone
  // differ (app.css): beside a list the Hebrew or Greek switch goes with the lamp, then the
  // chapter arrows, then Back's label; on a phone Back's label goes first, then the Hebrew or
  // Greek switch, and only at the very last the chapter arrows. Measured with nothing allowed to shrink
  // and the crumb at a readable minimum, so it is the real need and not what flexbox squeezed to fit.
  const BAR_LEVELS = ["nowords", "compact", "tight", "tighter", "tightest", "bare", "noorig", "barest"];
  function fitReaderBar(bar) {
    bar.classList.toggle("has-orig", !!bar.querySelector(".orig-btn")); // the menu offers the Hebrew or Greek only where the bar has the switch to fold
    if (!bar.querySelector(".size-pop")) return;
    bar.classList.remove(...BAR_LEVELS);
    if (bar.offsetParent === null) return;
    for (const level of BAR_LEVELS) {
      bar.classList.add("measuring");
      const over = overflows(bar);
      bar.classList.remove("measuring");
      if (!over) return;
      bar.classList.add(level);
    }
  }
  // Does a bar's row run past its own padding? Measured where its last piece ends: scrollWidth
  // leaves the end padding out once there is overflow, and forgave a bar that was 8px too full.
  function overflows(bar) {
    const edge = bar.getBoundingClientRect().right - (parseFloat(getComputedStyle(bar).paddingRight) || 0);
    let right = -Infinity;
    for (const c of bar.children) { const r = c.getBoundingClientRect(); if (r.width > 0) right = Math.max(right, r.right); }
    return right > edge + 0.5;
  }
  function fitReaderBars() { for (const bar of document.querySelectorAll(".reader-bar")) fitReaderBar(bar); }
  window.addEventListener("resize", fitReaderBars);
  // what joins the bar after it is drawn (the match count, the Hebrew button, the switch) refits it
  // (and a page drawn over a selection takes its bar with it: the pane's classes follow)
  const barWatch = new MutationObserver((all) => {
    // the match stepper moving between the bar and its strip is this code's own doing, not news
    const own = (n) => n.classList?.contains("matchnav") || n.classList?.contains("match-strip");
    const records = all.filter((r) => ![...r.addedNodes, ...r.removedNodes].every(own));
    if (!records.length) return;
    if (records.some((r) => r.target === readerPane)) syncPanes();
    const bars = new Set(records.map((r) => r.target.closest?.(".reader-bar")).filter(Boolean));
    for (const bar of bars) fitReaderBar(bar);
    if (bars.size && $(".matchnav", readerPane)) placeMatchNav();
  });
  barWatch.observe(readerPane, { childList: true, subtree: true });
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
  const stageKicker = el("div", { class: "stage-kicker", hidden: true, text: "Question" });
  // each slide said as it comes: its citation and its place in the run (the words on the stage
  // are there to be read by touch; a change of slide was silent)
  const stageSay = el("div", { class: "vh stage-say", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  stage.append(stageKicker, stageSay);

  function presentUnits(doc) {
    const scratch = el("div", {}, [sanitize(doc.body_html || "")]); // the same cleaning renderDoc gives the page
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
  // An iPad mirrored to a projector shows the room whatever the controls show: this hides the
  // timer and the "Next:" line until it is pressed again, and the choice is remembered.
  const speakerBtn = el("button", { type: "button", class: "stage-speaker", "aria-label": "Show the timer and the Next line", "aria-pressed": "true", title: "Timer and Next line: shown (hide them when the screen is mirrored)" });
  speakerBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2M10 3h4"/><path class="slash" d="M4 4l16 16"/></svg>`;
  function setSpeakerLines(on) {
    stage.classList.toggle("no-speaker", !on);
    speakerBtn.setAttribute("aria-pressed", String(on));
    speakerBtn.title = on ? "Timer and Next line: shown (hide them when the screen is mirrored)" : "Timer and Next line: hidden (tap to show them)";
  }
  speakerBtn.addEventListener("click", () => { const on = stage.classList.contains("no-speaker"); setSpeakerLines(on); store.set("stageSpeaker", on); wakeControls(); });
  stageTimer.after(speakerBtn);
  setSpeakerLines(store.get("stageSpeaker", true));
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
    // A sheet still up goes first, so its inert set (which holds the stage) is undone before the
    // stage makes its own; its marker entry becomes the stage's, so one Back closes the stage.
    if (overlay === "sheet") { hideNote(); overlay = "stage"; history.replaceState({ ...(history.state || {}), overlay: "stage" }, "", location.href); }
    else if (!sheet.hidden) hideNote();
    openOverlay("stage");
    resetStageClock();
    stageOpener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
    document.body.classList.add("presenting");
    wakeControls();
    stage.classList.toggle("themed", !!next.theme);
    for (const k of ["bg", "fg", "accent", "muted"]) stage.style.setProperty(`--stage-${k}`, next.theme?.[k] || "");
    stage.hidden = false;
    inertBehind(stage, true);
    renderStage();
    stage.tabIndex = -1;
    try { stage.focus({ preventScroll: true }); } catch (_) {}
    // Both of these are answered a moment later. If the stage has closed by then (Escape within
    // half a second), the screen would stay full with nothing on it and the lock would never be
    // let go: each is undone on arrival unless a stage is still up to use it.
    const mine = show;
    if (stage.requestFullscreen && !document.fullscreenElement) stage.requestFullscreen().then(() => { if (!show && document.fullscreenElement === stage) document.exitFullscreen?.().catch(() => {}); }).catch(() => {});
    try { navigator.wakeLock?.request("screen").then((l) => { if (show === mine) show.lock = l; else l.release?.()?.catch?.(() => {}); }).catch(() => {}); } catch (_) {}
  }

  function stopPresenting() {
    if (!show) return;
    const atPid = show.doc ? show.units[show.i]?.pid : null;
    show.lock?.release?.();
    show = null;
    clearInterval(stageClock); stageClock = null;
    stage.hidden = true;
    inertBehind(stage, false); // Escape, Close, Back and leaving full screen all come through here
    stage.classList.remove("blank");
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
    // What goes on the stage is cleaned as renderDoc cleans the page: a deck card or an Ask passage is HTML too.
    $(".stage-text", stage).replaceChildren(sanitize(u.kind === "verse" ? u.html.replace(/<span class="verse-number">[^<]*<\/span>/, "") : u.html, { drawing: u.kind === "map" }));
    // A question wears a small kicker and a rule, as its PowerPoint slide does, so it never reads as a title.
    stageKicker.hidden = u.kind !== "question";
    $(".stage-ref", stage).textContent = where;
    $(".stage-count", stage).textContent = `${show.i + 1} / ${show.units.length}`;
    $(".stage-prev", stage).disabled = show.i === 0;
    $(".stage-next", stage).disabled = show.i === show.units.length - 1;
    const after = show.units[show.i + 1];
    const peek = after ? firstWords(after) : "";
    $(".stage-upnext", stage).textContent = peek ? `Next: ${peek}` : "";
    stageSay.textContent = `${where || firstWords(u, 8) || "Slide"}, ${show.i + 1} of ${show.units.length}`;
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
      bodyEl.replaceChildren(...[n.marker ? el("div", { class: "nm", text: `Note ${n.marker}` }) : null, el("div", {}, [sanitize(n.html || esc(n.text))])].filter(Boolean));
    }
    openSheet("Footnote");
  }
  let sheetOpener = null;
  function openSheet(label) {
    sheet.setAttribute("aria-label", label);
    const wasHidden = sheet.hidden;
    sheet.hidden = false;
    document.body.classList.toggle("sheet-page", sheet.classList.contains("page")); // Settings dims the page behind it (app.css)
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
      const href = a.getAttribute("href") || "";
      const u = linkUrl(href, currentDoc && currentDoc.source_url);
      if (u && /^(mailto|tel|sms):$/.test(u.protocol)) return; // the tap itself opens Mail or the phone
      e.preventDefault();
      if (href.startsWith("#")) { closeSheet(); focusParagraph(href.slice(1)); return; }
      if (u) followLink(u.href);
    };
  }
  // hideNote takes the sheet down and leaves history alone: for the moment before a move, whose
  // push() takes over the marker. closeSheet is the user closing it: the marker is popped as well.
  let sheetSlid = false; // the grabber has already slid it away
  function hideNote() {
    const wasOpen = !sheet.hidden;
    // It leaves by the 200ms slide it came by. The sheet itself is hidden at once, so everything
    // that asks whether one is open has its answer; what slides away is a copy that nothing can
    // touch, gone when its animation ends. Not under reduced motion.
    if (wasOpen && !sheetSlid && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const ghost = sheet.cloneNode(true);
      ghost.removeAttribute("id");
      for (const n of ghost.querySelectorAll("[id]")) n.removeAttribute("id");
      const typed = sheet.querySelectorAll("textarea");
      ghost.querySelectorAll("textarea").forEach((t, i) => { t.value = typed[i]?.value || ""; });
      ghost.classList.add("leaving"); ghost.setAttribute("aria-hidden", "true"); ghost.inert = true;
      const top = sheet.scrollTop;
      document.body.append(ghost);
      ghost.scrollTop = top;
      const gone = () => ghost.remove();
      ghost.addEventListener("animationend", gone);
      setTimeout(gone, 320);
    }
    sheetSlid = false;
    sheet.hidden = true; $("#scrim")?.remove();
    sheet.classList.remove("page");
    document.body.classList.remove("sheet-page");
    inertBehind(sheet, false); // before the focus goes back to what opened it
    sheetKeep = null;
    const vv = window.visualViewport;
    if (vv) { vv.removeEventListener("resize", liftSheet); vv.removeEventListener("scroll", liftSheet); }
    sheet.style.bottom = ""; sheet.style.maxHeight = "";
    if (wasOpen && sheetOpener && sheetOpener.isConnected) { try { sheetOpener.focus({ preventScroll: true }); } catch (_) {} }
    sheetOpener = null;
  }
  function closeSheet() { const had = overlay === "sheet"; noteUnder = null; hideNote(); if (had) dropOverlay("sheet"); }
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
      const list = [...document.body.children].filter((n) => n !== node && !n.contains(node) && !n.inert && n.id !== "scrim" && n.id !== "toast" && n.id !== "say" && n.id !== "selSay" && n.tagName !== "SCRIPT");
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
  // The grabber is real: drag it down and the sheet follows the finger; let go past a third of
  // its height (or with a flick) and it goes, as Back or Escape would send it; less, and it
  // settles back. A note half typed is kept, as everywhere.
  (() => {
    const grab = $(".handle", sheet);
    let from = null;
    grab.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      from = { y: e.clientY, t: e.timeStamp, dy: 0 };
      sheet.classList.add("dragging");
      try { grab.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    });
    grab.addEventListener("pointermove", (e) => {
      if (!from) return;
      from.dy = Math.max(0, e.clientY - from.y);
      sheet.style.transform = `translateY(${from.dy}px)`;
    });
    const end = (e) => {
      if (!from) return;
      const { dy, t } = from; from = null;
      sheet.classList.remove("dragging");
      const fast = dy > 24 && dy / Math.max(1, e.timeStamp - t) > 0.6;
      if (e.type === "pointerup" && (dy > sheet.offsetHeight / 3 || fast) && !keepTyped()) {
        const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
        sheet.style.transform = "translateY(100%)";
        setTimeout(() => { sheet.style.transform = ""; if (!sheet.hidden) { sheetSlid = true; closeSheet(); } }, still ? 0 : 180);
      } else sheet.style.transform = "";
    };
    grab.addEventListener("pointerup", end);
    grab.addEventListener("pointercancel", end);
  })();

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
    rememberSearch(state.q);
    runSearch({ typeahead: false });
  });
  $(".clear").addEventListener("click", () => { if (!state.ready) return; input.value = ""; state.q = ""; input.focus(); runSearch(); });
  for (const b of document.querySelectorAll(".scopes button")) {
    b.addEventListener("click", () => { if (!state.ready) return; state.scope = b.dataset.scope; syncControls(); runSearch({ typeahead: false }); });
  }
  $("#filterBtn").addEventListener("click", () => { filters.hidden = !filters.hidden; mainEl.classList.toggle("filters-open", !filters.hidden); $("#filterBtn").setAttribute("aria-expanded", String(!filters.hidden)); });
  for (const b of document.querySelectorAll("#tabs .tab[data-tab]")) b.addEventListener("click", () => switchTab(b.dataset.tab));
  $("#settingsBtn").addEventListener("click", () => { if (state.ready) openSettings(); });
  function focusBox() { try { input.focus({ preventScroll: true }); input.select(); } catch (_) {} }
  // The search box from the keyboard ("/", Cmd+F): where it is not on the screen (the Deck, Ask,
  // a page on a phone) Search comes up first.
  function focusSearch() {
    if (input.offsetParent !== null) focusBox(); else switchTab("search").then(focusBox);
  }
  // The Library's search field: a tap on it is a step into Search, with the cursor in the box
  // and the shelf you were in as the place to search.
  input.addEventListener("click", () => {
    if (!state.ready || tabNow() === "search") return;
    rememberScroll();
    state.browse = { tab: "search" };
    syncControls(); renderHome(); showList(); push(); setEntry({ place: "search" });
    focusBox();
  });

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
    if (e.key === "Escape") {
      if (!sheet.hidden) { if (!keepTyped()) closeSheet(); }
      else if (typing) a.blur();
      else if (!readerPane.hidden && readerPane.querySelector(".doc .sel")) { const f = $(".doc .sel", readerPane); clearSelection(); focusUnit(f); } // the verses picked are let go, as Clear does
      return;
    }
    // With a keyboard attached: Cmd+F or Cmd+K is the search box, Cmd+[ is Back (Ctrl on other keyboards)
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && state.ready) {
      const k = e.key.toLowerCase();
      if ((k === "f" || k === "k") && sheet.hidden) { e.preventDefault(); focusSearch(); return; }
      if (k === "[") { e.preventDefault(); goBack(); return; }
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    // Left and Right turn the chapter, when the page is what is in front and nothing with arrows of its own has the focus
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.shiftKey && sheet.hidden && currentDoc && state.docId === currentDoc.id && !readerPane.hidden
      && !(e.target.closest && e.target.closest("[role='menu'], .board, .dsheet, #panel"))) {
      const to = e.key === "ArrowLeft" ? currentDoc.prev : currentDoc.next;
      if (to) { e.preventDefault(); stepChapter(to); }
      return;
    }
    if (e.key === "/" && state.ready && sheet.hidden) { e.preventDefault(); focusSearch(); }
    if (e.key === "?" && state.ready && sheet.hidden) { e.preventDefault(); openShortcuts(); }
    if ((e.key === "p" || e.key === "P") && currentDoc && !readerPane.hidden) { e.preventDefault(); startPresenting(); }
  });

  const ICON_THINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2V17h5v-1.2c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/></svg>';
  const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_PRESENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
  const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

  // The app's own files come from the service worker's cache, as one set (sw.js). A newer set
  // installs behind the page; once all of it is in, a quiet notice offers it, and Reload hands
  // over to it. Left alone it waits, and takes over when the app next starts from cold.
  // HTTPS only; a test turns it on over http on this machine with gospel.sw in localStorage.
  function watchShell() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && !(window.isSecureContext && store.get("sw") === true)) return;
    const sw = navigator.serviceWorker;
    const hadController = !!sw.controller;
    let reloading = false;
    sw.addEventListener("controllerchange", () => {
      if (reloading) { location.reload(); return; }
      // another tab took the new version: this one is still running the old files
      if (hadController) shellNotice(null);
    });
    sw.register(new URL("sw.js", BASE)).then((reg) => {
      const offer = (w) => { if (w && sw.controller) shellNotice(w); }; // a first install has nothing to replace
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (w) w.addEventListener("statechange", () => { if (w.state === "installed") offer(w); });
      });
      // a home-screen app can stay open for days: look for a new version when it comes back
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
    function shellNotice(waiting) {
      if ($(".banner.shell-update")) return;
      const banner = el("div", { class: "banner shell-update", role: "status" }, [
        el("span", { text: "A new version is ready." }),
        el("button", { class: "text-btn", type: "button", text: "Reload", onclick: async () => {
          try { await window.Deck?.flush(); } catch (_) {} // the deck's last edit is in the database before the page goes
          if (!waiting || waiting.state !== "installed") { location.reload(); return; }
          reloading = true;
          waiting.postMessage({ type: "take-over" });
          setTimeout(() => location.reload(), 4000); // in case the hand-over is never announced
        } }),
        el("button", { class: "icon-btn", type: "button", "aria-label": "Later", text: "×", onclick: () => banner.remove() }),
      ]);
      $("header.bar").after(banner);
    }
  }
  watchShell();

  // Search by meaning: the model (35 MB, once) and the paragraphs' vectors load
  // quietly after the library is open; until then search goes by words alone.
  let semState = null;
  const MEANING_ON = "finds passages by meaning as well as by their words";
  async function semanticNote() {
    try { semState = await api("semanticStatus", {}); } catch (_) { return ""; }
    return semState.available && semState.ready ? MEANING_ON : "";
  }
  async function loadSemantic() {
    try { semState = await api("semanticStatus", {}); } catch (_) { return; }
    if (!semState.available || (semState.ready && semState.loaded)) return; // model and index both in place
    // the home screen's footer line shows the download, then that meaning search is on
    const note = (text) => {
      const f = $("#homeStatus"); if (!f) return;
      const base = f.textContent.replace(/ · (finds passages by meaning[^·]*|downloading what search by meaning needs[^·]*|getting search by meaning ready…)$/, "");
      f.textContent = text ? `${base} · ${text}` : base;
    };
    try {
      await call("loadSemantic", { base: new URL("./", BASE).href }, (p) => {
        if (p.phase === "model" && p.total) note(`downloading what search by meaning needs (${mb(p.loaded)} of ${mb(p.total)}, once)…`);
        else if (p.phase === "index") note("getting search by meaning ready…");
      });
      semState = await api("semanticStatus", {});
      note(semState.ready ? MEANING_ON : "");
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
  let paneView = "page", unseen = false, pageWasOpen = false;
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
    syncPanes();
    // one Back on the screen: with a pane up on the right its bar has it, so the list's own goes
    document.body.classList.toggle("pane-up", !readerPane.hidden || !panelPane.hidden);
    // with a page open the header is the search box alone: the scope strip comes back with the list (app.css)
    if (document.body.classList.toggle("page-open", !readerPane.hidden) !== pageWasOpen) { pageWasOpen = !pageWasOpen; measureBar(); }
    for (const s of document.querySelectorAll(".head-back")) s.replaceChildren(headBack());
    refreshSwitches();
  }
  // The board's bar with no Back to offer and no switch has nothing in it, and goes (app.css)
  function syncPanelBar() {
    const bar = panelPane.querySelector(":scope > .reader-bar");
    if (bar) bar.classList.toggle("idle", !!bar.querySelector(":scope > .trail-back.none") && !bar.querySelector(".pane-switch"));
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
    // what Back brings back depends on which pane is up: its label is redrawn when that changes it
    for (const b of document.querySelectorAll(".reader-bar .trail-back")) if (b.querySelector(".lb")?.textContent !== (backLabel() || "Library")) b.replaceWith(trailButton());
    syncPanelBar();
    fitReaderBars(); // a pane just shown, or a switch come or gone, changes what the bar needs
    fitSelectBar();
  }

  function searchFor(q) {
    rememberScroll();
    state.q = q; state.offset = 0;
    if (!wide()) { state.docId = null; state.pid = null; }
    syncControls(); showList(); runSearch({ typeahead: false });
  }
  window.GL = {
    api, el, esc, store, openDoc, startPresentingUnits, toast, panel, search: searchFor, openSheet, hideSheet: hideNote, closeSheet, openSettings,
    openOverlay, dropOverlay, inertBehind, // deck.js: its link mode, label editor and sheets are overlay markers, so Back leaves them
    get ready() { return state.ready; },
    get skills() { return store.get("skills")?.data || null; },
    get wide() { return wide(); },
    get reading() { return currentDoc ? { doc: currentDoc, open: state.docId === currentDoc.id, selection: state.docId === currentDoc.id ? selectedUnits() : [] } : null; }, // for Ask: the page open (or read last) and what is selected in it
  };

  // ------------------------------------------------------------- start ----
  (async () => {
    // the app puts each place back where it was scrolled (render's restore); the browser's own attempt
    // comes later on an iPhone and lands at the top
    try { history.scrollRestoration = "manual"; } catch (_) {}
    // a reload under a sheet or the stage: nothing is open now, so its marker entry is dropped and
    // the place under it is where the app starts (the first Back then leaves it, as it should)
    if (history.state?.overlay) {
      await new Promise((done) => { const t = setTimeout(done, 800); window.addEventListener("popstate", () => { clearTimeout(t); done(); }, { once: true }); history.back(); });
      if (history.state?.overlay) history.replaceState({ ...history.state, overlay: null }, "", location.href);
    }
    readUrl();
    if (!history.state || !Number.isInteger(history.state.n)) history.replaceState({ n: 0, label: null, prev: null }, "", location.href);
    syncControls();
    const ok = await ensureLibrary();
    if (!ok) return;
    state.ready = true;
    try { navigator.storage?.persist?.().catch(() => {}); } catch (_) {} // 150 MB that should not be evicted
    api("speakers", {}).then((rows) => { const dl = $("#speakerList"); for (const r of rows) dl.append(el("option", { value: r.name })); }).catch(() => {});
    await render();
    setTimeout(checkForUpdate, 1500);
    setTimeout(loadSkills, 400);
    setTimeout(loadSemantic, 2500);
  })();
})();
