// pane-switch: run by tests/js/browser/run.mjs, which hands over the browser, the app's address and the passphrase.
// On an iPad the Deck tab is the board across the place, and the page stays where it was read:
// its tab brings it back with its selection and its scroll. Once the board has been opened, the
// page's bar has a Page | Deck switch that turns the right pane to the board and back without
// leaving the page's place. A reload on #deck?doc= shows the board with the page on offer. On a
// phone there is no switch and the Deck tab is a list view.
import { box, readerTool } from "./helpers.mjs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  async function unlock(page) {
    page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`); });
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
  }
  const look = (page) => page.evaluate(() => {
    const vis = (n) => !!n && n.offsetParent !== null;
    const sw = [...document.querySelectorAll(".pane-switch")].find(vis);
    const reader = document.querySelector("#reader"), panel = document.querySelector("#panel");
    return {
      hash: decodeURIComponent(location.hash),
      reader: vis(reader), board: vis(panel) && vis(panel.querySelector(".board")),
      cards: panel ? panel.querySelectorAll(".bcard").length : 0,
      sw: sw ? [...sw.querySelectorAll("button")].map((b) => b.textContent + (b.classList.contains("on") ? "*" : "")).join("|") : null,
      title: reader.querySelector(".doc h1")?.textContent?.trim() || "",
      target: reader.querySelector(".doc .is-target")?.id || null,
      sel: [...reader.querySelectorAll(".doc .sel")].map((n) => n.id),
      scroll: reader.scrollTop,
      fab: [...document.querySelectorAll(".think-btn")].some((b) => b.offsetParent !== null), // the lamp, in the page's bar only
      pill: !!document.querySelector(".fab-think"),
    };
  });
  const clickSwitch = (page, label) => page.evaluate((label) => [...document.querySelectorAll(".pane-switch button")].find((b) => b.offsetParent !== null && b.textContent === label)?.click(), label);
  const clickBack = (page) => page.evaluate(() => [...document.querySelectorAll(".trail-back")].find((b) => b.offsetParent !== null)?.click());

  let doc = "1316"; // Alma 32 in the test library; the iPad run reads it from the address
  // ---- iPad ----
  {
    const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 })).newPage();
    await unlock(page);
    await box(page, "Alma 32:21");
    await page.waitForTimeout(600);
    await page.press("#q", "Enter");
    await page.waitForSelector("#reader .doc #p21.is-target", { timeout: 30000 });
    await page.waitForTimeout(500);
    let w = await look(page);
    if (w.sw) errors.push(`ipad: a switch before the deck was opened: ${w.sw}`);
    // select verse 21 and put it on the deck
    await page.click("#reader .doc #p21");
    await page.click("#reader .select-bar .add-deck");
    await page.waitForTimeout(300);
    // select verse 22 too, to see the selection outlive the board
    await page.click("#reader .doc #p22");
    const scrolled = (await look(page)).scroll;
    await page.click("#deckBtn");
    await page.waitForTimeout(700);
    w = await look(page);
    if (!w.board) errors.push("ipad deck: the board is not showing");
    if (w.reader) errors.push("ipad deck: the page is still showing beside the board");
    if (w.sw) errors.push(`ipad deck: a switch with no page in the Deck's own place: ${w.sw}`);
    if (w.cards !== 1) errors.push(`ipad deck: ${w.cards} cards on the board`);
    if (w.fab) errors.push("ipad deck: Think it through shows over the board");
    if (w.hash !== "#deck") errors.push(`ipad deck: address ${w.hash}`);
    await page.screenshot({ path: SHOTS + "pane-switch-1-board.png" });
    // the page is where it was read (Search, from the typed reference): its tab brings it back
    await page.click("#searchTab");
    await page.waitForTimeout(700);
    const pageHash = (await look(page)).hash;
    await clickSwitch(page, "Deck");
    await page.waitForTimeout(400);
    w = await look(page);
    if (!w.board || w.cards !== 1 || w.sw !== "Page|Deck*" || w.hash !== pageHash) errors.push(`ipad switch to Deck: ${JSON.stringify(w)}`);
    await clickSwitch(page, "Page");
    await page.waitForTimeout(400);
    w = await look(page);
    if (!w.reader || w.board) errors.push("ipad page: the page is not back in the right pane");
    if (!/Alma 32/.test(w.title)) errors.push(`ipad page: reader shows ${w.title}`);
    if (w.target !== "p21") errors.push(`ipad page: verse 21 is no longer the target (${w.target})`);
    if (!w.sel.includes("p22")) errors.push("ipad page: the selection did not survive the board");
    if (Math.abs(w.scroll - scrolled) > 2) errors.push(`ipad page: scroll moved from ${scrolled} to ${w.scroll}`);
    if (w.sw !== "Page*|Deck") errors.push(`ipad page: switch reads ${w.sw}`);
    if (!w.fab) errors.push("ipad page: Think it through is missing over the page");
    if (w.hash !== pageHash || !/doc=\d+/.test(w.hash)) errors.push(`ipad page: the switch changed the address to ${w.hash}`);
    await page.screenshot({ path: SHOTS + "pane-switch-2-page.png" });
    await clickSwitch(page, "Deck");
    await page.waitForTimeout(400);
    w = await look(page);
    if (!w.board || w.cards !== 1) errors.push(`ipad deck again: board ${w.board}, ${w.cards} cards`);
    if (w.sw !== "Page|Deck*") errors.push(`ipad deck again: switch reads ${w.sw}`);
    // the Deck tab and back again: the page is still there
    await page.click("#deckBtn"); await page.waitForTimeout(500);
    await page.click("#searchTab"); await page.waitForTimeout(700);
    w = await look(page);
    if (!/Alma 32/.test(w.title) || w.hash !== pageHash) errors.push(`ipad back from the Deck tab: ${w.title} at ${w.hash}`);
    if (/^#deck/.test(w.hash)) errors.push(`ipad back: still at ${w.hash}`);
    // a reload on the page shows the page; one on #deck shows the board with the page on offer
    doc = /doc=(\d+)/.exec(w.hash)?.[1] || doc;
    await page.goto(`${BASE}#scriptures?b.book=alma&doc=${doc}`);
    await page.reload();
    await page.waitForSelector("#reader .doc", { timeout: 30000 });
    await page.waitForTimeout(800);
    w = await look(page);
    if (!w.reader || w.board || w.sw) errors.push(`ipad reload page: reader ${w.reader}, board ${w.board}, switch ${w.sw}`);
    await page.goto(`${BASE}#deck?doc=${doc}`);
    await page.reload();
    await page.waitForSelector("#panel .board", { timeout: 30000 });
    await page.waitForTimeout(1000);
    w = await look(page);
    if (!w.board || w.reader) errors.push(`ipad reload deck: board ${w.board}, reader ${w.reader}`);
    if (w.sw !== "Page|Deck*") errors.push(`ipad reload deck: switch reads ${w.sw}`);
    await clickSwitch(page, "Page");
    await page.waitForTimeout(400);
    w = await look(page);
    if (!w.reader || !/Alma 32/.test(w.title)) errors.push(`ipad reload deck, Page: reader ${w.reader}, ${w.title}`);
    await page.screenshot({ path: SHOTS + "pane-switch-3-reload.png" });
    await page.context().close();
  }

  // ---- iPhone: no switch, the Deck tab is a list view ----
  {
    const page = await (await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 1 })).newPage();
    await unlock(page);
    // a typed reference only lists the chapter on a phone, so go to the verse by its address
    await page.goto(`${BASE}#scriptures?b.book=alma&doc=${doc}&p=p21`);
    await page.waitForSelector("#reader .doc #p21.is-target", { timeout: 30000 });
    await page.click("#reader .doc #p21");
    await page.click("#reader .select-bar .add-deck");
    await page.waitForTimeout(300);
    await page.click("#deckBtn");
    await page.waitForTimeout(700);
    const w = await page.evaluate(() => ({
      sw: [...document.querySelectorAll(".pane-switch")].length,
      listBoard: !!document.querySelector("#list .board") && document.querySelector("#list").offsetParent !== null,
      panel: !document.querySelector("#panel")?.hidden,
      reader: !document.querySelector("#reader").hidden,
    }));
    if (w.sw) errors.push("iphone: a Page | Deck switch is rendered");
    if (!w.listBoard) errors.push("iphone: the Deck tab is not a list view with the board");
    if (w.panel || w.reader) errors.push(`iphone: panel ${w.panel}, reader ${w.reader}`);
    await page.screenshot({ path: SHOTS + "pane-switch-4-phone.png" });
    await page.context().close();
  }
  return errors;
}
