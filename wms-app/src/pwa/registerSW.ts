/**
 * 注册 Service Worker —— PWA 离线缓存
 *
 * ⚠️ 在 Capacitor 原生壳里绝对不能注册 SW！
 *    原因：SW 会拦截 fetch 请求，导致 @capacitor/BarcodeScanner 等
 *    插件的原生 bridge 通信被搞挂，扫码、相册、GPS 都失效。
 */
async function shouldRegister(): Promise<boolean> {
  // 原生壳里直接跳过
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      console.info('[SW] Capacitor native platform detected — skipping SW registration');
      return false;
    }
  } catch {
    // Web 环境（没有 @capacitor/core 包或 import 失败）
  }
  return 'serviceWorker' in navigator;
}

export async function registerSW() {
  if (!(await shouldRegister())) return;

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

registerSW();
