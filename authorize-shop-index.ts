// authorize-shop — 统一店铺/货源授权入口
// ==========================================
// 一个入口覆盖 OAuth 型和手动型，由 platform_configs.auth_type 决定路径
//
// 动作（action）:
//   oauth-url      → 返回 OAuth 跳转 URL（oauth 型平台）
//   oauth-callback → code 换 token + 入库（oauth 型平台）
//   cred-verify    → 仅校验手动凭据（manual 型）
//   cred-save      → 校验 + 加密 + 入库（manual 型）
//   list           → 当前用户所有授权列表
//   delete         → 删除一个授权
//
// 平台凭据加密（AES-GCM / PBKDF2）：secret 来自 JWT_SECRET，盐分两类：
//   oauth 型：直接存取 token（不需要加密）
//   manual 型：credentials_enc（加密后落库）
//
// 环境变量：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET （通用）
//   SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_REDIRECT_URI
//   TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_REDIRECT_URI

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const functionName = 'authorize-shop';

// ─── 通用工具 ────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
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

// 查 platform_configs 拿 auth_type（oauth | manual）
async function getPlatformInfo(platform: string): Promise<{ name: string; auth_type: string; status: string } | null> {
  try {
    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
    const { data, error } = await admin
      .from('platform_configs')
      .select('name, auth_type, status')
      .eq('name', platform)
      .maybeSingle();
    if (error || !data) return null;
    if (String(data.status ?? '启用') === '停用') return null;
    return { name: data.name, auth_type: data.auth_type ?? 'manual', status: data.status };
  } catch {
    return null;
  }
}

// ─── 凭据加密（手动型用） ────────────────────────────────────────────
async function encryptCredentials(plain: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('thalvior-cred-v1'), iterations: 100000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  const out = new Uint8Array(iv.length + cipher.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(cipher), iv.length);
  let bin = '';
  out.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

// ─── OAuth 平台实现（Shopify / TikTok Shop） ──────────────────────────
function shopifyAuthorizeUrl(shop: string): string {
  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
  const redirectUri = Deno.env.get('SHOPIFY_REDIRECT_URI');
  if (!clientId || !redirectUri) throw new Error('Shopify OAuth 未配置');
  return (
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent('read_products,read_orders,read_customers')}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${crypto.randomUUID()}`
  );
}

async function shopifyCallback(shop: string, code: string): Promise<{ accessToken: string; scope: string }> {
  const clientId = getEnv('SHOPIFY_CLIENT_ID');
  const clientSecret = getEnv('SHOPIFY_CLIENT_SECRET');
  const res = await fetchWithTimeout(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error('Shopify token exchange 失败');
  const d = (await res.json()) as { access_token?: string; scope?: string };
  if (!d.access_token) throw new Error('Shopify 未返回 access_token');
  return { accessToken: d.access_token, scope: d.scope ?? '' };
}

function tiktokAuthorizeUrl(): string {
  const appKey = Deno.env.get('TIKTOK_APP_KEY');
  const redirectUri = Deno.env.get('TIKTOK_REDIRECT_URI');
  if (!appKey || !redirectUri) throw new Error('TikTok Shop OAuth 未配置');
  return (
    `https://open-api.tiktokglobalshop.com/authorize` +
    `?app_key=${encodeURIComponent(appKey)}` +
    `&state=${crypto.randomUUID()}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`
  );
}

async function tiktokCallback(code: string): Promise<{ accessToken: string; shopName: string; region: string }> {
  const appKey = getEnv('TIKTOK_APP_KEY');
  const appSecret = getEnv('TIKTOK_APP_SECRET');

  const tr = await fetchWithTimeout('https://open-api.tiktokglobalshop.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret, auth_code: code, grant_type: 'authorized_code' }),
  });
  const td = (await tr.json().catch(() => ({}))) as { data?: { access_token?: string } };
  if (!tr.ok || !td?.data?.access_token) throw new Error('TikTok Shop token exchange 失败');
  const accessToken = td.data.access_token;

  const sr = await fetchWithTimeout(
    `https://open-api.tiktokglobalshop.com/api/shop/get_authorized_shop?app_key=${encodeURIComponent(appKey)}&secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(accessToken)}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } },
  );
  const sd = (await sr.json().catch(() => ({}))) as { data?: { shops?: Array<{ name?: string; region?: string }> } };
  const first = sd?.data?.shops?.[0] ?? {};
  return { accessToken, shopName: first.name ?? 'TikTok Shop 店铺', region: first.region ?? '短视频电商' };
}

// Lazada / Shopee OAuth 占位（配置密钥后启用）
function oauthNotReady(platform: string): never {
  throw new Error(`${platform} 一键授权接入中，请先使用手动授权或联系管理员配置 OAuth 密钥`);
}

// ─── 手动凭据校验（各平台直连 API 验证） ──────────────────────────────
type VerifyResult = { verifyable: boolean; ok: boolean; msg: string };

async function verifyAmazon(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientId = String(c.client_id ?? '').trim();
  const clientSecret = String(c.client_secret ?? '').trim();
  const refreshToken = String(c.refresh_token ?? '').trim();
  if (!clientId || !clientSecret || !refreshToken)
    return { verifyable: true, ok: false, msg: '请完整填写 Client ID / Client Secret / Refresh Token' };
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
  try {
    const r = await fetchWithTimeout('https://api.amazon.com/auth/o2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return r.ok && d.access_token
      ? { verifyable: true, ok: true, msg: 'Amazon 凭据有效' }
      : { verifyable: true, ok: false, msg: `Amazon 校验失败：${(d.error_description as string) ?? r.status}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Amazon 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyWalmart(c: Record<string, unknown>): Promise<VerifyResult> {
  const clientId = String(c.client_id ?? '').trim();
  const clientSecret = String(c.client_secret ?? '').trim();
  if (!clientId || !clientSecret)
    return { verifyable: true, ok: false, msg: '请完整填写 Client ID / Client Secret' };
  const basic = btoa(`${clientId}:${clientSecret}`);
  try {
    const r = await fetchWithTimeout('https://marketplace.walmartapis.com/v3/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`, Accept: 'application/json' },
      body: 'grant_type=client_credentials',
    });
    const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return r.ok && d.access_token
      ? { verifyable: true, ok: true, msg: 'Walmart 凭据有效' }
      : { verifyable: true, ok: false, msg: `Walmart 校验失败：${(d.error_description as string) ?? r.status}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Walmart 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyEtsy(c: Record<string, unknown>): Promise<VerifyResult> {
  const apiKey = String(c.api_key ?? '').trim();
  if (!apiKey) return { verifyable: true, ok: false, msg: '请填写 Etsy API Key' };
  try {
    const r = await fetchWithTimeout('https://openapi.etsy.com/v3/application/openapi-ping', {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    });
    return r.ok
      ? { verifyable: true, ok: true, msg: 'Etsy 凭据有效' }
      : { verifyable: true, ok: false, msg: `Etsy 校验失败：HTTP ${r.status}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Etsy 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyShopify(c: Record<string, unknown>): Promise<VerifyResult> {
  const domain = String(c.shop_domain ?? '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = String(c.access_token ?? '').trim();
  if (!domain || !token)
    return { verifyable: true, ok: false, msg: '请填写 Shopify 店铺域名与 Admin API 访问令牌' };
  try {
    const r = await fetchWithTimeout(`https://${domain}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    return r.status === 200
      ? { verifyable: true, ok: true, msg: 'Shopify 凭据校验通过' }
      : { verifyable: true, ok: false, msg: `Shopify 校验失败：HTTP ${r.status}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `Shopify 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

async function verifyEBay(c: Record<string, unknown>): Promise<VerifyResult> {
  const devId = String(c.dev_id ?? '').trim();
  const appId = String(c.app_id ?? '').trim();
  const certId = String(c.cert_id ?? '').trim();
  const authToken = String(c.auth_token ?? '').trim();
  if (!devId || !appId || !certId || !authToken)
    return { verifyable: true, ok: false, msg: '请填写 eBay Dev ID / App ID / Cert ID / 授权令牌' };
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GeteBayOfficialTimeRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${authToken.replace(/[<>&]/g, '')}</eBayAuthToken></RequesterCredentials>
</GeteBayOfficialTimeRequest>`;
  try {
    const r = await fetchWithTimeout('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967', 'X-EBAY-API-DEVELOPER-ID': devId,
        'X-EBAY-API-APPLICATION-ID': appId, 'X-EBAY-API-CERTIFICATE-ID': certId,
        'X-EBAY-API-CALL-NAME': 'GeteBayOfficialTime', 'X-EBAY-API-SITEID': '0',
        'Content-Type': 'text/xml; charset=utf-8',
      },
      body: xml,
    });
    const text = await r.text();
    if (/Ack>Success/.test(text)) return { verifyable: true, ok: true, msg: 'eBay 授权令牌校验通过' };
    const err = text.match(/ShortMessage>([^<]+)</)?.[1] ?? `HTTP ${r.status}`;
    return { verifyable: true, ok: false, msg: `eBay 校验失败：${err}` };
  } catch (e) {
    return { verifyable: true, ok: false, msg: `eBay 校验请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

// 自动匹配校验函数：先精确匹配平台名，再按关键词兜底
async function checkManualPlatform(platform: string, creds: Record<string, unknown>): Promise<VerifyResult> {
  const p = platform.toLowerCase();
  if (p.startsWith('amazon')) return verifyAmazon(creds);
  if (p.startsWith('walmart')) return verifyWalmart(creds);
  if (p.startsWith('etsy')) return verifyEtsy(creds);
  if (p.startsWith('shopify')) return verifyShopify(creds);
  if (p.startsWith('ebay')) return verifyEBay(creds);
  // 剩余平台不支持自动校验
  return { verifyable: false, ok: false, msg: '该平台暂不支持自动校验，凭据将保存为「待验证」' };
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405);

  const requestId = crypto.randomUUID().slice(0, 8);
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ error: 'JSON 格式错误' }, 400); }

  const action = String(body.action ?? '').trim();
  const platform = String(body.platform ?? '').trim();
  const shopName = String(body.shop_name ?? '').trim();
  const region = String(body.region ?? '').trim();
  const credentials = (body.credentials ?? {}) as Record<string, unknown>;
  const shop = String(body.shop ?? '').trim();   // Shopify OAuth 需要
  const code = String(body.code ?? '').trim();   // OAuth callback 需要
  const authId = String(body.id ?? '').trim();   // delete 需要

  try {
    const userId = await resolveUserId(req);

    // ── list：当前用户所有授权 ──
    if (action === 'list') {
      if (!userId) return json({ error: '未登录' }, 401);
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const { data, error } = await admin
        .from('shop_auths')
        .select('id, platform, shop_name, region, auth_type, status, token_expires_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 500);
      return json({ items: data ?? [] });
    }

    // ── delete：删除一个授权 ──
    if (action === 'delete') {
      if (!userId) return json({ error: '未登录' }, 401);
      if (!authId) return json({ error: '缺少 id' }, 400);
      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const { error } = await admin.from('shop_auths').delete().eq('id', authId).eq('user_id', userId);
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    // ── 以下 action 需要登录 + 平台存在 ──
    if (!userId) return json({ error: '未登录' }, 401);
    if (!platform) return json({ error: '缺少 platform' }, 400);

    const platInfo = await getPlatformInfo(platform);
    if (!platInfo) return json({ error: `平台「${platform}」不存在或已停用` }, 400);
    const authType = platInfo.auth_type;

    // ── oauth-url：生成 OAuth 跳转 URL ──
    if (action === 'oauth-url') {
      if (authType !== 'oauth') return json({ error: `「${platform}」不是 OAuth 型平台` }, 400);
      let url: string;
      if (platform === 'Shopify') {
        if (!shop) return json({ error: '缺少 shop（Shopify 店铺域名）' }, 400);
        url = shopifyAuthorizeUrl(shop);
      } else if (platform === 'TikTok Shop') {
        url = tiktokAuthorizeUrl();
      } else {
        oauthNotReady(platform);
      }
      console.info(`[${functionName}] oauth-url ${requestId} platform=${platform}`);
      return json({ url });
    }

    // ── oauth-callback：code 换 token + 入库 ──
    if (action === 'oauth-callback') {
      if (authType !== 'oauth') return json({ error: `「${platform}」不是 OAuth 型平台` }, 400);
      if (!code) return json({ error: '缺少 code' }, 400);

      let accessToken: string, storeName: string, storeRegion: string;
      let scope = '', shopDomain: string | null = null;

      if (platform === 'Shopify') {
        if (!shop) return json({ error: '缺少 shop' }, 400);
        const r = await shopifyCallback(shop, code);
        accessToken = r.accessToken; scope = r.scope;
        storeName = shop; storeRegion = '独立站'; shopDomain = shop;
      } else if (platform === 'TikTok Shop') {
        const r = await tiktokCallback(code);
        accessToken = r.accessToken; storeName = r.shopName; storeRegion = r.region;
      } else {
        oauthNotReady(platform);
      }

      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const { error: ie } = await admin.from('shop_auths').insert({
        user_id: userId, shop_name: storeName, platform, region: storeRegion,
        auth_type: 'oauth', status: '已授权',
        authorized_at: new Date().toISOString().slice(0, 10),
        access_token: accessToken, scope, shop_domain: shopDomain,
      });
      if (ie) return json({ error: `保存授权失败：${ie.message}` }, 500);

      console.info(`[${functionName}] oauth-callback ${requestId} platform=${platform} shop=${storeName}`);
      return json({ success: true, shop: storeName, platform });
    }

    // ── cred-verify：仅校验手动凭据 ──
    if (action === 'cred-verify') {
      if (authType !== 'manual') return json({ error: `「${platform}」建议用 OAuth 授权` }, 400);
      const r = await checkManualPlatform(platform, credentials);
      return json({ valid: r.ok, verifyable: r.verifyable, message: r.msg });
    }

    // ── cred-save：校验 + 加密 + 入库 ──
    if (action === 'cred-save') {
      if (authType !== 'manual') return json({ error: `「${platform}」建议用 OAuth 授权` }, 400);
      if (!shopName) return json({ error: '缺少 shop_name' }, 400);

      const r = await checkManualPlatform(platform, credentials);
      let finalStatus: string, verifyNote: string;
      if (r.verifyable) {
        if (!r.ok) return json({ valid: false, verifyable: true, message: r.msg }, 400);
        finalStatus = '已授权'; verifyNote = r.msg;
      } else {
        finalStatus = '待验证'; verifyNote = r.msg;
      }

      const secret = Deno.env.get('JWT_SECRET') ?? 'thalvior-default-secret';
      const encrypted = await encryptCredentials(JSON.stringify(credentials), secret);

      const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));
      const { error: ie } = await admin.from('shop_auths').insert({
        user_id: userId, shop_name: shopName, platform, region: region || '',
        auth_type: 'manual', status: finalStatus, credentials_enc: encrypted,
        verify_note: verifyNote, verify_at: new Date().toISOString(),
        authorized_at: finalStatus === '已授权' ? new Date().toISOString().slice(0, 10) : null,
      });
      if (ie) return json({ error: `保存授权失败：${ie.message}` }, 500);

      console.info(`[${functionName}] cred-save ${requestId} platform=${platform} status=${finalStatus}`);
      return json({ valid: finalStatus === '已授权', verifyable: r.verifyable, status: finalStatus, message: verifyNote });
    }

    return json({ error: `未知 action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
