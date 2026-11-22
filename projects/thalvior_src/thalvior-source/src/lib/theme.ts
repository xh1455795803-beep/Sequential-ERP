// 主题三态（亮/暗/跟随系统）：localStorage 持久化 + <html> class 切换
// index.html 内联脚本先行设置避免 FOUC，本模块负责 React 侧状态与切换
import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const KEY = "thalvior_theme";

export function getThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = localStorage.getItem(KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

export function systemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? (systemDark() ? "dark" : "light") : mode;
}

export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;
  // 浏览器 UI 底色跟随（移动端地址栏）
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  // 浏览器 UI 底色跟随（移动端地址栏）：取 --surface token，亮/暗自动一致
  const surface = getComputedStyle(root).getPropertyValue("--surface").trim();
  meta.content = surface || "canvas";
  return resolved;
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(getThemeMode);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(getThemeMode()));

  useEffect(() => {
    setResolved(applyTheme(mode));
    // 跟随系统：监听系统偏好变化
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSys = () => {
      if (getThemeMode() === "system") setResolved(applyTheme("system"));
    };
    mq.addEventListener("change", onSys);
    // 跨标签页同步
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY && e.newValue) {
        const m = e.newValue as ThemeMode;
        setModeState(m);
        setResolved(applyTheme(m));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      mq.removeEventListener("change", onSys);
      window.removeEventListener("storage", onStorage);
    };
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    localStorage.setItem(KEY, m);
    setModeState(m);
    setResolved(applyTheme(m));
  }, []);

  return { mode, resolved, setMode };
}
