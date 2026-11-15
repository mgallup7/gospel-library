// marks-sync: the marks store's contract for the sync between devices, with the real store.
// Two browser contexts are two devices (each has its own IndexedDB); they trade Marks.dump()
// for Marks.merge() and must end up holding the same records after an add, an edit, a recolor,
// a removal and a re-add, whichever goes first. Removed marks never show in forDoc, all, count,
// get or the export; onChange and the marks:change event say which changes were made here.
export default async function run(browser, { BASE }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const open = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
    await page.goto(BASE);
    await page.waitForFunction(() => !!window.Marks && !!window.Marks.merge, null, { timeout: 30000 });
    // every change this device is told of, by both routes
    await page.evaluate(() => { window.__heard = []; window.__events = []; window.Marks.onChange((c) => window.__heard.push(c.local)); window.addEventListener("marks:change", (e) => window.__events.push(e.detail.local)); });
    return { ctx, page };
  };
  const a = await open("ipad"), b = await open("iphone");
  const U = "/scriptures/bofm/alma/32";
  const dump = (d) => d.page.evaluate(() => window.Marks.dump());
  const merge = (d, recs) => d.page.evaluate((r) => window.Marks.merge(r), recs);
  // the same records, whatever order they or their fields were written in
  const sorted = (list) => JSON.stringify([...list].sort((x, y) => (x.id < y.id ? -1 : 1)).map((r) => Object.keys(r).sort().map((k) => [k, r[k]])));
  // each takes the other's; first says who sends first
  const trade = async (first, second) => { await merge(second, await dump(first)); await merge(first, await dump(second)); };
  const same = async (what) => { const [x, y] = [await dump(a), await dump(b)]; check(sorted(x) === sorted(y), `${what}: the two devices differ\n      ${sorted(x)}\n      ${sorted(y)}`); return x; };
  try {
    // add: a verse on one, a phrase and a word on the other
    await a.page.evaluate((U) => window.Marks.set({ uri: U, pid: "p21", verse: 21, color: "y", text: "And now as I said concerning faith", citation: "Alma 32:21", title: "Alma 32" }), U);
    await b.page.evaluate((U) => window.Marks.save({ kind: "phrase", uri: U, pid: "p21", start: 3, end: 5, color: "g", text: "I said concerning", citation: "Alma 32:21" }), U);
    await b.page.evaluate(() => window.Marks.save({ kind: "word", id: "orig:rev.3.16.4:gr", uri: "/scriptures/nt/rev/3", pid: "p16", verse: 16, color: "b", text: "χλιαρός lukewarm", citation: "Revelation 3:16", strongs: "G5513" }));
    await trade(a, b);
    let recs = await same("after the adds");
    check(recs.length === 3 && recs.every((r) => typeof r.id === "string" && Number.isFinite(r.updated)), `three records, each with id and updated: ${JSON.stringify(recs)}`);
    // the readers: forDoc keeps to verse and paragraph marks; the new kinds have their own
    const read = await a.page.evaluate(async (U) => ({ doc: (await window.Marks.forDoc(U)).map((r) => r.kind), phrases: (await window.Marks.phrases(U)).map((r) => r.id), words: (await window.Marks.words("/scriptures/nt/rev/3")).map((r) => r.id), count: await window.Marks.count() }), U);
    check(JSON.stringify(read) === JSON.stringify({ doc: ["verse"], phrases: [`${U}#p21~3-5`], words: ["orig:rev.3.16.4:gr"], count: 3 }), `the readers: ${JSON.stringify(read)}`);
    // edit on one, recolor on the other
    await a.page.evaluate((U) => window.Marks.set({ uri: U, pid: "p21", note: "not a perfect knowledge" }), U);
    await b.page.evaluate((U) => window.Marks.save({ kind: "phrase", uri: U, pid: "p21", start: 3, end: 5, color: "p", text: "I said concerning", citation: "Alma 32:21" }), U);
    await trade(b, a);
    recs = await same("after an edit and a recolor");
    check(recs.find((r) => r.kind === "verse")?.note === "not a perfect knowledge" && recs.find((r) => r.kind === "verse")?.color === "y", "the note reached both, the color kept");
    check(recs.find((r) => r.kind === "phrase")?.color === "p", "the recolor reached both");
    // remove on one: a tombstone, which the other takes; no reader returns it
    await b.page.evaluate(() => window.Marks.removeId("orig:rev.3.16.4:gr"));
    await a.page.evaluate((U) => window.Marks.remove(U, "p21"), U);
    await trade(a, b);
    recs = await same("after the removals");
    check(recs.filter((r) => r.deleted).length === 2 && recs.filter((r) => r.deleted).every((r) => Object.keys(r).sort().join() === "deleted,id,updated"), `two tombstones of id, deleted, updated: ${JSON.stringify(recs.filter((r) => r.deleted))}`);
    for (const d of [a, b]) {
      const seen = await d.page.evaluate(async (U) => ({ doc: (await window.Marks.forDoc(U)).length, all: (await window.Marks.all()).map((r) => r.kind), count: await window.Marks.count(), get: await window.Marks.get(U, "p21"), getId: await window.Marks.getId("orig:rev.3.16.4:gr"), words: (await window.Marks.words("/scriptures/nt/rev/3")).length, file: JSON.parse(await window.Marks.exportJson()).marks.map((r) => r.kind) }), U);
      check(JSON.stringify(seen) === JSON.stringify({ doc: 0, all: ["phrase"], count: 1, get: null, getId: null, words: 0, file: ["phrase"] }), `removed marks are not read: ${JSON.stringify(seen)}`);
    }
    // re-add, on the device that did not remove it
    await a.page.evaluate(() => window.Marks.save({ kind: "word", id: "orig:rev.3.16.4:gr", uri: "/scriptures/nt/rev/3", pid: "p16", verse: 16, color: "y", text: "χλιαρός lukewarm", citation: "Revelation 3:16", strongs: "G5513" }));
    await b.page.evaluate((U) => window.Marks.set({ uri: U, pid: "p21", verse: 21, color: "b", text: "And now as I said concerning faith", citation: "Alma 32:21" }), U);
    await trade(b, a);
    recs = await same("after the re-adds");
    check(recs.filter((r) => !r.deleted).length === 3 && recs.find((r) => r.kind === "word")?.color === "y" && recs.find((r) => r.kind === "verse")?.color === "b", `the marks are back on both: ${JSON.stringify(recs.map((r) => [r.id, r.color, !!r.deleted]))}`);
    // nothing left to trade
    const again = [await merge(a, await dump(b)), await merge(b, await dump(a))];
    check(again[0].changed === 0 && again[1].changed === 0, `a second trade changes nothing: ${JSON.stringify(again)}`);
    // what comes from another device is checked like a file: junk and markup are dropped
    const junk = await merge(a, [null, 5, { id: "x" }, { uri: U, pid: "p9", color: "red" }, { id: "orig:rev.3.16.4:gr\"><img>", kind: "word", color: "y", updated: 9e15 }, { uri: U, pid: "p30", color: "g", extra: "<script>", updated: 5 }]);
    const got = await a.page.evaluate((U) => window.Marks.get(U, "p30"), U);
    check(junk.changed === 1 && got && got.color === "g" && !("extra" in got), `merge sanitizes: ${JSON.stringify(junk)} ${JSON.stringify(got)}`);
    // an old tombstone is dropped when the store opens
    await a.page.evaluate(async () => { await window.Marks.merge([{ id: "/x#old", deleted: true, updated: Date.now() - 170 * 864e5 }]); });
    const kept = (await dump(a)).some((r) => r.id === "/x#old");
    check(kept, "a tombstone 170 days old is still kept");
    await a.page.evaluate(() => new Promise((done, fail) => { // age it past 180 days behind the store's back
      const r = indexedDB.open("gospel-marks");
      r.onsuccess = () => { const t = r.result.transaction("marks", "readwrite"); t.objectStore("marks").put({ id: "/x#old", deleted: true, updated: Date.now() - 181 * 864e5 }); t.oncomplete = () => { r.result.close(); done(); }; t.onerror = fail; };
      r.onerror = fail;
    }));
    await a.page.reload();
    await a.page.waitForFunction(() => !!window.Marks && !!window.Marks.merge, null, { timeout: 30000 });
    await a.page.waitForTimeout(500);
    check(!(await dump(a)).some((r) => r.id === "/x#old"), "a tombstone past 180 days is dropped at open");
    // b heard its own writes as local and what came in as not; the event says the same
    const heard = await b.page.evaluate(() => ({ heard: window.__heard, events: window.__events }));
    check(JSON.stringify(heard.heard) === JSON.stringify(heard.events), `onChange and marks:change agree: ${JSON.stringify(heard)}`);
    check(heard.heard.filter((l) => l === true).length === 5 && heard.heard.filter((l) => l === false).length >= 3, `five local changes and the merges that changed something: ${JSON.stringify(heard.heard)}`);
  } catch (e) { errors.push(`aborted: ${e.message.split("\n")[0]}`); }
  await a.ctx.close(); await b.ctx.close();
  return errors;
}
