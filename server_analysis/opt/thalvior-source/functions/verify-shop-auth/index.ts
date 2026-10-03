// 手动授权凭据真实校验 + 安全入库
// action = 'verify' | 'save'
// - verify：仅校验用户填写的平台凭据是否有效（直连平台官方验证端点，不依赖系统级平台密钥）
// - save  ：校验通过后，用 JWT_SECRET 派生 AES-GCM 密钥加密凭据，由 service role 写入 shop_auths
// 支持真实校验的平台：
//   Amazon (SP-API LWA)  : POST https://api.amazon.com/auth/o2/token（refresh_token 换 access_token）
//   Walmart              : POST https://marketplace.walmartapis.com/v3/token（client_credentials）
//   Etsy                 : GET  https://openapi.etsy.com/v3/application/openapi-ping（x-api-key）
// eBay / Temu / SHEIN / AliExpress：暂无稳定公开验证端点 → verifyable=false，保存为「待验证」
//
// 2026-09-28 增强：
//   1) 平台真实性校验：platform 必须是 platform_configs 表中启用的平台（或内置白名单），
//      未知平台一律 400 拦截，杜绝向任意字符串写入假授权。
//   2) 参数合法性校验：shop_name/region/凭据值类型与长度统一校验，超长/非法输入直接拦截。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readJson<T>(data: Record<string, unknown>, key: string): T | undefined {
  return data[key] as T | undefined;
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

// ---------- 平台真实性校验 ----------

// 内置白名单：与 platform_configs 保持一致，表读取失败/无权限时兜底
const BUILTIN_PLATFORMS = new Set([
  'Shopify', 'TikTok Shop', 'Lazada', 'Shopee',
  'Amazon US', 'Amazon JP', 'Amazon EU',
  'eBay', 'Walmart', 'Etsy', 'Temu', 'SHEIN', 'AliExpress',
]);

async function assertRealPlatform(platform: string): Promise<string | null> {
  // 1) 优先查库：platform_configs 中启用状态
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data, error } = await admin
      .from('platform_configs')
      .select('name, status')
      .eq('name', platform)
      .maybeSingle();
    if (error) {
      // 查库失败（权限/网络），走白名单
      return BUILTIN_PLATFORMS.has(platform) ? platform : null;
    }
    if (data && String(data.status ?? '启用') !== '停用') {
      return platform;
    }
    return null;
  } catch {
    return BUILTIN_PLATFORMS.has(platform) ? platform : null;
  }
}

// ---------- 参数合法性校验 ----------

const MAX_SHOP_NAME = 100;
const MAX_REGION = 50;
const MAX_CRED_VALUE = 256;
const MAX_CRED_FIELDS = 20;

function validatePayload(platform: string, shopName: string, region: string, credentials: Record<string, unknown>): string | null {
  if (!platform || platform.length > 60) {
    return '平台参数非法';
  }
  if (!shopName || shopName.length > MAX_SHOP_NAME) {
    return `店铺名称不能为空且不超过 ${MAX_SHOP_NAME} 字符`;
  }
  if (region.length > MAX_REGION) {
    return `地区不能超过 ${MAX_REGION} 字符`;
  }
  if (typeof credentials !== 'object' || credentials === null || Array.isArray(credentials)) {
    return '凭据格式非法';
  }
  const keys = Object.keys(credentials);
  if (keys.length === 0) {
    return '请至少填写一项平台凭据';
  }
  if (keys.length > MAX_CRED_FIELDS) {
    return '凭据字段过多';
  }
  for (const [k, v] of Object.entries(credentials)) {
    if (k.length > 64) return '凭据字段名非法';
    if (typeof v !== 'string' && typeof v !== 'number') {
      return `凭据字段 ${k} 格式非法`;
    }
    const s = String(v);
    if (s.length > MAX_CRED_VALUE) {
      return `凭据字段 ${k} 超过 ${MAX_CRED_VALUE} 字符`;
    }
    // 阻止明显的换行/控制字符注入
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) {
      return `凭据字段 ${k} 包含非法控制字符`;
    }
  }
  return null;
}

// ---------- 各平台校验 ----------

async function verifyAmazon(creds: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
  const clientId = readJson<string>(creds, 'client_id')?.trim() ?? '';
  const clientSecret = readJson<string>(creds, 'client_secret')?.trim() ?? '';
  const refreshToken = readJson<string>(creds, 'refresh_token')?.trim() ?? '';
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, msg: '请完整填写 Client ID、Client Secret、Refresh Token' };
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  try {
    const res = await fetchWithTimeout('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && data.access_token) {
      return { ok: true, msg: 'Amazon 凭据有效' };
    }
    return { ok: false, msg: `Amazon 凭据校验失败：${(data.error_description as string) ?? data.error ?? res.status}` };
  } catch (e) {
    return { ok: false, msg: `Amazon 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyWalmart(creds: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
  const clientId = readJson<string>(creds, 'client_id')?.trim() ?? '';
  const clientSecret = readJson<string>(creds, 'client_secret')?.trim() ?? '';
  if (!clientId || !clientSecret) {
    return { ok: false, msg: '请完整填写 Client ID、Client Secret' };
  }
  const basic = btoa(`${clientId}:${clientSecret}`);
  try {
    const res = await fetchWithTimeout('https://marketplace.walmartapis.com/v3/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && data.access_token) {
      return { ok: true, msg: 'Walmart 凭据有效' };
    }
    return { ok: false, msg: `Walmart 凭据校验失败：${(data.error_description as string) ?? data.error ?? res.status}` };
  } catch (e) {
    return { ok: false, msg: `Walmart 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyEtsy(creds: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
  const apiKey = readJson<string>(creds, 'api_key')?.trim() ?? '';
  if (!apiKey) {
    return { ok: false, msg: '请填写 Etsy API Key' };
  }
  try {
    const res = await fetchWithTimeout('https://openapi.etsy.com/v3/application/openapi-ping', {
      method: 'GET',
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    if (res.ok) {
      return { ok: true, msg: 'Etsy 凭据有效' };
    }
    return { ok: false, msg: `Etsy 凭据校验失败：HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, msg: `Etsy 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyShopify(creds: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
  // 手动授权：店铺域名 + Admin API 访问令牌 → 调 /admin/api/*/shop.json 验证令牌是否有效
  const domain = String(creds.shop_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = String(creds.access_token ?? '').trim();
  if (!domain || !token) {
    return { ok: false, msg: '请填写 Shopify 店铺域名与 Admin API 访问令牌' };
  }
  try {
    const res = await fetchWithTimeout(`https://${domain}/admin/api/2024-01/shop.json`, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 200) {
      return { ok: true, msg: 'Shopify 凭据校验通过，已获取店铺信息' };
    }
    let detail = '';
    try {
      const d = await res.json();
      detail = (d?.errors && JSON.stringify(d.errors)) || '';
    } catch { /* ignore */ }
    return { ok: false, msg: `Shopify 凭据校验失败：HTTP ${res.status}${detail ? ' ' + detail.slice(0, 120) : ''}` };
  } catch (e) {
    return { ok: false, msg: `Shopify 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyEBay(creds: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
  // eBay Trading API GeteBayOfficialTime：用 dev_id + app_id + cert_id + auth_token 验证令牌有效性
  const devId = String(creds.dev_id ?? '').trim();
  const appId = String(creds.app_id ?? '').trim();
  const certId = String(creds.cert_id ?? '').trim();
  const authToken = String(creds.auth_token ?? '').trim();
  if (!devId || !appId || !certId || !authToken) {
    return { ok: false, msg: '请填写 eBay 的 Dev ID / App ID / Cert ID / 授权令牌' };
  }
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayOfficialTimeRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${authToken.replace(/[<>&]/g, '')}</eBayAuthToken>
  </RequesterCredentials>
</GeteBayOfficialTimeRequest>`;
  try {
    const res = await fetchWithTimeout('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-DEVELOPER-ID': devId,
        'X-EBAY-API-APPLICATION-ID': appId,
        'X-EBAY-API-CERTIFICATE-ID': certId,
        'X-EBAY-API-CALL-NAME': 'GeteBayOfficialTime',
        'X-EBAY-API-SITEID': '0',
        'Content-Type': 'text/xml; charset=utf-8',
      },
      body: xml,
    });
    const text = await res.text();
    if (/Ack>Success</.test(text)) {
      return { ok: true, msg: 'eBay 授权令牌校验通过（GeteBayOfficialTime Success）' };
    }
    const err = text.match(/ShortMessage>([^<]+)</)?.[1] ?? `HTTP ${res.status}`;
    return { ok: false, msg: `eBay 授权令牌校验失败：${err}` };
  } catch (e) {
    return { ok: false, msg: `eBay 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

// 依据平台返回校验结果；不可校验平台 verifyable=false
async function checkPlatform(platform: string, creds: Record<string, unknown>): Promise<{ verifyable: boolean; ok: boolean; msg: string }> {
  switch (platform) {
    case 'Amazon US':
    case 'Amazon JP':
    case 'Amazon EU': {
      const r = await verifyAmazon(creds);
      return { verifyable: true, ok: r.ok, msg: r.msg };
    }
    case 'Walmart': {
      const r = await verifyWalmart(creds);
      return { verifyable: true, ok: r.ok, msg: r.msg };
    }
    case 'Etsy': {
      const r = await verifyEtsy(creds);
      return { verifyable: true, ok: r.ok, msg: r.msg };
    }
    case 'Shopify': {
      const r = await verifyShopify(creds);
      return { verifyable: true, ok: r.ok, msg: r.msg };
    }
    case 'eBay': {
      const r = await verifyEBay(creds);
      return { verifyable: true, ok: r.ok, msg: r.msg };
    }
    default: {
      return { verifyable: false, ok: false, msg: '该平台暂不支持自动校验，凭据将保存为「待验证」' };
    }
  }
}

// ---------- 凭据加密（JWT_SECRET 派生 AES-GCM） ----------

async function encryptCredentials(plain: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-shop-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  const buf = new Uint8Array(cipher);
  const out = new Uint8Array(iv.length + buf.length);
  out.set(iv, 0);
  out.set(buf, iv.length);
  let bin = '';
  out.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

// ---------- 登录用户解析 ----------

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: '仅支持 POST 请求' }, 405);
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = readJson<string>(body, 'action') ?? 'verify';
    const platform = readJson<string>(body, 'platform')?.trim() ?? '';
    const credentials = (body.credentials ?? {}) as Record<string, unknown>;
    const shopName = readJson<string>(body, 'shop_name')?.trim() ?? '';
    const region = readJson<string>(body, 'region')?.trim() ?? '';

    if (!platform) {
      return json({ error: '缺少 platform' }, 400);
    }

    // 平台真实性校验：非真实平台直接拦截，杜绝假授权
    const realPlatform = await assertRealPlatform(platform);
    if (!realPlatform) {
      return json({ error: `平台「${platform}」不存在或已停用，无法授权` }, 400);
    }

    // 参数合法性校验（save 才要求 shop_name）
    const payloadErr = validatePayload(platform, action === 'save' ? shopName : 'x', region, credentials);
    if (payloadErr) {
      return json({ error: payloadErr }, 400);
    }

    // 只校验
    if (action === 'verify') {
      const r = await checkPlatform(realPlatform, credentials);
      return json({ valid: r.ok, verifyable: r.verifyable, message: r.msg });
    }

    // 校验 + 入库
    if (action === 'save') {
      const userId = await resolveUserId(req);
      if (!userId) {
        return json({ error: '未登录或登录已过期' }, 401);
      }

      const r = await checkPlatform(realPlatform, credentials);
      let status: string;
      let verifyNote: string;
      if (r.verifyable) {
        if (!r.ok) {
          return json({ valid: false, verifyable: true, message: r.msg }, 400);
        }
        status = '已授权';
        verifyNote = r.msg;
      } else {
        status = '待验证';
        verifyNote = r.msg;
      }

      // 加密凭据（仅密文落库）
      const encrypted = await encryptCredentials(JSON.stringify(credentials), Deno.env.get('JWT_SECRET') ?? 'thalvior-default-secret');

      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      const { error: insertError } = await admin.from('shop_auths').insert({
        user_id: userId,
        shop_name: shopName,
        platform: realPlatform,
        region: region || '',
        status,
        credentials_enc: encrypted,
        verify_note: verifyNote,
        verify_at: new Date().toISOString(),
        authorized_at: status === '已授权' ? new Date().toISOString().slice(0, 10) : null,
      });
      if (insertError) {
        console.error('[verify-shop-auth] insert failed', insertError.message);
        return json({ error: `保存授权失败：${insertError.message}` }, 500);
      }
      return json({ valid: status === '已授权', verifyable: r.verifyable, status, message: verifyNote });
    }

    return json({ error: '未知 action' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
