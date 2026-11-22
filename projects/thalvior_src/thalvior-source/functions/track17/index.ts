// track17 — 17TRACK 物流轨迹聚合 Edge Function
// API 文档：https://api.17track.net/track/v2.4
// 认证：Header `17token: <API_KEY>`
// 免费额度：一次性 200 单（珍贵，register 最小化）
// 批量限制：≤40 单/次

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const API_BASE = 'https://api.17track.net';
const BATCH_LIMIT = 40;

// 17TRACK 状态码 → 内部 tracking_status
const STATE_MAP: Record<number, string> = {
  0: 'notfound',       // Not found
  10: 'pending_register', // Pending (registered, waiting first scan)
  20: 'in_transit',    // In transit
  30: 'exception',     // Exception
  35: 'delayed',       // Delayed (map to exception)
  40: 'delivered',     // Delivered
  50: 'returning',     // Returning (map to exception)
  60: 'returned',      // Returned (map to exception)
};

function mapState(code: number): string {
  return STATE_MAP[code] ?? 'in_transit';
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getApiKey(): string | null {
  const key = Deno.env.get('TRACK17_API_KEY');
  return key && key.trim() ? key.trim() : null;
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? 'http://api-gw:8000',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
}

// 17TRACK API 通用调用
async function call17Track(
  apiKey: string,
  endpoint: string,
  body: unknown,
): Promise<{ code: number; data?: unknown; message?: string }> {
  const resp = await fetch(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      '17token': apiKey,
    },
    body: JSON.stringify(body),
  });
  return await resp.json() as { code: number; data?: unknown; message?: string };
}

// 注册单号（批量≤40）
async function registerNumbers(apiKey: string, numbers: string[]): Promise<{
  accepted: string[];
  rejected: Array<{ number: string; error: string }>;
}> {
  const body = numbers.map((n) => ({ number: n }));
  const result = await call17Track(apiKey, '/track/v2.4/register', body);

  if (result.code !== 0) {
    // 额度用尽 or 超日限 → 全部拒绝
    return {
      accepted: [],
      rejected: numbers.map((n) => ({ number: n, error: `API error ${result.code}: ${result.message}` })),
    };
  }

  const data = result.data as Array<{ number: string; error?: { code: number; message: string } }> | undefined;
  const accepted: string[] = [];
  const rejected: Array<{ number: string; error: string }> = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      if (item.error) {
        rejected.push({ number: item.number, error: item.error.message });
      } else {
        accepted.push(item.number);
      }
    }
  }

  return { accepted, rejected };
}

// 查询轨迹（批量≤40）
async function queryNumbers(apiKey: string, numbers: string[]): Promise<{
  results: Array<{
    number: string;
    carrier?: number;
    state: number;
    events: Array<{ time: string; location: string; description: string; status: string }>;
  }>;
}> {
  const body = numbers.map((n) => ({ number: n }));
  const result = await call17Track(apiKey, '/track/v2.4/gettrackinfo', body);

  if (result.code !== 0) {
    return { results: [] };
  }

  const data = result.data as Array<{
    number: string;
    carrier?: { number: number };
    track_state: number;
    track_info?: {
      latest_event?: { time: string; location: string; desc: string; status: string };
      events?: Array<{ time: string; location: string; desc: string; status: string }>;
    };
  }> | undefined;

  const results: Array<{
    number: string;
    carrier?: number;
    state: number;
    events: Array<{ time: string; location: string; description: string; status: string }>;
  }> = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      const events = (item.track_info?.events ?? []).map((ev) => ({
        time: ev.time ?? '',
        location: ev.location ?? '',
        description: ev.desc ?? '',
        status: ev.status ?? '',
      }));
      results.push({
        number: item.number,
        carrier: item.carrier?.number,
        state: item.track_state ?? 0,
        events,
      });
    }
  }

  return { results };
}

// 分批处理（每批≤40）
async function batchProcess<T>(items: string[], fn: (batch: string[]) => Promise<T>): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = items.slice(i, i + BATCH_LIMIT);
    results.push(await fn(batch));
  }
  return results;
}

// Action: register — 批量注册单号（仅对 tracking_status IS NULL 的 shipment）
async function actionRegister(apiKey: string): Promise<unknown> {
  const supabase = getSupabaseAdmin();

  // 只取 tracking_status 为 NULL 或未注册的（避免重复注册浪费额度）
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, tracking_no')
    .is('tracking_status', null)
    .not('tracking_no', 'is', null)
    .limit(200); // 一次性最多取 200 条待注册

  if (error) {
    throw new Error(`DB query failed: ${error.message}`);
  }

  if (!shipments || shipments.length === 0) {
    return { registered: 0, message: 'No shipments pending registration' };
  }

  const numbers = shipments.map((s) => s.tracking_no!).filter(Boolean);
  const idMap = new Map(shipments.map((s) => [s.tracking_no, s.id]));

  const batches = await batchProcess(numbers, async (batch) => {
    return registerNumbers(apiKey, batch);
  });

  let totalRegistered = 0;
  const totalRejected: Array<{ number: string; error: string }> = [];

  for (const batch of batches) {
    totalRegistered += batch.accepted.length;
    totalRejected.push(...batch.rejected);

    // 更新已注册 shipment 的 tracking_status = 'pending_register'
    for (const num of batch.accepted) {
      const sid = idMap.get(num);
      if (sid) {
        await supabase
          .from('shipments')
          .update({ tracking_status: 'pending_register', tracking_last_check: new Date().toISOString() })
          .eq('id', sid);
      }
    }
  }

  return {
    registered: totalRegistered,
    rejected: totalRejected,
    total_pending: numbers.length,
  };
}

// Action: query — 批量查询轨迹
async function actionQuery(apiKey: string, trackingNumbers: string[]): Promise<unknown> {
  if (!trackingNumbers?.length) {
    return { error: 'tracking_numbers required' };
  }

  const batches = await batchProcess(trackingNumbers.slice(0, 200), async (batch) => {
    return queryNumbers(apiKey, batch);
  });

  const allResults = batches.flatMap((b) => b.results);
  return { results: allResults };
}

// Action: sync — 同步在途订单轨迹（cron 调用）
// 仅对 tracking_status NOT IN ('delivered','exception','expired') 且已注册过的 shipment 查询
async function actionSync(apiKey: string): Promise<unknown> {
  const supabase = getSupabaseAdmin();

  // 取在途 + 已注册（tracking_status 不是终态且非 NULL）
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, tracking_no, tracking_status')
    .not('tracking_status', 'in', '("delivered","exception","expired")')
    .not('tracking_status', 'is', null)
    .not('tracking_no', 'is', null)
    .limit(200); // 保护额度

  if (error) {
    throw new Error(`DB query failed: ${error.message}`);
  }

  if (!shipments || shipments.length === 0) {
    return { synced: 0, message: 'No active shipments to sync' };
  }

  const numbers = shipments.map((s) => s.tracking_no!).filter(Boolean);
  const idMap = new Map(shipments.map((s) => [s.tracking_no, s.id]));
  const now = new Date().toISOString();

  const batches = await batchProcess(numbers, async (batch) => {
    return queryNumbers(apiKey, batch);
  });

  let synced = 0;
  let delivered = 0;
  let exceptions = 0;

  for (const batch of batches) {
    for (const result of batch.results) {
      const sid = idMap.get(result.number);
      if (!sid) continue;

      const newStatus = mapState(result.state);
      const isDelivered = newStatus === 'delivered';
      const isException = newStatus === 'exception';

      await supabase
        .from('shipments')
        .update({
          tracking_status: newStatus,
          tracking_events: result.events as unknown as Json,
          tracking_last_check: now,
        })
        .eq('id', sid);

      synced++;
      if (isDelivered) delivered++;
      if (isException) exceptions++;
    }
  }

  return {
    synced,
    delivered,
    exceptions,
    total_active: shipments.length,
    checked_at: now,
  };
}

// Action: status — 检查服务状态 & 额度
async function actionStatus(apiKey: string): Promise<unknown> {
  try {
    const result = await call17Track(apiKey, '/track/v2/getquota', {});
    if (result.code === 0 && result.data) {
      const quota = result.data as { quota_total?: number; quota_used?: number; quota_remain?: number };
      return {
        configured: true,
        status: 'active',
        quota: {
          total: quota.quota_total ?? 200,
          used: quota.quota_used ?? 0,
          remain: quota.quota_remain ?? 200,
        },
      };
    }
    return { configured: true, status: 'invalid_key', error: result.message };
  } catch (e) {
    return { configured: true, status: 'error', error: (e as Error).message };
  }
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

Deno.serve(async (req) => {
  const functionName = 'track17';
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  try {
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn(`[${functionName}] ${requestId} TRACK17_API_KEY not configured`);
      return json(
        { error: '17TRACK API key not configured', error_code: 'NO_KEY' },
        503,
      );
    }

    const body = await req.json();
    const { action, tracking_numbers, tracking_no } = body as {
      action?: string;
      tracking_numbers?: string[];
      tracking_no?: string;
    };

    // 兼容单号和批量
    const numbers = tracking_numbers ?? (tracking_no ? [tracking_no] : []);

    console.info(`[${functionName}] ${requestId} action=${action} count=${numbers.length}`);

    let result: unknown;

    switch (action) {
      case 'register':
        result = await actionRegister(apiKey);
        break;
      case 'query':
      case 'track':
        result = await actionQuery(apiKey, numbers);
        break;
      case 'sync':
      case 'sync-active':
        result = await actionSync(apiKey);
        break;
      case 'status':
        result = await actionStatus(apiKey);
        break;
      default:
        return json({ error: `Unknown action: ${action}. Use register/query/sync/status` }, 400);
    }

    const elapsed = Date.now() - startTime;
    console.info(`[${functionName}] ${requestId} done in ${elapsed}ms`);

    return json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} failed: ${message}`);
    return json({ error: message }, 500);
  }
});
