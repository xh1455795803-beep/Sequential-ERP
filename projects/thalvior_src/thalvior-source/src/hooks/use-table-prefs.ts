// 表格偏好 hook：列显示自定义 + 命名视图（筛选条件快照），localStorage 持久化
// 用法：orders/products/inventory 三大列表页接入（详见各页 tbl.* i18n key）
import { useCallback, useEffect, useState } from "react";

// 列显示自定义：默认全部显示，隐藏集合持久化；新列默认显示（不持久化的 key 自动出现）
export function useColumnPrefs(pageKey: string, keys: string[]) {
  const storageKey = `tbl.cols.${pageKey}`;
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        return Array.isArray(arr) ? arr.filter((k) => keys.includes(k)) : [];
      }
    } catch {
      // 忽略坏数据，按默认全显示处理
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(hidden));
    } catch {
      // 存储满等异常不阻塞交互
    }
  }, [storageKey, hidden]);

  const toggle = useCallback((k: string) => {
    setHidden((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }, []);
  const reset = useCallback(() => setHidden([]), []);
  const visible = useCallback((k: string) => !hidden.includes(k), [hidden]);

  return { hidden, visible, toggle, reset };
}

// 命名视图：把当前筛选状态快照存起来，可应用/删除
export interface NamedView {
  name: string;
  state: Record<string, unknown>;
}

export function useNamedViews(pageKey: string) {
  const storageKey = `tbl.views.${pageKey}`;
  const [views, setViews] = useState<NamedView[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as NamedView[];
        return Array.isArray(arr) ? arr : [];
      }
    } catch {
      // 忽略坏数据
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(views));
    } catch {
      // 存储满等异常不阻塞交互
    }
  }, [storageKey, views]);

  const save = useCallback((name: string, state: Record<string, unknown>) => {
    setViews((prev) => [...prev.filter((v) => v.name !== name), { name, state }]);
  }, []);
  const remove = useCallback((name: string) => {
    setViews((prev) => prev.filter((v) => v.name !== name));
  }, []);

  return { views, save, remove };
}
