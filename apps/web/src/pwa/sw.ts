/**
 * Service Worker for Process OS PWA (SP6 §3.3)
 *
 * - App shell caching (HTML, JS, CSS)
 * - API response caching (stale-while-revalidate for reads)
 * - Offline queue for write operations
 * - Push notification handling
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'pos-v1';
const API_CACHE_NAME = 'pos-api-v1';

// App shell resources to precache
const APP_SHELL = [
  '/',
  '/manifest.json',
];

// API patterns to cache (GET only, stale-while-revalidate)
const API_CACHE_PATTERNS = [
  /^\/api\/v1\/cases$/,
  /^\/api\/v1\/attention/,
  /^\/api\/v1\/decisions/,
  /^\/api\/v1\/kanban\//,
  /^\/api\/v1\/packs$/,
];

// ── Install: precache app shell ─────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL);
    }),
  );
  // Activate immediately
  self.skipWaiting();
});

// ── Activate: clean old caches ──────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== API_CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
    }),
  );
  // Claim all clients immediately
  self.clients.claim();
});

// ── Fetch: cache strategy ───────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (let them go to network)
  if (request.method !== 'GET') return;

  // API requests: stale-while-revalidate
  if (url.pathname.startsWith('/api/')) {
    const shouldCache = API_CACHE_PATTERNS.some((p) => p.test(url.pathname));
    if (shouldCache) {
      event.respondWith(staleWhileRevalidate(request));
      return;
    }
    // Other API calls: network only
    return;
  }

  // App shell: cache first, then network
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/').then((cached) => {
        return cached || fetch(request);
      }),
    );
    return;
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(request).then((cached) => {
      return cached || fetch(request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && url.pathname.match(/\.(js|css|png|svg|woff2?)$/)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    }),
  );
});

// ── Push notification handler ───────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: Record<string, unknown>;
    actions?: Array<{ action: string; title: string }>;
  };

  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Process OS', body: event.data.text() };
  }

  const options: NotificationOptions = {
    body: payload.body,
    icon: payload.icon ?? '/icon-192.png',
    badge: payload.badge ?? '/icon-192.png',
    tag: payload.tag ?? 'pos-notification',
    data: payload.data,
    actions: payload.actions,
    vibrate: [200, 100, 200],
    requireInteraction: payload.data?.priority === 'critical',
  };

  event.waitUntil(
    self.registration.showNotification(payload.title, options),
  );
});

// ── Notification click handler ──────────────────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data ?? {};
  let targetUrl = '/cases';

  // Route to the appropriate page based on notification data
  if (data.case_id && data.move_id) {
    targetUrl = `/cases/${data.case_id}/kanban`;
  } else if (data.case_id) {
    targetUrl = `/cases/${data.case_id}`;
  } else if (data.url) {
    targetUrl = data.url;
  }

  // Handle action buttons
  if (event.action === 'approve') {
    targetUrl = data.approve_url ?? targetUrl;
  } else if (event.action === 'view') {
    targetUrl = data.view_url ?? targetUrl;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(targetUrl);
    }),
  );
});

// ── Cache strategies ────────────────────────────────────────────────

async function staleWhileRevalidate(request: Request): Promise<Response> {
  const cache = await caches.open(API_CACHE_NAME);
  const cached = await cache.match(request);

  // Start network fetch in background
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => {
      // Network failed — return cached or offline fallback
      return cached ?? new Response(
        JSON.stringify({ error: 'offline', cached: false }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    });

  // Return cached immediately if available, otherwise wait for network
  return cached ?? fetchPromise;
}
