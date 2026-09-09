// 全局状态: 用户 + 菜单折叠
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UserInfo } from '../api';

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  setAuth: (token: string, user: UserInfo) => void;
  setUser: (user: UserInfo) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'miaoerp-auth' },
  ),
);

interface UiState {
  collapsed: boolean;
  toggleCollapsed: () => void;
  setCollapsed: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  collapsed: false,
  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  setCollapsed: (collapsed) => set({ collapsed }),
}));

// i18n: 显示币种 + 语言
interface I18nState {
  displayCurrency: string;     // 全局显示币种 (用于顶栏切换)
  locale: string;              // 当前语言 locale
  setDisplayCurrency: (c: string) => void;
  setLocale: (l: string) => void;
}
export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      displayCurrency: 'CNY',
      locale: 'zh-CN',
      setDisplayCurrency: (displayCurrency) => set({ displayCurrency }),
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'miaoerp-i18n' },
  ),
);
