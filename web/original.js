/* The Bible in its own languages: every Hebrew and Greek word under the KJV's
   verses, each with its transliteration, meaning, grammar and Strong's number,
   and the lexicon behind the numbers. Data: STEP Bible, Tyndale House,
   Cambridge (CC BY 4.0), www.STEPBible.org. */
(() => {
  "use strict";

  const GL = () => window.GL;
  const { el, esc, store } = window.GL || {};
  const $ = (sel, root = document) => root.querySelector(sel);

  const CREDIT = "Hebrew and Greek from the STEP Bible (Tyndale House, Cambridge), CC BY 4.0";
  const BIBLE = { "Old Testament": "he", "New Testament": "gr" };
  const NAME = { he: "Hebrew", gr: "Greek" };

  let available = null;   // null until asked; then the meta record or false
  async function check() {
    if (available !== null) return !!available;
    try { available = (await GL().api("originalsInfo", {})) || false; } catch (_) { available = false; }
    return !!available;
  }
  window.addEventListener("library:change", () => { available = null; });

  function isBible(doc) { return !!doc && doc.collection === "scriptures" && !!BIBLE[doc.volume]; }
  function cleanGloss(g) { return String(g || "").replace(/\s+/g, " ").trim(); }
  function langAttr(lang) { return lang === "he" ? "he" : "el"; }

  // -------------------------------------------------------------- reader --
  // A button in the reader bar for a Bible chapter; the choice is remembered.
  async function attach(doc, body, bar) {
    if (!isBible(doc) || !(await check())) return;
    if (!bar.isConnected) return;
    const lang = BIBLE[doc.volume];
    const btn = el("button", { type: "button", class: "text-btn orig-btn", text: NAME[lang], title: `Show the ${NAME[lang]} under each verse` });
    btn.addEventListener("click", () => (body.classList.contains("with-orig") ? hide(body, btn) : show(doc, body, btn)));
    const anchor = bar.querySelector('[aria-label="Present"]');
    if (anchor) anchor.before(btn); else bar.append(btn);
    // the same switch on the phone's bottom bar
    const slot = bar.parentElement && bar.parentElement.querySelector(".reader-foot .slot-orig");
    if (slot) {
      const fb = el("button", { type: "button", class: "foot-btn", "aria-label": NAME[lang], onclick: () => btn.click() }, [
        el("span", { class: "ic", html: `<span class="glyph" lang="${langAttr(lang)}" style="font:600 18px/22px var(--serif)">${lang === "he" ? "אב" : "αβ"}</span>` }), el("span", { class: "lb", text: NAME[lang] })]);
      slot.replaceWith(fb);
      new MutationObserver(() => fb.classList.toggle("on", btn.classList.contains("on"))).observe(btn, { attributes: true, attributeFilter: ["class"] });
    }
    if (store.get("orig")) show(doc, body, btn);
  }

  async function show(doc, body, btn) {
    btn.disabled = true;
    let data;
    try { data = await GL().api("original", { doc_id: doc.id }); }
    catch (err) { btn.disabled = false; GL().toast(`Could not load the ${NAME[BIBLE[doc.volume]]}: ${err.message}`); return; }
    btn.disabled = false;
    if (!body.isConnected) return;
    if (!data || !data.available || !data.verses.length) { GL().toast("No original text for this chapter."); return; }
    store.set("orig", true);
    btn.classList.add("on");
    body.classList.add("with-orig");
    const byVerse = new Map(data.verses.map((v) => [v.verse, v]));
    let placed = 0;
    for (const p of body.querySelectorAll("p.verse")) {
      const n = verseNumber(p);
      const v = byVerse.get(n);
      if (!v) continue;
      p.after(block(v, data));
      placed++;
    }
    const title = byVerse.get(0);
    const first = body.querySelector("p.verse");
    if (title && first) { first.before(block(title, data, true)); placed++; }
    if (!placed) { GL().toast("The verses here could not be matched to the original text."); }
    if (!body.querySelector(".orig-credit")) body.append(el("div", { class: "orig-credit" }, [
      el("span", { text: CREDIT + ". " }),
      el("button", { type: "button", class: "text-btn small orig-legend-btn", text: "What the marks mean", onclick: () => legendSheet(data.lang || BIBLE[doc.volume]) }),
    ]));
  }
  // The legend: how to read a tile, what the colors and marks say.
  function legendSheet(lang) {
    const sheet = $("#sheet");
    const bodyEl = $(".sheet-body", sheet);
    if (!sheet || !bodyEl) return;
    const he = lang === "he";
    const item = (mark, text) => el("li", {}, [el("b", { text: mark + " " }), el("span", { text })]);
    bodyEl.replaceChildren(
      el("div", { class: "nm", text: `Reading the ${NAME[lang] || "original"} tiles` }),
      el("p", { class: "ow-fine", text: he
        ? "Each tile is one Hebrew word in the order of the Hebrew (right to left): the word with its vowel points and accents, how it sounds, and what it means here. Tap a tile for its dictionary entry, its grammar in plain words, and every verse that uses it."
        : "Each tile is one Greek word in the order of the Greek: the word with its accents, how it sounds, and what it means here. Tap a tile for its dictionary entry, its grammar in plain words, and every verse that uses it." }),
      el("ul", { class: "legend" }, [
        he ? item("CAPITAL letter", "in the sound marks the stressed syllable (be.re.SHIT is stressed on its last syllable); dots divide syllables.") : item("(Sound)", "is a plain transliteration; stress follows the Greek accent on the word itself."),
        item("[brackets]", "around an English word mean the translators supplied it; the original has no separate word for it."),
        he ? item("Dotted underline", "under the Hebrew word: either qere (the scribes' marginal reading, which the translators follow, where the written text differs) or a word restored from a parallel passage or the Septuagint; the word's sheet says which.") : item("Dashed edge", "a word in the Greek the KJV translators used (the Textus Receptus) that the critical text (NA28) behind modern translations does not have."),
        he ? null : item("Faded word", "a word in the critical text (NA28) that the KJV translators' Greek did not have, so the KJV has no word for it."),
        he ? item("Aramaic", "marks a verse written in Aramaic rather than Hebrew (parts of Daniel and Ezra).") : item("Editions", "in a word's sheet lists the Greek editions that have the word: NA28, SBL, Textus Receptus (TR), Byzantine (Byz) and others."),
        he ? item("Title (verse 0)", "a psalm's heading, which the Hebrew counts as its own verse.") : null,
        item("Strong's number", "names the dictionary word (H for Hebrew, G for Greek); a letter after it tells senses apart. Searching the number finds every verse with the word."),
      ].filter(Boolean)),
      el("p", { class: "ow-credit", text: CREDIT }),
    );
    openSheet(sheet);
  }
  function hide(body, btn) {
    store.set("orig", false);
    btn.classList.remove("on");
    body.classList.remove("with-orig");
    for (const n of body.querySelectorAll(".orig, .orig-credit")) n.remove();
  }
  function verseNumber(p) {
    const num = p.querySelector(".verse-number");
    const n = num ? parseInt(num.textContent, 10) : NaN;
    if (Number.isFinite(n)) return n;
    const m = /^p(\d+)$/.exec(p.id || "");
    return m ? Number(m[1]) : NaN;
  }

  // One verse's words, in reading order (right to left for Hebrew), each a
  // tile: the word, how it sounds, what it means.
  function block(v, data, isTitle = false) {
    const he = v.lang === "he";
    const aramaic = he && v.words.length > 2 && v.words.filter((w) => /^A/.test(w.morph || "")).length > v.words.length / 2;
    const wrap = el("div", { class: `orig ${he ? "he" : "gr"}${isTitle ? " orig-title-block" : ""}`, dir: he ? "rtl" : "ltr", lang: langAttr(v.lang) });
    if (isTitle) wrap.append(el("div", { class: "orig-label", dir: "ltr", lang: "en", text: "Title, as the Hebrew counts it (verse 0)" }));
    if (aramaic) wrap.append(el("div", { class: "orig-label", dir: "ltr", lang: "en", text: "Aramaic" }));
    for (const w of v.words) {
      const tile = el("button", { type: "button", class: "ow" + variantClass(w, v.lang), title: `${w.translit || ""} ${w.strongs || ""}`.trim(), onclick: () => wordSheet(w, v, data) }, [
        el("span", { class: "w", text: w.word }),
        el("span", { class: "t", dir: "ltr", lang: "en", text: w.translit || "" }),
        el("span", { class: "g", dir: "ltr", lang: "en", text: cleanGloss(w.gloss) }),
      ]);
      wrap.append(tile);
    }
    return wrap;
  }
  // Marks for words the editions do not share.
  function variantClass(w, lang) {
    const f = w.flags || "";
    if (lang === "gr") {
      if (f && !/[nN]/.test(f)) return " kjv-only";
      if (f && !/[kK]/.test(f)) return " not-kjv";
      return "";
    }
    if (/Q/.test(f)) return " qere";
    if (/[RX]/.test(f)) return " restored";
    return "";
  }
  function variantNote(w, lang) {
    const f = w.flags || "";
    if (lang === "gr") {
      if (f && !/[nN]/.test(f)) return "In the Greek the KJV translators used (the Textus Receptus), not in the critical text (NA28) behind modern translations.";
      if (f && !/[kK]/.test(f)) return "In the critical text (NA28) but not in the Greek the KJV translators used, so the KJV has no word for it.";
      if (/[()]/.test(f)) return "The editions differ in the form of this word.";
      return "";
    }
    if (/Q/.test(f)) return "Qere: the scribes' marginal reading, which the translators follow; the written text (ketiv) differs.";
    if (/R/.test(f)) return "Restored from a parallel passage; missing from the Leningrad Codex.";
    if (/X/.test(f)) return "Preserved in the Greek Septuagint and put back into Hebrew; not in the Hebrew manuscript.";
    return "";
  }

  // ------------------------------------------------------------- sheet ----
  // Everything about one word: its gloss here, its dictionary entry, its
  // grammar in plain words, where else it occurs.
  async function wordSheet(w, v, data) {
    const sheet = $("#sheet");
    const bodyEl = $(".sheet-body", sheet);
    if (!sheet || !bodyEl) return;
    const lang = v.lang;
    const cite = v.citation || `${data.book_name} ${data.chapter}:${v.verse}`;
    const head = el("div", { class: "ow-head" }, [
      el("div", { class: "ow-word", lang: langAttr(lang), dir: lang === "he" ? "rtl" : "ltr", text: w.word }),
      el("div", { class: "ow-meta" }, [
        el("div", { class: "ow-translit", text: w.translit || "" }),
        lang === "he" && /[A-Z]/.test(w.translit || "") ? el("div", { class: "ow-stress", text: "The capital marks the stressed syllable" }) : null,
        el("div", { class: "ow-gloss", text: cleanGloss(w.gloss) ? `“${cleanGloss(w.gloss)}” here, in ${cite}` : cite }),
      ].filter(Boolean)),
    ]);
    const details = el("div", { class: "ow-details" }, [el("div", { class: "status", text: "Looking it up…" })]);
    bodyEl.replaceChildren(head, details);
    openSheet(sheet);
    const [lex, morph] = await Promise.all([
      w.strongs ? GL().api("lexicon", { strongs: w.strongs, limit: 0 }).catch(() => null) : Promise.resolve(null),
      w.morph ? GL().api("morph", { code: w.morph }).catch(() => []) : Promise.resolve([]),
    ]);
    if (!sheet.contains(details)) return;
    details.replaceChildren();
    const note = variantNote(w, lang);
    if (note) details.append(el("p", { class: "ow-note", text: note }));
    if (morph && morph.length) {
      const parts = morph.filter((m) => m.short || m.meaning);
      details.append(el("div", { class: "ow-section" }, [
        el("div", { class: "nm", text: `Grammar (${w.morph})` }),
        ...parts.map((m) => el("p", {}, [el("b", { text: (m.short || m.code).replace(/^"|"$/g, "") }), m.meaning ? el("span", { text: `: ${m.meaning.toLowerCase()}` }) : null, exampleOf(m.example) ? el("i", { text: ` (${exampleOf(m.example)})` }) : null])),
      ]));
    }
    if (lex && (lex.entry || lex.count)) {
      const e = lex.entry;
      const sec = el("div", { class: "ow-section" }, [el("div", { class: "nm", text: `Lexicon, Strong's ${lex.strongs}` })]);
      if (e) {
        sec.append(el("p", { class: "ow-lemma" }, [
          el("span", { lang: langAttr(lang), dir: lang === "he" ? "rtl" : "ltr", class: "lemma", text: e.lemma || "" }),
          el("span", { text: ` ${e.translit || ""}` }),
          e.gloss ? el("span", { text: `, ${e.gloss}` }) : null,
          e.type ? el("span", { class: "ow-type", text: ` (${typeName(e.type)})` }) : null,
        ]));
        if (e.definition) sec.append(definitionEl(e.definition));
        if (e.relation) sec.append(el("p", { class: "ow-fine", text: e.relation }));
      }
      if (lex.senses && lex.senses.length > 1) {
        sec.append(el("p", { class: "ow-fine" }, [el("span", { text: "Senses told apart in the data: " }), ...lex.senses.map((s, i) => el("span", { text: `${i ? "; " : ""}${s.strongs} ${s.gloss || ""}` }))]));
      }
      if (lex.count) {
        const top = (lex.glosses || []).slice(0, 6).map((g) => `${g.gloss} (${g.n})`).join(", ");
        sec.append(el("p", { class: "ow-fine", text: `${lex.count.toLocaleString()} ${lex.count === 1 ? "occurrence" : "occurrences"} in ${lex.verses_total.toLocaleString()} ${lex.verses_total === 1 ? "verse" : "verses"}${lex.books && lex.books.length ? `, in ${lex.books.length === 1 ? lex.books[0].name : `${lex.books.length} books`}` : ""}.${top ? ` Rendered: ${top}.` : ""}` }));
        sec.append(el("div", { class: "deck-actions" }, [
          el("button", { type: "button", class: "primary", text: `All ${lex.verses_total.toLocaleString()} verses with this word`, onclick: () => { closeSheet(); GL().search(lex.strongs); } }),
          lex.senses && lex.senses.length > 1 && lex.strongs.length > 5 ? el("button", { type: "button", class: "text-btn", text: `Every sense of ${lex.strongs.slice(0, 5)}`, onclick: () => { closeSheet(); GL().search(lex.strongs.slice(0, 5)); } }) : null,
        ]));
      }
      details.append(sec);
    } else if (w.strongs) {
      details.append(el("p", { class: "ow-fine", text: `Strong's ${w.strongs}` }));
    }
    if (w.tags && lang === "gr" && w.tags !== "") details.append(el("p", { class: "ow-fine", text: `Editions with this word: ${w.tags.replace(/\+/g, ", ")}` }));
    // the Topical Guide, Bible Dictionary and Guide to the Scriptures on the English word
    const helps = await studyHelpsFor(w, lex);
    if (helps.length && sheet.contains(details)) {
      details.append(el("div", { class: "ow-section" }, [
        el("div", { class: "nm", text: "In the study helps" }),
        el("div", { class: "ow-helps" }, helps.map((h) => el("button", { type: "button", class: "chip", text: `${h.book}: ${h.title}`, onclick: () => { closeSheet(); GL().openDoc(h.id, null); } }))),
      ]));
    }
    details.append(el("p", { class: "ow-credit", text: CREDIT }));
  }
  const STOP = new Set(["the", "and", "that", "with", "for", "from", "unto", "into", "they", "them", "their", "his", "her", "him", "she", "you", "your", "who", "which", "what", "this", "these", "those", "there", "then", "than", "but", "not", "all", "any", "one", "two", "are", "was", "were", "been", "have", "has", "had", "will", "shall", "upon", "when", "also", "out", "over", "under", "before", "after", "because", "about", "through"]);
  async function studyHelpsFor(w, lex) {
    const words = [];
    const take = (text) => { for (const t of String(text || "").toLowerCase().replace(/[^a-z' -]/g, " ").split(/[\s-]+/)) { if (t.length >= 3 && !STOP.has(t)) { words.push(t); if (t.endsWith("s")) words.push(t.replace(/(ie)?s$/, (m) => m === "ies" ? "y" : "")); } } };
    take(cleanGloss(w.gloss));
    if (lex && lex.entry) take(lex.entry.gloss);
    for (const g of (lex && lex.glosses) || []) take(g.gloss);
    if (!words.length) return [];
    try { return await GL().api("studyHelps", { words: [...new Set(words)].slice(0, 12) }); } catch (_) { return []; }
  }
  // STEP's examples: "giving to‚ rich _and_ poor": "and" — the sentence, with the word in question marked.
  function exampleOf(ex) {
    let t = String(ex || "").replace(/\u201a/g, ",").trim();
    const m = /^"(.*?)"\s*:\s*"(.*)"$/.exec(t);
    if (m) t = m[1];
    t = t.replace(/^"|"$/g, "").replace(/_([^_]*)_/g, "$1").replace(/\s+/g, " ").trim();
    return /^(e\.g\.|example:?)\s*$/i.test(t) ? "" : t.replace(/^e\.g\.\s*/i, "");
  }
  function typeName(code) {
    const c = String(code || "").replace(/^[A-Z]:/, "");
    const names = { "N-M": "masculine noun", "N-F": "feminine noun", "N-N": "neuter noun", "N-M/F": "noun", N: "noun", "N--T": "name or title", "N--L": "place name", "N-M-P": "man's name", "N-F-P": "woman's name", "N--P": "name", V: "verb", A: "adjective", ADV: "adverb", PREP: "preposition", CONJ: "conjunction", T: "article", P: "pronoun", PERP: "personal pronoun", NEG: "negative", PRT: "particle", COND: "conditional", INTJ: "interjection", "A-NUI": "number", DEMP: "demonstrative pronoun", RELP: "relative pronoun", INTG: "interrogative" };
    return names[c.toUpperCase()] || names[c] || code;
  }
  // The brief lexicon's definition is small HTML with its own cross-reference
  // tag; references open the verse in the library.
  function definitionEl(html) {
    let h = String(html || "").replace(/^\s*:\s*/, "").replace(/<ref='([^']*)'>/gi, (m, ref) => `<a class="oref" data-ref="${esc(ref)}" href="#">`).replace(/<\/ref>/gi, "</a>")
      .replace(/<re>/gi, '<span class="ore">').replace(/<\/re>/gi, "</span>").replace(/<br\s*\/?>/gi, "<br>");
    const box = el("div", { class: "ow-def" });
    const tpl = document.createElement("template");
    tpl.innerHTML = h;
    const allowed = new Set(["B", "I", "BR", "SPAN", "A", "EM", "STRONG", "U", "SUP", "SUB", "P"]);
    const walk = (node, into) => {
      for (const c of [...node.childNodes]) {
        if (c.nodeType === 3) { into.append(document.createTextNode(c.nodeValue)); continue; }
        if (c.nodeType !== 1) continue;
        if (!allowed.has(c.tagName)) { walk(c, into); continue; }
        const n = document.createElement(c.tagName.toLowerCase());
        if (c.tagName === "A" && c.dataset.ref) { n.className = "oref"; n.dataset.ref = c.dataset.ref; n.href = "#"; }
        if (c.tagName === "SPAN" && c.className === "ore") n.className = "ore";
        walk(c, n);
        into.append(n);
      }
    };
    walk(tpl.content, box);
    box.addEventListener("click", async (e) => {
      const a = e.target.closest("a.oref");
      if (!a) return;
      e.preventDefault();
      try {
        const r = await GL().api("locate", { ref: a.dataset.ref });
        if (r && r.found) { closeSheet(); GL().openDoc(r.doc_id, r.pid); }
        else GL().toast("That verse is not in the library.");
      } catch (_) { GL().toast("That verse could not be opened."); }
    });
    return box;
  }
  function openSheet(sheet) {
    sheet.hidden = false;
    if (!$("#scrim")) { const scrim = el("div", { class: "scrim", onclick: closeSheet }); scrim.id = "scrim"; document.body.append(scrim); }
  }
  function closeSheet() { const sheet = $("#sheet"); if (sheet) sheet.hidden = true; $("#scrim")?.remove(); }

  // ----------------------------------------------------------- results ----
  // The line above search results for a Hebrew, Greek or Strong's search.
  function resultsHeader(o) {
    if (!o) return null;
    const lang = o.lang || "he";
    const bits = [];
    if (o.lexicon) {
      bits.push(el("span", { class: "ow-inline", lang: langAttr(lang), dir: lang === "he" ? "rtl" : "ltr", text: o.lexicon.lemma || "" }));
      bits.push(el("span", { text: ` ${o.lexicon.translit || ""}${o.lexicon.gloss ? `, ${o.lexicon.gloss}` : ""} · Strong's ${o.lexicon.strongs || o.strongs}` }));
    } else if (o.tokens) bits.push(el("span", { text: `${NAME[lang]}: ${o.tokens.join(" ")}` }));
    const line = el("div", { class: "smart-line orig-line" }, [
      el("span", { text: `${o.kind === "strongs" ? `${NAME[lang]} word ` : o.kind === "translit" ? "By transliteration: " : `${NAME[lang]}: `}` }),
      ...bits,
      el("span", { text: ` · ${o.total.toLocaleString()} ${o.total === 1 ? "verse" : "verses"}` }),
    ]);
    if (o.kind !== "strongs" && o.strongs && o.all_forms && o.all_forms > o.total) {
      line.append(el("button", { type: "button", class: "text-btn small", text: `Every form (${o.all_forms.toLocaleString()} verses)`, onclick: () => GL().search(o.strongs) }));
    }
    return line;
  }
  // "logos" or "shalom" typed into an ordinary search: the word it is.
  function hintLine(h) {
    if (!h) return null;
    return el("div", { class: "smart-line orig-hint" }, [
      el("span", { text: `In the ${h.language}: ` }),
      el("span", { class: "ow-inline", lang: langAttr(h.lang), dir: h.lang === "he" ? "rtl" : "ltr", text: h.lemma || "" }),
      el("span", { text: ` ${h.translit || ""}${h.gloss ? `, ${h.gloss}` : ""} · ${h.count.toLocaleString()} ${h.count === 1 ? "occurrence" : "occurrences"} ` }),
      el("button", { type: "button", class: "text-btn small", text: "Show the verses", onclick: () => GL().search(h.strongs) }),
    ]);
  }

  window.Original = { attach, resultsHeader, hintLine, check, isBible, closeSheet };
})();
