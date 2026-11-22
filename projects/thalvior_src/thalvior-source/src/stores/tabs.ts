// vV1-T3：多标签页（可关闭 tab bar）状态源
// ---------------------------------------------------------------------------
// 依赖检查：package.json 无 zustand / jotai → 用「极简外部 store + useSyncExternalStore」，
// 不引第三方、不需要 Provider，任意组件可直接读写。
// 边界：只管「开了哪些页 / 当前哪页 / 刷新信号」，不取数、不改路由语义。
// 持久化：localStorage[thalvior.openTabs] = Tab[]。
// activePath 不落库（避免与 URL 打架）：由 TabBar 用当前 pathname 点亮。
// 关闭类动作返回「应激活的 path」，由调用方（TabBar）负责 navigate，
// 避免关掉当前页后 URL 还停在那一页、被路由同步 effect 立刻补开回来。
import { useSyncExternalStore } from "react";

export interface Tab {
  path: string;
  title: string;
  closable: boolean;
}

export interface TabsSnapshot {
  tabs: Tab[];
  activePath: string;
  /** 自增计数：TabBar 用它作为 <Outlet key> 触发整页重挂载（右键「刷新」） */
  reloadNonce: number;
}

const STORAGE_KEY = "thalvior.openTabs";
/** 首页固定标签：不可关闭 */
export const HOME_PATH = "/dashboard";
const HOME_TITLE = "首页";

const isBrowser = typeof window !== "undefined";

/** 存量 / 外部写入的数据一律过一遍白名单，防脏数据把标签带画崩 */
function sanitize(raw: unknown): Tab[] {
  if (!Array.isArray(raw)) return [];
  const out: Tab[] = [];
  for (const item of raw as Partial<Tab>[]) {
    const path = typeof item?.path === "string" && item.path.startsWith("/") ? item.path : null;
    if (!path || out.some((t) => t.path === path)) continue;
    const title = typeof item?.title === "string" && item.title ? item.title : path;
    out.push({ path, title, closable: item.closable !== false });
  }
  return out;
}

function initialTabs(): Tab[] {
  let stored: Tab[] = [];
  try {
    stored = isBrowser ? sanitize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")) : [];
  } catch {
    stored = [];
  }
  const tabs = stored.filter((t) => t.path !== HOME_PATH);
  // 首页永远第一位、永远不可关闭
  return [{ path: HOME_PATH, title: HOME_TITLE, closable: false }, ...tabs];
}

let state: TabsSnapshot = { tabs: initialTabs(), activePath: HOME_PATH, reloadNonce: 0 };
const listeners = new Set<() => void>();

function commit(next: TabsSnapshot) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next.tabs));
  } catch {
    /* 隐私模式写入失败可忽略：标签偏好只是展示态 */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

export interface TabsApi {
  /** 打开（或复用）标签并点亮，返回该 path */
  openTab: (tab: { path: string; title: string; closable?: boolean }) => string;
  /** 关闭单个标签，返回关闭后应激活的 path（不可关闭 / 不存在时返回当前 activePath） */
  closeTab: (path: string) => string;
  setActive: (path: string) => void;
  closeOthers: (path: string) => string;
  closeAll: () => string;
  refresh: (path: string) => string;
  /** 路由变化同步：不存在则补开，存在则点亮（不覆盖已有标题） */
  syncPath: (tab: { path: string; title: string; closable?: boolean }) => void;
}

/** 从 tabs 移除 path 后，按「右侧优先、否则左侧」挑一个激活项 */
function pickAfterRemove(tabs: Tab[], path: string): string {
  const idx = state.tabs.findIndex((t) => t.path === path);
  if (idx < 0) return state.activePath;
  const fallback = tabs[Math.min(idx, tabs.length - 1)]?.path ?? HOME_PATH;
  return state.activePath === path ? fallback : state.activePath;
}

export const tabsApi: TabsApi = {
  openTab: ({ path, title, closable = true }) => {
    const exists = state.tabs.find((t) => t.path === path);
    const tabs = exists
      ? state.tabs.map((t) => (t.path === path ? { ...t, title: title || t.title } : t))
      : [...state.tabs, { path, title: title || path, closable }];
    commit({ ...state, tabs, activePath: path });
    return path;
  },
  closeTab: (path) => {
    const target = state.tabs.find((t) => t.path === path);
    if (!target || !target.closable) return state.activePath;
    const tabs = state.tabs.filter((t) => t.path !== path);
    const activePath = pickAfterRemove(tabs, path);
    commit({ ...state, tabs, activePath });
    return activePath;
  },
  setActive: (path) => {
    if (state.activePath === path || !state.tabs.some((t) => t.path === path)) return;
    commit({ ...state, activePath: path });
  },
  closeOthers: (path) => {
    const tabs = state.tabs.filter((t) => t.path === path || !t.closable);
    commit({ ...state, tabs, activePath: path });
    return path;
  },
  closeAll: () => {
    const tabs = state.tabs.filter((t) => !t.closable);
    const activePath = tabs.some((t) => t.path === state.activePath) ? state.activePath : HOME_PATH;
    commit({ ...state, tabs, activePath });
    return activePath;
  },
  refresh: (path) => {
    commit({ ...state, activePath: path, reloadNonce: state.reloadNonce + 1 });
    return path;
  },
  syncPath: ({ path, title, closable = true }) => {
    const exists = state.tabs.find((t) => t.path === path);
    // 已有标签：只点亮 + 用最新语言/模块名刷新标题（切换语言时标签文案跟着变）
    if (exists) {
      const tabs = title && exists.title !== title
        ? state.tabs.map((t) => (t.path === path ? { ...t, title } : t))
        : state.tabs;
      if (state.activePath === path && tabs === state.tabs) return;
      commit({ ...state, tabs, activePath: path });
      return;
    }
    commit({ ...state, tabs: [...state.tabs, { path, title: title || path, closable }], activePath: path });
  },
};

export function useTabs(): TabsSnapshot & TabsApi {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // tabsApi 的函数引用稳定，展开只是把 snapshot 与动作合成一个返回值
  return { ...snap, ...tabsApi };
}
