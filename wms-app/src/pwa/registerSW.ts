// 注册 Service Worker —— PWA 离线缓存
// 强制每次页面加载都检查 SW 更新（dev 期间更安全）
export function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = '/wms/sw.js';
      navigator.serviceWorker
        .register(swUrl, { updateViaCache: 'none' })
        .then((reg) => {
          // 立刻检查更新（不等浏览器的 24h 周期）
          reg.update().catch(() => {});
          // 当有新版本 SW 准备激活时，自动 reload
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.location.reload();
          });
        })
        .catch((err) => console.warn('SW registration failed:', err));
    });
  }
}

registerSW();
