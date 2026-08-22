// SHEIN 适配器（App Key + App Secret + 签名）
// 文档：https://open.sheincorp.com（邀请制）
const { buildContext, upsertOrder, upsertProduct } = require('./base');
const crypto = require('crypto');

const API_BASE = 'https://openapi.sheincorp.com';

// SHEIN 签名：MD5(app_secret + sorted_params + app_secret).toUpperCase()
function sign(params, secret) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  const str = secret + sorted + secret;
  return crypto.createHash('md5').update(str, 'utf8').digest('hex').toUpperCase();
}

async function callPost(ctx, path, payload) {
  const ts = Date.now().toString();
  const baseParams = {
    appKey: ctx.apiKey,
    timestamp: ts,
    signMethod: 'MD5',
  };
  const signature = sign({ ...baseParams, ...payload }, ctx.apiSecret);
  const r = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-shein-signature': signature },
    body: JSON.stringify({ ...baseParams, ...payload, sign: signature }),
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.error || data.message || data.msg || data._raw)) || `SHEIN 调用失败(${r.status})`;
    throw new Error('SHEIN 调用失败: ' + String(msg).slice(0, 300));
  }
  if (data.code && data.code !== '0' && data.code !== 0 && data.code !== '00000') {
    throw new Error('SHEIN 业务失败: ' + (data.message || data.msg || JSON.stringify(data).slice(0, 200)));
  }
  return data;
}

async function syncOrders(ctx) {
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('SHEIN 缺少 App Key/Secret');
  const since = Math.floor((Date.now() - 30 * 86400 * 1000) / 1000);
  const to = Math.floor(Date.now() / 1000);
  const data = await callPost(ctx, '/open/order/list', {
    startTime: since, endTime: to, pageNum: 1, pageSize: 100,
  });
  const list = (data && data.data && data.data.orderList) || (data && data.orderList) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'SHEIN' + String(o.orderNo || o.orderId || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'SHEIN') { skipped++; continue; }
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
  return 'PENDING';
}

async function syncProducts(ctx) {
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('SHEIN 缺少密钥');
  let created = 0, updated = 0, total = 0;
  const data = await callPost(ctx, '/open/product/list', { pageNum: 1, pageSize: 100 });
  const list = (data && data.data && data.data.productList) || (data && data.productList) || [];
  for (const it of list) {
    const sku = String(it.productSku || it.skuId || it.productId || '');
    if (!sku) continue;
    const name = it.productName || it.title || ('SHEIN ' + sku);
    const price = Number(it.salePrice || it.price) || 0;
    const action = await upsertProduct(ctx, { sku: 'SHEIN-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
