/* Drill Pick service worker.
 *
 * The app's own files are fetched network-first so a merge to main reaches an
 * installed phone on the next launch with signal, with no reinstall. The cache
 * is the offline fallback, and also covers a slow connection through the
 * timeout below. Fonts and icons never change, so those stay cache-first.
 */
const VERSION = 'v2';
const CACHE = 'drill-pick-' + VERSION;
const NETWORK_TIMEOUT = 3000;

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './wheel-core.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Long-lived assets: serve from cache, fetch and store on a miss. */
function cacheFirst(request) {
  return caches.match(request).then((hit) => {
    if (hit) return hit;
    return fetch(request).then((response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  });
}

/** App files: prefer the network, fall back to cache on failure or a stall. */
function networkFirst(request) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (response) => {
      if (!settled) {
        settled = true;
        resolve(response);
      }
    };

    // A slow network shouldn't hold the app hostage: after the timeout, serve
    // the cached copy if there is one. The fetch still runs and refreshes it.
    const stall = setTimeout(() => {
      caches.match(request).then((hit) => {
        if (hit) finish(hit);
      });
    }, NETWORK_TIMEOUT);

    fetch(request)
      .then((response) => {
        clearTimeout(stall);
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        finish(response);
      })
      .catch(() => {
        clearTimeout(stall);
        caches.match(request).then((hit) => {
          if (hit) return finish(hit);
          if (request.mode === 'navigate') {
            return caches.match('./index.html').then((shell) => finish(shell || Response.error()));
          }
          finish(Response.error());
        });
      });
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/icons/') !== -1) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
