// Coupang 酷澎 适配器（Access Key + Secret Key + HMAC-SHA256 签名）
// 文档：https://developers.coupang.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');
const crypto = require('crypto');

const API_BASE = 'https://api-gateway.coupang.com';

// Coupang 签名：HMAC-SHA256(secret, method + path + query_sorted + timestamp)
function sign(method, path, query, timestamp, secret) {
  const params = Object.keys(query).sort().map(k => `${k}=${encodeURIComponent(query[k])}`).join('&');
  const str = [method.toUpperCase(), path, params, timestamp, 'REQUEST'].join('\n');
  return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex');
}

async function callGet(ctx, path, query) {
  const ts = Date.now().toString();
  const signature = sign('GET', path, query, ts, ctx.apiSecret);
  const url = new URL(API_BASE + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    headers: {
      'Authorization': `HMAC-SHA256 Signature=${signature}`,
      'X-Timestamp': ts,
      'AccessKey': ctx.apiKey,
      'Content-Type': 'application/json',
    },
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error || data._raw)) || `Coupang 调用失败(${r.status})`;
    throw new Error('Coupang 调用失败: ' + String(msg).slice(0, 300));
  }
  return data;
}

async function syncOrders(ctx) {
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('Coupang 缺少 Access Key 或 Secret Key');
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const path = '/v2/providers/openapi/apis/api/v4/vendors';
  const data = await callGet(ctx, path, {
    startTime: since,
    endTime: new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    nextToken: '',
    maxPerPage: '100',
  });
  const list = (data && data.data && data.data.orders) || (data && data.orders) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'CPG' + String(o.orderId || o.order_id || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'CPG') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.orderStatus || o.order_status),
      totalAmount: Number(o.totalPrice || o.total_price) || 0,
      buyerName: o.buyerName || o.buyer_name || '',
      country: 'KR',
      createdAt: o.orderDate || o.order_date ? Math.floor(new Date(o.orderDate || o.order_date).getTime() / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  if (!s) return 'PENDING';
  const v = String(s).toUpperCase();
  if (v.includes('WAIT') || v.includes('PAY')) return 'PENDING';
  if (v.includes('CANCEL')) return 'CANCELLED';
  if (v.includes('DELIVER')) return 'DELIVERED';
  if (v.includes('SHIP')) return 'SHIPPED';
  return 'PENDING';
}

async function syncProducts(ctx) {
  // Coupang 通过 /v2/providers/openapi/apis/api/v4/products 拉取在售商品
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('Coupang 缺少密钥');
  let created = 0, updated = 0, total = 0;
  const data = await callGet(ctx, '/v2/providers/openapi/apis/api/v4/products', { maxPerPage: '100', nextToken: '' });
  const list = (data && data.data && data.data.products) || (data && data.products) || [];
  for (const it of list) {
    const sku = String(it.sellerProductId || it.seller_product_id || it.vendorItemId || '');
    if (!sku) continue;
    const name = it.productName || it.product_name || ('Coupang ' + sku);
    const price = Number(it.salePrice || it.sale_price) || 0;
    const action = await upsertProduct(ctx, { sku: 'CPG-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
