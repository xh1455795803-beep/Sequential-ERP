// sync-orders — 订单自动同步引擎（多平台 · 适配器驱动）
// =====================================================================
// action:
//   sync-shop    → 对指定店铺增量拉单（按平台适配器）→ orders 表正规写入（INSERT/UPDATE，
//                  现有联动 trigger 全部正常触发）→ 更新水位 shop_sync_state → 写审计 order_sync_logs → 通知
//   sync-all     → 用户模式：遍历本人所有「已接通平台 + 已授权/即将到期」店铺；service/cron 模式：遍历全站
//   sync-status  → 最近同步批次 + 各店水位
//
// 已接通平台（手动授权 / 粘贴 key 类，见 ADAPTERS）：
//   WooCommerce  WC REST v3      modified_after 水位分页（修改时间驱动，状态变化自动覆盖）
//   Ozon         Seller API      FBS /v4/posting/fbs/list + FBO /v3/posting/fbo/list
//                                创建时间窗口分片拉新 + 未完结单 order_numbers 精确回刷状态
//                                （实测：filter.status 被服务端忽略、列表项无 updated_at、
//                                  since/to 按创建时间过滤且跨度过大静默返回空 → 故必须切片 + 回刷）
//   Shopify        REST Admin 2024-01  updated_at_min + Link 头游标分页
//   Wildberries    Statistics API      supplier/orders?dateFrom=（金额÷100，status 数组末位为当前状态）
//   BigCommerce    Stores API v3       modified_min + include=line_items,customers
//   Mercado Libre  Orders API          orders/search（date_updated 增量）+ 逐单取明细
//   Coupang        WING Open API       HMAC-SHA256(CEA) + minOrderId 游标
//   Allegro        Order API v1        /order/orders（集合键 zorders）
//   TikTok Shop    Partner API 202309  HMAC-SHA256 签名 + page_token 游标
//   eBay           OAuth2 app/user token + Sell Fulfillment v1  modification_after 增量
//   Walmart        Marketplace OAuth2 + Orders v3            PO 行级折叠 + 180 天窗口截断
//   Shopee         Open Platform v2 HMAC-SHA256              get_order_list 增量 + get_order_detail 批量取状态
//   Lazada         开放平台 TOP（sign_method=md5）            行级按 order_id 分组 + 30 天重扫回刷状态
//   AliExpress     开放平台 TOP（api-sg/sync）                modified_begin/end（太平洋时间口径）
//   Temu           开放平台 OpenAPI（MD5 小写签名）             local/pop 双接口 + 30 天重扫回刷状态
//   Yandex Market  Partner API OAuth Bearer                  business 订单列表 + 客户端窗口过滤
//   Amazon         SP-API Orders v0（LWA refresh_token）      一个适配器覆盖 US/EU/JP/CA/AU 全站
//                                                                按 marketplaceId 反查 na/eu/fe 网关
//   SHEIN          开放平台 Open API（MD5 大写签名）           getOrderList 创建时间窗口 + pageNo 翻页
//   Daraz          Global Open Platform（iop，同 Lazada TOP）  行级按 order_id 分组 + 30 天重扫回刷状态
//   Noon           Marketplace API OAuth Bearer               行级按 ps_order_id 折叠 + 日期窗口过滤
//   Cdiscount      Octopia Seller API v2（client_credentials） /rest/orders offset 分页（旧版 OpenApi 已下线）
//   OTTO           Partner Connect（Keycloak client_credentials） order/api/v2/orders 倒序翻页到水位
//   Jumia          Vendor API（refresh_token 换 Bearer）       order-service 按日期窗口 + pageNo 翻页
//   Wish           Merchant Open API v3（Bearer）              since_timestamp + cursor 倒序翻页到水位
//   京东           JOS routerjson（TOP MD5 大写签名）          一个适配器覆盖京东国际 + 京东印尼（api.jd.id）
//   Wix          Stores API v3（OAuth Bearer + GraphQL 风格 query 端点） cursor 翻页
//   Magento 2    REST V1（OAuth1.0a 换得的 Admin Token）        searchCriteria 页码 + updated_at from
//   PrestaShop   Webservice API（API Key Basic Auth）           filter[date_upd]=[>=] + JSON=1 翻页
//   Shopline     Open API（Shopify 同构 · Bearer + Link 游标）   admin/openapi/v{YMD}/orders.json
//   ShopBase     Open API（Shopify 同构 · X-ShopbaseAccess-Token）
//   店匠 Shoplazza Open API（Shopify 同构 · Bearer + X-Shopify-Access-Token）
//   UEESHOP      ✗ 无公开订单 API → 代码已注册、同步时明确失败（不伪造端点）
//   Shopyy       ✗ 无公开订单 API → 同上
//   AllValue     ✗ 无公开订单 API → 同上
//   Salla        Partner OAuth2 Bearer（店铺专属域名 /api/v1/orders） 按日窗口 + page 翻页
//   Miravia      阿里 iop 网关（与 Lazada/Daraz 同一套 TOP 签名） 行级折叠 + 30 天重扫回刷状态
//   eMAG           Marketplace 报表接口（Bearer）              orders/search 翻页 + 水位客户端过滤
//   Kaufland       Seller API v2（HMAC-SHA256 签名头）          /v2/order-units 行级折叠 id_order
//   OnBuy          Supplier API（HMAC 时间戳+路径签名）         路径需文档回填 orders_path（不猜端点）
//   Wayfair        Partner API（sso.auth 令牌 + Dropship GraphQL）getDropshipPurchaseOrders fromDate
//   Zalando        Partner API（Bearer + partner_id 路径）       路径需合作方文档回填 orders_path
//   Rakuten        Web Services API（serviceSecret+licenseKey）  站点域名/方法需文档回填；支持 XML 浅解析
//   Fnac           Mirakl Shop API v3（Bearer API Key）          /api/v3/orders offset 翻页（域名按市场）
//   Joom           JoomPartner API（Bearer）                     RPC 路径需文档回填 orders_path
//   Tiki           Partner Order Service（OAuth2 Bearer）        /orders?updated_since 增量（含状态回刷）
//   B2W Americanas 集成网关（OAuth Bearer）                       服务名路径需文档回填 orders_path
//   Voghion        开放平台（Bearer）                            路径需文档回填 orders_path
//   Alibaba 国际站 开放平台 routerjson（TOP MD5 大写签名）         pageNo/pageSize（方法名/时间参数可覆盖）
//   DHgate         开放平台 router（TOP MD5 大写签名）            dhgate.trades.list + pageNo 翻页
//   新增平台 = 在 ADAPTERS 注册一个 pull/refreshOpen，主引擎零改动。
//
// Wave C 加固（2026-11-17，三层，均在引擎外壳、不改任何适配器内部逻辑）：
//   T1 fetchWithRetry：唯一出站口 fetchDirect 统一 429/5xx/网络异常重试（指数退避+抖动，4 次）
//   T2 每店咨询锁：syncShopOnce 最外壳先抢 shop_sync_locks，同店并发第二轮 → skipped/lock_held
//   T3 sync-all 分片：按 user_id 分桶，桶间 SYNC_CONCURRENCY(默认5) 路并发、桶内串行 + 500ms 限速
//
// 鉴权（双模式）：
//   用户模式：Authorization: Bearer <用户JWT> → admin.auth.getUser 验证（同 publish-listing）
//   Cron 模式：Bearer <service_role key> → JWT_SECRET 做 HS256 验签 + payload.role==='service_role'
//
// 铁律（主人强令）：
//   1. 只允许 status='已授权 / 即将到期'（_shared/shop-status.ts 白名单）且平台已接通的店铺参与同步
//   2. 订单写入必须走 orders 表正规路径 → 现有联动 trigger 正常触发
//      （notify_order_created / notify_order_status_change / deduct_inventory_on_ship）
//   3. 同步失败必须写 notifications；cron 定时成功不打扰（避免每 15 分钟刷屏）
//   4. 幂等：external_order_id 全局唯一（{前缀}-{店铺ID前8}-{平台单号}），重复同步不重复入库
//   5. 全程不产生假数据——远程 API 真实返回为准；平台未公开的字段（如 Ozon Global 买家姓名/地址）留空
//
// 凭据：shop_auths.credentials_enc（AES-GCM/PBKDF2，盐 thalvior-cred-v1，secret=JWT_SECRET，与 authorize-shop 对称）
// 状态词表（orders.status，前端 statusTabs / status-badge 已支持）：
//   待处理 / 待审核 / 待发货 / 已发货 / 已完成 / 已取消 / 售后中

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ACTIVE_AUTH_STATUS_LIST, isActiveAuthStatus } from '../_shared/shop-status.ts';

// ─── Wave C · T1：出站 HTTP 统一重试层（指数退避 + 抖动）───────────────────
// 为什么只改一层：本文件 49 个适配器 + 各自的 token 交换全部经由 fetchDirect()
// （直接调用，或经 getJson()/postJsonResp() 两个统一出口），
// 全站只有 fetchDirect() 里那一句真正的 fetch()，所以重试做在这一层 = 一处改动、49 家覆盖。
// 安全性：出站请求全部是「读订单列表 / 读明细 / 换 token」，没有写平台侧的调用，
//         因此对 429/5xx 与网络异常重试不会造成平台侧重复写入。
// 预算：4 次尝试，退避 600ms→1.2s→2.4s（各加 0~250ms 抖动），单次等待上限 12s。
async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: { maxAttempts?: number; baseMs?: number; maxMs?: number; label?: string; timeoutMs?: number } = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const base = opts.baseMs ?? 600;
  const cap = opts.maxMs ?? 12000;
  // timeoutMs>0 时按「每次尝试」独立计时：否则 30s 总预算会被退避等待吃光，剩余尝试必然瞬断
  const perAttemptMs = opts.timeoutMs ?? 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let ctrl: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let useInit = init;
    if (perAttemptMs > 0 && !init.signal) {
      ctrl = new AbortController();
      timer = setTimeout(() => ctrl!.abort(), perAttemptMs);
      useInit = { ...init, signal: ctrl.signal };
    }
    try {
      const r = await fetch(url, useInit);
      if (r.ok) return r;
      // retry on 429, 5xx
      if (r.status === 429 || (r.status >= 500 && r.status < 600)) {
        const retryAfter = Number(r.headers.get('retry-after') || '0');
        const wait = Math.max(retryAfter * 1000, Math.min(base * Math.pow(2, attempt) + Math.floor(Math.random() * 250), cap));
        console.warn(`[retry] ${opts.label ?? url} status=${r.status} attempt=${attempt + 1}/${maxAttempts} wait=${wait}ms`);
        await new Promise((res) => setTimeout(res, wait));
        continue;
      }
      return r; // non-retryable error, caller handles
    } catch (e) {
      lastErr = e;
      const wait = Math.min(base * Math.pow(2, attempt) + Math.floor(Math.random() * 250), cap);
      console.warn(`[retry] ${opts.label ?? url} throw attempt=${attempt + 1}/${maxAttempts} wait=${wait}ms err=${String(e)}`);
      if (attempt + 1 >= maxAttempts) break;
      await new Promise((res) => setTimeout(res, wait));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastErr ?? new Error(`${opts.label ?? url}: exhausted retries`);
}

/** 出站主机名 → 平台名：重试日志可读（动态域名如 Shopify/ Woo 回落为主机名） */
const HOST_LABEL: Record<string, string> = {
  'api-seller.ozon.ru': 'Ozon',
  'statistics-api.wildberries.ru': 'Wildberries',
  'api.mercadolibre.com': 'Mercado Libre',
  'api-gateway.coupang.com': 'Coupang',
  'api.allegro.pl': 'Allegro',
  'open-api.tiktokglobalshop.com': 'TikTok Shop',
  'api.ebay.com': 'eBay',
  'marketplace.walmartapis.com': 'Walmart',
  'partner.shopeemobile.com': 'Shopee',
  'api.lazada.com': 'Lazada',
  'api-sg.aliexpress.com': 'AliExpress',
  'openapi-b.temu.com': 'Temu',
  'api.partner.market.yandex.ru': 'Yandex Market',
  'sellingpartnerapi-na.amazon.com': 'Amazon SP-API',
  'sellingpartnerapi-eu.amazon.com': 'Amazon SP-API',
  'sellingpartnerapi-fe.amazon.com': 'Amazon SP-API',
  'api.amazon.com': 'Amazon LWA',
  'openapi.sheincorp.com': 'SHEIN',
  'api.daraz.com': 'Daraz',
  'noon-marketplace-api.noonpayments.com': 'Noon',
  'api.octopia.io': 'Cdiscount',
  'connect.api.otto.de': 'OTTO',
  'login.api.otto.de': 'OTTO(token)',
  'vendor-api.jumia.com': 'Jumia',
  'merchant.wish.com': 'Wish',
  'api.jd.com': 'JD',
  'api.jd.id': 'JD Indonesia',
  'www.wixapis.com': 'Wix',
  'api.miravia.com': 'Miravia',
  'report-api.emag.ro': 'eMAG',
  'sellerapi.kaufland.com': 'Kaufland',
  'api.wayfair.com': 'Wayfair',
  'sso.auth.wayfair.com': 'Wayfair(token)',
  'api.alibaba.com': 'Alibaba',
  'api.dhgate.com': 'DHgate',
  'api.bigcommerce.com': 'BigCommerce',
  'api.zalando.com': 'Zalando',
  'partner-api.joom.com': 'Joom',
  'api.tiki.vn': 'Tiki',
  'integration.b2w.io': 'B2W Americanas',
  'api.salla.dev': 'Salla',
  'api.onbuy.com': 'OnBuy',
};
function labelForUrl(url: string): string {
  try {
    const h = new URL(url).host;
    return HOST_LABEL[h] ?? h;
  } catch {
    return url.slice(0, 80);
  }
}

// ─── Wave C · T2：每店咨询锁（advisory lock，防同店并发重复拉单）────────────
// 为什么需要：cron 已从 30s 超时放宽到 14min（见 T3），而 thalvior-sync-orders-15min 每 15 分钟一跳；
// 上一跳没跑完时下一跳会撞上同一批店铺，同一 (shop, 水位) 并发拉两遍 → 重复写 orders / 水位互相覆盖。
// 实现落在 DB（shop_sync_locks + try_acquire/release）而不是进程内存：EF 是无状态多实例，内存锁互不可见。
// 释放放在 finally；EF 被运行时强杀时锁不会释放，靠行上的 expires_at（默认 25min）+ T6 每 10 分钟清理自愈。
async function acquireShopLock(admin: SupabaseClient, shopId: string, ttlSeconds = 1500): Promise<{ ok: true; token: string } | { ok: false }> {
  const token = crypto.randomUUID();
  const { data, error } = await admin.rpc('try_acquire_shop_sync_lock', { p_shop_id: shopId, p_ttl_seconds: ttlSeconds, p_token: token });
  if (error || !data) {
    if (error) console.warn(`[lock] try_acquire 失败 shop=${shopId}: ${error.message}`);
    return { ok: false };
  }
  return { ok: true, token };
}
async function releaseShopLock(admin: SupabaseClient, shopId: string, token: string) {
  await admin.rpc('release_shop_sync_lock', { p_shop_id: shopId, p_token: token }).then(() => {}).catch(() => {});
}

// ─── Batch A 运维日志层（sync_run_logs + adapter_health_snapshots）─────────
// 铁律：这一层只做「记录」，任何失败一律 console.error 吞掉——
//       日志写不进去也必须照常同步、照常返回原响应体（不改 status/返回结构）。
let opsClient: SupabaseClient | null = null;
function getOpsClient(): SupabaseClient {
  if (!opsClient) opsClient = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
  return opsClient;
}
type SyncRunStatus = 'success' | 'partial' | 'failed' | 'skipped' | 'auth_required' | 'no_credentials';

/** 写一行 sync_run_logs（每次每店一行）。永不抛错。 */
async function logRun(row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await getOpsClient().from('sync_run_logs').insert(row);
    if (error) console.error(`[${functionName}] sync_run_logs insert failed: ${error.message}`);
  } catch (e) {
    console.error(`[${functionName}] sync_run_logs insert threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}
/** profiles.role='admin' 判定（log_health_snapshot 的用户侧闸门） */
async function isAdminUser(admin: SupabaseClient, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
    return String((data as any)?.role ?? '') === 'admin';
  } catch {
    return false;
  }
}
/** 从错误文本里粗取 HTTP 状态码作为 error_code（仅诊断用，取不到就留 null） */
function guessErrorCode(msg: string | null): string | null {
  if (!msg) return null;
  const m = msg.match(/\b(401|403|404|429|500|502|503|504)\b/);
  return m ? m[1] : null;
}

const functionName = 'sync-orders';
const MAX_PAGES = 50;             // Woo：单店单次最多 50 页 × 100 单 = 5000 单，防失控
const MAX_ORDERS = 5000;          // 全平台：单店单次落库订单上限（达到上限下次继续）
const WATERMARK_LAG_MS = 60_000;  // 水位回退 60 秒，防时钟/写入顺序漂移漏单
const FIRST_SYNC_DAYS = 90;       // 首次同步回拉 90 天
const OPEN_REFRESH_LIMIT = 200;   // 未完结订单状态回刷的单次上限
const TERMINAL_STATUSES = '("已完成","已取消")';

// ─── 通用工具（与 publish-listing 同风格） ───────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}
// 全文件唯一的真实出站口：49 个适配器 + 各家 token 交换都经过这里（直接或经 getJson/postJsonResp）。
// Wave C·T1：超时/identity 语义不变，重试委托 fetchWithRetry，per-attempt 超时 = 原 ms（每次尝试各 30s）。
async function fetchDirect(url: string, init: RequestInit, ms = 30000): Promise<Response> {
  // 踩坑：edge runtime fetch 不解压 gzip → 必须显式 identity，否则乱码截断
  return fetchWithRetry(url, { ...init, headers: { ...init.headers, 'Accept-Encoding': 'identity' } }, {
    timeoutMs: ms,
    label: labelForUrl(url),
  });
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
/** 解析 ISO / "YYYY-MM-DD HH:MM:SS"（平台返回的 GMT 串）→ epoch ms；无效返回 null */
function parseTime(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  // 已带时区（Z 或 +08:00）→ 原样解析；裸串视为 GMT，补 Z
  const hasTz = /z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const ms = Date.parse(hasTz ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? ms : null;
}

// ─── service_role JWT 验签（HS256，防止伪造 payload） ────────────────
function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return raw;
}
async function verifyServiceRoleJwt(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return false;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1])));
    return payload?.role === 'service_role' && (!payload.exp || payload.exp * 1000 > Date.now());
  } catch {
    return false;
  }
}

// ─── 凭据解密（与 authorize-shop encryptCredentials 对称） ───────────
async function decryptCredentials(encB64: string, secret: string): Promise<Record<string, unknown>> {
  const enc = new TextEncoder();
  const raw = b64urlToBytes(encB64.replace(/-/g, '+').replace(/_/g, '/')); // 标准 base64 亦兼容
  const iv = raw.slice(0, 12);
  const cipher = raw.slice(12);
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

// ─── 类型 ────────────────────────────────────────────────────────────
interface SyncShop {
  id: string; user_id: string; shop_name: string; status: string; platform: string;
  credentials_enc: string | null; shop_domain: string | null; verify_at: string | null;
}
interface ShopResult {
  shop_auth_id: string; shop_name: string; ok: boolean;
  fetched: number; inserted: number; updated: number; failed: number;
  error?: string; duration_ms: number;
}
/** 适配器产出的归一化订单：externalId 幂等键 + status ERP 状态 + row orders 行 + modifiedMs 水位来源 */
interface NormOrder {
  externalId: string;
  status: string;
  row: Record<string, unknown>;
  modifiedMs: number | null;
}
interface FetchCtx {
  admin: ReturnType<typeof createClient>;
  shop: SyncShop;
  creds: Record<string, unknown>;
  sinceMs: number;   // 已含 WATERMARK_LAG_MS 回退
  untilMs: number;
  maxOrders: number;
  warn: (msg: string) => void;
  /** 同一次同步内共享的派生数据（如 Ozon 结算币种），避免重复打平台接口 */
  shared: Record<string, unknown>;
}
interface Adapter {
  key: string;
  label: string;
  aliases: string[];
  /** 凭据自检：缺字段就抛中文可操作错误 */
  checkCreds?(creds: Record<string, unknown>, shop: SyncShop): void;
  /** 增量拉取（新单发现 + 平台自身能覆盖的状态变化） */
  pull(ctx: FetchCtx): Promise<NormOrder[]>;
  /** 可选：对库内未完结订单做精确状态回刷（平台无「修改时间」增量能力时必需） */
  refreshOpen?(externalIds: string[], ctx: FetchCtx): Promise<NormOrder[]>;
}

// ─── orders 行公共字段 ───────────────────────────────────────────────
function rowBase(shop: SyncShop, externalId: string, channel: string): Record<string, unknown> {
  return {
    id: externalId,
    external_order_id: externalId,
    user_id: shop.user_id,
    shop_id: shop.id,
    shop_name: shop.shop_name,
    channel,
  };
}

/**
 * 状态变化时的 UPDATE 补丁：只覆盖「平台本次确实给了值」的字段，避免把库里已有的真实数据擦成空。
 *   · buyer/phone/address/sku/product/remark 为空 → 保留原值（Ozon 跨境单不返回买家信息，属正常）
 *   · items 为空数组 → 保留原值
 *   · amount 为 0 且库内已有金额 → 不动金额与币种（平台价格字段缺失时不擦数）
 */
function updatePatch(row: Record<string, unknown>, existingAmount: number): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: row.status, shop_name: row.shop_name };
  for (const k of ['buyer', 'phone', 'address', 'sku', 'product', 'remark']) {
    if (String(row[k] ?? '').trim() !== '') patch[k] = row[k];
  }
  if (Array.isArray(row.items) && (row.items as unknown[]).length > 0) patch.items = row.items;
  const amount = Number(row.amount) || 0;
  if (amount > 0 || existingAmount === 0) {
    patch.amount = amount;
    if (String(row.currency ?? '').trim() !== '') patch.currency = row.currency;
  }
  return patch;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 1：WooCommerce（行为与旧引擎完全一致）
// ═══════════════════════════════════════════════════════════════════
function wooBase(domain: string): string {
  const d = domain.trim().replace(/\/+$/, '');
  return d.startsWith('http') ? d : `https://${d}`;
}
function wooClient(shopDomain: string, ck: string, cs: string) {
  const base = wooBase(shopDomain);
  const auth = `consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`;
  return {
    async request(method: string, path: string, query: Record<string, string> = {}, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
      const qs = new URLSearchParams(query);
      const url = `${base}/wp-json/wc/v3${path}?${qs.toString()}&${auth}`;
      const res = await fetchDirect(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data: any = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data };
    },
  };
}

const WOO_STATUS_MAP: Record<string, string> = {
  'pending': '待处理',
  'processing': '待发货',
  'on-hold': '待审核',
  'completed': '已完成',
  'cancelled': '已取消',
  'refunded': '售后中',
  // WooCommerce 扩展/自定义状态兜底
  'checkout-draft': '待处理',
  'requested': '待审核',
  'awaiting-payment': '待处理',
  'awaiting-fulfillment': '待审核',
  'partially-paid': '待审核',
  'partially-refunded': '售后中',
};
function mapWooStatus(wooStatus: string): string {
  return WOO_STATUS_MAP[String(wooStatus || '').toLowerCase()] ?? '待处理';
}

function fmtAddr(a: Record<string, unknown> | undefined): string {
  if (!a) return '';
  const v = (k: string) => String(a[k] ?? '').trim();
  return [v('address_1'), v('address_2'), v('city'), v('state'), v('postcode'), v('country')].filter(Boolean).join(', ');
}
function wooOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = String(o.id ?? '').trim();
  if (!platformId) return null;
  const externalId = `WOO-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.line_items) ? o.line_items : [];
  const first = items[0] ?? {};
  const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
  let product = String(first.name ?? '').trim();
  if (!product) product = '[无商品明细]';
  else if (Number(first.quantity) > 1) product += ` ×${first.quantity}`;
  else if (items.length > 1) product += ` 等${totalQty}件`;
  const b = (o.billing ?? {}) as Record<string, unknown>;
  const buyer = [String(b.first_name ?? ''), String(b.last_name ?? '')].join(' ').trim()
    || String(b.email ?? '').trim() || 'Guest';
  const ship = fmtAddr(o.shipping as Record<string, unknown>);
  const status = mapWooStatus(String(o.status ?? ''));
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.date_modified_gmt ?? o.date_modified),
    row: {
      ...rowBase(shop, externalId, 'WooCommerce'),
      buyer,
      product,
      sku: String(first.sku ?? ''),
      // P0-6 打单供数：收件电话 + 完整商品明细（面单需要）
      phone: [String(o.billing?.phone ?? '').trim(), String(o.shipping?.phone ?? '').trim()].find(Boolean) || '',
      items: items.slice(0, 20).map((it) => ({ name: String(it.name ?? '').trim(), sku: String(it.sku ?? '').trim(), qty: Number(it.quantity) || 0 })),
      amount: Number.isFinite(Number(o.total)) ? Number(o.total) : 0,
      currency: String(o.currency ?? 'USD').toUpperCase(),
      status,
      address: ship || fmtAddr(b),
      created_at: parseTime(o.date_created_gmt ?? o.date_created) ? new Date(parseTime(o.date_created_gmt ?? o.date_created) as number).toISOString() : undefined,
    },
  };
}

async function wooPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const ck = String(ctx.creds.consumer_key ?? '').trim();
  const cs = String(ctx.creds.consumer_secret ?? '').trim();
  const domain = String(ctx.creds.shop_domain ?? ctx.shop.shop_domain ?? '');
  const woo = wooClient(domain, ck, cs);
  const modifiedAfter = new Date(ctx.sinceMs).toISOString().replace('.000Z', 'Z');
  const out: NormOrder[] = [];
  let page = 1;
  for (;;) {
    const r = await woo.request('GET', '/orders', {
      modified_after: modifiedAfter,
      per_page: '100',
      page: String(page),
      orderby: 'modified', // Woo orders 端点合法值（date_modified 会 rest_invalid_param）
      order: 'desc',
      status: 'any',
    });
    if (!r.ok) {
      const msg = r.data && (r.data.message || r.data.code) ? `${r.data.message}${r.data.code ? ` (${r.data.code})` : ''}` : `HTTP ${r.status}`;
      throw new Error(`WooCommerce 拉单失败：${msg}`);
    }
    const rows = Array.isArray(r.data) ? r.data : [];
    for (const o of rows) {
      const n = wooOrderToNorm(ctx.shop, o);
      if (n) out.push(n);
    }
    if (rows.length < 100 || page >= MAX_PAGES || out.length >= ctx.maxOrders) break;
    page++;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 2：Ozon（Seller API）
//   凭据：client_id + api_key（手动粘贴，platform_auth_config.Ozon.cred_fields）
//   实测端点（2026-11-16，用真实店铺凭据验证）：
//     POST /v4/posting/fbs/list  filter{since,to} limit(1..100) cursor → {has_next,cursor,postings[]}
//     POST /v3/posting/fbo/list  同上响应结构
//     POST /v3/posting/fbs/get   {posting_number} → {result:{...customer/financial_data}}
//     POST /v1/seller/info       → {company:{currency,...}}（同时用作凭据自检）
//   坑位（全部实测得出，不是猜的）：
//     · limit > 100 → 400 PostingFbsListRequest.Limit must be inside range (0,100]
//     · filter.status 被服务端忽略（传非法状态照样返回真实订单）→ 不能按状态筛
//     · 列表项没有 updated_at / created_at，只有 in_process_at
//     · since/to 按「下单（in_process）时间」过滤：8 天前的在途单不在 7 天窗口内 → 状态变化不会重新出现
//     · 窗口跨度 730 天 → 静默返回空数组（不报错）→ 必须切片
//     · filter.order_numbers 只接受 order_number（形如 36158078-0346），传 posting_number 会 regex 校验失败
//     · 列表/详情的 customer、financial_data、analytics_data 对 Ozon Global（跨境）卖家为 null
//       → 买家姓名/地址/平台实收无法获取，如实留空，金额取卖家标价 × 数量
// ═══════════════════════════════════════════════════════════════════
const OZON_API = 'https://api-seller.ozon.ru';
const OZON_PAGE_LIMIT = 100;
const OZON_WINDOW_MS = 30 * 86400_000;  // 切片宽度（防大窗口静默空返回）
const OZON_MAX_WINDOWS = 12;            // 单次最多回看 12 × 30 = 360 天
const OZON_MAX_PAGES = 50;              // 每端点每窗口最多 50 页
const OZON_BATCH = 100;                 // order_numbers 单批上限

const OZON_STATUS_MAP: Record<string, string> = {
  'awaiting_registration': '待审核',
  'awaiting_registr': '待审核',
  'awaiting_debit': '待审核',
  'awaiting_payment': '待审核',
  'awaiting_packaging': '待发货',
  'packaging': '待发货',
  'awaiting_deliver': '待发货',
  'deliver_in_progress': '已发货',
  'delivering': '已发货',
  'delivery_on_way': '已发货',
  'driver_out_delivery': '已发货',
  'posting_on_way_to_customer': '已发货',
  'posting_in_pickup_point': '已发货',
  'posted': '已发货',
  'sent_by_seller': '已发货',
  'shipment': '已发货',
  'shipping': '已发货',
  'delivered': '已完成',
  'received': '已完成',
  'canceled': '已取消',
  'cancelled': '已取消',
  'registration_canceled': '已取消',
  'not_delivered': '售后中',
  'not_valued': '售后中',
  'notvalued': '售后中',
  'arbitration': '售后中',
  'arbitrated': '售后中',
  'client_arbitration': '售后中',
  'claim_arbitration': '售后中',
};
function mapOzonStatus(raw: string): string {
  return OZON_STATUS_MAP[String(raw || '').trim().toLowerCase()] ?? '待处理';
}

function ozonIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
function ozonErr(data: any, status: number): string {
  const m = String(data?.message ?? data?.error ?? data?.raw ?? '').trim();
  if (status === 403 || status === 401 || /client[- ]?id|api[- ]?key|incorrect|permission|forbidden|token/i.test(m)) {
    return `Ozon 鉴权失败（Client-Id / Api-Key 无效或无该接口权限）：${m || `HTTP ${status}`}`;
  }
  return m || `HTTP ${status}`;
}
function ozonClient(clientId: string, apiKey: string) {
  return {
    async call(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
      const res = await fetchDirect(`${OZON_API}${path}`, {
        method: 'POST',
        headers: {
          'Client-Id': clientId,
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data };
    },
  };
}
/** 店铺结算币种（真实接口，非硬编码）；失败返回空串，不阻断拉单 */
async function ozonBaseCurrency(cli: ReturnType<typeof ozonClient>): Promise<string> {
  try {
    const r = await cli.call('/v1/seller/info', {});
    if (!r.ok) return '';
    return String(r.data?.company?.currency ?? '').toUpperCase();
  } catch {
    return '';
  }
}
/**
 * 单品价格：FBS v4 = price:{amount:'53.69', currency:'CNY'}；FBO v3 = price:'53.69' + currency_code
 * 返回卖家标价（跨境卖家看不到平台实收，这是能取到的最真实金额）
 */
function ozonItemPrice(it: any): { amount: number; currency: string } {
  const qty = Number(it?.quantity) || 0;
  const p = it?.price;
  const rawAmount = p && typeof p === 'object' ? Number(p.amount) : Number(p);
  const currency = String((p && typeof p === 'object' ? p.currency : '') || it?.currency_code || '').toUpperCase();
  return { amount: Number.isFinite(rawAmount) ? rawAmount * (qty > 0 ? qty : 1) : 0, currency };
}
/** posting_number → order_number（36158078-0346-1 → 36158078-0346）；不符合平台正则返回空 */
function ozonOrderNumber(postingNumber: string): string {
  const seg = String(postingNumber || '').split('-');
  if (seg.length >= 2 && /^\d+$/.test(seg[0]) && /^\d+$/.test(seg[1])) return `${seg[0]}-${seg[1]}`;
  return '';
}
/** external_order_id → posting_number（OZON-{8}-{posting_number}） */
function ozonPostingFromExternal(externalId: string): string {
  const parts = String(externalId || '').split('-');
  if (parts.length < 4 || parts[0] !== 'OZON') return '';
  return parts.slice(2).join('-');
}

function ozonPostingToNorm(shop: SyncShop, p: Record<string, any>, scheme: 'FBS' | 'FBO', baseCurrency: string): NormOrder | null {
  const postingNumber = String(p.posting_number ?? '').trim();
  if (!postingNumber) return null;
  const externalId = `OZON-${shop.id.slice(0, 8)}-${postingNumber}`;
  const products: any[] = Array.isArray(p.products) ? p.products : [];
  const first = products[0] ?? {};
  const totalQty = products.reduce((s, it) => s + (Number(it?.quantity) || 0), 0);
  const rawName = String(first.name ?? '').trim();
  let product = rawName;
  if (!product) product = '[无商品明细]';
  else if (Number(first.quantity) > 1) product += ` ×${first.quantity}`;
  else if (products.length > 1) product += ` 等${totalQty}件`;

  let amount = 0;
  let currency = '';
  for (const it of products) {
    const pr = ozonItemPrice(it);
    amount += pr.amount;
    if (!currency && pr.currency) currency = pr.currency;
  }
  currency = currency || baseCurrency || '';

  const rawStatus = String(p.status ?? '').trim();
  const substatus = String(p.substatus ?? '').trim();
  const status = mapOzonStatus(rawStatus);
  // 买家信息：RU 本土卖家有 customer；Ozon Global 跨境卖家实测为 null → 如实留空
  const cust = (p.customer ?? {}) as Record<string, any>;
  const addr = (cust.address ?? {}) as Record<string, any>;
  const buyer = [String(cust.name ?? ''), String(cust.email ?? '')].find((v) => String(v ?? '').trim()) ?? '';
  const address = [String(addr.house ?? ''), String(addr.city ?? ''), String(addr.region ?? ''), String(addr.postal_code ?? '')]
    .filter(Boolean).join(', ');
  const delivery = (p.delivery_method ?? {}) as Record<string, any>;
  const createdMs = parseTime(p.in_process_at ?? p.shipment_date);
  const cancelled = String(p.cancellation?.cancelled_at ?? '').trim();

  return {
    externalId,
    status,
    modifiedMs: createdMs,
    row: {
      ...rowBase(shop, externalId, 'Ozon'),
      buyer,
      product,
      sku: String(first.offer_id ?? (first.sku != null ? String(first.sku) : '')).trim(),
      phone: String(cust.phone ?? '').trim(),
      items: products.slice(0, 20).map((it) => ({
        name: String(it?.name ?? '').trim(),
        sku: String(it?.offer_id ?? (it?.sku != null ? String(it.sku) : '')).trim(),
        qty: Number(it?.quantity) || 0,
      })),
      amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
      currency,
      status,
      address,
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      // 备注保真：平台原始状态 + 子状态 + 取消时间 + 配送方式（跨境店铺拿不到买家数据时的排查依据）
      remark: [
        `Ozon ${scheme}`,
        `状态 ${rawStatus || '-'}`,
        substatus ? `子状态 ${substatus}` : '',
        cancelled ? `取消时间 ${cancelled}` : '',
        delivery?.warehouse ? `仓库 ${String(delivery.warehouse)}` : '',
      ].filter(Boolean).join(' | '),
    },
  };
}

interface OzonConn { cli: ReturnType<typeof ozonClient> }
function ozonConn(creds: Record<string, unknown>): OzonConn {
  const clientId = String(creds.client_id ?? '').trim();
  const apiKey = String(creds.api_key ?? '').trim();
  if (!clientId || !apiKey) throw new Error('Ozon 凭据不完整（缺 Client-Id 或 Api-Key），请在「店铺授权」重新填写');
  return { cli: ozonClient(clientId, apiKey) };
}
/** 结算币种在同一次同步内只取一次（真实接口 /v1/seller/info，失败降级为空串） */
async function ozonCurrency(ctx: FetchCtx): Promise<string> {
  if (typeof ctx.shared.ozonCurrency === 'string') return ctx.shared.ozonCurrency;
  const c = await ozonBaseCurrency(ozonConn(ctx.creds).cli);
  ctx.shared.ozonCurrency = c;
  return c;
}

async function ozonPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const conn = ozonConn(ctx.creds);
  const currency = await ozonCurrency(ctx); // 兼作凭据有效性检查，失败不阻断
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  const untilMs = Math.min(ctx.untilMs, Date.now());
  let winStart = ctx.sinceMs;
  let windows = 0;

  while (winStart < untilMs && windows < OZON_MAX_WINDOWS && out.length < ctx.maxOrders) {
    const winEnd = Math.min(winStart + OZON_WINDOW_MS, untilMs);
    windows++;
    for (const ep of [
      { path: '/v4/posting/fbs/list', scheme: 'FBS' as const },
      { path: '/v3/posting/fbo/list', scheme: 'FBO' as const },
    ]) {
      let cursor = '';
      for (let page = 0; page < OZON_MAX_PAGES; page++) {
        const r = await conn.cli.call(ep.path, {
          filter: { since: ozonIso(winStart), to: ozonIso(winEnd) },
          limit: OZON_PAGE_LIMIT,
          cursor,
        });
        if (!r.ok) throw new Error(`Ozon ${ep.scheme} 拉单失败：${ozonErr(r.data, r.status)}`);
        const postings = Array.isArray(r.data?.postings) ? r.data.postings : [];
        for (const p of postings) {
          const n = ozonPostingToNorm(ctx.shop, p, ep.scheme, currency);
          if (!n || seen.has(n.externalId)) continue;
          seen.add(n.externalId);
          out.push(n);
          if (out.length >= ctx.maxOrders) break;
        }
        cursor = String(r.data?.cursor ?? '');
        if (!r.data?.has_next || !cursor || out.length >= ctx.maxOrders) break;
      }
      if (out.length >= ctx.maxOrders) {
        ctx.warn(`Ozon 单店单次拉单达到上限 ${ctx.maxOrders} 单，未拉完部分将在下次同步补齐`);
        break;
      }
    }
    winStart = winEnd;
  }
  if (winStart < untilMs) {
    ctx.warn(`Ozon 本次回看已达 ${windows} 个 ${OZON_WINDOW_MS / 86400000} 天窗口上限，更早的订单需手工补拉`);
  }
  return out;
}

/**
 * 未完结订单状态回刷：since/to 按创建时间过滤（实测），老单状态变化不会再出现在增量窗口里，
 * 因此用 filter.order_numbers 精确回查。失败只降级告警，不影响新单同步。
 */
async function ozonRefreshOpen(externalIds: string[], ctx: FetchCtx): Promise<NormOrder[]> {
  if (externalIds.length === 0) return [];
  const conn = ozonConn(ctx.creds);
  const currency = await ozonCurrency(ctx);
  const wanted = new Set<string>();
  const orderNumbers = new Set<string>();
  for (const ext of externalIds) {
    const pn = ozonPostingFromExternal(ext);
    if (!pn) continue;
    wanted.add(pn);
    const on = ozonOrderNumber(pn);
    if (on) orderNumbers.add(on);
  }
  const list = [...orderNumbers];
  if (list.length === 0) return [];
  const out: NormOrder[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < list.length; i += OZON_BATCH) {
    const chunk = list.slice(i, i + OZON_BATCH);
    const r = await conn.cli.call('/v4/posting/fbs/list', {
      filter: { order_numbers: chunk },
      limit: OZON_PAGE_LIMIT,
      cursor: '',
    });
    if (!r.ok) {
      ctx.warn(`Ozon 未完结订单状态回刷失败（不影响新单同步）：${ozonErr(r.data, r.status)}`);
      break;
    }
    for (const p of (Array.isArray(r.data?.postings) ? r.data.postings : [])) {
      const pn = String(p?.posting_number ?? '').trim();
      if (!pn || !wanted.has(pn) || seen.has(pn)) continue;
      const n = ozonPostingToNorm(ctx.shop, p, 'FBS', currency);
      if (!n) continue;
      seen.add(pn);
      out.push(n);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 通用小工具（新增适配器共用，全部走 fetchDirect）
// ═══════════════════════════════════════════════════════════════════
function toStr(v: unknown): string { return String(v ?? '').trim(); }
function toNum(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
/** 金额统一保留 2 位小数（平台常返回字符串或小数位过长的浮点） */
function toAmount(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function toCurrency(v: unknown, fallback = ''): string {
  const c = toStr(v).toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : fallback;
}
/** 环境变量软读取（缺失返回空串，不抛错） */
function envOpt(name: string): string { return (Deno.env.get(name) ?? '').trim(); }
async function hmacSha256Hex(data: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** GET + JSON 统一出口：edge runtime 不解压 gzip，故一律走 fetchDirect（内含 identity） */
interface PlatResp { ok: boolean; status: number; data: any; link: string }
async function getJson(url: string, headers: Record<string, string> = {}, ms = 30000): Promise<PlatResp> {
  const res = await fetchDirect(url, { method: 'GET', headers: { Accept: 'application/json', ...headers } }, ms);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  return { ok: res.ok, status: res.status, data, link: res.headers.get('Link') ?? '' };
}
/** 平台错误可读化：各家错误体字段名不同，逐个兜底 */
function apiErr(data: any, status: number): string {
  if (data && typeof data === 'object') {
    const m = data.message ?? data.error ?? data.msg ?? data.detail;
    if (typeof m === 'string' && m.trim()) {
      const code = data.error_code ?? data.errorCode ?? (typeof data.code === 'string' ? data.code : undefined);
      return `${m.trim()}${code !== undefined && code !== null && code !== '' ? ` (${code})` : ''}`.slice(0, 300);
    }
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      return String(data.errors[0]?.message ?? data.errors[0] ?? '').slice(0, 300) || `HTTP ${status}`;
    }
    if (typeof data.raw === 'string' && data.raw.trim()) return `HTTP ${status}: ${data.raw.trim().slice(0, 160)}`;
  }
  return `HTTP ${status}`;
}
/** 首个非空字符串 */
function firstStr(...vals: unknown[]): string {
  for (const v of vals) { const s = toStr(v); if (s) return s; }
  return '';
}
/** 首个有限数值 */
function firstNum(...vals: unknown[]): number {
  for (const v of vals) { if (v === null || v === undefined || v === '') continue; const n = Number(v); if (Number.isFinite(n)) return n; }
  return 0;
}
/** 平台商品名 + 数量折叠成一行摘要（与 Woo/Ozon 表现一致） */
function summaryProduct(name: string, qty: number, lines: number): string {
  if (!name) return '[无商品明细]';
  if (qty > 1) return `${name} ×${qty}`;
  if (lines > 1) return `${name} 等${lines}项`;
  return name;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 3：Shopify（REST Admin API 2024-01）
//   凭据：shop_domain + access_token（authorize-shop OAuth 回调写入 credentials_enc）
//   分页：REST cursor 分页——下一页游标只出现在响应头 Link: <url>; rel="next"，
//         不能自己拼 page 参数（page 与 page_info 互斥，且官方已弃用 page）
//   状态：fulfillment_status（履约维度）；已取消单以 cancelled_at 兜底
// ═══════════════════════════════════════════════════════════════════
const SHOPIFY_API_VERSION = '2024-01';
const SHOPIFY_PAGE_SIZE = 250;

const SHOPIFY_STATUS_MAP: Record<string, string> = {
  'incomplete': '待处理',
  'unfulfilled': '待发货',
  'partially-fulfilled': '已发货',
  'scheduled': '待发货',
  'fulfilled': '已完成',
  'cancelled': '已取消',
};
function mapShopifyStatus(raw: string): string {
  return SHOPIFY_STATUS_MAP[toStr(raw).toLowerCase()] ?? '待处理';
}
function shopifyConn(creds: Record<string, unknown>, shop: SyncShop) {
  const domain = firstStr(creds.shop_domain, shop.shop_domain).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const token = firstStr(creds.access_token);
  if (!domain || !token) throw new Error('Shopify 凭据不完整（缺店铺域名或 Access Token），请重新授权');
  const base = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}`;
  return {
    async get(pathAndQuery: string): Promise<PlatResp> {
      // 第 2 页起 pathAndQuery 是 Link 头给的完整绝对 URL
      const url = /^https?:\/\//i.test(pathAndQuery) ? pathAndQuery : `${base}${pathAndQuery}`;
      return await getJson(url, { 'X-Shopify-Access-Token': token });
    },
  };
}
/** Link 头游标：`<https://...&page_info=abc>; rel="next", <...>; rel="previous"` */
function shopifyNextLink(link: string): string {
  for (const seg of String(link ?? '').split(',')) {
    if (!/rel="?next"?/i.test(seg)) continue;
    const m = seg.match(/<([^>]+)>/);
    if (m) return m[1];
  }
  return '';
}
function shopifyAddr(a: Record<string, any> | undefined): string {
  if (!a) return '';
  return [toStr(a.address1), toStr(a.address2), toStr(a.city), toStr(a.province), toStr(a.zip), toStr(a.country)].filter(Boolean).join(', ');
}
function shopifyOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = toStr(o.id);
  if (!platformId) return null;
  const externalId = `SHOPIFY-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.line_items) ? o.line_items : [];
  const first = items[0] ?? {};
  const cust = (o.customer ?? {}) as Record<string, any>;
  const buyer = [toStr(cust.first_name), toStr(cust.last_name)].join(' ').trim() || toStr(cust.email) || 'Guest';
  const ship = shopifyAddr(o.shipping_address as Record<string, any>);
  const status = toStr(o.cancelled_at) ? '已取消' : mapShopifyStatus(o.fulfillment_status);
  const createdMs = parseTime(o.created_at);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updated_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Shopify'),
      buyer,
      product: summaryProduct(toStr(first.name), toNum(first.quantity), items.length),
      sku: toStr(first.sku),
      phone: firstStr(cust.phone, o.shipping_address?.phone, o.billing_address?.phone),
      items: items.slice(0, 20).map((it) => ({ name: toStr(it.name), sku: toStr(it.sku), qty: toNum(it.quantity) })),
      amount: toAmount(o.total_price),
      currency: toCurrency(o.currency),
      status,
      address: ship || shopifyAddr(o.billing_address as Record<string, any>),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: toStr(o.number) ? `Shopify 单号 #${toStr(o.number)}` : '',
    },
  };
}
async function shopifyPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = shopifyConn(ctx.creds, ctx.shop);
  const since = new Date(ctx.sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out: NormOrder[] = [];
  let url = `/orders.json?status=any&limit=${SHOPIFY_PAGE_SIZE}&updated_at_min=${encodeURIComponent(since)}`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const r = await cli.get(url);
    if (!r.ok) throw new Error(`Shopify 拉单失败：${apiErr(r.data, r.status)}`);
    const rows = Array.isArray(r.data?.orders) ? r.data.orders : [];
    for (const o of rows) {
      const n = shopifyOrderToNorm(ctx.shop, o);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    if (rows.length < SHOPIFY_PAGE_SIZE || out.length >= ctx.maxOrders) break;
    url = shopifyNextLink(r.link);
    if (!url) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Shopify 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 4：Wildberries（Statistics API / supplier orders）
//   凭据：api_key（手动粘贴）
//   GET /api/v1/supplier/orders?dateFrom=yyyy-MM-ddTHH:mm:ss（dateFrom 按「下单时间」过滤，
//     官方限制窗口 ≤ 3 年、不支持游标分页 → 单次全量返回，故无翻页循环）
//   坑位：· 金额单位为「分的」——totalSum / price 需 ÷100
//         · status 是「最近若干条状态」数组，最后一个才是当前状态（俄语原文）
//         · 该端点不返回买家姓名/电话/地址（跨境与本土均脱敏）→ 如实留空，不编造
//         · 无更新时间字段 → 水位取 createdDate（与 dateFrom 同语义）
// ═══════════════════════════════════════════════════════════════════
const WB_API = 'https://statistics-api.wildberries.ru';

const WB_STATUS_MAP: Record<string, string> = {
  'над agreeing': '待发货',          // 平台历史英文化串，照原文匹配
  'на согласовании': '待发货',
  'ожидает сборки': '待发货',
  'ожидает отгрузки': '待发货',
  'в пути': '已发货',
  'передан в доставку': '已发货',
  'получен': '已完成',
  'доставлен': '已完成',
  'отменен': '已取消',
  'отменён': '已取消',
  'не доставлен': '售后中',
  'возврат': '售后中',
};
function mapWbStatus(raw: string): string {
  return WB_STATUS_MAP[toStr(raw).toLowerCase()] ?? '待处理';
}
function wbConn(creds: Record<string, unknown>) {
  const apiKey = firstStr(creds.api_key);
  if (!apiKey) throw new Error('Wildberries 凭据不完整（缺 Api-Key），请在「店铺授权」重新填写');
  return { async get(pathAndQuery: string): Promise<PlatResp> { return await getJson(`${WB_API}${pathAndQuery}`, { Authorization: `Bearer ${apiKey}` }); } };
}
function wbOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = toStr(o.order_id ?? o.orderId);
  if (!platformId) return null;
  const externalId = `WB-${shop.id.slice(0, 8)}-${platformId}`;
  const skus: any[] = Array.isArray(o.redactionSkus) ? o.redactionSkus : [];
  const sku = firstStr(skus[0], o.supplierArticle, o.chc);
  const name = toStr(o.productName ?? o.newName);
  const createdMs = parseTime(o.createdDate ?? o.date);
  // status 为状态流水数组，末位才是当前状态
  const flow: string[] = Array.isArray(o.status) ? o.status.map((s) => toStr(s)) : [toStr(o.status)];
  const rawStatus = flow.filter(Boolean).pop() ?? '';
  return {
    externalId,
    status: mapWbStatus(rawStatus),
    modifiedMs: createdMs,
    row: {
      ...rowBase(shop, externalId, 'Wildberries'),
      buyer: '',           // 平台该端点不返回买家身份（脱敏）
      product: summaryProduct(name, 1, 1),
      sku,
      phone: '',
      items: [{ name, sku, qty: 1 }],
      amount: toAmount(firstNum(o.totalSum, o.price) / 100),   // 单位：1% 货币
      currency: toCurrency(o.currency ?? o.currencyCode, 'RUB'),  // 该端点不给币种：WB 本土结算为 RUB
      status: mapWbStatus(rawStatus),
      address: '',
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `WB 状态 ${rawStatus || '-'}`,
    },
  };
}
async function wbPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = wbConn(ctx.creds);
  const dateFrom = new Date(ctx.sinceMs).toISOString().slice(0, 19);
  const r = await cli.get(`/api/v1/supplier/orders?dateFrom=${dateFrom}`);
  if (!r.ok) throw new Error(`Wildberries 拉单失败：${apiErr(r.data, r.status)}`);
  if (r.data && !Array.isArray(r.data) && (r.data.error || r.data.message)) {
    throw new Error(`Wildberries 拉单失败：${apiErr(r.data, r.status)}`);
  }
  const rows = Array.isArray(r.data) ? r.data : [];
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (const o of rows) {
    const n = wbOrderToNorm(ctx.shop, o);
    if (!n || seen.has(n.externalId)) continue;
    seen.add(n.externalId);
    out.push(n);
    if (out.length >= ctx.maxOrders) { ctx.warn(`Wildberries 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`); break; }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 5：BigCommerce（Stores API v3）
//   凭据：store_hash + access_token（X-Auth-Token 头）
//   GET /v3/orders?limit=200&offset=N&modified_min=ISO&include=line_items,customers,billing_address
//     （v3 订单集合默认不带商品行/客户名，必须 include 才有，否则只能逐单二次请求）
//   状态：status 文本优先、status_id 数字兜底——官方 status_id 语义多变（1 pending /
//         2 processing / 3 complete / 4 declined / 5,10,12 refunded / 6 shipped /
//         7 partially shipped / 8 awaiting payment / 11 partially refunded）
// ═══════════════════════════════════════════════════════════════════
const BC_PAGE_SIZE = 200;

const BC_STATUS_ID_MAP: Record<string, string> = {
  '1': '待处理', '2': '待发货', '3': '已完成', '4': '已取消', '5': '售后中', '6': '已发货',
  '7': '已发货', '8': '待处理', '9': '待处理', '10': '售后中', '11': '售后中', '12': '售后中',
};
const BC_STATUS_TEXT_MAP: Record<string, string> = {
  'pending': '待处理', 'processing': '待发货', 'complete': '已完成', 'completed': '已完成',
  'shipped': '已发货', 'partially shipped': '已发货', 'partially_shipped': '已发货',
  'awaiting payment': '待处理', 'awaiting_payment': '待处理', 'declined': '已取消',
  'cancelled': '已取消', 'refunded': '售后中', 'partially refunded': '售后中', 'partially_refunded': '售后中',
  'vulnerable': '待审核', 'payment deferred': '待审核',
};
function mapBcStatus(status: unknown, statusId: unknown): string {
  const t = toStr(status).toLowerCase();
  if (t && BC_STATUS_TEXT_MAP[t]) return BC_STATUS_TEXT_MAP[t];
  const id = toStr(statusId);
  return BC_STATUS_ID_MAP[id] ?? '待处理';
}
function bcConn(creds: Record<string, unknown>) {
  const hash = firstStr(creds.store_hash).replace(/^stores\//, '').replace(/\/+$/, '');
  const token = firstStr(creds.access_token);
  if (!hash || !token) throw new Error('BigCommerce 凭据不完整（缺 Store Hash 或 Access Token），请重新授权');
  const base = `https://api.bigcommerce.com/stores/${encodeURIComponent(hash)}/v3`;
  return { async get(pathAndQuery: string): Promise<PlatResp> { return await getJson(`${base}${pathAndQuery}`, { 'X-Auth-Token': token }); } };
}
function bcAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = Array.isArray(a.street) ? a.street.filter(Boolean).join(' ') : toStr(a.street);
  const country = typeof a.country === 'object' ? firstStr(a.country.code, a.country.name) : toStr(a.country ?? a.country_code);
  const state = typeof a.state === 'object' ? firstStr(a.state.code, a.state.name) : toStr(a.state ?? a.state_abbrev);
  return [street, toStr(a.city), state, toStr(a.zip ?? a.postal_code), country].filter(Boolean).join(', ');
}
function bcOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = toStr(o.id);
  if (!platformId) return null;
  const externalId = `BC-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.line_items) ? o.line_items : [];
  const first = items[0] ?? {};
  const customers: any[] = Array.isArray(o.customers) ? o.customers : [];
  const cust = customers[0] ?? (o.customer && typeof o.customer === 'object' ? o.customer : {});
  const buyer = [toStr(cust.first_name), toStr(cust.last_name)].join(' ').trim() || toStr(cust.email) || '';
  const createdMs = parseTime(o.date_ordered);
  return {
    externalId,
    status: mapBcStatus(o.status, o.status_id),
    modifiedMs: parseTime(o.date_modified ?? o.date_shipped) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'BigCommerce'),
      buyer,
      product: summaryProduct(toStr(first.name), toNum(first.quantity), items.length),
      sku: firstStr(first.sku, first.product_id),
      phone: firstStr(o.billing_address?.phone, cust.phone),
      items: items.slice(0, 20).map((it) => ({ name: toStr(it.name), sku: firstStr(it.sku, it.product_id), qty: toNum(it.quantity) })),
      amount: toAmount(firstNum(o.order_total, o.base_amount_total, o.grand_total)),
      currency: toCurrency(o.currency_code ?? o.currency),
      status: mapBcStatus(o.status, o.status_id),
      address: bcAddr(o.shipping_addresses?.[0] ?? o.shipping_address) || bcAddr(o.billing_address),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
    },
  };
}
async function bcPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = bcConn(ctx.creds);
  const modifiedMin = new Date(ctx.sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out: NormOrder[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * BC_PAGE_SIZE;
    const r = await cli.get(`/orders?limit=${BC_PAGE_SIZE}&offset=${offset}&modified_min=${encodeURIComponent(modifiedMin)}`
      + '&include=line_items,customers,billing_address,shipping_addresses&sort=modified:asc');
    if (!r.ok) throw new Error(`BigCommerce 拉单失败：${apiErr(r.data, r.status)}`);
    const rows = Array.isArray(r.data?.data) ? r.data.data : [];
    for (const o of rows) {
      const n = bcOrderToNorm(ctx.shop, o);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(r.data?.meta?.pagination?.total);
    if (rows.length < BC_PAGE_SIZE || out.length >= ctx.maxOrders || offset + rows.length >= total) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`BigCommerce 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 6：Mercado Libre（Orders API）
//   凭据：client_id / client_secret / refresh_token —— 按 ERP 约定 refresh_token 内即当前
//         可用 access token（OAuth 完成后落库），本适配器不做令牌刷新
//   GET /orders/search?seller={卖家用户ID}&sort=date_updated&since=ISO&limit=50&offset=N
//     · 搜索结果只有轻量字段，商品行/收货地址必须再取 GET /orders/{id} 明细
//     · seller 参数为卖家用户 ID：凭据未填时用 GET /users/me 真实取回（不猜）
//   状态：not_paid/pending/paid → 待审核/待处理，shipping → 待发货，shipped → 已发货，
//         delivered → 已完成，cancelled → 已取消，refunded → 售后中
// ═══════════════════════════════════════════════════════════════════
const ML_API = 'https://api.mercadolibre.com';
const ML_PAGE_SIZE = 50;
const ML_MAX_PAGES = 10;   // 单次最多 500 单（每单还要一次明细请求，防失控）

const ML_STATUS_MAP: Record<string, string> = {
  'not_paid': '待审核',
  'not_started': '待审核',
  'pending': '待处理',
  'paid': '待处理',
  'handling': '待发货',
  'shipping': '待发货',
  'shipped': '已发货',
  'delivered': '已完成',
  'not_delivered': '售后中',
  'cancelled': '已取消',
  'refunded': '售后中',
  'partially_refunded': '售后中',
  'claimed': '售后中',
};
function mapMlStatus(raw: string): string {
  return ML_STATUS_MAP[toStr(raw).toLowerCase()] ?? '待处理';
}
function mlConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.refresh_token);
  if (!token) throw new Error('Mercado Libre 凭据不完整（缺访问令牌），请重新授权');
  return {
    token,
    async get(pathAndQuery: string): Promise<PlatResp> { return await getJson(`${ML_API}${pathAndQuery}`, { Authorization: `Bearer ${token}` }); },
  };
}
function mlAddr(sh: any): string {
  const a = (sh && (sh.receiver_address ?? sh.address)) ?? null;
  if (!a || typeof a !== 'object') return '';
  const street = firstStr(a.street_name, a.address);
  const num = toStr(a.street_number);
  return [street ? `${street}${num ? ` ${num}` : ''}` : '', toStr(a.city), toStr(a.state_name ?? a.state), toStr(a.zip_code), toStr(a.country_name ?? a.country)].filter(Boolean).join(', ');
}
function mlOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = toStr(o.id);
  if (!platformId) return null;
  const externalId = `ML-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.order_items) ? o.order_items : [];
  const first: any = items[0] ?? {};
  const firstItem = (first.item ?? first) as Record<string, any>;
  const buyerObj = (o.buyer ?? o.collector ?? {}) as Record<string, any>;
  const buyer = firstStr(buyerObj.nickname, buyerObj.last_name, buyerObj.first_name, buyerObj.email, buyerObj.id);
  const createdMs = parseTime(o.date_created);
  return {
    externalId,
    status: mapMlStatus(o.status),
    modifiedMs: parseTime(o.date_updated ?? o.date_created) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Mercado Libre'),
      buyer,
      product: summaryProduct(toStr(firstItem.title ?? firstItem.name), toNum(first.quantity), items.length),
      sku: firstStr(firstItem.seller_sku, firstItem.id, firstItem.global_id),
      phone: firstStr(o.shipping?.receiver_address?.phone, o.phone?.home?.number),
      items: items.slice(0, 20).map((it) => {
        const it2 = (it.item ?? it) as Record<string, any>;
        return { name: toStr(it2.title ?? it2.name), sku: toStr(it2.seller_sku ?? it2.id ?? it2.global_id), qty: toNum(it.quantity) };
      }),
      amount: toAmount(firstNum(o.total_amount, o.paid_amount)),
      currency: toCurrency(o.currency_id),
      status: mapMlStatus(o.status),
      address: mlAddr(o.shipping),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `ML 状态 ${toStr(o.status) || '-'}`,
    },
  };
}
/** 卖家用户 ID：优先凭据，否则用 /users/me 真实取回并缓存到 ctx.shared */
async function mlSellerId(cli: ReturnType<typeof mlConn>, ctx: FetchCtx): Promise<string> {
  const own = firstStr(ctx.creds.seller_account, ctx.creds.seller_id, ctx.creds.user_id);
  if (own) return own;
  if (typeof ctx.shared.mlSellerId === 'string') return ctx.shared.mlSellerId;
  const r = await cli.get('/users/me');
  const id = r.ok ? toStr(r.data?.id) : '';
  if (!id) throw new Error(`Mercado Libre 无法确定卖家 ID（/users/me 失败：${apiErr(r.data, r.status)}），请在凭据中补填卖家账号`);
  ctx.shared.mlSellerId = id;
  return id;
}
async function mlPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = mlConn(ctx.creds);
  const seller = await mlSellerId(cli, ctx);
  const since = new Date(ctx.sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < ML_MAX_PAGES; page++) {
    const offset = page * ML_PAGE_SIZE;
    const q = `/orders/search?seller=${encodeURIComponent(seller)}&sort=date_updated&since=${encodeURIComponent(since)}&limit=${ML_PAGE_SIZE}&offset=${offset}`;
    const r = await cli.get(q);
    if (!r.ok) throw new Error(`Mercado Libre 拉单失败：${apiErr(r.data, r.status)}`);
    const rows: any[] = Array.isArray(r.data?.results) ? r.data.results : (Array.isArray(r.data) ? r.data : []);
    for (const item of rows) {
      const orderId = toStr(item.id ?? item.order_id);
      if (!orderId || seen.has(orderId)) continue;
      seen.add(orderId);
      // 列表项缺商品行/地址 → 逐单取明细；明细失败退化为列表项（不编造字段）
      const d = await cli.get(`/orders/${encodeURIComponent(orderId)}`);
      const src = d.ok && d.data && typeof d.data === 'object' ? d.data : item;
      const n = mlOrderToNorm(ctx.shop, { ...item, ...src });
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(r.data?.paging?.total);
    if (rows.length < ML_PAGE_SIZE || out.length >= ctx.maxOrders || offset + rows.length >= total) break;
  }
  if (seen.size >= ML_PAGE_SIZE * ML_MAX_PAGES) ctx.warn(`Mercado Libre 本次仅回看最新 ${ML_PAGE_SIZE * ML_MAX_PAGES} 单，更早的历史单请手工补拉`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 7：Coupang（WING Open API · HMAC-SHA256）
//   凭据：access_key + secret_key + seller_account（Vendor ID）
//   网关：https://api-gateway.coupang.com（与本仓库 verify-shop-auth.verifyCoupang 同一套签名）
//     签名 = hex(HMAC-SHA256(secret_key, signedDate + "GET" + path + query))
//     头   = Authorization: CEA algorithm=HmacSHA256, access-key=…, signed-date=…, signature=…
//            + X-Requested-By: vendorId
//   分页：无 page/offset，用 minOrderId（返回 orderId > minOrderId 的订单）向后翻
//   时间：createdFrom/createdTo 为 KST(UTC+9) 裸串 yyyy-MM-ddTHH:mm:ss
//   状态：平台返回英文码 + 韩文文案，两套都映射；原始状态写进 remark 备查
// ═══════════════════════════════════════════════════════════════════
const COUPANG_API = 'https://api-gateway.coupang.com';
const COUPANG_PAGE_SIZE = 200;

const COUPANG_STATUS_MAP: Record<string, string> = {
  'in_progress': '待处理',
  'order_confirmed': '待处理',
  'ready': '待处理',
  'done': '待发货',
  'payment_confirmed': '待发货',
  'shipping_preparation': '待发货',
  'awaiting_shipment': '待发货',
  'shipped': '已发货',
  'out_for_delivery': '已发货',
  'in_transit': '已发货',
  'arranged': '已发货',
  'delivered': '已完成',
  'completed': '已完成',
  'purchased': '已完成',
  'cancelled': '已取消',
  'canceled': '已取消',
  'cancel_requested': '售后中',
  'refunded': '售后中',
  'returned': '售后中',
  'exchange': '售后中',
  '주문확인': '待处理',
  '재고확정': '待发货',
  '배송준비중': '待发货',
  '배송시작': '已发货',
  '배송중': '已发货',
  '배송완료': '已完成',
  '구매결정': '已完成',
  '취소요청': '售后中',
  '취소완료': '已取消',
  '환불': '售后中',
  '반품': '售后中',
};
function mapCoupangStatus(...raws: unknown[]): string {
  for (const v of raws) {
    const k = toStr(v);
    if (k && COUPANG_STATUS_MAP[k]) return COUPANG_STATUS_MAP[k];
    const low = k.toLowerCase();
    if (low && COUPANG_STATUS_MAP[low]) return COUPANG_STATUS_MAP[low];
  }
  return '待处理';
}
function coupangConn(creds: Record<string, unknown>) {
  const ak = firstStr(creds.access_key);
  const sk = firstStr(creds.secret_key);
  const vendorId = firstStr(creds.seller_account, creds.vendor_id, creds.shop_id);
  if (!ak || !sk || !vendorId) throw new Error('Coupang 凭据不完整（缺 Access Key / Secret Key / Vendor ID），请重新填写');
  return {
    vendorId,
    async get(path: string, query: string): Promise<PlatResp> {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const signedDate = `${String(d.getUTCFullYear()).slice(2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
      const sig = await hmacSha256Hex(`${signedDate}GET${path}${query}`, sk);
      const url = `${COUPANG_API}${path}${query ? `?${query}` : ''}`;
      return await getJson(url, {
        Authorization: `CEA algorithm=HmacSHA256, access-key=${ak}, signed-date=${signedDate}, signature=${sig}`,
        'X-Requested-By': vendorId,
      });
    },
  };
}
/** KST 裸时间串（Coupang 时间参数不带时区） */
function coupangKst(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 19);
}
/** 金额：优先整单结算/支付总额；只有单价字段时按数量折算（Coupang 各版本字段名不一） */
function coupangAmount(o: Record<string, any>, qty: number): number {
  const whole = firstNum(o.settlementAmount, o.totalPayment, o.orderAmount, o.paymentAmount, o.invoiceAmount);
  return toAmount(whole > 0 ? whole : firstNum(o.unitPrice, o.paymentUnitPrice, o.productAmount) * (qty > 0 ? qty : 1));
}
function coupangOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = toStr(o.orderId ?? o.orderIdNo ?? o.id);
  if (!platformId) return null;
  const externalId = `COUPANG-${shop.id.slice(0, 8)}-${platformId}`;
  const name = firstStr(o.productName, o.itemName, o.goodsName, o.title);
  const qty = toNum(o.quantity ?? o.orderQuantity ?? o.itemCount) || 1;
  const pkgId = toStr(o.packageId);
  const createdMs = parseTime(o.orderDate ?? o.payDate ?? o.createdAt);
  const rawStatus = firstStr(o.orderStatus, o.shipmentStatus, o.shippingStatus, o.status);
  // 订单级状态优先（배송완료/已完成 不能被发货子状态覆盖），再退回发货/支付子状态
  const status = mapCoupangStatus(o.orderStatus, o.shipmentStatus, o.shippingStatus, o.status, o.paymentStatus);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updatedAt ?? o.invoiceCompleteDate ?? o.orderDate) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Coupang'),
      buyer: firstStr(o.customerName, o.buyerName, o.receiverName),   // 平台多数接口对买家身份脱敏，取不到就留空
      product: summaryProduct(name, qty, 1),
      sku: firstStr(o.itemId, o.externalSellerSku, o.sellerSku, o.skuId),
      phone: firstStr(o.receiverPhoneNumber, o.requesterPhoneNumber, o.phone),
      items: [{ name, sku: firstStr(o.itemId, o.sellerSku), qty }],
      amount: coupangAmount(o, qty),
      currency: toCurrency(o.currency, 'KRW'),   // Coupang 韩国本土结算币种
      status,
      address: firstStr(o.receiverAddress, o.shippingAddress, o.baseAddress, o.fullAddress),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`Coupang 状态 ${rawStatus || '-'}`, pkgId ? `包裹 ${pkgId}` : '', toStr(o.paymentStatus) ? `支付 ${toStr(o.paymentStatus)}` : ''].filter(Boolean).join(' | '),
    },
  };
}
async function coupangPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const conn = coupangConn(ctx.creds);
  const path = `/v2/providers/openapi/apis/api/v6/vendors/${encodeURIComponent(conn.vendorId)}/orders`;
  const createdFrom = coupangKst(ctx.sinceMs);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  let minOrderId = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = `limit=${COUPANG_PAGE_SIZE}&minOrderId=${minOrderId}&orderStatusBy=created&createdFrom=${createdFrom}`;
    const r = await conn.get(path, query);
    // Coupang 业务失败也可能 HTTP 200 + code/message，故成功判定同时校验 data 结构
    if (!r.ok || (r.data && r.data.code && !r.data.data)) {
      throw new Error(`Coupang 拉单失败：${apiErr(r.data, r.status)}`);
    }
    const rows: any[] = Array.isArray(r.data?.data) ? r.data.data : (Array.isArray(r.data?.orders) ? r.data.orders : []);
    let lastId = minOrderId;
    for (const o of rows) {
      const n = coupangOrderToNorm(ctx.shop, o);
      const id = toStr(o?.orderId ?? o?.id);
      if (id) lastId = Math.max(lastId, toNum(id));
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    if (rows.length < COUPANG_PAGE_SIZE || out.length >= ctx.maxOrders || lastId <= minOrderId) break;
    minOrderId = lastId;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Coupang 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 8：Allegro（Order API · public v1）
//   凭据：client_id / client_secret / refresh_token —— refresh_token 内即当前 access token
//   GET /order/orders?limit=60&offset=N&from=ISO   （响应集合键是 zorders，Allegro 历史遗留）
//   注意：不加 countryCode=PL 过滤——Allegro 已在 CZ/SK 开站，按国家过滤会静默漏单
//   兼容两代字段名：buyers[]/buyer、offer/offerOrVoucher、quantity{value}/quantity
// ═══════════════════════════════════════════════════════════════════
const ALLEGRO_API = 'https://api.allegro.pl';
const ALLEGRO_PAGE_SIZE = 60;

const ALLEGRO_STATUS_MAP: Record<string, string> = {
  'pending': '待审核',
  'pending_for_payment': '待处理',
  'pending_payment_confirmation': '待处理',
  'pending_separate_fulfillment': '待审核',
  'confirmed': '待发货',
  'realization_issue': '售后中',
  'completed': '已完成',
  'finished': '已完成',
  'cancelled': '已取消',
  'banned': '已取消',
};
function mapAllegroStatus(raw: string): string {
  return ALLEGRO_STATUS_MAP[toStr(raw).toLowerCase()] ?? '待处理';
}
function allegroConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.refresh_token);
  if (!token) throw new Error('Allegro 凭据不完整（缺 Access Token），请重新授权');
  return {
    async get(pathAndQuery: string): Promise<PlatResp> {
      return await getJson(`${ALLEGRO_API}${pathAndQuery}`, {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.allegro.public.v1+json',
      });
    },
  };
}
function allegroAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const country = typeof a.country === 'object' ? firstStr(a.country.code, a.country.name) : toStr(a.country);
  const street = [toStr(a.street), toStr(a.houseNumber), toStr(a.flatNumber)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.postCode), country].filter(Boolean).join(', ');
}
function allegroOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = toStr(o.id);
  if (!platformId) return null;
  const externalId = `ALLEGRO-${shop.id.slice(0, 8)}-${platformId}`;
  const products: any[] = Array.isArray(o.products) ? o.products : [];
  const first: any = products[0] ?? {};
  const offer = (first.offer ?? first.offerOrVoucher ?? {}) as Record<string, any>;
  const qtyOf = (p: any) => toNum(p?.quantity?.value ?? p?.quantity) || 0;
  const buyerObj: any = (Array.isArray(o.buyers) ? o.buyers[0] : null) ?? o.buyer ?? {};
  const buyer = firstStr(buyerObj.fullName, [toStr(buyerObj.firstName), toStr(buyerObj.lastName)].join(' '),
    buyerObj.company, buyerObj.email, buyerObj.login);
  const fulfill = (o.fulfillment ?? {}) as Record<string, any>;
  const address = (o.delivery?.address ?? fulfill.address) as any;
  const priceObj = (o.totalPrice ?? o.value ?? o.payment?.invoiceAmount ?? {}) as Record<string, any>;
  const createdMs = parseTime(o.createdAt ?? o.createTimestamp);
  const status = mapAllegroStatus(o.status);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updatedAt ?? o.modifiedTimestamp) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Allegro'),
      buyer,
      product: summaryProduct(toStr(offer.name ?? offer.id), qtyOf(first), products.length),
      sku: firstStr(offer.sku, o.selectedOffers?.[0]?.sku, offer.id),
      phone: firstStr(buyerObj.phone, Array.isArray(address?.phones) ? address.phones[0] : address?.phone),
      items: products.slice(0, 20).map((p) => {
        const of = (p?.offer ?? p?.offerOrVoucher ?? {}) as Record<string, any>;
        return { name: toStr(of.name ?? of.id), sku: toStr(of.sku ?? of.id), qty: qtyOf(p) };
      }),
      amount: toAmount(priceObj.amount ?? firstNum(o.sumTransactionProducts, o.transactionFinalAmounts?.reconciliationFinalizedAmounts?.grossLockedAmounts?.gross)),
      currency: toCurrency(priceObj.currency, 'PLN'),
      status,
      address: allegroAddr(address),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `Allegro 状态 ${toStr(o.status) || '-'}`,
    },
  };
}
async function allegroPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = allegroConn(ctx.creds);
  const from = new Date(ctx.sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out: NormOrder[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * ALLEGRO_PAGE_SIZE;
    const r = await cli.get(`/order/orders?limit=${ALLEGRO_PAGE_SIZE}&offset=${offset}&from=${encodeURIComponent(from)}&sort=CREATE_TIME`);
    if (!r.ok) throw new Error(`Allegro 拉单失败：${apiErr(r.data, r.status)}`);
    const rows: any[] = Array.isArray(r.data?.zorders) ? r.data.zorders : (Array.isArray(r.data?.orders) ? r.data.orders : []);
    for (const o of rows) {
      const n = allegroOrderToNorm(ctx.shop, o);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(r.data?.totalCount);
    if (rows.length < ALLEGRO_PAGE_SIZE || out.length >= ctx.maxOrders || offset + rows.length >= total) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Allegro 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 9：TikTok Shop（Partner API · order 202309）
//   凭据（authorize-shop OAuth 回调写入）：access_token + app_key + shop_cipher
//         app_secret 不在凭据里（平台级密钥）→ 回落环境变量 TIKTOK_APP_SECRET
//   签名（官方规范）：path + 按 key 升序拼接的 {key}{value}（排除 sign / access_token），
//                    首尾各拼一次 app_secret，再 HMAC-SHA256(app_secret, 该串) 取 hex
//   GET /order/202309/orders：不传 status = 全状态；按 update_time 升序翻页，
//                    page_token 游标；升序可保证「截断时水位只前进到已拉到的最新时间」不漏单
// ═══════════════════════════════════════════════════════════════════
const TTS_API = 'https://open-api.tiktokglobalshop.com';
const TTS_PAGE_SIZE = 100;

const TTS_STATUS_MAP: Record<string, string> = {
  'unpaid': '待处理',
  'awaiting_payment': '待处理',
  'partially_unpaid': '待处理',
  'on_hold': '待审核',
  'awaiting_shipment': '待发货',
  'partially_awaiting_shipment': '待发货',
  'shipping': '已发货',
  'delivered': '已完成',
  'completed': '已完成',
  'cancelled': '已取消',
  'returned': '售后中',
  'damaged': '售后中',
};
function mapTtsStatus(raw: string): string {
  return TTS_STATUS_MAP[toStr(raw).toLowerCase()] ?? '待处理';
}
/** TikTok 时间是 unix 秒（数字串），也兼容 ISO 串 */
function ttsTime(v: unknown): number | null {
  const n = Number(v);
  if (Number.isFinite(n) && n > 1_000_000_000 && n < 1e11) return n * 1000;
  return parseTime(v);
}
function ttsConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('TIKTOK_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('TIKTOK_APP_SECRET'));
  const accessToken = firstStr(creds.access_token, creds.refresh_token, creds.token);
  const cipher = firstStr(creds.shop_cipher, creds.seller_account);
  if (!appKey || !appSecret) throw new Error('TikTok Shop 缺少 App Key / App Secret（App Secret 请在服务端环境变量 TIKTOK_APP_SECRET 配置），请重新授权');
  if (!accessToken) throw new Error('TikTok Shop 缺少 Access Token，请重新授权');
  return {
    appKey, appSecret, accessToken, cipher,
    async get(path: string, params: Record<string, string>): Promise<PlatResp> {
      const kv = Object.keys(params)
        .filter((k) => k !== 'sign' && k !== 'access_token' && toStr(params[k]) !== '')
        .sort().map((k) => `${k}${params[k]}`).join('');
      const sign = await hmacSha256Hex(`${appSecret}${path}${kv}${appSecret}`, appSecret);
      const qs = new URLSearchParams(params);
      qs.set('sign', sign);
      return await getJson(`${TTS_API}${path}?${qs.toString()}`, { 'x-tts-access-token': accessToken });
    },
  };
}
function ttsOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = toStr(o.id ?? o.order_id);
  if (!platformId) return null;
  const externalId = `TTS-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.items) ? o.items : (Array.isArray(o.order_lines) ? o.order_lines : []);
  const first: any = items[0] ?? {};
  const amount = (o.order_amount ?? {}) as Record<string, any>;
  const addr = (o.recipient_address ?? o.shipping_address ?? o.address) as any;
  const createdMs = ttsTime(o.create_time ?? o.created_at);
  const status = mapTtsStatus(o.status);
  const fullAddr = addr && typeof addr === 'object'
    ? firstStr(addr.full_address, [toStr(addr.street1 ?? addr.address1), toStr(addr.city), toStr(addr.state), toStr(addr.zip_code), toStr(addr.country)].filter(Boolean).join(', '))
    : '';
  return {
    externalId,
    status,
    modifiedMs: ttsTime(o.update_time ?? o.create_time) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'TikTok Shop'),
      buyer: firstStr(o.buyer_name, o.shipping_name, o.buyer_user_id),
      product: summaryProduct(toStr(first.product_name ?? first.sku_name), toNum(first.quantity), items.length),
      sku: firstStr(first.sku_id, first.seller_sku, first.id),
      phone: firstStr(o.recipient_phone ?? o.phone_number, addr?.phone_number, addr?.phone),
      items: items.slice(0, 20).map((it) => ({
        name: toStr(it.product_name ?? it.sku_name),
        sku: toStr(it.sku_id ?? it.seller_sku ?? it.id),
        qty: toNum(it.quantity),
      })),
      amount: toAmount(amount.total_amount ?? o.total_amount),
      currency: toCurrency(amount.currency ?? o.currency),
      status,
      address: fullAddr,
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`TTS 状态 ${toStr(o.status) || '-'}`, toStr(o.cod_state) ? `COD ${toStr(o.cod_state)}` : ''].filter(Boolean).join(' | '),
    },
  };
}
async function ttsPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const conn = ttsConn(ctx.creds);
  const path = '/order/202309/orders';
  const out: NormOrder[] = [];
  let pageToken = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: Record<string, string> = {
      app_key: conn.appKey,
      timestamp: String(Math.floor(Date.now() / 1000)),
      page_size: String(TTS_PAGE_SIZE),
      sort_field: 'UPDATE_TIME',
      sort_order: 'ASC',
      update_time_ge: String(Math.floor(ctx.sinceMs / 1000)),
    };
    if (conn.cipher) params.shop_cipher = conn.cipher;
    if (pageToken) params.page_token = pageToken;
    const r = await conn.get(path, params);
    if (!r.ok) throw new Error(`TikTok Shop 拉单失败：${apiErr(r.data, r.status)}`);
    if (r.data?.code !== undefined && toNum(r.data.code) !== 0) {
      throw new Error(`TikTok Shop 拉单失败：${apiErr(r.data, r.status)}`);
    }
    const rows: any[] = Array.isArray(r.data?.data?.orders) ? r.data.data.orders : [];
    for (const o of rows) {
      const n = ttsOrderToNorm(ctx.shop, o);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    pageToken = toStr(r.data?.data?.next_page_token ?? r.data?.data?.page_token);
    if (!r.data?.data?.has_more || !pageToken || rows.length === 0 || out.length >= ctx.maxOrders) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`TikTok Shop 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}


// ═══════════════════════════════════════════════════════════════════
// 通用：TOP 系签名（Lazada / AliExpress / Temu 共用）
//   TOP 规范：排除 sign 与空值 → 按 key 升序拼接 key+value → 用 app_secret 首尾包裹
//            → MD5（sign_method=md5，默认）或 HMAC-SHA256（sign_method=sha256）
//   大小写：Lazada/AliExpress 取大写十六进制，Temu 取小写十六进制
//   说明：Deno crypto.subtle 不提供 MD5 → 内置纯 TS MD5（零依赖、冷启动不发请求）
// ═══════════════════════════════════════════════════════════════════
function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const nblk = ((bytes.length + 8) >> 6) + 1;
  const buf = new ArrayBuffer(nblk * 64);
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  u8.set(bytes);
  u8[bytes.length] = 0x80;
  const bitLen = bytes.length * 8;
  dv.setUint32(nblk * 64 - 8, bitLen >>> 0, true);
  dv.setUint32(nblk * 64 - 4, Math.floor(bitLen / 4294967296), true);
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K: number[] = new Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const rot = (x: number, c: number) => ((x << c) | (x >>> (32 - c))) | 0;
  let a0 = 0x67452301 | 0, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476 | 0;
  for (let blk = 0; blk < nblk; blk++) {
    const M: number[] = new Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(blk * 64 + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F = 0, g = 0;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const sum = (((A + F) | 0) + ((M[g] + K[i]) | 0)) | 0;
      const tmp = D;
      D = C; C = B;
      B = (B + rot(sum, S[i])) | 0;
      A = tmp;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const word = (n: number) => {
    let o = '';
    for (let i = 0; i < 4; i++) o += (((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0'));
    return o;
  };
  return word(a0) + word(b0) + word(c0) + word(d0);
}
/** TOP 公共参数串：排除 sign / 空值，按 key 升序拼 key+value */
function topConcat(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((k) => k !== 'sign' && toStr(params[k]) !== '')
    .sort().map((k) => `${k}${params[k]}`).join('');
}
/** TOP 签名：secret 包裹拼接串 → md5（默认）/ hmac-sha256；upper 控制大小写 */
async function topSign(concat: string, appSecret: string, algo: string, upper = true): Promise<string> {
  const wrapped = `${appSecret}${concat}${appSecret}`;
  const hex = algo === 'sha256' ? await hmacSha256Hex(wrapped, appSecret) : md5Hex(wrapped);
  return upper ? hex.toUpperCase() : hex.toLowerCase();
}
/** TOP 公共时间戳：yyyy-MM-dd HH:mm:ss（UTC，网关按字符串格式校验，不接受 ISO 带 Z） */
function topTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
/** TOP 系错误可读化（error_response / errorMsg 两套字段名都兜底） */
function topErr(data: any, status: number): string {
  const er = (data?.error_response ?? data?.top_refine ?? data) as Record<string, any>;
  const m = firstStr(er?.sub_msg, er?.msg, er?.message, data?.errorMsg, data?.error_msg, data?.message, apiErr(data, status));
  const code = firstStr(er?.code, data?.errorCode, data?.error_code);
  return `${m || `HTTP ${status}`}${code ? ` (${code})` : ''}`.slice(0, 300);
}
/** 分/元兼容取值：平台部分金额字段为 {cent, currencyCode}（分），部分为 {amount|value}（元） */
function moneyVal(v: any): number {
  if (v && typeof v === 'object') {
    if (v.cent !== undefined && v.amount === undefined && v.value === undefined) return toAmount(toNum(v.cent) / 100);
    return toAmount(firstNum(v.amount, v.value, v.cent));
  }
  return toAmount(v);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 10：eBay（OAuth2 + Sell Fulfillment API v1）
//   凭据：app_id + cert_id + dev_id（开发者门户 Application ID / Certificate ID / Dev ID）
//         订单接口属「用户级授权」域 → 凭据里的 OAuth2 access_token / refresh_token 优先；
//         只有 Trading API 的 auth_token（旧 XML 令牌）时无法调 Fulfillment，会显式报错
//   令牌：POST /identity/v2/oauth2/token（Basic base64(app_id:cert_id)），client_credentials
//         取应用令牌并按 expires_in 缓存进 ctx.shared，单次同步内多页复用
//   拉单：GET /sell/fulfillment/v1/order?limit=100&offset=N&modification_after=ISO
//         不传 order_status（=全状态，传 ALL 会被网关 400 拒）；modification_after 驱动水位
//   币种：totalPaymentAmount.{currency,value}；买家电话/收货地址平台不在订单体里给全 → 留空不编造
// ═══════════════════════════════════════════════════════════════════
const EBAY_API = 'https://api.ebay.com';
const EBAY_PAGE_SIZE = 100;
const EBAY_SCOPE = 'https://api.ebay.com/oauth2/api_scope/prod.ebay_auth';

const EBAY_STATUS_MAP: Record<string, string> = {
  'PENDING_PAYMENT': '待处理',
  'FAILED_PAYMENT': '待审核',
  'UNAVAILABLE': '待审核',
  'INACTIVE': '待审核',
  'ACTIVE': '待发货',
  'SHIPPED': '已发货',
  'COMPLETED': '已完成',
  'CANCELLED': '已取消',
  'PARTIALLY_REFUNDED': '售后中',
  'FULLY_REFUNDED': '售后中',
};
function mapEbayStatus(raw: unknown): string {
  return EBAY_STATUS_MAP[toStr(raw).toUpperCase().replace(/-/g, '_')] ?? '待处理';
}
function ebayAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  return [toStr(a.addressLine1), toStr(a.addressLine2), toStr(a.city), toStr(a.regionOrState ?? a.stateOrProvince),
    toStr(a.postalCode), toStr(a.country ?? a.countryName)].filter(Boolean).join(', ');
}
function ebayConn(creds: Record<string, unknown>) {
  const appId = firstStr(creds.app_id, envOpt('EBAY_APP_ID'));
  const certId = firstStr(creds.cert_id, envOpt('EBAY_CERT_ID'));
  const devId = firstStr(creds.dev_id, envOpt('EBAY_DEV_ID'));
  if (!appId || !certId) throw new Error('eBay 凭据不完整（缺 App ID / Cert ID），请重新授权');
  return {
    appId, certId, devId,
    basic: btoa(`${appId}:${certId}`),
    market: firstStr(creds.marketplace_id, 'EBAY_US').toUpperCase(),
    // OAuth2 用户令牌（新版）；legacy Trading auth_token 不能当 Bearer 用，故不在候选内
    userToken: firstStr(creds.access_token, creds.token),
    refreshToken: firstStr(creds.refresh_token),
    redirectUri: firstStr(creds.redirect_uri),
  };
}
/** eBay OAuth2 令牌：用户令牌 → refresh_token 刷新 → client_credentials 应用令牌（缓存复用） */
async function ebayBearer(ctx: FetchCtx, cli: ReturnType<typeof ebayConn>): Promise<string> {
  const cached = ctx.shared.ebayBearer as { token: string; expMs: number } | undefined;
  if (cached?.token && cached.expMs > Date.now() + 60_000) return cached.token;
  if (cli.userToken) {
    ctx.shared.ebayBearer = { token: cli.userToken, expMs: Date.now() + 3300_000 };
    return cli.userToken;
  }
  const form = new URLSearchParams(cli.refreshToken
    ? { grant_type: 'refresh_token', refresh_token: cli.refreshToken, scope: EBAY_SCOPE, ...(cli.redirectUri ? { redirect_uri: cli.redirectUri } : {}) }
    : { grant_type: 'client_credentials', scope: EBAY_SCOPE });
  const res = await fetchDirect(`${EBAY_API}/identity/v2/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${cli.basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  const text = await res.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  const token = toStr(d?.access_token);
  if (!res.ok || !token) {
    const hint = cli.refreshToken
      ? '（refresh_token 失效：请在 eBay 开发者门户重新完成用户授权并回写凭据）'
      : '（应用令牌只能调目录/浏览类接口；/sell/fulfillment 订单接口需用户级 OAuth2 授权，请把 access_token / refresh_token 写入凭据）';
    throw new Error(`eBay OAuth 取令牌失败：${apiErr(d, res.status)}${hint}`);
  }
  const ttlSec = toNum(d.expires_in) || 7100;
  ctx.shared.ebayBearer = { token, expMs: Date.now() + Math.max(60, ttlSec - 300) * 1000 };
  return token;
}
function ebayOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.orderId, o.legacyOrderId);
  if (!platformId) return null;
  const externalId = `EBAY-${shop.id.slice(0, 8)}-${platformId}`;
  const lines: any[] = Array.isArray(o.lineItems) ? o.lineItems : [];
  const first: any = lines[0] ?? {};
  const buyer: any = (o.buyer ?? {}) as Record<string, any>;
  const reg: any = (buyer.buyerRegistrationAddress ?? {}) as Record<string, any>;
  const pay: any = (o.totalPaymentAmount ?? {}) as Record<string, any>;
  const addr = first.shippingAddress ?? o.shippingAddress ?? reg;
  const createdMs = parseTime(o.createdDate);
  const status = mapEbayStatus(o.status);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.modificationDate ?? o.updatedDate) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'eBay'),
      buyer: firstStr(reg.fullName, buyer.email, buyer.buyerId),
      product: summaryProduct(toStr(first.title), toNum(first.quantityPurchased), lines.length),
      sku: firstStr(first.sellerSku, first.sku),
      phone: firstStr(first.shippingAddress?.phone),   // 订单接口多数站点不下发电话 → 留空
      items: lines.slice(0, 20).map((l) => ({
        name: toStr(l.title),
        sku: toStr(l.sku ?? l.sellerSku),
        qty: toNum(l.quantityPurchased),
      })),
      amount: toAmount(firstNum(pay.value, o.totalMarketplacePaymentAmount?.value)),
      currency: toCurrency(pay.currency, 'USD'),
      status,
      address: ebayAddr(addr),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`eBay 状态 ${toStr(o.status) || '-'}`, `行数 ${lines.length}`,
        firstStr(o.legacyOrderId) ? `legacy ${toStr(o.legacyOrderId)}` : '',
        toStr(first.shippingTrackingNumber) ? `运单 ${toStr(first.shippingTrackingNumber)}` : ''].filter(Boolean).join(' | '),
    },
  };
}
async function ebayPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = ebayConn(ctx.creds);
  const bearer = await ebayBearer(ctx, cli);
  const modAfter = new Date(ctx.sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const headers = { Authorization: `Bearer ${bearer}`, 'X-EBAY-C-MARKETPLACE-ID': cli.market };
  const out: NormOrder[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * EBAY_PAGE_SIZE;
    const qs = new URLSearchParams({
      limit: String(EBAY_PAGE_SIZE), offset: String(offset),
      marketplace_id: cli.market, modification_after: modAfter,
    });
    const r = await getJson(`${EBAY_API}/sell/fulfillment/v1/order?${qs.toString()}`, headers);
    if (!r.ok) throw new Error(`eBay 拉单失败：${apiErr(r.data, r.status)}`);
    const rows: any[] = Array.isArray(r.data?.orders) ? r.data.orders : (Array.isArray(r.data) ? r.data : []);
    for (const o of rows) {
      const n = ebayOrderToNorm(ctx.shop, o);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(r.data?.totalNumberOfOrders ?? r.data?.total);
    if (rows.length < EBAY_PAGE_SIZE || out.length >= ctx.maxOrders || (total > 0 && offset + rows.length >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`eBay 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 11：Walmart Marketplace（OAuth2 client_credentials + Orders v3）
//   凭据：client_id + client_secret
//   令牌：POST https://marketplace.walmartapis.com/v3/token（Basic + grant_type=client_credentials）
//         —— 与本仓库 authorize-shop / verify-shop-auth 校验用的是同一端点，
//            api.walmartlabs.com 为同一 API 的旧别名域，默认走 walmartapis.com
//   拉单：GET /v3/orders?queryWindowStartAt=&queryWindowEndAt=&limit=200&offset=N
//         （毫秒窗口为新版参数，同时带 startDate/endDate=yyyy-MM-dd 兼容旧版）
//   头：Authorization: Bearer + WM_SEC.ACCESS_TOKEN（旧版仍读此头）+ WM_SVC.NAME + WM_QOS.CORRELATION_ID
//   结构：v3 为「行级」返回——PO 在 elements[].poNumber，客户/地址信息受 PII 限制，
//         可能整单缺失（只给 city/state/country 或完全为空）→ 缺失字段留空，绝不编造
//   窗口：平台限制单次查询跨度 ≤ 6 个月，水位过旧时截断到 180 天并告警
// ═══════════════════════════════════════════════════════════════════
const WM_API = 'https://marketplace.walmartapis.com';
const WM_PAGE_SIZE = 200;
const WM_MAX_WINDOW_MS = 180 * 86400_000;

const WM_STATUS_MAP: Record<string, string> = {
  'pending': '待审核',
  'unreviewed': '待审核',
  'acknowledged': '待发货',
  'accepted': '待发货',
  'processed': '待发货',
  'on_hold': '待审核',
  'unsubstantiated': '待审核',
  'shipped': '已发货',
  'delivered': '已完成',
  'cancelled': '已取消',
  'canceled': '已取消',
  'rejected': '已取消',
  'returned': '售后中',
  'refunded': '售后中',
};
function mapWmStatus(raw: unknown): string {
  return WM_STATUS_MAP[toStr(raw).toLowerCase()] ?? '待处理';
}
function wmConn(creds: Record<string, unknown>) {
  const clientId = firstStr(creds.client_id, envOpt('WALMART_CLIENT_ID'));
  const clientSecret = firstStr(creds.client_secret, envOpt('WALMART_CLIENT_SECRET'));
  if (!clientId || !clientSecret) throw new Error('Walmart 凭据不完整（缺 Client ID / Client Secret），请重新授权');
  return {
    clientId, clientSecret,
    basic: btoa(`${clientId}:${clientSecret}`),
    svcName: firstStr(creds.svc_name, envOpt('WALMART_SVC_NAME'), 'Thalvior'),
  };
}
async function wmBearer(ctx: FetchCtx, cli: ReturnType<typeof wmConn>): Promise<string> {
  const cached = ctx.shared.wmToken as { token: string; expMs: number } | undefined;
  if (cached?.token && cached.expMs > Date.now() + 60_000) return cached.token;
  const res = await fetchDirect(`${WM_API}/v3/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${cli.basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: 'grant_type=client_credentials',
  });
  const text = await res.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  const token = firstStr(d?.access_token, d?.data?.access_token);
  if (!res.ok || !token) throw new Error(`Walmart OAuth 取令牌失败：${apiErr(d, res.status)}（Client ID/Secret 无效或未开通 Marketplace 权限）`);
  const ttlSec = toNum(d.expires_in ?? d.data?.expires_in) || 3500;
  ctx.shared.wmToken = { token, expMs: Date.now() + Math.max(60, ttlSec - 300) * 1000 };
  return token;
}
function wmAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.addressLine1 ?? a.street1), toStr(a.addressLine2 ?? a.street2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.state ?? a.province), toStr(a.zip ?? a.postalCode), toStr(a.country)].filter(Boolean).join(', ');
}
/** 行金额：优先平台给的行合计/折前金额，缺失才用 unitPrice × ordered（都是真实字段） */
function wmLineAmount(l: any): number {
  const ordered = toNum(l?.quantities?.ordered ?? l?.quantity);
  const unit = firstNum(l?.unitPrice?.amount, l?.unitPrice);
  const direct = firstNum(l?.lineTotal?.amount, l?.lineTotal, l?.lineAmountBeforeDiscount?.amount, l?.extendedPrice?.amount);
  if (direct > 0) return toAmount(direct);
  return toAmount(unit * (ordered > 0 ? ordered : 1));
}
/** 一个 PO 的多行折叠成一条 ERP 订单（与 Shopee/Lazada 行级平台同一套做法） */
function wmPoToNorm(shop: SyncShop, po: Record<string, any>): NormOrder | null {
  const platformId = firstStr(po.poNumber, po.orderId);
  if (!platformId) return null;
  const externalId = `WMART-${shop.id.slice(0, 8)}-${platformId}`;
  const lines: any[] = Array.isArray(po.lines) ? po.lines : (Array.isArray(po.orderLines) ? po.orderLines : []);
  const firstLine: any = lines[0] ?? {};
  const cust: any = (po.customer ?? firstLine.customer ?? {}) as Record<string, any>;
  const createdMs = parseTime(po.createdDate ?? po.orderDate);
  // 状态：单级 status 优先，缺则取首个行状态（v3 常只在 line 上给 status/statuses 末位）
  const rawStatus = firstStr(po.status, firstLine.status, Array.isArray(firstLine.statuses) ? firstLine.statuses[firstLine.statuses.length - 1] : '');
  const status = mapWmStatus(rawStatus);
  let amount = 0;
  for (const l of lines) amount += wmLineAmount(l);
  amount = toAmount(amount + firstNum(po.shippingCost?.amount, po.shippingCost));
  const addr = firstLine.shippingAddress ?? po.shippingAddress ?? po.addressFields ?? firstLine.addressFields;
  const lineTimeMs = lines.reduce((m: number, l: any) => Math.max(m, parseTime(l?.lastUpdateDate ?? l?.updatedDate) ?? 0), 0);
  return {
    externalId,
    status,
    modifiedMs: parseTime(po.lastUpdateDate ?? po.updatedDate) ?? (lineTimeMs || parseTime(po.createdDate ?? po.orderDate)),
    row: {
      ...rowBase(shop, externalId, 'Walmart'),
      buyer: firstStr(cust.name, [toStr(cust.firstName), toStr(cust.lastName)].filter(Boolean).join(' '), cust.email),
      product: summaryProduct(toStr(firstLine.name ?? firstLine.sku), toNum(firstLine.quantities?.ordered ?? firstLine.quantity), lines.length),
      sku: firstStr(firstLine.sku, firstLine.upc),
      phone: firstStr(cust.phone, addr?.phone),   // PII 受限站点不下发 → 留空
      items: lines.slice(0, 20).map((l) => ({
        name: toStr(l.name ?? l.sku),
        sku: toStr(l.sku),
        qty: toNum(l.quantities?.ordered ?? l.quantity),
      })),
      amount,
      currency: toCurrency(firstLine.unitPrice?.currency ?? po.currency, 'USD'),
      status,
      address: wmAddr(addr),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`WM 状态 ${rawStatus || '-'}`, `行数 ${lines.length}`, firstStr(po.trackingNumber) ? `运单 ${toStr(po.trackingNumber)}` : ''].filter(Boolean).join(' | '),
    },
  };
}
async function wmPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = wmConn(ctx.creds);
  const token = await wmBearer(ctx, cli);
  let sinceMs = ctx.sinceMs;
  if (ctx.untilMs - sinceMs > WM_MAX_WINDOW_MS) {
    sinceMs = ctx.untilMs - WM_MAX_WINDOW_MS;
    ctx.warn(`Walmart 单次查询窗口上限 6 个月，本次仅回看最近 180 天，更早历史单请手工补拉`);
  }
  const d = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const headers = {
    Authorization: `Bearer ${token}`,
    'WM_SEC.ACCESS_TOKEN': token,
    'WM_SVC.NAME': cli.svcName,
    'WM_QOS.CORRELATION_ID': crypto.randomUUID(),
  };
  const out: NormOrder[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * WM_PAGE_SIZE;
    const qs = new URLSearchParams({
      queryWindowStartAt: String(Math.floor(sinceMs)), queryWindowEndAt: String(Math.floor(ctx.untilMs)),
      startDate: d(sinceMs), endDate: d(ctx.untilMs),
      limit: String(WM_PAGE_SIZE), offset: String(offset),
    });
    const r = await getJson(`${WM_API}/v3/orders?${qs.toString()}`, headers);
    if (!r.ok) throw new Error(`Walmart 拉单失败：${apiErr(r.data, r.status)}`);
    const rows: any[] = Array.isArray(r.data?.elements) ? r.data.elements : (Array.isArray(r.data?.data?.elements) ? r.data.data.elements : []);
    for (const po of rows) {
      const n = wmPoToNorm(ctx.shop, po);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(r.data?.totalElements ?? r.data?.totalCount);
    if (rows.length < WM_PAGE_SIZE || out.length >= ctx.maxOrders || (total > 0 && offset + rows.length >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Walmart 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 12：Shopee（Open Platform v2 · HMAC-SHA256）
//   凭据：partner_id + partner_key + access_token + shop_id
//         （兼容 app_key/app_secret/seller_account 两套字段名，与 settlement-sync 一致）
//   域名：https://partner.shopeemobile.com —— 官方生产域（open-apis.shopee.com 无此 REST 路径）
//   签名：hex(HMAC-SHA256(partner_key, partner_id + path + timestamp + access_token + shop_id + body))
//         GET 请求 body 为空串，业务参数只进 query，不参与签名
//   拉单：/api/v2/order/get_order_list 按 update_time 窗口翻页（cursor 优先，无 cursor 回落 page_no）
//         列表项不含状态/商品/地址 → 再 /api/v2/order/get_order_detail 批量（≤50/次）取真实明细；
//         明细失败退化为列表项（与 Mercado Libre 适配器同一套容错，不编造字段）
//   说明：OAuth 未完成（无 access_token）时显式抛错，绝不静默空跑
// ═══════════════════════════════════════════════════════════════════
const SHOPEE_API = 'https://partner.shopeemobile.com';
const SHOPEE_PAGE_SIZE = 50;      // get_order_list page_size 上限 50
const SHOPEE_DETAIL_BATCH = 50;   // get_order_detail order_sn_list 上限 50

const SHOPEE_STATUS_MAP: Record<string, string> = {
  'UNPAID': '待处理',
  'TO_SHIP': '待发货',
  'SHIPPED': '已发货',
  'TO_ACCEPT': '已发货',
  'DELIVERED': '已完成',
  'COMPLETED': '已完成',
  'CANCELLED': '已取消',
  'IN_RETURN_PROCESS': '售后中',
  'RETURNED': '售后中',
};
function mapShopeeStatus(raw: unknown): string {
  return SHOPEE_STATUS_MAP[toStr(raw).toUpperCase()] ?? '待处理';
}
function shopeeConn(creds: Record<string, unknown>) {
  const partnerId = firstStr(creds.partner_id, creds.app_key, envOpt('SHOPEE_PARTNER_ID'));
  const partnerKey = firstStr(creds.partner_key, creds.app_secret, envOpt('SHOPEE_PARTNER_KEY'));
  const accessToken = firstStr(creds.access_token, creds.token);
  const shopId = firstStr(creds.shop_id, creds.seller_account, creds.shop_cipher);
  if (!partnerId || !partnerKey) throw new Error('Shopee 凭据不完整（缺 Partner ID / Partner Key；App Secret 可配置在环境变量 SHOPEE_PARTNER_KEY），请重新授权');
  if (!accessToken) throw new Error('Shopee OAuth 流程尚未就绪：缺少 Access Token（店铺未完成 Shopee 卖家授权），请重新走 OAuth 授权');
  if (!shopId) throw new Error('Shopee 凭据不完整（缺 Shop ID / Seller Account），请重新授权');
  return {
    partnerId, partnerKey, accessToken, shopId,
    async call(method: string, path: string, biz: Record<string, string>, bodyStr = ''): Promise<PlatResp> {
      const ts = Math.floor(Date.now() / 1000);
      const base = `${partnerId}${path}${ts}${accessToken}${shopId}${bodyStr}`;
      const sign = await hmacSha256Hex(base, partnerKey);
      const qs = new URLSearchParams({ partner_id: partnerId, timestamp: String(ts), shop_id: shopId, access_token: accessToken, sign, ...biz });
      const url = `${SHOPEE_API}${path}?${qs.toString()}`;
      if (method === 'POST') {
        const res = await fetchDirect(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: bodyStr });
        const text = await res.text();
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
        return { ok: res.ok, status: res.status, data, link: '' };
      }
      return await getJson(url);
    },
  };
}
/** Shopee 时间是 unix 秒，也兼容 ISO 串 */
function shopeeTime(v: unknown): number | null {
  const n = Number(v);
  if (Number.isFinite(n) && n > 1_000_000_000 && n < 1e11) return n * 1000;
  return parseTime(v);
}
function shopeeAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  return [toStr(a.addr_address ?? a.address), toStr(a.addr_address_2 ?? a.address2), toStr(a.addr_city ?? a.city),
    toStr(a.addr_name ?? a.state ?? a.region), toStr(a.zip_code ?? a.postal_code), toStr(a.country_name ?? a.country)].filter(Boolean).join(', ');
}
function shopeeOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.order_sn, o.orderSn);
  if (!platformId) return null;
  const externalId = `SHOPEE-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.item_list) ? o.item_list : (Array.isArray(o.items) ? o.items : []);
  const first: any = items[0] ?? {};
  const addr: any = (o.shipping_address ?? o.address ?? {}) as Record<string, any>;
  const createdMs = shopeeTime(o.create_time ?? o.createTime);
  const status = mapShopeeStatus(o.status);
  return {
    externalId,
    status,
    modifiedMs: shopeeTime(o.update_time ?? o.updateTime) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Shopee'),
      buyer: firstStr(o.buyer_username, o.buyer_name, addr.buyer_name),
      product: summaryProduct(toStr(first.item_name ?? first.name), toNum(first.quantity), items.length),
      sku: firstStr(first.sku_seller ?? first.item_sku ?? first.sku_id, first.item_id),
      phone: firstStr(addr.buyer_phone ?? addr.phone, o.buyer_personal_phone),   // 非跨境/无权限站点不下发 → 留空
      items: items.slice(0, 20).map((it) => ({
        name: toStr(it.item_name ?? it.name),
        sku: toStr(it.sku_seller ?? it.item_sku ?? it.item_id),
        qty: toNum(it.quantity),
      })),
      amount: toAmount(firstNum(o.payment_amount, o.total_amount, o.totalDiscountedPrice)),
      currency: toCurrency(o.currency, ''),
      status,
      address: shopeeAddr(addr),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`Shopee 状态 ${toStr(o.status) || '-'}`, toStr(o.invoice_number) ? `发票 ${toStr(o.invoice_number)}` : ''].filter(Boolean).join(' | '),
    },
  };
}
async function shopeePull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = shopeeConn(ctx.creds);
  const from = Math.floor(ctx.sinceMs / 1000);
  const to = Math.floor(ctx.untilMs / 1000);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const biz: Record<string, string> = {
      // 水位是「修改时间」语义：用 update_time 窗口才能刷到状态变化（create_time 只发现新单）
      update_time_from: String(from), update_time_to: String(to),
      time_sent_from: '0', time_sent_to: '0',
      page_size: String(SHOPEE_PAGE_SIZE),
    };
    if (cursor) biz.cursor = cursor; else biz.page_no = String(page);
    const lr = await cli.call('GET', '/api/v2/order/get_order_list', biz);
    if (!lr.ok || (lr.data?.error && lr.data.error !== '')) throw new Error(`Shopee 拉单失败：${lr.data?.error ? `${lr.data.error} ${lr.data.message ?? ''}`.trim() : apiErr(lr.data, lr.status)}`);
    const resp = lr.data?.response ?? {};
    const rows: any[] = Array.isArray(resp.order_list) ? resp.order_list : [];
    const sns: string[] = [];
    for (const o of rows) {
      const sn = firstStr(o.order_sn);
      if (!sn || seen.has(sn)) continue;
      seen.add(sn);
      sns.push(sn);
    }
    // 批量取真实明细（状态/商品/地址）；失败逐单退化为列表项
    const detailById = new Map<string, any>();
    for (let i = 0; i < sns.length; i += SHOPEE_DETAIL_BATCH) {
      const batch = sns.slice(i, i + SHOPEE_DETAIL_BATCH);
      const dr = await cli.call('GET', '/api/v2/order/get_order_detail', {
        order_sn_list: batch.join(','),
        response_option: 'item_list,buyer,final_price,payment',
      });
      if (!dr.ok || (dr.data?.error && dr.data.error !== '')) {
        ctx.warn(`Shopee 订单明细批量获取失败（本批 ${batch.length} 单退化为列表数据）：${apiErr(dr.data, dr.status)}`);
        continue;
      }
      for (const d of (Array.isArray(dr.data?.response?.order_list) ? dr.data.response.order_list : [])) {
        const sn = firstStr(d.order_sn);
        if (sn) detailById.set(sn, d);
      }
    }
    for (const o of rows) {
      const sn = firstStr(o.order_sn);
      if (!sn) continue;
      const n = shopeeOrderToNorm(ctx.shop, { ...o, ...(detailById.get(sn) ?? {}) });
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const meta = resp.metadata ?? {};
    cursor = firstStr(meta.next_cursor);
    if (!meta.has_more || rows.length === 0 || out.length >= ctx.maxOrders) break;
    if (!cursor && toNum(meta.total_count) > 0 && seen.size >= toNum(meta.total_count)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Shopee 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 13：Lazada（开放平台 TOP 协议 · sign_method=md5）
//   凭据：app_key + app_secret + access_token（兼容 session / seller_account 字段名）
//   域名：默认 https://api.lazada.com/rest；生产按站点分域（api.lazada.sg / .com.my / .co.id …）
//         → 可在凭据 api_base 或环境变量 LAZADA_API_BASE 覆盖
//   签名：大写 MD5(app_secret + 升序 key+value + app_secret)，POST form 提交全部公共参数
//   方法：lazada.orders.get（v3，行级返回，可按 order_id 分组）；creds.api_method 可覆盖
//   时间：created_after / created_before（ISO8601）。平台无修改时间增量能力 →
//         水位窗口与「最近 30 天」取早者，重复单靠 externalId 幂等去重，状态变化得以回刷
//   币种：行项目不带币种（按国家下单），由站点域名/凭据推断，推不出则留空不猜金额
// ═══════════════════════════════════════════════════════════════════
const LAZADA_PAGE_SIZE = 100;
const LAZADA_RESCAN_MS = 30 * 86400_000;
const LAZADA_CCY: Record<string, string> = {
  sg: 'SGD', my: 'MYR', th: 'THB', id: 'IDR', ph: 'PHP', vn: 'VND', pk: 'PKR', bd: 'BDT', np: 'NPR', lk: 'LKR',
};

const LAZADA_STATUS_MAP: Record<string, string> = {
  'unverified': '待审核',
  'pending': '待审核',
  'packing': '待发货',
  'packed': '待发货',
  'ready_to_ship': '待发货',
  'ready_to_ship_pending': '待发货',
  'shipped': '已发货',
  'delivered': '已完成',
  'completed': '已完成',
  'canceled': '已取消',
  'cancelled': '已取消',
  'returned': '售后中',
  'return_requested': '售后中',
  'lost': '售后中',
  'damaged': '售后中',
  'out_of_stock': '售后中',
  'invoiced': '已完成',
  'closed': '已取消',
};
function mapLazadaStatus(raw: unknown): string {
  return LAZADA_STATUS_MAP[toStr(raw).toLowerCase().replace(/-/g, '_')] ?? '待处理';
}
function lazadaConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('LAZADA_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('LAZADA_APP_SECRET'));
  const session = firstStr(creds.access_token, creds.session, creds.seller_account, envOpt('LAZADA_SESSION'));
  if (!appKey || !appSecret) throw new Error('Lazada 凭据不完整（缺 App Key / App Secret；App Secret 建议配置在环境变量 LAZADA_APP_SECRET），请重新授权');
  if (!session) throw new Error('Lazada OAuth 流程尚未就绪：缺少卖家 Access Token（session），需在 Lazada 开放平台完成卖家授权后回写凭据');
  const apiBase = firstStr(creds.api_base, envOpt('LAZADA_API_BASE'), 'https://api.lazada.com/rest').replace(/\/+$/, '');
  return {
    appKey, appSecret, session, apiBase,
    method: firstStr(creds.api_method, 'lazada.orders.get'),
    signMethod: firstStr(creds.sign_method, 'md5').toLowerCase(),
    currency: toCurrency(creds.currency, ''),
    async call(biz: Record<string, string>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: appKey, sign_method: this.signMethod, format: 'json', v: '2.0',
        timestamp: topTimestamp(Date.now()), method: this.method,
        ...biz, session: this.session,
      };
      params.sign = await topSign(topConcat(params), appSecret, this.signMethod === 'sha256' ? 'sha256' : 'md5', true);
      const form = new URLSearchParams(params);
      const res = await fetchDirect(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: form.toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
/** 站点域名 → 币种（真实映射，非订单金额本身） */
function lazadaCurrencyOf(cli: ReturnType<typeof lazadaConn>): string {
  if (cli.currency) return cli.currency;
  const m = /api\.lazada\.(?:com\.)?(sg|my|th|id|ph|vn|pk|bd|np|lk)|api\.lazada\.(sg|my|th|id|ph|vn)/i.exec(cli.apiBase);
  const cc = (m?.[1] ?? m?.[2] ?? '').toLowerCase();
  return LAZADA_CCY[cc] ?? '';
}
function lazadaAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address1 ?? a.address), toStr(a.address2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.state), toStr(a.country), toStr(a.postcode ?? a.zip)].filter(Boolean).join(', ');
}
function lazadaGroupToNorm(shop: SyncShop, orderId: string, rows: any[], cli: ReturnType<typeof lazadaConn>): NormOrder | null {
  if (!orderId) return null;
  const externalId = `LAZADA-${shop.id.slice(0, 8)}-${orderId}`;
  const first: any = rows[0] ?? {};
  const createdMs = parseTime(first.created_at ?? first.createdAt ?? first.create_date);
  const rawStatus = firstStr(first.status, first.order_status, rows.map((r: any) => r?.status).filter(Boolean).sort()[0]);
  const status = mapLazadaStatus(rawStatus);
  let amount = 0;
  let qty = 0;
  for (const r of rows) { amount += firstNum(r.paid_price, r.price) * (toNum(r.quantity) || 1); qty += toNum(r.quantity) || 1; }
  const addrSrc = first.shipping_address ?? first.address ?? (first.recipient ?? {});
  return {
    externalId,
    status,
    modifiedMs: parseTime(first.updated_at ?? first.updatedAt ?? first.modified_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Lazada'),
      buyer: firstStr(first.customer_name, first.buyer_name, first.buyer_id, addrSrc.name),   // v3 隐私限制常不下发姓名 → 留空
      product: summaryProduct(toStr(first.name ?? first.item_name), qty, rows.length),
      sku: firstStr(first.sku_seller ?? first.sku_id ?? first.seller_sku, first.sku),
      phone: firstStr(first.phone, first.buyer_phone, addrSrc.phone, addrSrc.phone_number),
      items: rows.slice(0, 20).map((r) => ({
        name: toStr(r.name ?? r.item_name),
        sku: toStr(r.sku_seller ?? r.sku_id ?? r.sku),
        qty: toNum(r.quantity),
      })),
      amount: toAmount(amount),
      currency: toCurrency(first.currency, lazadaCurrencyOf(cli)),
      status,
      address: lazadaAddr(addrSrc),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `Lazada 状态 ${rawStatus || '-'} | 行 ${rows.length}`,
    },
  };
}
async function lazadaPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = lazadaConn(ctx.creds);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // 状态回刷需要重扫近期已下单据：窗口起点取 min(水位, 30 天前)，幂等由 externalId 保证
  const fromMs = Math.min(ctx.sinceMs, ctx.untilMs - LAZADA_RESCAN_MS);
  const out: NormOrder[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * LAZADA_PAGE_SIZE;
    const r = await cli.call({
      created_after: iso(fromMs), created_before: iso(ctx.untilMs),
      limit: String(LAZADA_PAGE_SIZE), offset: String(offset),
    });
    if (!r.ok || r.data?.error_response) throw new Error(`Lazada 拉单失败：${topErr(r.data, r.status)}`);
    const body = r.data?.orders_get_response ?? r.data?.order_get_response ?? r.data ?? {};
    const flat: any[] = Array.isArray(body.order_items) ? body.order_items : [];
    const nested: any[] = Array.isArray(body.orders) ? body.orders : [];
    // 两种返回形态：v3 行级扁平（按 order_id 分组）/ v1 单级（内嵌 order_items）
    const groups = new Map<string, any[]>();
    const push = (k: string, v: any) => { const a = groups.get(k) ?? []; a.push(v); groups.set(k, a); };
    for (const it of flat) push(firstStr(it.order_id ?? it.trade_order_id), it);
    for (const o of nested) {
      const oid = firstStr(o.order_id ?? o.id);
      const items = Array.isArray(o.order_items) && o.order_items.length > 0 ? o.order_items : [o];
      for (const it of items) push(oid, { ...o, ...it });
    }
    for (const [oid, rows] of groups) {
      const n = lazadaGroupToNorm(ctx.shop, oid, rows, cli);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(body.total_count ?? body.totalResults ?? r.data?.total_count);
    const pageCount = flat.length + nested.length;
    if (pageCount < LAZADA_PAGE_SIZE || out.length >= ctx.maxOrders || (total > 0 && offset + pageCount >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Lazada 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}


// ═══════════════════════════════════════════════════════════════════
// 适配器 14：AliExpress 速卖通（TOP 协议 · sign_method=md5，与 Lazada 共用签名实现）
//   凭据：app_key + app_secret + access_token（兼容 seller_account / session 字段名）
//   网关：https://api-sg.aliexpress.com/sync —— 现行开放平台统一入口（新加坡区）
//         沙箱/美西区用 creds.api_base 覆盖（api.aliexpress.com/simba/* 为已下线老 Simba 路径，不用）
//   方法：aliexpress.trade.new.redefining.findOrderList（官方推荐，按修改时间增量）
//   签名：大写 MD5(app_secret + 升序 key+value + app_secret)，公共参数进 query，业务参数同进 body
//   时间：modified_begin / modified_end —— 平台按「太平洋时间(UTC-7)」裸串解析，
//         故把 UTC 水位偏移 -7h 再格式化成 yyyy-MM-dd HH:mm:ss（不带时区后缀）
//   分页：page_no 从 1 起，page_size 上限 50，不传 order_status（=全状态）
//   状态：主状态 orderStatus（Taobao 系与 AE 系两套码都映射）；缺失时用 logisticsStatus 推导
// ═══════════════════════════════════════════════════════════════════
const AE_API = 'https://api-sg.aliexpress.com/sync';
const AE_PAGE_SIZE = 50;
const AE_TZ_OFFSET_MS = 7 * 3600_000;   // 平台时间口径为太平洋时间 PDT = UTC-7

const AE_STATUS_MAP: Record<string, string> = {
  'placeorder success': '待处理',
  'place_order_success': '待处理',
  'waitbuyerpay': '待处理',
  'wait_payment': '待处理',
  'payment_pending': '待处理',
  'wait_group': '待处理',
  'waitsellersendgoods': '待发货',
  'wait_seller_send_goods': '待发货',
  'seller_part_send_goods': '已发货',
  'seller_send_goods_partial': '已发货',
  'waitbuyerreceivegoods': '已发货',
  'wait_buyer_accept_goods': '已发货',
  'send_goods': '已发货',
  'finish': '已完成',
  'finish_order': '已完成',
  'completed': '已完成',
  'trade_success': '已完成',
  'in_archive': '已完成',
  'in_cancel': '待审核',
  'cancel_in_process': '待审核',
  'closed': '已取消',
  'cancel_order': '已取消',
  'ordered_close': '已取消',
  'refund_success': '售后中',
  'part_refund_success': '售后中',
};
function mapAeStatus(orderStatus: unknown, logisticsStatus: unknown): string {
  const k = toStr(orderStatus).toLowerCase();
  if (AE_STATUS_MAP[k]) return AE_STATUS_MAP[k];
  const lg = toStr(logisticsStatus).toLowerCase();
  if (lg.includes('wait')) return '待发货';
  if (lg.includes('send') || lg.includes('ship') || lg.includes('accept')) return '已发货';
  return '待处理';
}
function aeConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('AE_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('AE_APP_SECRET'));
  const accessToken = firstStr(creds.access_token, creds.seller_account, creds.session, envOpt('AE_ACCESS_TOKEN'));
  if (!appKey || !appSecret) throw new Error('AliExpress 凭据不完整（缺 App Key / App Secret；App Secret 建议配置在环境变量 AE_APP_SECRET），请重新授权');
  if (!accessToken) throw new Error('AliExpress OAuth 流程尚未就绪：缺少卖家 Access Token，需在速卖通开放平台完成卖家授权后回写凭据');
  return {
    appKey, appSecret, accessToken,
    apiBase: firstStr(creds.api_base, envOpt('AE_API_BASE'), AE_API),
    method: firstStr(creds.api_method, 'aliexpress.trade.new.redefining.findOrderList'),
    signMethod: firstStr(creds.sign_method, 'md5').toLowerCase(),
    async call(biz: Record<string, string>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: this.appKey, sign_method: this.signMethod, format: 'json', v: '2.0',
        timestamp: topTimestamp(Date.now()), method: this.method, access_token: this.accessToken,
        ...biz,
      };
      params.sign = await topSign(topConcat(params), this.appSecret, this.signMethod === 'sha256' ? 'sha256' : 'md5', true);
      const res = await fetchDirect(`${this.apiBase}?${new URLSearchParams(params).toString()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams(biz).toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
/** TOP 返回体根键 = 方法名点转下划线 + 驼峰转下划线 + _response；再向下剥 result 包装 */
function aeUnwrap(data: any, method: string): any {
  const root = String(method).replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  let cur: any = data;
  for (let depth = 0; depth < 4; depth++) {
    if (!cur || typeof cur !== 'object') break;
    const next = cur[`${root}_response`] ?? cur[root] ?? (depth === 0 ? cur.result : undefined);
    if (next === undefined || next === cur || (typeof next !== 'object' && !Array.isArray(next))) break;
    cur = next;
  }
  return cur ?? {};
}
/** 从对象里按候选键（含递归下钻）找第一个非空数组——TOP 各版本常把数组再包一层同名单数键 */
function pickArr(o: any, keys: string[], depth = 0): any[] {
  if (!o || typeof o !== 'object' || depth > 4) return [];
  for (const k of keys) if (Array.isArray(o[k]) && o[k].length > 0) return o[k] as any[];
  for (const k of keys) {
    if (o[k] && typeof o[k] === 'object') {
      const r = pickArr(o[k], keys, depth + 1);
      if (r.length > 0) return r;
    }
  }
  return [];
}
/** 兜底：候选键都没命中时，深度优先找第一个「对象数组」（应对方法名/包裹键随版本漂移） */
function deepArr(o: any, depth = 0): any[] {
  if (!o || typeof o !== 'object' || depth > 4) return [];
  for (const v of Object.values(o)) if (Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object') return v as any[];
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') { const r = deepArr(v, depth + 1); if (r.length > 0) return r; }
  }
  return [];
}
/** 按候选键深度查找标量（总数、页数等） */
function deepGet(o: any, keys: string[], depth = 0): unknown {
  if (!o || typeof o !== 'object' || depth > 4) return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  for (const v of Object.values(o)) {
    if (v && typeof v === 'object') { const r = deepGet(v, keys, depth + 1); if (r !== undefined) return r; }
  }
  return undefined;
}
function aeAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.streetAddress1 ?? a.address1 ?? a.street), toStr(a.streetAddress2 ?? a.address2)].filter(Boolean).join(' ');
  return [street, toStr(a.city ?? a.cityName), toStr(a.province ?? a.provinceName ?? a.state),
    toStr(a.postCode ?? a.zipCode ?? a.zip), toStr(a.country ?? a.countryName)].filter(Boolean).join(', ');
}
function aeOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.id, o.orderId, o.order_id, o.parentOrderId, o.tradeOrderLineId);
  if (!platformId) return null;
  const externalId = `AE-${shop.id.slice(0, 8)}-${platformId}`;
  const products: any[] = pickArr(o, ['tradeSimpleProductDTOs', 'trade_simple_product_dtos', 'tradeSimpleOrderLineDTOList',
    'productDTOList', 'tradeSimpleProducts', 'trade_simple_products', 'tradeSimpleProductDtos', 'orderItems', 'items']);
  const first: any = products[0] ?? {};
  const createdMs = parseTime(o.gmtCreate ?? o.gmt_create ?? o.createTime ?? o.placeOrderTime);
  const status = mapAeStatus(o.orderStatus ?? o.order_status ?? o.status, o.logisticsStatus ?? o.logistics_status ?? o.shippingStatus);
  const addrSrc = o.shippingAddressWrapper ?? o.recipientAddress ?? o.tradeSimpleLogisticsVO ?? o.logisticsVO ?? first;
  const qtyOf = (p: any) => toNum(p?.productCount ?? p?.count ?? p?.quantity);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.gmtModified ?? o.gmt_modified ?? o.modifiedTime ?? o.updateTime) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'AliExpress'),
      buyer: firstStr(o.buyerFullName, o.buyer_full_name, o.buyerName, o.buyerLoginId, o.buyer_login_id, addrSrc.contactName),
      product: summaryProduct(toStr(first.productName ?? first.name ?? first.subject ?? o.productName),
        qtyOf(first) || toNum(o.productCount), products.length || 1),
      sku: firstStr(first.skuId, first.sku_id, first.sellerSku, first.productAttributeInfo, o.skuId),
      phone: firstStr(o.recipientAccountMobile, addrSrc.phone ?? addrSrc.mobileNo ?? addrSrc.phoneNumber),   // 平台脱敏不下发 → 留空
      items: (products.length > 0 ? products : [o]).slice(0, 20).map((p) => ({
        name: toStr(p.productName ?? p.name ?? p.subject),
        sku: toStr(p.skuId ?? p.sku_id ?? p.sellerSku ?? p.productAttributeInfo),
        qty: qtyOf(p),
      })),
      amount: moneyVal(o.totalPayAmount ?? o.sumProductPriceToPay ?? o.shouldPayAmount ?? o.orderAmount ?? o.amount ?? o.payAmount),
      currency: toCurrency(o.payCurrency ?? o.currency ?? addrSrc.currency, 'USD'),
      status,
      address: aeAddr(addrSrc),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`AE 状态 ${toStr(o.orderStatus ?? o.order_status ?? o.status) || '-'}`,
        toStr(o.logisticsStatus ?? o.logistics_status ?? o.shippingStatus) ? `物流 ${toStr(o.logisticsStatus ?? o.logistics_status ?? o.shippingStatus)}` : '',
        toStr(o.paymentStatus ?? o.payment_status) ? `款项 ${toStr(o.paymentStatus ?? o.payment_status)}` : ''].filter(Boolean).join(' | '),
    },
  };
}
async function aePull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = aeConn(ctx.creds);
  const ts = (ms: number) => topTimestamp(ms - AE_TZ_OFFSET_MS);   // UTC → 平台太平洋时间裸串
  const out: NormOrder[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await cli.call({
      page_size: String(AE_PAGE_SIZE), page_no: String(page),
      modified_begin: ts(ctx.sinceMs), modified_end: ts(ctx.untilMs),
    });
    if (!r.ok || r.data?.error_response) throw new Error(`AliExpress 拉单失败：${topErr(r.data, r.status)}`);
    const body = aeUnwrap(r.data, cli.method);
    const keys = ['trade_simple_infos', 'tradeSimpleInfos', 'trade_list', 'tradeList', 'order_list', 'orderList',
      'orders', 'results', 'data', 'trade_simple_info', 'tradeSimpleInfo'];
    const rows = pickArr(body, keys);
    const list = rows.length > 0 ? rows : deepArr(body);
    for (const o of list) {
      const n = aeOrderToNorm(ctx.shop, o);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(body, ['total_record', 'totalRecord', 'total_results', 'totalResults', 'totalCount']));
    if (list.length < AE_PAGE_SIZE || out.length >= ctx.maxOrders || (total > 0 && page * AE_PAGE_SIZE >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`AliExpress 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 15：Temu（开放平台 OpenAPI · 半托管 local / 全托管 pop 同一套签名与响应结构）
//   凭据：app_key + app_secret + access_token（兼容 seller_account / session 字段名）
//   网关：https://openapi-b.temu.com/openapi/api（POST form；其它区用 creds.api_base 覆盖）
//   签名：小写 MD5(app_secret + 升序 key+value + app_secret)；业务参数 JSON.stringify 后作为 data 参与签名
//   接口：creds.api_type 选 temu.local.order.list（默认）/ temu.open.pop.order.list（全托管）
//   时间：平台只给 updatedAtStart/updatedAtEnd（epoch ms）+ pageSn/pageSize 翻页；
//         窗口至少回看 30 天以兜住状态回刷（重复单靠 externalId 幂等去重）
//   金额：Temu 金额字段单位为「分」→ ÷100；币种取 currency（缺失兜底 USD）
//   状态：官方数字码 1~5 为主，字符串状态名一并兜底
// ═══════════════════════════════════════════════════════════════════
const TEMU_API = 'https://openapi-b.temu.com/openapi/api';
const TEMU_PAGE_SIZE = 100;
const TEMU_RESCAN_MS = 30 * 86400_000;

const TEMU_STATUS_MAP: Record<string, string> = {
  '1': '待处理', '2': '待发货', '3': '已发货', '4': '已完成', '5': '已取消',
  '6': '已完成', '7': '已取消', '8': '售后中', '9': '售后中',
  'wait_pay': '待处理', 'unpaid': '待处理', 'wait_ship': '待发货', 'to_ship': '待发货',
  'shipped': '已发货', 'delivered': '已发货', 'completed': '已完成', 'confirmed': '已完成',
  'cancelled': '已取消', 'canceled': '已取消', 'returning': '售后中', 'refunded': '售后中',
  'after_sale': '售后中',
};
function mapTemuStatus(raw: unknown): string {
  return TEMU_STATUS_MAP[toStr(raw).toLowerCase()] ?? '待处理';
}
function temuConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('TEMU_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('TEMU_APP_SECRET'));
  const accessToken = firstStr(creds.access_token, creds.seller_account, creds.session, envOpt('TEMU_ACCESS_TOKEN'));
  if (!appKey || !appSecret) throw new Error('Temu 凭据不完整（缺 App Key / App Secret；App Secret 建议配置在环境变量 TEMU_APP_SECRET），请重新授权');
  if (!accessToken) throw new Error('Temu OAuth 流程尚未就绪：缺少 Access Token（卖家授权回跳后写入），请重新走 Temu 开放平台授权');
  return {
    appKey, appSecret, accessToken,
    apiBase: firstStr(creds.api_base, envOpt('TEMU_API_BASE'), TEMU_API),
    // 半托管走 local，全托管店铺在凭据里把 api_type 换成 pop 即可，主引擎零改动
    apiType: firstStr(creds.api_type, 'temu.local.order.list'),
    async call(biz: Record<string, unknown>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: this.appKey, type: this.apiType, timestamp: String(Math.floor(Date.now() / 1000)),
        access_token: this.accessToken, data: JSON.stringify(biz),
      };
      params.sign = await topSign(topConcat(params), this.appSecret, 'md5', false);
      const res = await fetchDirect(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
/** Temu 时间统一为 epoch ms（秒级自动放大），非数字再走 parseTime */
function temuTime(v: unknown): number | null {
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e11 ? n * 1000 : n;
  }
  return parseTime(v);
}
function temuAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address1 ?? a.detailAddress ?? a.street), toStr(a.address2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.province ?? a.state), toStr(a.countryName ?? a.country),
    toStr(a.zipCode ?? a.postCode ?? a.zip)].filter(Boolean).join(', ');
}
function temuOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.parentOrderSn, o.orderSn, o.orderId, o.parentOrderId);
  if (!platformId) return null;
  const externalId = `TEMU-${shop.id.slice(0, 8)}-${platformId}`;
  const skus: any[] = pickArr(o, ['orderSkus', 'orderItems', 'list', 'items', 'skuList']);
  const first: any = skus[0] ?? {};
  const createdMs = temuTime(o.createdTime ?? o.addTime ?? o.orderTime);
  const status = mapTemuStatus(o.status ?? o.orderStatus);
  // 金额单位为「分」→ ÷100；总价缺失时按行合计（都是平台真实字段）
  const totalCent = firstNum(o.orderAmount, o.payAmount, o.totalAmount, o.saleAmount);
  let amount = totalCent > 0 ? totalCent / 100 : 0;
  if (amount === 0) {
    for (const s of skus) amount += (firstNum(s.skuAmount, s.price, s.salePrice) / 100) * (toNum(s.count ?? s.quantity) || 1);
  }
  const recv = o.receiverInfo ?? o.addressInfo ?? o.receiver ?? o.orderReceiverVO ?? {};
  return {
    externalId,
    status,
    modifiedMs: temuTime(o.maxOrderUpdateTs ?? o.updateTime ?? o.updatedAt) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Temu'),
      buyer: firstStr(o.orderPersonName, recv.receiverName, o.buyerName),
      product: summaryProduct(toStr(first.skuName ?? first.subject ?? o.subjectName),
        toNum(first.count ?? first.quantity), skus.length || 1),
      sku: firstStr(first.skuSn, first.sellerSku, first.skuId),
      phone: firstStr(recv.receiverPhone, recv.phone, o.receiverPhone),   // 加密站点不下发真实号码 → 留空
      items: (skus.length > 0 ? skus : [o]).slice(0, 20).map((s) => ({
        name: toStr(s.skuName ?? s.subject),
        sku: toStr(s.skuSn ?? s.sellerSku ?? s.skuId),
        qty: toNum(s.count ?? s.quantity),
      })),
      amount: toAmount(amount),
      currency: toCurrency(o.currency, 'USD'),
      status,
      address: temuAddr(recv),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`Temu 状态 ${toStr(o.status ?? o.orderStatus) || '-'}`,
        toStr(o.parentOrderSn) && toStr(o.orderSn) ? `子单 ${toStr(o.orderSn)}` : '',
        firstStr(o.whType, o.logisticsType) ? `履约 ${firstStr(o.whType, o.logisticsType)}` : ''].filter(Boolean).join(' | '),
    },
  };
}
async function temuPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = temuConn(ctx.creds);
  // 更新时间窗口至少回看 30 天：即使水位已前进，也能兜住漏刷的状态变化（重复单靠 externalId 幂等）
  const fromMs = Math.min(ctx.sinceMs, ctx.untilMs - TEMU_RESCAN_MS);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let pageSn = 0; pageSn < MAX_PAGES; pageSn++) {
    const r = await cli.call({
      pageSn, pageSize: TEMU_PAGE_SIZE,
      updatedAtStart: Math.floor(fromMs), updatedAtEnd: Math.floor(ctx.untilMs),
    });
    // Temu 业务失败常在 HTTP 200 的 body 里（success=false / errorCode≠0）
    if (!r.ok || r.data?.success === false || (r.data?.errorCode !== undefined && toNum(r.data.errorCode) !== 0)) {
      throw new Error(`Temu 拉单失败：${topErr(r.data, r.status)}`);
    }
    const body = r.data?.result ?? r.data?.data ?? r.data ?? {};
    const found = pickArr(body, ['orders', 'order_list', 'list', 'dataList', 'orderList', 'result']);
    const rows = found.length > 0 ? found : deepArr(body);
    if (rows.length === 0) break;
    let pageMaxTs = 0;
    for (const o of rows) {
      pageMaxTs = Math.max(pageMaxTs, temuTime(o.maxOrderUpdateTs ?? o.updateTime ?? o.createdTime) ?? 0);
      if (seen.has(`TEMU-${ctx.shop.id.slice(0, 8)}-${firstStr(o.parentOrderSn, o.orderSn, o.orderId)}`)) continue;
      const n = temuOrderToNorm(ctx.shop, o);
      if (!n) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const totalPage = toNum(deepGet(body, ['totalPage', 'totalPages', 'pages', 'total_page']));
    if (rows.length < TEMU_PAGE_SIZE || out.length >= ctx.maxOrders
      || (totalPage > 0 && pageSn + 1 >= totalPage)
      || (pageMaxTs > 0 && pageMaxTs < ctx.sinceMs)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Temu 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 16：Yandex Market（Partner API · OAuth Bearer + business 订单列表）
//   凭据：oauth_token（authorize-shop 现用字段名，兼容 access_token/refresh_token）
//         business_id（兼容 client_id / seller_account）；缺失时用 /v2/businesses 真实取回并缓存 ctx.shared
//   接口：GET /v3/businesses/{business_id}/orders?page=&pageSize=&order=UPDATE_AT_DESC
//         —— 官方订单接口无 visibleSince/visibleTo 时间参数（该对参数属 deliveries 配送接口），
//            故按「更新时间倒序翻页 + 客户端窗口过滤 + 翻到早于水位即停」，语义等价且不漏状态变化
//   金额：平台以「戈比/最小货币单位」整数返回 → ÷100；币种取 currencyCode（兜底 RUB）
//   买家：Partner API 对买家姓名/电话做了脱敏（virtualPhone），不下发真实值 → 留空不编造
// ═══════════════════════════════════════════════════════════════════
const YM_API = 'https://api.partner.market.yandex.ru';
const YM_PAGE_SIZE = 50;

const YM_STATUS_MAP: Record<string, string> = {
  'PROCESSING': '待处理',
  'PENDING': '待处理',
  'CREATED': '待处理',
  'AWAITING_PACKAGING': '待发货',
  'PACKAGING': '待发货',
  'AWAITING_DELIVERY': '待发货',
  'DELIVERY_IN_PROGRESS': '已发货',
  'DELIVERY_STARTED': '已发货',
  'DELIVERING': '已发货',
  'DELIVERED': '已完成',
  'FINISHED': '已完成',
  'CANCELLED': '已取消',
  'CANCELED': '已取消',
  'RETURNED': '售后中',
  'RETURNING': '售后中',
  'REFUNDED': '售后中',
  'UNPACKED': '售后中',
};
function mapYmStatus(raw: unknown): string {
  return YM_STATUS_MAP[toStr(raw).toUpperCase().replace(/-/g, '_')] ?? '待处理';
}
function ymConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.oauth_token, creds.access_token, creds.refresh_token, creds.token, envOpt('YANDEX_OAUTH_TOKEN'));
  if (!token) throw new Error('Yandex Market 凭据不完整（缺 OAuth Token），请重新授权');
  return {
    token,
    businessId: firstStr(creds.business_id, creds.client_id, creds.seller_account, envOpt('YANDEX_BUSINESS_ID')),
    async get(pathAndQuery: string): Promise<PlatResp> {
      return await getJson(`${YM_API}${pathAndQuery}`, { Accept: 'application/json', Authorization: `Bearer ${token}` });
    },
  };
}
/** business_id：凭据优先，否则 /v2/businesses 真实取回并缓存（与 mlSellerId 同一套做法） */
async function ymBusinessId(cli: ReturnType<typeof ymConn>, ctx: FetchCtx): Promise<string> {
  if (cli.businessId) return cli.businessId;
  if (typeof ctx.shared.ymBusinessId === 'string') return ctx.shared.ymBusinessId;
  const r = await cli.get('/v2/businesses');
  const list: any[] = Array.isArray(r.data?.businesses) ? r.data.businesses : [];
  const id = firstStr(list[0]?.id);
  if (!r.ok || !id) throw new Error(`Yandex Market 无法确定 Business ID（/v2/businesses：${apiErr(r.data, r.status)}），请在凭据中补填 business_id`);
  ctx.shared.ymBusinessId = id;
  return id;
}
function ymAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.Street ?? a.street ?? a.address), toStr(a.House ?? a.house)].filter(Boolean).join(' ');
  return [street, toStr(a.City ?? a.city), toStr(a.Region ?? a.province), toStr(a.PostalCode ?? a.zip),
    toStr(a.Country ?? a.country)].filter(Boolean).join(', ');
}
function ymOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.id, o.integrationId, o.serial);
  if (!platformId) return null;
  const externalId = `YAMARKET-${shop.id.slice(0, 8)}-${platformId}`;
  const products: any[] = Array.isArray(o.products) ? o.products : pickArr(o, ['items']);
  const first: any = products[0] ?? {};
  const createdMs = parseTime(o.creationDate ?? o.createdAt);
  const status = mapYmStatus(o.status ?? o.substatus);
  // 戈比 → 元；总价缺失时按行合计
  const totalMinor = firstNum(o.totalPrice, o.price, o.amount);
  let amount = totalMinor > 0 ? totalMinor / 100 : 0;
  if (amount === 0) {
    for (const p of products) amount += (firstNum(p.price, p.amount, p.itemPrice) / 100) * (toNum(p.count ?? p.quantity) || 1);
  }
  const cust: any = o.customer ?? o.buyer ?? {};
  const deliv: any = o.delivery ?? {};
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updateShipDate ?? o.updatedAt ?? o.changeStatus) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Yandex Market'),
      buyer: firstStr(o.clientName, cust.name, [toStr(cust.firstName), toStr(cust.lastName)].filter(Boolean).join(' '), deliv.receiver),
      product: summaryProduct(toStr(first.name ?? first.offeringId), toNum(first.count ?? first.quantity), products.length || 1),
      sku: firstStr(first.sku ?? first.sellerSku, first.offeringId, first.offerId),
      phone: firstStr(cust.phone, deliv.phone),   // 脱敏站点只给 virtualPhone → 留空
      items: (products.length > 0 ? products : []).slice(0, 20).map((p) => ({
        name: toStr(p.name ?? p.offeringId),
        sku: toStr(p.sku ?? p.offeringId),
        qty: toNum(p.count ?? p.quantity),
      })),
      amount: toAmount(amount),
      currency: toCurrency(o.currencyCode ?? first.currencyCode, 'RUB'),
      status,
      address: ymAddr(deliv.address ?? cust.address ?? deliv),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`YM 状态 ${toStr(o.status) || '-'}`, toStr(o.substatus) ? `子状态 ${toStr(o.substatus)}` : '',
        firstStr(deliv.method?.name, deliv.code) ? `配送 ${firstStr(deliv.method?.name, deliv.code)}` : ''].filter(Boolean).join(' | '),
    },
  };
}
async function ymPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = ymConn(ctx.creds);
  const biz = await ymBusinessId(cli, ctx);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(YM_PAGE_SIZE), order: 'UPDATE_AT_DESC' });
    const r = await cli.get(`/v3/businesses/${encodeURIComponent(biz)}/orders?${qs.toString()}`);
    if (!r.ok) {
      // 深翻页/跨度上限是平台硬限制 → 截断并给出可操作告警，其余错误照常抛出
      if ((r.status === 400 || r.status === 422) && /page|offset|deep|too (large|many|big)|interval/i.test(apiErr(r.data, r.status))) {
        ctx.warn(`Yandex Market 到达平台分页上限，本次取 ${out.length} 单（更早历史单请手工补拉）：${apiErr(r.data, r.status)}`);
        break;
      }
      throw new Error(`Yandex Market 拉单失败：${apiErr(r.data, r.status)}`);
    }
    const rows: any[] = Array.isArray(r.data?.orders) ? r.data.orders : (Array.isArray(r.data?.result?.orders) ? r.data.result.orders : []);
    if (rows.length === 0) break;
    let pageMaxTs = 0;
    for (const o of rows) {
      const changedMs = parseTime(o.updateShipDate ?? o.updatedAt ?? o.changeStatus) ?? parseTime(o.creationDate) ?? 0;
      pageMaxTs = Math.max(pageMaxTs, changedMs);
      const createdMs = parseTime(o.creationDate ?? o.createdAt) ?? 0;
      // 窗口过滤：创建时间或最后变更时间落在 [sinceMs, untilMs] 内才入库
      if (createdMs > ctx.untilMs || (changedMs && changedMs > ctx.untilMs)) continue;
      if (ctx.sinceMs > 0 && createdMs && changedMs && changedMs < ctx.sinceMs && createdMs < ctx.sinceMs) continue;
      const n = ymOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const totalPage = toNum(r.data?.pager?.totalPages ?? r.data?.totalPages ?? r.data?.pageCount);
    if (rows.length < YM_PAGE_SIZE || out.length >= ctx.maxOrders
      || (totalPage > 0 && page >= totalPage)
      || (pageMaxTs > 0 && pageMaxTs < ctx.sinceMs)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Yandex Market 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}


// ═══════════════════════════════════════════════════════════════════
// 适配器 17：Amazon SP-API（Orders v0 · LWA OAuth2 · 一个适配器覆盖全站）
//   凭据：client_id + client_secret + refresh_token —— platform_auth_config 已给
//         Amazon US/EU/JP/CA/AU 五站配好这三个字段（Seller Central 应用的
//         「LWA Client Identifier / Client Secret」+ 卖家授权后拿到的 Refresh Token）
//   令牌：POST https://api.amazon.com/auth/o2/token（grant_type=refresh_token）
//         → access_token 有效期约 1 小时，按 expires_in 缓存进 ctx.shared，单次同步内多页复用
//         （与 ebayBearer 同一套做法）
//   网关：按站点归属三区之一 —— na / eu / fe（sellingpartnerapi-{区}.amazon.com）
//   站点：marketplaceId 用官方 Store Identifiers 表（2026 现行值），可用凭据 marketplace_id 覆盖
//         US ATVPDKIKX0DER / CA A2EUQ1WTGCTBG2 / DE A1PA6795UKMFR9 / FR A13V1IB3VIYZZH /
//         ES A1RKKUPIHCS9HS / IT APJ6JRA9NG5V4 / UK A1F83G8C2ARO7P / JP A1VC38T7YXB528 /
//         AU A39IBJ37TRP1C6（官方归 Far East 区，不在 NA 网关）
//   拉单：GET /orders/v0/orders?MarketplaceIds=…&LastUpdatedAfter=ISO&MaxResultsPerPage=100[&NextToken=…]
//         · 水位是「修改时间」语义 → 默认 LastUpdatedAfter 才能刷到状态变化（与 Shopee/Lazada 同考量）；
//           凭据 date_field=created 可切回 CreatedAfter（只发现新单）
//         · NextToken 翻页要求其余参数与首次请求完全一致，故参数表只拼一次
//   PII：2022 起买家姓名/邮箱/地址须 Restricted Data Token(RDT)。未挂 RDT 时平台不下发
//         BuyerName/BuyerEmail/ShippingAddress → 如实留空，绝不编造
//   限流：getOrders 0.0167 rps / 突发 15 → 单次同步最多 MAX_PAGES 页，达上限告警下次续拉
// ═══════════════════════════════════════════════════════════════════
const AMZ_LWA_TOKEN = 'https://api.amazon.com/auth/o2/token';
const AMZ_PAGE_SIZE = 100;
const AMZ_REGION_HOST: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};
/** 官方 Store Identifiers：国家码 → { marketplaceId, 所属销售区域 } */
const AMZ_MARKETPLACES: Record<string, { id: string; region: string }> = {
  us: { id: 'ATVPDKIKX0DER', region: 'na' },
  ca: { id: 'A2EUQ1WTGCTBG2', region: 'na' },
  mx: { id: 'A1AM78C64UM0Y8', region: 'na' },
  br: { id: 'A2Q3Y263D00KWC', region: 'na' },
  uk: { id: 'A1F83G8C2ARO7P', region: 'eu' },
  de: { id: 'A1PA6795UKMFR9', region: 'eu' },
  fr: { id: 'A13V1IB3VIYZZH', region: 'eu' },
  es: { id: 'A1RKKUPIHCS9HS', region: 'eu' },
  it: { id: 'APJ6JRA9NG5V4', region: 'eu' },
  nl: { id: 'A1805IZSGTT6HS', region: 'eu' },
  be: { id: 'AMEN7PMS3EDWL', region: 'eu' },
  ie: { id: 'A28R8C7NBKEWEA', region: 'eu' },
  se: { id: 'A2NODRKZP88ZB9', region: 'eu' },
  pl: { id: 'A1C3SOZRARQ6R3', region: 'eu' },
  tr: { id: 'A33AVAJ2PDY3EV', region: 'eu' },
  ae: { id: 'A2VIGQ35RCS4UG', region: 'eu' },
  eg: { id: 'ARBP9OOSHTCHU', region: 'eu' },
  sa: { id: 'A17E79C6D8DWNP', region: 'eu' },
  in: { id: 'A21TJRUUN4KGV', region: 'eu' },
  za: { id: 'AE08WJ6YKNBMC', region: 'eu' },
  jp: { id: 'A1VC38T7YXB528', region: 'fe' },
  au: { id: 'A39IBJ37TRP1C6', region: 'fe' },
  sg: { id: 'A19VAU5U5O7RUS', region: 'fe' },
};
/** 合并账号站点（platform_auth_config 的 'Amazon EU'/'Amazon CA'…）：一次调用可传同区多个 marketplaceId */
const AMZ_CC_GROUPS: Record<string, string[]> = {
  eu: ['uk', 'de', 'fr', 'es', 'it'],
  na: ['us', 'ca', 'mx', 'br'],
  fe: ['jp', 'au', 'sg'],
};
const AMZ_CC_ALIAS: Record<string, string> = {
  'united states': 'us', usa: 'us', america: 'us', '美国': 'us',
  canada: 'ca', '加拿大': 'ca', mexico: 'mx', '墨西哥': 'mx', brazil: 'br', '巴西': 'br',
  'united kingdom': 'uk', england: 'uk', britain: 'uk', '英国': 'uk',
  germany: 'de', deutschland: 'de', '德国': 'de',
  france: 'fr', '法国': 'fr', spain: 'es', '西班牙': 'es', italy: 'it', '意大利': 'it',
  netherlands: 'nl', '荷兰': 'nl', belgium: 'be', ireland: 'ie', sweden: 'se', poland: 'pl',
  turkey: 'tr', uae: 'ae', emirates: 'ae', egypt: 'eg', saudi: 'sa', india: 'in',
  japan: 'jp', '日本': 'jp', australia: 'au', '澳大利亚': 'au', '澳洲': 'au', singapore: 'sg',
};
const AMZ_STATUS_MAP: Record<string, string> = {
  'pending': '待处理',
  'unshipped': '待发货',
  'partiallyshipped': '已发货',
  'shipped': '已发货',
  'invoicepending': '已发货',
  'invoiceunconfirmed': '待审核',
  'canceled': '已取消',
  'cancelled': '已取消',
  'unfulfillable': '售后中',
};
function mapAmzStatus(raw: unknown): string {
  return AMZ_STATUS_MAP[toStr(raw).toLowerCase().replace(/[^a-z]/g, '')] ?? '待处理';
}
/**
 * 站点判定：凭据 marketplace_id(s) 原样透传（官方 13 位 ID）> 国家名/国家码 token >
 * 合并区（eu/na/fe，同区多站一次请求）> 兜底美国站
 */
function amzMarketplace(creds: Record<string, unknown>, shop: SyncShop): { ids: string[]; region: string } {
  const direct = firstStr(creds.marketplace_id, creds.marketplace_ids, creds.marketplaceId)
    .split(',').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9]{10,16}$/.test(s));
  if (direct.length > 0) {
    const hit = Object.values(AMZ_MARKETPLACES).find((m) => m.id === direct[0]);
    const rg = firstStr(creds.region).toLowerCase();
    return { ids: direct, region: AMZ_REGION_HOST[rg] ? rg : (hit?.region ?? 'eu') };
  }
  // 只扫平台名与显式区域字段，不扫店铺名（避免店铺名里的常见词误命中二字母国家码）
  const hay = `${toStr(shop.platform)} ${firstStr(creds.region, creds.site, creds.country, creds.marketplace)}`.toLowerCase();
  const aliasKeys = Object.keys(AMZ_CC_ALIAS).sort((a, b) => b.length - a.length);
  for (const k of aliasKeys) if (hay.includes(k)) return { ids: [AMZ_MARKETPLACES[AMZ_CC_ALIAS[k]].id], region: AMZ_MARKETPLACES[AMZ_CC_ALIAS[k]].region };
  for (const cc of Object.keys(AMZ_MARKETPLACES)) {
    if (new RegExp(`(^|[^a-z])${cc}([^a-z]|$)`).test(hay)) return { ids: [AMZ_MARKETPLACES[cc].id], region: AMZ_MARKETPLACES[cc].region };
  }
  for (const g of Object.keys(AMZ_CC_GROUPS)) {
    if (new RegExp(`(^|[^a-z])${g}([^a-z]|$)`).test(hay) || (g === 'eu' && /europe|欧洲/.test(hay)) || (g === 'na' && /north[- ]?america|北美/.test(hay))) {
      return { ids: AMZ_CC_GROUPS[g].map((c) => AMZ_MARKETPLACES[c].id), region: g };
    }
  }
  return { ids: [AMZ_MARKETPLACES.us.id], region: 'na' };
}
function amzConn(creds: Record<string, unknown>) {
  const clientId = firstStr(creds.client_id, creds.app_id, envOpt('AMAZON_CLIENT_ID'));
  const clientSecret = firstStr(creds.client_secret, creds.app_secret, envOpt('AMAZON_CLIENT_SECRET'));
  const refreshToken = firstStr(creds.refresh_token, envOpt('AMAZON_REFRESH_TOKEN'));
  if (!clientId || !clientSecret) throw new Error('Amazon 凭据不完整（缺 LWA Client ID / Client Secret），请在「店铺授权」重新填写');
  if (!refreshToken) throw new Error('Amazon OAuth 流程尚未就绪：缺少卖家 Refresh Token，需在 Seller Central 完成 SP-API 应用授权后回写凭据');
  return {
    clientId, clientSecret, refreshToken,
    lwaUrl: firstStr(creds.lwa_url, envOpt('AMAZON_LWA_URL'), AMZ_LWA_TOKEN),
  };
}
/** LWA 访问令牌：refresh_token 换 access_token（约 1h），单次同步内缓存复用 */
async function amzBearer(ctx: FetchCtx, cli: ReturnType<typeof amzConn>): Promise<string> {
  const cached = ctx.shared.amzBearer as { token: string; expMs: number } | undefined;
  if (cached?.token && cached.expMs > Date.now() + 60_000) return cached.token;
  const res = await fetchDirect(cli.lwaUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: cli.refreshToken,
      client_id: cli.clientId, client_secret: cli.clientSecret,
    }).toString(),
  });
  const text = await res.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  const token = toStr(d?.access_token);
  if (!res.ok || !token) {
    throw new Error(`Amazon LWA 取令牌失败：${apiErr(d, res.status)}（refresh_token 失效需在 Seller Central 重新授权本应用）`);
  }
  const ttl = toNum(d.expires_in) || 3600;
  ctx.shared.amzBearer = { token, expMs: Date.now() + Math.max(60, ttl - 300) * 1000 };
  return token;
}
function amzAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  return [toStr(a.AddressLine1), toStr(a.AddressLine2), toStr(a.AddressLine3), toStr(a.City),
    toStr(a.StateOrRegion), toStr(a.PostalCode), toStr(a.CountryCode)].filter(Boolean).join(', ');
}
function amzOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.AmazonOrderId, o.AmazonOrderID, o.amazonOrderId);
  if (!platformId) return null;
  const externalId = `AMZ-${shop.id.slice(0, 8)}-${platformId}`;
  // getOrders 列表本身不含商品行（须再调 getOrderItems）；平台/凭据带回时照用，否则留空不编造
  const rawItems = o.OrderItems ?? o.orderItems ?? o.Items ?? [];
  const items: any[] = Array.isArray(rawItems) ? rawItems
    : Array.isArray(rawItems?.OrderItem) ? rawItems.OrderItem : [];
  const first: any = items[0] ?? {};
  const total = (o.OrderTotal ?? o.orderTotal ?? {}) as Record<string, any>;
  const createdMs = parseTime(o.PurchaseDate ?? o.purchaseDate);
  const status = mapAmzStatus(o.OrderStatus ?? o.orderStatus);
  const mpId = toStr(o.MarketplaceId ?? o.marketplaceId);
  const shipAddr = (o.ShippingAddress ?? o.shippingAddress) as Record<string, any> | undefined;
  const shipPrice = (o.ShippingPrice ?? {}) as Record<string, any>;
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.LastUpdateDate ?? o.lastUpdateDate) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Amazon'),
      // 未挂 RDT 时 BuyerName/BuyerEmail 平台直接不下发 → 留空
      buyer: firstStr(o.BuyerName, (o.BuyerName as any)?.Name, o.buyerName, o.BuyerEmail, o.buyerEmail),
      product: summaryProduct(toStr(first.Title ?? first.title ?? first.Name), toNum(first.Quantity ?? first.quantity), items.length),
      sku: firstStr(first.SellerSKU, first.sellerSKU, first.seller_sku, first.ASIN, first.asin),
      phone: firstStr(shipAddr?.Phone, shipAddr?.phone),
      items: items.slice(0, 20).map((it) => ({
        name: toStr(it.Title ?? it.title ?? it.Name),
        sku: toStr(it.SellerSKU ?? it.sellerSKU ?? it.ASIN ?? it.asin),
        qty: toNum(it.Quantity ?? it.quantity),
      })),
      amount: toAmount(firstNum(total.Amount, total.amount, o.OrderTotal, o.purchaseOrderTotal?.Total?.Amount)
        + (toNum(shipPrice.Amount) || 0)),
      currency: toCurrency(total.CurrencyCode ?? o.CurrencyCode, 'USD'),
      status,
      address: amzAddr(shipAddr),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [
        `Amazon 状态 ${toStr(o.OrderStatus) || '-'}`,
        toStr(o.FulfillmentChannel) ? `履约 ${toStr(o.FulfillmentChannel)}` : '',
        mpId ? `站点 ${mpId}` : '',
        toStr(o.ShippingServiceLevel) ? `配送 ${toStr(o.ShippingServiceLevel)}` : '',
      ].filter(Boolean).join(' | '),
    },
  };
}
async function amzPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = amzConn(ctx.creds);
  const token = await amzBearer(ctx, cli);
  const mp = amzMarketplace(ctx.creds, ctx.shop);
  const base = firstStr(ctx.creds.api_base, AMZ_REGION_HOST[mp.region]).replace(/\/+$/, '');
  const dateField = toStr(ctx.creds.date_field).toLowerCase() === 'created' ? 'CreatedAfter' : 'LastUpdatedAfter';
  // 翻页期间参数必须完全一致（NextToken 由平台编码其余条件）
  const params: Record<string, string> = {
    MarketplaceIds: mp.ids.join(','),
    MaxResultsPerPage: String(AMZ_PAGE_SIZE),
    [dateField]: new Date(ctx.sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };
  const headers = { 'x-amz-access-token': token, 'Content-Type': 'application/json' };
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  let next = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams(params);
    if (next) qs.set('NextToken', next);
    const r = await getJson(`${base}/orders/v0/orders?${qs.toString()}`, headers);
    if (!r.ok) throw new Error(`Amazon SP-API 拉单失败（${mp.ids.join('/') || mp.region}）：${apiErr(r.data, r.status)}`);
    const payload = r.data?.payload ?? r.data ?? {};
    const rows: any[] = Array.isArray(payload.Orders) ? payload.Orders
      : Array.isArray(payload.Order) ? payload.Order : pickArr(payload, ['Orders', 'Order', 'orders']);
    for (const o of rows) {
      const n = amzOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    next = toStr(payload.NextToken ?? deepGet(r.data, ['NextToken']));
    if (!next || rows.length === 0 || out.length >= ctx.maxOrders) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Amazon 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 18：SHEIN（开放平台 Open API · MD5 大写签名）
//   凭据：app_key + app_secret（可用 open_key_id / open_secret_key 字段名，或环境变量
//         SHEIN_APP_KEY / SHEIN_APP_SECRET —— platform_auth_config 的 SHEIN 未配 cred_fields，
//         故应用级密钥走环境变量注入，卖家级 access_token 走凭据回填）
//   签名：MD5(app_secret + 升序 key+value 拼接 + app_secret) 取大写 HEX —— 与 Lazada/AE 同一
//         topSign(topConcat(...))，无 sign/空值不参与拼接
//   接口：POST {base}/  表单参数 method=getOrderList + app_key + timestamp(毫秒) + sign [+ access_token]
//         业务参数 startTime/endTime(毫秒)/pageNo/pageSize 同表单一并提交（平台把它们一并纳入签名域）
//   区域：全球站 openapi.sheincorp.com；NA 专站 na.sheincorp.com；用凭据 api_base 覆盖
//   状态：平台给数字码 1..5
//   OAuth：SHEIN 卖家授权回调尚未接通（拿不到 access_token 时硬失败，不静默返回空）
// ═══════════════════════════════════════════════════════════════════
const SHEIN_API = 'https://openapi.sheincorp.com';
const SHEIN_PAGE_SIZE = 100;

const SHEIN_STATUS_MAP: Record<string, string> = {
  '1': '待处理',
  '2': '待发货',
  '3': '已发货',
  '4': '已完成',
  '5': '已取消',
  '6': '售后中',
  'pending': '待处理',
  'to_be_shipped': '待发货',
  'shipped': '已发货',
  'completed': '已完成',
  'cancelled': '已取消',
  'canceled': '已取消',
  'refunded': '售后中',
  'returned': '售后中',
};
function mapSheinStatus(raw: unknown): string {
  const k = toStr(raw).toLowerCase();
  return SHEIN_STATUS_MAP[k] ?? SHEIN_STATUS_MAP[k.replace(/[^a-z0-9_]/g, '')] ?? '待处理';
}
function sheinConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, creds.open_key_id, creds.client_id, envOpt('SHEIN_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, creds.open_secret_key, creds.client_secret, envOpt('SHEIN_APP_SECRET'));
  const accessToken = firstStr(creds.access_token, creds.session, creds.token);
  if (!appKey || !appSecret) throw new Error('SHEIN 凭据不完整（缺 App Key / App Secret；应用级密钥建议配置在环境变量 SHEIN_APP_KEY / SHEIN_APP_SECRET），请重新授权');
  if (!accessToken) throw new Error('SHEIN OAuth 流程尚未就绪：缺少卖家 Access Token，需完成 SHEIN 开放平台授权回调后回写凭据');
  return {
    appKey, appSecret, accessToken,
    apiBase: firstStr(creds.api_base, envOpt('SHEIN_API_BASE'), SHEIN_API).replace(/\/+$/, ''),
    method: firstStr(creds.api_method, 'getOrderList'),
    async call(biz: Record<string, string>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: appKey, method: this.method, format: 'json', v: '2.0',
        timestamp: String(Date.now()), access_token: accessToken, ...biz,
      };
      params.sign = await topSign(topConcat(params), appSecret, 'md5', true);
      const res = await fetchDirect(`${this.apiBase}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
/** SHEIN 时间为毫秒时间戳，也兼容 ISO / "yyyy-MM-dd HH:mm:ss" */
function sheinTime(v: unknown): number | null {
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{10,13}$/.test(v.trim()))) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e11 ? n * 1000 : n;
  }
  return parseTime(v);
}
function sheinAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address1 ?? a.street ?? a.address), toStr(a.address2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.state ?? a.province), toStr(a.country ?? a.countryName),
    toStr(a.zipCode ?? a.postCode ?? a.zip)].filter(Boolean).join(', ');
}
function sheinOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.orderSn, o.order_id, o.orderId, o.id);
  if (!platformId) return null;
  const externalId = `SHEIN-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = pickArr(o, ['orderItemList', 'orderItems', 'items', 'skuList', 'goodsList', 'productList']);
  const first: any = items[0] ?? {};
  const createdMs = sheinTime(o.createTime ?? o.createdTime ?? o.orderTime ?? o.startTime);
  const status = mapSheinStatus(o.orderStatus ?? o.status ?? o.state);
  const ship = o.shippingAddress ?? o.receiverInfo ?? o.deliveryAddress ?? o.address ?? {};
  const pay = o.orderAmount ?? o.payAmount ?? o.paymentAmount ?? o.totalAmount ?? o.amount;
  return {
    externalId,
    status,
    modifiedMs: sheinTime(o.updateTime ?? o.updatedTime ?? o.lastUpdateTime) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'SHEIN'),
      buyer: firstStr(o.customerName, o.buyerName, ship.receiverName, ship.name, o.xidBuyer),
      product: summaryProduct(toStr(first.skuName ?? first.name ?? first.goodsName), toNum(first.quantity ?? first.qty ?? first.skuNum), items.length || 1),
      sku: firstStr(first.sellerSku, first.skuId, first.sku, first.goodsSku, o.sellerSku),
      phone: firstStr(ship.phone, ship.mobile, o.buyerPhone, o.customerPhone),
      items: (items.length > 0 ? items : [o]).slice(0, 20).map((it) => ({
        name: toStr(it.skuName ?? it.name ?? it.goodsName),
        sku: toStr(it.sellerSku ?? it.skuId ?? it.sku ?? it.goodsSku),
        qty: toNum(it.quantity ?? it.qty ?? it.skuNum),
      })),
      amount: toAmount(firstNum(pay, first.price)),
      currency: toCurrency(o.currency ?? o.currencyCode ?? ship.currency, 'USD'),
      status,
      address: sheinAddr(ship),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `SHEIN 状态 ${toStr(o.orderStatus ?? o.status ?? o.state) || '-'}`,
    },
  };
}
async function sheinPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = sheinConn(ctx.creds);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await cli.call({
      startTime: String(ctx.sinceMs), endTime: String(ctx.untilMs),
      pageNo: String(page), pageSize: String(SHEIN_PAGE_SIZE),
    });
    // SHEIN 业务失败常在 HTTP 200 的 body（code / result / success 三套字段名都兜）
    const bizFail = r.data?.code !== undefined && toNum(r.data.code) !== 0 && toNum(r.data.code) !== 200;
    if (!r.ok || r.data?.success === false || bizFail) throw new Error(`SHEIN 拉单失败：${topErr(r.data, r.status)}`);
    const body = r.data?.data ?? r.data?.result ?? r.data ?? {};
    const rows = pickArr(body, ['orderList', 'orders', 'list', 'result', 'dataList', 'records']) ;
    const list = rows.length > 0 ? rows : deepArr(body);
    if (list.length === 0) break;
    for (const o of list) {
      const n = sheinOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const totalPage = toNum(deepGet(body, ['totalPage', 'totalPages', 'pages', 'pageCount']));
    if (list.length < SHEIN_PAGE_SIZE || out.length >= ctx.maxOrders || (totalPage > 0 && page >= totalPage)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`SHEIN 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 19：Daraz（Global Open Platform / iop —— 与 Lazada 同一套 TOP 签名）
//   凭据：app_key + app_secret + seller_account（iop 协议里 session/access_token 即卖家授权令牌）
//   网关：默认 https://api.daraz.com/rest（iop 统一入口）；分国网关用凭据 api_base 覆盖
//         PK api.daraz.pk/rest · BD api.daraz.com.bd/rest · LK api.daraz.lk/rest
//         NP api.daraz.com.np/rest · MM api.daraz.com.mm/rest · VN api.daraz.vn/rest
//   签名：MD5(app_secret + 升序 key+value + app_secret) 大写；公共参数 app_key/sign_method/
//         timestamp/format/v/method/session
//   方法：queryOrders（created_after / created_before ISO + offset / limit）
//   跨境卖家一个 token 覆盖 5 国站点（官方说明），故不做国家过滤，站点由 api_base 决定
//   OAuth：卖家 session 未回填时硬失败（不静默返回空）
// ═══════════════════════════════════════════════════════════════════
const DARAZ_API = 'https://api.daraz.com/rest';
const DARAZ_PAGE_SIZE = 100;
const DARAZ_RESCAN_MS = 30 * 86400_000;   // 创建时间口径 → 每次重扫近 30 天回刷状态

const DARAZ_STATUS_MAP: Record<string, string> = {
  'pending': '待处理',
  'packing': '待发货',
  'partially_packed': '待发货',
  'ready_to_ship': '待发货',
  'ready_to_ship_pending': '待发货',
  'shipped': '已发货',
  'delivered': '已完成',
  'confirmed': '已完成',
  'completed': '已完成',
  'canceled': '已取消',
  'cancelled': '已取消',
  'returned': '售后中',
  'delivered_returned': '售后中',
  'lost': '售后中',
  'damaged_by_3pl': '售后中',
  'returned_clawback': '售后中',
};
function mapDarazStatus(raw: unknown): string {
  return DARAZ_STATUS_MAP[toStr(raw).toLowerCase().replace(/-/g, '_')] ?? '待处理';
}
function darazConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('DARAZ_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('DARAZ_APP_SECRET'));
  const session = firstStr(creds.access_token, creds.session, creds.seller_account, envOpt('DARAZ_SESSION'));
  if (!appKey || !appSecret) throw new Error('Daraz 凭据不完整（缺 App Key / App Secret；App Secret 建议配置在环境变量 DARAZ_APP_SECRET），请重新授权');
  if (!session) throw new Error('Daraz OAuth 流程尚未就绪：缺少卖家 Access Token（session），需在 Daraz Global Open Platform 完成卖家授权后回写凭据');
  const apiBase = firstStr(creds.api_base, envOpt('DARAZ_API_BASE'), DARAZ_API).replace(/\/+$/, '');
  return {
    appKey, appSecret, session, apiBase,
    method: firstStr(creds.api_method, 'queryOrders'),
    signMethod: firstStr(creds.sign_method, 'md5').toLowerCase(),
    currency: toCurrency(creds.currency, ''),
    async call(biz: Record<string, string>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: appKey, sign_method: this.signMethod, format: 'json', v: '2.0',
        timestamp: topTimestamp(Date.now()), method: this.method,
        ...biz, session: this.session,
      };
      params.sign = await topSign(topConcat(params), appSecret, this.signMethod === 'sha256' ? 'sha256' : 'md5', true);
      const res = await fetchDirect(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
/** 站点域名 → 币种（真实映射，与 lazadaCurrencyOf 同一手法） */
function darazCurrencyOf(cli: ReturnType<typeof darazConn>): string {
  if (cli.currency) return cli.currency;
  const m = /daraz(?:\.com)?\.(pk|bd|lk|np|mm|vn)\//i.exec(`${cli.apiBase}/`);
  const cc = (m?.[1] ?? '').toLowerCase();
  return { pk: 'PKR', bd: 'BDT', lk: 'LKR', np: 'NPR', mm: 'MMK', vn: 'VND' }[cc] ?? '';
}
function darazAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address1 ?? a.address), toStr(a.address2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.state), toStr(a.country), toStr(a.postcode ?? a.zip)].filter(Boolean).join(', ');
}
/** iop 为行级返回（order_items）→ 按 orders_id 折叠成一单 */
function darazGroupToNorm(shop: SyncShop, orderId: string, rows: any[], cli: ReturnType<typeof darazConn>): NormOrder | null {
  if (!orderId) return null;
  const externalId = `DARAZ-${shop.id.slice(0, 8)}-${orderId}`;
  const first: any = rows[0] ?? {};
  const createdMs = parseTime(first.created_at ?? first.createdAt ?? first.create_date);
  const rawStatus = firstStr(first.status, first.order_status, rows.map((r: any) => r?.status).filter(Boolean).sort()[0]);
  const status = mapDarazStatus(rawStatus);
  let amount = 0;
  let qty = 0;
  for (const r of rows) { amount += firstNum(r.paid_price, r.price) * (toNum(r.quantity) || 1); qty += toNum(r.quantity) || 1; }
  const addrSrc = first.shipping_address ?? first.address ?? first;
  return {
    externalId,
    status,
    modifiedMs: parseTime(first.updated_at ?? first.modified_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Daraz'),
      buyer: firstStr(first.customer_name, first.buyer_name, addrSrc.name),   // 隐私限制常不下发姓名 → 留空
      product: summaryProduct(toStr(first.name ?? first.item_name), qty, rows.length),
      sku: firstStr(first.sku_seller ?? first.seller_sku ?? first.sku_id, first.sku),
      phone: firstStr(first.phone, addrSrc.phone, addrSrc.phone_number),
      items: rows.slice(0, 20).map((r) => ({
        name: toStr(r.name ?? r.item_name),
        sku: toStr(r.sku_seller ?? r.seller_sku ?? r.sku_id ?? r.sku),
        qty: toNum(r.quantity),
      })),
      amount: toAmount(amount),
      currency: toCurrency(first.currency, darazCurrencyOf(cli)),
      status,
      address: darazAddr(addrSrc),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `Daraz 状态 ${rawStatus || '-'} | 行 ${rows.length}`,
    },
  };
}
async function darazPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = darazConn(ctx.creds);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  // 平台按创建时间过滤 → 状态回刷靠重扫近 30 天，幂等由 externalId 保证（同 Lazada 做法）
  const fromMs = Math.min(ctx.sinceMs, ctx.untilMs - DARAZ_RESCAN_MS);
  const out: NormOrder[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * DARAZ_PAGE_SIZE;
    const r = await cli.call({
      created_after: iso(fromMs), created_before: iso(ctx.untilMs),
      limit: String(DARAZ_PAGE_SIZE), offset: String(offset),
    });
    if (!r.ok || r.data?.error_response) throw new Error(`Daraz 拉单失败：${topErr(r.data, r.status)}`);
    const body = r.data?.result ?? r.data?.orders_get_response ?? r.data ?? {};
    const flat: any[] = Array.isArray(body.order_items) ? body.order_items : pickArr(body, ['order_items', 'orderItems']);
    const nested: any[] = Array.isArray(body.orders) ? body.orders : pickArr(body, ['orders', 'dataList']);
    const groups = new Map<string, any[]>();
    const push = (k: string, v: any) => { const a = groups.get(k) ?? []; a.push(v); groups.set(k, a); };
    for (const it of flat) push(firstStr(it.order_id ?? it.orders_id ?? it.trade_order_id), it);
    for (const o of nested) {
      const oid = firstStr(o.order_id ?? o.orders_id ?? o.id);
      const items = Array.isArray(o.order_items) && o.order_items.length > 0 ? o.order_items : [o];
      for (const it of items) push(oid, { ...o, ...it });
    }
    if (groups.size === 0) break;
    for (const [oid, rows] of groups) {
      const n = darazGroupToNorm(ctx.shop, oid, rows, cli);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(body, ['total_count', 'totalCount', 'count', 'total']))
      || (Array.isArray(body.totalResults) ? 0 : toNum(body.totalResults));
    const pageCount = flat.length + nested.length;
    if (pageCount < DARAZ_PAGE_SIZE || out.length >= ctx.maxOrders || (total > 0 && offset + pageCount >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Daraz 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 20：Noon（Marketplace API · OAuth Bearer + project_code）
//   凭据：app_key + app_secret + seller_account（作为 project_code）+ access_token
//         Noon 卖家取令牌要走 App Key/Secret + 邮箱 OTP 挑战，ERP 侧无稳定服务端换取路径
//         → access_token 未回填时硬失败（绝不静默返回空）
//   接口：GET {base}/orders?project_code=&date_from=&date_to=&page=&page_size=50
//         头：Authorization: Bearer · 部分部署还要求 projectcode 头，凭据 project_code 存在时一并带上
//   响应：{ results: [...], pagination: { total, page, pagesize } }（集合键 results，行内 barcode 为主单号）
//   结构：Noon 是「行级」订单——同一 ps_order_id 下多条 barcode 行，按 ps_order_id 折叠成一单
//   时间：date_from / date_to 为 ISO 日期串（平台按当地日期过滤，闭区间）
//   买家：平台对手机号/姓名脱敏（部分站点整段不下发）→ 缺失留空，不编造
// ═══════════════════════════════════════════════════════════════════
const NOON_API = 'https://noon-marketplace-api.noonpayments.com/api/v1';
const NOON_PAGE_SIZE = 50;

const NOON_STATUS_MAP: Record<string, string> = {
  'pending': '待处理',
  'created': '待处理',
  'new': '待处理',
  'declined': '已取消',
  'canceled': '已取消',
  'cancelled': '已取消',
  'ready_to_ship': '待发货',
  'in_transit': '已发货',
  'out_of_delivery': '已发货',
  'out_for_delivery': '已发货',
  'shipped': '已发货',
  'delivered': '已完成',
  'returned': '售后中',
  'return_initiated': '售后中',
  'return_closed': '售后中',
  'cancelled_and_refunded': '已取消',
};
function mapNoonStatus(raw: unknown): string {
  return NOON_STATUS_MAP[toStr(raw).toLowerCase().replace(/-/g, '_')] ?? '待处理';
}
function noonConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('NOON_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('NOON_APP_SECRET'));
  const token = firstStr(creds.access_token, creds.token, creds.api_key);
  if (!appKey || !appSecret) throw new Error('Noon 凭据不完整（缺 App Key / App Secret），请重新授权');
  if (!token) throw new Error('Noon OAuth 流程尚未就绪：缺少 Access Token（Noon 需 App Key/Secret + 邮箱 OTP 换取令牌），需接通授权回调后重新授权');
  return {
    appKey, appSecret, token,
    projectCode: firstStr(creds.project_code, creds.seller_account, creds.seller_id),
    apiBase: firstStr(creds.api_base, envOpt('NOON_API_BASE'), NOON_API).replace(/\/+$/, ''),
    async get(pathAndQuery: string): Promise<PlatResp> {
      const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
      if (this.projectCode) headers.projectcode = this.projectCode;
      return await getJson(`${this.apiBase}${pathAndQuery}`, headers);
    },
  };
}
function noonAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address_line1 ?? a.addressLine1 ?? a.street), toStr(a.address_line2 ?? a.addressLine2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.zone ?? a.state ?? a.province), toStr(a.zip ?? a.postal_code),
    toStr(a.country_code ?? a.country)].filter(Boolean).join(', ');
}
/** 行级 barcode 记录折叠成一单（amount 取整单值，缺则行合计） */
function noonGroupToNorm(shop: SyncShop, key: string, rows: any[]): NormOrder | null {
  if (!key) return null;
  const externalId = `NOON-${shop.id.slice(0, 8)}-${key}`;
  const first: any = rows[0] ?? {};
  const createdMs = parseTime(first.order_date ?? first.created_at ?? first.createdDate);
  const statuses = rows.map((r) => toStr(r.status ?? r.order_status)).filter(Boolean);
  // 同一单多行状态可能不一致：取「最未完成」的那个，保证不会被已发货行掩盖待发货行
  const rank = ['待处理', '待审核', '待发货', '已发货', '已完成', '售后中', '已取消'];
  const status = statuses.map(mapNoonStatus).sort((a, b) => rank.indexOf(a) - rank.indexOf(b))[0] ?? '待处理';
  const cust = (first.customer ?? first.customer_detail ?? {}) as Record<string, any>;
  const addr = (first.delivery_address ?? first.address ?? first.shipping_address ?? {}) as Record<string, any>;
  let amount = firstNum(first.order_value, first.amount, first.total_amount);
  if (amount === 0) for (const r of rows) amount += firstNum(r.item_price, r.price, r.unit_price);
  const inv = firstStr(first.sales_invoice1 ?? first.sales_invoice);
  return {
    externalId,
    status,
    modifiedMs: parseTime(first.status_updated_at ?? first.updated_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Noon'),
      buyer: firstStr(cust.name, cust.full_name, first.customer_name, addr.name, cust.phone),
      product: summaryProduct(toStr(first.item?.name ?? first.item_name ?? first.name),
        toNum(first.item?.quantity ?? first.quantity) || rows.length, rows.length),
      sku: firstStr(first.item?.sku ?? first.sku_seller ?? first.seller_sku ?? first.sku, first.barcode),
      phone: firstStr(cust.phone, cust.mobile, addr.phone_number ?? addr.phone),
      items: rows.slice(0, 20).map((r) => ({
        name: toStr(r?.item?.name ?? r.item_name ?? r.name),
        sku: toStr(r?.item?.sku ?? r.sku_seller ?? r.seller_sku ?? r.sku ?? r.barcode),
        qty: toNum(r?.item?.quantity ?? r.quantity),
      })),
      amount: toAmount(amount),
      currency: toCurrency(first.currency ?? first.currency_code, 'AED'),
      status,
      address: noonAddr(addr),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`Noon 状态 ${statuses.join(',') || '-'}`, inv ? `发票 ${inv}` : '', `行 ${rows.length}`].filter(Boolean).join(' | '),
    },
  };
}
async function noonPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = noonConn(ctx.creds);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      date_from: day(ctx.sinceMs), date_to: day(ctx.untilMs),
      page: String(page), page_size: String(NOON_PAGE_SIZE),
    });
    if (cli.projectCode) qs.set('project_code', cli.projectCode);
    const r = await cli.get(`/orders?${qs.toString()}`);
    if (!r.ok) throw new Error(`Noon 拉单失败：${apiErr(r.data, r.status)}`);
    const rows: any[] = Array.isArray(r.data?.results) ? r.data.results
      : Array.isArray(r.data?.data) ? r.data.data : pickArr(r.data ?? {}, ['results', 'orders', 'data', 'list']);
    if (rows.length === 0) break;
    const groups = new Map<string, any[]>();
    for (const o of rows) {
      const key = firstStr(o.ps_order_id, o.order_id, o.noon_order_id, o.barcode);
      if (!key) continue;
      const a = groups.get(key) ?? [];
      a.push(o);
      groups.set(key, a);
    }
    for (const [key, grp] of groups) {
      const n = noonGroupToNorm(ctx.shop, key, grp);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(r.data?.pagination ?? r.data, ['total', 'total_count', 'totalCount']));
    const totalPage = toNum(deepGet(r.data?.pagination ?? r.data, ['pages', 'total_pages', 'totalPages']));
    if (rows.length < NOON_PAGE_SIZE || out.length >= ctx.maxOrders
      || (totalPage > 0 && page >= totalPage) || (total > 0 && page * NOON_PAGE_SIZE >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Noon 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 21：Cdiscount（Octopia Seller API v2 · OAuth2 client_credentials）
//   凭据：client_id + client_secret（兼容 ERP 里的 app_key / app_secret 字段名）
//         seller_account = Octopia Seller ID（多数接口要求 seller-id 头）
//   令牌：POST {base}/oauth2/token  grant_type=client_credentials，按 expires_in 缓存 ctx.shared
//   现状：Cdiscount 旧版 OpenApi/json（/OrderService/GetOrdersList）已于 2024-12 起下线，
//         现行只有 Octopia Seller API v2 → 本适配器按 v2 实现，用凭据 token_path / orders_path
//         可整体退回旧版（token_path=/OpenApi/json/AccessToken，orders_path=/OrderService/GetOrdersList）
//   拉单：GET {base}/rest/orders?status=&created_at_start=&created_at_end=&limit=&offset=
//   状态：平台给英文文案（Preparing Shipping / Shipping Placed / Delivered / Refund …）
//   OAuth：未拿到 Octopia 应用密钥时硬失败（不静默返回空）
// ═══════════════════════════════════════════════════════════════════
const CDISC_API = 'https://api.octopia.io/v2';
const CDISC_PAGE_SIZE = 100;

const CDISC_STATUS_MAP: Record<string, string> = {
  'waiting_validation': '待审核',
  'waiting validation': '待审核',
  'awaiting_validation': '待审核',
  'draft': '待处理',
  'preparing_shipping': '待发货',
  'preparing shipping': '待发货',
  'shipping_placed': '已发货',
  'shipping placed': '已发货',
  'shipped': '已发货',
  'delivered': '已完成',
  'delivered_digital': '已完成',
  'collected': '已完成',
  'refunded': '已取消',
  'refund': '已取消',
  'cancellation': '已取消',
  'cancelled': '已取消',
  'canceled': '已取消',
  'incident': '售后中',
  'returned': '售后中',
  'return': '售后中',
  'late_shipment': '售后中',
};
function mapCdiscStatus(raw: unknown): string {
  const k = toStr(raw).toLowerCase();
  return CDISC_STATUS_MAP[k] ?? CDISC_STATUS_MAP[k.replace(/[^a-z]+/g, ' ').trim()] ?? '待处理';
}
function cdiscConn(creds: Record<string, unknown>) {
  const clientId = firstStr(creds.client_id, creds.app_key, envOpt('CDISCOUNT_CLIENT_ID'));
  const clientSecret = firstStr(creds.client_secret, creds.app_secret, envOpt('CDISCOUNT_CLIENT_SECRET'));
  if (!clientId || !clientSecret) throw new Error('Cdiscount OAuth 流程尚未就绪：缺少 Octopia 应用 Client ID / Client Secret（需在 developer.octopia-io.net 创建应用后回填），请重新授权');
  return {
    clientId, clientSecret,
    sellerId: firstStr(creds.seller_account, creds.seller_id, envOpt('CDISCOUNT_SELLER_ID')),
    apiBase: firstStr(creds.api_base, envOpt('CDISCOUNT_API_BASE'), CDISC_API).replace(/\/+$/, ''),
    tokenPath: firstStr(creds.token_path, '/oauth2/token'),
    ordersPath: firstStr(creds.orders_path, '/rest/orders'),
  };
}
/** Octopia 访问令牌：client_credentials 换取，单次同步内按 expires_in 缓存复用 */
async function cdiscBearer(ctx: FetchCtx, cli: ReturnType<typeof cdiscConn>): Promise<string> {
  const cached = ctx.shared.cdiscBearer as { token: string; expMs: number } | undefined;
  if (cached?.token && cached.expMs > Date.now() + 60_000) return cached.token;
  const res = await fetchDirect(`${cli.apiBase}${cli.tokenPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: cli.clientId, client_secret: cli.clientSecret,
      ...(cli.sellerId ? { seller_id: cli.sellerId } : {}),
    }).toString(),
  });
  const text = await res.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  const token = firstStr(d?.access_token, d?.token, d?.result?.access_token);
  if (!res.ok || !token) throw new Error(`Cdiscount(Octopia) 取令牌失败：${apiErr(d, res.status)}`);
  const ttl = toNum(d.expires_in) || 3600;
  ctx.shared.cdiscBearer = { token, expMs: Date.now() + Math.max(60, ttl - 300) * 1000 };
  return token;
}
function cdiscAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address1 ?? a.address_1 ?? a.street), toStr(a.address2 ?? a.address_2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.state ?? a.province), toStr(a.postal_code ?? a.zip),
    toStr(a.country ?? a.iso3_country)].filter(Boolean).join(', ');
}
function cdiscOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.order_id, o.orderId, o.voucher_id, o.id);
  if (!platformId) return null;
  const externalId = `CDISC-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = pickArr(o, ['orderlines', 'order_lines', 'items', 'products', 'sku_list', 'variations']);
  const first: any = items[0] ?? {};
  const createdMs = parseTime(o.created_at ?? o.createdAt ?? o.order_date);
  const rawStatus = firstStr(o.status, o.order_status, o.state);
  const status = mapCdiscStatus(rawStatus);
  const buyer = (o.customer ?? o.buyer ?? {}) as Record<string, any>;
  const addr = (o.shipping_address ?? o.delivery_address ?? o.address ?? buyer) as Record<string, any>;
  const price = firstNum(o.total_amount ?? o.order_amount, o.amount, o.price);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updated_at ?? o.last_updated ?? o.shipped_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Cdiscount'),
      buyer: firstStr(buyer.full_name, buyer.email, o.customer_name, o.pseudo, buyer.last_name),
      product: summaryProduct(toStr(first.sku ?? first.title ?? first.name ?? o.product_reference),
        toNum(first.quantity), items.length || 1),
      sku: firstStr(first.sku, first.seller_sku, o.product_reference, o.sku),
      phone: firstStr(addr.phone_number, addr.phone, buyer.phone_number),
      items: (items.length > 0 ? items : [{ sku: o.product_reference, title: o.product_title, quantity: o.quantity }]).slice(0, 20)
        .map((it) => ({
          name: toStr(it.title ?? it.name ?? it.product_title),
          sku: toStr(it.sku ?? it.seller_sku ?? it.product_reference),
          qty: toNum(it.quantity),
        })),
      amount: toAmount(price > 0 ? price : firstNum(first.price, first.unit_price)),
      currency: toCurrency(o.currency ?? o.iso_currency_code ?? first.currency, 'EUR'),
      status,
      address: cdiscAddr(addr),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`Cdiscount 状态 ${rawStatus || '-'}`, toStr(o.shipping_mode) ? `配送 ${toStr(o.shipping_mode)}` : '', `行 ${items.length}`].filter(Boolean).join(' | '),
    },
  };
}
async function cdiscPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = cdiscConn(ctx.creds);
  const token = await cdiscBearer(ctx, cli);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (cli.sellerId) headers['seller-id'] = cli.sellerId;
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      created_at_start: iso(ctx.sinceMs), created_at_end: iso(ctx.untilMs),
      limit: String(CDISC_PAGE_SIZE), offset: String(page * CDISC_PAGE_SIZE),
    });
    const r = await getJson(`${cli.apiBase}${cli.ordersPath}?${qs.toString()}`, headers);
    if (!r.ok) throw new Error(`Cdiscount(Octopia) 拉单失败：${apiErr(r.data, r.status)}`);
    const body = r.data?.result ?? r.data?.data ?? r.data ?? {};
    const rows = pickArr(body, ['orders', 'order_list', 'results', 'list', 'data', 'collection']);
    const list = rows.length > 0 ? rows : deepArr(body);
    if (list.length === 0) break;
    for (const o of list) {
      const n = cdiscOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(body, ['total', 'total_count', 'totalCount', 'pagination.total']));
    if (list.length < CDISC_PAGE_SIZE || out.length >= ctx.maxOrders
      || (total > 0 && (page + 1) * CDISC_PAGE_SIZE >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Cdiscount 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 22：OTTO Market（OAuth2 client_credentials · Keycloak 令牌域）
//   凭据：client_id + client_secret（OTTO Partner Connect 建 App 后给出的那一对）
//   令牌：POST https://login.api.otto.de/auth/realms/otto_partner_connect/protocol/openid-connect/token
//         grant_type=client_credentials（Keycloak/OIDC 标准形态），按 expires_in 缓存 ctx.shared
//   网关：业务 API 在 connect.api.otto.de（api.otto.de 为门户域，不承载 Partner API）
//   拉单：GET {base}/order/api/v2/orders?offset=&limit=200&sort=orderData.orderDate,DESC
//   响应：{ content: [ { orderData: { orderNumber, orderState, orderDate, customer, items … } } ],
//           totalPages, totalElements } —— 行对象把订单项包在 orderData 下，兼容平铺两种形态
//   窗口：平台无「更新时间」增量参数 → 按下单日期倒序翻页，翻到早于水位即停（靠 externalId 幂等回刷）
//   OAuth：缺 client 密钥时硬失败
// ═══════════════════════════════════════════════════════════════════
const OTTO_API = 'https://connect.api.otto.de';
const OTTO_TOKEN_URL = 'https://login.api.otto.de/auth/realms/otto_partner_connect/protocol/openid-connect/token';
const OTTO_PAGE_SIZE = 200;

const OTTO_STATUS_MAP: Record<string, string> = {
  'pending': '待审核',
  'in_progress': '待发货',
  'in-progress': '待发货',
  'awaiting_payment': '待处理',
  'shipped': '已发货',
  'partially_shipped': '已发货',
  'sent': '已发货',
  'delivered': '已完成',
  'completed': '已完成',
  'cancelled': '已取消',
  'canceled': '已取消',
  'rejected': '已取消',
  'returned': '售后中',
  'refund': '售后中',
};
function mapOttoStatus(raw: unknown): string {
  const k = toStr(raw).toLowerCase().replace(/\s+/g, '_');
  return OTTO_STATUS_MAP[k] ?? '待处理';
}
function ottoConn(creds: Record<string, unknown>) {
  const clientId = firstStr(creds.client_id, creds.app_key, envOpt('OTTO_CLIENT_ID'));
  const clientSecret = firstStr(creds.client_secret, creds.app_secret, envOpt('OTTO_CLIENT_SECRET'));
  if (!clientId || !clientSecret) throw new Error('OTTO 凭据不完整（缺 Client ID / Client Secret，需在 OTTO Partner Connect 创建 App），请重新授权');
  return {
    clientId, clientSecret,
    apiBase: firstStr(creds.api_base, envOpt('OTTO_API_BASE'), OTTO_API).replace(/\/+$/, ''),
    tokenUrl: firstStr(creds.token_url, envOpt('OTTO_TOKEN_URL'), OTTO_TOKEN_URL),
    ordersPath: firstStr(creds.orders_path, '/order/api/v2/orders'),
  };
}
async function ottoBearer(ctx: FetchCtx, cli: ReturnType<typeof ottoConn>): Promise<string> {
  const cached = ctx.shared.ottoBearer as { token: string; expMs: number } | undefined;
  if (cached?.token && cached.expMs > Date.now() + 60_000) return cached.token;
  const res = await fetchDirect(cli.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cli.clientId, client_secret: cli.clientSecret }).toString(),
  });
  const text = await res.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  const token = toStr(d?.access_token);
  if (!res.ok || !token) throw new Error(`OTTO 取令牌失败：${apiErr(d, res.status)}（App 需在 OTTO Partner Connect 勾选 Orders 接口权限）`);
  const ttl = toNum(d.expires_in) || 300;
  ctx.shared.ottoBearer = { token, expMs: Date.now() + Math.max(60, ttl - 30) * 1000 };
  return token;
}
function ottoAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const name = [toStr(a.firstName), toStr(a.lastName)].filter(Boolean).join(' ');
  const street = [toStr(a.street ?? a.addressLine1), toStr(a.streetNumber ?? a.addressLine2)].filter(Boolean).join(' ');
  return [street, toStr(a.zipCode ?? a.postalCode), toStr(a.city), name, toStr(a.country ?? a.countryCode)].filter(Boolean).join(', ');
}
function ottoOrderToNorm(shop: SyncShop, src: Record<string, any>): NormOrder | null {
  const o = (src.orderData && typeof src.orderData === 'object' ? src.orderData : src) as Record<string, any>;
  const platformId = firstStr(o.orderNumber, o.orderId, o.id);
  if (!platformId) return null;
  const externalId = `OTTO-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = pickArr(o, ['items', 'orderItems', 'positions', 'lines', 'skus']);
  const first: any = items[0] ?? {};
  const createdMs = parseTime(o.orderDate ?? o.createdAt ?? o.orderCreationDate);
  const rawStatus = firstStr(o.orderState, o.status, o.state);
  const status = mapOttoStatus(rawStatus);
  const cust = (o.customer ?? o.buyer ?? {}) as Record<string, any>;
  const ship = (o.shipment ?? o.shippingAddress ?? o.address ?? cust) as Record<string, any>;
  const priceObj = (o.price ?? o.purchasePrice ?? {}) as Record<string, any>;
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.lastModified ?? o.shippedDate ?? o.modifiedAt) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'OTTO'),
      buyer: firstStr(cust.lastName ? `${toStr(cust.firstName)} ${toStr(cust.lastName)}`.trim() : '', cust.email, o.customerNumber),
      product: summaryProduct(toStr(first.title ?? first.productName ?? first.name),
        toNum(first.quantity ?? first.qty), items.length || 1),
      sku: firstStr(first.skuId, first.sku, first.variationId, first.ottoSkuId),
      phone: firstStr(cust.phone, ship.phone),
      items: (items.length > 0 ? items : [o]).slice(0, 20).map((it) => ({
        name: toStr(it.title ?? it.productName ?? it.name),
        sku: toStr(it.skuId ?? it.sku ?? it.variationId),
        qty: toNum(it.quantity ?? it.qty),
      })),
      amount: toAmount(firstNum(priceObj.commonPrice ?? priceObj.salesPrice ?? priceObj.amount, o.totalAmount, o.amount, first.price)),
      currency: toCurrency(priceObj.currency ?? o.currency, 'EUR'),
      status,
      address: ottoAddr(ship),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`OTTO 状态 ${rawStatus || '-'}`, toStr(o.verificationState) ? `风控 ${toStr(o.verificationState)}` : '', `行 ${items.length}`].filter(Boolean).join(' | '),
    },
  };
}
async function ottoPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = ottoConn(ctx.creds);
  const token = await ottoBearer(ctx, cli);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({ offset: String(page * OTTO_PAGE_SIZE), limit: String(OTTO_PAGE_SIZE), sort: 'orderData.orderDate,DESC' });
    const r = await getJson(`${cli.apiBase}${cli.ordersPath}?${qs.toString()}`, { Authorization: `Bearer ${token}` });
    if (!r.ok) throw new Error(`OTTO 拉单失败：${apiErr(r.data, r.status)}`);
    const body = r.data ?? {};
    const rows = Array.isArray(body.content) ? body.content : pickArr(body, ['content', 'orders', 'data', 'list']);
    if (rows.length === 0) break;
    let pageMinMs = Number.POSITIVE_INFINITY;
    for (const o of rows) {
      const data = (o?.orderData && typeof o.orderData === 'object' ? o.orderData : o) as Record<string, any>;
      pageMinMs = Math.min(pageMinMs, parseTime(data.orderDate ?? data.createdAt) ?? Number.POSITIVE_INFINITY);
      const n = ottoOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const totalPage = toNum(body.totalPages ?? deepGet(body, ['total_pages', 'pages']));
    const olderThanWatermark = Number.isFinite(pageMinMs) && pageMinMs < ctx.sinceMs;
    if (rows.length < OTTO_PAGE_SIZE || out.length >= ctx.maxOrders
      || (totalPage > 0 && page + 1 >= totalPage) || olderThanWatermark) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`OTTO 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 23：Jumia（Vendor API · OAuth2 refresh_token → Bearer）
//   凭据：client_id（ERP 里的 partner_id）+ refresh_token（当 access_token 用可直接生效，
//         也支持用 refresh_token 现换）+ secret_key（若站点启用 seller 级签名则走环境变量）
//   令牌：POST https://vendor-api.jumia.com/token  form: grant_type=refresh_token +
//         client_id + refresh_token —— 与本仓库 authorize-shop.verifyJumia 用的是同一端点，
//         换取成功即缓存 access_token（expires_in 驱动）；换取失败时退化为把 refresh_token
//         直接当 Bearer（ERP 现网也有把回调 access_token 落进 refresh_token 字段的存法）
//   拉单：GET {base}/order-service/api/orders?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&pageNo=&pageSize=100
//         + partner_id / vendor_code（凭据里有才带，缺省时平台按令牌作用域返回）
//   状态：Created / Accepted / Cancelled / Shipped / Packed / Delivered / Returned
//   买家：Jumia 对手机号与地址做脱敏（返回占位串）→ 原样保存，不加工不编造
// ═══════════════════════════════════════════════════════════════════
const JUMIA_API = 'https://vendor-api.jumia.com';
const JUMIA_TOKEN_URL = 'https://vendor-api.jumia.com/token';
const JUMIA_PAGE_SIZE = 100;

const JUMIA_STATUS_MAP: Record<string, string> = {
  'created': '待处理',
  'new': '待处理',
  'pending': '待处理',
  'accepted': '待发货',
  'confirmed': '待发货',
  'to_be_shipped': '待发货',
  'packed': '已发货',
  'shipped': '已发货',
  'out_for_delivery': '已发货',
  'in_transit': '已发货',
  'delivered': '已完成',
  'cancelled': '已取消',
  'canceled': '已取消',
  'returned': '售后中',
  'return_initiated': '售后中',
  'refunded': '售后中',
  'lost': '售后中',
  'expired': '已取消',
};
function mapJumiaStatus(raw: unknown): string {
  const k = toStr(raw).toLowerCase().replace(/[\s-]+/g, '_');
  return JUMIA_STATUS_MAP[k] ?? '待处理';
}
function jumiaConn(creds: Record<string, unknown>) {
  const clientId = firstStr(creds.client_id, creds.partner_id, creds.app_key, envOpt('JUMIA_CLIENT_ID'));
  const refreshToken = firstStr(creds.refresh_token, creds.client_secret, envOpt('JUMIA_REFRESH_TOKEN'));
  const preset = firstStr(creds.access_token, creds.token);
  if (!clientId) throw new Error('Jumia 凭据不完整（缺 Client ID / Partner ID），请重新授权');
  if (!refreshToken && !preset) throw new Error('Jumia OAuth 流程尚未就绪：缺少 Refresh Token / Access Token，需在 Jumia Vendor Center 完成 API 授权后回写凭据');
  return {
    clientId, refreshToken, preset,
    apiBase: firstStr(creds.api_base, envOpt('JUMIA_API_BASE'), JUMIA_API).replace(/\/+$/, ''),
    tokenUrl: firstStr(creds.token_url, envOpt('JUMIA_TOKEN_URL'), JUMIA_TOKEN_URL),
    ordersPath: firstStr(creds.orders_path, '/order-service/api/orders'),
    partnerId: firstStr(creds.partner_id, creds.client_id),
    vendorCode: firstStr(creds.vendor_code, creds.seller_account, creds.vendor_id),
  };
}
/** 先按 refresh_token 换 access_token；换不到时退回凭据里已存的令牌直接当 Bearer */
async function jumiaBearer(ctx: FetchCtx, cli: ReturnType<typeof jumiaConn>): Promise<string> {
  const cached = ctx.shared.jumiaBearer as { token: string; expMs: number } | undefined;
  if (cached?.token && cached.expMs > Date.now() + 60_000) return cached.token;
  if (!cli.refreshToken) {
    ctx.shared.jumiaBearer = { token: cli.preset, expMs: Date.now() + 3300_000 };
    return cli.preset;
  }
  const res = await fetchDirect(cli.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: cli.clientId, refresh_token: cli.refreshToken }).toString(),
  });
  const text = await res.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  const token = firstStr(d?.access_token, d?.result?.access_token);
  if (!res.ok || !token) {
    if (cli.preset) {
      ctx.warn(`Jumia 令牌换取失败（${apiErr(d, res.status)}），改用凭据中已存的 Access Token`);
      ctx.shared.jumiaBearer = { token: cli.preset, expMs: Date.now() + 3300_000 };
      return cli.preset;
    }
    throw new Error(`Jumia 取令牌失败：${apiErr(d, res.status)}`);
  }
  const ttl = toNum(d.expires_in) || 3600;
  ctx.shared.jumiaBearer = { token, expMs: Date.now() + Math.max(60, ttl - 300) * 1000 };
  return token;
}
function jumiaAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address ?? a.street ?? a.address1), toStr(a.address2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.state ?? a.province), toStr(a.country), toStr(a.zip_code ?? a.postcode)].filter(Boolean).join(', ');
}
function jumiaOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.order_number, o.orderNumber, o.reference_number, o.id);
  if (!platformId) return null;
  const externalId = `JUMIA-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = pickArr(o, ['order_items', 'orderItems', 'items', 'products', 'lines']);
  const first: any = items[0] ?? {};
  const createdMs = parseTime(o.create_time ?? o.createdAt ?? o.order_date ?? o.created_at);
  const rawStatus = firstStr(o.status, o.order_status, o.state);
  const status = mapJumiaStatus(rawStatus);
  const ship = (o.shipping_address ?? o.delivery_address ?? o.address ?? {}) as Record<string, any>;
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.update_time ?? o.updatedAt ?? o.last_update ?? o.status_update_time) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Jumia'),
      buyer: firstStr(o.customer_name, o.buyer_name, ship.first_name ? `${toStr(ship.first_name)} ${toStr(ship.last_name)}`.trim() : '', ship.customer),
      product: summaryProduct(toStr(first.name ?? first.product_name ?? first.title),
        toNum(first.quantity ?? first.qty), items.length || 1),
      sku: firstStr(first.seller_sku, first.vendor_product_code, first.product_code, first.sku),
      phone: firstStr(o.customer_phone_number, ship.phone, ship.phone_number, o.phone),
      items: (items.length > 0 ? items : [o]).slice(0, 20).map((it) => ({
        name: toStr(it.name ?? it.product_name ?? it.title),
        sku: toStr(it.seller_sku ?? it.vendor_product_code ?? it.product_code ?? it.sku),
        qty: toNum(it.quantity ?? it.qty),
      })),
      amount: toAmount(firstNum(o.total_amount, o.amount, o.order_value, first.price)),
      currency: toCurrency(o.price_currency ?? o.currency ?? first.currency, ''),
      status,
      address: jumiaAddr(ship),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`Jumia 状态 ${rawStatus || '-'}`, firstStr(o.country_code, o.site) ? `站点 ${firstStr(o.country_code, o.site)}` : '', `行 ${items.length}`].filter(Boolean).join(' | '),
    },
  };
}
async function jumiaPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = jumiaConn(ctx.creds);
  const token = await jumiaBearer(ctx, cli);
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      dateFrom: day(ctx.sinceMs), dateTo: day(ctx.untilMs),
      pageNo: String(page), pageSize: String(JUMIA_PAGE_SIZE),
    });
    if (cli.partnerId) qs.set('partnerId', cli.partnerId);
    if (cli.vendorCode) qs.set('vendorCode', cli.vendorCode);
    const r = await getJson(`${cli.apiBase}${cli.ordersPath}?${qs.toString()}`, { Authorization: `Bearer ${token}` });
    if (!r.ok) throw new Error(`Jumia 拉单失败：${apiErr(r.data, r.status)}`);
    const body = r.data?.data ?? r.data?.result ?? r.data ?? {};
    const rows = Array.isArray(body) ? body : pickArr(body, ['orders', 'content', 'results', 'list', 'data']);
    const list = rows.length > 0 ? rows : deepArr(body);
    if (list.length === 0) break;
    for (const o of list) {
      const n = jumiaOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const totalPage = toNum(deepGet(body, ['total_pages', 'totalPages', 'pages', 'pageCount']));
    if (list.length < JUMIA_PAGE_SIZE || out.length >= ctx.maxOrders || (totalPage > 0 && page >= totalPage)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Jumia 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 24：Wish（Merchant Open API v3 · OAuth Bearer）
//   凭据：access_token（platform_auth_config.Wish 只有这一个字段；Wish 已停止新开发者接入，
//         历史商户令牌需自行从开发者后台粘贴）
//   域名与鉴权头与本仓库 authorize-shop.verifyWish 完全一致：
//         https://merchant.wish.com/api + Authorization: Bearer <access_token>
//   拉单：GET /v3/order/list?since_timestamp={秒}&max=1000&sort_by=date_created&sort_order=DESC&cursor=…
//         · 平台无「更新时间」增量参数（date_updated 排序同样可用，但游标语义只保证 date_created 稳定）
//         · 故按创建时间倒序翻页 + 客户端窗口过滤，翻到早于水位即停；状态变化靠重复单幂等回刷
//   响应：{ code: 0, message, data: { orders: [...] } }（老版为 { result: [...] }，两种都剥）
//   金额：purchase_price / products[].price 为「元」小数字符串；平台另有 *_cents 字段不做二次换算
//   OAuth：无 access_token 时硬失败
// ═══════════════════════════════════════════════════════════════════
const WISH_API = 'https://merchant.wish.com/api';
const WISH_PAGE_SIZE = 1000;

const WISH_STATUS_MAP: Record<string, string> = {
  'new': '待处理',
  'pending': '待审核',
  'on_hold': '待审核',
  'risk_hold': '待审核',
  'partially_sent': '已发货',
  'sent': '已发货',
  'shipped': '已发货',
  'delivered': '已完成',
  'completed': '已完成',
  'canceled': '已取消',
  'cancelled': '已取消',
  'cancellation_requested': '售后中',
  'refunded': '售后中',
  'returned': '售后中',
};
function mapWishStatus(raw: unknown): string {
  const k = toStr(raw).toLowerCase().replace(/[\s-]+/g, '_');
  return WISH_STATUS_MAP[k] ?? '待处理';
}
function wishConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.token, creds.api_key);
  if (!token) throw new Error('Wish OAuth 流程尚未就绪：缺少 Access Token（需在 Wish 开发者后台完成 OAuth 授权后回写凭据），请重新授权');
  return {
    token,
    apiBase: firstStr(creds.api_base, envOpt('WISH_API_BASE'), WISH_API).replace(/\/+$/, ''),
  };
}
function wishTime(v: unknown): number | null {
  if (typeof v === 'number' || (typeof v === 'string' && /^\d{10}$/.test(v.trim()))) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n * 1000 : null;
  }
  return parseTime(v);
}
function wishAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address1 ?? a.address), toStr(a.address2), toStr(a.address3)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.state), toStr(a.country_code ?? a.country), toStr(a.zip ?? a.postal_code)].filter(Boolean).join(', ');
}
function wishOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.number, o.order_number, o.id, o.orderId);
  if (!platformId) return null;
  const externalId = `WISH-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = pickArr(o, ['products', 'items', 'order_products', 'variants']);
  const first: any = items[0] ?? {};
  const createdMs = wishTime(o.create_time ?? o.created ?? o.date_created ?? o.purchase_time);
  const rawStatus = firstStr(o.status, o.order_status);
  const status = mapWishStatus(rawStatus);
  const cust = (o.customer ?? o.shipping_address ?? {}) as Record<string, any>;
  const addr = (o.shipping_address ?? o.address ?? cust) as Record<string, any>;
  const pp = (o.purchase_price ?? {}) as Record<string, any>;
  return {
    externalId,
    status,
    modifiedMs: wishTime(o.update_time ?? o.updated ?? o.date_updated ?? o.shipped_time) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Wish'),
      buyer: firstStr(cust.name, cust.full_name, o.customer_name, [toStr(cust.first_name), toStr(cust.last_name)].join(' '), o.user_id),
      product: summaryProduct(toStr(first.name ?? first.sku ?? o.product_name), toNum(first.quantity ?? first.qty), items.length || 1),
      sku: firstStr(first.sku ?? '', first.seller_sku ?? '', o.sku),
      phone: firstStr(addr.phone ?? '', addr.tel ?? '', o.phone_number),
      items: (items.length > 0 ? items : [{ sku: o.sku, name: o.product_name, quantity: o.quantity }]).slice(0, 20)
        .map((it) => ({
          name: toStr(it.name ?? it.title),
          sku: toStr(it.sku ?? it.seller_sku ?? it.variant_id),
          qty: toNum(it.quantity ?? it.qty),
        })),
      amount: toAmount(firstNum(pp.amount, o.purchase_price, o.total, o.amount, first.price)),
      currency: toCurrency(pp.currency ?? o.currency ?? first.currency, 'USD'),
      status,
      address: wishAddr(addr),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [`Wish 状态 ${rawStatus || '-'}`, toStr(o.shipping_service_name) ? `配送 ${toStr(o.shipping_service_name)}` : '', `行 ${items.length}`].filter(Boolean).join(' | '),
    },
  };
}
async function wishPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = wishConn(ctx.creds);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      since_timestamp: String(Math.floor(ctx.sinceMs / 1000)),
      max: String(WISH_PAGE_SIZE), sort_by: 'date_created', sort_order: 'DESC',
    });
    if (cursor) qs.set('cursor', cursor);
    const r = await getJson(`${cli.apiBase}/v3/order/list?${qs.toString()}`, { Authorization: `Bearer ${cli.token}` });
    // Wish 业务失败常为 HTTP 200 + code≠0
    if (!r.ok || (r.data?.code !== undefined && toNum(r.data.code) !== 0)) throw new Error(`Wish 拉单失败：${apiErr(r.data, r.status)}`);
    const body = r.data?.data ?? r.data?.result ?? r.data ?? {};
    const rows = Array.isArray(body) ? body : pickArr(body, ['orders', 'list', 'data', 'results']);
    const list = rows.length > 0 ? rows : deepArr(body);
    if (list.length === 0) break;
    let pageMinMs = Number.POSITIVE_INFINITY;
    for (const o of list) {
      pageMinMs = Math.min(pageMinMs, wishTime(o.create_time ?? o.date_created ?? o.created) ?? Number.POSITIVE_INFINITY);
      const n = wishOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    cursor = firstStr(deepGet(body, ['next_cursor', 'cursor']), deepGet(r.data, ['next_cursor']));
    const olderThanWatermark = Number.isFinite(pageMinMs) && pageMinMs < ctx.sinceMs;
    if (out.length >= ctx.maxOrders || olderThanWatermark) break;
    if (!cursor && list.length < WISH_PAGE_SIZE) break;
    if (!cursor && !olderThanWatermark && page > 0) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Wish 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 25：京东 JOS（一个适配器覆盖「京东国际 POP」+「京东印尼 JD.id」）
//   凭据：app_key + app_secret + access_token（兼容 seller_account / session 字段名）
//   网关：https://api.jd.com/routerjson（京东国际 / 全球售）
//         https://api.jd.id/routerjson（京东印尼，platform 含「印尼」或 id/jd.id 时切换）
//   签名：TOP 规范 —— 大写 MD5(app_secret + 升序 key+value + app_secret)，与 Lazada/Daraz 共用 topSign
//         公共参数走 query，业务参数走表单体（与 AliExpress 同一发送方式）
//   方法：默认 jingdong.pop.order.search（POP 订单搜索）；印尼站可用凭据 api_method 换
//         jingdong.global.pop.order.search / jos.trade.order.list
//   时间：created_start / created_end 为 "yyyy-MM-dd HH:mm:ss" 裸串
//         · api.jd.com 按北京时间(UTC+8)解析，api.jd.id 按雅加达时间(UTC+7)解析
//         · 时区偏移用凭据 tz_offset_hours 覆盖
//   响应：根键 = 方法名点转下划线 + _response / _responce（京东两代网关都用过），再剥 result 包装
//   状态：Taobao 系订单状态码（NOT_PAY / CONFIRMED / WAIT_SELLER_STOCK_OUT / DELIVERY / …）
//   OAuth：缺 access_token 时硬失败（不静默返回空）
// ═══════════════════════════════════════════════════════════════════
const JD_API = 'https://api.jd.com/routerjson';
const JD_ID_API = 'https://api.jd.id/routerjson';
const JD_PAGE_SIZE = 50;

const JD_STATUS_MAP: Record<string, string> = {
  'not_pay': '待处理',
  'nodPay': '待处理',
  'wait_pay_confirm': '待审核',
  'wait_seller_confirm': '待审核',
  'confirmed': '待发货',
  'wait_seller_stock_out': '待发货',
  'wait_send': '待发货',
  'partial_sent': '已发货',
  'delivery': '已发货',
  'sending': '已发货',
  'shipped': '已发货',
  'delivered': '已完成',
  'finished_l': '已完成',
  'finished': '已完成',
  'completed': '已完成',
  'canceled': '已取消',
  'cancelled': '已取消',
  'trading_closed': '已取消',
  'trade_closed': '已取消',
  'closed': '已取消',
  'return': '售后中',
  'returned': '售后中',
  'refunded': '售后中',
  'afs_service': '售后中',
};
function mapJdStatus(raw: unknown): string {
  const k = toStr(raw);
  return JD_STATUS_MAP[k] ?? JD_STATUS_MAP[k.toLowerCase()] ?? '待处理';
}
/** 印尼站判定：平台名/凭据里出现「印尼」/jd.id/id 站标记 → 走 api.jd.id */
function jdIsIndonesia(creds: Record<string, unknown>, shop: SyncShop): boolean {
  const hay = `${toStr(shop.platform)} ${firstStr(creds.api_base, creds.region, creds.site, creds.country)}`.toLowerCase();
  return /印尼|indonesia|jd\.id|jdid|(^|[^a-z])id([^a-z]|$)/.test(hay);
}
function jdConn(creds: Record<string, unknown>, shop: SyncShop) {
  const appKey = firstStr(creds.app_key, envOpt('JD_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('JD_APP_SECRET'));
  const accessToken = firstStr(creds.access_token, creds.session, creds.seller_account, envOpt('JD_ACCESS_TOKEN'));
  const idSite = jdIsIndonesia(creds, shop);
  if (!appKey || !appSecret) throw new Error(`京东${idSite ? '印尼' : ''}凭据不完整（缺 App Key / App Secret；App Secret 建议配置在环境变量 JD_APP_SECRET），请重新授权`);
  if (!accessToken) throw new Error(`京东${idSite ? '印尼' : ''} OAuth 流程尚未就绪：缺少卖家 Access Token，需在 JOS 开放平台完成店铺授权后回写凭据`);
  return {
    appKey, appSecret, accessToken, idSite,
    apiBase: firstStr(creds.api_base, envOpt('JD_API_BASE'), idSite ? JD_ID_API : JD_API),
    method: firstStr(creds.api_method, 'jingdong.pop.order.search'),
    signMethod: firstStr(creds.sign_method, 'md5').toLowerCase(),
    // 网关按当地时钟解析裸时间串：京东国际=北京 UTC+8，JD.id=雅加达 UTC+7
    tzOffsetHours: Number.isFinite(Number(creds.tz_offset_hours)) && creds.tz_offset_hours !== ''
      ? Number(creds.tz_offset_hours) : (idSite ? 7 : 8),
    currency: toCurrency(creds.currency, idSite ? 'IDR' : 'CNY'),
    async call(biz: Record<string, string>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: this.appKey, method: this.method, access_token: this.accessToken,
        timestamp: topTimestamp(Date.now() + this.tzOffsetHours * 3600_000),
        format: 'json', v: '2.0', sign_method: this.signMethod,
      };
      params.sign = await topSign(topConcat(params), this.appSecret, this.signMethod === 'sha256' ? 'sha256' : 'md5', true);
      const qs = new URLSearchParams(params).toString();
      const res = await fetchDirect(`${this.apiBase}?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams(biz).toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
/** JOS 裸时间串（按平台解析时区偏移后的 yyyy-MM-dd HH:mm:ss） */
function jdLocalTime(ms: number, tzOffsetHours: number): string {
  return topTimestamp(ms + tzOffsetHours * 3600_000);
}
function jdAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const full = toStr(a.fullAddress ?? a.address);
  if (full) return full;
  return [toStr(a.provinceName ?? a.province), toStr(a.cityName ?? a.city), toStr(a.countyName ?? a.county),
    toStr(a.townName ?? a.town), toStr(a.address)].filter(Boolean).join(' ');
}
/** 状态回退：orderStatus 缺失时用出库/妥投/取消时间推导（POP 各版本字段名不一） */
function jdStatus(o: Record<string, any>): string {
  const direct = firstStr(o.orderStatus, o.order_status, o.status, o.orderState, o.state);
  if (direct) return mapJdStatus(direct);
  if (toStr(o.finishedTime ?? o.deliveryCompleteTime)) return '已完成';
  if (toStr(o.shippingTime ?? o.outboundTime)) return '已发货';
  if (toStr(o.cancelTime ?? o.canceledTime)) return '已取消';
  return '待处理';
}
function jdOrderToNorm(shop: SyncShop, o: Record<string, any>, cli: ReturnType<typeof jdConn>): NormOrder | null {
  const platformId = firstStr(o.orderNo, o.order_no, o.orderId, o.id, o.tradeId);
  if (!platformId) return null;
  const externalId = `JD-${shop.id.slice(0, 8)}-${platformId}`;
  const skus: any[] = pickArr(o, ['skuItemInfoList', 'skuList', 'skuItems', 'orderSkuList', 'items', 'goodsList', 'sku']);
  const first: any = skus[0] ?? {};
  const createdMs = parseTime(o.createdTime ?? o.created ?? o.creationTime ?? o.orderStartTime ?? o.orderTime);
  const status = jdStatus(o);
  const consignee = (o.consigneeInfo ?? o.receiverInfo ?? o.consignee ?? o.address ?? {}) as Record<string, any>;
  const qtyOf = (s: any) => toNum(s?.skuNum ?? s?.num ?? s?.quantity ?? s?.count) || 0;
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.modifiedTime ?? o.lastUpdateTime ?? o.finishedTime ?? o.canceledTime) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, cli.idSite ? '京东印尼' : '京东国际'),
      buyer: firstStr(o.customerName, o.consigneeName, consignee.fullName, consignee.name, o.xidBuyer, o.pin),
      product: summaryProduct(toStr(first.skuName ?? first.name ?? first.title), qtyOf(first) || toNum(o.orderScore), skus.length || 1),
      sku: firstStr(first.skuId ?? first.sku_id ?? first.outerSkuId ?? first.wareId, o.skuId),
      phone: firstStr(consignee.mobile, consignee.phone, o.mobile, o.telephone),   // 非授权接口返回虚拟号/掩码 → 原样保存
      items: (skus.length > 0 ? skus : [o]).slice(0, 20).map((s) => ({
        name: toStr(s.skuName ?? s.name ?? s.title),
        sku: toStr(s.skuId ?? s.outerSkuId ?? s.wareId ?? s.sku),
        qty: qtyOf(s),
      })),
      amount: toAmount(moneyVal(firstNum(o.actualPayPrice, o.orderTotalPrice, o.totalPayment, o.paymentPrice, o.orderAmount, o.payAmount, first.skuJdPrice))),
      currency: toCurrency(o.currency ?? o.currencyCode, cli.currency),
      status,
      address: jdAddr(consignee),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: [
        `京东${cli.idSite ? '印尼' : '国际'} 状态 ${firstStr(o.orderStatus, o.order_status, o.status) || '-'}`,
        toStr(o.orderType) ? `类型 ${toStr(o.orderType)}` : '',
        toStr(o.shippingType ?? o.deliveryType) ? `配送 ${toStr(o.shippingType ?? o.deliveryType)}` : '',
      ].filter(Boolean).join(' | '),
    },
  };
}
/** JOS 网关根键既可能是 xxx_response，也可能是老式拼写 xxx_responce；业务体还可能再套一层转义 JSON 字符串（如 queryOrderResponse）→ 逐层剥到对象为止 */
function jdUnwrap(data: any, method: string): any {
  const root = String(method).replace(/\./g, '_').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  const keys = [`${root}_response`, `${root}_responce`, root, 'response', 'result', 'data'];
  let cur: any = data;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof cur === 'string') {
      if (!/^\s*[[{]/.test(cur)) break;
      try { cur = JSON.parse(cur); } catch { break; }
      continue;
    }
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) break;
    let next: any;
    for (const k of keys) {
      const v = (cur as any)[k];
      if (v !== undefined && v !== null && v !== cur) { next = v; break; }
    }
    if (next === undefined) {
      // 候选键都没命中时，只在「唯一一个 plain 对象 / JSON 字符串值」上下钻一层（数组、数字、布尔都不算包裹层）
      const vals = Object.values(cur).filter((v: any) =>
        (v && typeof v === 'object' && !Array.isArray(v)) || (typeof v === 'string' && /^\s*\{/.test(v)));
      if (vals.length === 1) next = vals[0];
    }
    if (next === undefined || next === cur) break;
    cur = next;
  }
  return cur ?? {};
}
async function jdPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = jdConn(ctx.creds, ctx.shop);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await cli.call({
      created_start: jdLocalTime(ctx.sinceMs, cli.tzOffsetHours),
      created_end: jdLocalTime(ctx.untilMs, cli.tzOffsetHours),
      page: String(page), page_size: String(JD_PAGE_SIZE),
      sort: 'created', sort_type: 'DESC',
    });
    if (!r.ok || r.data?.error_response) throw new Error(`京东 JOS 拉单失败：${topErr(r.data, r.status)}`);
    const body: any = jdUnwrap(r.data, cli.method);
    const rows = pickArr(body, ['orderInfoList', 'orderList', 'orders', 'data', 'orderResult', 'list', 'result']);
    const list = rows.length > 0 ? rows : deepArr(body);
    if (list.length === 0) break;
    for (const o of list) {
      const n = jdOrderToNorm(ctx.shop, o, cli);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(body, ['total', 'totalCount', 'total_items', 'totalElements']));
    if (list.length < JD_PAGE_SIZE || out.length >= ctx.maxOrders || (total > 0 && page * JD_PAGE_SIZE >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`京东 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 26：Wix（Stores API v3 · OAuth2 Bearer + POST /stores/v3/orders/query）
//   凭据：access_token（Wix 应用市场 OAuth 授权回写）· api_key（同域令牌兜底）· account_id
//   接口：POST https://www.wixapis.com/stores/v3/orders/query
//         body { query, variables }（Wix 的 query 端点是 GraphQL/WQL 风格 DSL，返回 data.orders.items）
//         头：Authorization: Bearer · Wix-Hint: forward（多站点令牌必须，缺了会被路由到主站报 401）
//   分页：响应游标 cursor —— 有值即继续；Wix 不给页码，也没有「修改时间」以外的过滤口径
//   状态：order.status（PENDING/PAID/PROCESSED/SHIPPED/DELIVERED/CANCELED/REFUNDED）
//   前置：Wix 只允许「已上架 Wix 应用市场的应用」取 OAuth 令牌，ERP 侧无自研直连路径
//         → 未回填 access_token 时硬失败（绝不静默返回空）
// ═══════════════════════════════════════════════════════════════════
const WIX_API = 'https://www.wixapis.com';
const WIX_PAGE_SIZE = 100;

const WIX_STATUS_MAP: Record<string, string> = {
  'pending': '待审核',
  'proforma': '待处理',
  'paid': '待发货',
  'processed': '待发货',
  'shipped': '已发货',
  'delivered': '已完成',
  'canceled': '已取消',
  'cancelled': '已取消',
  'refunded': '售后中',
  'partially_refunded': '售后中',
  'returned': '售后中',
};
function mapWixStatus(raw: unknown): string {
  return WIX_STATUS_MAP[toStr(raw).toLowerCase().replace(/-/g, '_')] ?? '待处理';
}
function wixConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.api_key, envOpt('WIX_ACCESS_TOKEN'));
  if (!token) throw new Error('Wix OAuth 流程尚未就绪：缺少 Access Token（需在 Wix App Market 完成应用授权并回写凭据），请重新授权');
  const accountId = firstStr(creds.account_id, envOpt('WIX_ACCOUNT_ID'));
  return {
    token, accountId,
    async query(body: Record<string, unknown>): Promise<PlatResp> {
      const res = await fetchDirect(`${WIX_API}/stores/v3/orders/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Wix-Hint': 'forward',
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...(accountId ? { 'Wix-Account-Hint': `account=${accountId}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
function wixAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  return [toStr(a.addressLine1 ?? a.address_1), toStr(a.addressLine2 ?? a.address_2), toStr(a.location ?? a.city),
    toStr(a.subdivision ?? a.state), toStr(a.zip ?? a.postalCode), toStr(a.country)].filter(Boolean).join(', ');
}
function wixOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.id, o.orderId);
  if (!platformId) return null;
  const externalId = `WIX-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.lineItems) ? o.lineItems : (Array.isArray(o.line_items) ? o.line_items : []);
  const buyer = firstStr(o.buyerInfo?.name, [toStr(o.buyerInfo?.firstName ?? o.buyer?.first_name), toStr(o.buyerInfo?.lastName ?? o.buyer?.last_name)].join(' ').trim(),
    toStr(o.buyerInfo?.email), toStr(o.shippingInfo?.address?.fullName));
  const ship = o.shippingInfo ?? o.shippingAddress ?? {};
  const address = wixAddr(ship.address ?? ship);
  const rawStatus = firstStr(o.status, o.paymentStatus, o.payment_status);
  const status = mapWixStatus(rawStatus);
  const createdMs = parseTime(o.created ?? o.createdAt);
  let amount = firstNum(o.total, o.subtotal, o.priceSet?.shopCurrency?.unitAmount, o.priceSet?.standardCurrency?.unitAmount);
  if (amount === 0) amount = items.reduce((s, it) => s + firstNum(it.price, it.totalPrice) * (toNum(it.quantity) || 1), 0);
  const qty = items.reduce((s, it) => s + (toNum(it.quantity) || 1), 0);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updated ?? o.updatedAt) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Wix'),
      buyer: buyer || toStr(o.buyerInfo?.email) || 'Guest',
      product: summaryProduct(toStr(items[0]?.name ?? items[0]?.title), qty, items.length),
      sku: firstStr(items[0]?.catalogReference?.catalogId?.key ?? items[0]?.sku ?? items[0]?.id),
      phone: firstStr(o.buyerInfo?.phone, ship.phone, o.contact?.phone),
      items: items.slice(0, 20).map((it) => ({ name: toStr(it.name ?? it.title), sku: toStr(it.sku ?? it.catalogReference?.catalogId?.key ?? it.id), qty: toNum(it.quantity) })),
      amount: toAmount(amount),
      currency: toCurrency(firstStr(o.currency, o.priceSet?.shopCurrency?.currency), ''),
      status,
      address,
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: firstStr(o.number, o.displayedOrderNumber) ? `Wix 单号 #${firstStr(o.number, o.displayedOrderNumber)}` : (rawStatus ? `Wix 状态 ${rawStatus}` : ''),
    },
  };
}
async function wixPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = wixConn(ctx.creds);
  const since = new Date(ctx.sinceMs).toISOString();
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  let cursor = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const r = await cli.query({
      query: 'query($filter:String,$limit:Int,$cursor:String){orders(filter:$filter,limit:$limit,cursor:$cursor){items{id number displayedOrderNumber status paymentStatus created updated currency total lineItems{id name title sku quantity price catalogReference{catalogId{key}}}} cursor hasNextPage}}',
      variables: { filter: `updated > datetime('${since}')`, limit: WIX_PAGE_SIZE, cursor },
    });
    if (!r.ok) throw new Error(`Wix 拉单失败：${apiErr(r.data, r.status)}`);
    const body = r.data?.data ?? r.data ?? {};
    const rows = pickArr(body, ['items', 'orders', 'results']);
    for (const o of rows) {
      const n = wixOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    cursor = firstStr(deepGet(body, ['cursor', 'nextCursor']), r.data?.cursor);
    const more = deepGet(body, ['hasNextPage', 'more']);
    if (!cursor || more === false || more === 'false' || rows.length < WIX_PAGE_SIZE || out.length >= ctx.maxOrders) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Wix 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 27：Magento 2（REST V1 · OAuth1.0a 换得的 Admin Token）
//   凭据：store_domain + access_token（Magento 侧 integration / admin token）
//         Magento 的 OAuth1.0a 三段式握手（request token → 后台授权 → access token）必须在
//         商城后台建 integration 手工完成，ERP 侧无法自动跑通
//         → access_token 未回填时硬失败，不静默返回空
//   接口：GET {base}/orders?searchCriteria[...] Bearer；返回 { items: [...], search_result_count }
//   状态：order.state（pending/processing/complete/closed/holded/payment_review…）
//         注意用 state 而非 status（status 是带父级的组合串，state 才是主流程）
//   分页：searchCriteria[currentPage] 从 1 起（Magento 惯例，0 会被当成 1）
// ═══════════════════════════════════════════════════════════════════
const MAGE_PAGE_SIZE = 100;

const MAGE_STATUS_MAP: Record<string, string> = {
  'new': '待处理',
  'pending': '待处理',
  'pending_payment': '待处理',
  'pending_paypal': '待处理',
  'processing': '待发货',
  'complete': '已完成',
  'closed': '已取消',
  'canceled': '已取消',
  'holded': '待审核',
  'payment_review': '待审核',
  'fraud': '待审核',
  'miapp_om_manual': '售后中',
  'mijixusaser': '售后中',
  'wrlcm_creditmemo_full': '售后中',
};
function mapMageStatus(raw: unknown): string {
  return MAGE_STATUS_MAP[toStr(raw).toLowerCase()] ?? '待处理';
}
function mageConn(creds: Record<string, unknown>, shop: SyncShop) {
  const domain = firstStr(creds.store_domain, creds.shop_domain, shop.shop_domain)
    .replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const token = firstStr(creds.access_token, envOpt('MAGENTO_ACCESS_TOKEN'));
  if (!domain) throw new Error('Magento 凭据不完整（缺店铺域名 store_domain），请重新授权');
  if (!token) throw new Error('Magento OAuth1.0a 集成尚未就绪：缺少 Admin Access Token（需在商城后台 System → Integrations 建 OAuth1.0a integration 并回写令牌），请重新授权');
  const base = firstStr(creds.api_base, envOpt('MAGENTO_API_BASE')).replace(/\/+$/, '') || `https://${domain}/rest/V1`;
  return {
    token, base,
    storeViewCode: firstStr(creds.store_view_code, ''),
    async get(pathAndQuery: string): Promise<PlatResp> {
      return await getJson(`${base}${pathAndQuery}`, { Authorization: `Bearer ${token}`, Accept: 'application/json' });
    },
  };
}
function mageAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  return [toStr(a.street), toStr(a.city), toStr(a.region), toStr(a.postcode), toStr(a.country_id)].filter(Boolean).join(', ');
}
function mageOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.entity_id, o.id);
  if (!platformId) return null;
  const externalId = `MAGE-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.items) ? o.items : [];
  const billing = o.billing_address ?? {};
  const shipping = o.shipping_address ?? {};
  const qty = items.reduce((s, it) => s + (toNum(it.qty_ordered ?? it.quantity_ordered) || 1), 0);
  const rawStatus = firstStr(o.status, o.state);
  const status = o.state ? mapMageStatus(o.state) : mapMageStatus(rawStatus);
  const createdMs = parseTime(o.created_at);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updated_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Magento'),
      buyer: firstStr(shipping.firstname ?? billing.firstname, [toStr(billing.firstname), toStr(billing.lastname)].join(' ').trim(), toStr(billing.email), toStr(o.customer_email)) || 'Guest',
      product: summaryProduct(toStr(items[0]?.name), qty, items.length),
      sku: toStr(items[0]?.sku),
      phone: firstStr(shipping.telephone, billing.telephone, o.customer_telephone),
      items: items.slice(0, 20).map((it) => ({ name: toStr(it.name), sku: toStr(it.sku), qty: toNum(it.qty_ordered ?? it.quantity_ordered) || 1 })),
      amount: toAmount(firstNum(o.grand_total, o.total_due, o.base_grand_total)),
      currency: toCurrency(firstStr(o.order_currency_code, o.global_currency_code), ''),
      status,
      address: mageAddr(shipping) || mageAddr(billing),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: toStr(o.increment_id) ? `Magento 单号 ${toStr(o.increment_id)} | 状态 ${rawStatus || '-'}` : (rawStatus ? `Magento 状态 ${rawStatus}` : ''),
    },
  };
}
async function magePull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = mageConn(ctx.creds, ctx.shop);
  const since = new Date(ctx.sinceMs).toISOString().replace(/\.\d{3}Z$/, '');   // Magento 接受 "YYYY-MM-DDTHH:MM:SS"（无 Z）
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      'searchCriteria[pageSize]': String(MAGE_PAGE_SIZE),
      'searchCriteria[currentPage]': String(page),
      'searchCriteria[filter_groups][0][filters][0][field]': 'updated_at',
      'searchCriteria[filter_groups][0][filters][0][value]': since,
      'searchCriteria[filter_groups][0][filters][0][condition_type]': 'from',
      'searchCriteria[sortOrders][0][field]': 'updated_at',
      'searchCriteria[sortOrders][0][direction]': 'ASC',
    });
    if (cli.storeViewCode) q.set('storeViewCode', cli.storeViewCode);
    const r = await cli.get(`/orders?${q.toString()}`);
    if (!r.ok) throw new Error(`Magento 拉单失败：${apiErr(r.data, r.status)}`);
    const rows = Array.isArray(r.data?.items) ? r.data.items : pickArr(r.data, ['items', 'order']);
    for (const o of rows) {
      const n = mageOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(r.data, ['search_result_count', 'total_count']));
    if (rows.length < MAGE_PAGE_SIZE || out.length >= ctx.maxOrders || (total > 0 && page * MAGE_PAGE_SIZE >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Magento 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 28：PrestaShop（Webservice API · API Key Basic Auth）
//   凭据：store_domain + api_key（后台 「Advanced Parameters → Webservice → Enable + 生成 Key」）
//   鉴权：Authorization: Basic base64(api_key:) —— Presta 把 Key 放 username 位，密码留空
//   接口：GET {base}/api/orders?filter[date_upd]=[>=]Y-m-d H:i:s&display=full&associations=display&limit=100&page=N&JSON=1
//         Webservice 默认吐 XML，带 JSON=1 才返回 JSON；店铺未开 JSON 输出时显式报错不猜
//   状态：current_order_state（=order_state 主键，后台可自定义名称）→ 按官方默认 1~7 映射
//         1 等待付款 / 2 处理中 / 3 待发货 / 4 部分发货 / 5 已发货 / 6 已完成 / 7 退款
//   分页：page 从 1 起，返回条数 < limit 即结束
//   买家：/api/orders 不直接给地址明文（需再取 addresses 关联）→ 留空，不编造
// ═══════════════════════════════════════════════════════════════════
const PRESTA_PAGE_SIZE = 100;

const PRESTA_STATE_MAP: Record<string, string> = {
  '1': '待处理',
  '2': '待发货',
  '3': '待发货',
  '4': '已发货',
  '5': '已发货',
  '6': '已完成',
  '7': '已取消',
  // 名称兜底（商家会改 order_state 显示名，数值才是稳定键）
  'awaiting payment': '待处理', 'payment required': '待处理',
  'processing': '待发货', 'shipped': '已发货', 'preparation': '待发货',
  'complete': '已完成', 'delivered': '已完成', 'refunded': '已取消', 'canceled': '已取消',
};
function mapPrestaStatus(raw: unknown): string {
  const k = toStr(raw).toLowerCase().trim();
  return PRESTA_STATE_MAP[k] ?? (Number(k) >= 8 ? '售后中' : '待处理');
}
function prestaConn(creds: Record<string, unknown>, shop: SyncShop) {
  const domain = firstStr(creds.store_domain, creds.shop_domain, shop.shop_domain).replace(/\/+$/, '');
  const apiKey = firstStr(creds.api_key, creds.access_key, envOpt('PRESTASHOP_API_KEY'));
  if (!domain || !apiKey) throw new Error('PrestaShop 凭据不完整（缺店铺域名或 Webservice API Key），请在后台「参数设置 → Webservice」生成 Key 后重新授权');
  const host = domain.replace(/^https?:\/\//i, '');
  const root = firstStr(creds.api_prefix, '/api');
  const base = `${domain.startsWith('http') ? domain : `https://${host}`}${root.startsWith('/') ? root : `/${root}`}`.replace(/\/+$/, '');
  return {
    apiKey, base,
    async get(pathAndQuery: string): Promise<PlatResp> {
      return await getJson(`${base}${pathAndQuery}`, { Authorization: `Basic ${btoa(`${apiKey}:`)}`, Accept: 'application/json' });
    },
  };
}
function prestaNode(o: any): Record<string, any> {
  // Webservice JSON 形态：{"order":{...}} 或 {"orders":[{"order":{...}}]}
  const head = o?.order ?? o;
  const refs = (head?.references ?? {}) as Record<string, any>;
  return { ...refs, ...head };
}
function prestaOrderToNorm(shop: SyncShop, raw: Record<string, any>): NormOrder | null {
  const o = prestaNode(raw);
  const platformId = firstStr(o.id, o.id_order);
  if (!platformId) return null;
  const externalId = `PRESTA-${shop.id.slice(0, 8)}-${platformId}`;
  const createdMs = parseTime(o.date_add);
  const rawStatus = firstStr(o.current_order_state, o.id_order_state, o.order_state, o.state);
  const status = mapPrestaStatus(rawStatus);
  const total = firstNum(o.total_paid_real, o.total_paid, o.total_order_paid_4);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.date_upd) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'PrestaShop'),
      buyer: firstStr(o.customer, o.reference, 'Guest'),   // 列表只给 customer_id，姓名需再取关联 → 不编造
      product: summaryProduct(toStr(o.product_name), toNum(o.total_quantity ?? o.quantity), 0),
      sku: toStr(o.reference),
      phone: toStr(o.phone ?? o.mobile),
      items: [],
      amount: toAmount(total),
      currency: toCurrency(firstStr(o.currency_iso_code, o.currency, o.id_currency), ''),
      status,
      address: '',
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `PrestaShop 单号 ${toStr(o.reference) || platformId} | 状态 ${rawStatus || '-'}`,
    },
  };
}
async function prestaPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = prestaConn(ctx.creds, ctx.shop);
  const iso = (ms: number) => {
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  };
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      'filter[date_upd]': `[>=]${iso(ctx.sinceMs)}`,
      'display': 'full',
      'limit': String(PRESTA_PAGE_SIZE),
      'page': String(page),
      'JSON': '1',
    });
    if (firstStr(ctx.creds.store_key)) q.set('key', firstStr(ctx.creds.store_key));   // 多店铺 Key 场景
    const r = await cli.get(`/orders?${q.toString()}`);
    if (!r.ok) throw new Error(`PrestaShop 拉单失败：${apiErr(r.data, r.status)}`);
    if (r.data?.raw && /<\?xml|<orders|<order\b/i.test(String(r.data.raw))) {
      throw new Error('PrestaShop 返回 XML（店铺未接受 JSON=1）：请在后台确认 Webservice 已启用并允许 JSON 输出后重试');
    }
    const wrap = Array.isArray(r.data?.orders) ? r.data.orders : pickArr(r.data, ['orders', 'order']);
    for (const item of wrap) {
      const n = prestaOrderToNorm(ctx.shop, item);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const size = toNum(deepGet(r.data, ['size', 'headers', 'prtotal']));
    if (wrap.length < PRESTA_PAGE_SIZE || out.length >= ctx.maxOrders || (size > 0 && page * PRESTA_PAGE_SIZE >= size)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`PrestaShop 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 29~31：Shopline / ShopBase / 店匠 Shoplazza（Shopify 报文同族独立站 SaaS）
//   三家订单结构（orders[] + line_items + customer + 地址块）与游标翻页（Link: rel="next"）
//   与 Shopify 完全同构 → 共用一套归一化 + 翻页实现，只换 base / 鉴权头 / 状态表 / 前缀
//   凭据口径各平台不同，见各 Conn；OAuth 未回填的一律硬失败
// ═══════════════════════════════════════════════════════════════════
const CLONE_PAGE_SIZE = 100;   // Shopline 官方上限 100，取最小公分母

const SHOPLINE_STATUS_MAP: Record<string, string> = {
  'unshipped': '待发货', 'partial': '已发货', 'partially-fulfilled': '已发货', 'shipped': '已发货',
  'fulfilled': '已完成', 'unfulfilled': '待发货', 'incomplete': '待处理', 'paid': '待发货',
  'pending': '待处理', 'closed': '已完成', 'canceled': '已取消', 'cancelled': '已取消',
  'refunded': '售后中', 'unpaid': '待处理',
};
const SHOPBASE_STATUS_MAP: Record<string, string> = {
  'unshipped': '待发货', 'partial': '已发货', 'shipped': '已发货', 'fulfilled': '已完成',
  'unfulfilled': '待发货', 'incomplete': '待处理', 'open': '待处理', 'closed': '已完成',
  'canceled': '已取消', 'cancelled': '已取消', 'refunded': '售后中', 'pending': '待处理',
};
const SHOPLAZZA_STATUS_MAP: Record<string, string> = {
  'unshipped': '待发货', 'partial': '已发货', 'shipped': '已发货', 'fulfilled': '已完成',
  'unfulfilled': '待发货', 'incomplete': '待处理', 'open': '待处理', 'closed': '已完成',
  'canceled': '已取消', 'cancelled': '已取消', 'refunded': '售后中', 'pending': '待处理',
};

function cloneDomain(v: unknown): string {
  return firstStr(v).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}
function cloneOrderToNorm(shop: SyncShop, o: Record<string, any>, channel: string, prefix: string, map: Record<string, string>): NormOrder | null {
  const platformId = firstStr(o.id, o.order_id);
  if (!platformId) return null;
  const externalId = `${prefix}-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.line_items) ? o.line_items : [];
  const cust = (o.customer ?? {}) as Record<string, any>;
  const buyer = [toStr(cust.first_name), toStr(cust.last_name)].join(' ').trim() || toStr(cust.email) || 'Guest';
  const ship = shopifyAddr(o.shipping_address as Record<string, any>);
  const rawStatus = firstStr(o.fulfillment_status, o.financial_status, o.order_status, o.status);
  const status = toStr(o.cancelled_at) ? '已取消' : (map[rawStatus.toLowerCase()] ?? '待处理');
  const createdMs = parseTime(o.created_at);
  const qty = items.reduce((s, it) => s + (toNum(it.quantity) || 1), 0);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updated_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, channel),
      buyer,
      product: summaryProduct(toStr(items[0]?.name ?? items[0]?.title), qty, items.length),
      sku: toStr(items[0]?.sku),
      phone: firstStr(cust.phone, o.shipping_address?.phone, o.billing_address?.phone),
      items: items.slice(0, 20).map((it) => ({ name: toStr(it.name ?? it.title), sku: toStr(it.sku), qty: toNum(it.quantity) })),
      amount: toAmount(firstNum(o.total_price, o.total_price_set?.shop_money?.amount, o.current_total_price)),
      currency: toCurrency(firstStr(o.currency, o.currency_code), ''),
      status,
      address: ship || shopifyAddr(o.billing_address as Record<string, any>),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: toStr(o.name) ? `${channel} 单号 ${toStr(o.name)}` : (rawStatus ? `${channel} 状态 ${rawStatus}` : ''),
    },
  };
}
/** 三家共用的翻页拉取：updated_at_min 水位 + Link 头游标（Shopify 兼容协议） */
async function clonePull(
  ctx: FetchCtx, channel: string, prefix: string, map: Record<string, string>,
  cli: { get(pathAndQuery: string): Promise<PlatResp> }, limit: number,
): Promise<NormOrder[]> {
  const since = encodeURIComponent(new Date(ctx.sinceMs).toISOString().replace(/\.\d{3}Z$/, 'Z'));
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  let url = `/orders.json?status=any&limit=${limit}&updated_at_min=${since}`;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const r = await cli.get(url);
    if (!r.ok) throw new Error(`${channel} 拉单失败：${apiErr(r.data, r.status)}`);
    const rows = Array.isArray(r.data?.orders) ? r.data.orders : pickArr(r.data, ['orders', 'items', 'data']);
    for (const o of rows) {
      const n = cloneOrderToNorm(ctx.shop, o, channel, prefix, map);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    if (rows.length < limit || out.length >= ctx.maxOrders) break;
    url = shopifyNextLink(r.link);
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`${channel} 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ── 29 Shopline ─────────────────────────────────────────────────────
//   凭据：shop_domain + access_token（应用 OAuth 回写）· app_key（X-SL-App-Key）
//   官方现行口径：GET https://{handle}.myshopline.com/admin/openapi/v{YYYYMMDD}/orders.json
//                 头 Authorization: Bearer + Content-Type: application/json（link 头游标 pageinfo）
//                 旧版开放平台 {domain}/api/open/1 仍可用 → 凭据 api_base 可整体覆盖
//   注意：Shopline 单页上限 100（默认 50），传 250 会被拒
// ────────────────────────────────────────────────────────────────────
function shoplineConn(creds: Record<string, unknown>, shop: SyncShop) {
  const domain = cloneDomain(firstStr(creds.shop_domain, creds.store_domain, shop.shop_domain));
  const token = firstStr(creds.access_token, creds.api_key, envOpt('SHOPLINE_ACCESS_TOKEN'));
  if (!domain) throw new Error('Shopline 凭据不完整（缺店铺域名 shop_domain），请重新授权');
  if (!token) throw new Error('Shopline OAuth 流程尚未就绪：缺少 Access Token（需在 Shopline 合作伙伴后台完成应用授权并回写凭据），请重新授权');
  const version = firstStr(creds.api_version, envOpt('SHOPLINE_API_VERSION'), 'v20241201');
  const base = firstStr(creds.api_base, envOpt('SHOPLINE_API_BASE')).replace(/\/+$/, '')
    || (/myshopline\.com$/i.test(domain) ? `https://${domain}/admin/openapi/${version}` : `https://${domain}/api/open/1`);
  const appKey = firstStr(creds.app_key, envOpt('SHOPLINE_APP_KEY'));
  return {
    async get(pathAndQuery: string): Promise<PlatResp> {
      // Shopline 第 2 页起 Link 头给的是绝对 URL（同 Shopify 游标口径）
      const url = /^https?:\/\//i.test(pathAndQuery) ? pathAndQuery : `${base}${pathAndQuery}`;
      return await getJson(url, {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        ...(appKey ? { 'X-SL-App-Key': appKey } : {}),
      });
    },
  };
}
async function shoplinePull(ctx: FetchCtx): Promise<NormOrder[]> {
  return await clonePull(ctx, 'Shopline', 'SHOPLINE', SHOPLINE_STATUS_MAP, shoplineConn(ctx.creds, ctx.shop), CLONE_PAGE_SIZE);
}

// ── 30 ShopBase ─────────────────────────────────────────────────────
//   凭据：shop_domain（{shop}.myshopbase.com / onshopbase.com）+ access_token
//   官方 Open API：GET https://{domain}/api/{version}/orders.json（updated_at_min / limit）
//   鉴权头：X-ShopbaseAccess-Token；老版 Basic（username:password）仍广泛存在 → 二者择一
//   状态：ShopBase 沿用 Shopify 串（unshipped/shipped/…）+ 自身 order_status
// ────────────────────────────────────────────────────────────────────
function shopbaseConn(creds: Record<string, unknown>, shop: SyncShop) {
  const domain = cloneDomain(firstStr(creds.shop_domain, creds.store_domain, shop.shop_domain));
  const token = firstStr(creds.access_token, creds.api_key, creds.token, envOpt('SHOPBASE_ACCESS_TOKEN'));
  const user = firstStr(creds.username);
  const pass = firstStr(creds.password, creds.api_password);
  if (!domain) throw new Error('ShopBase 凭据不完整（缺店铺域名 shop_domain），请重新授权');
  if (!token && !(user && pass)) {
    throw new Error('ShopBase 凭据不完整：缺少 Access Token（X-ShopbaseAccess-Token），或缺少 username/password（旧版 Basic 鉴权）。请在 ShopBase 应用后台完成授权后重新填写');
  }
  const version = firstStr(creds.api_version, envOpt('SHOPBASE_API_VERSION'), '2023-10');
  const base = firstStr(creds.api_base, envOpt('SHOPBASE_API_BASE')).replace(/\/+$/, '') || `https://${domain}/api/${version}`;
  return {
    async get(pathAndQuery: string): Promise<PlatResp> {
      const url = /^https?:\/\//i.test(pathAndQuery) ? pathAndQuery : `${base}${pathAndQuery}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (token) headers['X-ShopbaseAccess-Token'] = token;
      else headers.Authorization = `Basic ${btoa(`${user}:${pass}`)}`;
      return await getJson(url, headers);
    },
  };
}
async function shopbasePull(ctx: FetchCtx): Promise<NormOrder[]> {
  return await clonePull(ctx, 'ShopBase', 'SHOPBASE', SHOPBASE_STATUS_MAP, shopbaseConn(ctx.creds, ctx.shop), CLONE_PAGE_SIZE);
}

// ── 31 店匠 Shoplazza ───────────────────────────────────────────────
//   凭据：shop_domain + access_token（店匠应用中心 OAuth 回写）
//   官方口径与 Shopify 同构：GET https://{domain}/admin/api/{version}/orders.json
//   鉴权头：店匠文档出现过 X-Shopify-Access-Token（克隆血统）与 Bearer 两种 → 两个都发，
//           由平台取其一；未回填令牌时硬失败
// ────────────────────────────────────────────────────────────────────
function shoplazzaConn(creds: Record<string, unknown>, shop: SyncShop) {
  const domain = cloneDomain(firstStr(creds.shop_domain, creds.store_domain, shop.shop_domain));
  const token = firstStr(creds.access_token, creds.api_key, creds.token, envOpt('SHOPLAZZA_ACCESS_TOKEN'));
  if (!domain) throw new Error('店匠 Shoplazza 凭据不完整（缺店铺域名 shop_domain），请重新授权');
  if (!token) throw new Error('店匠 Shoplazza OAuth 流程尚未就绪：缺少 Access Token（需在山海云/店匠应用中心完成店铺授权并回写凭据），请重新授权');
  const version = firstStr(creds.api_version, envOpt('SHOPLAZZA_API_VERSION'), '2023-04');
  const base = firstStr(creds.api_base, envOpt('SHOPLAZZA_API_BASE')).replace(/\/+$/, '') || `https://${domain}/admin/api/${version}`;
  return {
    async get(pathAndQuery: string): Promise<PlatResp> {
      const url = /^https?:\/\//i.test(pathAndQuery) ? pathAndQuery : `${base}${pathAndQuery}`;
      return await getJson(url, {
        Authorization: `Bearer ${token}`,
        'X-Shopify-Access-Token': token,
        Accept: 'application/json',
      });
    },
  };
}
async function shoplazzaPull(ctx: FetchCtx): Promise<NormOrder[]> {
  return await clonePull(ctx, '店匠Shoplazza', 'SHOPLAZZA', SHOPLAZZA_STATUS_MAP, shoplazzaConn(ctx.creds, ctx.shop), CLONE_PAGE_SIZE);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 32：UEESHOP（自建独立站 SaaS）—— 诚实挂起
//   公开渠道只有 UEESHOP 建站后台说明，无面向第三方 ERP 的订单 REST 文档：
//   签名口径（access_key_secret 参与哪种摘要）、订单端点、分页参数均无公开规范
//   → 不伪造端点。注册为「代码已登记、平台侧待开通」，同步时明确失败并提示走平台对接
// ═══════════════════════════════════════════════════════════════════
const UEESHOP_BLOCK_MSG = 'UEESHOP 订单 API 暂未对接：官方未公开面向第三方 ERP 的订单接口与签名规范，需联系 UEESHOP 服务商开通开放平台并回签接口文档后再接通';
function ueeshopConn(_creds: Record<string, unknown>): never {
  throw new Error(UEESHOP_BLOCK_MSG);
}
async function ueeshopPull(_ctx: FetchCtx): Promise<NormOrder[]> {
  throw new Error(UEESHOP_BLOCK_MSG);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 33：Shopyy（自建独立站 SaaS）—— 诚实挂起
//   与 UEESHOP 同因：无公开订单 API 文档（站内仅有「API 授权」开关，无端点/签名规范），
//   贸然按猜测的 /api/orders 打过去只会得到 404 并污染同步日志
//   → 注册但不伪造，同步时明确失败并提示走平台对接
// ═══════════════════════════════════════════════════════════════════
const SHOPYY_BLOCK_MSG = 'Shopyy 订单 API 暂未对接：官方未公开面向第三方 ERP 的订单接口与鉴权规范，需在 Shopyy 后台申请开放平台权限并回签接口文档后再接通';
function shopyyConn(_creds: Record<string, unknown>): never {
  throw new Error(SHOPYY_BLOCK_MSG);
}
async function shopyyPull(_ctx: FetchCtx): Promise<NormOrder[]> {
  throw new Error(SHOPYY_BLOCK_MSG);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 34：Salla（沙特建站 SaaS · Partner OAuth2 Bearer）
//   凭据：access_token（应用 OAuth 回写）· refresh_token + app_id/app_secret（配 token_url 时
//         现场换令牌并按 expires_in 缓存进 ctx.shared，单次同步多页复用）
//         api_base：Salla 授权响应里回的是「该店铺专属域名」→ 优先用凭据里的 api_base/store_url
//   接口：GET {base}/api/v1/orders?filter[status]=ALL&filter[date_from]=YYYY-MM-DD&filter[date_to]=YYYY-MM-DD&limit=&page=
//   响应：{ data: [...], meta: { pagination: { current_page, total_pages, per_page } } }
//   时间：filter[date_from/date_to] 只到「日」粒度（平台口径），故水位按天回退重扫，幂等靠 externalId
//   状态：PENDING/PAID/ON_DELIVERY/SHIPPED/DELIVERED/COMPLETED/CANCELED/RETURNED
// ═══════════════════════════════════════════════════════════════════
const SALLA_PAGE_SIZE = 100;

const SALLA_STATUS_MAP: Record<string, string> = {
  'pending': '待处理',
  'awaiting_payment': '待处理',
  'unpaid': '待处理',
  'paid': '待发货',
  'completed_payment': '待发货',
  'shipped': '已发货',
  'on_delivery': '已发货',
  'out_for_delivery': '已发货',
  'delivered': '已完成',
  'completed': '已完成',
  'canceled': '已取消',
  'cancelled': '已取消',
  'returned': '售后中',
  'partially_returned': '售后中',
  'return_requested': '售后中',
};
function mapSallaStatus(raw: unknown): string {
  return SALLA_STATUS_MAP[toStr(raw).toLowerCase().replace(/-/g, '_')] ?? '待处理';
}
const sallaDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
async function sallaToken(cli: { token: string, appId: string, appSecret: string, refreshToken: string, tokenUrl: string }, ctx: FetchCtx): Promise<string> {
  if (cli.token) return cli.token;
  const cached = String(ctx.shared.sallaToken ?? '');
  const expMs = Number(ctx.shared.sallaTokenExp ?? 0);
  if (cached && expMs > Date.now() + 60_000) return cached;
  if (!cli.appId || !cli.appSecret || !cli.refreshToken || !cli.tokenUrl) {
    throw new Error('Salla OAuth 流程尚未就绪：缺少 Access Token（且未同时配齐 app_id / app_secret / refresh_token / token_url 以现场换令牌），请在 Salla Partner 完成店铺授权后重新授权');
  }
  const res = await fetchDirect(cli.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: cli.refreshToken, client_id: cli.appId, client_secret: cli.appSecret }).toString(),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
  const accessToken = firstStr(data?.access_token);
  if (!res.ok || !accessToken) throw new Error(`Salla 换取 Access Token 失败：${apiErr(data, res.status)}`);
  ctx.shared.sallaToken = accessToken;
  ctx.shared.sallaTokenExp = Date.now() + Math.max(60, toNum(data.expires_in) - 60) * 1000;
  return accessToken;
}
function sallaConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.token, envOpt('SALLA_ACCESS_TOKEN'));
  const appId = firstStr(creds.app_id, envOpt('SALLA_APP_ID'));
  const appSecret = firstStr(creds.app_secret, envOpt('SALLA_APP_SECRET'));
  const refreshToken = firstStr(creds.refresh_token, envOpt('SALLA_REFRESH_TOKEN'));
  const tokenUrl = firstStr(creds.token_url, envOpt('SALLA_TOKEN_URL'));
  if (!token && !(appId && appSecret && refreshToken && tokenUrl)) {
    throw new Error('Salla OAuth 流程尚未就绪：缺少 Access Token（需在 Salla Partner 平台完成应用授权并回写凭据），请重新授权');
  }
  // Salla 的店铺 API 域名来自授权响应；未回填时退回公共网关域名，路径统一补 /api/v1
  const rawBase = firstStr(creds.api_base, creds.store_url, creds.base_url, envOpt('SALLA_API_BASE'), 'https://api.salla.dev');
  const base = rawBase.replace(/\/+$/, '').replace(/\/api\/v\d+.*$/i, '');
  return {
    token, appId, appSecret, refreshToken, tokenUrl,
    base: `${base}/api/v1`,
  };
}
function sallaAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  return [toStr(a.address ?? a.address_line_1), toStr(a.address_line2), toStr(a.city), toStr(a.region),
    toStr(a.postal_code), toStr(a.country)].filter(Boolean).join(', ');
}
function sallaOrderToNorm(shop: SyncShop, o: Record<string, any>): NormOrder | null {
  const platformId = firstStr(o.id, o.uuid, o.reference);
  if (!platformId) return null;
  const externalId = `SALLA-${shop.id.slice(0, 8)}-${platformId}`;
  const items: any[] = Array.isArray(o.products) ? o.products : (Array.isArray(o.items) ? o.items : []);
  const cust = (o.customer ?? {}) as Record<string, any>;
  const ship = (o.shipping ?? o.shipping_address ?? {}) as Record<string, any>;
  const rawStatus = firstStr(o.status, o.order_status);
  const status = toStr(o.cancelled_at) ? '已取消' : mapSallaStatus(rawStatus);
  const createdMs = parseTime(o.created_at ?? o.date);
  const qty = items.reduce((s, it) => s + (toNum(it.quantity) || 1), 0);
  return {
    externalId,
    status,
    modifiedMs: parseTime(o.updated_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Salla'),
      buyer: firstStr(cust.name, toStr(o.username), toStr(cust.email)) || 'Guest',
      product: summaryProduct(toStr(items[0]?.product_name ?? items[0]?.name), qty, items.length),
      sku: firstStr(items[0]?.sku, items[0]?.product_sku),
      phone: firstStr(cust.mobile, o.mobile, ship.phone),
      items: items.slice(0, 20).map((it) => ({ name: toStr(it.product_name ?? it.name), sku: toStr(it.sku ?? it.product_sku), qty: toNum(it.quantity) })),
      amount: toAmount(firstNum(o.total, o.total_with_vat, o.invoice_total)),
      currency: toCurrency(firstStr(o.currency, o.pricing?.currency, ship.country_code), 'SAR'),
      status,
      address: sallaAddr(ship) || sallaAddr(o.billing_address),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `Salla 单号 ${toStr(o.reference) || platformId} | 状态 ${rawStatus || '-'}`,
    },
  };
}
async function sallaPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = sallaConn(ctx.creds);
  const accessToken = await sallaToken(cli, ctx);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      'filter[status]': 'ALL',
      'filter[date_from]': sallaDay(ctx.sinceMs),
      'filter[date_to]': sallaDay(ctx.untilMs),
      'limit': String(SALLA_PAGE_SIZE),
      'page': String(page),
    });
    const r = await getJson(`${cli.base}/orders?${q.toString()}`, { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' });
    if (!r.ok) throw new Error(`Salla 拉单失败：${apiErr(r.data, r.status)}`);
    const rows = Array.isArray(r.data?.data) ? r.data.data : pickArr(r.data, ['data', 'orders']);
    for (const o of rows) {
      const n = sallaOrderToNorm(ctx.shop, o);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const totalPages = toNum(deepGet(r.data, ['total_pages', 'last_page', 'pages']));
    if (rows.length < SALLA_PAGE_SIZE || out.length >= ctx.maxOrders || (totalPages > 0 && page >= totalPages)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Salla 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 35：AllValue（台湾建站 SaaS）—— 诚实挂起
//   AllValue 开放接口需向平台申请「开发商配对金钥」，公开文档只有商品/库存类，
//   订单读取接口未对第三方 ERP 公开 → 不伪造端点，同步时明确失败并提示联系平台方
// ═══════════════════════════════════════════════════════════════════
const ALLVALUE_BLOCK_MSG = 'AllValue 暂未开放公开订单 API，需联系平台方对接（AllValue 开发商配对金钥仅开放商品/库存接口，订单需另行申请）';
function allvalueConn(_creds: Record<string, unknown>): never {
  throw new Error(ALLVALUE_BLOCK_MSG);
}
async function allvaluePull(_ctx: FetchCtx): Promise<NormOrder[]> {
  throw new Error(ALLVALUE_BLOCK_MSG);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 36：Miravia（阿里西班牙平台 · iop 网关，与 Lazada/Daraz 同一套 TOP 签名）
//   凭据：app_key + app_secret + access_token（卖家授权 session，兼容 seller_account）
//         api_base / api_method / sign_method 均可覆盖（Miravia 开放平台按站点灰度发布，
//         方法名在 order.get 与 orders.get 间有版本差异 → 不硬编码唯一口径）
//   接口：POST {base} 表单，公共参数 app_key/method/sign/sign_method/timestamp/v/session + 业务参数
//   状态：iop 与 Lazada 同族词表（unpaid/pending/packing/shipped/delivered/canceled/returned…）
//   分页：limit/offset（与 Daraz 一致）；平台按创建时间过滤 → 每次重扫近 30 天回刷状态
// ═══════════════════════════════════════════════════════════════════
const MIRAVIA_API = 'https://api.miravia.com/rest';
const MIRAVIA_PAGE_SIZE = 100;
const MIRAVIA_RESCAN_MS = 30 * 86400_000;

const MIRAVIA_STATUS_MAP: Record<string, string> = {
  'unpaid': '待处理',
  'unverified': '待审核',
  'pending': '待审核',
  'packaged': '待发货',
  'packing': '待发货',
  'packed': '待发货',
  'ready_to_ship': '待发货',
  'ready_to_ship_pending': '待发货',
  'shipped': '已发货',
  'in_transit': '已发货',
  'delivered': '已完成',
  'completed': '已完成',
  'delivered_unconfirmed': '已完成',
  'canceled': '已取消',
  'cancelled': '已取消',
  'cancel_pending': '待审核',
  'returned': '售后中',
  'return_requested': '售后中',
  'return_moving': '售后中',
  'return_completed': '售后中',
  'lost': '售后中',
  'damaged': '售后中',
};
function mapMiraviaStatus(raw: unknown): string {
  return MIRAVIA_STATUS_MAP[toStr(raw).toLowerCase().replace(/-/g, '_')] ?? '待处理';
}
function miraviaConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('MIRAVIA_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('MIRAVIA_APP_SECRET'));
  const session = firstStr(creds.access_token, creds.session, creds.seller_account, envOpt('MIRAVIA_SESSION'));
  if (!appKey || !appSecret) throw new Error('Miravia 凭据不完整（缺 App Key / App Secret；App Secret 建议配置在环境变量 MIRAVIA_APP_SECRET），请重新授权');
  if (!session) throw new Error('Miravia OAuth 流程尚未就绪：缺少卖家 Access Token（session），需在 Miravia 开放平台完成卖家授权后回写凭据');
  const apiBase = firstStr(creds.api_base, envOpt('MIRAVIA_API_BASE'), MIRAVIA_API).replace(/\/+$/, '');
  return {
    appKey, appSecret, session, apiBase,
    method: firstStr(creds.api_method, envOpt('MIRAVIA_API_METHOD'), 'miravia.order.get'),
    signMethod: firstStr(creds.sign_method, 'md5').toLowerCase(),
    currency: toCurrency(creds.currency, 'EUR'),
    async call(biz: Record<string, string>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: appKey, sign_method: this.signMethod, format: 'json', v: '2.0',
        timestamp: topTimestamp(Date.now()), method: this.method,
        ...biz, session: this.session,
      };
      params.sign = await topSign(topConcat(params), appSecret, this.signMethod === 'sha256' ? 'sha256' : 'md5', true);
      const res = await fetchDirect(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
function miraviaAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.address1 ?? a.address), toStr(a.address2)].filter(Boolean).join(' ');
  return [street, toStr(a.city), toStr(a.state), toStr(a.country), toStr(a.postcode ?? a.zip)].filter(Boolean).join(', ');
}
/** iop 行级返回（order_items）→ 按订单号折叠成一单，与 Daraz 同一手法 */
function miraviaGroupToNorm(shop: SyncShop, orderId: string, rows: any[], cli: ReturnType<typeof miraviaConn>): NormOrder | null {
  if (!orderId) return null;
  const externalId = `MIRAVIA-${shop.id.slice(0, 8)}-${orderId}`;
  const first: any = rows[0] ?? {};
  const createdMs = parseTime(first.created_at ?? first.createdAt ?? first.create_time);
  const rawStatus = firstStr(first.status, first.order_status, rows.map((r: any) => r?.status).filter(Boolean).sort()[0]);
  const status = mapMiraviaStatus(rawStatus);
  let amount = 0;
  let qty = 0;
  for (const r of rows) { amount += firstNum(r.paid_price, r.price) * (toNum(r.quantity) || 1); qty += toNum(r.quantity) || 1; }
  const addrSrc = first.shipping_address ?? first.address ?? first;
  return {
    externalId,
    status,
    modifiedMs: parseTime(first.updated_at ?? first.modified_at) ?? createdMs,
    row: {
      ...rowBase(shop, externalId, 'Miravia'),
      buyer: firstStr(first.customer_name, first.buyer_name, addrSrc.name),
      product: summaryProduct(toStr(first.name ?? first.item_name), qty, rows.length),
      sku: firstStr(first.sku_seller ?? first.seller_sku ?? first.sku_id, first.sku),
      phone: firstStr(first.phone, addrSrc.phone, addrSrc.phone_number),
      items: rows.slice(0, 20).map((r) => ({
        name: toStr(r.name ?? r.item_name),
        sku: toStr(r.sku_seller ?? r.seller_sku ?? r.sku_id ?? r.sku),
        qty: toNum(r.quantity),
      })),
      amount: toAmount(amount),
      currency: toCurrency(first.currency, cli.currency),
      status,
      address: miraviaAddr(addrSrc),
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `Miravia 状态 ${rawStatus || '-'} | 行 ${rows.length}`,
    },
  };
}
async function miraviaPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = miraviaConn(ctx.creds);
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const fromMs = Math.min(ctx.sinceMs, ctx.untilMs - MIRAVIA_RESCAN_MS);
  const out: NormOrder[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const offset = page * MIRAVIA_PAGE_SIZE;
    const r = await cli.call({
      created_after: iso(fromMs), created_before: iso(ctx.untilMs),
      limit: String(MIRAVIA_PAGE_SIZE), offset: String(offset),
    });
    if (!r.ok || r.data?.error_response) throw new Error(`Miravia 拉单失败：${topErr(r.data, r.status)}`);
    const body = r.data?.result ?? r.data?.order_get_response ?? r.data ?? {};
    const flat: any[] = Array.isArray(body.order_items) ? body.order_items : pickArr(body, ['order_items', 'orderItems']);
    const nested: any[] = Array.isArray(body.orders) ? body.orders : pickArr(body, ['orders', 'dataList', 'data']);
    const groups = new Map<string, any[]>();
    const push = (k: string, v: any) => { const a = groups.get(k) ?? []; a.push(v); groups.set(k, a); };
    for (const it of flat) push(firstStr(it.order_id ?? it.orders_id ?? it.trade_order_id), it);
    for (const o of nested) {
      const oid = firstStr(o.order_id ?? o.orders_id ?? o.id);
      const items = Array.isArray(o.order_items) && o.order_items.length > 0 ? o.order_items : [o];
      for (const it of items) push(oid, { ...o, ...it });
    }
    if (groups.size === 0) break;
    for (const [oid, rows] of groups) {
      const n = miraviaGroupToNorm(ctx.shop, oid, rows, cli);
      if (n) out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(body, ['total_count', 'totalCount', 'count', 'total']));
    const pageCount = flat.length + nested.length;
    if (pageCount < MIRAVIA_PAGE_SIZE || out.length >= ctx.maxOrders || (total > 0 && offset + pageCount >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`Miravia 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}


// ═══════════════════════════════════════════════════════════════════
// 批次 5 公共件（适配器 37~54）
//   这批以「区域市场 + 独立开放平台」为主，字段名/包装层各家不同，且多家平台的
//   订单接口文档在合作方账号后面（不公开）→ 统一两件套：
//     1) restPull / restGroupNorm：防御式解析（集合键、单号键、金额键、地址键全部候选），
//        平台给什么就落什么，缺字段留空，绝不编造（红线 5）
//     2) docConn / docPull：配置驱动请求 —— 只内置「公开文档可确认」的域名与路径；
//        未确认的必须显式回填 orders_path / api_base，否则同步时明确失败并说明缺什么
//        （红线：不拿猜出来的 URL 去打平台，免得污染同步日志）
// ═══════════════════════════════════════════════════════════════════
interface RestMeta {
  plat: string;      // 错误前缀 + remark 里的平台名
  prefix: string;    // externalId 前缀
  channel: string;   // orders.channel
  currency: string;  // 平台未回币种时的兜底币种
  map: Record<string, string>;
  idKeys: string[];  // 平台单号候选键（deepGet 逐层找，命中即用）
  /** 平台不给状态字段（或需按明细推断）时的覆盖钩子，返回空串表示走通用词表 */
  statusOf?: (rows: any[]) => string;
  /** 行级接口（一单多行、每行只有一个单价）：金额改为按行累加，不取单行值 */
  sumRows?: boolean;
  /** 平台金额单位为「分」（Kaufland price/revenue）：统一 /100 后再落库 */
  amountScale?: number;
  /** 明细行金额口径自定义（Wayfair products[] 给单价 + 数量） */
  lineTotal?: (line: any) => number;
}

const REST_STATUS_RANK = ['待处理', '待审核', '待发货', '已发货', '已完成', '售后中', '已取消'];
const REST_DATE_KEYS = ['created_at', 'createdAt', 'date_created', 'dateCreated', 'order_date', 'orderDate',
  'ts_created_iso', 'placed_at', 'placedAt', 'creation_date', 'creationDate', 'create_date', 'create_date_time', 'createDate', 'created', 'create_time', 'createTime', 'order_time', 'orderCreated', 'poDate'];
const REST_UPD_KEYS = ['updated_at', 'updatedAt', 'last_updated', 'lastUpdated', 'ts_updated_iso', 'ts_units_updated_iso',
  'modified_at', 'modifiedAt', 'status_updated_at', 'update_time', 'updateTime', 'updated', 'modified', 'change_date', 'changed_at', 'shipped_date', 'shippedDate'];
const REST_STATUS_KEYS = ['status', 'order_status', 'orderStatus', 'state', 'order_state', 'orderState',
  'status_code', 'statusCode', 'fulfillment_status', 'fulfillmentStatus', 'payment_status', 'paymentStatus'];
const REST_AMT_KEYS = ['total_amount', 'totalAmount', 'order_amount', 'orderAmount', 'trade_amount', 'tradeAmount', 'order_total', 'orderTotal', 'grand_total', 'grandTotal',
  'paid_amount', 'paidAmount', 'sale_amount', 'saleAmount', 'order_value', 'orderValue', 'amount', 'total', 'value', 'price'];
const REST_LINE_KEYS = ['items', 'order_items', 'orderItems', 'lines', 'order_lines', 'orderLines',
  'products', 'article_lines', 'articles', 'skus', 'positions', 'units'];
const REST_ID_KEYS = ['id', 'order_id', 'orderId', 'order_number', 'orderNumber', 'number', 'reference', 'code', 'uuid'];

/** 状态归一：小写 + 连字符/空格转下划线；词表未命中 → 待处理（宁可多留人工复核，不漏单） */
function mapRestStatus(m: RestMeta, raw: unknown): string {
  const s = toStr(raw);
  if (!s) return '';
  return m.map[s.toLowerCase().replace(/[-\s]+/g, '_')] ?? m.map[s] ?? '';
}
/** 通用地址串（候选键覆盖 snake/camel/平台自造名，缺段就少一段，不补假数据） */
function restAddr(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const street = [toStr(a.street1 ?? a.address1 ?? a.street ?? a.address_line1 ?? a.addressLine1),
    toStr(a.street2 ?? a.address2 ?? a.address_line2 ?? a.house_number)].filter(Boolean).join(' ');
  return [street, toStr(a.city ?? a.town ?? a.locality), toStr(a.state ?? a.province ?? a.region ?? a.county),
    toStr(a.zip ?? a.postcode ?? a.postal_code ?? a.zipCode), toStr(a.country ?? a.country_code ?? a.iso_country)].filter(Boolean).join(', ');
}
/** 单号相同的多行（行级接口）折叠成一单：状态取「最未完成」，金额优先整单、缺则行合计 */
function restGroupNorm(shop: SyncShop, key: string, rows: any[], m: RestMeta): NormOrder | null {
  if (!key) return null;
  const externalId = `${m.prefix}-${shop.id.slice(0, 8)}-${key}`;
  const first: any = rows[0] ?? {};
  const createdMs = parseTime(deepGet(first, REST_DATE_KEYS));
  const updatedMs = parseTime(deepGet(first, REST_UPD_KEYS));
  const rawStatus = firstStr(deepGet(first, REST_STATUS_KEYS));
  let status = '';
  if (m.statusOf) status = m.statusOf(rows) || '';
  if (!status) {
    const mapped = rows.map((r) => mapRestStatus(m, deepGet(r, REST_STATUS_KEYS))).filter(Boolean);
    status = mapped.sort((a, b) => REST_STATUS_RANK.indexOf(a) - REST_STATUS_RANK.indexOf(b))[0] || '待处理';
  }
  const cust: any = deepGet(first, ['customer', 'buyer', 'client', 'personal_data', 'personalData', 'order_customer']) ?? {};
  const ship: any = deepGet(first, ['shipping_address', 'shippingAddress', 'delivery_address', 'deliveryAddress', 'ship_to', 'shipTo', 'receiver', 'address']) ?? {};
  const bill: any = deepGet(first, ['billing_address', 'billingAddress', 'invoice_address', 'bill_to']) ?? {};
  const lines: any[] = [];
  for (const r of rows) {
    const its = pickArr(r, REST_LINE_KEYS);
    if (its.length > 0) lines.push(...its);
    else lines.push(r);
  }
  let amount = 0;
  if (m.lineTotal) for (const l of lines) amount += m.lineTotal(l);
  else if (m.sumRows) for (const r of rows) amount += moneyVal(deepGet(r, REST_AMT_KEYS));
  else amount = moneyVal(deepGet(first, REST_AMT_KEYS));
  if (amount === 0) for (const l of lines) amount += m.lineTotal ? m.lineTotal(l) : moneyVal(deepGet(l, REST_AMT_KEYS));
  if (m.amountScale && m.amountScale !== 1) amount *= m.amountScale;
  const head: any = lines[0] ?? {};
  const name = firstStr(deepGet(head, ['name', 'title', 'product_name', 'productName', 'product_title', 'item_name', 'description']));
  const qty = firstNum(deepGet(head, ['quantity', 'qty', 'count', 'number_of_items'])) || lines.length || 1;
  const addr = restAddr(ship) || restAddr(bill) || (typeof ship === 'string' ? ship : '') || (typeof bill === 'string' ? bill : '');
  const person = (x: any): string => (x && typeof x === 'object')
    ? firstStr(x.name, x.full_name, x.fullName, [toStr(x.first_name), toStr(x.last_name)].filter(Boolean).join(' ')) : '';
  return {
    externalId,
    status,
    modifiedMs: updatedMs ?? createdMs,
    row: {
      ...rowBase(shop, externalId, m.channel),
      buyer: firstStr(person(cust), person(ship), person(bill), deepGet(first, ['customer_name', 'customerName', 'buyer_name', 'buyerName', 'contact_name', 'contactName', 'name'])),
      product: summaryProduct(name, toNum(qty), lines.length),
      sku: firstStr(deepGet(head, ['seller_sku', 'sellerSku', 'sku', 'sku_code', 'skuCode', 'id_offer', 'offer_id', 'reference', 'partNumber', 'ean', 'barcode'])),
      phone: firstStr(cust.phone, cust.mobile, ship.phone, ship.phone_number, bill.phone, deepGet(first, ['phone', 'phone_number', 'phoneNumber', 'telephone', 'mobile'])),
      items: lines.slice(0, 20).map((l) => ({
        name: firstStr(deepGet(l, ['name', 'title', 'product_name', 'productName', 'item_name'])),
        sku: firstStr(deepGet(l, ['seller_sku', 'sellerSku', 'sku', 'sku_code', 'id_offer', 'offer_id', 'reference', 'partNumber', 'barcode'])),
        qty: firstNum(deepGet(l, ['quantity', 'qty', 'count'])) || 1,
      })),
      amount: toAmount(amount),
      currency: toCurrency(deepGet(first, ['currency', 'currency_code', 'currencyCode', 'iso_currency', 'moneyType']), m.currency),
      status,
      address: addr,
      created_at: createdMs ? new Date(createdMs).toISOString() : undefined,
      remark: `${m.plat} 状态 ${rawStatus || '-'} | 行 ${lines.length}`,
    },
  };
}

interface RestReq { url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; xml?: string }
interface RestPageOpt { size?: number; pageStart?: number; useOffset?: boolean; maxPages?: number; filter?: (o: any) => boolean }

/** POST + JSON 统一出口（与 getJson 对称；edge runtime 不解压 gzip → 走 fetchDirect） */
async function postJsonResp(url: string, body: string, headers: Record<string, string> = {}, ctype = 'application/json', ms = 30000): Promise<PlatResp> {
  const res = await fetchDirect(url, { method: 'POST', headers: { 'Content-Type': ctype, Accept: 'application/json', ...headers }, body }, ms);
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  return { ok: res.ok, status: res.status, data, link: '' };
}
/** XML 网关浅层解析：按重复标签切块（如 <order>…</order>），块内取叶子 <tag>文本</tag> */
function xmlBlocks(text: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g');
  let mm = re.exec(text);
  while (mm) { out.push(mm[1]); mm = re.exec(text); }
  return out;
}
/** 值里允许整段 CDATA（`<![CDATA[Max Me]]>` 含 `<`，否则叶子正则匹配不到） */
function xmlFields(block: string): Record<string, string> {
  const o: Record<string, string> = {};
  const re = /<([\w:.-]+)(?:\s[^>]*)?>((?:[^<]|<!\[CDATA\[[\s\S]*?\]\])*)<\/\1>/g;
  let mm = re.exec(block);
  while (mm) {
    const v = mm[2].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    if (o[mm[1]] === undefined) o[mm[1]] = v;
    mm = re.exec(block);
  }
  return o;
}
function xmlToRows(text: string, itemTag: string): any[] {
  return xmlBlocks(text, itemTag).map(xmlFields);
}

/** 通用翻页：build 每页给出请求；空集合 / 不足页大小 / 命中 total 即停；达 ctx.maxOrders 停止并 warn */
async function restPull(ctx: FetchCtx, m: RestMeta, build: (page: number, size: number, offset: number) => RestReq | Promise<RestReq>, opt?: RestPageOpt): Promise<NormOrder[]> {
  const size = opt?.size ?? 100;
  const start = opt?.pageStart ?? 1;
  const maxPages = opt?.maxPages ?? MAX_PAGES;
  const useOffset = opt?.useOffset === true;
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < maxPages; i++) {
    const page = start + i;
    const offset = i * size;
    const rq = await build(useOffset ? offset : page, size, offset);
    let r: PlatResp;
    if (rq.xml) {
      const res = await fetchDirect(rq.url, {
        method: rq.method ?? 'GET',
        headers: { Accept: 'application/xml,text/xml,application/json', ...(rq.headers ?? {}) },
        ...(rq.body ? { body: rq.body } : {}),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${m.plat} 拉单失败：${apiErr({ raw: text.slice(0, 300) }, res.status)}`);
      r = { ok: true, status: res.status, data: { results: xmlToRows(text, rq.xml) }, link: '' };
    } else if ((rq.method ?? 'GET') === 'POST') {
      r = await postJsonResp(rq.url, rq.body ?? '{}', rq.headers ?? {});
    } else {
      r = await getJson(rq.url, rq.headers ?? {});
    }
    if (!r.ok) throw new Error(`${m.plat} 拉单失败：${apiErr(r.data, r.status)}`);
    let rows: any[] = Array.isArray(r.data) ? r.data as any[]
      : pickArr(r.data ?? {}, ['results', 'data', 'orders', 'list', 'items', 'content', 'records', 'rows', 'order_list', 'orderList', 'ordersList']);
    if (rows.length === 0) break;
    if (opt?.filter) rows = rows.filter(opt.filter);
    const groups = new Map<string, any[]>();
    for (const o of rows) {
      const key = firstStr(deepGet(o, m.idKeys));
      if (!key) continue;
      const a = groups.get(key) ?? [];
      a.push(o);
      groups.set(key, a);
    }
    for (const [k, grp] of groups) {
      const n = restGroupNorm(ctx.shop, k, grp, m);
      if (!n || seen.has(n.externalId)) continue;
      seen.add(n.externalId);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(r.data ?? {}, ['total', 'total_count', 'totalCount', 'totalResults', 'total_results', 'total_elements', 'totalElements', 'count']));
    if (rows.length < size || out.length >= ctx.maxOrders
      || (total > 0 && (useOffset ? offset + rows.length >= total : page * size >= total))) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`${m.plat} 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}

/** 时间参数口径（平台各家：ISO / 日期 / 毫秒 / 秒） */
function docDate(fmt: string, ms: number): string {
  if (fmt === 'date') return new Date(ms).toISOString().slice(0, 10);
  if (fmt === 'ms') return String(ms);
  if (fmt === 'sec') return String(Math.floor(ms / 1000));
  if (fmt === 'datetime') return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  return new Date(ms).toISOString();
}

/** 配置驱动接口（docConn/docPull 共用字段）：defBase/defPath 只填「公开文档可确认」的值 */
interface DocCfg {
  m: RestMeta;
  defBase: string;
  defPath: string;
  method: 'GET' | 'POST';
  useOffset: boolean;
  size: number;
  pageStart: number;
  pageKey: string;
  offsetKey: string;
  sizeKey: string;
  fromKey: string;   // 空串 = 平台增量参数名未经确认 → 不带时间参数，改为客户端窗口过滤
  toKey: string;
  dateFmt: string;
  xmlTag: string;    // 非空 = 响应为 XML，按该标签切记录
  bodyWrap: string;  // POST 时业务参数放进 JSON 的哪个键（空 = 平铺）
  note: string;      // 缺 orders_path / api_base 时的中文说明
}
function docCfg(p: {
  plat: string; prefix: string; channel?: string; currency: string; map: Record<string, string>; idKeys: string[];
  defBase?: string; defPath?: string; method?: string; useOffset?: boolean; size?: number; pageStart?: number;
  pageKey?: string; offsetKey?: string; sizeKey?: string; fromKey?: string; toKey?: string; dateFmt?: string;
  xmlTag?: string; bodyWrap?: string; note?: string; statusOf?: (rows: any[]) => string;
}): DocCfg {
  const m: RestMeta = { plat: p.plat, prefix: p.prefix, channel: p.channel ?? p.plat, currency: p.currency, map: p.map, idKeys: p.idKeys };
  if (p.statusOf) m.statusOf = p.statusOf;
  return {
    m, defBase: p.defBase ?? '', defPath: p.defPath ?? '', method: p.method === 'POST' ? 'POST' : 'GET',
    useOffset: p.useOffset === true, size: p.size ?? 100, pageStart: p.pageStart ?? 1,
    pageKey: p.pageKey ?? 'page', offsetKey: p.offsetKey ?? 'offset', sizeKey: p.sizeKey ?? 'limit',
    fromKey: p.fromKey ?? '', toKey: p.toKey ?? '', dateFmt: p.dateFmt ?? 'iso', xmlTag: p.xmlTag ?? '',
    bodyWrap: p.bodyWrap ?? '', note: p.note ?? '请在凭据里回填 orders_path（平台方开放文档给出的订单接口路径）',
  };
}
/** 凭据解析：api_base / orders_path 缺失即明确失败（不猜端点）；Bearer 类令牌统一取 access_token/token/api_key */
function docConn(creds: Record<string, unknown>, cfg: DocCfg) {
  const P = cfg.m.prefix.toUpperCase();
  const token = firstStr(creds.access_token, creds.token, creds.api_key, creds.bearer_token, envOpt(`${P}_ACCESS_TOKEN`), envOpt(`${P}_API_KEY`));
  const apiBase = firstStr(creds.api_base, creds.api_host, envOpt(`${P}_API_BASE`), cfg.defBase).replace(/\/+$/, '');
  const path = firstStr(creds.orders_path, envOpt(`${P}_ORDERS_PATH`), cfg.defPath);
  const sellerAccount = firstStr(creds.seller_account, creds.shop_id, creds.seller_id, creds.partner_id, creds.username, envOpt(`${P}_SELLER_ACCOUNT`));
  if (!apiBase) throw new Error(`${cfg.m.plat} 缺少接口根域名（api_base）：${cfg.note}`);
  if (!path) throw new Error(`${cfg.m.plat} 缺少订单接口路径（orders_path）：${cfg.note}`);
  return {
    cfg, token, apiBase, sellerAccount,
    path: path.startsWith('/') ? path : `/${path}`,
    extra: JSON.parse(JSON.stringify(creds.extra_params && typeof creds.extra_params === 'object' ? creds.extra_params : {})) as Record<string, string>,
    pageKey: firstStr(creds.page_key, cfg.pageKey),
    offsetKey: firstStr(creds.offset_key, cfg.offsetKey),
    sizeKey: firstStr(creds.size_key, cfg.sizeKey),
    fromKey: firstStr(creds.from_key, cfg.fromKey),
    toKey: firstStr(creds.to_key, cfg.toKey),
    dateFmt: firstStr(creds.date_fmt, cfg.dateFmt),
    xmlTag: firstStr(creds.xml_item_tag, cfg.xmlTag),
    method: firstStr(creds.http_method, cfg.method),
    bodyWrap: firstStr(creds.body_wrap, cfg.bodyWrap),
  };
}
/** 路径模板支持 {partner_id}/{seller_account}/{shop_id}（Zalando、Mirakl 一类把店铺号写在路径里） */
function docUrl(cli: ReturnType<typeof docConn>, qs: Record<string, string>): string {
  const p = cli.path.replace(/\{(partner_id|seller_account|shop_id)\}/g, cli.sellerAccount || '');
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(qs)) if (v !== '' && v !== undefined) q.set(k, v);
  const joiner = p.includes('?') ? '&' : '?';
  return q.toString() ? `${cli.apiBase}${p}${joiner}${q.toString()}` : `${cli.apiBase}${p}`;
}
async function docPull(ctx: FetchCtx, cli: ReturnType<typeof docConn>, headers?: Record<string, string>): Promise<NormOrder[]> {
  const cfg = cli.cfg;
  const hdr: Record<string, string> = { ...(headers ?? {}) };
  if (cli.token) hdr.Authorization = `Bearer ${cli.token}`;
  const winFilter = (o: any) => {
    const ms = parseTime(deepGet(o, REST_UPD_KEYS)) ?? parseTime(deepGet(o, REST_DATE_KEYS));
    return ms === null || ms >= ctx.sinceMs;   // 平台不支持时间参数时在客户端按水位过滤
  };
  return await restPull(ctx, cfg.m, (pageOrSize0, size) => {
    const qs: Record<string, string> = {};
    if (cfg.useOffset) qs[cli.offsetKey] = String(pageOrSize0 * 1);
    else qs[cli.pageKey] = String(pageOrSize0);
    qs[cli.sizeKey] = String(size);
    if (cli.fromKey) qs[cli.fromKey] = docDate(cli.dateFmt, ctx.sinceMs);
    if (cli.toKey) qs[cli.toKey] = docDate(cli.dateFmt, ctx.untilMs);
    for (const [k, v] of Object.entries(cli.extra)) qs[k] = String(v);
    if (cli.method === 'POST') {
      // RPC 类 JSON 接口（Joom 等）对分页参数按 number 校验 → 纯数字串转回数字
      const flat: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(qs)) flat[k] = /^\d+$/.test(v) ? Number(v) : v;
      return { url: `${cli.apiBase}${cli.path.replace(/\{(partner_id|seller_account|shop_id)\}/g, cli.sellerAccount || '')}`, method: 'POST', headers: hdr, body: JSON.stringify(cli.bodyWrap ? { [cli.bodyWrap]: flat } : flat), xml: cli.xmlTag };
    }
    return { url: docUrl(cli, qs), method: 'GET', headers: hdr, xml: cli.xmlTag };
  }, { size: cfg.size, useOffset: cfg.useOffset, pageStart: cfg.pageStart, filter: cli.fromKey ? undefined : winFilter });
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 37：eMAG（罗马尼亚/保加利亚/匈牙利 · Marketplace 报表接口 JSON 口径）
//   凭据：username + password（卖家后台开通 API 后下发，用于换 Access Token）
//         access_token：平台方直接发令牌时回填，跳过换令牌（换令牌流程需白名单，多数店铺走这条）
//         api_base / orders_path / page_key / size_key / from_key：报表接口按对接文档口径实现，
//         参数名随平台版本漂移 → 全部可用凭据覆盖，未确认的过滤参数默认不下发（客户端按水位过滤）
//   状态：PENDING/IN_PREPARATION/IN_TRANSIT/DELIVERED/CANCELLED/RETURNED
// ═══════════════════════════════════════════════════════════════════
const EMAG_API = 'https://report-api.emag.ro';
const EMAG_STATUS_MAP: Record<string, string> = {
  'pending': '待处理', 'ordered': '待处理', 'new': '待处理', 'in_preparation': '待发货',
  'preparing': '待发货', 'confirmed': '待发货', 'ready_to_ship': '待发货', 'in_transit': '已发货',
  'shipped': '已发货', 'in_delivery': '已发货', 'delivered': '已完成', 'completed': '已完成',
  'cancelled': '已取消', 'canceled': '已取消', 'returned': '售后中', 'return_requested': '售后中',
  'annotation': '待审核', 'annotation_requested': '待审核',
};
const EMAG_META: RestMeta = {
  plat: 'eMAG', prefix: 'EMAG', channel: 'eMAG', currency: 'RON',
  map: EMAG_STATUS_MAP, idKeys: ['order_number', 'orderNumber', 'number', 'id', 'external_order_id'],
};
function emagConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.token, envOpt('EMAG_ACCESS_TOKEN'));
  const user = firstStr(creds.username, creds.user, envOpt('EMAG_USERNAME'));
  const pass = firstStr(creds.password, creds.secret, envOpt('EMAG_PASSWORD'));
  if (!token && !(user && pass)) {
    throw new Error('eMAG 凭据不完整：需回填卖家后台开通 API 后下发的 Username + Password（用于换 Access Token），或直接回填平台方发来的 access_token');
  }
  return {
    token, user, pass,
    apiBase: firstStr(creds.api_base, envOpt('EMAG_API_BASE'), EMAG_API).replace(/\/+$/, ''),
    tokenUrl: firstStr(creds.token_url, envOpt('EMAG_TOKEN_URL'), `${EMAG_API}/v1/oauth/token`),
    ordersPath: firstStr(creds.orders_path, envOpt('EMAG_ORDERS_PATH'), '/v1/orders/search'),
    pageKey: firstStr(creds.page_key, 'page'),
    sizeKey: firstStr(creds.size_key, 'pageSize'),
    fromKey: firstStr(creds.from_key, ''),
    toKey: firstStr(creds.to_key, ''),
    dateFmt: firstStr(creds.date_fmt, 'iso'),
    size: toNum(creds.page_size) || 100,
    extra: (creds.extra_params && typeof creds.extra_params === 'object' ? creds.extra_params : {}) as Record<string, string>,
  };
}
/** eMAG 令牌：client_credentials + Basic(user:pass)，单次同步内按 expires_in 复用 */
async function emagBearer(ctx: FetchCtx, cli: ReturnType<typeof emagConn>): Promise<string> {
  if (cli.token) return cli.token;
  const cached = String(ctx.shared.emagToken ?? '');
  const expMs = Number(ctx.shared.emagTokenExp ?? 0);
  if (cached && expMs > Date.now() + 60_000) return cached;
  const res = await fetchDirect(cli.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json',
      Authorization: `Basic ${btoa(`${cli.user}:${cli.pass}`)}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });
  const text = await res.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  const accessToken = firstStr(d?.access_token, d?.token);
  if (!res.ok || !accessToken) {
    throw new Error(`eMAG 换取 Access Token 失败：${apiErr(d, res.status)}（若平台未对本店开放报表/订单 API，请联系 eMAG 客户经理开通后回填 access_token）`);
  }
  ctx.shared.emagToken = accessToken;
  ctx.shared.emagTokenExp = Date.now() + Math.max(60, (toNum(d.expires_in) || 3600) - 300) * 1000;
  return accessToken;
}
async function emagPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = emagConn(ctx.creds);
  const tok = await emagBearer(ctx, cli);
  return await restPull(ctx, EMAG_META, (page, size) => {
    const qs: Record<string, string> = { [cli.pageKey]: String(page), [cli.sizeKey]: String(size), ...cli.extra };
    if (cli.fromKey) qs[cli.fromKey] = docDate(cli.dateFmt, ctx.sinceMs);
    if (cli.toKey) qs[cli.toKey] = docDate(cli.dateFmt, ctx.untilMs);
    const u = new URL(`${cli.apiBase}${cli.ordersPath}`);
    for (const [k, v] of Object.entries(qs)) u.searchParams.set(k, v);
    return { url: u.toString(), headers: { Authorization: `Bearer ${tok}` } };
  }, {
    size: cli.size,
    filter: cli.fromKey ? undefined : (o) => {
      const ms = parseTime(deepGet(o, REST_UPD_KEYS)) ?? parseTime(deepGet(o, REST_DATE_KEYS));
      return ms === null || ms >= ctx.sinceMs;
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 38：Kaufland（德国 Global Marketplace · Seller API v2，公开文档已确认）
//   凭据：client_key（32 位）+ secret_key（64 位），卖家后台 Shop Settings > API 生成
//         技术合作方还需 partner_client_key + partner_secret_key（多一层 Shop-Partner-Signature）
//   鉴权：5 个头 Accept / Shop-Client-Key / Shop-Timestamp(秒) / Shop-Signature / User-Agent
//         Shop-Signature = HMAC-SHA256(「GET\n{完整 URI}\n{body}\n{timestamp}」, secret_key) 十六进制
//         官方示例 URI 不含 query；带 query 时按完整 URI 签名，可用 creds.sign_scope='path' 退回只签路径
//   接口：GET {base}/v2/order-units?limit=&offset=（行级：同一 id_order 多行 → 折叠成一单）
//         平台另有 status/ts_created 过滤器，参数名随版本调整 → 默认不带，按水位在客户端过滤
//   金额：price/revenue 单位为「分」→ moneyVal 前统一 /100
//   状态：open（下单 15 分钟内地址不下发）→ need_to_be_sent → sent → delivered；cancelled/refund
// ═══════════════════════════════════════════════════════════════════
const KAUFLAND_API = 'https://sellerapi.kaufland.com';
const KAUFLAND_STATUS_MAP: Record<string, string> = {
  'open': '待处理', 'new': '待处理', 'need_to_be_sent': '待发货', 'need_to_be_send': '待发货',
  'in_fulfilment': '待发货', 'in_fulfillment': '待发货', 'to_be_sent': '待发货',
  'sent': '已发货', 'shipped': '已发货', 'delivered': '已完成', 'paid': '已完成',
  'cancelled': '已取消', 'canceled': '已取消', 'cancelled_by_customer': '已取消',
  'refund': '售后中', 'returned': '售后中', 'return': '售后中', 'complained': '售后中',
  '1': '待处理', '2': '待发货', '3': '已发货', '4': '已取消', '5': '已完成',
};
const KAUFLAND_META: RestMeta = {
  plat: 'Kaufland', prefix: 'KAUFLAND', channel: 'Kaufland', currency: 'EUR',
  map: KAUFLAND_STATUS_MAP, idKeys: ['id_order', 'idOrder', 'order_id', 'id'],
  sumRows: true, amountScale: 0.01,   // 行级 price 单位为分 → 逐行累加再 /100
};
function kauflandConn(creds: Record<string, unknown>) {
  const clientKey = firstStr(creds.client_key, creds.ClientKey, envOpt('KAUFLAND_CLIENT_KEY'));
  const secretKey = firstStr(creds.secret_key, creds.SecretKey, creds.client_secret, envOpt('KAUFLAND_SECRET_KEY'));
  if (!clientKey || !secretKey) throw new Error('Kaufland 凭据不完整（缺 Client Key / Secret Key，在卖家后台 Shop Settings > API 生成；密钥丢失只能重新生成），请重新授权');
  return {
    clientKey, secretKey,
    partnerClientKey: firstStr(creds.partner_client_key, envOpt('KAUFLAND_PARTNER_CLIENT_KEY')),
    partnerSecretKey: firstStr(creds.partner_secret_key, envOpt('KAUFLAND_PARTNER_SECRET_KEY')),
    apiBase: firstStr(creds.api_base, envOpt('KAUFLAND_API_BASE'), KAUFLAND_API).replace(/\/+$/, '') + '/v2',
    userAgent: firstStr(creds.user_agent, 'Thalvior-ERP'),
    signScope: firstStr(creds.sign_scope, 'full'),
    ordersPath: firstStr(creds.orders_path, '/order-units'),
    size: toNum(creds.page_size) || 100,
  };
}
/** Kaufland 签名串：METHOD + 换行 + URI + 换行 + BODY + 换行 + TIMESTAMP（timestamp 与 Shop-Timestamp 头同值）
 *  官方文档给出的校验向量：POST / https://sellerapi.kaufland.com/v2/units/ / 空 body /
 *  ts=1411055926 / secret=a7d0...dd403 → da0b65f51c0716c1d3fa658b7eaf710583630a762a98c9af8e9b392bd9df2e2a */
async function kauflandSign(cli: ReturnType<typeof kauflandConn>, method: string, uri: string, body: string, ts: string, secret?: string): Promise<string> {
  return await hmacSha256Hex(`${method}\n${uri}\n${body}\n${ts}`, secret || cli.secretKey);
}
async function kauflandPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = kauflandConn(ctx.creds);
  return await restPull(ctx, KAUFLAND_META, async (page, size) => {
    const path = `${cli.apiBase}${cli.ordersPath}`;
    const qs = new URLSearchParams({ limit: String(size), offset: String((page - 1) * size) });
    const ts = String(Math.floor(Date.now() / 1000));
    const signUri = cli.signScope === 'path' ? path : `${path}?${qs.toString()}`;
    const headers: Record<string, string> = {
      Accept: 'application/json', 'Shop-Client-Key': cli.clientKey, 'Shop-Timestamp': ts,
      'Shop-Signature': await kauflandSign(cli, 'GET', signUri, '', ts), 'User-Agent': cli.userAgent,
    };
    if (cli.partnerClientKey && cli.partnerSecretKey) {
      headers['Shop-Partner-Client-Key'] = cli.partnerClientKey;
      headers['Shop-Partner-Signature'] = await kauflandSign(cli, 'GET', signUri, '', ts, cli.partnerSecretKey);
    }
    return { url: `${path}?${qs.toString()}`, headers };
  }, {
    size: cli.size,
    filter: (o) => {
      const ms = parseTime(deepGet(o, REST_UPD_KEYS)) ?? parseTime(deepGet(o, REST_DATE_KEYS));
      return ms === null || ms >= ctx.sinceMs;
    },
  });
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 39：OnBuy（英国市场 · Supplier API HMAC 口径）
//   凭据：consumer_key + secret_key（Supplier Hub > API 申请，需平台审核）
//   现状：OnBuy 开放文档在供应商账号后面，订单接口的**路径与鉴权头名**未公开可核 →
//         本适配器不内置猜测路径：必须回填 orders_path（文档给出）后才发请求
//   签名：按对接文档口径 HMAC-SHA256(timestamp + path, secret_key)；头名可覆盖
//   状态：PENDING/PROCESSED/SHIPPED/DELIVERED/CANCELLED/RETURNED
// ═══════════════════════════════════════════════════════════════════
const ONBUY_STATUS_MAP: Record<string, string> = {
  'pending': '待处理', 'new': '待处理', 'awaiting_payment': '待处理', 'unconfirmed': '待审核',
  'confirmed': '待发货', 'processed': '待发货', 'processing': '待发货', 'to_be_shipped': '待发货',
  'shipped': '已发货', 'dispatched': '已发货', 'delivered': '已完成', 'completed': '已完成',
  'cancelled': '已取消', 'canceled': '已取消', 'void': '已取消', 'returned': '售后中', 'refund': '售后中',
};
const ONBUY_CFG = docCfg({
  plat: 'OnBuy', prefix: 'ONBUY', currency: 'GBP', map: ONBUY_STATUS_MAP,
  idKeys: ['order_id', 'orderId', 'order_number', 'id', 'reference'],
  defBase: 'https://api.onbuy.com', defPath: '',
  method: 'GET', useOffset: false, size: 100, pageStart: 1,
  fromKey: '', dateFmt: 'iso',
  note: 'OnBuy 订单接口路径在供应商后台开放文档内（未公开可核），请回填 orders_path，例如文档给出的 /seller/orders 列表接口；同时确认鉴权头名 header_consumer / header_timestamp / header_signature',
});
function onbuyConn(creds: Record<string, unknown>) {
  const consumerKey = firstStr(creds.consumer_key, creds.app_key, creds.client_key, envOpt('ONBUY_CONSUMER_KEY'));
  const secretKey = firstStr(creds.secret_key, creds.app_secret, creds.client_secret, envOpt('ONBUY_SECRET_KEY'));
  if (!consumerKey || !secretKey) throw new Error('OnBuy 凭据不完整（缺 Consumer Key / Secret Key，需在 OnBuy Supplier Hub 申请 API 权限并通过审核），请重新授权');
  const cli = docConn(creds, ONBUY_CFG);
  return {
    ...cli, consumerKey, secretKey,
    headerConsumer: firstStr(creds.header_consumer, 'X-Auth-Consumer'),
    headerTimestamp: firstStr(creds.header_timestamp, 'X-Auth-Timestamp'),
    headerSignature: firstStr(creds.header_signature, 'X-Auth-Signature'),
  };
}
async function onbuyPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = onbuyConn(ctx.creds);
  const ts = String(Math.floor(Date.now() / 1000));
  const signPath = `${cli.path.startsWith('/') ? '' : '/'}${cli.path}`;
  const sign = await hmacSha256Hex(`${ts}${signPath}`, cli.secretKey);
  return await docPull(ctx, cli, {
    [cli.headerConsumer]: cli.consumerKey,
    [cli.headerTimestamp]: ts,
    [cli.headerSignature]: sign,
  });
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 40：Wayfair（Partner API · sso.auth 取令牌 + Dropship GraphQL 订单查询）
//   凭据：client_id + client_secret（partners.wayfair > Developer > Applications 创建应用）
//         seller_account = Supplier ID（CastleGate/库存类接口要求，纯查询链路可选）
//   令牌：POST https://sso.auth.wayfair.com/oauth/token  JSON
//         { grant_type: client_credentials, client_id, client_secret, audience: https://api.wayfair.com/ }
//   订单：POST {base}/v1/graphql/  query getDropshipPurchaseOrders(fromDate, limit)
//         —— 平台口径「无游标分页、只给开始时间」，limit=0 返回全部 → 用 fromDate + 客户端水位过滤
//         CastleGate（平台仓）订单需另向 Wayfair 申请 ticket 开通 cg 路由 → creds.graphql_query 可换查询名
//   状态：PO 本身不带状态字段 → 有 trackingNumber/carrierCode 视为已发货，取消标记视为已取消，否则待发货
// ═══════════════════════════════════════════════════════════════════
const WAYFAIR_API = 'https://api.wayfair.com';
const WAYFAIR_TOKEN_URL = 'https://sso.auth.wayfair.com/oauth/token';
const WAYFAIR_STATUS_MAP: Record<string, string> = {
  'new': '待处理', 'pending': '待处理', 'acknowledged': '待发货', 'open': '待发货',
  'in_transit': '已发货', 'shipped': '已发货', 'delivered': '已完成', 'closed': '已完成',
  'cancelled': '已取消', 'canceled': '已取消', 'voided': '已取消', 'returned': '售后中', 'refund': '售后中',
};
const WAYFAIR_GQL = 'query getDropshipPurchaseOrders($fromDate: String, $limit: Int) { getDropshipPurchaseOrders(fromDate: $fromDate, limit: $limit) { poNumber poDate orderId estimatedShipDate orderType customerName customerAddress1 customerAddress2 customerCity customerState customerPostalCode customerCountry shippingInfo { shipSpeed carrierCode trackingNumber } shipTo { name address1 address2 address3 city state country postalCode phoneNumber } products { partNumber quantity price } } }';
const WAYFAIR_META: RestMeta = {
  plat: 'Wayfair', prefix: 'WAYFAIR', channel: 'Wayfair', currency: 'USD',
  map: WAYFAIR_STATUS_MAP, idKeys: ['orderId', 'poNumber', 'po_number', 'order_id', 'id'],
  statusOf: (rows: any[]) => {
    const r: any = rows[0] ?? {};
    const explicit = mapRestStatus(WAYFAIR_META, r.orderStatus ?? r.status ?? r.poStatus);
    if (explicit) return explicit;
    if (firstStr(r.cancelledDate, r.cancelDate, r.voidReason)) return '已取消';
    const track = firstStr(deepGet(r, ['trackingNumber', 'tracking_number']));
    if (track || firstStr(r.deliveredDate, r.shippedDate)) return '已发货';
    if (r.estimatedShipDate && Date.parse(String(r.estimatedShipDate)) < Date.now()) return '待发货';
    return '待发货';
  },
  lineTotal: (l: any) => moneyVal(l?.price) * (toNum(l?.quantity) || 1),   // GraphQL 给单价 + 数量
};
function wayfairConn(creds: Record<string, unknown>) {
  const clientId = firstStr(creds.client_id, creds.app_key, envOpt('WAYFAIR_CLIENT_ID'));
  const clientSecret = firstStr(creds.client_secret, creds.app_secret, envOpt('WAYFAIR_CLIENT_SECRET'));
  if (!clientId || !clientSecret) throw new Error('Wayfair 凭据不完整（缺 Client ID / Client Secret，需在 partners.wayfair.com > Developer > Applications 创建应用并开启 API 权限），请重新授权');
  return {
    clientId, clientSecret,
    token: firstStr(creds.access_token, envOpt('WAYFAIR_ACCESS_TOKEN')),
    supplierId: firstStr(creds.seller_account, creds.supplier_id, envOpt('WAYFAIR_SUPPLIER_ID')),
    apiBase: firstStr(creds.api_base, envOpt('WAYFAIR_API_BASE'), WAYFAIR_API).replace(/\/+$/, ''),
    tokenUrl: firstStr(creds.token_url, envOpt('WAYFAIR_TOKEN_URL'), WAYFAIR_TOKEN_URL),
    audience: firstStr(creds.audience, `${WAYFAIR_API}/`),
    graphqlPath: firstStr(creds.graphql_path, '/v1/graphql/'),
    gqlQuery: firstStr(creds.graphql_query, WAYFAIR_GQL),
    size: toNum(creds.page_size) || 1000,
  };
}
async function wayfairBearer(ctx: FetchCtx, cli: ReturnType<typeof wayfairConn>): Promise<string> {
  if (cli.token) return cli.token;
  const cached = String(ctx.shared.wayfairToken ?? '');
  const expMs = Number(ctx.shared.wayfairTokenExp ?? 0);
  if (cached && expMs > Date.now() + 60_000) return cached;
  const res = await fetchDirect(cli.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: cli.clientId, client_secret: cli.clientSecret, audience: cli.audience }),
  });
  const text = await res.text();
  let d: any = null;
  try { d = text ? JSON.parse(text) : null; } catch { d = { raw: text.slice(0, 300) }; }
  const accessToken = firstStr(d?.access_token);
  if (!res.ok || !accessToken) throw new Error(`Wayfair 换取 Access Token 失败：${apiErr(d, res.status)}（应用需先开启 API 权限，CastleGate 订单还需向平台提交 ticket）`);
  ctx.shared.wayfairToken = accessToken;
  ctx.shared.wayfairTokenExp = Date.now() + Math.max(60, (toNum(d.expires_in) || 43200) - 300) * 1000;
  return accessToken;
}
async function wayfairPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = wayfairConn(ctx.creds);
  const tok = await wayfairBearer(ctx, cli);
  // Wayfair 只认 fromDate（无游标分页）→ 固定单请求取回，水位过滤在客户端做
  const body = JSON.stringify({
    query: cli.gqlQuery,
    variables: { fromDate: new Date(ctx.sinceMs).toISOString().slice(0, 19), limit: cli.size },
  });
  const r = await postJsonResp(`${cli.apiBase}${cli.graphqlPath}`, body, { Authorization: `Bearer ${tok}` });
  const gqlErr = Array.isArray(r.data?.errors) && r.data.errors.length > 0 ? String(r.data.errors[0]?.message ?? '') : '';
  if (!r.ok || gqlErr) throw new Error(`Wayfair 拉单失败：${gqlErr || apiErr(r.data, r.status)}`);
  const rows = pickArr(r.data ?? {}, ['getDropshipPurchaseOrders', 'orders', 'results', 'data']);
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (const o of rows) {
    const ms = parseTime(deepGet(o, REST_DATE_KEYS));
    if (ms !== null && ms < ctx.sinceMs) continue;
    const key = firstStr(deepGet(o, WAYFAIR_META.idKeys));
    if (!key) continue;
    const n = restGroupNorm(ctx.shop, key, [o], WAYFAIR_META);
    if (!n || seen.has(n.externalId)) continue;
    seen.add(n.externalId);
    out.push(n);
    if (out.length >= ctx.maxOrders) { ctx.warn(`Wayfair 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`); break; }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 41：Zalando（Partner API · OAuth2 Bearer + partner_id 路径）
//   凭据：access_token（合作方 JWT/OAuth 令牌）+ partner_id（seller_account 同义）
//   现状：Zalando 合作方文档需 partner 账号登录后下载，订单接口的版本/路径（v1/v2）
//         按站点与合同不同 → 不内置猜测路径，必须回填 orders_path（支持 {partner_id} 占位）
//   状态：CONFIRMED/SHIPPED/DELIVERED/CANCELLED/RETURNED
// ═══════════════════════════════════════════════════════════════════
const ZALANDO_STATUS_MAP: Record<string, string> = {
  'created': '待处理', 'pending': '待处理', 'awaiting_validation': '待审核', 'confirmed': '待发货',
  'in_preparation': '待发货', 'ready_for_shipment': '待发货', 'shipped': '已发货', 'in_transit': '已发货',
  'delivered': '已完成', 'completed': '已完成', 'cancelled': '已取消', 'canceled': '已取消',
  'returned': '售后中', 'return_requested': '售后中', 'partially_returned': '售后中',
};
const ZALANDO_CFG = docCfg({
  plat: 'Zalando', prefix: 'ZALANDO', currency: 'EUR', map: ZALANDO_STATUS_MAP,
  idKeys: ['orderNumber', 'order_number', 'salesOrderId', 'id', 'orderId'],
  defBase: 'https://api.zalando.com', defPath: '',
  method: 'GET', useOffset: false, size: 100,
  fromKey: '', dateFmt: 'iso',
  note: 'Zalando 合作方文档需 partner 账号登录后获取，订单接口路径/版本按合同不同 → 请回填 orders_path，路径内可用 {partner_id} 占位（partner_id 填在 seller_account）',
});
function zalandoConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.token, envOpt('ZALANDO_ACCESS_TOKEN'));
  if (!token) throw new Error('Zalando OAuth 流程尚未就绪：Zalando 合作方接口只接受平台签发的 Bearer 令牌，需与 Zalando Partner Integration 团队签署接入并回写 access_token 后再接通');
  const cli = docConn(creds, ZALANDO_CFG);
  return { ...cli, partnerId: firstStr(creds.partner_id, cli.sellerAccount), };
}
async function zalandoPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = zalandoConn(ctx.creds);
  return await docPull(ctx, cli, cli.partnerId ? { 'X-Partner-Id': cli.partnerId } : undefined);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 42：Rakuten（Rakuten Web Services API · serviceSecret + licenseKey）
//   凭据：service_secret + license_key（各国 Rakuten 市场 分开签发），
//         merchant/seller_account 部分站点要求
//   现状：Rakuten 开放接口按国家（.de/.fr/.eu/.co.jp）域名与 API 版本不同，且响应多为 XML
//         → 不内置猜测 host/path：回填 api_base + orders_path（method 段）后才发请求；
//           响应为 XML 时配 xml_item_tag（如 orders）做浅层解析
//   状态：awaitingPayment/awaitingShipment/shipped/complete/canceled
// ═══════════════════════════════════════════════════════════════════
const RAKUTEN_STATUS_MAP: Record<string, string> = {
  'awaiting_payment': '待处理', 'awaitingpayment': '待处理', 'new': '待处理', 'unpaid': '待处理',
  'awaiting_shipment': '待发货', 'awaitingshipment': '待发货', 'paid': '待发货', 'invoiced': '待发货',
  'shipped': '已发货', 'in_transit': '已发货', 'complete': '已完成', 'completed': '已完成',
  'cancelled': '已取消', 'canceled': '已取消', 'cancellation_requested': '待审核', 'returned': '售后中', 'refund': '售后中',
};
const RAKUTEN_CFG = docCfg({
  plat: 'Rakuten', prefix: 'RAKUTEN', currency: 'EUR', map: RAKUTEN_STATUS_MAP,
  idKeys: ['orderId', 'order_id', 'orderIdList', 'id', 'number'],
  defBase: '', defPath: '', method: 'GET', useOffset: true, size: 100,
  offsetKey: 'startIndex', pageKey: 'startIndex', sizeKey: 'itemsPerPage',
  fromKey: '', dateFmt: 'iso',
  note: 'Rakuten 开放接口按国家站点分域名（如德国 api.rakuten.de、法国 api.rakuten.fr）且路径含 API 版本与服务名 → 请同时回填 api_base 与 orders_path（形如 /API/1.0/WS/OrderManagement/getOrders），响应为 XML 时再配 xml_item_tag=orders',
});
function rakutenConn(creds: Record<string, unknown>) {
  const serviceSecret = firstStr(creds.service_secret, creds.serviceSecret, envOpt('RAKUTEN_SERVICE_SECRET'));
  const licenseKey = firstStr(creds.license_key, creds.licenseKey, envOpt('RAKUTEN_LICENSE_KEY'));
  if (!serviceSecret || !licenseKey) throw new Error('Rakuten 凭据不完整（缺 service_secret / license_key，需在对应国家 Rakuten 市场 的开发者后台申请），请重新授权');
  // 令牌校验先于端点校验：即便还没回填 api_base/orders_path，也要先告知「还差授权令牌」这一硬门槛
  const tok = firstStr(creds.access_token, creds.token, creds.bearer_token, envOpt('RAKUTEN_ACCESS_TOKEN'));
  if (!tok) throw new Error('Rakuten OAuth 流程尚未就绪：该国站点的订单接口还需卖家授权令牌（license 之外另发 access token），请回填 access_token');
  const cli = docConn(creds, RAKUTEN_CFG);
  return { ...cli, serviceSecret, licenseKey };
}
async function rakutenPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = rakutenConn(ctx.creds);
  cli.extra.serviceSecret = cli.serviceSecret;
  cli.extra.licenseKey = cli.licenseKey;
  if (cli.sellerAccount) cli.extra.merchant = cli.sellerAccount;
  return await docPull(ctx, cli);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 43：Fnac（法国 Fnac-Darty 市场 · Mirakl Shop API v3）
//   凭据：api_key（Mirakl 后台 > Settings > API Keys 生成的 Bearer 密钥）
//         seller_account = shop id（Mirakl 订单接口要求）
//   域名：Mirakl 每市场独立域名（后台 API 文档页给出），故 api_base 必须由凭据/环境变量回填
//   接口：Mirakl 标准路由 GET /api/v3/orders（offset/max + additionalFields），
//         平台侧另可切到 POST /api/v3/orders/search
//   状态：ACCEPTED/REFUSED/SHIPPED/DELIVERED/RETURNED/COMPLETE
// ═══════════════════════════════════════════════════════════════════
const FNAC_STATUS_MAP: Record<string, string> = {
  'received': '待处理', 'accepted': '待发货', 'accepted_and_pending': '待发货', 'to_be_shipped': '待发货',
  'partially_shipped': '已发货', 'shipped': '已发货', 'in_transit': '已发货', 'delivered': '已完成',
  'complete': '已完成', 'completed': '已完成', 'refused': '已取消', 'cancelled': '已取消', 'canceled': '已取消',
  'pending_cancellation': '待审核', 'returned': '售后中', 'return_pending': '售后中', 'refunded': '售后中', 'incident': '售后中',
};
const FNAC_CFG = docCfg({
  plat: 'Fnac', prefix: 'FNAC', currency: 'EUR', map: FNAC_STATUS_MAP,
  idKeys: ['orderId', 'order_id', 'id', 'internalOrderId'],
  defBase: '', defPath: '/api/v3/orders',
  method: 'GET', useOffset: true, size: 100, offsetKey: 'offset', sizeKey: 'max',
  fromKey: '', dateFmt: 'iso',
  note: 'Fnac/Darty 市场 由 Mirakl 驱动，接口域名按市场分配，请回填 api_base（卖家后台 API 文档页给出的 https://api.xxx 域名）；如需改用检索接口可回填 orders_path=/api/v3/orders/search&method=POST',
});
function fnacConn(creds: Record<string, unknown>) {
  const apiKey = firstStr(creds.api_key, creds.access_token, creds.token, envOpt('FNAC_API_KEY'));
  if (!apiKey) throw new Error('Fnac 凭据不完整（缺 Mirakl API Key：登录 Fnac 卖家后台 > Settings > API Keys 生成，需勾选订单读取权限），请重新授权');
  const cli = docConn(creds, FNAC_CFG);
  cli.extra.additionalFields = firstStr(creds.additional_fields, 'COLLECTED_BY,SHIPMENT_TRACKING,NODE_DESCRIPTION,INVOICE_REFERENCE');
  cli.extra.timezone = firstStr(creds.timezone, 'Europe/Paris');
  return { ...cli, apiKey };
}
async function fnacPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = fnacConn(ctx.creds);
  return await docPull(ctx, cli);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 44：Joom（JoomPartner API · Bearer + JSON-RPC 风格）
//   凭据：access_token（JoomPartner 后台生成）
//   现状：Joom 的 RPC 方法名/路径在合作方后台文档内，公开渠道只能看到类目/库存类示例
//         → 不内置猜测路径：回填 orders_path（如 /rpc/GetOrders）+ method=POST 后才发请求
//   状态：pending/packing/shipped/delivered/cancelled
// ═══════════════════════════════════════════════════════════════════
const JOOM_STATUS_MAP: Record<string, string> = {
  'pending': '待处理', 'new': '待处理', 'unpaid': '待处理', 'awaiting_payment': '待处理',
  'packing': '待发货', 'ready_to_ship': '待发货', 'to_be_shipped': '待发货', 'paid': '待发货',
  'shipped': '已发货', 'in_transit': '已发货', 'delivered': '已完成', 'completed': '已完成',
  'cancelled': '已取消', 'canceled': '已取消', 'returned': '售后中', 'refund': '售后中', 'dispute': '售后中',
};
const JOOM_CFG = docCfg({
  plat: 'Joom', prefix: 'JOOM', currency: 'USD', map: JOOM_STATUS_MAP,
  idKeys: ['order_id', 'orderId', 'id', 'number'],
  defBase: 'https://partner-api.joom.com', defPath: '',
  method: 'POST', useOffset: true, size: 100, offsetKey: 'offset', pageKey: 'page', sizeKey: 'limit',
  fromKey: '', dateFmt: 'iso',
  note: 'Joom 订单接口以合作方后台文档给出的 RPC 方法为准（常见形态 /rpc/GetOrders 之类），请回填 orders_path，并把方法名/参数放好后再同步',
});
function joomConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.token, creds.api_key, envOpt('JOOM_ACCESS_TOKEN'));
  if (!token) throw new Error('Joom 凭据不完整（缺 JoomPartner API Access Token，需在 JoomPartner 后台 > Integration/API 生成并授权订单读取），请重新授权');
  return docConn(creds, JOOM_CFG);
}
async function joomPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = joomConn(ctx.creds);
  return await docPull(ctx, cli);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 45：Tiki（越南 Tiki.vn · Partner Order Service）
//   凭据：access_token（OAuth2 Bearer，Tiki 合作方后台签发）
//   接口：{base}/sc/order-service/v1.2/orders?updated_since=ISO&limit=&p=
//   说明：updated_since 为 Tiki 订单服务口径（按更新时间增量，天然覆盖状态回刷）
//   状态：confirmed/delivered/cancelled/returned/pending（Tiki 侧词表按站点略异，未命中落待处理）
// ═══════════════════════════════════════════════════════════════════
const TIKI_STATUS_MAP: Record<string, string> = {
  'new': '待处理', 'pending': '待处理', 'awaiting_payment': '待处理', 'unconfirmed': '待审核',
  'confirmed': '待发货', 'preparing': '待发货', 'packing': '待发货', 'to_be_shipped': '待发货',
  'shipping': '已发货', 'shipped': '已发货', 'delivering': '已发货', 'delivered': '已完成',
  'completed': '已完成', 'cancelled': '已取消', 'canceled': '已取消', 'returned': '售后中', 'return': '售后中',
};
const TIKI_CFG = docCfg({
  plat: 'Tiki', prefix: 'TIKI', currency: 'VND', map: TIKI_STATUS_MAP,
  idKeys: ['order_id', 'orderId', 'code', 'id', 'external_so_id'],
  defBase: 'https://api.tiki.vn/sc/order-service/v1.2', defPath: '/orders',
  method: 'GET', useOffset: false, size: 50, pageStart: 1, pageKey: 'p', sizeKey: 'limit',
  fromKey: 'updated_since', dateFmt: 'iso',
  note: 'Tiki 订单服务路径可按站点版本调整（当前按 /sc/order-service/v1.2/orders）；如需换版本请回填 api_base / orders_path',
});
function tikiConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.token, envOpt('TIKI_ACCESS_TOKEN'));
  if (!token) throw new Error('Tiki OAuth 流程尚未就绪：Tiki 合作方接口需先在 Tiki Partner Center 完成应用注册与店铺授权，回写 access_token 后再接通');
  return docConn(creds, TIKI_CFG);
}
async function tikiPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = tikiConn(ctx.creds);
  return await docPull(ctx, cli);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 46：B2W Americanas（巴西 B2W Digital 集成网关 · OAuth Bearer）
//   凭据：access_token（B2W 集成门户申请），client_id/client_secret 配 token_url 时现场换令牌
//   现状：B2W 网关按 service + env 组装（integration.b2w.io/apis/...），订单服务名与参数
//         以我方拿到的接入文档为准 → 不内置猜测路径：回填 orders_path 后才发请求
//   状态：待付款/已确认/待发货/已发货/已送达/取消/退货（葡语词表）
// ═══════════════════════════════════════════════════════════════════
const B2W_STATUS_MAP: Record<string, string> = {
  'aguardando_pagamento': '待处理', 'awaiting_payment': '待处理', 'created': '待处理', 'novo': '待处理',
  'confirmado': '待发货', 'confirmed': '待发货', 'pronta_para_envio': '待发货', 'a_enviar': '待发货',
  'enviado': '已发货', 'shipped': '已发货', 'em_transporte': '已发货', 'entregue': '已完成',
  'delivered': '已完成', 'concluido': '已完成', 'cancelled': '已取消', 'cancelado': '已取消',
  'devolvido': '售后中', 'returned': '售后中', 'estorno': '售后中',
};
const B2W_CFG = docCfg({
  plat: 'B2W Americanas', prefix: 'B2W', currency: 'BRL', map: B2W_STATUS_MAP,
  idKeys: ['orderNumber', 'order_number', 'orderId', 'id', 'number'],
  defBase: 'https://integration.b2w.io', defPath: '',
  method: 'GET', useOffset: false, size: 100, pageKey: 'page', sizeKey: 'pageSize',
  fromKey: '', dateFmt: 'date',
  note: 'B2W 集成网关按服务名组装路径（形如 /apis/marketplace-orders?env=production），请回填 orders_path（含 env 查询段亦可写在 extra_params），服务名以 B2W 接入文档为准',
});
function b2wConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.token, envOpt('B2W_ACCESS_TOKEN'));
  if (!token) throw new Error('B2W Americanas OAuth 流程尚未就绪：需先在 B2W 集成门户（integration.b2w.io）创建应用并完成店铺授权，回写 access_token 后再接通');
  const cli = docConn(creds, B2W_CFG);
  if (cli.sellerAccount) cli.extra.sellerId = cli.sellerAccount;
  return cli;
}
async function b2wPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = b2wConn(ctx.creds);
  return await docPull(ctx, cli);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 47：Voghion（欧洲区域市场 · 开放平台 Bearer）
//   凭据：access_token（开放平台应用授权后签发）
//   现状：Voghion 开放平台文档需开发者账号登录，订单接口路径未在公开渠道给出
//         → 不内置猜测路径：回填 api_base / orders_path 后才发请求
//   状态：pending/paid/shipped/delivered/cancelled/returned
// ═══════════════════════════════════════════════════════════════════
const VOGHION_STATUS_MAP: Record<string, string> = {
  'pending': '待处理', 'pending_payment': '待处理', 'unpaid': '待处理', 'created': '待处理',
  'paid': '待发货', 'confirmed': '待发货', 'to_ship': '待发货', 'ready_to_ship': '待发货',
  'shipped': '已发货', 'partially_shipped': '已发货', 'in_transit': '已发货',
  'delivered': '已完成', 'completed': '已完成', 'cancelled': '已取消', 'canceled': '已取消',
  'returned': '售后中', 'refund': '售后中',
};
const VOGHION_CFG = docCfg({
  plat: 'Voghion', prefix: 'VOGHION', currency: 'EUR', map: VOGHION_STATUS_MAP,
  idKeys: ['order_id', 'orderId', 'order_sn', 'id', 'order_number'],
  defBase: '', defPath: '', method: 'GET', useOffset: false, size: 50,
  pageKey: 'page_index', sizeKey: 'page_size', fromKey: '', dateFmt: 'datetime',
  note: 'Voghion 开放平台文档需开发者账号登录，订单接口路径与签名口径未公开可核 → 请回填 api_base 与 orders_path（若平台要求签名而非 Bearer，请先与 Voghion 取文档后补实现）',
});
function voghionConn(creds: Record<string, unknown>) {
  const token = firstStr(creds.access_token, creds.token, envOpt('VOGHION_ACCESS_TOKEN'));
  if (!token) throw new Error('Voghion OAuth 流程尚未就绪：需在 Voghion 开放平台创建应用并取得店铺 access_token，回写凭据后再接通');
  return docConn(creds, VOGHION_CFG);
}
async function voghionPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = voghionConn(ctx.creds);
  return await docPull(ctx, cli);
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 48：Alibaba 国际站（Alibaba.com / ICBU · 开放平台 routerjson，TOP 签名同族）
//   凭据：app_key + app_secret（open.alibaba.com 创建应用）+ access_token（卖家 OAuth 授权）
//   接口：POST {api_base}，公共参数 app_key/method/access_token/timestamp/v/format/sign_method/sign
//         方法名按 ICBU 版本有 alibaba.icbu.order.list 与 alibaba.trade.list 两类
//         → creds.api_method / env ALIBABA_API_METHOD 可覆盖，参数名亦可覆盖
//   状态：WAIT_BUYER_PAY/WAIT_SELLER_SEND/SELLER_SEND/TRADE_FINISHED/TRADE_CLOSED
// ═══════════════════════════════════════════════════════════════════
const ALIBABA_API = 'https://api.alibaba.com/routerjson';
const ALIBABA_STATUS_MAP: Record<string, string> = {
  'wait_buyer_pay': '待处理', 'wait_buyer_payment': '待处理', 'placed': '待处理', 'new': '待处理',
  'wait_seller_send': '待发货', 'wait_seller_ship': '待发货', 'wait_seller_confirm': '待审核',
  'seller_send': '已发货', 'shipped': '已发货', 'wait_buyer_confirm': '已发货',
  'trade_finished': '已完成', 'finished': '已完成', 'success': '已完成',
  'trade_closed': '已取消', 'closed': '已取消', 'in_seller_issue': '售后中', 'issue': '售后中', 'refund': '售后中',
};
const ALIBABA_META: RestMeta = {
  plat: 'Alibaba 国际站', prefix: 'ALIBABA', channel: 'Alibaba', currency: 'USD',
  map: ALIBABA_STATUS_MAP, idKeys: ['orderId', 'order_id', 'tradeId', 'trade_id', 'id', 'contractId'],
};
function alibabaConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('ALIBABA_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('ALIBABA_APP_SECRET'));
  const token = firstStr(creds.access_token, creds.session, envOpt('ALIBABA_ACCESS_TOKEN'));
  if (!appKey || !appSecret) throw new Error('Alibaba 国际站凭据不完整（缺 App Key / App Secret，需在 open.alibaba.com 创建应用），请重新授权');
  if (!token) throw new Error('Alibaba 国际站 OAuth 流程尚未就绪：缺少卖家 Access Token，需在 Alibaba.com 开放平台完成卖家授权并回写 access_token 后再接通');
  const apiBase = firstStr(creds.api_base, envOpt('ALIBABA_API_BASE'), ALIBABA_API).replace(/\/+$/, '');
  return {
    appKey, appSecret, token, apiBase,
    method: firstStr(creds.api_method, envOpt('ALIBABA_API_METHOD'), 'alibaba.icbu.order.list'),
    signMethod: firstStr(creds.sign_method, 'md5').toLowerCase(),
    tokenParam: firstStr(creds.token_param, 'access_token'),
    pageNoKey: firstStr(creds.page_key, 'pageNo'),
    pageSizeKey: firstStr(creds.size_key, 'pageSize'),
    fromKey: firstStr(creds.from_key, ''),
    toKey: firstStr(creds.to_key, ''),
    size: toNum(creds.page_size) || 50,
    async call(biz: Record<string, string>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: appKey, sign_method: this.signMethod, format: 'json', v: '2.0',
        timestamp: topTimestamp(Date.now()), method: this.method, ...biz,
      };
      params[this.tokenParam] = this.token;
      params.sign = await topSign(topConcat(params), appSecret, this.signMethod === 'sha256' ? 'sha256' : 'md5', true);
      const res = await fetchDirect(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
/** TOP 网关响应外层包裹键随方法名漂移（alibaba_icbu_order_list_response → result → orders）：逐层下钻到业务体 */
function topUnwrap(o: any, depth = 0): any {
  if (!o || typeof o !== 'object' || Array.isArray(o) || depth > 4) return o;
  for (const k of Object.keys(o)) {
    if (!/_response$|^result$|^data$|^response$|^module$|^detailed_results$/i.test(k)) continue;
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) return topUnwrap(v, depth + 1);
  }
  return o;
}
/** TOP 网关翻页：pageNo/pageSize + 可选时间参数，响应包装键随方法名漂移 → topUnwrap + pickArr/deepGet 兜底 */
async function topPagedPull(ctx: FetchCtx, m: RestMeta, cli: { call: (biz: Record<string, string>) => Promise<PlatResp> }, sp: { pageNoKey: string; pageSizeKey: string; fromKey: string; toKey: string; size: number; plat: string }): Promise<NormOrder[]> {
  const out: NormOrder[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const biz: Record<string, string> = { [sp.pageNoKey]: String(page), [sp.pageSizeKey]: String(sp.size) };
    if (sp.fromKey) biz[sp.fromKey] = topTimestamp(ctx.sinceMs);
    if (sp.toKey) biz[sp.toKey] = topTimestamp(ctx.untilMs);
    const r = await cli.call(biz);
    if (!r.ok || r.data?.error_response) throw new Error(`${sp.plat} 拉单失败：${topErr(r.data, r.status)}`);
    const body = topUnwrap(r.data ?? {});
    const rows: any[] = pickArr(body, ['orders', 'order_list', 'orderList', 'results', 'data', 'list', 'trades', 'trade_list', m.idKeys[0]]);
    if (rows.length === 0) break;
    for (const o of rows) {
      const key = firstStr(deepGet(o, m.idKeys));
      if (!key || seen.has(`${m.prefix}-${key}`)) continue;
      const n = restGroupNorm(ctx.shop, key, [o], m);
      if (!n) continue;
      seen.add(`${m.prefix}-${key}`);
      out.push(n);
      if (out.length >= ctx.maxOrders) break;
    }
    const total = toNum(deepGet(body, ['total', 'totalSize', 'total_size', 'totalCount', 'count']));
    if (rows.length < sp.size || out.length >= ctx.maxOrders || (total > 0 && page * sp.size >= total)) break;
  }
  if (out.length >= ctx.maxOrders) ctx.warn(`${sp.plat} 本次拉单达到上限 ${ctx.maxOrders} 单，其余下次同步补齐`);
  return out;
}
async function alibabaPull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = alibabaConn(ctx.creds);
  return await topPagedPull(ctx, ALIBABA_META, cli, {
    pageNoKey: cli.pageNoKey, pageSizeKey: cli.pageSizeKey, fromKey: cli.fromKey, toKey: cli.toKey,
    size: cli.size, plat: 'Alibaba 国际站',
  });
}

// ═══════════════════════════════════════════════════════════════════
// 适配器 49：DHgate 敦煌网（开放平台 TOP 风格 router）
//   凭据：app_key + app_secret（open.dhgate.com 创建应用）+ seller_account 位放 access_token
//         （敦煌网历史 ERP 对接把卖家授权串叫「授权令牌」，兼容 creds.access_token 字段名）
//   接口：POST https://api.dhgate.com/dhgate 公共参数 app_key/method/timestamp/v/format/sign(+md5)
//         方法名平台侧有 dhgate.trades.list / 旧版 queryOrderList 两类 → api_method 可覆盖
//   状态：平台返回数字状态位（1 待付款 / 2 待发货 / 3 已发货 / 4 完成 / 5 取消 / 6 纠纷）
//         与词表同名文本双口径，未命中落待处理
// ═══════════════════════════════════════════════════════════════════
const DHGATE_API = 'https://api.dhgate.com/dhgate';
const DHGATE_STATUS_MAP: Record<string, string> = {
  '1': '待处理', '2': '待发货', '3': '已发货', '4': '已完成', '5': '已取消', '6': '售后中',
  'wait_payment': '待处理', 'await_payment': '待处理', 'unpaid': '待处理', 'paid': '待发货',
  'wait_shipment': '待发货', 'await_shipment': '待发货', 'shipped': '已发货', 'partial_shipped': '已发货',
  'completed': '已完成', 'finished': '已完成', 'buyer_confirm_receipt': '已完成',
  'cancelled': '已取消', 'canceled': '已取消', 'closed': '已取消', 'dispute': '售后中', 'refund': '售后中', 'returned': '售后中',
};
const DHGATE_META: RestMeta = {
  plat: 'DHgate 敦煌网', prefix: 'DHGATE', channel: 'DHgate', currency: 'USD',
  map: DHGATE_STATUS_MAP, idKeys: ['tradeNo', 'trade_id', 'tradeId', 'order_id', 'id', 'escrow_id'],
};
function dhgateConn(creds: Record<string, unknown>) {
  const appKey = firstStr(creds.app_key, envOpt('DHGATE_APP_KEY'));
  const appSecret = firstStr(creds.app_secret, envOpt('DHGATE_APP_SECRET'));
  const token = firstStr(creds.access_token, creds.seller_account, creds.session, envOpt('DHGATE_ACCESS_TOKEN'));
  if (!appKey || !appSecret) throw new Error('DHgate 凭据不完整（缺 App Key / App Secret，需在 open.dhgate.com 创建应用并通过审核），请重新授权');
  if (!token) throw new Error('DHgate OAuth 流程尚未就绪：缺少卖家授权令牌（敦煌网需卖家在开放平台完成店铺授权并回写 access_token），请重新授权');
  const apiBase = firstStr(creds.api_base, envOpt('DHGATE_API_BASE'), DHGATE_API).replace(/\/+$/, '');
  return {
    appKey, appSecret, token, apiBase,
    method: firstStr(creds.api_method, envOpt('DHGATE_API_METHOD'), 'dhgate.trades.list'),
    signMethod: firstStr(creds.sign_method, 'md5').toLowerCase(),
    tokenParam: firstStr(creds.token_param, 'access_token'),
    pageNoKey: firstStr(creds.page_key, 'pageNo'),
    pageSizeKey: firstStr(creds.size_key, 'pageSize'),
    fromKey: firstStr(creds.from_key, ''),
    toKey: firstStr(creds.to_key, ''),
    size: toNum(creds.page_size) || 50,
    async call(biz: Record<string, string>): Promise<PlatResp> {
      const params: Record<string, string> = {
        app_key: appKey, sign_method: this.signMethod, format: 'json', v: '1.0',
        timestamp: topTimestamp(Date.now()), method: this.method, ...biz,
      };
      params[this.tokenParam] = this.token;
      params.sign = await topSign(topConcat(params), appSecret, this.signMethod === 'sha256' ? 'sha256' : 'md5', true);
      const res = await fetchDirect(this.apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: new URLSearchParams(params).toString(),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data, link: '' };
    },
  };
}
async function dhgatePull(ctx: FetchCtx): Promise<NormOrder[]> {
  const cli = dhgateConn(ctx.creds);
  return await topPagedPull(ctx, DHGATE_META, cli, {
    pageNoKey: cli.pageNoKey, pageSizeKey: cli.pageSizeKey, fromKey: cli.fromKey, toKey: cli.toKey,
    size: cli.size, plat: 'DHgate 敦煌网',
  });
}

// ─── 适配器注册表 ────────────────────────────────────────────────────
const ADAPTERS: Adapter[] = [
  {
    key: 'woocommerce',
    label: 'WooCommerce',
    aliases: ['woocommerce'],
    checkCreds(creds, shop) {
      const ck = String(creds.consumer_key ?? '').trim();
      const cs = String(creds.consumer_secret ?? '').trim();
      const domain = String(creds.shop_domain ?? shop.shop_domain ?? '').trim();
      if (!ck || !cs || !domain) throw new Error('WooCommerce 凭据不完整（缺域名或 Consumer Key/Secret），请重新授权');
    },
    pull: wooPull,
  },
  {
    key: 'ozon',
    label: 'Ozon',
    aliases: ['ozon'],
    checkCreds(creds) {
      const clientId = String(creds.client_id ?? '').trim();
      const apiKey = String(creds.api_key ?? '').trim();
      if (!clientId || !apiKey) throw new Error('Ozon 凭据不完整（缺 Client-Id 或 Api-Key），请重新授权');
    },
    pull: ozonPull,
    refreshOpen: ozonRefreshOpen,
  },
  {
    key: 'shopify',
    label: 'Shopify',
    aliases: ['shopify'],
    checkCreds(creds, shop) { shopifyConn(creds, shop); },
    pull: shopifyPull,
  },
  {
    key: 'wildberries',
    label: 'Wildberries',
    aliases: ['wildberries', 'wb'],
    checkCreds(creds) { wbConn(creds); },
    pull: wbPull,
  },
  {
    key: 'bigcommerce',
    label: 'BigCommerce',
    aliases: ['bigcommerce'],
    checkCreds(creds) { bcConn(creds); },
    pull: bcPull,
  },
  {
    key: 'mercadolibre',
    label: 'Mercado Libre',
    aliases: ['mercadolibre', 'mercado-libre', 'meli'],
    checkCreds(creds) { mlConn(creds); },
    pull: mlPull,
  },
  {
    key: 'coupang',
    label: 'Coupang',
    aliases: ['coupang'],
    checkCreds(creds) { coupangConn(creds); },
    pull: coupangPull,
  },
  {
    key: 'allegro',
    label: 'Allegro',
    aliases: ['allegro'],
    checkCreds(creds) { allegroConn(creds); },
    pull: allegroPull,
  },
  {
    key: 'tiktok-shop',
    label: 'TikTok Shop',
    aliases: ['tiktok', 'tiktokshop', 'tiktok-shop'],
    checkCreds(creds) { ttsConn(creds); },
    pull: ttsPull,
  },
  {
    key: 'ebay',
    label: 'eBay',
    aliases: ['ebay', 'ebay-marketplace'],
    checkCreds(creds) { ebayConn(creds); },
    pull: ebayPull,
  },
  {
    key: 'walmart',
    label: 'Walmart',
    aliases: ['walmart', 'walmart-marketplace'],
    checkCreds(creds) { wmConn(creds); },
    pull: wmPull,
  },
  {
    key: 'shopee',
    label: 'Shopee',
    aliases: ['shopee', 'shopee-market'],
    checkCreds(creds) { shopeeConn(creds); },
    pull: shopeePull,
  },
  {
    key: 'lazada',
    label: 'Lazada',
    aliases: ['lazada'],
    checkCreds(creds) { lazadaConn(creds); },
    pull: lazadaPull,
  },
  {
    key: 'aliexpress',
    label: 'AliExpress',
    aliases: ['aliexpress', 'ali-express', 'aechoice', '速卖通'],
    checkCreds(creds) { aeConn(creds); },
    pull: aePull,
  },
  {
    key: 'temu',
    label: 'Temu',
    aliases: ['temu', 'temu-local', 'temu-pop', 'temu 全托管'],
    checkCreds(creds) { temuConn(creds); },
    pull: temuPull,
  },
  {
    key: 'yandex-market',
    label: 'Yandex Market',
    aliases: ['yandex', 'yandexmarket', 'yandex-market', 'yamarket'],
    checkCreds(creds) { ymConn(creds); },
    pull: ymPull,
  },
  {
    key: 'amazon',
    label: 'Amazon',
    aliases: ['amazon', 'amazon us', 'amazon eu', 'amazon jp', 'amazon ca', 'amazon au',
      'amazonus', 'amazoneu', 'amazonjp', 'amazonca', 'amazonau', 'amazon sg', 'amazon in',
      'amazon ae', 'amazon sa', 'amazon mx', 'amazon br', 'spapi', 'amazon-sp-api', '亚马逊'],
    checkCreds(creds) { amzConn(creds); },
    pull: amzPull,
  },
  {
    key: 'shein',
    label: 'SHEIN',
    aliases: ['shein', '希音', 'shein-market'],
    checkCreds(creds) { sheinConn(creds); },
    pull: sheinPull,
  },
  {
    key: 'daraz',
    label: 'Daraz',
    aliases: ['daraz', 'daraz pk', 'daraz bd', 'daraz lk', 'daraz np', 'daraz mm'],
    checkCreds(creds) { darazConn(creds); },
    pull: darazPull,
  },
  {
    key: 'noon',
    label: 'Noon',
    aliases: ['noon', 'noon-partners', 'noon-uae'],
    checkCreds(creds) { noonConn(creds); },
    pull: noonPull,
  },
  {
    key: 'cdiscount',
    label: 'Cdiscount',
    aliases: ['cdiscount', 'octopia', 'cdiscount octopia'],
    checkCreds(creds) { cdiscConn(creds); },
    pull: cdiscPull,
  },
  {
    key: 'otto',
    label: 'OTTO',
    aliases: ['otto', 'otto-market', 'ottode'],
    checkCreds(creds) { ottoConn(creds); },
    pull: ottoPull,
  },
  {
    key: 'jumia',
    label: 'Jumia',
    aliases: ['jumia', 'jumia-marketplace', 'jumia-global'],
    checkCreds(creds) { jumiaConn(creds); },
    pull: jumiaPull,
  },
  {
    key: 'wish',
    label: 'Wish',
    aliases: ['wish', 'wishcom', 'wish-commerce'],
    checkCreds(creds) { wishConn(creds); },
    pull: wishPull,
  },
  {
    key: 'jd',
    label: '京东',
    aliases: ['jd', '京东', '京东国际', '京东印尼', 'jingdong', 'jos', 'jd.id', 'jd indonesia'],
    checkCreds(creds, shop) { jdConn(creds, shop); },
    pull: jdPull,
  },
  {
    key: 'wix',
    label: 'Wix',
    aliases: ['wix', 'wixstores', 'wix-stores', 'wix.com'],
    checkCreds(creds) { wixConn(creds); },
    pull: wixPull,
  },
  {
    key: 'magento',
    label: 'Magento',
    aliases: ['magento', 'magento2', 'magento-2', 'adobe commerce', 'adobecommerce'],
    checkCreds(creds, shop) { mageConn(creds, shop); },
    pull: magePull,
  },
  {
    key: 'prestashop',
    label: 'PrestaShop',
    aliases: ['prestashop', 'presta-shop', 'prestashop17'],
    checkCreds(creds, shop) { prestaConn(creds, shop); },
    pull: prestaPull,
  },
  {
    key: 'shopline',
    label: 'Shopline',
    aliases: ['shopline', 'shop-line', 'shopline-store'],
    checkCreds(creds, shop) { shoplineConn(creds, shop); },
    pull: shoplinePull,
  },
  {
    key: 'shopbase',
    label: 'ShopBase',
    aliases: ['shopbase', 'shop-base', 'onshopbase'],
    checkCreds(creds, shop) { shopbaseConn(creds, shop); },
    pull: shopbasePull,
  },
  {
    key: 'shoplazza',
    label: '店匠 Shoplazza',
    aliases: ['shoplazza', 'shop-lazza', '店匠', '店匠shoplazza', 'makewebgood'],
    checkCreds(creds, shop) { shoplazzaConn(creds, shop); },
    pull: shoplazzaPull,
  },
  {
    key: 'ueeshop',
    label: 'UEESHOP',
    aliases: ['ueeshop', 'uee-shop', '澳亚', 'ueeshop独立站'],
    checkCreds(creds) { ueeshopConn(creds); },
    pull: ueeshopPull,
  },
  {
    key: 'shopyy',
    label: 'Shopyy',
    aliases: ['shopyy', 'shop-yy', 'shopyyv1'],
    checkCreds(creds) { shopyyConn(creds); },
    pull: shopyyPull,
  },
  {
    key: 'salla',
    label: 'Salla',
    aliases: ['salla', 'salla-commerce', 'selly', '售阿拉'],
    checkCreds(creds) { sallaConn(creds); },
    pull: sallaPull,
  },
  {
    key: 'allvalue',
    label: 'AllValue',
    aliases: ['allvalue', 'all-value', 'allvalue商城'],
    checkCreds(creds) { allvalueConn(creds); },
    pull: allvaluePull,
  },
  {
    key: 'miravia',
    label: 'Miravia',
    aliases: ['miravia', 'miravia-es', 'miravia 西班牙'],
    checkCreds(creds) { miraviaConn(creds); },
    pull: miraviaPull,
  },
  {
    key: 'emag',
    label: 'eMAG',
    aliases: ['emag', 'e-mag', 'emag.ro', 'emag 罗马尼亚', 'funshop'],
    checkCreds(creds) { emagConn(creds); },
    pull: emagPull,
  },
  {
    key: 'kaufland',
    label: 'Kaufland',
    aliases: ['kaufland', 'kaufland-de', 'kaufland global marketplace', 'landau'],
    checkCreds(creds) { kauflandConn(creds); },
    pull: kauflandPull,
  },
  {
    key: 'onbuy',
    label: 'OnBuy',
    aliases: ['onbuy', 'on-buy', 'onbuy uk'],
    checkCreds(creds) { onbuyConn(creds); },
    pull: onbuyPull,
  },
  {
    key: 'wayfair',
    label: 'Wayfair',
    aliases: ['wayfair', 'wayfair-us', 'wayfair uk', 'castlegate', 'perigold'],
    checkCreds(creds) { wayfairConn(creds); },
    pull: wayfairPull,
  },
  {
    key: 'zalando',
    label: 'Zalando',
    aliases: ['zalando', 'zalando-partner', 'zalando.de', 'zalanado'],
    checkCreds(creds) { zalandoConn(creds); },
    pull: zalandoPull,
  },
  {
    key: 'rakuten',
    label: 'Rakuten',
    aliases: ['rakuten', 'rakuten-de', 'rakuten-fr', 'rakuten-eu', 'rakuten jp', '乐天', '楽天'],
    checkCreds(creds) { rakutenConn(creds); },
    pull: rakutenPull,
  },
  {
    key: 'fnac',
    label: 'Fnac',
    aliases: ['fnac', 'fnac-darty', 'dartymarketplace', 'mirakl', 'marketplace fnac'],
    checkCreds(creds) { fnacConn(creds); },
    pull: fnacPull,
  },
  {
    key: 'joom',
    label: 'Joom',
    aliases: ['joom', 'joompartner', 'joom-shop'],
    checkCreds(creds) { joomConn(creds); },
    pull: joomPull,
  },
  {
    key: 'tiki',
    label: 'Tiki',
    aliases: ['tiki', 'tiki.vn', 'tiki-vn', '越南 tiki'],
    checkCreds(creds) { tikiConn(creds); },
    pull: tikiPull,
  },
  {
    key: 'b2w',
    label: 'B2W Americanas',
    aliases: ['b2w', 'americanas', 'b2w-americanas', 'submarino', 'americanas marketplace'],
    checkCreds(creds) { b2wConn(creds); },
    pull: b2wPull,
  },
  {
    key: 'voghion',
    label: 'Voghion',
    aliases: ['voghion', 'voghion-eu', '薇购'],
    checkCreds(creds) { voghionConn(creds); },
    pull: voghionPull,
  },
  {
    key: 'alibaba',
    label: 'Alibaba 国际站',
    aliases: ['alibaba', 'alibaba 国际站', '阿里巴巴国际站', 'icbu', 'alibaba.com', 'alibaba-intl'],
    checkCreds(creds) { alibabaConn(creds); },
    pull: alibabaPull,
  },
  {
    key: 'dhgate',
    label: 'DHgate 敦煌网',
    aliases: ['dhgate', '敦煌', '敦煌网', 'dhgate-cn'],
    checkCreds(creds) { dhgateConn(creds); },
    pull: dhgatePull,
  },
];

function pickAdapter(platform: unknown): Adapter | null {
  const p = String(platform ?? '').trim().toLowerCase();
  if (!p) return null;
  for (const a of ADAPTERS) {
    if (a.key === p || a.label.toLowerCase() === p || a.aliases.includes(p)) return a;
  }
  for (const a of ADAPTERS) {
    if (a.aliases.some((al) => p.includes(al)) || p.includes(a.key)) return a;
  }
  return null;
}
const SUPPORTED_LABELS = ADAPTERS.map((a) => a.label).join('、');

// ─── 通知（联动红线：失败必写；cron 成功不打扰） ─────────────────────
async function notify(admin: ReturnType<typeof createClient>, userId: string, title: string, content: string) {
  await admin.from('notifications').insert({ user_id: userId, title, content, type: '订单' });
}

// ─── sync-shop 核心：单店增量同步一次（平台无关） ────────────────────
/**
 * Wave C · T2 最外壳：先抢每店锁，抢不到就「如实」记一条 skipped/lock_held 流水并返回，
 * 绝不进入同步逻辑。锁层刻意在 Batch A 日志层之外 —— 锁占用也要留下流水，不能静默。
 */
async function syncShopOnce(admin: ReturnType<typeof createClient>, shop: SyncShop, triggerType: 'manual' | 'cron'): Promise<ShopResult> {
  const lock = await acquireShopLock(admin, shop.id);
  if (!lock.ok) {
    const nowIso = new Date().toISOString();
    await logRun({
      started_at: nowIso,
      finished_at: nowIso,
      user_id: shop.user_id ?? null,
      shop_id: shop.id ?? null,
      platform_key: String(shop.platform ?? '').trim() || (pickAdapter(shop.platform)?.label ?? 'unknown'),
      status: 'skipped',
      pulled: 0, inserted: 0, updated: 0, unchanged: 0,
      error_msg: `上一轮同步仍在执行（店铺锁被占用），本轮跳过（trigger=${triggerType}）`,
      error_code: 'lock_held',
      duration_ms: 0,
    });
    return {
      shop_auth_id: shop.id, shop_name: shop.shop_name, ok: false,
      fetched: 0, inserted: 0, updated: 0, failed: 0,
      error: '店铺另一同步进行中，本轮跳过', duration_ms: 0,
    };
  }
  try {
    return await syncShopOnceLogged(admin, shop, triggerType);
  } finally {
    await releaseShopLock(admin, shop.id, lock.token);
  }
}

/**
 * Batch A 外壳：不改变内部任何同步逻辑，只在「每店一次调用」结束时补一行 sync_run_logs。
 * 内部函数原本就吞掉整店级异常并返回 base，所以 finally 一定走到；
 * 即便 inner 抛出（理论上不会），也会被记成 failed 后原样往上抛，行为不变。
 */
async function syncShopOnceLogged(admin: ReturnType<typeof createClient>, shop: SyncShop, triggerType: 'manual' | 'cron'): Promise<ShopResult> {
  const startedMs = Date.now();
  const startedAtIso = new Date(startedMs).toISOString();
  let res: ShopResult | null = null;
  let crash: string | null = null;
  try {
    res = await syncShopOnceInner(admin, shop, triggerType);
    return res;
  } catch (e) {
    crash = e instanceof Error ? e.message : String(e);
    throw e;
  } finally {
    try {
      const finishedMs = Date.now();
      const msg = crash ?? res?.error ?? null;
      let status: SyncRunStatus = 'failed';
      if (res && res.ok) status = res.failed > 0 ? 'partial' : 'success';
      else if (msg && msg.includes('缺少加密凭据')) status = 'no_credentials';
      else if (msg && msg.includes('尚未接通订单同步')) status = 'skipped';
      else if (msg && (msg.includes('当前状态为') || msg.includes('只有「已授权') || /\b(401|403)\b/.test(msg) || /access_token|client_id|ApiKey|API key/i.test(msg))) status = 'auth_required';
      const fetched = res?.fetched ?? 0;
      const inserted = res?.inserted ?? 0;
      const updated = res?.updated ?? 0;
      const failed = res?.failed ?? (crash ? 1 : 0);
      await logRun({
        started_at: startedAtIso,
        finished_at: new Date(finishedMs).toISOString(),
        user_id: shop.user_id ?? null,
        shop_id: shop.id ?? null,
        platform_key: String(shop.platform ?? '').trim() || (pickAdapter(shop.platform)?.label ?? 'unknown'),
        status,
        pulled: fetched,
        inserted,
        updated,
        unchanged: Math.max(fetched - inserted - updated - failed, 0),
        error_msg: msg ? String(msg).slice(0, 2000) : null,
        error_code: guessErrorCode(msg),
        duration_ms: res?.duration_ms || (finishedMs - startedMs),
      });
    } catch (e) {
      console.error(`[${functionName}] sync_run_logs 包装层异常（已忽略）：${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

async function syncShopOnceInner(admin: ReturnType<typeof createClient>, shop: SyncShop, triggerType: 'manual' | 'cron'): Promise<ShopResult> {
  const t0 = Date.now();
  const base: ShopResult = { shop_auth_id: shop.id, shop_name: shop.shop_name, ok: false, fetched: 0, inserted: 0, updated: 0, failed: 0, duration_ms: 0 };
  const warnings: string[] = [];
  const warn = (msg: string) => { if (warnings.length < 5) warnings.push(msg); };
  try {
    if (!isActiveAuthStatus(shop.status)) throw new Error(`店铺「${shop.shop_name}」当前状态为「${shop.status}」，只有「已授权 / 即将到期」的店铺才能同步`);
    const adapter = pickAdapter(shop.platform);
    if (!adapter) throw new Error(`平台「${shop.platform}」尚未接通订单同步（当前已接通：${SUPPORTED_LABELS}）`);
    if (!shop.credentials_enc) throw new Error('店铺缺少加密凭据，请重新授权');

    const creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
    adapter.checkCreds?.(creds, shop);

    // 1. 读水位：shop_sync_state.last_synced_at → verify_at → 90 天前
    const { data: state } = await admin.from('shop_sync_state').select('last_synced_at').eq('shop_auth_id', shop.id).maybeSingle();
    const watermarkMs = state?.last_synced_at
      ? Date.parse(state.last_synced_at)
      : (shop.verify_at ? Date.parse(shop.verify_at) : Date.now() - FIRST_SYNC_DAYS * 86400_000);
    const sinceMs = Number.isFinite(watermarkMs) ? watermarkMs : Date.now() - FIRST_SYNC_DAYS * 86400_000;
    const ctx: FetchCtx = { admin, shop, creds, sinceMs: sinceMs - WATERMARK_LAG_MS, untilMs: Date.now(), maxOrders: MAX_ORDERS, warn, shared: {} };

    // 2. 增量拉取
    const orders: NormOrder[] = [];
    const byId = new Map<string, NormOrder>();
    for (const n of await adapter.pull(ctx)) {
      if (!byId.has(n.externalId)) { byId.set(n.externalId, n); orders.push(n); }
    }
    base.fetched = orders.length;

    // 3. 未完结订单状态回刷（平台无修改时间增量时必需；覆盖同单的最新状态）
    if (adapter.refreshOpen) {
      const { data: openRows, error: openErr } = await admin.from('orders')
        .select('external_order_id')
        .eq('shop_id', shop.id)
        .not('status', 'in', TERMINAL_STATUSES)
        .order('created_at', { ascending: false })
        .limit(OPEN_REFRESH_LIMIT);
      if (openErr) warn(`未完结订单查询失败（本次跳过状态回刷）：${openErr.message}`);
      const exts = (openRows ?? []).map((r: any) => String(r?.external_order_id ?? '')).filter(Boolean);
      if (exts.length > 0) {
        const refreshed = await adapter.refreshOpen(exts, ctx);
        for (const n of refreshed) {
          if (byId.has(n.externalId)) byId.set(n.externalId, n);
          else { byId.set(n.externalId, n); orders.push(n); base.fetched++; }
        }
      }
    }

    // 4. 逐单落库（幂等）：新单 INSERT（触发 notify_order_created）；状态变化 UPDATE（触发状态/库存 trigger）
    for (const n of orders) {
      try {
        const { data: existing } = await admin.from('orders')
          .select('id, status, amount').eq('external_order_id', n.externalId).maybeSingle();
        if (!existing) {
          const { error } = await admin.from('orders').insert(n.row);
          if (error) {
            if (error.code === '23505') { /* 并发下唯一索引兜底：视为已存在，跳过 */ }
            else throw error;
          } else base.inserted++;
        } else if (existing.status !== n.status) {
          const { error } = await admin.from('orders').update(updatePatch(n.row, Number(existing.amount) || 0)).eq('id', existing.id);
          if (error) throw error;
          base.updated++;
        }
      } catch (e) {
        base.failed++;
        if (base.failed === 1) base.error = `订单 ${n.externalId}: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // 5. 更新水位（拉到数据时取最大平台时间并回退 60s；空拉保持原水位）
    let maxMs: number | null = null;
    for (const n of orders) {
      if (n.modifiedMs !== null && (maxMs === null || n.modifiedMs > maxMs)) maxMs = n.modifiedMs;
    }
    const newWatermark = maxMs !== null ? new Date(Math.max(maxMs - WATERMARK_LAG_MS, sinceMs)) : new Date(sinceMs);
    const batchStatus = base.failed > 0 ? (base.inserted + base.updated > 0 ? '部分成功' : '失败') : '成功';
    const errMsg = base.failed > 0
      ? (base.error ?? `${base.failed} 单处理失败`)
      : (warnings.length > 0 ? warnings.join('；') : null);
    await admin.from('shop_sync_state').upsert({
      shop_auth_id: shop.id, user_id: shop.user_id,
      last_synced_at: newWatermark.toISOString(),
      last_status: batchStatus, last_error: errMsg,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'shop_auth_id' });

    // 6. 审计日志
    base.duration_ms = Date.now() - t0;
    base.ok = batchStatus !== '失败';
    await admin.from('order_sync_logs').insert({
      user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name,
      trigger_type: triggerType, status: batchStatus,
      fetched_count: base.fetched, inserted_count: base.inserted, updated_count: base.updated,
      failed_count: base.failed, error_message: errMsg, duration_ms: base.duration_ms,
    });

    // 7. 通知（联动红线）：失败/部分成功必写；手动同步成功也回一条摘要；cron 成功静默
    if (batchStatus !== '成功') {
      await notify(admin, shop.user_id, '订单同步失败',
        `店铺「${shop.shop_name}」（${adapter.label}）订单同步${batchStatus === '失败' ? '失败' : '部分成功'}：拉取 ${base.fetched}，新增 ${base.inserted}，更新 ${base.updated}，失败 ${base.failed}。${errMsg ? `原因：${errMsg}` : ''}`);
    } else if (triggerType === 'manual') {
      await notify(admin, shop.user_id, '订单同步完成',
        `店铺「${shop.shop_name}」（${adapter.label}）手动同步完成：拉取 ${base.fetched}，新增 ${base.inserted}，更新 ${base.updated}，耗时 ${base.duration_ms}ms${warnings.length ? `。提醒：${warnings.join('；')}` : ''}`);
    }
    return base;
  } catch (e) {
    // 整店级失败：写日志 + 状态 + 通知
    base.duration_ms = Date.now() - t0;
    base.ok = false;
    base.error = e instanceof Error ? e.message : String(e);
    try {
      await admin.from('shop_sync_state').upsert({
        shop_auth_id: shop.id, user_id: shop.user_id,
        last_status: '失败', last_error: base.error,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'shop_auth_id' });
      await admin.from('order_sync_logs').insert({
        user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name,
        trigger_type: triggerType, status: '失败',
        fetched_count: base.fetched, inserted_count: base.inserted, updated_count: base.updated,
        failed_count: Math.max(base.failed, 1), error_message: base.error, duration_ms: base.duration_ms,
      });
      await notify(admin, shop.user_id, '订单同步失败', `店铺「${shop.shop_name}」订单同步失败：${base.error}`);
    } catch { /* 审计失败不再抛出，保持主错误返回 */ }
    return base;
  }
}

// ─── 取店铺列表（平台在代码侧按适配器注册表判定，避免 DB 平台名大小写/别名漏店） ──
async function loadShops(admin: ReturnType<typeof createClient>, userId: string | null): Promise<SyncShop[]> {
  let q = admin.from('shop_auths')
    .select('id, user_id, shop_name, status, platform, credentials_enc, shop_domain, verify_at')
    .in('status', ACTIVE_AUTH_STATUS_LIST);
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw new Error(`查询店铺失败：${error.message}`);
  return ((data ?? []) as unknown as SyncShop[]).filter((s) => pickAdapter(s.platform) !== null);
}

// ─── Batch A：未接通平台的 skip 流水（只读日志，绝不改变同步范围） ──────────
async function logSkippedNoAdapterShops(admin: ReturnType<typeof createClient>, userId: string | null): Promise<void> {
  try {
    let q = admin.from('shop_auths')
      .select('id, user_id, shop_name, status, platform, credentials_enc')
      .in('status', ACTIVE_AUTH_STATUS_LIST);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) {
      console.error(`[${functionName}] skipped 流水查询失败（忽略）：${error.message}`);
      return;
    }
    const nowIso = new Date().toISOString();
    for (const s of (data ?? []) as any[]) {
      if (pickAdapter(s.platform)) continue;   // 已接通的店由 syncShopOnce 记录，勿重复
      await logRun({
        started_at: nowIso,
        finished_at: nowIso,
        user_id: s.user_id ?? null,
        shop_id: s.id ?? null,
        platform_key: String(s.platform ?? '').trim() || 'unknown',
        status: String(s.credentials_enc ?? '') ? 'skipped' : 'no_credentials',
        pulled: 0, inserted: 0, updated: 0, unchanged: 0,
        error_msg: String(s.credentials_enc ?? '')
          ? `平台「${s.platform}」尚未接通订单同步（无适配器）`
          : `平台「${s.platform}」未接通且店铺缺少加密凭据`,
        error_code: null,
        duration_ms: 0,
      });
    }
  } catch (e) {
    console.error(`[${functionName}] logSkippedNoAdapterShops 异常（已忽略）：${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── sync-all ────────────────────────────────────────────────────────
async function syncAll(admin: ReturnType<typeof createClient>, userId: string | null, mode: string): Promise<{ shops: ShopResult[]; total: Omit<ShopResult, 'shop_auth_id' | 'shop_name'> }> {
  const shops = await loadShops(admin, userId);
  // Batch A：把「有店但平台未接通适配器」的店铺记成 skipped 流水（纯日志，不参与、不影响下面的同步）
  await logSkippedNoAdapterShops(admin, userId);
  // 错峰随机抖动：cron 触发时先随机等 0~8 秒，避免与各平台限流窗口撞车
  if (mode === 'cron' && shops.length > 0) {
    await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 8000)));
  }
  const results: ShopResult[] = [];
  // ─── Wave C · T3：分片 fan-out（用户之间并发，用户内部串行）───────────────
  // 旧写法是一条 for 顺序跑完全站所有店：单店慢（平台 30s 超时 × 重试）就把后面所有店拖在同一个
  // 15 分钟窗口里，排在最后的用户常常一整轮都轮不到。
  // 现按 user_id 分桶：桶与桶之间由 N 个 worker 并发消费，桶内保持顺序 + 500ms 间隔
  // —— 顺序+间隔是各平台限流的要求（同一家店并发拉两遍还会撞水位），所以不做「全站一把并发」。
  // 跨用户并发不会放大平台限流：同一个平台的限流是「按店铺凭据」的，不同用户是不同凭据。
  // 单店抛错不终止整轮（旧写法会让整批 cron 直接 500）。
  const CONCURRENCY = Math.max(1, Math.min(20, Number(Deno.env.get('SYNC_CONCURRENCY') || '5') || 5));
  const trigger: 'manual' | 'cron' = mode === 'cron' ? 'cron' : 'manual';
  const byUser = new Map<string, SyncShop[]>();
  for (const s of shops) {
    const arr = byUser.get(s.user_id) || [];
    arr.push(s);
    byUser.set(s.user_id, arr);
  }
  const userQueues: SyncShop[][] = [...byUser.values()];
  const worker = async () => {
    while (userQueues.length > 0) {
      const queue = userQueues.shift()!;
      for (const shop of queue) {
        try {
          results.push(await syncShopOnce(admin, shop, trigger));
        } catch (e) {
          console.error(`[${functionName}] sync err shop=${shop.id} ${e instanceof Error ? e.message : String(e)}`);
        }
        await new Promise((r) => setTimeout(r, 500)); // 同店内多店间限速
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, userQueues.length) }, worker));
  const total = results.reduce((acc, r) => ({
    ok: acc.ok && r.ok, fetched: acc.fetched + r.fetched, inserted: acc.inserted + r.inserted,
    updated: acc.updated + r.updated, failed: acc.failed + r.failed, duration_ms: acc.duration_ms + r.duration_ms,
  }), { ok: true, fetched: 0, inserted: 0, updated: 0, failed: 0, duration_ms: 0 });
  return { shops: results, total };
}

// ─── sync-status ─────────────────────────────────────────────────────
async function syncStatus(admin: ReturnType<typeof createClient>, userId: string | null) {
  let logQ = admin.from('order_sync_logs')
    .select('id, shop_auth_id, shop_name, trigger_type, status, fetched_count, inserted_count, updated_count, failed_count, error_message, duration_ms, created_at')
    .order('created_at', { ascending: false }).limit(10);
  if (userId) logQ = logQ.eq('user_id', userId);
  const { data: recent_logs, error: e1 } = await logQ;
  if (e1) throw new Error(`查询同步日志失败：${e1.message}`);

  let shopQ = admin.from('shop_auths')
    .select('id, shop_name, status, platform, shop_sync_state(last_synced_at, last_status, last_error)')
    .in('status', ACTIVE_AUTH_STATUS_LIST);
  if (userId) shopQ = shopQ.eq('user_id', userId);
  const { data: rows, error: e2 } = await shopQ;
  if (e2) throw new Error(`查询店铺水位失败：${e2.message}`);
  const shops = ((rows ?? []) as any[]).filter((s) => pickAdapter(s.platform) !== null);
  return { recent_logs: recent_logs ?? [], shops, supported_platforms: ADAPTERS.map((a) => a.label) };
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const mode = String(body.mode ?? '');

    // 鉴权：service_role（cron/运维）→ HS256 验签；否则走用户 JWT
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: '未登录或登录已过期' }, 401);
    let serviceMode = false;
    let userId: string | null = null;
    if (await verifyServiceRoleJwt(token, getEnv('JWT_SECRET'))) {
      serviceMode = true;
    } else {
      userId = await resolveUserId(req);
      if (!userId) return json({ error: '未登录或登录已过期' }, 401);
    }

    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

    // Batch A：手动滚动适配器健康快照（pg_cron 缺席/停摆时的兜底口径）
    // 调用：{ "_action": "log_health_snapshot", "window_seconds": 300 }，仅 service_role 或 profiles.role='admin'
    const forcedAction = String(body._action ?? '');
    if (action === 'log_health_snapshot' || forcedAction === 'log_health_snapshot') {
      if (!serviceMode && !(await isAdminUser(admin, userId))) {
        return json({ error: '仅 service_role 或 admin 可滚动适配器健康快照' }, 403);
      }
      const windowSeconds = Math.min(Math.max(Number(body.window_seconds ?? 300) || 300, 60), 3600);
      const { data: wrote, error: rollErr } = await admin.rpc('roll_adapter_health_snapshot', { window_seconds: windowSeconds });
      if (rollErr) return json({ error: `快照聚合失败：${rollErr.message}` }, 500);
      const { data: latest } = await admin.from('adapter_health_snapshots')
        .select('ts, platform_key, calls, ok, fail, skipped, avg_ms, p95_ms, errors')
        .order('ts', { ascending: false }).limit(50);
      console.info(`[${functionName}] ${requestId} log_health_snapshot window=${windowSeconds}s buckets=${wrote}`);
      return json({ ok: true, window_seconds: windowSeconds, buckets_written: wrote ?? 0, latest: latest ?? [] });
    }

    // Batch A：用运维现场填入的测试凭据试跑一次真实 pull（不落库、不读任何店铺凭据）
    // 放在这里而不是 admin-api：适配器注册表（ADAPTERS）只存在于本文件，复制一份必然漂移。
    // 调用：{ action:'test-adapter', platform_key, creds:{...}, days_back?, max_orders? }
    if (action === 'test-adapter') {
      if (!serviceMode && !(await isAdminUser(admin, userId))) {
        return json({ error: '仅 service_role 或 admin 可试跑适配器' }, 403);
      }
      const platform = String(body.platform_key ?? body.platform ?? '').trim();
      const adapter = pickAdapter(platform);
      if (!adapter) {
        return json({ error: `平台「${platform}」没有已注册的订单同步适配器`, registered: ADAPTERS.map((a) => a.key) }, 422);
      }
      const creds = (body.creds && typeof body.creds === 'object') ? body.creds as Record<string, unknown> : {};
      const nil = '00000000-0000-0000-0000-000000000000';
      const shop: SyncShop = {
        id: String(body.shop_id ?? nil),
        user_id: String(userId ?? nil),
        shop_name: String(body.shop_name ?? `${adapter.label} 试跑`),
        status: '已授权',
        platform: adapter.label,
        credentials_enc: null,
        shop_domain: String(body.shop_domain ?? '').trim() || null,
        verify_at: null,
      };
      const warnings: string[] = [];
      const untilMs = Date.now();
      const daysBack = Math.min(Math.max(Number(body.days_back ?? 7) || 7, 1), 90);
      const sinceMs = untilMs - daysBack * 86400_000;
      const t0 = Date.now();
      try {
        adapter.checkCreds?.(creds, shop);
      } catch (e) {
        return json({ ok: false, stage: 'checkCreds', adapter_key: adapter.key, error: e instanceof Error ? e.message : String(e) });
      }
      const ctx: FetchCtx = {
        admin, shop, creds, sinceMs, untilMs,
        maxOrders: Math.min(Math.max(Number(body.max_orders ?? 20) || 20, 1), 200),
        warn: (m: string) => { if (warnings.length < 10) warnings.push(m); },
        shared: {},
      };
      let pulled: NormOrder[] = [];
      try {
        pulled = await adapter.pull(ctx);
      } catch (e) {
        return json({
          ok: false, stage: 'pull', adapter_key: adapter.key,
          error: e instanceof Error ? e.message : String(e),
          warnings, duration_ms: Date.now() - t0,
        });
      }
      const sampleN = Math.min(Math.max(Number(body.sample ?? 3) || 3, 1), 10);
      return json({
        ok: true, adapter_key: adapter.key, adapter_label: adapter.label,
        platform_key: platform, pulled: pulled.length,
        sample: pulled.slice(0, sampleN).map((n) => ({
          external_id: n.externalId, status: n.status,
          modified_at: n.modifiedMs ? new Date(n.modifiedMs).toISOString() : null,
          row: n.row,
        })),
        warnings,
        window: { since: new Date(sinceMs).toISOString(), until: new Date(untilMs).toISOString(), days_back: daysBack },
        duration_ms: Date.now() - t0,
      });
    }

    if (action === 'sync-shop') {
      const shopAuthId = String(body.shop_auth_id ?? '').trim();
      if (!shopAuthId) return json({ error: '缺少 shop_auth_id' }, 400);
      // 用户模式必须校验店铺归属；service 模式可指定任意店
      const { data: shop, error: shopErr } = await admin
        .from('shop_auths')
        .select('id, user_id, shop_name, status, platform, credentials_enc, shop_domain, verify_at')
        .eq('id', shopAuthId)
        .maybeSingle();
      if (shopErr || !shop) return json({ error: '店铺不存在' }, 404);
      if (!serviceMode && (shop as any).user_id !== userId) return json({ error: '无权同步该店铺：店铺不属于当前用户' }, 403);
      const r = await syncShopOnce(admin, shop as unknown as SyncShop, mode === 'cron' ? 'cron' : 'manual');
      console.info(`[${functionName}] ${requestId} sync-shop ${shopAuthId} → ok=${r.ok} fetched=${r.fetched} ins=${r.inserted} upd=${r.updated} fail=${r.failed}`);
      return json({ ok: r.ok, ...r, duration_ms: r.duration_ms });
    }

    if (action === 'sync-all') {
      const r = await syncAll(admin, userId, mode);
      console.info(`[${functionName}] ${requestId} sync-all mode=${mode || (serviceMode ? 'service' : 'user')} shops=${r.shops.length} fetched=${r.total.fetched} ins=${r.total.inserted} upd=${r.total.updated} fail=${r.total.failed}`);
      return json({ ok: r.total.ok, ...r });
    }

    if (action === 'sync-status') {
      const r = await syncStatus(admin, userId);
      return json(r);
    }

    if (action === 'list-platforms') {
      return json({ supported: ADAPTERS.map((a) => ({ key: a.key, label: a.label })) });
    }

    return json({ error: `未知 action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
