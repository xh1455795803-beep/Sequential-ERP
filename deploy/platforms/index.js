// 平台适配器注册表：统一映射 platform 名称 → 适配器模块
// 每个适配器导出: syncOrders(shop, app), syncProducts(shop, app)
// 部分适配器额外导出: refreshToken(shop, app)
const stubs = require('./stubs');

const REGISTRY = {
  // OAuth 型（真实实现）
  'Amazon': require('./amazon'),
  'AliExpress': require('./aliexpress'),
  'Lazada': require('./lazada'),
  'eBay': require('./ebay'),
  'Mercado Libre': require('./mercadolibre'),
  'Allegro': require('./allegro'),
  // Shopee / TikTok Shop 走 sync-service 内置实现（历史稳定，不迁移）

  // API 密钥型（真实实现）
  'OZON': require('./ozon'),
  'Wildberries': require('./wildberries'),
  'Coupang': require('./coupang'),
  'Temu': require('./temu'),
  'SHEIN': require('./shein'),
  'Walmart': require('./walmart'),
  'Fruugo': require('./fruugo'),
  'Qoo10': require('./qoo10'),
  'Kaufland': require('./kaufland'),
  'OnBuy': require('./onbuy'),
};

// 把 29+ 个占位适配器合并进 REGISTRY（如有真实实现以 REGISTRY 优先，跳过）
for (const [name, mod] of Object.entries(stubs)) {
  if (!REGISTRY[name]) REGISTRY[name] = mod;
}
// 国内/独立站几个（与 oauth.js 里 14 OAuth + stubs.js 里 4 个独立站重复，此处合并去重）
for (const extra of ['Shopee', 'TikTok Shop']) {
  if (!REGISTRY[extra]) REGISTRY[extra] = stubs[extra] || stubs['Douyin']; // dummy, sync-service 内置真正实现
}

// 已注册平台列表（管理后台展示）
const SUPPORTED = Object.keys(REGISTRY).sort();

function lookup(platform) {
  return REGISTRY[platform] || stubs[platform] || null;
}

module.exports = REGISTRY;
module.exports.SUPPORTED = SUPPORTED;
module.exports.lookup = lookup;
