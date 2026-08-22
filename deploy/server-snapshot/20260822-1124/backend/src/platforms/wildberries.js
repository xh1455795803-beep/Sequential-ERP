// Wildberries 适配器（API Token 型）
// 文档：https://open-api.wildberries.ru
const { buildContext, upsertOrder, upsertProduct, fetchJson } = require('./base');

const API_BASE = 'https://suppliers-api.wildberries.ru';

async function syncOrders(ctx) {
  if (!ctx.apiKey) throw new Error('Wildberries 缺少 API Token');
  const dateFrom = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  let imported = 0, skipped = 0;
  const data = await fetchJson(`${API_BASE}/api/v2/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`, {
    headers: { 'Authorization': ctx.apiKey },
  }, 'Wildberries 订单拉取失败');
  const list = (data && data.orders) || [];
  for (const o of list) {
    const orderNo = 'WB' + String(o.id || o.odid || '').toString().replace(/[^0-9]/g, '');
    if (!orderNo || orderNo === 'WB') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o),
      totalAmount: Number(o.price) || 0, // 价格单位为 RUB，含税
      buyerName: o.fio || '',
      country: o.country || 'RU',
      createdAt: o.dateCreated ? Math.floor(new Date(o.dateCreated).getTime() / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(o) {
  const wm = (o.wbstatus || o.status || '').toString().toLowerCase();
  if (wm.includes('cancel')) return 'CANCELLED';
  if (wm.includes('sold') || wm.includes('shipped')) return 'SHIPPED';
  if (wm.includes('delivered') || wm.includes('ready')) return 'DELIVERED';
  return 'PENDING';
}

async function syncProducts(ctx) {
  if (!ctx.apiKey) throw new Error('Wildberries 缺少 API Token');
  let created = 0, updated = 0, total = 0;
  // 通过 /api/v2/list/goods/filter 获取商品列表
  const data = await fetchJson(`${API_BASE}/api/v2/list/goods/filter`, {
    method: 'POST',
    headers: { 'Authorization': ctx.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }, 'Wildberries 商品列表失败');
  const list = (data && data.data && data.data.list) || [];
  for (const it of list) {
    const sku = String(it.barcode || it.nm || '');
    if (!sku) continue;
    const name = it.name || ('WB ' + sku);
    const price = Number(it.price) || 0;
    const action = await upsertProduct(ctx, { sku: 'WB-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
