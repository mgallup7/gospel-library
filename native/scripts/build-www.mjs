// Builds native/www: the web app in web/, as the files the iPhone, iPad and Android apps carry.
//
//   node scripts/build-www.mjs            the app's own files, the search model fetched from the site
//   node scripts/build-www.mjs --no-model the app's own files only (the model is then downloaded on first use)
//
// Nothing in web/ is changed. Three things differ from the website:
//   1. native.js is added and loaded first. It names the site the library is downloaded from
//      (the library itself is never packed into the app: it is sealed, 150 MB, and renewed nightly).
//   2. The service worker and the web manifest are left out: the app's files are in the app.
//   3. The search model and its runtime are packed in, so search by meaning works with no signal
//      from the first day. They are public files, fetched here from the site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const web = path.resolve(root, "..", "web");
const out = path.join(root, "www");
const HOME = (process.env.LIBRARY_HOME || "https://mgallup7.github.io/gospel-library/").replace(/\/*$/, "/");
const wantModel = !process.argv.includes("--no-model");

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(web, out, { recursive: true });
for (const f of ["sw.js", "manifest.webmanifest"]) fs.rmSync(path.join(out, f), { force: true });

// the version the website calls this set of files (sw.js: gospel-shell-v53)
const shell = /gospel-shell-(v\d+)/.exec(fs.readFileSync(path.join(web, "sw.js"), "utf8"));
const build = shell ? shell[1] : "unknown";

// the search model and its runtime, from the site (public files)
const MODEL = ["model/model_quantized.onnx", "model/vocab.txt", "vendor/ort/ort.wasm.min.mjs", "vendor/ort/ort-wasm-simd-threaded.mjs", "vendor/ort/ort-wasm-simd-threaded.wasm"];
let modelLocal = false;
if (wantModel) {
  try {
    for (const f of MODEL) {
      const res = await fetch(new URL(f, HOME));
      if (!res.ok) throw new Error(`${f}: ${res.status}`);
      const to = path.join(out, f);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, Buffer.from(await res.arrayBuffer()));
    }
    modelLocal = true;
  } catch (err) {
    for (const f of MODEL) fs.rmSync(path.join(out, f), { force: true });
    console.warn(`The search model could not be fetched from ${HOME} (${err.message}). The app will download it on first use instead.`);
  }
}

fs.writeFileSync(path.join(out, "native.js"), `// Written by native/scripts/build-www.mjs. Read by app.js before anything else runs.
window.GL_HOME = ${JSON.stringify(HOME)};
window.GL_BUILD = ${JSON.stringify(build)};
window.GL_MODEL_LOCAL = ${JSON.stringify(modelLocal)};
`);

// index.html: native.js first, and no web manifest
const index = path.join(out, "index.html");
let html = fs.readFileSync(index, "utf8");
html = html.replace(/^.*<link rel="manifest"[^>]*>\s*\n/m, "");
const first = html.indexOf('<script type="module"');
if (first < 0) throw new Error("index.html has no module script to put native.js before");
html = html.slice(0, first) + '<script src="./native.js"></script>\n' + html.slice(first);
fs.writeFileSync(index, html);

const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`native/www: app files ${build}, library from ${HOME}, search model ${modelLocal ? "packed in" : "downloaded on first use"}, ${(size(out) / 1e6).toFixed(1)} MB`);
