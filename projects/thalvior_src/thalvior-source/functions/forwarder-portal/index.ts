// forwarder-portal — 货代门户人工作业入口（TFOP-1 的配套 UI 后端）
// =====================================================================
// 这个函数解决什么问题：
//   TFOP-1（docs/forwarder-integration-v1.md）打通的是「系统 ↔ 系统」：货代程序按 batch_no 回传
//   状态与费用。但真实仓内作业是人做的——收货、打包、交接、按实测重量申报费用，货代侧未必有程序，
//   有程序的也未必愿意为此接一次 API。此前这些动作只能由卖家在自己 ERP 里代货代操作，
//   等于把货代的作业责任转嫁给卖家，而且无法追责到具体是哪个人做的。
//   本函数给货代一个自己的账号入口：货代登录后只看得到「分给自己的货件队列」，
//   并直接在队列上做签收 / 推进 / 费用申报 / 拦截回执，每步都留可追溯记录。
//
// 契约（前端 src/routes/portal.forwarder.tsx 逐字对齐，字段名/action 名不得单边改动）：
//   POST，JSON body，必带 action。除 action=login 外，都要带请求头 X-Thalvior-Portal-Token。
//   成功：{ ok:true, ...各 action 自己的字段 }
//   失败：{ ok:false, code, message, details }（HTTP 400/401/403/404/409/429/500/503）
//   action：login | whoami | stats | shipments | shipment_detail | receive | advance
//           | declare_fees | intercept_report
//
// 为什么这里不用 checkPerm（与 forwarder-push 的唯一重大差异）：
//   push 的调用方是登录的租户用户，权限 = profiles/roles 里的权限点，所以走 _shared/perm.ts 的
//   checkPerm（fail-closed，判定链路异常一律拒绝）。货代不是平台用户：没有 profiles 行、没有角色、
//   没有权限点，把 checkPerm 套上去只会永远 fail-closed 拒绝。这里的等价闸门是「门户令牌」：
//     1) 令牌由本函数在校验 forwarder_auths 凭据后签发，payload 里写死 forwarder_auth_id /
//        forwarder_id / user_id / exp，签名 = hex(HMAC_SHA256(JWT_SECRET, base64url(payload)))；
//     2) 每次请求先验签 + 验 exp，再用 payload.forwarder_auth_id 回查库里的当前行，
//        比对 payload 里的 forwarder_id / user_id 是否与库里一致 —— 授权被撤销、改绑货代、
//        换绑卖家时，12h TTL 内的旧令牌立刻失效（撤销语义优先于 TTL 语义）；
//     3) auth_state ∈ {revoked, expired} 或 forwarder_auths.expires_at 已过 → 拒绝；
//     4) 任何一条不满足都回 401/403，只给一句原因，绝不回显密钥、期望签名、payload 差异细节。
//   闸门仍然是 fail-closed：验签异常、环境变量缺失、查库失败一律拒绝，不降级放行。
//
// 多租户硬约束（service_role 绕过 RLS，所以只能靠代码）：
//   本项目所有 EF 都用 SUPABASE_SERVICE_ROLE_KEY 建 client（forwarder-push / forwarder-webhook 实测），
//   service_role 在库里 rolbypassrls=true，RLS 完全不生效。因此本函数每一条读写都自带
//   `.eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId)`：
//     · user_id     ← 令牌里绑定的卖家租户（货代只看得见这家卖家的货）
//     · forwarder_id ← 该授权所属货代
//   跨租户 / 跨货代的 shipment_id、parcel_no 一律查不到 → 按「不存在」处理（404 / 逐条 rejected），
//   绝不返回「存在但不属于你」这种信息（对齐 forwarder-webhook 的 FORWARDER_MISMATCH → 同一个 404 做法）。
//
// 三条竞品铁律在本文件里的落点（与 forwarder-push/webhook 同一套口径）：
//   铁律1「规则命中 ≠ 执行成功」：门户只推进 stage（且必须走 RPC），**永远不写 push_state**；
//        门户签收成功不代表 ERP 推单成功，也不代表轨迹已回传。
//   铁律2「作业阶段与单据有效性分离」：doc_status='cancelled' 的货件不接受任何门户作业动作
//        （签收 / 推进 / 报费都拒绝），但记录不删、状态不覆盖；拦截回执只走 RPC。
//   铁律3「异常走工单，不塞进订单状态」：门户里门禁没过就**如实回绝 + 给出 gate 与原因**，
//        不像 webhook 那样自动开 work_orders —— 门户这一步是人在点，弹工单只会制造噪音，
//        人当场就能看到原因并改正；这一条与 webhook 的差异已写进交付报告。
//
// 为什么阶段推进只能走 RPC（绝不 update shipments.stage）：
//   shipment_stage_transitions（实测 10 条边）+ shipment_can_advance 的门禁是审计口径本身：
//     received→ready_pack 需 all_parcels_signed；ready_pack→label_ready 需 label_files 里有
//     file_type='WAYBILL' 且 status='ready'；handover→shipped 需 tracking_no 非空。
//   绕过 RPC 直接改列 = 跳过门禁 + 跳过 received_at/packed_at/handover_at/closed_at 补齐
//   + 跳过 ERP: 事件，看板和 v_shipment_progress 会立刻对不上账。
//   另外 parcels.inbound_status 一被写成 'signed'，库触发器 trg_parcels_signed_sync 会在
//   「全部包裹签收」时自动把 wait_inbound 推到 received 并补 received_at —— 这是既有实现，
//   所以签收动作**不重复推 stage**，只在推进前重读一次库里真实阶段。
//
// 凭据与门户账号（实测缺口，见交付报告 D1）：
//   forwarder_auths 实测 22 列，**没有任何门户账号/口令列**（username/password 只存在于 profiles，
//   那是平台用户表，货代不该有行）。本函数因此按「不新增列」的前提实现：
//     · 用户名定位：优先 forwarder_auths.external_account 精确匹配（该列实测无 CHECK、无注释，
//       语义就是「货代侧账号」，用它承载门户登录名是最贴近现状的做法）；
//       命中不到再退化为「解密 credentials_enc 后比对其中 username」的有界扫描（上限 40 行，
//       因为每行都要跑一次 PBKDF2-100000，全表扫描会打爆 30s 运行时上限）。
//     · 口令载体：credentials_enc 解密后的 JSON，支持
//       { portal_users:[{username, password|password_hash}], 或 username/portal_username + password/portal_password,
//         或 *_password_hash 单字段 }；password_hash 只接受自描述格式
//         `pbkdf2-sha256$<iterations>$<saltB64url>$<hashB64url>`（默认 150000 轮），
//         生产建议一律存哈希而不是明文口令。
//   口令比对走定长比较；不存在/不匹配都回同一句「用户名或密码不正确」，不透露账号是否存在。
//   凭据解密沿用 TFOP-1 口径：AES-256-GCM + PBKDF2(SHA-256, 100000, salt 'thalvior-cred-v1')，
//   密钥 = JWT_SECRET，密文布局 base64(iv12‖ct‖tag16)；同时兼容 _shared/secret-vault.ts 的
//   `v1:<b64iv>:<b64ct>`（主密钥 SECRET_MASTER_KEY）格式 —— 与 forwarder-push/webhook 一致，
//   按密文前缀自动选择。为了不引入跨目录依赖，两个解密器在本文件内自带实现（与那两个函数同源）。
//
// 幂等（妙手已知 bug「只操作了一次，两个货代系统都有该订单」的同类对策）：
//   · advance：sh.stage === to_stage → already_applied（绝不重复调 RPC，绝不重复计费）；
//   · receive：包裹已 signed → 不再写 signed_at（只允许补充实测重量/尺寸）；
//   · declare_fees：整批费用做 SHA-256 存进事件 payload.fee_hash，命中即 already_applied，
//     不新增账单行（对齐 forwarder-webhook 的 payload.event_hash 回放判定做法）；
//   · intercept_report：intercept_state 已经是该结果 → already_applied（RPC 自己也会拒重复回执）。
//   全部返回 200 + 明确 result，不当成错误，也不产生第二条事件/账单。
//
// 追溯记录：每个写动作写 1 条 shipment_status_events（raw_status 前缀 `PORTAL:`，与 ERP: / 货代回传
//   区分）+ 1 条 push_logs(direction='in', action='portal_*')，让卖家侧「推单日志」看得到货代干了什么。
//   事件 source 用 'manual'：sse_source_ck 实测只有 wms|webhook|manual|import|system 五个值，
//   没有 portal —— 门户是人在作业，manual 是语义最贴切的既有值；改枚举属于 migration，本任务禁止。
//   快照与事件 payload 里绝不写口令、密钥、完整令牌（只写 username / auth_id / 令牌前 8 位）。
//
// 错误码：优先复用 push_error_codes 字典（实测 18 条，全 is_active）——
//   AUTH_EXPIRED（授权撤销/过期/货代已删）、IDEMPOTENT_HIT（重复提交）。
//   字典里没有门户侧的鉴权/入参/找不到单据类码，确实需要的新码见交付报告 D2，本文件用固定
//   UPPER_SNAKE 常量，且 message 自己给（不冒充字典码，也不往字典表写数据）。
//
// 部署前置（由主会话执行，本文件不碰运行时）：见交付报告 D3 —— 货代没有平台 JWT，
//   该函数需要与 forwarder-webhook 同样的免 JWT 部署口径；前端仍会带上 anon key 以兼容
//   verify_jwt=on 的部署，但**鉴权不依赖 Authorization**，只认 X-Thalvior-Portal-Token。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const functionName = 'forwarder-portal';

// ─── 限额与时效 ──────────────────────────────────────────────────────
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;      // 契约：门户令牌 12h
const MAX_BATCH = 100;                         // 与 forwarder-push 同口径
const MAX_FEES = 200;                          // 单次申报费用行上限（对齐 webhook 的 MAX_ITEMS）
const MAX_PARCELS = 500;                       // 单次签收包裹上限
const AGG_WINDOW = 2000;                       // 阶段计数窗口：超过就如实标 capped，不假装全量
const MAX_AUTH_SCAN = 40;                      // 登录兜底扫描行数（每行一次 PBKDF2，见文件头）
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_FAILS = 10;                    // 每 (IP, username) 60s 内最多 10 次失败口令
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const TIMELINE_LIMIT = 50;
const PUSH_LOG_LIMIT = 20;

// ─── 实测枚举域（全部来自 pg_constraint 的 CHECK，不靠记忆） ─────────
// shipments_stage_ck / shipments_push_state_ck / shipments_doc_status_ck /
// shipments_norm_status_ck / shipments_intercept_ck / shipments_label_state_ck /
// parcels_inbound_status_ck / billing_lines_fee_type_ck / billing_lines_charge_unit_ck /
// billing_lines_source_ck / billing_lines_status_ck / work_orders_*_ck / sse_norm_status_ck /
// sse_source_ck / forwarder_auths_auth_state_ck / push_logs_status_ck / push_logs_direction_ck
const STAGES = ['wait_inbound', 'received', 'ready_pack', 'label_ready', 'picking', 'packed', 'handover', 'shipped', 'closed'];
const PUSH_STATES = ['not_pushed', 'pending', 'pushing', 'pushed', 'push_failed', 'dead'];
const DOC_STATUSES = ['valid', 'held', 'cancelled'];
const NORM_STATUSES = ['sending', 'success', 'cancel', 'failed'];
const INTERCEPT_STATES = ['none', 'requested', 'succeeded', 'failed'];
const LABEL_STATES = ['none', 'requested', 'ready', 'failed', 'updated'];
const INBOUND_STATUSES = ['not_inbound', 'in_transit', 'signed', 'partial_signed', 'rejected', 'lost'];
// billing_lines_fee_type_ck 实测 12 值（注意：协议文档 §4.5 的 12 值是旧口径，以库为准）
const FEE_TYPES = ['handling', 'domestic_freight', 'intl_freight', 'packaging', 'storage', 'duty',
  'volumetric_diff', 'surcharge', 'vas', 'return_fee', 'insurance', 'adjustment'];
const CHARGE_UNITS = ['piece', 'order', 'kg', 'cbm', 'manhour', 'flat'];
const AUTH_STATES_BLOCKED = ['revoked', 'expired'];

// 门户可搜索列：必须都是 shipments 表上的真实列（v_shipment_progress 里没有 forwarder_id，
// 关键字查询走 shipments 才能同时把租户 + 货代两道过滤下推到数据库）
const SEARCH_COLS = ['batch_no', 'wms_order_no', 'tracking_no', 'platform_order_no', 'order_id'];

// ─── 需要新增的错误码（push_error_codes 里没有；见交付报告 D2） ──────
const CODE_UNAUTHENTICATED = 'PORTAL_UNAUTHENTICATED';  // 缺头 / 验签失败 / 授权回查不一致
const CODE_TOKEN_EXPIRED = 'PORTAL_TOKEN_EXPIRED';      // exp 已过（前端据此回登录态）
const CODE_LOGIN_FAILED = 'PORTAL_LOGIN_FAILED';        // 用户名或密码不正确（不区分二者）
const CODE_RATE_LIMITED = 'PORTAL_RATE_LIMITED';        // 口令尝试过多
const CODE_INVALID_ARGUMENT = 'INVALID_ARGUMENT';       // 入参非法，字段级原因在 details
const CODE_NOT_FOUND = 'SHIPMENT_NOT_FOUND';            // 按「不存在」处理（含跨租户/跨货代）
const CODE_PARCEL_NOT_FOUND = 'PARCEL_NOT_FOUND';
const CODE_GATE_BLOCKED = 'GATE_BLOCKED';               // 状态机门禁未过
// 复用字典码
const CODE_AUTH_EXPIRED = 'AUTH_EXPIRED';
const CODE_IDEMPOTENT_HIT = 'IDEMPOTENT_HIT';

// ─── 通用工具（入口写法与 forwarder-push 完全一致：Deno.serve + json()） ──
function corsHeaders(extraAllow = ''): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-thalvior-timestamp,'
      + ' x-thalvior-signature, x-thalvior-forwarder-auth, x-thalvior-batch-no, x-thalvior-portal-token'
      + (extraAllow ? `, ${extraAllow}` : ''),
    'Access-Control-Max-Age': '600',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

/** 统一错误出口：结构化 {ok:false, code, message, details}，details 只在安全时才带。 */
function fail(code: string, message: string, status: number, details?: Record<string, unknown>): Response {
  return json({ ok: false, code, message, details: details ?? null }, status);
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

function nowIso(): string { return new Date().toISOString(); }
function sstr(v: unknown): string { return v === null || v === undefined ? '' : String(v); }
function snum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function trunc(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}…(truncated)` : text;
}
function isoOrNull(v: unknown): string | null {
  const t = sstr(v).trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function round(v: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

/**
 * 「今天」的口径 = Asia/Shanghai 的自然日（协议 §1：ERP 侧事件时间按 Asia/Shanghai 归一）。
 * 只用来算日界，不用来改任何存储时间（库里一律 timestamptz/UTC）。
 */
function shanghaiToday(): { date: string; startIso: string; endIso: string } {
  let date = '';
  try {
    date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
  } catch {
    date = '';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // 运行时没有该时区的 ICU 数据时退化为 UTC+8 固定偏移（口径不变，只是不依赖 tz 数据库）
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  const startIso = new Date(`${date}T00:00:00+08:00`).toISOString();
  const endIso = new Date(new Date(`${date}T00:00:00+08:00`).getTime() + 24 * 3600 * 1000).toISOString();
  return { date, startIso, endIso };
}

// ─── base64url / hex / HMAC / SHA-256 ───────────────────────────────
function bytesToB64url(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesFromB64url(s: string) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return raw;
}
function b64urlFromText(text: string): string { return bytesToB64url(new TextEncoder().encode(text)); }
function textFromB64url(s: string): string { return new TextDecoder().decode(bytesFromB64url(s)); }
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}
async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
}
async function sha256Hex(message: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message))));
}
/**
 * 定长比较（不提前返回）：门户令牌与口令摘要都走这里。
 * 理由与 forwarder-webhook 相同 —— 短路比较的耗时随前缀正确程度变化，是可观察的计时侧信道。
 */
function safeEqualHex(a: string, b: string): boolean {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ─── 凭据解密（与 forwarder-push / forwarder-webhook 同一套口径） ───
async function decryptLegacyB64(encB64: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const bin = atob(encB64);
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  const iv = raw.slice(0, 12);                 // base64(iv12 || ct || tag16)
  const cipher = raw.slice(12);
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
}

/** _shared/secret-vault.ts 的解密等价实现（`v1:<b64iv>:<b64ct>` + SECRET_MASTER_KEY）。 */
async function decryptVault(cipher: string): Promise<string> {
  const parts = cipher.split(':');
  if (parts.length !== 3) throw new Error('secret-vault 密文格式应为 vN:<b64iv>:<b64ct>');
  if (parts[0] !== 'v1') throw new Error(`secret-vault 未知封装版本 ${parts[0]}`);
  const master = (Deno.env.get('SECRET_MASTER_KEY') ?? '').trim();
  if (!master) throw new Error('缺少环境变量 SECRET_MASTER_KEY');
  const bytes = bytesFromB64url(master.replace(/-/g, '+').replace(/_/g, '/'));
  if (bytes.length !== 32) throw new Error('SECRET_MASTER_KEY base64 解码后不是 32 字节');
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  return new TextDecoder().decode(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytesFromB64url(parts[1]) }, key, bytesFromB64url(parts[2]),
  ));
}

/** 解出明文字符串；解密失败时原样返回（允许库里存明文过渡态；不因此放宽任何鉴权）。 */
async function decryptSecretText(enc: string): Promise<string> {
  const v = sstr(enc).trim();
  if (!v) return '';
  if (/^v\d+:/.test(v)) { try { return await decryptVault(v); } catch { return v; } }
  try { return await decryptLegacyB64(v, getEnv('JWT_SECRET')); } catch { return v; }
}

async function decryptCreds(enc: string): Promise<Record<string, unknown>> {
  const text = await decryptSecretText(enc);
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* 明文不是 JSON，走下面兜底 */ }
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

// ─── 门户口令 ───────────────────────────────────────────────────────
interface PortalAccount { username: string; password: string; hash: string; }

const USER_KEYS = ['portal_username', 'username', 'login_username', 'account'];
const PASS_KEYS = ['portal_password', 'password', 'pwd'];
const HASH_KEYS = ['portal_password_hash', 'password_hash', 'portal_pwd_hash', 'pwd_hash'];
const HASH_PREFIX = 'pbkdf2-sha256$';   // 迭代轮次由摘要自身携带，本函数只校验不生成

function accountFrom(obj: Record<string, unknown> | null): PortalAccount | null {
  if (!obj) return null;
  const username = pick(obj, USER_KEYS);
  if (!username) return null;
  return { username, password: pick(obj, PASS_KEYS), hash: pick(obj, HASH_KEYS) };
}

/**
 * 从解密后的凭据里取出所有可用门户账号。
 * 支持三种写法（写入口选其一即可，见交付报告 D1）：
 *   1) { portal_users: [{ username, password_hash }, ...] }   ← 多账号，推荐
 *   2) { portal_username, portal_password_hash }               ← 单账号
 *   3) { username, password }                                  ← 明文口令（过渡态，不建议）
 */
function extractAccounts(creds: Record<string, unknown>): PortalAccount[] {
  const out: PortalAccount[] = [];
  const seen = new Set<string>();
  const push = (a: PortalAccount | null) => {
    if (!a) return;
    const k = a.username.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(a);
  };
  const list = creds.portal_users ?? creds.portalAccounts ?? creds.portal;
  if (Array.isArray(list)) {
    for (const it of list) {
      if (it && typeof it === 'object' && !Array.isArray(it)) push(accountFrom(it as Record<string, unknown>));
    }
  } else if (list && typeof list === 'object') {
    push(accountFrom(list as Record<string, unknown>));
  }
  push(accountFrom(creds));
  return out;
}

async function pbkdf2Hex(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const enc = new TextEncoder();
  const saltBytes = new Uint8Array(salt.byteLength);   // 复制成 ArrayBuffer 支撑的切片，见上面说明
  saltBytes.set(salt);
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, keyMat, 256,
  );
  return toHex(new Uint8Array(bits));
}

/**
 * 口令校验。存 hash 时只认自描述格式 `pbkdf2-sha256$<iterations>$<saltB64url>$<hashHex>`：
 * 迭代次数与盐都跟着摘要走，将来调轮次不用改代码，也不会出现「换了参数旧口令失效」。
 */
async function verifyPassword(input: string, account: PortalAccount): Promise<boolean> {
  if (account.hash) {
    const parts = account.hash.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
      console.warn(`[${functionName}] 门户口令摘要格式不认识（prefix=${parts[0]}），拒绝放行`);
      return false;
    }
    const iters = Number(parts[1]);
    if (!Number.isInteger(iters) || iters < 1000 || iters > 2000000) return false;
    let salt: Uint8Array;
    try { salt = bytesFromB64url(parts[2]); } catch { return false; }
    if (salt.length < 8 || salt.length > 64) return false;
    const expected = parts[3].toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expected)) return false;
    return safeEqualHex(await pbkdf2Hex(input, salt, iters), expected);
  }
  if (account.password) return safeEqualHex(
    toHex(new TextEncoder().encode(input)), toHex(new TextEncoder().encode(account.password)),
  );
  return false;
}

// ─── 门户令牌 ───────────────────────────────────────────────────────
interface PortalClaims {
  forwarder_auth_id: string;
  forwarder_id: string;
  user_id: string;
  username: string;
  iat: number;
  exp: number;
}

/** token = base64url(JSON(payload)) + "." + hex(HMAC_SHA256(JWT_SECRET, base64url(payload))) */
async function signToken(ctx: Pick<PortalClaims, 'forwarder_auth_id' | 'forwarder_id' | 'user_id' | 'username'>):
  Promise<{ token: string; claims: PortalClaims; expires_at: string }> {
  const now = Date.now();
  const claims: PortalClaims = {
    forwarder_auth_id: ctx.forwarder_auth_id,
    forwarder_id: ctx.forwarder_id,
    user_id: ctx.user_id,
    username: ctx.username,
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  // 令牌只靠 JWT_SECRET 自证，不查库；库里当前授权行由 resolveContext 每次回查（撤销立刻生效）
  const head = b64urlFromText(JSON.stringify(claims));
  const sig = await hmacHex(getEnv('JWT_SECRET'), head);
  return { token: `${head}.${sig}`, claims, expires_at: new Date(claims.exp).toISOString() };
}

type TokenResult =
  | { kind: 'ok'; claims: PortalClaims }
  | { kind: 'expired' }
  | { kind: 'invalid'; reason: string };

async function verifyToken(raw: string): Promise<TokenResult> {
  const v = raw.trim();
  if (!v) return { kind: 'invalid', reason: 'missing_token' };
  const dot = v.lastIndexOf('.');
  if (dot <= 0 || dot === v.length - 1) return { kind: 'invalid', reason: 'bad_shape' };
  const head = v.slice(0, dot);
  const sig = v.slice(dot + 1).toLowerCase();
  if (!/^[A-Za-z0-9_-]+$/.test(head) || !/^[0-9a-f]{64}$/.test(sig)) return { kind: 'invalid', reason: 'bad_encoding' };
  let expected: string;
  try { expected = await hmacHex(getEnv('JWT_SECRET'), head); } catch (e) {
    // 环境变量缺失 / 密钥不可用 → fail-closed，绝不因为「验不了」而放行
    return { kind: 'invalid', reason: `sign_check_failed:${e instanceof Error ? e.message : 'unknown'}` };
  }
  if (!safeEqualHex(expected, sig)) return { kind: 'invalid', reason: 'signature_mismatch' };
  let claims: PortalClaims;
  try {
    const parsed = JSON.parse(textFromB64url(head)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { kind: 'invalid', reason: 'bad_payload' };
    claims = parsed as PortalClaims;
  } catch { return { kind: 'invalid', reason: 'bad_payload' }; }
  if (!sstr(claims.forwarder_auth_id) || !sstr(claims.forwarder_id) || !sstr(claims.user_id)) {
    return { kind: 'invalid', reason: 'missing_claims' };
  }
  if (!Number.isFinite(claims.exp) || claims.exp <= Date.now()) return { kind: 'expired' };
  return { kind: 'ok', claims };
}

// ─── 上下文（令牌 + 库里当前授权行的合并结果） ──────────────────────
interface Ctx {
  authId: string;
  userId: string;            // 绑定的卖家租户：唯一租户边界
  forwarderId: string;
  forwarderName: string;     // 进 operator 与工单/事件文案
  username: string;
  protocol: string;
  operator: string;          // `PORTAL:<forwarder>/<username>` —— 与 ERP: / auth: 前缀区分开
}

// 判别字段用字符串 kind（不是布尔 ok）：布尔字面量类型在 strictNullChecks 关闭时会被放宽成
// boolean，联合类型就退化成不可判别，调用方 `if (!x.ok) return x.res` 会报「属性不存在」。
async function resolveContext(req: Request, admin: Admin):
  Promise<{ kind: 'ok'; ctx: Ctx } | { kind: 'deny'; res: Response }> {
  const checked = await verifyToken(req.headers.get('X-Thalvior-Portal-Token') ?? '');
  if (checked.kind === 'expired') {
    return { kind: 'deny', res: fail(CODE_TOKEN_EXPIRED, '门户登录已过期，请重新登录', 401) };
  }
  if (checked.kind === 'invalid') {
    console.warn(`[${functionName}] 令牌校验失败：${checked.reason}`);
    return { kind: 'deny', res: fail(CODE_UNAUTHENTICATED, '门户令牌无效，请重新登录', 401) };
  }
  const claims = checked.claims;

  // 回查当前授权行：撤销 / 改绑货代 / 换绑卖家都必须让旧令牌立刻失效
  const { data, error } = await admin.from('forwarder_auths')
    .select('id, user_id, forwarder_id, protocol, auth_state, expires_at')
    .eq('id', claims.forwarder_auth_id).maybeSingle();
  if (error) {
    console.error(`[${functionName}] 授权回查失败：${error.message}`);
    return { kind: 'deny', res: fail(CODE_UNAUTHENTICATED, '门户令牌无效，请重新登录', 401) };
  }
  const row = (data ?? null) as Record<string, unknown> | null;
  if (!row) return { kind: 'deny', res: fail(CODE_UNAUTHENTICATED, '门户令牌无效，请重新登录', 401) };
  if (AUTH_STATES_BLOCKED.includes(sstr(row.auth_state))) {
    return { kind: 'deny', res: fail(CODE_AUTH_EXPIRED, '该货代授权已失效', 403) };
  }
  const exp = sstr(row.expires_at);
  if (exp && Number.isFinite(Date.parse(exp)) && Date.parse(exp) < Date.now()) {
    return { kind: 'deny', res: fail(CODE_AUTH_EXPIRED, '该货代授权已失效', 403) };
  }
  if (sstr(row.user_id) !== claims.user_id || sstr(row.forwarder_id) !== claims.forwarder_id) {
    // 只记日志不外泄细节：payload 与库里不一致说明授权被改绑，旧令牌一律作废
    console.warn(`[${functionName}] 令牌与授权行不一致 auth=${claims.forwarder_auth_id}`);
    return { kind: 'deny', res: fail(CODE_UNAUTHENTICATED, '门户令牌无效，请重新登录', 401) };
  }

  const forwarderId = sstr(row.forwarder_id);
  const { data: fwd, error: fwdErr } = await admin.from('freight_forwarders')
    .select('id, name, code, is_deleted, status').eq('id', forwarderId).maybeSingle();
  if (fwdErr) {
    console.error(`[${functionName}] 货代行查询失败：${fwdErr.message}`);
    return { kind: 'deny', res: fail(CODE_UNAUTHENTICATED, '门户令牌无效，请重新登录', 401) };
  }
  const f = (fwd ?? null) as Record<string, unknown> | null;
  if (!f || f.is_deleted === true) {
    return { kind: 'deny', res: fail(CODE_AUTH_EXPIRED, '该货代已停用或删除', 403) };
  }
  const forwarderName = sstr(f.name) || sstr(f.code) || 'forwarder';
  return {
    kind: 'ok',
    ctx: {
      authId: claims.forwarder_auth_id,
      userId: claims.user_id,
      forwarderId,
      forwarderName,
      username: sstr(claims.username),
      protocol: sstr(row.protocol),
      operator: `PORTAL:${forwarderName}/${claims.username || claims.forwarder_auth_id}`,
    },
  };
}

// ─── 行类型（只声明本文件用到的列，全部经 information_schema 核对） ──
interface ShipmentRow {
  id: string; user_id: string | null; order_id: string | null; forwarder_id: string | null;
  warehouse_id: string | null; channel_id: string | null; shop_id: string | null;
  platform: string | null; site: string | null; platform_order_no: string | null;
  batch_no: string | null; wms_order_no: string | null; tracking_no: string | null; carrier: string | null;
  destination: string | null; push_state: string; stage: string; doc_status: string; norm_status: string;
  raw_status: string | null; intercept_state: string; label_state: string; label_source: string | null;
  estimated_amount: number | string | null; actual_amount: number | string | null; fee_currency: string;
  charged_weight_g: number | string | null; declared_weight_g: number | string | null;
  received_at: string | null; packed_at: string | null; handover_at: string | null; closed_at: string | null;
  pushed_at: string | null; created_at: string | null; remark: string | null;
}

// 视图实测列（不含 forwarder_id / wms_order_no / 重量列，故与 shipments 并排用）
interface ProgressRow {
  shipment_id: string; parcel_total: number | string | null; parcel_signed: number | string | null;
  open_work_orders: number | string | null; forwarder_name: string | null; warehouse_name: string | null;
  channel_name: string | null; platform_order_no: string | null;
}

const SHIPMENT_COLS = 'id, user_id, order_id, forwarder_id, warehouse_id, channel_id, shop_id, platform, site,'
  + ' platform_order_no, batch_no, wms_order_no, tracking_no, carrier, destination, push_state, stage, doc_status,'
  + ' norm_status, raw_status, intercept_state, label_state, label_source, estimated_amount, actual_amount,'
  + ' fee_currency, charged_weight_g, declared_weight_g, received_at, packed_at, handover_at, closed_at,'
  + ' pushed_at, created_at, remark';
const PROGRESS_COLS = 'shipment_id, parcel_total, parcel_signed, open_work_orders, forwarder_name,'
  + ' warehouse_name, channel_name, platform_order_no';
const PARCEL_COLS = 'id, parcel_no, package_number, waybill_no, forwarder_parcel_no, inbound_tracking_no,'
  + ' inbound_status, shipment_id, order_id, weight, length, width, height, signed_at, signed_by, status, created_at';

// ─── 数据闸门（越权 = 不存在） ──────────────────────────────────────
async function findShipment(admin: Admin, ctx: Ctx, shipmentId: string): Promise<ShipmentRow | null> {
  if (!shipmentId) return null;
  const { data, error } = await admin.from('shipments')
    .select(SHIPMENT_COLS).eq('id', shipmentId).eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId)
    .maybeSingle();
  if (error) throw new Error(`查询货件失败：${error.message}`);
  return (data ?? null) as unknown as ShipmentRow | null;
}

/** 阶段边（10 条，静态小表）：一次请求内复用，避免逐行调 RPC。 */
interface Edge { from_stage: string; to_stage: string; requires_gate: string | null; note: string | null; }
async function loadEdges(admin: Admin): Promise<Edge[]> {
  const { data, error } = await admin.from('shipment_stage_transitions')
    .select('from_stage, to_stage, requires_gate, note').order('from_stage', { ascending: true });
  if (error) throw new Error(`读取阶段转移矩阵失败：${error.message}`);
  return (data ?? []) as unknown as Edge[];
}

/**
 * 追溯：写一条 shipment_status_events（raw_status 前缀 PORTAL:）。
 * 失败只打日志，绝不影响业务结果 —— 与 forwarder-push 写推单成功事件的做法一致
 * （业务已落库后再抛错，会让调用方以为失败而重发，反而造成重复入账）。
 * sse_field_completeness_ck 实测要求：success⇒tracking_no 非空、failed⇒failed_reason 非空，
 * 所以这里默认送 'sending'，需要 success 时必须带 tracking_no。
 */
async function writeEvent(
  admin: Admin, ctx: Ctx, shipmentId: string, args: {
    rawStatus: string; norm?: string; stage: string | null; trackingNo?: string | null;
    carrierName?: string | null; failedReason?: string | null; occurredAt?: string | null;
    payload: Record<string, unknown>;
  },
): Promise<string | undefined> {
  const norm = args.norm && NORM_STATUSES.includes(args.norm) ? args.norm : 'sending';
  const row: Record<string, unknown> = {
    user_id: ctx.userId,
    shipment_id: shipmentId,
    raw_status: args.rawStatus,
    norm_status: norm,
    stage: args.stage,
    tracking_no: args.trackingNo ?? null,
    carrier_name: args.carrierName ?? null,
    failed_reason: args.failedReason ?? null,
    operator: ctx.operator,
    source: 'manual',            // sse_source_ck 实测 5 值，没有 portal —— 见文件头说明
    occurred_at: args.occurredAt ?? nowIso(),
    time_zone_id: 'Asia/Shanghai',
    payload: args.payload,
  };
  const { data, error } = await admin.from('shipment_status_events').insert(row).select('id').single();
  if (error) {
    console.error(`[${functionName}] shipment_status_events 写入失败: ${error.message}`);
    return undefined;
  }
  return sstr((data as { id?: string } | null)?.id) || undefined;
}

/**
 * 审计：push_logs(direction='in', action='portal_*')，让卖家侧 forwarder-push 的 list-logs
 * 也能看到货代在门户里做过什么（列域实测：direction∈{out,in}、status∈{pending,success,failed,dead,skipped}）。
 * 快照绝不带口令/密钥/完整令牌。
 */
async function writeAuditLog(
  admin: Admin, ctx: Ctx, args: {
    action: string; shipmentId: string | null; batchNo?: string | null; status: string;
    request: Record<string, unknown>; result: Record<string, unknown>;
    errorCode?: string | null; errorMessage?: string | null; deduped?: boolean; durationMs?: number;
  },
): Promise<void> {
  const { error } = await admin.from('push_logs').insert({
    user_id: ctx.userId,
    direction: 'in',
    action: `portal_${args.action}`,
    batch_no: args.batchNo ?? null,
    shipment_id: args.shipmentId,
    forwarder_id: ctx.forwarderId,
    endpoint: `/functions/v1/${functionName}`,
    request_snapshot: { portal_user: ctx.username, auth_id: ctx.authId, ...args.request },
    response_snapshot: args.result,
    status: args.status,
    error_code: args.errorCode ?? null,
    error_message: args.errorMessage ? trunc(args.errorMessage, 500) : null,
    duration_ms: args.durationMs ?? null,
    deduped: args.deduped === true,
    created_by: null,            // 货代不是平台用户，created_by（uuid）留空，身份在 operator/快照里
    finished_at: nowIso(),
  });
  if (error) console.error(`[${functionName}] push_logs 写入失败: ${error.message}`);
}

/**
 * 账单行落库后同步 actual_amount：与 forwarder-webhook 同口径（重算总和而非累加，天然幂等）。
 * 币种口径（2026-11-17 修正）：actual_amount 是「以 shipments.fee_currency 计的本币合计」，
 * 绝不能把 USD/EUR 行直接加进 CNY 合计。异币行照实写入 billing_lines（审核与对账要看得到），
 * 但不进 actual_amount，另以 foreign_* 字段回给调用方，由卖家决定换汇口径或改 fee_currency。
 * currency 为空的历史行按本币处理（现网 billing_lines.currency 允许空，不能因此丢金额）。
 */
async function syncActualAmount(admin: Admin, ctx: Ctx, sh: ShipmentRow):
  Promise<{ value: number | null; foreignTotal: number; foreignCount: number }> {
  const base = (sstr(sh.fee_currency) || 'CNY').toUpperCase();
  const { data, error } = await admin.from('billing_lines')
    .select('amount, status, currency').eq('user_id', ctx.userId).eq('shipment_id', sh.id);
  if (error) {
    console.error(`[${functionName}] 汇总账单行失败：${error.message}`);
    return { value: null, foreignTotal: 0, foreignCount: 0 };
  }
  const rows = (data ?? []) as unknown as { amount: number | string; status: string; currency: string | null }[];
  const live = rows.filter((r) => r.status !== 'voided' && r.status !== 'rejected');
  const isForeign = (r: { currency: string | null }) => {
    const c = (sstr(r.currency) || '').trim().toUpperCase();
    return c !== '' && c !== base;
  };
  const total = live.filter((r) => !isForeign(r)).reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const foreign = live.filter(isForeign);
  const foreignTotal = round(foreign.reduce((a, r) => a + (Number(r.amount) || 0), 0), 4);
  const value = round(total, 4);                 // actual_amount 实测 numeric(14,4)
  const { error: uErr } = await admin.from('shipments')
    .update({ actual_amount: value, updated_at: nowIso() })
    .eq('id', sh.id).eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId);
  if (uErr) {
    console.error(`[${functionName}] actual_amount 同步失败：${uErr.message}`);
    return { value: null, foreignTotal, foreignCount: foreign.length };
  }
  return { value, foreignTotal, foreignCount: foreign.length };
}

/** 回放判定：按事件 payload 里的 hash 查同货件是否已经做过完全相同的一批动作。 */
async function findEventByHash(admin: Admin, ctx: Ctx, shipmentId: string, hashKey: string, hash: string): Promise<string | null> {
  // 与 forwarder-webhook 同一种 jsonb 路径过滤写法；user_id + shipment_id 两道都带上，
  // 幂等判定本身也不给跨租户留缝隙（货件归属上面已校验，这里只是纵深防御）。
  const { data, error } = await admin.from('shipment_status_events')
    .select('id').eq('shipment_id', shipmentId).eq('user_id', ctx.userId)
    .filter(`payload->>${hashKey}`, 'eq', hash)
    .order('created_at', { ascending: false }).limit(1);
  if (error) {
    console.warn(`[${functionName}] 幂等查询失败，降级为不判定：${error.message}`);
    return null;
  }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  return row ? sstr(row.id) : null;
}

// =====================================================================
// action = login
//   入参 {username, password}；成功签发 12h 门户令牌。
//   闸门：auth_state ∉ {revoked, expired}、expires_at 未到、freight_forwarders.is_deleted ≠ true。
//   凭据缺口：库里没有门户账号列，账号来自 credentials_enc 解密后的 JSON（见文件头）。
// =====================================================================
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function throttleKey(ip: string, username: string): string {
  return `${ip}|${username.toLowerCase()}`;
}
function throttleBlocked(key: string): boolean {
  const hit = loginAttempts.get(key);
  if (!hit) return false;
  if (hit.resetAt <= Date.now()) { loginAttempts.delete(key); return false; }
  return hit.count >= LOGIN_MAX_FAILS;
}
function throttleFail(key: string): void {
  const hit = loginAttempts.get(key);
  if (!hit || hit.resetAt <= Date.now()) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    return;
  }
  hit.count += 1;
}

const AUTH_LOGIN_COLS = 'id, user_id, forwarder_id, protocol, auth_state, external_account, credentials_enc, expires_at';

async function actionLogin(admin: Admin, body: Record<string, unknown>, req: Request):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const username = sstr(body.username).trim();
  const password = sstr(body.password);
  if (!username || !password) {
    return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: '用户名与密码都要填', details: null } };
  }
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const key = throttleKey(ip, username);
  if (throttleBlocked(key)) {
    return { status: 429, body: { ok: false, code: CODE_RATE_LIMITED, message: '尝试次数过多，请稍后再试', details: null } };
  }

  const genericDeny = (): { status: number; body: Record<string, unknown> } => {
    throttleFail(key);
    return { status: 401, body: { ok: false, code: CODE_LOGIN_FAILED, message: '用户名或密码不正确', details: null } };
  };

  // 路径 1：external_account 承载登录名 → 精确命中一行（不解密全表）
  let rows: Record<string, unknown>[] = [];
  const { data: byExt, error: e1 } = await admin.from('forwarder_auths')
    .select(AUTH_LOGIN_COLS).eq('external_account', username);
  if (e1) return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '门户服务暂时不可用', details: null } };
  rows = (byExt ?? []) as unknown as Record<string, unknown>[];
  let scanned = false;

  // 路径 2：登录名写在 credentials_enc 里 → 有界扫描（每行一次 PBKDF2，上限 MAX_AUTH_SCAN）
  if (!rows.length) {
    scanned = true;
    const { data: all, error: e2 } = await admin.from('forwarder_auths')
      .select(AUTH_LOGIN_COLS).order('created_at', { ascending: false }).limit(MAX_AUTH_SCAN);
    if (e2) return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '门户服务暂时不可用', details: null } };
    rows = (all ?? []) as unknown as Record<string, unknown>[];
  }
  if (scanned && rows.length >= MAX_AUTH_SCAN) {
    console.warn(`[${functionName}] 登录兜底扫描触顶 ${MAX_AUTH_SCAN} 行：请把门户登录名同时写入 forwarder_auths.external_account`);
  }

  const wantUser = username.toLowerCase();
  for (const row of rows) {
    const authState = sstr(row.auth_state);
    if (AUTH_STATES_BLOCKED.includes(authState)) continue;
    const exp = sstr(row.expires_at);
    if (exp && Number.isFinite(Date.parse(exp)) && Date.parse(exp) < Date.now()) continue;
    const userId = sstr(row.user_id);
    const forwarderId = sstr(row.forwarder_id);
    if (!userId || !forwarderId) continue;

    const creds = await decryptCreds(sstr(row.credentials_enc));
    const accounts = extractAccounts(creds);
    const matched = accounts.filter((a) => a.username.toLowerCase() === wantUser);
    if (!matched.length) continue;

    let ok = false;
    for (const acc of matched) {
      if (await verifyPassword(password, acc)) { ok = true; break; }
    }
    if (!ok) continue;

    const { data: fwd } = await admin.from('freight_forwarders')
      .select('id, name, code, is_deleted, status').eq('id', forwarderId).maybeSingle();
    const f = (fwd ?? null) as Record<string, unknown> | null;
    if (!f || f.is_deleted === true) {
      // 账号口令都对，但货代已被租户删除：给授权失效码，不另开一条信息泄露面
      return { status: 403, body: { ok: false, code: CODE_AUTH_EXPIRED, message: '该货代已停用或删除', details: null } };
    }

    const signed = await signToken({
      forwarder_auth_id: sstr(row.id), forwarder_id: forwarderId, user_id: userId, username,
    });
    loginAttempts.delete(key);
    await writeAuditLog(admin, {
      authId: sstr(row.id), userId, forwarderId, forwarderName: sstr(f.name) || sstr(f.code) || 'forwarder',
      username, protocol: sstr(row.protocol), operator: `PORTAL:login/${username}`,
    }, {
      action: 'login', shipmentId: null, status: 'success',
      request: { username, credential_mode: 'forwarder_auths' },
      result: { ok: true, expires_at: signed.expires_at },
      deduped: false,
    });
    console.info(`[${functionName}] login ok auth=${sstr(row.id)} forwarder=${forwarderId} user=${userId}`);
    return {
      status: 200,
      body: {
        ok: true,
        token: signed.token,
        token_type: 'portal',
        expires_at: signed.expires_at,
        ttl_seconds: Math.floor(TOKEN_TTL_MS / 1000),
        forwarder: { id: forwarderId, name: sstr(f.name) || '', code: sstr(f.code) || '' },
        account: { username, forwarder_auth_id: sstr(row.id), protocol: sstr(row.protocol) },
        scopes: { stage_filter: STAGES, push_state_filter: PUSH_STATES, doc_status_filter: DOC_STATUSES, search_cols: SEARCH_COLS },
      },
    };
  }
  // 一行都没匹配上：区分「完全没有门户账号配置」与「口令不对」，但对外同一句话
  if (rows.length && scanned) console.warn(`[${functionName}] 门户登录失败（扫描 ${rows.length} 行未命中 username）`);
  return genericDeny();
}

// =====================================================================
// action = whoami —— 前端刷新页面后用已有令牌恢复身份（不重复签发）
// =====================================================================
async function actionWhoami(ctx: Ctx): Promise<{ status: number; body: Record<string, unknown> }> {
  return {
    status: 200,
    body: {
      ok: true,
      forwarder: { id: ctx.forwarderId, name: ctx.forwarderName },
      account: { username: ctx.username, forwarder_auth_id: ctx.authId, protocol: ctx.protocol },
    },
  };
}

// =====================================================================
// action = stats —— 门户首页四张卡：待收货 / 待打包 / 待交接 / 未结工单
//   口径（全部按 stage / doc_status 实况算，不是「今天发生了几次」）：
//     待收货 = stage='wait_inbound'；待打包 = stage∈{received,ready_pack,label_ready}
//     待交接 = stage∈{picking,packed}（picking 视作打包进行中，仍在待交接队列里）
//     未结工单 = work_orders.status ∉ {processed, closed}
//   today_* 另给「今日实际发生的动作数」（received_at/packed_at/handover_at/closed_at 落在
//   Asia/Shanghai 今日区间），这样「今日待收货」这类说法两种读法都有数据，不用前端猜。
// =====================================================================
async function actionStats(admin: Admin, ctx: Ctx): Promise<{ status: number; body: Record<string, unknown> }> {
  const today = shanghaiToday();

  // 1) 队列分布：一次把作用域内的 stage / push_state / doc_status / intercept_state 拉回来在代码里数。
  //    不走 9 次 count 往返；行数按 AGG_WINDOW 封顶并如实标 agg_capped（与 action=shipments 同一口径），
  //    绝不拿"前 2000 条"假装是全量。
  const { data: rows, error: rErr } = await admin.from('shipments')
    .select('stage, push_state, doc_status, intercept_state')
    .eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId)
    .limit(AGG_WINDOW + 1);
  if (rErr) throw new Error(`统计失败：${rErr.message}`);
  const all = (rows ?? []) as unknown as
    { stage: string; push_state: string; doc_status: string; intercept_state: string }[];
  const aggCapped = all.length > AGG_WINDOW;
  const live = all.slice(0, AGG_WINDOW);

  const stageCounts: Record<string, number> = {};
  for (const s of STAGES) stageCounts[s] = 0;
  let cancelled = 0, interceptRequested = 0, pushFailedOrDead = 0, validCount = 0;
  for (const r of live) {
    if (r.doc_status === 'cancelled') cancelled++;
    if (r.intercept_state === 'requested') interceptRequested++;
    if (r.push_state === 'push_failed' || r.push_state === 'dead') pushFailedOrDead++;
    if (r.doc_status === 'valid') {
      validCount++;
      if (Object.prototype.hasOwnProperty.call(stageCounts, r.stage)) stageCounts[r.stage] += 1;
    }
  }

  // 2) 今日已发生的动作 + 未结工单：走数据库 count，不受 AGG_WINDOW 影响（这两项要的是准确数）
  const countShipments = async (mut: (q: any) => any): Promise<number> => {
    const q = admin.from('shipments').select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId);
    const res = await mut(q);
    if (res.error) throw new Error(`统计失败：${res.error.message}`);
    return Number(res.count ?? 0);
  };
  const inDay = (col: string) => (q: any) => q.gte(col, today.startIso).lt(col, today.endIso);
  const [todayReceived, todayPacked, todayHanded, todayClosed, woRes] = await Promise.all([
    countShipments(inDay('received_at')),
    countShipments(inDay('packed_at')),
    countShipments(inDay('handover_at')),
    countShipments(inDay('closed_at')),
    (async () => {
      const { count, error } = await admin.from('work_orders')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId)
        .not('status', 'in', '(processed,closed)');
      if (error) throw new Error(`工单统计失败：${error.message}`);
      return Number(count ?? 0);
    })(),
  ]);

  return {
    status: 200,
    body: {
      ok: true,
      tz: 'Asia/Shanghai',
      today: today.date,
      queue: {
        to_receive: stageCounts.wait_inbound,
        // 待打包：已进入"可以打单/可以打包"的队列；received 还卡在 all_parcels_signed 门禁前，单独给
        to_pack: stageCounts.ready_pack + stageCounts.label_ready,
        to_handover: stageCounts.picking + stageCounts.packed,
        open_work_orders: woRes,
      },
      stage_counts: stageCounts,
      today_done: {
        received: todayReceived, packed: todayPacked, handed_over: todayHanded, closed: todayClosed,
      },
      abnormal: { doc_cancelled: cancelled, intercept_requested: interceptRequested, push_failed_or_dead: pushFailedOrDead },
      agg_capped: aggCapped,
      agg_window: AGG_WINDOW,
      valid_total: validCount,
      note: 'queue / stage_counts / abnormal 只统计窗口内（agg_window）货件，doc_status=cancelled 不进作业队列（铁律2）；today_done 按 Asia/Shanghai 今日区间统计，不受窗口限制。',
    },
  };
}

// =====================================================================
// action = shipments —— 队列：stage / push_state / doc_status / norm_status / 关键字 / 分页
//   数据源：shipments（唯一能同时下推 user_id + forwarder_id 的表）
//          + v_shipment_progress（补 parcel_total / parcel_signed / open_work_orders / 仓库渠道名）
//   关键字只走单列 ilike：PostgREST 条件之间只能是 AND，跨列 or 会把租户过滤一起绕过风险面放大。
// =====================================================================
async function actionShipments(admin: Admin, ctx: Ctx, body: Record<string, unknown>):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const rejected: { field: string; reason: string }[] = [];
  const enumFilter = (name: string, allowed: string[]): string | null => {
    const v = sstr(body[name]).trim();
    if (!v || v === 'all') return null;
    if (!allowed.includes(v)) { rejected.push({ field: name, reason: `不在域内（${allowed.join('|')}），收到 ${v}` }); return null; }
    return v;
  };
  const stage = enumFilter('stage', STAGES);
  const pushState = enumFilter('push_state', PUSH_STATES);
  const docStatus = enumFilter('doc_status', DOC_STATUSES);
  const normStatus = enumFilter('norm_status', NORM_STATUSES);
  const interceptState = enumFilter('intercept_state', INTERCEPT_STATES);
  const labelState = enumFilter('label_state', LABEL_STATES);
  const parcelFilter = sstr(body.parcel_filter).trim();       // 'to_receive' | 'to_pack' | 'to_handover'
  const includeCancelled = body.include_cancelled === true;

  const page = Math.max(1, Number(body.page ?? 1) || 1);
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(body.page_size ?? PAGE_SIZE_DEFAULT) || PAGE_SIZE_DEFAULT));

  let q = admin.from('shipments').select(SHIPMENT_COLS, { count: 'exact' })
    .eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId);
  if (stage) q = q.eq('stage', stage);
  if (pushState) q = q.eq('push_state', pushState);
  if (docStatus) q = q.eq('doc_status', docStatus);
  else if (!includeCancelled) q = q.neq('doc_status', 'cancelled');   // 门户默认不看作废单
  if (normStatus) q = q.eq('norm_status', normStatus);
  if (interceptState) q = q.eq('intercept_state', interceptState);
  if (labelState) q = q.eq('label_state', labelState);
  if (parcelFilter === 'to_receive') q = q.eq('stage', 'wait_inbound');
  if (parcelFilter === 'to_pack') q = q.in('stage', ['received', 'ready_pack', 'label_ready']);
  if (parcelFilter === 'to_handover') q = q.in('stage', ['picking', 'packed']);

  const keyword = sstr(body.keyword).trim();
  const searchCol = sstr(body.search_col).trim() || 'batch_no';
  if (keyword) {
    if (!SEARCH_COLS.includes(searchCol)) {
      rejected.push({ field: 'search_col', reason: `只允许 ${SEARCH_COLS.join('|')}，收到 ${searchCol}` });
    } else {
      // PostgrestFilter 的 ilike 用 % 通配；关键字里的 % 和 _ 必须转义，否则用户输入就变成模式
      const esc = keyword.replace(/[%_]/g, (m: string) => '\\' + m);   // % 与 _ 转义成字面量
      q = q.ilike(searchCol, `%${esc}%`);
    }
  }
  // 默认排序：最新在前（新分下来的货必须先看到）；received_asc 给「按入库时间清队列」用
  const sort = sstr(body.sort).trim() || 'created_at_desc';
  if (sort === 'received_asc') q = q.order('received_at', { ascending: true });
  else if (sort === 'created_at_asc') q = q.order('created_at', { ascending: true });
  else if (sort === 'created_at_desc') q = q.order('created_at', { ascending: false });
  else rejected.push({ field: 'sort', reason: `只支持 created_at_desc | created_at_asc | received_asc，收到 ${sort}` });

  const { data, count, error } = await q.range((page - 1) * pageSize, page * pageSize - 1);
  if (error) {
    return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '货件队列查询失败', details: null } };
  }
  const rows = (data ?? []) as unknown as ShipmentRow[];

  // 视图补齐包裹/工单计数与仓库渠道名（按 user_id + shipment_id 下推，不放大可见范围）
  let progress = new Map<string, ProgressRow>();
  let aggCapped = false;
  let stageCounts: Record<string, number> = {};
  if (rows.length) {
    const ids = rows.map((r) => r.id);
    const { data: pv, error: pvErr } = await admin.from('v_shipment_progress')
      .select(PROGRESS_COLS).eq('user_id', ctx.userId).in('shipment_id', ids);
    if (pvErr) console.warn(`[${functionName}] v_shipment_progress 查询失败，降级为空计数：${pvErr.message}`);
    else progress = new Map(((pv ?? []) as unknown as ProgressRow[]).map((p) => [p.shipment_id, p]));

    const aggQ = await admin.from('shipments').select('stage')
      .eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId).eq('doc_status', 'valid')
      .limit(AGG_WINDOW + 1);
    if (aggQ.error) console.warn(`[${functionName}] 阶段计数失败：${aggQ.error.message}`);
    else {
      const all = (aggQ.data ?? []) as unknown as { stage: string }[];
      aggCapped = all.length > AGG_WINDOW;
      for (const s of STAGES) stageCounts[s] = 0;
      for (const r of all.slice(0, AGG_WINDOW)) {
        if (Object.prototype.hasOwnProperty.call(stageCounts, r.stage)) stageCounts[r.stage] += 1;
      }
    }
  }

  const edges = await loadEdges(admin);
  const out = rows.map((r) => {
    const p = progress.get(r.id);
    const next = edges.filter((e) => e.from_stage === r.stage).map((e) => ({
      to_stage: e.to_stage, requires_gate: e.requires_gate, note: e.note,
    }));
    return {
      shipment_id: r.id,
      order_id: r.order_id,
      platform_order_no: r.platform_order_no ?? (p?.platform_order_no ?? null),
      batch_no: r.batch_no,
      wms_order_no: r.wms_order_no,
      tracking_no: r.tracking_no,
      carrier: r.carrier,
      destination: r.destination,
      stage: r.stage,
      push_state: r.push_state,
      doc_status: r.doc_status,
      norm_status: r.norm_status,
      raw_status: r.raw_status,
      intercept_state: r.intercept_state,
      label_state: r.label_state,
      label_source: r.label_source,
      forwarder_name: p?.forwarder_name ?? ctx.forwarderName,
      warehouse_name: p?.warehouse_name ?? null,
      channel_name: p?.channel_name ?? null,
      parcel_total: Number(p?.parcel_total ?? 0),
      parcel_signed: Number(p?.parcel_signed ?? 0),
      open_work_orders: Number(p?.open_work_orders ?? 0),
      estimated_amount: snum(r.estimated_amount),
      actual_amount: snum(r.actual_amount),
      fee_currency: r.fee_currency,
      charged_weight_g: snum(r.charged_weight_g),
      declared_weight_g: snum(r.declared_weight_g),
      received_at: r.received_at, packed_at: r.packed_at, handover_at: r.handover_at,
      closed_at: r.closed_at, pushed_at: r.pushed_at, created_at: r.created_at,
      remark: r.remark,
      next_stages: next,
    };
  });

  return {
    status: 200,
    body: {
      ok: true,
      page, page_size: pageSize, total: Number(count ?? 0), rows: out,
      stage_counts: stageCounts, agg_capped: aggCapped,
      filter: { stage, push_state: pushState, doc_status: docStatus, keyword, search_col: keyword ? searchCol : null },
      search_cols: SEARCH_COLS,
      rejected,
    },
  };
}

// =====================================================================
// action = shipment_detail —— 单票：主单 + 包裹 + 费用行 + 工单 + 最近推单日志 + 状态时间线
//   时间线走 shipment_status_events（ERP: / PORTAL: / 货代原文 三类都在里面，按时间倒序原样给）
//   advance_options 逐条调 shipment_can_advance：只有一票，RPC 次数 ≤ 出边数（实测 ≤3）
// =====================================================================
async function actionShipmentDetail(admin: Admin, ctx: Ctx, body: Record<string, unknown>):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const shipmentId = sstr(body.shipment_id).trim();
  const sh = await findShipment(admin, ctx, shipmentId);
  if (!sh) return { status: 404, body: { ok: false, code: CODE_NOT_FOUND, message: '货件不存在或不属于本货代', details: null } };

  const edges = await loadEdges(admin);
  const [parcelsRes, billingRes, woRes, logsRes, eventsRes, progRes] = await Promise.all([
    admin.from('parcels').select(PARCEL_COLS).eq('user_id', ctx.userId).eq('shipment_id', sh.id)
      .order('created_at', { ascending: true }),
    admin.from('billing_lines')
      .select('id, fee_type, charge_type, charge_unit, charge_qty, unit_price, amount, currency, weight_charged_g, weight_declared_g, diff_flag, source, status, external_ref, period, statement_id, voided_reason, audited_at, created_at')
      .eq('user_id', ctx.userId).eq('shipment_id', sh.id).order('created_at', { ascending: false }),
    admin.from('work_orders')
      .select('id, type, title, description, status, priority, stage_when_detected, assignee_type, due_at, resolution, created_at, updated_at')
      .eq('user_id', ctx.userId).eq('shipment_id', sh.id).order('created_at', { ascending: false }).limit(50),
    admin.from('push_logs')
      .select('id, direction, action, batch_no, endpoint, status, error_code, error_message, attempt, max_attempts, duration_ms, deduped, created_at, finished_at, response_snapshot')
      .eq('user_id', ctx.userId).eq('shipment_id', sh.id).order('created_at', { ascending: false }).limit(PUSH_LOG_LIMIT),
    admin.from('shipment_status_events')
      .select('id, raw_status, norm_status, stage, tracking_no, carrier_name, failed_reason, operator, source, occurred_at, created_at, payload')
      .eq('shipment_id', sh.id).order('occurred_at', { ascending: false }).limit(TIMELINE_LIMIT),
    admin.from('v_shipment_progress').select(PROGRESS_COLS).eq('user_id', ctx.userId)
      .eq('shipment_id', sh.id).maybeSingle(),
  ]);
  if (parcelsRes.error) console.warn(`[${functionName}] parcels 查询失败：${parcelsRes.error.message}`);
  if (billingRes.error) console.warn(`[${functionName}] billing_lines 查询失败：${billingRes.error.message}`);
  if (woRes.error) console.warn(`[${functionName}] work_orders 查询失败：${woRes.error.message}`);
  if (logsRes.error) console.warn(`[${functionName}] push_logs 查询失败：${logsRes.error.message}`);
  if (eventsRes.error) console.warn(`[${functionName}] 事件查询失败：${eventsRes.error.message}`);

  const advanceOptions: { to_stage: string; allowed: boolean; reason: string | null; gate: string | null; note: string | null }[] = [];
  for (const e of edges.filter((x) => x.from_stage === sh.stage)) {
    const { data, error } = await admin.rpc('shipment_can_advance', { p_shipment_id: sh.id, p_to_stage: e.to_stage });
    if (error) {
      advanceOptions.push({ to_stage: e.to_stage, allowed: false, reason: `shipment_can_advance 调用失败：${error.message}`, gate: e.requires_gate, note: e.note });
      continue;
    }
    const r0 = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    advanceOptions.push({
      to_stage: e.to_stage, allowed: r0?.allowed === true,
      reason: sstr(r0?.reason) || null, gate: sstr(r0?.gate) || e.requires_gate || null, note: e.note,
    });
  }

  const lines = (billingRes.data ?? []) as unknown as Record<string, unknown>[];
  const prog = (progRes.data ?? null) as ProgressRow | null;
  const parcels = (parcelsRes.data ?? []) as unknown as Record<string, unknown>[];

  return {
    status: 200,
    body: {
      ok: true,
      shipment: {
        shipment_id: sh.id, order_id: sh.order_id, platform_order_no: sh.platform_order_no,
        batch_no: sh.batch_no, wms_order_no: sh.wms_order_no, tracking_no: sh.tracking_no, carrier: sh.carrier,
        destination: sh.destination, platform: sh.platform, site: sh.site,
        stage: sh.stage, push_state: sh.push_state, doc_status: sh.doc_status, norm_status: sh.norm_status,
        raw_status: sh.raw_status, intercept_state: sh.intercept_state,
        label_state: sh.label_state, label_source: sh.label_source,
        estimated_amount: snum(sh.estimated_amount), actual_amount: snum(sh.actual_amount),
        fee_currency: sh.fee_currency, charged_weight_g: snum(sh.charged_weight_g),
        declared_weight_g: snum(sh.declared_weight_g),
        received_at: sh.received_at, packed_at: sh.packed_at, handover_at: sh.handover_at,
        closed_at: sh.closed_at, pushed_at: sh.pushed_at, created_at: sh.created_at, remark: sh.remark,
        warehouse_name: prog?.warehouse_name ?? null, channel_name: prog?.channel_name ?? null,
        forwarder_name: prog?.forwarder_name ?? ctx.forwarderName,
        parcel_total: Number(prog?.parcel_total ?? parcels.length),
        parcel_signed: Number(prog?.parcel_signed ?? 0),
        open_work_orders: Number(prog?.open_work_orders ?? 0),
      },
      parcels: parcels.map((p) => ({
        id: sstr(p.id), parcel_no: p.parcel_no ?? null, package_number: p.package_number ?? null,
        waybill_no: p.waybill_no ?? null, forwarder_parcel_no: p.forwarder_parcel_no ?? null,
        inbound_tracking_no: p.inbound_tracking_no ?? null, inbound_status: p.inbound_status ?? null,
        weight: snum(p.weight), length: snum(p.length), width: snum(p.width), height: snum(p.height),
        signed_at: p.signed_at ?? null, signed_by: p.signed_by ?? null, status: p.status ?? null,
      })),
      billing_lines: lines.map((b) => ({
        id: sstr(b.id), fee_type: b.fee_type, charge_type: b.charge_type ?? null,
        charge_unit: b.charge_unit ?? null, charge_qty: snum(b.charge_qty), unit_price: snum(b.unit_price),
        amount: snum(b.amount), currency: b.currency, weight_charged_g: snum(b.weight_charged_g),
        weight_declared_g: snum(b.weight_declared_g), diff_flag: b.diff_flag === true,
        source: b.source, status: b.status, external_ref: b.external_ref ?? null,
        period: b.period ?? null, statement_id: b.statement_id ?? null,
        voided_reason: b.voided_reason ?? null, created_at: b.created_at,
      })),
      work_orders: (woRes.data ?? []) as unknown as Record<string, unknown>[],
      push_logs: (logsRes.data ?? []) as unknown as Record<string, unknown>[],
      timeline: (eventsRes.data ?? []) as unknown as Record<string, unknown>[],
      advance_options: advanceOptions,
      fee_summary: {
        declared_total: round(lines.filter((b) => b.status !== 'voided' && b.status !== 'rejected')
          .reduce((a, b) => a + (Number(b.amount) || 0), 0), 4),
        pending_audit: lines.filter((b) => b.status === 'pending_audit').length,
        diff_flag_lines: lines.filter((b) => b.diff_flag === true).length,
      },
      domains: { stages: STAGES, fee_types: FEE_TYPES, charge_units: CHARGE_UNITS, inbound_statuses: INBOUND_STATUSES },
    },
  };
}

// =====================================================================
// action = receive —— 批量入库签收
//   入参（三者可组合，至少要有一个）：
//     shipment_ids: string[]              → 把这些货件下所有包裹签收
//     parcel_nos:   string[]              → 只签收这些包裹号
//     parcels:      [{parcel_no, weight_g?, length?, width?, height?, inbound_status?}]
//                                        → 带实测重量/尺寸的签收（inbound_status 不给时默认 signed）
//   写 parcels.inbound_status/signed_at/signed_by；stage 交给库触发器（全部 signed 时自动
//   wait_inbound→received 并补 received_at），本函数绝不 update shipments.stage。
// =====================================================================
async function actionReceive(admin: Admin, ctx: Ctx, body: Record<string, unknown>):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const shipmentIds = [...new Set((Array.isArray(body.shipment_ids) ? body.shipment_ids : [])
    .map((x) => sstr(x).trim()).filter(Boolean))].slice(0, MAX_BATCH);
  const parcelNos = [...new Set((Array.isArray(body.parcel_nos) ? body.parcel_nos : [])
    .map((x) => sstr(x).trim()).filter(Boolean))];
  const rawParcels = Array.isArray(body.parcels) ? body.parcels as unknown[] : [];
  const occurredAt = isoOrNull(body.occurred_at);
  const note = trunc(sstr(body.note), 500);

  const wanted = new Map<string, Record<string, unknown>>();
  for (const p of rawParcels) {
    if (!p || typeof p !== 'object') continue;
    const o = p as Record<string, unknown>;
    const no = sstr(o.parcel_no).trim();
    if (no) wanted.set(no, o);
  }
  for (const no of parcelNos) if (!wanted.has(no)) wanted.set(no, {});

  if (!shipmentIds.length && !wanted.size) {
    return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: 'shipment_ids 或 parcel_nos / parcels 至少要有一个', details: null } };
  }

  // 1) 作用域内的货件（一次查完，跨租户/跨货代 id 直接消失）
  const { data: shData, error: shErr } = await admin.from('shipments').select(SHIPMENT_COLS)
    .eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId).in('id', shipmentIds);
  if (shErr) return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '货件查询失败', details: null } };
  const shipments = (shData ?? []) as unknown as ShipmentRow[];
  const shById = new Map(shipments.map((s) => [s.id, s]));
  const notFound: string[] = shipmentIds.filter((id) => !shById.has(id)).map((id) => `shipment:${id}`);

  // 2) 取包裹集合：两条路都只在本租户内查，最后统一用「本货代的货件」这道闸过滤。
  //    包裹号命中的包裹，其父货件可能不在 shipment_ids 里 → 一次批量补查（不逐条往返），
  //    父货件不属于本货代的一律当「不存在」，只进 not_found 清单，不返回也不改（对齐 webhook）。
  const parcelRows: Record<string, unknown>[] = [];
  const seenParcel = new Set<string>();
  const addParcel = (r: Record<string, unknown>): void => {
    const id = sstr(r.id);
    if (id && !seenParcel.has(id)) { seenParcel.add(id); parcelRows.push(r); }
  };
  if (shipmentIds.length) {
    const { data, error } = await admin.from('parcels').select(PARCEL_COLS)
      .eq('user_id', ctx.userId).in('shipment_id', shipmentIds);
    if (error) return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '包裹查询失败', details: null } };
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) addParcel(r);
  }
  if (wanted.size) {
    const nos = [...wanted.keys()];
    if (nos.length > MAX_PARCELS) {
      return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: `单次最多签收 ${MAX_PARCELS} 个包裹`, details: null } };
    }
    const { data, error } = await admin.from('parcels').select(PARCEL_COLS)
      .eq('user_id', ctx.userId).in('parcel_no', nos);
    if (error) return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '包裹查询失败', details: null } };
    const byNo = (data ?? []) as unknown as Record<string, unknown>[];
    const extraShipIds = [...new Set(byNo.map((r) => sstr(r.shipment_id)).filter((id) => id && !shById.has(id)))];
    if (extraShipIds.length) {
      const { data: moreSh, error: msErr } = await admin.from('shipments').select(SHIPMENT_COLS)
        .eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId).in('id', extraShipIds);
      if (msErr) return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '货件查询失败', details: null } };
      for (const s of (moreSh ?? []) as unknown as ShipmentRow[]) shById.set(s.id, s);
    }
    for (const r of byNo) if (shById.has(sstr(r.shipment_id))) addParcel(r);
    const foundNos = new Set(byNo.map((r) => sstr(r.parcel_no)));
    for (const no of nos) if (!foundNos.has(no)) notFound.push(`parcel:${no}`);
  }
  if (!parcelRows.length) {
    return { status: 404, body: { ok: false, code: CODE_PARCEL_NOT_FOUND, message: '没有可签收的包裹（不存在或不属于本货代）', details: { not_found: notFound } } };
  }

  // 3) 逐包裹落签收（已 signed 的不重复写签收时间，只允许补实测尺寸）
  const results: Record<string, unknown>[] = [];
  const rejected: { field: string; reason: string }[] = [];
  const touchedShipments = new Set<string>();
  let signedNow = 0, already = 0, failed = 0;

  for (const p of parcelRows) {
    const parcelNo = sstr(p.parcel_no) || sstr(p.package_number);
    const field = `parcels[${parcelNo || sstr(p.id)}]`;
    const ov = (wanted.get(parcelNo) ?? {}) as Record<string, unknown>;   // 该包裹号携带的实测数据
    const ship = shById.get(sstr(p.shipment_id));
    if (!ship) { rejected.push({ field, reason: '包裹所属货件不在本货代队列内' }); continue; }
    // 铁律2（本文件头承诺过，但 receive 之前漏了这道闸）：单据作废后 parcels 仍被写签收时间，
    // 接着 trg_parcels_signed_sync 会把一张已作废的货件从 wait_inbound 推进 received，
    // 并留一条 norm=sending 的 PORTAL:receive 事件——看板于是同时显示"已作废"和"流转中"。
    if (ship.doc_status === 'cancelled') {
      rejected.push({ field, reason: '单据已作废（doc_status=cancelled），不接收作业动作' });
      continue;
    }

    const statusRaw = sstr(ov.inbound_status).trim();
    const targetStatus = statusRaw || 'signed';
    if (!INBOUND_STATUSES.includes(targetStatus)) {
      rejected.push({ field: `${field}.inbound_status`, reason: `不在 6 值域内（${INBOUND_STATUSES.join('|')}），收到 ${JSON.stringify(statusRaw)}` });
      continue;
    }
    const wasSigned = sstr(p.inbound_status) === 'signed';

    // 实测重量/尺寸先收齐：它们是「已签收的包裹也允许补」的唯一一类字段
    // （重量/尺寸属于测量事实，签收事实一旦被 trg_parcels_signed_sync 消化过就不该再动）
    const meas: Record<string, unknown> = {};
    const measTouched: string[] = [];
    const w = snum(ov.weight_g ?? ov.weight);
    if (w !== null) {
      if (w < 0 || w > 100000000) rejected.push({ field: `${field}.weight_g`, reason: `重量不合理：${w}` });
      else { meas.weight = w; measTouched.push(`weight_g=${w}`); }   // parcels.weight 实测 numeric，单位克（协议 §1）
    }
    for (const key of ['length', 'width', 'height'] as const) {
      const v = snum(ov[key]);
      if (v === null) continue;
      if (v < 0 || v > 100000) { rejected.push({ field: `${field}.${key}`, reason: `尺寸不合理：${v}` }); continue; }
      meas[key] = Math.round(v);                 // 实测 int4 列，四舍五入后写入
      measTouched.push(`${key}=${Math.round(v)}`);
    }

    // 重复签收（已 signed 又报 signed）＝幂等落点：没有任何实测值就一个字节都不写，
    // 有实测值也只补实测列、不碰 inbound_status/signed_at/signed_by —— 否则同一批签收
    // 点两次会把「谁在什么时候收的货」改成最后一次点击的人，追溯就废了。
    if (wasSigned && targetStatus === 'signed') {
      if (measTouched.length) {
        const { error: mErr } = await admin.from('parcels').update({ ...meas, updated_at: nowIso() })
          .eq('id', sstr(p.id)).eq('user_id', ctx.userId);
        if (mErr) { rejected.push({ field, reason: `实测值更新失败：${mErr.message}` }); failed++; continue; }
      }
      already++;
      results.push({
        parcel_id: sstr(p.id), parcel_no: parcelNo || null, shipment_id: ship.id,
        result: 'already_applied', inbound_status: 'signed', applied: measTouched,
      });
      continue;   // 状态没变，trg_parcels_signed_sync 不会被触发，阶段也不必重读
    }

    const patch: Record<string, unknown> = { ...meas, updated_at: nowIso() };
    const touched: string[] = [...measTouched];
    patch.inbound_status = targetStatus;
    touched.push(`inbound_status=${targetStatus}`);
    if (targetStatus === 'signed') {
      patch.signed_at = occurredAt ?? nowIso();
      patch.signed_by = ctx.operator;
      touched.push('signed_at');
    } else if (targetStatus === 'not_inbound' || targetStatus === 'in_transit') {
      patch.signed_at = null;                    // 回退签收就清掉签收时间，否则入库时效报表是假的
    }

    const { error: uErr } = await admin.from('parcels').update(patch)
      .eq('id', sstr(p.id)).eq('user_id', ctx.userId);
    if (uErr) { rejected.push({ field, reason: `更新失败：${uErr.message}` }); failed++; continue; }
    signedNow++;
    touchedShipments.add(ship.id);
    results.push({
      parcel_id: sstr(p.id), parcel_no: parcelNo || null, shipment_id: ship.id,
      result: 'applied', inbound_status: targetStatus, applied: touched,
    });
  }

  // 4) 回读货件（触发器可能已把 wait_inbound 推到 received），按库里真实阶段回报
  const perShipment: Record<string, unknown>[] = [];
  const eventIds: string[] = [];
  for (const id of touchedShipments) {
    const before = shById.get(id);
    const { data: after } = await admin.from('shipments').select('stage, doc_status, received_at, norm_status')
      .eq('id', id).eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId).maybeSingle();
    const { count: total } = await admin.from('parcels').select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId).eq('shipment_id', id);
    const { count: signedCnt } = await admin.from('parcels').select('id', { count: 'exact', head: true })
      .eq('user_id', ctx.userId).eq('shipment_id', id).eq('inbound_status', 'signed');
    const a = (after ?? null) as Record<string, unknown> | null;
    const stageAfter = sstr(a?.stage) || (before?.stage ?? '');
    const autoAdvanced = !!before && !!stageAfter && before.stage !== stageAfter;
    perShipment.push({
      shipment_id: id, batch_no: before?.batch_no ?? null,
      stage_before: before?.stage ?? null, stage_after: stageAfter,
      auto_advanced: autoAdvanced,            // true = trg_parcels_signed_sync 干的，不是本函数改的
      parcel_total: Number(total ?? 0), parcel_signed: Number(signedCnt ?? 0),
      received_at: a?.received_at ?? null,
    });
    const ev = await writeEvent(admin, ctx, id, {
      rawStatus: 'PORTAL:receive', stage: stageAfter || null,
      trackingNo: before?.tracking_no ?? null,
      occurredAt,
      payload: {
        action: 'receive', operator: ctx.operator, note: note || null,
        auth_id: ctx.authId, parcels: results.filter((r) => r.shipment_id === id),
        stage_after: stageAfter, auto_advanced: autoAdvanced,
        parcel_total: Number(total ?? 0), parcel_signed: Number(signedCnt ?? 0),
      },
    });
    if (ev) eventIds.push(ev);
    await writeAuditLog(admin, ctx, {
      action: 'receive', shipmentId: id, batchNo: before?.batch_no ?? null,
      status: results.some((r) => r.shipment_id === id && r.result === 'applied') ? 'success' : 'skipped',
      request: { parcels: results.filter((r) => r.shipment_id === id).map((r) => r.parcel_no) },
      result: { stage_after: stageAfter, parcel_signed: Number(signedCnt ?? 0), parcel_total: Number(total ?? 0) },
      deduped: !results.some((r) => r.shipment_id === id && r.result === 'applied'),
    });
  }

  return {
    status: 200,
    body: {
      ok: true, action: 'receive',
      signed: signedNow, already_applied: already, failed,
      parcels: results, shipments: perShipment, rejected,
      not_found: notFound, status_event_ids: eventIds,
      note: '包裹全部签收后由数据库触发器自动 wait_inbound→received 并补 received_at；本接口不直接改 stage。',
    },
  };
}

// =====================================================================
// action = advance —— 推进到指定 stage（只走 RPC 状态机）
//   入参 {shipment_ids, to_stage, note?, tracking_no?, carrier?}
//     · stage 已等于 to_stage → already_applied（幂等，绝不重复调 RPC / 重复计费）
//     · 门禁没过 → rejected 带 reason + gate，不强跳、不开工单（门户是人当场操作，见文件头铁律3）
//     · tracking_no / carrier 为可选补齐：handover→shipped 的 gate=tracking_no，
//       货代在交接台才拿得到尾程单号，没有这个入口队列会卡死；覆盖必须留痕（同 webhook 做法）。
// =====================================================================
async function actionAdvance(admin: Admin, ctx: Ctx, body: Record<string, unknown>):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const ids = [...new Set((Array.isArray(body.shipment_ids) ? body.shipment_ids : [])
    .map((x) => sstr(x).trim()).filter(Boolean))];
  const toStage = sstr(body.to_stage).trim();
  const note = trunc(sstr(body.note), 500);
  const trackingNo = sstr(body.tracking_no).trim();
  const carrier = sstr(body.carrier).trim();
  const occurredAt = isoOrNull(body.occurred_at);

  if (!ids.length) return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: '缺少 shipment_ids', details: null } };
  if (ids.length > MAX_BATCH) return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: `单次最多推进 ${MAX_BATCH} 条`, details: null } };
  if (!STAGES.includes(toStage)) {
    return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: `to_stage 不在 9 值域内（${STAGES.join('|')}）`, details: { received: toStage } } };
  }

  const { data: shData, error: shErr } = await admin.from('shipments').select(SHIPMENT_COLS)
    .eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId).in('id', ids);
  if (shErr) return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '货件查询失败', details: null } };
  const found = new Map(((shData ?? []) as unknown as ShipmentRow[]).map((s) => [s.id, s]));

  const results: Record<string, unknown>[] = [];
  const notFound = ids.filter((id) => !found.has(id));
  let applied = 0, rejected = 0, already = 0;

  for (const id of ids) {
    const sh = found.get(id);
    if (!sh) continue;
    const rec: Record<string, unknown> = {
      shipment_id: id, batch_no: sh.batch_no, stage_before: sh.stage, to_stage: toStage,
    };

    if (sh.doc_status === 'cancelled') {
      rec.result = 'rejected'; rec.reason = '单据已作废（doc_status=cancelled），不接收作业动作';
      rec.code = CODE_GATE_BLOCKED;
      rejected++; results.push(rec); continue;
    }
    if (sh.stage === toStage) {
      rec.result = 'already_applied'; rec.stage_after = sh.stage;
      already++; results.push(rec);
      await writeAuditLog(admin, ctx, {
        action: 'advance', shipmentId: id, batchNo: sh.batch_no, status: 'skipped',
        request: { to_stage: toStage }, result: { already_applied: true, stage: sh.stage },
        errorCode: CODE_IDEMPOTENT_HIT, errorMessage: `已在目标阶段 ${toStage}`, deduped: true,
      });
      continue;
    }

    // 可选补齐运单号/承运商：必须先于门禁判定，否则 handover→shipped 永远过不去
    let trackingApplied: string | null = null;
    if (trackingNo && trackingNo !== sstr(sh.tracking_no)) {
      const { error: tErr } = await admin.from('shipments')
        .update({ tracking_no: trackingNo, updated_at: nowIso() })
        .eq('id', id).eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId);
      if (tErr) {
        rec.result = 'rejected'; rec.reason = `运单号写入失败：${tErr.message}`;
        rejected++; results.push(rec); continue;
      }
      trackingApplied = trackingNo;
      const oldT = sstr(sh.tracking_no) || null;
      const ev = await writeEvent(admin, ctx, id, {
        rawStatus: 'PORTAL:tracking_set', norm: 'success', stage: sh.stage,
        trackingNo, carrierName: carrier || sstr(sh.carrier) || null, occurredAt,
        payload: { reason: 'tracking_no_set_by_portal', previous_tracking_no: oldT, auth_id: ctx.authId, operator: ctx.operator },
      });
      rec.tracking_event_id = ev ?? null;
      sh.tracking_no = trackingNo;
    }
    if (carrier && carrier !== sstr(sh.carrier)) {
      const { error: cErr } = await admin.from('shipments')
        .update({ carrier, updated_at: nowIso() })
        .eq('id', id).eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId);
      if (!cErr) sh.carrier = carrier; else console.warn(`[${functionName}] carrier 回填失败 ${id}: ${cErr.message}`);
    }

    // 先问门禁再推进：为的是把 reason/gate 原样回给人看（shipment_advance 失败时也只回 message）
    const can = await admin.rpc('shipment_can_advance', { p_shipment_id: id, p_to_stage: toStage });
    if (can.error) {
      rec.result = 'rejected'; rec.reason = `shipment_can_advance 调用失败：${can.error.message}`;
      rejected++; results.push(rec); continue;
    }
    const c0 = (Array.isArray(can.data) ? can.data[0] : can.data) as Record<string, unknown> | undefined;
    if (c0?.allowed !== true) {
      rec.result = 'rejected'; rec.reason = sstr(c0?.reason) || '状态机拒绝';
      rec.gate = sstr(c0?.gate) || null; rec.code = CODE_GATE_BLOCKED;
      rejected++; results.push(rec);
      await writeAuditLog(admin, ctx, {
        action: 'advance', shipmentId: id, batchNo: sh.batch_no, status: 'failed',
        request: { to_stage: toStage }, result: { allowed: false, gate: sstr(c0?.gate) || null },
        errorMessage: sstr(c0?.reason) || 'gate blocked',
      });
      continue;
    }

    const adv = await admin.rpc('shipment_advance', {
      p_shipment_id: id, p_to_stage: toStage, p_operator: ctx.operator, p_note: note || null,
    });
    if (adv.error) {
      rec.result = 'rejected'; rec.reason = `shipment_advance 调用失败：${adv.error.message}`;
      rejected++; results.push(rec); continue;
    }
    const a0 = (Array.isArray(adv.data) ? adv.data[0] : adv.data) as Record<string, unknown> | undefined;
    if (a0?.ok !== true) {
      // can 与 advance 之间被别人改了状态（并发）：如实回绝，不重试、不强跳
      rec.result = 'rejected'; rec.reason = sstr(a0?.message) || 'advance 被拒';
      rejected++; results.push(rec); continue;
    }
    const newStage = sstr(a0?.new_stage) || toStage;
    rec.result = 'applied'; rec.stage_after = newStage; rec.gate = sstr(c0?.gate) || null;
    if (trackingApplied) rec.tracking_no = trackingApplied;
    applied++;

    const ev = await writeEvent(admin, ctx, id, {
      rawStatus: 'PORTAL:advance', stage: newStage,
      trackingNo: sstr(sh.tracking_no) || null, carrierName: sstr(sh.carrier) || null, occurredAt,
      payload: {
        action: 'advance', from: sh.stage, to: newStage, gate: sstr(c0?.gate) || null,
        note: note || null, operator: ctx.operator, auth_id: ctx.authId,
        tracking_no_set: trackingApplied,
      },
    });
    rec.status_event_id = ev ?? null;
    await writeAuditLog(admin, ctx, {
      action: 'advance', shipmentId: id, batchNo: sh.batch_no, status: 'success',
      request: { to_stage: toStage, note: note || null }, result: { applied: true, stage: newStage },
    });
    results.push(rec);   // 成功也必须回一行，否则门户前端拿到 applied=1 却看不到是哪条货件
  }

  const code = applied === 0 && already > 0 ? CODE_IDEMPOTENT_HIT : null;
  return {
    status: 200,
    body: {
      ok: true, action: 'advance', to_stage: toStage,
      total: ids.length, applied, rejected, already_applied: already, not_found: notFound, results, code,
      note: '推进只走数据库状态机 shipment_can_advance / shipment_advance；门禁未过时状态一个字节都不动。',
    },
  };
}

// =====================================================================
// action = declare_fees —— 货代为该货件申报费用行
//   入参 {shipment_id, fees:[{fee_type, amount, currency?, charge_unit?, charge_qty?, unit_price?,
//          weight_charged_g?, weight_declared_g?, parcel_id?, period?}], charged_weight_g?,
//          declared_weight_g?, idempotency_key?, note?}
//   落 billing_lines：source='wms_returned'（实测 4 值域内唯一表示「货代侧来的费用」的取值，
//     与 forwarder-webhook 同口径，便于财务按同一规则审核）、status='pending_audit'（审核权在卖家）。
//   diff_flag 由库触发器算（|计费重-申报重|/申报重 > 5%），本函数不写、只读回来。
//   已审行由 trg_billing_lines_approved_lock 保护 —— 本函数只新增，绝不 update 账单行。
// =====================================================================
async function actionDeclareFees(admin: Admin, ctx: Ctx, body: Record<string, unknown>):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const shipmentId = sstr(body.shipment_id).trim();
  const sh = await findShipment(admin, ctx, shipmentId);
  if (!sh) return { status: 404, body: { ok: false, code: CODE_NOT_FOUND, message: '货件不存在或不属于本货代', details: null } };
  if (sh.doc_status === 'cancelled') {
    return { status: 409, body: { ok: false, code: CODE_GATE_BLOCKED, message: '单据已作废，不再接收费用申报', details: { doc_status: sh.doc_status } } };
  }
  const raw = Array.isArray(body.fees) ? body.fees as unknown[] : [];
  if (!raw.length) return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: 'fees 至少要有一条', details: null } };
  if (raw.length > MAX_FEES) {
    return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: `单次最多申报 ${MAX_FEES} 条费用`, details: null } };
  }
  const note = trunc(sstr(body.note), 500);
  const idemKey = trunc(sstr(body.idempotency_key).trim(), 120);
  const occurredAt = isoOrNull(body.occurred_at);

  const rejected: { field: string; reason: string }[] = [];
  const normalized: Record<string, unknown>[] = [];
  const normForHash: Record<string, unknown>[] = [];

  for (let i = 0; i < raw.length; i++) {
    const f = (raw[i] ?? {}) as Record<string, unknown>;
    const field = `fees[${i}]`;
    const feeType = sstr(f.fee_type).trim();
    const amount = snum(f.amount);
    if (!FEE_TYPES.includes(feeType)) {
      rejected.push({ field: `${field}.fee_type`, reason: `不在 billing_lines_fee_type_ck 的 12 值内（${FEE_TYPES.join('|')}），收到 ${JSON.stringify(f.fee_type)}` });
      continue;
    }
    if (amount === null) { rejected.push({ field: `${field}.amount`, reason: '缺少 amount 或不是数字' }); continue; }
    if (Math.abs(amount) > 100000000) { rejected.push({ field: `${field}.amount`, reason: `金额不合理：${amount}` }); continue; }

    const row: Record<string, unknown> = {
      user_id: ctx.userId, shipment_id: sh.id, fee_type: feeType, amount,
      source: 'wms_returned', status: 'pending_audit',
    };
    const h: Record<string, unknown> = { fee_type: feeType, amount };

    const cur = sstr(f.currency).trim().toUpperCase();
    if (cur) {
      if (!/^[A-Z]{3}$/.test(cur)) rejected.push({ field: `${field}.currency`, reason: `币种应为 3 位字母，收到 ${cur}` });
      else { row.currency = cur; h.currency = cur; }
    }
    const unit = sstr(f.charge_unit).trim();
    if (unit) {
      if (!CHARGE_UNITS.includes(unit)) rejected.push({ field: `${field}.charge_unit`, reason: `不在 6 值内（${CHARGE_UNITS.join('|')}），收到 ${JSON.stringify(f.charge_unit)}` });
      else { row.charge_unit = unit; h.charge_unit = unit; }
    }
    const qty = snum(f.charge_qty);
    if (qty !== null) {
      if (qty < 0) rejected.push({ field: `${field}.charge_qty`, reason: '不能为负（库里 CHECK charge_qty >= 0）' });
      else { row.charge_qty = qty; h.charge_qty = qty; }
    }
    const up = snum(f.unit_price);
    if (up !== null) { row.unit_price = up; h.unit_price = up; }
    const wc = snum(f.weight_charged_g);
    if (wc !== null) {
      if (wc < 0) rejected.push({ field: `${field}.weight_charged_g`, reason: '不能为负' });
      else { row.weight_charged_g = wc; h.weight_charged_g = wc; }        // 单位克（协议 §1）
    }
    const wd = snum(f.weight_declared_g);
    if (wd !== null) {
      if (wd < 0) rejected.push({ field: `${field}.weight_declared_g`, reason: '不能为负' });
      else { row.weight_declared_g = wd; h.weight_declared_g = wd; }
    }
    const pid = sstr(f.parcel_id).trim();
    if (pid) {
      const { data: own } = await admin.from('parcels').select('id').eq('id', pid)
        .eq('user_id', ctx.userId).eq('shipment_id', sh.id).maybeSingle();
      if (!own) rejected.push({ field: `${field}.parcel_id`, reason: '包裹不存在或不属于本货件' });
      else { row.parcel_id = pid; h.parcel_id = pid; }
    }
    const period = sstr(f.period).trim();
    if (period) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || Number.isNaN(Date.parse(period))) {
        rejected.push({ field: `${field}.period`, reason: `period 应为 YYYY-MM-DD，收到 ${period}` });
      } else { row.period = period; h.period = period; }
    }
    const ctype = sstr(f.charge_type).trim();
    if (ctype) { row.charge_type = trunc(ctype, 60); h.charge_type = row.charge_type; }  // 实测无 CHECK，自由文本

    normalized.push(row);
    normForHash.push(h);
  }

  // 幂等：整批费用（+ 显式 key）做 SHA-256 存进事件 payload.fee_hash，命中就一条都不写
  const cw = snum(body.charged_weight_g);
  const dw = snum(body.declared_weight_g);
  const feeHash = await sha256Hex(JSON.stringify({
    shipment_id: sh.id, idempotency_key: idemKey || null,
    fees: normForHash, charged_weight_g: cw, declared_weight_g: dw,
  }));
  // 显式 idempotency_key 优先判定：同 key 换内容必须判冲突，不能当成一次新申报再计一遍费。
  if (idemKey) {
    const { data: keyRows, error: keyErr } = await admin.from('shipment_status_events')
      .select('id, payload').eq('shipment_id', sh.id).eq('user_id', ctx.userId)
      .filter('payload->>idempotency_key', 'eq', idemKey)
      .order('created_at', { ascending: false }).limit(1);
    if (keyErr) {
      console.warn(`[${functionName}] idempotency_key 查重失败，降级为内容判定：${keyErr.message}`);
    } else {
      const kr = (keyRows ?? [])[0] as Record<string, unknown> | undefined;
      if (kr) {
        const prev = (kr.payload ?? {}) as Record<string, unknown>;
        const sameContent = sstr(prev.fee_hash) === feeHash;
        await writeAuditLog(admin, ctx, {
          action: 'declare_fees', shipmentId: sh.id, batchNo: sh.batch_no,
          status: sameContent ? 'skipped' : 'failed',
          request: { count: raw.length, fee_hash: feeHash, idempotency_key: idemKey },
          result: { already_applied: sameContent, first_event_id: sstr(kr.id) },
          errorCode: sameContent ? CODE_IDEMPOTENT_HIT : CODE_INVALID_ARGUMENT,
          errorMessage: sameContent ? '重复申报，已忽略' : '同一 idempotency_key 携带了不同的费用内容',
          deduped: sameContent,
        });
        if (sameContent) {
          return {
            status: 200,
            body: {
              ok: true, action: 'declare_fees', shipment_id: sh.id, already_applied: true,
              first_event_id: sstr(kr.id), inserted: [], rejected,
              actual_amount: snum(sh.actual_amount), code: CODE_IDEMPOTENT_HIT,
              note: '同一 idempotency_key 的重复申报已被拦下，没有新增账单行。',
            },
          };
        }
        return {
          status: 409,
          body: {
            ok: false, code: CODE_INVALID_ARGUMENT,
            message: '同一个 idempotency_key 不能带不同的费用内容；请换 key 重新申报',
            details: { first_event_id: sstr(kr.id), previous_fee_hash: sstr(prev.fee_hash) },
          },
        };
      }
    }
  }
  const hitEvent = await findEventByHash(admin, ctx, sh.id, 'fee_hash', feeHash);
  if (hitEvent) {
    await writeAuditLog(admin, ctx, {
      action: 'declare_fees', shipmentId: sh.id, batchNo: sh.batch_no, status: 'skipped',
      request: { count: raw.length, fee_hash: feeHash }, result: { already_applied: true, first_event_id: hitEvent },
      errorCode: CODE_IDEMPOTENT_HIT, errorMessage: '重复申报，已忽略', deduped: true,
    });
    return {
      status: 200,
      body: {
        ok: true, action: 'declare_fees', shipment_id: sh.id, already_applied: true,
        first_event_id: hitEvent, inserted: [], rejected,
        actual_amount: snum(sh.actual_amount), code: CODE_IDEMPOTENT_HIT,
        note: '同一批费用重复提交不会产生第二条账单行（与货代回传的回放判定同一做法）。',
      },
    };
  }

  if (!normalized.length) {
    return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: '没有一条费用可用', details: { rejected } } };
  }

  const refTag = `PORTAL:${ctx.authId}:${idemKey || feeHash.slice(0, 16)}`;
  const inserted: Record<string, unknown>[] = [];
  const failed: { field: string; reason: string }[] = [];
  for (const row of normalized) {
    const payload = { ...row, external_ref: refTag };
    const { data, error } = await admin.from('billing_lines').insert(payload)
      .select('id, fee_type, amount, currency, diff_flag, status, source').single();
    if (error) { failed.push({ field: `fees(${sstr(row.fee_type)})`, reason: `账单行写入失败：${error.message}` }); continue; }
    const r = (data ?? {}) as Record<string, unknown>;
    inserted.push({
      id: sstr(r.id), fee_type: r.fee_type, amount: snum(r.amount), currency: r.currency,
      diff_flag: r.diff_flag === true, status: r.status, source: r.source,
    });
  }

  const sum = inserted.length ? await syncActualAmount(admin, ctx, sh) : { value: snum(sh.actual_amount), foreignTotal: 0, foreignCount: 0 };
  const actualAmount = sum.value;

  // 货件级计费重/申报重：列实测存在（shipments.charged_weight_g / declared_weight_g numeric(12,3)）
  // 且现网无任何写入方（见交付报告 D4），门户是货代实测重量的自然落点；只在显式给值时写。
  const weightPatch: Record<string, unknown> = {};
  if (cw !== null && cw >= 0) weightPatch.charged_weight_g = round(cw, 3);
  if (dw !== null && dw >= 0) weightPatch.declared_weight_g = round(dw, 3);
  if (Object.keys(weightPatch).length) {
    weightPatch.updated_at = nowIso();
    const { error } = await admin.from('shipments').update(weightPatch)
      .eq('id', sh.id).eq('user_id', ctx.userId).eq('forwarder_id', ctx.forwarderId);
    if (error) failed.push({ field: 'charged_weight_g', reason: `货件级计费重写入失败：${error.message}` });
  }

  let eventId: string | undefined;
  if (inserted.length) {
    eventId = await writeEvent(admin, ctx, sh.id, {
      rawStatus: 'PORTAL:fees_declared', stage: sh.stage,
      trackingNo: sstr(sh.tracking_no) || null, occurredAt,
      payload: {
        action: 'declare_fees', fee_hash: feeHash, idempotency_key: idemKey || null,
        operator: ctx.operator, auth_id: ctx.authId, note: note || null,
        inserted: inserted.map((x) => ({ id: x.id, fee_type: x.fee_type, amount: x.amount, diff_flag: x.diff_flag })),
        actual_amount: actualAmount,
        shipment_weights: Object.keys(weightPatch).length ? weightPatch : null,
      },
    });
    await writeAuditLog(admin, ctx, {
      action: 'declare_fees', shipmentId: sh.id, batchNo: sh.batch_no,
      status: inserted.length ? 'success' : 'failed',
      request: { count: raw.length, usable: normalized.length, fee_hash: feeHash },
      result: { inserted: inserted.length, actual_amount: actualAmount, rejected: rejected.length + failed.length },
      errorMessage: inserted.length ? null : (failed.map((x) => `${x.field}:${x.reason}`).join('; ') || 'nothing inserted'),
    });
  }

  const currencyMixed = inserted.some((x) => sstr(x.currency) && sstr(x.currency) !== sstr(sh.fee_currency));
  return {
    status: 200,
    body: {
      ok: true, action: 'declare_fees', shipment_id: sh.id, already_applied: false,
      inserted, rejected: [...rejected, ...failed],
      actual_amount: actualAmount,
      fee_currency: sh.fee_currency, currency_mixed: currencyMixed,
      foreign_currency_total: sum.foreignTotal, foreign_currency_lines: sum.foreignCount,
      charged_weight_g: weightPatch.charged_weight_g !== undefined ? Number(weightPatch.charged_weight_g) : snum(sh.charged_weight_g),
      declared_weight_g: weightPatch.declared_weight_g !== undefined ? Number(weightPatch.declared_weight_g) : snum(sh.declared_weight_g),
      diff_flag_count: inserted.filter((x) => x.diff_flag === true).length,
      status_event_id: eventId ?? null,
      note: '费用行进入 pending_audit，审核权在卖家；diff_flag 由库触发器按计费重/申报重差异 >5% 计算。',
    },
  };
}

// =====================================================================
// action = intercept_report —— 上报拦截结果（只走 RPC，不改 stage）
//   契约口径：intercept_result 只有 ERP 已发起拦截（intercept_state='requested'）时才有效，
//   否则进 rejected（协议 §8「避免货代单方面宣布拦截成功污染单据状态」）。
//   门户不代替卖家发起拦截（shipment_request_intercept 属 ERP 侧动作），这里只回执。
// =====================================================================
async function actionInterceptReport(admin: Admin, ctx: Ctx, body: Record<string, unknown>):
  Promise<{ status: number; body: Record<string, unknown> }> {
  const shipmentId = sstr(body.shipment_id).trim();
  const result = sstr(body.result).trim();
  const note = trunc(sstr(body.note), 500);
  const sh = await findShipment(admin, ctx, shipmentId);
  if (!sh) return { status: 404, body: { ok: false, code: CODE_NOT_FOUND, message: '货件不存在或不属于本货代', details: null } };
  if (result !== 'succeeded' && result !== 'failed') {
    return { status: 400, body: { ok: false, code: CODE_INVALID_ARGUMENT, message: 'result 只允许 succeeded / failed', details: { received: body.result } } };
  }
  if (sh.intercept_state === result) {
    return {
      status: 200,
      body: {
        ok: true, action: 'intercept_report', shipment_id: sh.id, already_applied: true,
        intercept_state: sh.intercept_state, doc_status: sh.doc_status, code: CODE_IDEMPOTENT_HIT,
        note: '该拦截结果此前已回执过，未重复写入。',
      },
    };
  }

  const { data, error } = await admin.rpc('shipment_set_intercept_result', {
    p_shipment_id: sh.id, p_result: result, p_by: null, p_note: note || `${ctx.operator}${note ? `：${note}` : ''}`,
  });
  if (error) {
    return { status: 500, body: { ok: false, code: 'INTERNAL_ERROR', message: '拦截回执 RPC 调用失败', details: null } };
  }
  const r0 = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  const applied = r0?.ok === true;
  const docStatus = sstr(r0?.doc_status) || sh.doc_status;
  const interceptState = sstr(r0?.intercept_state) || sh.intercept_state;
  const message = sstr(r0?.message);

  const out: Record<string, unknown> = {
    ok: true, action: 'intercept_report', shipment_id: sh.id, applied,
    already_applied: false, result,
    applied_list: applied ? [`intercept_result:${result}`] : [],
    rejected: applied ? [] : [{ field: 'result', reason: message || 'RPC 拒绝' }],
    doc_status: docStatus, intercept_state: interceptState,
    stage: sh.stage, note: applied ? null : (message || null),
  };
  if (applied) {
    // 事件行的 norm 必须与 RPC 落在货件上的那一值同源：2026-11-17 起 RPC 已把
    // 「拦截成功 → cancel」写进 shipments.norm_status，门户这边却还硬编码 sending，
    // 同一秒的两条事件（ERP: 与 PORTAL:）就互相打脸，时间线上看不出这单到底作废了没有。
    const shNorm = sstr(sh.norm_status);
    const evtNorm = result === 'succeeded' ? 'cancel'
      // 拦截失败 = 解冻续跑，货件原来是什么状态就是什么状态；
      // 但 sse_field_completeness_ck 要求 success⇒单号、failed⇒原因，缺一个就降级 sending，
      // 不许让一条追溯事件把整个回执接口撞 CHECK。
      : (shNorm === 'success' && sstr(sh.tracking_no).trim() ? 'success' : shNorm === 'failed' ? 'failed' : 'sending');
    const ev = await writeEvent(admin, ctx, sh.id, {
      rawStatus: `PORTAL:intercept_${result}`,
      norm: evtNorm,
      stage: sh.stage, trackingNo: sstr(sh.tracking_no) || null,
      failedReason: evtNorm === 'failed' ? (note || '货代门户回执：拦截失败，已解冻继续履约')
        : result === 'succeeded' ? (note || '货代门户回执：拦截成功') : null,
      payload: { action: 'intercept_report', result, note: note || null, operator: ctx.operator, auth_id: ctx.authId },
    });
    out.status_event_id = ev ?? null;
  }
  await writeAuditLog(admin, ctx, {
    action: 'intercept_report', shipmentId: sh.id, batchNo: sh.batch_no,
    status: applied ? 'success' : 'skipped',
    request: { result, note: note || null }, result: { applied, doc_status: docStatus, intercept_state: interceptState },
    errorMessage: applied ? null : (message || 'rejected'), deduped: !applied,
  });
  return { status: 200, body: out };
}

// ─── 主入口 ──────────────────────────────────────────────────────────
const ACTIONS = ['login', 'whoami', 'stats', 'shipments', 'shipment_detail', 'receive', 'advance', 'declare_fees', 'intercept_report'];

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  // 浏览器跨域预检：门户是货代直接打开的页面，带自定义头 X-Thalvior-Portal-Token，
  // 必然触发 preflight。forwarder-push/webhook 是系统对系统，不需要这一段。
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  try {
    if (req.method !== 'POST') {
      return fail('METHOD_NOT_ALLOWED', '仅支持 POST 请求', 405);
    }
    const rawBody = await req.text();
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody || '{}') as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail(CODE_INVALID_ARGUMENT, 'BAD_JSON：请求体必须是 JSON 对象', 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return fail(CODE_INVALID_ARGUMENT, 'BAD_JSON：请求体不是合法 JSON', 400);
    }
    const action = sstr(body.action).trim();
    if (!action) return fail(CODE_INVALID_ARGUMENT, '缺少 action', 400);
    if (!ACTIONS.includes(action)) {
      return fail(CODE_INVALID_ARGUMENT, `未知 action: ${action}`, 400, { allowed: ACTIONS });
    }

    const admin = adminClient();
    let r: { status: number; body: Record<string, unknown> };

    if (action === 'login') {
      r = await actionLogin(admin, body, req);
    } else {
      const resolved = await resolveContext(req, admin);
      if (resolved.kind === 'deny') return resolved.res;
      const ctx = resolved.ctx;
      if (action === 'whoami') r = await actionWhoami(ctx);
      else if (action === 'stats') r = await actionStats(admin, ctx);
      else if (action === 'shipments') r = await actionShipments(admin, ctx, body);
      else if (action === 'shipment_detail') r = await actionShipmentDetail(admin, ctx, body);
      else if (action === 'receive') r = await actionReceive(admin, ctx, body);
      else if (action === 'advance') r = await actionAdvance(admin, ctx, body);
      else if (action === 'declare_fees') r = await actionDeclareFees(admin, ctx, body);
      else r = await actionInterceptReport(admin, ctx, body);
    }

    console.info(`[${functionName}] ${requestId} action=${action} → ${r.status} (${Date.now() - startedAt}ms)`);
    return json(r.body, r.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    // 内部异常不外泄细节，也不回显任何凭据/令牌相关信息
    return fail('INTERNAL_ERROR', '门户服务暂时不可用，请稍后重试', 500, { request_id: requestId });
  }
});
