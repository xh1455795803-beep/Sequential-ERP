// Temu 半托管 适配器（Access ID + Secret + HMAC-SHA256 签名）
// 文档：https://seller.temu.com/openapi/document
const { buildContext, upsertOrder, upsertProduct } = require('./base');
const crypto = require('crypto');

const API_BASE = 'https://openapi.temuplatform.com';

// Temu 签名：HMAC-SHA256(secret, sorted_params + timestamp + appkey)
function sign(params, timestamp, secret) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const str = `${sorted}&timestamp=${timestamp}`;
  return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex');
}

async function callPost(ctx, path, payload) {
  const ts = Date.now().toString();
  const baseParams = {
    appKey: ctx.apiKey,
    timestamp: ts,
    signMethod: 'HMAC-SHA256',
    type: path.replace(/^\//, ''),
  };
  const signature = sign(baseParams, ts, ctx.apiSecret);
  const url = new URL(API_BASE + path);
  Object.entries(baseParams).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('sign', signature);
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.error || data.message || data._raw)) || `Temu 调用失败(${r.status})`;
    throw new Error('Temu 调用失败: ' + String(msg).slice(0, 300));
  }
  if (data.success === false || (data.code && data.code !== 0 && data.code !== '0')) {
    throw new Error('Temu 业务失败: ' + (data.message || JSON.stringify(data).slice(0, 200)));
  }
  return data;
}

async function syncOrders(ctx) {
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('Temu 缺少 Access ID/Secret');
  const since = Math.floor((Date.now() - 30 * 86400 * 1000) / 1000);
  const to = Math.floor(Date.now() / 1000);
  const data = await callPost(ctx, '/bg.order.list.get', {
    createTimeStart: since,
    createTimeEnd: to,
    pageNum: 1,
    pageSize: 100,
  });
  const list = (data && data.result && data.result.orderList) || (data && data.orderList) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'TEMU' + String(o.orderId || o.orderSn || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'TEMU') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.orderStatus || o.status),
      totalAmount: Number(o.totalAmount || o.orderAmount) || 0,
      buyerName: o.buyerName || '',
      country: o.country || o.countryCode || '',
      createdAt: o.createTime ? Math.floor(Number(o.createTime) / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  if (!s) return 'PENDING';
  const v = String(s).toString().toLowerCase();
  if (v.includes('cancel')) return 'CANCELLED';
  if (v.includes('shipped') || v.includes('delivering')) return 'SHIPPED';
  if (v.includes('deliver')) return 'DELIVERED';
  if (v.includes('paid')) return 'PENDING';
  return 'PENDING';
}

async function syncProducts(ctx) {
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('Temu 缺少密钥');
  let created = 0, updated = 0, total = 0;
  const data = await callPost(ctx, '/bg.product.list.get', { pageNum: 1, pageSize: 100 });
  const list = (data && data.result && data.result.productList) || (data && data.productList) || [];
  for (const it of list) {
    const sku = String(it.productSku || it.skuId || it.productId || '');
    if (!sku) continue;
    const name = it.productName || it.title || ('Temu ' + sku);
    const price = Number(it.price || it.salePrice) || 0;
    const action = await upsertProduct(ctx, { sku: 'TEMU-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
