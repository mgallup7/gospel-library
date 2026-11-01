/* Keeps the app shell available offline. The library itself lives in the
   browser's private storage; the data files are never cached here. */
const SHELL = "gospel-shell-v14";
const FILES = ["./", "./index.html", "./app.css", "./app.js", "./ask.js", "./deck.js", "./engine.js", "./lib/query.js", "./lib/scriptures.js",
  "./lib/scriptures-data.js", "./vendor/sqlite3.mjs", "./vendor/sqlite3.wasm", "./manifest.webmanifest", "./icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/data/")) return; // the library bundle and manifest always come from the network
  // Always ask the server whether the file changed (cheap: an ETag check), so a
  // new build shows up on the next open instead of after a cache expires.
  e.respondWith(
    fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {}); }
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("./index.html") : undefined)))
  );
});
