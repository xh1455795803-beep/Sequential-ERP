// 平台适配器注册表：统一映射 platform 名称 → 适配器模块
// 每个适配器导出: syncOrders(shop, app), syncProducts(shop, app)
// 部分适配器额外导出: refreshToken(shop, app)
module.exports = {
  // OAuth 型
  'Amazon': require('./amazon'),
  'AliExpress': require('./aliexpress'),
  'Lazada': require('./lazada'),
  'eBay': require('./ebay'),
  'Mercado Libre': require('./mercadolibre'),
  'Allegro': require('./allegro'),
  // Shopee / TikTok Shop 仍走 sync-service 内置实现（历史稳定，不迁移）
  // API 密钥型
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

// 已注册平台列表（用于管理后台展示）
const SUPPORTED = Object.keys(module.exports);

function lookup(platform) {
  return module.exports[platform] || null;
}

module.exports.SUPPORTED = SUPPORTED;
module.exports.lookup = lookup;
