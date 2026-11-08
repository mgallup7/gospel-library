// The browser's parsers must read a reference or a query exactly as the Python ones do:
// tests/fixtures/parsers.json holds what gospel_library.scriptures.parse_reference and
// gospel_library.search.compile_query said for a set of inputs (regenerate with
// `python -m pytest` after changing either side, see tests/test_library.py).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as S from "../../web/lib/scriptures.js";
import { compileQuery } from "../../web/lib/query.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(fs.readFileSync(path.join(here, "..", "fixtures", "parsers.json"), "utf8"));

test("references parse the way Python parses them", () => {
  for (const [input, want] of Object.entries(fx.references)) {
    const got = S.parseReference(input);
    if (want === null) { assert.equal(got, null, `${input} should not be a reference`); continue; }
    assert.ok(got, `${input} should be a reference`);
    assert.equal(got.uri, want.uri, `${input}: uri`);
    assert.equal(got.pid || null, want.pid, `${input}: pid`);
    assert.equal(got.label, want.label, `${input}: label`);
    assert.equal(got.verseEnd || null, want.verseEnd, `${input}: verseEnd`);
    assert.equal(got.book.slug, want.book, `${input}: book`);
  }
});

test("queries compile the way Python compiles them", () => {
  for (const [key, want] of Object.entries(fx.queries)) {
    const [q, ta] = key.split("|");
    const got = compileQuery(q, { typeahead: ta === "1" });
    assert.equal(got.match, want.match, `${key}: match`);
    assert.deepEqual([...(got.collections || [])].sort(), want.collections, `${key}: collections`);
    assert.equal(got.speaker || null, want.speaker, `${key}: speaker`);
    assert.equal(got.yearFrom || null, want.yearFrom, `${key}: yearFrom`);
    assert.equal(got.yearTo || null, want.yearTo, `${key}: yearTo`);
    assert.equal(got.bookSlug || null, want.bookSlug, `${key}: bookSlug`);
    assert.deepEqual(got.terms, want.terms, `${key}: terms`);
  }
});

test("a reference with a verse range carries the whole range", () => {
  const r = S.parseReference("Alma 32:21-27");
  assert.equal(r.pid, "p21");
  assert.equal(r.verseEnd, 27);
  assert.equal(S.citation(r.book, 32, 21, 27), "Alma 32:21–27");
});
