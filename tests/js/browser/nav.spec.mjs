// nav: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase
// One way to do each thing: + on a result stays put with Undo; an empty board gives way to fresh
// results and only one Back shows; the reader bar folds its text sizes into Aa when it has no room;
// a half-typed range keeps its card; nothing found says so once; a one-letter query leaves the
// address; the marks on My studies can be found by words and color, under a heading per book.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  async function start(name, viewport) {
    const page = await (await browser.newContext({ viewport, deviceScaleFactor: 1 })).newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForTimeout(400);
    return page;
  }
  const backs = (page) => page.evaluate(() => [...document.querySelectorAll(".trail-back, .home-back")].filter((x) => x.offsetParent !== null).map((b) => b.textContent.replace("‹", "").trim()));
  const panes = (page) => page.evaluate(() => ({ reader: !document.querySelector("#reader").hidden, panel: !document.querySelector("#panel").hidden }));

  // iPad: the empty board, then results; + on a result
  {
    const name = "ipad", page = await start(name, { width: 1180, height: 820 });
    await page.click("#deckBtn"); await page.waitForTimeout(700);
    let b = await backs(page);
    if (b.length !== 1) errors.push(`${name} empty deck: ${b.length} Back buttons (${b.join(", ")})`);
    await page.fill("#q", "faith hope"); await page.press("#q", "Enter"); await page.waitForTimeout(1200);
    if ((await panes(page)).panel) errors.push(`${name}: the empty board stayed up under fresh results`);
    b = await backs(page);
    if (b.length !== 1 || b[0] !== "Deck") errors.push(`${name} results: Back buttons ${JSON.stringify(b)}`);
    await page.click(".hit-row .add >> nth=0"); await page.waitForTimeout(600);
    const after = await page.evaluate(() => ({ panel: !document.querySelector("#panel").hidden, undo: !!document.querySelector(".toast .toast-action"), n: document.querySelector("#deckBtn .deck-count")?.textContent }));
    if (after.panel) errors.push(`${name}: + on a result turned the pane to the board`);
    if (!after.undo) errors.push(`${name}: + on a result showed no Undo`);
    if (after.n !== "1") errors.push(`${name}: the Deck button counts ${after.n}`);
    await page.context().close();
  }

  // iPad portrait: Genesis 1 with the Hebrew and the Page | Deck switch
  {
    const name = "portrait", page = await start(name, { width: 820, height: 1180 });
    await page.click("#homeBody .shelf-tile:has-text('Scriptures')"); await page.waitForTimeout(500);
    await page.click("#homeBody .chip:text-is('Genesis')"); await page.waitForTimeout(500);
    await page.click("#homeBody .chapters button:text-is('1')"); await page.waitForSelector("#reader .doc"); await page.waitForTimeout(800);
    await page.click("#deckBtn"); await page.waitForTimeout(700);
    await page.click("#panel .pane-switch button:has-text('Page')"); await page.waitForTimeout(600);
    const bar = await page.evaluate(() => { const b = document.querySelector("#reader .reader-bar"); return { cls: b.className, over: b.scrollWidth - b.clientWidth, crumb: b.querySelector(".crumb").getBoundingClientRect().width, two: b.querySelector(".size-btns").offsetParent !== null }; });
    if (!/compact/.test(bar.cls) || bar.two) errors.push(`${name}: the text sizes did not fold into Aa (${bar.cls})`);
    if (bar.over > 1) errors.push(`${name}: the reader bar overflows by ${bar.over}px`);
    if (bar.crumb < 40) errors.push(`${name}: the crumb is ${Math.round(bar.crumb)}px`);
    await page.click("#reader .size-pop-btn"); await page.waitForTimeout(200);
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--reading-size"));
    await page.click("#reader .size-menu button:has-text('Larger text')");
    const grown = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--reading-size"));
    if (before === grown) errors.push(`${name}: Larger text in the Aa menu did nothing`);
    await page.screenshot({ path: `${SHOTS}nav-portrait-bar.png`, clip: { x: 0, y: 0, width: 820, height: 260 } });
    const wideBar = await page.evaluate(() => document.querySelector("#reader .reader-bar").className);
    await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(400);
    const land = await page.evaluate(() => document.querySelector("#reader .reader-bar .size-btns").offsetParent !== null);
    if (!land) errors.push(`${name}: in landscape the two size buttons should be back (was ${wideBar})`);
    await page.context().close();
  }

  // iPhone: search edges and the marks list
  {
    const name = "iphone", page = await start(name, { width: 393, height: 852 });
    await page.fill("#q", "Alma 32:21-"); await page.waitForTimeout(900);
    if (!(await page.$("#list .jump"))) errors.push(`${name}: Alma 32:21- lost its jump card`);
    await page.fill("#q", 'a"b'); await page.press("#q", "Enter"); await page.waitForTimeout(900);
    const both = await page.evaluate(() => [!!document.querySelector("#list .smart-line"), !!document.querySelector("#list .empty")]);
    if (both[0] && both[1]) errors.push(`${name}: a"b shows the smart line and Nothing matches together`);
    await page.fill("#q", "a"); await page.waitForTimeout(900);
    const hash = await page.evaluate(() => location.hash);
    if (/search/.test(hash)) errors.push(`${name}: a one-letter query left ${hash}`);
    await page.evaluate(async () => {
      const books = [["Alma", 32], ["Genesis", 1], ["Moroni", 10]];
      for (let i = 0; i < 14; i++) {
        const [bk, ch] = books[i % 3];
        await window.Marks.set({ uri: `/nav-test/${bk}/${ch}`, pid: `p${i + 1}`, verse: i + 1, color: window.Marks.COLORS[i % 4], note: i === 5 ? "a seed of faith" : null, text: `Verse ${i} ${i % 2 ? "faith" : "hope"}`, citation: `${bk} ${ch}:${i + 1}`, title: `${bk} ${ch}` });
      }
    });
    await page.fill("#q", ""); await page.waitForTimeout(300);
    await page.click("#homeBody .shelf-tile:has-text('My studies')"); await page.waitForSelector(".mk-find");
    const count = () => page.evaluate(() => ({ rows: document.querySelectorAll(".mark-row").length, books: document.querySelectorAll(".mk-book").length, scopes: getComputedStyle(document.querySelector(".scopes")).display }));
    let c = await count();
    if (c.rows !== 10 || c.books !== 3) errors.push(`${name} marks: ${c.rows} rows under ${c.books} headings, not the latest 10 under 3`);
    if (c.scopes !== "none") errors.push(`${name}: the scope strip shows on My studies`);
    await page.fill(".mk-find", "seed"); await page.waitForTimeout(150);
    c = await count();
    if (c.rows !== 1 || c.books !== 0) errors.push(`${name} marks: "seed" (a note) found ${c.rows} rows, ${c.books} headings`);
    await page.fill(".mk-find", "faith"); await page.click(".mk-dot.hl-g"); await page.waitForTimeout(150);
    c = await count();
    if (c.rows !== 4) errors.push(`${name} marks: faith in green found ${c.rows}, not 4`);
    await page.screenshot({ path: `${SHOTS}nav-marks.png` });
    await page.context().close();
  }
  return errors;
}
