// shop-market-order — 电商平台服务市场订购（ERP 服务上架 / 商家订购 / 订购查询）
// =====================================================================
// 职责：在各电商平台的服务市场里，为「本 ERP 的增值服务」提供订购与查询能力。
//
//   list-services  { platform, shop_id? }      查询该平台可订购的服务清单
//   list-orders    { platform, shop_id? }      查询该平台的服务订购记录
//   create-order   { platform, shop_id, ... }  为指定店铺发起一次服务订购
//   query-order    { platform, order_id, shop_id? }  查询单个订购记录
//
// 重要边界（务必先读）：
//   各平台的服务市场订购都必须先取得 ISV / 开发者资质，资质没到位，平台侧接口根本调不通：
//     · Shopify      需 Partner 开发者账号 + 应用创建 + 应用上架审核（App review）
//                    审核未通过的应用不会出现在 App Store，商家无法订购；
//     · AliExpress  商用应用必须先购买服务市场服务，否则平台回调返回 AUTH_TYPE_UNSUPPORTED；
//     · Temu        开放平台授权时需勾选「特殊授权」（Special Authorization）并通过开发者审核；
//     · 抖音/淘宝系  需 ISV 资质入驻（开发者认证 + 应用审核 + 服务市场服务上架）；
//     · TikTok Shop 需开放平台开发者账号 + 应用审核通过后才能在应用市场接受订购。
//   所以本函数对每个平台都保留明确的 notConfigured 分支：
//     HTTP 400 + { error: '<资质提示文案>', code: 'MARKET_NOT_CONFIGURED', required_credentials: [...] }
//   不返回 500（不是系统故障，是资质未就绪），更不返回空数组冒充「平台没有服务」。
//   铁律：不写假的下单逻辑 —— 没有资质就没有订购，平台侧真实返回什么就回什么，绝不伪造成功。
//
// 数据源：
//   platform_auth_config —— 平台元数据（platform_key / platform_name / auth_type / api_base_url）
//   ⚠ 线上还没有 market_service_id / market_api_base 两列（迁移待补，本函数不改表结构）：
//       ALTER TABLE public.platform_auth_config
//         ADD COLUMN IF NOT EXISTS market_service_id text,  -- 服务市场服务 ID / 应用 ID
//         ADD COLUMN IF NOT EXISTS market_api_base  text;  -- 服务市场订购接口基址
//     迁移落地前，所有平台走 notConfigured 分支（资质提示照常返回），不会伪造订购结果。
//
// 通用 REST 模式的接口约定（由 market_api_base 指向各平台真实接口基址）：
//     GET  {base}/services?service_id={market_service_id}            → list-services
//     GET  {base}/orders?service_id={market_service_id}&shop_id=…    → list-orders
//     GET  {base}/orders/{order_id}                                  → query-order
//     POST {base}/orders  { service_id, shop_id, plan, quantity }    → create-order
//   请求头约定：X-App-Key ← app_key，X-App-Secret ← app_secret，
//               Authorization: Bearer <access_token>（有 access_token 时）。
//   若某平台要求 HMAC 签名（淘宝 TOP / 抖音开放平台等），需另配签名适配器，
//   在适配器落地前平台侧会返回真实错误，本函数原样透传，绝不伪造成功响应。
//
// Shopify 模式走真实的 Admin API 订购（账单订阅）路径：
//     GET  https://{shop_domain}/admin/api/{version}/recurring_application_charges
//     POST https://{shop_domain}/admin/api/{version}/recurring_application_charges
//     GET  https://{shop_domain}/admin/api/{version}/recurring_application_charges/{id}
//   即：商家在 App Store 订购服务后，由本系统创建对应的服务订阅（recurring application charge）。
//
// 鉴权：Authorization: Bearer <用户 JWT>，未登录返回 401；所有操作限定当前用户名下的店铺。
//
// 环境变量：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET
//           SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET（Shopify 应用资质，仅 Shopify 模式需要）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const functionName = 'shop-market-order';

// ─── 通用工具 ────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

function optEnv(name: string): string | null {
  const v = Deno.env.get(name);
  return v && v.trim() ? v.trim() : null;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
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

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return raw;
}

// 手动凭据解密（与 authorize-shop 的 encryptCredentials 完全对称）
async function decryptCredentials(encB64: string, secret: string): Promise<Record<string, unknown>> {
  const enc = new TextEncoder();
  const raw = b64urlToBytes(encB64.trim());
  if (raw.length <= 12) throw new Error('凭据密文长度异常');
  const iv = raw.slice(0, 12);
  const cipher = raw.slice(12);
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  const parsed = JSON.parse(new TextDecoder().decode(plain));
  if (!parsed || typeof parsed !== 'object') throw new Error('凭据明文不是 JSON 对象');
  return parsed as Record<string, unknown>;
}

// ─── 类型 ────────────────────────────────────────────────────────────
type OrderMode = 'shopify_admin' | 'generic_rest';

interface MarketPlatform {
  key: string;
  label: string;
  aliases: string[];
  orderMode: OrderMode;
  /** 资质提示文案：明确写出「需要什么资质」 */
  qualifier: string;
  /** 返回给前端的 required_credentials（缺什么就列什么） */
  requiredCredentials: string[];
  /** 资质落地入口提示（不写可能过期的直链，写清去哪申请） */
  applyHint: string;
}

interface PlatformMarketConfig {
  platformKey: string;
  platformName: string;
  authType: string;
  apiBaseUrl: string | null;
  marketServiceId: string | null;
  marketApiBase: string | null;
}

interface ShopRow {
  id: string;
  user_id: string;
  shop_name: string;
  platform: string;
  status: string | null;
  auth_type: string | null;
  credentials_enc: string | null;
  access_token: string | null;
  shop_domain: string | null;
  platform_shop_id: string | null;
}

// ─── 服务市场平台登记表 ──────────────────────────────────────────────
// 名单内的平台：未取得资质 → 400 + 资质提示；名单外的平台 → 400 + 未接入服务市场
const MARKET_PLATFORMS: MarketPlatform[] = [
  {
    key: 'shopify',
    label: 'Shopify App Store',
    aliases: ['shopify'],
    orderMode: 'shopify_admin',
    qualifier:
      'Shopify 服务市场订购需要 ISV 资质：必须注册 Shopify Partner 开发者账号、创建 Partner 应用，并提交应用上架审核（App review）。审核通过前应用不会出现在 App Store，商家无法订购任何服务。',
    requiredCredentials: [
      'shopify_partner_account',
      'shopify_client_id',
      'shopify_client_secret',
      'shopify_app_listing_approved',
      'shopify_shop_access_token',
    ],
    applyHint: '在 Shopify Partner 后台创建应用并提交 App review，同时在后台配置服务方案与订购价格。',
  },
  {
    key: 'aliexpress',
    label: 'AliExpress 服务市场',
    aliases: ['aliexpress', '速卖通', 'aliexpress全球', 'aliexpress 全球'],
    orderMode: 'generic_rest',
    qualifier:
      'AliExpress 商用应用必须先购买服务市场服务，否则平台回调会返回 AUTH_TYPE_UNSUPPORTED。也就是必须先以卖家身份在服务市场完成服务订购授权，并具备 AliExpress 开放平台开发者账号与已通过审核的服务市场上架记录。',
    requiredCredentials: [
      'aliexpress_open_platform_developer',
      'app_key',
      'app_secret',
      'service_market_order_authorization',
      'seller_authorization',
    ],
    applyHint: '先在 AliExpress 服务市场完成一次服务订购（试用亦可），再把该服务对应的应用授权接入本系统。',
  },
  {
    key: 'alibaba',
    label: '阿里国际站服务市场',
    aliases: ['alibaba 国际站', 'alibaba国际站', 'alibaba international', 'alibaba'],
    orderMode: 'generic_rest',
    qualifier:
      '阿里国际站服务市场订购需要 ISV 资质入驻：完成开放平台开发者认证（企业资质）、创建应用并通过服务商审核，再把服务提交到服务市场上架；未取得 ISV 资质前无法调用订购接口。',
    requiredCredentials: [
      'isv_developer_qualification',
      'app_key',
      'app_secret',
      'service_listing_approved',
      'seller_authorization',
    ],
    applyHint: '在阿里国际站开放平台提交 ISV 入驻材料，审核通过后在服务市场上架服务。',
  },
  {
    key: 'temu',
    label: 'Temu 开放平台服务市场',
    aliases: ['temu'],
    orderMode: 'generic_rest',
    qualifier:
      'Temu 开放平台需要开发者资质审核，并在店铺授权时勾选「特殊授权」（Special Authorization）。未开通特殊授权的店铺无法调用订购类服务接口，平台会直接拒绝请求。',
    requiredCredentials: [
      'temu_developer_audit_passed',
      'app_key',
      'app_secret',
      'special_authorization',
      'seller_authorization',
    ],
    applyHint: '在 Temu 开放平台提交开发者资料，审核通过后重新授权店铺并勾选「特殊授权」。',
  },
  {
    key: 'douyin',
    label: '抖音 / 淘宝系服务市场',
    aliases: ['douyin', '抖音', '抖音电商', 'taobao', '淘宝', '天猫', 'tmall', '千牛', 'qianniu'],
    orderMode: 'generic_rest',
    qualifier:
      '抖音 / 淘宝系服务市场订购需要 ISV 资质入驻：完成开放平台开发者认证（企业资质）、创建应用并通过服务商（ISV）审核，再把服务提交到服务市场上架。未取得 ISV 资质前无法调用订购接口。',
    requiredCredentials: [
      'isv_developer_qualification',
      'app_key',
      'app_secret',
      'service_listing_approved',
      'seller_authorization',
    ],
    applyHint: '在对应开放平台完成 ISV 入驻与服务上架，服务市场上架通过后才能发起订购。',
  },
  {
    key: 'tiktok_shop',
    label: 'TikTok Shop 应用市场',
    aliases: ['tiktok shop', 'tiktokshop', 'tiktok'],
    orderMode: 'generic_rest',
    qualifier:
      'TikTok Shop 应用市场订购需要开放平台开发者资质：创建应用并通过 TikTok Shop 开放平台的应用审核（App review），审核通过后应用才能在应用市场接受商家订购。',
    requiredCredentials: [
      'tiktok_open_platform_developer',
      'app_key',
      'app_secret',
      'app_review_passed',
      'shop_access_token',
    ],
    applyHint: '在 TikTok Shop 开放平台创建应用并提交审核，审核通过后配置应用市场服务方案。',
  },
];

function normalizePlatform(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

function findMarketPlatform(platform: string): MarketPlatform | null {
  const p = normalizePlatform(platform);
  if (!p) return null;
  for (const mp of MARKET_PLATFORMS) {
    for (const alias of mp.aliases) {
      if (normalizePlatform(alias) === p) return mp;
    }
  }
  // 前缀兜底：'tiktok shop 东南亚' → 'tiktok shop'
  for (const mp of MARKET_PLATFORMS) {
    for (const alias of mp.aliases) {
      const a = normalizePlatform(alias);
      if (a && p.startsWith(`${a} `)) return mp;
    }
  }
  return null;
}

// 资质未就绪的统一响应（HTTP 400，不返回 500）
function notConfigured(mp: MarketPlatform, reason?: string): Response {
  const detail = reason ? `${mp.qualifier}（${reason}）` : mp.qualifier;
  return json(
    {
      error: detail,
      code: 'MARKET_NOT_CONFIGURED',
      platform: mp.label,
      required_credentials: mp.requiredCredentials,
      apply_hint: mp.applyHint,
    },
    400,
  );
}

// 未接入服务市场的平台
function marketNotSupported(platform: string): Response {
  return json(
    {
      error: `该平台暂未接入服务市场`,
      code: 'MARKET_NOT_SUPPORTED',
      platform,
    },
    400,
  );
}

// ─── 平台元数据读取 ──────────────────────────────────────────────────
// market_service_id / market_api_base 两列线上还没有 → 优雅降级（读不到就用基础列）
async function loadPlatformConfigs(
  admin: ReturnType<typeof createClient>,
): Promise<{ configs: Map<string, PlatformMarketConfig>; degraded: boolean; degradedReason: string }> {
  const baseCols = 'platform_key, platform_name, auth_type, api_base_url';
  const fullCols = `${baseCols}, market_service_id, market_api_base`;

  let degraded = false;
  let degradedReason = '';
  let rows: Record<string, unknown>[] = [];

  const full = await admin.from('platform_auth_config').select(fullCols);
  if (!full.error) {
    rows = (full.data ?? []) as unknown as Record<string, unknown>[];
  } else {
    const msg = String(full.error.message ?? '');
    if (/does not exist|PGRST204|42703|column/i.test(msg)) {
      degraded = true;
      degradedReason = 'platform_auth_config 尚未配置 market_service_id / market_api_base（迁移待补）';
      const basic = await admin.from('platform_auth_config').select(baseCols);
      if (basic.error) throw new Error(`读取平台服务市场配置失败：${basic.error.message}`);
      rows = (basic.data ?? []) as unknown as Record<string, unknown>[];
    } else {
      throw new Error(`读取平台服务市场配置失败：${msg}`);
    }
  }

  const configs = new Map<string, PlatformMarketConfig>();
  for (const r of rows) {
    const key = String(r.platform_key ?? '').trim();
    if (!key) continue;
    configs.set(key.toLowerCase(), {
      platformKey: key,
      platformName: String(r.platform_name ?? key),
      authType: String(r.auth_type ?? 'manual'),
      apiBaseUrl: r.api_base_url ? String(r.api_base_url) : null,
      marketServiceId: r.market_service_id ? String(r.market_service_id) : null,
      marketApiBase: r.market_api_base ? String(r.market_api_base) : null,
    });
  }
  return { configs, degraded, degradedReason };
}

function matchPlatformConfig(platform: string, configs: Map<string, PlatformMarketConfig>): PlatformMarketConfig | null {
  const p = normalizePlatform(platform);
  if (!p) return null;
  const exact = configs.get(p);
  if (exact) return exact;
  for (const [k, v] of configs) {
    if (k.startsWith(`${p} `)) return v;
    if (p.startsWith(`${k} `)) return v;
  }
  return null;
}

// ─── 店铺读取 ────────────────────────────────────────────────────────
const SHOP_FIELDS =
  'id, user_id, shop_name, platform, status, auth_type, credentials_enc, access_token, shop_domain, platform_shop_id';

async function loadShops(
  admin: ReturnType<typeof createClient>,
  userId: string,
  platform: string,
  shopId?: string,
): Promise<ShopRow[]> {
  let q = admin.from('shop_auths').select(SHOP_FIELDS).eq('user_id', userId);
  if (shopId) q = q.eq('id', shopId);
  const { data, error } = await q;
  if (error) throw new Error(`读取店铺列表失败：${error.message}`);
  let rows = (data ?? []) as unknown as ShopRow[];
  rows = rows.filter((s) => normalizePlatform(s.platform) === normalizePlatform(platform) || normalizePlatform(s.platform).startsWith(`${normalizePlatform(platform)} `));
  if (shopId) rows = rows.filter((s) => s.id === shopId);
  return rows;
}

// 取店铺可用凭据（手动型解 credentials_enc，OAuth 型用 access_token 列）
async function shopCredentialView(
  shop: ShopRow,
): Promise<{ view: Record<string, string>; error: string | null }> {
  const view: Record<string, string> = {};
  const put = (k: string, v: unknown) => {
    if (v === null || v === undefined) return;
    const kk = k.trim().toLowerCase();
    if (!kk || kk in view) return;
    view[kk] = String(v);
  };
  put('access_token', shop.access_token);
  put('shop_domain', shop.shop_domain);
  put('platform_shop_id', shop.platform_shop_id);
  put('shop_name', shop.shop_name);

  let creds: Record<string, unknown> = {};
  if (shop.credentials_enc) {
    try {
      const secret = Deno.env.get('JWT_SECRET') ?? 'thalvior-default-secret';
      creds = await decryptCredentials(shop.credentials_enc, secret);
    } catch (e) {
      return { view, error: `店铺凭据解密失败：${errText(e)}` };
    }
  }
  for (const [k, v] of Object.entries(creds)) put(k, v);
  return { view, error: null };
}

function hasCredential(view: Record<string, string>): boolean {
  // 服务市场订购至少要有一种可用的平台凭据（不是任意非空字段）
  const keys = ['app_key', 'appkey', 'api_key', 'client_id', 'access_token', 'token'];
  return keys.some((k) => (view[k] ?? '').trim().length > 0);
}

// ─── 平台请求 ────────────────────────────────────────────────────────
function buildPlatformHeaders(view: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Thalvior-ERP/1.0 (support@thalvior.icu)',
  };
  const appKey = view.app_key ?? view.appkey ?? view.api_key ?? view.client_id ?? '';
  const appSecret = view.app_secret ?? view.appsecret ?? view.api_secret ?? view.client_secret ?? '';
  const token = view.access_token ?? view.token ?? '';
  if (appKey) headers['X-App-Key'] = appKey;
  if (appSecret) headers['X-App-Secret'] = appSecret;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function readPlatformMessage(text: string, status: number): string {
  const raw = (text ?? '').trim();
  if (!raw) return `平台返回 HTTP ${status}`;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const cand = d.message ?? d.error_description ?? d.error_message ?? d.error ?? d.msg ?? d.description;
    if (typeof cand === 'string' && cand.trim()) return cand.trim();
    if (cand && typeof cand === 'object') return JSON.stringify(cand).slice(0, 200);
  } catch {
    /* 非 JSON，按原文处理 */
  }
  const brief = raw.replace(/\s+/g, ' ').slice(0, 200);
  return brief ? `平台返回 HTTP ${status}：${brief}` : `平台返回 HTTP ${status}`;
}

// 统一发起平台请求，成功返回原始 JSON，失败抛 PlatformError
class PlatformError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'PlatformError';
    this.status = status;
    this.body = body;
  }
}

async function callPlatform(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchWithTimeout(url, init);
  } catch (e) {
    const m = errText(e);
    const reason = m.includes('abort') || m.includes('timeout') ? '平台接口请求超时' : `平台接口请求失败：${m}`;
    throw new PlatformError(reason, 502, '');
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new PlatformError(readPlatformMessage(text, res.status), res.status, text.slice(0, 500));
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

// ─── Shopify 模式（真实 Admin API 订购路径） ─────────────────────────
const SHOPIFY_API_VERSION = '2024-01';

function shopifyBaseUrl(shop: ShopRow): string {
  const domain = String(shop.shop_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (!domain) throw new PlatformError('店铺缺少 Shopify 域名（shop_domain），无法调用 Admin API', 400, '');
  return `https://${domain}/admin/api/${SHOPIFY_API_VERSION}`;
}

async function shopifyListCharges(shop: ShopRow): Promise<unknown> {
  const token = String(shop.access_token ?? '').trim();
  if (!token) throw new PlatformError('店铺缺少 Shopify Admin API 访问令牌，无法查询订购记录', 400, '');
  return await callPlatform(`${shopifyBaseUrl(shop)}/recurring_application_charges`, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
      Accept: 'application/json',
      'User-Agent': 'Thalvior-ERP/1.0 (support@thalvior.icu)',
    },
  });
}

// ─── 通用 REST 模式 ─────────────────────────────────────────────────
function genericBase(cfg: PlatformMarketConfig): string {
  const base = String(cfg.marketApiBase ?? '').trim().replace(/\/$/, '');
  if (!base) throw new PlatformError('platform_auth_config.market_api_base 未配置', 400, '');
  try {
    // 必须是合法绝对 URL，否则后面拼出来的地址无法发起真实请求
    const u = new URL(base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      throw new PlatformError(`platform_auth_config.market_api_base 协议非法：${base}`, 400, '');
    }
  } catch (e) {
    if (e instanceof PlatformError) throw e;
    throw new PlatformError(`platform_auth_config.market_api_base 不是合法 URL：${base}`, 400, '');
  }
  return base;
}

async function genericListServices(
  cfg: PlatformMarketConfig,
  shop: ShopRow | null,
  view: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${genericBase(cfg)}/services`);
  if (cfg.marketServiceId) url.searchParams.set('service_id', cfg.marketServiceId);
  if (shop) url.searchParams.set('shop_id', shop.id);
  return await callPlatform(url.toString(), { method: 'GET', headers: buildPlatformHeaders(view) });
}

async function genericListOrders(
  cfg: PlatformMarketConfig,
  shop: ShopRow | null,
  view: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${genericBase(cfg)}/orders`);
  if (cfg.marketServiceId) url.searchParams.set('service_id', cfg.marketServiceId);
  if (shop) url.searchParams.set('shop_id', shop.id);
  return await callPlatform(url.toString(), { method: 'GET', headers: buildPlatformHeaders(view) });
}

async function genericQueryOrder(
  cfg: PlatformMarketConfig,
  orderId: string,
  view: Record<string, string>,
): Promise<unknown> {
  const url = new URL(`${genericBase(cfg)}/orders/${encodeURIComponent(orderId)}`);
  return await callPlatform(url.toString(), { method: 'GET', headers: buildPlatformHeaders(view) });
}

async function genericCreateOrder(
  cfg: PlatformMarketConfig,
  shop: ShopRow,
  view: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<unknown> {
  const url = new URL(`${genericBase(cfg)}/orders`);
  const body: Record<string, unknown> = {
    service_id: cfg.marketServiceId ?? '',
    shop_id: shop.id,
    shop_name: shop.shop_name,
    platform_shop_id: shop.platform_shop_id ?? '',
    ...payload,
  };
  return await callPlatform(url.toString(), {
    method: 'POST',
    headers: { ...buildPlatformHeaders(view), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405);

  const requestId = crypto.randomUUID().slice(0, 8);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'JSON 格式错误' }, 400);
  }

  const action = String(body.action ?? '').trim();
  const platform = String(body.platform ?? '').trim();
  const shopId = String(body.shop_id ?? '').trim();
  const orderId = String(body.order_id ?? '').trim();
  const plan = String(body.plan ?? body.service_name ?? '').trim();
  const quantity = Number(body.quantity ?? 1);
  const price = body.price === undefined || body.price === null ? null : Number(body.price);
  const test = body.test === true;

  try {
    const userId = await resolveUserId(req);
    if (!userId) return json({ error: '未登录' }, 401);

    if (!action) return json({ error: '缺少 action' }, 400);
    if (!platform) return json({ error: '缺少 platform' }, 400);

    const mp = findMarketPlatform(platform);
    if (!mp) return marketNotSupported(platform);

    // 参数校验（先做纯本地校验，避免无资质时把用户参数错误藏起来）
    if (action === 'create-order') {
      if (!shopId) return json({ error: '缺少 shop_id（要订购服务的店铺）' }, 400);
      if (!/^[0-9a-fA-F-]{36}$/.test(shopId)) return json({ error: 'shop_id 格式不正确' }, 400);
      if (!Number.isFinite(quantity) || quantity <= 0) return json({ error: 'quantity 必须为正整数' }, 400);
      if (price !== null && (!Number.isFinite(price) || price < 0)) return json({ error: 'price 必须为非负数' }, 400);
    }
    if (action === 'query-order') {
      if (!orderId) return json({ error: '缺少 order_id（订购单号）' }, 400);
    }
    if (!['list-services', 'list-orders', 'create-order', 'query-order'].includes(action)) {
      return json({ error: `未知 action: ${action}` }, 400);
    }

    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const { configs, degraded, degradedReason } = await loadPlatformConfigs(admin);
    const cfg = matchPlatformConfig(platform, configs);

    // 店铺上下文（create-order 必有；list-* / query-order 可选）
    let shop: ShopRow | null = null;
    let credView: Record<string, string> = {};
    if (shopId) {
      const shops = await loadShops(admin, userId, platform, shopId);
      if (shops.length === 0) {
        return json({ error: `店铺不存在、不属于当前用户，或不属于「${platform}」平台` }, 404);
      }
      shop = shops[0];
      const cv = await shopCredentialView(shop);
      if (cv.error) return json({ error: cv.error }, 400);
      credView = cv.view;
    }

    // ── 资质闸门：没资质就不下单，一律 400 + 资质提示 ──
    if (mp.orderMode === 'shopify_admin') {
      const clientId = optEnv('SHOPIFY_CLIENT_ID');
      const clientSecret = optEnv('SHOPIFY_CLIENT_SECRET');
      if (!clientId || !clientSecret) {
        return notConfigured(mp, '尚未配置 SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET，应用资质未就绪');
      }
      if (!shop) {
        return notConfigured(mp, '该操作需要指定已授权的 Shopify 店铺（shop_id）');
      }
      if (!shop.access_token && !credView.access_token) {
        return notConfigured(mp, '该店铺尚未取得 Admin API 访问令牌');
      }
    } else {
      if (degraded || !cfg || !cfg.marketApiBase || !cfg.marketServiceId) {
        return notConfigured(mp, degraded ? degradedReason : 'platform_auth_config 尚未配置 market_api_base / market_service_id');
      }
      if (!shop) {
        return notConfigured(mp, '该操作需要指定已授权店铺（shop_id）以获取平台凭据');
      }
      if (!hasCredential(credView)) {
        return notConfigured(mp, '该店铺尚未配置平台应用凭据（app_key / app_secret / access_token）');
      }
    }

    // ── 真实调用平台 ──
    try {
      if (mp.orderMode === 'shopify_admin') {
        const s = shop as ShopRow;
        if (action === 'list-services' || action === 'list-orders') {
          const data = await shopifyListCharges(s);
          console.info(`[${functionName}] ${requestId} ${action} platform=${platform} shop=${s.id}`);
          return json({ platform: mp.label, action, shop_id: s.id, services: data });
        }
        if (action === 'query-order') {
          const token = String(s.access_token ?? credView.access_token ?? '').trim();
          if (!token) return notConfigured(mp, '该店铺尚未取得 Admin API 访问令牌');
          const data = await callPlatform(`${shopifyBaseUrl(s)}/recurring_application_charges/${encodeURIComponent(orderId)}`, {
            method: 'GET',
            headers: {
              'X-Shopify-Access-Token': token,
              Accept: 'application/json',
              'User-Agent': 'Thalvior-ERP/1.0 (support@thalvior.icu)',
            },
          });
          console.info(`[${functionName}] ${requestId} ${action} platform=${platform} order=${orderId}`);
          return json({ platform: mp.label, action, order_id: orderId, order: data });
        }
        // create-order：真实创建 Shopify 服务订阅（recurring application charge）
        const token = String(s.access_token ?? credView.access_token ?? '').trim();
        if (!token) return notConfigured(mp, '该店铺尚未取得 Admin API 访问令牌');
        const name = plan || 'Thalvior ERP 增值服务';
        const chargePrice = price ?? 0;
        if (!Number.isFinite(chargePrice) || chargePrice < 0) return json({ error: 'price 必须为非负数' }, 400);
        const domain = String(s.shop_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
        // Shopify 账单订阅要求 return_url：优先用配置的回跳地址，没有则退回店铺域名
        const returnUrl = optEnv('SHOPIFY_REDIRECT_URI') ?? `https://${domain}`;
        const data = await callPlatform(`${shopifyBaseUrl(s)}/recurring_application_charges`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': token,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'Thalvior-ERP/1.0 (support@thalvior.icu)',
          },
          body: JSON.stringify({
            name,
            price: chargePrice,
            test,
            quantity,
            return_url: returnUrl,
          }),
        });
        console.info(`[${functionName}] ${requestId} ${action} platform=${platform} shop=${s.id}`);
        return json({ platform: mp.label, action, shop_id: s.id, order: data });
      }

      // 通用 REST 模式
      const c = cfg as PlatformMarketConfig;
      const s = shop as ShopRow;
      if (action === 'list-services') {
        const data = await genericListServices(c, s, credView);
        return json({ platform: mp.label, action, shop_id: s.id, services: data });
      }
      if (action === 'list-orders') {
        const data = await genericListOrders(c, s, credView);
        return json({ platform: mp.label, action, shop_id: s.id, orders: data });
      }
      if (action === 'query-order') {
        const data = await genericQueryOrder(c, orderId, credView);
        return json({ platform: mp.label, action, order_id: orderId, order: data });
      }
      const data = await genericCreateOrder(c, s, credView, {
        plan,
        quantity,
        price,
        test,
        note: String(body.note ?? ''),
      });
      return json({ platform: mp.label, action, shop_id: s.id, order: data });
    } catch (e) {
      if (e instanceof PlatformError) {
        console.error(`[${functionName}] ${requestId} 平台接口失败 platform=${platform} ${e.message}`);
        return json(
          {
            error: e.message,
            code: 'MARKET_API_ERROR',
            platform: mp.label,
            status: e.status,
          },
          e.status >= 400 && e.status < 500 ? e.status : 502,
        );
      }
      throw e;
    }
  } catch (err) {
    const msg = errText(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
