// 注册 Service Worker —— PWA 离线缓存
export function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      const swUrl = '/wms/sw.js';
      navigator.serviceWorker
        .register(swUrl)
        .catch((err) => console.warn('SW registration failed:', err));
    });
  }
}

registerSW();
