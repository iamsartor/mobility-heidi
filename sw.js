// Service Worker: hält die App-Dateien offline verfügbar.
// Bei Änderungen an den Dateien VERSION erhöhen, damit Geräte die neue Fassung laden.
const VERSION = "v5";
const CACHE = `mobility-${VERSION}`;
const SHELL = ["./", "index.html", "css/style.css", "js/app.js", "js/store.js", "js/export.js", "js/analysis.js", "js/config.js", "manifest.webmanifest", "icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Netz zuerst (immer aktuelle Version), bei fehlendem Netz aus dem Cache.
// Firebase-Bibliotheken von gstatic werden ebenfalls zwischengespeichert.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const own = url.origin === location.origin;
  const lib = url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/");
  if (!own && !lib) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
