// admin-api — 平台运营后台统一 API（Batch A · 管理基础设施地基）
// =====================================================================
// 单一入口：POST { action, ...params }；所有路由都在此文件分发，前端只认这一个 EF。
//
// 路由（action）：
//   list_platform_health  { window_minutes=60 }
//   list_sync_runs        { platform_key?, shop_id?, user_id?, status?, since?, limit?(<=500) }
//   get_audit_log         { actor?, action_filter?, target?, since?, limit?(<=500) }
//   set_platform_enabled  { platform_key, enabled }              → platform_configs.status 启用/停用 + 审计
//   rotate_credential     { platform_key, app_key?, app_secret?, redirect_uri?, extra? }  → 密钥封装 + 审计（after 不落明文）
//   get_credential        { platform_key }                        → { app_key, redirect_uri, extra, has_secret, ... }，永不下发明文
//   force_resync          { shop_id }                             → 内部以 service_role 调 sync-orders sync-shop + 审计
//   test_adapter          { platform_key, creds, days_back?, max_orders? } → 转发 sync-orders test-adapter（用测试凭据试跑真实 pull）
//   write_audit           { audit_action, target_table?, target_id?, before?, after? } → 前端直改表后补记审计
//
// 鉴权（本 EF 自带，FUNCTIONS_VERIFY_JWT=false 时 main 只做 JWT 格式校验/路由）：
//   1) jose 验签：HS256 用 JWT_SECRET；ES256/RS256 用 SUPABASE_JWKS（本部署未注入 JWKS，故实际走 HS256，与 main/index.ts 同一套兜底）
//   2) payload.role==='service_role' → 运维通道（cron / curl 自检）
//   3) 否则取 payload.sub 查 profiles.role==='admin'（现网真实口径；gotrue 用户 JWT 的 role 恒为 'authenticated'，
//      因此不能只靠 auth.jwt()->>'role'==='admin'，那样真实管理员会被全部拒掉）
//   4) 都不满足 → 403
//
// 密钥边界：app_secret 明文只在本进程内存在（vault 封装后立即丢弃），
//   任何路由的返回值与审计记录里都只有 has_secret / 'rotated'，绝不回传密文或明文。

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as jose from 'jsr:@panva/jose@6';
import { ACTIVE_AUTH_STATUS_LIST } from '../_shared/shop-status.ts';
import { encrypt, hasMasterKey } from '../_shared/secret-vault.ts';

const functionName = 'admin-api';
const MAX_ROWS = 500;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const JWT_SECRET = Deno.env.get('JWT_SECRET') ?? '';

// ─── 通用工具 ────────────────────────────────────────────────────────
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, X-Client-Info',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
function json(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(req ? corsHeaders(req) : {}) },
  });
}
function svc(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}
function num(v: unknown, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = Math.trunc(num(v, dflt));
  return Math.min(Math.max(n, min), max);
}
function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  const first = xff.split(',')[0]?.trim();
  return first || req.headers.get('x-real-ip') || null;
}

// ─── JWT 验签（照抄 main/index.ts 的 HS256 + JWKS 双路兜底） ────────────
function parseJwks(raw: string | undefined): jose.JSONWebKeySet | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed?.keys && Array.isArray(parsed.keys) ? (parsed as jose.JSONWebKeySet) : null;
  } catch {
    return null;
  }
}
const LOCAL_JWKS = (() => {
  const set = parseJwks(Deno.env.get('SUPABASE_JWKS'));
  return set ? jose.createLocalJWKSet(set) : null;
})();

async function verifyJwt(token: string): Promise<Record<string, unknown> | null> {
  let alg: string | undefined;
  try {
    alg = jose.decodeProtectedHeader(token).alg;
  } catch {
    return null;
  }
  try {
    if (alg === 'HS256') {
      if (!JWT_SECRET) return null;
      const { payload } = await jose.jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
      return payload as Record<string, unknown>;
    }
    if ((alg === 'ES256' || alg === 'RS256') && LOCAL_JWKS) {
      const { payload } = await jose.jwtVerify(token, LOCAL_JWKS);
      return payload as Record<string, unknown>;
    }
  } catch (e) {
    console.error(`[${functionName}] JWT 验签失败（alg=${alg}）：${e instanceof Error ? e.message : String(e)}`);
  }
  return null;
}

interface Caller {
  mode: 'service' | 'admin';
  userId: string | null;
  email: string | null;
  ip: string | null;
}

/** 返回 null = 无权（上层统一 403，不透露是哪种失败，避免探测） */
async function authenticate(req: Request): Promise<Caller | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const payload = await verifyJwt(token);
  if (!payload) return null;
  const ip = clientIp(req);
  if (payload.role === 'service_role') {
    return { mode: 'service', userId: null, email: 'service_role', ip };
  }
  const sub = String(payload.sub ?? '');
  if (!sub) return null;
  const admin = svc();
  const { data: prof } = await admin.from('profiles').select('role').eq('id', sub).maybeSingle();
  const isAdmin = payload.role === 'admin' || String((prof as any)?.role ?? '') === 'admin';
  if (!isAdmin) return null;
  let email = String(payload.email ?? '') || null;
  if (!email) {
    try {
      const { data } = await admin.auth.getUser(token);
      email = data.user?.email ?? data.user?.phone ?? null;
    } catch { /* 邮箱只是审计冗余列，取不到不影响鉴权 */ }
  }
  return { mode: 'admin', userId: sub, email, ip };
}

// ─── 审计写入（永不抛错：审计失败不能把已完成的业务写回滚掉） ────────────
async function writeAuditRow(admin: SupabaseClient, caller: Caller, row: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await admin.from('admin_audit_log').insert({
      actor_user_id: caller.userId,
      actor_email: caller.email,
      ip: caller.ip,
      ...row,
    });
    if (error) console.error(`[${functionName}] admin_audit_log insert failed: ${error.message}`);
  } catch (e) {
    console.error(`[${functionName}] admin_audit_log insert threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── 内部调用其它 EF（service_role 身份，可跨用户操作） ─────────────────
async function callSyncOrders(body: Record<string, unknown>): Promise<{ status: number; data: any }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  return { status: res.status, data };
}

/** PostgREST 的 or= 是原样拼接的过滤串，值里的 ,( )% 会改变语义 → 拼进去之前先剥掉 */
function safeLike(v: string): string {
  return v.replace(/[(),]/g, '').replace(/\*/g, '%');
}

// ─── 路由实现 ────────────────────────────────────────────────────────

/** 平台健康：最近 window_minutes 的「每平台最新快照」+ 窗口累计 + 平台是否启用/有无店铺/有无凭据 */
async function listPlatformHealth(admin: SupabaseClient, body: Record<string, unknown>) {
  const minutes = clampInt(body.window_minutes, 1, 1440, 60);
  const since = new Date(Date.now() - minutes * 60_000).toISOString();

  const [snapRes, pcRes, credRes, shopRes, platRes] = await Promise.all([
    admin.from('adapter_health_snapshots')
      .select('ts, platform_key, calls, ok, fail, skipped, avg_ms, p95_ms, errors')
      .gte('ts', since)
      .order('platform_key', { ascending: true })
      .order('ts', { ascending: false })
      .limit(5000),
    admin.from('platform_configs').select('name, status, auth_state').limit(2000),
    admin.from('platform_credentials').select('platform_key, app_key, app_secret_enc, redirect_uri, extra, key_version, updated_at').limit(2000),
    admin.from('shop_auths').select('platform, status').in('status', ACTIVE_AUTH_STATUS_LIST).limit(20000),
    callSyncOrders({ action: 'list-platforms' }).catch(() => ({ status: 0, data: null })),
  ]);
  if (snapRes.error) throw new Error(`查询快照失败：${snapRes.error.message}`);

  const latest = new Map<string, any>();
  const totals = new Map<string, { calls: number; ok: number; fail: number; skipped: number }>();
  for (const r of (snapRes.data ?? []) as any[]) {
    if (!latest.has(r.platform_key)) latest.set(r.platform_key, r);
    const t = totals.get(r.platform_key) ?? { calls: 0, ok: 0, fail: 0, skipped: 0 };
    t.calls += Number(r.calls ?? 0); t.ok += Number(r.ok ?? 0);
    t.fail += Number(r.fail ?? 0); t.skipped += Number(r.skipped ?? 0);
    totals.set(r.platform_key, t);
  }

  const credByPlatform = new Map<string, any>();
  for (const c of (credRes.data ?? []) as any[]) credByPlatform.set(String(c.platform_key), c);
  const pcByPlatform = new Map<string, any>();
  for (const p of (pcRes.data ?? []) as any[]) pcByPlatform.set(String(p.name), p);
  const shopsByPlatform = new Map<string, number>();
  for (const s of (shopRes.data ?? []) as any[]) {
    const k = String(s.platform ?? '');
    shopsByPlatform.set(k, (shopsByPlatform.get(k) ?? 0) + 1);
  }
  const adapterKeys = new Set<string>((platRes.data?.supported ?? []).map((x: any) => String(x.key)));
  const adapterLabels = new Set<string>((platRes.data?.supported ?? []).map((x: any) => String(x.label)));

  // 平台全集 = platform_configs ∪ 快照里出现过的 key（快照可能含已删平台的历史）
  const keys = new Set<string>([...pcByPlatform.keys(), ...latest.keys(), ...credByPlatform.keys()]);
  const platforms = [...keys].sort().map((k) => {
    const cred = credByPlatform.get(k) ?? null;
    const pc = pcByPlatform.get(k) ?? null;
    const adapterConnected = adapterKeys.has(k.toLowerCase()) || adapterLabels.has(k)
      || adapterKeys.has(k) || adapterLabels.has(k.toLowerCase());
    return {
      platform_key: k,
      enabled: String(pc?.status ?? '') !== '停用',
      auth_state: pc?.auth_state ?? null,
      adapter_connected: adapterConnected,
      active_shops: shopsByPlatform.get(k) ?? 0,
      latest_snapshot: latest.get(k) ?? null,
      window_totals: totals.get(k) ?? { calls: 0, ok: 0, fail: 0, skipped: 0 },
      credential: cred ? {
        has_app_key: Boolean(cred.app_key),
        app_key: cred.app_key ?? null,
        has_secret: Boolean(cred.app_secret_enc),
        redirect_uri: cred.redirect_uri ?? null,
        extra: cred.extra ?? {},
        key_version: cred.key_version ?? 1,
        updated_at: cred.updated_at ?? null,
      } : null,
    };
  });
  return { window_minutes: minutes, since, platforms, adapter_sync_orders_status: platRes.status };
}

async function listSyncRuns(admin: SupabaseClient, body: Record<string, unknown>) {
  const limit = clampInt(body.limit, 1, MAX_ROWS, 200);
  let q = admin.from('sync_run_logs')
    .select('id, started_at, finished_at, user_id, shop_id, platform_key, status, pulled, inserted, updated, unchanged, error_msg, error_code, duration_ms')
    .order('started_at', { ascending: false })
    .limit(limit);
  const pk = String(body.platform_key ?? '').trim();
  const shopId = String(body.shop_id ?? '').trim();
  const userId = String(body.user_id ?? '').trim();
  const status = String(body.status ?? '').trim();
  if (pk) q = q.eq('platform_key', pk);
  if (shopId) q = q.eq('shop_id', shopId);
  if (userId) q = q.eq('user_id', userId);
  if (status) q = q.eq('status', status);
  const since = String(body.since ?? '').trim();
  if (since) q = q.gte('started_at', since);
  const { data, error } = await q;
  if (error) throw new Error(`查询同步流水失败：${error.message}`);
  return { rows: data ?? [], count: (data ?? []).length, limit };
}

async function getAuditLog(admin: SupabaseClient, body: Record<string, unknown>) {
  const limit = clampInt(body.limit, 1, MAX_ROWS, 200);
  let q = admin.from('admin_audit_log')
    .select('id, ts, actor_user_id, actor_email, action, target_table, target_id, before, after, ip')
    .order('ts', { ascending: false })
    .limit(limit);
  const actor = String(body.actor ?? '').trim();
  if (actor) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(actor);
    q = isUuid ? q.eq('actor_user_id', actor) : q.ilike('actor_email', `%${safeLike(actor)}%`);
  }
  // 注意：body.action 已被路由器用作动作名，这里必须用 action_filter，否则会被路由值污染
  const actionFilter = String(body.action_filter ?? '').trim();
  if (actionFilter) q = q.ilike('action', `%${safeLike(actionFilter)}%`);
  const target = String(body.target ?? '').trim();
  if (target) { const like = safeLike(target); q = q.or(`target_table.ilike.%${like}%,target_id.ilike.%${like}%`); }
  const since = String(body.since ?? '').trim();
  if (since) q = q.gte('ts', since);
  const { data, error } = await q;
  if (error) throw new Error(`查询审计日志失败：${error.message}`);
  return { rows: data ?? [], count: (data ?? []).length, limit };
}

async function setPlatformEnabled(admin: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  const platformKey = String(body.platform_key ?? '').trim();
  if (!platformKey) throw new Error('缺少 platform_key');
  const enabled = Boolean(body.enabled ?? true);
  const nextStatus = enabled ? '启用' : '停用';
  const { data: before, error: selErr } = await admin.from('platform_configs')
    .select('id, name, status, auth_state').eq('name', platformKey).maybeSingle();
  if (selErr) throw new Error(`读取平台配置失败：${selErr.message}`);
  if (!before) throw new Error(`平台「${platformKey}」不存在（platform_configs.name 未命中）`);
  const { data: after, error: updErr } = await admin.from('platform_configs')
    .update({ status: nextStatus }).eq('id', (before as any).id).select('id, name, status').maybeSingle();
  if (updErr) throw new Error(`更新平台状态失败：${updErr.message}`);
  await writeAuditRow(admin, caller, {
    action: 'adapter.toggle',
    target_table: 'platform_configs',
    target_id: String((before as any).id),
    before: { name: (before as any).name, status: (before as any).status },
    after: { name: (after as any)?.name, status: (after as any)?.status },
  });
  return { ok: true, platform_key: platformKey, status: nextStatus, changed: (before as any).status !== nextStatus };
}

async function rotateCredential(admin: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  const platformKey = String(body.platform_key ?? '').trim();
  if (!platformKey) throw new Error('缺少 platform_key');
  const { data: existed, error: selErr } = await admin.from('platform_credentials')
    .select('id, platform_key, app_key, app_secret_enc, redirect_uri, extra, key_version, updated_at')
    .eq('platform_key', platformKey).maybeSingle();
  if (selErr) throw new Error(`读取凭据行失败：${selErr.message}`);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: caller.userId };
  const secretProvided = body.app_secret !== undefined && body.app_secret !== null && String(body.app_secret) !== '';
  if (body.app_key !== undefined) patch.app_key = String(body.app_key ?? '');
  if (body.redirect_uri !== undefined) patch.redirect_uri = String(body.redirect_uri ?? '');
  if (body.extra !== undefined) {
    patch.extra = (body.extra && typeof body.extra === 'object') ? body.extra : {};
  }
  if (secretProvided) {
    if (!hasMasterKey()) throw new Error('服务器缺少 SECRET_MASTER_KEY，无法封装 app_secret');
    patch.app_secret_enc = await encrypt(String(body.app_secret));   // 明文只在本行内存活
    patch.key_version = 1;                                           // 与 vault 的 v1 封装版本一致
  }
  const { data: row, error: upErr } = await admin.from('platform_credentials')
    .upsert({ platform_key: platformKey, ...patch }, { onConflict: 'platform_key' })
    .select('id, platform_key, app_key, app_secret_enc, redirect_uri, extra, key_version, updated_at')
    .single();
  if (upErr) throw new Error(`写入凭据失败：${upErr.message}`);

  const redact = (r: any) => r ? ({
    platform_key: r.platform_key,
    app_key: r.app_key ?? null,
    has_secret: Boolean(r.app_secret_enc),
    redirect_uri: r.redirect_uri ?? null,
    extra_keys: r.extra && typeof r.extra === 'object' ? Object.keys(r.extra) : [],
    key_version: r.key_version ?? 1,
    updated_at: r.updated_at ?? null,
  }) : null;
  await writeAuditRow(admin, caller, {
    action: 'credential.rotate',
    target_table: 'platform_credentials',
    target_id: String((row as any).id),
    before: redact(existed),
    after: { ...redact(row), rotated: secretProvided },  // 密钥只记「已轮换」，绝不明文/密文入库
  });
  return { ok: true, created: !existed, secret_rotated: secretProvided, credential: redact(row) };
}

async function getCredential(admin: SupabaseClient, body: Record<string, unknown>) {
  const platformKey = String(body.platform_key ?? '').trim();
  if (!platformKey) throw new Error('缺少 platform_key');
  const { data, error } = await admin.from('platform_credentials')
    .select('platform_key, app_key, app_secret_enc, redirect_uri, extra, key_version, updated_at, created_at')
    .eq('platform_key', platformKey).maybeSingle();
  if (error) throw new Error(`读取凭据失败：${error.message}`);
  if (!data) return { ok: false, found: false, platform_key: platformKey };
  const row = data as any;
  // 密文不出门：只告诉前端有没有、什么时候换的
  return {
    ok: true,
    found: true,
    platform_key: row.platform_key,
    app_key: row.app_key ?? null,
    redirect_uri: row.redirect_uri ?? null,
    extra: row.extra ?? {},
    has_secret: Boolean(row.app_secret_enc),
    key_version: row.key_version ?? 1,
    updated_at: row.updated_at ?? null,
    created_at: row.created_at ?? null,
  };
}

async function forceResync(admin: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  const shopId = String(body.shop_id ?? '').trim();
  if (!shopId) throw new Error('缺少 shop_id');
  const { data: shop, error: selErr } = await admin.from('shop_auths')
    .select('id, user_id, shop_name, platform, status').eq('id', shopId).maybeSingle();
  if (selErr) throw new Error(`读取店铺失败：${selErr.message}`);
  if (!shop) throw new Error(`店铺不存在（shop_auths.id=${shopId}）`);
  const { data: stateBefore } = await admin.from('shop_sync_state')
    .select('last_synced_at, last_status, last_error').eq('shop_auth_id', shopId).maybeSingle();

  const { status, data } = await callSyncOrders({
    action: 'sync-shop', shop_auth_id: shopId, mode: 'manual',
  });
  const { data: stateAfter } = await admin.from('shop_sync_state')
    .select('last_synced_at, last_status, last_error').eq('shop_auth_id', shopId).maybeSingle();
  await writeAuditRow(admin, caller, {
    action: 'shop.force_resync',
    target_table: 'shop_auths',
    target_id: shopId,
    before: { shop_name: (shop as any).shop_name, platform: (shop as any).platform, sync_state: stateBefore ?? null },
    after: { sync_orders_status: status, result: data, sync_state: stateAfter ?? null },
  });
  return { ok: status >= 200 && status < 300 && !(data as any)?.error, sync_orders_status: status, result: data };
}

async function testAdapter(admin: SupabaseClient, body: Record<string, unknown>) {
  const platformKey = String(body.platform_key ?? '').trim();
  if (!platformKey) throw new Error('缺少 platform_key');
  const creds = (body.creds && typeof body.creds === 'object') ? body.creds : {};
  // 适配器只存在于 sync-orders（ADAPTERS 注册表），这里转发而不是复制一份
  const { status, data } = await callSyncOrders({
    action: 'test-adapter',
    platform_key: platformKey,
    creds,
    days_back: body.days_back,
    max_orders: body.max_orders,
    sample: body.sample,
    shop_domain: body.shop_domain,
    shop_name: body.shop_name,
  });
  return { ok: status >= 200 && status < 300, upstream_status: status, result: data };
}

async function writeAuditDirect(admin: SupabaseClient, caller: Caller, body: Record<string, unknown>) {
  // 同上：审计动作名走 audit_action，避免与路由用的 body.action（='write_audit'）混淆
  const action = String(body.audit_action ?? '').trim();
  if (!action) throw new Error('缺少 audit_action（写入 admin_audit_log.action 的动作名）');
  const { data, error } = await admin.from('admin_audit_log').insert({
    actor_user_id: caller.userId,
    actor_email: caller.email,
    ip: caller.ip,
    action,
    target_table: body.target_table != null ? String(body.target_table) : null,
    target_id: body.target_id != null ? String(body.target_id) : null,
    before: body.before ?? null,
    after: body.after ?? null,
  }).select('id, ts, actor_email, action').single();
  if (error) throw new Error(`写审计失败：${error.message}`);
  return { ok: true, audit: data };
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'admin-api 只接受 POST {action,...}' }, 405, req);

  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;

  const caller = await authenticate(req);
  if (!caller) {
    console.error(`[${functionName}] ${requestId} 403 非管理员调用 action=${String(body.action ?? '')}`);
    return json({ error: '仅管理员可访问 admin-api' }, 403, req);
  }
  const admin = svc();
  const action = String(body.action ?? '');
  try {
    switch (action) {
      case 'list_platform_health': return json(await listPlatformHealth(admin, body), 200, req);
      case 'list_sync_runs': return json(await listSyncRuns(admin, body), 200, req);
      case 'get_audit_log': return json(await getAuditLog(admin, body), 200, req);
      case 'set_platform_enabled': return json(await setPlatformEnabled(admin, caller, body), 200, req);
      case 'rotate_credential': return json(await rotateCredential(admin, caller, body), 200, req);
      case 'get_credential': return json(await getCredential(admin, body), 200, req);
      case 'force_resync': return json(await forceResync(admin, caller, body), 200, req);
      case 'test_adapter': return json(await testAdapter(admin, body), 200, req);
      case 'write_audit': return json(await writeAuditDirect(admin, caller, body), 200, req);
      default: return json({ error: `未知 action: ${action}`, supported: [
        'list_platform_health', 'list_sync_runs', 'get_audit_log', 'set_platform_enabled',
        'rotate_credential', 'get_credential', 'force_resync', 'test_adapter', 'write_audit',
      ] }, 400, req);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} action=${action} ${msg}`);
    return json({ error: msg }, 500, req);
  }
});
