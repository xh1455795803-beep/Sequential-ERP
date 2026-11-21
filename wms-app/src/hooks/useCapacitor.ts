/**
 * Capacitor 原生壳环境检测 + API 封装
 *
 * 在 Web 浏览器里：isNative = false，所有 API 返回 null/undefined
 * 在 Capacitor 壳里：isNative = true，可以调原生 API
 */

// 动态 import（Web 环境里 Capacitor 包会被 tree-shake 掉）
let _isNative: boolean | null = null;

export async function isNative(): Promise<boolean> {
  if (_isNative !== null) return _isNative;
  try {
    const { Capacitor } = await import('@capacitor/core');
    _isNative = Capacitor.isNativePlatform();
  } catch {
    _isNative = false;
  }
  return _isNative;
}

export function isNativeSync(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Capacitor } = require('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return !!(window as any).Capacitor?.isNativePlatform?.();
  }
}

/** 原生壳里调用 BarcodeScanner（PDA 实体扫码键也触发） */
export async function nativeScanBarcode(): Promise<string | null> {
  try {
    const { BarcodeScanner } = await import('@capacitor/barcode-scanner');
    // 先检查权限
    const status = await BarcodeScanner.checkPermission({ force: false });
    if (status.granted === false) {
      const req = await BarcodeScanner.requestPermission();
      if (req.granted === false) return null;
    }
    await BarcodeScanner.startScan();
    return await new Promise<string | null>((resolve) => {
      const handler = (result: any) => {
        BarcodeScanner.removeListener('barcodeScanned');
        resolve(result?.value || null);
      };
      BarcodeScanner.addListener('barcodeScanned', handler);
      // 超时 15s
      setTimeout(() => {
        BarcodeScanner.removeListener('barcodeScanned');
        resolve(null);
      }, 15000);
    });
  } catch (e) {
    console.warn('[Capacitor] nativeScanBarcode failed:', e);
    return null;
  }
}

/** 原生壳里检测网络状态 */
export async function getNetworkStatus(): Promise<{ connected: boolean; connectionType: string } | null> {
  try {
    const { Network } = await import('@capacitor/network');
    return await Network.getStatus();
  } catch {
    return null;
  }
}

/** 原生壳里触发本地通知 */
export async function notifyLocal(title: string, body: string, id?: number): Promise<void> {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({
      notifications: [{
        id: id ?? Date.now(),
        title,
        body,
        schedule: { at: new Date(Date.now() + 1000) },
      }],
    });
  } catch (e) {
    console.warn('[Capacitor] notifyLocal failed:', e);
  }
}
