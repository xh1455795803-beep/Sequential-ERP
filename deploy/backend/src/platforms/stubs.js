// 占位适配器：新接入的 29 个平台
// 统一走 base 适配器，syncOrders/syncProducts 返回 {imported:0, skipped:0, note:'待接入 OpenAPI'}
// 这样平台下拉、店铺创建、手动同步按钮都能正常用，不会"同步"按钮一按就炸
const Base = require('./base');

/**
 * Stub 工厂：生成一个合法的适配器
 * @param platform 平台名（用于日志 / 注释）
 * @param authMode 'apikey' | 'oauth' | 'unknown'
 */
function createStub(platform, authMode = 'apikey') {
  async function syncOrders(shop, app) {
    await Base.buildContext(shop, app);
    return { imported: 0, skipped: 0, mode: authMode, __stub: true, stub: true, platform,
             note: '占位适配器：该平台 OpenAPI 真实同步尚未接入，同步不报错但不会写入订单/商品。请联系运营商接入后再开启自动同步。' };
  }
  async function syncProducts(shop, app) {
    await Base.buildContext(shop, app);
    return { created: 0, updated: 0, skipped: 0, mode: authMode, __stub: true, stub: true, platform,
             note: '占位适配器：该平台真实商品同步尚未接入。' };
  }
  return { syncOrders, syncProducts, __stub: true, __authMode: authMode, __platform: platform };
}

module.exports = {
  // 北美
  'Newegg': createStub('Newegg', 'apikey'),
  'Etsy': createStub('Etsy', 'oauth'),     // oauth.js 已定义 OAuth 流程
  'Wish': createStub('Wish', 'oauth'),     // oauth.js 已定义 OAuth 流程
  'Houzz': createStub('Houzz', 'apikey'),
  'Overstock': createStub('Overstock', 'apikey'),
  'Target': createStub('Target', 'oauth'),
  'Home Depot': createStub('Home Depot', 'apikey'),
  'Costco': createStub('Costco', 'apikey'),
  'Best Buy': createStub('Best Buy', 'apikey'),
  'Kohl\'s': createStub("Kohl's", 'apikey'),

  // 欧洲
  'Zalando': createStub('Zalando', 'apikey'),
  'Cdiscount': createStub('Cdiscount', 'apikey'),
  'Fnac': createStub('Fnac', 'apikey'),
  'Darty': createStub('Darty', 'apikey'),
  'ManoMano': createStub('ManoMano', 'apikey'),
  'Back Market': createStub('Back Market', 'apikey'),
  'Bol.com': createStub('Bol.com', 'apikey'),
  'Coolblue': createStub('Coolblue', 'apikey'),
  'MediaMarkt': createStub('MediaMarkt', 'apikey'),
  'Saturn': createStub('Saturn', 'apikey'),
  'CDON': createStub('CDON', 'apikey'),
  'Elgiganten': createStub('Elgiganten', 'apikey'),
  'eMag': createStub('eMag', 'apikey'),

  // 东南亚/南亚 + 日韩
  'Daraz': createStub('Daraz', 'oauth'),
  'Flipkart': createStub('Flipkart', 'apikey'),
  'Meesho': createStub('Meesho', 'apikey'),
  'Sendo': createStub('Sendo', 'apikey'),
  'Tiki': createStub('Tiki', 'apikey'),
  'JD.ID': createStub('JD.ID', 'apikey'),
  'Rakuten': createStub('Rakuten', 'apikey'),
  'Yahoo! Shopping': createStub('Yahoo! Shopping', 'apikey'),
  'PayPay Mall': createStub('PayPay Mall', 'apikey'),
  'Gmarket': createStub('Gmarket', 'apikey'),
  '11st': createStub('11st', 'apikey'),

  // 中东/非洲
  'Noon': createStub('Noon', 'apikey'),
  'Namshi': createStub('Namshi', 'apikey'),
  'Jumia': createStub('Jumia', 'apikey'),
  'Kilimall': createStub('Kilimall', 'apikey'),
  'Souq': createStub('Souq', 'apikey'),

  // 拉美
  'Magazine Luiza': createStub('Magazine Luiza', 'apikey'),
  'B2W': createStub('B2W', 'apikey'),
  'Dafiti': createStub('Dafiti', 'apikey'),
  'Linio': createStub('Linio', 'apikey'),

  // 澳洲
  'Catch': createStub('Catch', 'apikey'),
  'Kogan': createStub('Kogan', 'apikey'),
  'MyDeal': createStub('MyDeal', 'apikey'),
  'Trade Me': createStub('Trade Me', 'apikey'),

  // 独立站/国内
  'Douyin': createStub('Douyin', 'oauth'),    // oauth.js 已定义 OAuth 流程
  'Shopify': createStub('Shopify', 'oauth'),  // 需商家域名后授权
  'Shoplazza': createStub('Shoplazza', 'oauth'),
  'Shopline': createStub('Shopline', 'oauth'),
  '独立站': createStub('独立站', 'apikey'),
};
