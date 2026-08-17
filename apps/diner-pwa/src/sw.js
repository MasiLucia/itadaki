/**
 * Cache-first for the app shell and rendered images, network-first for API
 * reads. Writes are never cached — the outbox in IndexedDB owns those.
 */
// Bumping the shell name evicts the previous cache on activate, which is what
// retires a bad shell from devices that already stored one.
const SHELL = 'itadaki-shell-v3';
const IMAGES = 'itadaki-images-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(['/', '/index.html'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== SHELL && key !== IMAGES).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never get between the dev server and the browser: it recompiles chunks
  // under new hashes, and a cached index.html would point at files that no
  // longer exist — a blank screen that survives a reload.
  if (url.hostname === 'localhost' && url.port === '4200') return;

  // Rendered image variants are immutable: once fetched, serve from cache.
  if (url.pathname.includes('/api/images/')) {
    event.respondWith(
      caches.open(IMAGES).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) return;

  // Network-first for the shell: serving a stale index.html would point at
  // hashed chunks a new deploy has already replaced. The cache is the offline
  // fallback, not the default answer.
  event.respondWith(
    caches.open(SHELL).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        const hit = await cache.match(request);
        if (hit) return hit;
        throw error;
      }
    }),
  );
});
