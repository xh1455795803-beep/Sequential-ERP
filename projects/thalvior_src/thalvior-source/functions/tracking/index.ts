// tracking — 17TRACK 物流轨迹聚合代理（2026-10-20）
// =====================================================================
// 替代原快递鸟(KDNiao)实现，改用 17TRACK 开放平台（2100+ 物流商聚合）
//
// Actions:
//   register     → 注册单号到 17TRACK（批量≤40，仅对 tracking_status='created' 的 shipment）
//   track        → 查询轨迹（批量≤40）
//   sync-active  → 同步所有在途订单轨迹（pg_cron 每 30 分钟调用；内部 action）
//   status       → 检查 API key 是否配置 + 查剩余额度
//
// 铁律：
//   1. TRACK17_API_KEY 从 Deno.env.get 获取，为空返回 503（前端优雅降级）
//   2. key 绝不硬编码进任何前端代码
//   3. 免费额度 200 单极珍贵 — register 仅对 tracking_status='created' 调用一次
//   4. 批量上限 40/次，自动分批
//
// API 文档：https://api.17track.net/en/doc

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TRACK17_BASE = 'https://api.17track.net';
const BATCH_LIMIT = 40;

// ─── 17TRACK 状态码 → 归一化英文 code ───────────────────────────────
function mapStatus(state: number): string {
  switch (state) {
    case 0: return 'notfound';
    case 10: return 'created';
    case 20: return 'in_transit';
    case 30: return 'in_transit';
    case 35: return 'exception';
    case 40: return 'delivered';
    case 50: return 'exception';
    case 60: return 'expired';
    default: return 'created';
  }
}

// ─── 工具函数 ────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, oneday-app-id',
    },
  });
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`ENV_MISSING:${name}`);
  return v;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, oneday-app-id',
  };
}

// 解析 service role / anon 权限
async function resolveAuth(req: Request): Promise<{ role: 'service' | 'anon' | 'none' }> {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { role: 'none' };
  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    if (token === serviceKey) return { role: 'service' };
    const url = Deno.env.get('SUPABASE_URL') || 'http://localhost:8000';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const sb = createClient(url, serviceKey);
    const { data } = await sb.auth.getUser(token);
    if (data.user) return { role: 'anon' };
  } catch { /* ignore */ }
  return { role: 'none' };
}

async function fetchDirect(url: string, init: RequestInit, ms = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { ...init.headers, 'Accept-Encoding': 'identity' } });
  } finally {
    clearTimeout(timer);
  }
}

// ─── 17TRACK API 客户端 ──────────────────────────────────────────────
async function track17Call(apiKey: string, endpoint: string, body: unknown): Promise<Record<string, unknown>> {
  const resp = await fetchDirect(`${TRACK17_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      '17token': apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json() as Record<string, unknown>;
  if ((data as any).code !== 0) {
    const errs = ((data as any).data?.errors ?? []) as Array<{ code: number; message: string }>;
    const msg = errs.map(e => `${e.code}:${e.message}`).join('; ') || `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

// ─── 归一化 17TRACK 轨迹事件 → 前端统一结构 ─────────────────────────
interface NormEvent {
  time: string;
  location: string;
  description: string;
  status: string;
}

function normalizeEvents(raw: unknown): NormEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((ev: Record<string, unknown>) => ({
    time: String(ev?.a ?? ev?.z ?? ''),
    location: String(ev?.c ?? ev?.z ?? ''),
    description: String(ev?.z ?? ev?.c ?? ''),
    status: String(ev?.z ?? ''),
  })).filter(e => e.time || e.description);
}

// ─── Batch 分片执行 ──────────────────────────────────────────────────
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── Action: register（批量注册单号） ────────────────────────────────
async function doRegister(apiKey: string, sb: ReturnType<typeof createClient>, numbers: string[]) {
  const unique = [...new Set(numbers)];
  const batches = chunk(unique, BATCH_LIMIT);
  const allAccepted: Array<{ number: string; carrier?: number }> = [];
  const allRejected: Array<{ number: string; error: string }> = [];

  for (const batch of batches) {
    const payload = batch.map(n => ({ number: n }));
    try {
      const data = await track17Call(apiKey, '/track/v2.4/register', payload);
      const d = (data as any).data ?? {};
      if (Array.isArray(d.accepted)) allAccepted.push(...d.accepted);
      if (Array.isArray(d.rejected)) allRejected.push(...d.rejected);
    } catch (e) {
      for (const n of batch) allRejected.push({ number: n, error: (e as Error).message });
    }
  }

  // 更新 shipments 的 tracking_status → 'created'（已注册等待首次轨迹）
  for (const item of allAccepted) {
    await sb.from('shipments')
      .update({ tracking_status: 'created', tracking_last_check: new Date().toISOString() })
      .eq('tracking_no', item.number)
      .eq('tracking_status', 'created');
  }

  return { accepted: allAccepted, rejected: allRejected };
}

// ─── Action: track（批量查询轨迹） ────────────────────────────────────
async function doTrack(apiKey: string, numbers: string[]) {
  const unique = [...new Set(numbers)];
  const batches = chunk(unique, BATCH_LIMIT);
  const results: Array<{ number: string; status?: string; events?: NormEvent[]; carrier?: number; error?: string }> = [];

  for (const batch of batches) {
    const payload = batch.map(n => ({ number: n }));
    try {
      const data = await track17Call(apiKey, '/track/v2.4/gettrackinfo', payload);
      const items = ((data as any).data ?? []) as Array<Record<string, unknown>>;
      for (const item of items) {
        const number = String(item.number ?? '');
        const track = (item.track_info ?? item) as Record<string, unknown>;
        const state = Number(track.latest_status ?? track.status ?? -1);
        const rawEvents = (track.track_events ?? []) as unknown[];
        results.push({
          number,
          status: mapStatus(state),
          events: normalizeEvents(rawEvents),
          carrier: Number(track.carrier?.toString?.() ?? 0) || undefined,
        });
      }
    } catch (e) {
      for (const n of batch) results.push({ number: n, error: (e as Error).message });
    }
  }

  return results;
}

// ─── Action: sync-active（pg_cron 触发：同步在途订单轨迹） ───────────
async function doSyncActive(apiKey: string, sb: ReturnType<typeof createClient>, dryRun: boolean) {
  // 查在途：已发货且 tracking_status 非终态
  const { data: activeShipments, error } = await sb
    .from('shipments')
    .select('id, tracking_no, tracking_status')
    .not('tracking_status', 'in', '("delivered","exception","expired")')
    .not('tracking_no', 'is', null)
    .neq('tracking_no', '')
    .limit(200);

  if (error) throw new Error(`Query active shipments failed: ${error.message}`);
  if (!activeShipments?.length) return { synced: 0, total: 0, skipped: 0, dryRun };

  // 分批：需注册的(created/notfound) vs 需查询的
  const toRegister = activeShipments.filter(s => s.tracking_status === 'created' || s.tracking_status === 'notfound');
  const toQuery = activeShipments.filter(s => s.tracking_status !== 'created' && s.tracking_status !== 'notfound');

  if (dryRun) {
    return {
      synced: 0,
      total: activeShipments.length,
      toRegister: toRegister.length,
      toQuery: toQuery.length,
      dryRun: true,
    };
  }

  let synced = 0;
  let errors = 0;

  // 注册（仅首次，保护额度）
  if (toRegister.length > 0) {
    const numbers = toRegister.map(s => s.tracking_no);
    const batches = chunk(numbers, BATCH_LIMIT);
    for (const batch of batches) {
      try {
        await track17Call(apiKey, '/track/v2.4/register', batch.map(n => ({ number: n })));
      } catch (e) {
        console.error('[tracking] register batch error:', (e as Error).message);
        errors++;
      }
    }
  }

  // 查询所有在途的轨迹
  const allNumbers = activeShipments.map(s => s.tracking_no);
  const queryBatches = chunk(allNumbers, BATCH_LIMIT);

  for (const batch of queryBatches) {
    try {
      const data = await track17Call(apiKey, '/track/v2.4/gettrackinfo', batch.map(n => ({ number: n })));
      const items = ((data as any).data ?? []) as Array<Record<string, unknown>>;

      for (const item of items) {
        const number = String(item.number ?? '');
        const shipment = activeShipments.find(s => s.tracking_no === number);
        if (!shipment) continue;

        const track = (item.track_info ?? item) as Record<string, unknown>;
        const state = Number(track.latest_status ?? track.status ?? -1);
        const rawEvents = (track.track_events ?? []) as unknown[];

        await sb.from('shipments')
          .update({
            tracking_status: mapStatus(state),
            tracking_events: normalizeEvents(rawEvents),
            tracking_last_check: new Date().toISOString(),
          })
          .eq('id', shipment.id);

        synced++;
      }
    } catch (e) {
      console.error('[tracking] gettrackinfo batch error:', (e as Error).message);
      errors++;
    }
  }

  return { synced, total: activeShipments.length, errors, dryRun: false };
}

// ─── Main Handler ────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action } = body as { action?: string };
  const apiKey = Deno.env.get('TRACK17_API_KEY');
  const auth = await resolveAuth(req);

  // ─── status：无需 API key，检查配置状态 ───
  if (action === 'status') {
    if (!apiKey) {
      return json({
        configured: false,
        status: 'inactive',
        message: 'TRACK17_API_KEY not configured',
      });
    }
    try {
      const data = await track17Call(apiKey, '/track/v2/getquota', {});
      const quota = (data as any).data ?? {};
      return json({
        configured: true,
        status: 'active',
        quota: {
          total: quota.quota_total ?? 0,
          used: quota.quota_used ?? 0,
          remain: (quota.quota_total ?? 0) - (quota.quota_used ?? 0),
        },
      });
    } catch {
      return json({ configured: true, status: 'invalid_key' });
    }
  }

  // ─── 其他 action 均需 API key ───
  if (!apiKey) {
    return json({
      error: 'TRACKING_SERVICE_UNAVAILABLE',
      error_code: 'TRACK17_KEY_NOT_CONFIGURED',
      message: 'Tracking service not yet activated. API key pending configuration.',
    }, 503);
  }

  const sb = createClient(
    getEnv('SUPABASE_URL'),
    getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  );

  try {
    // ─── register ───
    if (action === 'register') {
      const trackingNos = (body.tracking_numbers ?? (body.tracking_no ? [body.tracking_no] : [])) as string[];
      if (!trackingNos.length) return json({ error: 'No tracking numbers provided' }, 400);
      const result = await doRegister(apiKey, sb, trackingNos);
      return json({ success: true, data: result });
    }

    // ─── track ───
    if (action === 'track') {
      const trackingNos = (body.tracking_numbers ?? (body.tracking_no ? [body.tracking_no] : [])) as string[];
      if (!trackingNos.length) return json({ error: 'No tracking numbers provided' }, 400);
      const results = await doTrack(apiKey, trackingNos);
      return json({ success: true, data: results });
    }

    // ─── sync-active（cron 触发或手动全量同步）───
    if (action === 'sync-active') {
      if (auth.role === 'none') return json({ error: 'Unauthorized' }, 401);
      const dryRun = body.dry_run === true;
      const result = await doSyncActive(apiKey, sb, dryRun);
      return json({ success: true, data: result });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tracking] ${action} failed:`, message);

    // 17TRACK 额度用尽 → 明确错误码
    if (message.includes('-18019908')) {
      return json({
        error: 'TRACKING_QUOTA_EXHAUSTED',
        error_code: 'TRACK17_QUOTA_EXHAUSTED',
        message: '17TRACK free quota exhausted. Please upgrade or wait.',
      }, 503);
    }
    if (message.includes('-18019907')) {
      return json({
        error: 'TRACKING_DAILY_LIMIT',
        error_code: 'TRACK17_DAILY_LIMIT',
        message: '17TRACK daily limit reached. Try again tomorrow.',
      }, 429);
    }

    return json({ error: message }, 500);
  }
});
