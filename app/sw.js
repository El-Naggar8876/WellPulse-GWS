/* WellPulse GWS service worker: precache the app shell, cache-first for same-origin, network for the API. */
const VERSION = '1.0.3';
const CACHE = 'wellpulse-' + VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/config.js', './js/i18n.js', './js/util.js', './js/db.js', './js/sync.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('wellpulse-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // API posts go straight to the network
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // Apps Script / Google go straight to the network
  // Navigation requests: serve cached index so the app opens offline even with query params.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }))
  );
});
