/**
 * Atelier by GallusTech - Lightweight Progressive Web App Service Worker (Phase C)
 *
 * Security-first caching policy:
 *  - NEVER caches API responses, WebDAV, thumbnails, exports, setup, or authenticated HTML.
 *  - Uses network-first for navigation and static shell assets so updates always appear immediately.
 */
const CACHE_NAME = 'atelier-shell-v1';
const STATIC_ASSETS = [
  './manifest.webmanifest',
  './docs/assets/atelier-icon.svg',
  './themes/base.css',
  './css/window-manager.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Strictly bypass all dynamic, authenticated, or media endpoints
  const p = url.pathname.toLowerCase();
  if (
    p.includes('api.php') ||
    p.includes('thumb.php') ||
    p.includes('archive.php') ||
    p.includes('export.php') ||
    p.includes('webapp.php') ||
    p.includes('setup.php') ||
    p.includes('/dav') ||
    p.includes('/storage/')
  ) {
    return;
  }

  // Cache only static CSS/SVG/manifest assets with network-first fallback
  if (/\.(css|svg|webmanifest)$/i.test(p)) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req))
    );
  }
});
