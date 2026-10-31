/* Deck: collect passages, arrange them, and turn them into a PowerPoint file
   (or present them straight from the device). Everything runs here; the
   .pptx is written in the browser by PptxGenJS. */
(() => {
  "use strict";

  const { el, esc, store } = window.GL || {};
  const GL = () => window.GL;
  const $ = (sel, root = document) => root.querySelector(sel);

  // ------------------------------------------------------------- themes --
  // Hex colors without "#", as PptxGenJS wants them. Fonts are ones that ship
  // with PowerPoint and Keynote on Mac, Windows and iPad.
  const THEMES = {
    paper: { name: "Paper", bg: "FBFAF7", text: "1D1F23", accent: "1F4E79", muted: "7A7F88", rule: "D9D6CF", bar: null },
    night: { name: "Night", bg: "0E1013", text: "F2EFE8", accent: "E3C27A", muted: "9AA0A8", rule: "2A2E34", bar: null },
    linen: { name: "Linen", bg: "F1EDE4", text: "2A2622", accent: "7A4E2D", muted: "8C847B", rule: "DCD5C8", bar: "7A4E2D" },
    slate: { name: "Slate", bg: "1F2A37", text: "FFFFFF", accent: "9ECAE1", muted: "AEB8C4", rule: "33404F", bar: null },
  };
  const SERIF = "Georgia";
  const SANS = "Calibri";
  const MAX_CHARS = 430;

  // ---------------------------------------------------------------- model --
  const uid = () => Math.random().toString(36).slice(2, 10);
  const blank = () => ({ id: uid(), title: "", subtitle: "", theme: "paper", items: [], updated: Date.now() });
  let deck = store.get("deck") || blank();
  if (!deck.id) deck.id = uid();
  const save = () => { deck.updated = Date.now(); store.set("deck", deck); updateBadge(); };

  function count() { return deck.items.filter((i) => i.type === "passage").length; }
  function updateBadge() {
    const b = $("#deckBtn");
    if (b) b.textContent = count() ? `Deck ${count()}` : "Deck";
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
    for (const r of runs) {
      const verses = r.kind === "verse" ? r.units.map((u) => ({ n: u.verse, text: u.text })) : null;
      const text = verses ? verses.map((v) => v.text).join(" ") : r.units.map((u) => u.text).join("\n\n");
      deck.items.push({
        id: uid(), type: "passage", kind: r.kind === "verse" ? "verse" : "para",
        text, verses, doc_id: doc.id, pid: r.units[0].pid,
        ...citationFor(doc, verses),
      });
    }
    save();
    return runs.length;
  }

  /** Add one search hit or Ask passage: {doc_id, pid, kind, text, citation, author, title, label, collection, verse}. */
  function addPassage(p) {
    const verses = p.verses && p.verses.length ? p.verses.map((v) => ({ n: v.n, text: v.text })) : (p.kind === "verse" && p.verse ? [{ n: p.verse, text: p.text }] : null);
    const item = {
      id: uid(), type: "passage", kind: p.kind === "verse" ? "verse" : "para",
      text: verses ? verses.map((v) => v.text).join(" ") : p.text, verses, doc_id: p.doc_id, pid: p.pid,
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

  // ------------------------------------------------------------------ ui --
  let view = null;
  function render(container) {
    view = container;
    container.replaceChildren();
    const box = el("div", { class: "deck" });
    const title = el("input", { class: "deck-title", value: deck.title, placeholder: "Deck title (first slide)", "aria-label": "Deck title" });
    const subtitle = el("input", { class: "deck-subtitle", value: deck.subtitle, placeholder: "Subtitle, date, or audience", "aria-label": "Subtitle" });
    title.addEventListener("input", () => { deck.title = title.value; save(); });
    subtitle.addEventListener("input", () => { deck.subtitle = subtitle.value; save(); });

    const themes = el("div", { class: "themes" });
    for (const [key, t] of Object.entries(THEMES)) {
      const sw = el("button", { type: "button", class: "theme" + (deck.theme === key ? " on" : ""), title: t.name, "aria-label": `${t.name} theme`, onclick: () => { deck.theme = key; save(); render(container); } }, [
        el("span", { class: "swatch", style: `background:#${t.bg};color:#${t.text};border-color:#${t.rule}` }, [el("b", { text: "Aa", style: `color:#${t.text}` }), el("i", { style: `background:#${t.accent}` })]),
        el("span", { class: "theme-name", text: t.name }),
      ]);
      themes.append(sw);
    }

    const list = el("div", { class: "deck-list" });
    renderList(list, container);

    const actions = el("div", { class: "deck-actions" }, [
      el("button", { type: "button", class: "primary", text: "Download PowerPoint", disabled: !deck.items.length, onclick: () => download(container) }),
      el("button", { type: "button", class: "text-btn", text: "Present", disabled: !deck.items.length, onclick: () => present() }),
      el("button", { type: "button", class: "text-btn", text: "Add section", onclick: () => { deck.items.push({ id: uid(), type: "section", title: "" }); save(); render(container); } }),
    ]);
    const more = el("div", { class: "deck-actions secondary" }, [
      el("button", { type: "button", class: "text-btn", text: "Save to my decks", disabled: !deck.items.length, onclick: () => { saveNamed(); render(container); } }),
      el("button", { type: "button", class: "text-btn", text: "My decks", onclick: () => renderSaved(container) }),
      el("button", { type: "button", class: "text-btn danger", text: "Start a new deck", disabled: !deck.items.length && !deck.title, onclick: () => { if (deck.items.length && !confirm("Start a new, empty deck? The current one is kept only if you saved it.")) return; deck = blank(); save(); render(container); } }),
    ]);
    const hint = el("p", { class: "deck-hint", text: deck.items.length ? "" : "Tap verses or paragraphs while reading to select them, then “Add to deck”. The + on a search result adds it directly. Ask can add every passage it cites." });
    const status = el("div", { class: "deck-status", id: "deckStatus" });
    box.append(title, subtitle, themes, list, actions, more, status, hint);
    container.append(box);
  }

  function renderList(list, container) {
    list.replaceChildren();
    deck.items.forEach((it, idx) => {
      const row = el("div", { class: "deck-item" + (it.type === "section" ? " section" : "") });
      if (it.type === "section") {
        const inp = el("input", { value: it.title, placeholder: "Section title", "aria-label": "Section title" });
        inp.addEventListener("input", () => { it.title = inp.value; save(); });
        row.append(el("div", { class: "body" }, [el("div", { class: "kind", text: "Section" }), inp]));
      } else if (it.type === "link") {
        const a = byId(it.from.id), b = byId(it.to.id);
        if (!a || !b) { deck.items.splice(idx, 1); save(); return; }
        const label = el("input", { value: it.label || "", placeholder: "What the arrow says (fulfilled in, same word, echoes…)", "aria-label": "Connection label" });
        label.addEventListener("input", () => { it.label = label.value; save(); });
        row.classList.add("link");
        row.append(el("div", { class: "body" }, [
          el("div", { class: "kind", text: "Connection" }),
          el("div", { class: "link-line", html: `<b>${esc(phraseOf(a, it.from.hl) || a.citation)}</b> <span class="arrow">→</span> <b>${esc(phraseOf(b, it.to.hl) || b.citation)}</b>` }),
          el("div", { class: "where", text: `${a.citation} → ${b.citation}` }),
          label,
        ]));
      } else {
        const cite = el("input", { value: it.citation, "aria-label": "Citation", class: "cite-edit" });
        cite.addEventListener("input", () => { it.citation = cite.value; save(); });
        const preview = el("button", { type: "button", class: "preview", html: previewHtml(it), onclick: () => it.doc_id && GL().openDoc(it.doc_id, it.pid) });
        const marks = el("div", { class: "marks" }, [
          el("button", { type: "button", class: "chip small", text: it.hl?.length ? `Highlight (${it.hl.length})` : "Highlight", onclick: () => renderMark(container, it) }),
          el("button", { type: "button", class: "chip small", text: "Connect", onclick: () => renderConnect(container, it, null) }),
        ]);
        row.append(el("div", { class: "body" }, [cite, it.where || it.label ? el("div", { class: "where", text: [it.where, it.label].filter(Boolean).join(", ") }) : null, preview, marks]));
      }
      row.append(el("div", { class: "tools" }, [
        el("button", { type: "button", "aria-label": "Move up", text: "↑", disabled: idx === 0, onclick: () => { move(idx, -1); renderList(list, container); } }),
        el("button", { type: "button", "aria-label": "Move down", text: "↓", disabled: idx === deck.items.length - 1, onclick: () => { move(idx, 1); renderList(list, container); } }),
        el("button", { type: "button", "aria-label": "Remove", text: "×", onclick: () => { deck.items.splice(idx, 1); save(); render(container); } }),
      ]));
      list.append(row);
    });
  }
  function move(i, d) {
    const j = i + d;
    if (j < 0 || j >= deck.items.length) return;
    [deck.items[i], deck.items[j]] = [deck.items[j], deck.items[i]];
    save();
  }

  // ------------------------------------------------------- highlights --
  // A highlight is a range of word indexes over the passage's words, so it
  // survives re-rendering and never depends on text selection.
  function byId(id) { return deck.items.find((i) => i.id === id) || null; }
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
  function phraseOf(it, hl) {
    if (!hl) return "";
    return wordsOf(it).slice(hl.s, hl.e + 1).map((x) => x.w).join(" ");
  }
  function previewHtml(it) {
    const words = wordsOf(it);
    let html = "", len = 0;
    for (let i = 0; i < words.length; i++) {
      const piece = esc(words[i].w) + " ";
      html += inHl(it, i) ? `<mark>${piece}</mark>` : piece;
      len += words[i].w.length + 1;
      if (len > 170 && !inHl(it, i)) { html += "…"; break; }
    }
    return html;
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

  // Mark a phrase: tap the first word, then the last.
  function renderMark(container, it) {
    let first = null;
    const box = el("div", { class: "deck mark" }, [
      el("div", { class: "crumbs" }, [el("button", { text: "Back to deck", onclick: () => render(container) }), el("span", { text: it.citation })]),
      el("p", { class: "deck-hint", text: "Tap the first word of a phrase, then the last word. Tap a highlighted phrase to remove it." }),
    ]);
    const text = el("div", { class: "mark-text" });
    const draw = () => {
      text.replaceChildren();
      wordsOf(it).forEach((x, i) => {
        if (x.first && x.para > 0) text.append(el("br"), el("br"));
        if (x.n !== null && x.n !== undefined) text.append(el("span", { class: "vn", text: String(x.n) }));
        const span = el("button", { type: "button", class: "w" + (inHl(it, i) ? " hl" : "") + (first === i ? " first" : ""), text: x.w, onclick: () => {
          const existing = (it.hl || []).findIndex((h) => i >= h.s && i <= h.e);
          if (existing >= 0 && first === null) { it.hl.splice(existing, 1); save(); draw(); return; }
          if (first === null) { first = i; draw(); return; }
          const [a, b] = first <= i ? [first, i] : [i, first];
          it.hl = (it.hl || []).filter((h) => h.e < a || h.s > b);
          it.hl.push({ s: a, e: b }); it.hl.sort((p, q) => p.s - q.s);
          first = null; save(); draw();
        } });
        text.append(span, " ");
      });
    };
    draw();
    const acts = el("div", { class: "deck-actions" }, [
      el("button", { type: "button", class: "primary", text: "Done", onclick: () => {
        if (pendingConnect && pendingConnect.to === it) { const pc = pendingConnect; pendingConnect = null; renderConnect(container, pc.from, pc.hl); return; }
        render(container);
      } }),
      el("button", { type: "button", class: "text-btn", text: "Connect a highlighted phrase…", onclick: () => renderConnect(container, it, (it.hl || [])[it.hl ? it.hl.length - 1 : 0] || null) }),
    ]);
    box.append(text, acts);
    container.replaceChildren(box);
  }

  // Connect: pick the phrase, the target passage, its phrase, and the arrow's label.
  function renderConnect(container, from, hl) {
    const state = { hl: hl || (from.hl || [])[0] || null, to: null, toHl: null, label: "" };
    const box = el("div", { class: "deck connect" }, [
      el("div", { class: "crumbs" }, [el("button", { text: "Back to deck", onclick: () => render(container) }), el("span", { text: "Connect" })]),
    ]);
    const body = el("div");
    box.append(body);
    container.replaceChildren(box);

    const step = () => {
      body.replaceChildren();
      // 1. phrase in the source
      body.append(el("h2", { text: `From ${from.citation}` }));
      const phrases = el("div", { class: "shelf" });
      for (const h of from.hl || []) phrases.append(el("button", { type: "button", class: "chip" + (state.hl === h ? " on" : ""), text: phraseOf(from, h), onclick: () => { state.hl = h; step(); } }));
      phrases.append(el("button", { type: "button", class: "chip" + (state.hl === null ? " on" : ""), text: "Whole passage", onclick: () => { state.hl = null; step(); } }));
      phrases.append(el("button", { type: "button", class: "chip", text: "Mark a new phrase…", onclick: () => renderMark(container, from) }));
      body.append(phrases);

      // 2. target
      body.append(el("h2", { text: "Points to" }));
      const targets = el("div", { class: "target-list" });
      const candidates = deck.items.filter((i) => i.type === "passage" && i.id !== from.id);
      if (!candidates.length) targets.append(el("div", { class: "deck-hint", text: "No other passages in the deck yet. Search below to add one." }));
      for (const c of candidates) {
        targets.append(el("button", { type: "button", class: "toc-row" + (state.to === c ? " on" : ""), onclick: () => { state.to = c; state.toHl = (c.hl || [])[0] || null; step(); } }, [
          el("div", { class: "t", text: c.citation }), el("div", { class: "s", text: c.text.slice(0, 60) + "…" })]));
      }
      body.append(targets);
      const search = el("input", { class: "deck-subtitle", placeholder: "Or search for a passage to add (Alma 32:21, or words)", "aria-label": "Search" });
      const results = el("div");
      let timer = null;
      search.addEventListener("input", () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          results.replaceChildren();
          const q = search.value.trim();
          if (q.length < 2) return;
          const r = await GL().api("search", { q, typeahead: true, limit: 8 });
          const add = (p) => { addPassage(p); state.to = deck.items[deck.items.length - 1]; state.toHl = null; step(); };
          if (r.jump?.doc_id && r.jump.pid) {
            const ctx = await GL().api("context", { doc_id: r.jump.doc_id, pid: r.jump.pid, before: 0, after: (r.jump.verse_end || 0) ? Math.max(0, r.jump.verse_end - parseInt(r.jump.pid.slice(1), 10)) : 0 });
            if (ctx) results.append(el("button", { type: "button", class: "toc-row", onclick: () => add({ doc_id: r.jump.doc_id, pid: r.jump.pid, kind: "verse", verse: ctx.paragraphs[0]?.verse, text: ctx.paragraphs.map((x) => x.text).join(" "), citation: ctx.citation, collection: "scriptures", verses: ctx.paragraphs.map((x) => ({ n: x.verse, text: x.text })) }) }, [el("div", { class: "t", text: ctx.citation }), el("div", { class: "s", text: "add" })]));
          }
          for (const h of r.hits.slice(0, 6)) {
            results.append(el("button", { type: "button", class: "toc-row", onclick: () => add({ doc_id: h.doc_id, pid: h.pid, kind: h.kind, verse: h.verse, text: el("div", { html: h.snippet }).textContent, citation: h.citation, label: h.label, author: h.author, title: h.title, collection: h.collection }) }, [
              el("div", { class: "t", text: h.citation }), el("div", { class: "s", text: "add" })]));
          }
        }, 200);
      });
      body.append(search, results);

      // 3. phrase in the target + label
      if (state.to) {
        body.append(el("h2", { text: `Phrase in ${state.to.citation}` }));
        const tp = el("div", { class: "shelf" });
        for (const h of state.to.hl || []) tp.append(el("button", { type: "button", class: "chip" + (state.toHl === h ? " on" : ""), text: phraseOf(state.to, h), onclick: () => { state.toHl = h; step(); } }));
        tp.append(el("button", { type: "button", class: "chip" + (state.toHl === null ? " on" : ""), text: "Whole passage", onclick: () => { state.toHl = null; step(); } }));
        tp.append(el("button", { type: "button", class: "chip", text: "Mark a phrase…", onclick: () => { pendingConnect = { from, hl: state.hl, to: state.to }; renderMark(container, state.to); } }));
        body.append(tp);
        body.append(el("h2", { text: "The arrow says" }));
        const quick = el("div", { class: "shelf" });
        for (const l of ["fulfilled in", "same word", "echoes", "defines", "explains", "contrast", "promise and keeping"]) quick.append(el("button", { type: "button", class: "chip" + (state.label === l ? " on" : ""), text: l, onclick: () => { state.label = l; labelInput.value = l; } }));
        const labelInput = el("input", { class: "deck-subtitle", placeholder: "Your own words for the connection", value: state.label });
        labelInput.addEventListener("input", () => { state.label = labelInput.value; });
        body.append(quick, labelInput);
        body.append(el("div", { class: "deck-actions" }, [
          el("button", { type: "button", class: "primary", text: "Add connection slide", onclick: () => {
            const link = { id: uid(), type: "link", from: { id: from.id, hl: state.hl ? { ...state.hl } : null }, to: { id: state.to.id, hl: state.toHl ? { ...state.toHl } : null }, label: state.label.trim() };
            // Place it right after the later of the two passages so the story reads in order.
            const idx = Math.max(deck.items.indexOf(from), deck.items.indexOf(state.to));
            deck.items.splice(idx + 1, 0, link);
            save(); render(container);
            GL().toast("Connection added.");
          } }),
        ]));
      }
    };
    step();
  }
  let pendingConnect = null;

  // Saved decks
  function saveNamed() {
    const all = store.get("decks", []);
    const name = deck.title || `Deck ${new Date().toLocaleDateString()}`;
    const i = all.findIndex((d) => d.id === deck.id);
    const entry = { id: deck.id, title: name, updated: Date.now(), deck: JSON.parse(JSON.stringify(deck)) };
    if (i >= 0) all[i] = entry; else all.unshift(entry);
    store.set("decks", all.slice(0, 50));
    flash(`Saved “${name}”.`);
  }
  function renderSaved(container) {
    const all = store.get("decks", []);
    const box = el("div", { class: "deck" }, [
      el("div", { class: "crumbs" }, [el("button", { text: "Back", onclick: () => render(container) }), el("span", { text: "My decks" })]),
    ]);
    if (!all.length) box.append(el("div", { class: "empty", text: "No saved decks yet. Build one and tap “Save to my decks”." }));
    for (const d of all) {
      box.append(el("div", { class: "deck-item" }, [
        el("button", { type: "button", class: "body preview", onclick: () => { deck = JSON.parse(JSON.stringify(d.deck)); save(); render(container); } }, [
          el("div", { class: "cite-edit", text: d.title }),
          el("div", { class: "where", text: `${d.deck.items.filter((i) => i.type === "passage").length} passages, ${new Date(d.updated).toLocaleDateString()}` }),
        ]),
        el("div", { class: "tools" }, [el("button", { type: "button", "aria-label": "Delete", text: "×", onclick: () => { if (!confirm(`Delete “${d.title}”?`)) return; store.set("decks", all.filter((x) => x.id !== d.id)); renderSaved(container); } })]),
      ]));
    }
    container.replaceChildren(box);
  }
  function flash(text) {
    const s = $("#deckStatus");
    if (s) { s.textContent = text; setTimeout(() => { if (s.textContent === text) s.textContent = ""; }, 4000); }
  }

  // --------------------------------------------------------------- present --
  function present() {
    const units = [];
    if (deck.title) units.push({ kind: "title", html: esc(deck.title), where: deck.subtitle || "" });
    for (const it of deck.items) {
      if (it.type === "section") { units.push({ kind: "title", html: esc(it.title || "—"), where: "" }); continue; }
      if (it.type === "link") { const u = linkUnit(it); if (u) units.push(u); continue; }
      for (const chunk of chunksOf(it)) units.push({ kind: it.kind, html: chunkHtml(it, chunk), where: it.kind === "verse" ? chunk.label : [it.citation, it.where, chunk.label].filter(Boolean).join("  ·  "), doc_id: it.doc_id });
    }
    const map = mapUnit();
    if (map) units.push(map);
    GL().startPresentingUnits(units);
  }
  // Chunk text with verse numbers and highlights, as HTML for the stage.
  function chunkHtml(it, chunk) {
    const words = wordsOf(it);
    let offset = 0;
    if (chunk.verses && it.verses) {
      // word offset of this chunk within the passage
      const firstN = chunk.verses.find((v) => v.n !== null)?.n;
      const idx = it.verses.findIndex((v) => v.n === firstN);
      offset = it.verses.slice(0, Math.max(0, idx)).reduce((a, v) => a + v.text.split(/\s+/).filter(Boolean).length, 0);
      const parts = [];
      let i = offset;
      for (const v of chunk.verses) {
        if (v.n !== null && v.n !== undefined) parts.push(`<span class="vn">${v.n}</span>`);
        for (const w of v.text.split(/\s+/).filter(Boolean)) { parts.push(inHl(it, i) ? `<mark>${esc(w)}</mark>` : esc(w)); i++; }
      }
      return parts.join(" ").replace(/<\/mark> <mark>/g, " ");
    }
    // paragraphs: find where this chunk starts in the full text
    const startWord = it.text.slice(0, it.text.indexOf(chunk.text)).split(/\s+/).filter(Boolean).length;
    const parts = [];
    chunk.text.split(/\n\n+/).forEach((para, pi) => {
      if (pi) parts.push("<br><br>");
      para.split(/\s+/).filter(Boolean).forEach((w) => { parts.push(inHl(it, startWord + parts.filter((x) => x !== "<br><br>").length) ? `<mark>${esc(w)}</mark>` : esc(w)); });
    });
    return parts.join(" ").replace(/<\/mark> <mark>/g, " ");
  }
  function excerptHtml(it, hl) {
    const ex = excerpt(it, hl);
    const parts = ex.words.map((x, i) => (i >= ex.s && i <= ex.e && hl ? `<mark>${esc(x.w)}</mark>` : esc(x.w)));
    return (ex.before ? "… " : "") + parts.join(" ").replace(/<\/mark> <mark>/g, " ") + (ex.after ? " …" : "");
  }
  function linkUnit(it) {
    const a = byId(it.from.id), b = byId(it.to.id);
    if (!a || !b) return null;
    const html = `<div class="stage-link"><div class="side"><div class="x">${excerptHtml(a, it.from.hl)}</div><div class="ref">${esc(a.citation)}</div></div>` +
      `<div class="mid"><div class="arrow">→</div><div class="lbl">${esc(it.label || "")}</div></div>` +
      `<div class="side"><div class="x">${excerptHtml(b, it.to.hl)}</div><div class="ref">${esc(b.citation)}</div></div></div>`;
    return { kind: "link", html, where: "" };
  }
  function mapUnit() {
    const g = graph();
    if (!g) return null;
    const W = 1000, H = 560, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 70;
    const pos = {};
    g.nodes.forEach((n, i) => { const ang = -Math.PI / 2 + (2 * Math.PI * i) / g.nodes.length; pos[n.id] = { x: cx + R * Math.cos(ang), y: cy + R * Math.sin(ang) }; });
    let svg = `<svg class="stage-map" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>`;
    for (const e of g.edges) {
      const a = pos[e.from], b = pos[e.to];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, pad = 78;
      const x1 = a.x + ux * pad, y1 = a.y + uy * pad, x2 = b.x - ux * pad, y2 = b.y - uy * pad;
      svg += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="2.5" marker-end="url(#ah)" opacity=".8"/>`;
      if (e.label) svg += `<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 8}" text-anchor="middle" font-size="18" fill="currentColor" opacity=".85">${esc(e.label)}</text>`;
    }
    for (const n of g.nodes) {
      const p = pos[n.id];
      svg += `<rect x="${p.x - 76}" y="${p.y - 26}" width="152" height="52" rx="10" fill="none" stroke="currentColor" stroke-width="2"/><text x="${p.x}" y="${p.y + 6}" text-anchor="middle" font-size="19" font-weight="600" fill="currentColor">${esc(n.label)}</text>`;
    }
    svg += "</svg>";
    return { kind: "map", html: svg, where: deck.title ? `${deck.title}: the connections` : "The connections" };
  }
  // Nodes and edges for the map: every passage that takes part in a connection.
  function graph() {
    const edges = deck.items.filter((i) => i.type === "link" && byId(i.from.id) && byId(i.to.id)).map((i) => ({ from: i.from.id, to: i.to.id, label: i.label || "" }));
    if (!edges.length) return null;
    const ids = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
    const nodes = ids.map((id) => ({ id, label: shortCitation(byId(id)) }));
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

  async function build() {
    const PptxGenJS = await loadLib();
    const t = THEMES[deck.theme] || THEMES.paper;
    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 in
    pptx.title = deck.title || "Scriptures";
    const W = 10, H = 5.625, M = 0.75, inner = W - 2 * M;
    const total = deck.items.length;
    let n = 0;

    const base = (slide) => {
      slide.background = { color: t.bg };
      if (t.bar) slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.14, h: H, fill: { color: t.bar }, line: { color: t.bar, width: 0 } });
    };
    const footer = (slide, idx) => {
      slide.addShape(pptx.ShapeType.line, { x: M, y: H - 0.58, w: inner, h: 0, line: { color: t.rule, width: 0.75 } });
      if (deck.title) slide.addText(deck.title, { x: M, y: H - 0.52, w: inner - 1, h: 0.3, fontFace: SANS, fontSize: 10, color: t.muted, margin: 0 });
      slide.addText(String(idx), { x: W - M - 1, y: H - 0.52, w: 1, h: 0.3, fontFace: SANS, fontSize: 10, color: t.muted, align: "right", margin: 0 });
    };

    // Title slide
    if (deck.title || deck.subtitle) {
      const s = pptx.addSlide(); base(s);
      s.addShape(pptx.ShapeType.rect, { x: M, y: 1.55, w: 0.9, h: 0.045, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
      s.addText(deck.title || "", { x: M, y: 1.7, w: inner, h: 1.7, fontFace: SERIF, fontSize: 40, bold: true, color: t.text, valign: "top", margin: 0, fit: "shrink" });
      if (deck.subtitle) s.addText(deck.subtitle, { x: M, y: 3.45, w: inner, h: 0.6, fontFace: SANS, fontSize: 18, color: t.muted, valign: "top", margin: 0 });
    }

    for (const it of deck.items) {
      if (it.type === "section") {
        n++;
        const s = pptx.addSlide(); base(s);
        s.addText(it.title || "", { x: M, y: 1.9, w: inner, h: 1.4, fontFace: SERIF, fontSize: 40, bold: true, color: t.text, align: "center", valign: "middle", margin: 0, fit: "shrink" });
        s.addShape(pptx.ShapeType.rect, { x: W / 2 - 0.45, y: 3.42, w: 0.9, h: 0.045, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
        footer(s, n);
        continue;
      }
      if (it.type === "link") {
        const a = byId(it.from.id), b = byId(it.to.id);
        if (!a || !b) continue;
        n++;
        const s = pptx.addSlide(); base(s);
        const colW = 3.75, gap = inner - 2 * colW; // 1.0in middle for the arrow
        const side = (item, hl, x) => {
          const ex = excerpt(item, hl);
          const runs = ex.words.map((w, i) => ({ text: w.w + (i < ex.words.length - 1 ? " " : ""), options: hl && i >= ex.s && i <= ex.e ? { color: t.accent, bold: true } : { color: t.text } }));
          if (ex.before) runs.unshift({ text: "… ", options: { color: t.muted } });
          if (ex.after) runs.push({ text: " …", options: { color: t.muted } });
          const len = ex.words.reduce((a2, w) => a2 + w.w.length + 1, 0);
          s.addText(runs, { x, y: 1.0, w: colW, h: 2.9, fontFace: SERIF, fontSize: len > 300 ? 16 : len > 200 ? 18 : len > 120 ? 20 : 24, valign: "middle", align: "left", lineSpacingMultiple: 1.12, margin: 0, fit: "shrink" });
          s.addText(item.citation + (item.kind !== "verse" && item.where ? `, ${item.where}` : ""), { x, y: 3.95, w: colW, h: 0.5, fontFace: SANS, fontSize: 13, color: t.accent, valign: "top", margin: 0 });
        };
        side(a, it.from.hl, M);
        side(b, it.to.hl, M + colW + gap);
        // the arrow and its label
        const ax = M + colW + 0.12, aw = gap - 0.24;
        s.addShape(pptx.ShapeType.line, { x: ax, y: 2.45, w: aw, h: 0, line: { color: t.accent, width: 2.75, endArrowType: "triangle" } });
        if (it.label) s.addText(it.label, { x: M + colW - 0.35, y: 1.9, w: gap + 0.7, h: 0.5, fontFace: SANS, fontSize: 13, color: t.accent, align: "center", valign: "bottom", margin: 0, fit: "shrink" });
        footer(s, n);
        continue;
      }
      for (const chunk of chunksOf(it)) {
        n++;
        const s = pptx.addSlide(); base(s);
        const isTalk = it.kind !== "verse";
        s.addText(chunk.label, { x: M, y: 0.5, w: inner, h: 0.4, fontFace: SANS, fontSize: 14, color: t.accent, margin: 0, valign: "top" });
        const runs = passageRuns(it, chunk, t);
        const len = chunk.verses ? chunk.verses.reduce((a, v) => a + v.text.length, 0) : chunk.text.length;
        const boxH = isTalk && it.where ? 3.15 : 3.55;
        s.addText(runs, { x: M, y: 1.0, w: inner, h: boxH, fontFace: SERIF, fontSize: fontSize(len), color: t.text, valign: "middle", align: "left", lineSpacingMultiple: 1.12, margin: 0, fit: "shrink" });
        if (isTalk && (it.citation || it.where)) {
          s.addText([
            { text: it.citation || "", options: { bold: true, fontSize: 15, color: t.text, breakLine: !!it.where } },
            ...(it.where ? [{ text: it.where, options: { fontSize: 12, color: t.muted } }] : []),
          ], { x: M, y: 4.2, w: inner, h: 0.7, fontFace: SANS, valign: "top", margin: 0 });
        }
        footer(s, n);
      }
    }

    // The web of connections, one slide at the end.
    const g = graph();
    if (g) {
      n++;
      const s = pptx.addSlide(); base(s);
      s.addText(deck.title ? `${deck.title}: the connections` : "The connections", { x: M, y: 0.45, w: inner, h: 0.4, fontFace: SANS, fontSize: 14, color: t.accent, margin: 0 });
      const cx = W / 2, cy = 2.75, R = Math.min(2.0, 1.1 + g.nodes.length * 0.12), bw = 1.9, bh = 0.6;
      const pos = {};
      g.nodes.forEach((node, i) => { const ang = -Math.PI / 2 + (2 * Math.PI * i) / g.nodes.length; pos[node.id] = { x: cx + R * 1.35 * Math.cos(ang), y: cy + R * 0.78 * Math.sin(ang) }; });
      for (const e of g.edges) {
        const a = pos[e.from], b = pos[e.to];
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        // trim the segment so it starts and ends at the box edges (roughly)
        const trimA = Math.min(bw / 2 / Math.max(Math.abs(ux), 1e-6), bh / 2 / Math.max(Math.abs(uy), 1e-6)) + 0.05;
        const trimB = trimA;
        const x1 = a.x + ux * trimA, y1 = a.y + uy * trimA, x2 = b.x - ux * trimB, y2 = b.y - uy * trimB;
        addSegment(pptx, s, x1, y1, x2, y2, { color: t.accent, width: 1.75, endArrowType: "triangle" });
        if (e.label) {
          const px = -uy, py = ux; // perpendicular, so the label sits beside the arrow rather than on it
          s.addText(e.label, { x: (x1 + x2) / 2 + px * 0.2 - 0.9, y: (y1 + y2) / 2 + py * 0.2 - 0.15, w: 1.8, h: 0.3, fontFace: SANS, fontSize: 11, color: t.accent, align: "center", valign: "middle", margin: 0, fit: "shrink" });
        }
      }
      for (const node of g.nodes) {
        const p = pos[node.id];
        s.addText(node.label, { x: p.x - bw / 2, y: p.y - bh / 2, w: bw, h: bh, fontFace: SANS, fontSize: 13, bold: true, color: t.text, align: "center", valign: "middle", margin: 4, fit: "shrink",
          fill: { color: t.bg }, line: { color: t.text, width: 1 }, rectRadius: 0.08, shape: pptx.ShapeType.roundRect });
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

  async function download(container) {
    const status = $("#deckStatus");
    try {
      status.textContent = "Building the PowerPoint file…";
      const pptx = await build();
      const blob = await pptx.write({ outputType: "blob" });
      const name = `${(deck.title || "Scriptures").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Scriptures"}.pptx`;
      const file = new File([blob], name, { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: name }); status.textContent = ""; return; }
        catch (err) { if (err.name === "AbortError") { status.textContent = ""; return; } }
      }
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = `Saved ${name}.`;
    } catch (err) {
      status.textContent = `Could not build the file: ${err.message}`;
    }
  }

  window.Deck = { render, addFromDoc, addPassage, count, updateBadge, present, chunksOf, build, THEMES };
  updateBadge();
})();
