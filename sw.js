// Offline support for Honest Gin.
// Network first: when you're online you always get the latest version straight away;
// when you're offline the copy saved on your device is used.
const VERSION = 'honest-gin-v11';
const FILES = ['./', 'index.html', 'engine.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(req, { cache: 'no-cache', signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      return (await cache.match(req, { ignoreSearch: true })) || (await caches.match('index.html')) || Response.error();
    }
  })());
});
