// A second page beside the one being read, on an iPad: "Open beside" in the passage sheet puts
// that chapter in a pane of its own to the right of the reader (under it in portrait), with a
// divider to drag between them. The pane is a reading copy: it shows the page and the reader's
// highlights and notes, and marks nothing itself; Swap brings its page to the reader in one tap.
// "Split" in the reader's bar opens the pane with a picker in place of a page: a reference or
// words, the places read lately, and the shelves.
//
// This file keeps to itself on purpose. The reader (openDoc, renderDoc, placePanes) knows nothing
// of it: the pane is a section made on demand at the end of <main>, laid out by one body class
// (app.css, "the second pane"), and it is outside the app's history. app.js gives it three
// things: the button in the passage sheet, a call once the library is open (the saved pair comes
// back), and its sanitizer. The Split button is put in the reader's bar from here, by watching
// the reader for a new bar, so the reader's own code has no line for it. Only flexbox, pointer events, matchMedia and storage are used.
import { chapterOf } from "./lib/cite.js";
import { wordSpans, locate, paint, unitText, wrapWords, unwrapPhrases } from "./lib/phrase.js";

(() => {
  "use strict";
  const GL = window.GL;
  if (!GL) return;
  const { el, api } = GL;

  const UNIT_SEL = "p.verse, .body-block p[id], .body-block li[id]"; // as the reader has it
  const SITE = "https://www.churchofjesuschrist.org/";
  const STOPS = [[1 / 3, "One third"], [1 / 2, "Half"], [2 / 3, "Two thirds"]];
  const CLOSE_PX = 80;  // the divider let go this near the pane's own edge closes the pane
  const I = {
    split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.4"/><path d="M12 5v14"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/></svg>',
    swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h14M14 4l4 4-4 4"/><path d="M20 16H6M10 12l-4 4 4 4"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.4"/><path d="M15 12H7.5M10.5 9l-3 3 3 3"/></svg>',
    find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>',
    note: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/></svg>',
  };

  const wide = () => GL.wide;
  const stacked = () => window.matchMedia("(orientation: portrait)").matches; // top and bottom, where side by side would be two thin columns
  const main = document.querySelector("main");
  const mainPane = () => [document.querySelector("#reader"), document.querySelector("#panel"), document.querySelector("#list")].find((n) => n && !n.hidden && n.offsetParent !== null) || null;
  const nameOf = (doc) => (doc.collection === "scriptures" && doc.citation ? chapterOf(doc.citation) : doc.title) || "This page";

  // ---- what is open ----------------------------------------------------------
  let pane = null, bar = null, hint = null, under = null, scroller = null, divider = null, track = null, menu = null;
  let cur = null;       // { doc, body } of the page in the pane
  let ratio = 0.5;      // the reader's share of the width (the height in portrait)
  let trail = [];       // where the pane was before a link or a jump: { id, pid, off }
  let stepping = false; // the last move was an arrow: a run of chapters is one step back
  let seq = 0, paintSeq = 0;
  let listKey = null;   // which list the hidden column holds; when it changes the pane gives way
  let pick = null;      // the picker's own element, made once
  let picking = false;  // the picker is up: in place of a page, or over the one that is there
  let level = [];       // how far into the shelves the picker has gone
  let pickSeq = 0;
  let origOn = false;   // the Hebrew or Greek tiles show under this pane's Bible chapters
  const up = () => !!(cur || picking); // the pane is in the layout

  const saved = () => GL.store.get("beside");
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    if (!cur) return;
    const at = topUnit(scroller, cur.body, 0);
    GL.store.set("beside", { id: cur.doc.id, url: cur.doc.source_url || null, title: nameOf(cur.doc), pid: at ? at.pid : null, off: at ? at.off : 0, ratio, orig: origOn });
  }
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(save, 300); };

  // The paragraph at the top of a scroller, and how far its top is from the scroller's (under
  // any bar that sticks there): a place that holds when the pane changes width.
  function topUnit(sc, body, under) {
    if (!sc || !body) return null;
    const top = sc.getBoundingClientRect().top + under;
    for (const u of body.querySelectorAll(UNIT_SEL)) {
      const r = u.getBoundingClientRect();
      if (r.bottom > top + 1) return u.id ? { pid: u.id, off: Math.round(r.top - top) } : null;
    }
    return null;
  }

  // ---- the pane, made the first time it is asked for ---------------------------
  function build() {
    if (pane) return;
    bar = el("div", { class: "bs-bar" });
    hint = el("div", { class: "bs-hint", role: "status", hidden: true, text: "Reading copy. Swap to mark this side." });
    scroller = el("div", { class: "bs-scroll" });
    under = el("div", { class: "bs-under" }, [scroller]); // the chapter list drops over the page from here
    pane = el("section", { id: "beside", class: "bs-pane", "aria-label": "The page beside" }, [bar, hint, under]);
    divider = el("div", { class: "bs-div" }, [el("span", { class: "bs-grip" }), el("span", { class: "bs-grab", role: "separator", tabindex: "0", "aria-label": "Divider between the two pages. Drag to resize, double-tap to even out." })]);
    track = el("div", { class: "bs-track", hidden: true });
    scroller.addEventListener("scroll", saveSoon, { passive: true });
    scroller.addEventListener("click", onBodyClick);
    // Left and Right with the focus in this pane turn its chapter, and never reach the reader's own keys
    pane.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu) { e.stopPropagation(); shutMenu(true); return; }
      if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.stopPropagation();
      if (e.target.closest(".bs-menu") || !cur) return;
      const to = e.key === "ArrowLeft" ? cur.doc.prev : cur.doc.next;
      if (to) { e.preventDefault(); step(to); }
    });
    wireDivider();
  }

  function drawBar() {
    if (!cur) {
      // no page yet: the picker is all there is, and the bar says what it is for
      bar.replaceChildren(el("div", { class: "bs-title bs-title-plain" }, [el("span", { text: "Open a second page" })]), el("div", { class: "bs-spacer" }),
        el("button", { type: "button", class: "bs-close", "aria-label": "Close the second pane", title: "Close this side", html: I.close, onclick: () => close() }));
      return;
    }
    const doc = cur.doc;
    const back = trail.length ? el("button", { type: "button", class: "bs-back", "aria-label": `Back to ${trail[trail.length - 1].title || "the page before"}`, title: "Back in this pane", html: I.prev, onclick: goBack }) : null;
    const title = el("button", { type: "button", class: "bs-title", "aria-haspopup": "true", "aria-expanded": "false", "aria-label": `${nameOf(doc)}. Choose another chapter or page for this side`, onclick: toggleMenu }, [el("span", { text: nameOf(doc) }), el("span", { class: "bs-caret", html: I.down })]);
    const arrow = (to, word, icon) => el("button", { type: "button", class: "bs-chap", disabled: !to, "aria-label": to ? `${word}: ${to.title}` : word, title: to ? to.title : word, html: icon, onclick: () => step(to) });
    bar.replaceChildren(...[
      back, title,
      doc.prev || doc.next ? el("span", { class: "bs-nav", role: "group", "aria-label": "Previous and next, this side" }, [arrow(doc.prev, "Previous", I.prev), arrow(doc.next, "Next", I.next)]) : null,
      el("div", { class: "bs-spacer" }),
      el("button", { type: "button", class: "bs-swap", title: "Swap the two pages", "aria-label": "Swap: bring this page to the reader", onclick: swap }, [el("span", { class: "g", html: I.swap }), el("span", { class: "w", text: "Swap" })]),
      el("button", { type: "button", class: "bs-close", "aria-label": `Close ${nameOf(doc)}`, title: "Close this side", html: I.close, onclick: () => close() }),
    ].filter(Boolean));
  }

  // ---- showing a page --------------------------------------------------------
  // how: "push" keeps the place left for this pane's Back, "step" is an arrow (a run of them is
  // one step back), "back" and "fresh" keep nothing.
  async function show(id, { pid = null, off = null, how = "fresh" } = {}) {
    build();
    const my = ++seq;
    shutMenu();
    const from = cur ? { id: cur.doc.id, title: nameOf(cur.doc), ...(topUnit(scroller, cur.body, 0) || { pid: null, off: 0 }) } : null;
    let doc = null;
    try { doc = await api("doc", { id }); } catch (_) { doc = null; }
    if (my !== seq) return false;
    if (!doc) {
      if (!up()) { unmount(); GL.store.set("beside", null); }
      GL.toast("That page is not in the library.");
      return false;
    }
    if (how === "push" && from) trail.push(from);
    else if (how === "step" && from && !stepping) trail.push(from);
    else if (how === "fresh") trail = [];
    stepping = how === "step";
    // the same cleaning the reader gives a page: nothing from the library is put in unsanitized
    const body = el("article", { class: "doc" }, [GL.sanitize(doc.body_html || "")]);
    cur = { doc, body };
    if (picking) shutPicker();
    remember(doc);
    drawBar();
    hint.hidden = true;
    scroller.replaceChildren(body);
    scroller.scrollTop = 0;
    mount();
    place(pid, off);
    paintMarks();
    save();
    if (origOn) tilesIn(doc, body, pid, off);
    return true;
  }
  // The Hebrew or Greek under this pane's verses (original.js draws them; the reader's own
  // switch is left as it is). The tiles push the verses down, so the place is found again.
  const langOf = (doc) => (doc && window.Original && window.Original.tiles && window.Original.isBible(doc) ? (doc.volume === "Old Testament" ? "Hebrew" : "Greek") : null);
  async function tilesIn(doc, body, pid, off) {
    if (!langOf(doc)) return;
    try { await window.Original.tiles(doc, body); } catch (err) { window.GLLog?.note("beside.tiles", err); return; }
    if (cur && cur.body === body && pid) place(pid, off);
  }
  function setOrig(on) {
    origOn = on;
    if (!cur) return;
    const at = topUnit(scroller, cur.body, 0);
    if (on) tilesIn(cur.doc, cur.body, at ? at.pid : null, at ? at.off : null);
    else {
      cur.body.classList.remove("with-orig");
      for (const n of cur.body.querySelectorAll(".orig, .orig-credit")) n.remove();
      if (at) place(at.pid, at.off);
    }
    save();
  }
  // The verse asked for, a little under the bar (and marked, when it was named by a link); or
  // the saved place, to the pixel.
  function place(pid, off) {
    if (!cur || !pid) return;
    const body = cur.body;
    let target = body.querySelector(`#${CSS.escape(pid)}`);
    if (!target && /^p\d+$/.test(pid)) target = body.querySelector(`.verse:nth-of-type(${pid.slice(1)})`);
    if (!target) return;
    if (off === null) { for (const t of body.querySelectorAll(".is-target")) t.classList.remove("is-target"); target.classList.add("is-target"); }
    const first = body.querySelector(UNIT_SEL);
    if (off === null && target === first) return; // the first verse: the chapter from its heading
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (off === null ? 14 : off);
  }
  function step(to) { if (to) show(to.id, { how: "step" }); }
  function goBack() {
    const b = trail.pop();
    if (b) show(b.id, { pid: b.pid, off: b.off, how: "back" });
  }

  // ---- the reader's marks, read-only -------------------------------------------
  async function paintMarks() {
    if (!cur || !window.Marks || !cur.doc.uri) return;
    const { doc, body } = cur;
    const my = ++paintSeq;
    let marks = [], phrases = [];
    try {
      marks = await window.Marks.forDoc(doc.uri);
      phrases = window.Marks.phrases ? await window.Marks.phrases(doc.uri) : [];
    } catch (_) { return; }
    if (my !== paintSeq || !cur || cur.body !== body) return;
    const colors = (window.Marks.COLORS || []).map((c) => `hl-${c}`);
    for (const u of body.querySelectorAll(UNIT_SEL)) {
      u.classList.remove("hl", "noted", "note-range", "note-range-start", "note-range-end", ...colors);
      if (u.querySelector("mark.hlp")) { try { unwrapPhrases(u); } catch (_) {} }
    }
    for (const n of body.querySelectorAll(".note-mark")) n.remove();
    const units = [...body.querySelectorAll(UNIT_SEL)];
    for (const m of marks) {
      const unit = body.querySelector(`#${CSS.escape(m.pid)}`);
      if (!unit) continue;
      if (m.color) unit.classList.add("hl", `hl-${m.color}`);
      if (!m.note) continue;
      unit.classList.add("noted");
      unit.append(el("button", { type: "button", class: "note-mark", "aria-label": `Note: ${m.note.slice(0, 80)}`, html: I.note, onclick: (e) => { e.preventDefault(); e.stopPropagation(); readNote(m); } }));
      const a = units.indexOf(unit), b = m.pid_end ? units.findIndex((n) => n.id === m.pid_end) : -1;
      if (b > a) {
        for (const n of units.slice(a, b + 1)) n.classList.add("note-range");
        unit.classList.add("note-range-start"); units[b].classList.add("note-range-end");
      }
    }
    const byPid = new Map();
    for (const m of phrases) { if (!byPid.has(m.pid)) byPid.set(m.pid, []); byPid.get(m.pid).push(m); }
    for (const [pid, list] of byPid) {
      const unit = body.querySelector(`#${CSS.escape(pid)}`);
      if (!unit) continue;
      try {
        const { text } = unitText(unit);
        const spans = wordSpans(text);
        const here = [];
        for (const m of list) { const at = locate(text, spans, m); if (at) here.push({ id: m.id, start: at.start, end: at.end, color: m.color, updated: m.updated }); }
        for (const r of paint(here)) wrapWords(unit, r.start, r.end, `hlp hl-${r.color}`, {});
      } catch (err) { window.GLLog?.note("beside.phrases", err); }
    }
  }
  // a note is read here in the app's own sheet; it is written from the reader
  function readNote(m) {
    const bodyEl = document.querySelector("#sheet .sheet-body");
    if (!bodyEl) return;
    bodyEl.replaceChildren(
      el("div", { class: "nm", text: `Note on ${m.citation || nameOf(cur.doc)}` }),
      el("p", { class: "bs-note", text: m.note }),
      el("p", { class: "note-passage", text: "Swap to bring this page to the reader, where the note can be changed." }),
    );
    GL.openSheet("Note");
  }
  window.addEventListener("marks:change", () => { if (cur) paintMarks(); });

  // ---- taps in the page ------------------------------------------------------
  function linkUrl(href) {
    try { return new URL(String(href || "").trim().replace(/^gospellibrary:\/\/content\//i, SITE + "study/"), (cur && cur.doc.source_url) || SITE); } catch (_) { return null; }
  }
  async function onBodyClick(e) {
    if (!cur) return;
    const a = e.target.closest("a");
    if (!a) {
      // a verse is not selected on this side yet; the first tap of a session says so, once
      if (e.target.closest(UNIT_SEL) && !e.target.closest(".note-mark")) sayHint();
      return;
    }
    const href = a.getAttribute("href") || "";
    if (a.classList.contains("study-note-ref") || /^#note/.test(href) || a.dataset.scrollId) {
      e.preventDefault();
      showNote(a.dataset.scrollId || href.split("#").pop());
      return;
    }
    if (href.startsWith("#")) {
      e.preventDefault();
      const t = cur.body.querySelector(`#${CSS.escape(href.slice(1))}`);
      if (t) scroller.scrollTop += t.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 14;
      return;
    }
    const u = href.trim() ? linkUrl(href) : null;
    if (!u || !/^https?:$/.test(u.protocol)) return; // mail and phone links are the device's
    e.preventDefault();
    // a page the library holds opens here, in this pane; anything else leaves the way every
    // link does (the app's own toast, or the book's contents)
    let res = null;
    try { res = await api("resolve", { href: u.href }); } catch (_) { res = null; }
    if (res && res.found && res.doc_id && res.kind !== "book" && res.kind !== "shelf") {
      if (cur && res.doc_id === cur.doc.id) { place(res.pid, null); return; }
      show(res.doc_id, { pid: res.pid || null, how: "push" });
      return;
    }
    GL.followLink(u.href);
  }
  function showNote(noteId) {
    const n = (cur.doc.footnotes || []).find((x) => x.note_id === noteId) || null;
    const bodyEl = document.querySelector("#sheet .sheet-body");
    if (!n || !bodyEl) return;
    bodyEl.replaceChildren(...[n.marker ? el("div", { class: "nm", text: `Note ${n.marker}` }) : null, el("div", {}, [GL.sanitize(n.html || GL.esc(n.text))])].filter(Boolean));
    GL.openSheet("Footnote");
  }
  let hintTimer = null;
  function sayHint() {
    try { if (sessionStorage.getItem("gospel.besideHint")) return; sessionStorage.setItem("gospel.besideHint", "1"); } catch (_) { if (sayHint.said) return; sayHint.said = true; }
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { if (hint) hint.hidden = true; }, 7000);
  }

  // ---- the chapters of this book, under the title --------------------------------
  function shutMenu(refocus) {
    if (!menu) return;
    menu.remove(); menu = null;
    const t = bar.querySelector(".bs-title");
    if (t) { t.setAttribute("aria-expanded", "false"); if (refocus) try { t.focus({ preventScroll: true }); } catch (_) {} }
  }
  async function toggleMenu() {
    if (menu) { shutMenu(); return; }
    const doc = cur.doc, my = seq;
    // what this side can do comes first, then the chapters of the book it is in
    const act = (icon, text, fn) => el("button", { type: "button", class: "bs-act", onclick: () => { shutMenu(); fn(); } }, [el("span", { class: "g", html: icon }), text]);
    const lang = langOf(doc);
    const acts = el("div", { class: "bs-acts" }, [
      act(I.find, "Open something else", openPicker),
      // this page in the reader, by the app's own open (so Back returns from it); the pane stays
      act(I.out, "Open in the main page", () => { const at = topUnit(scroller, cur.body, 0); GL.openDoc(cur.doc.id, at ? at.pid : null); }),
      lang ? act(`<b>${lang === "Greek" ? "α" : "א"}</b>`, cur.body.classList.contains("with-orig") ? `Hide the ${lang} here` : `Show the ${lang} here`, () => setOrig(!cur.body.classList.contains("with-orig"))) : null,
    ]);
    const can = doc.collection === "scriptures" ? !!doc.book_slug : !!(doc.book && doc.book.uri);
    const box = el("div", { class: "bs-menu", role: "dialog", "aria-label": "This side: open something else, or another chapter" }, [acts, can ? el("div", { class: "status", text: "Opening…" }) : null]);
    menu = box;
    under.append(box);
    bar.querySelector(".bs-title")?.setAttribute("aria-expanded", "true");
    const jump = (id) => { shutMenu(); if (id !== cur.doc.id) show(id, { how: "push" }); };
    if (!can) return;
    try {
      if (doc.collection === "scriptures") {
        const shelf = await api("scriptures");
        const bk = shelf.volumes.flatMap((v) => v.books).find((x) => x.slug === doc.book_slug);
        if (my !== seq || menu !== box) return;
        const grid = el("div", { class: "chapters" });
        for (const c of bk.chapters) grid.append(el("button", { type: "button", class: c.doc_id === doc.id ? "on" : "", text: String(c.n), disabled: !c.doc_id, "aria-label": `${bk.name} ${c.n}`, "aria-current": c.doc_id === doc.id ? "true" : null, onclick: () => jump(c.doc_id) }));
        box.replaceChildren(acts, el("div", { class: "bs-menu-h", text: bk.name.replace("JST, ", "") }), grid);
      } else {
        const book = await api("book", { uri: doc.book.uri });
        if (my !== seq || menu !== box) return;
        const rows = (book.nodes || []).map((n) => n.kind === "section"
          ? el("div", { class: "toc-row section" }, [el("div", { class: "t", text: n.title })])
          : el("button", { type: "button", class: "toc-row" + (n.depth > 1 ? " sub" : "") + (n.doc_id === doc.id ? " on" : ""), disabled: !n.doc_id, onclick: () => n.doc_id && jump(n.doc_id) }, [el("div", { class: "t", text: n.title })]));
        box.replaceChildren(acts, el("div", { class: "bs-menu-h", text: book.title }), ...rows);
      }
      box.querySelector(".on")?.scrollIntoView({ block: "center" });
    } catch (_) { if (menu === box) box.replaceChildren(acts, el("div", { class: "status error", text: "The chapters could not be listed." })); }
  }
  document.addEventListener("pointerdown", (e) => { if (menu && !e.target.closest?.(".bs-menu, .bs-title")) shutMenu(); }, true);

  // ---- in and out of the layout ------------------------------------------------
  const keyNow = () => {
    const h = location.hash.replace(/^#/, ""), qi = h.indexOf("?");
    const p = new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : "");
    for (const k of ["doc", "p", "s"]) p.delete(k);
    return (qi >= 0 ? h.slice(0, qi) : h) + "?" + p.toString();
  };
  let poll = null;
  function mount() {
    if (pane.isConnected) return;
    main.append(divider, pane, track);
    document.body.classList.add("beside-open");
    pressSplit();
    listKey = keyNow();
    applyRatio();
    poll = setInterval(watchList, 500);
    refit();
  }
  function unmount() {
    clearInterval(poll); poll = null;
    clearTimeout(saveTimer); clearTimeout(hintTimer);
    shutMenu();
    if (pane) { pane.remove(); divider.remove(); track.remove(); track.hidden = true; }
    document.body.classList.remove("beside-open", "bs-dragging");
    main.style.removeProperty("--bs-a"); main.style.removeProperty("--bs-b");
    cur = null; trail = []; stepping = false; seq++;
    picking = false; pickSeq++; if (pick) pick.remove();
    pressSplit();
    refit();
  }
  // Closing is one tap and forgets the pair. When the pane went without being asked to (a tab
  // of the rail, the divider run to the edge), the toast offers it back.
  function close({ offer = false } = {}) {
    if (!up()) return;
    save();
    const was = saved();
    unmount();
    GL.store.set("beside", null);
    if (offer && was) GL.toast(`${was.title} closed.`, { action: "Open beside again", onAction: () => { ratio = STOPS.some(([s]) => s === was.ratio) ? was.ratio : 0.5; show(was.id, { pid: was.pid, off: was.off }); } });
  }
  // The reader's bar, its selection bar and a study's frame are fitted to their pane on a resize;
  // the pane coming, going or changing width is one, so the app is told the way a rotation tells it.
  let refitting = false;
  function refit() {
    requestAnimationFrame(() => {
      fold();
      refitting = true;
      try { window.dispatchEvent(new Event("resize")); } finally { refitting = false; }
    });
  }
  // under a third of an iPad the bar keeps the title, the arrows, Swap as its sign alone, and close
  function fold() { if (pane && pane.isConnected) pane.classList.toggle("narrow", pane.clientWidth < 430); }
  window.addEventListener("resize", () => { if (refitting || !up()) return; fold(); track.hidden = true; });

  // The list's column is hidden while two pages share the width. Whatever asks for the list
  // (a tab of the rail, the title of the reader's page, Think, a book's contents) changes the
  // address in something other than the page; the pane then gives way, so the list is never
  // asked for and not shown. While no page is open at all the list is showing, and may change.
  function watchList() {
    if (!up()) return;
    const k = keyNow();
    if (k === listKey) return;
    listKey = k;
    if (wide() && !document.body.classList.contains("list-only")) close({ offer: true });
  }
  document.addEventListener("click", () => { if (up()) { setTimeout(watchList, 0); setTimeout(watchList, 250); } }, true);
  window.addEventListener("popstate", () => { if (up()) setTimeout(watchList, 0); });
  document.querySelector("#tabs")?.addEventListener("click", (e) => {
    if (up() && wide() && e.target.closest(".tab[data-tab]")) setTimeout(() => { if (up() && !document.body.classList.contains("list-only")) close({ offer: true }); }, 0);
  });

  // ---- Swap ------------------------------------------------------------------
  // The page here goes to the reader by the app's own open (so it is in the trail, and Back
  // returns), and the reader's page comes here. With no page in the reader this one simply moves.
  async function swap() {
    if (!cur) return;
    const r = GL.reading;
    const reader = document.querySelector("#reader");
    const theirs = r && r.open && reader && !reader.hidden ? { id: r.doc.id, ...(topUnit(reader, reader.querySelector(".doc"), reader.querySelector(".reader-bar")?.offsetHeight || 0) || { pid: null }) } : null;
    const mine = { id: cur.doc.id, ...(topUnit(scroller, cur.body, 0) || { pid: null }) };
    if (!theirs) { close(); await GL.openDoc(mine.id, mine.pid); return; }
    seq++; // a page still on its way into this pane is dropped
    await GL.openDoc(mine.id, mine.pid);
    await show(theirs.id, { pid: theirs.pid, off: theirs.pid ? Math.max(0, theirs.off || 0) : null });
    try { bar.querySelector(".bs-swap")?.focus({ preventScroll: true }); } catch (_) {}
  }

  // ---- the divider -----------------------------------------------------------
  function applyRatio() {
    main.style.setProperty("--bs-a", String(Math.round(ratio * 1000)));
    main.style.setProperty("--bs-b", String(Math.round((1 - ratio) * 1000)));
  }
  const nearest = (r) => STOPS.reduce((best, s) => (Math.abs(s[0] - r) < Math.abs(best[0] - r) ? s : best));
  function drawTrack(r, closing) {
    const at = nearest(r)[0];
    const side = stacked() ? "top" : "left";
    track.className = "bs-track" + (stacked() ? " stack" : "");
    track.replaceChildren(
      ...STOPS.map(([s, name]) => el("span", { class: "bs-stop" + (!closing && s === at ? " at" : ""), style: `${side}:${(s * 100).toFixed(3)}%` }, [el("i"), el("b", { text: name })])),
      el("span", { class: "bs-stop end" + (closing ? " at" : ""), style: `${side}:${stacked() ? 96 : 93}%` }, [el("b", { text: cur ? `Close ${nameOf(cur.doc)}` : "Close this side" })]),
    );
    track.hidden = false;
  }
  function wireDivider() {
    const grab = divider.querySelector(".bs-grab");
    let drag = null, lastTap = 0, frame = 0;
    const read = (e) => {
      const box = main.getBoundingClientRect();
      const first = mainPane();
      const start = first ? (stacked() ? first.getBoundingClientRect().top : first.getBoundingClientRect().left) : (stacked() ? box.top : box.left);
      const size = (stacked() ? box.bottom : box.right) - start;
      const at = (stacked() ? e.clientY : e.clientX) - start;
      // neither page is squeezed under a readable column while the finger travels on to the edge
      const least = Math.min(0.3, 260 / size);
      return { r: Math.max(least, Math.min(1 - least, at / size)), closing: size - at < CLOSE_PX };
    };
    grab.addEventListener("pointerdown", (e) => {
      if (e.button > 0 || !up()) return;
      e.preventDefault(); // no text selection begins under the finger
      try { grab.setPointerCapture(e.pointerId); } catch (_) {}
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, r: ratio, closing: false };
    });
    grab.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved) {
        if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 6) return;
        drag.moved = true;
        divider.classList.add("live");
        document.body.classList.add("bs-dragging");
      }
      const now = read(e);
      drag.r = now.r; drag.closing = now.closing;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!drag || !drag.moved) return;
        ratio = drag.r; applyRatio(); fold();
        drawTrack(drag.r, drag.closing);
      });
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      divider.classList.remove("live");
      document.body.classList.remove("bs-dragging");
      track.hidden = true;
      if (!d.moved) {
        // two taps even the panes out
        if (e.type === "pointerup" && e.timeStamp - lastTap < 400) { lastTap = 0; setRatio(0.5); } else lastTap = e.timeStamp;
        return;
      }
      if (e.type === "pointerup" && d.closing) { ratio = saved()?.ratio || 0.5; close({ offer: true }); return; }
      setRatio(e.type === "pointerup" ? nearest(d.r)[0] : saved()?.ratio || 0.5);
    };
    grab.addEventListener("pointerup", end);
    grab.addEventListener("pointercancel", end);
    grab.addEventListener("dblclick", (e) => { e.preventDefault(); setRatio(0.5); }); // a mouse on a desk
    // a keyboard: the arrows move between the stops, Enter evens out
    grab.addEventListener("keydown", (e) => {
      const i = STOPS.findIndex(([s]) => s === nearest(ratio)[0]);
      const less = e.key === "ArrowLeft" || e.key === "ArrowUp", more = e.key === "ArrowRight" || e.key === "ArrowDown";
      if (!less && !more && e.key !== "Enter") return;
      e.preventDefault(); e.stopPropagation();
      setRatio(e.key === "Enter" ? 0.5 : STOPS[Math.max(0, Math.min(STOPS.length - 1, i + (more ? 1 : -1)))][0]);
    });
  }
  function setRatio(r) {
    ratio = r;
    applyRatio();
    save();
    refit();
  }

  // ---- the places read lately ---------------------------------------------------
  // The app keeps one place for Continue, and its trail lasts only as long as the tab. So a
  // short list is kept here: each page as it opens, in the reader or in this pane.
  const whereOf = (doc) => (doc.collection === "scriptures" ? doc.volume : doc.book && doc.book.title) || "";
  const recents = () => { const r = GL.store.get("besideRecent", []); return Array.isArray(r) ? r : []; };
  function remember(doc) {
    if (!doc || !doc.id) return;
    const was = recents();
    if (was[0] && was[0].id === doc.id) return;
    const item = { id: doc.id, url: doc.source_url || null, title: nameOf(doc), where: whereOf(doc) };
    GL.store.set("besideRecent", [item, ...was.filter((x) => x.id !== item.id && (!item.url || x.url !== item.url))].slice(0, 9));
  }
  // A library rebuilt since may have numbered its pages afresh: the page is found by its address.
  async function sure(item) {
    try {
      const doc = await api("doc", { id: item.id });
      if (!item.url || (doc && doc.source_url === item.url)) return doc ? item.id : null;
      const res = await api("resolve", { href: item.url });
      return res && res.found && res.doc_id ? res.doc_id : null;
    } catch (_) { return null; }
  }

  // ---- the picker: what to open on this side -------------------------------------
  // Split opens the pane with this in place of a page. It is one scrolling column inside the
  // pane: a level of it at a time, each row one tap, a chevron at the top to go back up.
  function openPicker() {
    if (!can()) return false;
    build();
    shutMenu();
    if (!cur) { ratio = 0.5; origOn = false; }
    if (!pick) pick = el("div", { class: "bs-pick" });
    picking = true; level = [];
    under.append(pick);
    if (!cur) drawBar();
    mount();
    drawPick();
    return true;
  }
  function shutPicker() {
    picking = false; pickSeq++;
    if (pick) pick.remove();
  }
  const choose = (id, pid = null) => { if (id) show(id, { pid, how: cur ? "push" : "fresh" }); };
  const rowBtn = (t, s, fn, more) => el("button", { type: "button", class: "bs-row", onclick: fn }, [el("span", { class: "t", text: t }), s ? el("span", { class: "s", text: s }) : null, more ? el("span", { class: "go", html: I.next }) : null]);
  const into = (lv) => { level.push(lv); drawPick(); };
  // A level of the shelves: the Scriptures' books, a book's chapters, a shelf's books, a book's
  // contents, through the calls the Library makes.
  async function drawPick() {
    const my = ++pickSeq;
    const at = level[level.length - 1] || null;
    if (!at) { drawPickHome(my); return; }
    const body = el("div", {}, [el("div", { class: "status", text: "Opening…" })]);
    pick.replaceChildren(
      el("button", { type: "button", class: "bs-up", onclick: () => { level.pop(); drawPick(); } }, [el("span", { class: "g", html: I.prev }), level.length > 1 ? level[level.length - 2].title : "All shelves"]),
      el("h2", { class: "bs-pick-h", text: at.title }), body);
    pick.scrollTop = 0;
    let out = [];
    try {
      if (at.kind === "scriptures") {
        for (const vol of (await api("scriptures")).volumes) {
          const chips = el("div", { class: "shelf" });
          for (const bk of vol.books) { const name = bk.name.replace("JST, ", ""); chips.append(el("button", { type: "button", class: "chip", text: name, onclick: () => into({ kind: "chapters", slug: bk.slug, title: name }) })); }
          out.push(el("h3", { class: "bs-sub", text: vol.name }), chips);
        }
      } else if (at.kind === "chapters") {
        const bk = (await api("scriptures")).volumes.flatMap((v) => v.books).find((x) => x.slug === at.slug);
        const grid = el("div", { class: "chapters" });
        for (const c of bk.chapters) grid.append(el("button", { type: "button", text: String(c.n), disabled: !c.doc_id, "aria-label": `${bk.name} ${c.n}`, onclick: () => choose(c.doc_id) }));
        out.push(grid);
      } else if (at.kind === "shelf") {
        const books = (await api("browse", { collection: at.slug })).books.filter((x) => x.docs > 0);
        // a shelf of one book is that book's contents
        if (books.length === 1) { if (my === pickSeq) { level[level.length - 1] = { kind: "book", uri: books[0].uri, title: at.title }; drawPick(); } return; }
        for (const bk of books) out.push(rowBtn(bk.title, `${bk.docs} ${bk.docs === 1 ? "page" : "pages"}`, () => into({ kind: "book", uri: bk.uri, title: bk.title }), true));
        if (!books.length) out.push(el("div", { class: "status", text: "Nothing on this shelf yet." }));
      } else {
        const book = await api("book", { uri: at.uri });
        for (const n of book.nodes || []) out.push(n.kind === "section" ? el("h3", { class: "bs-sub", text: n.title })
          : el("button", { type: "button", class: "bs-row" + (n.depth > 1 ? " sub" : ""), disabled: !n.doc_id, onclick: () => choose(n.doc_id) }, [el("span", { class: "t", text: n.title }), n.subtitle ? el("span", { class: "s", text: n.subtitle }) : null]));
      }
    } catch (_) { out = [el("div", { class: "status error", text: "That could not be listed." })]; }
    if (my === pickSeq && picking) body.replaceChildren(...out);
  }
  // The first level: the box, then (until something is typed) this chapter in its own language,
  // the places read lately and the shelves.
  async function drawPickHome(my) {
    const input = el("input", { type: "search", class: "bs-q", placeholder: "A reference or words, e.g. Hebrews 11", "aria-label": "Open beside: a reference or words", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false", enterkeyhint: "search" });
    const found = el("div", { class: "bs-found", hidden: true });
    const home = el("div", { class: "bs-home" });
    pick.replaceChildren(...[
      cur ? el("button", { type: "button", class: "bs-up", onclick: shutPicker }, [el("span", { class: "g", html: I.prev }), `Back to ${nameOf(cur.doc)}`]) : null,
      el("div", { class: "bs-qrow" }, [el("span", { class: "g", html: I.find }), input]), found, home,
    ].filter(Boolean));
    pick.scrollTop = 0;
    // The box asks the engine what the app's search asks it: a reference gives the card that
    // jumps there, words give the first few passages. Return opens a reference outright.
    let timer = null, qSeq = 0, jump = null;
    async function run(full) {
      const q = input.value.trim(), mine = ++qSeq;
      jump = null;
      if (!q) { found.hidden = true; home.hidden = false; return; }
      let data = null;
      try { data = await api("search", { q, typeahead: !full, light: true, limit: 6 }); } catch (_) { data = null; }
      if (mine !== qSeq || !input.isConnected) return;
      const rows = [];
      const j = data && data.jump;
      if (j) {
        if (j.doc_id) jump = j;
        rows.push(el("button", { type: "button", class: "bs-jump", disabled: !j.doc_id, onclick: () => choose(j.doc_id, j.pid || null) }, [el("b", { text: j.label }), el("span", { text: j.doc_id ? "Open beside" : "Not in the library yet" })]));
      }
      for (const h of ((data && data.hits) || []).slice(0, 5)) {
        if (!h.doc_id) continue;
        rows.push(el("button", { type: "button", class: "bs-hit", onclick: () => choose(h.doc_id, h.pid || null) }, [el("div", { class: "cite", text: h.citation || h.title || "" }), el("div", { class: "snip" }, [GL.sanitize(h.snippet || GL.esc(h.text || ""))])]));
      }
      for (const d of ((data && data.titles) || []).slice(0, 4)) if (d.doc_id) rows.push(rowBtn(d.title, d.label || d.author || "", () => choose(d.doc_id)));
      if (!rows.length) rows.push(el("div", { class: "status", text: data ? "Nothing found. Try a reference such as Alma 32:21, or fewer words." : "The search could not be run." }));
      found.replaceChildren(...rows);
      found.hidden = false; home.hidden = true;
    }
    input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(false), 220); });
    input.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault(); e.stopPropagation();
      clearTimeout(timer);
      await run(true);
      if (jump && input.isConnected) { try { input.blur(); } catch (_) {} choose(jump.doc_id, jump.pid || null); }
    });
    // this chapter in its own language, when the reader has a Bible chapter open
    const rd = GL.reading, lang = rd && rd.open ? langOf(rd.doc) : null;
    const slot = el("div");
    home.append(slot);
    if (lang) window.Original.check().then((ok) => {
      if (!ok || my !== pickSeq) return;
      const main = document.querySelector("#reader");
      slot.append(el("button", { type: "button", class: "bs-row bs-lang", onclick: () => { const at = topUnit(main, main.querySelector(".doc"), main.querySelector(".reader-bar")?.offsetHeight || 0); origOn = true; choose(rd.doc.id, at ? at.pid : null); } }, [
        el("span", { class: "g", html: `<b>${lang === "Greek" ? "α" : "א"}</b>` }), el("span", { class: "t", text: `This chapter in ${lang}` }), el("span", { class: "s", text: nameOf(rd.doc) })]));
    }).catch(() => {});
    // the places read lately, the page in the reader left out: it is already on the screen
    const r = GL.reading, here = r && r.open ? r.doc.id : null;
    let list = recents();
    const last = GL.store.get("lastRead");
    if (!list.length && last && last.id) list = [{ id: last.id, url: null, title: last.title, where: last.where || "" }];
    list = list.filter((x) => x.id !== here).slice(0, 8);
    if (list.length) {
      home.append(el("h3", { class: "bs-sub", text: "Recent" }));
      for (const item of list) home.append(rowBtn(item.title, item.where, async () => { const id = await sure(item); if (id) choose(id); else GL.toast("That page is not in the library."); }));
    }
    // the shelves that hold something
    const lib = el("div");
    home.append(lib);
    try {
      const shelves = (await api("browse", {})).collections.filter((c) => c.docs > 0);
      if (my !== pickSeq) return;
      if (shelves.length) lib.append(el("h3", { class: "bs-sub", text: "Library" }));
      for (const c of shelves) lib.append(rowBtn(c.title, c.slug === "scriptures" ? "" : `${c.docs} ${c.docs === 1 ? "page" : "pages"}`, () => into(c.slug === "scriptures" ? { kind: "scriptures", title: "Scriptures" } : { kind: "shelf", slug: c.slug, title: c.title }), true));
    } catch (_) {}
  }

  // ---- Split, in the reader's bar ------------------------------------------------
  // The reader draws a new bar with every page. Each one is given the button as it appears
  // (before the text sizes, or at the end of a study's bar); the app's own watch of the bar
  // then refits it. On a phone the button is there and not shown (app.css).
  const readerEl = document.querySelector("#reader");
  function splitButton() {
    return el("span", { class: "bs-split-wrap" }, [el("button", { type: "button", class: "icon-btn bs-split", "aria-pressed": String(up()), "aria-label": "Split: a second page beside this one", title: "Read two pages side by side", onclick: () => { if (up()) close(); else openPicker(); } }, [el("span", { class: "g", html: I.split }), el("span", { class: "w", text: "Split" })])]);
  }
  function pressSplit() { for (const b of document.querySelectorAll(".bs-split")) b.setAttribute("aria-pressed", String(up())); }
  function onReader() {
    const r = GL.reading;
    if (r && r.open) remember(r.doc);
    const rb = [...readerEl.children].find((n) => n.classList.contains("reader-bar"));
    if (!rb || rb.querySelector(".bs-split")) return;
    const before = rb.querySelector(".size-btns") || rb.querySelector(".pane-switch-slot");
    if (before && before.parentNode === rb) before.before(splitButton()); else rb.append(splitButton());
  }
  if (readerEl) {
    try { new MutationObserver(onReader).observe(readerEl, { childList: true }); } catch (_) {}
    onReader();
  }

  // ---- the way in --------------------------------------------------------------
  const can = () => wide();
  // For the passage sheet's row of buttons: "Open beside", on an iPad
  function button(res) {
    if (!can() || !res || !res.doc_id) return null;
    return el("button", { type: "button", class: "beside-btn", onclick: () => { GL.closeSheet(); open(res.doc_id, res.pid || null); } }, [el("span", { class: "g", html: I.split }), "Open beside"]);
  }
  // For the reference card in the search results: "Open beside" under it, on an iPad
  function jumpButton(j) {
    if (!can() || !j || !j.doc_id) return null;
    return el("button", { type: "button", class: "beside-btn bs-jump-beside", "aria-label": `Open ${j.label || "this"} beside`, onclick: () => open(j.doc_id, j.pid || null) }, [el("span", { class: "g", html: I.split }), "Open beside"]);
  }
  async function open(id, pid = null) {
    if (!can()) return false;
    if (!cur) { ratio = 0.5; origOn = false; }
    return show(id, { pid, how: cur ? "push" : "fresh" });
  }
  // The pair that was open when the app was last used comes back: the page, its place, the widths.
  // A library rebuilt since may have numbered its pages afresh, so the page is found by its address.
  async function restore() {
    const s = saved();
    if (!s || !s.id || up() || !can()) return false;
    ratio = STOPS.some(([x]) => x === s.ratio) ? s.ratio : 0.5;
    origOn = !!s.orig;
    let id = s.id;
    try {
      const doc = await api("doc", { id });
      if (s.url && (!doc || doc.source_url !== s.url)) { const res = await api("resolve", { href: s.url }); id = res && res.found && res.doc_id ? res.doc_id : null; }
    } catch (_) { id = null; }
    if (!id || up()) { if (!id) GL.store.set("beside", null); return false; }
    return show(id, { pid: s.pid, off: s.pid ? s.off || 0 : null });
  }
  // the place is kept as the app goes to the back, where a timer may never fire
  window.addEventListener("pagehide", () => { if (cur) save(); });
  document.addEventListener("visibilitychange", () => { if (cur && document.visibilityState === "hidden") save(); });

  window.Beside = { can, button, jumpButton, open, restore, close: () => close(), swap, pick: () => openPicker(), get isOpen() { return up(); }, get doc() { return cur ? cur.doc : null; } };
})();
