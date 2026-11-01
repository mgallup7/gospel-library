/* Deck: the passages picked for a presentation, laid out on a board where
   phrases are highlighted and linked with arrows, then written out as a
   PowerPoint file (or presented straight from the device). Everything runs
   here; the .pptx is written in the browser by PptxGenJS. */
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
  const MAX_CHARS = 430;
  const QUICK_LABELS = ["fulfilled in", "same word", "echoes", "defines", "explains", "contrast", "promise and keeping"];

  // ---------------------------------------------------------------- model --
  // deck.items: passages and sections in slide order. deck.links: arrows
  // between a highlighted phrase (or whole passage) and another; a connection
  // slide follows the later of its two passages.
  const uid = () => Math.random().toString(36).slice(2, 10);
  const blank = () => ({ id: uid(), title: "", subtitle: "", theme: DEFAULT_THEME, themeSet: true, items: [], links: [], updated: Date.now() });
  let deck = migrate(store.get("deck")) || blank();

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
    if (!THEMES[d.theme]) d.theme = DEFAULT_THEME;
    return d;
  }

  function save({ redraw = true } = {}) {
    deck.updated = Date.now();
    store.set("deck", deck);
    updateBadge();
    if (redraw) draw();
    try { window.dispatchEvent(new CustomEvent("deck:change")); } catch (_) {}
  }

  function count() { return deck.items.filter((i) => i.type === "passage").length; }
  function updateBadge() {
    const b = $("#deckBtn");
    if (b) b.textContent = count() ? `Deck ${count()}` : "Deck";
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
  /** Put a passage on the deck or take it off. Returns true when it was added. */
  function toggle(p) {
    if (has(p.doc_id, p.pid)) { remove(p.doc_id, p.pid); return false; }
    addPassage(p);
    return true;
  }

  /** Add passages from a document. units: [{pid, kind, verse, text}] in reading order. */
  function addFromDoc(doc, units) {
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
    for (const r of runs) {
      const verses = r.kind === "verse" ? r.units.map((u) => ({ n: u.verse, text: u.text })) : null;
      const text = verses ? verses.map((v) => v.text).join(" ") : r.units.map((u) => u.text).join("\n\n");
      if (has(doc.id, r.units[0].pid)) continue;
      deck.items.push({
        id: uid(), type: "passage", kind: r.kind === "verse" ? "verse" : "para",
        text, verses, doc_id: doc.id, pid: r.units[0].pid, hl: [],
        ...citationFor(doc, verses),
      });
      added++;
    }
    save();
    return added;
  }

  /** Add one search hit or Ask passage: {doc_id, pid, kind, text, verses, citation, author, title, label, collection, verse}. */
  function addPassage(p, { show = false } = {}) {
    const existing = find(p.doc_id, p.pid);
    if (existing) { if (show) showBoard(); return existing; }
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
    save();
    if (show) showBoard();
    return item;
  }

  function citationFor(doc, verses) {
    if (doc.collection === "general-conference") {
      return { citation: doc.author || "", where: `“${doc.title}”`, label: doc.label || "" };
    }
    if (doc.book_slug && verses && verses.length) {
      const base = (doc.citation || doc.title).replace(/:\d.*$/, "");
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
    return { words: words.slice(a, b + 1), s: s - a, e: e - a, before: a > 0, after: b < words.length - 1 };
  }

  // ---------------------------------------------------------------- board --
  // One board element for the whole app. On a wide screen it borrows the
  // right-hand pane while the left pane keeps finding passages; on a phone
  // it is the Deck tab.
  let board = null, ui = null;
  let pending = null;   // {id, i}: first word of a phrase being marked
  let active = null;    // {id, hl}: a highlight whose tools are showing
  let linking = null;   // {id, hl}: tap-to-link in progress
  let drag = null;      // a port being dragged
  let editing = null;   // the link whose label editor is open
  let hintShown = false;

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
    if (!n) return "Nothing on the deck yet.";
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
    const present = el("button", { type: "button", class: "text-btn", text: "Present", onclick: () => presentDeck() });
    const more = el("button", { type: "button", class: "text-btn", text: "More", "aria-expanded": "false", onclick: () => { const open = ui.moreRow.hidden; ui.moreRow.hidden = !open; more.setAttribute("aria-expanded", String(open)); } });
    const moreRow = el("div", { class: "deck-actions secondary", hidden: true }, [
      el("button", { type: "button", class: "text-btn", text: "Add section", onclick: () => { deck.items.push({ id: uid(), type: "section", title: "" }); save(); } }),
      el("button", { type: "button", class: "text-btn", text: "Save to my decks", onclick: () => saveNamed() }),
      el("button", { type: "button", class: "text-btn", text: "My decks", onclick: () => showSaved() }),
      el("button", { type: "button", class: "text-btn danger", text: "Start a new deck", onclick: () => {
        if (deck.items.length && !confirm("Start a new, empty deck? The current one is kept only if you saved it.")) return;
        deck = blank(); pending = active = linking = null; save();
      } }),
    ]);
    const banner = el("div", { class: "board-banner", hidden: true });
    const hint = el("p", { class: "deck-hint" });
    const head = el("div", { class: "board-head" }, [title, subtitle, themes, el("div", { class: "board-row" }, [download, present, more]), moreRow, banner]);
    const cards = el("div", { class: "board-cards" });
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", "board-lines");
    svg.setAttribute("aria-hidden", "true");
    const labels = el("div", { class: "board-labels" });
    const canvas = el("div", { class: "board-canvas" }, [cards, svg, labels]);
    const saved = el("div", { class: "board-saved", hidden: true });
    const status = el("div", { class: "deck-status" });
    board.append(head, canvas, saved, status, hint);
    ui = { title, subtitle, themes, download, present, moreRow, banner, hint, cards, svg, labels, canvas, saved, status };

    cards.addEventListener("click", onCardClick);
    cards.addEventListener("pointerdown", onPortDown);
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
    ui.download.disabled = empty; ui.present.disabled = empty;
    if (linking) {
      const from = endOf(linking);
      ui.banner.hidden = false;
      ui.banner.replaceChildren(
        el("span", { html: `Tap a phrase or a passage to link <b>${esc(from && from.hl ? `“${phraseOf(from.item, from.hl)}”` : from ? from.item.citation : "")}</b> to it.` }),
        el("button", { type: "button", class: "text-btn small", text: "Cancel", onclick: () => { linking = null; draw(); } }),
      );
    } else ui.banner.hidden = true;
    ui.hint.textContent = empty
      ? "Nothing here yet. Tick a passage under an Ask answer, tap + on a search result, or select verses while reading and choose Add to deck."
      : count() === 1 ? "To highlight: tap the first and last word of a phrase. To link: add another passage, then drag the dot at the end of a highlight onto a phrase there."
      : "To highlight: tap the first and last word of a phrase. To link: drag the dot at the end of a highlight onto a phrase in another passage. To name a link: tap its number.";
  }

  function drawCards() {
    const cards = ui.cards;
    cards.replaceChildren();
    deck.items.forEach((it, idx) => {
      const card = el("div", { class: "bcard" + (it.type === "section" ? " section" : ""), "data-id": it.id, "data-type": it.type });
      const tools = el("div", { class: "bc-tools" }, [
        el("button", { type: "button", "aria-label": "Move up", title: "Move up", text: "↑", disabled: idx === 0, onclick: (e) => { e.stopPropagation(); move(idx, -1); } }),
        el("button", { type: "button", "aria-label": "Move down", title: "Move down", text: "↓", disabled: idx === deck.items.length - 1, onclick: (e) => { e.stopPropagation(); move(idx, 1); } }),
        el("button", { type: "button", "aria-label": "Remove from the deck", title: "Remove", text: "×", onclick: (e) => { e.stopPropagation(); removeItem(it); } }),
      ]);
      if (it.type === "section") {
        const inp = el("input", { value: it.title, placeholder: "Section title", "aria-label": "Section title" });
        inp.addEventListener("input", () => { it.title = inp.value; save({ redraw: false }); });
        card.append(el("div", { class: "bc-head" }, [el("div", { class: "bc-meta" }, [el("div", { class: "bc-kind", text: "Section" }), inp]), tools]));
        cards.append(card);
        return;
      }
      const meta = el("div", { class: "bc-meta" }, [el("div", { class: "bc-cite", text: it.citation })]);
      const port = el("button", { type: "button", class: "port card-port", "data-item": it.id, "data-hl": "", "aria-label": `Link the whole passage ${it.citation}`, title: "Drag to another passage to link the whole passage" });
      card.append(el("div", { class: "bc-head" }, [meta, tools, port]));
      card.append(textEl(it));
      // the talk and conference sit under the words, the way an attribution follows a quote
      if (it.where || it.label) card.append(el("div", { class: "bc-src", text: [it.where, it.label].filter(Boolean).join(", ") }));
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
    if (!deck.items.length) cards.append(el("div", { class: "board-empty", text: "The deck is empty." }));
  }
  // A passage as tappable words, with verse numbers, highlights and a port after each highlight.
  function textEl(it) {
    const text = el("div", { class: "bc-text" });
    const words = wordsOf(it);
    words.forEach((x, i) => {
      if (x.first && x.para > 0) text.append(el("br"), el("br"));
      if (x.n !== null && x.n !== undefined) text.append(el("span", { class: "vn", text: String(x.n) }));
      const h = hlAt(it, i);
      const cls = ["w"];
      if (h) { cls.push("hl"); if (h.s === i) cls.push("hl-s"); if (h.e === i) cls.push("hl-e"); if (active && active.id === it.id && active.hl === h.id) cls.push("active"); }
      if (pending && pending.id === it.id && pending.i === i) cls.push("first");
      text.append(el("span", { class: cls.join(" "), "data-i": String(i), text: x.w }));
      if (h && h.e === i) text.append(el("button", { type: "button", class: "port", "data-item": it.id, "data-hl": h.id, "aria-label": `Link “${phraseOf(it, h)}” to another passage`, title: "Drag onto a phrase in another passage to link them" }));
      text.append(" ");
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
    if (linking) {
      if (item.id === linking.id) return;
      const i = w ? Number(w.dataset.i) : null;
      const h = port ? hlById(item, port.dataset.hl) : i !== null ? hlAt(item, i) : null;
      const from = linking; linking = null;
      finishLink(from, { item, hl: h ? h.id : null, word: !h && i !== null ? i : null });
      return;
    }
    if (port) {
      if (!hintShown) { hintShown = true; GL().toast("Drag this dot onto a phrase in another passage to link them."); }
      return;
    }
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
  // as it is and start a new one, or keep adding to it. Asked once per state
  // of the deck, so refining the same search does not ask twice.
  let asking = null, keptAt = null;
  function shouldAsk() { return count() > 0 && deck.updated !== keptAt; }
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
          deck = blank(); pending = active = linking = null; save();
          GL().toast(`Saved “${v || deck.title}”. The deck is empty.`);
          finish("new");
        } }),
      ]);
      sheet.append(
        el("h2", { text: `Clear the deck for this ${kind}?` }),
        el("p", { class: "lede", text: `${deck.title ? `“${deck.title}” has` : "The deck has"} ${what}.` }),
        el("button", { type: "button", class: "primary", text: "No, keep adding to it", onclick: () => { keptAt = deck.updated; finish("keep"); } }),
        el("button", { type: "button", class: "text-btn", text: "No, save it as it is, then start a new deck", onclick: (e) => { nameRow.hidden = false; e.currentTarget.hidden = true; name.focus(); name.select(); } }),
        nameRow,
        el("button", { type: "button", class: "text-btn danger", text: "Yes, delete it and start over", onclick: () => { deck = blank(); pending = active = linking = null; save(); GL().toast("The deck is empty."); finish("new"); } }),
        el("button", { type: "button", class: "text-btn", text: "Cancel", onclick: () => finish("cancel") }),
      );
      scrim.addEventListener("click", () => finish("cancel"));
      document.addEventListener("keydown", onKey);
      document.body.append(scrim, sheet);
    });
    return asking;
  }

  // Saved decks
  function saveNamed(nameGiven) {
    const all = store.get("decks", []);
    const name = (nameGiven || "").trim() || deck.title || `Deck ${new Date().toLocaleDateString()}`;
    const i = all.findIndex((d) => d.id === deck.id);
    const entry = { id: deck.id, title: name, updated: Date.now(), deck: JSON.parse(JSON.stringify(deck)) };
    if (i >= 0) all[i] = entry; else all.unshift(entry);
    store.set("decks", all.slice(0, 50));
    flash(`Saved “${name}”.`);
  }
  function savedList(onBack, onPick) {
    const all = store.get("decks", []);
    const box = el("div", { class: "deck saved" }, [
      el("div", { class: "crumbs" }, [el("button", { type: "button", text: "Back", onclick: onBack }), el("span", { text: "My decks" })]),
    ]);
    if (!all.length) box.append(el("div", { class: "empty", text: "No saved decks yet. Build one and choose “Save to my decks” under More." }));
    for (const d of all) {
      const n = (d.deck.items || []).filter((i) => i.type === "passage").length;
      box.append(el("div", { class: "deck-item" }, [
        el("button", { type: "button", class: "body preview", onclick: () => { deck = migrate(JSON.parse(JSON.stringify(d.deck))) || blank(); pending = active = linking = null; save(); onPick(); } }, [
          el("div", { class: "cite-edit", text: d.title }),
          el("div", { class: "where", text: `${n} ${n === 1 ? "passage" : "passages"}, ${new Date(d.updated).toLocaleDateString()}` }),
        ]),
        el("div", { class: "tools" }, [el("button", { type: "button", "aria-label": "Delete", text: "×", onclick: () => { if (!confirm(`Delete “${d.title}”?`)) return; store.set("decks", all.filter((x) => x.id !== d.id)); box.replaceWith(savedList(onBack, onPick)); } })]),
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
    return { kind: "map", html: svg, where: deck.title ? `${deck.title}: the chain` : "The chain" };
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
    const W = 10, M = 0.75, inner = W - 2 * M, top = 0.98, bottom = 4.95;
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
    const surname = (it.citation || "").replace(/^(President|Elder|Sister|Brother|Bishop)\s+/, "").split(" ").pop();
    const when = (it.label || "").replace(" General Conference", "").replace(/^April /, "Apr ").replace(/^October /, "Oct ");
    return [surname, when].filter(Boolean).join(", ");
  }

  // ------------------------------------------------------------ chunking --
  // A slide holds about MAX_CHARS of scripture comfortably; longer passages
  // are split at verse or sentence boundaries, and the label says "1 of 2".
  function chunksOf(it) {
    const out = [];
    if (it.verses && it.verses.length) {
      let cur = [], len = 0;
      for (const v of it.verses) {
        if (cur.length && len + v.text.length > MAX_CHARS) { out.push({ verses: cur }); cur = []; len = 0; }
        if (v.text.length > MAX_CHARS * 1.4) {
          // one very long verse: split its sentences, keep the number on the first piece
          const parts = sentences(v.text, MAX_CHARS);
          if (cur.length) { out.push({ verses: cur }); cur = []; len = 0; }
          parts.forEach((p, i) => out.push({ verses: [{ n: i === 0 ? v.n : null, text: p }] }));
          continue;
        }
        cur.push(v); len += v.text.length;
      }
      if (cur.length) out.push({ verses: cur });
    } else {
      for (const p of sentences(it.text, MAX_CHARS)) out.push({ text: p });
    }
    out.forEach((c, i) => {
      let label = (it.kind === "verse" || !it.label) ? (it.citation || "") : it.label;
      if (c.verses && it.verses && out.length > 1) {
        const ns = c.verses.map((v) => v.n).filter((n) => n !== null);
        if (ns.length) label = `${label.replace(/:\d.*$/, "")}:${ns[0]}${ns.length > 1 ? "–" + ns[ns.length - 1] : ""}`;
      }
      c.label = out.length > 1 ? `${label} (${i + 1} of ${out.length})` : label;
    });
    return out;
  }
  function sentences(text, max) {
    const paras = text.split(/\n\n+/);
    const pieces = [];
    for (const para of paras) {
      const sents = para.match(/[^.!?;:]+[.!?;:]+["’”)]?\s*|[^.!?;:]+$/g) || [para];
      let cur = "";
      for (const s of sents) {
        if (cur && (cur + s).length > max) { pieces.push(cur.trim()); cur = ""; }
        if (s.length > max) {
          // a run-on sentence: split on commas, then hard-wrap as a last resort
          for (const bit of s.split(/(?<=,)\s+/)) {
            if (cur && (cur + bit).length > max) { pieces.push(cur.trim()); cur = ""; }
            cur += bit + " ";
          }
          continue;
        }
        cur += s;
      }
      if (cur.trim()) pieces.push(cur.trim());
    }
    return pieces.length ? pieces : [text];
  }
  function fontSize(len) {
    if (len <= 90) return 40;
    if (len <= 170) return 36;
    if (len <= 260) return 32;
    if (len <= 350) return 28;
    return 26;
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
  function backgroundImage(t) {
    if (!t.gradient || typeof document === "undefined") return null;
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
      const data = c.toDataURL("image/png");
      return data.startsWith("data:image/png") ? data.slice(5) : null;
    } catch (_) { return null; }
  }

  async function build(opts = {}) {
    const PptxGenJS = await loadLib();
    const t = THEMES[deck.theme] || THEMES[DEFAULT_THEME];
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 in
    pptx.title = deck.title || "Scriptures";
    const W = 10, H = 5.625, M = 0.75, inner = W - 2 * M;
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
      s.addText(String(text || "").toUpperCase(), { x: M, y: 0.46, w: inner, h: 0.34, fontFace: SANS, fontSize: 12, color: t.accent, charSpacing: 2, margin: 0, valign: "top", fit: "shrink" });
      rule(s, M, 0.86, 0.55);
    };
    const footer = (s, idx) => {
      s.addShape(pptx.ShapeType.line, { x: M, y: H - 0.58, w: inner, h: 0, line: { color: t.rule, width: 0.75 } });
      if (deck.title) s.addText(deck.title, { x: M, y: H - 0.52, w: inner - 1, h: 0.3, fontFace: SANS, fontSize: 10, color: t.muted, margin: 0 });
      s.addText(String(idx), { x: W - M - 1, y: H - 0.52, w: 1, h: 0.3, fontFace: SANS, fontSize: 10, color: t.muted, align: "right", margin: 0 });
    };

    // Title slide
    if (deck.title || deck.subtitle) {
      const s = slide();
      rule(s, M, 1.55, 0.9);
      s.addText(deck.title || "", { x: M, y: 1.7, w: inner, h: 1.7, fontFace: SERIF, fontSize: 40, bold: true, color: t.text, valign: "top", margin: 0, fit: "shrink" });
      if (deck.subtitle) s.addText(deck.subtitle, { x: M, y: 3.45, w: inner, h: 0.6, fontFace: SANS, fontSize: 18, color: t.muted, valign: "top", margin: 0 });
    }

    for (const it of sequence()) {
      if (it.type === "section") {
        n++;
        const s = slide();
        s.addText(it.title || "", { x: M, y: 1.9, w: inner, h: 1.4, fontFace: SERIF, fontSize: 40, bold: true, color: t.text, align: "center", valign: "middle", margin: 0, fit: "shrink" });
        rule(s, W / 2 - 0.45, 3.42, 0.9);
        footer(s, n);
        continue;
      }
      if (it.type === "link") {
        const a = endOf(it.from), b = endOf(it.to);
        if (!a || !b) continue;
        n++;
        const s = slide();
        kicker(s, it.label ? `Connection: ${it.label}` : "Connection");
        const colW = 3.75, gap = inner - 2 * colW, top = 1.12, panelH = 3.3, pad = 0.22;
        const side = (end, x) => {
          const { item, hl } = end;
          s.addShape(pptx.ShapeType.roundRect, { x, y: top, w: colW, h: panelH, fill: { color: t.panel }, line: { color: t.panel, width: 0 }, rectRadius: 0.1 });
          const ex = excerpt(item, hl);
          const runs = ex.words.map((w, i) => ({ text: w.w + (i < ex.words.length - 1 ? " " : ""), options: hl && i >= ex.s && i <= ex.e ? { color: t.accent, bold: true } : { color: t.text } }));
          if (ex.before) runs.unshift({ text: "… ", options: { color: t.muted } });
          if (ex.after) runs.push({ text: " …", options: { color: t.muted } });
          const len = ex.words.reduce((a2, w) => a2 + w.w.length + 1, 0);
          s.addText(runs, { x: x + pad, y: top + pad, w: colW - 2 * pad, h: panelH - 0.95, fontFace: SERIF, fontSize: len > 300 ? 15 : len > 200 ? 17 : len > 120 ? 19 : 22, valign: "middle", align: "left", lineSpacingMultiple: 1.12, margin: 0, fit: "shrink" });
          s.addText(item.citation + (item.kind !== "verse" && item.where ? `, ${item.where}` : ""), { x: x + pad, y: top + panelH - 0.62, w: colW - 2 * pad, h: 0.45, fontFace: SANS, fontSize: 12, color: t.accent, valign: "bottom", margin: 0, fit: "shrink" });
        };
        side(a, M);
        side(b, M + colW + gap);
        const ax = M + colW + 0.14, aw = gap - 0.28, ay = top + panelH / 2;
        s.addShape(pptx.ShapeType.line, { x: ax, y: ay, w: aw, h: 0, line: { color: t.accent, width: 2.5, endArrowType: "triangle" } });
        if (it.label) s.addText(it.label, { x: M + colW - 0.3, y: ay - 0.62, w: gap + 0.6, h: 0.5, fontFace: SANS, fontSize: 12, color: t.accent, align: "center", valign: "bottom", margin: 0, fit: "shrink" });
        footer(s, n);
        continue;
      }
      for (const chunk of chunksOf(it)) {
        n++;
        const s = slide();
        const isTalk = it.kind !== "verse";
        kicker(s, chunk.label);
        const runs = passageRuns(it, chunk, t);
        const len = chunk.verses ? chunk.verses.reduce((a, v) => a + v.text.length, 0) : chunk.text.length;
        const boxH = isTalk && (it.citation || it.where) ? 3.05 : 3.5;
        s.addText(runs, { x: M, y: 1.08, w: inner, h: boxH, fontFace: SERIF, fontSize: fontSize(len), color: t.text, valign: "middle", align: "left", lineSpacingMultiple: 1.15, margin: 0, fit: "shrink" });
        if (isTalk && (it.citation || it.where)) {
          s.addText([
            { text: it.citation || "", options: { bold: true, fontSize: 15, color: t.text, breakLine: !!it.where } },
            ...(it.where ? [{ text: it.where, options: { fontSize: 12, color: t.muted } }] : []),
          ], { x: M, y: 4.2, w: inner, h: 0.7, fontFace: SANS, valign: "top", margin: 0 });
        }
        footer(s, n);
      }
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
          s.addText(l.label, { x: x - 1.0, y: above === null ? y - 0.14 : above ? y - 0.3 : y + 0.02, w: 2.0, h: 0.28, fontFace: SANS, fontSize: 10, color: t.accent, align: "center", valign: above === null ? "middle" : above ? "bottom" : "top", margin: 0, fit: "shrink" });
        }
      }
      for (const nd of lay.nodes) {
        const big = nd.w >= 2;
        s.addText([
          { text: nd.label, options: { bold: true, fontSize: big ? 11 : 10, color: t.accent, fontFace: SANS, breakLine: true, paraSpaceAfter: 3 } },
          { text: nd.excerpt, options: { fontSize: big ? 11 : nd.w >= 1.7 ? 10 : 9, color: t.text, fontFace: SERIF } },
        ], { x: nd.x - nd.w / 2, y: nd.y - nd.h / 2, w: nd.w, h: nd.h, align: "center", valign: "middle", margin: 6, fit: "shrink", lineSpacingMultiple: 1.05,
          fill: { color: t.panel }, line: { color: t.accent, width: 1 }, rectRadius: 0.08, shape: pptx.ShapeType.roundRect });
      }
      footer(s, n);
    }
    return pptx;
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

  async function downloadFile() {
    const status = ui ? ui.status : null;
    const say = (s) => { if (status) status.textContent = s; };
    try {
      say("Building the PowerPoint file…");
      const pptx = await build();
      const blob = await pptx.write({ outputType: "blob" });
      const name = `${(deck.title || "Scriptures").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Scriptures"}.pptx`;
      const file = new File([blob], name, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); say(""); return; }
        catch (err) { if (err.name === "AbortError") { say(""); return; } }
      }
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      say(`Saved ${name}.`);
    } catch (err) {
      say(`Could not build the file: ${err.message}`);
    }
  }

  window.Deck = {
    render, board: boardEl, showBoard, addFromDoc, addPassage, has, remove, toggle, count, updateBadge,
    shouldAsk, askAboutDeck, present: presentDeck, chunksOf, build, THEMES,
    // for tests and scripts
    get state() { return deck; }, setHighlight: (id, a, b) => { const it = byId(id); if (!it) return null; const h = setHighlight(it, a, b); save(); return h; }, link: (from, to, label) => { const l = addLink(from, to, label); if (l) save(); return l; }, sequence,
  };
  updateBadge();
})();
