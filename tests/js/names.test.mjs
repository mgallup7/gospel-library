// web/lib/names.js: the names passages go by, and the chapters that repeat another.
import test from "node:test";
import assert from "node:assert/strict";
import { passageNamed, allNames, nameKey, parallelsOf, allParallels } from "../../web/lib/names.js";
import { parseReference, book } from "../../web/lib/scriptures.js";

test("every name points at a reference the library can open", () => {
  const seen = new Map();
  for (const { name, ref, also } of allNames()) {
    const r = parseReference(ref);
    assert.ok(r && r.uri, `${name}: ${ref} is not a reference`);
    if (/:/.test(ref)) assert.ok(r.pid, `${name}: ${ref} lost its verse`);
    for (const k of [name, ...also]) {
      const key = nameKey(k);
      assert.ok(key.length >= 5, `${k}: too short a name to be safe`);
      assert.ok(!seen.has(key) || seen.get(key) === name, `${k} is listed under both ${seen.get(key)} and ${name}`);
      seen.set(key, name);
      assert.equal(passageNamed(k)?.name, name, k);
    }
  }
  assert.ok(allNames().length >= 60);
});

test("a name is found however it is typed, and only as a whole", () => {
  assert.equal(passageNamed("moroni's promise").ref, "Moroni 10:3-5");
  assert.equal(passageNamed("Moronis Promise?").ref, "Moroni 10:3-5");
  assert.equal(passageNamed("where is the lord’s prayer").ref, "Matthew 6:9-13");
  assert.equal(passageNamed("the beatitudes").ref, "Matthew 5:3-12");
  assert.equal(passageNamed("lehi's dream in the book of mormon").ref, "1 Nephi 8");
  assert.equal(passageNamed("stripling warriors").ref, "Alma 56");
  assert.equal(passageNamed("the isaiah chapters").ref, "2 Nephi 12");
  assert.equal(passageNamed("great are the words of isaiah"), null);
  assert.equal(passageNamed("promise"), null);
  for (const plain of ["faith", "charity", "resurrection", "creation", "the fall"]) assert.equal(passageNamed(plain), null, plain);
  assert.equal(passageNamed("the faith chapter").ref, "Hebrews 11");
  assert.equal(passageNamed("the promise of the lord to moroni's people"), null);
});

test("chapters that repeat another know their twin, both ways", () => {
  assert.deepEqual(parallelsOf("2-nephi", 12), [{ slug: "isaiah", chapter: 2, how: "quotes" }]);
  assert.deepEqual(parallelsOf("2-nephi", 24), [{ slug: "isaiah", chapter: 14, how: "quotes" }]);
  assert.deepEqual(parallelsOf("2-nephi", 25), []);
  assert.deepEqual(parallelsOf("isaiah", 53), [{ slug: "mosiah", chapter: 14, how: "is quoted in" }]);
  assert.deepEqual(parallelsOf("3-nephi", 13), [{ slug: "matthew", chapter: 6, how: "parallels" }]);
  assert.deepEqual(parallelsOf("malachi", 4), [{ slug: "3-nephi", chapter: 25, how: "is quoted in" }]);
  assert.deepEqual(parallelsOf("isaiah", 48).map((t) => `${t.slug} ${t.chapter}`), ["1-nephi 20"]);
  // every chapter named exists in its book
  for (const { a, a0, b, b0, n } of allParallels()) for (let i = 0; i < n; i++) {
    assert.ok(book(a)?.chapters.includes(a0 + i), `${a} ${a0 + i}`);
    assert.ok(book(b)?.chapters.includes(b0 + i), `${b} ${b0 + i}`);
  }
});
