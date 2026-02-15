const CACHE_VERSION = "v2";
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `dynamic-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

// Install
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (!key.includes(CACHE_VERSION)) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch Strategy
self.addEventListener("fetch", event => {

  // Network First for API calls
  if (event.request.url.includes("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          return caches.open(DYNAMIC_CACHE).then(cache => {
            cache.put(event.request, res.clone());
            return res;
          });
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache First for static assets
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        return cached || fetch(event.request);
      })
  );
});
