/* Keeps the app available offline. The library itself lives in the browser's
   private storage and the data files are never cached here.

   Three kinds of request:
   - the shell (the app's own files): network first, so a new build shows up on
     the next open, but the network gets three seconds; on a weak signal, or
     none, the cached copy answers at once;
   - the search model and ONNX Runtime (model/, vendor/ort/): cache first, in a
     cache of their own that a shell update leaves alone, so 50 MB is fetched once;
   - the data files (the library bundle and its manifest): network only. */
const SHELL = "gospel-shell-v28";
const ASSETS = "gospel-assets-v1";
const FILES = ["./", "./index.html", "./app.css", "./app.js", "./ask.js", "./original.js", "./deck.js", "./studies.js", "./marks.js", "./engine.js", "./semantic.js", "./lib/wordpiece.js", "./vendor/pptxgen.bundle.js", "./lib/query.js", "./lib/scriptures.js",
  "./lib/scriptures-data.js", "./vendor/sqlite3.mjs", "./vendor/sqlite3.wasm", "./manifest.webmanifest", "./icons/icon.svg"];
const NETWORK_WAIT = 3000;

self.addEventListener("install", (e) => {
  // each file on its own, so one that is missing does not cost the whole offline shell
  e.waitUntil(caches.open(SHELL).then((c) => Promise.allSettled(FILES.map((f) => c.add(f)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isAsset = (url) => /\/(model|vendor\/ort)\//.test(url.pathname);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/")) return;
  e.respondWith(isAsset(url) ? cacheFirst(e.request) : networkFirst(e.request));
});

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request, { credentials: "same-origin" });
  if (res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  const fromNet = fetch(request.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
    if (res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  });
  const waited = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_WAIT));
  try {
    const res = await Promise.race([fromNet, waited]);
    if (res) return res;
  } catch (_) { /* offline, or the request failed: the cache answers */ }
  const cached = await cache.match(request) || (request.mode === "navigate" ? await cache.match("./index.html") : null);
  if (cached) { fromNet.catch(() => {}); return cached; }
  return fromNet; // nothing cached yet: the network, however long it takes
}
