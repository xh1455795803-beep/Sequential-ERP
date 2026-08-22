// 同步服务：订单拉取 + 商品 Listing 拉取（供手动触发与后台定时调度共用）
// 平台支持：
//   - Shopee / TikTok Shop：内置实现（历史稳定）
//   - Amazon / AliExpress / Lazada / eBay / Mercado Libre / Allegro / OZON /
//     Wildberries / Coupang / Temu / SHEIN / Walmart / Fruugo / Qoo10 / Kaufland / OnBuy
//     → platforms/ 适配器框架统一调度
const { query } = require('./db');
const { shopeeSign } = require('./util-crypto');
const adapters = require('./platforms');

// 平台默认结算币种（授权建店时写入 shops.currency）
const PLATFORM_CURRENCY = {
  'Amazon': 'USD', 'Shopee': 'SGD', 'TikTok Shop': 'USD', 'Lazada': 'SGD', 'AliExpress': 'USD',
  'eBay': 'USD', 'Mercado Libre': 'USD', 'Wish': 'USD', 'Etsy': 'USD', 'Allegro': 'PLN',
  'Douyin': 'CNY', 'Shopify': 'USD', 'Shoplazza': 'USD', 'Shopline': 'USD',
  'Temu': 'USD', 'SHEIN': 'USD', 'Coupang': 'KRW', 'OZON': 'RUB', 'Wildberries': 'RUB',
  'Walmart': 'USD', 'Fruugo': 'GBP', 'Qoo10': 'JPY', 'Kaufland': 'EUR', 'OnBuy': 'GBP'
};

/** 当前汇率（币种→CNY），未知币种按 1 */
async function getRate(code) {
  if (!code || code === 'CNY') return 1;
  const rows = await query('SELECT rate FROM exchange_rates WHERE code = ?', [code]);
  return rows.length ? Number(rows[0].rate) : 1;
}

/** 同步订单：shop 为 shops 行（含令牌加密列），app 为平台应用配置行 */
async function syncOrders(shop, app) {
  // 优先用适配器框架（新接入平台）
  const adapter = adapters.lookup(shop.platform);
  if (adapter) {
    return await adapter.syncOrders(shop, app);
  }
  // 内置：Shopee / TikTok Shop
  return await syncOrdersLegacy(shop, app);
}

/** 同步商品 Listing：拉取平台在售商品，按 SKU 前缀导入/更新本地商品库 */
async function syncProducts(shop, app) {
  const adapter = adapters.lookup(shop.platform);
  if (adapter) {
    return await adapter.syncProducts(shop, app);
  }
  return await syncProductsLegacy(shop, app);
}

/** 令牌刷新：仅 OAuth 型适配器支持 */
async function refreshToken(shop, app) {
  const adapter = adapters.lookup(shop.platform);
  if (!adapter || typeof adapter.refreshToken !== 'function') {
    return null; // 不支持自动刷新（密钥型或 Shopee/TikTok 走原逻辑）
  }
  return await adapter.refreshToken(shop, app);
}

// ===== 内置实现：Shopee / TikTok Shop =====
async function syncOrdersLegacy(shop, app) {
  const { decrypt } = require('./util-crypto');
  const accessToken = shop.access_token_enc ? decrypt(shop.access_token_enc) : null;
  let imported = 0, skipped = 0;
  const currency = shop.currency || 'CNY';
  const rate = await getRate(currency);

  if (shop.platform === 'Shopee' && app && accessToken) {
    const ts = Math.floor(Date.now() / 1000);
    const path = '/api/v2/order/get_order_list';
    const sign = shopeeSign(decrypt(app.app_secret_enc), path, ts);
    const r = await fetch(`https://partner.shopeemobile.com${path}?partner_id=${app.app_id}&timestamp=${ts}&sign=${sign}&access_token=${encodeURIComponent(accessToken)}&shop_id=${shop.ext_shop_id}&page_size=50`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time_range_field: 'create_time', time_from: Math.floor(Date.now() / 1000) - 30 * 86400, time_to: Math.floor(Date.now() / 1000), page_size: 50 }),
    });
    const data = await r.json();
    const list = (data.response && data.response.order_list) || [];
    if (!data.response) throw new Error(data.error || data.message || 'Shopee 拉单失败');
    for (const o of list) {
      const orderNo = 'SHP' + o.order_sn;
      const exist = await query('SELECT id FROM orders WHERE tenant_id=? AND order_no=?', [shop.tenant_id, orderNo]);
      if (exist.length) { skipped++; continue; }
      await query(
        'INSERT INTO orders (tenant_id, order_no, shop_id, status, total_amount, buyer_name, country, currency, exchange_rate, created_at) VALUES (?,?,?,?,?,?,?,?,?,FROM_UNIXTIME(?))',
        [shop.tenant_id, orderNo, shop.id, 'PENDING', Number(o.total_amount) || 0, o.buyer_username || '', '', currency, rate, o.create_time]
      );
      imported++;
    }
  } else if (shop.platform === 'TikTok Shop' && accessToken) {
    const r = await fetch('https://open-api.tiktokglobalshop.com/order/list/search?access_token=' + encodeURIComponent(accessToken), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tts-access-token': accessToken },
      body: JSON.stringify({ page_size: 50 }),
    });
    const data = await r.json();
    const list = (data.data && data.data.orders) || [];
    if (data.code && data.code !== 0) throw new Error(data.message || 'TikTok 拉单失败');
    for (const o of list) {
      const orderNo = 'TT' + o.id;
      const exist = await query('SELECT id FROM orders WHERE tenant_id=? AND order_no=?', [shop.tenant_id, orderNo]);
      if (exist.length) { skipped++; continue; }
      await query(
        'INSERT INTO orders (tenant_id, order_no, shop_id, status, total_amount, buyer_name, country, currency, exchange_rate) VALUES (?,?,?,?,?,?,?,?,?)',
        [shop.tenant_id, orderNo, shop.id, 'PENDING', Number(o.payment && o.payment.total_amount) || 0, (o.recipient && o.recipient.name) || '', '', currency, rate]
      );
      imported++;
    }
  } else {
    throw new Error(`${shop.platform} 订单自动同步需运营商开通对应 API 套件，当前请手动录入订单`);
  }
  return { imported, skipped };
}

async function syncProductsLegacy(shop, app) {
  const { decrypt } = require('./util-crypto');
  const accessToken = shop.access_token_enc ? decrypt(shop.access_token_enc) : null;
  let items = [];

  if (shop.platform === 'Shopee' && app && accessToken) {
    const ts = Math.floor(Date.now() / 1000);
    const path = '/api/v2/product/get_item_list';
    const sign = shopeeSign(decrypt(app.app_secret_enc), path, ts);
    const r = await fetch(`https://partner.shopeemobile.com${path}?partner_id=${app.app_id}&timestamp=${ts}&sign=${sign}&access_token=${encodeURIComponent(accessToken)}&shop_id=${shop.ext_shop_id}&page_size=100`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page_size: 100 }),
    });
    const data = await r.json();
    const list = (data.response && data.response.item) || [];
    if (!data.response) throw new Error(data.error || data.message || 'Shopee 商品列表拉取失败');
    if (list.length) {
      const ids = list.map(i => i.item_id);
      const ts2 = Math.floor(Date.now() / 1000);
      const path2 = '/api/v2/product/get_item_base_info';
      const sign2 = shopeeSign(decrypt(app.app_secret_enc), path2, ts2);
      const r2 = await fetch(`https://partner.shopeemobile.com${path2}?partner_id=${app.app_id}&timestamp=${ts2}&sign=${sign2}&access_token=${encodeURIComponent(accessToken)}&shop_id=${shop.ext_shop_id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id_list: ids }),
      });
      const d2 = await r2.json();
      const base = (d2.response && d2.response.item_list) || [];
      items = base.map(b => ({ sku: 'SHP-' + b.item_id, name: b.item_name || ('Shopee 商品 ' + b.item_id), price: Number(b.price_info && b.price_info[0] && b.price_info[0].original_price) || 0 }));
    }
  } else if (shop.platform === 'TikTok Shop' && accessToken) {
    const r = await fetch('https://open-api.tiktokglobalshop.com/product/202309/products/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-tts-access-token': accessToken },
      body: JSON.stringify({ page_size: 100 }),
    });
    const data = await r.json();
    const list = (data.data && data.data.products) || [];
    if (data.code && data.code !== 0) throw new Error(data.message || 'TikTok 商品拉取失败');
    items = list.map(p => ({ sku: 'TT-' + p.id, name: p.title && p.title[0] || ('TikTok 商品 ' + p.id), price: 0 }));
  } else {
    throw new Error(`${shop.platform} 商品自动同步需运营商开通对应 API 套件，请手动录入商品`);
  }

  let created = 0, updated = 0;
  for (const it of items) {
    const exist = await query('SELECT id FROM products WHERE tenant_id=? AND sku=?', [shop.tenant_id, it.sku]);
    if (exist.length) {
      await query('UPDATE products SET name=?, price=? WHERE id=?', [it.name, it.price, exist[0].id]);
      updated++;
    } else {
      const r = await query(
        'INSERT INTO products (tenant_id, sku, name, category, price, cost) VALUES (?,?,?,?,?,0)',
        [shop.tenant_id, it.sku, it.name, shop.platform, it.price]
      );
      await query("INSERT INTO inventory (tenant_id, product_id, warehouse, qty_on_hand, qty_reserved) VALUES (?,?, 'MAIN', 0, 0)", [shop.tenant_id, r.insertId]);
      created++;
    }
  }
  return { created, updated, total: items.length };
}

/** 校验店铺可同步（令牌存在且未过期） */
function checkSyncable(shop) {
  // 密钥型平台（无 access_token_enc）放宽：只要 api_key_enc 有值即可
  const isKeyPlatform = ['OZON', 'Wildberries', 'Coupang', 'Temu', 'SHEIN', 'Walmart', 'Fruugo', 'Qoo10', 'Kaufland', 'OnBuy'].includes(shop.platform);
  if (isKeyPlatform) {
    if (!shop.api_key_enc) throw Object.assign(new Error('该密钥型店铺缺少 API Key，请先完成 API 凭证配置'), { status: 400 });
    return;
  }
  if (!shop.access_token_enc) throw Object.assign(new Error('该店铺无授权令牌（手动录入或密钥型店铺），暂不支持自动同步'), { status: 400 });
  if (shop.token_expires_at && new Date(shop.token_expires_at) < new Date()) {
    throw Object.assign(new Error('令牌已过期，请先刷新令牌'), { status: 400 });
  }
}

module.exports = { syncOrders, syncProducts, checkSyncable, getRate, refreshToken, PLATFORM_CURRENCY };
