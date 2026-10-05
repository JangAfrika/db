// sw.js — a minimal service worker. Its real job is just existing: a
// registered service worker + manifest.json are what make Chrome/Edge/
// Android treat this site as an installable app at all. It also caches the
// app shell (the static HTML/CSS/JS, not any data) so a repeat visit — or
// opening the installed app with a flaky connection — loads instantly
// instead of blocking on the network; every page still needs a live
// connection to the Apps Script backend for actual data, so this is NOT a
// full offline mode.

const CACHE_NAME = 'db-shell-v1';
const SHELL_FILES = [
  'index.html',
  'style.css',
  'config.js',
  'dialog.js',
  'ga.js',
  'pwa.js',
  'logo.png',
  'manifest.json'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // Best-effort — a missing file (e.g. logo.png not uploaded yet)
      // shouldn't stop the service worker from installing.
      return Promise.all(SHELL_FILES.map(function (file) {
        return cache.add(file).catch(function () {});
      }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return; // never intercept the Apps Script POST calls
  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        // Keep the cached shell fresh whenever a real network fetch succeeds.
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return response;
      })
      .catch(function () { return caches.match(event.request); })
  );
});
