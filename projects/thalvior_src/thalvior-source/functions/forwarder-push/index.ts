// forwarder-push — ERP → 货代 出站推单（M2 履约链路：订单 → 货件 → 推单 → 回传）
// =====================================================================
// 契约（主会话已定死，字段名/action 名不得改动）：
//   POST，必须携带调用者 Authorization（service_role 建连 + 代码层 checkPerm，见下）
//   action="create_from_orders" → checkPerm("logistics.shipment.view") 且 checkPerm("logistics.push.push")
//   action="push"               → checkPerm("logistics.push.push")
//   action="list-logs"          → checkPerm("logistics.push.view")
//
// 为什么权限判定必须显式走 checkPerm（不能指望 RLS）：
//   本项目所有 Edge Function 都用 SUPABASE_SERVICE_ROLE_KEY 建 client（functions/*/index.ts 实测），
//   service_role 在库里 rolbypassrls=true 且 current_user 恒为 'service_role'，
//   所以 RLS 对 EF 完全不生效、库内触发器里的 current_user 判定也一律命中 service_role。
//   → 权限闸门只有 checkPerm（用调用者自己的 JWT 调 SECURITY DEFINER has_perm）这一条路；
//   → 租户隔离只有代码层 `.eq('user_id', userId)` 这一条路。两处都漏了就是跨租户越权。
//
// 三条竞品铁律在本文件里的落点（DESIGN §2）：
//   铁律1「规则命中 ≠ 执行成功」：push_state（推单到哪一步）与 stage（货到哪一步）是两个列，
//        本函数只写 push_state / push_attempt / pushed_at / wms_order_no / tracking_no，
//        绝不因为"推单成功"就顺手改 stage —— 推单成功不代表货已经到了货代仓。
//   铁律2「作业阶段与单据有效性分离」：doc_status='cancelled' 的货件不再推单，但不是删除记录。
//   铁律3「异常走工单，不塞进订单状态」：推单失败只写 push_state='push_failed'/'dead' + push_logs，
//        不动 orders.status，也不自建"异常"字段。
//
// 幂等（妙手已知 bug「只操作了一次提交待打包，但两个货代系统都有该订单」的对策）：
//   batch_no 是租户内唯一的推单幂等键（shipments_user_batch_key 唯一索引 + push_is_duplicate RPC）。
//   注意：create_from_orders 在建单时就给货件分配了 batch_no，所以 push 阶段拿这条货件自己的
//   batch_no 去问 push_is_duplicate **必然命中自己**（该函数按 user_id+batch_no 查 shipments）。
//   因此这里把命中拆成两种情况：
//     · existing_shipment === 本货件 → 属于"自己"，不算重复，继续（否则永远推不出去）；
//     · existing_shipment !== 本货件 → 真重复（同一次提交被拆成了两条货件），跳过并写 deduped 日志。
//   另外 push_state='pushed' 的货件不再外呼（幂等的真正落点）。
//
// 凭据解密：forwarder_auths.credentials_enc / webhook_secret_enc
//   fw01 列注释实测口径：AES-256-GCM / PBKDF2 100000 / SHA-256，盐 thalvior-cred-v1，secret=JWT_SECRET，
//   布局 base64(iv12 || ct || tag16)（与 shop_auths 同口径，见 functions/ship-orders/index.ts）。
//   _shared/secret-vault.ts 是另一套（SECRET_MASTER_KEY + `v1:<b64iv>:<b64ct>`），只用于
//   platform_credentials。本函数两种都支持：按密文前缀自动选择，避免"写入口用哪套"把 EF 卡死。
//   —— 这一点与任务书描述不一致，已在交付报告里单独列出。
//
// 错误码：push_logs.error_code 必须来自 push_error_codes 字典（实测 18 条，全 is_active=true），
//   不自造文案：error_message 直接取字典 message_cn / message_en，具体技术细节写进 response_snapshot。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { checkPerm } from '../_shared/perm.ts';
import { decrypt as vaultDecrypt } from '../_shared/secret-vault.ts';

const functionName = 'forwarder-push';
const MAX_BATCH = 100;                       // 与 ship-orders 同口径，防止一次请求把货代接口打爆
const HTTP_TIMEOUT_MS = 15000;               // 货代接口超时必须自己掐，否则 EF 被 runtime 30s 砍掉后状态未知
const DEFAULT_RETRY_MAX = 5;                 // fulfillment_switches.retry_max 缺省值
const DEFAULT_DEDUPE_WINDOW_HOURS = 24;      // fulfillment_switches.dedupe_window_hours 缺省值
const DEFAULT_BACKOFF_MINUTES = 15;          // fulfillment_switches.retry_backoff_minutes 缺省值

// ─── 通用工具（照抄 ship-orders / tracking 风格） ────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-thalvior-forwarder-auth, x-thalvior-timestamp, x-thalvior-signature, x-thalvior-batch-no',
    },
  });
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

function adminClient() {
  return createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
}
type Admin = ReturnType<typeof adminClient>;

// 调用者身份：用 service_role client 换 JWT → user id（与 ship-orders.resolveUserId 一致）
async function resolveUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const { data } = await adminClient().auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function sstr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

function snum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function trunc(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}…(truncated)` : text;
}

// ─── 凭据解密（两套口径自适应） ──────────────────────────────────────
async function decryptLegacyB64(encB64: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const bin = atob(encB64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  const iv = raw.slice(0, 12);              // 布局实测：base64(iv12 || ct || tag16)
  const cipher = raw.slice(12);
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

/** 解出明文字符串。解密失败时原样返回（允许库里存明文密钥的过渡态；不因此放宽任何鉴权）。 */
async function decryptSecretText(enc: string): Promise<string> {
  const v = sstr(enc).trim();
  if (!v) return '';
  if (/^v\d+:/.test(v)) {                    // _shared/secret-vault.ts 口径
    try { return await vaultDecrypt(v); } catch { return v; }
  }
  try {
    return await decryptLegacyB64(v, getEnv('JWT_SECRET'));
  } catch {
    return v;
  }
}

/** 解成对象；明文不是 JSON 时包成 { value: "<原文>" }，让上层用同一套 key 取值。 */
async function decryptCreds(enc: string): Promise<Record<string, unknown>> {
  const text = await decryptSecretText(enc);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* 明文密钥不是 JSON，走下面的兜底 */ }
  return { value: text };
}

/** 从对象里按候选 key 顺序取第一个非空字符串。 */
function pick(obj: Record<string, unknown> | null, keys: string[]): string {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

// ─── HMAC 签名（对外的唯一凭据形态，不回显密钥） ─────────────────────
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// ─── batch_no：B + yyyyMMddHHmmss(UTC) + 6 位随机数字 ────────────────
function genBatchNo(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  const rnd = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return `B${ts}${p(rnd, 6)}`;
}

// ─── 错误码：只允许字典里的 18 条 ────────────────────────────────────
interface ErrCodeDef { code: string; message_cn: string; message_en: string; retryable: boolean; }

async function loadErrorCodes(admin: Admin): Promise<Map<string, ErrCodeDef>> {
  const map = new Map<string, ErrCodeDef>();
  const { data, error } = await admin.from('push_error_codes')
    .select('code, message_cn, message_en, retryable').eq('is_active', true);
  if (error) throw new Error(`读取 push_error_codes 字典失败：${error.message}`);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    map.set(sstr(r.code), {
      code: sstr(r.code),
      message_cn: sstr(r.message_cn),
      message_en: sstr(r.message_en),
      retryable: r.retryable === true,
    });
  }
  return map;
}

// 本函数会用到的字典码（全部实测存在于 push_error_codes，18 条之一）
const CODE_AUTH_EXPIRED = 'AUTH_EXPIRED';        // 没有 approved 授权 / 没有端点 / 没有签名密钥
const CODE_CH_DISABLED = 'CH_DISABLED';          // 渠道已停用
const CODE_WMS_TIMEOUT = 'WMS_TIMEOUT';          // 网络异常、超时、无法判定的非 2xx
const CODE_IDEMPOTENT_HIT = 'IDEMPOTENT_HIT';    // 重复推单被幂等拦截
const CODE_BALANCE_LOW = 'BALANCE_LOW';          // 余额不足（货代侧回传的业务码）
const CODE_PROVIDER_UNSUPPORTED = 'PROVIDER_UNSUPPORTED';  // 货代系统协议未适配，不外呼

// ─── 行类型（只声明本函数用到的列，全部经 information_schema 核对） ──
interface OrderRow {
  id: string; user_id: string | null; status: string; buyer: string; phone: string;
  address: string | null; amount: number | string; currency: string; channel: string;
  shop_id: string | null; shop_name: string; external_order_id: string | null;
  product: string; sku: string; items: unknown;
}

interface ShipmentRow {
  id: string; user_id: string | null; order_id: string | null; forwarder_id: string | null;
  warehouse_id: string | null; channel_id: string | null; shop_id: string | null;
  platform: string | null; site: string | null; platform_order_no: string | null;
  batch_no: string | null; push_state: string; push_attempt: number; stage: string;
  doc_status: string; label_source: string; label_state: string; domestic_tracking_owner: string;
  tracking_no: string | null; carrier: string | null; destination: string | null;
  wms_order_no: string | null; fee_currency: string; declared_weight_g: number | null;
  shipment_kind: string; pushed_at: string | null;
}

const SHIPMENT_COLS = 'id, user_id, order_id, forwarder_id, warehouse_id, channel_id, shop_id,'
  + ' platform, site, platform_order_no, batch_no, push_state, push_attempt, stage, doc_status,'
  + ' label_source, label_state, domestic_tracking_owner, tracking_no, carrier, destination,'
  + ' wms_order_no, fee_currency, declared_weight_g, shipment_kind, pushed_at';

const ORDER_COLS = 'id, user_id, status, buyer, phone, address, amount, currency, channel,'
  + ' shop_id, shop_name, external_order_id, product, sku, items';

// ─── 开关（缺省即常量，绝不因为没配开关就报错） ──────────────────────
interface Switches { retry_max: number; dedupe_window_hours: number; retry_backoff_minutes: number; }

async function loadSwitches(admin: Admin, userId: string): Promise<Switches> {
  const sw: Switches = {
    retry_max: DEFAULT_RETRY_MAX,
    dedupe_window_hours: DEFAULT_DEDUPE_WINDOW_HOURS,
    retry_backoff_minutes: DEFAULT_BACKOFF_MINUTES,
  };
  // 实测：生产 fulfillment_switches 目前 0 行，所以这里必须静默降级到缺省值。
  // 口径：先取租户 scope='global' 那行（fulfillment_switches_scope_key 唯一键保证一行）。
  const { data, error } = await admin.from('fulfillment_switches')
    .select('retry_max, dedupe_window_hours, retry_backoff_minutes')
    .eq('user_id', userId).eq('scope', 'global').maybeSingle();
  if (error) {
    console.warn(`[${functionName}] 读 fulfillment_switches 失败，用缺省值：${error.message}`);
    return sw;
  }
  const row = (data ?? {}) as Record<string, unknown>;
  const a = snum(row.retry_max);
  const b = snum(row.dedupe_window_hours);
  const c = snum(row.retry_backoff_minutes);
  if (a !== null && a >= 0) sw.retry_max = a;
  if (b !== null && b > 0) sw.dedupe_window_hours = b;
  if (c !== null && c >= 0) sw.retry_backoff_minutes = c;
  return sw;
}

// 下次重试时间：只有"还会被自动重试捞起来"的情形才排期。
//   · push_failed 且错误码在字典里 retryable=true（BALANCE_LOW / WMS_TIMEOUT / CH_LABELING / NO_LABEL_YET）
//     → now + retry_backoff_minutes；
//   · dead（超过 retry_max）、或不可重试码（AUTH_EXPIRED / CH_DISABLED / IDEMPOTENT_HIT…，字典 retryable=f）
//     → null。理由：排了也不会成功，反而让自动重试 forever 打货代接口（竞品"重试风暴"的常见翻车点）。
//   契约没有规定 next_retry_at 的算法，这是本函数补的实现口径，已在交付报告里说明。
function nextRetryAt(
  state: string,
  code: string | null,
  sw: Switches,
  codes: Map<string, ErrCodeDef>,
): string | null {
  if (state !== 'push_failed') return null;
  if (!code || codes.get(code)?.retryable !== true) return null;
  return new Date(Date.now() + sw.retry_backoff_minutes * 60000).toISOString();
}

// =====================================================================
// action = create_from_orders
//   一个订单 → 1 条 shipments + N 条 shipment_items + 1 个 parcels
//   初始态（契约）：push_state='not_pushed' / stage='wait_inbound' / doc_status='valid' /
//                  intercept_state='none' / raw_status=null
//   norm_status：契约写 null，但库里 shipments.norm_status 是 NOT NULL DEFAULT 'sending'
//                （information_schema 实测），写 null 会直接 23502。落缺省值 'sending'，
//                语义就是"发货中"，与 raw_status=null（还没有对方原始状态）不冲突。
// =====================================================================
async function createFromOrders(
  admin: Admin,
  userId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const rawIds = Array.isArray(body.order_ids) ? body.order_ids : [];
  const orderIds = [...new Set(rawIds.map((x: unknown) => sstr(x).trim()).filter(Boolean))];
  const forwarderId = sstr(body.forwarder_id).trim();
  const warehouseId = sstr(body.warehouse_id).trim();
  const channelId = sstr(body.channel_id).trim();

  if (!orderIds.length) return { status: 400, body: { error: '缺少 order_ids' } };
  if (orderIds.length > MAX_BATCH) {
    return { status: 400, body: { error: `单次最多生成 ${MAX_BATCH} 条货件` } };
  }
  if (!forwarderId) return { status: 400, body: { error: '缺少 forwarder_id' } };

  // 归属校验：货代 / 仓库 / 渠道都必须属于调用者租户（service_role 绕过 RLS，只能自己拦）
  const { data: fwd, error: fwdErr } = await admin.from('freight_forwarders')
    .select('id, name, code').eq('id', forwarderId).eq('user_id', userId).maybeSingle();
  if (fwdErr) return { status: 500, body: { error: `查询货代失败：${fwdErr.message}` } };
  if (!fwd) return { status: 403, body: { error: 'FORWARDER_NOT_FOUND_OR_FORBIDDEN' } };

  if (warehouseId) {
    const { data: wh, error: whErr } = await admin.from('forwarder_warehouses')
      .select('id, code, forwarder_id').eq('id', warehouseId).eq('user_id', userId).maybeSingle();
    if (whErr) return { status: 500, body: { error: `查询仓库失败：${whErr.message}` } };
    if (!wh || sstr(wh.forwarder_id) !== forwarderId) {
      return { status: 403, body: { error: 'WAREHOUSE_NOT_FOUND_OR_NOT_OF_FORWARDER' } };
    }
  }
  if (channelId) {
    const { data: ch, error: chErr } = await admin.from('logistics_channels')
      .select('id, code, is_active, label_source_default').eq('id', channelId).eq('user_id', userId).maybeSingle();
    if (chErr) return { status: 500, body: { error: `查询渠道失败：${chErr.message}` } };
    if (!ch) return { status: 403, body: { error: 'CHANNEL_NOT_FOUND_OR_FORBIDDEN' } };
  }

  const { data: orders, error: oErr } = await admin.from('orders')
    .select(ORDER_COLS).in('id', orderIds);
  if (oErr) return { status: 500, body: { error: `查询订单失败：${oErr.message}` } };
  // PostgREST 客户端在没有 Generated Types 时把 data 推成很宽的类型，这里显式收敛成本文件声明的行形状
  const orderRows = (orders ?? []) as unknown as OrderRow[];

  const created: { shipment_id: string; order_id: string; batch_no: string }[] = [];
  const skipped: { order_id: string; reason: string }[] = [];

  for (const orderId of orderIds) {
    const o = orderRows.find((x) => x.id === orderId);
    if (!o) { skipped.push({ order_id: orderId, reason: 'ORDER_NOT_FOUND_OR_FORBIDDEN' }); continue; }
    if (o.user_id !== userId) {
      skipped.push({ order_id: orderId, reason: 'ORDER_NOT_FOUND_OR_FORBIDDEN' }); // 跨租户：不透露存在性
      continue;
    }

    // 铁律：已存在"未关闭"货件的订单不再生成第二条（stage<>'closed' 且 doc_status<>'cancelled'）
    const { data: actives, error: aErr } = await admin.from('shipments')
      .select('id, stage, doc_status, batch_no')
      .eq('user_id', userId).eq('order_id', orderId)
      .neq('stage', 'closed').neq('doc_status', 'cancelled').limit(1);
    if (aErr) {
      skipped.push({ order_id: orderId, reason: `查询既有货件失败：${aErr.message}` });
      continue;
    }
    const act = (actives ?? [])[0] as Record<string, unknown> | undefined;
    if (act) {
      skipped.push({
        order_id: orderId,
        reason: `ACTIVE_SHIPMENT_EXISTS:${sstr(act.id)}(stage=${sstr(act.stage)},batch=${sstr(act.batch_no)})`,
      });
      continue;
    }

    // 面单来源：优先用渠道默认（logistics_channels.label_source_default，4 值枚举与本列同域），
    // 没有渠道就留 'api'（shipments_label_source_ck 实测 4 值，缺省值同为 api）。
    let labelSource = 'api';
    if (channelId) {
      const { data: ch2 } = await admin.from('logistics_channels')
        .select('label_source_default').eq('id', channelId).maybeSingle();
      const v = sstr((ch2 as Record<string, unknown> | null)?.label_source_default);
      if (['attachment', 'api', 'pre_file', 'wms_gen'].includes(v)) labelSource = v;
    }

    const batchNo = genBatchNo();
    const insertRow: Record<string, unknown> = {
      user_id: userId,
      order_id: orderId,                    // shipments.order_id 是 text（orders.id 也是 text，实测）
      forwarder_id: forwarderId,
      warehouse_id: warehouseId || null,
      channel_id: channelId || null,
      shop_id: o.shop_id || null,
      platform: o.channel || null,          // 实测 orders.channel 存平台名（如 'Ozon'）
      platform_order_no: o.external_order_id || null,
      destination: o.address || null,
      batch_no: batchNo,
      push_state: 'not_pushed',
      stage: 'wait_inbound',
      doc_status: 'valid',
      intercept_state: 'none',
      norm_status: 'sending',               // 契约要求 null，但列 NOT NULL —— 见文件头说明
      raw_status: null,
      label_source: labelSource,
      label_state: 'none',
      push_attempt: 0,
      fee_currency: o.currency || 'CNY',
      declared_weight_g: null,
      remark: null,
      // legacy 列：shipments.status 缺省 '运输中' 对新链路是假状态（还没推给货代），显式置 null。
      // tracking.tsx 实测写法 row.status ?? tt('st.toPickup') → null 显示"待取件"，语义正确。
      status: null,
    };
    const { data: ship, error: sErr } = await admin.from('shipments').insert(insertRow).select('id').single();
    const shipmentId = sstr((ship as { id?: string } | null)?.id);
    if (sErr || !shipmentId) {
      // (user_id, batch_no) 是唯一索引，理论碰撞概率 1e-6/秒；真撞上就换一个随机尾号重试一次
      if (sErr && sstr(sErr.code) === '23505' && sstr(sErr.message).includes('batch_no')) {
        const retryBatch = genBatchNo();
        const { data: s2, error: e2 } = await admin.from('shipments')
          .insert({ ...insertRow, batch_no: retryBatch }).select('id').single();
        const id2 = sstr((s2 as { id?: string } | null)?.id);
        if (!e2 && id2) {
          created.push({ shipment_id: id2, order_id: orderId, batch_no: retryBatch });
          await insertChildren(admin, userId, id2, orderId, o, retryBatch);
        } else {
          skipped.push({ order_id: orderId, reason: `CREATE_SHIPMENT_FAILED:${e2?.message ?? 'no id'}` });
        }
        continue;
      }
      skipped.push({ order_id: orderId, reason: `CREATE_SHIPMENT_FAILED:${sErr?.message ?? 'no id'}` });
      continue;
    }
    created.push({ shipment_id: shipmentId, order_id: orderId, batch_no: batchNo });
    await insertChildren(admin, userId, shipmentId, orderId, o, batchNo);
  }

  return { status: 200, body: { ok: true, created, skipped } };
}

/** shipment_items（报关四件套落点）+ 1 个 parcels；子表失败不回滚货件，如实回报。 */
async function insertChildren(
  admin: Admin,
  userId: string,
  shipmentId: string,
  orderId: string,
  o: OrderRow,
  batchNo: string,
): Promise<void> {
  // items 解析口径与 ship-orders.parseItemQty / deduct_inventory_on_ship 保持一致：
  // qty 非正整数 → 1；items 空 → 退化成 order.sku × 1；无 sku 的条目丢弃。
  type ItemIn = { sku?: unknown; qty?: unknown; name?: unknown; name_en?: unknown; name_cn?: unknown;
    hs_code?: unknown; price?: unknown; amount?: unknown; weight_g?: unknown; currency?: unknown };
  const rows: Record<string, unknown>[] = [];
  let any = false;
  if (Array.isArray(o.items)) {
    for (const it of o.items as ItemIn[]) {
      if (!it || typeof it !== 'object') continue;
      const sku = sstr(it.sku).trim();
      if (!sku) continue;
      const q = Number(it.qty);
      const qty = Number.isInteger(q) && q > 0 ? q : 1;
      any = true;
      const price = snum(it.price ?? it.amount);
      rows.push({
        user_id: userId,
        shipment_id: shipmentId,
        order_id: orderId,
        sku,
        erp_sku: sku,                       // 外部 SKU↔ERP SKU 的配对是 forwarder_sku_mappings 的事，建单不强填
        external_sku: null,
        qty,
        name_cn: sstr(it.name_cn) || null,
        name_en: sstr(it.name_en) || sstr(it.name) || null,
        hs_code: sstr(it.hs_code) || null,
        unit_price: price,
        amount: price === null ? null : price * qty,
        weight_g: snum(it.weight_g),
        currency: sstr(it.currency) || o.currency || 'CNY',
        stock_status: 'good',
      });
    }
  }
  if (!any && sstr(o.sku).trim()) {
    rows.push({
      user_id: userId, shipment_id: shipmentId, order_id: orderId,
      sku: sstr(o.sku).trim(), erp_sku: sstr(o.sku).trim(), qty: 1,
      name_en: sstr(o.product) || null, currency: o.currency || 'CNY', stock_status: 'good',
    });
  }
  if (rows.length) {
    const { error } = await admin.from('shipment_items').insert(rows);
    if (error) console.error(`[${functionName}] shipment_items 落库失败 ${shipmentId}: ${error.message}`);
  }

  // 1 个 parcels：parcel_no 用 batch_no 派生，货代侧回传 parcels[].parcel_no 时能对上
  const { error: pErr } = await admin.from('parcels').insert({
    user_id: userId,
    shipment_id: shipmentId,
    order_id: orderId,                      // parcels.order_id 也是 text（实测）
    parcel_no: `${batchNo}-P1`,
    package_number: `${batchNo}-P1`,
    inbound_status: 'not_inbound',           // NOT NULL DEFAULT 'not_inbound'（实测）
    status: '待打包',
    weight: 0, length: 0, width: 0, height: 0,
    is_headless: false,
  });
  if (pErr) console.error(`[${functionName}] parcels 落库失败 ${shipmentId}: ${pErr.message}`);
}

// =====================================================================
// action = push
// =====================================================================
interface PushResult {
  shipment_id: string;
  order_id?: string;
  batch_no?: string;
  ok: boolean;
  dup?: boolean;
  push_state?: string;
  push_attempt?: number;
  existing_shipment_id?: string;
  state?: string;                            // 命中重复时：既有货件的 push_state
  skipped?: boolean;
  error_code?: string;                       // 一定是 push_error_codes 里的 18 条之一
  error_message?: string;                    // 直接取字典文案，不自造
  http_status?: number;
  tracking_no?: string;
  wms_order_no?: string;
  endpoint?: string;
  duration_ms?: number;
  log_id?: string;
  next_retry_at?: string | null;
  error?: string;                            // 非字典类的硬错误（查库失败等）
}

async function writePushLog(
  admin: Admin,
  row: Record<string, unknown>,
): Promise<string | undefined> {
  const { data, error } = await admin.from('push_logs').insert(row).select('id').single();
  if (error) {
    console.error(`[${functionName}] push_logs 写入失败: ${error.message}`);
    return undefined;
  }
  return sstr((data as { id?: string } | null)?.id) || undefined;
}

/** 从货代响应里挑一个字典错误码（货代给的 code 命中字典就用它，否则 undefined） */
function pickDictCode(codes: Map<string, ErrCodeDef>, payload: unknown): string | undefined {
  const cands: string[] = [];
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const data = (p.data && typeof p.data === 'object') ? p.data as Record<string, unknown> : null;
    for (const src of [p, data ?? {}]) {
      for (const k of ['code', 'errorCode', 'error_code', 'errCode', 'errcode']) {
        const v = sstr(src[k]).trim();
        if (v) cands.push(v.toUpperCase());
      }
    }
  }
  for (const c of cands) if (codes.has(c)) return c;
  return undefined;
}

async function pushShipments(
  admin: Admin,
  userId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const rawIds = Array.isArray(body.shipment_ids) ? body.shipment_ids : [];
  const shipmentIds = [...new Set(rawIds.map((x: unknown) => sstr(x).trim()).filter(Boolean))];
  if (!shipmentIds.length) return { status: 400, body: { error: '缺少 shipment_ids' } };
  if (shipmentIds.length > MAX_BATCH) {
    return { status: 400, body: { error: `单次最多推送 ${MAX_BATCH} 条货件` } };
  }

  const codes = await loadErrorCodes(admin);
  const sw = await loadSwitches(admin, userId);
  const siteUrl = (Deno.env.get('SUPABASE_PUBLIC_URL') || Deno.env.get('SITE_URL') || '').replace(/\/+$/, '');
  const webhookUrl = siteUrl ? `${siteUrl}/functions/v1/forwarder-webhook` : '';

  // 一次请求内复用：授权 / 仓库 / 渠道 / 包裹 / 明细 / 货代名
  const { data: shipmentData, error: shErr } = await admin.from('shipments')
    .select(SHIPMENT_COLS).in('id', shipmentIds);
  if (shErr) return { status: 500, body: { error: `查询货件失败：${shErr.message}` } };
  const shipments = (shipmentData ?? []) as unknown as ShipmentRow[];

  const results: PushResult[] = [];
  let pushed = 0, failed = 0, dup = 0, skipped = 0;

  for (const sid of shipmentIds) {
    const sh = shipments.find((x) => x.id === sid);
    if (!sh) {
      results.push({ shipment_id: sid, ok: false, error: 'SHIPMENT_NOT_FOUND_OR_FORBIDDEN' });
      skipped++;
      continue;
    }
    if (sh.user_id !== userId) {            // 跨租户 id 一律拒绝并回报
      results.push({ shipment_id: sid, ok: false, error: 'SHIPMENT_NOT_FOUND_OR_FORBIDDEN' });
      skipped++;
      continue;
    }

    // 1) 幂等前置：push_is_duplicate(p_user_id, p_batch_no, p_window_hours)
    //    注意 batch_no 为空的老货件不做去重判定（RPC 对空 batch_no 直接返回 duplicate=false）。
    let batchNo = sstr(sh.batch_no).trim();
    if (!batchNo) {
      // 没有幂等键就先补一个（否则"绝不重复外呼"这条根本没有落点）
      batchNo = genBatchNo();
      const { error: uErr } = await admin.from('shipments')
        .update({ batch_no: batchNo, updated_at: nowIso() }).eq('id', sid).eq('user_id', userId);
      if (uErr) console.warn(`[${functionName}] 回填 batch_no 失败 ${sid}: ${uErr.message}`);
    }

    const { data: dupRows, error: dupErr } = await admin.rpc('push_is_duplicate', {
      p_user_id: userId, p_batch_no: batchNo, p_window_hours: sw.dedupe_window_hours,
    });
    if (dupErr) {
      // 幂等判定都查不出来时，宁可不外呼（宁可少推不可重推）
      results.push({ shipment_id: sid, batch_no: batchNo, ok: false, error: `幂等判定失败：${dupErr.message}` });
      skipped++;
      continue;
    }
    const d0 = (Array.isArray(dupRows) ? dupRows[0] : dupRows) as Record<string, unknown> | undefined;
    const dupHit = d0?.duplicate === true;
    const dupShip = sstr(d0?.existing_shipment);
    const dupState = sstr(d0?.existing_status);
    const selfHit = dupHit && dupShip === sid;

    if (dupHit && !selfHit) {
      // 真重复：同一次提交已经有另一条货件在窗口内占了这个 batch_no —— 绝不外呼
      const logId = await writePushLog(admin, {
        user_id: userId, direction: 'out', action: 'create_order', batch_no: batchNo,
        shipment_id: sid, forwarder_id: sh.forwarder_id, warehouse_id: sh.warehouse_id,
        endpoint: null, request_snapshot: { reason: 'duplicate_batch_no', existing_shipment: dupShip },
        response_snapshot: { duplicate: true, existing_shipment: dupShip, existing_status: dupState },
        attempt: Math.max(1, Number(sh.push_attempt) || 0), max_attempts: sw.retry_max,
        status: 'skipped', error_code: CODE_IDEMPOTENT_HIT,
        error_message: codes.get(CODE_IDEMPOTENT_HIT)?.message_cn ?? CODE_IDEMPOTENT_HIT,
        deduped: true, created_by: userId, finished_at: nowIso(),
      });
      dup++;
      results.push({
        shipment_id: sid, order_id: sh.order_id ?? undefined, batch_no: batchNo, ok: false,
        dup: true, existing_shipment_id: dupShip, state: dupState, error_code: CODE_IDEMPOTENT_HIT,
        error_message: codes.get(CODE_IDEMPOTENT_HIT)?.message_cn ?? CODE_IDEMPOTENT_HIT,
        log_id: logId,
      });
      continue;
    }

    if (sh.push_state === 'pushed') {
      // 幂等的真正落点：已成功推过就不再外呼（selfHit 必然为真，见文件头说明）
      const logId = await writePushLog(admin, {
        user_id: userId, direction: 'out', action: 'create_order', batch_no: batchNo,
        shipment_id: sid, forwarder_id: sh.forwarder_id, warehouse_id: sh.warehouse_id,
        request_snapshot: { reason: 'already_pushed' }, response_snapshot: { skipped: true },
        attempt: Math.max(1, Number(sh.push_attempt) || 0), max_attempts: sw.retry_max,
        status: 'skipped', error_code: CODE_IDEMPOTENT_HIT,
        error_message: codes.get(CODE_IDEMPOTENT_HIT)?.message_cn ?? CODE_IDEMPOTENT_HIT,
        deduped: true, created_by: userId, finished_at: nowIso(),
      });
      dup++;
      results.push({
        shipment_id: sid, order_id: sh.order_id ?? undefined, batch_no: batchNo, ok: false,
        dup: true, state: 'pushed', push_state: 'pushed', existing_shipment_id: sid,
        error_code: CODE_IDEMPOTENT_HIT, log_id: logId,
      });
      continue;
    }

    // 铁律2：单据已作废不推单，但不是错误，状态保持原样
    if (sh.doc_status === 'cancelled') {
      skipped++;
      results.push({
        shipment_id: sid, order_id: sh.order_id ?? undefined, batch_no: batchNo, ok: false,
        skipped: true, push_state: sh.push_state, error: 'DOC_CANCELLED：单据已作废，不再推单',
      });
      continue;
    }
    if (!sh.forwarder_id) {
      const def = codes.get(CODE_AUTH_EXPIRED);
      const logId = await writePushLog(admin, {
        user_id: userId, direction: 'out', action: 'create_order', batch_no: batchNo, shipment_id: sid,
        request_snapshot: { reason: 'shipment has no forwarder_id' }, response_snapshot: null,
        attempt: (Number(sh.push_attempt) || 0) + 1, max_attempts: sw.retry_max,
        status: 'failed', error_code: CODE_AUTH_EXPIRED, error_message: def?.message_cn ?? CODE_AUTH_EXPIRED,
        created_by: userId, finished_at: nowIso(),
      });
      await admin.from('shipments').update({
        push_state: 'push_failed', push_attempt: (Number(sh.push_attempt) || 0) + 1,
        // AUTH_EXPIRED 在字典里 retryable=f → 不排下次重试（见 nextRetryAt 注释）
        next_retry_at: nextRetryAt('push_failed', CODE_AUTH_EXPIRED, sw, codes), updated_at: nowIso(),
      }).eq('id', sid).eq('user_id', userId);
      failed++;
      results.push({
        shipment_id: sid, order_id: sh.order_id ?? undefined, batch_no: batchNo, ok: false,
        push_state: 'push_failed', error_code: CODE_AUTH_EXPIRED,
        error_message: def?.message_cn ?? CODE_AUTH_EXPIRED, log_id: logId,
      });
      continue;
    }

    // 渠道已停用 → 不外呼（业务码 CH_DISABLED 明确"不重试"，重试也只会白打）
    if (sh.channel_id) {
      const { data: ch } = await admin.from('logistics_channels')
        .select('id, code, name, carrier, is_active, deleted_at, label_source_default, platform_carrier')
        .eq('id', sh.channel_id).eq('user_id', userId).maybeSingle();
      if (ch && (ch.is_active === false || sstr(ch.deleted_at))) {
        const def = codes.get(CODE_CH_DISABLED);
        const nextAttempt = (Number(sh.push_attempt) || 0) + 1;
        const logId = await writePushLog(admin, {
          user_id: userId, direction: 'out', action: 'create_order', batch_no: batchNo, shipment_id: sid,
          forwarder_id: sh.forwarder_id, warehouse_id: sh.warehouse_id,
          request_snapshot: { reason: 'channel inactive', channel_id: sh.channel_id },
          response_snapshot: null, attempt: nextAttempt, max_attempts: sw.retry_max,
          status: nextAttempt > sw.retry_max ? 'dead' : 'failed', error_code: CODE_CH_DISABLED,
          error_message: def?.message_cn ?? CODE_CH_DISABLED, created_by: userId, finished_at: nowIso(),
        });
        await admin.from('shipments').update({
          push_state: nextAttempt > sw.retry_max ? 'dead' : 'push_failed',
          push_attempt: nextAttempt,
          next_retry_at: nextRetryAt(nextAttempt > sw.retry_max ? 'dead' : 'push_failed', CODE_CH_DISABLED, sw, codes),
          updated_at: nowIso(),
        }).eq('id', sid).eq('user_id', userId);
        failed++;
        results.push({
          shipment_id: sid, order_id: sh.order_id ?? undefined, batch_no: batchNo, ok: false,
          push_state: nextAttempt > sw.retry_max ? 'dead' : 'push_failed', error_code: CODE_CH_DISABLED,
          error_message: def?.message_cn ?? CODE_CH_DISABLED, log_id: logId,
        });
        continue;
      }
    }

    // 2) 取授权：forwarder_auths 里 auth_state='approved' 的一条（契约）
    // 实测列清单（information_schema 核对，forwarder_auths 共 22 列）：这里只 select 用得上的，
    // 特别注意：本表没有 endpoint_url 列（契约描述与库不符，见文件头与交付报告）。
    const { data: authRows, error: authErr } = await admin.from('forwarder_auths')
      .select('id, protocol, provider, auth_state, available_state, unavailable_reason, push_enabled, credentials_enc, webhook_secret_enc, app_key, callback_url, expires_at')
      .eq('user_id', userId).eq('forwarder_id', sh.forwarder_id).eq('auth_state', 'approved')
      .order('created_at', { ascending: false }).limit(1);
    if (authErr) {
      results.push({ shipment_id: sid, ok: false, error: `查询货代授权失败：${authErr.message}` });
      skipped++;
      continue;
    }
    const auth = (authRows ?? [])[0] as Record<string, unknown> | undefined;

    const attempt = (Number(sh.push_attempt) || 0) + 1;

    // 「本地就已经没法外呼」的三个分支（无授权 / 无端点 / 无签名密钥）动作完全一致：
    // 写 push_logs + 回写 push_state/push_attempt/next_retry_at + 记一条结果。
    // 只在本次循环内部复用，不做全局抽象。任何一条都不碰 stage（铁律1）。
    const failPreCall = async (code: string, reason: Record<string, unknown>, ep = ''): Promise<PushResult> => {
      const def = codes.get(code);
      const state = attempt > sw.retry_max ? 'dead' : 'push_failed';
      const retryAt = nextRetryAt(state, code, sw, codes);
      const logId = await writePushLog(admin, {
        user_id: userId, direction: 'out', action: 'create_order', batch_no: batchNo, shipment_id: sid,
        forwarder_id: sh.forwarder_id, warehouse_id: sh.warehouse_id, endpoint: ep || null,
        request_snapshot: { failure_stage: 'pre_call', ...reason }, response_snapshot: null,
        attempt, max_attempts: sw.retry_max, next_retry_at: retryAt,
        status: state === 'dead' ? 'dead' : 'failed',
        error_code: code, error_message: def?.message_cn ?? code,
        deduped: false, created_by: userId, finished_at: nowIso(),
      });
      const { error: upErr } = await admin.from('shipments').update({
        push_state: state, push_attempt: attempt, next_retry_at: retryAt, updated_at: nowIso(),
      }).eq('id', sid).eq('user_id', userId);
      if (upErr) console.error(`[${functionName}] 失败态回写异常 ${sid}: ${upErr.message}`);
      failed++;
      return {
        shipment_id: sid, order_id: sh.order_id ?? undefined, batch_no: batchNo, ok: false,
        push_state: state, error_code: code, error_message: def?.message_cn ?? code,
        push_attempt: attempt, endpoint: ep || undefined, next_retry_at: retryAt, log_id: logId,
      };
    };

    if (!auth) {
      results.push(await failPreCall(CODE_AUTH_EXPIRED,
        { reason: 'no forwarder_auths row with auth_state=approved', forwarder_id: sh.forwarder_id }));
      continue;
    }

    // 3.1) 授权行上的三个租户级闸门（这三列 fw01 就建好了，契约没提，但不拦就是白名单失效）
    //   · push_enabled=false      → 租户自己把这家货代的推单开关关了（fulfillment_switches 之外的逐货代开关）。
    //   · available_state=unavailable → 连通性探测已判定不可用；available / unknown 放行，
    //       unknown 只表示"还没探测过"，推单本身就是最权威的探测，不能因为没探测过就永久拦死链路。
    //   · expires_at < now        → 授权到期，语义与"没有 approved 授权"一致，用同一个码。
    //   三者都不外呼、都不改 stage（铁律1），统一走 failPreCall：写 push_logs + 回写 push_state/push_attempt。
    if (sstr(auth.push_enabled) === 'false') {
      results.push(await failPreCall(CODE_CH_DISABLED,
        { reason: 'forwarder_auths.push_enabled=false（该货代的推单开关已被关闭）', auth_id: sstr(auth.id) }, ''));
      continue;
    }
    if (sstr(auth.available_state) === 'unavailable') {
      results.push(await failPreCall(CODE_CH_DISABLED,
        { reason: 'forwarder_auths.available_state=unavailable', unavailable_reason: sstr(auth.unavailable_reason), auth_id: sstr(auth.id) }, ''));
      continue;
    }
    const authExpiresAt = sstr(auth.expires_at);
    if (authExpiresAt && Number.isFinite(Date.parse(authExpiresAt)) && Date.parse(authExpiresAt) < Date.now()) {
      results.push(await failPreCall(CODE_AUTH_EXPIRED,
        { reason: 'forwarder auth expired', expires_at: authExpiresAt, auth_id: sstr(auth.id) }, ''));
      continue;
    }

    const authId = sstr(auth.id);
    // 2.5) 适配器分派：目前只有 TFOP-1（我方开放协议）有实现。
    //      provider='huoxiaoyi'（货小易商家端，如慧航货运）走的是对方的授权码/AppKey 体系，
    //      签名串、字段名、状态码枚举、回推格式全部不同 → 在 HTTP 之前直接失败，
    //      免得对方只回一句"sign error"让人猜半天。适配器写好后在这里加一条分支即可。
    const provider = sstr(auth.provider) || 'tfop1';
    if (provider !== 'tfop1') {
      results.push(await failPreCall(CODE_PROVIDER_UNSUPPORTED,
        { reason: 'no push adapter implemented for provider', provider: provider, auth_id: authId }, ''));
      continue;
    }

    const creds = await decryptCreds(sstr(auth.credentials_enc));
    // 契约写"读 endpoint_url"，但 forwarder_auths 实测没有 endpoint_url 列（只有 callback_url / app_key /
    // credentials_enc / webhook_secret_enc）→ 端点从解密后的凭据对象里取（这是唯一不新增生产列的做法）。
    const endpoint = pick(creds, ['endpoint_url', 'push_endpoint_url', 'endpoint', 'api_base_url'])
      || sstr(auth.callback_url);
    if (!endpoint || !/^https?:\/\//i.test(endpoint)) {
      results.push(await failPreCall(CODE_AUTH_EXPIRED,
        { reason: 'forwarder auth has no usable endpoint_url in credentials', auth_id: authId }, endpoint));
      continue;
    }

    const signSecret = pick(creds, ['push_secret', 'signing_secret', 'webhook_secret', 'secret', 'app_secret'])
      || (await decryptSecretText(sstr(auth.webhook_secret_enc)));
    if (!signSecret) {
      results.push(await failPreCall(CODE_AUTH_EXPIRED,
        { reason: 'no signing secret in credentials / webhook_secret_enc', auth_id: authId }, endpoint));
      continue;
    }

    // 3) 组装载荷（DESIGN §4.1 的对外字段名；面单来源/仓库 code/收件地址/回传 url 按契约必带）
    const [{ data: orderData }, { data: whData }, { data: chData }, { data: parcelRows },
      { data: itemRows }, { data: fwdData }] = await Promise.all([
      sh.order_id
        ? admin.from('orders').select(ORDER_COLS).eq('id', sh.order_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sh.warehouse_id
        ? admin.from('forwarder_warehouses').select('id, code, name').eq('id', sh.warehouse_id).maybeSingle()
        : Promise.resolve({ data: null }),
      sh.channel_id
        ? admin.from('logistics_channels').select('id, code, name, carrier, platform_carrier').eq('id', sh.channel_id).maybeSingle()
        : Promise.resolve({ data: null }),
      admin.from('parcels').select('id, parcel_no, package_number, weight, length, width, height, inbound_tracking_no')
        .eq('shipment_id', sid).eq('user_id', userId).order('created_at', { ascending: true }),
      admin.from('shipment_items').select('sku, erp_sku, external_sku, qty, name_cn, name_en, hs_code, unit_price, amount, weight_g, currency')
        .eq('shipment_id', sid).eq('user_id', userId).order('created_at', { ascending: true }),
      admin.from('freight_forwarders').select('id, name, code').eq('id', sstr(sh.forwarder_id)).maybeSingle(),
    ]);
    const ord = (orderData ?? null) as OrderRow | null;
    const wh = (whData ?? null) as Record<string, unknown> | null;
    const chn = (chData ?? null) as Record<string, unknown> | null;
    const parcels = (parcelRows ?? []) as Record<string, unknown>[];
    const items = (itemRows ?? []) as Record<string, unknown>[];
    const fwdName = sstr((fwdData as Record<string, unknown> | null)?.name);

    const payload = {
      batchNo: batchNo,
      onlineOrderId: sh.order_id,
      platform: sh.platform ?? (ord ? ord.channel : null),
      site: sh.site ?? null,
      shopName: ord ? ord.shop_name : null,
      platformOrderNo: sh.platform_order_no ?? (ord ? ord.external_order_id : null),
      warehouseCode: sstr(wh?.code) || null,        // 对外契约字段：必须与对方系统仓库 code 字面一致
      warehouseName: sstr(wh?.name) || null,
      channelCode: sstr(chn?.code) || null,
      carrierName: sstr(chn?.carrier) || null,
      labelSource: (sh.label_source || 'api').toUpperCase(),  // DESIGN §4.1 用大写枚举
      labelState: sh.label_state,
      domesticTrackingOwner: (sh.domestic_tracking_owner || 'transit_system').toUpperCase(),
      shipmentKind: sh.shipment_kind,
      currency: sh.fee_currency || 'CNY',
      receiver: {
        name: ord ? sstr(ord.buyer) : '', phone: ord ? sstr(ord.phone) : '',
        address: sstr(sh.destination) || (ord ? sstr(ord.address) : ''),
      },
      items: items.map((it) => ({
        sku: sstr(it.sku), erpSku: sstr(it.erp_sku) || sstr(it.sku), externalSku: sstr(it.external_sku) || null,
        quantity: snum(it.qty) ?? 1, amount: snum(it.amount), unitPrice: snum(it.unit_price),
        hsCode: sstr(it.hs_code) || null, nameCn: sstr(it.name_cn) || null, nameEn: sstr(it.name_en) || null,
        weightG: snum(it.weight_g), currency: sstr(it.currency) || 'CNY',
      })),
      parcels: parcels.map((p) => ({
        packageNumber: sstr(p.parcel_no) || sstr(p.package_number) || null,
        l: snum(p.length) ?? 0, w: snum(p.width) ?? 0, h: snum(p.height) ?? 0,
        weightG: snum(p.weight) ?? 0, inboundTrackingNo: sstr(p.inbound_tracking_no) || null,
      })),
      // 回传锚点：货代必须原样带 batchNo 回来，并在 X-Thalvior-Forwarder-Auth 里带上这个 authId
      callback: { webhookUrl, batchNo, authId },
    };
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Date.now());
    // 签名原文 = timestamp + "." + raw_body（与 forwarder-webhook 校验完全一致，改一边就两边炸）
    const signature = await hmacHex(signSecret, `${timestamp}.${rawBody}`);

    await admin.from('shipments')
      .update({ push_state: 'pending', updated_at: nowIso() }).eq('id', sid).eq('user_id', userId);

    const startedAt = Date.now();
    let httpStatus = 0;
    let respPayload: unknown = null;
    let respText = '';
    let netError = '';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Accept-Encoding': 'identity',   // 实测坑：edge runtime fetch 不解压 gzip
            'X-Thalvior-Timestamp': timestamp,
            'X-Thalvior-Signature': signature,
            'X-Thalvior-Batch-No': batchNo,
            'X-Thalvior-Forwarder-Auth': authId,
          },
          body: rawBody,
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      httpStatus = res.status;
      respText = await res.text();
      try { respPayload = respText ? JSON.parse(respText) : null; } catch { respPayload = { raw: trunc(respText, 1200) }; }
    } catch (e) {
      netError = e instanceof Error ? e.message : String(e);
    }
    const durationMs = Date.now() - startedAt;

    const ok2xx = httpStatus >= 200 && httpStatus < 300 && !netError;
    // 快照里绝不留密钥/签名原文（只存 payload + 头名，signature/secret 一律不写）
    const reqSnapshot = {
      endpoint, headers: { 'X-Thalvior-Timestamp': timestamp, 'X-Thalvior-Batch-No': batchNo, 'X-Thalvior-Forwarder-Auth': authId, 'X-Thalvior-Signature': `${signature.slice(0, 12)}…(hmac, 截断存储)` },
      body: payload,
    };
    const respSnapshot = {
      http_status: ok2xx ? httpStatus : (httpStatus || 0),
      network_error: netError || null,
      duration_ms: durationMs,
      body: typeof respPayload === 'object' ? respPayload : { raw: trunc(String(respPayload), 1200) },
    };

    // 4) 结果落库
    let nextState: string;
    let statusCode: string;
    let errCode: string | null = null;
    let errMsg: string | null = null;
    let nextRetry: string | null = null;
    if (ok2xx) {
      nextState = 'pushed';
      statusCode = 'success';
    } else {
      nextState = attempt > sw.retry_max ? 'dead' : 'push_failed';
      statusCode = nextState === 'dead' ? 'dead' : 'failed';
      if (netError) {
        errCode = CODE_WMS_TIMEOUT;
      } else if (httpStatus === 401 || httpStatus === 403) {
        errCode = CODE_AUTH_EXPIRED;
      } else if (httpStatus === 402) {
        errCode = CODE_BALANCE_LOW;
      } else if (httpStatus === 409) {
        errCode = CODE_IDEMPOTENT_HIT;
      } else {
        errCode = pickDictCode(codes, respPayload) ?? CODE_WMS_TIMEOUT;
      }
      errMsg = codes.get(errCode)?.message_cn ?? errCode;
      nextRetry = nextRetryAt(nextState, errCode, sw, codes);
    }

    const update: Record<string, unknown> = {
      push_state: nextState, push_attempt: attempt, next_retry_at: nextRetry, updated_at: nowIso(),
    };
    if (ok2xx) {
      update.pushed_at = nowIso();
      // 响应里给了跟踪号/货代单号就回填（大小写都收，取不到就不动原值）
      const rp = (respPayload ?? {}) as Record<string, unknown>;
      const rpd = (rp.data && typeof rp.data === 'object') ? rp.data as Record<string, unknown> : {};
      const tn = pick(rp, ['tracking_no', 'trackingNo', 'trackingNumber']) || pick(rpd, ['tracking_no', 'trackingNo', 'trackingNumber']);
      const wms = pick(rp, ['wms_order_no', 'wmsOrderNo', 'order_no']) || pick(rpd, ['wms_order_no', 'wmsOrderNo', 'orderNo', 'order_no']);
      const carrier = pick(rp, ['carrier', 'carrierName', 'carrier_name']) || pick(rpd, ['carrier', 'carrierName', 'carrier_name']);
      if (tn) update.tracking_no = tn;
      if (wms) update.wms_order_no = wms;
      if (carrier && !sstr(sh.carrier)) update.carrier = carrier;
      // 面单已在货代侧生成 → label_state 从 none 进 requested 没有意义，这里只补一句事件，
      // 让"推单成功"在货件时间线上可见（stage 一个字节都不动，铁律1）。
      try {
        await admin.from('shipment_status_events').insert({
          user_id: userId, shipment_id: sid, raw_status: 'ERP:pushed', norm_status: 'sending',
          stage: sh.stage, tracking_no: tn ? String(tn) : null, carrier_name: carrier ? String(carrier) : null,
          operator: `${fwdName || 'forwarder'}(${authId})`, source: 'system',
          payload: { batch_no: batchNo, http_status: httpStatus, wms_order_no: wms || null, duration_ms: durationMs },
          occurred_at: nowIso(),
        });
      } catch (e) {
        console.warn(`[${functionName}] 推单成功事件写入失败（不影响推单结果）: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const { error: upErr } = await admin.from('shipments').update(update).eq('id', sid).eq('user_id', userId);
    if (upErr) console.error(`[${functionName}] 推单状态回写失败 ${sid}: ${upErr.message}`);

    const logId = await writePushLog(admin, {
      user_id: userId, direction: 'out', action: 'create_order', batch_no: batchNo, shipment_id: sid,
      forwarder_id: sh.forwarder_id, warehouse_id: sh.warehouse_id, endpoint,
      request_snapshot: reqSnapshot, response_snapshot: respSnapshot,
      attempt, max_attempts: sw.retry_max, next_retry_at: nextRetry, status: statusCode,
      error_code: errCode, error_message: errMsg, duration_ms: durationMs,
      deduped: false, created_by: userId, created_at: nowIso(), finished_at: nowIso(),
    });

    pushed += ok2xx ? 1 : 0;
    failed += ok2xx ? 0 : 1;
    results.push({
      shipment_id: sid, order_id: sh.order_id ?? undefined, batch_no: batchNo, ok: ok2xx,
      push_state: nextState, push_attempt: attempt, http_status: httpStatus || undefined,
      error_code: errCode ?? undefined, error_message: errMsg ?? undefined,
      tracking_no: sstr(update.tracking_no) || undefined, wms_order_no: sstr(update.wms_order_no) || undefined,
      endpoint, duration_ms: durationMs, next_retry_at: nextRetry, log_id: logId,
    });
  }

  return {
    status: 200,
    body: { ok: true, total: shipmentIds.length, pushed, failed, dup, skipped, retry_max: sw.retry_max, results },
  };
}

// =====================================================================
// action = list-logs —— 该货件的 push_logs 倒序 ≤50 条
// =====================================================================
async function listLogs(
  admin: Admin,
  userId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const shipmentId = sstr(body.shipment_id).trim();
  if (!shipmentId) return { status: 400, body: { error: '缺少 shipment_id' } };
  const { data: sh } = await admin.from('shipments').select('id, batch_no, push_state, stage')
    .eq('id', shipmentId).eq('user_id', userId).maybeSingle();
  if (!sh) return { status: 403, body: { error: 'SHIPMENT_NOT_FOUND_OR_FORBIDDEN' } };
  const { data, error } = await admin.from('push_logs')
    .select('id, direction, action, batch_no, shipment_id, forwarder_id, warehouse_id, endpoint,'
      + ' request_snapshot, response_snapshot, attempt, max_attempts, next_retry_at, status,'
      + ' error_code, error_message, duration_ms, deduped, created_by, created_at, finished_at')
    .eq('shipment_id', shipmentId).eq('user_id', userId)
    .order('created_at', { ascending: false }).limit(50);
  if (error) return { status: 500, body: { error: `查询推单日志失败：${error.message}` } };
  return { status: 200, body: { ok: true, shipment_id: shipmentId, total: (data ?? []).length, logs: data ?? [] } };
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    if (req.method !== 'POST') return json({ error: '仅支持 POST 请求' }, 405);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = sstr(body.action);

    const userId = await resolveUserId(req);
    if (!userId) return json({ error: '未登录或登录已过期' }, 401);

    // 权限闸门（fail-closed，全部在业务逻辑之前）
    const need = action === 'create_from_orders'
      ? ['logistics.shipment.view', 'logistics.push.push']
      : action === 'push'
        ? ['logistics.push.push']
        : action === 'list-logs'
          ? ['logistics.push.view']
          : [];
    if (!need.length) return json({ error: `未知 action: ${action}` }, 400);
    for (const key of need) {
      const gate = await checkPerm(req, key);
      if (!gate.allowed) {
        console.warn(`[${functionName}] ${requestId} 权限拒绝 perm=${key} reason=${gate.error ?? 'denied'}`);
        return json({ error: `权限不足：${key}`, perm_key: key }, 403);
      }
    }

    const admin = adminClient();
    let r: { status: number; body: Record<string, unknown> };
    if (action === 'create_from_orders') r = await createFromOrders(admin, userId, body);
    else if (action === 'push') r = await pushShipments(admin, userId, body);
    else r = await listLogs(admin, userId, body);

    console.info(`[${functionName}] ${requestId} action=${action} → ${r.status}`);
    return json(r.body, r.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
