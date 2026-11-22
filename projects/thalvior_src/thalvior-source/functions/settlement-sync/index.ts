// settlement-sync — 真利润核算/业财一体：平台结算费用同步引擎（完整版）
// =====================================================================
// 平台覆盖（第一批 5 家，字段映射完整实现）：
//   WooCommerce  GET /wp-json/wc/v3/orders → fee_lines/shipping_lines/tax_lines/refunds【实测通路】
//   Shopify      Admin REST orders（运费/税）+ Shopify Payments payouts（支付手续费）
//   Ozon         POST /v1/finance/cash-flow-statement/list（半月佣金/物流/服务/退款汇总）
//                POST /v1/finance/accrual/by-day（逐日应计明细；旧 /v3/finance/transaction/list 已下线 404）
//   TikTok Shop  GET /finance/202501/transactions（revenue/fee_and_tax/shipping_cost，HMAC 签名）
//   Shopee       /api/v2/payment/get_escrow_list + get_escrow_detail（佣金/服务费/运费三态）
// 无凭证（credentials_enc 缺失或关键子段缺失）→ 返回 NO_CREDENTIALS，不崩、不落库。
//
// actions:
//   sync-shop {shop_auth_id}            单店同步（按店铺平台自动 dispatch）
//   sync-all  {mode}                    全部第一批平台（cron/用户模式）
//   sync-status                         最近日志 + 各店水位
//   woo|shopify|ozon|tiktok|shopee      只同步该平台
//
// 鉴权（与 sync-orders 完全同模式）：
//   用户模式 Authorization: Bearer <用户JWT> → admin.auth.getUser
//   Cron/服务模式 Bearer <service_role key> → JWT_SECRET HS256 验签 role=service_role
//
// 落库（platform_fee_records）：
//   唯一键 (platform, platform_order_no, fee_account_id, sku) + upsert 幂等
//   同步行 sku=''（订单级）；同单同科目多笔先合并再 upsert（金额累加、raw 保留数组）
//   分摊衍生行 sku=真实SKU、allocation_group_id=源记录id（allocate_fees RPC 生成）
//
// 金额符号约定（重要）：费用=正数；退款/返还冲减=负数（仅允许 is_negative_allowed 科目）。
//
// 异常检测（同步时逐订单执行，规则可配 fee_settings）：
//   R1 单笔费用绝对值 > single_fee_threshold（默认 10000）
//   R2 负数金额落在 is_negative_allowed=false 的科目
//   R3 同订单同科目（sku='' 源行）条数 > dup_account_limit（默认 2）
//   R4 Σ费用（同单源行） > 订单收入 orders.amount
//   命中 → platform_fee_records.is_abnormal=true + abnormal_reason；新增异常写 notifications(type='自动化')
//
// 通知红线：异常新增必写通知；cron 正常同步成功静默（防刷屏）；手动同步成功回摘要。
// 水位：settlement_sync_state.last_synced_at（按 Woo modified_after 等），空拉保持原水位。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ACTIVE_AUTH_STATUS_LIST, isActiveAuthStatus } from '../_shared/shop-status.ts';

const functionName = 'settlement-sync';
const MAX_PAGES = 50;
const WATERMARK_LAG_MS = 60_000;
const FIRST_SYNC_DAYS = 90;
// 第一批平台：库内 platform 名（大小写不敏感匹配）→ 适配器
const PLATFORM_ADAPTERS: Record<string, string> = {
  'woocommerce': 'woo',
  'shopify': 'shopify',
  'ozon': 'ozon',
  'tiktok shop': 'tiktok',
  'tiktokshop': 'tiktok',
  'shopee': 'shopee',
};
const PLATFORM_PATTERNS: Record<string, string> = {
  woo: 'WooCommerce', shopify: 'Shopify', ozon: 'Ozon', tiktok: 'TikTok Shop', shopee: 'Shopee',
};
// 外部订单号前缀（与 sync-orders 的 WOO-{店8}-{单号} 约定一致；其余平台供未来订单同步对齐）
const EXTERNAL_PREFIX: Record<string, string> = {
  woo: 'WOO', shopify: 'SHOPIFY', ozon: 'OZON', tiktok: 'TIKTOK', shopee: 'SHOPEE',
};

// ─── 通用工具 ────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}
async function fetchDirect(url: string, init: RequestInit, ms = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    // 踩坑：edge runtime fetch 不解压 gzip → 必须显式 identity
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { ...init.headers, 'Accept-Encoding': 'identity' } });
  } finally {
    clearTimeout(timer);
  }
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
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
async function decryptCredentials(encB64: string, secret: string): Promise<Record<string, unknown>> {
  const enc = new TextEncoder();
  const raw = b64urlToBytes(encB64.replace(/-/g, '+').replace(/_/g, '/'));
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
function parseGmt(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

// ─── 类型 ────────────────────────────────────────────────────────────
interface SyncShop {
  id: string; user_id: string; shop_name: string; status: string; platform: string;
  credentials_enc: string | null; shop_domain: string | null; verify_at: string | null;
}
interface RawFee {
  accountCode: string;
  amount: number;              // 费用=正；退款冲减=负
  currency: string;
  platformOrderNo: string;
  raw: Record<string, unknown>;
  occurredAt: string | null;
}
interface FeeRow {
  user_id: string; shop_auth_id: string; platform: string;
  order_id: string | null; platform_order_no: string; fee_account_id: string;
  sku: string; item_name: string; amount: number; currency: string;
  raw: Record<string, unknown>; occurred_at: string | null;
  allocation_type: string;
}
interface AcctInfo { id: string; is_negative_allowed: boolean; is_active: boolean }
interface Settings { threshold: number; dupLimit: number; feeGtRevenue: boolean }
interface ShopOutcome {
  shop_auth_id: string; shop_name: string; platform: string; ok: boolean;
  code?: 'OK' | 'NO_CREDENTIALS' | 'NO_ACCOUNTS' | 'FAILED';
  fetched_orders: number; fee_count: number; inserted: number; updated: number;
  abnormal_new: number; error?: string; duration_ms: number;
}
type AdminClient = ReturnType<typeof createClient>;

// ─── 科目解析（带自动 seed 兜底） ────────────────────────────────────
async function loadFeeAccounts(admin: AdminClient, userId: string): Promise<Map<string, AcctInfo>> {
  await admin.rpc('seed_fee_accounts', { p_user: userId });
  const { data, error } = await admin.from('fee_accounts').select('id, code, is_negative_allowed, is_active').eq('user_id', userId);
  if (error) throw new Error(`查询费用科目失败：${error.message}`);
  const m = new Map<string, AcctInfo>();
  for (const a of (data ?? []) as any[]) m.set(String(a.code), { id: a.id, is_negative_allowed: !!a.is_negative_allowed, is_active: a.is_active !== false });
  return m;
}
async function loadSettings(admin: AdminClient, userId: string): Promise<Settings> {
  const { data } = await admin.from('fee_settings').select('single_fee_threshold, dup_account_limit, fee_gt_revenue_enabled').eq('user_id', userId).maybeSingle();
  return {
    threshold: num((data as any)?.single_fee_threshold) || 10000,
    dupLimit: Math.max(1, Number((data as any)?.dup_account_limit) || 2),
    feeGtRevenue: (data as any)?.fee_gt_revenue_enabled !== false,
  };
}

// ─── 行合并（同单同科目同 SKU 合并，保证 upsert 批内无冲突） ─────────
function mergeRows(rows: FeeRow[]): FeeRow[] {
  const map = new Map<string, FeeRow>();
  for (const r of rows) {
    const key = `${r.platform_order_no}|${r.fee_account_id}|${r.sku}`;
    const cur = map.get(key);
    if (!cur) map.set(key, r);
    else {
      cur.amount = Math.round((cur.amount + r.amount) * 100) / 100;
      const raws = Array.isArray((cur.raw as any).merged) ? (cur.raw as any).merged : [cur.raw];
      raws.push(r.raw);
      cur.raw = { merged: raws };
    }
  }
  return Array.from(map.values());
}

// ─── upsert（幂等） + 订单关联 ───────────────────────────────────────
async function resolveErpOrder(admin: AdminClient, shop: SyncShop, pfx: string, platformOrderNo: string): Promise<string | null> {
  const ext = `${pfx}-${shop.id.slice(0, 8)}-${platformOrderNo}`;
  const { data } = await admin.from('orders').select('id').eq('external_order_id', ext).maybeSingle();
  return (data as any)?.id ?? null;
}
async function upsertFees(admin: AdminClient, rows: FeeRow[]): Promise<{ inserted: number; updated: number; idMap: Record<string, string> }> {
  if (rows.length === 0) return { inserted: 0, updated: 0, idMap: {} };
  // 幂等落库走 SQL RPC upsert_fee_records：ON CONFLICT 命中 uniq_pfr_synced 部分唯一索引
  // （platform, platform_order_no, fee_account_id WHERE sku='' AND allocation_group_id IS NULL）
  // → 重复同步不翻倍；衍生行（分摊）不受该索引约束
  const { data, error } = await admin.rpc('upsert_fee_records', { p_rows: rows });
  if (error) throw new Error(`费用记录落库失败：${error.message}`);
  const res = data as { inserted?: number; updated?: number; map?: Record<string, string> } | null;
  return {
    inserted: Number(res?.inserted ?? 0),
    updated: Number(res?.updated ?? 0),
    idMap: res?.map ?? {},
  };
}

// ─── 异常检测（R1-R4） ───────────────────────────────────────────────
async function notifyFeeAbnormal(admin: AdminClient, userId: string, orderLabel: string, reasons: string[]) {
  await admin.from('notifications').insert({
    user_id: userId, type: '自动化',
    title: '费用异常提醒',
    content: `订单 ${orderLabel} 检测到 ${reasons.length} 条费用异常：${reasons.slice(0, 5).join('；')}。请在「利润报表 → 费用异常」中查看处理。`,
  });
}
async function detectAbnormal(
  admin: AdminClient, shop: SyncShop, settings: Settings,
  accounts: Map<string, AcctInfo>, acctIdToCode: Map<string, string>,
  scope: { orderId: string | null } , upsertedIds: string[],
): Promise<number> {
  // 取该订单（或本次落库行）的全部源行（sku=''）
  let q = admin.from('platform_fee_records')
    .select('id, fee_account_id, amount, platform_order_no, is_abnormal, abnormal_reason')
    .eq('user_id', shop.user_id).eq('sku', '').is('allocation_group_id', null);
  if (scope.orderId) q = q.eq('order_id', scope.orderId);
  else if (upsertedIds.length > 0) q = q.in('id', upsertedIds);
  else return 0;
  const { data: rows, error } = await q;
  if (error) throw new Error(`异常检测查询失败：${error.message}`);
  if (!rows || rows.length === 0) return 0;

  const rowIds = (rows as any[]).map((r) => r.id);
  const flags = new Map<string, string>();   // rowId → reason

  for (const r of rows as any[]) {
    const code = acctIdToCode.get(r.fee_account_id) ?? '';
    const acct = accounts.get(code);
    if (Math.abs(Number(r.amount)) > settings.threshold) {
      flags.set(r.id, `单笔费用 ${r.amount} 超阈值 ${settings.threshold}（科目 ${code}）`);
    } else if (Number(r.amount) < 0 && acct && !acct.is_negative_allowed) {
      flags.set(r.id, `负数金额落在非退款科目 ${code}`);
    }
  }
  // R3：同订单同科目条数
  const byAcct = new Map<string, any[]>();
  for (const r of rows as any[]) {
    const arr = byAcct.get(r.fee_account_id) ?? [];
    arr.push(r); byAcct.set(r.fee_account_id, arr);
  }
  for (const [acctId, arr] of byAcct) {
    if (arr.length > settings.dupLimit) {
      const code = acctIdToCode.get(acctId) ?? acctId.slice(0, 8);
      for (const r of arr) if (!flags.has(r.id)) flags.set(r.id, `同订单同科目 ${code} 重复 ${arr.length} 条（上限 ${settings.dupLimit}）`);
    }
  }
  // R4：费用总额 > 订单收入
  if (scope.orderId && settings.feeGtRevenue) {
    const { data: orderRow } = await admin.from('orders').select('amount, currency').eq('id', scope.orderId).maybeSingle();
    if (orderRow) {
      const totalFee = (rows as any[]).reduce((s, r) => s + Number(r.amount), 0);
      if (Math.round(totalFee * 100) / 100 > Number(orderRow.amount)) {
        for (const r of rows as any[]) {
          if (!flags.has(r.id)) flags.set(r.id, `同单费用合计 ${totalFee} 超过订单收入 ${orderRow.amount} ${orderRow.currency ?? ''}`.trim());
        }
      }
    }
  }

  // 落标记（先重置再评估：数据修正后异常自动解除）
  await admin.from('platform_fee_records').update({ is_abnormal: false, abnormal_reason: '' }).in('id', rowIds);
  let newAbnormal = 0;
  const newReasons: string[] = [];
  if (flags.size > 0) {
    const markRows: any[] = [];
    for (const [id, reason] of flags) {
      markRows.push({ id, is_abnormal: true, abnormal_reason: reason });
      const prev = (rows as any[]).find((r) => r.id === id);
      if (prev && !prev.is_abnormal) { newAbnormal++; newReasons.push(reason); }
    }
    for (const m of markRows) {
      await admin.from('platform_fee_records').update({ is_abnormal: m.is_abnormal, abnormal_reason: m.abnormal_reason }).eq('id', m.id);
    }
    if (newAbnormal > 0) {
      await notifyFeeAbnormal(admin, shop.user_id, (rows as any[])[0]?.platform_order_no || scope.orderId || shop.shop_name, newReasons);
    }
  }
  return newAbnormal;
}

// ─── 平台适配器公共落库 ──────────────────────────────────────────────
async function persistFees(
  admin: AdminClient, shop: SyncShop, adapterKey: string,
  accounts: Map<string, AcctInfo>, acctIdToCode: Map<string, string>,
  rawFees: RawFee[],
): Promise<{ rows: number; up: { inserted: number; updated: number }; perOrder: Map<string, { orderId: string | null; ids: string[]; orderNo: string }> }> {
  const pfx = EXTERNAL_PREFIX[adapterKey] ?? adapterKey.toUpperCase();
  // 订单号 → ERP order 关联（一次查询缓存）
  const orderLinkCache = new Map<string, string | null>();
  const rows: FeeRow[] = [];
  for (const f of rawFees) {
    const acct = accounts.get(f.accountCode);
    if (!acct) throw new Error(`科目缺失：${f.accountCode}（请重新授权或联系管理员重新 seed）`);
    if (!acct.is_active) continue; // 停用科目不落新数据
    let orderId = orderLinkCache.get(f.platformOrderNo);
    if (orderId === undefined) { orderId = await resolveErpOrder(admin, shop, pfx, f.platformOrderNo); orderLinkCache.set(f.platformOrderNo, orderId); }
    rows.push({
      user_id: shop.user_id, shop_auth_id: shop.id, platform: PLATFORM_PATTERNS[adapterKey] ?? shop.platform,
      order_id: orderId, platform_order_no: f.platformOrderNo, fee_account_id: acct.id,
      sku: '', item_name: '', amount: f.amount, currency: f.currency,
      raw: f.raw, occurred_at: f.occurredAt, allocation_type: 'none',
    });
  }
  // merged 行携带 _rid，RPC 按 rid 精确回查落库后的记录 id
  const merged = mergeRows(rows).map((r, i) => ({ ...r, _rid: `f${Date.now().toString(36)}_${i}` }));
  const up = await upsertFees(admin, merged as unknown as FeeRow[]);
  // 按订单分组（用于逐单异常检测）：ids 由 rid → idMap 精确映射
  const perOrder = new Map<string, { orderId: string | null; ids: string[]; orderNo: string }>();
  for (const r of merged as (FeeRow & { _rid: string })[]) {
    const g = perOrder.get(r.platform_order_no) ?? { orderId: r.order_id, ids: [], orderNo: r.platform_order_no };
    if (!g.orderId && r.order_id) g.orderId = r.order_id;
    const rid = up.idMap[r._rid];
    if (rid) g.ids.push(rid);
    perOrder.set(r.platform_order_no, g);
  }
  return { rows: merged.length, up, perOrder };
}

// ─── WooCommerce 适配器（实测通路，映射表写全） ──────────────────────
// 映射表（WooCommerce → fee_accounts）：
//   shipping_lines[].total − total_tax → logistics.shipping_fee（物流运费）
//   tax_lines[].tax_total              → other.tax（税费，订单级全部税，shipping 用净额防双计）
//   fee_lines[].amount 按名称匹配：
//     payment/gateway/stripe/paypal/手续费/支付  → finance.payment_fee（支付手续费）
//     commission/佣金                            → platform.commission（平台佣金）
//     packaging/packing/wrap/包装                → logistics.packing（包装费）
//     insurance/保险 / cod/货到付款              → finance.other（其他金融费）
//     其余                                       → other.misc（其他费用）
//   refunds[]：refund.shipping_lines/fee_lines 同映射取负（冲减）
function mapWooFeeLine(name: unknown): string {
  const n = String(name ?? '').toLowerCase();
  if (/(payment|gateway|stripe|paypal|alipay|wechat|square|klarna|手续费|支付)/.test(n)) return 'finance.payment_fee';
  if (/(commission|佣金)/.test(n)) return 'platform.commission';
  if (/(packaging|packing|wrap|包装|礼盒|礼品)/.test(n)) return 'logistics.packing';
  if (/(insurance|保险)/.test(n)) return 'finance.other';
  if (/(cod|cash on delivery|货到付款)/.test(n)) return 'finance.other';
  return 'other.misc';
}
const WOO_SKIP_STATUS = new Set(['checkout-draft', 'auto-draft', 'trash']);
function extractWooFees(o: Record<string, any>): RawFee[] {
  const out: RawFee[] = [];
  const orderNo = String(o.id ?? '').trim();
  const ccy = String(o.currency ?? 'USD').toUpperCase();
  const occ = parseGmt(o.date_created_gmt ?? o.date_created);
  const push = (code: string, amount: number, raw: Record<string, unknown>) => {
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return;
    out.push({ accountCode: code, amount, currency: ccy, platformOrderNo: orderNo, raw, occurredAt: occ });
  };
  for (const sl of (Array.isArray(o.shipping_lines) ? o.shipping_lines : []) as any[]) {
    push('logistics.shipping_fee', num(sl.total) - num(sl.total_tax), { source: 'shipping_lines', id: sl.id, method_title: sl.method_title, total: sl.total, total_tax: sl.total_tax });
  }
  for (const tl of (Array.isArray(o.tax_lines) ? o.tax_lines : []) as any[]) {
    push('other.tax', num(tl.tax_total), { source: 'tax_lines', id: tl.id, rate_code: tl.rate_code, tax_total: tl.tax_total });
  }
  for (const fl of (Array.isArray(o.fee_lines) ? o.fee_lines : []) as any[]) {
    push(mapWooFeeLine(fl.name), num(fl.amount), { source: 'fee_lines', id: fl.id, name: fl.name, amount: fl.amount });
  }
  for (const rf of (Array.isArray(o.refunds) ? o.refunds : []) as any[]) {
    for (const sl of (Array.isArray(rf.shipping_lines) ? rf.shipping_lines : []) as any[]) {
      push('logistics.shipping_fee', -num(sl.total), { source: 'refund_shipping', refund_id: rf.id, reason: rf.reason });
    }
    for (const fl of (Array.isArray(rf.fee_lines) ? rf.fee_lines : []) as any[]) {
      push(mapWooFeeLine(fl.name), -num(fl.amount), { source: 'refund_fee', refund_id: rf.id, name: fl.name });
    }
  }
  return out;
}
function wooBase(domain: string): string {
  const d = domain.trim().replace(/\/+$/, '');
  return d.startsWith('http') ? d : `https://${d}`;
}
async function syncWooShop(admin: AdminClient, shop: SyncShop, triggerType: string, accounts: Map<string, AcctInfo>, acctIdToCode: Map<string, string>, settings: Settings): Promise<ShopOutcome> {
  const t0 = Date.now();
  const out: ShopOutcome = { shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'WooCommerce', ok: false, fetched_orders: 0, fee_count: 0, inserted: 0, updated: 0, abnormal_new: 0, duration_ms: 0 };
  try {
    if (!isActiveAuthStatus(shop.status)) throw new Error(`店铺状态为「${shop.status}」，只有「已授权 / 即将到期」的店铺才能同步结算`);
    if (!shop.credentials_enc) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: 店铺缺少加密凭据'; return out; }
    const creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
    const ck = String(creds.consumer_key ?? '').trim();
    const cs = String(creds.consumer_secret ?? '').trim();
    const domain = String(creds.shop_domain ?? shop.shop_domain ?? '');
    if (!ck || !cs || !domain) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: WooCommerce 凭据不完整（缺域名或 Key/Secret）'; return out; }
    const auth = `consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`;

    // 水位
    const { data: state } = await admin.from('settlement_sync_state').select('last_synced_at').eq('shop_auth_id', shop.id).maybeSingle();
    const watermarkMs = state?.last_synced_at ? Date.parse((state as any).last_synced_at) : (shop.verify_at ? Date.parse(shop.verify_at) : Date.now() - FIRST_SYNC_DAYS * 86400_000);
    const watermark = new Date(Number.isFinite(watermarkMs) ? watermarkMs : Date.now() - FIRST_SYNC_DAYS * 86400_000);
    const modifiedAfter = new Date(watermark.getTime() - WATERMARK_LAG_MS).toISOString().replace('.000Z', 'Z');

    // 分页增量拉订单（含费用字段）
    let page = 1;
    let maxModified: number | null = null;
    const orders: any[] = [];
    for (;;) {
      const url = `${wooBase(domain)}/wp-json/wc/v3/orders?modified_after=${encodeURIComponent(modifiedAfter)}&per_page=100&page=${page}&orderby=modified&order=desc&status=any&${auth}`;
      const res = await fetchDirect(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
      const text = await res.text();
      let data: any; try { data = text ? JSON.parse(text) : null; } catch { throw new Error(`WooCommerce 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`); }
      if (!res.ok) {
        const msg = data?.message ?? `HTTP ${res.status}`;
        throw new Error(`WooCommerce 拉单失败：${msg}${data?.code ? ` (${data.code})` : ''}`);
      }
      const rows = Array.isArray(data) ? data : [];
      orders.push(...rows);
      out.fetched_orders += rows.length;
      for (const o of rows) {
        const gm = Date.parse(String(o.date_modified_gmt ?? '').replace(' ', 'T') + (String(o.date_modified_gmt ?? '').endsWith('Z') ? '' : 'Z'));
        if (Number.isFinite(gm) && (maxModified === null || gm > maxModified)) maxModified = gm;
      }
      if (rows.length < 100 || page >= MAX_PAGES) break;
      page++;
    }

    // 逐单抽费 → 落库 → 异常检测
    const statusesSeen = new Map<string, string>();
    for (const o of orders) {
      const st = String(o.status ?? '').toLowerCase();
      statusesSeen.set(st, st);
      if (WOO_SKIP_STATUS.has(st)) continue;
      const rawFees = extractWooFees(o);
      if (rawFees.length === 0) continue;
      const { rows, up, perOrder } = await persistFees(admin, shop, 'woo', accounts, acctIdToCode, rawFees);
      out.fee_count += rows;
      out.inserted += up.inserted;
      out.updated += up.updated;
      for (const [, g] of perOrder) {
        const n = await detectAbnormal(admin, shop, settings, accounts, acctIdToCode, { orderId: g.orderId }, g.ids);
        out.abnormal_new += n;
      }
    }

    // 水位 + 审计
    const newWatermark = maxModified !== null ? new Date(maxModified - WATERMARK_LAG_MS) : watermark;
    await admin.from('settlement_sync_state').upsert({
      shop_auth_id: shop.id, user_id: shop.user_id,
      last_synced_at: newWatermark.toISOString(), last_status: '成功', last_error: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'shop_auth_id' });
    out.duration_ms = Date.now() - t0;
    out.ok = true; out.code = 'OK';
    await admin.from('settlement_sync_logs').insert({
      user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'WooCommerce',
      trigger_type: triggerType, status: '成功',
      fetched_orders: out.fetched_orders, fee_count: out.fee_count,
      inserted_count: out.inserted, updated_count: out.updated, abnormal_count: out.abnormal_new,
      duration_ms: out.duration_ms,
    });
    if (triggerType === 'manual') {
      await admin.from('notifications').insert({
        user_id: shop.user_id, type: '自动化', title: '结算同步完成',
        content: `店铺「${shop.shop_name}」结算费用同步完成：订单 ${out.fetched_orders}，费用记录 ${out.fee_count} 条，异常新增 ${out.abnormal_new} 条，耗时 ${out.duration_ms}ms`,
      });
    }
    return out;
  } catch (e) {
    out.duration_ms = Date.now() - t0;
    out.ok = false; out.code = out.code ?? 'FAILED';
    out.error = e instanceof Error ? e.message : String(e);
    try {
      await admin.from('settlement_sync_state').upsert({
        shop_auth_id: shop.id, user_id: shop.user_id,
        last_status: '失败', last_error: out.error, updated_at: new Date().toISOString(),
      }, { onConflict: 'shop_auth_id' });
      await admin.from('settlement_sync_logs').insert({
        user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'WooCommerce',
        trigger_type: triggerType, status: '失败',
        fetched_orders: out.fetched_orders, fee_count: out.fee_count,
        abnormal_count: out.abnormal_new, error_message: out.error, duration_ms: out.duration_ms,
      });
      await admin.from('notifications').insert({
        user_id: shop.user_id, type: '自动化', title: '结算同步失败',
        content: `店铺「${shop.shop_name}」结算费用同步失败：${out.error}`,
      });
    } catch { /* 审计失败不抛出 */ }
    return out;
  }
}

// ─── Shopify 适配器（完整映射：orders 运费/税 + Payments payout 手续费） ──
async function syncShopifyShop(admin: AdminClient, shop: SyncShop, triggerType: string, accounts: Map<string, AcctInfo>, acctIdToCode: Map<string, string>, settings: Settings): Promise<ShopOutcome> {
  const t0 = Date.now();
  const out: ShopOutcome = { shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Shopify', ok: false, fetched_orders: 0, fee_count: 0, inserted: 0, updated: 0, abnormal_new: 0, duration_ms: 0 };
  try {
    if (!isActiveAuthStatus(shop.status)) throw new Error(`店铺状态为「${shop.status}」`);
    if (!shop.credentials_enc) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: Shopify 未配置凭据（需 Admin API access token + 店铺域名）'; return out; }
    const creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
    const token = String(creds.access_token ?? '').trim();
    let domain = String(creds.shop_domain ?? shop.shop_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (!token || !domain) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: Shopify 凭据不完整（缺 access_token 或 shop_domain）'; return out; }
    const base = `https://${domain}`;
    const api = '2024-10';
    const H = { 'X-Shopify-Access-Token': token, 'Accept': 'application/json' };

    const { data: state } = await admin.from('settlement_sync_state').select('last_synced_at').eq('shop_auth_id', shop.id).maybeSingle();
    const watermarkMs = state?.last_synced_at ? Date.parse((state as any).last_synced_at) : (shop.verify_at ? Date.parse(shop.verify_at) : Date.now() - FIRST_SYNC_DAYS * 86400_000);
    const watermark = new Date(Number.isFinite(watermarkMs) ? watermarkMs : Date.now() - FIRST_SYNC_DAYS * 86400_000);
    const updatedMin = new Date(watermark.getTime() - WATERMARK_LAG_MS).toISOString();

    // 1) orders：运费 + 税
    const q = new URLSearchParams({ status: 'any', limit: '250', updated_at_min: updatedMin,
      fields: 'id,name,currency,created_at,updated_at,total_price,total_shipping_price_set,total_tax_set' });
    const res = await fetchDirect(`${base}/admin/api/${api}/orders.json?${q}`, { headers: H });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Shopify orders 拉取失败：HTTP ${res.status} ${(body as any)?.errors ?? ''}`);
    const orders = (body as any)?.orders ?? [];
    const rawFees: RawFee[] = [];
    for (const o of orders) {
      const orderNo = String(o.name ?? o.id ?? '');
      const ccy = String(o.currency ?? 'USD').toUpperCase();
      const occ = parseGmt(o.created_at);
      const ship = num((o.total_shipping_price_set as any)?.shop_money?.amount);
      if (Math.abs(ship) >= 0.005) rawFees.push({ accountCode: 'logistics.shipping_fee', amount: ship, currency: ccy, platformOrderNo: orderNo, raw: { source: 'orders.total_shipping_price_set', order_id: o.id }, occurredAt: occ });
      const tax = num((o.total_tax_set as any)?.shop_money?.amount);
      if (Math.abs(tax) >= 0.005) rawFees.push({ accountCode: 'other.tax', amount: tax, currency: ccy, platformOrderNo: orderNo, raw: { source: 'orders.total_tax_set', order_id: o.id }, occurredAt: occ });
    }
    out.fetched_orders = orders.length;

    // 2) Shopify Payments payout 手续费（需 read_shopify_payments，失败不阻塞主流程）
    let payoutNote = '';
    try {
      const pRes = await fetchDirect(`${base}/admin/api/${api}/shopify_payments/payouts.json?limit=50&status=paid`, { headers: H });
      if (pRes.ok) {
        const pBody = await pRes.json().catch(() => null);
        const payouts = (pBody as any)?.payouts ?? [];
        for (const p of payouts.slice(0, 10)) {
          const tRes = await fetchDirect(`${base}/admin/api/${api}/shopify_payments/payouts/${p.id}/transactions.json`, { headers: H });
          if (!tRes.ok) continue;
          const tBody = await tRes.json().catch(() => null);
          for (const tx of (tBody as any)?.transactions ?? []) {
            const fee = num(tx.fee);
            if (Math.abs(fee) >= 0.005) {
              rawFees.push({ accountCode: 'finance.payment_fee', amount: Math.abs(fee), currency: String(tx.currency ?? 'USD').toUpperCase(),
                platformOrderNo: `payout-${p.id}`, raw: { source: 'shopify_payments.payout_transactions', payout_id: p.id, tx_type: tx.type, payout_status: p.status },
                occurredAt: parseGmt(tx.processed_at ?? p.date) });
            }
          }
        }
      } else payoutNote = `（payouts 接口 HTTP ${pRes.status}，跳过支付手续费抓取）`;
    } catch (pe) { payoutNote = `（payouts 异常：${pe instanceof Error ? pe.message : pe}）`; }

    if (rawFees.length > 0) {
      const { rows, up, perOrder } = await persistFees(admin, shop, 'shopify', accounts, acctIdToCode, rawFees);
      out.fee_count = rows; out.inserted = up.inserted; out.updated = up.updated;
      for (const [, g] of perOrder) {
        out.abnormal_new += await detectAbnormal(admin, shop, settings, accounts, acctIdToCode, { orderId: g.orderId }, g.ids);
      }
    }
    await admin.from('settlement_sync_state').upsert({
      shop_auth_id: shop.id, user_id: shop.user_id, last_synced_at: new Date().toISOString(),
      last_status: '成功', last_error: payoutNote || null, updated_at: new Date().toISOString(),
    }, { onConflict: 'shop_auth_id' });
    out.ok = true; out.code = 'OK'; out.duration_ms = Date.now() - t0;
    await admin.from('settlement_sync_logs').insert({
      user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Shopify',
      trigger_type: triggerType, status: '成功', fetched_orders: out.fetched_orders, fee_count: out.fee_count,
      inserted_count: out.inserted, updated_count: out.updated, abnormal_count: out.abnormal_new,
      error_message: payoutNote || null, duration_ms: out.duration_ms,
    });
    return out;
  } catch (e) {
    out.duration_ms = Date.now() - t0; out.ok = false; out.code = out.code ?? 'FAILED';
    out.error = e instanceof Error ? e.message : String(e);
    try {
      await admin.from('settlement_sync_state').upsert({ shop_auth_id: shop.id, user_id: shop.user_id, last_status: '失败', last_error: out.error, updated_at: new Date().toISOString() }, { onConflict: 'shop_auth_id' });
      await admin.from('settlement_sync_logs').insert({
        user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Shopify',
        trigger_type: triggerType, status: '失败', error_message: out.error, duration_ms: out.duration_ms,
      });
    } catch { /* ignore */ }
    return out;
  }
}

// ─── Ozon 适配器（静态 Client-Id + Api-Key） ────────────────────────
// 数据源（均用主人真实 Ozon 店铺凭据实测，2026-11-16）：
//   /v1/finance/cash-flow-statement/list  半月期间汇总：佣金/物流/服务/退款 → 期间级费用行
//   /v1/finance/accrual/by-day            逐日应计明细 → 逐单费用行（现网该店尚无已结算订单，返回空数组）
//   ⚠ 原实现走 /v3/finance/transaction/list，该路径已从 Ozon Seller API 下线（HTTP 404 page not found），
//     导致 Ozon 费用一直同步不到、利润页只有收入没有成本。
// 操作类型映射（官方枚举，凭真实凭证接入后按返回值校准）：
//   *SaleCommission* → platform.commission；*LastMile*/物流履约类 → logistics.last_mile；
//   *MarketingAction* → marketing.other；*Return*/退款类 → finance.refund_fee（负向冲减）；
//   *Compensation*/*赔偿 → other.compensation；其余 → platform.other
function mapOzonOperation(t: string): { code: string; negate: boolean } {
  const s = String(t ?? '');
  if (/SaleCommission|Commission/i.test(s)) return { code: 'platform.commission', negate: false };
  if (/LastMile|Fulfillment|Dropoff|Delivery|Logistic/i.test(s)) return { code: 'logistics.last_mile', negate: false };
  if (/MarketingAction|Promotion/i.test(s)) return { code: 'marketing.other', negate: false };
  if (/Return|Refund/i.test(s)) return { code: 'finance.refund_fee', negate: true };
  if (/Compensation|Penalty|Fine/i.test(s)) return { code: 'other.compensation', negate: false };
  return { code: 'platform.other', negate: false };
}
const OZON_ACCRUAL_MAX_DAYS = 31;

/**
 * 半月结算汇总 → 费用行（实测端点，Ozon 跨境店唯一确定的费用口径）
 *   POST /v1/finance/cash-flow-statement/list  {date:{from,to}, page, page_size}
 *   → {result:{cash_flows:[{period:{id,begin,end}, orders_amount, returns_amount, commission_amount,
 *          services_amount, item_delivery_and_return_amount, currency_code}], page_count, details}}
 * 期间级金额没有单号 → platform_order_no 用 OZON-PERIOD-{begin~end}，不挂到具体订单（order_id 为空），
 * 利润页按「店铺 + 期间」计入；orders_amount 是成交额（收入），不落费用表。
 */
function mapOzonCashFlow(f: any): RawFee[] {
  const begin = String(f?.period?.begin ?? '').trim();
  if (!begin) return [];
  const end = String(f?.period?.end ?? '').trim();
  const currency = String(f?.currency_code ?? '').toUpperCase();
  const orderNo = `OZON-PERIOD-${begin.slice(0, 10)}${end ? `~${end.slice(0, 10)}` : ''}`;
  const rows: RawFee[] = [];
  // 符号口径：ERP 约定「费用=正、退款冲减=负」（见 RawFee.amount 注释）。
  // Ozon 本期间该店尚无已结算订单，汇总全为 0，无法用真实非零样本校准平台自身正负号，
  // 因此这里固定按 ERP 口径取绝对值，并把平台原值（含原始符号）留在 raw.platform_value，
  // 等首个非零期间出现后可一次性校正（不改历史数据，只改符号规则）。
  const push = (accountCode: string, rawVal: unknown, negative: boolean) => {
    const v = num(rawVal);
    if (v === 0) return; // 0 元期间不产生费用行（避免噪声数据）
    const abs = Math.abs(v);
    rows.push({
      accountCode,
      amount: negative ? -abs : abs,
      currency: currency || 'RUB',
      platformOrderNo: orderNo,
      raw: {
        source: 'v1/finance/cash-flow-statement/list',
        period_id: f?.period?.id ?? 0, period_begin: begin, period_end: end,
        field: accountCode, platform_value: v, currency_code: currency,
      },
      occurredAt: parseGmt(end || begin),
    });
  };
  push('platform.commission', f?.commission_amount, false);
  push('logistics.last_mile', f?.item_delivery_and_return_amount, false);
  push('platform.other', f?.services_amount, false);
  push('finance.refund_fee', f?.returns_amount, true);
  return rows;
}

/**
 * 逐日应计明细 → 费用行
 *   POST /v1/finance/accrual/by-day {date:'YYYY-MM-DD'} → {accruals:[], last_id:''}（实测 200）
 * 现网该跨境店铺尚无已结算订单，accruals 恒为空，条目字段无法用真实数据校准，
 * 因此这里只做「识别得出金额 + 单号才落，识别不出整体跳过」的防御式解析——绝不猜数字。
 */
function mapOzonAccrual(a: any, dateStr: string): RawFee[] {
  const amount = num(a?.amount ?? a?.accrual_amount ?? a?.total);
  if (amount === 0) return [];
  const orderNo = String(a?.posting_number ?? a?.order_number ?? a?.posting?.posting_number ?? '').trim();
  const { code, negate } = mapOzonOperation(String(a?.type ?? a?.accrual_type ?? a?.operation_type ?? ''));
  const abs = Math.abs(amount);
  return [{
    accountCode: code,
    amount: negate ? -abs : (amount > 0 ? abs : -abs),
    currency: String(a?.currency ?? a?.currency_code ?? 'RUB').toUpperCase(),
    platformOrderNo: orderNo || `OZON-ACCRUAL-${dateStr}`,
    raw: { source: 'v1/finance/accrual/by-day', date: dateStr, type: a?.type ?? a?.accrual_type ?? a?.operation_type ?? null, posting_number: orderNo, platform_amount: amount },
    occurredAt: parseGmt(a?.date ?? a?.accrual_date ?? `${dateStr}T00:00:00Z`),
  }];
}
async function syncOzonShop(admin: AdminClient, shop: SyncShop, triggerType: string, accounts: Map<string, AcctInfo>, acctIdToCode: Map<string, string>, settings: Settings): Promise<ShopOutcome> {
  const t0 = Date.now();
  const out: ShopOutcome = { shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Ozon', ok: false, fetched_orders: 0, fee_count: 0, inserted: 0, updated: 0, abnormal_new: 0, duration_ms: 0 };
  try {
    if (!isActiveAuthStatus(shop.status)) throw new Error(`店铺状态为「${shop.status}」`);
    if (!shop.credentials_enc) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: Ozon 未配置凭据（需 Client-Id + Api-Key）'; return out; }
    const creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
    const clientId = String(creds.client_id ?? '').trim();
    const apiKey = String(creds.api_key ?? '').trim();
    if (!clientId || !apiKey) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: Ozon 凭据不完整（缺 client_id 或 api_key）'; return out; }
    const H = { 'Client-Id': clientId, 'Api-Key': apiKey, 'Content-Type': 'application/json' };

    const { data: state } = await admin.from('settlement_sync_state').select('last_synced_at').eq('shop_auth_id', shop.id).maybeSingle();
    const wmMs = state?.last_synced_at ? Date.parse((state as any).last_synced_at) : (shop.verify_at ? Date.parse(shop.verify_at) : Date.now() - FIRST_SYNC_DAYS * 86400_000);
    const from = new Date(Number.isFinite(wmMs) ? wmMs - WATERMARK_LAG_MS : Date.now() - FIRST_SYNC_DAYS * 86400_000).toISOString();
    const to = new Date().toISOString();

    const rawFees: RawFee[] = [];
    const notes: string[] = [];

    // ── 来源 1：半月结算汇总（实测可用；/v3/finance/transaction/list 已从 Ozon API 下线，404） ──
    let cfPage = 1;
    for (;;) {
      const res = await fetchDirect('https://api-seller.ozon.ru/v1/finance/cash-flow-statement/list', {
        method: 'POST', headers: H,
        body: JSON.stringify({ date: { from, to }, page: cfPage, page_size: 1000 }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`Ozon cash-flow-statement/list 失败：HTTP ${res.status} ${(body as any)?.message ?? ''}`);
      const flows = (body as any)?.result?.cash_flows ?? [];
      out.fetched_orders += flows.length;
      for (const f of flows) rawFees.push(...mapOzonCashFlow(f));
      const pageCount = Number((body as any)?.result?.page_count ?? 1) || 1;
      if (flows.length === 0 || cfPage >= pageCount || cfPage >= MAX_PAGES) break;
      cfPage++;
    }

    // ── 来源 2：逐日应计明细（逐单佣金；限流严，单次最多回看 OZON_ACCRUAL_MAX_DAYS 天） ──
    // 该接口逐日返回，任一天失败不阻断：已拿到的费用行照常落库，缺口写进 note（不假装全量）
    const dayFrom = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
    const dayTo = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
    let days = 0;
    for (let t = dayFrom; Number.isFinite(t) && t <= dayTo && days < OZON_ACCRUAL_MAX_DAYS; t += 86400_000) {
      const dateStr = new Date(t).toISOString().slice(0, 10);
      days++;
      const res = await fetchDirect('https://api-seller.ozon.ru/v1/finance/accrual/by-day', {
        method: 'POST', headers: H, body: JSON.stringify({ date: dateStr }),
      });
      if (!res.ok) {
        notes.push(`Ozon 逐日应计 ${dateStr} 起中断（HTTP ${res.status}），本次仅计入已获取部分`);
        break;
      }
      const body = await res.json().catch(() => null);
      const accruals = (body as any)?.accruals ?? [];
      out.fetched_orders += accruals.length;
      for (const a of accruals) rawFees.push(...mapOzonAccrual(a, dateStr));
    }
    if (days >= OZON_ACCRUAL_MAX_DAYS && Number.isFinite(dayTo) && dayTo - dayFrom > OZON_ACCRUAL_MAX_DAYS * 86400_000) {
      notes.push(`Ozon 逐日应计单次仅回看 ${OZON_ACCRUAL_MAX_DAYS} 天（平台限流），更早期间由结算汇总覆盖`);
    }
    if (out.fetched_orders === 0) notes.push('Ozon 本次无可解析的财务返回（店铺尚无已结算/已妥投订单，属正常）');
    if (rawFees.length > 0) {
      const { rows, up, perOrder } = await persistFees(admin, shop, 'ozon', accounts, acctIdToCode, rawFees);
      out.fee_count = rows; out.inserted = up.inserted; out.updated = up.updated;
      for (const [, g] of perOrder) out.abnormal_new += await detectAbnormal(admin, shop, settings, accounts, acctIdToCode, { orderId: g.orderId }, g.ids);
    }
    const noteMsg = notes.length > 0 ? notes.join('；') : null;
    await admin.from('settlement_sync_state').upsert({ shop_auth_id: shop.id, user_id: shop.user_id, last_synced_at: to, last_status: '成功', last_error: noteMsg, updated_at: new Date().toISOString() }, { onConflict: 'shop_auth_id' });
    out.ok = true; out.code = 'OK'; out.duration_ms = Date.now() - t0;
    await admin.from('settlement_sync_logs').insert({
      user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Ozon',
      trigger_type: triggerType, status: '成功', fetched_orders: out.fetched_orders, fee_count: out.fee_count,
      inserted_count: out.inserted, updated_count: out.updated, abnormal_count: out.abnormal_new, duration_ms: out.duration_ms,
      error_message: noteMsg,
    });
    return out;
  } catch (e) {
    out.duration_ms = Date.now() - t0; out.ok = false; out.code = out.code ?? 'FAILED';
    out.error = e instanceof Error ? e.message : String(e);
    try {
      await admin.from('settlement_sync_state').upsert({ shop_auth_id: shop.id, user_id: shop.user_id, last_status: '失败', last_error: out.error, updated_at: new Date().toISOString() }, { onConflict: 'shop_auth_id' });
      await admin.from('settlement_sync_logs').insert({
        user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Ozon',
        trigger_type: triggerType, status: '失败', error_message: out.error, duration_ms: out.duration_ms,
      });
    } catch { /* ignore */ }
    return out;
  }
}

// ─── TikTok Shop 适配器（/finance/202501/transactions，HMAC-SHA256 签名） ──
async function tiktokSign(appKey: string, appSecret: string, path: string, timestamp: number, bodyStr: string): Promise<string> {
  const base = `${appKey}${timestamp}${path}${bodyStr}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function syncTiktokShop(admin: AdminClient, shop: SyncShop, triggerType: string, accounts: Map<string, AcctInfo>, acctIdToCode: Map<string, string>, settings: Settings): Promise<ShopOutcome> {
  const t0 = Date.now();
  const out: ShopOutcome = { shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'TikTok Shop', ok: false, fetched_orders: 0, fee_count: 0, inserted: 0, updated: 0, abnormal_new: 0, duration_ms: 0 };
  try {
    if (!isActiveAuthStatus(shop.status)) throw new Error(`店铺状态为「${shop.status}」`);
    if (!shop.credentials_enc) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: TikTok Shop 未配置凭据（需 access_token + app_key/app_secret，且授权含 Finance Information scope）'; return out; }
    const creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
    const accessToken = String(creds.access_token ?? '').trim();
    const appKey = String(creds.app_key ?? '').trim();
    const appSecret = String(creds.app_secret ?? '').trim();
    const shopId = String(creds.shop_id ?? '').trim();
    if (!accessToken || !appKey || !appSecret || !shopId) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: TikTok Shop 凭据不完整（缺 access_token/app_key/app_secret/shop_id）'; return out; }

    const { data: state } = await admin.from('settlement_sync_state').select('last_synced_at').eq('shop_auth_id', shop.id).maybeSingle();
    const wmMs = state?.last_synced_at ? Date.parse((state as any).last_synced_at) : (shop.verify_at ? Date.parse(shop.verify_at) : Date.now() - FIRST_SYNC_DAYS * 86400_000);
    const from = Math.floor((Number.isFinite(wmMs) ? wmMs - WATERMARK_LAG_MS : Date.now() - FIRST_SYNC_DAYS * 86400_000) / 1000);
    const to = Math.floor(Date.now() / 1000);

    const path = '/finance/202501/transactions';
    const rawFees: RawFee[] = [];
    let cursor = '';
    let pageNum = 0;
    for (;;) {
      const ts = Math.floor(Date.now() / 1000);
      const bodyObj: Record<string, unknown> = { shop_id: shopId, create_time_ge: from, create_time_lt: to, page_size: 100 };
      if (cursor) bodyObj.cursor = cursor;
      const bodyStr = JSON.stringify(bodyObj);
      const sign = await tiktokSign(appKey, appSecret, path, ts, bodyStr);
      const q = new URLSearchParams({ app_key: appKey, timestamp: String(ts), sign, shop_id: shopId });
      const res = await fetchDirect(`https://open-api.tiktokglobalshop.com${path}?${q}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tts-access-token': accessToken }, body: bodyStr,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || (body as any)?.code !== undefined && (body as any)?.code !== 0) {
        throw new Error(`TikTok transactions 失败：HTTP ${res.status} code=${(body as any)?.code} ${(body as any)?.message ?? ''}`);
      }
      const txs = (body as any)?.data?.transactions ?? [];
      out.fetched_orders += txs.length;
      for (const tx of txs) {
        const ccy = String(tx.currency ?? 'USD').toUpperCase();
        const occ = tx.create_time ? new Date(Number(tx.create_time) * 1000).toISOString() : null;
        const feeTax = Math.abs(num(tx.fee_and_tax_amount));
        if (feeTax >= 0.005) rawFees.push({ accountCode: 'platform.commission', amount: feeTax, currency: ccy, platformOrderNo: String(tx.order_id ?? ''), raw: { source: 'finance/202501/transactions', field: 'fee_and_tax_amount', order_id: tx.order_id }, occurredAt: occ });
        const ship = Math.abs(num(tx.shipping_cost_amount));
        if (ship >= 0.005) rawFees.push({ accountCode: 'logistics.shipping_fee', amount: ship, currency: ccy, platformOrderNo: String(tx.order_id ?? ''), raw: { source: 'finance/202501/transactions', field: 'shipping_cost_amount', order_id: tx.order_id }, occurredAt: occ });
      }
      cursor = (body as any)?.data?.next_cursor ?? '';
      if (!cursor || txs.length === 0 || ++pageNum >= MAX_PAGES) break;
    }
    if (rawFees.length > 0) {
      const { rows, up, perOrder } = await persistFees(admin, shop, 'tiktok', accounts, acctIdToCode, rawFees);
      out.fee_count = rows; out.inserted = up.inserted; out.updated = up.updated;
      for (const [, g] of perOrder) out.abnormal_new += await detectAbnormal(admin, shop, settings, accounts, acctIdToCode, { orderId: g.orderId }, g.ids);
    }
    await admin.from('settlement_sync_state').upsert({ shop_auth_id: shop.id, user_id: shop.user_id, last_synced_at: new Date().toISOString(), last_status: '成功', last_error: null, updated_at: new Date().toISOString() }, { onConflict: 'shop_auth_id' });
    out.ok = true; out.code = 'OK'; out.duration_ms = Date.now() - t0;
    await admin.from('settlement_sync_logs').insert({
      user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'TikTok Shop',
      trigger_type: triggerType, status: '成功', fetched_orders: out.fetched_orders, fee_count: out.fee_count,
      inserted_count: out.inserted, updated_count: out.updated, abnormal_count: out.abnormal_new, duration_ms: out.duration_ms,
    });
    return out;
  } catch (e) {
    out.duration_ms = Date.now() - t0; out.ok = false; out.code = out.code ?? 'FAILED';
    out.error = e instanceof Error ? e.message : String(e);
    try {
      await admin.from('settlement_sync_state').upsert({ shop_auth_id: shop.id, user_id: shop.user_id, last_status: '失败', last_error: out.error, updated_at: new Date().toISOString() }, { onConflict: 'shop_auth_id' });
      await admin.from('settlement_sync_logs').insert({
        user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'TikTok Shop',
        trigger_type: triggerType, status: '失败', error_message: out.error, duration_ms: out.duration_ms,
      });
    } catch { /* ignore */ }
    return out;
  }
}

// ─── Shopee 适配器（get_escrow_list + get_escrow_detail，HMAC 签名） ──
async function shopeeSign(partnerId: string, partnerKey: string, path: string, ts: number, accessToken: string, shopId: string, bodyStr: string): Promise<string> {
  const base = `${partnerId}${path}${ts}${accessToken}${shopId}${bodyStr}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(partnerKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function syncShopeeShop(admin: AdminClient, shop: SyncShop, triggerType: string, accounts: Map<string, AcctInfo>, acctIdToCode: Map<string, string>, settings: Settings): Promise<ShopOutcome> {
  const t0 = Date.now();
  const out: ShopOutcome = { shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Shopee', ok: false, fetched_orders: 0, fee_count: 0, inserted: 0, updated: 0, abnormal_new: 0, duration_ms: 0 };
  try {
    if (!isActiveAuthStatus(shop.status)) throw new Error(`店铺状态为「${shop.status}」`);
    if (!shop.credentials_enc) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: Shopee 未配置凭据（需 partner_id/partner_key/access_token/shop_id，App 类型需含 Accounting And Finance）'; return out; }
    const creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
    const partnerId = String(creds.partner_id ?? '').trim();
    const partnerKey = String(creds.partner_key ?? '').trim();
    const accessToken = String(creds.access_token ?? '').trim();
    const shopId = String(creds.shop_id ?? '').trim();
    if (!partnerId || !partnerKey || !accessToken || !shopId) { out.code = 'NO_CREDENTIALS'; out.error = 'NO_CREDENTIALS: Shopee 凭据不完整（缺 partner_id/partner_key/access_token/shop_id）'; return out; }
    const host = 'https://partner.shopeemobile.com';

    const { data: state } = await admin.from('settlement_sync_state').select('last_synced_at').eq('shop_auth_id', shop.id).maybeSingle();
    const wmMs = state?.last_synced_at ? Date.parse((state as any).last_synced_at) : (shop.verify_at ? Date.parse(shop.verify_at) : Date.now() - FIRST_SYNC_DAYS * 86400_000);
    const from = Math.floor((Number.isFinite(wmMs) ? wmMs - WATERMARK_LAG_MS : Date.now() - FIRST_SYNC_DAYS * 86400_000) / 1000);
    const to = Math.floor(Date.now() / 1000);

    // 1) escrow list（按 update_time 增量）
    const listPath = '/api/v2/payment/get_escrow_list';
    const ts1 = Math.floor(Date.now() / 1000);
    const s1 = await shopeeSign(partnerId, partnerKey, listPath, ts1, accessToken, shopId, '');
    const lq = new URLSearchParams({ partner_id: partnerId, timestamp: String(ts1), shop_id: shopId, access_token: accessToken, sign: s1,
      time_range_field: 'update_time', time_from: String(from), time_to: String(to), page_size: '100', cursor: '' });
    const lRes = await fetchDirect(`${host}${listPath}?${lq}`, { headers: { Accept: 'application/json' } });
    const lBody = await lRes.json().catch(() => null);
    if (!lRes.ok || ((lBody as any)?.error && (lBody as any).error !== '')) {
      throw new Error(`Shopee get_escrow_list 失败：HTTP ${lRes.status} ${(lBody as any)?.error ?? ''} ${(lBody as any)?.message ?? ''}`);
    }
    const orderNos: string[] = ((lBody as any)?.response?.order_list ?? []).map((x: any) => String(x.order_sn));
    out.fetched_orders = orderNos.length;

    // 2) escrow detail（批量 ≤ 50/次）
    const rawFees: RawFee[] = [];
    for (let i = 0; i < orderNos.length; i += 50) {
      const batch = orderNos.slice(i, i + 50);
      const dPath = '/api/v2/payment/get_escrow_detail';
      const ts2 = Math.floor(Date.now() / 1000);
      const bodyStr = JSON.stringify({ order_list: batch });
      const s2 = await shopeeSign(partnerId, partnerKey, dPath, ts2, accessToken, shopId, bodyStr);
      const dq = new URLSearchParams({ partner_id: partnerId, timestamp: String(ts2), shop_id: shopId, access_token: accessToken, sign: s2 });
      const dRes = await fetchDirect(`${host}${dPath}?${dq}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: bodyStr });
      const dBody = await dRes.json().catch(() => null);
      if (!dRes.ok) continue;
      for (const e of ((dBody as any)?.response?.order_list ?? []) as any[]) {
        const income = e?.order_income ?? {};
        const no = String(e.order_sn ?? '');
        const ccy = String(income.currency ?? 'USD').toUpperCase();
        const occ = e.update_time ? new Date(Number(e.update_time) * 1000).toISOString() : null;
        const put = (code: string, v: unknown, forceNegative = false) => {
          const a0 = num(v);
          if (Math.abs(a0) < 0.005) return;
          // Shopee escrow 字段正负即语义（费用为正）；forceNegative 用于平台补贴冲减
          const amount = forceNegative ? -Math.abs(a0) : a0;
          if (Math.abs(amount) < 0.005) return;
          rawFees.push({ accountCode: code, amount, currency: ccy, platformOrderNo: no,
            raw: { source: 'get_escrow_detail', order_sn: no, escrow_amount: income.escrow_amount },
            occurredAt: occ });
        };
        // 映射（escrow 明细字段 → 科目）：
        put('platform.commission', income.commission_fee);            // 平台佣金
        put('platform.service_fee', income.service_fee);              // 交易服务费
        put('logistics.shipping_fee', income.actual_shipping_fee);    // 实收运费（终态）
        put('marketing.promotion_discount', income.seller_discount);  // 卖家折扣 → 促销折扣费
        put('platform.service_fee', income.shopee_discount, true);    // 平台补贴 → 服务费冲减（负数）
        put('finance.return_handling', income.seller_return_refund);  // 卖家承担退货退款
      }
    }
    if (rawFees.length > 0) {
      const { rows, up, perOrder } = await persistFees(admin, shop, 'shopee', accounts, acctIdToCode, rawFees);
      out.fee_count = rows; out.inserted = up.inserted; out.updated = up.updated;
      for (const [, g] of perOrder) out.abnormal_new += await detectAbnormal(admin, shop, settings, accounts, acctIdToCode, { orderId: g.orderId }, g.ids);
    }
    await admin.from('settlement_sync_state').upsert({ shop_auth_id: shop.id, user_id: shop.user_id, last_synced_at: new Date().toISOString(), last_status: '成功', last_error: null, updated_at: new Date().toISOString() }, { onConflict: 'shop_auth_id' });
    out.ok = true; out.code = 'OK'; out.duration_ms = Date.now() - t0;
    await admin.from('settlement_sync_logs').insert({
      user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Shopee',
      trigger_type: triggerType, status: '成功', fetched_orders: out.fetched_orders, fee_count: out.fee_count,
      inserted_count: out.inserted, updated_count: out.updated, abnormal_count: out.abnormal_new, duration_ms: out.duration_ms,
    });
    return out;
  } catch (e) {
    out.duration_ms = Date.now() - t0; out.ok = false; out.code = out.code ?? 'FAILED';
    out.error = e instanceof Error ? e.message : String(e);
    try {
      await admin.from('settlement_sync_state').upsert({ shop_auth_id: shop.id, user_id: shop.user_id, last_status: '失败', last_error: out.error, updated_at: new Date().toISOString() }, { onConflict: 'shop_auth_id' });
      await admin.from('settlement_sync_logs').insert({
        user_id: shop.user_id, shop_auth_id: shop.id, shop_name: shop.shop_name, platform: 'Shopee',
        trigger_type: triggerType, status: '失败', error_message: out.error, duration_ms: out.duration_ms,
      });
    } catch { /* ignore */ }
    return out;
  }
}

// ─── 调度 ────────────────────────────────────────────────────────────
async function loadShops(admin: AdminClient, adapterKey: string | null, userId: string | null): Promise<SyncShop[]> {
  let q = admin.from('shop_auths')
    .select('id, user_id, shop_name, status, platform, credentials_enc, shop_domain, verify_at')
    .in('status', ACTIVE_AUTH_STATUS_LIST);
  if (adapterKey) q = q.ilike('platform', PLATFORM_PATTERNS[adapterKey]);
  else {
    // 第一批平台白名单
    const pats = Object.values(PLATFORM_PATTERNS);
    q = q.or(pats.map((p) => `platform.ilike.${p}`).join(','));
  }
  if (userId) q = q.eq('user_id', userId);
  const { data, error } = await q;
  if (error) throw new Error(`查询店铺失败：${error.message}`);
  return (data ?? []).filter((s: any) => PLATFORM_ADAPTERS[String(s.platform ?? '').toLowerCase().trim()] !== undefined) as unknown as SyncShop[];
}
async function syncOneShop(admin: AdminClient, shop: SyncShop, triggerType: string): Promise<ShopOutcome> {
  const key = PLATFORM_ADAPTERS[String(shop.platform ?? '').toLowerCase().trim()] ?? 'woo';
  const accounts = await loadFeeAccounts(admin, shop.user_id);
  const acctIdToCode = new Map<string, string>();
  for (const [code, a] of accounts) acctIdToCode.set(a.id, code);
  const settings = await loadSettings(admin, shop.user_id);
  switch (key) {
    case 'woo': return syncWooShop(admin, shop, triggerType, accounts, acctIdToCode, settings);
    case 'shopify': return syncShopifyShop(admin, shop, triggerType, accounts, acctIdToCode, settings);
    case 'ozon': return syncOzonShop(admin, shop, triggerType, accounts, acctIdToCode, settings);
    case 'tiktok': return syncTiktokShop(admin, shop, triggerType, accounts, acctIdToCode, settings);
    case 'shopee': return syncShopeeShop(admin, shop, triggerType, accounts, acctIdToCode, settings);
    default: return { shop_auth_id: shop.id, shop_name: shop.shop_name, platform: shop.platform, ok: false, code: 'FAILED', fetched_orders: 0, fee_count: 0, inserted: 0, updated: 0, abnormal_new: 0, error: `未知平台适配器：${shop.platform}`, duration_ms: 0 };
  }
}
async function syncAll(admin: AdminClient, adapterKey: string | null, userId: string | null, mode: string): Promise<{ shops: ShopOutcome[] }> {
  const shops = await loadShops(admin, adapterKey, userId);
  if (mode === 'cron' && shops.length > 0) await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 5000)));
  const results: ShopOutcome[] = [];
  for (const shop of shops) {
    try {
      results.push(await syncOneShop(admin, shop, mode === 'cron' ? 'cron' : 'manual'));
    } catch (e) {
      results.push({ shop_auth_id: shop.id, shop_name: shop.shop_name, platform: shop.platform, ok: false, code: 'FAILED', fetched_orders: 0, fee_count: 0, inserted: 0, updated: 0, abnormal_new: 0, error: e instanceof Error ? e.message : String(e), duration_ms: 0 });
    }
    if (shops.length > 1) await new Promise((r) => setTimeout(r, 400));
  }
  return { shops: results };
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String((body as any).action ?? '');
    const mode = String((body as any).mode ?? '');

    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: '未登录或登录已过期' }, 401);
    let serviceMode = false;
    let userId: string | null = null;
    if (await verifyServiceRoleJwt(token, getEnv('JWT_SECRET'))) serviceMode = true;
    else {
      userId = await resolveUserId(req);
      if (!userId) return json({ error: '未登录或登录已过期' }, 401);
    }
    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

    if (action === 'sync-shop') {
      const shopAuthId = String((body as any).shop_auth_id ?? '').trim();
      if (!shopAuthId) return json({ error: '缺少 shop_auth_id' }, 400);
      const { data: shop } = await admin.from('shop_auths')
        .select('id, user_id, shop_name, status, platform, credentials_enc, shop_domain, verify_at')
        .eq('id', shopAuthId).maybeSingle();
      if (!shop) return json({ error: '店铺不存在' }, 404);
      if (!serviceMode && (shop as any).user_id !== userId) return json({ error: '无权同步该店铺' }, 403);
      const r = await syncOneShop(admin, shop as unknown as SyncShop, mode === 'cron' ? 'cron' : 'manual');
      console.info(`[${functionName}] ${requestId} sync-shop ${shopAuthId} → ${r.code} fees=${r.fee_count} abn=${r.abnormal_new}`);
      return json({ ok: r.ok, ...r });
    }

    if (action === 'sync-all' || PLATFORM_PATTERNS[action]) {
      const adapterKey = action === 'sync-all' ? null : action;
      const r = await syncAll(admin, adapterKey, userId, mode);
      const total = r.shops.reduce((a, s) => ({
        fees: a.fees + s.fee_count, abnormal: a.abnormal + s.abnormal_new,
        noCred: a.noCred + (s.code === 'NO_CREDENTIALS' ? 1 : 0), failed: a.failed + (!s.ok && s.code !== 'NO_CREDENTIALS' ? 1 : 0),
      }), { fees: 0, abnormal: 0, noCred: 0, failed: 0 });
      console.info(`[${functionName}] ${requestId} ${action} mode=${mode || (serviceMode ? 'service' : 'user')} shops=${r.shops.length} fees=${total.fees} noCred=${total.noCred} failed=${total.failed}`);
      return json({ ok: total.failed === 0, shops: r.shops, total });
    }

    if (action === 'sync-status') {
      let logQ = admin.from('settlement_sync_logs')
        .select('id, shop_auth_id, shop_name, platform, trigger_type, status, fetched_orders, fee_count, inserted_count, updated_count, abnormal_count, error_message, duration_ms, created_at')
        .order('created_at', { ascending: false }).limit(20);
      if (userId) logQ = logQ.eq('user_id', userId);
      const { data: logs } = await logQ;
      let shopQ = admin.from('shop_auths')
        .select('id, shop_name, status, platform, settlement_sync_state(last_synced_at, last_status, last_error)')
        .in('status', ACTIVE_AUTH_STATUS_LIST);
      if (userId) shopQ = shopQ.eq('user_id', userId);
      const { data: shops } = await shopQ;
      // 异常统计
      let abnQ = admin.from('platform_fee_records').select('id, order_id', { count: 'exact' }).eq('is_abnormal', true);
      if (userId) abnQ = abnQ.eq('user_id', userId);
      const { count } = await abnQ;
      return json({ recent_logs: logs ?? [], shops: shops ?? [], abnormal_count: count ?? 0 });
    }

    return json({ error: `未知 action: ${action}（可用：sync-shop / sync-all / sync-status / woo / shopify / ozon / tiktok / shopee）` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
