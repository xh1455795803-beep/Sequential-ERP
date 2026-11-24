import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.thalvior.wms',
  appName: 'Thalvior WMS',
  webDir: 'dist',
  bundledWebRuntime: false,

  // 允许 App 内调用外部 HTTPS API
  server: {
    // 生产环境指向真实服务器（如果 web 端有后端）
    // url: 'https://thalvior.icu',
    cleartext: true, // 允许 HTTP (Android 默认只允许 HTTPS)
  },

  // Android 配置
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },

  // 全局：允许跨源 API 调用
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#1a1a2e',
      showSpinner: false,
    },
  },
};

export default config;
