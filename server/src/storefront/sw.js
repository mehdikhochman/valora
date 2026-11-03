// Service worker: makes the shop open instantly on repeat visits and still work offline.
//   - Pages: network first (always the latest prices), the last copy when offline.
//   - Fonts, brand images and photos: cache first (their names never change content).
//   - Orders and counters (/api/*) and the admin are never cached.
const VERSION = 'vallora-v2';
const SHELL = ['/', '/assets/brand/emblem-ink.webp', '/assets/brand/wordmark-ink.webp', '/assets/brand/silhouette-640.webp'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) ?? (await cache.match('/')) ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;
  if (request.mode === 'navigate') return event.respondWith(networkFirst(request));
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/media/')) event.respondWith(cacheFirst(request));
});
