// 核心翻译 hook
// - 支持嵌套 key: t('common.login') -> '登录'
// - 支持参数插值: t('dashboard.welcomeMessage', { name: '张三' })
// - 未翻译自动回退 zh-CN，不再显示空白
import { useCallback } from 'react';
import { useI18nStore } from '../store/auth';
import { zhCN, enUS, jaJP } from './locales';
import type { TranslationDict } from './types';

const dictionaries: Record<string, TranslationDict | undefined> = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'ja-JP': jaJP,
};

export function useTranslation() {
  const { locale } = useI18nStore();

  const dict = dictionaries[locale] || zhCN;
  const fallback = zhCN;

  const t = useCallback(
    /**
     * @param key 翻译 key，如 'menu.order-list'
     * @param params 参数插值对象，可选
     * @param fallback 兜底字符串 — 当所有字典都找不到时返回这个
     *                 菜单场景传 menuConfig.label（即中文原文），保证永远有值不裸 key
     */
    (key: string, params?: Record<string, string | number>, fallback?: string): string => {
      const parts = key.split('.');
      let value: any = dict;
      let fallbackValue: any = fallback;

      for (const part of parts) {
        value = value?.[part];
        fallbackValue = fallbackValue?.[part];
        if (value === undefined && fallbackValue === undefined) break;
      }

      let result: string;
      if (typeof value === 'string') {
        result = value;
      } else if (typeof fallbackValue === 'string') {
        result = fallbackValue;
      } else if (fallback) {
        result = fallback;
      } else {
        result = key;
      }

      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          result = result.replace(new RegExp(`{${k}}`, 'g'), String(v));
        });
      }

      return result;
    },
    [dict],
  );

  return { t, locale };
}
