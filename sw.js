/* ===============================
   UNsaid Secure PWA Service Worker
   Production Grade - Maximum Security
================================== */

const VERSION = "v6.0.0";
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const API_CACHE = `api-${VERSION}`;
const MAX_RUNTIME_ITEMS = 100;

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png"
];

/* ===============================
   INSTALL & ACTIVATE
================================== */
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(key => {
        if (![STATIC_CACHE, RUNTIME_CACHE, API_CACHE].includes(key)) {
          return caches.delete(key);
        }
      })
    );
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable();
    }
    await self.clients.claim();
  })());
});

/* ===============================
   FETCH HANDLER (The Vault Door)
================================== */
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // 1️⃣ Strict Protocol & Method Check
  if (!url.protocol.startsWith("http") || request.method !== "GET") return;

  // 2️⃣ Strict Origin Check (Block cross-origin caching by default)
  if (url.origin !== self.location.origin) return;

  // 3️⃣ API Requests: Network First, but EXCLUDE sensitive routes
  if (url.pathname.startsWith("/api/")) {
    // Prevent caching of known sensitive routes entirely
    const sensitiveRoutes = ["/api/auth", "/api/user/private", "/api/tokens"];
    if (sensitiveRoutes.some(route => url.pathname.startsWith(route))) {
      return; // Let the browser handle it natively, bypassing SW cache completely
    }
    
    event.respondWith(networkFirstWithTimeout(request, API_CACHE, 3000));
    return;
  }

  // 4️⃣ Navigation Requests
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(event));
    return;
  }

  // 5️⃣ Static Assets
  event.respondWith(staleWhileRevalidate(request));
});

/* ===============================
   STRATEGIES
================================== */

async function networkFirstWithTimeout(request, cacheName, timeout) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const networkResponse = await fetch(request, { signal: controller.signal });
    clearTimeout(id);

    // Strict Validation before caching API data
    if (isStrictlyCacheable(networkResponse)) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "Offline" }), { 
      status: 503, headers: { "Content-Type": "application/json" } 
    });
  }
}

async function navigationHandler(event) {
  const request = event.request;
  try {
    const preloadResponse = await event.preloadResponse;
    if (preloadResponse) return preloadResponse;

    const networkResponse = await fetch(request);
    
    if (isStrictlyCacheable(networkResponse)) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (err) {
    return caches.match("/index.html") || new Response("Offline", { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cachedResponse = await cache.match(request);

  const networkFetch = fetch(request).then(networkResponse => {
    if (isStrictlyCacheable(networkResponse)) {
      cache.put(request, networkResponse.clone());
      trimCache(RUNTIME_CACHE, MAX_RUNTIME_ITEMS);
    }
    return networkResponse;
  }).catch(() => null);

  return cachedResponse || networkFetch;
}

/* ===============================
   SECURITY & UTILITIES
================================== */

/**
 * 3️⃣ & 4️⃣: Strict Response Type & Cache-Control Validation
 */
function isStrictlyCacheable(response) {
  if (!response) return false;

  // Reject Non-200 responses (404s, 500s) and Opaque responses (type 0)
  if (response.status !== 200 || response.type === "opaque" || response.type === "error") {
    return false;
  }

  // Respect Server Cache-Control Directives
  const cacheControl = response.headers.get("Cache-Control");
  if (cacheControl) {
    if (cacheControl.includes("no-store") || cacheControl.includes("private")) {
      return false; // Do not cache sensitive or strictly fresh data
    }
  }

  return true;
}

/**
 * 5️⃣: Iterative (Non-Recursive) Cache Trimming
 * Safe from stack-overflow errors.
 */
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();

    if (keys.length > maxItems) {
      const itemsToDelete = keys.length - maxItems;
      for (let i = 0; i < itemsToDelete; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (err) {
    console.error("[SW] Cache trim error:", err);
  }
                   }
