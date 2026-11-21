// Thalvior WMS Service Worker —— 离线缓存 + 版本化
// v3: 强制清理 v2 旧缓存，彻底解决 bundle 陈旧问题
const CACHE_NAME = 'thalvior-wms-v3';
const PRECACHE_URLS = [
  '/wms/',
  '/wms/index.html',
  '/wms/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();  // 新 SW 安装后立刻激活
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        }),
      ),
    ),
  );
  self.clients.claim();  // 立刻接管所有页面
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 1) Supabase / REST API —— 永不缓存，网络直取
  if (
    request.method !== 'GET' ||
    request.url.includes('supabase') ||
    request.url.includes('rest/v1') ||
    request.url.includes('auth/v1')
  ) {
    return;  // 让浏览器默认处理
  }

  // 2) 导航请求（index.html） —— 网络优先，失败才回退缓存
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return resp;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/wms/index.html'))),
    );
    return;
  }

  // 3) 带 hash 的静态资源（/assets/*.js, /assets/*.css） —— 缓存优先
  // 因为文件名含 hash，内容变 = URL 变，不会冲突
  if (request.url.includes('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return resp;
        });
      }),
    );
    return;
  }

  // 4) 其他 GET（manifest, icon 等） —— 缓存优先 + 后台更新
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        // 后台异步更新
        fetch(request).then((resp) => {
          if (resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(request).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return resp;
      });
    }),
  );
});
