// forwarder-webhook — 货代 → ERP 回传入口（M2 履约链路：订单 → 货件 → 推单 → 回传）
// =====================================================================
// 契约（主会话已定死，字段名不得改动）：
//   POST，**不带用户 JWT**；鉴权只认 HMAC，密钥取 X-Thalvior-Forwarder-Auth 指向的那条 forwarder_auths。
//   必带：X-Thalvior-Timestamp（毫秒）、X-Thalvior-Signature = hex(hmac_sha256(secret, timestamp + "." + raw_body))
//   防重放窗口 ±5 分钟；鉴权失败一律 401/403，**绝不回显密钥或期望签名**。
//   入参：{batch_no?, shipment_no?, event:{stage?, raw_status?, tracking_no?, carrier?, reason?,
//          parcels?[{parcel_no,inbound_status?,weight_g?,length?,width?,height?}],
//          fees?[{fee_type,amount,currency?,weight_charged_g?,weight_declared_g?,charge_unit?,charge_qty?}],
//          intercept_result?:'succeeded'|'failed'}}
//   出参：{ok:true, shipment_id, applied:[...], rejected:[{field,reason}], work_orders:[...]}
//
// 为什么每条规则都按顺序落在这份代码里（DESIGN §2 三条竞品铁律）：
//   铁律1「规则命中 ≠ 执行成功」：本函数只动 stage / raw_status / tracking_no / carrier / intercept_state /
//        actual_amount，**永远不因为"货代说到了某一步"就顺手改 push_state**，也不改 orders.status。
//   铁律2「作业阶段与单据有效性分离」：intercept_result 先经 RPC 落 intercept_state + doc_status（单据有效性），
//        之后才处理 stage（作业进度），两者互不覆盖。
//   铁律3「异常走工单，不塞进订单状态」：stage 跳转非法时**不强改 stage**，改为开 work_orders 工单，
//        并把发现时所处阶段写进 work_orders.stage_when_detected（该列的注释语义就是"决定能否回退"）。
//        货代的口头解释不进状态机，只进工单描述与事件 payload。
//
// 为什么鉴权不用 checkPerm：
//   调用方是货代系统，不是登录用户，没有 JWT。这里的"权限"= 持有该 auth 的 HMAC 密钥 + 时间戳在窗口内。
//   但**租户隔离仍然必须自己做**：service_role 在库里 rolbypassrls=true、RLS 完全不生效，
//   所以本函数把"这条 auth 属于哪个 user_id"当成租户边界，之后每一条读写都带 .eq('user_id', userId)。
//   跨租户的 batch_no / shipment_no / parcel_no 一律查不到 → 按契约回 404，不透露存在性。
//
// 与契约的已知偏差（都写进了交付报告，没有静默改）：
//   · shipments 实测**没有 shipment_no 列**（56 列全查过）。回传定位按 DESIGN §4.2 的锚点字段
//     batchNo / wmsOrderNo 实现：shipment_no → 匹配 shipments.wms_order_no。
//   · event 里没有 occurred_at/status(规范化状态) 字段，但 shipment_status_events.norm_status 是 NOT NULL，
//     所以本函数按显式字段推导 norm_status（见 deriveNormStatus），并把对方原文整体存进 payload。
//   · DESIGN §4.2 要求"同 batchNo+rawStatus+occurredAt 重复提交不产生第二条事件"（否则账单行会重复入账），
//     这里用 事件体哈希 做幂等：命中就 replay=true 直接返回，不再改任何业务数据。
//   · 除契约要求的 shipment_status_events 外，另外补写一条 push_logs(direction='in') —— push_logs 的
//     direction CHECK 本来就有 'in'，回传审计放这里才对得上 list-logs；不写业务状态。
//   · 契约没提"跨货代"这条边界，本函数加了一道 forwarder_id 对齐（对不上回同样的 404）：
//     同租户接了好几个货代时，A 家的密钥能改 B 家的货件属于越权，不能靠"对方不会乱发"假设。
//   · 契约说 auth_state='approved' 才可用于推单（forwarder-push 照做），但同一个 CHECK 里还有
//     'authorized' 这一档（实测 7 值）。回传侧我不按 auth_state 放行/拦截，只拒 revoked/expired：
//     对方密钥是对的却因状态档位被拒，会让人以为我们在丢回调，排查成本太高 —— 这一条留给主会话定夺。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { decrypt as vaultDecrypt } from '../_shared/secret-vault.ts';

const functionName = 'forwarder-webhook';
const REPLAY_WINDOW_MS = 5 * 60 * 1000;   // 契约：±5 分钟
const MAX_BODY_BYTES = 1_000_000;         // 1MB 上限：回传体再大也不该有，挡一下无脑灌包
const MAX_ITEMS = 200;                    // parcels / fees 单次上限，防止一个回调灌几万行账单

// ─── 实测枚举域（全部来自 pg_constraint 的 CHECK，不靠记忆） ─────────
// shipments_stage_ck / parcels_inbound_status_ck / billing_lines_fee_type_ck /
// billing_lines_charge_unit_ck / sse_norm_status_ck
const STAGES = ['wait_inbound', 'received', 'ready_pack', 'label_ready', 'picking', 'packed', 'handover', 'shipped', 'closed'];
const INBOUND_STATUSES = ['not_inbound', 'in_transit', 'signed', 'partial_signed', 'rejected', 'lost'];
const FEE_TYPES = ['handling', 'domestic_freight', 'intl_freight', 'packaging', 'storage', 'duty',
  'volumetric_diff', 'surcharge', 'vas', 'return_fee', 'insurance', 'adjustment'];
const CHARGE_UNITS = ['piece', 'order', 'kg', 'cbm', 'manhour', 'flat'];

// ─── 通用工具 ────────────────────────────────────────────────────────
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

/** 时间字段安全转换：非法/缺失 → null（绝不因为对方时间格式就把整条回调打回去）。 */
function isoOrNull(v: unknown): string | null {
  const t = sstr(v).trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── 凭据解密（与 forwarder-push 同一套口径，两边必须一致） ─────────
// fw01 列注释：AES-256-GCM / PBKDF2 100000 / SHA-256，盐 thalvior-cred-v1，secret=JWT_SECRET，
// 布局 base64(iv12 || ct || tag16)；_shared/secret-vault.ts 是另一套（SECRET_MASTER_KEY + v1:<iv>:<ct>）。
async function decryptLegacyB64(encB64: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const bin = atob(encB64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  const iv = raw.slice(0, 12);
  const cipher = raw.slice(12);
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

async function decryptSecretText(enc: string): Promise<string> {
  const v = sstr(enc).trim();
  if (!v) return '';
  if (/^v\d+:/.test(v)) {
    try { return await vaultDecrypt(v); } catch { return v; }
  }
  try {
    return await decryptLegacyB64(v, getEnv('JWT_SECRET'));
  } catch {
    return v;
  }
}

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

function pick(obj: Record<string, unknown> | null, keys: string[]): string {
  if (!obj) return '';
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return '';
}

// ─── HMAC / SHA-256 ─────────────────────────────────────────────────
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return toHex(new Uint8Array(sig));
}

async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * 定长比较（不提前返回）。
 * 为什么不用 ===：签名校验走短路比较会随前缀正确程度改变耗时，是教科书级的计时侧信道；
 * 这里对方是外部系统，日志与耗时都可能被观察，所以老老实实做等长扫描。
 * 长度不同直接判失败（长度本身不泄露密钥内容）。
 */
function safeEqualHex(a: string, b: string): boolean {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ─── 行类型（只声明用到的列，全部经 information_schema 核对） ────────
interface AuthRow {
  id: string; user_id: string | null; forwarder_id: string | null; protocol: string;
  auth_state: string; available_state: string; push_enabled: boolean | null;
  webhook_secret_enc: string | null; credentials_enc: string | null; app_key: string | null;
}

interface ShipmentRow {
  id: string; user_id: string | null; order_id: string | null; forwarder_id: string | null;
  warehouse_id: string | null; channel_id: string | null; batch_no: string | null;
  wms_order_no: string | null; push_state: string; stage: string; doc_status: string;
  norm_status: string; raw_status: string | null; tracking_no: string | null; carrier: string | null;
  intercept_state: string; actual_amount: number | string | null; fee_currency: string;
  declared_weight_g: number | string | null; charged_weight_g: number | string | null;
}

const SHIPMENT_COLS = 'id, user_id, order_id, forwarder_id, warehouse_id, channel_id, batch_no,'
  + ' wms_order_no, push_state, stage, doc_status, norm_status, raw_status, tracking_no, carrier,'
  + ' intercept_state, actual_amount, fee_currency, declared_weight_g, charged_weight_g';

// ─── 结果收集器 ─────────────────────────────────────────────────────
interface Rejected { field: string; reason: string }
interface WorkOrderRef { id: string; type: string; title: string; stage_when_detected: string | null }

interface Collector {
  applied: string[];
  rejected: Rejected[];
  workOrders: WorkOrderRef[];
  events: string[];
  notes: Record<string, unknown>;
  apply(label: string): void;
  reject(field: string, reason: string): void;
}

function newCollector(): Collector {
  const applied: string[] = [];
  const rejected: Rejected[] = [];
  const workOrders: WorkOrderRef[] = [];
  const events: string[] = [];
  const notes: Record<string, unknown> = {};
  return {
    applied, rejected, workOrders, events, notes,
    apply: (label: string) => { applied.push(label); },
    // rejected 永远带 field：契约出参就是 [{field, reason}]，调用方据此决定要不要重发某个字段
    reject: (field: string, reason: string) => { rejected.push({ field, reason }); },
  };
}

// =====================================================================
// 定位货件：batch_no 优先，其次 shipment_no（实测映射到 wms_order_no）
// =====================================================================
async function locateShipment(
  admin: Admin,
  userId: string,
  batchNo: string,
  shipmentNo: string,
): Promise<{ sh?: ShipmentRow; ambiguity?: string }> {
  if (batchNo) {
    // (user_id, batch_no) 有唯一索引 shipments_user_batch_key，租户内不会撞
    const { data, error } = await admin.from('shipments')
      .select(SHIPMENT_COLS).eq('user_id', userId).eq('batch_no', batchNo).maybeSingle();
    if (error) throw new Error(`查询货件失败：${error.message}`);
    if (data) return { sh: data as unknown as ShipmentRow };
  }
  if (shipmentNo) {
    // shipments 没有 shipment_no 列 → 按 DESIGN §4.2 的 wmsOrderNo 锚点匹配 wms_order_no。
    // wms_order_no 无唯一约束，所以取最新一条并如实回报歧义（宁可标注也不悄悄挑一条）。
    const { data, error } = await admin.from('shipments')
      .select(SHIPMENT_COLS).eq('user_id', userId).eq('wms_order_no', shipmentNo)
      .order('created_at', { ascending: false }).limit(2);
    if (error) throw new Error(`查询货件失败：${error.message}`);
    const rows = (data ?? []) as unknown as ShipmentRow[];
    if (rows.length) {
      return {
        sh: rows[0],
        ambiguity: rows.length > 1 ? `wms_order_no=${shipmentNo} 命中 ${rows.length} 条，按 created_at 最新处理` : undefined,
      };
    }
  }
  return {};
}

// =====================================================================
// 规范化状态推导：event 里没有 status 字段，但 sse.norm_status NOT NULL
//   优先级：拦截成功 → cancel；给了 reason → failed；给了 tracking_no → success；否则 sending
//   依据 shipments_norm_status_ck / sse_norm_status_ck 实测 4 值，
//   且必须满足 sse_field_completeness_ck：success⇒tracking_no 非空、failed⇒failed_reason 非空。
// =====================================================================
function deriveNormStatus(
  opts: { interceptSucceeded: boolean; reason: string; trackingNo: string },
): { norm: string; failed_reason: string | null } {
  if (opts.interceptSucceeded) return { norm: 'cancel', failed_reason: opts.reason || null };
  if (opts.reason) return { norm: 'failed', failed_reason: trunc(opts.reason, 500) };
  if (opts.trackingNo) return { norm: 'success', failed_reason: null };
  return { norm: 'sending', failed_reason: null };
}

/**
 * 把对方 event 原样收进 jsonb，但控制在 12000 字符以内。
 * 为什么不用 JSON.parse(trunc(JSON.stringify(...)))：截断会砍出半个 JSON，parse 直接抛异常，
 * 而这里是"业务已经落库、只剩写审计事件"的位置，抛出去就变成 500，对方会当成失败重发 → 重复入账。
 */
function shrinkEvent(event: Record<string, unknown>): Record<string, unknown> {
  const text = JSON.stringify(event);
  if (text.length <= 12000) return event;
  const preview: Record<string, unknown> = { _truncated: true, _original_length: text.length };
  for (const k of Object.keys(event)) {
    const v = event[k];
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    preview[k] = s.length > 300 ? `${s.slice(0, 300)}…` : v;
  }
  return preview;
}

// =====================================================================
// 事件写入：每一个被采纳的动作都要留痕（契约），这里一次回调写一条汇总事件，
// 外加 RPC（shipment_advance / shipment_set_intercept_result）自己写的那条系统事件。
// 为什么不每个字段写一条：回传是一个业务动作，拆成 5 条会把货件时间线冲淡，
// 而且 payload 里已经有 applied/rejected 的逐项明细，信息量不减。
// =====================================================================
async function writeStatusEvent(
  admin: Admin,
  userId: string,
  shipmentId: string,
  args: {
    rawStatus: string | null;
    stage: string | null;
    trackingNo: string | null;
    carrierName: string | null;
    norm: string;
    failedReason: string | null;
    operator: string;
    occurredAt: string | null;
    payload: Record<string, unknown>;
  },
): Promise<string | undefined> {
  const { data, error } = await admin.from('shipment_status_events').insert({
    user_id: userId,
    shipment_id: shipmentId,
    raw_status: args.rawStatus,
    norm_status: args.norm,
    stage: args.stage,
    tracking_no: args.trackingNo,
    carrier_name: args.carrierName,
    failed_reason: args.failedReason,
    operator: args.operator,
    occurred_at: args.occurredAt ?? nowIso(),
    source: 'webhook',                 // sse_source_ck 实测含 webhook
    payload: args.payload,
  }).select('id').single();
  if (error) {
    console.error(`[${functionName}] shipment_status_events 写入失败: ${error.message}`);
    return undefined;
  }
  return sstr((data as { id?: string } | null)?.id) || undefined;
}

// =====================================================================
// 规则 1：intercept_result（最先处理 —— 铁律2：单据有效性优先于作业进度）
// =====================================================================
async function applyIntercept(
  out: Collector,
  admin: Admin,
  shipmentId: string,
  result: string,
  note: string,
): Promise<{ ok: boolean; succeeded: boolean; docStatus?: string; interceptState?: string }> {
  if (result !== 'succeeded' && result !== 'failed') {
    out.reject('event.intercept_result', `只允许 succeeded / failed，收到 ${JSON.stringify(result)}`);
    return { ok: false, succeeded: false };
  }
  // RPC 参数名必须逐字对上（PostgREST 按参数名解析，写错就是 404 PGRST202）：
  // shipment_set_intercept_result(p_shipment_id uuid, p_result text, p_by uuid DEFAULT NULL, p_note text DEFAULT NULL)
  // 返回 TABLE(ok, message, doc_status, intercept_state) → 一定是数组，取 [0]
  const { data, error } = await admin.rpc('shipment_set_intercept_result', {
    p_shipment_id: shipmentId, p_result: result, p_by: null, p_note: note,
  });
  if (error) {
    out.reject('event.intercept_result', `RPC 调用失败：${error.message}`);
    return { ok: false, succeeded: false };
  }
  const rows = Array.isArray(data) ? data : [data];
  const r0 = (rows[0] ?? {}) as Record<string, unknown>;
  if (r0.ok !== true) {
    // 实测：intercept_state<>'requested' 或单据已作废时 RPC 返回 ok=false。
    // 这不是"非法"到要开工单的程度，只是回执乱序/重复 → 记 rejected，状态一个字节都不动。
    out.reject('event.intercept_result', sstr(r0.message) || 'RPC 拒绝');
    return { ok: false, succeeded: false };
  }
  out.apply(`intercept_result:${result}`);
  return {
    ok: true,
    succeeded: result === 'succeeded',
    docStatus: sstr(r0.doc_status) || undefined,
    interceptState: sstr(r0.intercept_state) || undefined,
  };
}

// =====================================================================
// 规则 2：stage —— 只能走 shipment_can_advance / shipment_advance
//          非法跳转不强改，开 work_orders（含 stage_when_detected）（铁律3）
// =====================================================================
async function applyStage(
  out: Collector,
  admin: Admin,
  sh: ShipmentRow,
  requestedStage: string,
  operator: string,
  note: string,
  forwarderId: string | null,
  orderId: string | null,
): Promise<{ changed: boolean; stageNow: string }> {
  if (!STAGES.includes(requestedStage)) {
    // 对方给了一个我们状态机里根本不存在的值 → 属于入参非法，不是非法跳转，不开工单
    out.reject('event.stage', `不在 stage 域内（9 值：${STAGES.join('|')}），收到 ${JSON.stringify(requestedStage)}`);
    return { changed: false, stageNow: sh.stage };
  }
  if (sh.stage === requestedStage) {
    // 幂等：已经在该阶段。注意 trg_parcels_signed_sync 会在包裹全部签收时自动把
    // wait_inbound→received，所以"对方报 received 而我们已经 received"是常态，绝不能当成异常开工单。
    out.apply(`stage:already(${requestedStage})`);
    return { changed: false, stageNow: sh.stage };
  }
  // shipment_can_advance(p_shipment_id, p_to_stage) → TABLE(allowed, reason, gate)
  const { data: cd, error: cdErr } = await admin.rpc('shipment_can_advance', {
    p_shipment_id: sh.id, p_to_stage: requestedStage,
  });
  if (cdErr) {
    out.reject('event.stage', `shipment_can_advance 调用失败：${cdErr.message}`);
    return { changed: false, stageNow: sh.stage };
  }
  const c0 = (Array.isArray(cd) ? cd[0] : cd) as Record<string, unknown> | undefined;
  const allowed = c0?.allowed === true;
  const reason = sstr(c0?.reason);
  const gate = sstr(c0?.gate);

  if (!allowed) {
    // 铁律3 的落点：门禁没过 / 边不存在 → 状态不动，开工单让人裁决。
    // 为什么不能"顺手先跳到中间阶段"：stage 矩阵（shipment_stage_transitions 10 条边）是审计口径，
    // 自动补跳会把"货代说到了 picking 但还没打单"这种矛盾抹平，问题就被藏起来了。
    const wo = await createStageWorkOrder(out, admin, sh, requestedStage, reason, gate, forwarderId, orderId);
    if (wo) out.workOrders.push(wo);
    out.reject('event.stage', `非法跳转已转工单：${sh.stage} → ${requestedStage}（${reason || '矩阵无边'}）`);
    return { changed: false, stageNow: sh.stage };
  }

  // shipment_advance(p_shipment_id, p_to_stage, p_operator text DEFAULT 'system', p_note)
  //   → TABLE(ok, message, new_stage)；内部会再校验一次门禁并补 received_at/packed_at/handover_at/closed_at
  const { data: ad, error: adErr } = await admin.rpc('shipment_advance', {
    p_shipment_id: sh.id, p_to_stage: requestedStage, p_operator: operator, p_note: note,
  });
  if (adErr) {
    out.reject('event.stage', `shipment_advance 调用失败：${adErr.message}`);
    return { changed: false, stageNow: sh.stage };
  }
  const a0 = (Array.isArray(ad) ? ad[0] : ad) as Record<string, unknown> | undefined;
  if (a0?.ok !== true) {
    // 两步之间门禁被别人改了（并发），同样不强跳，转工单
    const wo = await createStageWorkOrder(out, admin, sh, requestedStage, sstr(a0?.message) || 'advance 拒绝', gate, forwarderId, orderId);
    if (wo) out.workOrders.push(wo);
    out.reject('event.stage', `advance 被拒：${sstr(a0?.message) || 'unknown'}`);
    return { changed: false, stageNow: sh.stage };
  }
  const newStage = sstr(a0?.new_stage) || requestedStage;
  out.apply(`stage:${sh.stage}→${newStage}`);
  sh.stage = newStage;   // 后续事件与包裹判定都按新阶段看
  return { changed: true, stageNow: newStage };
}

/**
 * 作废单据仍被回传费用 → 工单（type 同样用现网枚举里的 other：
 * work_orders_type_ck 实测 14 值没有"作废单费用"，新增枚举值属 migration，本文件禁止）。
 * 为什么不能静默丢弃：货代坚持"费用确实发生"时，这条工单就是卖家侧唯一的入口，
 * 丢了它等于让货代的钱凭空消失，最后一定会变成线下扯皮（协议 §7 对账争议要的就是这条链）。
 */
async function createVoidedFeeWorkOrder(
  out: Collector,
  admin: Admin,
  sh: ShipmentRow,
  fees: unknown[],
  externalRef: string,
): Promise<WorkOrderRef | null> {
  const items = fees.slice(0, 20).map((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    return `${sstr(o.fee_type) || '?'}=${sstr(o.amount) || '?'}${sstr(o.currency) || ''}`;
  }).join(', ');
  const title = `已作废单据收到费用回传：${fees.length} 条未入账`;
  const { data, error } = await admin.from('work_orders').insert({
    user_id: sh.user_id,
    forwarder_id: sh.forwarder_id,
    warehouse_id: sh.warehouse_id,
    shipment_id: sh.id,
    order_id: sh.order_id,
    type: 'other',
    stage_when_detected: sh.stage,
    title,
    description: `来源：货代回传（webhook），批次/单号 ${externalRef || '-'}。`
      + `该货件 doc_status=cancelled（拦截状态：${sstr(sh.intercept_state) || '-'}，`
      + `库里作废原因见 shipments.cancelled_reason），`
      + `本次回传携带 ${fees.length} 条费用，已全部拒绝入账：${items}。`
      + `请人工判定：确属作废前已发生 → 走对账单手工补录并说明依据；否则驳回货代。`,
    status: 'pending',
    priority: 'normal',
    assignee_type: 'forwarder',
    created_by: null,
  }).select('id, type, title, stage_when_detected').single();
  if (error) {
    out.reject('work_order', `作废单费用工单创建失败：${error.message}`);
    return null;
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    id: sstr(row.id), type: sstr(row.type), title: sstr(row.title),
    stage_when_detected: sstr(row.stage_when_detected) || null,
  };
}

/** stage 非法跳转 → 工单（type 用现网枚举里的 other；title/description 里保留对方原文，便于回溯） */
async function createStageWorkOrder(
  out: Collector,
  admin: Admin,
  sh: ShipmentRow,
  requestedStage: string,
  reason: string,
  gate: string,
  forwarderId: string | null,
  orderId: string | null,
): Promise<WorkOrderRef | null> {
  const title = `货代回传的阶段跳转被拒：${sh.stage} → ${requestedStage}`;
  const { data, error } = await admin.from('work_orders').insert({
    user_id: sh.user_id,
    forwarder_id: forwarderId,
    warehouse_id: sh.warehouse_id,
    shipment_id: sh.id,
    order_id: orderId,
    // work_orders_type_ck 实测 14 值，没有"阶段非法"这一类，用 other（不新增枚举值：改枚举属于 migration，
    // 本任务禁止动 migrations/**）
    type: 'other',
    // stage_when_detected：契约点名必须带 —— 该列的语义是"异常被发现时所处阶段"，决定后续能否回退
    stage_when_detected: sh.stage,
    title,
    description: `来源：货代回传（webhook）。对方请求跳转到 ${requestedStage}，`
      + `门禁/矩阵判定不允许：${reason || '无'}${gate ? `（gate=${gate}）` : ''}。`
      + `请人工核对货代侧实际作业状态，再决定是用 shipment_advance 人工推进还是驳回该回传。`,
    status: 'pending',
    priority: 'normal',
    assignee_type: 'forwarder',
    created_by: null,          // 与 trg_parcels_headless_ticket 同口径：系统来源的工单 created_by 留空
  }).select('id, type, title, stage_when_detected').single();
  if (error) {
    out.reject('work_order', `工单创建失败：${error.message}`);
    return null;
  }
  const row = (data ?? {}) as Record<string, unknown>;
  return {
    id: sstr(row.id),
    type: sstr(row.type),
    title: sstr(row.title),
    stage_when_detected: sstr(row.stage_when_detected) || null,
  };
}

// =====================================================================
// 规则 3：tracking_no / carrier 回填
//   契约：已有值且不同 → 覆盖，并写一条状态事件说明"来自回传"
//   为什么覆盖而不是拒绝：跟踪号是对方系统的权威字段（尾程单号只有货代知道），
//   但覆盖必须留痕，否则推单时拿到的号与最终号不一致将无法对账。
// =====================================================================
async function applyTracking(
  out: Collector,
  admin: Admin,
  sh: ShipmentRow,
  trackingNo: string,
  carrier: string,
  operator: string,
  occurredAt: string | null,
  rawStatus: string | null,
): Promise<void> {
  if (trackingNo) {
    const old = sstr(sh.tracking_no);
    if (old !== trackingNo) {
      const { error } = await admin.from('shipments').update({
        tracking_no: trackingNo, updated_at: nowIso(),
      }).eq('id', sh.id).eq('user_id', sstr(sh.user_id));
      if (error) { out.reject('event.tracking_no', `回填失败：${error.message}`); return; }
      out.apply(`tracking_no:${old || '(空)'}→${trackingNo}`);
      // 覆盖留痕：单独一条事件，明确写了"原值由推单/其他来源产生，本次被回传覆盖"
      const eventId = await writeStatusEvent(admin, sstr(sh.user_id), sh.id, {
        rawStatus: rawStatus ? `${rawStatus}#tracking_override` : 'ERP:tracking_override',
        stage: sh.stage,
        trackingNo,
        carrierName: carrier || sstr(sh.carrier) || null,
        norm: 'sending',        // 满足 sse_field_completeness_ck：sending 不要求 tracking_no，但这里有更严格也够用
        failedReason: null,
        operator,
        occurredAt,
        payload: { reason: 'tracking_no_overridden_by_callback', previous_tracking_no: old || null, source_of_new_value: 'forwarder_webhook' },
      });
      if (eventId) out.events.push(eventId);
      sh.tracking_no = trackingNo;
    } else {
      out.apply(`tracking_no:${trackingNo}(unchanged)`);
    }
  }
  if (carrier) {
    const old = sstr(sh.carrier);
    if (old !== carrier) {
      const { error } = await admin.from('shipments').update({
        carrier, updated_at: nowIso(),
      }).eq('id', sh.id).eq('user_id', sstr(sh.user_id));
      if (error) { out.reject('event.carrier', `回填失败：${error.message}`); return; }
      out.apply(`carrier:${old || '(空)'}→${carrier}`);
      sh.carrier = carrier;
    } else {
      out.apply(`carrier:${carrier}(unchanged)`);
    }
  }
}

// =====================================================================
// 规则 4：包裹回传（按 parcel_no 匹配；inbound_status 必须落在 6 值域内）
//   为什么写 parcels.inbound_status 会"顺带"改货件：库里 trg_parcels_signed_sync
//   在该列被更新时自动把 wait_inbound 推到 received 并补 received_at（全部签收才推）。
//   这不是本函数越权改 stage，而是状态机的既有实现；因此上面 stage 判定必须容忍"已经在目标阶段"。
// =====================================================================
async function applyParcels(
  out: Collector,
  admin: Admin,
  sh: ShipmentRow,
  list: unknown[],
  occurredAt: string | null,
): Promise<void> {
  const userId = sstr(sh.user_id);
  const items = list.slice(0, MAX_ITEMS);
  if (list.length > MAX_ITEMS) out.reject('event.parcels', `单次最多处理 ${MAX_ITEMS} 个包裹，收到 ${list.length} 个，多余部分已忽略`);

  for (let i = 0; i < items.length; i++) {
    const p = (items[i] ?? {}) as Record<string, unknown>;
    const field = `event.parcels[${i}]`;
    const parcelNo = sstr(p.parcel_no).trim();
    if (!parcelNo) { out.reject(`${field}.parcel_no`, '缺少 parcel_no'); continue; }

    // 先在本货件下找；找不到再到租户内找（找得到但属于别的货件 = 明确报错，不"顺手"改别人的包裹）
    const { data: inShipment, error: e1 } = await admin.from('parcels')
      .select('id, parcel_no, shipment_id, inbound_status, weight, length, width, height, signed_at')
      .eq('user_id', userId).eq('shipment_id', sh.id).eq('parcel_no', parcelNo).maybeSingle();
    if (e1) { out.reject(`${field}`, `查询包裹失败：${e1.message}`); continue; }
    const parcel = (inShipment ?? null) as Record<string, unknown> | null;
    if (!parcel) {
      const { data: other, error: e2 } = await admin.from('parcels')
        .select('id, parcel_no, shipment_id').eq('user_id', userId).eq('parcel_no', parcelNo).limit(1);
      if (e2) { out.reject(`${field}`, `查询包裹失败：${e2.message}`); continue; }
      const o = (other ?? [])[0] as Record<string, unknown> | undefined;
      if (o) out.reject(`${field}.parcel_no`, `包裹 ${parcelNo} 属于其他货件（${sstr(o.shipment_id)}），本次回传不改它`);
      else out.reject(`${field}.parcel_no`, `PARCEL_NOT_FOUND：本货件与租户内都查不到 ${parcelNo}`);
      continue;
    }

    const patch: Record<string, unknown> = { updated_at: nowIso() };
    const touched: string[] = [];

    const rawStatusField = p.inbound_status;
    if (rawStatusField !== undefined && rawStatusField !== null && sstr(rawStatusField) !== '') {
      const v = sstr(rawStatusField).trim();
      if (!INBOUND_STATUSES.includes(v)) {
        // 契约：非法值必须拒绝（不猜、不小写化、不映射）
        out.reject(`${field}.inbound_status`, `不在 6 值域内（${INBOUND_STATUSES.join('|')}），收到 ${JSON.stringify(v)}`);
      } else {
        patch.inbound_status = v;
        touched.push(`inbound_status=${v}`);
        if (v === 'signed') patch.signed_at = parcel.signed_at ? parcel.signed_at : (occurredAt ?? nowIso());
        // 回退签收状态就清掉 signed_at：该列只表示"签收"这一事实，留着旧时间戳会误导入库时效报表
        if (v === 'not_inbound' || v === 'in_transit') patch.signed_at = null;
      }
    }

    const w = snum(p.weight_g);
    if (w !== null) {
      if (w < 0 || w > 100000000) out.reject(`${field}.weight_g`, `重量不合理：${w}`);
      else { patch.weight = w; touched.push(`weight_g=${w}`); }   // 单位口径见交付报告：按克写入 parcels.weight
    }
    for (const key of ['length', 'width', 'height'] as const) {
      const v = snum(p[key]);
      if (v !== null) {
        if (v < 0 || v > 100000) { out.reject(`${field}.${key}`, `尺寸不合理：${v}`); continue; }
        patch[key] = Math.round(v);                              // 实测 int4 列，四舍五入后写入
        touched.push(`${key}=${Math.round(v)}`);
      }
    }

    if (Object.keys(patch).length === 1) {   // 只有 updated_at → 没有任何有效字段
      out.reject(field, '没有可应用的字段（inbound_status/weight_g/length/width/height 都缺失或非法）');
      continue;
    }
    const { error: uErr } = await admin.from('parcels').update(patch)
      .eq('id', sstr(parcel.id)).eq('user_id', userId);
    if (uErr) { out.reject(field, `更新失败：${uErr.message}`); continue; }
    out.apply(`parcel:${parcelNo}:${touched.join(',')}`);
  }
}

// =====================================================================
// 规则 5：费用回传 → billing_lines（source='wms_returned' / status='pending_audit'）
//   + 同步 shipments.actual_amount
//   为什么金额不直接进"已审"：diff_flag 由库触发器 fn_billing_lines_diff_flag 计算
//   （实重 vs 报重差异 >5% → true），审核动作属于财务，必须留在 pending_audit 让人过一眼；
//   同时 trg_billing_lines_approved_lock 会锁住已审行，本函数只新增、绝不改已有行。
// =====================================================================
async function applyFees(
  out: Collector,
  admin: Admin,
  sh: ShipmentRow,
  list: unknown[],
  externalRef: string,
): Promise<void> {
  const userId = sstr(sh.user_id);
  const items = list.slice(0, MAX_ITEMS);
  if (list.length > MAX_ITEMS) out.reject('event.fees', `单次最多处理 ${MAX_ITEMS} 条费用，收到 ${list.length} 条，多余部分已忽略`);

  let inserted = 0;
  for (let i = 0; i < items.length; i++) {
    const f = (items[i] ?? {}) as Record<string, unknown>;
    const field = `event.fees[${i}]`;
    const feeType = sstr(f.fee_type).trim();
    const amount = snum(f.amount);

    if (!FEE_TYPES.includes(feeType)) {
      out.reject(`${field}.fee_type`, `不在 billing_lines_fee_type_ck 的 12 值内（${FEE_TYPES.join('|')}），收到 ${JSON.stringify(feeType)}`);
      continue;
    }
    if (amount === null) { out.reject(`${field}.amount`, '缺少 amount 或不是数字'); continue; }

    const row: Record<string, unknown> = {
      user_id: userId,
      shipment_id: sh.id,
      fee_type: feeType,
      amount,
      source: 'wms_returned',
      status: 'pending_audit',
      external_ref: externalRef || null,
    };

    const cur = sstr(f.currency).trim().toUpperCase();
    if (cur) {
      if (!/^[A-Z]{3}$/.test(cur)) out.reject(`${field}.currency`, `币种应为 3 位字母，收到 ${cur}`);
      else row.currency = cur;
    }
    // 币种与货件 fee_currency 不一致：不拦（对方收什么币种是事实），但明确回报，避免财务按单币种汇总时踩坑
    if (row.currency && sstr(sh.fee_currency) && row.currency !== sstr(sh.fee_currency)) {
      out.notes.currencyMixed = true;
      out.apply(`fee-currency-mixed:${sstr(sh.fee_currency)}≠${String(row.currency)}`);
    }

    const unit = sstr(f.charge_unit).trim();
    if (unit) {
      if (!CHARGE_UNITS.includes(unit)) { out.reject(`${field}.charge_unit`, `不在 6 值内（${CHARGE_UNITS.join('|')}），收到 ${JSON.stringify(unit)}`); }
      else row.charge_unit = unit;
    }
    const qty = snum(f.charge_qty);
    if (qty !== null) {
      if (qty < 0) out.reject(`${field}.charge_qty`, '不能为负');
      else row.charge_qty = qty;
    }
    const wc = snum(f.weight_charged_g);
    if (wc !== null) {
      if (wc < 0) out.reject(`${field}.weight_charged_g`, '不能为负');
      else row.weight_charged_g = wc;
    }
    const wd = snum(f.weight_declared_g);
    if (wd !== null) {
      if (wd < 0) out.reject(`${field}.weight_declared_g`, '不能为负');
      else row.weight_declared_g = wd;
    }

    const { data, error } = await admin.from('billing_lines').insert(row).select('id, diff_flag, amount').single();
    if (error) { out.reject(field, `账单行写入失败：${error.message}`); continue; }
    const r = (data ?? {}) as Record<string, unknown>;
    inserted++;
    // diff_flag 是库触发器算出来的（>5% 置 true），这里把它读回来告诉调用方，供上游决定是否开 weight_dispute
    out.apply(`billing_line:${sstr(r.id)}:${feeType}=${amount}${r.diff_flag === true ? '(diff_flag=true)' : ''}`);
  }

  if (inserted > 0) await syncActualAmount(out, admin, sh);
}

/**
 * actual_amount = 该货件全部未作废/未驳回账单行之和。
 * 用"重算总和"而不是"累加增量"：一个回调可能被 replay、被部分拒绝、被人工 voided，
 * 累加会把这些路径都变成对不上的账；重算永远收敛到同一个值（幂等）。
 */
async function syncActualAmount(out: Collector, admin: Admin, sh: ShipmentRow): Promise<void> {
  const base = (sstr(sh.fee_currency) || 'CNY').toUpperCase();
  const { data, error } = await admin.from('billing_lines')
    .select('amount, status, currency')
    .eq('user_id', sstr(sh.user_id)).eq('shipment_id', sh.id);
  if (error) { out.reject('actual_amount', `汇总账单行失败：${error.message}`); return; }
  // 在代码侧排除 voided/rejected（不用 PostgREST 的 not.in 语法：一条账单行最多几十条，
  // 少一次"过滤器写法不生效就悄悄把作废金额算进去"的风险）
  const rows = (data ?? []) as unknown as { amount: number | string; status: string; currency: string | null }[];
  // 币种口径与门户一致：actual_amount 只合计本币（fee_currency）行，异币行照实入账但不进合计。
  const isForeign = (r: { currency: string | null }) => {
    const c = (sstr(r.currency) || '').trim().toUpperCase();
    return c !== '' && c !== base;
  };
  const foreignRows = rows.filter((r) => r.status !== 'voided' && r.status !== 'rejected' && isForeign(r));
  const total = rows
    .filter((r) => r.status !== 'voided' && r.status !== 'rejected' && !isForeign(r))
    .reduce((a, r) => a + (Number(r.amount) || 0), 0);
  if (foreignRows.length) {
    out.apply(`actual_amount 口径：${foreignRows.length} 条非 ${base} 账单行未计入本币合计`);
  }
  const rounded = Math.round(total * 10000) / 10000;     // actual_amount 实测 numeric(14,4)
  const { error: uErr } = await admin.from('shipments')
    .update({ actual_amount: rounded, updated_at: nowIso() })
    .eq('id', sh.id).eq('user_id', sstr(sh.user_id));
  if (uErr) { out.reject('actual_amount', `同步失败：${uErr.message}`); return; }
  out.apply(`actual_amount:${sstr(sh.actual_amount)}→${rounded}`);
  sh.actual_amount = rounded;
}

// =====================================================================
// 幂等（回放）判定：同一货件的完全相同回调只生效一次
//   DESIGN §4.2 明文要求（"同 batchNo+rawStatus+occurredAt 重复提交不产生第二条事件"）。
//   这里用整事件体 SHA-256：比三字段更严格，也顺带防住"同一 occurredAt 发两条不同费用"的漏算。
//   哈希存进 shipment_status_events.payload.event_hash，用 PostgREST 的 jsonb 路径过滤查；
//   查询失败（路径语法/版本差异）时降级为"不做幂等判定"，宁可不拦也不拦错正常回调。
// =====================================================================
async function findReplayEventId(
  admin: Admin,
  shipmentId: string,
  hash: string,
): Promise<string | null> {
  try {
    const { data, error } = await admin.from('shipment_status_events')
      .select('id')
      .eq('shipment_id', shipmentId)
      .filter('payload->>event_hash', 'eq', hash)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.warn(`[${functionName}] 幂等查询失败，降级为不判定：${error.message}`);
      return null;
    }
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    return row ? sstr(row.id) : null;
  } catch (e) {
    console.warn(`[${functionName}] 幂等查询异常，降级为不判定：${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

// =====================================================================
// 回传审计日志：push_logs(direction='in')
//   契约没要求，但 push_logs 的 direction CHECK 本来就有 'in'，且 list-logs 按 shipment_id 查，
//   回传不留这条日志的话，卖家侧永远看不到"货代到底回了什么"。
//   快照里绝不包含密钥；签名只留前 12 位。
// =====================================================================
async function writeInboundLog(
  admin: Admin,
  args: {
    userId: string; shipmentId: string | null; batchNo: string; forwarderId: string | null;
    warehouseId: string | null; authId: string; timestamp: string; signature: string; rawBody: string;
    status: string; deduped: boolean; errorCode?: string; errorMessage?: string;
    result: Record<string, unknown>; durationMs: number;
  },
): Promise<void> {
  const { error } = await admin.from('push_logs').insert({
    user_id: args.userId,
    direction: 'in',
    action: 'webhook_order_status',
    batch_no: args.batchNo || null,
    shipment_id: args.shipmentId,
    forwarder_id: args.forwarderId,
    warehouse_id: args.warehouseId,
    endpoint: `/functions/v1/${functionName}`,
    request_snapshot: {
      auth_id: args.authId,
      timestamp: args.timestamp,
      // 签名只存前 12 位：够比对"对方到底用哪个签名"，又不会把可重放的凭证留在库里
      signature_prefix: `${args.signature.slice(0, 12)}…(hmac-sha256, 截断存储)`,
      body: trunc(args.rawBody, 8000),
    },
    response_snapshot: args.result,
    status: args.status,                      // push_logs_status_ck: pending|success|failed|dead|skipped
    error_code: args.errorCode ?? null,       // 只用 push_error_codes 里的码（或 null），不自造
    error_message: args.errorMessage ? trunc(args.errorMessage, 500) : null,
    duration_ms: args.durationMs,
    deduped: args.deduped,
    finished_at: nowIso(),
  });
  if (error) console.error(`[${functionName}] push_logs(in) 写入失败：${error.message}`);
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID().slice(0, 8);

  // 鉴权失败统一出口：只给一句原因，绝不带密钥/期望签名/对方签名长度以外的信息
  const deny = (status: number, reason: string): Response => {
    console.warn(`[${functionName}] ${requestId} 拒绝(${status})：${reason}`);
    return json({ ok: false, error: reason }, status);
  };

  try {
    if (req.method !== 'POST') return deny(405, '仅支持 POST 请求');

    // 先取原文：签名对象是 raw body，一旦 JSON.parse 再 stringify 就对不上了
    // （长度按字符数近似：回传体是 ASCII JSON，够用；真正的上限保护由 MAX_ITEMS 兜住）
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) return deny(413, `请求体超过 ${MAX_BODY_BYTES} 字节上限`);

    const authId = (req.headers.get('X-Thalvior-Forwarder-Auth') || '').trim();
    const tsHeader = (req.headers.get('X-Thalvior-Timestamp') || '').trim();
    const sigHeader = (req.headers.get('X-Thalvior-Signature') || '').trim().toLowerCase();

    // 报文缺头时不能只说"缺头"：对方很可能压根不知道本入口只讲 TFOP-1。
    // 货小易这类第三方货代系统有自己的签名与字段格式，接进来需要单独写适配器，
    // 这里明确把协议说清楚，免得对方按自己文档调了半天只拿到一句 401。
    if (!authId) return deny(401, '缺少 X-Thalvior-Forwarder-Auth：本入口只接受 TFOP-1 协议回传（三个 X-Thalvior-* 头必须齐全）；货小易等其他货代系统的报文需先实现对应适配器');
    if (!sigHeader) return deny(401, '缺少 X-Thalvior-Signature（TFOP-1：hex(hmac_sha256(secret, timestamp + "." + raw_body))）');

    const admin = adminClient();

    // 1) 找到密钥归属：这条 auth 就是"调用方身份 + 租户边界"
    const { data: authData, error: authErr } = await admin.from('forwarder_auths')
      .select('id, user_id, forwarder_id, protocol, provider, auth_state, available_state, push_enabled,'
        + ' webhook_secret_enc, credentials_enc, app_key')
      .eq('id', authId).maybeSingle();
    if (authErr) return json({ ok: false, error: '鉴权查询失败' }, 500);
    if (!authData) return deny(401, 'X-Thalvior-Forwarder-Auth 无法识别');

    const auth = authData as unknown as AuthRow;
    // 与 forwarder-push 对称：登记成别的货代系统的授权，不能拿 TFOP-1 的验签规则来解释它的回传，
    // 否则对方报文里的字段会被按我们的口径误写进库（比 401 更难查）。
    const provider = sstr((auth as unknown as Record<string, unknown>).provider) || 'tfop1';
    if (provider !== 'tfop1') {
      return deny(401, `该授权登记的货代系统是 ${provider}，本入口目前只实现 TFOP-1 的回传验签；请先完成该系统的报文适配器`);
    }
    const userId = sstr(auth.user_id);
    if (!userId) return deny(401, '该授权未绑定租户 user_id');

    // 显式撤销/过期的授权直接拒（HMAC 是对的，但这条关系已经被租户切断了）
    if (auth.auth_state === 'revoked' || auth.auth_state === 'expired') {
      return deny(403, `该授权状态为 ${auth.auth_state}`);
    }

    // 2) 时间戳防重放（±5 分钟）
    const ts = Number(tsHeader);
    if (!Number.isFinite(ts) || ts <= 0) return deny(401, 'X-Thalvior-Timestamp 非法');
    const skew = Math.abs(Date.now() - ts);
    if (skew > REPLAY_WINDOW_MS) return deny(401, '请求时间戳超出 ±5 分钟窗口');

    // 3) HMAC 校验：原文 = timestamp + "." + raw_body（与 forwarder-push 的签名口径完全一致）
    //    密钥优先级与 forwarder-push 相反，这是有意的：
    //      回传（入站）方向先认 webhook_secret_enc —— 这一列本来就是"货代回传给我们时用的密钥"；
    //      推单（出站）方向先认 credentials 里的 push_secret —— 那是我们签给货代验的。
    //    两家各一套密钥是常见做法（出站密钥泄露不该影响入站验签，反之亦然），
    //    只有一套共享密钥时两条路径落到同一个值，行为不变。
    const hookSecret = await decryptSecretText(sstr(auth.webhook_secret_enc));
    const creds = await decryptCreds(sstr(auth.credentials_enc));
    const secret = hookSecret || pick(creds, ['webhook_secret', 'push_secret', 'signing_secret', 'secret', 'app_secret']);
    if (!secret) return deny(401, '该授权没有可用的回传密钥');
    const expected = await hmacHex(secret, `${tsHeader}.${rawBody}`);
    if (!safeEqualHex(expected, sigHeader)) return deny(401, '签名校验失败');

    // 4) 解析入参
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return json({ ok: false, error: 'BAD_JSON：请求体必须是 JSON 对象' }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ ok: false, error: 'BAD_JSON：请求体不是合法 JSON' }, 400);
    }
    const event = (body.event && typeof body.event === 'object' && !Array.isArray(body.event))
      ? body.event as Record<string, unknown>
      : {};

    const batchNo = sstr(body.batch_no).trim();
    const shipmentNo = sstr(body.shipment_no).trim();
    if (!batchNo && !shipmentNo) return json({ ok: false, error: 'batch_no 与 shipment_no 至少要有一个' }, 400);

    // 5) 定位货件（租户内；查不到一律 404，不透露是否存在）
    const located = await locateShipment(admin, userId, batchNo, shipmentNo);
    const sh = located.sh;
    if (!sh) {
      await writeInboundLog(admin, {
        userId, shipmentId: null, batchNo, forwarderId: auth.forwarder_id, warehouseId: null,
        authId, timestamp: tsHeader, signature: sigHeader, rawBody, status: 'failed', deduped: false,
        // 字典里没有"找不到货件"这个码（18 条都是推单/资料类），所以 error_code 留 null，
        // 具体定位信息放 error_message —— 不违反"错误码只能来自 push_error_codes"
        errorMessage: `SHIPMENT_NOT_FOUND batch_no=${batchNo || '-'} shipment_no=${shipmentNo || '-'}`,
        result: { error: 'SHIPMENT_NOT_FOUND' }, durationMs: Date.now() - startedAt,
      });
      return json({ ok: false, error: 'SHIPMENT_NOT_FOUND' }, 404);
    }
    const shUserId = sstr(sh.user_id);
    if (located.ambiguity) console.warn(`[${functionName}] ${requestId} ${located.ambiguity}`);

    // 5.5 同租户多货代是常态：A 家的密钥不能改 B 家的货件。
    //     按 forwarder_id 对齐（不是按 auth id —— 同一个货代可能有多种 protocol 的授权行）。
    //     对不上就回同一个 404：不告诉对方"这单存在但属于别人"，真实原因只进内部审计。
    if (auth.forwarder_id && sh.forwarder_id && sstr(auth.forwarder_id) !== sstr(sh.forwarder_id)) {
      console.warn(`[${functionName}] ${requestId} auth forwarder=${sstr(auth.forwarder_id)} `
        + `≠ shipment forwarder=${sstr(sh.forwarder_id)} shipment=${sh.id}`);
      await writeInboundLog(admin, {
        userId: shUserId, shipmentId: sh.id, batchNo, forwarderId: auth.forwarder_id, warehouseId: null,
        authId, timestamp: tsHeader, signature: sigHeader, rawBody, status: 'failed', deduped: false,
        errorMessage: `FORWARDER_MISMATCH shipment=${sh.id} 的货代不是本授权所属货代`,
        result: { error: 'SHIPMENT_NOT_FOUND' }, durationMs: Date.now() - startedAt,
      });
      return json({ ok: false, error: 'SHIPMENT_NOT_FOUND' }, 404);
    }

    // 6) 幂等判定（回放）
    const occurredAt = isoOrNull(event.occurred_at ?? body.occurred_at ?? event.occurredAt ?? body.occurredAt);
    const eventHash = await sha256Hex(JSON.stringify({
      batch_no: batchNo, shipment_no: shipmentNo,
      occurred_at: occurredAt, // 没给就留空，仍然按"完全相同才算回放"处理
      event,
    }));
    const hitReplay = await findReplayEventId(admin, sh.id, eventHash);
    if (hitReplay) {
      // 回放：一个业务字节都不动（否则账单行会重复入账），但审计日志必须留，方便对方排查
      await writeInboundLog(admin, {
        userId: shUserId, shipmentId: sh.id, batchNo, forwarderId: sh.forwarder_id,
        warehouseId: sh.warehouse_id, authId, timestamp: tsHeader, signature: sigHeader, rawBody,
        status: 'skipped', deduped: true, errorCode: 'IDEMPOTENT_HIT',
        errorMessage: `重复回传，已忽略（首个事件 id=${hitReplay}）`,
        result: { ok: true, replay: true, shipment_id: sh.id, first_event_id: hitReplay },
        durationMs: Date.now() - startedAt,
      });
      return json({
        ok: true, replay: true, shipment_id: sh.id, first_event_id: hitReplay,
        applied: [], rejected: [], work_orders: [],
      });
    }

    // 7) 依次应用（顺序就是契约给的顺序，不能并行：intercept 决定 doc_status，
    //    后续 stage/费用都建立在"这张单还有效"之上）
    const out = newCollector();
    if (located.ambiguity) out.reject('shipment_no', located.ambiguity);

    const { data: fwdData } = await admin.from('freight_forwarders')
      .select('id, name, code').eq('id', sstr(auth.forwarder_id)).maybeSingle();
    const fwd = (fwdData ?? null) as Record<string, unknown> | null;
    const forwarderName = sstr(fwd?.name) || sstr(fwd?.code) || 'forwarder';
    // 契约：p_operator = 货代名 + auth id
    const operator = `${forwarderName}(auth:${authId})`;

    // 对方原文（一字不改，后面既写 shipments.raw_status 也进事件）
    const rawStatus = (event.raw_status !== undefined && event.raw_status !== null && sstr(event.raw_status) !== '')
      ? sstr(event.raw_status)
      : null;

    // 7.1 intercept_result —— 契约规定它排在最前（铁律2：先定单据有效性，再谈作业进度）
    const interceptRaw = sstr(event.intercept_result).trim();
    const reason = sstr(event.reason).trim();
    let interceptSucceeded = false;
    if (interceptRaw) {
      const r = await applyIntercept(out, admin, sh.id, interceptRaw,
        reason || `货代回传拦截结果：${interceptRaw}${rawStatus ? `（raw_status=${rawStatus}）` : ''}`);
      interceptSucceeded = r.ok && r.succeeded;
      if (r.docStatus) sh.doc_status = r.docStatus;
      if (r.interceptState) sh.intercept_state = r.interceptState;
      if (interceptSucceeded) {
        // 拦截成功 = 单据作废，后面的 stage 跳转一律不执行
        out.notes.interceptCancelledDoc = true;
      }
    } else if (event.intercept_result !== undefined && event.intercept_result !== null) {
      out.reject('event.intercept_result', `只允许 succeeded / failed，收到 ${JSON.stringify(event.intercept_result)}`);
    }

    // 7.2 对方原文先存：raw_status 一字不改（回传排障全靠它，不做任何归一化猜测）
    if (rawStatus !== null && rawStatus !== sstr(sh.raw_status)) {
      const { error } = await admin.from('shipments')
        .update({ raw_status: rawStatus, updated_at: nowIso() })
        .eq('id', sh.id).eq('user_id', shUserId);
      if (error) out.reject('event.raw_status', `写入失败：${error.message}`);
      else { out.apply(`raw_status:${rawStatus}`); sh.raw_status = rawStatus; }
    } else if (rawStatus !== null) {
      out.apply(`raw_status:${rawStatus}(unchanged)`);
    }

    // 7.3 stage
    const stageReq = sstr(event.stage).trim();
    if (stageReq) {
      if (interceptSucceeded) {
        out.reject('event.stage', `拦截已成功、单据作废（doc_status=${sh.doc_status}），不再接收阶段跳转`);
      } else {
        await applyStage(out, admin, sh, stageReq, operator,
          `webhook 回传${rawStatus ? ` raw_status=${rawStatus}` : ''}`, sh.forwarder_id, sh.order_id);
      }
    }

    // 7.4 tracking_no / carrier
    //   铁律2（实测缺口）：本函数原先只把"作废不推进"写在 7.3 的 stage 上，
    //   单号/承运商/费用三条路都没看 doc_status。一张已作废的单被迟到回传补上运单号以后，
    //   ERP 看板与 17track 查询都把它当在途单显示，等于"作废"只在 stage 上成立。
    const trackingNo = sstr(event.tracking_no).trim();
    const carrierName = sstr(event.carrier).trim();
    const voidedDoc = sstr(sh.doc_status) === 'cancelled';
    if (trackingNo || carrierName) {
      if (voidedDoc) {
        out.reject('event.tracking_no',
          `单据已作废（doc_status=cancelled），回传的单号/承运商只留痕不回填：`
          + `${trackingNo || '(无单号)'}${carrierName ? ` / ${carrierName}` : ''}`);
      } else {
        await applyTracking(out, admin, sh, trackingNo, carrierName, operator, occurredAt, rawStatus);
      }
    }

    // 7.5 parcels（会经 trg_parcels_signed_sync 间接触发 received 自动推进）
    if (Array.isArray(event.parcels) && event.parcels.length) {
      await applyParcels(out, admin, sh, event.parcels as unknown[], occurredAt);
      // 包裹全部签收时，库触发器会自动把 wait_inbound 推到 received 并补 received_at。
      // 回读一次，让后面的事件与返回值写的是库里真实阶段，而不是本函数内存里的旧值。
      const { data: refreshed } = await admin.from('shipments')
        .select('stage, doc_status, intercept_state, tracking_no, carrier')
        .eq('id', sh.id).eq('user_id', shUserId).maybeSingle();
      const rf = (refreshed ?? null) as Record<string, unknown> | null;
      if (rf) {
        if (sstr(rf.stage) && sstr(rf.stage) !== sh.stage) out.apply(`stage:auto(${sh.stage}→${sstr(rf.stage)})`);
        sh.stage = sstr(rf.stage) || sh.stage;
        sh.doc_status = sstr(rf.doc_status) || sh.doc_status;
        sh.intercept_state = sstr(rf.intercept_state) || sh.intercept_state;
        sh.tracking_no = (rf.tracking_no === null || rf.tracking_no === undefined) ? sh.tracking_no : sstr(rf.tracking_no);
        sh.carrier = (rf.carrier === null || rf.carrier === undefined) ? sh.carrier : sstr(rf.carrier);
      }
    } else if (event.parcels !== undefined && !Array.isArray(event.parcels)) {
      out.reject('event.parcels', '必须是数组');
    }

    // 7.6 fees → billing_lines + actual_amount
    //   作废单的费用绝不进账本：actual_amount 是"这单实际发生多少"的口径，
    //   拦截成功的单子还挂着费用，卖家的成本报表和对账单就都是假的，而且事后没人能解释来源。
    if (Array.isArray(event.fees) && event.fees.length) {
      if (voidedDoc) {
        const n = (event.fees as unknown[]).length;
        out.reject('event.fees',
          `单据已作废（doc_status=cancelled），${n} 条费用不予入账；`
          + `若货代主张确实发生，请在对账单里按"作废单费用"争议，不要重复回传`);
        const wo = await createVoidedFeeWorkOrder(out, admin, sh, event.fees as unknown[],
          batchNo || shipmentNo || sstr(sh.wms_order_no) || '-');
        if (wo) out.workOrders.push(wo);
      } else {
        await applyFees(out, admin, sh, event.fees as unknown[], shipmentNo || sstr(sh.wms_order_no) || batchNo);
      }
    } else if (event.fees !== undefined && !Array.isArray(event.fees)) {
      out.reject('event.fees', '必须是数组');
    }

    // 7.7 汇总事件（契约："每一个动作"都要写 shipment_status_events，这里是本次回调的汇总留痕，
    //     明细在 applied/rejected 里逐条给出，所以不拆成多条事件冲淡货件时间线）
    // norm_status 推导口径（契约 event 里没有规范化状态字段，列又 NOT NULL）：
    //   拦截成功 → cancel；只给了 reason 没给 tracking_no → failed（failed_reason 必须非空，见 CHECK）；
    //   给了 tracking_no → success（tracking_no 非空，同样满足 CHECK）；其余 → sending。
    const storedTracking = sstr(sh.tracking_no).trim();
    const derived = deriveNormStatus({
      interceptSucceeded,
      // 有运单号就不算失败回传；reason 只在没有 tracking_no 时充当 failed_reason
      reason: storedTracking ? '' : reason,
      // 用库里真正落下的号（不是对方原文）：回填失败时避免写出违反 sse_field_completeness_ck 的 success 行
      trackingNo: storedTracking,
    });
    // 7.7b 货件级 norm_status 同步（四态分离里的"规范化状态"，看板与 v_shipment_progress 就读这一列）。
    //   之前只写进 shipment_status_events，货件上的 norm_status 会永远停在 'sending'，
    //   于是"已取消/已失败"的单子在列表上仍显示运输中——这一列必须和事件的推导同源（都用 derived.norm）。
    //   唯一例外：cancel 是终态。ERP 侧作废过的单子不因后续任何回调被改回 sending/success，
    //   否则任何一条迟到回传都能把作废单据"洗白"。failed→success 允许（货代后补单号是常态）。
    const curNorm = sstr(sh.norm_status);
    // cancel 是终态：货件列不写回，事件行与回显也必须是 cancel。
    //   之前只有 update 那条路认了这条规矩，事件仍按 derived 写 success/sending，
    //   于是时间线上一张作废单后面挂着几条"运输中/已妥投"，与协议 §4.4 直接矛盾。
    const effectiveNorm = (curNorm === 'cancel' && derived.norm !== 'cancel') ? 'cancel' : derived.norm;
    if (effectiveNorm !== curNorm) {
      const { error } = await admin.from('shipments')
        .update({ norm_status: derived.norm, updated_at: nowIso() })
        .eq('id', sh.id).eq('user_id', shUserId);
      if (error) out.reject('norm_status', `写入失败：${error.message}`);
      else { out.apply(`norm_status:${curNorm}→${effectiveNorm}`); sh.norm_status = effectiveNorm; }
    }

    const eventId = await writeStatusEvent(admin, shUserId, sh.id, {
      rawStatus: rawStatus ?? 'ERP:webhook',
      stage: sh.stage,
      trackingNo: sstr(sh.tracking_no) || null,
      carrierName: sstr(sh.carrier) || null,
      norm: effectiveNorm,
      // 作废单的事件不许带 failed_reason 之外的语义：cancel 不要求任何完整性字段
      failedReason: effectiveNorm === 'cancel' ? null : derived.failed_reason,
      operator,
      occurredAt,
      payload: {
        event_hash: eventHash,          // 幂等锚点，见 findReplayEventId
        batch_no: batchNo || null,
        shipment_no: shipmentNo || null,
        auth_id: authId,
        applied: out.applied,
        rejected: out.rejected,
        work_orders: out.workOrders.map((w) => ({ id: w.id, type: w.type })),
        event: shrinkEvent(event),
      },
    });
    if (eventId) out.events.push(eventId);

    const result = {
      ok: true,
      shipment_id: sh.id,
      batch_no: batchNo || sstr(sh.batch_no) || null,
      stage: sh.stage,
      doc_status: sh.doc_status,
      intercept_state: sh.intercept_state,
      push_state: sh.push_state,       // 只回显，本函数一个字节都不改（铁律1）
      norm_status: effectiveNorm,      // 回显库里生效值，不是本次回传的推导值：否则货代看到 success 而 ERP 是 cancel
      applied: out.applied,
      rejected: out.rejected,
      work_orders: out.workOrders,
      status_event_ids: out.events,
      actual_amount: snum(sh.actual_amount),
      notes: out.notes,
    };

    await writeInboundLog(admin, {
      userId: shUserId, shipmentId: sh.id, batchNo, forwarderId: sh.forwarder_id,
      warehouseId: sh.warehouse_id, authId, timestamp: tsHeader, signature: sigHeader, rawBody,
      status: out.applied.length ? 'success' : 'failed',
      deduped: false,
      errorMessage: out.applied.length ? undefined : (out.rejected.map((r) => `${r.field}:${r.reason}`).join('; ') || 'nothing applied'),
      result, durationMs: Date.now() - startedAt,
    });

    console.info(`[${functionName}] ${requestId} shipment=${sh.id} applied=${out.applied.length}`
      + ` rejected=${out.rejected.length} wo=${out.workOrders.length} → 200`);
    return json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    // 内部异常不外泄细节，也不回显任何密钥相关信息
    return json({ ok: false, error: 'INTERNAL_ERROR' }, 500);
  }
});
