// Qoo10 适配器（API Key 型，GMKT Open API）
// 文档：https://www.qoo10.com/gmkt.inc/RestfulAPI
const { buildContext, upsertOrder, upsertProduct } = require('./base');

const API_BASE = 'https://api.qoo10.com/gmkt.inc';

async function callGet(ctx, path, query = {}) {
  if (!ctx.apiKey) throw new Error('Qoo10 缺少 API Key');
  const url = new URL(API_BASE + path);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('key', ctx.apiKey);
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.message || data.error || data._raw)) || `Qoo10 调用失败(${r.status})`;
    throw new Error('Qoo10 调用失败: ' + String(msg).slice(0, 300));
  }
  return data;
}

async function syncOrders(ctx) {
  // 近 30 天订单
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const data = await callGet(ctx, '/Rest/SalesService/GetOrderList', { StdDateType: '1', BeginDate: since, EndDate: new Date().toISOString().slice(0, 19).replace('T', ' '), Page: '1', PageSize: '100' });
  const list = (data && data.OrderList) || (data && data.Result && data.Result.OrderList) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'QQ' + String(o.OrderNo || o.orderNo || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'QQ') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.OrderState || o.orderState),
      totalAmount: Number(o.TotalPrice || o.totalPrice) || 0,
      buyerName: o.BuyerName || o.buyerName || '',
      country: o.BuyerCountry || o.buyerCountry || 'JP',
      createdAt: o.OrderDate || o.orderDate ? Math.floor(new Date(o.OrderDate || o.orderDate).getTime() / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  if (!s) return 'PENDING';
  const v = String(s).toString().toLowerCase();
  if (v.includes('cancel')) return 'CANCELLED';
  if (v.includes('ship') || v.includes('transit')) return 'SHIPPED';
  if (v.includes('deliver')) return 'DELIVERED';
  return 'PENDING';
}

async function syncProducts(ctx) {
  let created = 0, updated = 0, total = 0;
  const data = await callGet(ctx, '/Rest/ItemService/GetItemList', { Page: '1', PageSize: '100' });
  const list = (data && data.ItemList) || (data && data.Result && data.Result.ItemList) || [];
  for (const it of list) {
    const sku = String(it.ItemCode || it.itemCode || '');
    if (!sku) continue;
    const name = it.ItemName || it.itemName || ('Qoo10 ' + sku);
    const price = Number(it.SellPrice || it.sellPrice) || 0;
    const action = await upsertProduct(ctx, { sku: 'QQ-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
