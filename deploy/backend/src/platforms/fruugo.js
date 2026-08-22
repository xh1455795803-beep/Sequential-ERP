// Fruugo 适配器（API Key 型，REST）
// 文档：https://developer.fruugo.com（人工开通 API）
const { buildContext, upsertOrder, upsertProduct } = require('./base');

const API_BASE = 'https://www.fruugo.co.uk/api';

async function callGet(ctx, path) {
  if (!ctx.apiKey) throw new Error('Fruugo 缺少 API Key');
  const r = await fetch(API_BASE + path, {
    headers: {
      'Authorization': 'Bearer ' + ctx.apiKey,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error || data._raw)) || `Fruugo 调用失败(${r.status})`;
    throw new Error('Fruugo 调用失败: ' + String(msg).slice(0, 300));
  }
  return data;
}

async function syncOrders(ctx) {
  // Fruugo：按近 30 天的订单
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const data = await callGet(ctx, `/orders?date_from=${since}`);
  const list = (data && data.orders) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'FRG' + String(o.orderId || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'FRG') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.status),
      totalAmount: Number(o.totalPrice || o.total) || 0,
      buyerName: (o.customer && o.customer.name) || '',
      country: (o.delivery && o.delivery.country) || 'GB',
      createdAt: o.orderDate ? Math.floor(new Date(o.orderDate).getTime() / 1000) : null,
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
  const data = await callGet(ctx, '/products?page=1&limit=100');
  const list = (data && data.products) || [];
  for (const it of list) {
    const sku = String(it.sku || it.productId || '');
    if (!sku) continue;
    const name = it.name || ('Fruugo ' + sku);
    const price = Number(it.price) || 0;
    const action = await upsertProduct(ctx, { sku: 'FRG-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
