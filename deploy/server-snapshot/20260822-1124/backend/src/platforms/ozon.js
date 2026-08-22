// OZON 适配器（API Key 型：Client-Id + Api-Key）
// 文档：https://docs.ozon.ru/api/seller
const { buildContext, upsertOrder, upsertProduct, fetchJson } = require('./base');

const API_BASE = 'https://api-seller.ozon.ru';

async function syncOrders(ctx) {
  if (!ctx.apiKey) throw new Error('OZON 缺少 Client-Id 或 Api-Key');
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  let imported = 0, skipped = 0;
  const data = await fetchJson(`${API_BASE}/v3/order/list`, {
    method: 'POST',
    headers: {
      'Client-Id': ctx.apiKey,
      'Api-Key': ctx.apiSecret || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      dir: 'ASC',
      filter: { since, to: new Date().toISOString() },
      limit: 100,
    }),
  }, 'OZON 订单拉取失败');
  const list = (data.result && data.result.postings) || [];
  for (const o of list) {
    const orderNo = 'OZN' + String(o.posting_number || '').replace(/[^A-Za-z0-9-]/g, '');
    if (!orderNo || orderNo === 'OZN') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.status),
      totalAmount: Number(o.total && o.total.price) || 0,
      buyerName: (o.buyer && o.buyer.name) || '',
      country: (o.analytics_data && o.analytics_data.region) || 'RU',
      createdAt: o.in_process_at ? Math.floor(new Date(o.in_process_at).getTime() / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  if (!s) return 'PENDING';
  const v = String(s).toLowerCase();
  if (v.includes('awaiting')) return 'PENDING';
  if (v.includes('delivering') || v.includes('shipped')) return 'SHIPPED';
  if (v.includes('delivered')) return 'DELIVERED';
  if (v.includes('cancel')) return 'CANCELLED';
  return 'PENDING';
}

async function syncProducts(ctx) {
  if (!ctx.apiKey) throw new Error('OZON 缺少 Api-Key');
  let last = '', created = 0, updated = 0, total = 0;
  for (let page = 0; page < 10; page++) {
    const data = await fetchJson(`${API_BASE}/v2/product/list`, {
      method: 'POST',
      headers: { 'Client-Id': ctx.apiKey, 'Api-Key': ctx.apiSecret || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 100, last }),
    }, 'OZON 商品列表失败');
    const items = (data.result && data.result.items) || [];
    if (!items.length) break;
    // 拉详情
    const productIds = items.map(i => i.product_id).filter(Boolean).slice(0, 100);
    if (productIds.length) {
      const detail = await fetchJson(`${API_BASE}/v2/product/info/list`, {
        method: 'POST',
        headers: { 'Client-Id': ctx.apiKey, 'Api-Key': ctx.apiSecret || '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productIds }),
      }, 'OZON 商品详情失败');
      for (const it of (detail.result && detail.result.items) || []) {
        const sku = String(it.sku || it.product_id || '');
        if (!sku) continue;
        const name = it.name || ('OZON ' + sku);
        const price = Number(it.price && it.price.price) || 0;
        const action = await upsertProduct(ctx, { sku: 'OZN-' + sku, name, price });
        total++;
        action === 'create' ? created++ : updated++;
      }
    }
    last = (data.result && data.result.last_item_id) || '';
    if (!last) break;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
