// Kaufland 适配器（API Key + Secret Key + HMAC-SHA256 签名）
// 文档：https://sellerapi.kaufland.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');
const crypto = require('crypto');

const API_BASE = 'https://sellerapi.kaufland.com/v2';

// Kaufland 签名：HMAC-SHA256(secret_key, URL_path + sorted_query + timestamp + body)
function sign(secret, path, query, ts, body = '') {
  const sortedQuery = Object.keys(query).sort().map(k => `${k}=${encodeURIComponent(query[k])}`).join('&');
  const raw = `${path}?${sortedQuery}${body}${ts}`;
  return crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
}

async function callGet(ctx, path, query = {}) {
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('Kaufland 缺少 API Key/Secret Key');
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = sign(ctx.apiSecret, path, query, ts);
  const url = new URL(API_BASE + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'HOS-User': ctx.apiKey,
      'HOS-Timestamp': ts,
      'HOS-Signature': signature,
    },
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error || data._raw)) || `Kaufland 调用失败(${r.status})`;
    throw new Error('Kaufland 调用失败: ' + String(msg).slice(0, 300));
  }
  return data;
}

async function syncOrders(ctx) {
  // /orders：取近 30 天订单
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  const data = await callGet(ctx, '/orders', { created_at_from: since, limit: '100' });
  const list = (data && data.data && data.data.orders) || (data && data.orders) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'KFL' + String(o.id || o.order_number || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'KFL') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.status),
      totalAmount: Number(o.total_price || o.invoice_amount) || 0,
      buyerName: (o.address && o.address.name) || '',
      country: (o.address && o.address.country) || 'DE',
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
  const data = await callGet(ctx, '/products', { limit: '100' });
  const list = (data && data.data && data.data.products) || (data && data.products) || [];
  for (const it of list) {
    const sku = String(it.id || it.product_id || '');
    if (!sku) continue;
    const name = it.title || ('Kaufland ' + sku);
    const price = Number(it.price) || 0;
    const action = await upsertProduct(ctx, { sku: 'KFL-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
