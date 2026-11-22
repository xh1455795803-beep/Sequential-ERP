// authorize-shop — 统一店铺/货源授权入口
// ==========================================
// 一个入口覆盖 OAuth 型和手动型，由 platform_configs.auth_type 决定路径
//
// 动作（action）:
//   oauth-url      → 返回 OAuth 跳转 URL（oauth 型平台）
//   oauth-callback → code 换 token + 入库（oauth 型平台）
//   cred-verify    → 仅校验手动凭据（manual 型）
//   cred-save      → 校验 + 加密 + 入库（manual 型）
//   list           → 当前用户所有授权列表
//   delete         → 删除一个授权
//
// 平台凭据加密（AES-GCM / PBKDF2）：secret 来自 JWT_SECRET，盐分两类：
//   oauth 型：直接存取 token（不需要加密）
//   manual 型：credentials_enc（加密后落库）
//
// 手动授权硬性规则（2026-10-07 二次修订）：
//   所有平台一视同仁——必须直连该平台官方接口真实验证，平台返回有效才入库并标记「已授权」；
//   平台不认可、或系统尚未接入该平台真实验证的，一律拒绝保存，绝不用「填写完整」冒充授权成功。
//   不产生「待验证」这种含糊状态：要么真的已授权，要么明确拒绝并提示原因。
//
// 环境变量：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET （通用）
//   SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_REDIRECT_URI
//   TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_REDIRECT_URI

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ACTIVE_AUTH_STATUS_LIST } from '../_shared/shop-status.ts';

const functionName = 'authorize-shop';

// ─── 通用工具 ────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── 店铺授权额度校验（免费额度 + 已购额度，总量制） ───
// 免费额度来源：platform_auth_config.free_shop_limit（DB 单一事实源，30 个平台统一在这里配）
//   ⚠️ 原来写死 FREE_SHOP_LIMIT = 2 → 改额度要改代码重部署；现在读 DB。
const DEFAULT_FREE_SHOP_LIMIT = 2;
const MS_DAY = 86400000;
const EXPIRING_WINDOW_DAYS = 30;
/** 有效授权状态（凭据可用）—— 与 _shared/shop-status.ts 的 ACTIVE_AUTH_STATUSES 对齐 */
const ACTIVE_VALID_STATUSES = ['已授权', '即将到期'];

type AdminClient = ReturnType<typeof createClient>;

/** 平台授权配置（platform_auth_config）—— 平台元数据唯一事实源 */
type PlatformAuthConfig = {
  platform_key: string;
  oauth_flow: string | null;
  oauth_ready: boolean | null;
  token_endpoint: string | null;
  shop_list_endpoint: string | null;
  shop_list_method: string | null;
  shop_list_field_path: Record<string, string> | null;
  authorize_endpoint: string | null;
  callback_param: string | null;
  verify_mode: string | null;
  verify_endpoint: string | null;
  verify_credential_map: Record<string, unknown> | null;
  cred_fields: Array<Record<string, unknown>> | null;
  supports_shop_list: boolean | null;
  max_shops_per_auth: number | null;
  token_ttl_days: number | null;
  api_base_url: string | null;
  token_scope_note: string | null;
  free_shop_limit: number | null;
  market_service_id: string | null;
  market_api_base: string | null;
};

/** 免费额度：优先该平台自己的配置 → 任意一条配置 → 默认值 */
async function getFreeShopLimit(admin: AdminClient, platform?: string): Promise<number> {
  if (platform) {
    const { data } = await admin
      .from('platform_auth_config').select('free_shop_limit').eq('platform_key', platform).maybeSingle();
    if (data?.free_shop_limit != null) return Number(data.free_shop_limit);
  }
  // 无平台上下文时取所有平台配置里的最大免费额度（原来 limit(1) 随机取一行 → 改某平台配置不生效）
  const { data } = await admin
    .from('platform_auth_config').select('free_shop_limit')
    .not('free_shop_limit', 'is', null)
    .order('free_shop_limit', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.free_shop_limit != null ? Number(data.free_shop_limit) : DEFAULT_FREE_SHOP_LIMIT;
}

async function checkShopQuota(admin: AdminClient, userId: string, platform?: string): Promise<{ ok: boolean; quota: number; used: number; freeLimit: number; purchased: number }> {
  const nowIso = new Date().toISOString();
  const [licRes, usedRes, freeLimit] = await Promise.all([
    admin.from('shop_licenses').select('shop_count').eq('user_id', userId).eq('status', 'active').gt('expires_at', nowIso),
    // 额度占用口径：凭据仍然有效的店（已授权 / 即将到期）都占额度
    //   ⚠️ 原来只数 status='已授权' → 即将到期的店不占额度，会让额度卡与实际可授权数对不上
    admin.from('shop_auths').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ACTIVE_AUTH_STATUS_LIST),
    getFreeShopLimit(admin, platform),
  ]);
  const purchased = (licRes.data ?? []).reduce((s: number, l: { shop_count: number }) => s + Number(l.shop_count || 0), 0);
  const quota = freeLimit + purchased;
  const used = usedRes.count ?? 0;
  return { ok: used < quota, quota, used, freeLimit, purchased };
}
async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

async function resolveUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

// 查 platform_configs 拿 auth_type（oauth | manual）+ platform_auth_config 拿授权参数
type PlatformInfo = {
  name: string;
  auth_type: string;
  status: string;
  authFlow: string | null;
  authState: string | null;
  logoUrl: string | null;
  logoLetter: string | null;
  logoGradient: string | null;
  sites: unknown;
  authCfg: PlatformAuthConfig | null;
};

async function getPlatformInfo(platform: string): Promise<PlatformInfo | null> {
  try {
    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const { data, error } = await admin
      .from('platform_configs')
      .select('name, auth_type, status, auth_flow, auth_state, logo_url, logo_letter, logo_gradient, sites')
      .eq('name', platform)
      .maybeSingle();
    if (error || !data) return null;
    if (String(data.status ?? '启用') === '停用') return null;
    const { data: cfg } = await admin
      .from('platform_auth_config')
      .select('platform_key, oauth_flow, oauth_ready, token_endpoint, shop_list_endpoint, shop_list_method,'
        + ' shop_list_field_path, authorize_endpoint, callback_param, verify_mode, verify_endpoint,'
        + ' verify_credential_map, cred_fields, supports_shop_list, max_shops_per_auth, token_ttl_days,'
        + ' api_base_url, token_scope_note, free_shop_limit, market_service_id, market_api_base')
      .eq('platform_key', platform)
      .maybeSingle();
    return {
      name: data.name,
      auth_type: data.auth_type ?? 'manual',
      status: data.status,
      authFlow: data.auth_flow ?? null,
      authState: data.auth_state ?? null,
      logoUrl: data.logo_url ?? null,
      logoLetter: data.logo_letter ?? null,
      logoGradient: data.logo_gradient ?? null,
      sites: data.sites ?? null,
      authCfg: (cfg as PlatformAuthConfig | null) ?? null,
    };
  } catch {
    return null;
  }
}

// ─── 凭据加密（手动型用） ────────────────────────────────────────────
async function encryptCredentials(plain: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.length);
  let bin = '';
  out.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

// ─── OAuth 平台实现（Shopify / TikTok Shop） ──────────────────────────
function shopifyAuthorizeUrl(shop: string): string {
  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
  const redirectUri = Deno.env.get('SHOPIFY_REDIRECT_URI');
  if (!clientId || !redirectUri) throw new Error('Shopify OAuth 未配置');
  const platformUri = redirectUri.includes("?") ? `${redirectUri}&platform=Shopify` : `${redirectUri}?platform=Shopify`;
  return (
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent('read_products,read_orders,read_customers')}` +
    `&redirect_uri=${encodeURIComponent(platformUri)}` +
    `&state=${crypto.randomUUID()}`
  );
}

async function shopifyCallback(shop: string, code: string): Promise<{ accessToken: string; scope: string; expiresIn: number | null; refreshToken: string | null }> {
  const clientId = getEnv('SHOPIFY_CLIENT_ID');
  const clientSecret = getEnv('SHOPIFY_CLIENT_SECRET');
  const res = await fetchWithTimeout(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error('Shopify token exchange 失败');
  const d = (await res.json()) as { access_token?: string; scope?: string; expires_in?: number; refresh_token?: string };
  if (!d.access_token) throw new Error('Shopify 未返回 access_token');
  return {
    accessToken: d.access_token,
    scope: d.scope ?? '',
    // offline token 有效期 3600s —— 原来丢弃 → token_expires_at 恒空 → 「即将到期」恒 0
    expiresIn: typeof d.expires_in === 'number' ? d.expires_in : null,
    refreshToken: d.refresh_token ?? null,
  };
}

function tiktokAuthorizeUrl(): string {
  const appKey = Deno.env.get('TIKTOK_APP_KEY');
  const redirectUri = Deno.env.get('TIKTOK_REDIRECT_URI');
  if (!appKey || !redirectUri) throw new Error('TikTok Shop OAuth 未配置');
  const platformUri = redirectUri.includes("?") ? `${redirectUri}&platform=TikTok%20Shop` : `${redirectUri}?platform=TikTok%20Shop`;
  return (
    `https://open-api.tiktokglobalshop.com/authorize` +
    `?app_key=${encodeURIComponent(appKey)}` +
    `&state=${crypto.randomUUID()}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`
  );
}

type TikTokShop = { id?: string; shop_id?: string; name?: string; region?: string; seller_type?: string; cipher?: string; code?: string };

type TikTokCallbackResult = {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpiresIn: number | null;
  refreshTokenExpiresIn: number | null;
  openId: string | null;
  userType: number | null;
  sellerName: string | null;
  sellerBaseRegion: string | null;
  grantedScopes: string[];
  shops: TikTokShop[];
};

// 端点保持 v1（B3 实测 202309 端点后再换），但不再丢弃 expires_in / refresh_token / N 店清单
async function tiktokCallback(code: string): Promise<TikTokCallbackResult> {
  const appKey = getEnv('TIKTOK_APP_KEY');
  const appSecret = getEnv('TIKTOK_APP_SECRET');

  const tr = await fetchWithTimeout('https://open-api.tiktokglobalshop.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret, auth_code: code, grant_type: 'authorized_code' }),
  });
  const td = (await tr.json().catch(() => ({}))) as {
    data?: {
      access_token?: string; refresh_token?: string;
      access_token_expire_in?: number; refresh_token_expire_in?: number;
      open_id?: string; user_type?: number; seller_name?: string;
      seller_base_region?: string; granted_scopes?: string[];
    };
  };
  if (!tr.ok || !td?.data?.access_token) throw new Error('TikTok Shop token exchange 失败');
  const accessToken = td.data.access_token;

  const sr = await fetchWithTimeout(
    `https://open-api.tiktokglobalshop.com/api/shop/get_authorized_shop?app_key=${encodeURIComponent(appKey)}&secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(accessToken)}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } },
  );
  const sd = (await sr.json().catch(() => ({}))) as { data?: { shops?: TikTokShop[] } };
  const shops = sd?.data?.shops ?? [];

  return {
    accessToken,
    refreshToken: td.data.refresh_token ?? null,
    accessTokenExpiresIn: typeof td.data.access_token_expire_in === 'number' ? td.data.access_token_expire_in : null,
    refreshTokenExpiresIn: typeof td.data.refresh_token_expire_in === 'number' ? td.data.refresh_token_expire_in : null,
    openId: td.data.open_id ?? null,
    userType: typeof td.data.user_type === 'number' ? td.data.user_type : null,
    sellerName: td.data.seller_name ?? null,
    sellerBaseRegion: td.data.seller_base_region ?? null,
    grantedScopes: Array.isArray(td.data.granted_scopes) ? td.data.granted_scopes : [],
    shops,
  };
}

// Lazada / Shopee OAuth 占位（配置密钥后启用）
function oauthNotReady(platform: string): never {
  throw new Error(`${platform} 一键授权接入中，请先使用手动授权或联系管理员配置 OAuth 密钥`);
}

// ─── 手动凭据校验（各平台直连 API 验证） ──────────────────────────────
type VerifyResult = { verifyable: boolean; ok: boolean; msg: string; softSave?: boolean };

async function verifyAmazon(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientId = String(c.client_id ?? '').trim();
  const clientSecret = String(c.client_secret ?? '').trim();
  const refreshToken = String(c.refresh_token ?? '').trim();
  if (!clientId || !clientSecret || !refreshToken)
    return { verifyable: true, ok: false, msg: '请完整填写 Client ID / Client Secret / Refresh Token' };
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  try {
    const r = await fetchWithTimeout('https://api.amazon.com/auth/o2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return r.ok && d.access_token
      ? { verifyable: true, ok: true, msg: 'Amazon 凭据有效' }
      : { verifyable: true, ok: false, msg: `Amazon 校验失败：${(d.error_description as string) ?? r.status}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Amazon 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyWalmart(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientId = String(c.client_id ?? '').trim();
  const clientSecret = String(c.client_secret ?? '').trim();
  if (!clientId || !clientSecret)
    return { verifyable: true, ok: false, msg: '请完整填写 Client ID / Client Secret' };
  const basic = btoa(`${clientId}:${clientSecret}`);
  try {
    const r = await fetchWithTimeout('https://marketplace.walmartapis.com/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`, Accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return r.ok && d.access_token
      ? { verifyable: true, ok: true, msg: 'Walmart 凭据有效' }
      : { verifyable: true, ok: false, msg: `Walmart 校验失败：${(d.error_description as string) ?? r.status}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Walmart 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyEtsy(c: Record<string, unknown>): Promise<VerifyResult> {
  const apiKey = String(c.api_key ?? '').trim();
  if (!apiKey) return { verifyable: true, ok: false, msg: '请填写 Etsy API Key' };
  try {
    const r = await fetchWithTimeout('https://openapi.etsy.com/v3/application/openapi-ping', {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    return r.ok
      ? { verifyable: true, ok: true, msg: 'Etsy 凭据有效' }
      : { verifyable: true, ok: false, msg: `Etsy 校验失败：HTTP ${r.status}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Etsy 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyShopify(c: Record<string, unknown>): Promise<VerifyResult> {
  const domain = String(c.shop_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = String(c.access_token ?? '').trim();
  if (!domain || !token)
    return { verifyable: true, ok: false, msg: '请填写 Shopify 店铺域名与 Admin API 访问令牌' };
  try {
    const r = await fetchWithTimeout(`https://${domain}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    return r.status === 200
      ? { verifyable: true, ok: true, msg: 'Shopify 凭据校验通过' }
      : { verifyable: true, ok: false, msg: `Shopify 校验失败：HTTP ${r.status}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Shopify 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyEBay(c: Record<string, unknown>): Promise<VerifyResult> {
  const devId = String(c.dev_id ?? '').trim();
  const appId = String(c.app_id ?? '').trim();
  const certId = String(c.cert_id ?? '').trim();
  const authToken = String(c.auth_token ?? '').trim();
  if (!devId || !appId || !certId || !authToken)
    return { verifyable: true, ok: false, msg: '请填写 eBay Dev ID / App ID / Cert ID / 授权令牌' };
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayOfficialTimeRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${authToken.replace(/[<>&]/g, '')}</eBayAuthToken></RequesterCredentials>
</GeteBayOfficialTimeRequest>`;
  try {
    const r = await fetchWithTimeout('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-DEVELOPER-ID': devId,
        'X-EBAY-API-APPLICATION-ID': appId, 'X-EBAY-API-CERTIFICATE-ID': certId,
        'X-EBAY-API-CALL-NAME': 'GeteBayOfficialTime', 'X-EBAY-API-SITEID': '0',
        'Content-Type': 'text/xml; charset=utf-8',
      },
      body: xml,
    });
    const text = await r.text();
    if (/Ack>Success/.test(text)) return { verifyable: true, ok: true, msg: 'eBay 授权令牌校验通过' };
    const err = text.match(/ShortMessage>([^<]+)</)?.[1] ?? `HTTP ${r.status}`;
    return { verifyable: true, ok: false, msg: `eBay 校验失败：${err}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `eBay 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

// WooCommerce：REST API key 直连校验（query 方式，HTTP/HTTPS 均可），带真实商品数背书
async function verifyWooCommerce(c: Record<string, unknown>): Promise<VerifyResult> {
  const domain = String(c.shop_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const ck = String(c.consumer_key ?? '').trim();
  const cs = String(c.consumer_secret ?? '').trim();
  if (!domain || !ck || !cs)
    return { verifyable: true, ok: false, msg: '请完整填写店铺域名 / Consumer Key / Consumer Secret' };
  try {
    const r = await fetchWithTimeout(
      `https://${domain}/wp-json/wc/v3/products?per_page=1&consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (r.status === 401) return { verifyable: true, ok: false, msg: 'WooCommerce 校验失败：Consumer Key/Secret 无效' };
    if (r.status === 404) return { verifyable: true, ok: false, msg: 'WooCommerce 校验失败：找不到 REST 端点，请检查店铺域名' };
    if (!r.ok) return { verifyable: true, ok: false, msg: `WooCommerce 校验失败：HTTP ${r.status}` };
    const total = Number(r.headers.get('x-wp-total') ?? '');
    return { verifyable: true, ok: true, msg: Number.isFinite(total) && total > 0 ? `WooCommerce 凭据有效，店铺共 ${total} 件商品` : 'WooCommerce 凭据有效' };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `WooCommerce 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

// Ozon：Seller API 商品列表探活（Client-Id + Api-Key）
async function verifyOzon(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientId = String(c.client_id ?? '').trim();
  const apiKey = String(c.api_key ?? '').trim();
  if (!clientId || !apiKey) return { verifyable: true, ok: false, msg: '请完整填写 Client-Id / Api-Key' };
  try {
    const r = await fetchWithTimeout('https://api-seller.ozon.ru/v3/product/list', {
      method: 'POST',
      headers: { 'Client-Id': clientId, 'Api-Key': apiKey, 'Content-Type': 'application/json', 'User-Agent': 'Thalvior-ERP/1.0 (support@thalvior.icu)', Accept: 'application/json' },
      body: JSON.stringify({ filter: {}, limit: 1 }),
    }, 8000);
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok) {
      const result = d.result as Record<string, unknown> | undefined;
      const total = Number(result?.total ?? 0);
      return { verifyable: true, ok: true, msg: total > 0 ? `Ozon 凭据有效，店铺共 ${total} 个商品` : 'Ozon 凭据有效' };
    }
    return { verifyable: false, ok: false, softSave: true, msg: `Ozon 校验未通过：HTTP ${r.status} ${JSON.stringify(d).slice(0, 140)}（凭据已保存为「对接中」，平台开通 API 权限后即可同步）` };
  } catch (e) {
    return { verifyable: false, ok: false, softSave: true, msg: `Ozon 校验请求失败：${e instanceof Error ? e.message : String(e)}（凭据保存为「对接中」）` };
  }
}

// Wildberries：common-api seller-info 探活（Token）
async function verifyWildberries(c: Record<string, unknown>): Promise<VerifyResult> {
  const apiKey = String(c.api_key ?? '').trim();
  if (!apiKey) return { verifyable: true, ok: false, msg: '请填写 Wildberries API Token' };
  try {
    const r = await fetchWithTimeout('https://common-api.wildberries.ru/api/v2/seller-info', {
      headers: { Authorization: apiKey, Accept: 'application/json' },
    });
    if (r.status === 401 || r.status === 403)
      return { verifyable: true, ok: false, msg: 'Wildberries 校验失败：Token 无效或无权限' };
    if (!r.ok) return { verifyable: true, ok: false, msg: `Wildberries 校验失败：HTTP ${r.status}` };
    let name = '';
    try {
      const d = (await r.json()) as Record<string, unknown>;
      name = String(d.tradeMark ?? d.supplierName ?? '');
    } catch { /* 忽略解析失败 */ }
    return { verifyable: true, ok: true, msg: name ? `Wildberries 凭据有效，店铺：${name}` : 'Wildberries 凭据有效' };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Wildberries 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

// Mercado Libre：refresh_token 换新 token 后拉取 /users/me 真实账号昵称
async function verifyMercadoLibre(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientId = String(c.client_id ?? '').trim();
  const clientSecret = String(c.client_secret ?? '').trim();
  const refreshToken = String(c.refresh_token ?? '').trim();
  if (!clientId || !clientSecret || !refreshToken)
    return { verifyable: true, ok: false, msg: '请完整填写 Client ID / Client Secret / Refresh Token' };
  try {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
    const tr = await fetchWithTimeout('https://api.mercadolibre.com/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString(),
    });
    const td = (await tr.json().catch(() => ({}))) as Record<string, unknown>;
    if (!tr.ok || !td.access_token)
      return { verifyable: true, ok: false, msg: `Mercado Libre 校验失败：${(td.message as string) ?? tr.status}` };
    const ur = await fetchWithTimeout(`https://api.mercadolibre.com/users/me?access_token=${encodeURIComponent(String(td.access_token))}`, {});
    const ud = (await ur.json().catch(() => ({}))) as Record<string, unknown>;
    if (!ur.ok) return { verifyable: true, ok: false, msg: `Mercado Libre 校验失败：HTTP ${ur.status}` };
    return { verifyable: true, ok: true, msg: ud.nickname ? `Mercado Libre 授权有效，账号：${ud.nickname}` : 'Mercado Libre 授权有效' };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Mercado Libre 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

// Coupang：OpenAPI HMAC-SHA256 签名探活
async function verifyCoupang(c: Record<string, unknown>): Promise<VerifyResult> {
  const accessKey = String(c.access_key ?? '').trim();
  const secretKey = String(c.secret_key ?? '').trim();
  if (!accessKey || !secretKey) return { verifyable: true, ok: false, msg: '请完整填写 Access Key / Secret Key' };
  const datetime = new Date().toISOString().replace(/\.\d{3}Z$/, '.000Z');
  const nonce = crypto.randomUUID();
  const path = '/v2/providers/openapi/apis/api/v4/vendors/default-modules/setting/Bizrule/MinimumOrderAmount';
  const message = `GET\n${path}\n${datetime}\n${nonce}`;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    const signature = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
    const authorization = `CEAA algorithm=HmacSHA256,access-key=${accessKey},signed-date=${datetime},signature=${signature}`;
    const r = await fetchWithTimeout(`https://api-gateway.coupang.com${path}`, {
      headers: { Authorization: authorization, 'X-COUPANG-DATE': datetime, 'Content-Type': 'application/json' },
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok) return { verifyable: true, ok: true, msg: 'Coupang 凭据有效' };
    return { verifyable: true, ok: false, msg: `Coupang 校验失败：HTTP ${r.status} ${String(d.message ?? '')}`.slice(0, 160) };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Coupang 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}


async function verifyBigCommerce(c: Record<string, unknown>): Promise<VerifyResult> {
  const hash = String(c.store_hash ?? '').trim().replace(/^stores\//, '').replace(/\/$/, '');
  const token = String(c.access_token ?? '').trim();
  if (!hash || !token) return { verifyable: true, ok: false, msg: '请完整填写 Store Hash / Access Token' };
  try {
    const r = await fetchWithTimeout(`https://api.bigcommerce.com/stores/${encodeURIComponent(hash)}/v3/store.json`, {
      headers: { 'X-Auth-Token': token, Accept: 'application/json' },
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok) {
      const data = (d.data ?? {}) as Record<string, unknown>;
      const name = String(data.name ?? data.domain ?? '');
      return { verifyable: true, ok: true, msg: `BigCommerce 凭据有效${name ? `，店铺：${name.slice(0, 40)}` : ''}` };
    }
    return { verifyable: true, ok: false, msg: `BigCommerce 校验失败：HTTP ${r.status}`.slice(0, 160) };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `BigCommerce 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyMagento(c: Record<string, unknown>): Promise<VerifyResult> {
  const domain = String(c.store_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = String(c.access_token ?? '').trim();
  if (!domain || !token) return { verifyable: true, ok: false, msg: '请完整填写店铺域名 / Access Token' };
  try {
    const r = await fetchWithTimeout(`https://${domain}/rest/V1/store/storeConfigs`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (r.ok) {
      const d = (await r.json().catch(() => [])) as Array<Record<string, unknown>>;
      const name = Array.isArray(d) && d[0] ? String(d[0].store_name ?? '') : '';
      return { verifyable: true, ok: true, msg: `Magento 凭据有效${name ? `，店铺：${name.slice(0, 40)}` : ''}` };
    }
    if (r.status === 401) return { verifyable: true, ok: false, msg: 'Magento 校验失败：Access Token 无效' };
    return { verifyable: true, ok: false, msg: `Magento 校验失败：HTTP ${r.status}`.slice(0, 160) };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Magento 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyPrestaShop(c: Record<string, unknown>): Promise<VerifyResult> {
  const domain = String(c.store_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const key = String(c.api_key ?? '').trim();
  if (!domain || !key) return { verifyable: true, ok: false, msg: '请完整填写店铺域名 / API Key' };
  try {
    const r = await fetchWithTimeout(`https://${domain}/api/?output_format=JSON`, {
      headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: 'application/json' },
    });
    if (r.ok) return { verifyable: true, ok: true, msg: 'PrestaShop 凭据有效' };
    if (r.status === 401) return { verifyable: true, ok: false, msg: 'PrestaShop 校验失败：API Key 无效' };
    return { verifyable: true, ok: false, msg: `PrestaShop 校验失败：HTTP ${r.status}，请检查域名是否开启 Webservice`.slice(0, 160) };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `PrestaShop 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyAllegro(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientId = String(c.client_id ?? '').trim();
  const clientSecret = String(c.client_secret ?? '').trim();
  const refreshToken = String(c.refresh_token ?? '').trim();
  if (!clientId || !clientSecret || !refreshToken)
    return { verifyable: true, ok: false, msg: '请完整填写 Client ID / Client Secret / Refresh Token' };
  try {
    const tr = await fetchWithTimeout('https://allegro.pl/auth/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    const td = (await tr.json().catch(() => ({}))) as Record<string, unknown>;
    if (!tr.ok || !td.access_token)
      return { verifyable: true, ok: false, msg: `Allegro 校验失败：HTTP ${tr.status}，凭据无效`.slice(0, 160) };
    const r = await fetchWithTimeout('https://api.allegro.pl/me', {
      headers: { Authorization: `Bearer ${td.access_token}`, Accept: 'application/vnd.allegro.public.v1+json' },
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok) return { verifyable: true, ok: true, msg: `Allegro 凭据有效${d.login ? `，账号：${String(d.login).slice(0, 40)}` : ''}` };
    return { verifyable: true, ok: false, msg: `Allegro 校验失败：HTTP ${r.status}`.slice(0, 160) };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Allegro 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyKaufland(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientKey = String(c.client_key ?? '').trim();
  const secretKey = String(c.secret_key ?? '').trim();
  if (!clientKey || !secretKey) return { verifyable: true, ok: false, msg: '请完整填写 Client Key / Secret Key' };
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const path = '/v2/shipments?limit=1';
  const message = `GET\n${path}\n${timestamp}\n`;
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    const signature = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    const r = await fetchWithTimeout(`https://sellerapi.kaufland.com${path}`, {
      headers: { 'Seller-Key': clientKey, Timestamp: timestamp, 'Shop-Signature': signature, Accept: 'application/json' },
    });
    if (r.ok) return { verifyable: true, ok: true, msg: 'Kaufland 凭据有效' };
    if (r.status === 401 || r.status === 403) return { verifyable: true, ok: false, msg: 'Kaufland 校验失败：Client Key/Secret 无效' };
    return { verifyable: true, ok: false, msg: `Kaufland 校验失败：HTTP ${r.status}`.slice(0, 160) };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Kaufland 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyYandexMarket(c: Record<string, unknown>): Promise<VerifyResult> {
  const token = String(c.oauth_token ?? '').trim();
  if (!token) return { verifyable: true, ok: false, msg: '请填写 OAuth Token' };
  try {
    const r = await fetchWithTimeout('https://api.partner.market.yandex.ru/v2/campaigns.json?page=1&pageSize=1', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok) {
      const campaigns = Array.isArray(d.campaigns) ? (d.campaigns.length as number) : 0;
      return { verifyable: true, ok: true, msg: campaigns > 0 ? `Yandex Market 凭据有效，共 ${campaigns} 个活动` : 'Yandex Market 凭据有效' };
    }
    if (r.status === 403 || r.status === 401) return { verifyable: true, ok: false, msg: 'Yandex Market 校验失败：OAuth Token 无效' };
    return { verifyable: true, ok: false, msg: `Yandex Market 校验失败：HTTP ${r.status}`.slice(0, 160) };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Yandex Market 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

// 自动匹配校验函数：先精确匹配平台名，再按关键词兜底

async function verifyWish(c: Record<string, unknown>): Promise<VerifyResult> {
  const token = String(c.access_token ?? '').trim();
  if (!token) return { verifyable: true, ok: false, msg: '缺少 access_token' };
  const r = await fetchWithTimeout('https://merchant.wish.com/api/v3/order/multi-get?limit=1', { headers: { Authorization: `Bearer ${token}` } }, 15000);
  const j = await r.json().catch(() => null);
  if (j && j.code === 0) return { verifyable: true, ok: true, msg: '凭据有效，Wish 店铺连接成功' };
  const m = j && j.message;
  return { verifyable: true, ok: false, msg: `Wish 校验失败：${m || 'HTTP ' + r.status}` };
}

async function verifyWix(c: Record<string, unknown>): Promise<VerifyResult> {
  const key = String(c.api_key ?? '').trim();
  const acct = String(c.account_id ?? '').trim();
  if (!key || !acct) return { verifyable: true, ok: false, msg: '缺少 api_key 或 account_id' };
  const r = await fetchWithTimeout('https://www.wixapis.com/site-properties/v4/properties', {
    method: 'GET',
    headers: { Authorization: key, 'wix-account-id': acct },
  }, 15000);
  if (r.status === 200) return { verifyable: true, ok: true, msg: '凭据有效，Wix 站点连接成功' };
  if (r.status === 401 || r.status === 403) return { verifyable: true, ok: false, msg: 'Wix API Key 或 Account ID 无效（官方 API 拒绝）' };
  return { verifyable: true, ok: false, msg: `Wix 校验失败：HTTP ${r.status}` };
}



async function verifyJumia(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientId = String(c.client_id ?? '').trim();
  const refreshToken = String(c.refresh_token ?? '').trim();
  if (!clientId || !refreshToken) return { verifyable: true, ok: false, msg: '缺少 client_id 或 refresh_token' };
  const body = new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken });
  const r = await fetchWithTimeout('https://vendor-api.jumia.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, 15000);
  if (r.status === 200) return { verifyable: true, ok: true, msg: '凭据有效，Jumia 店铺连接成功' };
  const j = await r.json().catch(() => null);
  const m = j && (j.message || j.error_description || j.error);
  return { verifyable: true, ok: false, msg: `Jumia 校验失败：${m || 'HTTP ' + r.status}` };
}

async function checkManualPlatform(platform: string, creds: Record<string, unknown>): Promise<VerifyResult> {
  const p = platform.toLowerCase();
  if (p.startsWith('amazon')) return verifyAmazon(creds);
  if (p.startsWith('walmart')) return verifyWalmart(creds);
  if (p.startsWith('etsy')) return verifyEtsy(creds);
  if (p.startsWith('shopify')) return verifyShopify(creds);
  if (p.startsWith('ebay')) return verifyEBay(creds);
  if (p.startsWith('woo')) return verifyWooCommerce(creds);
  if (p.startsWith('ozon')) return verifyOzon(creds);
  if (p.startsWith('wildberries')) return verifyWildberries(creds);
  if (p.startsWith('mercado')) return verifyMercadoLibre(creds);
  if (p.startsWith('coupang')) return verifyCoupang(creds);
  if (p.startsWith('bigcommerce')) return verifyBigCommerce(creds);
  if (p.startsWith('magento')) return verifyMagento(creds);
  if (p.startsWith('prestashop')) return verifyPrestaShop(creds);
  if (p.startsWith('allegro')) return verifyAllegro(creds);
  if (p.startsWith('kaufland')) return verifyKaufland(creds);
  if (p.startsWith('yandex')) return verifyYandexMarket(creds);
  if (p.startsWith('wish')) return verifyWish(creds);
  if (p.startsWith('wix')) return verifyWix(creds);
  if (p.startsWith('jumia')) return verifyJumia(creds);
  // Qoo10：官方 API 已不可达（2026 实测 api.qoo10.com 超时），无法真实校验，保持对接中
  // 剩余平台：尚未接入官方真实验证 → 不允许保存（宁可拒绝，不能让未经验证的凭据冒充已授权）
  return {
    verifyable: false,
    ok: false,
    msg: `「${platform}」的官方真实验证正在接入中，当前暂不接受手动录入`,
  };
}

// 兜底校验：凭据对象至少有一个非空字段（字段级必填由前端保证，这里防绕过）
function hasAnyCredential(creds: Record<string, unknown>): boolean {
  return Object.values(creds).some((v) => String(v ?? '').trim().length > 0);
}

// ─── 授权状态机（token_expires_at 参与） ────────────────────────────────
/** 距到期 ≤30 天 → 即将到期；已过期 → 已过期；否则保持 baseStatus */
function deriveStatusByExpiry(baseStatus: string, tokenExpiresAt: string | null): string {
  if (!tokenExpiresAt) return baseStatus;
  const ts = new Date(tokenExpiresAt).getTime();
  if (!Number.isFinite(ts)) return baseStatus;
  const days = (ts - Date.now()) / MS_DAY;
  if (days < 0) return '已过期';
  if (days <= EXPIRING_WINDOW_DAYS) return '即将到期';
  return baseStatus;
}

/** 按平台配置的 token_ttl_days 推算到期时间（未配置 = 永久有效或未知 → null） */
function expiryFromTtlDays(ttlDays: number | null | undefined): string | null {
  if (!ttlDays || ttlDays <= 0) return null;
  return new Date(Date.now() + ttlDays * MS_DAY).toISOString();
}

/** 到期时间 → 剩余天数 */
function daysFromExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ts = new Date(expiresAt).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.round((ts - Date.now()) / MS_DAY));
}

/**
 * 找同一用户 / 平台下同一家店的「有效授权行」（先查后 upsert 的第一步）。
 * 唯一索引是表达式索引：
 *   uq_shop_auths_user_platform_shop
 *     (user_id, platform, COALESCE(platform_shop_id, shop_domain, shop_name)) WHERE unbound_at IS NULL
 *   → PostgREST 的 onConflict 不支持表达式索引，只能先查再写（裸 insert 会撞 23505）。
 */
async function findActiveAuth(admin: AdminClient, userId: string, platform: string, key: string): Promise<{ id: string } | null> {
  if (!key) return null;
  const { data } = await admin
    .from('shop_auths')
    .select('id, platform_shop_id, shop_domain, shop_name')
    .eq('user_id', userId)
    .eq('platform', platform)
    .is('unbound_at', null);
  const rows = (data ?? []) as Array<{ id: string; platform_shop_id: string | null; shop_domain: string | null; shop_name: string }>;
  const hit = rows.find((r) => (r.platform_shop_id || r.shop_domain || r.shop_name) === key);
  return hit ? { id: hit.id } : null;
}

/** 先查后 upsert：命中有效行就更新，否则插入 */
async function upsertShopAuth(admin: AdminClient, userId: string, platform: string, key: string, payload: Record<string, unknown>): Promise<{ id: string; created: boolean }> {
  const dup = await findActiveAuth(admin, userId, platform, key);
  if (dup?.id) {
    const { error } = await admin.from('shop_auths').update(payload).eq('id', dup.id);
    if (error) throw new Error(`保存授权失败：${error.message}`);
    return { id: dup.id, created: false };
  }
  const { data, error } = await admin.from('shop_auths').insert(payload).select('id').single();
  if (error) throw new Error(`保存授权失败：${error.message}`);
  return { id: (data as { id: string }).id, created: true };
}

/** 模板占位替换：{client_id} / {access_token} …（值做 URL 编码） */
function buildTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(encodeURIComponent(v));
  }
  return out;
}

/** 模板变量严格解析：返回最终 URL / 被消费的键 / 缺失的键 */
function applyTemplateVars(tpl: string, creds: Record<string, string>): { url: string; used: string[]; missing: string[] } {
  const used: string[] = [];
  const missing: string[] = [];
  let out = tpl;
  for (const m of tpl.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    const k = m[1];
    const v = creds[k];
    if (v === undefined) { missing.push(k); continue; }
    out = out.split(m[0]).join(encodeURIComponent(v));
    used.push(k);
  }
  return { url: out, used, missing };
}

/** URL 里还剩哪些未替换的占位符 */
function unfilledPlaceholders(url: string): string[] {
  return [...new Set((url.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).map((s) => s.slice(1, -1)))];
}

/** 解析 a.b[].c 形式路径 */
function resolvePath(obj: unknown, path: string): unknown {
  const m = path.match(/^(.*?)\[\]\.(.+)$/);
  if (m) {
    const arr = resolvePath(obj, m[1]);
    if (!Array.isArray(arr)) return undefined;
    return arr.map((it) => resolvePath(it, m[2]));
  }
  return path.split('.').reduce<unknown>((acc, k) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[k];
  }, obj);
}

/** 按 platform_auth_config.shop_list_field_path 把平台返回的店铺清单归一成 ERP 字段 */
const SHOP_LIST_FIELD_ALIAS: Record<string, string> = {
  name: 'shop_name',
  shopId: 'platform_shop_id',
  shop_id: 'platform_shop_id',
  region: 'region',
  globalStoreId: 'global_store_id',
  sellerType: 'seller_type',
  code: 'platform_shop_code',
  cipher: 'shop_cipher',
  authTime: 'auth_time',
  expireTime: 'expire_time',
};

function extractShops(raw: unknown, pathMap: Record<string, string> | null): Array<Record<string, unknown>> {
  const entries = Object.entries(pathMap ?? {});
  if (!entries.length) return [];
  // 数组路径 = 第一个含 "[]." 的映射去掉 "[]" 后的前缀
  //   例：TikTok "data.shops[].name" → 数组在 data.shops；Etsy "shops[].shop_id" → 数组在 shops
  const arrEntry = entries.find(([, p]) => p.includes('[].'));
  if (!arrEntry) return [];
  const arrPath = arrEntry[1].split('[]')[0];
  const arr = resolvePath(raw, arrPath);
  if (!Array.isArray(arr)) return [];
  const rootCache: Record<string, unknown> = {};
  return arr.map((el) => {
    const out: Record<string, unknown> = {};
    for (const [key, path] of entries) {
      let v: unknown;
      if (path.includes('[].')) {
        // 元素级字段：相对数组元素解析
        const rel = path.slice(arrPath.length).replace(/^\[\]\./, '');
        v = resolvePath(el, rel);
      } else {
        // 根级字段（如 global_store_id = user_id）：整批共用
        if (!(key in rootCache)) rootCache[key] = resolvePath(raw, path);
        v = rootCache[key];
      }
      if (v === undefined) continue;
      out[SHOP_LIST_FIELD_ALIAS[key] ?? key] = v;
    }
    return out;
  });
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405);

  const requestId = crypto.randomUUID().slice(0, 8);
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ error: 'JSON 格式错误' }, 400); }

  const action = String(body.action ?? '').trim();
  const platform = String(body.platform ?? '').trim();
  const shopName = String(body.shop_name ?? '').trim();
  const region = String(body.region ?? '').trim();
  const credentials = (body.credentials ?? {}) as Record<string, unknown>;
  const shop = String(body.shop ?? '').trim();   // Shopify OAuth 需要
  const code = String(body.code ?? '').trim();   // OAuth callback 需要
  const authId = String(body.id ?? '').trim();   // delete / shop-update 需要
  const platformError = String(body.error ?? '').trim();          // 平台回调可能带 error（用户拒绝授权）
  const patch = (body.patch ?? {}) as Record<string, unknown>;   // shop-update 的字段补丁
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map((v) => String(v)) : [];  // status-scan 的店铺 id

  try {
    const userId = await resolveUserId(req);

    // ── list：当前用户所有授权（补齐 v2.4 店铺档案列） ──
    if (action === 'list') {
      if (!userId) return json({ error: '未登录' }, 401);
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const { data, error } = await admin
        .from('shop_auths')
        .select('id, platform, platform_shop_id, shop_name, shop_alias, region, auth_type, auth_method,'
          + ' auth_group_id, status, shop_status, global_store_id, global_store_name, global_store_source,'
          + ' subject_account_id, auth_scope, biz_model, seller_level, shop_type, group_ids,'
          + ' token_expires_at, validity_days, authorized_at, authorized_at_ts, last_checked_at,'
          + ' data_source, manual_fields, sort_order, is_new, remark, notify_enabled, unbound_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      const quota = await checkShopQuota(admin, userId, platform || undefined);
      return json({
        items: data ?? [],
        quota: { used: quota.used, quota: quota.quota, freeLimit: quota.freeLimit, purchased: quota.purchased },
      });
    }

    // ── delete：解绑一个授权（软解绑，保留行 → orders.shop_id 等外键不悬空） ──
    if (action === 'delete') {
      if (!userId) return json({ error: '未登录' }, 401);
      if (!authId) return json({ error: '缺少 id' }, 400);
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      // ⚠️ 必须同时改 status —— 否则按 status='已授权' 过滤的结算 / 刊登 / 发货链路会继续拉已解绑店铺
      const { error } = await admin
        .from('shop_auths')
        .update({ unbound_at: new Date().toISOString(), status: '已停用' })
        .eq('id', authId)
        .eq('user_id', userId)
        .is('unbound_at', null);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true, softUnbound: true, status: '已停用' });
    }

    // ── shop-update：编辑店铺档案（白名单字段 + manual_fields 标记） ──
    if (action === 'shop-update') {
      if (!userId) return json({ error: '未登录' }, 401);
      if (!authId) return json({ error: '缺少 id' }, 400);
      const EDITABLE = new Set(['shop_alias', 'shop_type', 'group_ids', 'remark', 'notify_enabled',
        'sort_order', 'biz_model', 'seller_level', 'global_store_name', 'global_store_id',
        'global_store_source', 'region', 'platform_shop_id']);
      const keys = Object.keys(patch);
      const bad = keys.filter((k) => !EDITABLE.has(k));
      if (bad.length) return json({ error: `不允许修改这些字段：${bad.join(', ')}` }, 400);
      if (keys.includes('group_ids')) {
        const gids = patch.group_ids;
        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!Array.isArray(gids) || gids.some((g) => !uuidRe.test(String(g)))) {
          return json({ error: 'group_ids 必须是分组 uuid 数组' }, 400);
        }
      }
      if (keys.includes('global_store_source')
        && !['platform', 'suggested', 'manual'].includes(String(patch.global_store_source))) {
        return json({ error: 'global_store_source 只能是 platform / suggested / manual' }, 400);
      }
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const { data: cur, error: curErr } = await admin
        .from('shop_auths').select('id, manual_fields').eq('id', authId).eq('user_id', userId).maybeSingle();
      if (curErr) return json({ error: curErr.message }, 500);
      if (!cur) return json({ error: '授权记录不存在' }, 404);
      // 用户手工改过的列 → 记进 manual_fields（前端显示「人工维护」角标）
      const manual = new Set<string>(((cur as { manual_fields: string[] }).manual_fields ?? []) as string[]);
      for (const k of keys) manual.add(k);
      const { error } = await admin
        .from('shop_auths')
        .update({ ...patch, manual_fields: [...manual] })
        .eq('id', authId)
        .eq('user_id', userId);
      if (error) return json({ error: error.message }, 500);
      console.info(`[${functionName}] shop-update ${requestId} id=${authId} fields=${keys.join(',')}`);
      return json({ success: true, id: authId, updated: keys, manual_fields: [...manual] });
    }

    // ── shop-groups：分组（多值 uuid[]）增删改查 ──
    if (action === 'shop-groups') {
      if (!userId) return json({ error: '未登录' }, 401);
      const op = String(body.op ?? '').trim() || 'list';
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      if (op === 'list') {
        const { data, error } = await admin
          .from('shop_groups').select('id, name, color, sort_order, created_at')
          .eq('user_id', userId).order('sort_order', { ascending: true });
        if (error) return json({ error: error.message }, 500);
        return json({ groups: data ?? [] });
      }
      const groupId = String(body.group_id ?? '').trim();
      const groupName = String(body.name ?? '').trim();
      if (op === 'create') {
        if (!groupName) return json({ error: '缺少 name' }, 400);
        const { data, error } = await admin
          .from('shop_groups')
          .insert({ user_id: userId, name: groupName, color: body.color ?? null, sort_order: Number(body.sort_order ?? 0) })
          .select('id, name, color, sort_order').single();
        if (error) return json({ error: error.message }, 500);
        return json({ success: true, group: data });
      }
      if (op === 'rename') {
        if (!groupId || !groupName) return json({ error: '缺少 group_id 或 name' }, 400);
        const { error } = await admin.from('shop_groups').update({ name: groupName }).eq('id', groupId).eq('user_id', userId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true, id: groupId });
      }
      if (op === 'delete') {
        if (!groupId) return json({ error: '缺少 group_id' }, 400);
        // 先把该分组从所有店铺的 group_ids 里摘掉，再删分组本体
        const { data: rows } = await admin.from('shop_auths').select('id, group_ids').eq('user_id', userId);
        for (const r of (rows ?? []) as Array<{ id: string; group_ids: string[] }>) {
          const gids = r.group_ids ?? [];
          if (!gids.includes(groupId)) continue;
          await admin.from('shop_auths').update({ group_ids: gids.filter((g) => g !== groupId) }).eq('id', r.id);
        }
        const { error } = await admin.from('shop_groups').delete().eq('id', groupId).eq('user_id', userId);
        if (error) return json({ error: error.message }, 500);
        return json({ success: true, id: groupId });
      }
      return json({ error: `未知 shop-groups 操作：${op}` }, 400);
    }

    // ── status-scan：店铺状态检测（转调 shop-status-check；未部署则如实报错） ──
    if (action === 'status-scan') {
      const base = getEnv('SUPABASE_URL');
      const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
      // 转调下游时必须透传调用方的 Authorization：shop-status-check 用 admin.auth.getUser(token) 解析用户，
      // 换成 service_role key 会被判成「未登录」（401），店铺状态检测因此长期不可用。
      const callerAuth = req.headers.get('Authorization') ?? `Bearer ${key}`;
      const callScan = async (payload: Record<string, unknown>) => {
        const res = await fetch(`${base}/functions/v1/shop-status-check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: callerAuth },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };
      try {
        // ── 全量检测：一次调用 ──
        if (ids.length === 0) {
          const { res, data } = await callScan({ action: 'check-all' });
          if (res.status === 404) {
            return json({ error: '状态检测服务未部署（shop-status-check 缺失）', code: 'STATUS_CHECK_UNAVAILABLE' }, 503);
          }
          // 下游容器起不来时网关会返 500（InvalidWorkerCreation），语义同样是「服务不可用」
          if (!res.ok) {
            return json({ error: `状态检测服务不可用（HTTP ${res.status}）`, code: 'STATUS_CHECK_UNAVAILABLE', detail: data }, 503);
          }
          return json(data);
        }
        // ── 指定店铺检测 ──
        // shop-status-check 的 check 只接受单个 id（body.id），这里逐店调用后合并计数与明细，
        // 避免历史实现传 { action:'check', ids:[…] } 被下游判成「缺少 id」而永远检测失败。
        const merged = {
          checked: 0, ok: 0, failed: 0, unchecked: 0,
          results: [] as Record<string, unknown>[],
          degraded: false, degraded_reason: '',
        };
        let svcErr = '';
        let svcStatus = 0;
        for (const id of ids) {
          const { res, data } = await callScan({ action: 'check', id });
          if (res.status === 404) {
            return json({ error: '状态检测服务未部署（shop-status-check 缺失）', code: 'STATUS_CHECK_UNAVAILABLE' }, 503);
          }
          if (!res.ok) {
            if (!svcErr) { svcErr = `状态检测服务不可用（HTTP ${res.status}）`; svcStatus = res.status; }
            continue;
          }
          merged.checked += Number(data.checked ?? 0);
          merged.ok += Number(data.ok ?? 0);
          merged.failed += Number(data.failed ?? 0);
          merged.unchecked += Number(data.unchecked ?? 0);
          if (Array.isArray(data.results)) merged.results.push(...(data.results as Record<string, unknown>[]));
          if (data.degraded === true) {
            merged.degraded = true;
            merged.degraded_reason = String(data.degraded_reason ?? merged.degraded_reason);
          }
        }
        if (merged.checked === 0 && svcErr) {
          return json({ error: svcErr, code: 'STATUS_CHECK_UNAVAILABLE', status: svcStatus }, 503);
        }
        console.info(`[${functionName}] status-scan ids=${ids.length} checked=${merged.checked} ok=${merged.ok} failed=${merged.failed} unchecked=${merged.unchecked}`);
        return json(merged);
      } catch (e) {
        return json({ error: '状态检测服务不可用（shop-status-check 未部署）', code: 'STATUS_CHECK_UNAVAILABLE', detail: e instanceof Error ? e.message : String(e) }, 503);
      }
    }

    // ── 以下 action 需要登录 + 平台存在 ──
    if (!userId) return json({ error: '未登录' }, 401);
    if (!platform) return json({ error: '缺少 platform' }, 400);

    const platInfo = await getPlatformInfo(platform);
    if (!platInfo) return json({ error: `平台「${platform}」不存在或已停用` }, 400);
    const authType = platInfo.auth_type;

    // ── oauth-url：生成 OAuth 跳转 URL ──
    if (action === 'oauth-url') {
      if (authType !== 'oauth') return json({ error: `「${platform}」不是 OAuth 型平台` }, 400);
      let url: string;
      const authCfg = platInfo.authCfg;
      // 优先走 DB 配置的授权端点模板（platform_auth_config.authorize_endpoint）
      //   密钥未就绪（oauth_ready ≠ true）时不用这条路径 —— 宁可报未就绪，也不给假跳转
      if (authCfg?.authorize_endpoint && authCfg.oauth_ready === true) {
        url = buildTemplate(authCfg.authorize_endpoint, {
          redirect_uri: Deno.env.get('OAUTH_REDIRECT_URI') ?? '',
          state: crypto.randomUUID(),
          shop,
          scope: 'read_products,read_orders,read_customers',
          client_id: Deno.env.get('SHOPIFY_CLIENT_ID') ?? '',
          app_key: Deno.env.get('TIKTOK_APP_KEY') ?? '',
          service_id: Deno.env.get('TIKTOK_SERVICE_ID') ?? '',
          user_id: '',
          code_challenge: '',
        });
        const missing = unfilledPlaceholders(url);
        if (missing.length) {
          return json({ error: `授权端点模板变量缺失：${missing.join(', ')}（platform_auth_config.authorize_endpoint 未配全）`, code: 'MISSING_TEMPLATE_VARS' }, 500);
        }
      } else if (platform === 'Shopify') {
        if (!shop) return json({ error: '缺少 shop（Shopify 店铺域名）' }, 400);
        url = shopifyAuthorizeUrl(shop);
      } else if (platform === 'TikTok Shop') {
        url = tiktokAuthorizeUrl();
      } else if (platform === 'Lazada') {
        oauthNotReady(platform); // TODO: Lazada OAuth 密钥待配置
      } else if (platform === 'Shopee') {
        oauthNotReady(platform); // TODO: Shopee OAuth 密钥待配置
      } else {
        oauthNotReady(platform);
      }
      console.info(`[${functionName}] oauth-url ${requestId} platform=${platform}`);
      return json({ url });
    }

    // ── oauth-callback：code 换 token + 入库（一次授权可落 N 店） ──
    if (action === 'oauth-callback') {
      if (authType !== 'oauth') return json({ error: `「${platform}」不是 OAuth 型平台` }, 400);
      if (platformError) {
        // 平台回调可能带 error（如用户拒绝授权：code=null&error=auth_denied）
        return json({ error: `平台授权失败：${platformError}`, platformError }, 400);
      }
      if (!code) return json({ error: '缺少 code', hint: '平台回调未携带授权码（用户可能已拒绝授权）' }, 400);

      const secret = Deno.env.get('JWT_SECRET') ?? 'thalvior-default-secret';
      const authGroupId = crypto.randomUUID();   // 同一次授权产生的 N 行共用（批量刷 token / 续期用）
      const nowIso = new Date().toISOString();
      const nowDate = nowIso.slice(0, 10);
      const ttlDays = platInfo.authCfg?.token_ttl_days ?? null;
      const shopRows: Array<Record<string, unknown>> = [];

      if (platform === 'Shopify') {
        if (!shop) return json({ error: '缺少 shop' }, 400);
        const r = await shopifyCallback(shop, code);
        const expiresAt = r.expiresIn ? new Date(Date.now() + r.expiresIn * 1000).toISOString() : expiryFromTtlDays(ttlDays);
        shopRows.push({
          shop_name: shop,
          platform_shop_id: shop,
          region: '独立站',
          subject_account_id: null,
          auth_scope: r.scope,
          shop_type: 'cross',
          access_token: r.accessToken,
          refresh_token: r.refreshToken ?? '',
          scope: r.scope,
          shop_domain: shop,
          token_expires_at: expiresAt,
          validity_days: ttlDays ?? daysFromExpiry(expiresAt),
          credentials_enc: await encryptCredentials(JSON.stringify({
            access_token: r.accessToken, refresh_token: r.refreshToken, shop_domain: shop,
          }), secret),
        });
      } else if (platform === 'TikTok Shop') {
        const r = await tiktokCallback(code);
        const appKey = Deno.env.get('TIKTOK_APP_KEY') ?? '';
        for (const s of r.shops) {
          const platformShopId = s.id ?? s.shop_id ?? s.cipher ?? s.code ?? null;
          const expiresAt = r.accessTokenExpiresIn
            ? new Date(Date.now() + r.accessTokenExpiresIn * 1000).toISOString()
            : expiryFromTtlDays(ttlDays);
          shopRows.push({
            shop_name: s.name ?? 'TikTok Shop 店铺',
            platform_shop_id: platformShopId,
            region: s.region ?? '短视频电商',
            subject_account_id: r.openId,
            auth_scope: JSON.stringify(r.grantedScopes),
            shop_type: (r.userType === 4 || r.userType === 5 || s.seller_type === 'CROSS_BORDER') ? 'cross' : 'local',
            access_token: r.accessToken,
            refresh_token: r.refreshToken ?? '',
            scope: r.grantedScopes.join(','),
            shop_domain: null,
            token_expires_at: expiresAt,
            validity_days: ttlDays ?? daysFromExpiry(expiresAt),
            // N 店授权 = 同一份 token 复制 N 份密文（每行独立 IV），保持「一行 = 一店 = 一份凭据」
            credentials_enc: await encryptCredentials(JSON.stringify({
              access_token: r.accessToken, refresh_token: r.refreshToken,
              shop_cipher: s.cipher ?? null, app_key: appKey,
            }), secret),
          });
        }
        if (!shopRows.length) {
          // 平台没返回店铺清单：保留 1 行占位（与旧行为一致），platform_shop_id 留空
          const expiresAt = r.accessTokenExpiresIn
            ? new Date(Date.now() + r.accessTokenExpiresIn * 1000).toISOString()
            : expiryFromTtlDays(ttlDays);
          shopRows.push({
            shop_name: r.sellerName ?? 'TikTok Shop 店铺',
            platform_shop_id: null,
            region: r.sellerBaseRegion ?? '短视频电商',
            subject_account_id: r.openId,
            auth_scope: JSON.stringify(r.grantedScopes),
            shop_type: 'cross',
            access_token: r.accessToken,
            refresh_token: r.refreshToken ?? '',
            scope: r.grantedScopes.join(','),
            shop_domain: null,
            token_expires_at: expiresAt,
            validity_days: ttlDays ?? daysFromExpiry(expiresAt),
            credentials_enc: await encryptCredentials(JSON.stringify({
              access_token: r.accessToken, refresh_token: r.refreshToken, app_key: appKey,
            }), secret),
          });
        }
      } else {
        oauthNotReady(platform);
      }

      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const quota = await checkShopQuota(admin, userId, platform);
      // 一次授权 N 店 = 占用 N 个额度，必须在写入前判
      if (!quota.ok || quota.used + shopRows.length > quota.quota) {
        return json({ error: `店铺授权额度不足：本次授权将新增 ${shopRows.length} 个店铺，当前已授权 ${quota.used}/${quota.quota}（含免费 ${quota.freeLimit} 店）。请前往「订阅中心 → 店铺授权额度」扩容后再授权`, code: 'SHOP_LICENSE_REQUIRED' }, 403);
      }

      const saved: Array<{ id: string; shop_name: string; created: boolean }> = [];
      for (const row of shopRows) {
        const key = String(row.platform_shop_id ?? row.shop_name ?? '');
        const status = deriveStatusByExpiry('已授权', (row.token_expires_at as string | null) ?? null);
        const payload = {
          ...row,
          user_id: userId, platform,
          auth_type: 'oauth', auth_method: 'oauth',
          auth_group_id: authGroupId,
          authorized_at: nowDate,
          authorized_at_ts: nowIso,
          status,
          data_source: 'api', shop_status: '未检测',
          is_new: true, notify_enabled: true,
          shop_alias: null, remark: null,
          global_store_id: null, global_store_name: null, global_store_source: 'platform',
          biz_model: null, seller_level: null, manual_fields: [],
        };
        const r = await upsertShopAuth(admin, userId, platform, key, payload);
        saved.push({ id: r.id, shop_name: String(row.shop_name ?? ''), created: r.created });
      }

      console.info(`[${functionName}] oauth-callback ${requestId} platform=${platform} shops=${shopRows.length} group=${authGroupId}`);
      return json({
        success: true,
        shop: saved.length === 1 ? saved[0].shop_name : `${saved.length} 个店铺`,
        platform, count: saved.length, shops: saved, auth_group_id: authGroupId,
      });
    }

    // ── cred-verify：校验手动凭据（OAuth 未就绪平台转手动时同样允许） ──
    if (action === 'cred-verify') {
      const r = await checkManualPlatform(platform, credentials);
      // 只有平台官方接口确认有效，才算校验通过
      return json({ valid: r.verifyable && r.ok, verifyable: r.verifyable, message: r.msg });
    }

    // ── cred-save：校验 + 加密 + 入库（补齐 v2.4 店铺档案列） ──
    if (action === 'cred-save') {
      if (!shopName) return json({ error: '缺少 shop_name' }, 400);
      if (!hasAnyCredential(credentials)) return json({ error: '请填写至少一项平台凭据' }, 400);

      const r = await checkManualPlatform(platform, credentials);
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const quota = await checkShopQuota(admin, userId, platform);
      if (!quota.ok) {
        return json({ error: `店铺授权额度已用满（已授权 ${quota.used}/${quota.quota}，含免费 ${quota.freeLimit} 店）。请前往「订阅中心 → 店铺授权额度」扩容后再授权`, code: 'SHOP_LICENSE_REQUIRED' }, 403);
      }

      const secret = Deno.env.get('JWT_SECRET') ?? 'thalvior-default-secret';
      const encrypted = await encryptCredentials(JSON.stringify(credentials), secret);
      const nowIso = new Date().toISOString();
      const ttlDays = platInfo.authCfg?.token_ttl_days ?? null;
      const tokenExpiresAt = expiryFromTtlDays(ttlDays);
      // 用户手工填的字段 → manual_fields（前端显示「人工维护」角标）
      const manualFields = Object.keys(credentials).map((k) => `credentials.${k}`);
      const platformShopId = String(body.platform_shop_id ?? '').trim() || null;
      const basePayload: Record<string, unknown> = {
        user_id: userId, shop_name: shopName, platform, region: region || '',
        platform_shop_id: platformShopId,
        auth_type: 'manual',
        auth_method: 'token',        // 手动粘贴凭据 = token 路线（oauth 走 oauth-callback）
        credentials_enc: encrypted,
        verify_at: nowIso,
        token_expires_at: tokenExpiresAt,
        validity_days: ttlDays ?? daysFromExpiry(tokenExpiresAt),
        data_source: 'user', shop_status: '未检测',
        is_new: true, notify_enabled: true,
        shop_alias: null, remark: null,
        global_store_id: null, global_store_name: null, global_store_source: 'platform',
        biz_model: null, seller_level: null, subject_account_id: null, auth_scope: null,
        manual_fields: manualFields,
        auth_group_id: crypto.randomUUID(),   // 单店授权也要有（不变式：每行都有 auth_group_id）
      };

      // 铁律：未接入真实验证、或平台返回无效，一律拒绝入库为「已授权」
      if (!r.verifyable || !r.ok) {
        // 例外：平台校验请求无法完成时（如 Ozon 未开通 API/网络不可达），凭据加密入库为「待验证」，绝不冒充「已授权」
        if ((r as VerifyResult).softSave) {
          // 状态机已把 softSave 从「对接中」收敛为「待验证」，出口文案同步（不改动 verify 函数本体）
          const softMsg = r.msg.replace(/对接中/g, '待验证');
          const saved = await upsertShopAuth(admin, userId, platform, platformShopId || shopName, {
            ...basePayload, status: '待验证', verify_note: softMsg, authorized_at: null, authorized_at_ts: null,
          });
          console.info(`[${functionName}] cred-save ${requestId} platform=${platform} status=待验证(softSave) id=${saved.id}`);
          return json({ valid: false, verifyable: false, status: '待验证', message: softMsg, id: saved.id });
        }
        return json({ valid: false, verifyable: r.verifyable, message: r.msg }, 400);
      }

      const finalStatus = deriveStatusByExpiry('已授权', tokenExpiresAt);
      const verifyNote = r.msg;
      const saved = await upsertShopAuth(admin, userId, platform, platformShopId || shopName, {
        ...basePayload,
        status: finalStatus,
        verify_note: verifyNote,
        authorized_at: finalStatus === '已过期' ? null : nowIso.slice(0, 10),
        authorized_at_ts: nowIso,
      });

      console.info(`[${functionName}] cred-save ${requestId} platform=${platform} status=${finalStatus} id=${saved.id}`);
      // '即将到期' 仍是有效授权（与 ACTIVE_AUTH_STATUSES 口径一致），不能报 valid=false
      return json({ valid: ACTIVE_VALID_STATUSES.includes(finalStatus), verifyable: r.verifyable, status: finalStatus, message: verifyNote, id: saved.id });
    }

    // ── shop-list：拉平台店铺清单（不写库，只返回给前端选） ──
    if (action === 'shop-list') {
      const cfg = platInfo.authCfg;
      if (!cfg?.shop_list_endpoint) {
        return json({ error: `「${platform}」未配置店铺清单接口（platform_auth_config.shop_list_endpoint 为空），无法自动拉取`, code: 'NOT_CONFIGURED' }, 400);
      }
      const creds: Record<string, string> = {};
      for (const [k, v] of Object.entries((body.credentials ?? {}) as Record<string, unknown>)) {
        if (v !== undefined && v !== null && String(v) !== '') creds[k] = String(v);
      }
      if (body.access_token) creds.access_token = String(body.access_token);
      if (!Object.keys(creds).length) return json({ error: '缺少平台凭据（credentials 或 access_token）' }, 400);
      // 模板变量严格消费：缺一个就报清楚，不发半成品请求
      const tpl = applyTemplateVars(cfg.shop_list_endpoint, creds);
      if (tpl.missing.length) {
        return json({ error: `平台清单接口缺少变量：${tpl.missing.join(', ')}（请在凭据里补齐后再试）`, code: 'MISSING_TEMPLATE_VARS' }, 400);
      }
      // 没被模板消费的凭据 → GET 走 query、POST 走 body（Shopee partner_id/key 这类）
      const rest = Object.fromEntries(Object.entries(creds).filter(([k]) => !tpl.used.includes(k)));
      const method = (cfg.shop_list_method ?? 'GET').toUpperCase();
      let url = tpl.url;
      const init: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(creds.access_token ? { Authorization: `Bearer ${creds.access_token}` } : {}),
        },
      };
      if (method === 'POST') {
        init.body = JSON.stringify(rest);
      } else if (Object.keys(rest).length) {
        const qs = new URLSearchParams(rest).toString();
        url = url + (url.includes('?') ? '&' : '?') + qs;
      }
      const res = await fetchWithTimeout(url, init);
      const raw = await res.json().catch(() => null);
      if (!res.ok) return json({ error: `平台返回 HTTP ${res.status}`, detail: raw }, 502);
      const shops = extractShops(raw, cfg.shop_list_field_path);
      if (!shops.length) return json({ error: '平台未返回可识别的店铺清单', code: 'NO_SHOP_LIST', raw }, 502);
      console.info(`[${functionName}] shop-list ${requestId} platform=${platform} shops=${shops.length}`);
      return json({ shops, count: shops.length });
    }

    return json({ error: `未知 action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
