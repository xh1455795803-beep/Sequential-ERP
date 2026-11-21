/**
 * meoo 多标签状态管理 —— 源码反推自 _layout-gjXQ2pXw.js
 * localStorage 持久化 key: thalvior.openTabs
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface OpenTab {
  path: string;
  label: string;
  closable: boolean;
}

interface TabState {
  tabs: OpenTab[];
  activePath: string;
  openTab: (tab: OpenTab) => void;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
  syncPath: (path: string) => void;
}

const DEFAULT_TAB: OpenTab = { path: '/dashboard', label: '工作台', closable: false };

export const useTabStore = create<TabState>()(
  persist(
    (set, get) => ({
      tabs: [DEFAULT_TAB],
      activePath: '/dashboard',
      openTab: (tab) => {
        const existing = get().tabs.find((t) => t.path === tab.path);
        if (existing) {
          set({ activePath: tab.path });
          return;
        }
        set({ tabs: [...get().tabs, tab], activePath: tab.path });
      },
      closeTab: (path) => {
        const tabs = get().tabs.filter((t) => t.path !== path);
        const activePath = get().activePath === path
          ? tabs[tabs.length - 1]?.path ?? '/dashboard'
          : get().activePath;
        set({ tabs, activePath });
      },
      setActive: (path) => set({ activePath: path }),
      syncPath: (path) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (!existing) {
          // 自动加一个 closable=true 的 tab
          get().openTab({ path, label: guessLabel(path), closable: true });
        } else {
          set({ activePath: path });
        }
      },
    }),
    { name: 'thalvior.openTabs' }
  )
);

function guessLabel(path: string): string {
  const map: Record<string, string> = {
    '/dashboard': '工作台',
    '/orders': '订单列表',
    '/products': '商品管理',
    '/inventory': '库存概览',
    '/inventory/skus': 'SKU 管理',
    '/warehouses': '仓库管理',
    '/warehouses/locations': '库位管理',
    '/inbound/asns': '收货·ASN',
    '/outbound/shipments': '出库管理',
    '/channels': '物流渠道',
    '/exceptions': '异常中心',
    '/stocktaking': '盘点管理',
    '/erp': 'ERP 连接',
  };
  return map[path] ?? path.split('/').filter(Boolean).pop() ?? '页面';
}
