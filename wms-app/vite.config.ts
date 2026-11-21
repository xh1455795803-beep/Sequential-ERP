import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

/**
 * 构建模式：
 *   web       → 部署到 https://thalvior.fun/wms/  (base: '/wms/')
 *   capacitor → 原生壳内 file:// 协议              (base: './' 相对路径)
 * 用法：
 *   npm run build              → web 模式
 *   VITE_MODE=capacitor npm run build  → 原生壳模式
 */
const mode = process.env.VITE_MODE || 'web';
const base = mode === 'capacitor' ? './' : '/wms/';

console.log(`[vite] build mode: ${mode}, base: ${base}`);

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 3016,
    host: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Capacitor 需要 sourcemap 关掉（安全），Web 可以保留
    sourcemap: mode !== 'capacitor',
  },
});
