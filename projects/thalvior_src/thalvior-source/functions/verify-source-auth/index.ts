import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 货源授权凭据真实校验 + 安全入库（action = 'save'）
// - 可真实校验的货源平台（Shopify 独立站 / eBay 分销 / Amazon 供应商）：校验通过 → 已授权；失败 → 拒绝保存
// - 其余货源平台（1688/淘宝/国际站/Temu/SHEIN 等）：保存为「待验证」，绝不直接标记已授权
// - 凭据用 JWT_SECRET 派生 AES-GCM 加密后仅存密文，避免明文落库
// 入口：POST /functions/v1/verify-source-auth
// body: { source_name, platform, credentials: { key: value } }

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchWithTimeout(url: string, init: RequestInit, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ---------- 平台白名单（与前端货源平台池一致） ----------
const SOURCE_PLATFORMS = new Set([
  '1688', '淘宝天猫', '拼多多', '义乌购', '广州十三行', '杭州四季青',
  '阿里巴巴国际站', '环球资源', '中国制造网', '敦煌网', '义乌国际商贸城',
  'Amazon 供应商', 'eBay 分销', 'Temu 全托管', 'SHEIN 供应链', 'Coupang', 'Shopee', 'Lazada', 'Mercado Libre',
  '珠三角工厂集群', '长三角工厂集群', '产业带直供',
]);

// ---------- 凭据校验 ----------
async function verifyAmazon(creds: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
  const clientId = String(creds.client_id ?? '').trim();
  const clientSecret = String(creds.client_secret ?? '').trim();
  const refreshToken = String(creds.refresh_token ?? '').trim();
  if (!clientId || !clientSecret || !refreshToken) {
    return { ok: false, msg: '请填写 Amazon SP-API 的 Client ID / Client Secret / Refresh Token' };
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  try {
    const res = await fetchWithTimeout('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await res.json() as Record<string, unknown>;
    if (res.status === 200 && data.access_token) {
      return { ok: true, msg: 'Amazon SP-API 凭据校验通过，已获取访问令牌' };
    }
    return { ok: false, msg: `Amazon 凭据校验失败：${(data.error_description as string) ?? data.error ?? res.status}` };
  } catch (e) {
    return { ok: false, msg: `Amazon 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyShopify(creds: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
  const domain = String(creds.shop_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = String(creds.access_token ?? '').trim();
  if (!domain || !token) {
    return { ok: false, msg: '请填写 Shopify 店铺域名与 Admin API 访问令牌' };
  }
  try {
    const res = await fetchWithTimeout(`https://${domain}/admin/api/2024-01/shop.json`, {
      method: 'GET',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    if (res.status === 200) {
      return { ok: true, msg: 'Shopify 凭据校验通过，已获取店铺信息' };
    }
    return { ok: false, msg: `Shopify 凭据校验失败：HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, msg: `Shopify 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyEBay(creds: Record<string, unknown>): Promise<{ ok: boolean; msg: string }> {
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

// 货源平台校验路由：可校验返回 verifyable=true；其余待验证
async function checkSourcePlatform(platform: string, creds: Record<string, unknown>): Promise<{ verifyable: boolean; ok: boolean; msg: string }> {
  if (platform === 'Shopify' || platform === '独立站') {
    const r = await verifyShopify(creds);
    return { verifyable: true, ok: r.ok, msg: r.msg };
  }
  if (platform === 'eBay 分销' || platform === 'eBay') {
    const r = await verifyEBay(creds);
    return { verifyable: true, ok: r.ok, msg: r.msg };
  }
  if (platform === 'Amazon 供应商' || platform === 'Amazon') {
    const r = await verifyAmazon(creds);
    return { verifyable: true, ok: r.ok, msg: r.msg };
  }
  return { verifyable: false, ok: false, msg: '该货源平台暂不支持自动校验，凭据将保存为「待验证」，确认信息无误后可在平台侧启用' };
}

// ---------- 凭据加密（JWT_SECRET 派生 AES-GCM） ----------
async function encryptCredentials(plain: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-source-cred-v1'), iterations: 100000, hash: 'SHA-256' },
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
    const platform = String(body.platform ?? '').trim();
    const sourceName = String(body.source_name ?? '').trim();
    const credentials = (body.credentials ?? {}) as Record<string, unknown>;

    if (!platform) {
      return json({ error: '缺少 platform' }, 400);
    }
    if (!SOURCE_PLATFORMS.has(platform)) {
      return json({ error: `货源平台「${platform}」不在支持列表内` }, 400);
    }
    if (!sourceName || sourceName.length > 100) {
      return json({ error: '货源名称不能为空且不能超过 100 字符' }, 400);
    }
    // 凭据必须至少有一项
    const credEntries = Object.entries(credentials).filter(([, v]) => typeof v === 'string' && v.trim() !== '');
    if (credEntries.length === 0) {
      return json({ error: '请至少填写一项授权凭据（AppKey / Secret / 令牌等）' }, 400);
    }
    for (const [k, v] of credEntries) {
      if (String(v).length > 500) {
        return json({ error: `凭据字段 ${k} 过长` }, 400);
      }
    }

    const userId = await resolveUserId(req);
    if (!userId) {
      return json({ error: '未登录或登录已过期' }, 401);
    }

    const r = await checkSourcePlatform(platform, credentials);
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

    const encrypted = await encryptCredentials(JSON.stringify(credentials), Deno.env.get('JWT_SECRET') ?? 'thalvior-default-secret');

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error: insertError } = await admin.from('source_auths').insert({
      user_id: userId,
      source_name: sourceName,
      platform,
      status,
      credentials_enc: encrypted,
      verify_note: verifyNote,
      verify_at: new Date().toISOString(),
      authorized_at: status === '已授权' ? new Date().toISOString().slice(0, 10) : null,
    });
    if (insertError) {
      console.error('[verify-source-auth] insert failed', insertError.message);
      return json({ error: `保存货源授权失败：${insertError.message}` }, 500);
    }
    return json({ valid: status === '已授权', verifyable: r.verifyable, status, message: verifyNote });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
