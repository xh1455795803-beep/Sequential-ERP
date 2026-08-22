// Lazada 适配器（OAuth 型，Open Platform）
// 文档：https://open.lazada.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');
const crypto = require('crypto');

const API_BASES = {
  SG: 'https://api.lazada.sg/rest',
  MY: 'https://api.lazada.com.my/rest',
  TH: 'https://api.lazada.co.th/rest',
  VN: 'https://api.lazada.vn/rest',
  PH: 'https://api.lazada.com.ph/rest',
  ID: 'https://api.lazada.co.id/rest',
};

function endpoint(shop) {
  const country = (shop.ext_shop_name || 'SG').toUpperCase();
  return API_BASES[country] || API_BASES.SG;
}

// Lazada 签名：HMAC-SHA256(secret, sorted query + payload)
function sign(params, secret, payload) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const str = sorted + (payload || '');
  return crypto.createHmac('sha256', secret).update(str, 'utf8').digest('hex').toUpperCase();
}

async function call(ctx, action, commonParams, payload) {
  if (!ctx.accessToken) throw new Error('Lazada 无 access_token');
  if (!ctx.app || !ctx.app.app_id || !ctx.app.app_secret_enc) throw new Error('Lazada 应用未配置');
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '+0800';
  const secret = ctx.decrypt(ctx.app.app_secret_enc);
  const params = {
    action,
    app_key: ctx.app.app_id,
    access_token: ctx.accessToken,
    format: 'json',
    timestamp: ts,
    sign_method: 'sha256',
    ...commonParams,
  };
  params.sign = sign(params, secret, payload ? JSON.stringify(payload) : '');
  const url = new URL(endpoint(ctx.shop) + '/' + action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    method: payload ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok || (data.code && !String(data.code).includes('0'))) {
    const msg = (data && (data.message || data.error_message || data._raw)) || `Lazada 调用失败(${r.status})`;
    throw new Error('Lazada 调用失败: ' + String(msg).slice(0, 300));
  }
  return data;
}

async function syncOrders(ctx) {
  const since = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const data = await call(ctx, '/orders/get', {
    created_after: since,
    limit: '100',
    offset: '0',
  }, null);
  const list = (data && data.data && data.data.orders) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'LZD' + String(o.order_number || o.order_id || '').toString().replace(/[^A-Za-z0-9]/g, '');
    if (!orderNo || orderNo === 'LZD') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.statuses),
      totalAmount: Number(o.price) || 0,
      buyerName: o.customer_first_name || '',
      country: o.address_billing_country || '',
      createdAt: o.created_at ? Math.floor(new Date(o.created_at).getTime() / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(arr) {
  const statuses = Array.isArray(arr) ? arr.map(s => String(s).toLowerCase()) : [String(arr || '').toLowerCase()];
  if (statuses.some(s => s.includes('cancel'))) return 'CANCELLED';
  if (statuses.some(s => s.includes('ship'))) return 'SHIPPED';
  if (statuses.some(s => s.includes('deliver'))) return 'DELIVERED';
  return 'PENDING';
}

async function syncProducts(ctx) {
  let created = 0, updated = 0, total = 0;
  const data = await call(ctx, '/products/get', { limit: '100', offset: '0' }, null);
  const list = (data && data.data && data.data.products) || [];
  for (const it of list) {
    const sku = String(it.item_id || it.sku || '');
    if (!sku) continue;
    const name = (it.attributes && it.attributes.name) || ('Lazada ' + sku);
    const price = Number(it.skus && it.skus[0] && it.skus[0].price) || 0;
    const action = await upsertProduct(ctx, { sku: 'LZD-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
