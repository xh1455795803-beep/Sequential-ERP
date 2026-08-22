// 商品路由：CRUD（租户内 SKU 唯一，建品即初始化 MAIN 仓库存行）+ 平台 Listing 同步
const express = require('express');
const { query, withTransaction } = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT p.*, i.qty_on_hand, i.qty_reserved, (i.qty_on_hand - i.qty_reserved) AS qty_available
       FROM products p
       LEFT JOIN inventory i ON i.tenant_id = p.tenant_id AND i.product_id = p.id AND i.warehouse = 'MAIN'
       WHERE p.tenant_id = ? ORDER BY p.id DESC`,
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { sku, name, category, price, cost } = req.body || {};
    if (!sku || !String(sku).trim()) return res.status(400).json({ error: '请填写 SKU' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写商品名称' });

    const item = await withTransaction(async conn => {
      const [r] = await conn.query(
        'INSERT INTO products (tenant_id, sku, name, category, price, cost) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.tenantId, String(sku).trim(), String(name).trim(), category || null, price || 0, cost || 0]
      );
      await conn.query(
        'INSERT INTO inventory (tenant_id, product_id, warehouse, qty_on_hand, qty_reserved) VALUES (?, ?, ?, 0, 0)',
        [req.user.tenantId, r.insertId, 'MAIN']
      );
      const [rows] = await conn.query('SELECT * FROM products WHERE id = ?', [r.insertId]);
      return rows[0];
    });
    res.json({ item });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '该 SKU 已存在' });
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { sku, name, category, price, cost } = req.body || {};
    const fields = [], params = [];
    if (sku !== undefined) { fields.push('sku = ?'); params.push(String(sku).trim()); }
    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (category !== undefined) { fields.push('category = ?'); params.push(category); }
    if (price !== undefined) { fields.push('price = ?'); params.push(price); }
    if (cost !== undefined) { fields.push('cost = ?'); params.push(cost); }
    if (!fields.length) return res.status(400).json({ error: '无更新字段' });
    params.push(req.user.tenantId, req.params.id);
    const r = await query(`UPDATE products SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: '商品不存在' });
    const rows = await query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    res.json({ item: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '该 SKU 已存在' });
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const holding = await query(
      `SELECT qty_on_hand, qty_reserved FROM inventory WHERE tenant_id = ? AND product_id = ? AND warehouse = 'MAIN'`,
      [req.user.tenantId, req.params.id]
    );
    if (holding.length && (holding[0].qty_on_hand > 0 || holding[0].qty_reserved > 0)) {
      return res.status(400).json({ error: '该商品仍有库存或占用，无法删除' });
    }
    await withTransaction(async conn => {
      await conn.query('DELETE FROM inventory WHERE tenant_id = ? AND product_id = ?', [req.user.tenantId, req.params.id]);
      await conn.query('DELETE FROM products WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** 从平台同步商品 Listing（Shopee / TikTok 真实拉取，导入本地商品库） */
router.post('/sync/:shopId', async (req, res, next) => {
  try {
    const shops = await query('SELECT * FROM shops WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.shopId]);
    const shop = shops[0];
    if (!shop) return res.status(404).json({ error: '店铺不存在' });
    const { checkSyncable, syncProducts } = require('../sync-service');
    checkSyncable(shop);
    const apps = await query("SELECT * FROM platform_apps WHERE platform = ? AND status = 'active'", [shop.platform]);
    const result = await syncProducts(shop, apps[0] || null);
    await query("INSERT INTO sync_logs (tenant_id, shop_id, type, status, message) VALUES (?,?,'products','ok',?)",
      [req.user.tenantId, shop.id, `商品同步：拉取 ${result.total} 个，新建 ${result.created}，更新 ${result.updated}`]);
    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

/** 可同步商品的店铺列表（有令牌的授权店铺） */
router.get('/syncable-shops', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, name, platform, currency FROM shops
       WHERE tenant_id = ? AND access_token_enc IS NOT NULL AND (token_expires_at IS NULL OR token_expires_at > NOW()) AND status = 'active'`,
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

module.exports = router;
