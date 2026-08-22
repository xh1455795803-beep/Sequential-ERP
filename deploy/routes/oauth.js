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

// ===== API 密钥型平台定义 =====
const KEY_PLATFORMS = {
  'Temu': { name: 'Temu 半托管', fields: [{ key: 'api_key', label: 'Access ID' }, { key: 'api_secret', label: 'Secret' }], where: 'Temu 商家后台 → 服务市场 → 开放平台', portal: 'https://seller.temu.com' },
  'SHEIN': { name: 'SHEIN', fields: [{ key: 'api_key', label: 'App Key' }, { key: 'api_secret', label: 'App Secret' }], where: 'SHEIN 开放平台（邀请制）', portal: 'https://open.sheincorp.com' },
  'Coupang': { name: 'Coupang 酷澎', fields: [{ key: 'api_key', label: 'Access Key' }, { key: 'api_secret', label: 'Secret Key' }], where: 'Coupang 开放平台（WING 后台）', portal: 'https://developers.coupang.com' },
  'OZON': { name: 'OZON', fields: [{ key: 'api_key', label: 'Client-Id' }, { key: 'api_secret', label: 'Api-Key' }], where: 'OZON Seller Center → 设置 → API 密钥', portal: 'https://seller.ozon.ru' },
  'Wildberries': { name: 'Wildberries', fields: [{ key: 'api_key', label: 'API Token' }], where: 'WB 卖家后台 → 设置 → API 访问令牌', portal: 'https://seller.wildberries.ru' },
  'Walmart': { name: 'Walmart', fields: [{ key: 'api_key', label: 'Client ID' }, { key: 'api_secret', label: 'Client Secret' }], where: 'Walmart Marketplace 开发者中心', portal: 'https://developer.walmart.com' },
  'Fruugo': { name: 'Fruugo', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Fruugo 卖家后台（人工开通 API）', portal: 'https://seller.fruugo.com' },
  'Qoo10': { name: 'Qoo10', fields: [{ key: 'api_key', label: 'API Key' }], where: 'Qoo10 GMKT 卖家后台', portal: 'https://www.qoo10.com' },
  'Kaufland': { name: 'Kaufland', fields: [{ key: 'api_key', label: 'API Key' }, { key: 'api_secret', label: 'Secret Key' }], where: 'Kaufland 卖家后台 → API 设置', portal: 'https://seller.kaufland.com' },
  'OnBuy': { name: 'OnBuy', fields: [{ key: 'api_key', label: 'Consumer Key' }, { key: 'api_secret', label: 'Secret Key' }], where: 'OnBuy 卖家后台 → API 管理', portal: 'https://www.onbuy.com' },
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
    authUrl: (app, state, cb) => `https://allegro.
[EXIT_CODE=0]
