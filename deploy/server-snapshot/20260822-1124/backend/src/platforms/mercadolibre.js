// MercadoLibre Mercado Libre 适配器（OAuth 型）
// 文档：https://developers.mercadolibre.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');

const API_BASE = 'https://api.mercadolibre.com';

async function syncOrders(ctx) {
  if (!ctx.accessToken) throw new Error('MercadoLibre 无 access_token');
  // 近 30 天的订单
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  let imported = 0, skipped = 0, offset = 0;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${API_BASE}/orders/search`);
    url.searchParams.set('access_token', ctx.accessToken);
    url.searchParams.set('limit', '50');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('sort', 'date_desc');
    url.searchParams.set('q', ''); // 最近订单
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r.status === 401) throw new Error('MercadoLibre 令牌已过期，请重新授权');
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('MercadoLibre 订单拉取失败: ' + txt.slice(0, 300));
    }
    const data = await r.json();
    const list = data.results || [];
    if (!list.length) break;
    for (const o of list) {
      if (o.date_created && new Date(o.date_created) < new Date(since)) continue;
      const orderNo = 'ML' + String(o.id || '').toString().replace(/[^A-Za-z0-9]/g, '');
      if (!orderNo || orderNo === 'ML') { skipped++; continue; }
      const action = await upsertOrder(ctx, {
        orderNo,
        status: mapStatus(o.status),
        totalAmount: Number(o.total_amount) || 0,
        buyerName: (o.buyer && o.buyer.first_name + ' ' + (o.buyer.last_name || '')).trim() || '',
        country: (o.buyer && o.buyer.country) || 'MX',
        createdAt: o.date_created ? Math.floor(new Date(o.date_created).getTime() / 1000) : null,
      });
      action === 'import' ? imported++ : skipped++;
    }
    offset += list.length;
    if (list.length < 50) break;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  if (!s) return 'PENDING';
  const v = String(s).toLowerCase();
  if (v.includes('cancel')) return 'CANCELLED';
  if (v.includes('shipped') || v.includes('ship')) return 'SHIPPED';
  if (v.includes('deliver')) return 'DELIVERED';
  if (v.includes('paid') || v.includes('confirm')) return 'PENDING';
  return 'PENDING';
}

async function syncProducts(ctx) {
  if (!ctx.accessToken) throw new Error('MercadoLibre 无 access_token');
  let created = 0, updated = 0, total = 0;
  // 通过 /users/me/items 访问当前卖家的在售商品
  const meResp = await fetch(`${API_BASE}/users/me?access_token=${encodeURIComponent(ctx.accessToken)}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!meResp.ok) throw new Error('MercadoLibre 卖家信息拉取失败');
  const me = await meResp.json();
  const userId = me.id;
  if (!userId) throw new Error('MercadoLibre 无法获取卖家 ID');
  // 通过 search 接口拉取该卖家在售商品（限前 100）
  const r = await fetch(`${API_BASE}/sites/MLB/search?seller_id=${userId}&limit=50`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error('MercadoLibre 商品拉取失败: ' + txt.slice(0, 300));
  }
  const data = await r.json();
  const list = data.results || [];
  for (const it of list) {
    const sku = String(it.id || '');
    if (!sku) continue;
    const name = it.title || ('MercadoLibre ' + sku);
    const price = Number(it.price) || 0;
    const action = await upsertProduct(ctx, { sku: 'ML-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
