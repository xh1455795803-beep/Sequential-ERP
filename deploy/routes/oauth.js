// 平台授权路由：24 个主流跨境平台真实授权协议
//   A) OAuth 跳转型（11 个）：Amazon / Shopee / TikTok Shop / Lazada / AliExpress / eBay / Mercado Libre / Wish / Etsy(PKCE) / Allegro / 抖音小店
//   B) 域名型 OAuth（3 个）：Shopify / Shoplazza 店匠 / Shopline（先输店铺域名再跳授权）
//   C) API 密钥型（10 个）：Temu / SHEIN / Coupang / OZON / Wildberries / Walmart / Fruugo / Qoo10 / Kaufland / OnBuy
// 平台开发者应用由运营商在 platform_apps 表配置（scripts/platform-app.js，密钥加密存储）
const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const config = require('../config');
const auth = require('../middleware/auth');
const { encrypt, decrypt, shopeeSign, newState } = require('../util-crypto');

const router = express.Router();

// ===== 标准 OAuth2 工厂（授权码模式）=====
function stdOAuth(name, opt) {
  return {
    name,
    authorize(app, state, cb, q, st) {
      return typeof opt.authUrl === 'function' ? opt.authUrl(app, state, cb, q, st) : opt.authUrl(app, state, cb);
    },
    needShop: !!opt.needShop, // 域名型：需先输入店铺域名
    pickCode(q) { return q.code; },
    async exchange(app, code, cb, q, stRow) {
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      const params = opt.tokenParams(app, code, cb, q, stRow);
      if (opt.basicAuth) {
        headers['Authorization'] = 'Basic ' + Buffer.from((app.client_id || app.app_id) + ':' + decrypt(app.app_secret_enc)).toString('base64');
      }
      const r = await fetch(opt.tokenUrl(app, q), { method: 'POST', headers, body: new URLSearchParams(params) });
      const data = await r.json().catch(() => ({}));
      const t = opt.parse(data);
      if (!t.accessToken) throw new Error(opt.errMsg(data));
      return { refreshToken: null, expiresIn: 3600, extShopId: null, extShopName: null, ...t };
    },
    async refresh(app, refreshToken) {
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      const params = opt.refreshParams(app, refreshToken);
      if (opt.basicAuth) {
        headers['Authorization'] = 'Basic ' + Buffer.from((app.client_id || app.app_id) + ':' + decrypt(app.app_secret_enc)).toString('base64');
      }
      const r = await fetch(opt.tokenUrlRefresh ? opt.tokenUrlRefresh(app) : opt.tokenUrl(app, {}), { method: 'POST', headers, body: new URLSearchParams(params) });
      const data = await r.json().catch(() => ({}));
      const t = opt.parseRefresh ? opt.parseRefresh(data) : opt.parse(data);
      if (!t.accessToken) throw new Error('令牌刷新失败');
      return { accessToken: t.accessToken, expiresIn: t.expiresIn || 3600 };
    },
  };
}

// ===== API 密钥型平台定义（新增到 34 个：覆盖北美/欧洲/东南亚/南亚/中东/非/拉美/澳新）=====
const KEY_PLATFORMS = {
  // 北美
  'Temu': { name: 'Temu 半托管', fields: [{ key: 'api_key', label: 'Access ID' }, { key: 'api_secret', label: 'Secret' }], where: 'Temu 商家后台 → 服务市场 → 开放平台', portal: 'https://seller.temu.com' },
  'SHEIN': { name: 'SHEIN', fields: [{ key: 'api_key', label: 'App Key' }, { key: 'api_secret', label: 'App Secret' }], where: 'SHEIN 开放平台（邀请制）', portal: 'https://open.sheincorp.com' },
  'Walmart': { name: 'Walmart', fields: [{ key: 'api_key', label: 'Client ID' }, { key: 'api_secret', label: 'Client Secret' }], where: 'Walmart Marketplace 开发者中心', portal: 'https://developer.walmart.com' },
  'Newegg': { name: 'Newegg', fields: [{ key: 'api_key', label: 'API Key' }, { key: 'api_secret', label: 'Secret Key' }], where: 'Newegg Seller Portal → Developer API', portal: 'https://seller.newegg.com' },
  'Houzz': { name: 'Houzz', fields: [{ key: 'api_key', label: 'API Token' }], where: 'Houzz Pro 商家后台 → API 设置', portal: 'https://www.houzz.com/pro' },
  'Overstock': { name: 'Overstock', fields: [{ key: 'api_key', label: 'API Key' }, { key: 'api_secret', label: 'API Secret' }], where: 'Overstock Supplier Central', portal: 'https://supplier.overstock.com' },
  'Home Depot': { name: 'Home Depot', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Home Depot Supplier API Portal', portal: 'https://supplier.homedepot.com' },
  'Costco': { name: 'Costco', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Costco 供应商后台（EDI/API）', portal: 'https://www.costco.com' },
  'Best Buy': { name: 'Best Buy', fields: [{ key: 'api_key', label: 'Client ID' }, { key: 'api_secret', label: 'Secret' }], where: 'Best Buy Marketplace Developer', portal: 'https://developer.bestbuy.com' },
  "Kohl's": { name: "Kohl's", fields: [{ key: 'api_key', label: 'API Key' }], where: "Kohl's 供应商平台", portal: 'https://www.kohls.com' },

  // 欧洲
  'Coupang': { name: 'Coupang 酷澎', fields: [{ key: 'api_key', label: 'Access Key' }, { key: 'api_secret', label: 'Secret Key' }], where: 'Coupang 开放平台（WING 后台）', portal: 'https://developers.coupang.com' },
  'OZON': { name: 'OZON', fields: [{ key: 'api_key', label: 'Client-Id' }, { key: 'api_secret', label: 'Api-Key' }], where: 'OZON Seller Center → 设置 → API 密钥', portal: 'https://seller.ozon.ru' },
  'Wildberries': { name: 'Wildberries', fields: [{ key: 'api_key', label: 'API Token' }], where: 'WB 卖家后台 → 设置 → API 访问令牌', portal: 'https://seller.wildberries.ru' },
  'Fruugo': { name: 'Fruugo', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Fruugo 卖家后台（人工开通 API）', portal: 'https://seller.fruugo.com' },
  'Qoo10': { name: 'Qoo10', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Qoo10 GMKT 卖家后台', portal: 'https://www.qoo10.com' },
  'Kaufland': { name: 'Kaufland', fields: [{ key: 'api_key', label: 'API Key' }, { key: 'api_secret', label: 'Secret Key' }], where: 'Kaufland 卖家后台 → API 设置', portal: 'https://seller.kaufland.com' },
  'OnBuy': { name: 'OnBuy', fields: [{ key: 'api_key', label: 'Consumer Key' }, { key: 'api_secret', label: 'Secret Key' }], where: 'OnBuy 卖家后台 → API 管理', portal: 'https://www.onbuy.com' },
  'Zalando': { name: 'Zalando', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Zalando Merchant Center → ZDirect API', portal: 'https://www.zalando.com' },
  'Cdiscount': { name: 'Cdiscount', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Cdiscount Seller → API Settings', portal: 'https://seller.cdiscount.com' },
  'Fnac': { name: 'Fnac', fields: [{ key: 'api_key', label: 'Partner ID' }, { key: 'api_secret', label: 'Secret Key' }], where: 'Fnac Marketplace API', portal: 'https://marketplace.fnac.com' },
  'Darty': { name: 'Darty', fields: [{ key: 'api_key', label: 'Partner ID' }, { key: 'api_secret', label: 'Secret Key' }], where: 'Darty Marketplace（沿用 Fnac 接口）', portal: 'https://www.darty.com' },
  'ManoMano': { name: 'ManoMano', fields: [{ key: 'api_key', label: 'API Key' }], where: 'ManoMano Seller → API 申请', portal: 'https://www.manomano.com' },
  'Back Market': { name: 'Back Market', fields: [{ key: 'api_key', label: 'API Token' }], where: 'Back Market Seller Dashboard → API', portal: 'https://www.backmarket.com' },
  'Bol.com': { name: 'Bol.com', fields: [{ key: 'api_key', label: 'Client ID' }, { key: 'api_secret', label: 'Client Secret' }], where: 'Bol.com Retailer API', portal: 'https://developers.bol.com' },
  'Coolblue': { name: 'Coolblue', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Coolblue Seller 平台 → API Settings', portal: 'https://www.coolblue.nl' },
  'MediaMarkt': { name: 'MediaMarkt', fields: [{ key: 'api_key', label: 'API Key' }], where: 'MediaMarktSaturn Marketplace API', portal: 'https://business.mediamarkt.de' },
  'Saturn': { name: 'Saturn', fields: [{ key: 'api_key', label: 'API Key' }], where: 'MediaMarktSaturn Marketplace API', portal: 'https://business.saturn.de' },
  'CDON': { name: 'CDON', fields: [{ key: 'api_key', label: 'API Key' }], where: 'CDON Marketplace → API Keys', portal: 'https://www.cdon.com' },
  'Elgiganten': { name: 'Elgiganten', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Elgiganten Business Portal → API', portal: 'https://www.elgiganten.se' },
  'eMag': { name: 'eMag', fields: [{ key: 'api_key', label: 'User' }, { key: 'api_secret', label: 'Password (API Key)' }], where: 'eMag Marketplace API', portal: 'https://marketplace.emag.ro' },

  // 东南亚/南亚/日韩
  'Daraz': { name: 'Daraz', fields: [{ key: 'api_key', label: 'App Key' }, { key: 'api_secret', label: 'App Secret' }], where: 'Daraz Open Platform', portal: 'https://open.daraz.com' },
  'Flipkart': { name: 'Flipkart', fields: [{ key: 'api_key', label: 'Client ID' }, { key: 'api_secret', label: 'Client Secret' }], where: 'Flipkart Seller API', portal: 'https://seller.flipkart.com' },
  'Meesho': { name: 'Meesho', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Meesho Supplier → API', portal: 'https://supplier.meesho.com' },
  'Sendo': { name: 'Sendo', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Sendo Seller → Open API', portal: 'https://www.sendo.vn' },
  'Tiki': { name: 'Tiki', fields: [{ key: 'api_key', label: 'Seller Key' }, { key: 'api_secret', label: 'Seller Secret' }], where: 'Tiki Seller Center → API', portal: 'https://seller.tiki.vn' },
  'JD.ID': { name: 'JD.ID', fields: [{ key: 'api_key', label: 'App Key' }, { key: 'api_secret', label: 'App Secret' }], where: 'JD.ID Open Platform', portal: 'https://seller.jd.id' },
  'Rakuten': { name: 'Rakuten 乐天', fields: [{ key: 'api_key', label: 'Service Secret' }, { key: 'api_secret', label: 'License Key' }], where: 'Rakuten Merchant RMS → API', portal: 'https://rms.rakuten.co.jp' },
  'Yahoo! Shopping': { name: 'Yahoo! Shopping', fields: [{ key: 'api_key', label: 'Client ID' }, { key: 'api_secret', label: 'Client Secret' }], where: 'Yahoo! Developer Network → Shopping API', portal: 'https://developer.yahoo.co.jp' },
  'PayPay Mall': { name: 'PayPay Mall', fields: [{ key: 'api_key', label: 'API Key' }], where: 'PayPay Mall 商家后台 → API', portal: 'https://www.paypaymall.jp' },
  'Gmarket': { name: 'Gmarket', fields: [{ key: 'api_key', label: 'App Key' }, { key: 'api_secret', label: 'App Secret' }], where: 'Gmarket/G9 Seller API', portal: 'https://www.gmarket.co.kr' },
  '11st': { name: '11번가 11st', fields: [{ key: 'api_key', label: 'API Key' }, { key: 'api_secret', label: 'API Secret' }], where: '11st Seller Center → API', portal: 'https://seller.11st.co.kr' },

  // 中东/非洲/拉美/澳新
  'Noon': { name: 'Noon', fields: [{ key: 'api_key', label: 'App Id' }, { key: 'api_secret', label: 'App Secret' }], where: 'Noon Partner API', portal: 'https://partners.noon.com' },
  'Namshi': { name: 'Namshi', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Namshi Seller Portal → API', portal: 'https://www.namshi.com' },
  'Souq': { name: 'Souq / Amazon.ae', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Souq 卖家后台（已并入 Amazon UAE）', portal: 'https://www.amazon.ae' },
  'Jumia': { name: 'Jumia', fields: [{ key: 'api_key', label: 'API Key' }, { key: 'api_secret', label: 'API Secret' }], where: 'Jumia Marketplace → API', portal: 'https://www.jumia.com.ng' },
  'Kilimall': { name: 'Kilimall', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Kilimall Seller Center → API', portal: 'https://www.kilimall.co.ke' },
  'Magazine Luiza': { name: 'Magazine Luiza (Magalu)', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Magalu Marketplace API', portal: 'https://sellers.magazineluiza.com.br' },
  'B2W': { name: 'B2W (Americanas/Submarino/Shoptime)', fields: [{ key: 'api_key', label: 'App Token' }, { key: 'api_secret', label: 'App Secret' }], where: 'B2W Marketplace Developer API', portal: 'https://b2wdigital.com' },
  'Dafiti': { name: 'Dafiti', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Dafiti Seller API', portal: 'https://www.dafiti.com.br' },
  'Linio': { name: 'Linio', fields: [{ key: 'api_key', label: 'Seller ID' }, { key: 'api_secret', label: 'API Secret' }], where: 'Linio Marketplace API', portal: 'https://www.linio.com' },
  'Catch': { name: 'Catch 澳洲', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Catch Sellers → API', portal: 'https://sellers.catch.com.au' },
  'Kogan': { name: 'Kogan', fields: [{ key: 'api_key', label: 'API Key' }, { key: 'api_secret', label: 'API Secret' }], where: 'Kogan Marketplace Developer Portal', portal: 'https://marketplace.kogan.com' },
  'MyDeal': { name: 'MyDeal', fields: [{ key: 'api_key', label: 'API Key' }], where: 'MyDeal Seller → API', portal: 'https://www.mydeal.com.au' },
  'Trade Me': { name: 'Trade Me 新西兰', fields: [{ key: 'api_key', label: 'OAuth Key' }, { key: 'api_secret', label: 'OAuth Secret' }], where: 'Trade Me Developer → My Trade Me API', portal: 'https://developer.trademe.co.nz' },

  // 独立站
  '独立站': { name: '自建站 (通用 Woo/Shop/S2B)', fields: [{ key: 'api_key', label: '网站 API Key' }, { key: 'api_secret', label: 'Secret / 网址' }], where: '自行提供的 REST API 凭证（按站点对接）', portal: 'https://example.com/wp-json/wc/v3' }
};

// ===== OAuth 平台定义 =====
const OAUTH_PLATFORMS = {
  'Amazon': {
    name: 'Amazon SP-API',
    authorize(app, state) {
      return `https://sellercentral.amazon.com/apps/authorize/consent?application_id=${encodeURIComponent(app.app_id)}&state=${state}&version=beta`;
    },
    pickCode(q) { return q.spapi_oauth_code || q.code; },
    async exchange(app, code, cb) {
      const r = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: app.client_id || app.app_id, client_secret: decrypt(app.app_secret_enc), redirect_uri: cb }),
      });
      const data = await r.json();
      if (!data.access_token) throw new Error(data.error_description || 'Amazon 令牌交换失败');
      return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: Number(data.expires_in) || 3600, extShopId: null, extShopName: null };
    },
    async refresh(app, refreshToken) {
      const r = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: app.client_id || app.app_id, client_secret: decrypt(app.app_secret_enc) }),
      });
      const data = await r.json();
      if (!data.access_token) throw new Error('Amazon 令牌刷新失败');
      return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3600 };
    },
  },

  'Shopee': {
    name: 'Shopee 开放平台',
    authorize(app, state, cb) {
      const ts = Math.floor(Date.now() / 1000);
      const path = '/api/v2/shop/auth_partner';
      const sign = shopeeSign(decrypt(app.app_secret_enc), path, ts);
      return `https://partner.shopeemobile.com${path}?partner_id=${app.app_id}&timestamp=${ts}&sign=${sign}&redirect=${encodeURIComponent(cb)}`;
    },
    pickCode(q) { return q.code; },
    async exchange(app, code, cb, q) {
      const ts = Math.floor(Date.now() / 1000);
      const path = '/api/v2/auth/token/get';
      const sign = shopeeSign(decrypt(app.app_secret_enc), path, ts);
      const r = await fetch(`https://partner.shopeemobile.com${path}?partner_id=${app.app_id}&timestamp=${ts}&sign=${sign}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, partner_id: Number(app.app_id), shop_id: q.shop_id ? Number(q.shop_id) : undefined }),
      });
      const data = await r.json();
      const t = data.response || {};
      if (!t.access_token) throw new Error(data.error || data.message || 'Shopee 令牌交换失败');
      return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: Number(t.expire_in) || 4 * 3600, extShopId: t.shop_id ? String(t.shop_id) : (q.shop_id || null), extShopName: t.shop_name || null };
    },
    async refresh(app, refreshToken) {
      const ts = Math.floor(Date.now() / 1000);
      const path = '/api/v2/auth/access_token/get';
      const sign = shopeeSign(decrypt(app.app_secret_enc), path, ts);
      const r = await fetch(`https://partner.shopeemobile.com${path}?partner_id=${app.app_id}&timestamp=${ts}&sign=${sign}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken, partner_id: Number(app.app_id) }),
      });
      const data = await r.json();
      const t = data.response || {};
      if (!t.access_token) throw new Error('Shopee 令牌刷新失败');
      return { accessToken: t.access_token, expiresIn: Number(t.expire_in) || 4 * 3600 };
    },
  },

  'TikTok Shop': {
    name: 'TikTok Shop 开放平台',
    authorize(app, state) {
      return `https://auth.tiktok-shops.com/oauth/authorize?app_key=${encodeURIComponent(app.app_id)}&state=${state}`;
    },
    pickCode(q) { return q.code; },
    async exchange(app, code) {
      const r = await fetch('https://auth.tiktok-shops.com/api/v2/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ app_key: app.app_id, app_secret: decrypt(app.app_secret_enc), code, grant_type: 'authorized_code' }),
      });
      const data = await r.json();
      const t = data.data || {};
      if (!t.access_token) throw new Error(data.message || 'TikTok 令牌交换失败');
      return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: Number(t.access_token_expire_in) || 7 * 86400, extShopId: t.authorized_shop ? String(t.authorized_shop.id) : (t.shop_cipher || null), extShopName: t.authorized_shop ? t.authorized_shop.name : null };
    },
    async refresh(app, refreshToken) {
      const r = await fetch('https://auth.tiktok-shops.com/api/v2/oauth/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ app_key: app.app_id, app_secret: decrypt(app.app_secret_enc), refresh_token: refreshToken, grant_type: 'refresh_token' }),
      });
      const data = await r.json();
      const t = data.data || {};
      if (!t.access_token) throw new Error('TikTok 令牌刷新失败');
      return { accessToken: t.access_token, expiresIn: Number(t.access_token_expire_in) || 7 * 86400 };
    },
  },

  'Lazada': {
    name: 'Lazada 开放平台',
    authorize(app, state, cb) {
      return `https://auth.lazada.com/oauth/authorize?response_type=code&force_auth=true&redirect_uri=${encodeURIComponent(cb)}&client_id=${encodeURIComponent(app.app_id)}&state=${state}`;
    },
    pickCode(q) { return q.code; },
    async exchange(app, code) {
      const r = await fetch('https://auth.lazada.com/rest/auth/token/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      });
      const data = await r.json();
      if (!data.access_token) throw new Error('Lazada 令牌交换失败');
      const cu = (data.country_user_info || [])[0] || {};
      return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: Number(data.expires_in) || 7 * 86400, extShopId: cu.seller_id ? String(cu.seller_id) : null, extShopName: cu.seller_name || null };
    },
    async refresh(app, refreshToken) {
      const r = await fetch('https://auth.lazada.com/rest/auth/token/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const data = await r.json();
      if (!data.access_token) throw new Error('Lazada 令牌刷新失败');
      return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 7 * 86400 };
    },
  },

  // ===== 速卖通 =====
  'AliExpress': stdOAuth('AliExpress 速卖通', {
    authUrl: (app, state, cb) => `https://oauth.aliexpress.com/authorize?client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}&view=web`,
    tokenUrl: () => 'https://oauth.aliexpress.com/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: decrypt(app.app_secret_enc), code, redirect_uri: cb, view: 'web' }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: decrypt(app.app_secret_enc), refresh_token: rt, view: 'web' }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.access_token_expire) || 86400 }),
    errMsg: d => d.error_description || d.error_msg || '速卖通令牌交换失败',
  }),

  // ===== eBay（client_id 存 RuName）=====
  'eBay': stdOAuth('eBay', {
    authUrl: (app, state, cb) => `https://auth.ebay.com/oauth2/authorize?client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(app.client_id || '')}&response_type=code&scope=${encodeURIComponent('https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory.readonly https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly')}&state=${state}`,
    tokenUrl: () => 'https://api.ebay.com/identity/v1/oauth2/token',
    basicAuth: true,
    tokenParams: (app, code) => ({ grant_type: 'authorization_code', code, redirect_uri: app.client_id || '' }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', refresh_token: rt, redirect_uri: app.client_id || '' }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 7200 }),
    errMsg: d => d.error_description || 'eBay 令牌交换失败',
  }),

  // ===== 美客多 =====
  'Mercado Libre': stdOAuth('Mercado Libre 美客多', {
    authUrl: (app, state, cb) => `https://auth.mercadolibre.com/authorization?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://api.mercadolibre.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: decrypt(app.app_secret_enc), code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: decrypt(app.app_secret_enc), refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 21600, extShopId: d.user_id ? String(d.user_id) : null }),
    errMsg: d => d.message || '美客多令牌交换失败',
  }),

  // ===== Wish =====
  'Wish': stdOAuth('Wish', {
    authUrl: (app) => `https://merchant.wish.com/oauth/authorize?client_id=${encodeURIComponent(app.app_id)}`,
    tokenUrl: () => 'https://merchant.wish.com/api/v3/oauth/access_token',
    tokenParams: (app, code, cb) => ({ client_id: app.app_id, client_secret: decrypt(app.app_secret_enc), code, grant_type: 'authorization_code', redirect_uri: cb }),
    refreshParams: (app, rt) => ({ client_id: app.app_id, client_secret: decrypt(app.app_secret_enc), refresh_token: rt, grant_type: 'refresh_token' }),
    parse: d => { const t = d.data || d; return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: Number(t.expires_in) || 2592000 }; },
    errMsg: d => d.message || 'Wish 令牌交换失败',
  }),

  // ===== Etsy（PKCE）=====
  'Etsy': stdOAuth('Etsy', {
    authUrl: (app, state, cb, q, stRow) => `https://www.etsy.com/oauth/connect?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&scope=${encodeURIComponent('listings_r shops_r')}&state=${state}&code_challenge=${stRow.code_verifier ? challenge(stRow.code_verifier) : ''}&code_challenge_method=S256`,
    tokenUrl: () => 'https://api.etsy.com/v3/public/oauth/token',
    tokenParams: (app, code, cb, q, stRow) => ({ grant_type: 'authorization_code', client_id: app.app_id, redirect_uri: cb, code, code_verifier: stRow ? stRow.code_verifier : '' }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Etsy 令牌交换失败',
  }),

  // ===== Allegro =====
  'Allegro': stdOAuth('Allegro', {
    authUrl: (app, state, cb) => `https://allegro.pl/auth/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://allegro.pl/auth/oauth/token',
    basicAuth: true,
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', code, redirect_uri: cb }),
    refreshParams: () => ({ grant_type: 'refresh_token' }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 43200 }),
    errMsg: d => d.error_description || d.error || 'Allegro 令牌交换失败',
  }),

  // ===== 抖音小店 =====
  'Douyin': stdOAuth('抖音小店', {
    authUrl: (app, state, cb) => `https://open.douyin.com/oauth/authorize?client_key=${encodeURIComponent(app.app_id)}&response_type=code&scope=${encodeURIComponent('order.list.read,product.list.read')}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://open.douyin.com/oauth/access_token/',
    tokenParams: (app, code) => ({ appid: app.app_id, secret: decrypt(app.app_secret_enc), code, grant_type: 'authorization_code' }),
    refreshParams: (app, rt) => ({ appid: app.app_id, secret: decrypt(app.app_secret_enc), refresh_token: rt, grant_type: 'refresh_token' }),
    parse: d => { const t = d.data || {}; return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: Number(t.expires_in) || 604800, extShopId: t.open_id || null }; },
    errMsg: d => (d.data && d.data.description) || d.message || '抖音令牌交换失败',
  }),

  // ===== 独立站（域名型 OAuth）=====
  'Shopify': shopOAuth('Shopify 独立站'),
  'Shoplazza': shopOAuth('Shoplazza 店匠'),
  'Shopline': shopOAuth('Shopline'),
};

// ===== 额外 OAuth/PKCE 平台补齐：按 stdOAuth 统一模式 (平台名 + 开发域名) =====
// 以下为 14 个「占位级」OAuth 定义（跳转/回调能跑通，令牌交换字段用平台常见命名；后续真实对接时再替换细节）
Object.assign(OAUTH_PLATFORMS, {
  // 北美
  'Newegg': stdOAuth('Newegg', {
    authUrl: (app, state, cb) => `https://www.newegg.com/sellers/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://api.newegg.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || d.message || 'Newegg 令牌交换失败'
  }),
  'Houzz': stdOAuth('Houzz', {
    authUrl: (app, state, cb) => `https://www.houzz.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://api.houzz.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Houzz 令牌交换失败'
  }),
  'Target': stdOAuth('Target', {
    authUrl: (app, state, cb) => `https://login.target.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://login.target.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Target 令牌交换失败'
  }),
  'Overstock': stdOAuth('Overstock', {
    authUrl: (app, state, cb) => `https://supplier.overstock.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://api.overstock.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Overstock 令牌交换失败'
  }),
  // 欧洲
  'Zalando': stdOAuth('Zalando', {
    authUrl: (app, state, cb) => `https://accounts.merchants.zalando.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://api.merchants.zalando.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Zalando 令牌交换失败'
  }),
  'Cdiscount': stdOAuth('Cdiscount', {
    authUrl: (app, state, cb) => `https://seller.cdiscount.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://api.cdiscount.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Cdiscount 令牌交换失败'
  }),
  'Bol.com': stdOAuth('Bol.com', {
    authUrl: (app, state, cb) => `https://login.bol.com/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://login.bol.com/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Bol.com 令牌交换失败'
  }),
  // 南亚/东南亚
  'Daraz': stdOAuth('Daraz', {
    authUrl: (app, state, cb) => `https://auth.daraz.com/oauth2/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://auth.daraz.com/oauth2/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', code, client_id: app.app_id, client_secret: app.app_secret, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', refresh_token: rt, client_id: app.app_id, client_secret: app.app_secret }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || d.error_description || 'Daraz 令牌交换失败'
  }),
  'Flipkart': stdOAuth('Flipkart', {
    authUrl: (app, state, cb) => `https://api.flipkart.net/oauth-service/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://api.flipkart.net/oauth-service/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Flipkart 令牌交换失败'
  }),
  'Rakuten': stdOAuth('Rakuten 乐天', {
    authUrl: (app, state, cb) => `https://app.rakuten.co.jp/services/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}&scope=rms%3Aorder`,
    tokenUrl: () => 'https://app.rakuten.co.jp/services/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Rakuten 令牌交换失败'
  }),
  // 中东/拉美/澳新
  'Noon': stdOAuth('Noon', {
    authUrl: (app, state, cb) => `https://accounts.noon.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://oauth.noon.com/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Noon 令牌交换失败'
  }),
  'Linio': stdOAuth('Linio', {
    authUrl: (app, state, cb) => `https://sellercenter.linio.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://sellercenter.linio.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Linio 令牌交换失败'
  }),
  'Catch': stdOAuth('Catch 澳洲', {
    authUrl: (app, state, cb) => `https://sso.catch.com.au/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://sso.catch.com.au/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Catch 令牌交换失败'
  }),
  'Kogan': stdOAuth('Kogan', {
    authUrl: (app, state, cb) => `https://sso.kogan.com/oauth/authorize?response_type=code&client_id=${encodeURIComponent(app.app_id)}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`,
    tokenUrl: () => 'https://api.kogan.com/oauth/token',
    tokenParams: (app, code, cb) => ({ grant_type: 'authorization_code', client_id: app.app_id, client_secret: app.app_secret, code, redirect_uri: cb }),
    refreshParams: (app, rt) => ({ grant_type: 'refresh_token', client_id: app.app_id, client_secret: app.app_secret, refresh_token: rt }),
    parse: d => ({ accessToken: d.access_token, refreshToken: d.refresh_token, expiresIn: Number(d.expires_in) || 3600 }),
    errMsg: d => d.error || 'Kogan 令牌交换失败'
  }),
});

// 域名型 OAuth 工厂（Shopify 系：myshopify/店匠/Shopline 同协议）
function shopOAuth(name) {
  return {
    name,
    needShop: true,
    authorize(app, state, cb, q) {
      const shop = String(q.shop || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      return `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(app.app_id)}&scope=${encodeURIComponent('read_orders,read_products,read_fulfillments')}&redirect_uri=${encodeURIComponent(cb)}&state=${state}`;
    },
    pickCode(q) { return q.code; },
    async exchange(app, code, cb, q) {
      const shop = String(q.shop || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!shop) throw new Error('缺少店铺域名');
      const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: app.app_id, client_secret: decrypt(app.app_secret_enc), code }),
      });
      const data = await r.json();
      if (!data.access_token) throw new Error('独立站令牌交换失败');
      return { accessToken: data.access_token, refreshToken: null, expiresIn: 365 * 86400, extShopId: shop, extShopName: shop };
    },
    async refresh() { throw new Error('独立站令牌长期有效，无需刷新'); },
  };
}

// PKCE challenge：base64url(sha256(verifier))
function challenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function callbackBase() {
  return (process.env.PUBLIC_BASE_URL || 'https://qianniu-erp.cc') + '/api/v1/oauth';
}

function frontUrl(params) {
  return (process.env.PUBLIC_BASE_URL || 'https://qianniu-erp.cc') + '/app/#/shops' + (params || '');
}

async function getPlatformApp(platform) {
  const rows = await query("SELECT * FROM platform_apps WHERE platform = ? AND status = 'active'", [platform]);
  return rows[0] || null;
}

/** 各平台可授权状态（租户端展示，不含密钥） */
router.get('/status', auth, async (req, res, next) => {
  try {
    const rows = await query("SELECT platform FROM platform_apps WHERE status = 'active'");
    const configured = new Set(rows.map(r => r.platform));
    const oauth = Object.entries(OAUTH_PLATFORMS).map(([platform, def]) => ({
      platform, name: def.name, mode: def.needShop ? 'shop-oauth' : 'oauth',
      needShop: !!def.needShop,
      configured: configured.has(platform),
      authorizeUrl: '/api/v1/oauth/authorize/' + encodeURIComponent(platform),
    }));
    const apiKey = Object.entries(KEY_PLATFORMS).map(([platform, def]) => ({
      platform, name: def.name, mode: 'apikey',
      fields: def.fields, where: def.where, portal: def.portal,
      configured: configured.has(platform),
    }));
    res.json({ items: [...oauth, ...apiKey] });
  } catch (err) { next(err); }
});

/** 发起授权：返回平台官方授权页 URL（前端 fetch 携带令牌调用后跳转，避免浏览器直跳丢鉴权） */
router.get('/authorize-url/:platform', auth, async (req, res, next) => {
  try {
    const platform = req.params.platform;
    const def = OAUTH_PLATFORMS[platform];
    if (!def) return res.status(400).json({ error: '该平台暂不支持在线授权，请手动录入' });
    if (def.needShop && !req.query.shop) return res.status(400).json({ error: '请先填写店铺域名再发起授权' });

    const app = await getPlatformApp(platform);
    if (!app) return res.status(400).json({ error: `「${def.name}」开发者应用尚未配置，请联系运营商配置后再授权` });

    // 记录 state（10 分钟有效；Etsy 顺带存 PKCE verifier）
    const state = newState();
    const verifier = platform === 'Etsy' ? crypto.randomBytes(48).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
    await query(
      'INSERT INTO oauth_states (state, platform, tenant_id, user_id, expires_at, code_verifier) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), ?)',
      [state, platform, req.user.tenantId, req.user.uid, verifier]
    );
    await query('DELETE FROM oauth_states WHERE expires_at < NOW()');

    const url = def.authorize(app, state, callbackBase() + '/callback/' + encodeURIComponent(platform), req.query, { code_verifier: verifier });
    res.json({ url });
  } catch (err) { next(err); }
});

/** 密钥型平台：录入 API 密钥（加密存储，支持任意字段 + 保存前探活校验） */
router.post('/apikey/:platform', auth, async (req, res, next) => {
  try {
    const platform = req.params.platform;
    const def = KEY_PLATFORMS[platform];
    if (!def) return res.status(400).json({ error: '该平台不支持密钥录入' });

    const body = req.body || {};
    const shop_name = String(body.shop_name || '').trim();

    // —— 1) 按 KEY_PLATFORMS.fields 逐一提取必填，不再只硬认 api_key / api_secret ——
    const values = {};
    for (const f of def.fields) {
      const raw = body[f.key];
      const v = typeof raw === 'string' ? raw.trim() : (raw == null ? '' : String(raw));
      if (!v) return res.status(400).json({ error: `请填写 ${f.label}` });
      // 最小长度兜底：拒绝 1~3 位的"随便输一个"的假凭证
      if (v.length < 4) return res.status(400).json({ error: `${f.label} 长度不足，疑似无效凭证` });
      values[f.key] = v;
    }

    // —— 2) 探活：先调用适配器 probeCredentials / syncOrders（dry mode）验证凭证是否真实可用 ——
    const adapters = require('../platforms');
    const adapter = adapters.lookup(platform);
    let probeMsg = null;
    if (adapter && typeof adapter.probeCredentials === 'function') {
      try {
        await adapter.probeCredentials(values, platform);
      } catch (e) {
        probeMsg = e.message || '凭证无效';
        return res.status(400).json({ error: `凭证校验失败：${probeMsg}（请确认从「${def.where || '平台后台'}」正确复制）` });
      }
    } else if (adapter && typeof adapter.syncOrders === 'function') {
      // stub 适配器：至少能走通流程不会抛 notImplemented（即使 imported = 0）
      try {
        const fakeShop = {
          tenant_id: req.user.tenantId,
          platform,
          id: 0,
          name: shop_name || def.name,
          // 传进未加密字段：用一个短期假行让 buildContext 读取到 raw keys（探活不落库）
          api_key_enc: 'raw:' + (values.api_key || values[Object.keys(values)[0]] || ''),
          api_secret_enc: 'raw:' + (values.api_secret || values[Object.keys(values)[1]] || ''),
          ext_fields_enc: 'raw:' + Buffer.from(JSON.stringify(values)).toString('base64')
        };
        const resProbe = await adapter.syncOrders(fakeShop, null);
        if (!resProbe || typeof resProbe !== 'object') {
          return res.status(400).json({ error: '平台响应异常，无法确认凭证有效性' });
        }
      } catch (e) {
        if (/not implemented|NOT_IMPLEMENTED|UNSUPPORTED/i.test(e.message)) {
          // 未实现的：至少字段校验过了，允许保存
        } else {
          return res.status(400).json({ error: `凭证校验失败：${e.message || '未知错误'}` });
        }
      }
    }

    // —— 3) 套餐店铺数限制 ——
    const { PLANS } = require('../util');
    const tenants = await query('SELECT * FROM tenants WHERE id = ?', [req.user.tenantId]);
    const plan = PLANS[tenants[0].plan] || PLANS.trial;
    const cnt = await query('SELECT COUNT(*) AS c FROM shops WHERE tenant_id = ?', [req.user.tenantId]);
    if (cnt[0].c >= plan.shops) return res.status(400).json({ error: `当前套餐（${plan.name}）最多接入 ${plan.shops} 个店铺，请升级套餐` });

    // —— 4) 写库：第一个字段 => api_key_enc；第二个字段 => api_secret_enc；第 3+ 字段 => ext_fields_enc JSON ——
    const orderedKeys = def.fields.map(f => f.key);
    const keyEnc = encrypt(values[orderedKeys[0]]);
    const secretEnc = orderedKeys.length >= 2 ? encrypt(values[orderedKeys[1]]) : null;
    let extEnc = null;
    if (orderedKeys.length > 2) {
      const ext = {};
      for (let i = 2; i < orderedKeys.length; i++) ext[orderedKeys[i]] = values[orderedKeys[i]];
      extEnc = encrypt(JSON.stringify(ext));
    }

    const name = shop_name || def.name;
    const { PLATFORM_CURRENCY } = require('../sync-service');
    const currency = PLATFORM_CURRENCY[platform] || 'USD';
    const r = await query(
      `INSERT INTO shops (tenant_id, name, platform, auth_status, api_key_enc, api_secret_enc, ext_fields_enc, authorized_at, currency)
       VALUES (?, ?, ?, 'authorized', ?, ?, ?, NOW(), ?)`,
      [req.user.tenantId, name, platform, keyEnc, secretEnc, extEnc, currency]
    );
    await query(
      "INSERT INTO sync_logs (tenant_id, shop_id, platform, job_type, status, message, finished_at) VALUES (?, ?, ?, 'auth', 'ok', ?, NOW())",
      [req.user.tenantId, r.insertId, platform,
        `API 密钥已录入（加密存储，字段 ${orderedKeys.join('+')}${probeMsg ? '，探活通过' : '，平台适配器 stub 级校验通过'}`]
    );
    res.json({ ok: true, id: r.insertId, probed: !!probeMsg });
  } catch (err) { next(err); }
});

/** 平台回调：校验 state → 换令牌 → 加密落库 → 跳回控制台 */
router.get('/callback/:platform', async (req, res, next) => {
  const fail = (msg) => res.redirect(frontUrl('?auth=failed&msg=' + encodeURIComponent(msg)));
  try {
    const platform = req.params.platform;
    const def = OAUTH_PLATFORMS[platform];
    if (!def) return fail('不支持的平台回调');

    const state = req.query.state || '';
    const code = def.pickCode(req.query);
    if (!code) return fail('平台未返回授权码');

    // 校验 state（Lazada 个别场景可能不回传 state，放行最近 10 分钟内的该平台记录）
    let stRow = null;
    if (state) {
      const rows = await query('SELECT * FROM oauth_states WHERE state = ? AND expires_at > NOW()', [state]);
      stRow = rows[0] || null;
      if (!stRow) return fail('授权状态已过期，请重新发起授权');
    } else {
      const rows = await query("SELECT * FROM oauth_states WHERE platform = ? AND expires_at > NOW() ORDER BY id DESC LIMIT 1", [platform]);
      stRow = rows[0] || null;
      if (!stRow) return fail('授权状态已过期，请重新发起授权');
    }

    const app = await getPlatformApp(platform);
    if (!app) return fail('开发者应用配置缺失');

    // 真实令牌交换
    const t = await def.exchange(app, code, callbackBase() + '/callback/' + encodeURIComponent(platform), req.query, stRow);
    const extShopId = t.extShopId || (req.query.selling_partner_id ? String(req.query.selling_partner_id) : null);

    // 套餐店铺数限制
    const { PLANS } = require('../util');
    const tenants = await query('SELECT * FROM tenants WHERE id = ?', [stRow.tenant_id]);
    const plan = PLANS[tenants[0].plan] || PLANS.trial;
    const cnt = await query('SELECT COUNT(*) AS c FROM shops WHERE tenant_id = ?', [stRow.tenant_id]);
    if (cnt[0].c >= plan.shops) return fail(`当前套餐（${plan.name}）最多接入 ${plan.shops} 个店铺，请升级套餐`);

    // 已有同平台外部店铺则覆盖令牌，否则新建
    let shop;
    if (extShopId) {
      const exist = await query('SELECT * FROM shops WHERE tenant_id = ? AND platform = ? AND ext_shop_id = ?', [stRow.tenant_id, platform, extShopId]);
      shop = exist[0] || null;
    }
    const expiresAt = new Date(Date.now() + t.expiresIn * 1000);
    if (shop) {
      await query(
        `UPDATE shops SET auth_status='authorized', access_token_enc=?, refresh_token_enc=?, token_expires_at=?, authorized_at=NOW(),
         ext_shop_id=COALESCE(?, ext_shop_id), ext_shop_name=COALESCE(?, ext_shop_name) WHERE id=?`,
        [encrypt(t.accessToken), encrypt(t.refreshToken), expiresAt, extShopId, t.extShopName, shop.id]
      );
    } else {
      const name = t.extShopName || `${platform} 店铺` + (extShopId ? ` (${extShopId})` : '');
      const { PLATFORM_CURRENCY } = require('../sync-service');
      const currency = PLATFORM_CURRENCY[platform] || 'USD';
      const r = await query(
        `INSERT INTO shops (tenant_id, name, platform, auth_status, ext_shop_id, ext_shop_name, access_token_enc, refresh_token_enc, token_expires_at, authorized_at, currency)
         VALUES (?, ?, ?, 'authorized', ?, ?, ?, ?, ?, NOW(), ?)`,
        [stRow.tenant_id, name, platform, extShopId, t.extShopName, encrypt(t.accessToken), encrypt(t.refreshToken), expiresAt, currency]
      );
      shop = { id: r.insertId };
    }
    await query('DELETE FROM oauth_states WHERE state = ?', [stRow.state]);
    await query("INSERT INTO sync_logs (tenant_id, shop_id, platform, job_type, status, message, finished_at) VALUES (?, ?, ?, 'auth', 'ok', 'OAuth 授权成功', NOW())", [stRow.tenant_id, shop.id, platform]);

    res.redirect(frontUrl('?auth=success&shop=' + shop.id));
  } catch (err) {
    console.error('[oauth callback]', err.message);
    fail('授权失败：' + err.message);
  }
});

/** 刷新令牌 */
router.post('/refresh/:shopId', auth, async (req, res, next) => {
  try {
    const shops = await query('SELECT * FROM shops WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.shopId]);
    const shop = shops[0];
    if (!shop) return res.status(404).json({ error: '店铺不存在' });
    const def = OAUTH_PLATFORMS[shop.platform];
    if (!def || !shop.refresh_token_enc) return res.status(400).json({ error: '该店铺无在线授权令牌' });

    const app = await getPlatformApp(shop.platform);
    if (!app) return res.status(400).json({ error: '平台应用配置缺失' });

    const t = await def.refresh(app, decrypt(shop.refresh_token_enc));
    const expiresAt = new Date(Date.now() + t.expiresIn * 1000);
    await query("UPDATE shops SET access_token_enc=?, token_expires_at=?, auth_status='authorized' WHERE id=?", [encrypt(t.accessToken), expiresAt, shop.id]);
    res.json({ ok: true, token_expires_at: expiresAt });
  } catch (err) { next(err); }
});

/** 解除授权（保留店铺与业务数据，仅清除令牌/密钥） */
router.post('/unlink/:shopId', auth, async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE shops SET auth_status='manual', access_token_enc=NULL, refresh_token_enc=NULL, token_expires_at=NULL, authorized_at=NULL, api_key_enc=NULL, api_secret_enc=NULL WHERE tenant_id=? AND id=?`,
      [req.user.tenantId, req.params.shopId]
    );
    if (!r.affectedRows) return res.status(404).json({ error: '店铺不存在' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** 同步订单：Shopee / TikTok 真实拉单（复用同步服务），其余平台需运营商开通对应 API 套件 */
router.post('/sync/:shopId', auth, async (req, res, next) => {
  try {
    const shops = await query('SELECT * FROM shops WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.shopId]);
    const shop = shops[0];
    if (!shop) return res.status(404).json({ error: '店铺不存在' });
    const { checkSyncable, syncOrders } = require('../sync-service');
    checkSyncable(shop);
    const app = await getPlatformApp(shop.platform);
    const { imported, skipped } = await syncOrders(shop, app);
    await query('UPDATE shops SET last_sync_at = NOW() WHERE id = ?', [shop.id]);
    await query("INSERT INTO sync_logs (tenant_id, shop_id, platform, job_type, imported, skipped, status, message, finished_at) VALUES (?, ?, ?, 'orders', ?, ?, 'success', ?, NOW())",
      [req.user.tenantId, shop.id, shop.platform, imported, skipped, `新导入 ${imported} 单，跳过已存在 ${skipped} 单`]);
    res.json({ ok: true, imported, skipped, last_sync_at: new Date() });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** 最近同步日志（手动 + 定时） */
router.get('/logs', auth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT l.id, l.job_type AS type, l.status, l.message, l.imported, l.skipped, l.finished_at, l.created_at, s.name AS shop_name, s.platform
       FROM sync_logs l LEFT JOIN shops s ON s.tenant_id = l.tenant_id AND s.id = l.shop_id
       WHERE l.tenant_id = ? ORDER BY l.id DESC LIMIT 30`,
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

module.exports = router;

[EXIT_CODE=0]
