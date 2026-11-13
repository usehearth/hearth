// Hearth's service worker: makes the web build installable and quick to open. It caches only the app itself (HTML,
// scripts, styles, icons) from this origin. Chats never pass through it: they travel over the WebSocket to the server,
// which a service worker cannot see, and nothing from the server is ever cached.
const CACHE = 'hearth-shell-v1';

// Install: the page, its icons, and the built scripts and styles the page names (so the first visit works offline).
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(['/', '/manifest.webmanifest', '/logo.svg', '/icon-192.png', '/icon-512.png']);
    const html = await (await c.match('/')).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    if (assets.length) await c.addAll(assets);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first for pages (a new version shows at once), cache first for hashed assets. Same origin, GET only.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res; }).catch(() => caches.match('/')));
    return;
  }
  if (/^\/(assets\/|icon-|logo\.svg|apple-touch-icon|manifest\.webmanifest)/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
