// delta: a small update applied on the device. delta-fixture.py builds a delta the way the nightly
// job does, from the served test library to a copy with Moroni 10's title changed, and a manifest
// that lists it. A server of our own on another port (so the storage starts empty) hands the app
// the old manifest until the library is installed and a mark and a deck card are made, then the
// new one: the banner offers one changed page, Update now applies it in place, and the version,
// the new title, the mark and the deck card are all there after a reload, with no whole-library
// download on the way. (The reader's heading comes from the page's own HTML, which the fixture
// leaves as it was, so the new title is checked through the engine.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gl-delta-"));
  let server = null, ctx = null;
  try {
    // the published library and manifest, then the delta built from them
    const oldManifest = await (await fetch(new URL("data/manifest.json", BASE))).text();
    fs.writeFileSync(path.join(tmp, "manifest-old.json"), oldManifest);
    fs.writeFileSync(path.join(tmp, "library.bin"), Buffer.from(await (await fetch(new URL("data/" + JSON.parse(oldManifest).file, BASE))).arrayBuffer()));
    const built = JSON.parse(execFileSync("python3", [path.join(here, "delta-fixture.py"), path.join(tmp, "library.bin"), path.join(tmp, "manifest-old.json"), path.join(tmp, "out"), PASS], { encoding: "utf8" }).trim().split("\n").at(-1));
    fs.rmSync(path.join(tmp, "library.bin"));

    // the app and the library from BASE; the manifest and the delta from here
    let manifest = oldManifest;
    const fetched = [];
    server = http.createServer(async (req, res) => {
      const p = new URL(req.url, "http://x").pathname;
      fetched.push(p);
      if (p === "/data/manifest.json") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(manifest); return; }
      if (p === "/data/" + built.file) { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(fs.readFileSync(path.join(tmp, "out", built.file))); return; }
      try {
        const r = await fetch(new URL(req.url.slice(1), BASE));
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") || "application/octet-stream", ...(r.headers.get("content-length") ? { "content-length": r.headers.get("content-length") } : {}) });
        if (r.body) Readable.fromWeb(r.body).pipe(res); else res.end();
      } catch (err) { res.writeHead(502); res.end(String(err)); }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const URL2 = `http://127.0.0.1:${server.address().port}/`;

    ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
    await page.goto(URL2);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.active") || "null"));
    check(before?.version === built.from, `installed ${before?.version}, expected ${built.from}`);

    // a mark and a deck card on the page that will change, and the page open
    const docId = await page.evaluate(async (uri) => {
      const d = await GL.api("doc", { uri });
      const v4 = "And when ye shall receive these things, I would exhort you that ye would ask God, the Eternal Father, in the name of Christ, if these things are not true.";
      await window.Marks.set({ uri, pid: "p4", doc_id: d.id, verse: 4, color: "g", note: "ask with a sincere heart", text: v4, citation: "Moroni 10:4", title: d.title });
      await window.Deck.ready;
      window.Deck.addPassage({ doc_id: d.id, pid: "p4", kind: "verse", verse: 4, text: v4, citation: "Moroni 10:4" });
      await window.Deck.flush();
      GL.openDoc(d.id, "p4");
      return d.id;
    }, built.uri);
    await page.waitForSelector("#reader .doc #p4", { timeout: 15000 });

    // the server moves on; the next launch offers the small update
    manifest = fs.readFileSync(path.join(tmp, "out", "manifest.json"), "utf8");
    const mark = fetched.length;
    await page.reload();
    const banner = await page.waitForSelector(".banner", { timeout: 20000 }).catch(() => null);
    const said = banner ? await banner.textContent() : "";
    check(/1 page changed/.test(said), `the banner should offer one changed page: ${said.slice(0, 120)}`);
    await page.screenshot({ path: SHOTS + "delta-banner.png" });
    if (banner) {
      await page.click(".banner button:has-text('Update now')");
      await page.waitForSelector(".banner", { state: "detached", timeout: 30000 }).catch(() => errors.push(`the banner stayed: ${(said || "").slice(0, 80)}`));
    }
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.active") || "null"));
    check(after?.version === built.to, `version after the update ${after?.version}, expected ${built.to}`);
    check(after?.slot === before?.slot, `the delta applies in place (slot ${before?.slot} became ${after?.slot})`);
    check(fetched.slice(mark).includes("/data/" + built.file), "the delta should have been downloaded");
    check(!fetched.slice(mark).some((p) => p.endsWith("/library.bin")), "the whole library should not have been downloaded");

    // after a fresh start: the new title, the mark and the deck card
    await page.reload();
    await page.waitForFunction(() => window.GL?.ready, null, { timeout: 30000 });
    const state = await page.evaluate(async ([uri, id]) => {
      await window.Deck.ready;
      const d = await GL.api("doc", { uri });
      return { title: d.title, version: JSON.parse(localStorage.getItem("gospel.active")).version, mark: await window.Marks.get(uri, "p4"), deck: window.Deck.state.items.filter((i) => i.doc_id === id && i.pid === "p4").length };
    }, [built.uri, docId]);
    check(state.title === built.title, `the page's title after the update: ${state.title}`);
    check(state.version === built.to, `the version after a reload: ${state.version}`);
    check(state.mark?.color === "g" && state.mark?.note === "ask with a sincere heart", `the mark should survive: ${JSON.stringify(state.mark)}`);
    check(state.deck === 1, `the deck card should survive (found ${state.deck})`);
    await page.evaluate((id) => GL.openDoc(id, "p4"), docId);
    await page.waitForSelector("#reader .doc #p4", { timeout: 15000 });
    await page.waitForTimeout(400);
    check(!!(await page.$("#reader .doc #p4.hl-g")), "the reader should show the mark on verse 4");
    await page.screenshot({ path: SHOTS + "delta-after.png" });
  } finally {
    if (ctx) await ctx.close();
    if (server) await new Promise((r) => server.close(r));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return errors;
}
