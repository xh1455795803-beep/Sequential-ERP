// Thalvior WMS Service Worker —— 离线缓存 + 网络优先
const CACHE_NAME = 'thalvior-wms-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // POST/PUT/DELETE、Supabase API、导航请求 —— 网络优先
  if (
    request.method !== 'GET' ||
    request.url.includes('supabase') ||
    request.url.includes('rest/v1') ||
    request.mode === 'navigate'
  ) {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          // 导航页 + JS/CSS 资源缓存
          if (resp.ok && (request.mode === 'navigate' || resp.url.includes('/assets/'))) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return resp;
        })
        .catch(() => {
          return caches.match(request).then((cached) => cached || caches.match('/index.html'));
        }),
    );
    return;
  }

  // 静态资源 —— 缓存优先
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return resp;
      }).catch(() => cached);
    }),
  );
});
