/* Gospel Library — personal edition. Plain JavaScript, no build step.
   The library lives on this device; engine.js (a Web Worker) holds it and
   answers searches. This file is the interface. */
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
  const wide = () => window.matchMedia("(min-width: 900px)").matches;
  const monthName = (m) => (m === 4 ? "April" : m === 10 ? "October" : "");
  const mb = (n) => `${(n / 1048576).toFixed(n > 50 * 1048576 ? 0 : 1)} MB`;
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

  // ------------------------------------------------------------- state ----
  const state = {
    q: "", scope: "all", speaker: "", from: "", to: "", book: "", group: "passages",
    docId: null, pid: null, terms: [], offset: 0, lastSearch: null, view: "home", browse: null, ready: false,
  };
  let searchSeq = 0;
  let typeTimer = null;

  const listPane = $("#list");
  const readerPane = $("#reader");
  const input = $("#q");
  const filters = $("#filters");
  const mainEl = $("main");

  // ----------------------------------------------------------- routing ----
  // Hash routes so the app works from any static host:  #q=faith&scope=conference   #read/123?q=faith#p21
  function urlFor() {
    const p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.scope !== "all") p.set("scope", state.scope);
    for (const k of ["speaker", "from", "to", "book"]) if (state[k]) p.set(k, state[k]);
    if (state.group !== "passages") p.set("group", state.group);
    if (state.pid) p.set("p", state.pid);
    const qs = p.toString();
    if (state.docId) return `#read/${state.docId}${qs ? "?" + qs : ""}`;
    return qs ? `#search?${qs}` : "#";
  }
  function push(replace = false) {
    const url = urlFor();
    if (location.hash === url || (url === "#" && !location.hash)) return;
    if (replace) history.replaceState(null, "", url); else history.pushState(null, "", url);
  }
  function readUrl() {
    const h = location.hash.replace(/^#/, "");
    const m = h.match(/^read\/(\d+)(?:\?(.*))?$/);
    const qs = m ? (m[2] || "") : h.replace(/^search\??/, "");
    const p = new URLSearchParams(qs);
    state.q = p.get("q") || "";
    state.scope = p.get("scope") || "all";
    state.speaker = p.get("speaker") || "";
    state.from = p.get("from") || "";
    state.to = p.get("to") || "";
    state.book = p.get("book") || "";
    state.group = p.get("group") || "passages";
    state.docId = m ? Number(m[1]) : null;
    state.pid = p.get("p") || null;
  }
  window.addEventListener("popstate", () => { if (!state.ready) return; readUrl(); syncControls(); render(); });

  function syncControls() {
    input.value = state.q;
    for (const b of document.querySelectorAll(".scopes button")) b.classList.toggle("on", b.dataset.scope === state.scope);
    $("#fSpeaker").value = state.speaker;
    $("#fFrom").value = state.from;
    $("#fTo").value = state.to;
    $("#fBook").value = state.book;
    for (const b of document.querySelectorAll("#fGroup button")) b.classList.toggle("on", b.dataset.group === state.group);
    const active = !!(state.speaker || state.from || state.to || state.book || state.group !== "passages");
    $("#filterBtn").classList.toggle("on", active);
  }

  // ------------------------------------------------------------ render ----
  async function render() {
    if (state.q.trim().length >= 2) await runSearch({ typeahead: false, silent: true });
    else { state.lastSearch = null; await renderHome(); }
    if (state.docId) await openDoc(state.docId, state.pid, { push: false });
    else showList();
  }
  function showList() {
    listPane.hidden = false;
    readerPane.hidden = wide() ? !(state.docId || (panel.lastEl && readerPane.contains(panel.lastEl))) : true;
  }
  function showReader() {
    listPane.hidden = !wide();
    readerPane.hidden = false;
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------- setup ----
  // The library is downloaded once per device and unlocked with the passphrase.
  async function ensureLibrary() {
    const active = store.get("active");
    let status;
    try { status = await call("open", { slot: active?.slot }); }
    catch (err) { showFatal(`The library engine could not start: ${err.message}`); return false; }
    if (status.hasLibrary) {
      store.set("active", { slot: status.slot, version: status.version, builtAt: status.builtAt, mode: status.mode });
      return true;
    }
    return new Promise((resolve) => renderSetup(status, resolve));
  }

  async function renderSetup(status, done) {
    readerPane.hidden = true;
    listPane.hidden = false;
    document.body.classList.add("setup");
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
    if (status.mode !== "opfs") {
      note.textContent = "This browser cannot keep the library between visits, so it downloads each time you open the app. Adding it to the home screen fixes that on iPhone and iPad.";
    }
    let manifest = null;
    try {
      manifest = await call("manifest", { manifestUrl: MANIFEST_URL });
      const built = new Date(manifest.built_at);
      lede.textContent = `${manifest.verses.toLocaleString()} verses, ${manifest.talks.toLocaleString()} talks, ${manifest.documents.toLocaleString()} pages in all, built ${built.toLocaleDateString([], { month: "long", day: "numeric" })}. One download of ${mb(manifest.bundle_size)}, then everything works on this device, offline too.`;
    } catch (err) {
      lede.textContent = "The library file is not published yet. Once the nightly job has run on GitHub, reload this page.";
      btn.disabled = true;
    }
    const saved = store.get("passphrase");
    if (saved) pass.value = saved;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!pass.value) { pass.focus(); return; }
      btn.disabled = true; pass.disabled = true; msg.textContent = ""; bar.hidden = false;
      const fill = $(".fill", bar);
      try {
        const result = await call("install", { passphrase: pass.value, manifestUrl: MANIFEST_URL, slot: "/library-a.sqlite" }, (p) => {
          const pct = p.total ? Math.min(100, Math.round((p.loaded / p.total) * 100)) : 0;
          fill.style.width = pct + "%";
          msg.textContent = p.phase === "download" ? `Downloading… ${mb(p.loaded)} of ${mb(p.total)}` : `Unpacking… ${pct}%`;
        });
        store.set("passphrase", pass.value);
        store.set("active", { slot: result.slot, version: result.version, builtAt: result.builtAt, mode: result.mode });
        document.body.classList.remove("setup");
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
    listPane.replaceChildren(el("div", { class: "setup" }, [el("h1", { text: "Something is wrong" }), el("p", { class: "lede", text })]));
  }

  // A newer library on the server? Offer it; install into the other slot, then switch.
  async function checkForUpdate() {
    if (!navigator.onLine) return;
    const active = store.get("active");
    let manifest;
    try { manifest = await call("manifest", { manifestUrl: MANIFEST_URL }); } catch (_) { return; }
    if (!active || manifest.version === active.version) return;
    const banner = el("div", { class: "banner" }, [
      el("span", { text: `A newer library is available (built ${new Date(manifest.built_at).toLocaleDateString([], { month: "short", day: "numeric" })}, ${mb(manifest.bundle_size)}).` }),
      el("button", { class: "text-btn", text: "Update now", onclick: () => updateNow(banner, manifest) }),
      el("button", { class: "icon-btn", "aria-label": "Later", text: "×", onclick: () => banner.remove() }),
    ]);
    $("header.bar").after(banner);
  }
  async function updateNow(banner, manifest) {
    const active = store.get("active");
    const passphrase = store.get("passphrase");
    const slot = active?.slot === "/library-a.sqlite" ? "/library-b.sqlite" : "/library-a.sqlite";
    const label = $("span", banner);
    for (const b of banner.querySelectorAll("button")) b.disabled = true;
    try {
      const result = await call("install", { passphrase, manifestUrl: MANIFEST_URL, slot }, (p) => {
        const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
        label.textContent = p.phase === "download" ? `Downloading the new library… ${pct}%` : `Unpacking… ${pct}%`;
      });
      store.set("active", { slot: result.slot, version: result.version, builtAt: result.builtAt, mode: result.mode });
      if (active?.slot && active.slot !== result.slot) call("forget", { slot: active.slot }).catch(() => {});
      banner.remove();
      currentDoc = null;
      render();
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

  async function runSearch({ typeahead = false, silent = false, more = false } = {}) {
    const q = state.q.trim();
    if (q.length < 2) { state.lastSearch = null; renderHome(); if (!silent) push(true); return; }
    if (!more) state.offset = 0;
    const mySeq = ++searchSeq;
    try {
      const data = await api("search", {
        q, scope: state.scope, typeahead, limit: 40, offset: state.offset,
        speaker: state.speaker, from: state.from, to: state.to, book: state.book, group: state.group,
      });
      if (mySeq !== searchSeq) return;
      if (more && state.lastSearch) {
        data.hits = state.lastSearch.hits.concat(data.hits);
        data.documents = state.lastSearch.documents.concat(data.documents);
        data.titles = state.lastSearch.titles;
        data.jump = state.lastSearch.jump;
      }
      state.lastSearch = data;
      state.terms = termsFrom(q);
      renderResults(data);
      if (!silent) push(true);
      if (!typeahead && !more && data.smart && window.Ask?.hasKey() && navigator.onLine) widenWithClaude(q, data, mySeq);
    } catch (e) {
      listPane.replaceChildren(el("div", { class: "status error", text: `Search failed: ${e.message}` }));
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
        const r = await api("search", { q: pq.q, scope: pq.scope && pq.scope !== "all" ? pq.scope : state.scope, limit: 10, speaker: state.speaker, from: state.from, to: state.to, book: state.book });
        r.hits.forEach((h, rank) => { if (!have.has(h.paragraph_id)) { const prev = extra.get(h.paragraph_id); const score = 1 / (rank + 2 + i); if (prev) prev.score += score; else extra.set(h.paragraph_id, { hit: h, score }); } });
      } catch (_) {}
    }
    if (mySeq !== searchSeq) return;
    $(".widening", listPane)?.remove();
    const added = [...extra.values()].sort((a, b) => b.score - a.score).slice(0, 20).map((x) => x.hit);
    if (!added.length) return;
    data.hits = data.hits.concat(added);
    data.total = Math.max(data.total, data.hits.length);
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
    state.view = "results";
    const frag = document.createDocumentFragment();
    if (data.error) frag.append(el("div", { class: "status error", text: data.error }));
    if (data.jump) {
      const j = data.jump;
      frag.append(el("button", { class: "jump", onclick: () => j.doc_id ? openDoc(j.doc_id, j.pid) : null }, [
        el("div", {}, [el("b", { text: j.label }), " ", el("span", { text: j.doc_id ? "Open" : "Not in the library yet" })]),
        el("span", { text: j.doc_id ? "›" : "" }),
      ]));
    }
    if (data.smart) {
      const bits = [];
      if (data.smart.terms?.length) bits.push(data.smart.terms.join(", "));
      if (data.smart.speaker) bits.push(`by ${data.smart.speaker}`);
      if (data.smart.book) bits.push(`in ${data.smart.book.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace("Sections", "D&C")}`);
      if (data.smart.scope) bits.push(`in ${{ conference: "conference", scriptures: "the scriptures", handbook: "the handbook", pmg: "Preach My Gospel", cfm: "Come, Follow Me", helps: "study helps" }[data.smart.scope] || data.smart.scope}`);
      if (data.smart.years) bits.push(data.smart.years[0] === data.smart.years[1] ? String(data.smart.years[0]) : `${data.smart.years[0]} to ${data.smart.years[1]}`);
      const line = el("div", { class: "smart-line" }, [
        el("span", { text: `Reading this as: ${bits.join(" · ")}` }),
        el("button", { type: "button", class: "text-btn small", text: "Exact words", onclick: () => { state.q = `"${data.query.trim()}"`; syncControls(); runSearch({ typeahead: false }); } }),
      ]);
      if (data.widened) line.append(el("span", { class: "widened", text: ` · Claude also searched: ${data.widened.join("; ")}` }));
      frag.append(line);
    }
    if (data.titles && data.titles.length) {
      frag.append(el("div", { class: "group-title", text: "By title" }));
      for (const d of data.titles) frag.append(docRow(d));
    }
    const total = data.total || 0;
    if (data.hits.length || data.documents.length) {
      frag.append(el("div", { class: "group-title", text: `${total.toLocaleString()} ${state.group === "documents" ? "talks and chapters" : "passages"}${data.ms ? ` in ${data.ms} ms` : ""}` }));
    } else if (!data.jump && !(data.titles || []).length) {
      frag.append(el("div", { class: "empty" }, [
        el("div", { text: `Nothing matches “${data.query}”${scopeLabel()}. Try fewer words, a different spelling, or ask the question instead:` }),
        el("button", { type: "button", class: "text-btn", text: "Ask Claude", onclick: () => { state.browse = { tab: "ask" }; state.q = ""; syncControls(); renderHome(); setTimeout(() => { const ta = $(".ask-input"); if (ta) { ta.value = data.query; ta.focus(); } }, 50); } }),
      ]));
    }
    if (state.group === "documents") for (const d of data.documents) frag.append(docRow(d, d.hits));
    else for (const h of data.hits) frag.append(hitRow(h));
    const shown = state.group === "documents" ? data.documents.length : data.hits.length;
    if (shown < total) {
      frag.append(el("button", { class: "more", text: `Show more (${(total - shown).toLocaleString()} left)`, onclick: () => { state.offset = shown; runSearch({ more: true, silent: true }); } }));
    }
    listPane.replaceChildren(frag);
    listPane.scrollTop = 0;
    markActive();
  }
  function scopeLabel() { return state.scope === "all" ? "" : ` in ${{ conference: "general conference", pmg: "Preach My Gospel" }[state.scope] || state.scope}`; }

  function hitRow(h) {
    const row = el("div", { class: "hit-row" }, [
      el("button", { class: "hit", "data-doc": h.doc_id, "data-pid": h.pid, onclick: () => openDoc(h.doc_id, h.pid) }, [
        el("div", { class: "cite", text: h.citation }),
        el("div", { class: "snip", html: h.snippet }),
        el("div", { class: "where", text: h.collection === "general-conference" ? [h.session, h.label].filter(Boolean).join(", ") : h.label }),
      ]),
      el("button", { class: "add", "aria-label": "Add to deck", title: "Add to deck", text: window.Deck?.has(h.doc_id, h.pid) ? "\u2713" : "+", onclick: async (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        if (window.Deck?.has(h.doc_id, h.pid)) { window.Deck.remove(h.doc_id, h.pid); btn.textContent = "+"; toast("Taken off the deck."); return; }
        // The snippet is a search excerpt; the deck wants the whole verse or paragraph.
        let text = el("div", { html: h.snippet }).textContent, verses = null;
        try {
          const ctx = await api("context", { doc_id: h.doc_id, pid: h.pid, before: 0, after: 0 });
          if (ctx?.paragraphs?.length) {
            text = ctx.paragraphs.map((x) => x.text).join(" ");
            const vs = ctx.paragraphs.filter((x) => x.kind === "verse" && x.verse);
            if (vs.length) verses = vs.map((x) => ({ n: x.verse, text: x.text }));
          }
        } catch (_) { /* the snippet will do */ }
        window.Deck?.addPassage({ doc_id: h.doc_id, pid: h.pid, kind: h.kind, verse: h.verse, text, verses, citation: h.citation, label: h.label, author: h.author, title: h.title, collection: h.collection }, { show: true });
        btn.textContent = "\u2713";
        if (!wide()) toast("On the deck.");
      } }),
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
  async function renderHome() {
    state.view = "home";
    const frag = document.createDocumentFragment();
    frag.append(el("div", { class: "status", id: "homeStatus", text: "" }));
    const tabs = el("div", { class: "shelf", id: "homeTabs" });
    const sections = [["ask", "Ask"], ["deck", "Deck"], ["conference", "Latest conference"], ["scriptures", "Scriptures"], ["preach-my-gospel", "Preach My Gospel"], ["come-follow-me", "Come, Follow Me"], ["handbook", "Handbook"], ["manuals", "Manuals"], ["study-helps", "Study helps"]];
    for (const [key, label] of sections) {
      tabs.append(el("button", { class: "chip" + ((state.browse?.tab || "conference") === key ? " on" : ""), text: label, onclick: () => { state.browse = { tab: key }; renderHome(); } }));
    }
    frag.append(tabs);
    const body = el("div", { id: "homeBody" });
    frag.append(body);
    listPane.replaceChildren(frag);
    try {
      const s = await api("stats");
      const built = s.meta?.bundle?.built_at ? new Date(s.meta.bundle.built_at) : null;
      const when = built ? `Library built ${built.toLocaleDateString([], { month: "short", day: "numeric" })}.` : "";
      $("#homeStatus").textContent = `${s.verses.toLocaleString()} verses and ${s.talks.toLocaleString()} talks on this device. ${when}`;
    } catch (e) {
      $("#homeStatus").textContent = `The library is not answering (${e.message}).`;
      $("#homeStatus").classList.add("error");
      return;
    }
    const tab = state.browse?.tab || "conference";
    try {
      if (tab === "ask") { window.Ask?.render(body); return; }
      if (tab === "deck") { window.Deck?.render(body); return; }
      if (tab === "conference") await browseConference(body);
      else if (tab === "scriptures") await browseScriptures(body);
      else await browseCollection(body, tab);
    } catch (e) {
      body.append(el("div", { class: "status error", text: e.message }));
    }
  }

  async function browseConference(body) {
    const b = state.browse || {};
    if (b.bookUri) return renderBookToc(body, b.bookUri, () => { state.browse = { tab: "conference", year: b.year, all: true }; renderHome(); });
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
    for (const y of years) shelf.append(el("button", { class: "chip" + (b.year === y ? " on" : ""), text: String(y), onclick: () => { state.browse = { tab: "conference", year: y, all: true }; renderHome(); } }));
    body.append(shelf);
    if (b.year) {
      for (const bk of books.filter((x) => x.year === b.year)) {
        body.append(el("button", { class: "toc-row", onclick: () => { state.browse = { tab: "conference", year: b.year, bookUri: bk.uri }; renderHome(); } }, [
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
        for (const bk of vol.books) row.append(el("button", { class: "chip", text: bk.name.replace("JST, ", ""), onclick: () => { state.browse = { tab: "scriptures", book: bk.slug }; renderHome(); } }));
        body.append(row);
      }
      return;
    }
    const bk = shelf.volumes.flatMap((v) => v.books).find((x) => x.slug === b.book);
    body.append(el("div", { class: "crumbs" }, [el("button", { text: "Scriptures", onclick: () => { state.browse = { tab: "scriptures" }; renderHome(); } }), el("span", { text: bk.name })]));
    const grid = el("div", { class: "chapters" });
    for (const c of bk.chapters) grid.append(el("button", { text: String(c.n), disabled: !c.doc_id, onclick: () => openDoc(c.doc_id, null) }));
    body.append(grid);
    if (!bk.chapters.some((c) => c.doc_id)) body.append(el("div", { class: "empty", text: "Not in this library yet. It arrives with a later build." }));
  }

  async function browseCollection(body, slug) {
    const b = state.browse || {};
    if (b.bookUri) return renderBookToc(body, b.bookUri, () => { state.browse = { tab: slug }; renderHome(); });
    const data = await api("browse", { collection: slug });
    const books = data.books.filter((x) => x.docs > 0);
    if (!books.length) { body.append(el("div", { class: "empty", text: "Nothing here yet. It arrives with a later nightly build." })); return; }
    if (books.length === 1) return renderBookToc(body, books[0].uri, null);
    for (const bk of books) body.append(el("button", { class: "toc-row", onclick: () => { state.browse = { tab: slug, bookUri: bk.uri }; renderHome(); } }, [el("div", { class: "t", text: bk.title }), el("div", { class: "s", text: `${bk.docs} pages` })]));
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
  async function openDoc(id, pid, { push: doPush = true } = {}) {
    if (!id) return;
    state.docId = id; state.pid = pid || null;
    if (doPush) push();
    markActive();
    showReader();
    if (!currentDoc || currentDoc.id !== id) {
      readerPane.replaceChildren(el("div", { class: "status", text: "Opening…" }));
      try { currentDoc = await api("doc", { id }); }
      catch (e) { readerPane.replaceChildren(el("div", { class: "status error", text: `Could not open that page (${e.message}).` })); return; }
      if (!currentDoc) { readerPane.replaceChildren(el("div", { class: "status error", text: "That page is not in the library." })); return; }
      renderDoc(currentDoc);
    }
    focusParagraph(state.pid);
  }

  function renderDoc(doc) {
    const bar = el("div", { class: "reader-bar" }, [
      el("button", { class: "icon-btn back", "aria-label": "Back", onclick: () => history.back(), html: ICON_BACK }),
      el("div", { class: "crumb", text: crumbFor(doc) }),
      el("div", { class: "spacer" }),
      el("button", { class: "icon-btn", "aria-label": "Smaller text", title: "Smaller text", onclick: () => resize(-1), html: "<span style='font-size:14px;font-weight:600'>A</span>" }),
      el("button", { class: "icon-btn", "aria-label": "Larger text", title: "Larger text", onclick: () => resize(1), html: "<span style='font-size:20px;font-weight:600'>A</span>" }),
      panel.lastEl && wide() ? el("button", { class: "text-btn", text: panel.lastTitle || "Back", title: "Back to the passages", onclick: () => panel.restore() }) : null,
      el("button", { class: "icon-btn", "aria-label": "Present", title: "Present on a big screen", onclick: () => startPresenting(), html: ICON_PRESENT }),
      el("a", { class: "icon-btn", href: doc.source_url, target: "_blank", rel: "noopener", title: "Open on churchofjesuschrist.org", "aria-label": "Open on churchofjesuschrist.org", html: ICON_OUT }),
    ]);
    const body = el("article", { class: "doc", html: doc.body_html || "" });
    if (doc.footnotes && doc.footnotes.length) {
      const notes = el("section", { class: "notes" }, [el("h2", { text: "Footnotes" })]);
      const ol = el("ol");
      for (const n of doc.footnotes) ol.append(el("li", { id: `fn-${n.note_id}` }, [el("b", { text: n.marker || "" }), el("span", { html: n.html || esc(n.text) })]));
      notes.append(ol);
      body.append(notes);
    }
    const nav = el("div", { class: "doc-nav" }, [
      doc.prev ? el("button", { text: `‹ ${doc.prev.title}`, onclick: () => openDoc(doc.prev.id, null) }) : el("span"),
      doc.next ? el("button", { text: `${doc.next.title} ›`, onclick: () => openDoc(doc.next.id, null) }) : el("span"),
    ]);
    const foot = el("div", { class: "doc-foot", text: doc.fetched_at ? `Copied from churchofjesuschrist.org ${new Date(doc.fetched_at).toLocaleDateString()}. Text and study helps are the Church's; this copy is for personal study.` : "" });
    readerPane.replaceChildren(bar, body, nav, foot);
    readerPane.scrollTop = 0;
    body.addEventListener("click", onBodyClick);
    body.addEventListener("click", onSelectClick);
    body.addEventListener("dblclick", (e) => {
      const unit = e.target.closest("p, h2, h3, li");
      if (unit && unit.id) { e.preventDefault(); window.getSelection()?.removeAllRanges(); startPresenting(unit.id); }
    });
    highlightTerms(body);
  }

  // Tap a verse or paragraph to select it for the deck; a bar offers what to do with the selection.
  function onSelectClick(e) {
    if (e.defaultPrevented || e.target.closest("a, button, .notes, header")) return;
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
      for (const junk of c.querySelectorAll("sup.marker, .verse-number, .page-break")) junk.remove();
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
        el("button", { type: "button", class: "primary", text: "Add to deck", onclick: () => {
          const added = window.Deck?.addFromDoc(currentDoc, selectedUnits());
          clearSelection();
          toast(added === 0 ? "Already on the deck." : added === 1 ? "On the deck. Tap Deck to highlight and link." : `${added} passages on the deck. Tap Deck to highlight and link.`);
        } }),
        el("button", { type: "button", class: "text-btn", text: "Present", onclick: () => { const u = selectedUnits(); startPresentingUnits(u.map((x) => ({ text: x.text, kind: x.kind, where: x.kind === "verse" && currentDoc ? `${currentDoc.citation.replace(/:\d.*$/, "")}:${x.verse}` : crumbFor(currentDoc) }))); } }),
        el("button", { type: "button", class: "text-btn", text: "Clear", onclick: clearSelection }),
      ]);
      readerPane.append(bar);
    }
    $(".n", bar).textContent = `${n} selected`;
  }
  function toast(text) {
    const t = el("div", { class: "toast", text });
    document.body.append(t);
    setTimeout(() => t.classList.add("show"), 10);
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 1800);
  }

  function crumbFor(doc) {
    if (doc.collection === "general-conference") return [doc.author, doc.session, doc.label].filter(Boolean).join(", ");
    const path = (doc.section_path || []).join(", ");
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
    if (/^(\/study\/|https?:\/\/(www\.)?churchofjesuschrist\.org\/study\/)/.test(href)) {
      e.preventDefault();
      const res = await api("resolve", { href });
      if (res.found) openDoc(res.doc_id, res.pid);
      else window.open(href.startsWith("/") ? "https://www.churchofjesuschrist.org" + href : href, "_blank", "noopener");
      return;
    }
    if (href.startsWith("/")) { e.preventDefault(); window.open("https://www.churchofjesuschrist.org" + href, "_blank", "noopener"); }
    else if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
  }

  function focusParagraph(pid) {
    if (!pid || !currentDoc) return;
    const body = $(".doc", readerPane);
    if (!body) return;
    for (const t of body.querySelectorAll(".is-target")) t.classList.remove("is-target");
    let target = body.querySelector(`#${CSS.escape(pid)}`);
    if (!target && /^p\d+$/.test(pid)) target = body.querySelector(`.verse:nth-of-type(${pid.slice(1)})`);
    if (!target) return;
    target.classList.add("is-target");
    requestAnimationFrame(() => target.scrollIntoView({ block: "center", behavior: "auto" }));
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
    const sizes = [15, 16, 17, 18, 19, 21, 23, 26];
    const cur = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--reading-size")) || 17;
    let i = Math.max(0, Math.min(sizes.length - 1, sizes.indexOf(cur) + delta));
    if (sizes.indexOf(cur) === -1) i = delta > 0 ? 3 : 1;
    document.documentElement.style.setProperty("--reading-size", sizes[i] + "px");
    store.set("readingSize", sizes[i]);
  }
  { const s = store.get("readingSize"); if (s) document.documentElement.style.setProperty("--reading-size", s + "px"); }

  // ------------------------------------------------------------ present ----
  // One paragraph or verse at a time, large, on a plain background: for a
  // projector, a TV over AirPlay, or a tablet turned toward the room.
  const stage = $("#stage");
  let show = null; // { units: [{pid, kind, html, verse}], i, doc }

  function presentUnits(doc) {
    const scratch = el("div", { html: doc.body_html || "" });
    const units = [];
    const take = (node, kind) => {
      const c = node.cloneNode(true);
      for (const junk of c.querySelectorAll("sup.marker, .page-break, a.study-note-ref sup")) junk.remove();
      for (const a of c.querySelectorAll("a")) a.replaceWith(...a.childNodes);
      const html = c.innerHTML.trim();
      const text = c.textContent.replace(/\s+/g, " ").trim();
      if (!text) return;
      units.push({ pid: node.id || null, kind, html, text });
    };
    for (const node of scratch.querySelectorAll("h1, h2, h3, p, li, figcaption")) {
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

  function openStage(next) {
    show = { ...next, scale: store.get("stageScale", 1) };
    document.body.classList.add("presenting");
    stage.classList.toggle("themed", !!next.theme);
    for (const k of ["bg", "fg", "accent", "muted"]) stage.style.setProperty(`--stage-${k}`, next.theme?.[k] || "");
    stage.hidden = false;
    renderStage();
    if (stage.requestFullscreen && !document.fullscreenElement) stage.requestFullscreen().catch(() => {});
    try { navigator.wakeLock?.request("screen").then((l) => { show.lock = l; }).catch(() => {}); } catch (_) {}
  }

  function stopPresenting() {
    if (!show) return;
    const atPid = show.doc ? show.units[show.i]?.pid : null;
    show.lock?.release?.();
    show = null;
    stage.hidden = true;
    stage.classList.remove("themed");
    document.body.classList.remove("presenting");
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    if (atPid) focusParagraph(atPid);
  }

  function renderStage() {
    if (!show) return;
    const u = show.units[show.i];
    const d = show.doc;
    let where = u.where || "";
    if (d) {
      const ref = u.kind === "verse" && d.book_slug && u.pid ? `${d.citation.replace(/:\d.*$/, "")}:${u.pid.replace(/^p/, "")}` : null;
      where = d.collection === "general-conference" ? [d.author, d.title, d.label.replace(" General Conference", "")].filter(Boolean).join("  \u00b7  ") : (ref || d.citation);
    }
    const body = $(".stage-body", stage);
    body.style.setProperty("--stage-scale", show.scale);
    body.classList.toggle("is-title", u.kind === "title");
    body.classList.toggle("is-wide", u.kind === "link" || u.kind === "map");
    $(".stage-text", stage).innerHTML = u.kind === "verse" ? u.html.replace(/<span class="verse-number">[^<]*<\/span>/, "") : u.html;
    $(".stage-ref", stage).textContent = where;
    $(".stage-count", stage).textContent = `${show.i + 1} / ${show.units.length}`;
    $(".stage-prev", stage).disabled = show.i === 0;
    $(".stage-next", stage).disabled = show.i === show.units.length - 1;
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
    if (e.target.closest("button")) return;
    const r = stage.getBoundingClientRect();
    stageStep(e.clientX - r.left > r.width / 2 ? 1 : -1);
  });
  stage.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
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
      bodyEl.replaceChildren(el("div", { class: "nm", text: `Note ${n.marker || ""}`.trim() }), el("div", { html: n.html || esc(n.text) }));
    }
    sheet.hidden = false;
    const scrim = el("div", { class: "scrim", onclick: hideNote });
    scrim.id = "scrim";
    document.body.append(scrim);
    bodyEl.onclick = (e) => {
      const a = e.target.closest("a");
      if (!a) return;
      e.preventDefault();
      const href = a.getAttribute("href") || "";
      api("resolve", { href }).then((res) => {
        hideNote();
        if (res.found) openDoc(res.doc_id, res.pid);
        else window.open(href.startsWith("/") ? "https://www.churchofjesuschrist.org" + href : href, "_blank", "noopener");
      });
    };
  }
  function hideNote() { sheet.hidden = true; $("#scrim")?.remove(); }
  $(".close", sheet).addEventListener("click", hideNote);

  // ----------------------------------------------------------- controls ----
  input.addEventListener("input", () => {
    if (!state.ready) return;
    state.q = input.value;
    if (!wide() && !readerPane.hidden) { state.docId = null; state.pid = null; showList(); }
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
  $("#homeBtn").addEventListener("click", () => { if (!state.ready) return; state.q = ""; state.docId = null; state.pid = null; state.browse = null; syncControls(); renderHome(); showList(); push(); });
  $("#filterBtn").addEventListener("click", () => { filters.hidden = !filters.hidden; mainEl.classList.toggle("filters-open", !filters.hidden); });
  $("#askBtn").addEventListener("click", () => { if (!state.ready) return; state.q = ""; state.browse = { tab: "ask" }; syncControls(); renderHome(); showList(); push(); });
  $("#deckBtn").addEventListener("click", () => { if (!state.ready) return; state.q = ""; state.browse = { tab: "deck" }; syncControls(); renderHome(); showList(); push(); });
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
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown" || e.key === "ArrowDown") { e.preventDefault(); stageStep(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp" || e.key === "ArrowUp" || e.key === "Backspace") { e.preventDefault(); stageStep(-1); }
      else if (e.key === "Escape") stopPresenting();
      else if (e.key === "+" || e.key === "=") stageScale(0.1);
      else if (e.key === "-") stageScale(-0.1);
      return;
    }
    if (e.key === "/" && document.activeElement !== input && !document.body.classList.contains("setup")) { e.preventDefault(); input.focus(); input.select(); }
    if ((e.key === "p" || e.key === "P") && document.activeElement !== input && currentDoc && !readerPane.hidden && !e.metaKey && !e.ctrlKey) { e.preventDefault(); startPresenting(); }
    if (e.key === "Escape") { if (!sheet.hidden) hideNote(); else input.blur(); }
  });

  const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_PRESENT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
  const ICON_OUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';

  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register(new URL("sw.js", BASE)).catch(() => {});

  // What ask.js needs from the app.
  // A view that borrows the reader pane on wide screens (Ask's passages, for one).
  const panel = {
    lastEl: null, lastTitle: "",
    show(node, title) {
      panel.lastEl = node; panel.lastTitle = title || "";
      if (!wide()) return;
      currentDoc = null;
      readerPane.replaceChildren(el("div", { class: "reader-bar" }, [el("div", { class: "crumb", text: title || "" })]), node);
      readerPane.hidden = false;
      readerPane.scrollTop = 0;
    },
    restore() { if (panel.lastEl) panel.show(panel.lastEl, panel.lastTitle); },
  };

  window.GL = {
    api, el, esc, store, openDoc, startPresentingUnits, toast, panel,
    get ready() { return state.ready; },
    get wide() { return wide(); },
  };

  // ------------------------------------------------------------- start ----
  (async () => {
    readUrl();
    syncControls();
    const ok = await ensureLibrary();
    if (!ok) return;
    state.ready = true;
    api("speakers", {}).then((rows) => { const dl = $("#speakerList"); for (const r of rows) dl.append(el("option", { value: r.name })); }).catch(() => {});
    await render();
    if (!state.q && !state.docId && wide()) input.focus();
    setTimeout(checkForUpdate, 1500);
  })();
})();
