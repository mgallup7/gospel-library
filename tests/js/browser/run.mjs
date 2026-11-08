// The browser tests: the app, served with a library, driven by Playwright at iPad and
// phone sizes. They need a running copy to point at:
//   1. a working database with a few books in it (python -m gospel_library sync --minutes 5 fetches one,
//      or copy data/library.sqlite from a machine that has it), and a passphrase;
//   2. the site built beside it: cp -R web/. site/ && python -m gospel_library bundle --out site/data;
//   3. a static server on it: (cd site && python3 -m http.server 8790).
// Then: GOSPEL_TEST_URL=http://127.0.0.1:8790/ GOSPEL_TEST_PASS="…" node tests/js/browser/run.mjs [spec…]
// Screenshots land in tests/js/browser/shots/ (ignored by git). Playwright comes from PLAYWRIGHT
// (a path to its index.mjs) or from node_modules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.GOSPEL_TEST_URL || "http://127.0.0.1:8790/";
const PASS = process.env.GOSPEL_TEST_PASS || "correct horse battery staple test";
const SHOTS = path.join(here, "shots") + "/";
fs.mkdirSync(SHOTS, { recursive: true });
const pw = process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : "playwright";
const { chromium } = await import(pw);

const wanted = process.argv.slice(2);
const specs = fs.readdirSync(here).filter((f) => f.endsWith(".spec.mjs") && (!wanted.length || wanted.some((w) => f.includes(w)))).sort();
const browser = await chromium.launch();
let failed = 0;
for (const f of specs) {
  const name = f.replace(/\.spec\.mjs$/, "");
  const t0 = Date.now();
  let errors;
  try { errors = await (await import(pathToFileURL(path.join(here, f)).href)).default(browser, { BASE, PASS, SHOTS }); }
  catch (err) { errors = [`aborted: ${err.message.split("\n")[0]}`]; }
  const real = (errors || []).filter((e) => !/ERR_TUNNEL_CONNECTION_FAILED|NoModificationAllowedError|removeVfs|another tab/.test(e)); // the sandbox cannot reach the web; a reload can race the old worker for the storage
  if (real.length) { failed++; console.log(`✗ ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); for (const e of real) console.log(`    ${e}`); }
  else console.log(`✓ ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
await browser.close();
console.log(failed ? `${failed} of ${specs.length} failed` : `all ${specs.length} passed`);
process.exit(failed ? 1 : 0);
