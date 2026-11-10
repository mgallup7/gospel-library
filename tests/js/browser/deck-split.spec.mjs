import fs from "node:fs";
import { execSync } from "node:child_process";
// deck-split: a verse too long for one slide is cut into pieces, and a highlight shows on the
// words it was put on, in whichever piece they fall, on the stage and in the PowerPoint file.
// Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-split/";
  fs.mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
  const check = (c, m) => { if (!c) errors.push(m); };
  // one verse of about 900 characters (it splits past 602), between two short ones
  const long = "For, notwithstanding the great love which the converts to these different faiths expressed at the time of their conversion, and the great zeal manifested by the respective clergy, who were active in getting up and promoting this extraordinary scene of religious feeling, in order to have everybody converted, as they were pleased to call it, let them join what sect they pleased; yet when the converts began to file off, some to one party and some to another, it was seen that the seemingly good feelings of both the priests and the converts were more pretended than real; for a scene of great confusion and bad feeling ensued, priest contending against priest, and convert against convert; so that all their good feelings one for another, if they ever had any, were entirely lost in a strife of words and a contest about opinions.";
  const verses = [{ n: 5, text: "Some time in the second year after our removal to Manchester, there was an unusual excitement on the subject of religion." }, { n: 6, text: long }, { n: 7, text: "I was at this time in my fifteenth year." }];
  const seed = { id: "split1", title: "", subtitle: "", theme: "royal", themeSet: true, updated: Date.now(), chain: null, links: [], items: [
    { id: "v", type: "passage", kind: "verse", doc_id: 9, pid: "p5", citation: "Joseph Smith—History 1:5–7", where: "", hl: [], text: verses.map((v) => v.text).join(" "), verses } ] };
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  await page.evaluate((d) => localStorage.setItem("gospel.deck", JSON.stringify(d)), seed);
  await page.reload();
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 60000 });
  await page.evaluate(() => window.Deck.ready);

  // three highlights: in the first piece of the long verse, in its last piece, and in the verse after it
  const words = verses.flatMap((v) => v.text.split(/\s+/));
  const at = (phrase) => { const p = phrase.split(" "); const i = words.findIndex((_, k) => p.every((w, j) => words[k + j] === w)); return [i, i + p.length - 1]; };
  const phrases = ["the great love which", "a strife of words", "my fifteenth year."];
  for (const p of phrases) { const [a, b] = at(p); check(a >= 0, `test phrase not found: ${p}`); await page.evaluate(([a, b]) => window.Deck.setHighlight("v", a, b), [a, b]); }

  // the stage: every slide's marked words
  await page.click("#deckBtn");
  await page.waitForSelector(".board .bcard", { timeout: 10000 });
  await page.click(".board-row button:has-text('Present')");
  await page.waitForSelector(".stage:not([hidden])", { timeout: 5000 });
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const slide = await page.evaluate(() => ({ text: document.querySelector(".stage-text").textContent.slice(0, 40), marks: [...document.querySelectorAll(".stage-text mark")].map((m) => m.textContent) }));
    if (seen.length && seen[seen.length - 1].text === slide.text) break;
    seen.push(slide);
    if (slide.marks.length) await page.screenshot({ path: `${OUT}stage-${seen.length}.png` });
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
  }
  await page.keyboard.press("Escape");
  const staged = seen.flatMap((s) => s.marks);
  check(seen.length >= 3, `the long verse should be cut across slides: ${seen.length} slides`);
  check(JSON.stringify(staged) === JSON.stringify(phrases), `the stage should mark the three phrases and nothing else: ${JSON.stringify(staged)}`);

  // the PowerPoint: the runs in the accent color, bold, that are not verse numbers
  const r = await page.evaluate(async () => {
    const pptx = await window.Deck.build();
    const blob = await pptx.write({ outputType: "blob" });
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
  });
  fs.writeFileSync(OUT + "deck.pptx", Buffer.from(r, "base64"));
  execSync(`cd ${OUT} && rm -rf x && mkdir x && cd x && unzip -o -q ../deck.pptx`);
  const filed = [];
  const slides = fs.readdirSync(OUT + "x/ppt/slides").filter((f) => /^slide\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
  for (const f of slides) {
    const xml = fs.readFileSync(`${OUT}x/ppt/slides/${f}`, "utf8");
    const runs = [...xml.matchAll(/<a:r>(.*?)<\/a:r>/gs)].map((m) => m[1]).filter((x) => /b="1"/.test(x) && /F2C75C/.test(x) && !/baseline=/.test(x) && /sz="(1[89]|[2-9]\d)\d\d"/.test(x));
    const text = runs.map((x) => (x.match(/<a:t>(.*?)<\/a:t>/s) || [])[1] || "").join("").trim();
    if (text) filed.push(text);
  }
  check(JSON.stringify(filed) === JSON.stringify(phrases), `the PowerPoint should mark the three phrases and nothing else: ${JSON.stringify(filed)}`);
  await ctx.close();
  return errors;
}
