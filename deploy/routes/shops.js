// 店铺路由：CRUD + 套餐店铺数限制 + 手动同步触发（订单/商品/令牌刷新）
const express = require('express');
const { query } = require('../db');
const { PLANS } = require('../util');
const audit = require('../middleware/audit');
const { syncOrders, syncProducts, checkSyncable, refreshToken } = require('../sync-service');
const adapters = require('../platforms');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT s.id, s.tenant_id, s.name, s.platform, s.status, s.commission_rate, s.currency, s.created_at,
              s.auth_status, s.ext_shop_id, s.ext_shop_name, s.token_expires_at, s.authorized_at, s.last_sync_at,
              (s.access_token_enc IS NOT NULL) AS has_token,
              (s.api_key_enc IS NOT NULL) AS has_apikey,
              (SELECT COUNT(*) FROM orders o WHERE o.shop_id = s.id) AS order_count,
              CASE WHEN s.access_token_enc IS NOT NULL AND s.token_expires_at IS NOT NULL AND s.token_expires_at < NOW()
                   THEN 'expired' ELSE s.auth_status END AS effective_auth
       FROM shops s WHERE s.tenant_id = ? ORDER BY s.id DESC`,
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, platform, commission_rate, currency } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写店铺名称' });
    if (!platform) return res.status(400).json({ error: '请选择平台' });
    if (String(name).trim().length < 2) return res.status(400).json({ error: '店铺名称至少 2 个字' });

    // —— 平台白名单校验：必须在 OAUTH_PLATFORMS / KEY_PLATFORMS / PLATFORM_CURRENCY 中存在其一 ——
    const oa = require('./oauth');
    const cur = require('../sync-service').PLATFORM_CURRENCY;
    const allowed = new Set([...Object.keys(oa.OAUTH_PLATFORMS || {}), ...Object.keys(oa.KEY_PLATFORMS || {}), ...Object.keys(cur)]);
    if (!allowed.has(platform)) {
      return res.status(400).json({ error: `「${platform}」不在已接入平台列表，请在「自动授权」的卡片里接入` });
    }

    const rate = commission_rate === undefined || commission_rate === null || commission_rate === '' ? 0 : Number(commission_rate);
    if (isNaN(rate) || rate < 0 || rate > 0.5) return res.status(400).json({ error: '佣金率需在 0% - 50% 之间' });
    const cur2 = /^[A-Z]{3}$/.test(currency || '') ? currency : 'CNY';

    const tenants = await query('SELECT * FROM tenants WHERE id = ?', [req.user.tenantId]);
    const plan = PLANS[tenants[0].plan] || PLANS.trial;
    const count = await query('SELECT COUNT(*) AS c FROM shops WHERE tenant_id = ?', [req.user.tenantId]);
    if (count[0].c >= plan.shops) {
      return res.status(403).json({ error: `当前套餐（${plan.name}）最多接入 ${plan.shops} 个店铺，请升级套餐` });
    }

    // —— 防重复：同租户下同平台 + 同店铺名，不允许重复登记 ——
    const dup = await query(
      'SELECT id FROM shops WHERE tenant_id = ? AND platform = ? AND name = ? LIMIT 1',
      [req.user.tenantId, platform, String(name).trim()]
    );
    if (dup.length) return res.status(409).json({ error: '该平台下已存在同名店铺，请勿重复录入' });

    const r = await query(
      'INSERT INTO shops (tenant_id, name, platform, commission_rate, currency, auth_status) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.tenantId, String(name).trim(), platform, rate, cur2, 'manual']
    );
    const rows = await query('SELECT * FROM shops WHERE id = ?', [r.insertId]);
    res.json({ item: rows[0] });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '该平台下已存在同名店铺，请勿重复录入' });
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { name, platform, status, commission_rate } = req.body || {};
    const fields = [], params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (platform !== undefined) { fields.push('platform = ?'); params.push(platform); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (commission_rate !== undefined) {
      const rate = Number(commission_rate);
      if (isNaN(rate) || rate < 0 || rate > 0.5) return res.status(400).json({ error: '佣金率需在 0% - 50% 之间' });
      fields.push('commission_rate = ?'); params.push(rate);
    }
    if (!fields.length) return res.status(400).json({ error: '无更新字段' });
    params.push(req.user.tenantId, req.params.id);
    const r = await query(`UPDATE shops SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: '店铺不存在' });
    const rows = await query('SELECT * FROM shops WHERE id = ?', [req.params.id]);
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const r = await query('DELETE FROM shops WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: '店铺不存在' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// [P2] 手动触发同步：POST /:id/sync  body: { type: 'orders' | 'products' }
router.post('/:id/sync', audit('shop.sync'), async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM shops WHERE tenant_id=? AND id=?', [req.user.tenantId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '店铺不存在' });
    const shop = rows[0];
    const type = (req.body && req.body.type) || 'orders';
    try { checkSyncable(shop); }
    catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const apps = await query("SELECT * FROM platform_apps WHERE platform=? AND status='active'", [shop.platform]);
    const app = apps[0] || null;
    const tStart = Date.now();
    try {
      const result = type === 'products' ? await syncProducts(shop, app) : await syncOrders(shop, app);
      // 更新 last_sync_at
      await query('UPDATE shops SET last_sync_at=NOW() WHERE id=?', [shop.id]);
      // 写 sync_logs
      await query(
        'INSERT INTO sync_logs (tenant_id, shop_id, platform, job_type, imported, skipped, status, message, finished_at) VALUES (?,?,?,?,?,?,?, ?, NOW())',
        [shop.tenant_id, shop.id, shop.platform, type,
         result.imported || result.created || 0, result.skipped || 0,
         'success', JSON.stringify(result).slice(0, 480)]
      );
      res.json({ ok: true, result });
    } catch (e) {
      await query(
        'INSERT INTO sync_logs (tenant_id, shop_id, platform, job_type, status, message, finished_at) VALUES (?,?,?,?,?,?, NOW())',
        [shop.tenant_id, shop.id, shop.platform, type, 'failed', e.message.slice(0, 480)]
      );
      throw e;
    }
  } catch (err) { next(err); }
});

// [P2] 手动刷新令牌（OAuth 型）：POST /:id/refresh-token
router.post('/:id/refresh-token', audit('shop.refreshToken'), async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM shops WHERE tenant_id=? AND id=?', [req.user.tenantId, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '店铺不存在' });
    const shop = rows[0];
    const adapter = adapters.lookup(shop.platform);
    if (!adapter || typeof adapter.refreshToken !== 'function') {
      return res.status(400).json({ error: `${shop.platform} 不支持令牌自动刷新（密钥型或内置实现）` });
    }
    const apps = await query("SELECT * FROM platform_apps WHERE platform=? AND status='active'", [shop.platform]);
    const app = apps[0] || null;
    const newToken = await refreshToken(shop, app);
    if (!newToken || !newToken.accessToken) {
      return res.status(400).json({ error: '令牌刷新失败，请重新完成授权' });
    }
    const expiresAt = new Date(Date.now() + (newToken.expiresIn || 3600) * 1000);
    const { encrypt } = require('../util-crypto');
    await query('UPDATE shops SET access_token_enc=?, token_expires_at=?, authorized_at=NOW() WHERE id=?',
      [encrypt(newToken.accessToken), expiresAt, shop.id]);
    res.json({ ok: true, expires_at: expiresAt });
  } catch (err) { next(err); }
});

// [P2] 已注册平台列表：GET /supported-platforms（前端可用作授权面板）
router.get('/supported-platforms', (req, res) => {
  res.json({ items: adapters.SUPPORTED });
});

module.exports = router;

[EXIT_CODE=0]
