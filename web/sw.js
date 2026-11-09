/* Keeps the app available offline. The library itself lives in the browser's
   private storage and the data files are never cached here.

   Three kinds of request:
   - the shell (the app's own files): from this version's cache, as one set, so a
     launch on a weak signal or none is as fast as offline, and app.js always runs
     beside the lib files it was built with. A new SHELL version is the update: it
     installs into a cache of its own, fresh from the network, and only when every
     file is in does it wait to take over; the page then offers "A new version is
     ready" and the new set takes over when that is tapped (or when the app is next
     started from cold). So every change to a shell file needs SHELL bumped;
   - the search model and ONNX Runtime (model/, vendor/ort/): cache first, in a
     cache of their own that a shell update leaves alone, so 50 MB is fetched once;
   - the data files (the library bundle and its manifest): network only. */
const SHELL = "gospel-shell-v31";
const ASSETS = "gospel-assets-v1";
const FILES = ["./", "./index.html", "./app.css", "./app.js", "./ask.js", "./original.js", "./deck.js", "./studies.js", "./marks.js", "./engine.js", "./model-worker.js", "./semantic.js", "./lib/wordpiece.js", "./vendor/pptxgen.bundle.js", "./lib/query.js", "./lib/scriptures.js",
  "./lib/scriptures-data.js", "./lib/cite.js", "./lib/markdown.js", "./lib/chunk.js","./vendor/sqlite3.mjs", "./vendor/sqlite3.wasm", "./manifest.webmanifest", "./icons/icon.svg"];

self.addEventListener("install", (e) => {
  // Every file fetched fresh (not from the browser's own cache, which could hold an older one)
  // into this version's cache. One that fails fails the install: the version in use carries
  // on whole, and the browser tries the new one again on a later launch. No skipWaiting here:
  // a page running the old files must not be handed new ones partway through.
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(FILES.map((f) => fetch(f, { cache: "reload", credentials: "same-origin" }).then((r) => {
    if (!r.ok) throw new Error(`${f} ${r.status}`);
    return c.put(f, r);
  })))).catch(async (err) => { await caches.delete(SHELL); throw err; }));
});
// The page says "take over" when the reader taps Reload on the notice
self.addEventListener("message", (e) => { if (e.data && e.data.type === "take-over") self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isAsset = (url) => /\/(model|vendor\/ort)\//.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/")) return;
  e.respondWith(isAsset(url) ? cacheFirst(e.request, ASSETS) : shell(e.request));
});

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request, { credentials: "same-origin" });
  if (res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

// The shell from this version's cache; a page opened at any address within the app gets
// index.html (the address after it is read by the app). A file not in the set (an icon the
// manifest names) comes from the network and is kept with this version.
async function shell(request) {
  const cache = await caches.open(SHELL);
  const hit = request.mode === "navigate"
    ? await cache.match(request, { ignoreSearch: true }) || await cache.match("./index.html")
    : await cache.match(request);
  if (hit) return hit;
  return cacheFirst(request, SHELL);
}
