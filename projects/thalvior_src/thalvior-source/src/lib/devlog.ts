/**
 * 开发环境日志。生产构建中 devLog 是空函数（Vite dead-code 会消除）。
 * 用法：
 *   import { devLog } from "@/lib/devlog";
 *   devLog("[orders] 打开面单", { count });
 */
export const devLog = (...args: unknown[]) => {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
};
