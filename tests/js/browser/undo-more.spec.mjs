// undo-more: the changes outside the deck that could not be taken back. A note written over,
// a highlight recolored, Settings saved with the instructions or the notes emptied, and an
// import (marks, study pages, decks, and the words for Claude once accepted): each says what
// happened in a toast with Undo, and Undo puts things back as they were.
import fs from "node:fs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("dialog", (d) => { errors.push(`a browser dialog appeared: ${d.message()}`); d.dismiss().catch(() => {}); });
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  const toastSays = async (re) => { await page.waitForFunction((src) => new RegExp(src).test(document.querySelector("#toast.show")?.textContent || ""), re.source, { timeout: 5000 }).catch(() => {}); return (document_text.last = await page.textContent("#toast").catch(() => "")); };
  const undo = async () => { await page.click("#toast.show .toast-action", { timeout: 4000 }).catch(() => errors.push(`no Undo to tap in the toast: ${JSON.stringify(document_text.last)}`)); await page.waitForTimeout(500); };
  const document_text = { last: "" };

  // a highlight recolored, and a note written over
  const alma = await page.evaluate(async () => (await GL.api("search", { q: "Alma 32:21", limit: 1 })).jump);
  await page.evaluate((id) => GL.openDoc(id), alma.doc_id);
  await page.waitForSelector("#reader .doc .verse", { timeout: 10000 });
  const mark = () => page.evaluate(async (uri) => { const m = (await window.Marks.all()).find((x) => x.pid === "p3"); return m ? { color: m.color, note: m.note } : null; });
  await page.click("#reader .doc p.verse >> nth=2");
  await page.click("#reader .select-bar .hl-dot.hl-y");
  await toastSays(/Highlighted/);
  const first = await mark();
  await page.click("#reader .select-bar .hl-dot.hl-p");
  check(/Color changed\.Undo/.test(await toastSays(/Color changed/)), `recoloring a highlight should offer Undo: ${await page.textContent("#toast")}`);
  check((await mark())?.color !== first?.color, "the second color was not laid on");
  await undo();
  check((await mark())?.color === first?.color, `Undo should put the first color back: ${JSON.stringify(await mark())}`);
  const note = async (text) => { await page.click("#reader .select-bar .text-btn:has-text('Note')"); await page.waitForSelector("#sheet:not([hidden]) .note-text"); await page.fill("#sheet .note-text", text); await page.click("#sheet .peek-row .primary"); await page.waitForTimeout(400); };
  await note("The first wording.");
  await note("Written over.");
  check(/Note saved\.Undo/.test(await toastSays(/Note saved/)), `writing over a note should offer Undo: ${await page.textContent("#toast")}`);
  await undo();
  check((await mark())?.note === "The first wording.", `Undo should put the note back as it read: ${JSON.stringify(await mark())}`);

  // Settings saved with the instructions emptied
  const told = () => page.evaluate(() => ({ i: window.Ask.settings.instructions, n: window.Ask.settings.notes }));
  await page.evaluate(() => { window.Ask.settings.instructions = "Keep it short."; window.Ask.settings.notes = "2026-11-01: A note to keep."; });
  await page.evaluate(() => GL.openSettings());
  await page.waitForSelector("#sheet:not([hidden]) .ask-instructions");
  await page.fill("#sheet .ask-instructions", "");
  await page.click("#sheet .ask-settings .primary");
  check(/Instructions cleared\.Undo/.test(await toastSays(/cleared/)), `saving with the instructions emptied should say so, with Undo: ${await page.textContent("#toast")}`);
  check((await told()).i === "" && (await told()).n === "2026-11-01: A note to keep.", "the instructions were not cleared, or the notes went too");
  await undo();
  check((await told()).i === "Keep it short.", `Undo should put the instructions back: ${JSON.stringify(await told())}`);

  // an import, undone whole
  const before = await page.evaluate(async () => ({ marks: (await window.Marks.all()).length, studies: (await window.Studies.list()).length, decks: window.Deck.backup().saved.length }));
  const file = `${SHOTS}undo-more-backup.json`;
  fs.writeFileSync(file, JSON.stringify({ app: "gospel-library", kind: "backup", version: 1,
    marks: [{ uri: "/scriptures/bofm/alma/33", pid: "p1", kind: "verse", color: "y", text: "x", citation: "Alma 33:1", title: "Alma 33", updated: 5, created: 5 }],
    studies: [{ id: "simported1", title: "An imported page", kind: "txt", text: "Imported words.", added: 5, size: 15 }],
    decks: { current: null, saved: [{ id: "dimported1", title: "An imported deck", updated: 5, deck: { id: "dimported1", title: "An imported deck", items: [{ id: "q1", type: "question", text: "Why?" }], links: [] } }] },
    ask: { instructions: "", notes: "2026-11-05: An imported note." } }));
  await page.evaluate(() => GL.openSettings());
  await page.waitForSelector("#sheet:not([hidden]) .settings");
  await page.setInputFiles("#sheet .settings input[type=file]", file);
  check(/Brought in: 1 mark, 1 study page, 1 deck in My decks\.Undo/.test(await toastSays(/Brought in/)), `an import should say what came in, with Undo: ${await page.textContent("#toast")}`);
  await undo();
  await page.waitForTimeout(600);
  const after = await page.evaluate(async () => ({ marks: (await window.Marks.all()).length, studies: (await window.Studies.list()).length, decks: window.Deck.backup().saved.length }));
  check(JSON.stringify(after) === JSON.stringify(before), `Undo of an import should leave marks, study pages and decks as they were: ${JSON.stringify(before)} then ${JSON.stringify(after)}`);
  check(/The import was undone/.test(await page.textContent("#sheet .set-said")) && await page.locator("#sheet .set-incoming").isHidden(), "Settings does not say the import was undone, or still offers its words for Claude");
  // again: the words for Claude accepted, and that taken back
  await page.setInputFiles("#sheet .settings input[type=file]", file);
  await page.waitForSelector("#sheet .set-incoming:not([hidden])", { timeout: 5000 }).catch(() => errors.push("the imported note for Claude was not offered"));
  await page.click("#sheet .set-incoming .primary");
  check(/An imported note/.test((await told()).n), "Accept did not bring the note in");
  check(/Brought in for Claude\.Undo/.test(await toastSays(/for Claude/)), "accepting the words for Claude should offer Undo");
  await undo();
  check(!/An imported note/.test((await told()).n), "Undo should take the accepted note back out");

  await page.evaluate(async () => { await window.Marks.replaceAll([]); await window.Studies.replaceAll([]); await window.Deck.restoreSaved([]); window.Ask.settings.instructions = ""; window.Ask.settings.notes = ""; });
  await ctx.close();
  return errors;
}
