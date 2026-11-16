/*
 * Service worker: кэширует только оболочку приложения (HTML, JS, CSS, иконки).
 * Запросы к /api сюда не попадают: записи для офлайн-просмотра приложение само
 * хранит в IndexedDB на устройстве.
 */
const CACHE = 'diary-shell-__VERSION__';
const PRECACHE = '__PRECACHE__';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req.mode === 'navigate' ? '/' : req, { ignoreSearch: true });
      if (cached) return cached;
      return fetch(req);
    })(),
  );
});
