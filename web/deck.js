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
    const verses = p.kind === "verse" && p.verse ? [{ n: p.verse, text: p.text }] : null;
    const item = {
      id: uid(), type: "passage", kind: p.kind === "verse" ? "verse" : "para",
      text: p.text, verses, doc_id: p.doc_id, pid: p.pid,
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
      } else {
        const cite = el("input", { value: it.citation, "aria-label": "Citation", class: "cite-edit" });
        cite.addEventListener("input", () => { it.citation = cite.value; save(); });
        const preview = el("button", { type: "button", class: "preview", text: it.text.slice(0, 160) + (it.text.length > 160 ? "…" : ""), onclick: () => it.doc_id && GL().openDoc(it.doc_id, it.pid) });
        row.append(el("div", { class: "body" }, [cite, it.where || it.label ? el("div", { class: "where", text: [it.where, it.label].filter(Boolean).join(", ") }) : null, preview]));
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
      for (const chunk of chunksOf(it)) units.push({ kind: it.kind, html: chunkHtml(chunk), where: it.kind === "verse" ? chunk.label : [it.citation, it.where, chunk.label].filter(Boolean).join("  ·  "), doc_id: it.doc_id });
    }
    GL().startPresentingUnits(units);
  }
  function chunkHtml(chunk) {
    if (chunk.verses) return chunk.verses.map((v) => `<span class="vn">${v.n}</span> ${esc(v.text)}`).join(" ");
    return esc(chunk.text).replace(/\n\n/g, "<br><br>");
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
      for (const chunk of chunksOf(it)) {
        n++;
        const s = pptx.addSlide(); base(s);
        const isTalk = it.kind !== "verse";
        s.addText(chunk.label, { x: M, y: 0.5, w: inner, h: 0.4, fontFace: SANS, fontSize: 14, color: t.accent, margin: 0, valign: "top" });
        const runs = [];
        if (chunk.verses) {
          chunk.verses.forEach((v, i) => {
            if (v.n !== null && v.n !== undefined) runs.push({ text: `${v.n} `, options: { superscript: true, color: t.accent, fontSize: 16, fontFace: SANS, bold: true } });
            runs.push({ text: v.text + (i < chunk.verses.length - 1 ? " " : ""), options: { color: t.text } });
          });
        } else {
          chunk.text.split(/\n\n+/).forEach((p, i, arr) => runs.push({ text: p, options: { color: t.text, breakLine: i < arr.length - 1, paraSpaceAfter: 8 } }));
        }
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
    return pptx;
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
