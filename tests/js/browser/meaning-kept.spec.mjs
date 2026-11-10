// meaning-kept: the meaning index is built from the vectors table once, written to a file beside
// the library, and read whole on every later launch. The file must give exactly the index the
// table gives: ten questions are ranked with a freshly built index, with the kept one after a
// reload, and with one rebuilt after the file was cut short, and all three must agree, ids and
// scores. A file left by an older library is removed when the new one is written. The typing
// vocabulary is kept the same way, and must correct the same misspellings from its file.
export default async function run(browser, { BASE, PASS }) {
  const errors = [];
  const check = (c, m) => { if (!c) errors.push(m); };
  const QUESTIONS = ["how can I feel forgiven", "comfort for someone who is grieving", "why do bad things happen to good people", "faith without works is dead",
    "the gathering of Israel in the last days", "how should I pray", "charity never faileth", "put on the whole armor of God", "the shepherd leaves the ninety and nine", "keeping the sabbath day holy"];
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e}`));
  const until = async (fn, what, ms = 60000) => {
    const t = Date.now();
    for (;;) {
      if (await page.evaluate(fn)) return true;
      if (Date.now() - t > ms) { errors.push(`timed out waiting for ${what}`); return false; }
      await page.waitForTimeout(150);
    }
  };
  // the index in, and its file written (or read)
  const ready = async () => {
    await page.waitForSelector("#homeBody .shelf-grid", { timeout: 120000 });
    await page.evaluate(() => GL.api("loadSemantic", { base: new URL("./", location.href).href }));
    await until(async () => { const s = await GL.api("semanticStatus", {}); return s.loaded && s.ready && s.index && s.index.saved; }, "the meaning index and its file");
    await until(async () => { const k = await GL.api("keptStatus", {}); return k.vocabulary && k.vocabulary.saved; }, "the vocabulary and its file");
    return { ...(await page.evaluate(() => GL.api("semanticStatus", {}))), vocabulary: (await page.evaluate(() => GL.api("keptStatus", {}))).vocabulary };
  };
  // what the vocabulary makes of some misspellings (and of words that are right)
  const typos = () => page.evaluate(async () => {
    const out = {};
    for (const q of ["spirt", "repentence", "baptisim", "charaty", "rightousness", "tabernacel", "faith", "nephi", "zarahemla", "forgivness of sins"]) out[q] = (await GL.api("search", { q, limit: 5 })).smart?.corrected || null;
    return JSON.stringify(out);
  });
  const files = () => page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(), out = {};
    for await (const [name, h] of root.entries()) if (h.kind === "file" && name.startsWith("gl-kept-meaning-")) out[name] = (await h.getFile()).size;
    return out;
  });
  const rank = () => page.evaluate(async (qs) => {
    const out = {};
    for (const q of qs) {
      const near = await GL.api("semanticNearest", { text: q, k: 60 });
      const s = await GL.api("search", { q, limit: 40 });
      out[q] = { near: near.map((t) => [t.id, t.score]), hits: s.hits.map((h) => h.paragraph_id), semantic: !!(s.smart && s.smart.semantic) };
    }
    return out;
  }, QUESTIONS);
  const scoped = () => page.evaluate(async () => (await GL.api("search", { q: "scope:nt how should I pray", limit: 40 })).hits.map((h) => h.paragraph_id));

  await page.goto(BASE);
  await page.fill("div.setup input", PASS);
  await page.press("div.setup input", "Enter");
  const first = await ready();
  check(first.index.from === "library", `the first launch should build the index from the library (${JSON.stringify(first.index)})`);
  const version = await page.evaluate(() => JSON.parse(localStorage.getItem("gospel.active")).version);
  const name = `gl-kept-meaning-${version}.bin`;
  const made = await files();
  check(Object.keys(made).length === 1 && made[name] > first.count * 48, `one file named for the library: ${JSON.stringify(made)}`);
  const fresh = await rank(), freshScoped = await scoped(), freshTypos = await typos();
  check(first.vocabulary.from === "library" && first.vocabulary.terms > 5000, `the first launch should walk the term index (${JSON.stringify(first.vocabulary)})`);
  check(/"to":"spirit"/.test(freshTypos) && /"to":"baptism"/.test(freshTypos), `misspellings should be corrected: ${freshTypos.slice(0, 200)}`);
  check(QUESTIONS.every((q) => fresh[q].near.length === 60 && fresh[q].hits.length > 0 && fresh[q].semantic), "every question should be ranked by meaning");
  check(new Set(QUESTIONS.map((q) => fresh[q].near[0][0])).size > 3, "different questions should have different nearest passages");

  // the next launch reads the file, and ranks exactly as before
  await page.reload();
  const second = await ready();
  check(second.index.from === "file", `the second launch should read the kept index (${JSON.stringify(second.index)})`);
  check(second.count === first.count, "the same number of vectors");
  const kept = await rank();
  for (const q of QUESTIONS) {
    check(JSON.stringify(kept[q].near) === JSON.stringify(fresh[q].near), `${q}: the kept index ranks differently from the fresh one`);
    check(JSON.stringify(kept[q].hits) === JSON.stringify(fresh[q].hits), `${q}: the search differs with the kept index`);
  }
  check(JSON.stringify(await scoped()) === JSON.stringify(freshScoped), "a search within one shelf should be the same with the kept index");
  check(second.vocabulary.from === "file" && second.vocabulary.terms === first.vocabulary.terms, `the second launch should read the kept vocabulary (${JSON.stringify(second.vocabulary)})`);
  check(await typos() === freshTypos, "the kept vocabulary should correct exactly as the fresh one did");
  console.log(`meaning-kept: index from the library ${first.index.ms} ms, from the file ${second.index.ms} ms, ${made[name]} bytes; vocabulary ${first.vocabulary.ms} ms, from the file ${second.vocabulary.ms} ms, ${first.vocabulary.terms} terms`);

  // a file cut short, and one left by an older library: the index is rebuilt and written again, the old one goes
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle(name)).createWritable({ keepExistingData: true });
    await w.truncate((await (await root.getFileHandle(name)).getFile()).size - 1);
    await w.close();
    for (const stale of ["gl-kept-meaning-0000000000000000.bin", "gl-kept-vocab-0000000000000000.bin"]) {
      const old = await (await root.getFileHandle(stale, { create: true })).createWritable();
      await old.write(new Uint8Array(64));
      await old.close();
    }
    // and this library's vocabulary with a line missing from its end
    const vname = name.replace("meaning", "vocab");
    const size = (await (await root.getFileHandle(vname)).getFile()).size;
    const v = await (await root.getFileHandle(vname)).createWritable({ keepExistingData: true });
    await v.truncate(size - 9);
    await v.close();
  }, name);
  await page.reload();
  const third = await ready();
  check(third.index.from === "library", `a short file should not be used (${JSON.stringify(third.index)})`);
  const again = await files();
  check(Object.keys(again).length === 1 && again[name] === made[name], `the file written again, the old one gone: ${JSON.stringify(again)}`);
  check(third.vocabulary.from === "library" && third.vocabulary.terms === first.vocabulary.terms, `a short vocabulary file should not be used (${JSON.stringify(third.vocabulary)})`);
  const vocabFiles = await page.evaluate(async () => { const root = await navigator.storage.getDirectory(), out = []; for await (const n of root.keys()) if (n.startsWith("gl-kept-vocab-")) out.push(n); return out.join(); });
  check(vocabFiles === name.replace("meaning", "vocab"), `one vocabulary file, this library's: ${vocabFiles}`);
  check(await typos() === freshTypos, "the rebuilt vocabulary should correct the same");
  const rebuilt = await rank();
  for (const q of QUESTIONS) check(JSON.stringify(rebuilt[q].near) === JSON.stringify(fresh[q].near), `${q}: the rebuilt index ranks differently`);

  // a file of the right length made for another library is not this library's index
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const bytes = new Uint8Array(await (await (await root.getFileHandle(name)).getFile()).arrayBuffer());
    const at = new TextDecoder().decode(bytes.subarray(16, 200)).indexOf('"key":"') + 16 + 7;
    bytes[at] = bytes[at] === 48 ? 49 : 48; // one character of the key
    const w = await (await root.getFileHandle(name)).createWritable();
    await w.write(bytes);
    await w.close();
  }, name);
  await page.reload();
  const fourth = await ready();
  check(fourth.index.from === "library", `a file with another key should not be used (${JSON.stringify(fourth.index)})`);
  await page.reload();
  const fifth = await ready();
  check(fifth.index.from === "file", "and the file written after it should be read again");
  await ctx.close();
  return errors;
}
