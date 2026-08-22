// Amazon SP-API 适配器（OAuth 型）
// 文档：https://developer-docs.amazon.com/sp-api
// 流程：用 LWA refresh_token 换 access_token → 调 Reports API 异步生成订单报告 → 解析后落库
// 简化版：直接调 Orders API v0（按 last_updated_after 拉取近 30 天订单）
const { buildContext, upsertOrder, upsertProduct, fetchJson } = require('./base');
const crypto = require('crypto');

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';
const ORDERS_API = 'https://sellingpartnerapi.na.amazon.com'; // 北美区，EU/FE 由 shops.ext_shop_name 等可选区码切换
const EU_URL = 'https://sellingpartnerapi.eu.amazon.com';
const FE_URL = 'https://sellingpartnerapi.fe.amazon.com';

function endpointFor(shop) {
  // ext_shop_name 约定写入区域码：NA / EU / FE
  const region = (shop.ext_shop_name || 'NA').toUpperCase();
  if (region === 'EU') return EU_URL;
  if (region === 'FE') return FE_URL;
  return ORDERS_API;
}

// 用 refresh_token 刷新 LWA access_token
async function refreshAccessToken(ctx) {
  if (!ctx.refreshToken) throw new Error('Amazon 缺少 refresh_token，请重新完成授权');
  if (!ctx.app || !ctx.app.app_id || !ctx.app.app_secret_enc) throw new Error('Amazon 应用未配置 client_id/client_secret');
  const clientSecret = ctx.decrypt(ctx.app.app_secret_enc);
  const data = await fetchJson(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: ctx.refreshToken,
      client_id: ctx.app.app_id,
      client_secret: clientSecret,
    }),
  }, 'Amazon 令牌刷新失败');
  if (!data.access_token) throw new Error('Amazon 令牌刷新失败：' + JSON.stringify(data).slice(0, 300));
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3600 };
}

// SP-API 不强制 AWS SigV4（PublicKey 升级后），用 LWA Bearer 即可访问 Orders v0
async function syncOrders(ctx) {
  if (!ctx.accessToken) throw new Error('Amazon 无 access_token，请先刷新令牌');
  if (!ctx.app || !ctx.app.app_id) throw new Error('Amazon 缺少 app_id（SP-API 应用未配置）');
  const base = endpointFor(ctx.shop);
  const lastUpdated = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
  let imported = 0, skipped = 0, nextToken = null;
  // 拉取近 30 天所有订单（含分页）
  for (let page = 0; page < 50; page++) {
    const url = new URL(base + '/orders/v0/orders');
    url.searchParams.set('MarketplaceIds', ctx.app.app_id); // 借用 app_id 字段存放 marketplaceId（运营商配置时约定）
    url.searchParams.set('CreatedAfter', lastUpdated);
    if (nextToken) url.searchParams.set('NextToken', nextToken);
    const data = await fetchJson(url, {
      headers: {
        'x-amz-access-token': ctx.accessToken,
        'Content-Type': 'application/json',
      },
    }, 'Amazon 订单拉取失败');
    const payload = data.payload || {};
    const list = payload.Orders || [];
    for (const o of list) {
      const orderNo = 'AMZ' + String(o.AmazonOrderId || '').replace(/[^A-Za-z0-9-]/g, '');
      if (!orderNo || orderNo === 'AMZ') { skipped++; continue; }
      const action = await upsertOrder(ctx, {
        orderNo,
        status: mapStatus(o.OrderStatus),
        totalAmount: Number(o.OrderTotal && o.OrderTotal.Amount) || 0,
        buyerName: o.BuyerName || o.BuyerEmail || '',
        country: (o.ShippingAddress && o.ShippingAddress.CountryCode) || '',
        createdAt: o.PurchaseDate ? Math.floor(new Date(o.PurchaseDate).getTime() / 1000) : null,
      });
      action === 'import' ? imported++ : skipped++;
    }
    nextToken = payload.NextToken;
    if (!nextToken) break;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  if (!s) return 'PENDING';
  s = String(s).toLowerCase();
  if (s.includes('pending')) return 'PENDING';
  if (s.includes('unshipped')) return 'PENDING';
  if (s.includes('partial')) return 'PARTIAL';
  if (s.includes('shipped')) return 'SHIPPED';
  if (s.includes('canceled') || s.includes('cancelled')) return 'CANCELLED';
  if (s.includes('unfulfillable')) return 'CANCELLED';
  return 'PENDING';
}

// 商品同步：通过 Listings Items API v20210801 或 Reports API（这里用 Catalog Items v20220101 拉取商家在售 SKU）
async function syncProducts(ctx) {
  if (!ctx.accessToken) throw new Error('Amazon 无 access_token，请先刷新令牌');
  if (!ctx.app || !ctx.app.app_id) throw new Error('Amazon 缺少 marketplaceId');
  const base = endpointFor(ctx.shop);
  // Listings Items：按 SKU 拉取（实际生产应遍历卖家 SKU 列表，这里取近 100 个做示例）
  // 由于真实 SKU 列表需先查 Reports API 异步生成报告，这里通过一个简化的 reports 触发+轮询示例
  let created = 0, updated = 0, total = 0;
  // 简化策略：如果 shop.ext_shop_id 含 SKU 列表（用 , 分隔），则按 SKU 批量拉取
  const skuList = (ctx.shop.ext_shop_id || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const sku of skuList) {
    const url = `${base}/catalog/2022-04-01/items/${encodeURIComponent(sku)}?marketplaceIds=${encodeURIComponent(ctx.app.app_id)}`;
    try {
      const data = await fetchJson(url, {
        headers: { 'x-amz-access-token': ctx.accessToken },
      }, 'Amazon 商品拉取失败');
      const item = data || {};
      const name = (item.attributeSets && item.attributeSets[0] && item.attributeSets[0].title) || ('Amazon ' + sku);
      const priceAttr = item.summaries && item.summaries[0] && item.summaries[0].lowestPrice;
      const price = priceAttr && Number(priceAttr.amount) || 0;
      const action = await upsertProduct(ctx, { sku: 'AMZ-' + sku, name, price });
      total++;
      action === 'create' ? created++ : updated++;
    } catch (e) {
      // 单个 SKU 拉取失败不阻断整轮
      console.error('[amazon.syncProducts]', sku, e.message);
    }
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
  refreshToken: async (shop, app) => refreshAccessToken(await buildContext(shop, app)),
};
