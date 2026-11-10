// The service worker's FILES is the shell: what a device keeps to start offline. A file added
// under web/ and not listed there works online and fails on a plane, so the list is checked
// against the folder: every web/*.js (but sw.js itself), web/*.css, web/*.html and web/lib/*.js,
// with the vendor files, the manifest and the icon it names, each of which must exist.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const sw = fs.readFileSync(path.join(web, "sw.js"), "utf8");
const listed = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\]);/)[1]);

test("sw.js FILES lists every file the shell needs, and nothing that is not there", () => {
  const ours = [
    ...fs.readdirSync(web).filter((f) => (f.endsWith(".js") && f !== "sw.js") || f.endsWith(".css") || f.endsWith(".html")).map((f) => `./${f}`),
    ...fs.readdirSync(path.join(web, "lib")).filter((f) => f.endsWith(".js")).map((f) => `./lib/${f}`),
  ];
  const others = listed.filter((f) => f !== "./" && !ours.includes(f));
  for (const f of others) {
    assert.ok(/^\.\/(vendor\/|icons\/|manifest\.webmanifest$)/.test(f), `${f} is listed in FILES and is not a shell file`);
    assert.ok(fs.existsSync(path.join(web, f)), `${f} is listed in FILES and is not under web/`);
  }
  assert.ok(listed.includes("./"), "FILES should list ./ (the page itself)");
  assert.deepEqual([...listed].sort(), ["./", ...ours, ...others].sort());
  assert.equal(new Set(listed).size, listed.length, "a file is listed twice");
});

test("the shell version is named once, as gospel-shell-vN", () => {
  assert.match(sw, /const SHELL = "gospel-shell-v\d+";/);
});
