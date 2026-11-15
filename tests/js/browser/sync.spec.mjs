// sync: highlights and notes travel between two devices (web/sync.js). Two browser contexts, an
// iPad and an iPhone, each with its own storage, talk to one fake GitHub (api.github.com is
// answered here: a file with a sha, a write refused when made against an older sha). A mark made
// on one appears on the other after its sync, a removal travels, two devices writing at once
// both keep their marks, a bad token is said in plain words, disconnecting and reconnecting
// neither doubles nor loses anything, and the token is in neither the backup file nor the error log.
import fs from "node:fs";
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const TOKEN = "github_pat_TESTONLY_not_a_token_0123456789";
  const OWNER = "someone", REPO = "gospel-library-sync";

  // GitHub's side: one private repository, one file
  const gh = { file: null, n: 0, puts: 0, gets: 0, beforePut: null, seenAuth: new Set() };
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "Authorization, Content-Type, Accept", "access-control-allow-methods": "GET, PUT, OPTIONS", "access-control-expose-headers": "x-ratelimit-remaining" };
  const serve = async (route) => {
    const req = route.request();
    const send = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const auth = (req.headers().authorization || "").replace(/^Bearer /, "");
    gh.seenAuth.add(auth);
    if (auth !== TOKEN) return send(401, { message: "Bad credentials" });
    const path = new URL(req.url()).pathname;
    const base = `/repos/${OWNER}/${REPO}`;
    if (!path.startsWith(base)) return send(404, { message: "Not Found" });
    const rest = path.slice(base.length);
    if (rest === "") return send(200, { private: true });
    if (rest === "/contents/marks.json.enc" && req.method() === "GET") {
      gh.gets++;
      return gh.file ? send(200, { sha: gh.file.sha, size: gh.file.text.length, encoding: "base64", content: Buffer.from(gh.file.text).toString("base64").replace(/(.{60})/g, "$1\n") }) : send(404, { message: "Not Found" });
    }
    if (rest === "/contents/marks.json.enc" && req.method() === "PUT") {
      if (gh.beforePut) { const f = gh.beforePut; gh.beforePut = null; await f(); }
      const body = JSON.parse(req.postData());
      if (gh.file && body.sha !== gh.file.sha) return send(body.sha ? 409 : 422, { message: "sha does not match" });
      gh.file = { sha: `sha${++gh.n}`, text: Buffer.from(body.content, "base64").toString("utf8") };
      gh.puts++;
      return send(200, { content: { sha: gh.file.sha } });
    }
    return send(404, { message: "Not Found" });
  };

  async function device(viewport) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
    await ctx.route("https://api.github.com/**", serve);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.waitForFunction(() => !!window.Sync, null, { timeout: 10000 });
    // Until marks.js keeps removals and tells of its changes itself (dump, merge, onChange), a
    // small stand-in over the real store does, so the spec runs against either.
    await page.evaluate(() => {
      const M = window.Marks;
      if (typeof M.dump === "function" && typeof M.merge === "function") return;
      const fns = [], dead = new Map();
      const tell = (local) => { for (const fn of fns) fn({ local }); };
      const set0 = M.set, remove0 = M.remove;
      M.set = async (a) => { const r = await set0(a); if (r) dead.delete(r.id); tell(true); return r; };
      M.remove = async (uri, pid) => { await remove0(uri, pid); const id = `${uri}#${pid}`; dead.set(id, { id, deleted: true, updated: Date.now() }); tell(true); };
      M.dump = async () => [...(await M.all()), ...dead.values()];
      M.merge = async (list) => {
        const have = new Map((await M.dump()).map((r) => [r.id, r]));
        let changed = 0;
        for (const r of list) {
          const old = have.get(r.id);
          if (old && old.updated >= r.updated) continue;
          have.set(r.id, r); changed++;
        }
        if (!changed) return { changed };
        dead.clear();
        for (const r of have.values()) if (r.deleted) dead.set(r.id, r);
        await M.replaceAll([...have.values()].filter((r) => !r.deleted));
        tell(false);
        return { changed };
      };
      M.onChange = (fn) => { fns.push(fn); };
      window.Sync.register("marks", M);
    });
    const section = async () => {
      await page.evaluate(() => window.GL.openSettings(true));
      await page.waitForSelector("#sheet #set-sync .sync-connect", { timeout: 5000 });
      await page.locator("#sheet #set-sync").scrollIntoViewIfNeeded();
    };
    const said = () => page.textContent("#sheet #set-sync .sync-said");
    const connect = async (token) => {
      await section();
      await page.fill("#sheet .sync-owner", OWNER);
      await page.fill("#sheet .sync-repo", REPO);
      await page.fill("#sheet .sync-token", token);
      await page.click("#sheet .sync-connect");
      await page.waitForFunction(() => !/Connecting|Syncing/.test(document.querySelector("#sheet .sync-said")?.textContent || "Connecting"), null, { timeout: 20000 }).catch(() => {});
      return said();
    };
    const sync = () => page.evaluate(async () => (await window.Sync.syncNow()).text);
    const live = () => page.evaluate(async () => (await window.Marks.all()).map((m) => `${m.pid}:${m.color || ""}:${m.note || ""}`).sort());
    const mark = (pid, color, note) => page.evaluate(([pid, color, note]) => window.Marks.set({ uri: "/scriptures/bofm/alma/32", pid, verse: Number(pid.slice(1)), color, note, text: "And now as I said concerning faith", citation: `Alma 32:${pid.slice(1)}` }), [pid, color, note]);
    return { ctx, page, section, said, connect, sync, live, mark };
  }

  const ipad = await device({ width: 1180, height: 820 });
  const phone = await device({ width: 393, height: 852 });
  try {
    // before anything is set up: the steps are written out, nothing has been asked of GitHub
    await ipad.section();
    const text = await ipad.page.textContent("#sheet #set-sync");
    check(/Sync between devices/.test(text) && /create a new repository named gospel-library-sync and choose Private/.test(text) && /Fine-grained tokens/.test(text) && /Only select repositories/.test(text) && /Contents to "Read and write"/.test(text) && /Paste the token here/.test(text), `the five steps are not all written out: ${text.slice(0, 300)}`);
    check(/Not connected/.test(await ipad.said()), `before setup the status says: ${await ipad.said()}`);
    check(await ipad.page.evaluate(() => document.querySelector("#sheet .sync-steps").open && document.querySelector("#sheet .sync-token").type === "password" && document.querySelector("#sheet .sync-now").hidden), "before setup: the steps should be open, the token field masked, Sync now out of sight");
    check(gh.seenAuth.size === 0, "GitHub was called before anything was set up");
    await ipad.page.screenshot({ path: `${SHOTS}sync-settings-ipad-new.png` });
    await phone.section();
    await phone.page.screenshot({ path: `${SHOTS}sync-settings-phone-new.png` });
    check(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1 && [...document.querySelectorAll("#sheet #set-sync input, #sheet #set-sync button:not([hidden])")].every((n) => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; })), "on a phone the section runs off the side");

    // a bad token: said plainly, and nothing written
    const bad = await ipad.connect("github_pat_WRONG_0000");
    check(/GitHub did not accept the token/.test(bad), `a bad token says: ${bad}`);
    check(!gh.file, "a bad token wrote a file");
    check(await ipad.page.evaluate(() => document.querySelector("#sheet .sync-said").classList.contains("bad")), "the refusal is not marked as one");

    // the iPad connects with a mark already made: the file is created, sealed
    await ipad.mark("p21", "y", "faith is not a perfect knowledge");
    const first = await ipad.connect(TOKEN);
    check(/^Synced just now, 1 highlight or note\.$/.test(first), `after Connect the iPad says: ${first}`);
    check(!!gh.file && !gh.file.text.includes("perfect knowledge") && !gh.file.text.includes(PASS) && !gh.file.text.includes(TOKEN), "the file is missing, or readable, or holds a secret");
    const f = gh.file ? JSON.parse(gh.file.text) : {};
    check(f.v === 1 && Object.keys(f).sort().join() === "data,iv,salt,v", `the file's form: ${Object.keys(f)}`);
    check(await ipad.page.evaluate(() => !document.querySelector("#sheet .sync-steps").open && document.querySelector("#sheet .sync-token").value === "" && !document.querySelector("#sheet .sync-now").hidden), "once connected: the steps fold away, the token field is empty, Sync now shows");
    await ipad.page.screenshot({ path: `${SHOTS}sync-settings-ipad.png` });

    // the phone has a mark of its own; its first connect merges both ways and overwrites nothing
    await phone.mark("p27", "g", null);
    const second = await phone.connect(TOKEN);
    check(/2 highlights and notes/.test(second), `after Connect the phone says: ${second}`);
    check((await phone.live()).join("|") === "p21:y:faith is not a perfect knowledge|p27:g:", `the phone holds: ${await phone.live()}`);
    await phone.page.locator("#sheet #set-sync .sync-said").scrollIntoViewIfNeeded();
    await phone.page.screenshot({ path: `${SHOTS}sync-settings-phone.png` });

    // a mark made on the iPad is sent on its own a few seconds later, and is on the phone after the phone's sync
    const puts = gh.puts;
    await ipad.mark("p28", "b", "a seed");
    await ipad.page.waitForTimeout(2000);
    check(gh.puts === puts, "a change was sent at once, not a few seconds after it");
    const t0 = Date.now();
    while (gh.puts === puts && Date.now() - t0 < 9000) await ipad.page.waitForTimeout(250);
    check(gh.puts === puts + 1, `a local change was not sent by itself (${gh.puts - puts} writes)`);
    await phone.sync();
    check((await phone.live()).includes("p28:b:a seed"), `the iPad's mark did not reach the phone: ${await phone.live()}`);
    check((await ipad.live()).includes("p27:g:"), "the phone's mark did not reach the iPad");

    // a removal on the phone reaches the iPad
    await phone.page.evaluate(() => window.Marks.remove("/scriptures/bofm/alma/32", "p27"));
    await phone.sync(); await ipad.sync();
    check(!(await ipad.live()).some((m) => m.startsWith("p27")), `the removal did not reach the iPad: ${await ipad.live()}`);

    // both write at once: the phone's write lands while the iPad is between its read and its write
    await ipad.mark("p29", "p", null);
    await phone.mark("p30", "y", "from the phone");
    let raced = false;
    gh.beforePut = async () => { raced = true; await phone.sync(); };
    const after = await ipad.sync();
    check(raced && /^Synced/.test(after), `the iPad, having lost the race, says: ${after}`);
    await phone.sync();
    const a = await ipad.live(), b = await phone.live();
    check(a.join("|") === b.join("|") && a.length === 4 && a.includes("p29:p:") && a.includes("p30:y:from the phone"), `after the race: iPad ${a} / phone ${b}`);

    // a sync with nothing new reads and does not write
    const quiet = gh.puts;
    await ipad.sync(); await phone.sync();
    check(gh.puts === quiet, "a sync with nothing new wrote the file");

    // coming back to the front syncs, but not more than once a minute
    const gets = gh.gets;
    await ipad.page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await ipad.page.waitForTimeout(600);
    check(gh.gets === gets, "coming to the front synced again within a minute of the last sync");

    // disconnect on the phone: the token goes, the marks stay; reconnecting doubles nothing
    await phone.section();
    await phone.page.click("#sheet .sync-off");
    check(/Disconnected/.test(await phone.said()) && (await phone.page.evaluate(() => localStorage.getItem("gospel.syncToken"))) === null, "Disconnect did not remove the token");
    check((await phone.live()).length === 4, "Disconnect took marks away");
    const back = await phone.connect(TOKEN);
    check(/4 highlights and notes/.test(back) && (await phone.live()).join("|") === a.join("|"), `after reconnecting: ${back} / ${await phone.live()}`);

    // the token: sent to GitHub and nowhere else. Not in the backup file, not in the error log.
    await ipad.page.evaluate(() => window.GL.openSettings(true));
    const [download] = await Promise.all([ipad.page.waitForEvent("download", { timeout: 10000 }), ipad.page.click("#sheet #set-backup button.primary")]);
    const backup = fs.readFileSync(await download.path(), "utf8");
    check(JSON.parse(backup).marks.length === 4, "the backup does not hold the marks");
    check(!backup.includes(TOKEN) && !backup.includes("github_pat_") && !backup.includes("syncToken") && !backup.includes(PASS), "the backup file holds the token or the passphrase");
    await ipad.page.evaluate((t) => { window.GLLog.note("sync", new Error(`refused with ${t} and github_pat_ANOTHER_ONE_123`)); }, TOKEN);
    const log = await ipad.page.evaluate(() => window.GLLog.text() + (sessionStorage.getItem("gospel.errorLog") || ""));
    check(/sync: GitHub did not accept the token/.test(log), `the refusal was not noted in the error log: ${log.slice(0, 300)}`);
    check(!log.includes(TOKEN) && !log.includes("github_pat_"), "the error log holds a token");
    check([...gh.seenAuth].every((t) => t === TOKEN || t === "github_pat_WRONG_0000"), "something other than the token was sent as the token");
  } finally { await ipad.ctx.close(); await phone.ctx.close(); }
  return errors;
}
