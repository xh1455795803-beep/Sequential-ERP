// shop-status-check — 店铺状态检测（凭据有效性 + 业务健康度）
// =====================================================================
// 职责：对已授权店铺做真实状态检测，回答两个互不相同的问题：
//
//   1) 授权状态机 status（已授权 / 待验证 / 即将到期 / 已过期 / 已停用 / 未授权）
//      —— 「授权还在不在？」
//      只有两种情况允许把 status 改写：
//        a) 平台接口明确返回 401 / 403（平台判定凭据无效）
//        b) token_expires_at 已过期
//      其余任何异常（网络抖动、超时、5xx、429、404、解析失败……）一律不动 status。
//      原因：结算链路只认 status='已授权'，一次网络抖动不能把店铺踢出结算链路。
//
//   2) 业务健康度 shop_status（正常 / 异常 / 未检测）
//      —— 「这个店铺现在能不能正常用？」
//      shop_status 与 status 严格分离，互不覆盖：异常只落 shop_status，不动 status。
//
// actions:
//   check          { id }             检测单个店铺（仅限本人名下）
//   check-all      { }                检测当前用户全部在用店铺
//   check-platform { platform }       检测当前用户某平台全部店铺
//
// 检测端点来源（platform_auth_config）：
//   verify_endpoint        text   检测接口 URL，支持 {占位符}
//   verify_credential_map  jsonb  { header:{}, query:{}, body:{} }
//                           值为字面量，或 {凭据字段} 占位符（从店铺凭据 / 店铺列取）
//   verify_mode            text   'api' = 走接口检测；'none' = 该平台不支持状态检测
//
//   ✅ 线上现状：platform_auth_config 的 verify_endpoint / verify_credential_map / verify_mode
//       三列已落地，直接走接口检测；万一读不到（列被删/权限不足）才降级为
//       「全部平台未检测」，绝不把没检测过的店铺写成「正常」。
//
//   请求组装规则：
//     1) 占位符守卫：模板里 {凭据字段} 解析不出来（平台要、店铺没有）→ 不发请求，
//        记「检测配置未解析」+ shop_status='未检测'，绝不带字面量去请求平台
//        （平台会回 400/401，被误判成凭据失效并改写 status）。
//     2) Content-Type 驱动 body 编码：按平台配置的 Content-Type 选编码
//        （x-www-form-urlencoded / json / text-xml 原文），不再一律 JSON。
//     3) 模板支持 base64(...) 包裹（Basic 认证用），如 Walmart 的
//        Basic base64({client_id}:{client_secret})。
//     说明：Amazon US / JP / EU / CA / AU 共用一套凭据形态，检测配置建议复制到每一行。
//
// 凭据解密（AES-GCM / PBKDF2，与 authorize-shop 加密端完全对称）：
//   密钥 = JWT_SECRET 环境变量；盐 = 'thalvior-cred-v1'；迭代 100000；SHA-256；
//   密文 = base64( iv[12] || cipher )；明文 = JSON 字符串。
//   OAuth 型店铺的令牌在 shop_auths.access_token 列（非加密），手动型在 credentials_enc。
//
// 落库：
//   shop_auths            只写 shop_status / last_checked_at；确有必要时才写 status。
//                         绝不触碰 credentials_enc / access_token / id，绝不删行。
//   shop_status_check_logs 每次检测一条 (user_id, shop_id, platform, status, error, checked_at)。
//                         status 记 正常 / 异常 / 未检测，error 记中文原因。
//
// 定时检测：本函数不自带 pg_cron / 定时任务，由外部调度器调用 check-all。
//
// 环境变量：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const functionName = 'shop-status-check';

// 判定「即将到期」的时间窗（仅用于返回值展示，不写库、不影响结算链路）
const EXPIRING_WINDOW_MS = 7 * 24 * 3600 * 1000;
// 单次批量检测的最大店铺数，防止一次请求打爆平台接口
const MAX_SHOPS_PER_RUN = 100;
// 并发检测数
const CONCURRENCY = 4;
// 平台接口超时
const VERIFY_TIMEOUT_MS = 15000;

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

async function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
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

// base64 / base64url → 字节
function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return raw;
}

// 凭据解密（与 authorize-shop 的 encryptCredentials 完全对称）
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
type ShopStatus = '正常' | '异常' | '未检测';

interface VerifyCredentialMap {
  header?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}

interface PlatformVerifyConfig {
  platformKey: string;
  platformName: string;
  apiBaseUrl: string | null;
  verifyEndpoint: string | null;
  verifyCredentialMap: VerifyCredentialMap;
  verifyMode: string;
}

interface ShopRow {
  id: string;
  user_id: string;
  shop_name: string;
  platform: string;
  status: string | null;
  shop_status: string;
  auth_type: string | null;
  credentials_enc: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  shop_domain: string | null;
  platform_shop_id: string | null;
  scope: string | null;
  unbound_at?: string | null;
}

interface CheckResult {
  shop_id: string;
  platform: string;
  shop_name: string;
  shop_status: ShopStatus;
  auth_status: string;
  error: string | null;
  checked_at: string;
  skipped?: boolean;
}

interface Outcome {
  shop_status: ShopStatus;
  error: string | null;
  persist_status: string | null;
  auth_expired: boolean;
}

// ─── 平台检测配置读取 ────────────────────────────────────────────────
// platform_auth_config 的 verify_* 三列已落地；万一读不到（列被删/权限不足），
// 优雅降级：退回基础列，全部平台按「未检测」处理，绝不假装正常。
async function loadVerifyConfigs(
  admin: ReturnType<typeof createClient>,
): Promise<{ configs: Map<string, PlatformVerifyConfig>; degraded: boolean; degradedReason: string }> {
  const baseCols = 'platform_key, platform_name, api_base_url, auth_type';
  const fullCols = `${baseCols}, verify_endpoint, verify_credential_map, verify_mode`;

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
      degradedReason =
        'platform_auth_config 尚未配置 verify_endpoint / verify_credential_map / verify_mode（迁移待补），本次全部平台按「未检测」处理';
      const basic = await admin.from('platform_auth_config').select(baseCols);
      if (basic.error) throw new Error(`读取平台检测配置失败：${basic.error.message}`);
      rows = (basic.data ?? []) as unknown as Record<string, unknown>[];
    } else {
      throw new Error(`读取平台检测配置失败：${msg}`);
    }
  }

  const configs = new Map<string, PlatformVerifyConfig>();
  for (const r of rows) {
    const key = String(r.platform_key ?? '').trim();
    if (!key) continue;
    const rawMap = r.verify_credential_map as VerifyCredentialMap | null | undefined;
    const map: VerifyCredentialMap = rawMap && typeof rawMap === 'object' ? rawMap : {};
    configs.set(key.toLowerCase(), {
      platformKey: key,
      platformName: String(r.platform_name ?? key),
      apiBaseUrl: r.api_base_url ? String(r.api_base_url) : null,
      verifyEndpoint: r.verify_endpoint ? String(r.verify_endpoint) : null,
      verifyCredentialMap: {
        header: map.header ?? {},
        query: map.query ?? {},
        body: map.body ?? {},
      },
      verifyMode: String(r.verify_mode ?? 'none'),
    });
  }
  return { configs, degraded, degradedReason };
}

// 店铺平台 → 检测配置（忽略大小写；'amazon' 可命中 'amazon us'，'tiktok' 可命中 'tiktok shop'）
function matchConfig(platform: string, configs: Map<string, PlatformVerifyConfig>): PlatformVerifyConfig | null {
  const p = platform.trim().toLowerCase();
  if (!p) return null;
  const exact = configs.get(p);
  if (exact) return exact;
  for (const [k, v] of configs) {
    if (k.startsWith(p + ' ')) return v;
    if (p.startsWith(k + ' ')) return v;
  }
  return null;
}

// 店铺平台匹配（check-platform 用；同样容忍 amazon / amazon us 这类前缀关系）
function platformMatches(shopPlatform: string, wanted: string): boolean {
  const a = shopPlatform.trim().toLowerCase();
  const b = wanted.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.startsWith(b + ' ')) return true;
  if (b.startsWith(a + ' ')) return true;
  return false;
}

// ─── 凭据视图 / 占位符解析 ───────────────────────────────────────────
// 视图里同时含：店铺列字段（access_token 等）+ 解密后的手动凭据字段（同名以手动凭据为准）
function buildCredView(creds: Record<string, unknown>, shop: ShopRow): Record<string, string> {
  const view: Record<string, string> = {};
  const put = (k: string, v: unknown, override: boolean) => {
    if (v === null || v === undefined) return;
    const kk = k.trim().toLowerCase();
    if (!kk) return;
    if (!override && kk in view) return;
    view[kk] = String(v);
  };
  put('access_token', shop.access_token, false);
  put('refresh_token', shop.refresh_token, false);
  put('shop_domain', shop.shop_domain, false);
  put('platform_shop_id', shop.platform_shop_id, false);
  put('shop_name', shop.shop_name, false);
  put('platform', shop.platform, false);
  put('scope', shop.scope, false);
  put('credentials', JSON.stringify(creds), false);
  for (const [k, v] of Object.entries(creds)) put(k, v, true);
  return view;
}

// 解析模板：把 {凭据字段} 换成真实值。
// missing 收集「视图里没有的占位符」→ 调用方据此跳过请求，
// 绝不带着 {token} 字面量去请求平台（平台会回 400/401，被误判成凭据失效并改写 status）。
// 额外支持 base64(...) 包裹：base64({client_id}:{client_secret}) → base64(client_id:client_secret)
function resolveTemplate(tpl: string, view: Record<string, string>, missing?: Set<string>): string {
  let localMissing = 0;
  const substituted = String(tpl ?? '').replace(/\{([A-Za-z0-9_.-]+)\}/g, (whole, key: string) => {
    const k = key.trim().toLowerCase();
    const v = view[k];
    if (v === undefined) {
      localMissing++;
      if (missing) missing.add(k);
      return whole;
    }
    return v;
  });
  if (localMissing > 0) return substituted;
  return substituted.replace(/base64\(([^()]*)\)/gi, (_m, inner: string) => toBase64(inner));
}

// UTF-8 安全 base64（Deno / Node 都有 btoa）
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// 依据 verify_credential_map 组装真实请求
// missing：模板里没能解析出值的占位符（= 平台需要但本店铺没有的凭据），调用方据此跳过请求
function buildVerifyRequest(
  cfg: PlatformVerifyConfig,
  view: Record<string, string>,
): { url: string; init: RequestInit; missing: string[]; contentType: string; bodyKind: string } {
  const missing = new Set<string>();
  const rawEndpoint = String(cfg.verifyEndpoint ?? '').trim();
  const endpoint = resolveTemplate(rawEndpoint, view, missing);
  const map = cfg.verifyCredentialMap;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'Thalvior-ERP/1.0 (support@thalvior.icu)',
  };
  for (const [k, v] of Object.entries(map.header ?? {})) {
    headers[k] = resolveTemplate(String(v ?? ''), view, missing);
  }

  let url: URL;
  if (/^https?:\/\//i.test(endpoint)) {
    url = new URL(endpoint);
  } else if (cfg.apiBaseUrl) {
    const base = resolveTemplate(cfg.apiBaseUrl, view, missing);
    url = new URL(endpoint.startsWith('/') ? endpoint : `/${endpoint}`, base);
  } else {
    throw new Error(`检测端点不是合法 URL：${endpoint}`);
  }
  for (const [k, v] of Object.entries(map.query ?? {})) {
    url.searchParams.set(k, resolveTemplate(String(v ?? ''), view, missing));
  }

  const init: RequestInit = { method: 'GET', headers };
  let contentType = '';
  let bodyKind = 'none';
  const bodyKeys = Object.keys(map.body ?? {});
  if (bodyKeys.length > 0) {
    // 非字符串值（如 Ozon 的 limit:1 / filter:{}）原样保留，不做字符串化
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(map.body ?? {})) {
      body[k] = typeof v === 'string' ? resolveTemplate(v, view, missing) : v;
    }
    // Content-Type 由平台配置决定，绝不覆盖配置里已声明的类型：
    //   application/x-www-form-urlencoded → 表单编码（Amazon/Allegro/Jumia/ML/Walmart）
    //   application/json                  → JSON 编码（Ozon 等）
    //   text/xml 等其它                    → 原文直发（eBay 的 raw XML）
    const ctRaw = headers['Content-Type'] ?? headers['content-type'];
    contentType = (ctRaw ? String(ctRaw) : 'application/json').toLowerCase();
    if (!ctRaw) headers['Content-Type'] = 'application/json';
    init.method = 'POST';
    if (contentType.includes('x-www-form-urlencoded')) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) form.set(k, String(v ?? ''));
      init.body = form.toString();
      bodyKind = 'form';
    } else if (contentType.includes('json')) {
      init.body = JSON.stringify(body);
      bodyKind = 'json';
    } else {
      const raw = typeof body.raw === 'string' ? body.raw : '';
      init.body = raw || Object.entries(body).map(([k, v]) => `${k}=${v}`).join('&');
      bodyKind = 'raw';
    }
  }
  return { url: url.toString(), init, missing: Array.from(missing), contentType, bodyKind };
}

// 从平台响应体里提取一句可读原因
function extractPlatformMessage(text: string): string {
  const raw = (text ?? '').trim();
  if (!raw) return '';
  let msg = '';
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const cand = d.message ?? d.error_description ?? d.error_message ?? d.error ?? d.detail ?? d.msg;
    if (typeof cand === 'string') msg = cand;
    else if (cand && typeof cand === 'object') {
      const obj = cand as Record<string, unknown>;
      const inner = obj.message ?? obj.description ?? obj.code;
      msg = typeof inner === 'string' ? inner : JSON.stringify(cand).slice(0, 160);
    }
  } catch {
    msg = raw.slice(0, 160);
  }
  msg = msg.replace(/\s+/g, ' ').trim();
  if (!msg) return '';
  return msg.length > 160 ? `${msg.slice(0, 160)}…` : msg;
}

// 平台「应用级」拒绝标记：命中说明是我们自己的 app 凭据/请求格式有问题，不是店铺授权失效
const APP_LEVEL_MARKERS = [
  'invalid_client',
  'unauthorized_client',
  'invalid_client_id',
  'client authentication failed',
  'invalid api key',
  'invalid api-key',
  'invalid x-api-key',
  'invalid access key',
  'invalid_request',
  'unsupported_grant_type',
];

// 2xx 但响应体明确说令牌无效的情况，也按凭据失效处理
function looksLikeInvalidToken(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  const markers = [
    'invalid_token',
    'invalid_grant',
    'token_expired',
    'token has expired',
    'invalid access token',
    'access_token_invalid',
    'access token is invalid',
    'unauthorized',
  ];
  return markers.some((m) => t.includes(m));
}

// ─── 单店检测 ────────────────────────────────────────────────────────
async function probePlatform(cfg: PlatformVerifyConfig, view: Record<string, string>): Promise<{
  ok: boolean;
  expired: boolean;
  error: string | null;
  skipped?: boolean;
}> {
  let built: { url: string; init: RequestInit; missing: string[]; contentType: string; bodyKind: string };
  try {
    built = buildVerifyRequest(cfg, view);
  } catch (e) {
    return { ok: false, expired: false, skipped: true, error: `检测配置错误：${errText(e)}（不改变授权状态）` };
  }
  // 守卫：模板里有没解析出来的占位符（= 平台需要但本店铺没有的凭据）→ 不发请求。
  // 带 {token} 字面量去请求平台会拿到 400/401，被误判成「凭据已失效」并改写 status。
  if (built.missing.length > 0) {
    return {
      ok: false,
      expired: false,
      skipped: true,
      error: `检测配置未解析：缺少凭据字段 ${built.missing.join('、')}，已跳过请求（不改变授权状态）`,
    };
  }
  // 脱敏日志：只记方法/主机/路径/编码方式，不记 query 与 body 明文
  try {
    const u = new URL(built.url);
    console.info(
      `[${functionName}] probe ${cfg.platformKey} ${built.init.method} ${u.origin}${u.pathname}` +
        ` ct=${built.contentType || '-'} body=${built.bodyKind}`,
    );
  } catch {
    // 日志失败不影响检测
  }

  let res: Response;
  try {
    res = await fetchWithTimeout(built.url, built.init, VERIFY_TIMEOUT_MS);
  } catch (e) {
    const m = errText(e);
    const reason = m.includes('abort') || m.includes('timeout') ? '检测请求超时' : `检测请求失败：${m}`;
    return { ok: false, expired: false, error: `${reason}（不改变授权状态）` };
  }

  const text = await res.text().catch(() => '');

  // 平台明确判定凭据无效 → 这是唯一允许改写 status 的「接口侧」信号
  if (res.status === 401 || res.status === 403) {
    const detail = extractPlatformMessage(text);
    // 但 401/403 也可能是「平台应用级凭据被拒」（invalid_client / 无效 api key），
    // 这时店铺令牌其实还有效，绝不能改写 status
    if (APP_LEVEL_MARKERS.some((m) => (detail || text).toLowerCase().includes(m))) {
      return {
        ok: false,
        expired: false,
        error: `平台应用凭据被拒：HTTP ${res.status}${detail ? `（${detail}）` : ''}（非店铺授权失效，不改变授权状态）`,
      };
    }
    return {
      ok: false,
      expired: true,
      error: `凭据已失效：平台返回 HTTP ${res.status}${detail ? `（${detail}）` : ''}`,
    };
  }

  if (res.status >= 200 && res.status < 300) {
    if (looksLikeInvalidToken(text)) {
      const detail = extractPlatformMessage(text);
      return { ok: false, expired: true, error: `凭据已失效：${detail || '平台返回令牌无效'}` };
    }
    return { ok: true, expired: false, error: null };
  }

  if (res.status === 429) {
    return { ok: false, expired: false, error: '平台限流（HTTP 429），请稍后重试（不改变授权状态）' };
  }
  if (res.status === 404) {
    return { ok: false, expired: false, error: '检测端点不存在（HTTP 404），请检查平台检测配置（不改变授权状态）' };
  }
  if (res.status >= 500) {
    return { ok: false, expired: false, error: `平台服务异常（HTTP ${res.status}），请稍后重试（不改变授权状态）` };
  }
  const detail = extractPlatformMessage(text);
  return {
    ok: false,
    expired: false,
    error: `检测未通过：HTTP ${res.status}${detail ? `（${detail}）` : ''}（不改变授权状态）`,
  };
}

// 计算授权状态机取值
function resolveAuthStatus(currentStatus: string, expired: boolean, tokenExpiresAt: string | null): string {
  if (currentStatus === '已停用') return '已停用';
  if (expired) return '已过期';
  if (tokenExpiresAt) {
    const t = new Date(tokenExpiresAt).getTime();
    if (Number.isFinite(t)) {
      if (t <= Date.now()) return '已过期';
      if (t - Date.now() <= EXPIRING_WINDOW_MS) return '即将到期';
    }
  }
  return currentStatus;
}

// 检测单个店铺并落库
async function checkOne(
  admin: ReturnType<typeof createClient>,
  shop: ShopRow,
  cfg: PlatformVerifyConfig | null,
  degradedReason: string,
): Promise<CheckResult> {
  const checkedAt = new Date().toISOString();
  const currentStatus = (shop.status ?? '未授权').trim() || '未授权';

  let outcome: Outcome;

  const unsupported = (reason: string): Outcome => ({
    shop_status: '未检测',
    error: reason,
    persist_status: null,
    auth_expired: false,
  });

  if (!cfg) {
    outcome = unsupported('该平台暂不支持状态检测');
  } else if (cfg.verifyMode !== 'api') {
    outcome = unsupported('该平台暂不支持状态检测');
  } else if (!cfg.verifyEndpoint) {
    outcome = unsupported('该平台暂不支持状态检测');
  } else {
    // 解密凭据
    let creds: Record<string, unknown> = {};
    if (shop.credentials_enc) {
      try {
        const secret = Deno.env.get('JWT_SECRET') ?? 'thalvior-default-secret';
        creds = await decryptCredentials(shop.credentials_enc, secret);
      } catch (e) {
        outcome = {
          shop_status: '异常',
          error: `凭据解密失败：${errText(e)}（不改变授权状态）`,
          persist_status: null,
          auth_expired: false,
        };
        // 走到落库
        return persistOutcome(admin, shop, currentStatus, outcome, checkedAt);
      }
    }

    const view = buildCredView(creds, shop);
    const map = cfg.verifyCredentialMap;
    const mapNeedsCredential =
      Object.keys(map.header ?? {}).length + Object.keys(map.query ?? {}).length + Object.keys(map.body ?? {}).length > 0;

    if (mapNeedsCredential && !shop.credentials_enc && !shop.access_token) {
      outcome = {
        shop_status: '异常',
        error: '缺少可用的平台凭据，无法发起检测（不改变授权状态）',
        persist_status: null,
        auth_expired: false,
      };
    } else {
      const probe = await probePlatform(cfg, view);
      outcome = {
        // skipped = 本次没真正发出检测请求（配置缺字段/端点非法）→ 记「未检测」，
        // 既不冒充正常，也不把平台配置问题算成店铺异常
        shop_status: probe.skipped ? '未检测' : (probe.ok ? '正常' : '异常'),
        error: probe.error,
        persist_status: null,
        auth_expired: probe.expired,
      };
    }
  }

  // token 已过期：按授权状态机规则改写 status（已停用不覆盖）
  const tokenExpired = !!shop.token_expires_at && new Date(shop.token_expires_at).getTime() <= Date.now();
  if ((outcome.auth_expired || tokenExpired) && currentStatus !== '已停用') {
    outcome.persist_status = '已过期';
  }

  if (degradedReason && outcome.shop_status === '未检测' && outcome.error === '该平台暂不支持状态检测') {
    outcome.error = `该平台暂不支持状态检测（${degradedReason}）`;
  }

  return persistOutcome(admin, shop, currentStatus, outcome, checkedAt);
}

// 落库 + 写检测日志
async function persistOutcome(
  admin: ReturnType<typeof createClient>,
  shop: ShopRow,
  currentStatus: string,
  outcome: Outcome,
  checkedAt: string,
): Promise<CheckResult> {
  const patch: Record<string, unknown> = {
    shop_status: outcome.shop_status,
    last_checked_at: checkedAt,
  };
  if (outcome.persist_status && outcome.persist_status !== currentStatus) {
    patch.status = outcome.persist_status;
  }
  const { error: upErr } = await admin.from('shop_auths').update(patch).eq('id', shop.id);
  if (upErr) {
    console.error(`[${functionName}] 更新店铺状态失败 shop=${shop.id} ${upErr.message}`);
  }

  // 检测日志
  const logRow = {
    user_id: shop.user_id,
    shop_id: shop.id,
    platform: shop.platform,
    status: outcome.shop_status,
    error: outcome.error,
    checked_at: checkedAt,
  };
  const { error: logErr } = await admin.from('shop_status_check_logs').insert(logRow);
  if (logErr) {
    console.error(`[${functionName}] 写入检测日志失败 shop=${shop.id} ${logErr.message}`);
  }

  const authStatus = resolveAuthStatus(
    outcome.persist_status ?? currentStatus,
    outcome.persist_status === '已过期',
    shop.token_expires_at,
  );

  return {
    shop_id: shop.id,
    platform: shop.platform,
    shop_name: shop.shop_name,
    shop_status: outcome.shop_status,
    auth_status: authStatus,
    error: outcome.error,
    checked_at: checkedAt,
  };
}

// ─── 取店铺 ──────────────────────────────────────────────────────────
const SHOP_FIELDS =
  'id, user_id, shop_name, platform, status, shop_status, auth_type, credentials_enc, access_token, refresh_token, token_expires_at, shop_domain, platform_shop_id, scope, unbound_at';

async function loadShops(
  admin: ReturnType<typeof createClient>,
  userId: string,
  filter: { id?: string; platform?: string },
): Promise<ShopRow[]> {
  let q = admin.from('shop_auths').select(SHOP_FIELDS).eq('user_id', userId);
  if (filter.id) q = q.eq('id', filter.id);
  const { data, error } = await q;
  if (error) throw new Error(`读取店铺列表失败：${error.message}`);
  let rows = (data ?? []) as unknown as ShopRow[];
  // 只检测在用店铺（已解绑的不检测）
  rows = rows.filter((s) => (s as unknown as { unbound_at?: string | null }).unbound_at == null);
  if (filter.platform) {
    rows = rows.filter((s) => platformMatches(s.platform, filter.platform as string));
  }
  rows.sort((a, b) => a.platform.localeCompare(b.platform) || a.shop_name.localeCompare(b.shop_name));
  return rows.slice(0, MAX_SHOPS_PER_RUN);
}

// 简单并发池
async function runPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(
      (async () => {
        for (;;) {
          const idx = cursor++;
          if (idx >= items.length) return;
          out[idx] = await worker(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return out;
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
  const shopId = String(body.id ?? body.shop_id ?? '').trim();
  const platform = String(body.platform ?? '').trim();

  try {
    const userId = await resolveUserId(req);
    if (!userId) return json({ error: '未登录' }, 401);

    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const { configs, degraded, degradedReason } = await loadVerifyConfigs(admin);

    let shops: ShopRow[] = [];
    if (action === 'check') {
      if (!shopId) return json({ error: '缺少 id（要检测的店铺 ID）' }, 400);
      if (!/^[0-9a-fA-F-]{36}$/.test(shopId)) return json({ error: '店铺 ID 格式不正确' }, 400);
      shops = await loadShops(admin, userId, { id: shopId });
      if (shops.length === 0) return json({ error: '店铺不存在或不属于当前用户' }, 404);
    } else if (action === 'check-all') {
      shops = await loadShops(admin, userId, {});
    } else if (action === 'check-platform') {
      if (!platform) return json({ error: '缺少 platform' }, 400);
      shops = await loadShops(admin, userId, { platform });
      if (shops.length === 0) return json({ error: `当前用户没有「${platform}」平台的店铺` }, 404);
    } else {
      return json({ error: `未知 action: ${action}` }, 400);
    }

    const results = await runPool(shops, CONCURRENCY, async (shop) => {
      const cfg = matchConfig(shop.platform, configs);
      return await checkOne(admin, shop, cfg, degradedReason);
    });

    const ok = results.filter((r) => r.shop_status === '正常').length;
    const failed = results.filter((r) => r.shop_status === '异常').length;
    const unchecked = results.filter((r) => r.shop_status === '未检测').length;

    console.info(
      `[${functionName}] ${requestId} action=${action} checked=${results.length} ok=${ok} failed=${failed} unchecked=${unchecked}` +
        (degraded ? ` degraded=${degradedReason}` : ''),
    );

    return json({
      checked: results.length,
      ok,
      failed,
      results,
      unchecked,
      degraded,
      ...(degraded ? { degraded_reason: degradedReason } : {}),
    });
  } catch (err) {
    const msg = errText(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
