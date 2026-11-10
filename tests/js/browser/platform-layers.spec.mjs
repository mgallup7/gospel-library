// platform-layers: motion and what lies on what. A sheet leaves by the slide it came by (not
// under reduced motion); the phone's tab bar is opaque with a hairline above it; a toast sits
// above the tab bar, the selection bar and Ask's box, never on them; Escape pressed the moment
// Present starts does not leave the screen full with the stage hidden; a wake lock that arrives
// after the stage has closed is let go. Also the small things: the search box's Clear has the
// contrast to be read, and the tabs show a focus ring.
export default async function run(browser, { BASE, PASS, SHOTS }) {
  const errors = [];
  for (const [name, viewport] of [["iphone", { width: 393, height: 852 }], ["ipad", { width: 1180, height: 820 }]]) {
    const check = (c, m) => { if (!c) errors.push(`${name}: ${m}`); };
    const phone = viewport.width < 760;
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => {
      try { localStorage.setItem("gospel.apiKey", JSON.stringify("sk-ant-test-not-a-key")); } catch (_) {}
      // a wake lock that takes 300ms to arrive, and counts what is asked for and let go
      window.__lock = { asked: 0, released: 0 };
      try { Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => { window.__lock.asked++; return new Promise((done) => setTimeout(() => done({ release() { window.__lock.released++; return Promise.resolve(); } }), 300)); } } }); } catch (_) {}
    });
    await ctx.route("https://api.anthropic.com/**", (r) => r.abort());
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: pageerror: ${e}`));
    await page.goto(BASE);
    await page.fill("div.setup input", PASS);
    await page.press("div.setup input", "Enter");
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.evaluate(() => window.Deck.reset());
    const wait = (ms = 400) => page.waitForTimeout(ms);
    const openDoc = async (uri, pid) => { await page.evaluate(async ([u, p]) => { const d = await window.GL.api("doc", { uri: u }); await window.GL.openDoc(d.id, p); }, [uri, pid]); await page.waitForSelector(`#reader .doc #${pid}`, { timeout: 15000 }); await wait(); };

    // ---- the tab bar: opaque, a hairline above it
    if (phone) {
      const bar = await page.evaluate(() => { const c = getComputedStyle(document.querySelector("#tabs")); return { bg: c.backgroundColor, blur: c.backdropFilter || c.webkitBackdropFilter || "none", line: c.borderTopWidth, style: c.borderTopStyle }; });
      check(/^rgb\(/.test(bar.bg) && bar.blur === "none" && bar.line === "1px" && bar.style === "solid", `the tab bar should be opaque with a hairline on top: ${JSON.stringify(bar)}`);
    }

    // ---- small things: Clear in the search box and the tabs' words can be read (4.5:1 in both
    // schemes), and a tab reached by the keyboard shows a ring that fits inside the bar or rail
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.fill("#q", "fa"); await wait(250);
      const c = await page.evaluate(() => {
        const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
        const css = (s) => getComputedStyle(document.querySelector(s));
        const typed = ratio(css(".search .clear").color, css("#q").backgroundColor);
        document.querySelector("#q").blur();
        return { typed, idle: ratio(css(".search .clear").color, css("#q").backgroundColor), shown: css(".search .clear").display !== "none", tab: ratio(css("#tabs .tab:not(.on)").color, css("#tabs").backgroundColor), tabOn: ratio(css("#tabs .tab.on").color, css("#tabs").backgroundColor) };
      });
      check(c.shown && c.typed >= 4.5 && c.idle >= 4.5, `${scheme}: Clear in the search box should reach 4.5:1: ${JSON.stringify(c)}`);
      check(c.tab >= 4.5 && c.tabOn >= 4.5, `${scheme}: the tabs' words should reach 4.5:1: ${JSON.stringify(c)}`);
      await page.fill("#q", ""); await wait(250);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.focus("#homeBtn"); await page.keyboard.press("Tab"); await wait(150);
    const ring = await page.evaluate(() => { const a = document.activeElement, c = getComputedStyle(a), r = a.getBoundingClientRect(), bar = document.querySelector("#tabs").getBoundingClientRect(); const off = parseFloat(c.outlineOffset), w = parseFloat(c.outlineWidth); return { on: a.id, style: c.outlineStyle, w, off, inside: r.left - off - w >= bar.left && r.right + off + w <= bar.right && r.top - off - w >= bar.top && r.bottom + off + w <= bar.bottom }; });
    check(ring.on === "searchTab" && ring.style === "solid" && ring.w >= 2 && ring.inside, `a tab reached by Tab should show a ring inside the ${phone ? "bar" : "rail"}: ${JSON.stringify(ring)}`);
    await page.screenshot({ path: `${SHOTS}platform-${name}-tab-focus.png` });
    await page.evaluate(() => document.activeElement?.blur());

    // ---- a toast sits above whatever holds the bottom of the screen
    const over = (sel) => page.evaluate((s) => {
      const t = document.querySelector("#toast").getBoundingClientRect();
      const n = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().height > 0);
      if (!n) return { missing: s };
      const r = n.getBoundingClientRect();
      return { toastBottom: Math.round(t.bottom), top: Math.round(r.top), clear: t.bottom <= r.top + 0.5, shown: document.querySelector("#toast").classList.contains("show"), inView: t.top >= 0 };
    }, sel);
    const toast = async (words = "Copied, with the citation.") => { await page.evaluate((w) => window.GL.toast(w, { action: "Undo", onAction() {} }), words); await wait(350); };
    if (phone) { await toast(); const o = await over("#tabs"); check(o.clear && o.shown && o.inView, `the Library: a toast should sit above the tab bar: ${JSON.stringify(o)}`); }
    await openDoc("/scriptures/bofm/alma/32", "p21");
    await page.click("#reader .doc #p21"); await page.click("#reader .doc #p22"); await wait(200);
    await toast();
    let o = await over("#reader .select-bar");
    check(o.clear && o.shown && o.inView, `a toast should sit above the selection bar: ${JSON.stringify(o)}`);
    if (phone) { o = await over("#tabs"); check(o.clear, `and above the tab bar: ${JSON.stringify(o)}`); await page.screenshot({ path: `${SHOTS}platform-${name}-toast-selection.png` }); }
    await page.keyboard.press("Escape"); await wait(200);
    await page.click("#askBtn"); await wait();
    await toast("Your note is not saved yet: Save it, or Cancel to let it go.");
    o = await over("#list .ask-dock");
    check(o.clear && o.shown && o.inView, `a toast should sit above Ask's box: ${JSON.stringify(o)}`);
    await page.screenshot({ path: `${SHOTS}platform-${name}-toast-ask.png` });
    await page.evaluate(() => document.querySelector("#toast").classList.remove("show"));

    // ---- a sheet leaves by the slide it came by; not under reduced motion
    await page.evaluate(() => window.GL.openSettings()); await wait(500);
    await page.keyboard.press("Escape");
    const leaving = await page.evaluate(() => { const g = document.querySelector(".sheet.leaving"); const c = g && getComputedStyle(g); return { real: document.querySelector("#sheet").hidden, ghost: !!g, anim: c?.animationName, dur: c?.animationDuration, inert: g?.inert, touch: c?.pointerEvents, ids: g ? g.querySelectorAll("[id]").length + (g.id ? 1 : 0) : null }; });
    check(leaving.real && leaving.ghost && leaving.anim === "sheet-down" && leaving.dur === "0.2s" && leaving.inert && leaving.touch === "none" && leaving.ids === 0, `a closed sheet should slide away as an untouchable copy over 200ms: ${JSON.stringify(leaving)}`);
    await wait(500);
    check(await page.evaluate(() => !document.querySelector(".sheet.leaving") && document.querySelectorAll(".sheet").length === 1), "the copy should be gone once it has slid away");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => window.GL.openSettings()); await wait(300);
    await page.keyboard.press("Escape");
    check(await page.evaluate(() => document.querySelector("#sheet").hidden && !document.querySelector(".sheet.leaving")), "under reduced motion a sheet should just go");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // ---- Escape the moment Present starts; a wake lock that arrives late
    await page.click("#homeBtn"); await wait();
    await openDoc("/scriptures/bofm/alma/32", "p21");
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("p");
    await page.keyboard.press("Escape");
    await wait(900);
    const after = await page.evaluate(() => ({ full: !!document.fullscreenElement, hidden: document.querySelector("#stage").hidden, presenting: document.body.classList.contains("presenting"), lock: { ...window.__lock } }));
    check(!after.full && after.hidden && !after.presenting, `Escape at once should leave the stage closed and the screen not full: ${JSON.stringify(after)}`);
    check(after.lock.asked === 1 && after.lock.released === 1, `a wake lock that arrives after the stage closed should be let go: ${JSON.stringify(after.lock)}`);
    // and a stage left up long enough keeps its lock until it closes
    await page.keyboard.press("p"); await wait(700);
    const held = await page.evaluate(() => ({ ...window.__lock, up: !document.querySelector("#stage").hidden }));
    check(held.up && held.asked === 2 && held.released === 1, `a stage that stays up should keep its wake lock: ${JSON.stringify(held)}`);
    await page.keyboard.press("Escape"); await wait(700);
    const let_go = await page.evaluate(() => ({ ...window.__lock, full: !!document.fullscreenElement }));
    check(let_go.released === 2 && !let_go.full, `closing the stage should let the lock go: ${JSON.stringify(let_go)}`);
    await ctx.close();
  }
  return errors;
}
