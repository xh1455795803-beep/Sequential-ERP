// 货币工具 hooks
// - formatMoney: 用 Intl.NumberFormat 格式化货币金额
// - useCurrencyConverter: 异步换算货币
// - getCurrencyMeta: 取币种元数据 (符号/中英文名)
import { useQuery } from '@tanstack/react-query';
import { i18nApi, type Currency } from '../api';

// 内置静态币种 (兜底, 当 API 失败时使用)
export const FALLBACK_CURRENCIES: Currency[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar', nameZh: '美元' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', nameZh: '人民币' },
  { code: 'EUR', symbol: '€', name: 'Euro', nameZh: '欧元' },
  { code: 'GBP', symbol: '£', name: 'British Pound', nameZh: '英镑' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', nameZh: '日元' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong Dollar', nameZh: '港币' },
  { code: 'KRW', symbol: '₩', name: 'Korean Won', nameZh: '韩元' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', nameZh: '澳元' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', nameZh: '加元' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', nameZh: '新加坡元' },
];

export const SUPPORTED_LOCALES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'ja-JP', label: '日本語' },
  { code: 'ko-KR', label: '한국어' },
  { code: 'fr-FR', label: 'Français' },
  { code: 'de-DE', label: 'Deutsch' },
  { code: 'es-ES', label: 'Español' },
  { code: 'pt-BR', label: 'Português (BR)' },
  { code: 'ru-RU', label: 'Русский' },
];

// 取币种元数据
export function getCurrencyMeta(code: string, list: Currency[] = FALLBACK_CURRENCIES): Currency | undefined {
  return list.find((c) => c.code === code.toUpperCase());
}

// 格式化货币
export function formatMoney(
  amount: number | string,
  currency: string = 'CNY',
  locale: string = 'zh-CN',
): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '-';
  const meta = getCurrencyMeta(currency);
  const symbol = meta?.symbol || currency;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${symbol}${num.toFixed(2)}`;
  }
}

// 简化显示 (不带货币符号, 仅数字带千分位)
export function formatNumber(amount: number | string, locale: string = 'zh-CN', fractionDigits = 2): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '-';
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(num);
  } catch {
    return num.toFixed(fractionDigits);
  }
}

// useCurrencyConverter: 异步换算 hook
export function useCurrencyConverter(
  amount: number,
  from: string,
  to: string,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['currency-convert', amount, from, to],
    enabled: enabled && amount > 0 && !!from && !!to,
    queryFn: () => i18nApi.convert({ amount, from, to }),
    staleTime: 5 * 60 * 1000, // 5 分钟内不重复请求
  });
}

// useCurrencies: 获取币种列表
export function useCurrencies() {
  return useQuery({
    queryKey: ['i18n-currencies'],
    queryFn: () => i18nApi.currencies(),
    staleTime: 60 * 60 * 1000, // 1 小时
    initialData: FALLBACK_CURRENCIES,
  });
}
