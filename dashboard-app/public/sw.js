const CACHE_NAME = 'bitxbit-dashboard-v2';
const OFFLINE_PAGE = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([OFFLINE_PAGE]);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API calls: network only with offline fallback.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/rest/v1/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'You are offline' }),
          { headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // Navigation requests: network first, fallback to offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(OFFLINE_PAGE))
        .then((response) => response || caches.match(OFFLINE_PAGE) || new Response('Offline'))
    );
    return;
  }

  // Cross-origin requests are NOT ours to handle. Intercepting them put the
  // third-party URL under this page's CSP `connect-src`, so a blocked fetch (e.g.
  // fonts.googleapis.com) rejected and the handler resolved to `undefined` -
  // respondWith(undefined) throws "Failed to convert value to 'Response'", and a
  // throwing fetch handler can surface as ERR_FAILED on the page. Let the browser
  // fetch them directly.
  if (url.origin !== self.location.origin) return;

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => null);
      // NEVER resolve to undefined: respondWith() requires a real Response.
      // Previously `return cached || fetchPromise` could yield undefined when a
      // request was neither cached nor fetchable, throwing inside the handler.
      return cached || fetchPromise.then((r) => r || new Response('', { status: 504 }));
    })
  );
});
