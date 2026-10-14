/* Simple offline-first service worker for the Nap Tracker PWA.
 *
 * Strategy:
 *  - Precache a minimal offline fallback page and icons on install.
 *  - Navigations: network-first, falling back to a cached offline page so the
 *    app shell still loads with no connection (the timer runs client-side).
 *  - Static assets (Next.js /_next/static, icons): cache-first (immutable).
 *  - API/tRPC and auth requests are never cached (always hit the network).
 */

const CACHE = "baby-app-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache dynamic app data or auth — these must be live.
  if (url.pathname.startsWith("/api/")) return;

  // Navigations: try network, fall back to the cached offline shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  // Static assets: cache-first, then populate the cache.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          }),
      ),
    );
  }
});
