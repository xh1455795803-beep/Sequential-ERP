// 平台适配器基类与公共工具
// 所有适配器实现统一接口：
//   - syncOrders(ctx)        拉取订单（去重+落库）
//   - syncProducts(ctx)      拉取在售商品（落库到 products + inventory）
//   - refreshToken?(ctx)     可选：刷新访问令牌（OAuth 型平台）
// ctx 含 shop、app、decrypt、query、getRate、prefix（订单号前缀）
const { decrypt } = require('../util-crypto');
const { query } = require('../db');

// 内置汇率查询（避免与 sync-service 形成循环依赖）
async function getRate(code) {
  if (!code || code === 'CNY') return 1;
  const rows = await query('SELECT rate FROM exchange_rates WHERE code = ?', [code]);
  return rows.length ? Number(rows[0].rate) : 1;
}

// 公共上下文构造：注入 decrypt/query/getRate 与计算汇率
async function buildContext(shop, app) {
  const currency = shop.currency || 'CNY';
  const rate = await getRate(currency);
  return {
    shop,
    app,
    decrypt,
    query,
    getRate,
    currency,
    rate,
    // 取出已解密的 access token（OAuth 型）
    accessToken: shop.access_token_enc ? decrypt(shop.access_token_enc) : null,
    refreshToken: shop.refresh_token_enc ? decrypt(shop.refresh_token_enc) : null,
    // 取出已解密的 API key/secret（密钥型平台）
    apiKey: shop.api_key_enc ? decrypt(shop.api_key_enc) : null,
    apiSecret: shop.api_secret_enc ? decrypt(shop.api_secret_enc) : null,
  };
}

// 公共：订单去重 + 写入（返回 {imported, skipped}）
async function upsertOrder(ctx, o) {
  const { shop } = ctx;
  const exist = await query('SELECT id FROM orders WHERE tenant_id=? AND order_no=?', [shop.tenant_id, o.orderNo]);
  if (exist.length) return 'skip';
  await query(
    `INSERT INTO orders (tenant_id, order_no, shop_id, status, total_amount, buyer_name, country, currency, exchange_rate, created_at)
     VALUES (?,?,?,?,?,?,?,?,?, IFNULL(FROM_UNIXTIME(?), NOW()))`,
    [shop.tenant_id, o.orderNo, shop.id, o.status || 'PENDING',
     Number(o.totalAmount) || 0, o.buyerName || '', o.country || '',
     ctx.currency, ctx.rate, o.createdAt || null]
  );
  return 'import';
}

// 公共：商品去重 + 写入（存在则更新名称/价格，不存在则新建并初始化库存行）
async function upsertProduct(ctx, p) {
  const { shop } = ctx;
  const exist = await query('SELECT id FROM products WHERE tenant_id=? AND sku=?', [shop.tenant_id, p.sku]);
  if (exist.length) {
    await query('UPDATE products SET name=?, price=? WHERE id=?', [p.name, Number(p.price) || 0, exist[0].id]);
    return 'update';
  }
  const r = await query(
    'INSERT INTO products (tenant_id, sku, name, category, price, cost) VALUES (?,?,?,?,?,0)',
    [shop.tenant_id, p.sku, p.name, shop.platform, Number(p.price) || 0]
  );
  await query(
    "INSERT INTO inventory (tenant_id, product_id, warehouse, qty_on_hand, qty_reserved) VALUES (?,?, 'MAIN', 0, 0)",
    [shop.tenant_id, r.insertId]
  );
  return 'create';
}

// 公共：fetch + JSON 解析 + 错误抛出
async function fetchJson(url, opt = {}, errMsg = '请求失败') {
  const r = await fetch(url, opt);
  const txt = await r.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { _raw: txt }; }
  if (!r.ok) {
    const msg = (data && (data.error || data.message || data.errors || data._raw)) || `${errMsg}(${r.status})`;
    const e = new Error(`${errMsg}: ${String(msg).slice(0, 300)}`);
    e.status = r.status; e.payload = data;
    throw e;
  }
  return data;
}

// 公共：HMAC-SHA256 签名
function hmacSha256(key, msg, algo = 'sha256') {
  return require('crypto').createHmac(algo, key).update(msg).digest();
}

// 公共：MD5 大写
function md5Upper(s) {
  return require('crypto').createHash('md5').update(s).digest('hex').toUpperCase();
}

// 公共：Sleep
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = {
  buildContext,
  upsertOrder,
  upsertProduct,
  fetchJson,
  hmacSha256,
  md5Upper,
  sleep,
};
