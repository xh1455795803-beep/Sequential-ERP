import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor 原生壳配置
 * 一套代码 → Android + iOS 双端
 *
 * 用法：
 *   1. VITE_MODE=capacitor npm run build    # 构建 Web 产物（相对路径）
 *   2. npx cap add android                   # 首次：创建 Android 工程
 *   3. npx cap add ios                       # 首次：创建 iOS 工程
 *   4. npx cap sync                          # 把 dist/ 同步到原生工程
 *   5. npx cap open android                  # 打开 Android Studio
 *   6. npx cap open ios                      # 打开 Xcode
 */
const config: CapacitorConfig = {
  appId: 'com.thalvior.wms',
  appName: 'thalvior｜塔威仓库管理系统',
  webDir: 'dist',
  bundledWebRuntime: false,

  // Android 原生壳配置
  android: {
    allowMixedContent: true,            // 允许 file:// 壳 + https:// API 混合（Supabase）
    captureInput: true,                 // 实体键盘/扫码枪输入自动聚焦当前 input
    webContentsDebuggingEnabled: false, // 生产环境关掉 Chrome DevTools
  },

  // iOS 原生壳配置
  ios: {
    contentInset: 'never',
    allowsLinkPreview: false,
    backgroundColor: '#0e7490',
    overrideUserAgent: 'ThalviorWMS/1.0',
  },

  // 服务器配置 —— 允许 Supabase 通信
  server: {
    allowNavigation: [
      '*.supabase.co',
      '*.supabase.rest',
      '43.133.232.81',
      'thalvior.fun',
      '*.thalvior.fun',
    ],
  },

  // 插件配置
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#0e7490',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#0e7490',
      overlaysWebView: false,
    },
  },
};

export default config;
