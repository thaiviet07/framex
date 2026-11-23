// Lightweight offline-capable service worker for FX Studio
const CACHE_NAME = 'fx-studio-v3';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.png',
  './logo.png',
  './img/card.webp',
  './img/card_back.webp',
  './img/card_mask.webp',
  './css/pokemon-cards-css/cards/base.css',
  './css/pokemon-cards-css/cards/cards.css',
  './css/pokemon-cards-css/cards/basic.css',
  './css/pokemon-cards-css/cards/trainer-full-art.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Skip API, admin, share routes and large optional reference archive from SW cache
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/portal') ||
    url.pathname.startsWith('/share/') ||
    url.pathname.endsWith('Card_Reference.zip')
  ) {
    return;
  }

  // Immutable hashed assets: cache-first
  if (url.pathname.includes('/assets/') || url.pathname.includes('/css/') || url.pathname.includes('/img/')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        });
      }),
    );
    return;
  }

  // App shell (HTML): network-first with cache fallback for offline support
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
    );
  }
});
