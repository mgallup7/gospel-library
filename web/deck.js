/* Deck: the passages picked for a presentation, laid out on a board where
   phrases are highlighted and linked with arrows, then written out as a
   PowerPoint file (or presented straight from the device). Everything runs
   here; the .pptx is written in the browser by PptxGenJS. */
import { chunksOf, fontSize, MAX_CHARS } from "./lib/chunk.js";
import { talkCitation, chapterOf } from "./lib/cite.js";

(() => {
  "use strict";

  const { el, esc, store } = window.GL || {};
  const GL = () => window.GL;
  const $ = (sel, root = document) => root.querySelector(sel);
  const SVG = "http://www.w3.org/2000/svg";
  const raf = (fn) => (window.requestAnimationFrame ? window.requestAnimationFrame(fn) : setTimeout(fn, 0));

  // ------------------------------------------------------------- themes --
  // Hex colors without "#", as PptxGenJS wants them. Fonts are ones that ship
  // with PowerPoint and Keynote on Mac, Windows and iPad. "panel" is the tone
  // for cards on connection and map slides; "gradient" paints the background
  // of every slide when the device can draw it (a slide master holds it once).
  const THEMES = {
    royal: { name: "Royal", bg: "0F2D52", text: "FFFFFF", accent: "F2C75C", muted: "B9C8DC", rule: "2E527F", panel: "1B4273", gradient: ["173E6E", "0F2D52", "0A2140"], bar: null },
    paper: { name: "Paper", bg: "FBFAF7", text: "1D1F23", accent: "1F4E79", muted: "7A7F88", rule: "D9D6CF", panel: "F0EEE8", gradient: null, bar: null },
    night: { name: "Night", bg: "0E1013", text: "F2EFE8", accent: "E3C27A", muted: "9AA0A8", rule: "2A2E34", panel: "1A1E24", gradient: null, bar: null },
    linen: { name: "Linen", bg: "F1EDE4", text: "2A2622", accent: "7A4E2D", muted: "8C847B", rule: "DCD5C8", panel: "E7E1D5", gradient: null, bar: "7A4E2D" },
    slate: { name: "Slate", bg: "1F2A37", text: "FFFFFF", accent: "9ECAE1", muted: "AEB8C4", rule: "33404F", panel: "2B3849", gradient: null, bar: null },
  };
  const DEFAULT_THEME = "royal";
  const SERIF = "Georgia";
  const SANS = "Calibri";
  const QUICK_LABELS = ["fulfilled in", "same word", "echoes", "defines", "explains", "contrast", "promise and keeping"];

  // ---------------------------------------------------------------- model --
  // deck.items: passages and sections in slide order. deck.links: arrows
  // between a highlighted phrase (or whole passage) and another; a connection
  // slide follows the later of its two passages.
  const uid = () => Math.random().toString(36).slice(2, 10);
  const blank = () => ({ id: uid(), title: "", subtitle: "", theme: DEFAULT_THEME, themeSet: true, items: [], links: [], chain: null, updated: Date.now() });
  // The deck starts blank and the one kept on the device arrives a moment later (see storage below);
  // the board draws from memory and never waits on the database.
  let deck = blank();

  function migrate(d) {
    if (!d || typeof d !== "object") return null;
    if (!d.id) d.id = uid();
    d.items = Array.isArray(d.items) ? d.items : [];
    d.links = Array.isArray(d.links) ? d.links : [];
    // Earlier decks kept connections among the items and highlights without ids.
    const inline = d.items.filter((i) => i.type === "link");
    d.items = d.items.filter((i) => i.type !== "link");
    for (const it of d.items) if (it.type === "passage") it.hl = (it.hl || []).map((h) => (h.id ? h : { ...h, id: uid() }));
    const links = [...inline, ...d.links];
    for (const l of links) {
      l.type = "link";
      if (!l.id) l.id = uid();
      for (const end of [l.from, l.to]) {
        if (!end || !end.hl || typeof end.hl !== "object") continue;
        const it = d.items.find((i) => i.id === end.id);
        const found = it && (it.hl || []).find((h) => h.s === end.hl.s && h.e === end.hl.e);
        if (found) end.hl = found.id;
        else if (it) { const h = { id: uid(), s: end.hl.s, e: end.hl.e }; it.hl.push(h); it.hl.sort((p, q) => p.s - q.s); end.hl = h.id; }
        else end.hl = null;
      }
    }
    d.links = links.filter((l) => l.from && l.to && d.items.some((i) => i.id === l.from.id) && d.items.some((i) => i.id === l.to.id));
    if (!d.themeSet) { d.theme = DEFAULT_THEME; d.themeSet = true; }
    if (d.chain === undefined) d.chain = null;
    if (!THEMES[d.theme]) d.theme = DEFAULT_THEME;
    return d;
  }

  // ------------------------------------------------------------ storage --
  // The current deck and the saved decks, with their full text and speaker notes, outgrow
  // localStorage (about 5 MB, and a full store refuses the write), so they live in the browser's
  // database, like the marks: "current" holds the deck in progress under the key "deck", "saved"
  // one record per saved deck. What is in memory is the truth; writes follow a moment behind.
  const DB = "gospel-decks";
  let dbOpen = null;
  function openDb() {
    if (dbOpen) return dbOpen;
    dbOpen = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains("current")) r.result.createObjectStore("current");
        if (!r.result.objectStoreNames.contains("saved")) r.result.createObjectStore("saved", { keyPath: "id" });
      };
      r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbOpen = null; }; resolve(db); };
      r.onerror = () => { dbOpen = null; reject(r.error || new Error("the decks database did not open")); };
    });
    return dbOpen;
  }
  async function tx(name, mode, work) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const t = db.transaction(name, mode);
      const req = work(t.objectStore(name));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error || new Error("the decks database failed"));
      t.onabort = () => reject(t.error || new Error("the decks database failed"));
    });
  }
  const isFull = (err) => !!err && (err.name === "QuotaExceededError" || /quota|full/i.test(err.message || ""));
  let warnedAt = 0;
  function warn(err) {
    if (Date.now() - warnedAt < 10000) return;
    warnedAt = Date.now();
    GL()?.toast(isFull(err) ? "Storage is full. The deck could not be saved." : `The deck could not be saved: ${err?.message || "the browser refused"}.`);
  }
  // A browser without the database (or one that will not open it) keeps the decks in localStorage, as before.
  let noDb = typeof indexedDB === "undefined";
  let loaded = false, writeTimer = null, writeWanted = false;
  let savedDecks = []; // [{id, title, updated, deck}], newest first
  const bc = typeof BroadcastChannel === "function" ? new BroadcastChannel(DB) : null;

  async function writeCurrent() {
    clearTimeout(writeTimer); writeTimer = null;
    if (!loaded) { writeWanted = true; return; }
    writeWanted = false;
    if (noDb) { store.set("deck", deck); return; }
    try { await tx("current", "readwrite", (s) => s.put(deck, "deck")); bc?.postMessage({ what: "current", updated: deck.updated }); }
    catch (err) { warn(err); }
  }
  function scheduleWrite() { clearTimeout(writeTimer); writeTimer = setTimeout(writeCurrent, 400); }
  // A deck being typed into when the page goes away is written at once.
  const flushNow = () => { if (writeTimer) writeCurrent(); };
  window.addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushNow(); });

  async function putSaved(entry) {
    if (noDb) return store.set("decks", savedDecks);
    try { await tx("saved", "readwrite", (s) => s.put(entry)); bc?.postMessage({ what: "saved" }); return true; }
    catch (err) { warn(err); return false; }
  }
  async function dropSaved(id) {
    if (noDb) return store.set("decks", savedDecks);
    try { await tx("saved", "readwrite", (s) => s.delete(id)); bc?.postMessage({ what: "saved" }); return true; }
    catch (err) { warn(err); return false; }
  }
  const sortSaved = () => savedDecks.sort((a, b) => (b.updated || 0) - (a.updated || 0));

  // First run after the move: what localStorage holds goes into the database, and leaves
  // localStorage only once it is safely written. A newer copy wins where both have one.
  const ready = (async () => {
    await null; // after this file has run to the end, so the board's variables exist
    let current = null, saved = [];
    if (!noDb) {
      try { [current, saved] = await Promise.all([tx("current", "readonly", (s) => s.get("deck")), tx("saved", "readonly", (s) => s.getAll())]); }
      catch (err) { console.warn("decks stay in localStorage:", err?.message); noDb = true; }
    }
    const oldDeck = store.get("deck"), oldSaved = store.get("decks", null);
    if (noDb) { current = oldDeck; saved = Array.isArray(oldSaved) ? oldSaved : []; }
    else {
      if (oldDeck && typeof oldDeck === "object" && (!current || (oldDeck.updated || 0) >= (current.updated || 0))) {
        try { await tx("current", "readwrite", (s) => s.put(oldDeck, "deck")); current = oldDeck; store.del("deck"); } catch (err) { current = oldDeck; console.warn("the deck stays in localStorage for now:", err?.message); }
      } else if (oldDeck) store.del("deck");
      if (Array.isArray(oldSaved)) {
        const byKey = new Map((saved || []).map((d) => [d.id, d]));
        const take = oldSaved.filter((d) => d && d.id && d.deck && (!byKey.has(d.id) || (d.updated || 0) > (byKey.get(d.id).updated || 0)));
        try {
          if (take.length) await tx("saved", "readwrite", (s) => { for (const d of take) s.put(d); });
          for (const d of take) byKey.set(d.id, d);
          saved = [...byKey.values()];
          store.del("decks");
        } catch (err) { saved = [...byKey.values(), ...take]; console.warn("saved decks stay in localStorage for now:", err?.message); }
      }
    }
    savedDecks = (saved || []).filter((d) => d && d.id && d.deck);
    sortSaved();
    // Anything added in the moment before the stored deck arrived joins it rather than replacing it.
    const early = deck;
    deck = migrate(current) || deck;
    if (early !== deck && early.items.length) {
      for (const it of early.items) if (!(it.type === "passage" && has(it.doc_id, it.pid))) deck.items.push(it);
      deck.links.push(...early.links);
      deck.updated = Date.now();
      writeWanted = true;
    }
    loaded = true;
    if (writeWanted) writeCurrent();
    draw(); updateBadge();
    try { window.dispatchEvent(new CustomEvent("deck:change")); } catch (_) {}
  })();

  // Another tab saved: take its newer deck rather than writing over it later.
  if (bc) bc.onmessage = async (e) => {
    try {
      if (e.data?.what === "current") {
        const other = await tx("current", "readonly", (s) => s.get("deck"));
        if (other && other.updated > deck.updated) { deck = migrate(other); pending = active = linking = null; draw(); updateBadge(); window.dispatchEvent(new CustomEvent("deck:change")); }
      } else if (e.data?.what === "saved") {
        savedDecks = (await tx("saved", "readonly", (s) => s.getAll())) || [];
        sortSaved();
      }
    } catch (_) { /* the next save writes ours */ }
  };

  function save({ redraw = true } = {}) {
    deck.updated = Date.now();
    scheduleWrite();
    updateBadge();
    if (redraw) draw();
    else if (ui) { syncDownloadButton(); schedulePrepare(); }
    try { window.dispatchEvent(new CustomEvent("deck:change")); } catch (_) {}
  }

  function count() { return deck.items.filter((i) => i.type === "passage").length; }
  // The header button carries the count as a small pill, so the teacher sees the deck grow
  // from any screen; the label says it in words for VoiceOver.
  function updateBadge() {
    const b = $("#deckBtn");
    if (!b) return;
    const n = count();
    b.replaceChildren("Deck");
    if (n) b.append(Object.assign(document.createElement("span"), { className: "deck-count", textContent: String(n) }));
    b.setAttribute("aria-label", n ? `Deck, ${n} ${n === 1 ? "passage" : "passages"}` : "Deck");
  }
  const byId = (id) => deck.items.find((i) => i.id === id) || null;
  function find(doc_id, pid) { return deck.items.find((i) => i.type === "passage" && i.doc_id === doc_id && i.pid === pid) || null; }
  function has(doc_id, pid) { return !!find(doc_id, pid); }
  function remove(doc_id, pid) { const it = find(doc_id, pid); if (it) removeItem(it); return !!it; }
  function removeItem(it) {
    deck.items = deck.items.filter((i) => i !== it);
    deck.links = deck.links.filter((l) => l.from.id !== it.id && l.to.id !== it.id);
    if (pending && pending.id === it.id) pending = null;
    if (active && active.id === it.id) active = null;
    save();
  }
  // Take off the items one add put on (the Undo in its toast); one save, one redraw.
  function removeIds(ids) {
    const gone = new Set(ids || []);
    const before = deck.items.length;
    deck.items = deck.items.filter((i) => !gone.has(i.id));
    if (deck.items.length === before) return 0;
    deck.links = deck.links.filter((l) => !gone.has(l.from.id) && !gone.has(l.to.id));
    if (pending && gone.has(pending.id)) pending = null;
    if (active && gone.has(active.id)) active = null;
    if (linking && gone.has(linking.id)) linking = null;
    save();
    return before - deck.items.length;
  }
  // The ids the last addFromDoc or addPassage put on the deck; empty when it added nothing.
  let lastAddedIds = [];
  function lastAdded() { return lastAddedIds.slice(); }
  /** Put a passage on the deck or take it off. Returns true when it was added. */
  function toggle(p) {
    if (has(p.doc_id, p.pid)) { remove(p.doc_id, p.pid); return false; }
    addPassage(p);
    return true;
  }

  /** Add passages from a document. units: [{pid, kind, verse, text}] in reading order. */
  function addFromDoc(doc, units) {
    // what is already on the deck stays as it is; the rest goes on, in runs of consecutive verses
    units = units.filter((u) => !has(doc.id, u.pid));
    const runs = [];
    let run = null;
    for (const u of units) {
      if (run && run.kind === u.kind && (u.kind !== "verse" || u.verse === run.lastVerse + 1)) {
        run.units.push(u); run.lastVerse = u.verse;
      } else {
        run = { kind: u.kind, units: [u], lastVerse: u.verse };
        runs.push(run);
      }
    }
    let added = 0;
    lastAddedIds = [];
    const cards = []; // each new card and the paragraphs it holds, for its marks
    for (const r of runs) {
      const verses = r.kind === "verse" ? r.units.map((u) => ({ n: u.verse, text: u.text })) : null;
      const text = verses ? verses.map((v) => v.text).join(" ") : r.units.map((u) => u.text).join("\n\n");
      if (has(doc.id, r.units[0].pid)) continue;
      const id = uid();
      deck.items.push({
        id, type: "passage", kind: r.kind === "verse" ? "verse" : "para",
        text, verses, doc_id: doc.id, pid: r.units[0].pid, hl: [],
        ...citationFor(doc, verses),
      });
      lastAddedIds.push(id);
      cards.push({ id, pids: r.units.map((u) => u.pid) });
      added++;
    }
    save();
    if (added) carryMarks(doc, cards);
    return added;
  }
  // The reader's marks come along: a verse he colored arrives with that color (item.color, and on
  // each verse; the PowerPoint does not read it, the board can), and a note on a verse the card
  // holds becomes its speaker note. The marks store answers after the add has returned, so the
  // cards are filled in a moment later; a card already taken off (Undo) is left alone.
  function carryMarks(doc, cards) {
    if (!window.Marks || !doc?.uri) return;
    window.Marks.forDoc(doc.uri).then((marks) => {
      if (!marks || !marks.length) return;
      const byPid = new Map(marks.map((m) => [m.pid, m]));
      let changed = false;
      for (const { id, pids } of cards) {
        const it = deck.items.find((i) => i.id === id);
        if (!it) continue;
        const colors = pids.map((p) => byPid.get(p)?.color || null);
        if (it.verses) it.verses.forEach((v, i) => { if (colors[i]) v.color = colors[i]; });
        const color = colors.find(Boolean) || null;
        if (color) { it.color = color; changed = true; }
        // a note covers its own verse, or a range of them: any overlap with the card brings it
        const lo = it.verses ? it.verses[0].n : null, hi = it.verses ? it.verses[it.verses.length - 1].n : null;
        const notes = marks.filter((m) => m.note && (pids.includes(m.pid) || (m.pid_end && pids.includes(m.pid_end))
          || (lo !== null && Number.isFinite(m.verse) && m.kind === "verse" && m.verse <= hi && (Number.isFinite(m.verse_end) ? m.verse_end : m.verse) >= lo)))
          .sort((a, b) => (a.verse || 0) - (b.verse || 0));
        for (const m of notes) {
          const text = m.note.trim();
          if (!text || (it.notes || "").includes(text)) continue;
          it.notes = it.notes && it.notes.trim() ? `${it.notes.trim()}\n\n${text}` : text;
          changed = true;
        }
      }
      if (changed) save();
    }).catch(() => {});
  }

  /** A section heading at the end of the deck (what "Think it through" builds under). */
  function addSection(title) {
    const item = { id: uid(), type: "section", title: String(title || "").trim() };
    deck.items.push(item);
    selectedId = item.id; // a question added next (addCard goes after the selected card) lands under it
    save();
    return item;
  }

  /** Add one search hit or Ask passage: {doc_id, pid, kind, text, verses, citation, author, title, label, collection, verse}. */
  function addPassage(p, { show = false } = {}) {
    const existing = find(p.doc_id, p.pid);
    if (existing) { lastAddedIds = []; if (show) showBoard(); return existing; }
    const verses = p.verses && p.verses.length ? p.verses.map((v) => ({ n: v.n, text: v.text })) : (p.kind === "verse" && p.verse ? [{ n: p.verse, text: p.text }] : null);
    const item = {
      id: uid(), type: "passage", kind: p.kind === "verse" ? "verse" : "para",
      text: verses ? verses.map((v) => v.text).join(" ") : p.text, verses, doc_id: p.doc_id, pid: p.pid, hl: [],
      citation: p.citation || p.label || "", where: p.where || "",
    };
    if (p.collection === "general-conference" && p.author) {
      item.citation = p.author;
      item.where = `“${p.title}”`;
      item.label = p.label || "";
    } else if (p.citation && p.citation.includes("“") && p.citation.includes(",")) {
      // An Ask citation reads: Russell M. Nelson, “Think Celestial!”, Oct 2023
      const i = p.citation.indexOf("“");
      item.citation = p.citation.slice(0, i).replace(/,\s*$/, "");
      const tail = p.citation.slice(i);
      const m = tail.match(/^(“[^”]*”)(?:,\s*(.*))?$/);
      if (m) {
        item.where = m[1];
        item.label = (m[2] || "").replace(/^(Apr|Oct) (\d{4})$/, (_, mo, y) => `${mo === "Apr" ? "April" : "October"} ${y} General Conference`);
      }
    }
    deck.items.push(item);
    lastAddedIds = [item.id];
    save();
    if (show) showBoard();
    return item;
  }

  function citationFor(doc, verses) {
    if (doc.collection === "general-conference") {
      return { citation: doc.author || "", where: `“${doc.title}”`, label: doc.label || "" };
    }
    if (doc.book_slug && verses && verses.length) {
      const base = chapterOf(doc.citation || doc.title);
      const a = verses[0].n, b = verses[verses.length - 1].n;
      return { citation: a === b ? `${base}:${a}` : `${base}:${a}–${b}`, where: "" };
    }
    return { citation: doc.title, where: doc.label !== doc.title ? doc.label : "" };
  }

  // ------------------------------------------------------- highlights --
  // A highlight is a range of word indexes over the passage's words, so it
  // survives re-rendering and never depends on text selection. Links point
  // at highlights by id (or at a whole passage with hl: null).
  function wordsOf(it) {
    if (it.verses && it.verses.length) {
      const out = [];
      it.verses.forEach((v) => v.text.split(/\s+/).filter(Boolean).forEach((w, i) => out.push({ w, n: i === 0 ? v.n : null })));
      return out;
    }
    const out = [];
    it.text.split(/\n\n+/).forEach((para, pi) => para.split(/\s+/).filter(Boolean).forEach((w, i) => out.push({ w, n: null, para: pi, first: i === 0 })));
    return out;
  }
  function inHl(it, i) { return (it.hl || []).some((h) => i >= h.s && i <= h.e); }
  function hlAt(it, i) { return (it.hl || []).find((h) => i >= h.s && i <= h.e) || null; }
  function hlById(it, id) { return (it.hl || []).find((h) => h.id === id) || null; }
  function phraseOf(it, hl) {
    if (!hl) return "";
    return wordsOf(it).slice(hl.s, hl.e + 1).map((x) => x.w).join(" ");
  }
  /** Highlight words a..b; highlights it overlaps are replaced and their links follow. */
  function setHighlight(it, a, b) {
    const s = Math.min(a, b), e = Math.max(a, b);
    const replaced = (it.hl || []).filter((h) => !(h.e < s || h.s > e));
    const h = { id: uid(), s, e };
    it.hl = (it.hl || []).filter((x) => !replaced.includes(x));
    it.hl.push(h); it.hl.sort((p, q) => p.s - q.s);
    const gone = new Set(replaced.map((x) => x.id));
    for (const l of deck.links) for (const end of [l.from, l.to]) if (end.id === it.id && gone.has(end.hl)) end.hl = h.id;
    return h;
  }
  function removeHighlight(it, h) {
    it.hl = (it.hl || []).filter((x) => x !== h);
    deck.links = deck.links.filter((l) => !((l.from.id === it.id && l.from.hl === h.id) || (l.to.id === it.id && l.to.hl === h.id)));
  }
  /** {id, hl} → {item, hl: highlight object or null}, or null when the passage is gone. */
  function endOf(end) {
    const item = byId(end.id);
    if (!item) return null;
    return { item, hl: end.hl ? hlById(item, end.hl) : null };
  }
  function addLink(from, to, label = "") {
    if (from.id === to.id) return null;
    const dup = deck.links.find((l) => l.from.id === from.id && l.from.hl === from.hl && l.to.id === to.id && l.to.hl === to.hl);
    if (dup) return dup;
    const l = { id: uid(), type: "link", from: { id: from.id, hl: from.hl || null }, to: { id: to.id, hl: to.hl || null }, label };
    deck.links.push(l);
    return l;
  }
  /** Slide order: items as arranged, each connection right after the later of its two passages. */
  function sequence() {
    const order = new Map(deck.items.map((it, i) => [it.id, i]));
    const out = [];
    const placed = new Set();
    for (const it of deck.items) {
      out.push(it);
      if (it.type !== "passage") continue;
      for (const l of deck.links) {
        if (placed.has(l.id)) continue;
        const a = order.get(l.from.id), b = order.get(l.to.id);
        if (a === undefined || b === undefined) continue;
        if (Math.max(a, b) === order.get(it.id)) { out.push(l); placed.add(l.id); }
      }
    }
    return out;
  }
  // The sentence(s) around a highlighted phrase, for a connection slide.
  function excerpt(it, hl, maxWords = 48) {
    const words = wordsOf(it);
    if (!words.length) return { words: [], s: 0, e: -1 };
    let s = hl ? hl.s : 0, e = hl ? hl.e : Math.min(words.length - 1, maxWords - 1);
    const boundary = (w) => /[.!?;:]["’”)]?$/.test(w);
    let a = s, b = e;
    while (a > 0 && !boundary(words[a - 1].w) && s - a < maxWords / 2) a--;
    while (b < words.length - 1 && !boundary(words[b].w) && b - e < maxWords / 2) b++;
    return { words: words.slice(a, b + 1), s: s - a, e: e - a, before: a > 0, after: b < words.length - 1, start: a };
  }

  // ---------------------------------------------------------------- board --
  // One board element for the whole app. On a wide screen it has a right-hand
  // pane of its own, beside the page (app.js switches between them), while the
  // left pane keeps finding passages; on a phone it is the Deck tab.
  let board = null, ui = null;
  let pending = null;   // {id, i}: first word of a phrase being marked
  let active = null;    // {id, hl}: a highlight whose tools are showing
  let linking = null;   // {id, hl}: tap-to-link in progress
  let drag = null;      // a port being dragged
  let editing = null;   // the link whose label editor is open
  let hintShown = false;
  let selectedId = null; // the card last tapped or typed in: where a new question or slide text goes
  let naming = false;     // "Name this deck" was tapped on an empty deck: its title fields show

  // The card tools, drawn as strokes in the app's icon style rather than text arrows,
  // which sit at different heights in different fonts.
  const toolIcon = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const TOOL_UP = toolIcon("M12 19V5M6 11l6-6 6 6");
  const TOOL_DOWN = toolIcon("M12 5v14M6 13l6 6 6-6");
  const TOOL_REMOVE = toolIcon("M6 6l12 12M18 6L6 18");

  function boardEl() { if (!board) buildBoard(); return board; }
  function showBoard() {
    if (GL().wide) { GL().panel.show(boardEl(), "Deck"); draw(); }
    else $("#deckBtn")?.click();
  }

  /** The Deck tab. Wide screens: a summary here, the board on the right. */
  function render(container) {
    container.replaceChildren();
    if (GL().wide) {
      container.append(el("div", { class: "deck-summary" }, [
        el("h2", { text: deck.title || "Deck" }),
        el("p", { text: summaryText() }),
        el("div", { class: "deck-actions" }, [
          el("button", { type: "button", class: "primary", text: "Show the deck", onclick: () => showBoard() }),
          el("button", { type: "button", class: "text-btn", text: "My decks", onclick: () => renderSaved(container) }),
        ]),
        el("p", { class: "deck-hint", text: "Find passages on this side: search, browse, or Ask. Tick a card or tap + to put one on the deck. The deck on the right is where you highlight phrases, draw the arrows between them, and download the PowerPoint." }),
      ]));
      showBoard();
    } else {
      container.append(boardEl());
      draw();
    }
  }
  function summaryText() {
    const n = count(), l = deck.links.length;
    // a deck of questions or slide text alone is not empty, so it does not say so
    if (!n) { const k = deck.items.length; return k ? `${k} ${k === 1 ? "card" : "cards"}, no passages yet.` : "Nothing on the deck yet."; }
    return `${n} ${n === 1 ? "passage" : "passages"}${l ? `, ${l} ${l === 1 ? "connection" : "connections"}` : ""}.`;
  }

  function buildBoard() {
    board = el("div", { class: "board" });
    const title = el("input", { class: "deck-title", placeholder: "Deck title (first slide)", "aria-label": "Deck title" });
    const subtitle = el("input", { class: "deck-subtitle", placeholder: "Subtitle, date, or audience", "aria-label": "Subtitle" });
    title.addEventListener("input", () => { deck.title = title.value; save({ redraw: false }); });
    subtitle.addEventListener("input", () => { deck.subtitle = subtitle.value; save({ redraw: false }); });
    const themes = el("div", { class: "themes" });
    const download = el("button", { type: "button", class: "primary", text: "Download PowerPoint", onclick: () => downloadFile() });
    const present = el("button", { type: "button", class: "primary quiet", text: "Present", onclick: () => presentDeck() });
    const think = el("button", { type: "button", class: "text-btn", text: "Think it through", title: "Claude studies the chain: labels, connections, a caption", onclick: () => thinkChain() });
    const md = el("button", { type: "button", class: "text-btn", text: "Markdown", title: "The deck as Markdown, for Bear or any notes app", onclick: () => exportMarkdown() });
    const more = el("button", { type: "button", class: "text-btn", text: "More", "aria-expanded": "false", onclick: () => { const open = ui.moreRow.hidden; ui.moreRow.hidden = !open; more.setAttribute("aria-expanded", String(open)); } });
    const moreRow = el("div", { class: "deck-actions secondary", hidden: true }, [
      think, md,
      el("button", { type: "button", class: "text-btn", text: "Add section", onclick: () => { deck.items.push({ id: uid(), type: "section", title: "" }); save(); } }),
      el("button", { type: "button", class: "text-btn", text: "Save to my decks", onclick: () => saveNamed() }),
      el("button", { type: "button", class: "text-btn", text: "My decks", onclick: () => showSaved() }),
      el("button", { type: "button", class: "text-btn danger", text: "Start a new deck", onclick: () => {
        if (deck.items.length && !confirm("Start a new, empty deck? The current one is kept only if you saved it.")) return;
        deck = blank(); pending = active = linking = null; naming = false; save();
      } }),
    ]);
    const banner = el("div", { class: "board-banner", hidden: true });
    const hint = el("p", { class: "deck-hint" });
    const thinkBox = el("div", { class: "board-think", hidden: true });
    const actions = el("div", { class: "board-row" }, [download, present, more]);
    const head = el("div", { class: "board-head" }, [title, subtitle, themes, actions, moreRow, banner, thinkBox]);
    const cards = el("div", { class: "board-cards" });
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "board-lines");
    svg.setAttribute("aria-hidden", "true");
    const labels = el("div", { class: "board-labels" });
    const canvas = el("div", { class: "board-canvas" }, [cards, svg, labels]);
    const saved = el("div", { class: "board-saved", hidden: true });
    const status = el("div", { class: "deck-status" });
    board.append(head, canvas, saved, status, hint);
    ui = { title, subtitle, themes, download, present, more, actions, think, md, thinkBox, moreRow, banner, hint, cards, svg, labels, canvas, saved, status };

    cards.addEventListener("click", onCardClick);
    cards.addEventListener("pointerdown", onPortDown);
    const touch = (e) => { const card = e.target.closest && e.target.closest(".bcard"); if (card) select(card.dataset.id); };
    cards.addEventListener("pointerdown", touch);
    cards.addEventListener("focusin", touch);
    window.addEventListener("resize", () => { if (board.isConnected) drawLines(); });
    if (window.ResizeObserver) new ResizeObserver(() => drawLines()).observe(cards);
  }

  function draw() {
    if (!ui) return;
    syncHead();
    drawCards();
    raf(drawLines);
  }
  function syncHead() {
    if (document.activeElement !== ui.title) ui.title.value = deck.title || "";
    if (document.activeElement !== ui.subtitle) ui.subtitle.value = deck.subtitle || "";
    ui.themes.replaceChildren();
    for (const [key, t] of Object.entries(THEMES)) {
      ui.themes.append(el("button", { type: "button", class: "theme" + (deck.theme === key ? " on" : ""), title: t.name, "aria-label": `${t.name} theme`, "aria-pressed": String(deck.theme === key), onclick: () => { deck.theme = key; deck.themeSet = true; save({ redraw: false }); syncHead(); } }, [
        el("span", { class: "swatch", style: `background:#${t.bg};color:#${t.text};border-color:#${t.rule}` }, [el("b", { text: "Aa", style: `color:#${t.text}` }), el("i", { style: `background:#${t.accent}` })]),
        el("span", { class: "theme-name", text: t.name }),
      ]));
    }
    const empty = !deck.items.length;
    // An empty deck has nothing to theme, download or present: the board shows only how to add a passage.
    ui.themes.hidden = empty; ui.actions.hidden = empty;
    // nor anything to name: the title and subtitle wait for the first card, or for "Name this deck"
    const named = !empty || naming || !!(deck.title || deck.subtitle);
    ui.title.hidden = !named; ui.subtitle.hidden = !named;
    ui.moreRow.hidden = empty || ui.more.getAttribute("aria-expanded") !== "true";
    ui.download.disabled = empty; ui.present.disabled = empty;
    ui.think.disabled = count() < 2;
    ui.md.disabled = empty;
    syncDownloadButton();
    schedulePrepare();
    if (linking) {
      const from = endOf(linking);
      ui.banner.hidden = false;
      ui.banner.replaceChildren(
        el("span", { html: `Tap a phrase or a passage to link <b>${esc(from && from.hl ? `“${phraseOf(from.item, from.hl)}”` : from ? from.item.citation : "")}</b> to it.` }),
        el("button", { type: "button", class: "text-btn small", text: "Cancel", onclick: () => { linking = null; draw(); } }),
      );
    } else ui.banner.hidden = true;
    ui.hint.hidden = empty;
    ui.hint.textContent = empty ? ""
      : count() === 1 ? "To highlight: tap the first and last word of a phrase. To link: add another passage, then drag the dot at the end of a highlight onto a phrase there."
      : "To highlight: tap the first and last word of a phrase. To link: drag the dot at the end of a highlight onto a phrase in another passage. To name a link: tap its number.";
  }

  // The selected card wears a quiet outline, so it is plain where the next question will land.
  function select(id) {
    if (selectedId === id || !ui) return;
    selectedId = id;
    for (const c of ui.cards.querySelectorAll(".bcard")) c.classList.toggle("selected", c.dataset.id === id);
  }
  function drawCards() {
    const cards = ui.cards;
    cards.replaceChildren();
    if (selectedId && !byId(selectedId)) selectedId = null;
    deck.items.forEach((it, idx) => {
      const card = el("div", { class: "bcard" + (it.type === "section" ? " section" : "") + (it.id === selectedId ? " selected" : ""), "data-id": it.id, "data-type": it.type });
      const tools = el("div", { class: "bc-tools" }, [
        el("button", { type: "button", "aria-label": "Move up", title: "Move up", html: TOOL_UP, disabled: idx === 0, onclick: (e) => { e.stopPropagation(); move(idx, -1); } }),
        el("button", { type: "button", "aria-label": "Move down", title: "Move down", html: TOOL_DOWN, disabled: idx === deck.items.length - 1, onclick: (e) => { e.stopPropagation(); move(idx, 1); } }),
        el("button", { type: "button", "aria-label": "Remove from the deck", title: "Remove", html: TOOL_REMOVE, onclick: (e) => { e.stopPropagation(); removeItem(it); } }),
      ]);
      if (it.type === "section") {
        const inp = el("input", { value: it.title, placeholder: "Section title", "aria-label": "Section title" });
        inp.addEventListener("input", () => { it.title = inp.value; save({ redraw: false }); });
        card.append(el("div", { class: "bc-head" }, [el("div", { class: "bc-meta" }, [el("div", { class: "bc-kind", text: "Section" }), inp]), tools]));
        card.append(notesEl(it));
        cards.append(card);
        return;
      }
      if (it.type === "question" || it.type === "note") {
        card.classList.add(it.type);
        const ta = el("textarea", { class: "bc-card-text", rows: 2, placeholder: it.type === "question" ? "A question for the room…" : "Words for the room to read: a teaching point, a line to say…", "aria-label": it.type === "question" ? "Question" : "Slide text" });
        ta.value = it.text || "";
        const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(320, ta.scrollHeight + 2) + "px"; };
        ta.addEventListener("input", () => { it.text = ta.value; grow(); save({ redraw: false }); });
        requestAnimationFrame(grow);
        card.append(el("div", { class: "bc-head" }, [el("div", { class: "bc-meta" }, [el("div", { class: "bc-kind", text: it.type === "question" ? "Question" : "Slide text" })]), tools]));
        card.append(ta);
        card.append(notesEl(it));
        cards.append(card);
        return;
      }
      const meta = el("div", { class: "bc-meta" }, [el("div", { class: "bc-cite", text: it.citation })]);
      const port = el("button", { type: "button", class: "port card-port", "data-item": it.id, "data-hl": "", "aria-label": `Link the whole passage ${it.citation}`, title: "Drag to another passage to link the whole passage" });
      card.append(el("div", { class: "bc-head" }, [meta, tools, port]));
      card.append(textEl(it));
      // the talk and conference sit under the words, the way an attribution follows a quote
      if (it.where || it.label) card.append(el("div", { class: "bc-src", text: [it.where, it.label].filter(Boolean).join(", ") }));
      card.append(notesEl(it));
      if (pending && pending.id === it.id) card.append(el("div", { class: "bc-hint", text: "Now tap the last word of the phrase." }));
      if (active && active.id === it.id) {
        const h = hlById(it, active.hl);
        if (h) card.append(el("div", { class: "hl-tools" }, [
          el("span", { class: "ph", text: `“${phraseOf(it, h)}”` }),
          el("button", { type: "button", class: "chip small", text: "Link to…", onclick: (e) => { e.stopPropagation(); linking = { id: it.id, hl: h.id }; active = null; draw(); } }),
          el("button", { type: "button", class: "chip small", text: "Remove highlight", onclick: (e) => { e.stopPropagation(); removeHighlight(it, h); active = null; save(); } }),
          el("button", { type: "button", class: "chip small", text: "Done", onclick: (e) => { e.stopPropagation(); active = null; draw(); } }),
        ]));
      }
      const mine = deck.links.filter((l) => l.from.id === it.id || l.to.id === it.id);
      if (mine.length) {
        const row = el("div", { class: "bc-links" });
        for (const l of mine) {
          const out = l.from.id === it.id;
          const other = endOf(out ? l.to : l.from);
          if (!other) continue;
          const otherText = other.hl ? `: “${phraseOf(other.item, other.hl)}”` : "";
          row.append(el("button", { type: "button", class: "chip small link-chip" + (l.label ? "" : " unlabeled"), title: "Edit this connection", onclick: (e) => { e.stopPropagation(); openLabelEditor(l, e.currentTarget); } }, [
            el("b", { text: String(linkNumber(l)) }),
            ` ${out ? "→" : "←"} ${shortCitation(other.item)}${otherText}`,
            el("i", { text: l.label ? `, ${l.label}` : ", add a label" }),
          ]));
        }
        card.append(row);
      }
      cards.append(card);
    });
    // A question or slide text is added from the foot of the list, after the selected card.
    if (deck.items.length) cards.append(el("div", { class: "board-foot" }, [
      el("button", { type: "button", class: "foot-add", text: "+ Question", title: "A question for the room, as a slide of its own, after the selected card", onclick: () => addCard("question") }),
      el("button", { type: "button", class: "foot-add", text: "+ Slide text", title: "Words for the room to read, as a slide of its own, after the selected card", onclick: () => addCard("note") }),
    ]));
    if (!deck.items.length) {
      const savedAny = savedDecks.length > 0;
      cards.append(el("div", { class: "board-empty" }, [
        el("p", { text: "To add a passage, tap + on a search result, tick one under an Ask answer, or select verses while reading and choose Add to deck." }),
        naming || deck.title || deck.subtitle ? null : el("button", { type: "button", class: "text-btn", text: "Name this deck", onclick: () => { naming = true; draw(); ui.title.focus(); } }),
        savedAny ? el("button", { type: "button", class: "text-btn", text: "Open one of my decks", onclick: () => showSaved() }) : null,
      ].filter(Boolean)));
    }
  }
  function speakerNotes(s, it) { const text = (it.notes || "").trim(); if (text) { try { s.addNotes(text); } catch (_) {} } }
  // A question or slide text (kind "note" in the data, so saved decks still load): a slide of its
  // own, with words the teacher writes. It goes in after the card last touched, or at the end.
  // focus: the board's own buttons put the cursor in the new card; a card sent from Ask or a word
  // sheet leaves focus on the button that sent it.
  function addCard(type, { focus = true } = {}) {
    const item = { id: uid(), type, text: "", notes: "" };
    const at = selectedId ? deck.items.findIndex((i) => i.id === selectedId) : -1;
    if (at >= 0) deck.items.splice(at + 1, 0, item); else deck.items.push(item);
    selectedId = item.id;
    save();
    if (focus) requestAnimationFrame(() => { const ta = ui && ui.cards.querySelector(`.bcard[data-id="${item.id}"] textarea`); if (ta) ta.focus(); });
    return item;
  }
  // Speaker notes on any card: what to say, folded away until wanted; they travel into the PowerPoint
  function notesEl(it) {
    const wrap = el("div", { class: "bc-notes" + (it.notes ? " has" : "") });
    const toggle = el("button", { type: "button", class: "text-btn small notes-toggle", text: it.notes ? "Speaker notes" : "Add speaker notes", "aria-expanded": "false", onclick: (e) => { e.stopPropagation(); const open = ta.hidden; ta.hidden = !open; toggle.setAttribute("aria-expanded", String(open)); if (open) { grow(); ta.focus(); } } });
    const ta = el("textarea", { class: "bc-notes-text", rows: 2, hidden: true, placeholder: "What to say when this slide is up (goes into the PowerPoint as speaker notes)", "aria-label": "Speaker notes" });
    ta.value = it.notes || "";
    const grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(240, ta.scrollHeight + 2) + "px"; };
    ta.addEventListener("input", () => { it.notes = ta.value; wrap.classList.toggle("has", !!ta.value.trim()); toggle.textContent = ta.value.trim() ? "Speaker notes" : "Add speaker notes"; grow(); save({ redraw: false }); });
    ta.addEventListener("click", (e) => e.stopPropagation());
    wrap.append(toggle, ta);
    return wrap;
  }
  // A passage as tappable words, with verse numbers, highlights and a port after each highlight.
  // A highlighted phrase is one run (its words and the spaces between them in one span), so it
  // reads as a phrase, not a row of boxes, and its active outline goes round the whole of it.
  function textEl(it) {
    const text = el("div", { class: "bc-text" });
    const words = wordsOf(it);
    let host = text;
    words.forEach((x, i) => {
      if (x.first && x.para > 0) host.append(el("br"), el("br"));
      if (x.n !== null && x.n !== undefined) host.append(el("span", { class: "vn", text: String(x.n) }));
      const h = hlAt(it, i);
      if (h && host === text) {
        host = el("span", { class: "hl-run" + (active && active.id === it.id && active.hl === h.id ? " active" : ""), "data-hl": h.id });
        text.append(host);
      }
      const cls = ["w"];
      if (h) { cls.push("hl"); if (h.s === i) cls.push("hl-s"); if (h.e === i) cls.push("hl-e"); }
      if (pending && pending.id === it.id && pending.i === i) cls.push("first");
      host.append(el("span", { class: cls.join(" "), "data-i": String(i), text: x.w }));
      if (h && h.e === i) {
        host = text;
        text.append(el("button", { type: "button", class: "port", "data-item": it.id, "data-hl": h.id, "aria-label": `Link “${phraseOf(it, h)}” to another passage`, title: "Drag onto a phrase in another passage to link them" }));
      }
      host.append(" ");
    });
    return text;
  }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= deck.items.length) return;
    [deck.items[i], deck.items[j]] = [deck.items[j], deck.items[i]];
    save();
  }

  // Taps: mark phrases (first word, then last), pick a highlight, or finish a tap-to-link.
  function onCardClick(e) {
    if (drag) return;
    const port = e.target.closest(".port");
    const card = e.target.closest(".bcard");
    if (!card || card.dataset.type !== "passage") return;
    const item = byId(card.dataset.id);
    if (!item) return;
    const w = e.target.closest(".w");
    const run = !w && e.target.closest(".hl-run"); // the space between two words of a phrase
    if (linking) {
      if (item.id === linking.id) return;
      const i = w ? Number(w.dataset.i) : null;
      const h = port ? hlById(item, port.dataset.hl) : i !== null ? hlAt(item, i) : run ? hlById(item, run.dataset.hl) : null;
      const from = linking; linking = null;
      finishLink(from, { item, hl: h ? h.id : null, word: !h && i !== null ? i : null });
      return;
    }
    if (port) {
      if (!hintShown) { hintShown = true; GL().toast("Drag this dot onto a phrase in another passage to link them."); }
      return;
    }
    if (run) { const h = hlById(item, run.dataset.hl); if (h) { active = active && active.hl === h.id ? null : { id: item.id, hl: h.id }; pending = null; draw(); } return; }
    if (!w) { if (pending || active) { pending = null; active = null; draw(); } return; }
    const i = Number(w.dataset.i);
    if (pending && pending.id === item.id) {
      const h = setHighlight(item, pending.i, i);
      pending = null; active = { id: item.id, hl: h.id };
      save();
      return;
    }
    const h = hlAt(item, i);
    if (h) { active = active && active.hl === h.id ? null : { id: item.id, hl: h.id }; pending = null; draw(); return; }
    pending = { id: item.id, i }; active = null;
    draw();
  }

  // Drag a port onto a phrase, a port, or a card in another passage.
  function onPortDown(e) {
    const port = e.target.closest(".port");
    if (!port || (e.button !== undefined && e.button > 0)) return;
    e.preventDefault();
    const from = { id: port.dataset.item, hl: port.dataset.hl || null };
    const start = portPoint(from, ui.canvas.getBoundingClientRect());
    if (!start) return;
    const temp = document.createElementNS(SVG, "path");
    temp.setAttribute("class", "blink temp");
    temp.setAttribute("marker-end", "url(#bArrow)");
    ui.svg.append(temp);
    board.classList.add("dragging");
    port.classList.add("src");
    try { port.setPointerCapture(e.pointerId); } catch (_) {}
    closeEditor();
    drag = { from, port, temp, start, target: null, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, loop: null };
    const update = () => {
      if (!drag) return;
      const c = ui.canvas.getBoundingClientRect();
      const px = drag.x - c.left, py = drag.y - c.top;
      temp.setAttribute("d", `M ${start.x} ${start.y} C ${start.x + 70} ${start.y}, ${px - 70} ${py}, ${px} ${py}`);
      setDropTarget(resolveAt(drag.x, drag.y, from));
    };
    const onMove = (ev) => {
      drag.x = ev.clientX; drag.y = ev.clientY;
      if (Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) > 6) drag.moved = true;
      update();
    };
    const onEnd = (ev) => {
      port.removeEventListener("pointermove", onMove);
      port.removeEventListener("pointerup", onEnd);
      port.removeEventListener("pointercancel", onEnd);
      try { port.releasePointerCapture(ev.pointerId); } catch (_) {}
      if (drag.loop) cancelAnimationFrame(drag.loop);
      temp.remove();
      board.classList.remove("dragging");
      port.classList.remove("src");
      const target = ev.type === "pointerup" && drag.moved ? resolveAt(ev.clientX, ev.clientY, from) : null;
      setDropTarget(null);
      const moved = drag.moved;
      drag = null;
      if (target) finishLink(from, target);
      else if (!moved && !hintShown) { hintShown = true; GL().toast("Drag this dot onto a phrase in another passage to link them."); }
    };
    port.addEventListener("pointermove", onMove);
    port.addEventListener("pointerup", onEnd);
    port.addEventListener("pointercancel", onEnd);
    // Scroll the pane when the finger nears its edge, so far-away passages can be reached.
    const scroller = scrollerOf(ui.canvas);
    const step = () => {
      if (!drag) return;
      const r = scroller === document.scrollingElement || scroller === document.documentElement ? { top: 0, bottom: window.innerHeight } : scroller.getBoundingClientRect();
      let dy = 0;
      if (drag.y < r.top + 60) dy = -Math.min(18, Math.ceil((r.top + 60 - drag.y) / 3));
      else if (drag.y > r.bottom - 60) dy = Math.min(18, Math.ceil((drag.y - (r.bottom - 60)) / 3));
      if (dy && scroller.scrollBy) { scroller.scrollBy(0, dy); update(); }
      drag.loop = requestAnimationFrame(step);
    };
    if (window.requestAnimationFrame) drag.loop = requestAnimationFrame(step);
  }
  function scrollerOf(node) {
    for (let n = node.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowY;
      if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  }
  /** What is under the pointer: a port, a word (or the nearest one), or a whole card. */
  function resolveAt(x, y, from) {
    const node = document.elementFromPoint(x, y);
    if (!node || !node.closest) return null;
    const card = node.closest(".bcard");
    if (!card || card.dataset.type !== "passage" || card.dataset.id === from.id) return null;
    const item = byId(card.dataset.id);
    if (!item) return null;
    const port = node.closest(".port");
    if (port) return { item, hl: port.dataset.hl || null, word: null, el: port };
    let w = node.closest(".w");
    const text = node.closest(".bc-text");
    if (!w && text) w = nearestWord(text, x, y);
    if (w) { const i = Number(w.dataset.i); const h = hlAt(item, i); return { item, hl: h ? h.id : null, word: h ? null : i, el: w }; }
    return { item, hl: null, word: null, el: card };
  }
  function nearestWord(text, x, y) {
    let best = null, bestD = Infinity;
    for (const w of text.querySelectorAll(".w")) {
      const r = w.getBoundingClientRect();
      const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      const d = dy * 4 + dx;
      if (d < bestD) { bestD = d; best = w; }
    }
    return bestD < 80 ? best : null;
  }
  function setDropTarget(t) {
    if (drag && drag.target && drag.target.el) drag.target.el.classList.remove("drop");
    if (drag) drag.target = t;
    if (t && t.el) t.el.classList.add("drop");
  }
  function finishLink(from, t) {
    let hl = t.hl;
    if (!hl && t.word !== null && t.word !== undefined) hl = setHighlight(t.item, t.word, t.word).id;
    const link = addLink(from, { id: t.item.id, hl });
    if (!link) return;
    active = null; pending = null;
    save();
    GL().toast("Linked.");
    raf(() => raf(() => { const pill = ui.labels.querySelector(`[data-link="${link.id}"]`); if (pill) openLabelEditor(link, pill); }));
  }

  // The arrows: from the port at the end of one highlight, out through the
  // right-hand gutter, into the port of the other. Positions are measured
  // from the live layout, so they follow scrolling, wrapping and reordering.
  function drawLines() {
    if (!ui || !board.isConnected) return;
    const cr = ui.canvas.getBoundingClientRect();
    const W = Math.max(1, cr.width), H = Math.max(1, cr.height);
    ui.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const defs = document.createElementNS(SVG, "defs");
    defs.innerHTML = `<marker id="bArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker>`;
    ui.svg.replaceChildren(defs);
    ui.labels.replaceChildren();
    let k = 0;
    for (const l of deck.links) {
      const a = portPoint(l.from, cr), b = portPoint(l.to, cr);
      if (!a || !b) continue;
      const gx = W - 15 - (k % 3) * 4;
      const bx = b.x + 10;
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", `M ${a.x} ${a.y} C ${gx} ${a.y}, ${gx} ${b.y}, ${bx} ${b.y}`);
      path.setAttribute("class", "blink" + (editing === l ? " on" : ""));
      path.setAttribute("marker-end", "url(#bArrow)");
      ui.svg.append(path);
      // A numbered badge on the arrow's run down the gutter; the label itself
      // is read on the chip under each card, where there is room for it.
      ui.labels.append(el("button", { type: "button", class: "blabel" + (l.label ? "" : " empty") + (editing === l ? " on" : ""), "data-link": l.id, text: String(linkNumber(l)), title: l.label ? `${l.label} (edit)` : "Name this connection",
        "aria-label": `Connection ${linkNumber(l)}${l.label ? `: ${l.label}` : ""}`, style: `left:${gx}px;top:${(a.y + b.y) / 2}px`, onclick: (e) => { e.stopPropagation(); openLabelEditor(l, e.currentTarget); } }));
      k++;
    }
  }
  const linkNumber = (l) => deck.links.indexOf(l) + 1;
  function portPoint(end, cr) {
    const p = ui.cards.querySelector(`.port[data-item="${end.id}"][data-hl="${end.hl || ""}"]`);
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: r.left + r.width / 2 - cr.left, y: r.top + r.height / 2 - cr.top };
  }

  // The label editor: what the arrow says, its direction, or remove it.
  let outside = null;
  function openLabelEditor(link, anchor) {
    closeEditor();
    editing = link;
    const a = endOf(link.from), b = endOf(link.to);
    const name = (end) => (end ? (end.hl ? `“${phraseOf(end.item, end.hl)}”` : end.item.citation) : "");
    const input = el("input", { class: "deck-subtitle", placeholder: "What the arrow says", value: link.label || "", "aria-label": "Connection label", autocapitalize: "off" });
    const setLabel = (v) => { link.label = v; input.value = v; save({ redraw: false }); const pill = ui.labels.querySelector(`[data-link="${link.id}"]`); if (pill) { pill.classList.toggle("empty", !v); pill.title = v ? `${v} (edit)` : "Name this connection"; } };
    input.addEventListener("input", () => setLabel(input.value));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); closeEditor(); draw(); } });
    const pop = el("div", { class: "bpop", role: "dialog", "aria-label": "Connection" }, [
      el("div", { class: "bpop-t", html: `<b class="num">${linkNumber(link)}</b> ${esc(name(a))} <span class="arrow">→</span> ${esc(name(b))}` }),
      el("div", { class: "bpop-s", text: `${a ? a.item.citation : ""} → ${b ? b.item.citation : ""}` }),
      input,
      el("div", { class: "shelf" }, QUICK_LABELS.map((q) => el("button", { type: "button", class: "chip small" + (link.label === q ? " on" : ""), text: q, onclick: () => { setLabel(q); closeEditor(); draw(); } }))),
      el("div", { class: "deck-actions" }, [
        el("button", { type: "button", class: "primary", text: "Done", onclick: () => { closeEditor(); draw(); } }),
        el("button", { type: "button", class: "text-btn", text: "Swap direction", onclick: () => { [link.from, link.to] = [link.to, link.from]; closeEditor(); save(); } }),
        el("button", { type: "button", class: "text-btn danger", text: "Remove link", onclick: () => { deck.links = deck.links.filter((x) => x !== link); closeEditor(); save(); GL().toast("Connection removed."); } }),
      ]),
    ]);
    const cr = ui.canvas.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    const width = Math.min(380, cr.width - 16);
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(8, Math.min(ar.left - cr.left - width / 2 + ar.width / 2, cr.width - width - 8))}px`;
    pop.style.top = `${ar.bottom - cr.top + 8}px`;
    ui.canvas.append(pop);
    ui.pop = pop;
    drawLines();
    outside = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { closeEditor(); draw(); } };
    setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    if (GL().wide) input.focus();
  }
  function closeEditor() {
    if (outside) { document.removeEventListener("pointerdown", outside, true); outside = null; }
    if (ui && ui.pop) { ui.pop.remove(); ui.pop = null; }
    editing = null;
  }

  // ------------------------------------------------------------ new topic --
  // A new search or question while a deck is in progress: clear it, save it
  // as it is and start a new one, or keep adding to it. Asked only about a deck
  // left over from an earlier day, and once: a deck being built now (search,
  // add, search again) never interrupts, and the answer is kept across launches.
  const SESSION_START = Date.now();
  let asking = null;
  function shouldAsk() { return count() > 0 && deck.updated < SESSION_START - 60 * 1000 && store.get("deckKept") !== deck.id; }
  function askAboutDeck({ kind = "search" } = {}) {
    if (asking) return asking;
    if (!shouldAsk()) return Promise.resolve("keep");
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    asking = new Promise((resolve) => {
      const n = count(), l = deck.links.length;
      const scrim = el("div", { class: "dscrim" });
      const sheet = el("div", { class: "dsheet", role: "dialog", "aria-modal": "true", "aria-label": "Deck in progress" });
      const onKey = (e) => { if (e.key === "Escape") finish("cancel"); };
      const finish = (v) => { scrim.remove(); sheet.remove(); document.removeEventListener("keydown", onKey); asking = null; resolve(v); };
      const what = `${n} ${n === 1 ? "passage" : "passages"}${l ? ` and ${l} ${l === 1 ? "connection" : "connections"}` : ""}`;
      const name = el("input", { class: "deck-subtitle", value: deck.title || `Deck ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })}`, "aria-label": "Name for the saved deck", autocapitalize: "words" });
      const nameRow = el("div", { class: "dsheet-save", hidden: true }, [
        el("label", { text: "Save it as" }),
        name,
        el("button", { type: "button", class: "primary", text: "Save, then start a new deck", onclick: () => {
          const v = name.value.trim();
          if (!deck.title && v) deck.title = v;
          saveNamed(v);
          deck = blank(); pending = active = linking = null; naming = false; save();
          GL().toast(`Saved “${v || deck.title}”. The deck is empty.`);
          finish("new");
        } }),
      ]);
      sheet.append(
        el("h2", { text: `Clear the deck for this ${kind}?` }),
        el("p", { class: "lede", text: `${deck.title ? `“${deck.title}” has` : "The deck has"} ${what}.` }),
        el("button", { type: "button", class: "primary", text: "No, keep adding to it", onclick: () => { store.set("deckKept", deck.id); finish("keep"); } }),
        el("button", { type: "button", class: "text-btn", text: "No, save it as it is, then start a new deck", onclick: (e) => { nameRow.hidden = false; e.currentTarget.hidden = true; name.focus(); name.select(); } }),
        nameRow,
        el("button", { type: "button", class: "text-btn danger", text: "Yes, delete it and start over", onclick: () => { deck = blank(); pending = active = linking = null; naming = false; save(); GL().toast("The deck is empty."); finish("new"); } }),
        el("button", { type: "button", class: "text-btn", text: "Cancel", onclick: () => finish("cancel") }),
      );
      scrim.addEventListener("click", () => finish("cancel"));
      document.addEventListener("keydown", onKey);
      document.body.append(scrim, sheet);
    });
    return asking;
  }

  // ------------------------------------------------------------ markdown --
  // The deck as a Markdown note (Bear, Obsidian, Notes): the title as the
  // heading, sections, each passage as a quote with the highlights in bold
  // and the attribution under it, each connection as a quote pair, and the
  // chain at the end with its caption and notes.
  function mdWords(it, s, e, highlightFrom = null) {
    // words s..e of the passage, highlighted runs wrapped in **…**
    const words = wordsOf(it);
    const parts = [];
    let open = false;
    for (let i = s; i <= e && i < words.length; i++) {
      const hl = highlightFrom ? (i >= highlightFrom.s && i <= highlightFrom.e) : inHl(it, i);
      if (words[i].n !== null && words[i].n !== undefined && !highlightFrom) { if (open) { parts[parts.length - 1] += "**"; open = false; } parts.push(`**${words[i].n}**`); }
      if (words[i].first && words[i].para > 0 && i > s) { if (open) { parts[parts.length - 1] += "**"; open = false; } parts.push("\n>\n> "); }
      let w = words[i].w;
      if (hl && !open) { w = "**" + w; open = true; }
      if (!hl && open) { parts[parts.length - 1] += "**"; open = false; }
      parts.push(w);
    }
    if (open) parts[parts.length - 1] += "**";
    return parts.join(" ").replace(/ *\n>\n> */g, "\n>\n> ").replace(/\*\* \*\*/g, " ");
  }
  function excerptMd(it, hl) {
    const ex = excerpt(it, hl);
    const s0 = ex.start || 0;
    const body = hl ? mdWords(it, s0, s0 + ex.words.length - 1, { s: s0 + ex.s, e: s0 + ex.e }) : ex.words.map((x) => x.w).join(" ");
    return (ex.before ? "… " : "") + body + (ex.after ? " …" : "");
  }
  function markdownOf() {
    const out = [`# ${deck.title || "Scriptures"}`];
    if (deck.subtitle) out.push(deck.subtitle);
    out.push("");
    for (const it of sequence()) {
      const notes = it.notes && it.notes.trim() ? [`*Speaker notes: ${it.notes.trim().replace(/\n+/g, " ")}*`, ""] : [];
      if (it.type === "section") { out.push(`## ${it.title || "—"}`, "", ...notes); continue; }
      if (it.type === "question") { out.push(`### Question`, "", it.text || "", "", ...notes); continue; }
      if (it.type === "note") { out.push(`### Slide text`, "", it.text || "", "", ...notes); continue; }
      if (it.type === "link") {
        const a = endOf(it.from), b = endOf(it.to);
        if (!a || !b) continue;
        out.push(`### ${a.item.citation} → ${b.item.citation}${it.label ? `: ${it.label}` : ""}`);
        out.push(`> ${excerptMd(a.item, a.hl)}`, `>`, `> → ${excerptMd(b.item, b.hl)}`, "");
        continue;
      }
      out.push(`### ${it.citation}`);
      out.push(`> ${mdWords(it, 0, wordsOf(it).length - 1)}`);
      if (it.where || it.label) out.push(`>`, `> ${[it.where, it.label].filter(Boolean).join(", ")}`);
      out.push("", ...notes);
    }
    if (deck.links.length) {
      out.push("## The chain", "");
      for (const l of deck.links) {
        const a = endOf(l.from), b = endOf(l.to);
        if (!a || !b) continue;
        out.push(`- ${a.item.citation}${a.hl ? ` “${phraseOf(a.item, a.hl)}”` : ""} → ${b.item.citation}${b.hl ? ` “${phraseOf(b.item, b.hl)}”` : ""}${l.label ? ` (${l.label})` : ""}`);
      }
      if (deck.chain && deck.chain.caption) out.push("", `*${deck.chain.caption}*`);
      if (deck.chain && deck.chain.notes) out.push("", "### Notes", "", deck.chain.notes);
      out.push("");
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }
  function exportMarkdown() {
    const text = markdownOf();
    const name = `${(deck.title || "Scriptures").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Scriptures"}.md`;
    const scrim = el("div", { class: "dscrim" });
    const sheet = el("div", { class: "dsheet", role: "dialog", "aria-label": "Markdown" });
    const close = () => { scrim.remove(); sheet.remove(); };
    const msg = el("p", { class: "lede", text: `${text.split("\n").length} lines. Copy it and paste into a new Bear note, or save the file and share it to Bear.` });
    sheet.append(
      el("h2", { text: "The deck as Markdown" }),
      msg,
      el("button", { type: "button", class: "primary", text: "Copy", onclick: async () => {
        try { await navigator.clipboard.writeText(text); msg.textContent = "Copied. Paste it into a new note."; }
        catch (_) { const ta = el("textarea", { class: "ask-input", rows: 8 }); ta.value = text; sheet.insertBefore(ta, msg.nextSibling); ta.select(); msg.textContent = "Select all and copy from the box."; }
      } }),
      el("button", { type: "button", class: "text-btn", text: "Save .md file", onclick: async () => {
        const file = new File([text], name, { type: "text/markdown" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); close(); return; } catch (err) { if (err.name === "AbortError") return; } }
        const url = URL.createObjectURL(file);
        const a = el("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        msg.textContent = `Saved ${name}.`;
      } }),
      el("button", { type: "button", class: "text-btn", text: "Cancel", onclick: close }),
    );
    scrim.addEventListener("click", close);
    document.body.append(scrim, sheet);
  }

  // ------------------------------------------------------------ thinking --
  // Claude studies the chain: the passages in order, their highlighted
  // phrases, the arrows drawn so far. It returns labels for unlabeled arrows,
  // connections not yet drawn (with the exact phrases), a key phrase for any
  // passage without one, a caption for the chain slide, and speaker notes.
  // Each is accepted one at a time; nothing changes until it is.
  const CHAIN_SYSTEM = `You are helping a mission president finish a scripture chain for a presentation. He has chosen the passages, highlighted key phrases in some, and drawn arrows between some of them. Study the whole chain as a careful teacher would: what each passage contributes, which words or ideas carry from one to another (the same word, a definition, a promise and its keeping, a cause and its effect, a contrast), and what the chain says when it is read from the first passage to the last, in the order given.

Answer with JSON only, no prose around it, in this shape:
{"caption": "one or two sentences: how the chain reads from start to finish, for the slide",
 "labels": [{"link": 1, "label": "two to four words"}],
 "connections": [{"from": {"passage": 1, "words": "exact words from that passage"}, "to": {"passage": 3, "words": "exact words from that passage"}, "label": "two to four words", "why": "one sentence"}],
 "key_phrases": [{"passage": 2, "words": "exact words from that passage"}],
 "notes": "speaker notes, 120 to 220 words: how to walk the room through the chain, passage by passage"}

Rules. "labels" only for arrows that have no label or a weak one. "connections" only for arrows worth drawing that are not drawn; three at most; each must join two different passages and be something the words themselves support. "key_phrases" only for passages that have no highlighted phrase: the short phrase (three to eight words) a teacher would underline. Every "words" value must be copied exactly from the passage text given, with its punctuation; never paraphrase, never quote from memory. Plain, warm, doctrinally precise prose; no em dashes.`;

  function chainUser(context = new Map()) {
    const passages = deck.items.filter((i) => i.type === "passage");
    const num = new Map(passages.map((p, i) => [p.id, i + 1]));
    const lines = [deck.title ? `Deck title: ${deck.title}` : "", "Passages, in the order they are presented:"];
    passages.forEach((p, i) => {
      const words = wordsOf(p);
      const hl = (p.hl || []).map((h) => `“${words.slice(h.s, h.e + 1).map((x) => x.w).join(" ")}”`);
      const around = context.get(p.id);
      lines.push(`[${i + 1}] ${p.citation}${p.where ? `, ${p.where}` : ""}${p.label ? `, ${p.label}` : ""}\n${p.verses ? p.verses.map((v) => `${v.n} ${v.text}`).join(" ") : p.text}\nHighlighted: ${hl.length ? hl.join("; ") : "nothing yet"}${around ? `\nAround it on the page (for its setting, not for the slide): ${around}` : ""}${p.notes ? `\nHis speaker notes: ${p.notes}` : ""}`);
    });
    const cards = deck.items.filter((i) => i.type === "question" || i.type === "note").filter((i) => (i.text || "").trim());
    if (cards.length) lines.push("Question and slide-text slides he has written, in order:\n" + cards.map((c) => `- ${c.type === "question" ? "Question" : "Slide text"}: ${c.text.trim()}`).join("\n"));
    lines.push(deck.links.length ? "Arrows drawn so far:" : "No arrows drawn yet.");
    deck.links.forEach((l, i) => {
      const a = endOf(l.from), b = endOf(l.to);
      if (!a || !b) return;
      lines.push(`${i + 1}. [${num.get(a.item.id)}] ${a.hl ? `“${phraseOf(a.item, a.hl)}”` : "(whole passage)"} → [${num.get(b.item.id)}] ${b.hl ? `“${phraseOf(b.item, b.hl)}”` : "(whole passage)"}${l.label ? ` (label: ${l.label})` : " (no label yet)"}`);
    });
    return lines.filter(Boolean).join("\n\n");
  }
  // Where a run of words sits in a passage, by matching the words themselves (case and punctuation aside).
  function findPhrase(it, text) {
    const norm = (w) => w.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[^a-z0-9']/g, "");
    const target = String(text || "").split(/\s+/).map(norm).filter(Boolean);
    const words = wordsOf(it).map((x) => norm(x.w));
    if (!target.length) return null;
    for (let i = 0; i + target.length <= words.length; i++) {
      let ok = true;
      for (let j = 0; j < target.length; j++) if (words[i + j] !== target[j]) { ok = false; break; }
      if (ok) return { s: i, e: i + target.length - 1 };
    }
    return null;
  }
  async function thinkChain() {
    const Ask = window.Ask;
    if (!Ask || !Ask.hasKey()) { GL().toast("Add your Claude API key under Ask first."); return; }
    if (count() < 2) { GL().toast("Put at least two passages on the deck first."); return; }
    const box = ui.thinkBox;
    box.hidden = false;
    const status = el("div", { class: "think-status", text: `${Ask.modelName()} is studying the chain…` });
    box.replaceChildren(el("div", { class: "think-head" }, [el("b", { text: "Thinking it through" }), el("button", { type: "button", class: "text-btn small", text: "Close", onclick: () => { box.hidden = true; box.replaceChildren(); } })]), status);
    ui.think.disabled = true;
    try {
      const sk = GL().skills || {};
      const system = [{ type: "text", text: CHAIN_SYSTEM + (sk.style ? `\n\nHouse style for the caption and notes:\n${sk.style}` : ""), cache_control: { type: "ephemeral" } }];
      let thought = "";
      const context = await contextAround();
      const text = await Ask.complete({ model: Ask.settings.model, system, messages: [{ role: "user", content: chainUser(context) }], max_tokens: 16000, stream: true, thinking: Ask.settings.think,
        onThinking: (t) => { thought = (thought + t).slice(-2000); status.textContent = `Thinking: ${thought.replace(/\s+/g, " ").trim().slice(-160)}`; },
        onDelta: () => { status.textContent = "Writing…"; } });
      const m = String(text).match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no JSON in the reply");
      renderThought(JSON.parse(m[0]), box);
    } catch (err) {
      status.textContent = `Could not think it through: ${err.message}`;
    } finally { ui.think.disabled = count() < 2; }
  }
  // The verse or paragraph before and after each passage, from the library, so the chain is read in its setting
  async function contextAround() {
    const out = new Map();
    const passages = deck.items.filter((i) => i.type === "passage" && i.doc_id && i.pid);
    await Promise.all(passages.map(async (p) => {
      try {
        const ctx = await GL().api("context", { doc_id: p.doc_id, pid: p.pid, before: 1, after: (p.verses ? p.verses.length : 1) });
        if (!ctx || !ctx.paragraphs) return;
        const own = new Set(p.verses ? p.verses.map((v) => v.n) : []);
        const near = ctx.paragraphs.filter((x) => x.pid !== p.pid && !(x.verse && own.has(x.verse))).map((x) => `${x.verse ? `${x.verse} ` : ""}${(x.text || "").slice(0, 300)}`);
        if (near.length) out.set(p.id, near.join(" | "));
      } catch (_) { /* no context, no harm */ }
    }));
    return out;
  }
  function renderThought(r, box) {
    const passages = deck.items.filter((i) => i.type === "passage");
    const byNum = (n) => passages[Number(n) - 1] || null;
    const list = el("div", { class: "think-list" });
    const row = (text, btn, act) => { const b = el("button", { type: "button", class: "chip small", text: btn }); const line = el("div", { class: "think-row" }, [el("span", { html: text }), b]); b.addEventListener("click", () => { const ok = act(); if (ok !== false) { b.textContent = "Done"; b.disabled = true; } }); list.append(line); return line; };
    const applied = [];
    if (r.caption) { const cap = String(r.caption).trim(); applied.push(row(`<b>Caption for the chain slide:</b> ${esc(cap)}`, "Use", () => { deck.chain = { ...(deck.chain || {}), caption: cap }; save({ redraw: false }); flash("Caption added to the chain slide."); })); }
    for (const x of r.labels || []) {
      const l = deck.links[Number(x.link) - 1];
      if (!l || !x.label) continue;
      applied.push(row(`<b>Label arrow ${x.link}:</b> “${esc(x.label)}”${l.label ? ` (now “${esc(l.label)}”)` : ""}`, "Apply", () => { l.label = String(x.label).trim(); save(); }));
    }
    for (const c of r.connections || []) {
      const a = byNum(c.from?.passage), b = byNum(c.to?.passage);
      if (!a || !b || a === b) continue;
      const ra = findPhrase(a, c.from.words), rb = findPhrase(b, c.to.words);
      const text = `<b>Connect</b> ${esc(a.citation)} “${esc(c.from.words)}” → ${esc(b.citation)} “${esc(c.to.words)}”${c.label ? `, <i>${esc(c.label)}</i>` : ""}${c.why ? `<br><span class="why">${esc(c.why)}</span>` : ""}${!ra || !rb ? `<br><span class="why">(those words were not found exactly; it will link the whole passage on that side)</span>` : ""}`;
      applied.push(row(text, "Add", () => {
        const from = { id: a.id, hl: ra ? (hlAt(a, ra.s) && hlAt(a, ra.s).e === ra.e && hlAt(a, ra.s).s === ra.s ? hlAt(a, ra.s).id : setHighlight(a, ra.s, ra.e).id) : null };
        const to = { id: b.id, hl: rb ? (hlAt(b, rb.s) && hlAt(b, rb.s).e === rb.e && hlAt(b, rb.s).s === rb.s ? hlAt(b, rb.s).id : setHighlight(b, rb.s, rb.e).id) : null };
        addLink(from, to, String(c.label || "").trim()); save();
      }));
    }
    for (const k of r.key_phrases || []) {
      const p = byNum(k.passage);
      if (!p || !k.words) continue;
      const range = findPhrase(p, k.words);
      if (!range) continue;
      applied.push(row(`<b>Highlight in ${esc(p.citation)}:</b> “${esc(k.words)}”`, "Highlight", () => { setHighlight(p, range.s, range.e); save(); }));
    }
    if (r.notes) { const notes = String(r.notes).trim(); applied.push(row(`<b>Speaker notes for the chain slide:</b> ${esc(notes)}`, "Add", () => { deck.chain = { ...(deck.chain || {}), notes }; save({ redraw: false }); flash("Notes added to the chain slide."); })); }
    if (!applied.length) list.append(el("div", { class: "deck-hint", text: "Nothing to add: the chain reads well as it is." }));
    const all = el("button", { type: "button", class: "primary", text: "Use everything", onclick: () => { for (const line of list.querySelectorAll(".think-row button:not(:disabled)")) line.click(); } });
    box.querySelector(".think-status")?.remove();
    box.append(list, el("div", { class: "deck-actions" }, [all]));
  }

  // Saved decks
  // Saved decks: kept in memory, each written to the database on its own. No cap: the database
  // has room, and dropping the oldest without a word is what this storage is here to stop.
  function saveNamed(nameGiven) {
    const name = (nameGiven || "").trim() || deck.title || `Deck ${new Date().toLocaleDateString()}`;
    const entry = { id: deck.id, title: name, updated: Date.now(), deck: JSON.parse(JSON.stringify(deck)) };
    savedDecks = [entry, ...savedDecks.filter((d) => d.id !== deck.id)];
    putSaved(entry).then((ok) => { if (ok !== false) flash(`Saved “${name}”.`); });
  }
  function renameSaved(d) {
    const name = (prompt("A new name for this deck", d.title) || "").trim();
    if (!name || name === d.title) return false;
    d.title = name;
    if (d.deck) d.deck.title = d.deck.title || name;
    putSaved(d);
    return true;
  }
  function savedList(onBack, onPick) {
    const all = savedDecks;
    const box = el("div", { class: "deck saved" }, [
      el("div", { class: "crumbs" }, [el("button", { type: "button", text: "Back", onclick: onBack }), el("span", { text: "My decks" })]),
    ]);
    if (!all.length) box.append(el("div", { class: "empty", text: "No saved decks yet. Build one and choose “Save to my decks” under More." }));
    for (const d of all) {
      const n = (d.deck.items || []).filter((i) => i.type === "passage").length;
      box.append(el("div", { class: "deck-item" }, [
        el("button", { type: "button", class: "body preview", onclick: () => { deck = migrate(JSON.parse(JSON.stringify(d.deck))) || blank(); pending = active = linking = null; naming = false; save(); onPick(); } }, [
          el("div", { class: "cite-edit", text: d.title }),
          el("div", { class: "where", text: `${n} ${n === 1 ? "passage" : "passages"}, ${new Date(d.updated).toLocaleDateString()}` }),
        ]),
        el("div", { class: "tools" }, [
          el("button", { type: "button", class: "rename", "aria-label": `Rename “${d.title}”`, text: "Rename", onclick: () => { if (renameSaved(d)) box.replaceWith(savedList(onBack, onPick)); } }),
          el("button", { type: "button", class: "delete", "aria-label": `Delete “${d.title}”`, title: "Delete", text: "×", onclick: () => { if (!confirm(`Delete “${d.title}”?`)) return; savedDecks = savedDecks.filter((x) => x.id !== d.id); dropSaved(d.id); box.replaceWith(savedList(onBack, onPick)); } }),
        ]),
      ]));
    }
    return box;
  }
  function showSaved() {
    ui.canvas.hidden = true;
    ui.saved.hidden = false;
    const back = () => { ui.saved.hidden = true; ui.canvas.hidden = false; ui.saved.replaceChildren(); draw(); };
    ui.saved.replaceChildren(savedList(back, back));
  }
  function renderSaved(container) {
    const back = () => render(container);
    container.replaceChildren(savedList(back, back));
  }
  function flash(text) {
    const s = ui ? ui.status : null;
    if (s) { s.textContent = text; setTimeout(() => { if (s.textContent === text) s.textContent = ""; }, 4000); }
    else GL().toast(text);
  }

  // --------------------------------------------------------------- present --
  function presentDeck() {
    const t = THEMES[deck.theme] || THEMES[DEFAULT_THEME];
    const units = [];
    if (deck.title) units.push({ kind: "title", html: esc(deck.title), where: deck.subtitle || "" });
    for (const it of sequence()) {
      if (it.type === "section") { units.push({ kind: "title", html: esc(it.title || "—"), where: "" }); continue; }
      if (it.type === "question") { if ((it.text || "").trim()) units.push({ kind: "question", html: esc(it.text.trim()), where: "" }); continue; }
      if (it.type === "note") { if ((it.text || "").trim()) units.push({ kind: "note", html: esc(it.text.trim()).replace(/\n/g, "<br>"), where: "" }); continue; }
      if (it.type === "link") { const u = linkUnit(it); if (u) units.push(u); continue; }
      for (const chunk of chunksOf(it)) units.push({ kind: it.kind, html: chunkHtml(it, chunk), where: it.kind === "verse" ? chunk.label : [it.citation, it.where, chunk.label].filter(Boolean).join("  ·  "), doc_id: it.doc_id });
    }
    const map = mapUnit();
    if (map) units.push(map);
    GL().startPresentingUnits(units, { theme: { bg: `#${t.bg}`, fg: `#${t.text}`, accent: `#${t.accent}`, muted: `#${t.muted}` } });
  }
  // Chunk text with verse numbers and highlights, as HTML for the stage.
  function chunkHtml(it, chunk) {
    if (chunk.verses && it.verses) {
      const firstN = chunk.verses.find((v) => v.n !== null)?.n;
      const idx = it.verses.findIndex((v) => v.n === firstN);
      const offset = it.verses.slice(0, Math.max(0, idx)).reduce((a, v) => a + v.text.split(/\s+/).filter(Boolean).length, 0);
      const parts = [];
      let i = offset;
      for (const v of chunk.verses) {
        if (v.n !== null && v.n !== undefined) parts.push(`<span class="vn">${v.n}</span>`);
        for (const w of v.text.split(/\s+/).filter(Boolean)) { parts.push(inHl(it, i) ? `<mark>${esc(w)}</mark>` : esc(w)); i++; }
      }
      return parts.join(" ").replace(/<\/mark> <mark>/g, " ");
    }
    const startWord = it.text.slice(0, Math.max(0, it.text.indexOf(chunk.text))).split(/\s+/).filter(Boolean).length;
    const parts = [];
    let i = startWord;
    chunk.text.split(/\n\n+/).forEach((para, pi) => {
      if (pi) parts.push("<br><br>");
      para.split(/\s+/).filter(Boolean).forEach((w) => { parts.push(inHl(it, i) ? `<mark>${esc(w)}</mark>` : esc(w)); i++; });
    });
    return parts.join(" ").replace(/<\/mark> <mark>/g, " ");
  }
  function excerptHtml(it, hl) {
    const ex = excerpt(it, hl);
    const parts = ex.words.map((x, i) => (i >= ex.s && i <= ex.e && hl ? `<mark>${esc(x.w)}</mark>` : esc(x.w)));
    return (ex.before ? "… " : "") + parts.join(" ").replace(/<\/mark> <mark>/g, " ") + (ex.after ? " …" : "");
  }
  function linkUnit(l) {
    const a = endOf(l.from), b = endOf(l.to);
    if (!a || !b) return null;
    const html = `<div class="stage-link"><div class="side"><div class="x">${excerptHtml(a.item, a.hl)}</div><div class="ref">${esc(a.item.citation)}</div></div>` +
      `<div class="mid"><div class="arrow">→</div><div class="lbl">${esc(l.label || "")}</div></div>` +
      `<div class="side"><div class="x">${excerptHtml(b.item, b.hl)}</div><div class="ref">${esc(b.item.citation)}</div></div></div>`;
    return { kind: "link", html, where: "" };
  }
  function mapUnit() {
    const lay = mapLayout();
    if (!lay) return null;
    const S = 100; // slide inches to SVG units
    const f = (v) => (v * S).toFixed(1);
    let svg = `<svg class="stage-map" viewBox="0 ${f(lay.top - 0.1)} ${f(lay.W)} ${f(lay.bottom - lay.top + 0.2)}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
    for (const l of lay.links) {
      svg += `<polyline points="${l.points.map(([x, y]) => `${f(x)},${f(y)}`).join(" ")}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" marker-end="url(#ah)" opacity=".85"/>`;
      if (l.label) {
        const { x, y, above } = l.labelAt;
        const ty = y * S + (above === null ? 6 : above ? -7 : 19);
        svg += `<text x="${f(x)}" y="${ty.toFixed(1)}" text-anchor="middle" font-size="16" fill="currentColor" opacity=".9">${esc(l.label)}</text>`;
      }
    }
    const accent = "var(--stage-accent, currentColor)";
    for (const nd of lay.nodes) {
      const bx = nd.x * S, by = nd.y * S, bw = nd.w * S, bh = nd.h * S;
      svg += `<rect x="${(bx - bw / 2).toFixed(1)}" y="${(by - bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="9" fill="rgba(127,127,127,.14)" stroke="currentColor" stroke-width="1.5" opacity=".9"/>`;
      const refSize = Math.min(15, Math.max(10, (bw * 0.92) / Math.max(1, nd.label.length * 0.58)));
      const top = by - bh / 2;
      svg += `<text x="${bx.toFixed(1)}" y="${(top + 9 + refSize).toFixed(1)}" text-anchor="middle" font-size="${refSize.toFixed(1)}" font-weight="700" style="fill:${accent}">${esc(nd.label)}</text>`;
      const size = nd.w >= 2 ? 13 : nd.w >= 1.7 ? 12 : 11;
      const lines = wrapWords(nd.excerpt, Math.max(8, Math.floor((bw - 16) / (size * 0.5))), 3);
      lines.forEach((line, i) => { svg += `<text x="${bx.toFixed(1)}" y="${(top + 9 + refSize + 7 + (i + 1) * size * 1.18).toFixed(1)}" text-anchor="middle" font-size="${size}" fill="currentColor" opacity=".92">${esc(line)}</text>`; });
    }
    svg += "</svg>";
    const caption = deck.chain && deck.chain.caption ? `<div class="stage-caption">${esc(deck.chain.caption)}</div>` : "";
    return { kind: "map", html: svg + caption, where: deck.title ? `${deck.title}: the chain` : "The chain" };
  }
  // Greedy word wrap for SVG text, with an ellipsis when it runs past the lines allowed.
  function wrapWords(text, perLine, maxLines) {
    const lines = [];
    let cur = "";
    for (const w of String(text || "").split(/\s+/).filter(Boolean)) {
      if (cur && (cur + " " + w).length > perLine) { lines.push(cur); cur = w; if (lines.length === maxLines) break; } else cur = cur ? cur + " " + w : w;
    }
    if (lines.length < maxLines && cur) lines.push(cur);
    const used = lines.join(" ").split(/\s+/).length, all = String(text || "").split(/\s+/).filter(Boolean).length;
    if (used < all && lines.length) lines[lines.length - 1] = lines[lines.length - 1].replace(/[,;:.]?$/, "") + " …";
    return lines;
  }
  // What a passage says, in a box: its highlighted phrases, or its opening words.
  function nodeExcerpt(it, maxWords = 18) {
    const words = wordsOf(it);
    const hls = (it.hl || []).slice().sort((a, b) => a.s - b.s);
    if (hls.length) {
      const parts = [];
      let left = maxWords;
      for (const h of hls) { const ws = words.slice(h.s, h.e + 1).map((x) => x.w); if (left <= 0) break; parts.push(ws.slice(0, left).join(" ")); left -= ws.length; }
      return `“${parts.join(" … ")}”`;
    }
    const ws = words.map((x) => x.w);
    return `“${ws.slice(0, maxWords).join(" ")}${ws.length > maxWords ? " …" : ""}”`;
  }
  // The chain as one picture: passages in deck order, left to right (up to
  // five a row), each arrow routed above the row (forward) or below it
  // (back) on its own lane, with the label on the run. Positions are slide
  // inches; the PowerPoint and the stage both draw from this.
  function mapLayout() {
    const g = graph();
    if (!g) return null;
    const W = 10, M = 0.75, inner = W - 2 * M, top = 0.98, bottom = deck.chain && deck.chain.caption ? 4.3 : 4.95;
    const n = g.nodes.length;
    const perRow = Math.min(5, n);
    const rows = Math.ceil(n / perRow);
    const gap = 0.3;
    const bw = Math.min(2.4, (inner - (perRow - 1) * gap) / perRow), bh = rows <= 2 ? 1.0 : 0.8;
    const x0 = M + (inner - (perRow * bw + (perRow - 1) * gap)) / 2 + bw / 2;
    const rowY = rows === 1 ? [3.0] : rows === 2 ? [2.18, 3.68] : Array.from({ length: rows }, (_, r) => top + bh / 2 + 0.1 + r * ((bottom - top - bh - 0.2) / (rows - 1)));
    const nodes = g.nodes.map((node, i) => ({ ...node, i, row: Math.floor(i / perRow), x: x0 + (i % perRow) * (bw + gap), y: rowY[Math.floor(i / perRow)], w: bw, h: bh, excerpt: nodeExcerpt(byId(node.id), perRow >= 5 ? 12 : perRow === 4 ? 14 : 18) }));
    const at = Object.fromEntries(nodes.map((nd) => [nd.id, nd]));
    const links = g.edges.map((e) => ({ label: e.label, a: at[e.from], b: at[e.to] }));
    const useLanes = rows <= 2;
    const slots = {};
    for (const l of links) {
      l.bracket = useLanes && l.a.row === l.b.row;
      if (!l.bracket) continue;
      l.side = rows === 1 ? (l.a.i < l.b.i ? "top" : "bottom") : (l.a.row === 0 ? "top" : "bottom");
      for (const nd of [l.a, l.b]) (slots[`${nd.id}|${l.side}`] ||= []).push(l);
    }
    // Lanes: the shortest spans sit closest to the row; a lane is reused when the spans do not overlap.
    const lanes = {};
    for (const l of links.filter((x) => x.bracket).sort((p, q) => Math.abs(p.a.x - p.b.x) - Math.abs(q.a.x - q.b.x))) {
      const list = (lanes[`${l.a.row}|${l.side}`] ||= []);
      const x1 = Math.min(l.a.x, l.b.x), x2 = Math.max(l.a.x, l.b.x);
      let lane = 0;
      while ((list[lane] || []).some(([u1, u2]) => x1 < u2 + 0.15 && x2 > u1 - 0.15)) lane++;
      (list[lane] ||= []).push([x1, x2]);
      l.lane = lane;
    }
    // Where an arrow meets a box: spread the arrows on one side so they do not pile onto one point.
    const attach = (l, nd) => {
      const list = slots[`${nd.id}|${l.side}`].slice().sort((p, q) => (p.a === nd ? p.b.x : p.a.x) - (q.a === nd ? q.b.x : q.a.x));
      const k = list.indexOf(l), m = list.length;
      return nd.x + (k - (m - 1) / 2) * Math.min(0.22, (nd.w - 0.3) / Math.max(1, m - 1));
    };
    for (const l of links) {
      if (l.bracket) {
        const up = l.side === "top";
        const edge = (nd) => (up ? nd.y - nd.h / 2 : nd.y + nd.h / 2);
        const laneY = Math.max(top, Math.min(bottom, up ? edge(l.a) - 0.22 - l.lane * 0.26 : edge(l.a) + 0.22 + l.lane * 0.26));
        const ax = attach(l, l.a), bx = attach(l, l.b);
        l.points = [[ax, edge(l.a)], [ax, laneY], [bx, laneY], [bx, edge(l.b)]];
        l.labelAt = { x: (ax + bx) / 2, y: laneY, above: up };
      } else {
        const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        const trim = (nd) => Math.min(nd.w / 2 / Math.max(Math.abs(ux), 1e-6), nd.h / 2 / Math.max(Math.abs(uy), 1e-6)) + 0.04;
        const x1 = l.a.x + ux * trim(l.a), y1 = l.a.y + uy * trim(l.a), x2 = l.b.x - ux * trim(l.b), y2 = l.b.y - uy * trim(l.b);
        l.points = [[x1, y1], [x2, y2]];
        l.labelAt = { x: (x1 + x2) / 2 - uy * 0.22, y: (y1 + y2) / 2 + ux * 0.22, above: null };
      }
    }
    return { nodes, links, W, H: 5.625, top, bottom };
  }
  // Nodes and edges for the map: every passage that takes part in a connection.
  function graph() {
    const edges = deck.links.filter((l) => byId(l.from.id) && byId(l.to.id)).map((l) => ({ from: l.from.id, to: l.to.id, label: l.label || "" }));
    if (!edges.length) return null;
    const ids = new Set(edges.flatMap((e) => [e.from, e.to]));
    // in deck order, so the picture reads the way the slides were presented
    const nodes = deck.items.filter((it) => ids.has(it.id)).map((it) => ({ id: it.id, label: shortCitation(it) }));
    return { nodes, edges };
  }
  function shortCitation(it) {
    if (!it) return "";
    if (it.kind === "verse") return it.citation;
    return talkCitation(it.citation, it.label); // a talk's card keeps the speaker in citation (citationFor)
  }

  // ------------------------------------------------------------ chunking --
  // chunksOf, sentences and fontSize live in lib/chunk.js (imported above): a
  // slide holds about MAX_CHARS of scripture comfortably; longer passages are
  // split at verse or sentence boundaries, and the label says "1 of 2".

  // --------------------------------------------------------------- fitting --
  // "Shrink text on overflow" in the file is only a hint, and Keynote and
  // PowerPoint on an iPad do not act on it: text set too large runs over the
  // footer. So every box is sized here, by measuring the words: the largest
  // size at which they fit, and a passage split further when none does.
  let ctx2d = null;
  function measurer() {
    if (ctx2d !== null) return ctx2d;
    try { const c = typeof document !== "undefined" ? document.createElement("canvas") : null; ctx2d = (c && c.getContext && c.getContext("2d")) || false; }
    catch (_) { ctx2d = false; }
    return ctx2d;
  }
  const AVG_EM = { [SERIF]: 0.5, [SANS]: 0.46 };   // average width of a character, in ems, when no canvas can measure (Georgia is 0.44, Calibri 0.40)
  const LINE_EM = { [SERIF]: 1.22, [SANS]: 1.22 };  // a line's height in ems, with room for apps that space lines more generously than the font asks
  const widthCache = new Map();
  // Width of a piece of text in points at a size in points.
  function textWidth(text, font, size, bold) {
    const key = `${font}|${bold ? 1 : 0}|${size}|${text}`;
    const hit = widthCache.get(key);
    if (hit !== undefined) return hit;
    let w = null;
    const c = measurer();
    if (c) {
      try { c.font = `${bold ? "bold " : ""}${size}px "${font}", ${font === SANS ? "Helvetica, Arial, sans-serif" : "Georgia, 'Times New Roman', serif"}`; w = c.measureText(text).width; }
      catch (_) { w = null; }
    }
    if (w === null || !Number.isFinite(w) || w <= 0) w = text.length * size * (AVG_EM[font] || 0.5) * (bold ? 1.12 : 1);
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(key, w);
    return w;
  }
  // The words of a text or of text runs, each with its weight; a run's
  // breakLine (or a "\n") ends a paragraph.
  function fitWords(src, bold = false) {
    const out = [];
    const runs = typeof src === "string" ? [{ text: src, options: { bold } }] : src;
    let carry = "";
    for (const r of runs) {
      const b = !!(r.options && r.options.bold) || bold;
      const parts = String(r.text || "").split("\n");
      parts.forEach((part, i) => {
        if (i > 0) { if (carry) { out.push({ w: carry, bold: b }); carry = ""; } out.push({ nl: true }); }
        const bits = part.split(/(\s+)/);
        for (const bit of bits) {
          if (!bit) continue;
          if (/^\s+$/.test(bit)) { if (carry) { out.push({ w: carry, bold: b }); carry = ""; } }
          else carry += bit;
        }
        if (carry && /\s$/.test(part)) { out.push({ w: carry, bold: b }); carry = ""; }
      });
      if (r.options && r.options.breakLine) { if (carry) { out.push({ w: carry, bold: b }); carry = ""; } out.push({ nl: true }); }
    }
    if (carry) out.push({ w: carry, bold });
    return out;
  }
  // Lines the words take when wrapped in a box of boxW inches.
  function countLines(src, font, size, boxW, bold = false, charSpacing = 0) {
    const maxW = boxW * 72;
    const words = Array.isArray(src) && src.length && ("w" in src[0] || "nl" in src[0]) ? src : fitWords(src, bold);
    const space = textWidth(" ", font, size, false) + charSpacing;
    let lines = 1, w = 0, any = false;
    for (const t of words) {
      if (t.nl) { lines++; w = 0; continue; }
      any = true;
      const ww = textWidth(t.w, font, size, !!t.bold) + charSpacing * t.w.length;
      if (w > 0 && w + space + ww > maxW) { lines++; w = ww; } else w += (w > 0 ? space : 0) + ww;
    }
    return any || lines > 1 ? lines : 1;
  }
  // The largest size (points) from max down to min at which the text fits the box.
  function fitSize({ text, runs = null, font = SERIF, boxW, boxH, max, min, lineSpacing = 1, bold = false, charSpacing = 0, paraSpace = 0, safety = 0.94 }) {
    const words = runs ? fitWords(runs) : fitWords(String(text ?? ""), bold);
    const breaks = words.filter((t) => t.nl).length;
    let best = null;
    for (let size = max; size >= min; size -= 1) {
      const lines = countLines(words, font, size, boxW * safety, bold, charSpacing);
      const height = (lines * size * (LINE_EM[font] || 1.2) * lineSpacing + breaks * paraSpace) / 72;
      best = { size, lines, height, fits: height <= boxH };
      if (best.fits) return best;
    }
    return best || { size: min, lines: 1, height: 0, fits: true };
  }
  const plainOfRuns = (runs) => runs.map((r) => r.text + (r.options && r.options.breakLine ? "\n" : "")).join("");
  // A label that must stay on one line: smaller first, then shortened.
  function oneLine(text, { font = SANS, boxW, max, min, bold = false, charSpacing = 0 }) {
    let t = String(text || "");
    for (let size = max; size >= min; size -= 1) {
      if (countLines(t, font, size, boxW * 0.96, bold, charSpacing) <= 1) return { text: t, size };
    }
    while (t.length > 8 && countLines(t + "…", font, min, boxW * 0.96, bold, charSpacing) > 1) t = t.replace(/\s*\S+$/, "");
    return { text: t + "…", size: min };
  }

  // ------------------------------------------------------------------ pptx --
  let lib = null;
  function loadLib() {
    if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
    if (lib) return lib;
    lib = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "./vendor/pptxgen.bundle.js";
      s.onload = () => resolve(window.PptxGenJS);
      s.onerror = () => reject(new Error("could not load the PowerPoint writer"));
      document.head.append(s);
    });
    return lib;
  }

  // The slide background for themes that have a gradient: drawn once on a
  // canvas, stored once in the file's slide master. Flat color when the
  // device cannot draw it.
  // One background per theme per session (drawn once, as a JPEG: a gradient needs no PNG, and the
  // file is a third of the size).
  const backgrounds = new Map();
  function backgroundImage(t) {
    if (!t.gradient || typeof document === "undefined") return null;
    const key = t.gradient.join(",");
    if (backgrounds.has(key)) return backgrounds.get(key);
    const data = drawBackground(t);
    backgrounds.set(key, data);
    return data;
  }
  function drawBackground(t) {
    try {
      const c = document.createElement("canvas");
      c.width = 1600; c.height = 900;
      const g = c.getContext && c.getContext("2d");
      if (!g) return null;
      const lin = g.createLinearGradient(0, 0, 1600, 900);
      t.gradient.forEach((col, i) => lin.addColorStop(i / (t.gradient.length - 1), `#${col}`));
      g.fillStyle = lin; g.fillRect(0, 0, 1600, 900);
      const glow = g.createRadialGradient(260, 140, 0, 260, 140, 1150);
      glow.addColorStop(0, "rgba(255,255,255,0.075)"); glow.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = glow; g.fillRect(0, 0, 1600, 900);
      const data = c.toDataURL("image/jpeg", 0.9);
      return data.startsWith("data:image/jpeg") ? data.slice(5) : null;
    } catch (_) { return null; }
  }

  async function build(opts = {}) {
    const PptxGenJS = await loadLib();
    const t = THEMES[deck.theme] || THEMES[DEFAULT_THEME];
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 in
    pptx.title = deck.title || "Scriptures";
    const W = 10, H = 5.625, M = 0.75, inner = W - 2 * M;
    const report = { slides: 0, boxes: 0, shortened: 0, split: 0, tight: [] };
    lastReport = report;
    const bg = opts.background !== undefined ? opts.background : backgroundImage(t);
    const ext = bg ? (/^image\/(\w+)/.exec(bg) || [])[1] || "png" : "png";
    pptx.defineSlideMaster({ title: "DECK", background: bg ? { data: bg, path: `background.${ext}` } : { color: t.bg } });
    let n = 0;

    const slide = () => {
      const s = pptx.addSlide({ masterName: "DECK" });
      if (t.bar) s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: H, fill: { color: t.bar }, line: { color: t.bar, width: 0 } });
      return s;
    };
    const rule = (s, x, y, w) => s.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.035, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
    const kicker = (s, text) => {
      const k = oneLine(String(text || "").toUpperCase(), { font: SANS, boxW: inner, max: 12, min: 9, charSpacing: 2 });
      if (k.text !== String(text || "").toUpperCase()) report.shortened++;
      report.boxes++;
      s.addText(k.text, { x: M, y: 0.46, w: inner, h: 0.34, fontFace: SANS, fontSize: k.size, color: t.accent, charSpacing: 2, margin: 0, valign: "top" });
      rule(s, M, 0.86, 0.55);
    };
    const footer = (s, idx) => {
      s.addShape(pptx.ShapeType.line, { x: M, y: H - 0.58, w: inner, h: 0, line: { color: t.rule, width: 0.75 } });
      if (deck.title) { const ft = oneLine(deck.title, { font: SANS, boxW: inner - 1.1, max: 10, min: 8 }); s.addText(ft.text, { x: M, y: H - 0.52, w: inner - 1, h: 0.3, fontFace: SANS, fontSize: ft.size, color: t.muted, margin: 0 }); }
      s.addText(String(idx), { x: W - M - 1, y: H - 0.52, w: 1, h: 0.3, fontFace: SANS, fontSize: 10, color: t.muted, align: "right", margin: 0 });
    };

    // Title slide
    if (deck.title || deck.subtitle) {
      const s = slide();
      report.slides++;
      rule(s, M, 1.55, 0.9);
      const tf = fitSize({ text: deck.title || "", font: SERIF, bold: true, boxW: inner, boxH: 1.7, max: 40, min: 22, lineSpacing: 1.05 });
      report.boxes++;
      s.addText(deck.title || "", { x: M, y: 1.7, w: inner, h: 1.7, fontFace: SERIF, fontSize: tf.size, bold: true, color: t.text, valign: "top", margin: 0 });
      if (deck.subtitle) {
        const sf = fitSize({ text: deck.subtitle, font: SANS, boxW: inner, boxH: 0.9, max: 18, min: 12, lineSpacing: 1.05 });
        report.boxes++;
        s.addText(deck.subtitle, { x: M, y: 3.45, w: inner, h: 0.9, fontFace: SANS, fontSize: sf.size, color: t.muted, valign: "top", margin: 0 });
      }
    }

    for (const it of sequence()) {
      if (it.type === "section") {
        n++;
        const s = slide();
        report.slides++; report.boxes++;
        const sf = fitSize({ text: it.title || "", font: SERIF, bold: true, boxW: inner, boxH: 1.4, max: 40, min: 22, lineSpacing: 1.05 });
        s.addText(it.title || "", { x: M, y: 1.9, w: inner, h: 1.4, fontFace: SERIF, fontSize: sf.size, bold: true, color: t.text, align: "center", valign: "middle", margin: 0 });
        rule(s, W / 2 - 0.45, 3.42, 0.9);
        footer(s, n);
        speakerNotes(s, it);
        continue;
      }
      if (it.type === "question" || it.type === "note") {
        const text = (it.text || "").trim();
        if (!text) continue;
        n++;
        const s = slide();
        report.slides++; report.boxes++;
        // A question says so over a rule; slide text is the teacher's own words and needs no label in front of the room.
        if (it.type === "question") kicker(s, "Question");
        const question = it.type === "question";
        const f = fitSize({ text, font: question ? SERIF : SANS, boxW: inner - (question ? 0.6 : 0), boxH: 3.3, max: question ? 36 : 26, min: 16, lineSpacing: 1.15, paraSpace: 6 });
        if (!f.fits) report.tight.push(n);
        s.addText(text, { x: M + (question ? 0.3 : 0), y: 1.1, w: inner - (question ? 0.6 : 0), h: 3.3, fontFace: question ? SERIF : SANS, fontSize: f.size, color: question ? t.text : t.text, align: question ? "center" : "left", valign: "middle", lineSpacingMultiple: 1.15, margin: 0, italic: false });
        if (question) rule(s, W / 2 - 0.45, 4.55, 0.9);
        footer(s, n);
        speakerNotes(s, it);
        continue;
      }
      if (it.type === "link") {
        const a = endOf(it.from), b = endOf(it.to);
        if (!a || !b) continue;
        n++;
        const s = slide();
        kicker(s, it.label ? `Connection: ${it.label}` : "Connection");
        const colW = 3.75, gap = inner - 2 * colW, top = 1.12, panelH = 3.3, pad = 0.22;
        report.slides++;
        const side = (end, x) => {
          const { item, hl } = end;
          s.addShape(pptx.ShapeType.roundRect, { x, y: top, w: colW, h: panelH, fill: { color: t.panel }, line: { color: t.panel, width: 0 }, rectRadius: 0.1 });
          // the excerpt around the highlight: as many words as fit the panel at a size the room can read
          let best = null;
          for (const maxWords of [48, 38, 30, 24, 18, 14, 10]) {
            const ex = excerpt(item, hl, maxWords);
            const runs = ex.words.map((w, i) => ({ text: w.w + (i < ex.words.length - 1 ? " " : ""), options: hl && i >= ex.s && i <= ex.e ? { color: t.accent, bold: true } : { color: t.text } }));
            if (ex.before) runs.unshift({ text: "… ", options: { color: t.muted } });
            if (ex.after) runs.push({ text: " …", options: { color: t.muted } });
            const fit = fitSize({ runs, font: SERIF, boxW: colW - 2 * pad, boxH: panelH - 0.95, max: 22, min: 13, lineSpacing: 1.12 });
            const cand = { runs, fit, maxWords };
            if (fit.fits && fit.size >= 16) { best = cand; break; }
            if (fit.fits && (!best || fit.size > best.fit.size)) best = cand;
            if (!best && maxWords === 10) best = cand;
          }
          if (best.maxWords !== 48) report.shortened++;
          report.boxes += 2;
          s.addText(best.runs, { x: x + pad, y: top + pad, w: colW - 2 * pad, h: panelH - 0.95, fontFace: SERIF, fontSize: best.fit.size, valign: "middle", align: "left", lineSpacingMultiple: 1.12, margin: 0 });
          const citeText = item.citation + (item.kind !== "verse" && item.where ? `, ${item.where}` : "");
          let cite = fitSize({ text: citeText, font: SANS, boxW: colW - 2 * pad, boxH: 0.45, max: 12, min: 10, lineSpacing: 1 });
          cite = cite.fits ? { text: citeText, size: cite.size } : oneLine(citeText, { font: SANS, boxW: colW - 2 * pad, max: 10, min: 9 });
          s.addText(cite.text, { x: x + pad, y: top + panelH - 0.62, w: colW - 2 * pad, h: 0.45, fontFace: SANS, fontSize: cite.size, color: t.accent, valign: "bottom", margin: 0 });
        };
        side(a, M);
        side(b, M + colW + gap);
        const ax = M + colW + 0.14, aw = gap - 0.28, ay = top + panelH / 2;
        s.addShape(pptx.ShapeType.line, { x: ax, y: ay, w: aw, h: 0, line: { color: t.accent, width: 2.5, endArrowType: "triangle" } });
        // The label sits over the arrow when it is short; a long one is already in the kicker.
        if (it.label) {
          const lf = fitSize({ text: it.label, font: SANS, boxW: gap + 0.6, boxH: 0.5, max: 12, min: 9, lineSpacing: 1 });
          if (lf.fits && lf.lines <= 2) {
            report.boxes++;
            s.addText(it.label, { x: M + colW - 0.3, y: ay - 0.62, w: gap + 0.6, h: 0.5, fontFace: SANS, fontSize: lf.size, color: t.accent, align: "center", valign: "bottom", margin: 0 });
          }
        }
        footer(s, n);
        continue;
      }
      const isTalk = it.kind !== "verse";
      const boxH = isTalk && (it.citation || it.where) ? 3.05 : 3.5;
      // Chunks that fit the box at a size the room can read; a passage is cut into more pieces until they do.
      let chunks = chunksOf(it), limit = MAX_CHARS, fits = [];
      const measure = (cs) => cs.map((chunk) => fitSize({ runs: passageRuns(it, chunk, t), font: SERIF, boxW: inner, boxH, max: fontSize(chunk.verses ? chunk.verses.reduce((a, v) => a + v.text.length, 0) : chunk.text.length), min: 20, lineSpacing: 1.15, paraSpace: 8 }));
      fits = measure(chunks);
      while (fits.some((f) => !f.fits || f.size < 22) && limit > 140) {
        limit = Math.round(limit * 0.8);
        const again = chunksOf(it, limit);
        if (again.length <= chunks.length) continue;
        chunks = again; fits = measure(chunks); report.split++;
      }
      chunks.forEach((chunk, ci) => {
        n++;
        const s = slide();
        report.slides++; report.boxes++;
        kicker(s, chunk.label);
        const runs = passageRuns(it, chunk, t);
        const fit = fits[ci];
        if (!fit.fits) report.tight.push(n);
        s.addText(runs, { x: M, y: 1.08, w: inner, h: boxH, fontFace: SERIF, fontSize: fit.size, color: t.text, valign: "middle", align: "left", lineSpacingMultiple: 1.15, margin: 0 });
        if (isTalk && (it.citation || it.where)) {
          const c1 = oneLine(it.citation || "", { font: SANS, boxW: inner, max: 15, min: 11, bold: true });
          const c2 = it.where ? oneLine(it.where, { font: SANS, boxW: inner, max: 12, min: 9 }) : null;
          report.boxes++;
          s.addText([
            { text: c1.text, options: { bold: true, fontSize: c1.size, color: t.text, breakLine: !!c2 } },
            ...(c2 ? [{ text: c2.text, options: { fontSize: c2.size, color: t.muted } }] : []),
          ], { x: M, y: 4.2, w: inner, h: 0.7, fontFace: SANS, valign: "top", margin: 0 });
        }
        footer(s, n);
        if (ci === 0) speakerNotes(s, it);
      });
    }

    // The chain as one picture, one slide at the end.
    const lay = mapLayout();
    if (lay) {
      n++;
      const s = slide();
      kicker(s, deck.title ? `${deck.title}: the chain` : "The chain");
      for (const l of lay.links) {
        for (let i = 1; i < l.points.length; i++) {
          const [x1, y1] = l.points[i - 1], [x2, y2] = l.points[i];
          addSegment(pptx, s, x1, y1, x2, y2, { color: t.accent, width: 1.75, ...(i === l.points.length - 1 ? { endArrowType: "triangle" } : {}) });
        }
        if (l.label) {
          const { x, y, above } = l.labelAt;
          const ll = oneLine(l.label, { font: SANS, boxW: 2.0, max: 10, min: 7 });
          report.boxes++;
          s.addText(ll.text, { x: x - 1.0, y: above === null ? y - 0.14 : above ? y - 0.3 : y + 0.02, w: 2.0, h: 0.28, fontFace: SANS, fontSize: ll.size, color: t.accent, align: "center", valign: above === null ? "middle" : above ? "bottom" : "top", margin: 0 });
        }
      }
      if (deck.chain && deck.chain.caption) {
        const cf = fitSize({ text: deck.chain.caption, font: SERIF, boxW: inner - 0.6, boxH: 0.62, max: 12, min: 8, lineSpacing: 1.1 });
        report.boxes++;
        s.addText(deck.chain.caption, { x: M + 0.3, y: 4.36, w: inner - 0.6, h: 0.62, fontFace: SERIF, italic: true, fontSize: cf.size, color: t.muted, align: "center", valign: "top", margin: 0, lineSpacingMultiple: 1.1 });
      }
      if (deck.chain && deck.chain.notes) s.addNotes(deck.chain.notes);
      report.slides++;
      for (const nd of lay.nodes) {
        const big = nd.w >= 2;
        // label and excerpt share the box; the excerpt gives way until both fit
        const innerW = nd.w - 12 / 72, innerH = nd.h - 12 / 72;
        let excerptText = nd.excerpt, size = big ? 11 : nd.w >= 1.7 ? 10 : 9, labelSize = big ? 11 : 10, ok = false;
        for (let tries = 0; tries < 8 && !ok; tries++) {
          const labelLines = countLines(nd.label, SANS, labelSize, innerW * 0.94, true);
          const labelH = (labelLines * labelSize * LINE_EM[SANS] * 1.05 + 3) / 72;
          const ef = fitSize({ text: excerptText, font: SERIF, boxW: innerW, boxH: Math.max(0.1, innerH - labelH), max: size, min: 7, lineSpacing: 1.05 });
          size = ef.size; ok = ef.fits;
          if (!ok) { const ws = excerptText.replace(/[“”]/g, "").replace(/\s*…$/, "").split(/\s+/); if (ws.length <= 4) break; excerptText = `“${ws.slice(0, Math.max(3, Math.floor(ws.length * 0.75))).join(" ")} …”`; report.shortened++; }
        }
        report.boxes++;
        s.addText([
          { text: nd.label, options: { bold: true, fontSize: labelSize, color: t.accent, fontFace: SANS, breakLine: true, paraSpaceAfter: 3 } },
          { text: excerptText, options: { fontSize: size, color: t.text, fontFace: SERIF } },
        ], { x: nd.x - nd.w / 2, y: nd.y - nd.h / 2, w: nd.w, h: nd.h, align: "center", valign: "middle", margin: 6, lineSpacingMultiple: 1.05,
          fill: { color: t.panel }, line: { color: t.accent, width: 1 }, rectRadius: 0.08, shape: pptx.ShapeType.roundRect });
      }
      footer(s, n);
    }
    return pptx;
  }
  // What the last build measured: slides, boxes, what had to give way.
  let lastReport = null;
  function reportLine() {
    const r = lastReport;
    if (!r) return "";
    const bits = [`Checked ${r.slides} ${r.slides === 1 ? "slide" : "slides"}: every box fits`];
    if (r.split) bits.push(`${r.split === 1 ? "a passage was" : `${r.split} passages were`} cut into more slides to stay readable`);
    if (r.shortened) bits.push(`${r.shortened} ${r.shortened === 1 ? "label or excerpt was" : "labels or excerpts were"} shortened`);
    if (r.tight.length) bits[0] = `Checked ${r.slides} slides: ${r.tight.length === 1 ? `slide ${r.tight[0]} is` : `slides ${r.tight.join(", ")} are`} very full`;
    return bits.join("; ") + ".";
  }

  // PptxGenJS draws a line from its box's top-left to bottom-right; flips cover the other directions.
  function addSegment(pptx, slide, x1, y1, x2, y2, line) {
    const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
    const flipH = x2 < x1, flipV = y2 < y1;
    slide.addShape(pptx.ShapeType.line, { x, y, w: Math.max(w, 0.01), h: Math.max(h, 0.01), line, flipH, flipV });
  }

  // Text runs for a chunk of a passage: verse numbers small, highlights in the accent color.
  function passageRuns(it, chunk, t) {
    const runs = [];
    const hlOpts = { color: t.accent, bold: true };
    if (chunk.verses && it.verses) {
      const firstN = chunk.verses.find((v) => v.n !== null && v.n !== undefined)?.n;
      const idx = it.verses.findIndex((v) => v.n === firstN);
      let i = it.verses.slice(0, Math.max(0, idx)).reduce((a, v) => a + v.text.split(/\s+/).filter(Boolean).length, 0);
      chunk.verses.forEach((v, vi) => {
        if (v.n !== null && v.n !== undefined) runs.push({ text: `${v.n} `, options: { superscript: true, color: t.accent, fontSize: 16, fontFace: SANS, bold: true } });
        const words = v.text.split(/\s+/).filter(Boolean);
        words.forEach((w, wi) => {
          const last = wi === words.length - 1 && vi === chunk.verses.length - 1;
          runs.push({ text: w + (last ? "" : " "), options: inHl(it, i) ? hlOpts : { color: t.text } });
          i++;
        });
      });
    } else {
      const startWord = it.text.slice(0, Math.max(0, it.text.indexOf(chunk.text))).split(/\s+/).filter(Boolean).length;
      let i = startWord;
      const paras = chunk.text.split(/\n\n+/);
      paras.forEach((para, pi) => {
        const words = para.split(/\s+/).filter(Boolean);
        words.forEach((w, wi) => {
          const lastInPara = wi === words.length - 1;
          runs.push({ text: w + (lastInPara ? "" : " "), options: { ...(inHl(it, i) ? hlOpts : { color: t.text }), ...(lastInPara && pi < paras.length - 1 ? { breakLine: true, paraSpaceAfter: 8 } : {}) } });
          i++;
        });
      });
    }
    // Merge neighbouring runs with identical options so the file stays small.
    const merged = [];
    for (const r of runs) {
      const prev = merged[merged.length - 1];
      if (prev && JSON.stringify(prev.options) === JSON.stringify(r.options) && !r.options.breakLine && !r.options.superscript) prev.text += r.text;
      else merged.push({ text: r.text, options: { ...r.options } });
    }
    return merged;
  }

  // Handing the file over. On an iPhone or iPad the file goes out through the
  // share sheet (Save to Files, PowerPoint, Keynote, AirDrop, Mail), and Safari
  // opens that sheet only in direct answer to a tap: once the file has taken a
  // moment to build, the tap is spent and the sheet never appears. So the file
  // is built ahead of time while the board is open, and when it is not ready
  // at the tap, the button becomes "Save PowerPoint" for one more tap.
  const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  let prepared = null;   // { updated, theme, blob, name, file }
  let preparing = null;
  let prepareTimer = null;
  function pptxName() { return `${(deck.title || "Scriptures").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Scriptures"}.pptx`; }
  function isPrepared() { return !!prepared && prepared.updated === deck.updated && prepared.theme === deck.theme && prepared.name === pptxName(); }
  async function preparePptx() {
    if (isPrepared()) return prepared;
    if (preparing) return preparing;
    const stamp = deck.updated, theme = deck.theme;
    preparing = (async () => {
      const pptx = await build();
      const blob = new Blob([await pptx.write({ outputType: "arraybuffer" })], { type: PPTX_TYPE });
      const name = pptxName();
      prepared = { updated: stamp, theme, blob, name, file: new File([blob], name, { type: PPTX_TYPE }) };
      return prepared;
    })();
    try { return await preparing; } finally { preparing = null; }
  }
  // Build quietly a moment after the board settles, so the tap finds the file ready.
  function schedulePrepare() {
    clearTimeout(prepareTimer);
    if (!deck.items.length || isPrepared()) return;
    const run = () => { if (!linking && !pending && !preparing) preparePptx().then(() => syncDownloadButton()).catch(() => {}); };
    prepareTimer = setTimeout(() => { if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 4000 }); else run(); }, 4000);
  }
  function syncDownloadButton() {
    if (!ui) return;
    const ready = isPrepared();
    ui.download.textContent = ready && !ui.download.disabled ? "Save PowerPoint" : "Download PowerPoint";
    ui.download.classList.toggle("ready", ready);
  }
  function canShareFile(file) { try { return !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (_) { return false; } }
  function say(text) { if (ui) ui.status.textContent = text; }
  // Inside the tap: the share sheet where there is one, a download elsewhere.
  function handOver(p) {
    if (canShareFile(p.file)) {
      say(reportLine());
      navigator.share({ files: [p.file], title: p.name }).catch((err) => {
        if (err && err.name === "AbortError") return;
        fallbackDownload(p);
      });
      return;
    }
    fallbackDownload(p);
  }
  function fallbackDownload(p) {
    try {
      const url = URL.createObjectURL(p.blob);
      const a = el("a", { href: url, download: p.name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say(`${reportLine()} ${p.name} is on its way to your downloads; if it did not appear, tap Save PowerPoint once more.`);
    } catch (err) {
      say(`Could not hand the file over: ${err.message}`);
    }
  }
  async function downloadFile() {
    if (isPrepared()) { handOver(prepared); return; }
    if (!ui) return;
    ui.download.disabled = true;
    say("Building the PowerPoint file…");
    try { await preparePptx(); }
    catch (err) { say(`Could not build the file: ${err.message}`); ui.download.disabled = false; return; }
    ui.download.disabled = false;
    syncDownloadButton();
    // Built after the tap. Where a share sheet exists it needs a fresh tap; elsewhere the download can start now.
    if (canShareFile(prepared.file)) say(`${reportLine()} Tap Save PowerPoint, then choose Save to Files, PowerPoint, Keynote or AirDrop.`);
    else handOver(prepared);
  }

  window.Deck = {
    render, board: boardEl, showBoard, addFromDoc, addPassage, addSection, has, remove, removeIds, lastAdded, toggle, count, updateBadge,
    shouldAsk, askAboutDeck, present: presentDeck, chunksOf, build, THEMES, reportLine,
    ready, flush: () => writeCurrent(), // ready: the stored deck has arrived; flush: write now rather than a moment later
    // for tests and scripts
    get state() { return deck; }, markdown: markdownOf, setHighlight: (id, a, b) => { const it = byId(id); if (!it) return null; const h = setHighlight(it, a, b); save(); return h; }, link: (from, to, label) => { const l = addLink(from, to, label); if (l) save(); return l; }, sequence,
    // a question card with its words written (Ask's Think it through): addCard, then the text
    addQuestion: (text) => { const it = addCard("question", { focus: false }); it.text = String(text || "").trim(); lastAddedIds = [it.id]; save(); return it; },
    // a note card with its words already written (a Hebrew or Greek word from its sheet); Undo takes it off by its id
    addNote: (text, notes = "") => { const it = addCard("note", { focus: false }); it.text = String(text || ""); it.notes = String(notes || ""); lastAddedIds = [it.id]; save(); return it; },
  };
  updateBadge();
})();
