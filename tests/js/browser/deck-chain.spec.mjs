import fs from "node:fs";
import { execSync } from "node:child_process";
// deck-chain: the closing chain slides can be read from the back of a chapel. A chain of nine
// passages and eight arrows is presented on a 1920 by 1080 screen and written to a PowerPoint:
// it is split across slides (six passages a slide at most) with every arrow drawn once, the
// passage names and arrow names are at least 40px tall on the screen (20pt on PowerPoint's
// wide slide; 15pt on this file's 10 inch one), the excerpts at least 13pt, the boxes take a
// good share of the slide, and no text leaves its box. A short chain of three is one slide of
// three large boxes. Run by tests/js/browser/run.mjs.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "deck-chain/";
  fs.mkdirSync(OUT, { recursive: true });
  const check = (c, m) => { if (!c) errors.push(m); };
  const text = "And now as I said concerning faith, faith is not to have a perfect knowledge of things; therefore if ye have faith ye hope for things which are not seen, which are true.";
  const names = ["Alma 32:21", "Hebrews 11:1", "Ether 12:6", "Moroni 7:33", "Doctrine and Covenants 76:22–24", "2 Nephi 31:20", "James 2:17", "Alma 32:27", "Mosiah 4:9"];
  const labels = ["defines", "same word", "promise and keeping", "", "echoes", "a much longer name than any arrow has room to carry", "fulfilled in", "contrast"];
  const seed = (n) => {
    const d = { id: `ch${n}`, title: "Faith Is a Seed", subtitle: "", theme: "royal", themeSet: true, updated: Date.now(), chain: { caption: "Faith begins as a desire, is nourished by the word, and ends in knowledge.", notes: "Walk the room through it." }, links: [], items: [] };
    for (let i = 0; i < n; i++) d.items.push({ id: `c${i}`, type: "passage", kind: "verse", doc_id: 7000 + i, pid: `p${i + 1}`, citation: names[i], where: "", hl: [{ id: `h${i}`, s: 5, e: 9 }], text, verses: [{ n: i + 1, text }] });
    for (let i = 0; i + 1 < n; i++) d.links.push({ id: `l${i}`, type: "link", from: { id: `c${i}`, hl: `h${i}` }, to: { id: `c${i + 1}`, hl: `h${i + 1}` }, label: labels[i] });
    return d;
  };
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 300)}`); });
  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });

  // What the stage shows of a chain slide: sizes in screen pixels, and what overlaps what.
  const measure = () => page.evaluate(() => {
    const svg = document.querySelector(".stage .stage-map");
    if (!svg) return null;
    const sr = svg.getBoundingClientRect();
    const px = (sel) => [...svg.querySelectorAll(sel)].map((t) => parseFloat(getComputedStyle(t).fontSize) * (sr.width / svg.viewBox.baseVal.width));
    const boxes = [...svg.querySelectorAll("rect")].map((r) => r.getBoundingClientRect());
    const inside = (t) => boxes.some((b) => t.left >= b.left - 1 && t.right <= b.right + 1 && t.top >= b.top - 1 && t.bottom <= b.bottom + 1);
    const hit = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const arrows = [...svg.querySelectorAll(".map-arrow-label")].map((t) => t.getBoundingClientRect());
    return {
      labels: px(".map-label"), arrows: px(".map-arrow-label"), excerpts: px(".map-excerpt"),
      names: [...svg.querySelectorAll(".map-arrow-label")].map((t) => t.textContent),
      boxes: boxes.length, lines: svg.querySelectorAll("polyline").length,
      share: boxes.reduce((a, b) => a + b.width * b.height, 0) / (sr.width * sr.height),
      wide: sr.width / innerWidth,
      spill: [...svg.querySelectorAll(".map-label, .map-excerpt")].filter((t) => !inside(t.getBoundingClientRect())).map((t) => t.textContent),
      crossed: boxes.some((a, i) => boxes.some((b, j) => j > i && hit(a, b))),
      covered: arrows.filter((t, i) => boxes.some((b) => hit(t, b)) || arrows.some((u, j) => j !== i && hit(t, u))).length,
      offscreen: [...svg.querySelectorAll("text")].some((t) => { const r = t.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight; }),
      caption: document.querySelector(".stage .stage-caption")?.textContent || "",
      where: document.querySelector(".stage .stage-ref")?.textContent || "",
    };
  });
  const load = async (d) => {
    await page.evaluate((x) => localStorage.setItem("gospel.deck", JSON.stringify(x)), d);
    await page.reload();
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 60000 });
    await page.evaluate(() => window.Deck.ready);
  };
  // present, and walk back from the last slide over the chain slides
  const chainSlides = async (tag) => {
    await page.evaluate(() => window.Deck.present());
    await page.waitForSelector(".stage .stage-text", { timeout: 10000 });
    const total = await page.evaluate(() => Number(document.querySelector(".stage .stage-count").textContent.split("/")[1]));
    for (let i = 1; i < total; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    const out = [];
    for (;;) {
      const m = await measure();
      if (!m) break;
      await page.screenshot({ path: `${OUT}stage-${tag}-${out.length + 1}-from-last.png` });
      out.unshift(m);
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(150);
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    return out;
  };
  const judge = (tag, slides) => {
    slides.forEach((m, i) => {
      const at = `${tag}, chain slide ${i + 1}`;
      check(m.labels.length && Math.min(...m.labels) >= 40, `${at}: a passage name is ${Math.min(...m.labels).toFixed(1)}px tall on a 1920 by 1080 screen; 40 is the least`);
      check(!m.arrows.length || Math.min(...m.arrows) >= 40, `${at}: an arrow's name is ${Math.min(...m.arrows).toFixed(1)}px; 40 is the least`);
      check(!m.excerpts.length || Math.min(...m.excerpts) >= 34, `${at}: an excerpt is ${Math.min(...m.excerpts).toFixed(1)}px; 34 (13pt) is the least`);
      check(m.boxes <= 6, `${at}: ${m.boxes} boxes on one slide; six is the most`);
      check(m.share >= 0.4 && m.wide >= 0.8, `${at}: the boxes should fill the slide (they take ${(m.share * 100).toFixed(0)}% of a picture ${(m.wide * 100).toFixed(0)}% of the screen wide)`);
      check(!m.spill.length, `${at}: text leaves its box: ${m.spill.join(" | ")}`);
      check(!m.crossed, `${at}: two boxes overlap`);
      check(!m.covered, `${at}: ${m.covered} arrow names sit on a box or on each other`);
      check(!m.offscreen, `${at}: some text is off the screen`);
    });
  };

  // ---- nine passages, eight arrows
  await load(seed(9));
  const long = await chainSlides("nine");
  check(long.length >= 2, `a chain of nine passages should be split across slides (${long.length})`);
  judge("nine", long);
  check(long.reduce((a, m) => a + m.lines, 0) === 8, `every arrow should be drawn once: ${long.map((m) => m.lines).join(" + ")} of 8`);
  check(long.every((m, i) => new RegExp(`the chain, ${i + 1} of ${long.length}`).test(m.where)), `each slide should say which it is: ${long.map((m) => m.where).join(" | ")}`);
  check(long.slice(0, -1).every((m) => !m.caption) && /ends in knowledge/.test(long[long.length - 1].caption), "the caption should close the last chain slide only");
  const all = long.flatMap((m) => m.names);
  check(all.includes("promise and keeping") && all.includes("defines"), `the arrows should wear their names: ${all.join(" | ")}`);
  check(all.some((x) => /^a much longer name.*…$/.test(x)) && !all.includes(labels[5]), "a name too long for its run should be cut short, not shrunk");

  // the PowerPoint: the same slides, with the names at 15pt or more on its 10 inch slide
  const b64 = await page.evaluate(async () => {
    const pptx = await window.Deck.build();
    const blob = await pptx.write({ outputType: "blob" });
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
  });
  fs.writeFileSync(OUT + "chain.pptx", Buffer.from(b64, "base64"));
  execSync(`cd ${OUT} && rm -rf x && mkdir x && cd x && unzip -o -q ../chain.pptx`);
  const files = fs.readdirSync(OUT + "x/ppt/slides").filter((f) => /^slide\d+\.xml$/.test(f)).sort((a, b) => parseInt(a.slice(5)) - parseInt(b.slice(5)));
  const filed = files.map((f) => fs.readFileSync(`${OUT}x/ppt/slides/${f}`, "utf8")).filter((xml) => /THE CHAIN/.test(xml));
  check(filed.length === long.length, `the PowerPoint should have the same ${long.length} chain slides (${filed.length})`);
  const seen = new Set();
  filed.forEach((xml, i) => {
    const runs = [...xml.matchAll(/<a:r>(.*?)<\/a:r>/gs)].map((m) => ({ text: ((m[1].match(/<a:t>(.*?)<\/a:t>/s) || [])[1] || "").replace(/&amp;/g, "&"), size: Number((m[1].match(/sz="(\d+)"/) || [])[1] || 0) / 100, bold: /b="1"/.test(m[1]) }));
    const named = runs.filter((r) => names.includes(r.text));
    const arrows = runs.filter((r) => labels.some((l) => l && (r.text === l || (r.text.endsWith("…") && l.startsWith(r.text.slice(0, -1).trim())))));
    const excerpts = runs.filter((r) => r.text.startsWith("“"));
    named.forEach((r) => seen.add(r.text));
    check(named.length >= 2 && named.length <= 6, `PowerPoint chain slide ${i + 1}: ${named.length} passages (two to six)`);
    check(named.every((r) => r.size >= 15 && r.bold), `PowerPoint chain slide ${i + 1}: passage names should be bold and 15pt or more: ${named.map((r) => r.size).join(", ")}`);
    check(arrows.length > 0 && arrows.every((r) => r.size >= 15), `PowerPoint chain slide ${i + 1}: arrow names should be 15pt or more: ${arrows.map((r) => r.size).join(", ")}`);
    check(excerpts.every((r) => r.size >= 13), `PowerPoint chain slide ${i + 1}: excerpts should be 13pt or more: ${excerpts.map((r) => r.size).join(", ")}`);
  });
  check(seen.size === 9, `every passage should be on a chain slide (${seen.size} of 9)`);

  // ---- three passages: one slide, one row of large boxes
  await load(seed(3));
  const short = await chainSlides("three");
  check(short.length === 1 && short[0].boxes === 3, `a chain of three should be one slide of three boxes (${short.length} slides)`);
  judge("three", short);
  check(short[0] && short[0].labels.length === 3 && !/ of /.test(short[0].where), "and it should not be numbered");

  // ---- an iPad and a phone: the same picture, inside the screen
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    await page.setViewportSize(viewport);
    await load(seed(9));
    const m = await chainSlides(name);
    check(m.length === long.length && m.every((x) => !x.offscreen && !x.spill.length), `${name}: the chain slides should fit the screen`);
  }
  await ctx.close();
  return errors;
}
