/* FGC 2026 Scouting — offline cache.
   Static shell: stale-while-revalidate. Navigations: network first, cache fallback.
   Flags/photos: cache first (immutable). /api/: never cached. */
const V = 'fgc2026-v22';
const SHELL = [
  './', 'app.css', 'app.js', 'ranks.js', 'nations.js',
  'i18n.js', 'i18n2.js', 'i18n3.js', 'i18n4.js', 'i18n5.js', 'i18n6.js', 'i18n7.js',
  'manifest.webmanifest', 'fgc2026-64.png', 'fgc2026-192.png', 'fgc2026-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.mobileconfig')) return;

  // photos and flags never change once written
  if (url.pathname.startsWith('/photos/') || url.pathname.startsWith('/flags/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  // page loads: fresh if possible, cached shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(V).then(c => c.put('./', copy));
      return res;
    }).catch(() => caches.match('./').then(hit => hit || caches.match(req))));
    return;
  }

  // everything else: serve cache, refresh in the background
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});
