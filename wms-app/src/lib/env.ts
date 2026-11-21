/**
 * 环境检测：Web vs Capacitor 原生壳
 * - Web: vite base=/wms/ → React Router basepath=/wms
 * - Native: file:///android_asset/ → basepath=/
 */
export async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** 同步版本（main.tsx 顶层不能 await） */
export function isNativeSync(): boolean {
  // Capacitor 原生壳里 window.Capacitor 自动注入
  return !!(typeof (globalThis as any).Capacitor !== 'undefined' && (globalThis as any).Capacitor?.isNativePlatform?.());
}

/** 当前路由 basepath */
export function getBasepath(): string {
  return isNativeSync() ? '/' : '/wms';
}

/** vite build 产物里写死了 base，用 import.meta.env 读 */
export function getViteBase(): string {
  return import.meta.env.BASE_URL || '/wms/';
}
