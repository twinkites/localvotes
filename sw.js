// LocalVotes service worker — app-shell caching for offline resilience.
// Strategy: cache-first for static assets; network-only for all API calls.
// On install, pre-caches the app shell so the UI loads even when offline.
// API calls are never cached — live civic data must stay fresh.

const CACHE_VERSION = 'lv-shell-v1';

const SHELL_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './config.js',
  './js/theme.js',
  './js/elections.js',
  './js/civic-info.js',
  './js/geo.js',
  './js/federal.js',
  './js/openstates.js',
  './js/fec.js',
  './js/congress.js',
  './js/local.js',
  './js/submit.js',
  './js/map.js',
  './js/civic-links.js',
  './js/statewide.js',
  './js/school-boards.js',
  './js/city-council.js',
  './js/ui.js',
  './js/app.js',
];

// API hostnames — always bypass cache for these.
const API_HOSTS = new Set([
  'api.zippopotam.us',
  'api.propublica.org',
  'v3.openstates.org',
  'api.open.fec.gov',
  'api.congress.gov',
  'geocoding.geo.census.gov',
  'tigerweb.geo.census.gov',
  'nominatim.openstreetmap.org',
  'query.wikidata.org',
  'docs.google.com',
  'www.googleapis.com',
]);

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Always go network-first for API calls.
  if (API_HOSTS.has(url.hostname)) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(
          JSON.stringify({ error: 'offline' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // For shell assets: serve from cache, fall back to network.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache successful same-origin GET responses.
        if (
          response.ok &&
          event.request.method === 'GET' &&
          url.origin === self.location.origin
        ) {
          caches.open(CACHE_VERSION).then(c => c.put(event.request, response.clone()));
        }
        return response;
      });
    })
  );
});
