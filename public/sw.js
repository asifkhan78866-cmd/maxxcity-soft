/* ═══════════════════════════════════════
 * MaxxCity POS — Service Worker
 * ═══════════════════════════════════════
 * Keeps the POS usable through an internet interruption.
 *
 * CACHING POLICY — deliberately conservative about what is stored:
 *
 *   · App shell & static build assets → cache-first (they are immutable and
 *     carry no business data)
 *   · Page navigations → network-first, falling back to the cached shell and
 *     then to /offline.html
 *   · EVERYTHING under /api/ → NETWORK ONLY, never cached
 *
 * The API exclusion is the important one. Those responses contain sales,
 * staff, customer and stock data; caching them would leave business and
 * personal data sitting in the browser's cache store, readable by anyone with
 * access to the terminal, and would let a stale response be served as if it
 * were current. Offline data belongs in IndexedDB (lib/database/dexie.ts),
 * which the app controls and prunes.
 */

const CACHE_VERSION = 'maxxcity-v1';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const SHELL_URLS = ['/offline.html', '/manifest.webmanifest', '/icons/maxxcity.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // addAll is all-or-nothing; a single 404 would abort the install, so
      // each URL is cached independently.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:css|js|woff2?|ttf|svg|png|jpg|jpeg|webp|ico)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle same-origin traffic.
  if (url.origin !== self.location.origin) return;

  // ── API: never cached, never intercepted. ──
  // Falling through to the network means an offline API call rejects, which
  // is exactly what the POS expects — it then bills locally to IndexedDB.
  if (url.pathname.startsWith('/api/')) return;

  // ── Static assets: cache-first. ──
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── Navigations: network-first with an offline fallback. ──
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match('/offline.html');
          return (
            offline ??
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        })
    );
  }
});

// Lets the app trigger an immediate update instead of waiting for a reload.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
