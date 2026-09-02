// App-shell service worker. Root scope so it can control everything under
// / (including /app/*). Precaches the shell for offline reading; /relay/*
// (live search/fetch data) is always network-only, never cached — see
// each fetch handler below for the reasoning.
const CACHE_VERSION = "shell-v8";

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable.png",
  "/app/digest.html",
  "/app/search.html",
  "/app/saved.html",
  "/app/library.html",
  "/app/settings.html",
  "/app/style.css",
  "/app/pwa.js",
  "/app/db.js",
  "/app/ui-common.js",
  "/app/refresh.js",
  "/app/scoring.js",
  "/app/dedup.js",
  "/app/default-interests.js",
  "/app/heuristics.js",
  "/app/relate.js",
  "/app/feedback.js",
  "/app/fetch-orchestrator.js",
  "/app/digest.js",
  "/app/search.js",
  "/app/saved.js",
  "/app/library.js",
  "/app/settings.js",
  "/app/models.worker.js",
  "/app/sources/arxiv.js",
  "/app/sources/semanticscholar.js",
  "/app/sources/openreview.js",
  "/app/vendor/transformers.min.js",
];

function precache() {
  return caches.open(CACHE_VERSION).then((cache) =>
    // Individual adds, not cache.addAll — one missing/renamed file (e.g.
    // mid-deploy) shouldn't break installability for everything else,
    // same "one failure never wipes good output" ethos as the old pipeline.
    Promise.all(
      PRECACHE_URLS.map((url) => cache.add(url).catch((err) => console.warn("sw: precache failed", url, err)))
    )
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function staleWhileRevalidate(request) {
  return caches.open(CACHE_VERSION).then((cache) =>
    cache.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return; // never intercept writes

  const url = new URL(event.request.url);

  // Live data — search results, new-paper fetches — must always be live.
  if (url.pathname.startsWith("/relay/")) return;

  const cacheable =
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname === "/manifest.json" ||
    url.pathname === "/seed-corpus.json" ||
    url.pathname.startsWith("/app/") ||
    url.pathname.startsWith("/icons/");

  if (cacheable) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});
