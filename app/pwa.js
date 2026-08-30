// Service worker registration, included by every page (app pages + the
// landing page) via <script type="module" src="pwa.js">. Root-scoped so
// one worker covers both / and /app/*.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((err) => {
    console.warn("pwa: service worker registration failed", err);
  });
}
