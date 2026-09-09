// Translation types
export interface TranslationDict {
  common: Record<string, string>;
  menu: Record<string, string>;
  pageTitle: Record<string, string>;
  dashboard: Record<string, string>;
  tenantIsolation: Record<string, string>;
  auth: Record<string, string>;
  order: Record<string, string>;
  product: Record<string, string>;
  settings: Record<string, string>;
}

export type LocaleCode = 'zh-CN' | 'en-US' | 'ja-JP' | 'ko-KR' | 'fr-FR' | 'de-DE' | 'es-ES' | 'pt-BR' | 'ru-RU';

export type TranslationKey = 
  | `common.${keyof TranslationDict['common']}`
  | `menu.${keyof TranslationDict['menu']}`
  | `pageTitle.${keyof TranslationDict['pageTitle']}`
  | `dashboard.${keyof TranslationDict['dashboard']}`
  | `tenantIsolation.${keyof TranslationDict['tenantIsolation']}`
  | `auth.${keyof TranslationDict['auth']}`
  | `order.${keyof TranslationDict['order']}`
  | `product.${keyof TranslationDict['product']}`
  | `settings.${keyof TranslationDict['settings']}`;
