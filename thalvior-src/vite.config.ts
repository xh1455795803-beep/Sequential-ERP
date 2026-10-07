import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        bypass(req) {
          // Vite dev 模式下源码 import 会被 transform 成绝对路径 /api/xxx.ts,
          // 必须排除 .ts/.tsx/.js 等源码后缀, 否则会被错误代理到后端
          const url = req.url || '';
          if (/\.(tsx?|jsx?|mjs|cjs|vue|svelte)(\?|$)/.test(url)) return url;
          return void 0;
        },
      },
    },
  },
});
