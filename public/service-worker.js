/* =========================================================
   Study Until the Ice Melts — service-worker.js
   Cache-first strategy for all static assets.
   Enables full offline use after first load.
   ========================================================= */

const CACHE_NAME = 'ice-timer-v1';

const PRECACHE_ASSETS = [
  '/FinalProject/public/',
  '/FinalProject/public/index.html',
  '/FinalProject/public/main.js',
  '/FinalProject/public/style.css',
  '/FinalProject/public/manifest.json',
  '/FinalProject/public/assets/ice-clink.wav',
  '/FinalProject/public/assets/ice-clink.mp3',
  '/FinalProject/public/assets/cafe.mp3',
  '/FinalProject/public/assets/white.mp3',
  '/FinalProject/public/assets/icons/icon-192.png',
  '/FinalProject/public/assets/icons/icon-512.png',
  '/FinalProject/public/assets/icons/icon-180.png',
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Montserrat:wght@200;300&display=swap'
];

/* ── Install: pre-cache all critical assets ─────────────── */
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Cache what we can; don't fail install if optional assets 404
      return Promise.allSettled(
        PRECACHE_ASSETS.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[SW] Failed to cache:', url, err);
          });
        })
      );
    }).then(function () {
      // Take control immediately without waiting for old SW to die
      return self.skipWaiting();
    })
  );
});

/* ── Activate: delete stale caches ──────────────────────── */
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* ── Fetch: cache-first, network fallback ───────────────── */
self.addEventListener('fetch', function (event) {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests we don't care about (analytics etc.)
  var url = new URL(event.request.url);
  var isSameOrigin    = url.origin === self.location.origin;
  var isCDN           = url.hostname === 'cdnjs.cloudflare.com';
  var isGoogleFonts   = url.hostname.includes('fonts.g');

  if (!isSameOrigin && !isCDN && !isGoogleFonts) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;

      return fetch(event.request).then(function (response) {
        // Don't cache bad responses
        if (!response || response.status !== 200 || response.type === 'error') {
          return response;
        }

        // Clone because the response body can only be consumed once
        var toCache = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, toCache);
        });

        return response;
      }).catch(function () {
        // Offline fallback — return cached index for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/FinalProject/public/index.html');
        }
      });
    })
  );
});