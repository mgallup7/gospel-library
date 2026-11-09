// Every file under web/ and web/lib/ parses as the module it is loaded as. `node --check
// web/app.js` passes a file with a `let keepTyped` and a `function keepTyped` side by side, which
// the browser refuses to load; a copy saved as .mjs is checked as a module, and node names the
// file, the line and the duplicate. web/vendor/ is not ours and is left out.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const web = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "web");
const files = [web, path.join(web, "lib")].flatMap((dir) =>
  fs.readdirSync(dir).filter((f) => f.endsWith(".js") || f.endsWith(".mjs")).map((f) => path.join(dir, f)));

test("every web/ and web/lib/ file parses as a module", () => {
  assert.ok(files.length > 10, `only ${files.length} files found under ${web}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gl-syntax-"));
  const bad = [];
  try {
    for (const file of files) {
      const copy = path.join(tmp, path.relative(web, file).replace(/[\\/]/g, "__").replace(/\.m?js$/, ".mjs"));
      fs.copyFileSync(file, copy);
      try { execFileSync(process.execPath, ["--check", copy], { stdio: "pipe" }); }
      catch (err) {
        const msg = String(err.stderr || err.message).split(copy).join(path.relative(path.dirname(web), file)).trim();
        bad.push(`${path.relative(path.dirname(web), file)}:\n${msg}`);
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  assert.deepEqual(bad, [], bad.join("\n\n"));
});
