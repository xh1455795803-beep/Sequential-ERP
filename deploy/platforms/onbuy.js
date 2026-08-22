// OnBuy 适配器（Consumer Key + Secret Key + JWT 鉴权）
// 文档：https://apidocs.onbuy.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');
const crypto = require('crypto');

const API_BASE = 'https://api.onbuy.com/v2';

// OnBuy：先用 secret + consumer_key 换取 JWT access token，再用 token 调 API
async function getToken(ctx) {
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('OnBuy 缺少 Consumer Key/Secret Key');
  const r = await fetch(`${API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: ctx.apiKey,
      client_secret: ctx.apiSecret,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) {
    throw new Error('OnBuy 令牌获取失败: ' + (data.message || JSON.stringify(data).slice(0, 200)));
  }
  return data.access_token;
}

async function callGet(ctx, path, query = {}) {
  const token = await getToken(ctx);
  const url = new URL(API_BASE + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error || data._raw)) || `OnBuy 调用失败(${r.status})`;
    throw new Error('OnBuy 调用失败: ' + String(msg).slice(0, 300));
  }
  return data;
}

async function syncOrders(ctx) {
  // 近 30 天订单
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const data = await callGet(ctx, '/orders', { from_created: since, limit: '100' });
  const list = (data && data.result && data.result.orders) || (data && data.orders) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'ONBUY' + String(o.id || o.order_id || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'ONBUY') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.status),
      totalAmount: Number(o.total || o.total_amount) || 0,
      buyerName: (o.buyer && o.buyer.name) || '',
      country: (o.delivery_address && o.delivery_address.country) || 'GB',
      createdAt: o.created_at ? Math.floor(new Date(o.created_at).getTime() / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  if (!s) return 'PENDING';
  const v = String(s).toString().toLowerCase();
  if (v.includes('cancel')) return 'CANCELLED';
  if (v.includes('ship')) return 'SHIPPED';
  if (v.includes('deliver')) return 'DELIVERED';
  return 'PENDING';
}

async function syncProducts(ctx) {
  let created = 0, updated = 0, total = 0;
  const data = await callGet(ctx, '/listings', { limit: '100' });
  const list = (data && data.result && data.result.listings) || (data && data.listings) || [];
  for (const it of list) {
    const sku = String(it.sku || it.listing_id || '');
    if (!sku) continue;
    const name = it.title || ('OnBuy ' + sku);
    const price = Number(it.price) || 0;
    const action = await upsertProduct(ctx, { sku: 'ONBUY-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
