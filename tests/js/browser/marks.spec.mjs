import fs from "node:fs";
// marks: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
// Copy and Clear sit in the selection bar where it has room, and behind its "more" button where it has not (a phone)
const barDo = async (page, sel, item) => {
  const b = page.locator(`#reader .select-bar ${sel}`).first();
  if (await b.isVisible()) return b.click();
  await page.click("#reader .select-bar .sel-more-btn");
  await page.click(`#reader .select-bar .size-menu >> text=${item}`);
};
import { box, readerTool } from "./helpers.mjs";

// ---- words marked inside a verse
// The page's text selection laid over some words of one paragraph: by a real mouse drag where
// there is a mouse (the iPad's size), set from the page where there is not (the phone's).
// the words' place in the paragraph, whatever marks already divide its text: a Range over them
const RANGE_OF = `(pid, words) => {
  const p = document.querySelector("#reader .doc #" + pid);
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest(".verse-number, sup.marker, .note-mark") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = []; let text = "";
  while (w.nextNode()) { nodes.push({ n: w.currentNode, at: text.length }); text += w.currentNode.nodeValue; }
  const from = text.indexOf(words), to = from + words.length;
  if (from < 0) return null;
  const spot = (i, end) => { const x = nodes.filter((o) => (end ? o.at < i : o.at <= i)).pop(); return [x.n, i - x.at]; };
  const r = document.createRange(); r.setStart(...spot(from, false)); r.setEnd(...spot(to, true));
  return r;
}`;
const wordsBox = (page, pid, words) => page.evaluate(`(() => {
  const r = (${RANGE_OF})(${JSON.stringify(pid)}, ${JSON.stringify(words)});
  if (!r) return null;
  const rects = [...r.getClientRects()].filter((b) => b.width > 1);
  const a = rects[0], z = rects[rects.length - 1];
  return { x1: a.left + 1, y1: a.top + a.height / 2, x2: z.right - 1, y2: z.top + z.height / 2 };
})()`);
const selectWords = async (page, pid, words, mouse) => {
  await page.evaluate((pid) => document.querySelector(`#reader .doc #${pid}`).scrollIntoView({ block: "center" }), pid);
  await page.waitForTimeout(150);
  if (mouse) {
    const b = await wordsBox(page, pid, words);
    await page.mouse.move(b.x1, b.y1);
    await page.mouse.down();
    await page.mouse.move((b.x1 + b.x2) / 2, b.y2, { steps: 4 });
    await page.mouse.move(b.x2, b.y2, { steps: 4 });
    await page.mouse.up();
  } else {
    await page.evaluate(`(() => { const r = (${RANGE_OF})(${JSON.stringify(pid)}, ${JSON.stringify(words)}); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
  }
  await page.waitForSelector("#reader .phrase-bar", { timeout: 5000 });
};
const marked = (page, pid) => page.evaluate((pid) => [...document.querySelectorAll(`#reader .doc #${pid} mark.hlp`)].map((m) => `${m.className.replace("hlp hl-", "")}:${m.textContent}`), pid);
const kept = (page) => page.evaluate(async () => (await window.Marks.phrases(window.GL.reading.doc.uri)).map((r) => `${r.pid}~${r.start}-${r.end}:${r.color}:${r.text}`).sort());
async function phrases(page, { name, viewport, check, shot }) {
  const mouse = viewport.width >= 760;
  const undo = async () => { await page.waitForSelector(".toast.show .toast-action", { timeout: 3000 }); await page.click(".toast.show .toast-action"); await page.waitForTimeout(500); };
  // verse 21 is yellow and carries a note: a phrase inside it is its own mark, beside those
  await selectWords(page, "p21", "a perfect knowledge of things", mouse);
  check(!(await page.evaluate(() => document.querySelector("#reader .doc #p21").classList.contains("sel"))), "selecting words does not select the verse");
  check(/a perfect knowledge of things/.test(await page.textContent("#reader .phrase-bar .n")) || viewport.width < 760, "the bar names the words");
  check(await page.evaluate(() => { const b = document.querySelector("#reader .phrase-bar"); const r = b.getBoundingClientRect(); return b.scrollWidth <= b.clientWidth + 1 && r.bottom <= window.innerHeight + 1 && r.top > window.innerHeight / 2; }), "the bar is docked at the foot of the page, on one row");
  await shot("06-phrase-bar");
  await page.click("#reader .phrase-bar .hl-dot.hl-g");
  await page.waitForTimeout(500);
  check(JSON.stringify(await marked(page, "p21")) === JSON.stringify(["g:a perfect knowledge of things"]), `exactly those words are green: ${JSON.stringify(await marked(page, "p21"))}`);
  check(await page.evaluate(() => { const p = document.querySelector("#reader .doc #p21"); return p.classList.contains("hl-y") && !!p.querySelector(".note-mark"); }), "the verse keeps its own yellow and its note");
  check(!(await page.$("#reader .phrase-bar")) && (await page.evaluate(() => window.getSelection().isCollapsed)), "the bar and the selection go once the words are marked");
  const rec = await page.evaluate(async () => (await window.Marks.phrases(window.GL.reading.doc.uri))[0]);
  check(rec && rec.kind === "phrase" && rec.id === `${rec.uri}#p21~${rec.start}-${rec.end}` && rec.end - rec.start === 4 && rec.color === "g" && rec.text === "a perfect knowledge of things" && rec.citation === "Alma 32:21", `the record: ${JSON.stringify(rec)}`);
  check((await page.evaluate(async () => (await window.Marks.forDoc(window.GL.reading.doc.uri)).some((m) => m.kind === "phrase"))) === false, "forDoc still returns verse and paragraph marks only");
  // a second phrase in the same verse; then one over part of the first: the newer has the shared words
  await selectWords(page, "p21", "which are not seen", mouse);
  await page.click("#reader .phrase-bar .hl-dot.hl-b");
  await page.waitForTimeout(400);
  await selectWords(page, "p21", "not to have a perfect", mouse);
  await page.click("#reader .phrase-bar .hl-dot.hl-p");
  await page.waitForTimeout(400);
  check(JSON.stringify(await marked(page, "p21")) === JSON.stringify(["p:not to have a perfect", "g:knowledge of things", "b:which are not seen,"]), `three phrases, the newer over the older where they meet: ${JSON.stringify(await marked(page, "p21"))}`);
  await shot("07-phrases");
  // a tap on a marked phrase: its color is pressed; another color changes it, and Undo puts it back
  await page.click("#reader .doc #p21 mark.hlp.hl-b");
  await page.waitForSelector("#reader .phrase-bar .ph-remove");
  check((await page.getAttribute("#reader .phrase-bar .hl-dot.hl-b", "aria-pressed")) === "true", "the phrase's color is pressed in the bar");
  check(!(await page.evaluate(() => document.querySelector("#reader .doc #p21").classList.contains("sel"))), "a tap on a marked phrase does not select the verse");
  check(await page.evaluate(() => { const b = document.querySelector("#reader .phrase-bar"); return b.scrollWidth <= b.clientWidth + 1; }), "the bar with Remove in it fits on one row");
  await shot("08-phrase-tapped");
  await page.click("#reader .phrase-bar .hl-dot.hl-y");
  await page.waitForTimeout(400);
  check((await marked(page, "p21")).includes("y:which are not seen,"), "the phrase is recolored");
  await undo();
  check((await marked(page, "p21")).includes("b:which are not seen,"), `Undo puts the color back: ${JSON.stringify(await marked(page, "p21"))}`);
  // Remove, and Undo
  await page.click("#reader .doc #p21 mark.hlp.hl-b");
  await page.click("#reader .phrase-bar .ph-remove");
  await page.waitForTimeout(400);
  check(!(await marked(page, "p21")).some((m) => /which are not seen/.test(m)) && (await kept(page)).length === 2, `Remove takes the phrase off: ${JSON.stringify(await kept(page))}`);
  check((await page.evaluate(async () => (await window.Marks.dump()).filter((r) => r.deleted && /~/.test(r.id)).length)) >= 1, "the removal leaves a tombstone for the other devices");
  await undo();
  check((await marked(page, "p21")).includes("b:which are not seen,") && (await kept(page)).length === 3, `Undo puts the phrase back: ${JSON.stringify(await kept(page))}`);
  // words across two verses: the bar offers the verses whole, as the selection bar does
  await page.evaluate(() => {
    const a = [...document.querySelector("#reader .doc #p25").childNodes].filter((n) => n.nodeType === 3).pop(), z = [...document.querySelector("#reader .doc #p26").childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim().length > 8);
    const r = document.createRange(); r.setStart(a, Math.max(0, a.nodeValue.length - 12)); r.setEnd(z, 8);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.waitForSelector("#reader .phrase-bar", { timeout: 5000 });
  check(/2 passages/.test(await page.evaluate(() => document.querySelector("#reader .phrase-bar .n").textContent)), "two verses under the selection are offered as two passages");
  await page.click("#reader .phrase-bar .hl-dot.hl-p");
  await page.waitForTimeout(500);
  check(await page.evaluate(() => ["p25", "p26"].every((id) => { const p = document.querySelector(`#reader .doc #${id}`); return p.classList.contains("hl-p") && !p.querySelector("mark.hlp"); })), "both verses are pink, whole");
  // a plain tap still selects a verse
  await page.click("#reader .doc #p24 .verse-number");
  check(await page.evaluate(() => document.querySelector("#reader .doc #p24").classList.contains("sel")) && !!(await page.$("#reader .select-bar")), "a tap with no words selected selects the verse, as before");
  await barDo(page, ".clear-sel", "Clear selection");
  // marks that arrive from another device are drawn at once
  await page.evaluate(async () => { const u = window.GL.reading.doc.uri; await window.Marks.merge([{ kind: "phrase", uri: u, pid: "p24", start: 0, end: 2, color: "y", text: "", citation: "Alma 32:24", updated: Date.now() }, { uri: u, pid: "p27", kind: "verse", verse: 27, color: "b", updated: Date.now() }]); });
  await page.waitForTimeout(600);
  check((await marked(page, "p24")).length === 1 && (await marked(page, "p24"))[0].startsWith("y:") && await page.evaluate(() => document.querySelector("#reader .doc #p27").classList.contains("hl-b")), `a merge draws on the open page: ${JSON.stringify(await marked(page, "p24"))}`);
  check((await marked(page, "p21")).length === 3, "and what was there is drawn once, not twice");
  // reload: the phrases come back
  await page.reload();
  for (let i = 0; i < 5; i++) {
    const again = await page.waitForSelector("#reader .doc #p21, .setup button:has-text('Try again')", { timeout: 30000 });
    if ((await again.textContent()) === "Try again") { await page.waitForTimeout(800); await again.click(); continue; }
    break;
  }
  await page.waitForSelector("#reader .doc #p21 mark.hlp", { timeout: 30000 });
  await page.waitForTimeout(600);
  check(JSON.stringify(await marked(page, "p21")) === JSON.stringify(["p:not to have a perfect", "g:knowledge of things", "b:which are not seen,"]), `the phrases survive a reload: ${JSON.stringify(await marked(page, "p21"))}`);
  await page.evaluate(() => document.querySelector("#reader .doc #p21").scrollIntoView({ block: "center" }));
  await shot("09-phrases-after-reload");
  // the list of marks has the phrases, and a Greek word, beside the verses; the color filter and the search take them in
  await page.evaluate(() => window.Marks.save({ kind: "word", id: "orig:revelation.3.16.16003:gr", uri: "/scriptures/nt/rev/3", pid: "p16", verse: 16, color: "g", text: "χλιαρὸς lukewarm", citation: "Revelation 3:16", strongs: "G5513" }));
  await page.click("#homeBtn");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 10000 });
  await page.waitForTimeout(400);
  await page.click("#homeBody .own-row:has-text('Highlights and notes')");
  await page.waitForSelector("#homeBody .mark-row.mk-phrase", { timeout: 10000 });
  const rows = () => page.evaluate(() => [...document.querySelectorAll("#homeBody .mark-row")].map((r) => ({ kind: r.classList.contains("mk-phrase") ? "phrase" : r.classList.contains("mk-word") ? "word" : "verse", color: (r.className.match(/hl-(\w)/) || [])[1] || null, cite: r.querySelector(".mk-cite").textContent, text: r.querySelector(".mk-text").textContent })));
  let list = await rows();
  check(/^10 marks$/.test(await page.textContent("#homeBody .marks-count")), `the heading counts every kind: ${await page.textContent("#homeBody .marks-count")}`);
  check(list.some((r) => r.kind === "phrase" && r.cite === "Alma 32:21" && r.text === "“which are not seen,”" && r.color === "b"), `a phrase is listed with its words and verse: ${JSON.stringify(list.filter((r) => r.kind === "phrase"))}`);
  check(list.some((r) => r.kind === "word" && r.cite === "Revelation 3:16, χλιαρὸς lukewarm" && r.text === "Greek word, Strong's G5513" && r.color === "g"), `a word is listed with its verse, itself and its meaning: ${JSON.stringify(list.filter((r) => r.kind === "word"))}`);
  await shot("10-list-with-phrases");
  await page.click("#homeBody .mk-colors .mk-dot.hl-b");
  list = await rows();
  check(list.length === 2 && list.every((r) => r.color === "b") && list.some((r) => r.kind === "phrase") && list.some((r) => r.kind === "verse"), `the color filter takes in phrases: ${JSON.stringify(list)}`);
  await page.click("#homeBody .mk-colors .mk-dot.all");
  await page.fill("#homeBody .mk-find", "lukewarm");
  list = await rows();
  check(list.length === 1 && list[0].kind === "word", `the search finds a word by its meaning: ${JSON.stringify(list)}`);
  await page.fill("#homeBody .mk-find", "g5513");
  check((await rows()).length === 1, "and by its Strong's number");
  await page.fill("#homeBody .mk-find", "not seen");
  list = await rows();
  check(list.some((r) => r.kind === "phrase" && /which are not seen/.test(r.text)), `the search finds a phrase by its words: ${JSON.stringify(list)}`);
  // tapping a phrase opens its verse
  await page.click("#homeBody .mark-row.mk-phrase");
  await page.waitForSelector("#reader .doc .is-target", { timeout: 10000 });
  check((await page.getAttribute("#reader .doc .is-target", "id")) === "p21", "a phrase's row opens its verse");
  await page.evaluate(() => window.Marks.removeId("orig:revelation.3.16.16003:gr"));
}

export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "marks/";
  fs.mkdirSync(OUT, { recursive: true });
  async function session(name, viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") { errors.push(`${name} console: ${m.text().slice(0, 300)}`); console.log(name, "console:", m.text().slice(0, 300)); } });
    page.on("pageerror", (e) => console.log(name, "pageerror:", String(e.stack || e).slice(0, 400)));
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const shot = (l) => page.screenshot({ path: `${OUT}${name}-${l}.png` });
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForTimeout(600);
    await box(page, "Alma 32:21"); await page.press("#q", "Enter");
    await page.waitForTimeout(800);
    const jump = await page.$("#list .jump");
    if (jump && viewport.width < 760 && await jump.isVisible()) await jump.click(); // Enter opens the page on the phone too
    await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
    await page.waitForTimeout(500);
    // select two verses, highlight yellow
    await page.click("#reader .doc #p21");
    await page.click("#reader .doc #p22");
    await page.waitForSelector("#reader .select-bar .hl-dot.hl-y");
    await shot("01-selected");
    await page.click("#reader .select-bar .hl-dot.hl-y");
    await page.waitForTimeout(500);
    check(await page.evaluate(() => document.querySelector("#reader .doc #p21").classList.contains("hl-y") && document.querySelector("#reader .doc #p22").classList.contains("hl-y")), "both verses should be yellow");
    // the selection and the bar stay, and the yellow dot says the verses carry it
    check((await page.locator("#reader .doc .sel").count()) === 2, "both verses stay selected after a color");
    check((await page.getAttribute("#reader .select-bar .hl-dot.hl-y", "aria-pressed")) === "true", "the yellow dot is pressed");
    check((await page.getAttribute("#reader .select-bar .hl-dot.hl-g", "aria-pressed")) === "false", "the green dot is not pressed");
    await shot("02-highlighted");
    // a note on the two, kept selected after it saves
    await page.click("#reader .select-bar button:has-text('Note')");
    await page.waitForSelector("#sheet:not([hidden]) .note-text");
    await page.fill("#sheet .note-text", "Two verses, one note.");
    await page.click("#sheet .peek-row .primary");
    await page.waitForTimeout(500);
    check((await page.locator("#reader .doc .sel").count()) === 2, "the selection stays after a note saves");
    // the note covers both: its marker on 21, a bracket from 21 to 22
    check(!!(await page.$("#reader .doc #p21 .note-mark")) && !(await page.$("#reader .doc #p22 .note-mark")), "the range note's marker sits on the first verse");
    check(await page.evaluate(() => document.querySelector("#reader .doc #p21").classList.contains("note-range-start") && document.querySelector("#reader .doc #p22").classList.contains("note-range-end")), "the range is bracketed 21 to 22");
    await shot("02b-range-note");
    // still selected: Add to deck carries the color and the note
    await page.click("#reader .select-bar .add-deck");
    await page.waitForTimeout(600);
    const card = await page.evaluate(() => { return window.Deck.state.items.find((i) => i.pid === "p21") || null; });
    check(card && card.color === "y", `the card should carry the reader's yellow: ${card && card.color}`);
    check(card && /Two verses, one note\./.test(card.notes || ""), `the range note should be the card's speaker note: ${card && card.notes}`);
    check(card && Array.isArray(card.hl) && card.hl.length === 0, "the card's phrase highlights (and so the PowerPoint) are unchanged");
    // a note on verse 23
    await page.click("#reader .doc #p23");
    await page.click("#reader .select-bar button:has-text('Note')");
    await page.waitForSelector("#sheet:not([hidden]) .note-text");
    await page.fill("#sheet .note-text", "Faith grows by experiment: plant the word.");
    await shot("03-note-sheet");
    await page.click("#sheet .peek-row .primary");
    await page.waitForTimeout(500);
    check(!!(await page.$("#reader .doc #p23 .note-mark")), "verse 23 should carry a note marker");
    check(await page.evaluate(() => document.querySelector("#sheet").hidden), "sheet closes after saving");
    await barDo(page, ".clear-sel", "Clear selection");
    // the same color again removes the highlight on verse 22
    await page.click("#reader .doc #p22");
    await page.click("#reader .select-bar .hl-dot.hl-y");
    await page.waitForTimeout(400);
    check(await page.evaluate(() => !document.querySelector("#reader .doc #p22").classList.contains("hl-y")), "verse 22 highlight should toggle off");
    // reload: marks come back
    await page.reload();
    for (let i = 0; i < 5; i++) { // the old worker may still hold the storage for a moment: the app offers Try again
      const again = await page.waitForSelector("#reader .doc #p21, .setup button:has-text('Try again')", { timeout: 30000 });
      if ((await again.textContent()) === "Try again") { await page.waitForTimeout(800); await again.click(); continue; }
      break;
    }
    await page.waitForSelector("#reader .doc #p21", { timeout: 30000 });
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => document.querySelector("#reader .doc #p21").classList.contains("hl-y")), "highlight should survive a reload");
    check(!!(await page.$("#reader .doc #p23 .note-mark")), "note should survive a reload");
    await shot("04-after-reload");
    // the marker opens the note for editing
    await page.click("#reader .doc #p23 .note-mark");
    await page.waitForSelector("#sheet:not([hidden]) .note-text");
    check((await page.inputValue("#sheet .note-text")) === "Faith grows by experiment: plant the word.", "note text should load into the sheet");
    await page.click("#sheet .peek-row button:has-text('Cancel')");
    // the shelf lists the marks
    await page.click("#homeBtn");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 10000 });
    await page.waitForTimeout(400);
    const sub = await page.textContent("#homeBody .own-row:has-text('Highlights and notes') .st-s");
    check(/2/.test(sub), `the Highlights and notes row should count 2 marks: ${sub}`);
    await page.click("#homeBody .own-row:has-text('Highlights and notes')");
    await page.waitForSelector("#homeBody .mark-row", { timeout: 10000 });
    check((await page.locator("#homeBody .mark-row").count()) === 2, "two marks listed");
    check(/Alma 32:23/.test(await page.textContent("#homeBody .mark-row >> nth=0")), "newest mark first (verse 23)");
    check(/Alma 32:21-22/.test(await page.textContent("#homeBody .mark-row >> nth=1")), "the range note is listed as Alma 32:21-22");
    const exported = await page.evaluate(async () => JSON.parse(await window.Marks.exportJson()).marks.find((m) => m.pid === "p21"));
    check(exported && exported.pid_end === "p22" && exported.verse_end === 22 && exported.citation === "Alma 32:21-22", "the export carries the range");
    // import: the new fields are checked, a bad one is dropped, an old record without them still loads
    const imp = await page.evaluate(async () => {
      const n = await window.Marks.importJson({ marks: [
        { uri: "/x/old", pid: "p1", note: "old record", updated: 1 },
        { uri: "/x/bad", pid: "p1", note: "bad end", pid_end: "p9\"><img>", verse_end: "x", updated: 1 },
        { uri: "/x/ok", pid: "p1", note: "good end", pid_end: "p3", verse_end: 3, updated: 1 },
      ] });
      const all = await window.Marks.all();
      const f = (u) => all.find((m) => m.uri === u);
      const out = { n, old: f("/x/old")?.pid_end, bad: f("/x/bad")?.pid_end, ok: f("/x/ok")?.pid_end, okv: f("/x/ok")?.verse_end };
      for (const u of ["/x/old", "/x/bad", "/x/ok"]) await window.Marks.remove(u, "p1");
      return out;
    });
    // Export: no touch screen here, so the file downloads (an iPhone or iPad takes the share sheet)
    const dl = await Promise.all([page.waitForEvent("download", { timeout: 5000 }), page.click("#homeBody .marks-tools button:has-text('Export')")]).then(([d]) => d).catch(() => null);
    check(dl && /^gospel-marks-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), `Export downloads the marks file (${dl && dl.suggestedFilename()})`);
    check(imp.n === 3 && imp.old === null && imp.bad === null && imp.ok === "p3" && imp.okv === 3, `import sanitizes the range: ${JSON.stringify(imp)}`);
    await shot("05-marks-list");
    // tapping a mark opens the verse
    await page.click("#homeBody .mark-row >> nth=1");
    await page.waitForSelector("#reader .doc .is-target", { timeout: 10000 });
    check((await page.getAttribute("#reader .doc .is-target", "id")) === "p21", "mark row should open its verse");
    await phrases(page, { name, viewport, check, shot });
    await ctx.close();
  }
  for (const [name, vp] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    try { await session(name, vp); } catch (e) { errors.push(`${name} aborted: ${e.message.split("\n")[0]}`); }
  }
  return errors;
}
