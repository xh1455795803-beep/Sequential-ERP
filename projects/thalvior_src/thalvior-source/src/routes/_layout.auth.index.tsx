import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Loader2,
  ShieldCheck,
  Trash2,
  KeyRound,
  Puzzle,
  Search,
  RefreshCw,
  Pencil,
  MoreHorizontal,
  Radar,
  ExternalLink,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { PlatformLogo } from "@/components/platform-logo";
import { StatusBadge } from "@/components/status-badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchTable, type ExtRow } from "@/lib/data-access";
import { isActiveAuthStatus } from "@/lib/shop-status";
import { saveManualAuth, listMyAuthWithQuota, deleteMyAuth, statusScanShop, updateShopProfile } from "@/services/shopOAuth";
// AuthSourcePage 已合并到 AuthShopTab（authorize-shop 统一入口）
import { getSyncStatus, syncShopNow, listSyncPlatforms } from "@/services/orderSyncService";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tt, tk } from "@/i18n/tts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { devLog } from "@/lib/devlog";

export const Route = createFileRoute("/_layout/auth/")({
  component: AuthCenter,
});

// ===== 平台配置 =====
// 授权类型标记统一从开发者后台 platform_configs 表读取（auth_type: oauth / manual），
// 并叠加 platform_auth_config.oauth_ready 就绪标记：声明为 oauth 但后端未就绪（缺密钥/未接入）的平台
// 一律降级为 manual 手动凭据表单（凭据经平台 API 真实验证通过才入库，未开通校验的平台会被拒绝），绝不让用户点进报错的 OAuth 流程。
// 前端不写死板块归属；后台表为空或读取失败时使用下面的内置兜底配置，保证页面可用。
export type PlatformCfg = {
  name: string;
  region: string;
  store_note?: string;
  auth_type: "oauth" | "manual";
  status?: string;
  oauth_ready?: boolean;
  shop_types?: string[];
};

const fallbackPlatforms: PlatformCfg[] = [
  // 支持 OAuth 的平台卡片带「一键 OAuth」徽标；oauth_ready=false 表示后端密钥/接入待配置，按钮点击提示并转手动授权
  // region = 主力市场分组（P2-1）：北美/欧洲/东南亚/日韩/俄语区/中东/拉美/非洲/独立站建站/其他；region 为 NULL 的平台归「其他」
  // 归组说明：Temu/SHEIN 采用全托管/自营模式，主力消费市场为北美（美国为最大市场），故归「北美」；
  // AliExpress 全球多市场（俄/欧/拉美）无单一主力市场、Daraz 主力市场为南亚（未设南亚分组），均归「其他」
  { name: "Shopify", region: "src.storeBuilder", store_note: "src.standalone", auth_type: "oauth", oauth_ready: false },
  { name: "TikTok Shop", region: "region.sea", store_note: "src.shortVideo", auth_type: "oauth", oauth_ready: false },
  { name: "Lazada", region: "region.sea", store_note: "region.sea", auth_type: "oauth", oauth_ready: false },
  { name: "Shopee", region: "region.sea", store_note: "region.sea", auth_type: "oauth", oauth_ready: false },
  { name: "Amazon US", region: "region.na", store_note: "mkt.us", auth_type: "oauth", oauth_ready: false },
  { name: "Amazon JP", region: "region.jk", store_note: "mkt.jp", auth_type: "oauth", oauth_ready: false },
  { name: "Amazon EU", region: "region.eu", store_note: "mkt.eu", auth_type: "oauth", oauth_ready: false },
  { name: "eBay", region: "region.na", store_note: "mkt.globalAuction", auth_type: "oauth", oauth_ready: false },
  { name: "Walmart", region: "region.na", store_note: "mkt.usRetail", auth_type: "oauth", oauth_ready: false },
  { name: "Etsy", region: "region.na", store_note: "mkt.handmade", auth_type: "oauth", oauth_ready: false },
  { name: "Temu", region: "region.na", store_note: "chn.fullyManaged", auth_type: "oauth" },
  { name: "SHEIN", region: "region.na", store_note: "mkt.fastFashion", auth_type: "oauth" },
  { name: "AliExpress", region: "common.other", store_note: "mkt.ali", auth_type: "oauth" },
  { name: "Amazon CA", region: "region.na", store_note: "mkt.ca", auth_type: "oauth", oauth_ready: false },
  { name: "Amazon AU", region: "common.other", store_note: "mkt.au", auth_type: "oauth", oauth_ready: false },
  { name: "Mercado Libre", region: "region.latam", store_note: "mkt.latam", auth_type: "oauth", oauth_ready: false },
  { name: "Coupang", region: "region.jk", store_note: "mkt.kr", auth_type: "manual" },
  { name: "Noon", region: "region.me", store_note: "mkt.me", auth_type: "oauth", oauth_ready: false },
  { name: "Ozon", region: "region.ru", store_note: "src.ruEcom", auth_type: "manual" },
  { name: "Wildberries", region: "region.ru", store_note: "src.ruEcom", auth_type: "manual" },
  { name: "WooCommerce", region: "src.storeBuilder", store_note: "src.standalone", auth_type: "manual" },
  // 2026-10-11 扩充（对齐妙手 30+ 平台）：6 个已接官方 API 真实验证 + 5 个诚实"对接中"
  { name: "BigCommerce", region: "src.storeBuilder", store_note: "src.standalone", auth_type: "oauth", oauth_ready: false },
  { name: "Magento", region: "src.storeBuilder", store_note: "src.standalone", auth_type: "manual" },
  { name: "PrestaShop", region: "src.storeBuilder", store_note: "src.standalone", auth_type: "manual" },
  { name: "Allegro", region: "region.eu", store_note: "region.ee", auth_type: "oauth", oauth_ready: false },
  { name: "Kaufland", region: "region.eu", store_note: "region.de", auth_type: "manual" },
  { name: "Yandex Market", region: "region.ru", store_note: "src.ruEcom", auth_type: "oauth", oauth_ready: false },
  { name: "Wish", region: "region.na", store_note: "region.euus", auth_type: "oauth", oauth_ready: false },
  { name: "Wix", region: "src.storeBuilder", store_note: "src.standalone", auth_type: "oauth", oauth_ready: false },
  { name: "Daraz", region: "common.other", store_note: "region.sa", auth_type: "oauth" },
  { name: "Jumia", region: "region.africa", store_note: "region.africa", auth_type: "oauth", oauth_ready: false },
];

// 平台图标（官方 logo 优先，缺失时回退「首字母 + 渐变」芯片）统一由 @/components/platform-logo 提供，
// 让平台墙 / 店铺列表 / 添加店铺弹窗 / 货源授权四处视觉一致。

const emptyForm = {
  shop_name: "",
  platform: "Amazon US",
  region: "",
  shop_type: "cross",
  status: "已授权",
  creds: {} as Record<string, string>,
};

/** 根据平台 shop_types 推断默认店铺类型 */
function defaultShopType(p?: PlatformCfg): string {
  if (!p?.shop_types?.length) return "cross";
  if (p.shop_types.length === 1) return p.shop_types[0];
  if (p.shop_types.includes("cross")) return "cross";
  return p.shop_types[0];
}

// ===== 手动授权凭据字段（按平台差异） =====
// 保存前必须填写带 * 的字段；服务端会调平台官方端点真实校验：
// Amazon（含各站点）/Walmart/eBay/Etsy/Shopify 校验通过才标记「已授权」；
// 其余平台尚未开通直连校验，提交会被服务端拒绝，避免无效凭据入库。
// 字段清单优先读后台 platform_auth_config.cred_fields（可随平台调整，无需发版），
// 后台为空时回退下面的内置映射。
export type CredField = {
  key: string;
  labelKey: string;
  placeholderKey: string;
  required?: boolean;
  type?: "text" | "password";
};

// 授权引导条目（platform_configs.auth_guide 同构：summaryKey + stepKeys + doc / portal）
export type PlatformGuide = { summaryKey: string; stepKeys: string[]; doc?: string; portal?: string };


// 授权引导：内容按各平台官方文档核对（2026-10），能后台自助获取的引导去后台，需开放平台的给官方入口
// 授权引导：内容按各平台官方文档核对（2026-10），能后台自助获取的引导去后台，需开放平台的给官方入口
// 2026-10-12 i18n 审计修复：文案全部迁移到 translations.ts（auth.guide.*），zh 与原文一致，en 为地道英文
const platformGuides: Record<string, PlatformGuide> = {
  "Amazon US": { summaryKey: "auth.guide.amazonUs.summary", stepKeys: ["auth.guide.amazonUs.s1", "auth.guide.amazonUs.s2", "auth.guide.amazonUs.s3"], doc: "https://developer-docs.amazon.com/sp-api/docs/self-authorization" },
  "Amazon JP": { summaryKey: "auth.guide.amazonJp.summary", stepKeys: ["auth.guide.amazonJp.s1", "auth.guide.amazonJp.s2", "auth.guide.amazonJp.s3"], doc: "https://developer-docs.amazon.com/sp-api/docs/self-authorization" },
  "Amazon EU": { summaryKey: "auth.guide.amazonEu.summary", stepKeys: ["auth.guide.amazonEu.s1", "auth.guide.amazonEu.s2", "auth.guide.amazonEu.s3"], doc: "https://developer-docs.amazon.com/sp-api/docs/self-authorization" },
  "Amazon CA": { summaryKey: "auth.guide.amazonCa.summary", stepKeys: ["auth.guide.amazonCa.s1", "auth.guide.amazonCa.s2", "auth.guide.amazonCa.s3"], doc: "https://developer-docs.amazon.com/sp-api/docs/self-authorization" },
  "Amazon AU": { summaryKey: "auth.guide.amazonAu.summary", stepKeys: ["auth.guide.amazonAu.s1", "auth.guide.amazonAu.s2", "auth.guide.amazonAu.s3"], doc: "https://developer-docs.amazon.com/sp-api/docs/self-authorization" },
  Walmart: { summaryKey: "auth.guide.walmart.summary", stepKeys: ["auth.guide.walmart.s1", "auth.guide.walmart.s2", "auth.guide.walmart.s3"], doc: "https://developer.walmart.com/us-marketplace/docs/use-apis-as-a-marketplace-seller" },
  Etsy: { summaryKey: "auth.guide.etsy.summary", stepKeys: ["auth.guide.etsy.s1", "auth.guide.etsy.s2", "auth.guide.etsy.s3"], doc: "https://developer.etsy.com/documentation/essentials/authentication" },
  eBay: { summaryKey: "auth.guide.ebay.summary", stepKeys: ["auth.guide.ebay.s1", "auth.guide.ebay.s2", "auth.guide.ebay.s3", "auth.guide.ebay.s4"], doc: "https://developer.ebay.com/develop/guides/get-started-with-ebay-apis" },
  Shopify: { summaryKey: "auth.guide.shopify.summary", stepKeys: ["auth.guide.shopify.s1", "auth.guide.shopify.s2", "auth.guide.shopify.s3", "auth.guide.shopify.s4"], doc: "https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant" },
  WooCommerce: { summaryKey: "auth.guide.woocommerce.summary", stepKeys: ["auth.guide.woocommerce.s1", "auth.guide.woocommerce.s2", "auth.guide.woocommerce.s3"], doc: "https://woocommerce.com/document/woocommerce-rest-api/" },
  BigCommerce: { summaryKey: "auth.guide.bigcommerce.summary", stepKeys: ["auth.guide.bigcommerce.s1", "auth.guide.bigcommerce.s2", "auth.guide.bigcommerce.s3"], doc: "https://developer.bigcommerce.com/docs/start/authentication/api-accounts" },
  Magento: { summaryKey: "auth.guide.magento.summary", stepKeys: ["auth.guide.magento.s1", "auth.guide.magento.s2", "auth.guide.magento.s3"], doc: "https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token" },
  PrestaShop: { summaryKey: "auth.guide.prestashop.summary", stepKeys: ["auth.guide.prestashop.s1", "auth.guide.prestashop.s2", "auth.guide.prestashop.s3"], doc: "https://devdocs.prestashop-project.org/8/webservice/tutorials/creating-access/" },
  Ozon: { summaryKey: "auth.guide.ozon.summary", stepKeys: ["auth.guide.ozon.s1", "auth.guide.ozon.s2", "auth.guide.ozon.s3"], doc: "https://docs.ozon.ru/api/seller/" },
  Wildberries: { summaryKey: "auth.guide.wildberries.summary", stepKeys: ["auth.guide.wildberries.s1", "auth.guide.wildberries.s2", "auth.guide.wildberries.s3"], doc: "https://seller.wildberries.ru/instructions/ru/ru/material/how-to-create-update-or-delete-a-wb-api-token" },
  "Mercado Libre": { summaryKey: "auth.guide.mercadolibre.summary", stepKeys: ["auth.guide.mercadolibre.s1", "auth.guide.mercadolibre.s2", "auth.guide.mercadolibre.s3"], doc: "https://global-selling.mercadolibre.com/devsite/en_us/authentication-and-authorization-global-selling/create-application" },
  Coupang: { summaryKey: "auth.guide.coupang.summary", stepKeys: ["auth.guide.coupang.s1", "auth.guide.coupang.s2", "auth.guide.coupang.s3", "auth.guide.coupang.s4"], doc: "https://developers.coupangcorp.com/hc/zh-cn/articles/20288952179993-Issue-Open-API-Key-NEW" },
  Allegro: { summaryKey: "auth.guide.allegro.summary", stepKeys: ["auth.guide.allegro.s1", "auth.guide.allegro.s2", "auth.guide.allegro.s3"], doc: "https://developer.allegro.pl/tutorials/uwierzytelnianie-i-autoryzacja-zlq9e75GdIR" },
  Kaufland: { summaryKey: "auth.guide.kaufland.summary", stepKeys: ["auth.guide.kaufland.s1", "auth.guide.kaufland.s2"], doc: "https://sellerapi.kaufland.com/?page=rest-api" },
  "Yandex Market": { summaryKey: "auth.guide.yandexMarket.summary", stepKeys: ["auth.guide.yandexMarket.s1", "auth.guide.yandexMarket.s2", "auth.guide.yandexMarket.s3"], doc: "https://yandex.ru/dev/market/partner-api/doc/ru/" },
  Wish: { summaryKey: "auth.guide.wish.summary", stepKeys: ["auth.guide.wish.s1", "auth.guide.wish.s2", "auth.guide.wish.s3"], doc: "https://china-merchant.wish.com/documentation/api/v3/oauth" },
  Wix: { summaryKey: "auth.guide.wix.summary", stepKeys: ["auth.guide.wix.s1", "auth.guide.wix.s2", "auth.guide.wix.s3"], doc: "https://dev.wix.com/docs/develop-websites-sdk/code-your-site/authorization/generate-an-api-key" },
  Jumia: { summaryKey: "auth.guide.jumia.summary", stepKeys: ["auth.guide.jumia.s1", "auth.guide.jumia.s2", "auth.guide.jumia.s3"], doc: "https://vendorcenter.jumia.com/api-docs/" },
  "TikTok Shop": { summaryKey: "auth.guide.tiktokShop.summary", stepKeys: ["auth.guide.tiktokShop.s1", "auth.guide.tiktokShop.s2", "auth.guide.tiktokShop.s3"], portal: "https://partner.tiktokshop.com/" },
  Shopee: { summaryKey: "auth.guide.shopee.summary", stepKeys: ["auth.guide.shopee.s1", "auth.guide.shopee.s2", "auth.guide.shopee.s3"], portal: "https://open.shopee.com/" },
  Lazada: { summaryKey: "auth.guide.lazada.summary", stepKeys: ["auth.guide.lazada.s1", "auth.guide.lazada.s2", "auth.guide.lazada.s3"], portal: "https://open.lazada.com/" },
  Temu: { summaryKey: "auth.guide.temu.summary", stepKeys: ["auth.guide.temu.s1", "auth.guide.temu.s2", "auth.guide.temu.s3"], portal: "https://partner.temu.com/" },
  SHEIN: { summaryKey: "auth.guide.shein.summary", stepKeys: ["auth.guide.shein.s1", "auth.guide.shein.s2", "auth.guide.shein.s3"], portal: "https://open.sheincorp.cn/" },
  AliExpress: { summaryKey: "auth.guide.aliexpress.summary", stepKeys: ["auth.guide.aliexpress.s1", "auth.guide.aliexpress.s2", "auth.guide.aliexpress.s3"], portal: "https://open.aliexpress.com/" },
  Daraz: { summaryKey: "auth.guide.daraz.summary", stepKeys: ["auth.guide.daraz.s1", "auth.guide.daraz.s2", "auth.guide.daraz.s3"], portal: "https://iopaccount.daraz.com/" },
  Noon: { summaryKey: "auth.guide.noon.summary", stepKeys: ["auth.guide.noon.s1", "auth.guide.noon.s2", "auth.guide.noon.s3"], doc: "https://developers.noon.market/" },
  Cdiscount: { summaryKey: "auth.guide.cdiscount.summary", stepKeys: ["auth.guide.cdiscount.s1", "auth.guide.cdiscount.s2", "auth.guide.cdiscount.s3"], doc: "https://developer.octopia-io.net/" },
  Salla: { summaryKey: "auth.guide.salla.summary", stepKeys: ["auth.guide.salla.s1", "auth.guide.salla.s2", "auth.guide.salla.s3"], doc: "https://documentation.salla.dev/" },
  Shopline: { summaryKey: "auth.guide.shopline.summary", stepKeys: ["auth.guide.shopline.s1", "auth.guide.shopline.s2", "auth.guide.shopline.s3"], doc: "https://developers.shopline.com/" },
  ShopBase: { summaryKey: "auth.guide.shopbase.summary", stepKeys: ["auth.guide.shopbase.s1", "auth.guide.shopbase.s2", "auth.guide.shopbase.s3"], doc: "https://developer.shopbase.com/" },
  "店匠 Shoplazza": { summaryKey: "auth.guide.shoplazza.summary", stepKeys: ["auth.guide.shoplazza.s1", "auth.guide.shoplazza.s2", "auth.guide.shoplazza.s3"], doc: "https://open.shoplazza.com/" },
  Joom: { summaryKey: "auth.guide.joom.summary", stepKeys: ["auth.guide.joom.s1", "auth.guide.joom.s2", "auth.guide.joom.s3"], doc: "https://partner.joom.com/" },
  Tiki: { summaryKey: "auth.guide.tiki.summary", stepKeys: ["auth.guide.tiki.s1", "auth.guide.tiki.s2", "auth.guide.tiki.s3"], doc: "https://partner.tiki.vn/" },
  AllValue: { summaryKey: "auth.guide.allvalue.summary", stepKeys: ["auth.guide.allvalue.s1", "auth.guide.allvalue.s2", "auth.guide.allvalue.s3"], doc: "https://www.allvalue.com/" },
  "京东国际": { summaryKey: "auth.guide.jdIntl.summary", stepKeys: ["auth.guide.jdIntl.s1", "auth.guide.jdIntl.s2", "auth.guide.jdIntl.s3"], doc: "https://jos.jd.com/" },
  "京东印尼": { summaryKey: "auth.guide.jdId.summary", stepKeys: ["auth.guide.jdId.s1", "auth.guide.jdId.s2", "auth.guide.jdId.s3"], doc: "https://jos.jd.com/" },
  Miravia: { summaryKey: "auth.guide.miravia.summary", stepKeys: ["auth.guide.miravia.s1", "auth.guide.miravia.s2", "auth.guide.miravia.s3"], doc: "https://open.miravia.com/" },
  "Alibaba 国际站": { summaryKey: "auth.guide.alibaba.summary", stepKeys: ["auth.guide.alibaba.s1", "auth.guide.alibaba.s2", "auth.guide.alibaba.s3"], doc: "https://open.alibaba.com/" },
  OTTO: { summaryKey: "auth.guide.otto.summary", stepKeys: ["auth.guide.otto.s1", "auth.guide.otto.s2", "auth.guide.otto.s3"], doc: "https://developer.otto.de/" },
};

// 授权引导：内容按各平台官方文档核对（2026-10）
const manualCredFields: Record<string, CredField[]> = {
  Shopify: [
    { key: "shop_domain", labelKey: "auth.cred.shopDomain", placeholderKey: "auth.cred.shopifyDomainPh", required: true },
    { key: "access_token", labelKey: "auth.cred.accessToken", placeholderKey: "auth.cred.accessTokenPh", required: true },
  ],
  "TikTok Shop": [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Lazada: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Shopee: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  "Amazon US": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  "Amazon JP": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  "Amazon EU": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  Walmart: [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.walmartClientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.walmartClientSecretPh", required: true },
  ],
  Etsy: [
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.etsyApiKeyPh", required: true },
  ],
  eBay: [
    { key: "app_id", labelKey: "auth.cred.appId", placeholderKey: "auth.cred.appIdPh", required: true },
    { key: "cert_id", labelKey: "auth.cred.certId", placeholderKey: "auth.cred.certIdPh", required: true },
    { key: "dev_id", labelKey: "auth.cred.devId", placeholderKey: "auth.cred.devIdPh", required: true },
    { key: "auth_token", labelKey: "auth.cred.authToken", placeholderKey: "auth.cred.authTokenPh", required: true },
  ],
  "Amazon CA": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  "Amazon AU": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  "Mercado Libre": [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  Coupang: [
    { key: "access_key", labelKey: "auth.cred.accessKey", placeholderKey: "auth.cred.accessKeyPh", required: true },
    { key: "secret_key", labelKey: "auth.cred.secretKey", placeholderKey: "auth.cred.secretKeyPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  BigCommerce: [
    { key: "store_hash", labelKey: "auth.cred.storeHash", placeholderKey: "auth.cred.storeHashPh", required: true },
    { key: "access_token", labelKey: "auth.cred.accessToken", placeholderKey: "auth.cred.bcTokenPh", required: true },
  ],
  Magento: [
    { key: "store_domain", labelKey: "auth.cred.storeDomain", placeholderKey: "auth.cred.storeDomainPh", required: true },
    { key: "access_token", labelKey: "auth.cred.accessToken", placeholderKey: "auth.cred.magentoTokenPh", required: true },
  ],
  PrestaShop: [
    { key: "store_domain", labelKey: "auth.cred.storeDomain", placeholderKey: "auth.cred.storeDomainPh", required: true },
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.prestaKeyPh", required: true },
  ],
  Allegro: [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.refreshTokenPh", required: true },
  ],
  Kaufland: [
    { key: "client_key", labelKey: "auth.cred.clientKey", placeholderKey: "auth.cred.clientKeyPh", required: true },
    { key: "secret_key", labelKey: "auth.cred.secretKey", placeholderKey: "auth.cred.secretKeyPh", required: true },
  ],
  Jumia: [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.jumiaClientIdPh", required: true },
    { key: "refresh_token", labelKey: "auth.cred.refreshToken", placeholderKey: "auth.cred.jumiaTokenPh", required: true },
  ],
  Wish: [
    { key: "access_token", labelKey: "auth.cred.accessToken", placeholderKey: "auth.cred.wishTokenPh", required: true },
  ],
  Wix: [
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.wixKeyPh", required: true },
    { key: "account_id", labelKey: "auth.cred.accountId", placeholderKey: "auth.cred.accountIdPh", required: true },
  ],
  "Yandex Market": [
    { key: "oauth_token", labelKey: "auth.cred.oauthToken", placeholderKey: "auth.cred.oauthTokenPh", required: true },
  ],
  Noon: [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Ozon: [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.ozonClientIdPh", required: true },
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.ozonApiKeyPh", required: true },
  ],
  Wildberries: [
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.wbApiKeyPh", required: true },
  ],
  WooCommerce: [
    { key: "shop_domain", labelKey: "auth.cred.shopDomain", placeholderKey: "auth.cred.shopDomainPh", required: true },
    { key: "consumer_key", labelKey: "auth.cred.consumerKey", placeholderKey: "auth.cred.consumerKeyPh", required: true },
    { key: "consumer_secret", labelKey: "auth.cred.consumerSecret", placeholderKey: "auth.cred.consumerSecretPh", required: true },
  ],
  Fnac: [
    { key: "api_key", labelKey: "auth.cred.apiKey", placeholderKey: "auth.cred.miraklKeyPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Rakuten: [
    { key: "service_secret", labelKey: "auth.cred.serviceSecret", placeholderKey: "auth.cred.serviceSecretPh", required: true },
    { key: "license_key", labelKey: "auth.cred.licenseKey", placeholderKey: "auth.cred.licenseKeyPh", required: true },
  ],
  Wayfair: [
    { key: "client_id", labelKey: "auth.cred.clientId", placeholderKey: "auth.cred.clientIdPh", required: true },
    { key: "client_secret", labelKey: "auth.cred.clientSecret", placeholderKey: "auth.cred.clientSecretPh", required: true },
    { key: "seller_account", labelKey: "auth.cred.sellerAccount", placeholderKey: "auth.cred.sellerAccountPh", required: true },
  ],
  Voghion: [
    { key: "token", labelKey: "auth.cred.accessToken", placeholderKey: "auth.cred.voghionTokenPh", required: true },
  ],
  UEESHOP: [
    { key: "access_key_id", labelKey: "auth.cred.accessKey", placeholderKey: "auth.cred.ueeshopAkPh", required: true },
    { key: "access_key_secret", labelKey: "auth.cred.secretKey", placeholderKey: "auth.cred.ueeshopSkPh", required: true },
    { key: "api_url", labelKey: "auth.cred.apiUrl", placeholderKey: "auth.cred.ueeshopUrlPh", required: true },
  ],
  Shopyy: [
    { key: "token", labelKey: "auth.cred.accessToken", placeholderKey: "auth.cred.shopyyTokenPh", required: true },
    { key: "shop_domain", labelKey: "auth.cred.storeDomain", placeholderKey: "auth.cred.storeDomainPh", required: true },
  ],
  "敦煌网 DHgate": [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
  ],
  OnBuy: [
    { key: "consumer_key", labelKey: "auth.cred.consumerKey", placeholderKey: "auth.cred.consumerKeyPh", required: true },
    { key: "secret_key", labelKey: "auth.cred.secretKey", placeholderKey: "auth.cred.secretKeyPh", required: true },
    { key: "seller_id", labelKey: "auth.cred.sellerId", placeholderKey: "auth.cred.onbuySellerIdPh", required: true },
  ],
  eMAG: [
    { key: "username", labelKey: "auth.cred.username", placeholderKey: "auth.cred.emagUserPh", required: true },
    { key: "password", labelKey: "auth.cred.password", placeholderKey: "auth.cred.passwordPh", required: true },
  ],
  Zalando: [
    { key: "partner_id", labelKey: "auth.cred.partnerId", placeholderKey: "auth.cred.zalandoPartnerPh", required: true },
    { key: "api_token", labelKey: "auth.cred.apiToken", placeholderKey: "auth.cred.zalandoTokenPh", required: true },
  ],
  "B2W Americanas": [
    { key: "app_key", labelKey: "auth.cred.appKey", placeholderKey: "auth.cred.appKeyPh", required: true },
    { key: "app_secret", labelKey: "auth.cred.appSecret", placeholderKey: "auth.cred.appSecretPh", required: true },
  ],
};

// 支持平台官方端点真实校验的平台（与后端 authorize-shop checkManualPlatform 保持一致）：
// Amazon 全站点/Walmart/eBay/Etsy/Shopify/Ozon/Wildberries/Mercado Libre/Coupang/WooCommerce
// 均走平台官方 API 真实校验，凭据无效直接拒绝；
// Temu/SHEIN/AliExpress/Noon 等无公开 API 或 OAuth 待配置平台不可授权
const VERIFIABLE_PLATFORMS = new Set([
  "Amazon US", "Amazon JP", "Amazon EU", "Amazon CA", "Amazon AU",
  "Walmart", "Etsy", "eBay", "Shopify",
  "Ozon", "Wildberries", "Mercado Libre", "Coupang", "WooCommerce",
  "BigCommerce", "Magento", "PrestaShop", "Allegro", "Kaufland", "Yandex Market",
  "Wish", "Wix", "Jumia",
]);
// ════════════════════════════════════════════════════════════════════════
//  店铺授权工作台（妙手式布局：概览条 → 平台墙 → 店铺列表）
//
//  设计口径（对齐妙手跨境 ERP 的授权页，同时坚持本项目"只说真话"的底线）：
//    1. 平台墙一屏看全：搜索 + 地区/状态筛选取代原来的分组长列表，
//       tile 上直接标出「已授权 N 家 / 手动授权 / 一键授权 / 对接中」与订单同步是否接通。
//    2. 添加授权弹窗 = 左侧填表（店铺类型 / 站点 / 名称 / 凭据）+ 右侧「如何获取凭据」引导，
//       凭据字段优先读后台 platform_auth_config.cred_fields，引导优先读 platform_configs.auth_guide，
//       后台没配才回退内置常量，改平台不用发版。
//    3. 店铺列表就是操作台：立即同步（真调 sync-orders）、状态检测（真调 shop-status-check）、
//       编辑档案（真调 shop-update）、重新授权、解绑，并把每店同步水位与结果如实显示。
//    4. 绝不编造状态：未接入订单同步的平台不显示水位；未接入真实校验的平台不给录入入口。
// ════════════════════════════════════════════════════════════════════════

const SHOP_TYPES = [
  { value: "cross", key: "auth.ms.typeCross" },
  { value: "local", key: "auth.ms.typeLocal" },
  { value: "full", key: "auth.ms.typeFull" },
  { value: "standalone", key: "auth.ms.typeStandalone" },
];

type SyncCell = { last_synced_at: string | null; last_status: string | null; last_error: string | null };
type QuotaInfo = { quota: number; used: number; freeLimit: number; purchased: number };
type Translate = (key: string, vars?: Record<string, string | number>) => string;

const pad2 = (n: number) => String(n).padStart(2, "0");

function fmtDate(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 到期剩余天数（无到期时间 = null，表示长期有效） */
function daysLeft(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const ts = new Date(s).getTime();
  if (Number.isNaN(ts)) return null;
  return Math.round((ts - Date.now()) / 86400000);
}

/** 相对时间（最近同步列用）：刚刚 / N 分钟前 / N 小时前 / N 天前 / 具体日期 */
function relText(v: unknown, t: Translate): string {
  const s = String(v ?? "").trim();
  if (!s) return t("auth.ms.neverSynced");
  const ts = new Date(s).getTime();
  if (Number.isNaN(ts)) return s;
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return t("auth.ms.justNow");
  if (min < 60) return t("auth.ms.minAgo", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("auth.ms.hourAgo", { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t("auth.ms.dayAgo", { n: d });
  return fmtDate(s);
}

function AuthShopTab() {
  const { t } = useLanguage();

  // ── 数据 ──
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [platforms, setPlatforms] = useState<PlatformCfg[]>(fallbackPlatforms);
  const [credMap, setCredMap] = useState<Record<string, CredField[]>>({});
  const [guideMap, setGuideMap] = useState<Record<string, PlatformGuide>>({});
  const [siteMap, setSiteMap] = useState<Record<string, string[]>>({});
  // 后台可覆盖的平台图标（platform_configs.logo_url）；未配置时组件回退内置 PLATFORM_LOGOS / 字母芯片
  const [logoMap, setLogoMap] = useState<Record<string, string>>({});
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [syncCells, setSyncCells] = useState<Record<string, SyncCell>>({});
  const [syncLive, setSyncLive] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cfgLoading, setCfgLoading] = useState(true);

  // ── 筛选 ──
  const [q, setQ] = useState("");
  const [regionFilter, setRegionFilter] = useState("all");
  const [authFilter, setAuthFilter] = useState<"all" | "authed" | "unauth" | "soon">("all");
  const [showSoon, setShowSoon] = useState(false);
  const [shopQ, setShopQ] = useState("");

  // ── 弹窗 / 进行中 ──
  const [addFor, setAddFor] = useState<PlatformCfg | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [guideFor, setGuideFor] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<ExtRow | null>(null);
  const [editForm, setEditForm] = useState({ shop_alias: "", shop_type: "cross", region: "", remark: "", notify: true });
  const [deleting, setDeleting] = useState<ExtRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 服务端错误码 → 双语提示（i18n 铁律：英文界面不得直接显示中文错误原文）
  const authErrorText = (e: unknown, fallback: string): string => {
    const code = (e as { code?: string } | null | undefined)?.code;
    const map: Record<string, string> = {
      SHOP_LICENSE_REQUIRED: "auth.err.shopLicenseRequired",
      NOT_CONFIGURED: "auth.err.shopListNotConfigured",
      MISSING_TEMPLATE_VARS: "auth.err.missingTemplateVars",
      STATUS_CHECK_UNAVAILABLE: "auth.err.statusCheckUnavailable",
    };
    const key = code ? map[code] : undefined;
    if (key) return t(key);
    return e instanceof Error && e.message ? e.message : fallback;
  };

  const load = () => {
    listMyAuthWithQuota()
      .then(({ items, quota: qq }) => {
        setRows(items as ExtRow[]);
        // 授权额度口径统一由服务端返回（免费额度读 platform_auth_config，已购额度读 shop_licenses）
        if (qq) setQuota(qq);
      })
      .catch((e) => console.error("[auth] 加载店铺授权失败", e))
      .finally(() => setLoading(false));
  };

  // 各店同步水位 + 已接通订单同步引擎的平台清单（清单来自 sync-orders 适配器注册表，前端不写死）
  const loadSync = () => {
    getSyncStatus()
      .then((r) => {
        const cells: Record<string, SyncCell> = {};
        (r.shops ?? []).forEach((s) => {
          const id = String((s as { id?: string }).id ?? "");
          if (!id) return;
          const st = (s as { shop_sync_state?: Partial<SyncCell> | null }).shop_sync_state;
          cells[id] = {
            last_synced_at: st?.last_synced_at ?? null,
            last_status: st?.last_status ?? null,
            last_error: st?.last_error ?? null,
          };
        });
        setSyncCells(cells);
        setSyncLive(r.supported_platforms ?? []);
      })
      .catch((e) => console.warn("[auth] 同步水位读取失败（平台墙不显示同步徽标，不编造）", e));
    listSyncPlatforms()
      .then((list) => setSyncLive((list ?? []).map((p) => p.label)))
      .catch(() => { /* getSyncStatus 已带回 supported_platforms，失败不影响 */ });
  };

  // 平台配置：platform_configs（名称/地区/授权类型/引导/站点）+ platform_auth_config（oauth_ready/凭据字段）
  const loadPlatforms = () => {
    Promise.all([
      fetchTable("platform_configs").catch(() => [] as ExtRow[]),
      fetchTable("platform_auth_config").catch(() => [] as ExtRow[]),
    ])
      .then(([cfgs, authCfgs]) => {
        const readyMap: Record<string, boolean> = {};
        const credM: Record<string, CredField[]> = {};
        authCfgs.forEach((r) => {
          const key = String(r.platform_key ?? "");
          if (!key) return;
          readyMap[key] = r.oauth_ready === true || String(r.oauth_ready) === "true";
          const raw = Array.isArray(r.cred_fields) ? (r.cred_fields as Array<Record<string, unknown>>) : [];
          const fields = raw
            .filter((f) => f && typeof f.key === "string" && typeof f.labelKey === "string")
            .map((f) => ({
              key: String(f.key),
              labelKey: String(f.labelKey),
              placeholderKey: String(f.placeholderKey ?? f.labelKey),
              required: f.required !== false,
              type: (f.type === "password" ? "password" : "text") as "text" | "password",
            }));
          if (fields.length) credM[key] = fields;
        });

        const guideM: Record<string, PlatformGuide> = {};
        const siteM: Record<string, string[]> = {};
        const logoM: Record<string, string> = {};
        cfgs.forEach((r) => {
          const name = String(r.name ?? "");
          if (!name) return;
          const g = r.auth_guide;
          if (g && typeof g === "object" && typeof (g as PlatformGuide).summaryKey === "string") {
            guideM[name] = g as PlatformGuide;
          }
          const sites = Array.isArray(r.sites) ? (r.sites as Array<unknown>) : [];
          const labels = sites
            .map((s) => (typeof s === "string" ? s : String((s as Record<string, unknown>)?.label ?? "")))
            .filter(Boolean);
          if (labels.length) siteM[name] = labels;
          const lg = String(r.logo_url ?? "").trim();
          if (lg) logoM[name] = lg;
        });

        const list: PlatformCfg[] = cfgs
          .filter((r) => String(r.status ?? tt("st.enabled")) !== "停用")
          .map((r) => {
            const name = String(r.name ?? "");
            const st = Array.isArray(r.shop_types) ? (r.shop_types as Array<unknown>).map(String) : undefined;
            return {
              name,
              region: String(r.region ?? ""),
              store_note: String(r.store_note ?? ""),
              auth_type: r.auth_type === "oauth" ? ("oauth" as const) : ("manual" as const),
              status: String(r.status ?? tt("st.enabled")),
              oauth_ready: readyMap[name] ?? false,
              shop_types: st?.length ? st : undefined,
            };
          })
          .filter((p) => p.name);

        setPlatforms(list.length > 0 ? list : fallbackPlatforms);
        setCredMap(credM);
        setGuideMap(guideM);
        setSiteMap(siteM);
        setLogoMap(logoM);
      })
      .catch((e) => {
        console.error("[auth] 加载平台配置失败，使用内置兜底", e);
        setPlatforms(fallbackPlatforms);
      })
      .finally(() => setCfgLoading(false));
  };

  useEffect(() => {
    load();
    loadSync();
    loadPlatforms();
    // 授权额度不在前端拼装：免费额度与已购额度统一由 authorize-shop EF 计算后随 list 一并返回
  }, []);

  // ── 派生 ──
  const shopNameOf = (r: ExtRow) => String(r.shop_alias || r.shop_name || "");
  const authorizedCount = rows.filter((r) => isActiveAuthStatus(r.status)).length;
  const expiringCount = rows.filter((r) => {
    if (!isActiveAuthStatus(r.status)) return false;
    const d = daysLeft(r.token_expires_at);
    return d !== null && d >= 0 && d <= 30;
  }).length;

  const authedByPlatform = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => {
      if (!isActiveAuthStatus(r.status)) return;
      const p = String(r.platform ?? "");
      m[p] = (m[p] ?? 0) + 1;
    });
    return m;
  }, [rows]);

  // 该平台是否真的能授权：手动平台看后端是否接入真实校验，OAuth 平台看应用密钥是否就绪
  const canAuth = (p: PlatformCfg) =>
    p.auth_type === "oauth" ? !!p.oauth_ready : VERIFIABLE_PLATFORMS.has(p.name);

  const hasOrderSync = (name: string) =>
    syncLive.some((label) => name.toLowerCase().includes(label.toLowerCase()));

  const credFieldsOf = (name: string): CredField[] => credMap[name] ?? manualCredFields[name] ?? [];
  const guideOf = (name: string): PlatformGuide | undefined => guideMap[name] ?? platformGuides[name];

  const REGION_GROUP_ORDER = [
    tt("region.na"), tt("region.eu"), tt("mkt.global"), tt("region.sea"), tt("region.jk"),
    tt("region.ru"), tt("region.me"), tt("region.latam"), tt("region.africa"), tt("src.storeBuilder"), tt("common.other"),
  ];
  const regionOf = (p: PlatformCfg) => p.region || tt("common.other");

  // 地区筛选 chips 只列真实存在的分组，并按主力市场靠前排序
  const regionChips = useMemo(() => {
    const present = new Set(platforms.map(regionOf));
    const ordered = REGION_GROUP_ORDER.filter((r) => present.has(r));
    const extra = [...present].filter((r) => !REGION_GROUP_ORDER.includes(r));
    return [...ordered, ...extra];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platforms]);

  const wall = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return platforms.filter((p) => {
      if (kw && !(p.name.toLowerCase().includes(kw) || tk(p.name).toLowerCase().includes(kw))) return false;
      if (regionFilter !== "all" && regionOf(p) !== regionFilter) return false;
      const authed = (authedByPlatform[p.name] ?? 0) > 0;
      if (authFilter === "authed" && !authed) return false;
      if (authFilter === "unauth" && authed) return false;
      if (authFilter === "soon" && canAuth(p)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platforms, q, regionFilter, authFilter, authedByPlatform]);

  const shopRows = useMemo(() => {
    const kw = shopQ.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) =>
      [r.shop_name, r.shop_alias, r.platform, r.region].some((v) => String(v ?? "").toLowerCase().includes(kw)),
    );
  }, [rows, shopQ]);

  // 平台墙分两段：可授权（含已授权）在前，API 对接中在后折叠，默认收起
  const wallOpen = useMemo(() => wall.filter(canAuth), [wall]); // eslint-disable-line react-hooks/exhaustive-deps
  const wallSoon = useMemo(() => wall.filter((p) => !canAuth(p)), [wall]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 动作 ──
  const openManualForm = (p: PlatformCfg, rebind?: ExtRow) => {
    setForm({
      ...emptyForm,
      platform: p.name,
      shop_name: rebind ? String(rebind.shop_name ?? "") : "",
      region: rebind ? String(rebind.region ?? "") : "",
      shop_type: rebind ? String(rebind.shop_type ?? defaultShopType(p)) : defaultShopType(p),
      creds: {},
    });
    setAddFor(p);
  };

  const handlePick = (p: PlatformCfg, rebind?: ExtRow) => {
    if (p.auth_type === "oauth") {
      // OAuth 应用密钥未就绪：给官方入口与步骤引导，不放行进必失败的跳转
      if (p.oauth_ready) openManualForm(p, rebind);
      else setGuideFor(p.name);
      return;
    }
    if (!VERIFIABLE_PLATFORMS.has(p.name)) {
      toast.info(t("auth.manualNotOpen", { platform: p.name }));
      return;
    }
    openManualForm(p, rebind);
  };

  // 手动授权保存：必填校验 → 服务端直连平台 API 真实校验 → （可选）补写店铺类型
  const handleSave = async () => {
    if (!addFor) return;
    if (!form.shop_name.trim()) {
      toast.error(t("auth.shopNameRequired"));
      return;
    }
    const fields = credFieldsOf(addFor.name);
    for (const f of fields) {
      if (f.required !== false && !String(form.creds?.[f.key] ?? "").trim()) {
        toast.error(t("auth.credsRequired", { field: t(f.labelKey) }));
        return;
      }
    }
    setSaving(true);
    try {
      const data = await saveManualAuth({
        shop_name: form.shop_name.trim(),
        platform: form.platform,
        region: form.region.trim(),
        credentials: form.creds,
      });
      const newId = String(data.id ?? "");
      // 店铺类型是档案字段，cred-save 不接收；授权成功后补写，失败不回滚授权
      if (newId && form.shop_type !== "cross") {
        try {
          await updateShopProfile(newId, { shop_type: form.shop_type });
        } catch (e) {
          console.warn("[auth] 店铺类型写入失败（不影响授权结果）", e);
        }
      }
      if (String(data.status ?? "") === "待验证") toast.warning(t("auth.ms.savedPending"));
      else toast.success(t("auth.verifyPass"));
      setAddFor(null);
      setForm({ ...emptyForm });
      load();
      loadSync();
    } catch (e) {
      console.error("[auth] 新增授权失败", e);
      toast.error(authErrorText(e, t("auth.verifyCredFail")));
    } finally {
      setSaving(false);
    }
  };

  const doSync = async (row: ExtRow) => {
    setBusyId(row.id);
    try {
      const r = await syncShopNow(row.id);
      const name = shopNameOf(row);
      if (r.ok) toast.success(t("auth.ms.syncOk", { shop: name, fetched: r.fetched, inserted: r.inserted, updated: r.updated }));
      else toast.error(t("auth.ms.syncFail", { shop: name, reason: r.error || t("auth.ms.syncUnknownErr") }));
      loadSync();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("auth.ms.syncFail", { shop: shopNameOf(row), reason: t("auth.ms.syncUnknownErr") }));
    } finally {
      setBusyId(null);
    }
  };

  const doStatusCheck = async (row: ExtRow) => {
    setBusyId(row.id);
    try {
      const d = await statusScanShop([row.id]);
      const results = Array.isArray(d.results) ? (d.results as Array<Record<string, unknown>>) : [];
      const st = results.length ? String(results[0].shop_status ?? "") : "";
      if (d.degraded === true) toast.warning(t("auth.ms.checkDegraded", { reason: String(d.degraded_reason ?? "") }));
      else if (st) toast.success(t("auth.ms.checkDone", { status: tk(st) }));
      else toast.info(t("auth.ms.checkDonePlain"));
      load();
      loadSync();
    } catch (e) {
      toast.error(authErrorText(e, t("auth.ms.checkFail")));
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = (row: ExtRow) => {
    setEditForm({
      shop_alias: String(row.shop_alias ?? ""),
      shop_type: String(row.shop_type ?? "cross"),
      region: String(row.region ?? ""),
      remark: String(row.remark ?? ""),
      notify: row.notify_enabled !== false,
    });
    setEditFor(row);
  };

  const handleEditSave = async () => {
    if (!editFor) return;
    setSaving(true);
    try {
      await updateShopProfile(editFor.id, {
        shop_alias: editForm.shop_alias.trim() || null,
        shop_type: editForm.shop_type,
        region: editForm.region.trim(),
        remark: editForm.remark.trim() || null,
        notify_enabled: editForm.notify,
      });
      toast.success(t("auth.ms.saved"));
      setEditFor(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed", { reason: "" }));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteMyAuth(deleting.id);
      devLog("[auth] 删除授权成功", { id: deleting.id });
      toast.success(t("common.deleted"));
      setDeleting(null);
      load();
      loadSync();
    } catch (e) {
      console.error("[auth] 删除授权失败", e);
      setDeleting(null);
      toast.error(authErrorText(e, t("common.failed", { reason: e instanceof Error ? e.message : "" })));
    }
  };

  // ── 渲染：平台 tile（妙手式竖排：图标芯片 + 平台名 + 状态行） ──
  const renderTile = (p: PlatformCfg) => {
    const n = authedByPlatform[p.name] ?? 0;
    const open = canAuth(p);
    const live = hasOrderSync(p.name);
    return (
      <button
        key={p.name}
        type="button"
        onClick={() => handlePick(p)}
        title={guideOf(p.name) ? t(guideOf(p.name)!.summaryKey) : undefined}
        className={cn(
          "group flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2.5 text-center transition-all duration-200",
          n > 0
            ? "border-success/30 bg-success-bg/40 hover:border-success/50"
            : open
              ? "border-border bg-card hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lift"
              : "border-dashed border-border bg-surface-sunken/60",
        )}
      >
        <PlatformLogo name={p.name} logoUrl={logoMap[p.name]} size="md" />
        <span className="w-full truncate text-[12.5px] font-medium leading-4 text-fg">{tk(p.name)}</span>
        <span className={cn("w-full truncate text-[11px] leading-4", n > 0 ? "text-success" : open ? "text-fg-muted" : "text-fg-subtle")}>
          {n > 0 ? t("auth.ms.shopsN", { n }) : open ? (p.auth_type === "oauth" ? t("auth.ms.tagOAuth") : t("auth.ms.tagManual")) : t("auth.notOpenBtn")}
        </span>
        {/* 只标好消息：订单同步真的接通才显示徽标，未接通不占位、不制造满屏灰字 */}
        {live && open && (
          <span className="rounded-full bg-info-bg px-1.5 py-px text-[10px] font-medium leading-4 text-info">
            {t("auth.ms.tagSyncLive")}
          </span>
        )}
      </button>
    );
  };

  // ── 渲染：店铺列表行 ──
  const renderShopRow = (row: ExtRow) => {
    const p = String(row.platform ?? "");
    const alias = String(row.shop_alias ?? "").trim();
    const name = alias || String(row.shop_name ?? "");
    const cell = syncCells[row.id];
    const live = hasOrderSync(p);
    const dl = daysLeft(row.token_expires_at);
    const active = isActiveAuthStatus(row.status);
    const busy = busyId === row.id;
    return (
      <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/50">
        <td className="px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <PlatformLogo name={p} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-fg">{name}</div>
              <div className="truncate text-[11px] text-fg-subtle">
                {p}
                {alias ? ` · ${String(row.shop_name ?? "")}` : ""}
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-2.5 text-[12.5px] text-fg-muted">
          {shopTypeLabel(String(row.shop_type ?? "cross"), t)}
        </td>
        <td className="hidden px-3 py-2.5 text-[12.5px] text-fg-muted lg:table-cell">
          {String(row.region ?? "") || "—"}
        </td>
        <td className="px-3 py-2.5"><StatusBadge status={String(row.status ?? "未授权")} /></td>
        <td className="hidden px-3 py-2.5 text-[12.5px] md:table-cell">
          {dl === null ? (
            <span className="text-fg-subtle">{t("auth.ms.longValid")}</span>
          ) : dl < 0 ? (
            <span className="text-destructive">{t("auth.ms.expiredDays", { n: Math.abs(dl) })}</span>
          ) : dl <= 30 ? (
            <span className="text-warning">{fmtDate(row.token_expires_at)} · {t("auth.ms.daysLeft", { n: dl })}</span>
          ) : (
            <span className="text-fg-muted">{fmtDate(row.token_expires_at)}</span>
          )}
        </td>
        <td className="hidden px-3 py-2.5 text-[12.5px] xl:table-cell">
          {!live ? (
            <span className="text-fg-subtle">{t("auth.ms.syncNotOpen")}</span>
          ) : !cell || !cell.last_synced_at ? (
            <span className="text-fg-subtle">{t("auth.ms.neverSynced")}</span>
          ) : (
            <div className="min-w-0">
              <div className={cn("truncate", cell.last_status === "失败" ? "text-destructive" : "text-fg-muted")}>
                {relText(cell.last_synced_at, t)} · {tk(String(cell.last_status ?? ""))}
              </div>
              {cell.last_error && <div className="max-w-[220px] truncate text-[11px] text-fg-subtle">{cell.last_error}</div>}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[12px]"
              disabled={!live || !active || busy}
              title={!live ? t("auth.ms.syncNotOpen") : undefined}
              onClick={() => doSync(row)}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {t("auth.ms.syncNow")}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12px]" onClick={() => openEdit(row)}>
              <Pencil size={12} />
              {t("auth.ms.edit")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreHorizontal size={14} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 text-[12.5px]">
                <DropdownMenuItem disabled={busy} onSelect={() => doStatusCheck(row)}>
                  <Radar size={13} /> {t("auth.ms.statusCheck")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => {
                  const cfg = platforms.find((x) => x.name === p);
                  if (!cfg) { toast.info(t("auth.manualNotOpen", { platform: p })); return; }
                  handlePick(cfg, row);
                }}>
                  <ShieldCheck size={13} /> {t("auth.reauth")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(row)}>
                  <Trash2 size={13} /> {t("auth.ms.unbind")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>
    );
  };

  const addFields = addFor ? credFieldsOf(addFor.name) : [];
  const addGuide = addFor ? guideOf(addFor.name) : undefined;
  const addSites = addFor ? (siteMap[addFor.name] ?? []) : [];
  const quotaFull = !!quota && authorizedCount >= quota.quota;

  return (
    <div className="space-y-4">
      {/* ── 概览条：紧凑指标 + 额度进度（妙手式一条横栏，不占四张大盘卡） ── */}
      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
          <Metric label={t("auth.ms.mAuthorized")} value={String(authorizedCount)} sub={quota ? t("auth.ms.mQuotaOf", { quota: quota.quota }) : ""} tone="success" />
          <span className="hidden h-8 w-px bg-border sm:block" />
          <Metric label={t("auth.ms.mExpiring")} value={String(expiringCount)} sub={expiringCount > 0 ? t("auth.needRenew") : t("auth.ms.mNone")} tone={expiringCount > 0 ? "warning" : "muted"} />
          <span className="hidden h-8 w-px bg-border sm:block" />
          <Metric label={t("auth.ms.mSyncLive")} value={String(platforms.filter((p) => hasOrderSync(p.name)).length)} sub={t("auth.ms.mSyncLiveSub")} tone="info" />
          <span className="hidden h-8 w-px bg-border sm:block" />
          <Metric label={t("auth.ms.mOpenable")} value={String(platforms.filter(canAuth).length)} sub={t("auth.ms.mOpenableSub")} tone="primary" />
          <div className="ml-auto flex min-w-[180px] flex-col gap-1">
            {quota ? (
              <>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-fg-muted">{t("auth.ms.quotaTitle")}</span>
                  <span className="font-data tabular-nums text-fg">{quota.used} / {quota.quota}</span>
                </div>
                <Progress value={quota.quota > 0 ? Math.min(100, (quota.used / quota.quota) * 100) : 0} className="h-1.5" />
                <span className="text-[11px] text-fg-subtle">
                  {t("auth.ms.quotaFree", { free: quota.freeLimit, purchased: quota.purchased })}
                  {quotaFull && <a href="/subscription" className="ml-1 text-warning underline">{t("auth.goSubscription")}</a>}
                </span>
              </>
            ) : (
              <span className="text-[12px] text-fg-subtle">{t("common.loading")}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── 平台墙：搜索 + 地区/状态筛选 + 紧凑 tile ── */}
      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">{t("auth.ms.wallTitle")}</h2>
            <p className="mt-0.5 text-[12px] text-fg-muted">{t("auth.ms.wallDesc")}</p>
          </div>
          <div className="relative ml-auto w-full sm:w-56">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("auth.ms.searchPh")}
              className="h-8 pl-8 pr-7 text-[13px]"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg">
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5">
          <Chip active={regionFilter === "all"} onClick={() => setRegionFilter("all")}>{t("auth.ms.catAll")}</Chip>
          {regionChips.map((r) => (
            <Chip key={r} active={regionFilter === r} onClick={() => setRegionFilter(regionFilter === r ? "all" : r)}>{r}</Chip>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <Chip active={authFilter === "all"} onClick={() => setAuthFilter("all")}>{t("auth.ms.stAll")}</Chip>
          <Chip active={authFilter === "authed"} onClick={() => setAuthFilter(authFilter === "authed" ? "all" : "authed")}>{t("auth.ms.stAuthed")}</Chip>
          <Chip active={authFilter === "unauth"} onClick={() => setAuthFilter(authFilter === "unauth" ? "all" : "unauth")}>{t("auth.ms.stUnauth")}</Chip>
          <Chip active={authFilter === "soon"} onClick={() => setAuthFilter(authFilter === "soon" ? "all" : "soon")}>{t("auth.ms.stSoon")}</Chip>
        </div>

        {cfgLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-fg-muted">
            <Loader2 size={16} className="animate-spin" /> {t("common.loading")}
          </div>
        ) : wall.length === 0 ? (
          <div className="py-12 text-center text-sm text-fg-subtle">{t("auth.ms.noMatch")}</div>
        ) : (
          <>
            {/* 可授权平台优先：一进来就能点到能用的，不被"对接中"平台淹没 */}
            {wallOpen.length > 0 && (
              <div className="grid grid-cols-3 gap-2 px-4 pb-4 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                {wallOpen.map(renderTile)}
              </div>
            )}
            {wallSoon.length > 0 && (
              <div className={cn("border-t border-border", wallOpen.length > 0 && "pt-1")}>
                <button
                  type="button"
                  onClick={() => setShowSoon((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-[12.5px] text-fg-muted transition-colors hover:bg-surface-sunken/70 hover:text-fg"
                >
                  <ChevronRight size={13} className={cn("transition-transform duration-200", showSoon && "rotate-90")} />
                  {t("auth.ms.soonGroup", { n: wallSoon.length })}
                  <span className="text-fg-subtle">· {t("auth.ms.soonGroupHint")}</span>
                </button>
                {showSoon && (
                  <div className="grid grid-cols-3 gap-2 px-4 pb-4 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
                    {wallSoon.map(renderTile)}
                  </div>
                )}
              </div>
            )}
            {wallOpen.length === 0 && wallSoon.length === 0 && (
              <div className="py-12 text-center text-sm text-fg-subtle">{t("auth.ms.noMatch")}</div>
            )}
          </>
        )}
      </div>

      {/* ── 店铺列表：授权后的日常操作台 ── */}
      <div className="rounded-xl border border-border bg-card shadow-soft">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-fg">{t("auth.ms.listTitle")}</h2>
            <p className="mt-0.5 text-[12px] text-fg-muted">{t("auth.ms.listDesc")}</p>
          </div>
          <div className="relative ml-auto w-full sm:w-52">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input value={shopQ} onChange={(e) => setShopQ(e.target.value)} placeholder={t("auth.ms.shopSearchPh")} className="h-8 pl-8 text-[13px]" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-sunken text-left text-[12px] text-fg-muted">
                <th className="px-3 py-2 font-medium">{t("auth.ms.colShop")}</th>
                <th className="px-3 py-2 font-medium">{t("auth.ms.colType")}</th>
                <th className="hidden px-3 py-2 font-medium lg:table-cell">{t("auth.ms.colSite")}</th>
                <th className="px-3 py-2 font-medium">{t("common.status")}</th>
                <th className="hidden px-3 py-2 font-medium md:table-cell">{t("auth.ms.colExpiry")}</th>
                <th className="hidden px-3 py-2 font-medium xl:table-cell">{t("auth.ms.colLastSync")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-fg-muted">
                    <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
                    {t("common.loading")}
                  </td>
                </tr>
              ) : shopRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-[13px] text-fg-subtle">
                    {rows.length === 0 ? t("auth.ms.emptyShop") : t("auth.ms.noShopMatch")}
                  </td>
                </tr>
              ) : (
                shopRows.map(renderShopRow)
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 添加授权店铺（妙手式：左填表 + 右引导） ── */}
      <Dialog open={!!addFor} onOpenChange={(o) => !o && setAddFor(null)}>
        <DialogContent className="max-w-3xl">
          {addFor && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <PlatformLogo name={addFor.name} logoUrl={logoMap[addFor.name]} size="lg" />
                  <div>
                    <DialogTitle>{t("auth.ms.dlgTitle")} · {tk(addFor.name)}</DialogTitle>
                    <DialogDescription className="mt-0.5">{t("auth.ms.dlgDesc")}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              <div className="grid gap-5 py-1 md:grid-cols-[minmax(0,1fr)_248px]">
                {/* 左：表单 */}
                <div className="grid gap-4">
                  <div className="grid gap-1.5">
                    <Label>{t("auth.ms.shopType")}</Label>
                    {(() => {
                      const available = SHOP_TYPES.filter((s) => !addFor?.shop_types || addFor.shop_types.includes(s.value));
                      if (available.length === 1) {
                        return <span className="text-[13px] text-fg-muted">{t(available[0].key)}</span>;
                      }
                      return (
                        <RadioGroup
                          value={form.shop_type}
                          onValueChange={(v) => setForm({ ...form, shop_type: v })}
                          className="flex flex-wrap gap-4"
                        >
                          {available.map((s) => (
                            <label key={s.value} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                              <RadioGroupItem value={s.value} /> {t(s.key)}
                            </label>
                          ))}
                        </RadioGroup>
                      );
                    })()}
                  </div>

                  <div className="grid gap-1.5">
                    <Label>{t("auth.ms.shopName")} <span className="text-destructive">*</span></Label>
                    <Input
                      value={form.shop_name}
                      onChange={(e) => setForm({ ...form, shop_name: e.target.value })}
                      placeholder={t("auth.ms.shopNamePh")}
                    />
                    <p className="text-[11px] text-fg-subtle">{t("auth.ms.shopNameHint")}</p>
                  </div>

                  <div className="grid gap-1.5">
                    <Label>{t("auth.ms.site")}</Label>
                    {addSites.length > 0 ? (
                      <Input
                        value={form.region}
                        onChange={(e) => setForm({ ...form, region: e.target.value })}
                        list="auth-site-options"
                        placeholder={t("auth.ms.sitePh")}
                      />
                    ) : (
                      <Input
                        value={form.region}
                        onChange={(e) => setForm({ ...form, region: e.target.value })}
                        placeholder={t("auth.ms.sitePh")}
                      />
                    )}
                    {addSites.length > 0 && (
                      <datalist id="auth-site-options">
                        {addSites.map((s) => <option key={s} value={s} />)}
                      </datalist>
                    )}
                  </div>

                  <div className="grid gap-3 border-t border-border pt-4">
                    <div className="flex items-center gap-2">
                      <KeyRound size={13} className="text-fg-muted" />
                      <span className="text-[13px] font-medium text-fg">{t("auth.ms.credSection")}</span>
                    </div>
                    {addFields.length === 0 ? (
                      <p className="rounded-lg bg-surface-sunken px-3 py-2 text-[12px] text-fg-muted">{t("auth.ms.noCredFields")}</p>
                    ) : (
                      addFields.map((f) => (
                        <div className="grid gap-1.5" key={f.key}>
                          <Label className="text-[12.5px]">
                            {t(f.labelKey)} {f.required !== false && <span className="text-destructive">*</span>}
                          </Label>
                          <Input
                            value={form.creds?.[f.key] ?? ""}
                            onChange={(e) => setForm({ ...form, creds: { ...(form.creds ?? {}), [f.key]: e.target.value } })}
                            placeholder={t(f.placeholderKey)}
                            type={f.type === "password" || /secret|token|key/i.test(f.key) ? "password" : "text"}
                            autoComplete="off"
                          />
                        </div>
                      ))
                    )}
                  </div>

                  <div className="rounded-lg bg-surface-sunken px-3 py-2 text-[11.5px] leading-relaxed text-fg-muted">
                    {VERIFIABLE_PLATFORMS.has(form.platform) ? t("auth.verifyHint.verifyable") : t("auth.verifyHint.pending")}
                  </div>
                </div>

                {/* 右：授权引导（妙手把"怎么拿到 key"放在同一弹窗里） */}
                <div className="rounded-xl border border-border bg-surface-sunken/70 p-3.5">
                  <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-fg">
                    <ChevronRight size={13} className="text-brand" />
                    {t("auth.ms.guideTitle")}
                  </div>
                  {addGuide ? (
                    <>
                      <p className="mb-2 text-[11.5px] leading-relaxed text-fg-muted">{t(addGuide.summaryKey)}</p>
                      <ol className="list-decimal space-y-1 pl-4 text-[11.5px] leading-relaxed text-fg-body">
                        {addGuide.stepKeys.map((k, i) => <li key={i}>{t(k)}</li>)}
                      </ol>
                      {(addGuide.doc || addGuide.portal) && (
                        <a
                          href={addGuide.doc ?? addGuide.portal}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-brand hover:underline"
                        >
                          <ExternalLink size={11} /> {t("auth.guideDoc")}
                        </a>
                      )}
                    </>
                  ) : (
                    <p className="text-[11.5px] leading-relaxed text-fg-muted">{t("auth.ms.guideFallback")}</p>
                  )}
                  <div className="mt-3 border-t border-border pt-2.5">
                    <div className="mb-1.5 text-[12px] font-medium text-fg">{t("auth.ms.noticeTitle")}</div>
                    <ul className="space-y-1 text-[11px] leading-relaxed text-fg-muted">
                      <li>· {t("auth.ms.notice1")}</li>
                      <li>· {t("auth.ms.notice2")}</li>
                      <li>· {t("auth.ms.notice3")}</li>
                    </ul>
                  </div>
                  <div className="mt-3 rounded-lg bg-card px-2.5 py-2 text-[11px]">
                    <span className="text-fg-muted">{t("auth.ms.syncCapLabel")}</span>
                    {hasOrderSync(addFor.name) ? (
                      <span className="ml-1 font-medium text-info">{t("auth.ms.tagSyncLive")}</span>
                    ) : (
                      <span className="ml-1 font-medium text-fg-subtle">{t("auth.ms.tagSyncIdle")}</span>
                    )}
                  </div>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setAddFor(null)}>{t("common.cancel")}</Button>
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
                  {saving ? t("auth.verifying") : t("auth.ms.confirm")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── 编辑店铺档案（妙手「店铺设置」：别名 / 类型 / 站点 / 备注 / 通知） ── */}
      <Dialog open={!!editFor} onOpenChange={(o) => !o && setEditFor(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("auth.ms.editTitle")}</DialogTitle>
            <DialogDescription>
              {String(editFor?.shop_name ?? "")} · {String(editFor?.platform ?? "")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label>{t("auth.ms.shopAlias")}</Label>
              <Input value={editForm.shop_alias} onChange={(e) => setEditForm({ ...editForm, shop_alias: e.target.value })} placeholder={t("auth.ms.shopAliasPh")} />
              <p className="text-[11px] text-fg-subtle">{t("auth.ms.shopAliasHint")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("auth.ms.shopType")}</Label>
              <RadioGroup value={editForm.shop_type} onValueChange={(v) => setEditForm({ ...editForm, shop_type: v })} className="flex flex-wrap gap-4">
                {SHOP_TYPES.map((s) => (
                  <label key={s.value} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
                    <RadioGroupItem value={s.value} /> {t(s.key)}
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("auth.ms.site")}</Label>
              <Input value={editForm.region} onChange={(e) => setEditForm({ ...editForm, region: e.target.value })} placeholder={t("auth.ms.sitePh")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("auth.ms.remark")}</Label>
              <Textarea rows={2} value={editForm.remark} onChange={(e) => setEditForm({ ...editForm, remark: e.target.value })} placeholder={t("auth.ms.remarkPh")} />
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <span className="text-[13px]">{t("auth.ms.notifyNewOrder")}</span>
              <Switch checked={editForm.notify} onCheckedChange={(v) => setEditForm({ ...editForm, notify: !!v })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditFor(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleEditSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── OAuth 平台授权引导（应用密钥未就绪时给官方入口，不放行进必失败的跳转） ── */}
      <Dialog open={!!guideFor} onOpenChange={(o) => !o && setGuideFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{guideFor} · {t("auth.guideTitle")}</DialogTitle>
            <DialogDescription>
              {guideFor && guideOf(guideFor) ? t(guideOf(guideFor)!.summaryKey) : ""}
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-1.5 pl-4 text-sm">
            {(guideFor ? (guideOf(guideFor)?.stepKeys ?? []) : []).map((k, i) => <li key={i}>{t(k)}</li>)}
          </ol>
          {guideFor && (guideOf(guideFor)?.portal || guideOf(guideFor)?.doc) && (
            <a href={guideOf(guideFor)!.portal ?? guideOf(guideFor)!.doc} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary underline">
              {t("auth.oauthPortal")}
            </a>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setGuideFor(null)}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── 解绑确认 ── */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auth.ms.unbind")} · {String(deleting?.shop_name ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{t("auth.ms.unbindDesc", { name: shopNameOf(deleting ?? ({} as ExtRow)) })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive">{t("auth.ms.unbind")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── 概览条指标（妙手式紧凑数字块）───
function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "success" | "warning" | "info" | "primary" | "muted" }) {
  const color = {
    success: "text-success",
    warning: "text-warning",
    info: "text-info",
    primary: "text-brand",
    muted: "text-fg",
  }[tone];
  return (
    <div className="min-w-[84px]">
      <div className="text-[11.5px] text-fg-muted">{label}</div>
      <div className={cn("font-data text-[19px] font-semibold leading-6 tabular-nums", color)}>{value}</div>
      {sub ? <div className="text-[11px] text-fg-subtle">{sub}</div> : null}
    </div>
  );
}

// ─── 筛选 chip（妙手平台墙顶部的分类条）───
function Chip({ active, onClick, children }: { active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[12px] leading-4 transition-colors",
        active
          ? "border-brand/40 bg-brand/10 font-medium text-brand"
          : "border-border bg-card text-fg-muted hover:border-brand/30 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function AuthCenter() {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <PageHeader title={t("auth.centerTitle")} description={t("auth.centerDesc")} />
      <Tabs defaultValue="shop">
        <TabsList>
          <TabsTrigger value="shop">{t("auth.tabShop")}</TabsTrigger>
          <TabsTrigger value="source">{t("auth.tabSource")}</TabsTrigger>
        </TabsList>
        <TabsContent value="shop" className="mt-4">
          <AuthShopTab />
        </TabsContent>
        <TabsContent value="source" className="mt-4">
          <AuthSupplierTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// 店铺类型标签（模块级，供表格渲染复用）
function shopTypeLabel(value: string, t: Translate): string {
  const hit = SHOP_TYPES.find((s) => s.value === value);
  return hit ? t(hit.key) : t("auth.ms.typeCross");
}

// ─── 货源授权：真实检测采集插件连接状态（chrome.runtime.sendMessage PING，无假状态） ───
const COLLECTOR_EXT_ID = "nagkkllgfgbkdhchckdcfhgdblohkgmf";

type PingState = { status: "checking" | "ok" | "missing"; version?: string; loggedIn?: boolean };

function AuthSupplierTab() {
  const { t, lang } = useLanguage();
  const [ping, setPing] = useState<PingState>({ status: "checking" });
  const [probe, setProbe] = useState(0);

  useEffect(() => {
    let alive = true;
    setPing({ status: "checking" });
    const doPing = () => {
      const chromeApi = (window as any).chrome;
      if (!chromeApi?.runtime?.sendMessage) {
        setPing({ status: "missing" });
        return;
      }
      try {
        chromeApi.runtime.sendMessage(COLLECTOR_EXT_ID, { type: "PING" }, (resp: any) => {
          if (!alive) return;
          const err = chromeApi.runtime.lastError;
          if (err || !resp?.pong) setPing({ status: "missing" });
          else setPing({ status: "ok", version: resp.version, loggedIn: !!resp.loggedIn });
        });
      } catch {
        if (alive) setPing({ status: "missing" });
      }
    };
    doPing();
    const timer = setInterval(doPing, 15000);
    return () => { alive = false; clearInterval(timer); };
  }, [probe]);

  // logo 走平台名索引（缺图时 PlatformLogo 自动降级为字母芯片）
  const channels = [
    { nameKey: "auth.src.chan1688", desc: t("auth.src.desc1688"), platform: "1688", icon: "1", color: "from-orange-500 to-orange-700" },
    { nameKey: "auth.src.chanTaobao", desc: t("auth.src.descTaobao"), platform: "淘宝", icon: lang === "zh" ? tt('auth.srcTaobaoShort') : "T", color: "from-orange-400 to-red-500" },
    { nameKey: "auth.src.chanGlobal", desc: t("auth.src.descGlobal"), platform: "AliExpress", icon: "A", color: "from-slate-600 to-slate-800" },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Puzzle className="h-4 w-4" />
              <span className="text-sm font-semibold">{t("auth.src.pluginTitle")}</span>
              {ping.status === "ok" && (
                <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-medium text-success">v{ping.version}</span>
              )}
              {ping.status === "ok" && ping.loggedIn && (
                <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs text-success">{t("auth.src.loginOk")}</span>
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {ping.status === "checking" && t("auth.src.pluginChecking")}
              {ping.status === "ok" && (ping.loggedIn ? t("auth.src.pluginOkLoggedIn") : t("auth.src.pluginOkNoLogin"))}
              {ping.status === "missing" && t("auth.src.pluginMissing")}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => setProbe((n) => n + 1)}>{t("auth.src.recheck")}</Button>
            <a href="/downloads/thalvior-collect-extension.zip" download>
              <Button size="sm">{t("auth.src.download")}</Button>
            </a>
          </div>
        </div>
      </div>
      <div>
        <h2 className="mb-1 text-base font-medium text-foreground">{t("auth.src.groupTitle")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{t("auth.src.groupDesc")}</p>
        <div className="grid gap-3 md:grid-cols-3">
          {channels.map((c) => (
            <div key={c.nameKey} className="rounded-xl border bg-card p-4">
              <div className="mb-3">
                <PlatformLogo name={c.platform} size="lg" />
              </div>
              <div className="text-sm font-semibold">{t(c.nameKey)}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


