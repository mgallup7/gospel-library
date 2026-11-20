// deck-name: Download PowerPoint asks for the file's name first, the deck's title offered, and the
// file comes under the name typed; and nothing shared beside a file carries a title (on an iPhone
// or iPad a title is saved as a second file, a .txt).
// Run by tests/js/browser/run.mjs.
import fs from "node:fs";
import { box } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  await page.evaluate(() => window.Deck.ready);
  await box(page, "Alma 32:21"); await page.press("#q", "Enter");
  await page.waitForSelector("#reader .doc #p21", { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.click("#reader .doc #p21");
  await page.click("#reader .select-bar .add-deck");
  await page.click("#deckBtn");
  await page.waitForSelector(".board .bcard .bc-cite", { timeout: 10000 });

  // the button opens the naming sheet, with the deck's title in the box and no download yet
  let early = false;
  page.once("download", () => { early = true; });
  await page.click(".board-row .primary");
  await page.waitForSelector(".dsheet input.file-name", { timeout: 5000 });
  await page.waitForTimeout(400);
  check(!early, "the file came before it was named");
  check((await page.inputValue(".dsheet input.file-name")) === "Scriptures", `the name offered is ${JSON.stringify(await page.inputValue(".dsheet input.file-name"))}`);
  check(await page.evaluate(() => document.activeElement?.classList.contains("file-name")), "the name box is not ready to type in");
  // Cancel: no file
  await page.click(".dsheet button:text-is('Cancel')");
  await page.waitForTimeout(300);
  check(!(await page.$(".dsheet input.file-name")), "Cancel left the sheet open");
  // a name typed, with characters a file cannot have and its own .pptx: the file comes under the clean name
  await page.click(".board-row .primary");
  await page.waitForSelector(".dsheet input.file-name", { timeout: 5000 });
  await page.fill(".dsheet input.file-name", 'Zone conference: "Faith"/Nov.pptx');
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click(".dsheet .file-save")]);
  check(dl.suggestedFilename() === "Zone conference Faith Nov.pptx", `the file is named ${JSON.stringify(dl.suggestedFilename())}`);
  const file = await dl.path();
  check(file && fs.statSync(file).size > 10000 && fs.readFileSync(file).subarray(0, 2).toString() === "PK", "the file is not a PowerPoint");
  check(!(await page.$(".dsheet input.file-name")), "the sheet stayed open after Save");
  // Return in the box saves as well; an empty name falls back to the deck's title
  await page.click(".board-row .primary");
  await page.waitForSelector(".dsheet input.file-name", { timeout: 5000 });
  await page.fill(".dsheet input.file-name", "   ");
  const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.press(".dsheet input.file-name", "Enter")]);
  check(dl2.suggestedFilename() === "Scriptures.pptx", `an empty name gave ${JSON.stringify(dl2.suggestedFilename())}`);
  await ctx.close();

  // where files leave by the share sheet (iPhone, iPad): the file alone is shared, under the name typed
  {
    const phone = await browser.newContext({ viewport: { width: 393, height: 852 }, hasTouch: true });
    const pp = await phone.newPage();
    pp.on("pageerror", (e) => errors.push(`page error (phone): ${e.message}`));
    await pp.addInitScript(() => { window.__shared = []; navigator.canShare = (d) => !!(d && d.files && d.files.length); navigator.share = async (d) => { window.__shared.push({ keys: Object.keys(d).sort(), names: (d.files || []).map((f) => f.name), sizes: (d.files || []).map((f) => f.size) }); }; });
    await pp.goto(BASE);
    await pp.fill("div.setup input", PASS);
    await pp.press("div.setup input", "Enter");
    await pp.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await pp.evaluate(async () => { await window.Deck.ready; const r = await GL.api("search", { q: "Alma 32:21", limit: 1 }); await GL.openDoc(r.jump.doc_id, "p21"); });
    await pp.waitForSelector("#reader .doc #p21", { timeout: 15000 });
    await pp.evaluate(() => document.querySelector("#reader .doc #p21").click());
    await pp.waitForSelector("#reader .select-bar .add-deck", { timeout: 5000 });
    await pp.evaluate(() => document.querySelector("#reader .select-bar .add-deck").click());
    await pp.evaluate(() => window.Deck.showBoard());
    await pp.waitForSelector(".board .board-row .primary", { timeout: 10000 });
    await pp.evaluate(() => document.querySelector(".board .board-row .primary").click());
    await pp.waitForSelector(".dsheet input.file-name", { timeout: 5000 });
    await pp.fill(".dsheet input.file-name", "My talk");
    await pp.waitForTimeout(1500); // the file is built while the name is typed
    await pp.evaluate(() => document.querySelector(".dsheet .file-save").click());
    await pp.waitForFunction(() => window.__shared.length > 0, null, { timeout: 15000 }).catch(() => {});
    const shared = await pp.evaluate(() => window.__shared);
    check(shared.length === 1 && shared[0].keys.join() === "files" && shared[0].names.join() === "My talk.pptx" && shared[0].sizes[0] > 10000, `what was shared: ${JSON.stringify(shared)}`);
    // the Markdown file and the backup file: the file alone as well
    const others = await pp.evaluate(async () => { window.__shared = []; await GL.saveFile?.("x.json", "{}", "A title"); return window.__shared; });
    if (others.length) check(others[0].keys.join() === "files", `the backup file was shared with ${others[0].keys}`);
    await phone.close();
  }
  return errors;
}
