// sync-stock — P0-4 库存同步推送 MVP（第一平台：WooCommerce）
// =====================================================================
// action:
//   process-queue → 取 stock_sync_queue 待推送批次（同 SKU 只推最新值，旧值标「跳过」）
//                   → 按 listing 的 wc_product_id 调 WooCommerce API 更新库存
//                     （simple → PUT /products/{id}；variable → 按 platform_sku 匹配 variation 后 PUT /variations/{vid}）
//                   → 成功标记 / 失败重试（最多 3 次，cron 每 5 分钟天然退避；耗尽写通知）
//                   → 写 stock_sync_logs 批次审计
//   sync-status   → 队列统计（待推送/失败）+ 最近推送明细 + 最近批次日志
//
// 鉴权（双模式，与 sync-orders 一致）：
//   用户模式：Authorization: Bearer <用户JWT> → admin.auth.getUser 验证；只能处理/查看本人数据
//   Cron 模式：Bearer <service_role key> → JWT_SECRET 做 HS256 验签 + payload.role==='service_role'
//
// 铁律（主人强令）：
//   1. 只允许 status='成功' 的刊登 + status='已授权' 的 WooCommerce 店铺参与推送（入队时已过滤，推送时二次校验）
//   2. 缺映射告警（DB trigger 写 notifications）+ 推送失败通知（本函数写）——联动红线
//   3. 全程不产生假数据——远程 API 真实返回成功才算成功
//   4. 幂等：同值变更不入队（trigger 层拦截）；同 SKU 多次变更只推最新值
//
// 凭据：shop_auths.credentials_enc（AES-GCM/PBKDF2，盐 thalvior-cred-v1，secret=JWT_SECRET，与 authorize-shop 对称）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isActiveAuthStatus } from '../_shared/shop-status.ts';

const functionName = 'sync-stock';
const MAX_RETRIES = 3;        // 最多 3 次推送尝试
const BATCH_LIMIT = 500;      // 单批最多处理 500 条队列，防失控
const WOO_PAGE_SIZE = 100;    // 拉取变体列表每页数量

// ─── 通用工具（与 publish-listing / sync-orders 同风格） ─────────────
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
    // 踩坑：edge runtime fetch 不解压 gzip → 必须显式 identity，否则乱码截断
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { ...init.headers, 'Accept-Encoding': 'identity' } });
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

// ─── WooCommerce 客户端（与 sync-orders 同实现） ─────────────────────
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

// ─── 通知（联动红线：失败必写） ──────────────────────────────────────
async function notify(admin: ReturnType<typeof createClient>, userId: string | null, title: string, content: string) {
  if (!userId) return;
  await admin.from('notifications').insert({ user_id: userId, title, content, type: '库存' });
}

// ─── 单条推送 ────────────────────────────────────────────────────────
interface QueueRow {
  id: string;
  product_id: string | null;
  sku_mappings_id: string | null;
  user_id: string | null;
  shop_auth_id: string | null;
  local_sku: string;
  old_qty: number;
  new_qty: number;
  status: string;
  retry_count: number;
  error: string | null;
  created_at: string;
}

async function pushOne(
  admin: ReturnType<typeof createClient>,
  row: QueueRow,
): Promise<{ ok: boolean; error?: string; shopName?: string }> {
  // 1. 映射 + 刊登 + 店铺 组装
  const { data: mapping } = await admin
    .from('sku_mappings')
    .select('id, local_sku, platform_sku, listing_id')
    .eq('id', row.sku_mappings_id ?? '')
    .maybeSingle();
  const markFail = async (errMsg: string, terminal: boolean) => {
    const patch: Record<string, unknown> = { error: errMsg, pushed_at: new Date().toISOString() };
    if (terminal) {
      patch.status = '失败';
      patch.retry_count = MAX_RETRIES;
      await notify(admin, row.user_id, '库存推送失败',
        `商品 SKU「${row.local_sku}」的库存变更（${row.old_qty} → ${row.new_qty}）无法推送到店铺：${errMsg}`);
    } else {
      const nextRetry = row.retry_count + 1;
      patch.retry_count = nextRetry;
      if (nextRetry >= MAX_RETRIES) {
        patch.status = '失败';
        await notify(admin, row.user_id, '库存推送失败',
          `商品 SKU「${row.local_sku}」的库存变更（${row.old_qty} → ${row.new_qty}）推送到店铺失败（已重试 ${MAX_RETRIES} 次）：${errMsg}`);
      }
    }
    await admin.from('stock_sync_queue').update(patch).eq('id', row.id);
    return { ok: false, error: errMsg };
  };

  if (!mapping) return markFail('刊登映射记录已不存在（可能刊登已被删除）', true);
  const { data: listing, error: lErr } = await admin
    .from('listings')
    .select('id, user_id, shop_auth_id, status, wc_product_id, shop_auths(status, platform, credentials_enc, shop_domain, shop_name)')
    .eq('id', mapping.listing_id)
    .maybeSingle();
  if (lErr || !listing) return markFail(`刊登记录查询失败：${lErr?.message ?? '不存在'}`, true);
  if (listing.status !== '成功' || !listing.wc_product_id) {
    return markFail(`刊登记录状态为「${listing.status}」，远程商品不可用，请先重新刊登`, true);
  }
  const shop = (listing as unknown as { shop_auths?: { status: string; platform: string; credentials_enc: string; shop_domain: string; shop_name: string } }).shop_auths;
  if (!shop || !isActiveAuthStatus(shop.status)) {
    return markFail(`目标店铺已不可用（${shop ? `状态「${shop.status}」` : '店铺已删除'}），请重新授权后再同步`, true);
  }
  if (!shop.credentials_enc) return markFail('店铺缺少加密凭据，请重新授权', true);

  // 2. 解凭据 → Woo 客户端
  let creds: Record<string, unknown>;
  try {
    creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
  } catch (e) {
    return markFail(`店铺凭据解密失败：${e instanceof Error ? e.message : String(e)}`, true);
  }
  const ck = String(creds.consumer_key ?? '').trim();
  const cs = String(creds.consumer_secret ?? '').trim();
  const domain = String(creds.shop_domain ?? shop.shop_domain ?? '');
  if (!ck || !cs || !domain) return markFail('店铺凭据不完整（缺域名或 Key/Secret）', true);
  const woo = wooClient(domain, ck, cs);
  const wcId = String(listing.wc_product_id);

  // 3. 查远程商品类型，决定推送目标
  const g = await woo.request('GET', `/products/${encodeURIComponent(wcId)}`);
  if (!g.ok) {
    // 404 = 远程商品已删除 → 终态失败（不重试）
    const terminal = g.status === 404;
    return markFail(`WooCommerce 查询远程商品 ${wcId} 失败：${g.data?.message ?? `HTTP ${g.status}`}`, terminal);
  }
  const wtype = String(g.data?.type ?? 'simple');
  const stockBody = { manage_stock: true, stock_quantity: Number(row.new_qty) || 0 };

  // 4. 推送库存
  let r: { ok: boolean; status: number; data: any };
  if (wtype === 'variable') {
    // 变体型：按 platform_sku 匹配远程 variation，更新到 variation 上
    let variationId: string | null = null;
    for (let page = 1; page <= 5 && !variationId; page++) {
      const vs = await woo.request('GET', `/products/${encodeURIComponent(wcId)}/variations`, { page: String(page), per_page: String(WOO_PAGE_SIZE) });
      if (!vs.ok || !Array.isArray(vs.data)) break;
      const hit = vs.data.find((v: any) => String(v?.sku ?? '') === String(mapping.platform_sku));
      if (hit) variationId = String(hit.id);
      if (!Array.isArray(vs.data) || vs.data.length < WOO_PAGE_SIZE) break;
    }
    if (!variationId) {
      return markFail(`远程变体不存在：WooCommerce 商品 ${wcId} 下未找到 SKU 为「${mapping.platform_sku}」的变体`, true);
    }
    r = await woo.request('PUT', `/products/${encodeURIComponent(wcId)}/variations/${encodeURIComponent(variationId)}`, {}, stockBody);
  } else {
    r = await woo.request('PUT', `/products/${encodeURIComponent(wcId)}`, {}, stockBody);
  }

  // 5. 结果处理
  if (!r.ok) {
    const errMsg = `${r.data?.message ?? ''}${r.data?.code ? ` (${r.data.code})` : ''}` || `HTTP ${r.status}`;
    const retryCount = row.retry_count + 1;
    const exhausted = retryCount >= MAX_RETRIES;
    const patch: Record<string, unknown> = {
      retry_count: retryCount,
      error: `WooCommerce 库存更新失败：${errMsg}`,
      pushed_at: new Date().toISOString(),
    };
    if (exhausted) {
      patch.status = '失败';
      await notify(admin, row.user_id, '库存推送失败',
        `商品 SKU「${row.local_sku}」的库存变更（${row.old_qty} → ${row.new_qty}）推送到店铺「${shop.shop_name}」失败（已重试 ${MAX_RETRIES} 次）：${errMsg}`);
    }
    await admin.from('stock_sync_queue').update(patch).eq('id', row.id);
    return { ok: false, error: String(patch.error), shopName: shop.shop_name };
  }
  await admin.from('stock_sync_queue').update({ status: '成功', error: null, pushed_at: new Date().toISOString() }).eq('id', row.id);
  return { ok: true, shopName: shop.shop_name };
}

// ─── process-queue ───────────────────────────────────────────────────
async function processQueue(admin: ReturnType<typeof createClient>, userId: string | null, triggerType: 'cron' | 'manual') {
  const t0 = Date.now();
  // 1. 取待推送批次（retry_count < 3）
  let q = admin.from('stock_sync_queue')
    .select('id, product_id, sku_mappings_id, user_id, shop_auth_id, local_sku, old_qty, new_qty, status, retry_count, error, created_at')
    .eq('status', '待推送')
    .lt('retry_count', MAX_RETRIES)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);
  if (userId) q = q.eq('user_id', userId);
  const { data: rows, error } = await q;
  if (error) throw new Error(`查询推送队列失败：${error.message}`);
  const pending = rows ?? [];

  // 2. 同一映射只推最新值：其余旧变更标「跳过」（幂等 + 减少无效推送）
  const latest = new Map<string, QueueRow>();
  for (const r of pending as QueueRow[]) {
    const key = r.sku_mappings_id ?? r.id;
    const prev = latest.get(key);
    if (!prev || String(r.created_at) > String(prev.created_at)) latest.set(key, r);
  }
  const superseded = (pending as QueueRow[]).filter((r) => (latest.get(r.sku_mappings_id ?? r.id)?.id ?? r.id) !== r.id);
  for (const s of superseded) {
    await admin.from('stock_sync_queue').update({
      status: '跳过',
      error: '同 SKU 已有更新的库存变更，旧值跳过推送（推送时以最新值为准）',
    }).eq('id', s.id);
  }

  // 3. 逐条推送（真实远程调用），按用户归集统计
  const stats = new Map<string, { pushed: number; success: number; failed: number; skipped: number; errors: string[] }>();
  const bump = (uid: string | null) => {
    const k = uid ?? '__null__';
    if (!stats.has(k)) stats.set(k, { pushed: 0, success: 0, failed: 0, skipped: 0, errors: [] });
    return stats.get(k)!;
  };
  for (const s of superseded) bump(s.user_id).skipped++;
  for (const row of latest.values()) {
    const res = await pushOne(admin, row);
    const st = bump(row.user_id);
    st.pushed++;
    if (res.ok) st.success++;
    else { st.failed++; if (res.error) st.errors.push(`SKU「${row.local_sku}」：${res.error}`); }
  }

  // 4. 批次审计（按用户分组写：用户模式一条；cron 全站模式每个受影响用户各一条 → 用户在「同步状态」能看到自己的定时批次）
  const duration = Date.now() - t0;
  let success = 0, failed = 0, batchStatus = '成功';
  for (const [k, st] of stats) {
    const uid = k === '__null__' ? null : k;
    const stStatus = st.pushed === 0 ? '成功' : st.failed === 0 ? '成功' : st.success > 0 ? '部分成功' : '失败';
    const { error: logErr } = await admin.from('stock_sync_logs').insert({
      user_id: uid,
      shop_auth_id: null,
      trigger_type: triggerType,
      status: stStatus,
      pushed_count: st.pushed,
      success_count: st.success,
      failed_count: st.failed,
      skipped_count: st.skipped,
      error_message: st.errors.length ? st.errors.slice(0, 5).join('；') : null,
      duration_ms: duration,
    });
    if (logErr) console.error(`[${functionName}] 写批次日志失败：${logErr.message}`);
    success += st.success;
    failed += st.failed;
    if (stStatus === '失败' || (stStatus === '部分成功' && batchStatus === '成功')) batchStatus = stStatus;
  }

  const pushed = latest.size;
  return { ok: failed === 0, pushed, success, failed, skipped: superseded.length, status: batchStatus, duration_ms: duration };
}

// ─── sync-status ─────────────────────────────────────────────────────
async function syncStatus(admin: ReturnType<typeof createClient>, userId: string | null) {
  // 队列统计（待推送/失败）
  let pending = 0, failed = 0;
  const base = () => {
    let s = admin.from('stock_sync_queue').select('id', { count: 'exact', head: true });
    if (userId) s = s.eq('user_id', userId);
    return s;
  };
  const [p1, p2] = await Promise.all([base().eq('status', '待推送'), base().eq('status', '失败')]);
  if (p1.error) throw new Error(`查询队列统计失败：${p1.error.message}`);
  if (p2.error) throw new Error(`查询队列统计失败：${p2.error.message}`);
  pending = p1.count ?? 0;
  failed = p2.count ?? 0;

  // 最近推送明细（10 条）
  let rp = admin.from('stock_sync_queue')
    .select('id, local_sku, old_qty, new_qty, status, retry_count, error, created_at, pushed_at, shop_auths(shop_name)')
    .order('created_at', { ascending: false }).limit(10);
  if (userId) rp = rp.eq('user_id', userId);
  const { data: recent_pushes, error: e3 } = await rp;
  if (e3) throw new Error(`查询最近推送失败：${e3.message}`);

  // 最近批次（10 条）
  let rl = admin.from('stock_sync_logs')
    .select('id, trigger_type, status, pushed_count, success_count, failed_count, skipped_count, error_message, duration_ms, created_at')
    .order('created_at', { ascending: false }).limit(10);
  if (userId) rl = rl.eq('user_id', userId);
  const { data: recent_logs, error: e4 } = await rl;
  if (e4) throw new Error(`查询批次日志失败：${e4.message}`);

  return { queue_summary: { pending, failed }, recent_pushes: recent_pushes ?? [], recent_logs: recent_logs ?? [] };
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

    if (action === 'process-queue') {
      const r = await processQueue(admin, serviceMode ? null : userId, mode === 'cron' ? 'cron' : 'manual');
      console.info(`[${functionName}] ${requestId} process-queue mode=${mode || (serviceMode ? 'service' : 'user')} pushed=${r.pushed} ok=${r.success} fail=${r.failed} skip=${r.skipped}`);
      return json(r);
    }
    if (action === 'sync-status') {
      const r = await syncStatus(admin, serviceMode ? null : userId);
      return json(r);
    }
    return json({ error: `未知 action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
