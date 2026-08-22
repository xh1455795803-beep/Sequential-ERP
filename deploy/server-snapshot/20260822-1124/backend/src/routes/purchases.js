// 采购管理路由：供应商 CRUD + 采购单（创建→入库回写库存→取消）
const express = require('express');
const ledger = require('../inventory-ledger');
const crypto = require('crypto');
const { query, withTransaction } = require('../db');

const router = express.Router();

const PURCHASE_STATUS = { DRAFT: '待入库', RECEIVED: '已入库', CANCELLED: '已取消' };

function purchaseNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `PO${ymd}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

/* ===== 供应商 ===== */

router.get('/suppliers', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT sp.*, (SELECT COUNT(*) FROM purchases p WHERE p.supplier_id = sp.id AND p.status != 'CANCELLED') AS po_count
       FROM suppliers sp WHERE sp.tenant_id = ? ORDER BY sp.id DESC`,
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/suppliers', async (req, res, next) => {
  try {
    const { name, contact, phone, remark } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写供应商名称' });
    const r = await query(
      'INSERT INTO suppliers (tenant_id, name, contact, phone, remark) VALUES (?, ?, ?, ?, ?)',
      [req.user.tenantId, String(name).trim(), contact || null, phone || null, remark || null]
    );
    const rows = await query('SELECT * FROM suppliers WHERE id = ?', [r.insertId]);
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/suppliers/:id', async (req, res, next) => {
  try {
    const { name, contact, phone, remark } = req.body || {};
    const fields = [], params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (contact !== undefined) { fields.push('contact = ?'); params.push(contact); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
    if (remark !== undefined) { fields.push('remark = ?'); params.push(remark); }
    if (!fields.length) return res.status(400).json({ error: '无更新字段' });
    params.push(req.user.tenantId, req.params.id);
    const r = await query(`UPDATE suppliers SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: '供应商不存在' });
    const rows = await query('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/suppliers/:id', async (req, res, next) => {
  try {
    const used = await query("SELECT COUNT(*) AS c FROM purchases WHERE tenant_id = ? AND supplier_id = ? AND status != 'CANCELLED'", [req.user.tenantId, req.params.id]);
    if (used[0].c > 0) return res.status(400).json({ error: '该供应商存在采购记录，无法删除' });
    const r = await query('DELETE FROM suppliers WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: '供应商不存在' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* ===== 采购单 ===== */

router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query;
    const params = [req.user.tenantId];
    let where = 'WHERE p.tenant_id = ?';
    if (status) { where += ' AND p.status = ?'; params.push(status); }
    const rows = await query(
      `SELECT p.*, sp.name AS supplier_name,
              (SELECT COUNT(*) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS item_count,
              (SELECT COALESCE(SUM(pi.qty), 0) FROM purchase_items pi WHERE pi.purchase_id = p.id) AS total_qty
       FROM purchases p
       LEFT JOIN suppliers sp ON sp.tenant_id = p.tenant_id AND sp.id = p.supplier_id
       ${where} ORDER BY p.id DESC LIMIT 200`,
      params
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const pos = await query(
      `SELECT p.*, sp.name AS supplier_name FROM purchases p
       LEFT JOIN suppliers sp ON sp.tenant_id = p.tenant_id AND sp.id = p.supplier_id
       WHERE p.tenant_id = ? AND p.id = ?`,
      [req.user.tenantId, req.params.id]
    );
    if (!pos.length) return res.status(404).json({ error: '采购单不存在' });
    const items = await query(
      `SELECT pi.*, pr.sku, pr.name FROM purchase_items pi
       JOIN products pr ON pr.tenant_id = pi.tenant_id AND pr.id = pi.product_id
       WHERE pi.purchase_id = ?`,
      [req.params.id]
    );
    res.json({ item: { ...pos[0], items } });
  } catch (err) { next(err); }
});

// 创建采购单（DRAFT）
router.post('/', async (req, res, next) => {
  try {
    const { supplier_id, remark, items } = req.body || {};
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: '采购单至少包含一个商品行' });
    for (const it of items) {
      const q = parseInt(it.qty, 10);
      if (!it.product_id || !Number.isInteger(q) || q <= 0) {
        return res.status(400).json({ error: '采购行参数不合法（product_id + 正整数 qty）' });
      }
    }

    const po = await withTransaction(async conn => {
      // 校验商品归属
      for (const it of items) {
        const [prods] = await conn.query('SELECT id FROM products WHERE tenant_id = ? AND id = ?', [req.user.tenantId, it.product_id]);
        if (!prods.length) throw Object.assign(new Error('商品不存在'), { status: 404 });
      }
      const total = items.reduce((s, it) => s + Number(it.unit_cost || 0) * it.qty, 0);
      const no = purchaseNo();
      const [r] = await conn.query(
        'INSERT INTO purchases (tenant_id, purchase_no, supplier_id, status, total_amount, remark) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.tenantId, no, supplier_id || null, 'DRAFT', total.toFixed(2), remark || null]
      );
      for (const it of items) {
        await conn.query(
          'INSERT INTO purchase_items (tenant_id, purchase_id, product_id, qty, unit_cost) VALUES (?, ?, ?, ?, ?)',
          [req.user.tenantId, r.insertId, it.product_id, it.qty, it.unit_cost || 0]
        );
      }
      const [rows] = await conn.query('SELECT * FROM purchases WHERE id = ?', [r.insertId]);
      return rows[0];
    });
    res.json({ item: po });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// 入库：DRAFT → RECEIVED，库存 on_hand += qty，并回写商品最新成本
router.post('/:id/receive', async (req, res, next) => {
  try {
    const po = await withTransaction(async conn => {
      const [rows] = await conn.query(
        'SELECT * FROM purchases WHERE tenant_id = ? AND id = ? FOR UPDATE',
        [req.user.tenantId, req.params.id]
      );
      if (!rows.length) throw Object.assign(new Error('采购单不存在'), { status: 404 });
      if (rows[0].status !== 'DRAFT') {
        throw Object.assign(new Error(`采购单当前状态「${PURCHASE_STATUS[rows[0].status]}」不允许入库`), { status: 400 });
      }

      const [items] = await conn.query('SELECT * FROM purchase_items WHERE purchase_id = ?', [req.params.id]);
      for (const it of items) {
        const [inv] = await conn.query(
          "SELECT id FROM inventory WHERE tenant_id = ? AND product_id = ? AND warehouse = 'MAIN' FOR UPDATE",
          [req.user.tenantId, it.product_id]
        );
        if (!inv.length) throw Object.assign(new Error('商品库存记录不存在'), { status: 400 });
        await conn.query(
          "UPDATE inventory SET qty_on_hand = qty_on_hand + ? WHERE id = ?",
          [it.qty, inv[0].id]
        );
        await ledger.record(conn, { tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN', changeType: 'inbound', qtyChange: it.qty, qtyBefore: 0, qtyAfter: 0, balanceField: 'on_hand', refType: 'purchase', refId: parseInt(req.params.id, 10), operator: req.user.username, remark: '采购入库' });
        // 回写商品成本为最近采购价（可选成本核算口径）
        if (Number(it.unit_cost) > 0) {
          await conn.query('UPDATE products SET cost = ? WHERE tenant_id = ? AND id = ?', [it.unit_cost, req.user.tenantId, it.product_id]);
        }
      }
      await conn.query("UPDATE purchases SET status = 'RECEIVED' WHERE id = ?", [req.params.id]);
      const [after] = await conn.query('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
      return after[0];
    });
    res.json({ item: po });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// 取消：DRAFT → CANCELLED（不动库存）
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const r = await query("UPDATE purchases SET status = 'CANCELLED' WHERE tenant_id = ? AND id = ? AND status = 'DRAFT'", [req.user.tenantId, req.params.id]);
    if (!r.affectedRows) return res.status(400).json({ error: '仅「待入库」采购单可取消' });
    const rows = await query('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
