// Allegro 适配器（OAuth 型，波兰市场）
// 文档：https://developer.allegro.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');

const API_BASE = 'https://api.allegro.pl';

async function syncOrders(ctx) {
  if (!ctx.accessToken) throw new Error('Allegro 无 access_token');
  // /order/orders：取近 30 天订单（不含 checkout-form，按 deliveredAt/payTime filter）
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  let imported = 0, skipped = 0, offset = 0;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${API_BASE}/order/orders`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('lineItems.boughtAt.gte', since);
    const r = await fetch(url, {
      headers: {
        'Authorization': 'Bearer ' + ctx.accessToken,
        'Accept': 'application/vnd.allegro.public.v1+json',
        'Accept-Language': 'en',
      },
    });
    if (r.status === 401) throw new Error('Allegro 令牌已过期，请重新授权');
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('Allegro 订单拉取失败: ' + txt.slice(0, 300));
    }
    const data = await r.json();
    const list = data.orders || [];
    if (!list.length) break;
    for (const o of list) {
      const orderNo = 'ALG' + String(o.id || '').toString().replace(/[^A-Za-z0-9-]/g, '');
      if (!orderNo || orderNo === 'ALG') { skipped++; continue; }
      const total = (o.lineItems || []).reduce((s, l) => s + Number(l.price && l.price.amount || 0) * Number(l.quantity || 1), 0);
      const action = await upsertOrder(ctx, {
        orderNo,
        status: mapStatus(o.status),
        totalAmount: total,
        buyerName: (o.buyer && o.buyer.login) || '',
        country: (o.delivery && o.delivery.address && o.delivery.address.countryCode) || 'PL',
        createdAt: o.lineItems && o.lineItems[0] && o.lineItems[0].boughtAt ? Math.floor(new Date(o.lineItems[0].boughtAt).getTime() / 1000) : null,
      });
      action === 'import' ? imported++ : skipped++;
    }
    offset += list.length;
    if (list.length < 100) break;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  if (!s) return 'PENDING';
  const v = String(s).toString().toUpperCase();
  if (v.includes('CANCEL')) return 'CANCELLED';
  if (v.includes('FILLED')) return 'DELIVERED';
  if (v.includes('PROCESS')) return 'PENDING';
  return 'PENDING';
}

async function syncProducts(ctx) {
  if (!ctx.accessToken) throw new Error('Allegro 无 access_token');
  let created = 0, updated = 0, total = 0;
  // /sale/offers?owner.id=ME：取当前用户的所有 offers
  // 先取用户 ID
  const meResp = await fetch(`${API_BASE}/me`, {
    headers: { 'Authorization': 'Bearer ' + ctx.accessToken, 'Accept': 'application/vnd.allegro.public.v1+json' },
  });
  if (!meResp.ok) {
    const txt = await meResp.text().catch(() => '');
    throw new Error('Allegro 卖家信息拉取失败: ' + txt.slice(0, 200));
  }
  const me = await meResp.json();
  const userId = me.id;
  if (!userId) throw new Error('Allegro 无法获取卖家 ID');
  const r = await fetch(`${API_BASE}/sale/offers?user.id=${userId}&limit=200`, {
    headers: { 'Authorization': 'Bearer ' + ctx.accessToken, 'Accept': 'application/vnd.allegro.public.v1+json' },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error('Allegro 商品拉取失败: ' + txt.slice(0, 300));
  }
  const data = await r.json();
  const list = data.offers || [];
  for (const it of list) {
    const sku = String(it.id || '');
    if (!sku) continue;
    const name = it.name || ('Allegro ' + sku);
    const price = Number((it.sellingMode && it.sellingMode.price && it.sellingMode.price.amount) || 0);
    const action = await upsertProduct(ctx, { sku: 'ALG-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
