// forwarder-credentials — 货代接口凭据的加密录入与脱敏回读（2026-11-18）
// ============================================================================
// 为什么要有这个函数：
//   「货代管理 → 授权」tab 之前只能填 AppKey / 外部账号 / 回调地址，
//   而真正决定能不能外呼的三样东西——系统授权码、AppSecret、回调验签密钥——
//   在库里是 forwarder_auths.credentials_enc / webhook_secret_enc，
//   前端既没有入口，也不能有：这两个列存的是密文，密钥来自 JWT_SECRET，
//   任何把明文写进浏览器再传上来的路径都必须走服务端加密。
//   forwarder-push 早就在读这两列（缺任一条就直接失败），所以录入端补齐后
//   整条「录入 → 推单签名」链路才闭合。
//
// 契约（POST + 调用者 JWT；service_role 建连 + 代码层 checkPerm，与 bill-import 同套）：
//   action="set"   → checkPerm("logistics.forwarder_auth.bind")
//   action="view"  → checkPerm("logistics.forwarder_auth.view")
//
// 为什么权限和租户都要显式写：
//   所有 EF 都用 SUPABASE_SERVICE_ROLE_KEY 建 client，service_role rolbypassrls=true，
//   RLS 对 EF 完全不生效 → 权限只有 checkPerm 一条路，隔离只有 .eq('user_id', userId) 一条路。
//
// 凭据口径（与 authorize-shop / forwarder-push 完全一致，不能自创）：
//   AES-256-GCM + PBKDF2(SHA-256, 100000, salt='thalvior-cred-v1')，secret=JWT_SECRET，
//   密文布局 base64(iv12 || ct || tag16)。
//
// 明文永不回显：view 只返回「有没有 / 长度 / 尾 4 位」，set 的响应同样只回脱敏摘要。
// 授权码与 AppSecret 会写进请求日志吗？不会——本函数不打任何含明文的日志，
// push_logs / console 里出现的只有脱敏摘要。
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { enforce } from '../_shared/jwt-guard.ts';
import { checkPerm } from '../_shared/perm.ts';

const functionName = 'forwarder-credentials';
const CRED_SALT = 'thalvior-cred-v1';
const PBKDF2_ITER = 100000;

// 允许录入的字段：provider 是明文列（哪家系统），其余进 credentials_enc
const PROVIDERS = ['tfop1', 'huoxiaoyi', 'other'] as const;
type Provider = (typeof PROVIDERS)[number];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    },
  });
}

function err(code: string, message: string, status = 400): Response {
  return json({ ok: false, error_code: code, error: message }, status);
}

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}

function adminClient() {
  return createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

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

const sstr = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const nowIso = (): string => new Date().toISOString();

// ─── 加解密（与 authorize-shop 同口径） ──────────────────────────────
async function deriveKey(secret: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(CRED_SALT), iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMat,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  );
}

async function encryptText(plain: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await deriveKey(secret, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.length);
  let bin = '';
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}

async function decryptText(b64: string, secret: string): Promise<string> {
  if (!b64) return '';
  let bin: string;
  try { bin = atob(b64); } catch { return ''; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length < 28) return '';
  const key = await deriveKey(secret, 'decrypt');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      key,
      bytes.slice(12),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return '';
  }
}

async function readCreds(enc: string, secret: string): Promise<Record<string, unknown>> {
  const plain = await decryptText(sstr(enc), secret);
  if (!plain) return {};
  try {
    const parsed = JSON.parse(plain);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ─── 脱敏 ───────────────────────────────────────────────────────────
function mask(value: unknown): { present: boolean; length: number; tail: string } {
  const v = sstr(value);
  return { present: v !== '', length: v.length, tail: v.length > 4 ? `****${v.slice(-4)}` : v ? '****' : '' };
}

function summary(row: Record<string, unknown>, creds: Record<string, unknown>, webhookSecret: string) {
  const provider = sstr(row.provider) || sstr(creds.provider) || 'tfop1';
  return {
    ok: true,
    auth_id: sstr(row.id),
    forwarder_id: sstr(row.forwarder_id),
    protocol: sstr(row.protocol),
    provider,
    auth_state: sstr(row.auth_state),
    available_state: sstr(row.available_state),
    push_enabled: row.push_enabled !== false,
    callback_url: sstr(row.callback_url),
    expires_at: sstr(row.expires_at),
    has_credentials: sstr(row.credentials_enc) !== '',
    endpoint_url: sstr(creds.endpoint_url) || sstr(row.callback_url),
    app_key: sstr(row.app_key) || sstr(creds.app_key),
    merchant_account: sstr(creds.merchant_account),
    auth_code: mask(creds.auth_code),
    app_secret: mask(creds.app_secret),
    webhook_secret: mask(webhookSecret),
    credentials_updated_at: sstr(creds.updated_at),
    // 适配器状态：货小易/other 目前只登记凭据，真正的报文适配要等对方接口文档
    adapter_ready: provider === 'tfop1',
  };
}

// ─── action=set ─────────────────────────────────────────────────────
async function actSet(userId: string, body: Record<string, unknown>): Promise<Response> {
  const authId = sstr(body.auth_id);
  if (!authId) return err('MISSING_AUTH_ID', '缺少 auth_id（要往哪条货代授权上挂凭据）');

  const admin = adminClient();
  const { data: row, error: qErr } = await admin
    .from('forwarder_auths')
    .select('id, user_id, forwarder_id, protocol, auth_state, available_state, push_enabled, credentials_enc, webhook_secret_enc, app_key, callback_url, expires_at, provider')
    .eq('id', authId).eq('user_id', userId).maybeSingle();
  if (qErr) return err('QUERY_FAILED', `读取货代授权失败：${qErr.message}`, 500);
  if (!row) return err('AUTH_NOT_FOUND', '这条货代授权不存在，或不属于当前账号', 404);

  const secret = getEnv('JWT_SECRET');
  const prev = await readCreds(sstr((row as Record<string, unknown>).credentials_enc), secret);

  // 只覆盖显式给了非空值的字段：留空 = 不改，不是清空（清空走 action=clear）
  const next: Record<string, unknown> = { ...prev };
  const put = (key: string, raw: unknown) => {
    const v = sstr(raw).trim();
    if (v) next[key] = v;
  };
  put('endpoint_url', body.endpoint_url);
  put('auth_code', body.auth_code);
  put('app_secret', body.app_secret);
  put('merchant_account', body.merchant_account);
  put('external_tenant_id', body.external_tenant_id);
  const appKey = sstr(body.app_key).trim();
  if (appKey) next.app_key = appKey;

  const providerRaw = sstr(body.provider).trim();
  const provider: Provider = (PROVIDERS as readonly string[]).includes(providerRaw)
    ? (providerRaw as Provider)
    : (sstr((row as Record<string, unknown>).provider) || sstr(prev.provider) || 'tfop1') as Provider;
  next.provider = provider;
  next.updated_at = nowIso();
  next.updated_by = userId;

  const patch: Record<string, unknown> = {};
  patch.credentials_enc = await encryptText(JSON.stringify(next), secret);
  if (appKey) patch.app_key = appKey;
  if (providerRaw && providerRaw !== sstr((row as Record<string, unknown>).provider)) patch.provider = provider;

  // 回调验签密钥单独落 webhook_secret_enc：forwarder-push 的 TFOP-1 签名就读这一列
  const webhookSecret = sstr(body.webhook_secret).trim();
  if (webhookSecret) patch.webhook_secret_enc = await encryptText(webhookSecret, secret);

  const { error: uErr } = await admin.from('forwarder_auths').update(patch).eq('id', authId).eq('user_id', userId);
  if (uErr) return err('UPDATE_FAILED', `凭据落库失败：${uErr.message}`, 500);

  const after = await readCreds(sstr(patch.credentials_enc), secret);
  return json({
    ...summary({ ...row, ...patch } as Record<string, unknown>, after, webhookSecret || await decryptText(sstr((row as Record<string, unknown>).webhook_secret_enc), secret)),
    changed: Object.keys(patch),
  });
}

// ─── action=view ────────────────────────────────────────────────────
async function actView(userId: string, body: Record<string, unknown>): Promise<Response> {
  const authId = sstr(body.auth_id);
  if (!authId) return err('MISSING_AUTH_ID', '缺少 auth_id');
  const admin = adminClient();
  const { data: row, error: qErr } = await admin
    .from('forwarder_auths')
    .select('id, user_id, forwarder_id, protocol, auth_state, available_state, push_enabled, credentials_enc, webhook_secret_enc, app_key, callback_url, expires_at, provider')
    .eq('id', authId).eq('user_id', userId).maybeSingle();
  if (qErr) return err('QUERY_FAILED', `读取货代授权失败：${qErr.message}`, 500);
  if (!row) return err('AUTH_NOT_FOUND', '这条货代授权不存在，或不属于当前账号', 404);
  const secret = getEnv('JWT_SECRET');
  const creds = await readCreds(sstr((row as Record<string, unknown>).credentials_enc), secret);
  const wsecret = await decryptText(sstr((row as Record<string, unknown>).webhook_secret_enc), secret);
  return json(summary(row as Record<string, unknown>, creds, wsecret));
}

// ─── action=create：建授权行 + 同时录凭据（前端「新增货代授权」用这一条就够） ──
async function actCreate(userId: string, body: Record<string, unknown>): Promise<Response> {
  const forwarderId = sstr(body.forwarder_id);
  if (!forwarderId) return err('MISSING_FORWARDER', '缺少 forward_id / forwarder_id');
  const admin = adminClient();
  const { data: fwd } = await admin.from('freight_forwarders')
    .select('id, name').eq('id', forwarderId).eq('user_id', userId).maybeSingle();
  if (!fwd) return err('FORWARDER_NOT_FOUND', '货代不存在或不属于当前账号', 404);

  const providerRaw = sstr(body.provider).trim() || 'tfop1';
  const provider: Provider = (PROVIDERS as readonly string[]).includes(providerRaw) ? (providerRaw as Provider) : 'other';
  const secret = getEnv('JWT_SECRET');
  const creds: Record<string, unknown> = { provider, updated_at: nowIso(), created_at: nowIso() };
  for (const k of ['endpoint_url', 'auth_code', 'app_secret', 'merchant_account', 'external_tenant_id']) {
    const v = sstr(body[k]).trim();
    if (v) creds[k] = v;
  }
  const appKey = sstr(body.app_key).trim();
  if (appKey) creds.app_key = appKey;

  const insert: Record<string, unknown> = {
    user_id: userId,
    forwarder_id: forwarderId,
    protocol: sstr(body.protocol).trim() || (provider === 'huoxiaoyi' && creds.auth_code ? 'auth_code' : 'appkey_token'),
    external_account: sstr(body.merchant_account).trim() || null,
    external_tenant_id: sstr(body.external_tenant_id).trim() || null,
    app_key: appKey || null,
    callback_url: sstr(body.callback_url).trim() || null,
    provider,
    push_enabled: body.push_enabled !== false,
    // 新建一律从 registered 起步：审核态必须由动作流转，前端不能直接写 approved/authorized
    auth_state: 'registered',
    available_state: 'unknown',
    registered_at: nowIso(),
    credentials_enc: await encryptText(JSON.stringify(creds), secret),
    webhook_secret_enc: sstr(body.webhook_secret).trim()
      ? await encryptText(sstr(body.webhook_secret).trim(), secret)
      : null,
    expires_at: sstr(body.expires_at).trim() ? new Date(sstr(body.expires_at).trim()).toISOString() : null,
  };
  const { data: created, error: iErr } = await admin.from('forwarder_auths').insert(insert).select('id').maybeSingle();
  if (iErr) return err('INSERT_FAILED', `授权行创建失败：${iErr.message}`, 500);

  const view = await actView(userId, { auth_id: sstr(created?.id) });
  const text = await view.text();
  return json({ ...JSON.parse(text), created: true, auth_id: sstr(created?.id) });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }
  { const deny = await enforce(req, 'end-user'); if (deny) return deny; }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return err('BAD_JSON', '请求体不是合法 JSON');
  }

  const userId = await resolveUserId(req);
  if (!userId) return err('UNAUTHENTICATED', '未登录或令牌无效', 401);

  const action = sstr(body.action);
  const permKey = action === 'set' || action === 'create'
    ? 'logistics.forwarder_auth.bind'
    : 'logistics.forwarder_auth.view';
  const gate = await checkPerm(req, permKey);
  if (!gate.allowed) {
    return err('PERM_DENIED', `没有权限点 ${permKey}${gate.error ? `（${gate.error}）` : ''}`, 403);
  }

  try {
    if (action === 'set') return await actSet(userId, body);
    if (action === 'view') return await actView(userId, body);
    if (action === 'create') return await actCreate(userId, body);
    return err('UNKNOWN_ACTION', `未知 action：${action || '(空)'}，支持 set / view / create`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${functionName}] ${action} 异常：${msg}`);
    return err('INTERNAL', msg, 500);
  }
});
