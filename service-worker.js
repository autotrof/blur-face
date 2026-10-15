const CACHE_PREFIX = 'autotrof-blur-face-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const ROOT = new URL('./', self.location);
const ASSETS = [
  './', './index.html', './style.css?v=3', './app.js?v=3', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
  './public/wasm/face-detect/wajah_detect.js', './public/wasm/face-detect/wajah_detect_bg.wasm',
  './public/wasm/blur/wajah_blur.js', './public/wasm/blur/wajah_blur_bg.wasm'
].map((path) => new URL(path, ROOT).href);
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))); }
      return response;
    }).catch(() => caches.match(request).then((cached) => cached || caches.match(new URL('./index.html', ROOT).href))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok && new URL(request.url).pathname.startsWith(new URL('./', ROOT).pathname)) {
        const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  }).catch(() => request.mode === 'navigate' ? caches.match(new URL('./index.html', ROOT).href) : Response.error()));
});
