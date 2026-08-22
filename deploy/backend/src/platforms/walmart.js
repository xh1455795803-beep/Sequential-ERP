// Walmart Marketplace 适配器（Client ID + Client Secret + Signature）
// 文档：https://developer.walmart.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');
const crypto = require('crypto');

const API_BASE = 'https://marketplace.walmartapis.com/v3';

// Walmart 签名：Base64(SHA256(secret + timestamp + private_key)).
// 实际为：Authorization: Basic base64(client_id:client_secret)
// 请求头 WM_SEC.AUTH_TOKEN 为 client_secret，WM_QOS.CORRELATION_ID 为 UUID
async function callGet(ctx, path, query = {}) {
  if (!ctx.apiKey || !ctx.apiSecret) throw new Error('Walmart 缺少 Client ID/Secret');
  const url = new URL(API_BASE + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  const correlationId = crypto.randomUUID();
  const ts = Date.now().toString();
  const r = await fetch(url, {
    headers: {
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID': correlationId,
      'WM_SEC.AUTH_TOKEN': ctx.apiSecret,
      'WM_CONSUMER.ID': ctx.apiKey,
      'WM_CONSUMER.STAGE_INTIDENTIFIER': ts,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.error && data.error.description || data.message || data._raw)) || `Walmart 调用失败(${r.status})`;
    throw new Error('Walmart 调用失败: ' + String(msg).slice(0, 300));
  }
  return data;
}

async function syncOrders(ctx) {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const data = await callGet(ctx, '/orders', { createdStartDate: since, limit: '200' });
  const list = (data && data.list && data.list.elements && data.list.elements.order) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'WMT' + String(o.purchaseOrderId || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'WMT') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.orderLines && o.orderLines.orderLine),
      totalAmount: Number((o.orderLines && o.orderLines.orderLine && o.orderLines.orderLine.length && o.orderLines.orderLine.reduce((s, l) => s + Number(l.charges && l.charges.charge && l.charges.charge[0] && l.charges.charge[0].chargeAmount && l.charges.charge[0].chargeAmount.amount) || 0, 0))) || Number((o.orderLines && o.orderLines.orderLine && o.orderLines.orderLine.charges && o.orderLines.orderLine.charges.charge && o.orderLines.orderLine.charges.charge[0] && o.orderLines.orderLine.charges.charge[0].chargeAmount && o.orderLines.orderLine.charges.charge[0].chargeAmount.amount) || 0),
      buyerName: (o.shippingInfo && o.shippingInfo.postalAddress && o.shippingInfo.postalAddress.name) || '',
      country: (o.shippingInfo && o.shippingInfo.postalAddress && o.shippingInfo.postalAddress.country) || 'US',
      createdAt: o.purchaseDate ? Math.floor(new Date(o.purchaseDate).getTime() / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(lines) {
  if (!lines) return 'PENDING';
  const arr = Array.isArray(lines) ? lines : [lines];
  const statuses = arr.map(l => String(l.status || '').toLowerCase());
  if (statuses.length && statuses.every(s => s.includes('cancel'))) return 'CANCELLED';
  if (statuses.some(s => s.includes('ship'))) return 'SHIPPED';
  if (statuses.some(s => s.includes('deliver'))) return 'DELIVERED';
  return 'PENDING';
}

async function syncProducts(ctx) {
  let created = 0, updated = 0, total = 0;
  const data = await callGet(ctx, '/items', { limit: '100' });
  const list = (data && data.ItemList && data.ItemList.Item) || [];
  for (const it of list) {
    const sku = String(it.sku || '');
    if (!sku) continue;
    const name = it.productName || ('Walmart ' + sku);
    const price = Number(it.price && it.price.value) || 0;
    const action = await upsertProduct(ctx, { sku: 'WMT-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
