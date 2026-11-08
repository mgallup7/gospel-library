import fs from "node:fs";
// deck-cards: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "cards/";
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  // a deck with two passages
  await page.evaluate(() => { const d = { id: "d2", title: "Faith Is a Seed", subtitle: "Zone conference", theme: "royal", themeSet: true, updated: Date.now(), chain: null, links: [], items: [
    { id: "a", type: "passage", kind: "verse", doc_id: 1316, pid: "p21", citation: "Alma 32:21", where: "", hl: [], text: "And now as I said concerning faith faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.", verses: [{ n: 21, text: "And now as I said concerning faith faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true." }] },
    { id: "b", type: "passage", kind: "verse", doc_id: 2, pid: "p1", citation: "Hebrews 11:1", where: "", hl: [], text: "Now faith is the substance of things hoped for, the evidence of things not seen.", verses: [{ n: 1, text: "Now faith is the substance of things hoped for, the evidence of things not seen." }] } ] };
    localStorage.setItem("gospel.deck", JSON.stringify(d)); });
  await page.reload();
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 60000 });
  await page.click("#deckBtn");
  await page.waitForSelector(".board .bcard", { timeout: 10000 });
  await page.click(".board-row button:has-text('More')");
  await page.click(".board button:has-text('Add question')");
  await page.waitForSelector(".bcard.question textarea", { timeout: 5000 });
  await page.fill(".bcard.question textarea", "What has faith asked of you this transfer?");
  await page.click(".board button:has-text('Add note')");
  await page.waitForSelector(".bcard.note textarea", { timeout: 5000 });
  await page.fill(".bcard.note .bc-card-text", "Pause here. Let them answer before moving on.");
  // speaker notes on the first passage
  await page.click(".bcard[data-id='a'] .notes-toggle");
  await page.fill(".bcard[data-id='a'] .bc-notes-text", "Read slowly; this is the hinge of the lesson.");
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "01-board.png" });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.deck")));
  const q = saved.items.find((i) => i.type === "question"), nt = saved.items.find((i) => i.type === "note");
  if (!q || q.text !== "What has faith asked of you this transfer?") errors.push("question not saved");
  if (!nt || !/Pause here/.test(nt.text)) errors.push("note not saved");
  if (saved.items[0].notes !== "Read slowly; this is the hinge of the lesson.") errors.push(`speaker notes not saved: ${saved.items[0].notes}`);
  // present: the question is a slide
  await page.click(".board-row button:has-text('Present')");
  await page.waitForSelector(".stage:not([hidden])", { timeout: 5000 });
  let found = false;
  for (let i = 0; i < 8; i++) { const t = await page.textContent(".stage-text"); if (/faith asked of you/.test(t)) { found = await page.evaluate(() => document.querySelector(".stage-body").classList.contains("is-question")); break; } await page.keyboard.press("ArrowRight"); await page.waitForTimeout(200); }
  if (!found) errors.push("question slide not shown while presenting");
  await page.screenshot({ path: OUT + "02-stage.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  // the PowerPoint: build it and read the slide XML
  const r = await page.evaluate(async () => {
    const pptx = await window.Deck.build();
    const blob = await pptx.write({ outputType: "blob" });
    return { size: blob.size, b64: await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(",")[1]); fr.readAsDataURL(blob); }) };
  }).catch((e) => ({ error: String(e) }));
  if (r.error) errors.push("pptx build: " + r.error);
  else {
    fs.writeFileSync(OUT + "deck.pptx", Buffer.from(r.b64, "base64"));
    const { execSync } = await import("node:child_process");
    const list = execSync(`cd ${OUT} && rm -rf x && mkdir x && cd x && unzip -o -q ../deck.pptx && ls ppt/slides ppt/notesSlides 2>/dev/null; grep -l "faith asked of you" ppt/slides/*.xml; grep -l "hinge of the lesson" ppt/notesSlides/*.xml`).toString();
    console.log(list);
    if (!/notesSlides\/notesSlide\d+\.xml/.test(list) || !/slide\d+\.xml/.test(list)) errors.push("pptx missing the question slide or the notes");
  }
  return errors;
}
