// eBay 适配器（OAuth 型，Browse API + Fulfillment API）
// 文档：https://developer.ebay.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');

const API_BASE = 'https://api.ebay.com';

async function syncOrders(ctx) {
  if (!ctx.accessToken) throw new Error('eBay 无 access_token');
  // Fulfillment API: /sell/fulfillment/v1/order
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  let imported = 0, skipped = 0;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${API_BASE}/sell/fulfillment/v1/order`);
    url.searchParams.set('filter', `lastmodifieddate:[${since.slice(0, 19)}.000Z..]`);
    url.searchParams.set('limit', '200');
    url.searchParams.set('offset', String(page * 200));
    const r = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + ctx.accessToken,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });
    if (r.status === 401) throw new Error('eBay 令牌已过期，请重新授权');
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('eBay 订单拉取失败: ' + txt.slice(0, 300));
    }
    const data = await r.json();
    const list = (data && data.orders) || [];
    if (!list.length) break;
    for (const o of list) {
      const orderNo = 'EBAY' + String(o.orderId || '').toString().replace(/[^A-Za-z0-9-]/g, '');
      if (!orderNo || orderNo === 'EBAY') { skipped++; continue; }
      const action = await upsertOrder(ctx, {
        orderNo,
        status: mapStatus(o.orderFulfillmentStatus, o.orderPaymentStatus),
        totalAmount: Number(o.pricingSummary && o.pricingSummary.total && o.pricingSummary.total.value) || 0,
        buyerName: (o.buyer && o.buyer.username) || '',
        country: (o.fulfillmentStartInstructions && o.fulfillmentStartInstructions[0] && o.fulfillmentStartInstructions[0].shippingStep && o.fulfillmentStartInstructions[0].shippingStep.shipTo && o.fulfillmentStartInstructions[0].shippingStep.shipTo.countryCode) || '',
        createdAt: o.creationDate ? Math.floor(new Date(o.creationDate).getTime() / 1000) : null,
      });
      action === 'import' ? imported++ : skipped++;
    }
    if (list.length < 200) break;
  }
  return { imported, skipped };
}

function mapStatus(fulfill, payment) {
  if (!payment) payment = '';
  if (String(payment).toLowerCase() === 'failed') return 'CANCELLED';
  if (!fulfill) return 'PENDING';
  const v = String(fulfill).toLowerCase();
  if (v.includes('ship')) return 'SHIPPED';
  if (v.includes('deliver')) return 'DELIVERED';
  if (v.includes('cancel')) return 'CANCELLED';
  return 'PENDING';
}

async function syncProducts(ctx) {
  if (!ctx.accessToken) throw new Error('eBay 无 access_token');
  // 使用 Inventory API 拉取在售 SKU（每页 100）
  let created = 0, updated = 0, total = 0;
  const url = new URL(`${API_BASE}/sell/inventory/v1/inventory_item`);
  url.searchParams.set('limit', '100');
  const r = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + ctx.accessToken, 'Accept': 'application/json' },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error('eBay 商品拉取失败: ' + txt.slice(0, 300));
  }
  const data = await r.json();
  const list = (data && data.inventoryItems) || [];
  for (const it of list) {
    const sku = String(it.sku || '');
    if (!sku) continue;
    const name = it.product && it.product.title || ('eBay ' + sku);
    const price = Number((it.price && it.price.value) || 0);
    const action = await upsertProduct(ctx, { sku: 'EBAY-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
