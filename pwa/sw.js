const VERSION = 'leeao-mdbook-pwa-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const CONTENT_CACHE = 'leeao-mdbook-content-v1';
const BASE_URL = new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== SHELL_CACHE && key !== CONTENT_CACHE)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== BASE_URL.origin || !url.pathname.startsWith(BASE_URL.pathname)) return;

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (
    request.destination === 'style' ||
    request.destination === 'script' ||
    request.destination === 'worker' ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.js')
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});

function toUrl(path) {
  return new URL(path, BASE_URL).href;
}

async function networkFirst(request) {
  const cache = await caches.open(CONTENT_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) ||
      (await matchDirectoryIndex(request)) ||
      (await caches.match(toUrl('.'))) ||
      (await caches.match(toUrl('index.html'))) ||
      Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CONTENT_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CONTENT_CACHE);
  const cached = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => cached || Response.error());

  return cached || fresh || Response.error();
}

async function matchDirectoryIndex(request) {
  const url = new URL(request.url);
  if (!url.pathname.endsWith('/')) return null;
  const indexUrl = new URL('index.html', url);
  return caches.match(indexUrl.href);
}
