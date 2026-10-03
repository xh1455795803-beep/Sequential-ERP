import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 店铺 OAuth 授权：生成第三方平台授权跳转 URL，并在回调时用 code 换取 access_token 后安全入库
// 动作：action = 'authorize'（生成授权 URL）| 'callback'（code 换 token 并入库）
// 平台密钥通过环境变量注入：
//   Shopify     : SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET / SHOPIFY_REDIRECT_URI
//   TikTok Shop : TIKTOK_APP_KEY / TIKTOK_APP_SECRET / TIKTOK_REDIRECT_URI
// 已接入：Shopify、TikTok Shop；Lazada / Shopee 走同一框架，配置密钥后可复用（返回待接入提示）

const TIKTOK_AUTH_BASE = 'https://open-api.tiktokglobalshop.com/authorize';
const TIKTOK_TOKEN_URL = 'https://open-api.tiktokglobalshop.com/api/token';
const TIKTOK_SHOP_URL = 'https://open-api.tiktokglobalshop.com/api/shop/get_authorized_shop';

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请先在云服务面板配置`);
  }
  return value;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 从 Authorization 头解析当前登录用户 id
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

async function fetchWithTimeout(url: string, init: RequestInit, ms = 20000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ===== Shopify =====
function shopifyAuthorizeUrl(shop: string): string {
  const clientId = Deno.env.get('SHOPIFY_CLIENT_ID');
  const redirectUri = Deno.env.get('SHOPIFY_REDIRECT_URI');
  if (!clientId || !redirectUri) {
    throw new Error('Shopify OAuth 尚未配置（缺少 SHOPIFY_CLIENT_ID / SHOPIFY_REDIRECT_URI），请联系管理员启用');
  }
  const scopes = 'read_products,read_orders,read_customers';
  const authState = crypto.randomUUID();
  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(authState)}`;
  return authUrl;
}

async function shopifyCallback(shop: string, code: string): Promise<{ accessToken: string; scope: string }> {
  const clientId = getEnv('SHOPIFY_CLIENT_ID');
  const clientSecret = getEnv('SHOPIFY_CLIENT_SECRET');
  const tokenUrl = `https://${shop}/admin/oauth/access_token`;
  const tokenRes = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error(`[shop-oauth] shopify token exchange failed status=${tokenRes.status}: ${errBody.slice(0, 300)}`);
    throw new Error('授权码换取 token 失败');
  }
  const tokenData = (await tokenRes.json()) as { access_token?: string; scope?: string };
  if (!tokenData.access_token) {
    throw new Error('未获取到 access_token');
  }
  return { accessToken: tokenData.access_token, scope: tokenData.scope ?? '' };
}

// ===== TikTok Shop =====
function tiktokAuthorizeUrl(): string {
  const appKey = Deno.env.get('TIKTOK_APP_KEY');
  const redirectUri = Deno.env.get('TIKTOK_REDIRECT_URI');
  if (!appKey || !redirectUri) {
    throw new Error('TikTok Shop OAuth 尚未配置（缺少 TIKTOK_APP_KEY / TIKTOK_REDIRECT_URI），请联系管理员启用');
  }
  const authState = crypto.randomUUID();
  const authUrl =
    `${TIKTOK_AUTH_BASE}` +
    `?app_key=${encodeURIComponent(appKey)}` +
    `&state=${encodeURIComponent(authState)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`;
  return authUrl;
}

async function tiktokCallback(code: string): Promise<{ accessToken: string; shopName: string; region: string }> {
  const appKey = getEnv('TIKTOK_APP_KEY');
  const appSecret = getEnv('TIKTOK_APP_SECRET');

  // 1. auth_code 换 access_token（TikTok Shop Open Platform）
  const tokenRes = await fetchWithTimeout(TIKTOK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_key: appKey,
      app_secret: appSecret,
      auth_code: code,
      grant_type: 'authorized_code',
    }),
  });
  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    data?: { access_token?: string };
    code?: number;
    message?: string;
  };
  if (!tokenRes.ok || !tokenData?.data?.access_token) {
    console.error(`[shop-oauth] tiktok token exchange failed status=${tokenRes.status} msg=${tokenData.message ?? ''} code=${tokenData.code ?? ''}`);
    throw new Error('TikTok Shop 授权码换取 token 失败');
  }
  const accessToken = tokenData.data.access_token;

  // 2. 拉取授权店铺信息
  const shopRes = await fetchWithTimeout(
    `${TIKTOK_SHOP_URL}?app_key=${encodeURIComponent(appKey)}&secret=${encodeURIComponent(appSecret)}&access_token=${encodeURIComponent(accessToken)}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } },
  );
  const shopData = (await shopRes.json().catch(() => ({}))) as {
    data?: { shops?: Array<{ name?: string; region?: string; cipher?: string; shop_id?: string }> };
    code?: number;
    message?: string;
  };
  const shops = shopData?.data?.shops ?? [];
  const first = shops[0] ?? {};
  if (!first?.name) {
    console.warn(`[shop-oauth] tiktok get shop empty status=${shopRes.status} msg=${shopData.message ?? ''}`);
  }
  return {
    accessToken,
    shopName: first.name ?? 'TikTok Shop 店铺',
    region: first.region ?? '短视频电商',
  };
}

// ===== 主入口 =====
Deno.serve(async (req) => {
  const functionName = 'shop-oauth';
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== 'POST') {
      return json({ error: '仅支持 POST 请求' }, 405);
    }

    const body = await req.json();
    const { action, platform, shop, code } = body as {
      action?: string;
      platform?: string;
      shop?: string;
      code?: string;
    };
    const plat = platform ?? 'Shopify';

    const userId = await resolveUserId(req);
    if (!userId) {
      return json({ error: '未登录或登录已过期' }, 401);
    }

    // ===== 生成授权跳转 URL =====
    if (action === 'authorize') {
      try {
        let url: string;
        if (plat === 'Shopify') {
          if (!shop) return json({ error: '缺少店铺域名（shop）' }, 400);
          url = shopifyAuthorizeUrl(shop);
        } else if (plat === 'TikTok Shop') {
          url = tiktokAuthorizeUrl();
        } else if (plat === 'Lazada' || plat === 'Shopee') {
          return json({ error: `${plat} 一键授权接入中，请先使用手动授权` }, 503);
        } else {
          return json({ error: `未知平台 ${plat}` }, 400);
        }
        console.info(`[${functionName}] authorize ${requestId} platform=${plat}`);
        return json({ url });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return json({ error: message }, 503);
      }
    }

    // ===== 回调：code 换 token 并入库 =====
    if (action === 'callback') {
      if (!code) {
        return json({ error: '缺少 code 参数' }, 400);
      }

      let accessToken: string;
      let shopName: string;
      let region: string;
      let platformName: string;
      let shopDomain: string | null = null;
      let scope = '';

      if (plat === 'Shopify') {
        if (!shop) return json({ error: '缺少 shop 参数' }, 400);
        const r = await shopifyCallback(shop, code);
        accessToken = r.accessToken;
        scope = r.scope;
        shopName = shop;
        region = '独立站';
        platformName = 'Shopify';
        shopDomain = shop;
      } else if (plat === 'TikTok Shop') {
        const r = await tiktokCallback(code);
        accessToken = r.accessToken;
        shopName = r.shopName;
        region = r.region;
        platformName = 'TikTok Shop';
      } else {
        return json({ error: `平台 ${plat} 回调暂未接入` }, 400);
      }

      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );

      // 写入授权记录（token 仅存服务端，不落前端）
      const { error: insertError } = await admin.from('shop_auths').insert({
        user_id: userId,
        shop_name: shopName,
        platform: platformName,
        region,
        status: '已授权',
        authorized_at: new Date().toISOString().slice(0, 10),
        shop_domain: shopDomain,
        access_token: accessToken,
        scope,
      });

      if (insertError) {
        console.error(`[${functionName}] insert failed ${requestId}: ${insertError.message}`);
        return json({ error: '授权记录保存失败' }, 500);
      }

      console.info(`[${functionName}] callback success ${requestId} platform=${platformName}`);
      return json({ success: true, shop: shopName });
    }

    return json({ error: '未知 action' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return json({ error: message }, 500);
  }
});
