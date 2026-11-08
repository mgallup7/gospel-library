import fs from "node:fs";
// modules: the interface scripts load as ES modules, in order, and the helpers they import from
// web/lib/ answer the same in the page as in node: the Markdown of a study, the deck's chunks.
// Run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const OUT = SHOTS + "modules/";
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, viewport] of [["ipad", { width: 1180, height: 820 }], ["iphone", { width: 393, height: 852 }]]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name} pageerror: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${name} console: ${m.text().slice(0, 200)}`); });
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    const got = await page.evaluate(() => ({
      types: [...document.querySelectorAll("body > script[src]")].map((s) => `${s.getAttribute("src")}:${s.type}`),
      globals: ["GL", "Ask", "Original", "Deck", "Studies", "Marks"].filter((g) => !window[g]),
      md: window.Studies.frameHtml({ kind: "md", text: "# Notes\n\n> A quote\n\n- one\n- *two*\n\n[site](https://example.com/)" }),
      chunks: window.Deck.chunksOf({ kind: "verse", verses: [1, 2, 3].map((n) => ({ n, text: "word ".repeat(60).trim() })), citation: "Alma 32:1–3" }).map((c) => c.label),
    }));
    const want = ["./app.js", "./ask.js", "./original.js", "./deck.js", "./studies.js", "./marks.js"].map((s) => `${s}:module`);
    if (JSON.stringify(got.types) !== JSON.stringify(want)) errors.push(`${name} scripts: ${got.types.join(", ")}`);
    if (got.globals.length) errors.push(`${name} missing: ${got.globals.join(", ")}`);
    for (const bit of ["<h1>Notes</h1>", "<blockquote>A quote</blockquote>", "<li><i>two</i></li>", '<a href="https://example.com/">site</a>']) if (!got.md.includes(bit)) errors.push(`${name} study markdown lacks ${bit}`);
    if (got.chunks.join("|") !== "Alma 32:1 (1 of 3)|Alma 32:2 (2 of 3)|Alma 32:3 (3 of 3)") errors.push(`${name} chunks: ${got.chunks.join("|")}`);
    await page.screenshot({ path: OUT + `${name}-home.png` });
    await ctx.close();
  }
  return errors;
}
