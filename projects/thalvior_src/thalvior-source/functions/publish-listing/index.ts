// publish-listing — P0-1 刊登发布引擎 MVP（第一平台：WooCommerce）
// =====================================================================
// action:
//   create-listing  → product_id + shop_auth_id → 调 WooCommerce REST 创建商品 → 写 listings + sku_mappings + 通知
//   list-listings   → 按用户分页查刊登记录（关联店铺名/商品名）
//   delete-listing  → 调 WooCommerce DELETE 远程商品(force) → 本地 listings 标记「已下线」→ 通知
//
// 铁律（主人强令）：
//   1. 只允许 status='已授权' 且 platform='WooCommerce' 的店铺参与刊登
//   2. 发布成功/失败都必须写 notifications（联动红线）
//   3. 全程不产生假数据——远程 API 真实返回成功才算成功
//
// 凭据：shop_auths.credentials_enc（AES-GCM/PBKDF2，盐 thalvior-cred-v1，secret=JWT_SECRET）
// WooCommerce 认证：HTTPS 下 query 参数 consumer_key/consumer_secret（与 verify-shop-auth 一致）

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isActiveAuthStatus } from '../_shared/shop-status.ts';

const functionName = 'publish-listing';

// ─── 通用工具 ────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`缺少环境变量 ${name}`);
  return v;
}
async function fetchDirect(url: string, init: RequestInit, ms = 30000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    // 踩坑：edge runtime fetch 不解压 gzip → 必须显式 identity，否则乱码截断
    return await fetch(url, { ...init, signal: ctrl.signal, headers: { ...init.headers, 'Accept-Encoding': 'identity' } });
  } finally {
    clearTimeout(timer);
  }
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

// ─── 凭据解密（与 authorize-shop encryptCredentials 对称） ───────────
async function decryptCredentials(encB64: string, secret: string): Promise<Record<string, unknown>> {
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
  return JSON.parse(new TextDecoder().decode(plain));
}

// ─── WooCommerce 客户端 ──────────────────────────────────────────────
// shop_domain 形如 https://thalvior.icu/woo 或 thalvior.icu/woo；归一化为 https://host/path
function wooBase(domain: string): string {
  const d = domain.trim().replace(/\/+$/, '');
  return d.startsWith('http') ? d : `https://${d}`;
}
function wooClient(shopDomain: string, ck: string, cs: string) {
  const base = wooBase(shopDomain);
  const auth = `consumer_key=${encodeURIComponent(ck)}&consumer_secret=${encodeURIComponent(cs)}`;
  return {
    async request(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data: any }> {
      const url = `${base}/wp-json/wc/v3${path}${path.includes('?') ? '&&' : '?'}${auth}`;
      const res = await fetchDirect(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let data: any = null;
      const text = await res.text();
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
      return { ok: res.ok, status: res.status, data };
    },
  };
}

// ─── 店铺语言判断（P0-6 补：region → 语言码，无法判断返回 null 走主语言） ──
const REGION_LANG: Record<string, string> = {
  US: 'en', GB: 'en', UK: 'en', CA: 'en', AU: 'en', NZ: 'en', IE: 'en',
  DE: 'de', AT: 'de', CH: 'de', FR: 'fr', BE: 'fr', ES: 'es', MX: 'es', AR: 'es',
  IT: 'it', JP: 'ja', KR: 'ko', RU: 'ru', BR: 'pt', PT: 'pt', TH: 'th', VN: 'vi',
  SA: 'ar', AE: 'ar', EG: 'ar', TW: 'zh-TW', HK: 'zh-TW', ID: 'id',
  '独立站': 'en', // 跨境独立站默认面向海外买家：有 en 翻译用 en，无则退主语言
};
function regionLang(region: string): string | null {
  const r = String(region || '').trim().toUpperCase();
  return REGION_LANG[r] ?? null;
}

// ─── 变体解析：product_variants.attributes 形如 "颜色:红 / 尺码:M" ──
function parseAttrs(attrs: string): Array<{ name: string; option: string }> {
  return String(attrs || '')
    .split(' / ').map((s) => s.trim()).filter(Boolean)
    .map((seg) => {
      const i = seg.indexOf(':');
      if (i <= 0) return null;
      return { name: seg.slice(0, i).trim(), option: seg.slice(i + 1).trim() };
    })
    .filter(Boolean) as Array<{ name: string; option: string }>;
}

// ─── 通知（联动红线：成功/失败都写） ─────────────────────────────────
async function notify(admin: ReturnType<typeof createClient>, userId: string, title: string, content: string) {
  await admin.from('notifications').insert({ user_id: userId, title, content, type: '刊登' });
}

// ─── create-listing ─────────────────────────────────────────────────
async function createListing(admin: ReturnType<typeof createClient>, userId: string, productId: string, shopAuthId: string, reqLang = '') {
  // 1. 店铺校验：本人 + 已授权 + WooCommerce（红线：只允许 status=已授权）
  const { data: shop, error: shopErr } = await admin
    .from('shop_auths')
    .select('id, user_id, shop_name, platform, status, credentials_enc, shop_domain, region')
    .eq('id', shopAuthId).eq('user_id', userId).maybeSingle();
  if (shopErr || !shop) return { status: 404, body: { error: '店铺不存在或不属于当前用户' } };
  if (!isActiveAuthStatus(shop.status)) return { status: 403, body: { error: `店铺「${shop.shop_name}」当前状态为「${shop.status}」，只有「已授权 / 即将到期」的店铺才能刊登` } };
  if (String(shop.platform).toLowerCase() !== 'woocommerce') return { status: 400, body: { error: `本引擎 MVP 仅支持 WooCommerce 平台（当前店铺平台：${shop.platform}）` } };
  if (!shop.credentials_enc) return { status: 400, body: { error: '店铺缺少加密凭据，请重新授权' } };

  // 2. 商品校验：本人 + 存在（含 products.i18n 多语言，P0-6 消费翻译文案）
  const { data: product, error: pErr } = await admin
    .from('products')
    .select('id, user_id, name, sku, category, price, stock, status, image, description, images, primary_image, i18n')
    .eq('id', productId).eq('user_id', userId).maybeSingle();
  if (pErr || !product) return { status: 404, body: { error: '商品不存在或不属于当前用户' } };

  // 2.1 多语言消费：店铺语言可判断（region 映射）且 i18n 有对应翻译 → 用翻译文本；否则退主语言（不阻塞）
  const productI18n = (product.i18n ?? null) as Record<string, { name?: string; description?: string }> | null;
  const requested = String(reqLang ?? '').trim().toLowerCase();
  const hasTrans = (l: string) => !!(productI18n && productI18n[l]?.name);
  const shopLang = requested && hasTrans(requested) ? requested : regionLang(String(shop.region ?? ''));
  let displayName: string = product.name;
  let displayDesc: string = product.description || '';
  let langNote = '';
  if (shopLang && productI18n && productI18n[shopLang]?.name) {
    displayName = String(productI18n[shopLang].name);
    if (productI18n[shopLang]?.description) displayDesc = String(productI18n[shopLang].description);
    langNote = `已使用${shopLang.toUpperCase()}翻译文案`;
  } else if (shopLang) {
    langNote = `店铺语言 ${shopLang.toUpperCase()} 暂无翻译，已使用主语言`;
  }

  // 3. 变体
  const { data: variants } = await admin
    .from('product_variants')
    .select('sku, attributes, price, stock')
    .eq('product_id', productId)
    .neq('sku', null);
  const variantRows = (variants ?? []).filter((v: any) => String(v.sku || '').trim());

  // 4. 预写 listings（发布中）
  const { data: listing, error: insErr } = await admin
    .from('listings')
    .insert({ user_id: userId, shop_auth_id: shop.id, product_id: product.id, platform: 'WooCommerce', status: '发布中' })
    .select('id').single();
  if (insErr || !listing) return { status: 500, body: { error: `写入刊登记录失败：${insErr?.message ?? 'unknown'}` } };

  // 5. 组装 WooCommerce payload
  const images: string[] = Array.isArray(product.images) && product.images.length
    ? (product.images as unknown[]).map(String).filter(Boolean)
    : [product.primary_image, product.image].filter(Boolean).map(String);
  const wooImages = images.length ? images.slice(0, 8).map((src) => ({ src })) : undefined;

  let payload: Record<string, unknown>;
  const wooSkuMaps: Array<{ local_sku: string; platform_sku: string }> = [];

  // P0-6 修复：WooCommerce REST v3 不支持把 variations 嵌进 POST /products（会被静默丢弃，
  // 父产品无价格无子变体）。正确姿势：先 POST 父产品（type=variable + attributes 定义变体轴），
  // 再逐个 POST /products/{id}/variations 建子变体（价格/库存/属性）。
  const isVariable = variantRows.length > 0;

  if (isVariable) {
    // variable 型：按 attributes 聚合变体轴
    const attrMap = new Map<string, Set<string>>();
    for (const v of variantRows) {
      for (const a of parseAttrs(v.attributes)) {
        if (!attrMap.has(a.name)) attrMap.set(a.name, new Set());
        attrMap.get(a.name)!.add(a.option);
      }
    }
    const wooAttributes = [...attrMap.entries()].map(([name, opts]) => ({ name, visible: true, variation: true, options: [...opts] }));
    payload = {
      name: displayName, type: 'variable',
      description: displayDesc,
      ...(wooImages ? { images: wooImages } : {}),
      attributes: wooAttributes,
    };
  } else {
    payload = {
      name: displayName, type: 'simple',
      regular_price: (Number(product.price) || 0).toFixed(2),
      description: displayDesc,
      ...(product.sku ? { sku: product.sku } : {}),
      stock_quantity: Number(product.stock) || 0,
      manage_stock: true,
      ...(wooImages ? { images: wooImages } : {}),
    };
  }

  // 6. 调 WooCommerce 创建
  const creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
  const ck = String(creds.consumer_key ?? '').trim();
  const cs = String(creds.consumer_secret ?? '').trim();
  const domain = String(creds.shop_domain ?? shop.shop_domain ?? '');
  if (!ck || !cs || !domain) {
    await admin.from('listings').update({ status: '失败', error_message: '店铺凭据不完整（缺域名或 Key/Secret）' }).eq('id', listing.id);
    await notify(admin, userId, '刊登失败', `商品「${product.name}」发布到店铺「${shop.shop_name}」失败：凭据不完整`);
    return { status: 400, body: { error: '店铺凭据不完整（缺域名或 Key/Secret）', listing_id: listing.id } };
  }
  const woo = wooClient(domain, ck, cs);
  // F3：本站图优先——外链图（CDN 防盗链/IP 拦截）Woo 服务端拉不到会导致整包图片被拒
  let shopHost = '';
  try { shopHost = new URL(wooBase(domain)).host; } catch { shopHost = ''; }
  const hostOf = (u: string) => { try { return new URL(u).host; } catch { return ''; } };
  const localImgs = images.filter((u) => shopHost && hostOf(u) === shopHost);
  const extImgs = images.filter((u) => !shopHost || hostOf(u) !== shopHost);
  const orderedImgs = [...localImgs, ...extImgs].slice(0, 8);
  if (orderedImgs.length) payload.images = orderedImgs.map((src) => ({ src }));
  let r = await woo.request('POST', '/products', payload);
  // 图片尽力而为：WooCommerce 拒绝图片 URL（外站防盗链/无扩展名等）时，跳过图片重试一次，商品本体照常发布并如实注明
  let imgNote = '';
  if (!r.ok && Array.isArray(payload.images) && payload.images.length) {
    const emsg = String(r.data?.message ?? '') + ' ' + String(r.data?.code ?? '');
    if (/image|upload/i.test(emsg)) {
      // 第一级重试：若混有外链图，只保留本站图再试一次
      const curSrcs = (payload.images as Array<{ src?: string }>).map((x) => String(x?.src ?? ''));
      const localOnly = curSrcs.filter((u) => shopHost && hostOf(u) === shopHost);
      if (localOnly.length > 0 && localOnly.length < curSrcs.length) {
        payload.images = localOnly.map((src) => ({ src }));
        r = await woo.request('POST', '/products', payload);
      }
      // 第二级重试：仍被拒 → 跳过图片发布商品本体（如实注明）
      if (!r.ok && Array.isArray(payload.images) && payload.images.length) {
        imgNote = '（注：商品图片未能同步到店铺——WooCommerce 拒绝了图片 URL，已跳过图片发布商品本体）';
        const { images: _drop, ...rest } = payload as Record<string, unknown> & { images?: unknown };
        payload = rest;
        r = await woo.request('POST', '/products', payload);
      }
    }
  }

  if (!r.ok) {
    const errMsg = (r.data && (r.data.message || r.data.code)) ? `${r.data.message}${r.data.code ? ` (${r.data.code})` : ''}` : `HTTP ${r.status}`;
    await admin.from('listings').update({ status: '失败', error_message: errMsg }).eq('id', listing.id);
    await notify(admin, userId, '刊登失败', `商品「${displayName}」发布到店铺「${shop.shop_name}」失败：${errMsg}`);
    return { status: 502, body: { error: `WooCommerce 发布失败：${errMsg}`, listing_id: listing.id } };
  }

  const wcId = String(r.data?.id ?? '');

  // P0-6 修复：variable 型 → 逐个 POST /products/{parentId}/variations 建子变体
  let variationNote = '';
  if (isVariable) {
    let created = 0;
    const failedVars: string[] = [];
    for (const v of variantRows) {
      const vp = Number(v.price ?? product.price ?? 0);
      const vr = await woo.request('POST', `/products/${encodeURIComponent(wcId)}/variations`, {
        sku: String(v.sku),
        regular_price: (Number.isFinite(vp) && vp > 0 ? vp : Number(product.price) || 0).toFixed(2),
        stock_quantity: Number(v.stock ?? 0) || 0,
        manage_stock: true,
        attributes: parseAttrs(v.attributes),
      });
      if (vr.ok) {
        created++;
        wooSkuMaps.push({ local_sku: String(v.sku), platform_sku: String(v.sku) });
      } else {
        const em = (vr.data && (vr.data.message || vr.data.code)) ? `${vr.data.message}${vr.data.code ? ` (${vr.data.code})` : ''}` : `HTTP ${vr.status}`;
        failedVars.push(`${v.sku}: ${em}`);
      }
    }
    if (created === 0) {
      // 一个子变体都没建成 → 父产品是无价空壳，诚实失败并清理远程父产品
      const errMsg = `子变体创建全部失败：${failedVars.join('；')}`;
      await woo.request('DELETE', `/products/${encodeURIComponent(wcId)}?force=true`, {});
      await admin.from('listings').update({ status: '失败', error_message: errMsg }).eq('id', listing.id);
      await notify(admin, userId, '刊登失败', `商品「${displayName}」发布到店铺「${shop.shop_name}」失败：${errMsg}`);
      return { status: 502, body: { error: `WooCommerce 发布失败：${errMsg}`, listing_id: listing.id } };
    }
    if (failedVars.length) {
      variationNote = `（注意：${failedVars.length}/${variantRows.length} 个子变体创建失败：${failedVars.join('；')}）`;
      await notify(admin, userId, '刊登部分成功', `商品「${displayName}」已发布，但部分子变体创建失败：${failedVars.join('；')}`);
    }
  }
  // 7. 成功：写 listings + sku_mappings + 通知
  await admin.from('listings').update({ status: '成功', wc_product_id: wcId, error_message: null }).eq('id', listing.id);
  const skuRows: Array<{ listing_id: string; local_sku: string; platform_sku: string }> = [];
  if (product.sku) skuRows.push({ listing_id: listing.id, local_sku: String(product.sku), platform_sku: String(product.sku) });
  for (const m of wooSkuMaps) skuRows.push({ listing_id: listing.id, local_sku: m.local_sku, platform_sku: m.platform_sku });
  const uniq = new Map(skuRows.map((s) => [`${s.local_sku}|${s.platform_sku}`, s]));
  if (uniq.size) await admin.from('sku_mappings').insert([...uniq.values()]);

  const perm = (r.data?.permalink ? ` 商品链接：${r.data.permalink}` : '') + imgNote + (langNote ? `（${langNote}）` : '') + variationNote;
  await notify(admin, userId, '刊登成功', `商品「${displayName}」已发布到店铺「${shop.shop_name}」（WooCommerce 商品 ID：${wcId}${isVariable ? `，子变体 ${wooSkuMaps.length} 个` : ''}）${perm}`);
  return {
    status: 200,
    body: {
      ok: true,
      listing_id: listing.id,
      wc_product_id: wcId,
      permalink: r.data?.permalink ?? null,
      message: `发布成功（远程商品 ID：${wcId}${isVariable ? `，子变体 ${wooSkuMaps.length} 个` : ''}）${perm}`,
      sku_mapped: uniq.size,
      used_lang: shopLang && langNote.startsWith('已使用') ? shopLang : null,
    },
  };
}

// ─── list-listings ───────────────────────────────────────────────────
async function listListings(admin: ReturnType<typeof createClient>, userId: string, page: number, pageSize: number) {
  const { data, count, error } = await admin
    .from('listings')
    .select('id, shop_auth_id, product_id, platform, status, wc_product_id, error_message, created_at, updated_at, shop_auths(shop_name, platform), products(name, image, sku)', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) return { status: 500, body: { error: `查询刊登记录失败：${error.message}` } };
  return { status: 200, body: { items: data ?? [], total: count ?? 0, page, page_size: pageSize } };
}

// ─── delete-listing ──────────────────────────────────────────────────
async function deleteListing(admin: ReturnType<typeof createClient>, userId: string, listingId: string) {
  const { data: listing, error: lErr } = await admin
    .from('listings')
    .select('id, user_id, shop_auth_id, product_id, platform, status, wc_product_id')
    .eq('id', listingId).eq('user_id', userId).maybeSingle();
  if (lErr || !listing) return { status: 404, body: { error: '刊登记录不存在或不属于当前用户' } };
  if (listing.status !== '成功' || !listing.wc_product_id) return { status: 400, body: { error: `仅「成功」状态的刊登记录可下架远程商品（当前：${listing.status}）` } };
  if (!listing.shop_auth_id) return { status: 400, body: { error: '刊登记录缺少店铺关联，无法下架' } };

  const { data: shop } = await admin.from('shop_auths').select('shop_name, status, credentials_enc, shop_domain').eq('id', listing.shop_auth_id).maybeSingle();
  if (!shop || !isActiveAuthStatus(shop.status) || !shop.credentials_enc) {
    return { status: 400, body: { error: '店铺已不可用（未授权或凭据缺失），请到店铺管理处理' } };
  }
  const creds = await decryptCredentials(shop.credentials_enc, getEnv('JWT_SECRET'));
  const woo = wooClient(String(creds.shop_domain ?? shop.shop_domain ?? ''), String(creds.consumer_key), String(creds.consumer_secret));
  const wcId = String(listing.wc_product_id);

  // P0-6 修复：variable 产品需先删子变体再删父产品（部分 Woo 环境对带 variations 的父产品直接 DELETE 返回 400）
  const g = await woo.request('GET', `/products/${encodeURIComponent(wcId)}`);
  if (g.ok && String(g.data?.type ?? '') === 'variable') {
    const varIds: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const vr = await woo.request('GET', `/products/${encodeURIComponent(wcId)}/variations?per_page=100&page=${page}`);
      const arr = Array.isArray(vr.data) ? vr.data : [];
      for (const x of arr) varIds.push(String(x?.id ?? ''));
      if (!vr.ok || arr.length < 100) break;
    }
    for (const vid of varIds.filter(Boolean)) {
      await woo.request('DELETE', `/products/${encodeURIComponent(wcId)}/variations/${encodeURIComponent(vid)}?force=true`, {});
    }
  }

  const r = await woo.request('DELETE', `/products/${encodeURIComponent(wcId)}?force=true`, {});
  if (!r.ok) {
    const errMsg = r.data?.message ?? `HTTP ${r.status}`;
    // 404 = 远程已不存在 → 也视为下线成功（幂等），但仍记录错误信息
    if (r.status !== 404) {
      await notify(admin, userId, '下架失败', `刊登记录（远程商品 ID ${wcId}）在 WooCommerce 下架失败：${errMsg}`);
      return { status: 502, body: { error: `WooCommerce 删除失败：${errMsg}` } };
    }
  }
  await admin.from('listings').update({ status: '已下线', error_message: null }).eq('id', listing.id);
  await notify(admin, userId, '刊登下架', `商品（WooCommerce ID：${wcId}）已从店铺「${shop.shop_name}」下架，本地刊登记录标记为「已下线」`);
  return { status: 200, body: { ok: true, message: `远程商品 ${wcId} 已删除，本地记录标记「已下线」` } };
}

// ─── 主入口 ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');

    const userId = await resolveUserId(req);
    if (!userId) return json({ error: '未登录或登录已过期' }, 401);

    const admin = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

    if (action === 'create-listing') {
      const productId = String(body.product_id ?? '').trim();
      const shopAuthId = String(body.shop_auth_id ?? '').trim();
      if (!productId || !shopAuthId) return json({ error: '缺少 product_id 或 shop_auth_id' }, 400);
      const r = await createListing(admin, userId, productId, shopAuthId, String(body.lang ?? ''));
      console.info(`[${functionName}] ${requestId} create-listing product=${productId} shop=${shopAuthId} → ${r.status}`);
      return json(r.body, r.status);
    }
    if (action === 'list-listings') {
      const page = Math.max(1, Number(body.page ?? 1) || 1);
      const pageSize = Math.min(50, Math.max(1, Number(body.page_size ?? 10) || 10));
      const r = await listListings(admin, userId, page, pageSize);
      return json(r.body, r.status);
    }
    if (action === 'delete-listing') {
      const listingId = String(body.listing_id ?? '').trim();
      if (!listingId) return json({ error: '缺少 listing_id' }, 400);
      const r = await deleteListing(admin, userId, listingId);
      console.info(`[${functionName}] ${requestId} delete-listing ${listingId} → ${r.status}`);
      return json(r.body, r.status);
    }
    return json({ error: `未知 action: ${action}` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
