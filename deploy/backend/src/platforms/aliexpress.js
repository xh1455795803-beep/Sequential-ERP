// AliExpress 适配器（OAuth + 签名）
// 文档：https://openservice.aliexpress.com
const { buildContext, upsertOrder, upsertProduct } = require('./base');
const crypto = require('crypto');

const API_BASE = 'https://api-sg.aliexpress.com/sync';

// AliExpress 签名：HMAC-SHA256(secret, sorted params + body)
function sign(params, secret) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHmac('sha256', secret).update(sorted, 'utf8').digest('hex').toUpperCase();
}

async function call(ctx, method, payload) {
  if (!ctx.accessToken) throw new Error('AliExpress 无 access_token，请重新授权');
  if (!ctx.app || !ctx.app.app_id || !ctx.app.app_secret_enc) throw new Error('AliExpress 应用未配置');
  const ts = Date.now().toString();
  const secret = ctx.decrypt(ctx.app.app_secret_enc);
  const baseParams = {
    method,
    app_key: ctx.app.app_id,
    access_token: ctx.accessToken,
    sign_method: 'sha256',
    timestamp: ts,
  };
  const allParams = { ...baseParams, ...payload };
  allParams.sign = sign(allParams, secret);
  const r = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(allParams).toString(),
  });
  const txt = await r.text();
  let data; try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.error_message || data.error || data._raw)) || `AliExpress 调用失败(${r.status})`;
    throw new Error('AliExpress 调用失败: ' + String(msg).slice(0, 300));
  }
  return data;
}

async function syncOrders(ctx) {
  const since = Math.floor((Date.now() - 30 * 86400 * 1000) / 1000);
  const to = Math.floor(Date.now() / 1000);
  const data = await call(ctx, 'aliexpress.solution.order.get', {
    param: JSON.stringify({ order_query: { create_date_start: since, create_date_end: to, page_size: 100, page: 1 } }),
  });
  const list = (data && data.aliexpress_solution_order_get_response && data.aliexpress_solution_order_get_response.result && data.aliexpress_solution_order_get_response.result.target_list && data.aliexpress_solution_order_get_response.result.target_list.order_dto) || [];
  let imported = 0, skipped = 0;
  for (const o of list) {
    const orderNo = 'AE' + String(o.order_id || '').toString().replace(/[^0-9]/g, '');
    if (!orderNo || orderNo === 'AE') { skipped++; continue; }
    const action = await upsertOrder(ctx, {
      orderNo,
      status: mapStatus(o.order_status),
      totalAmount: Number(o.order_amount && o.order_amount.amount) || 0,
      buyerName: o.login_id || '',
      country: o.logistics_address && o.logistics_address.country || '',
      createdAt: o.gmt_create ? Math.floor(new Date(o.gmt_create).getTime() / 1000) : null,
    });
    action === 'import' ? imported++ : skipped++;
  }
  return { imported, skipped };
}

function mapStatus(s) {
  const v = String(s || '').toString().toLowerCase();
  if (v.includes('cancel')) return 'CANCELLED';
  if (v.includes('ship')) return 'SHIPPED';
  if (v.includes('finish') || v.includes('deliver')) return 'DELIVERED';
  if (v.includes('wait')) return 'PENDING';
  return 'PENDING';
}

async function syncProducts(ctx) {
  let created = 0, updated = 0, total = 0;
  const data = await call(ctx, 'aliexpress.solution.product.list.get', {
    param: JSON.stringify({ page_size: 100, current_page: 1 }),
  });
  const list = (data && data.aliexpress_solution_product_list_get_response && data.aliexpress_solution_product_list_get_response.result && data.aliexpress_solution_product_list_get_response.result.products) || [];
  for (const it of list) {
    const sku = String(it.product_id || it.sku_code || '');
    if (!sku) continue;
    const name = it.subject || it.subject_multi_language || ('AliExpress ' + sku);
    const price = Number(it.simple_product_info && it.simple_product_info.product_price || it.product_price) || 0;
    const action = await upsertProduct(ctx, { sku: 'AE-' + sku, name, price });
    total++;
    action === 'create' ? created++ : updated++;
  }
  return { created, updated, total };
}

module.exports = {
  syncOrders: async (shop, app) => syncOrders(await buildContext(shop, app)),
  syncProducts: async (shop, app) => syncProducts(await buildContext(shop, app)),
};
