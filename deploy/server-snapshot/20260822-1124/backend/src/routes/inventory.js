// 库存路由：查询 / 入库 / 出库 / 调整（行级锁保证并发安全）
// [P1] 每次库存变动同步写 inventory_transactions 流水
const express = require('express');
const { query, withTransaction } = require('../db');
const ledger = require('../inventory-ledger');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT i.id, i.product_id, p.sku, p.name, i.warehouse,
              i.qty_on_hand, i.qty_reserved, (i.qty_on_hand - i.qty_reserved) AS qty_available,
              i.updated_at
       FROM inventory i
       JOIN products p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
       WHERE i.tenant_id = ? ORDER BY p.sku`,
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// 库存调整：type = IN(入库) / OUT(出库)
router.post('/adjust', async (req, res, next) => {
  try {
    const { product_id, type, qty, remark } = req.body || {};
    const n = parseInt(qty, 10);
    if (!product_id || !['IN', 'OUT'].includes(type) || !Number.isInteger(n) || n <= 0) {
      return res.status(400).json({ error: '参数不合法（需 product_id、type=IN/OUT、正整数 qty）' });
    }

    const item = await withTransaction(async conn => {
      const [rows] = await conn.query(
        `SELECT i.*, p.sku, p.name FROM inventory i
         JOIN products p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
         WHERE i.tenant_id = ? AND i.product_id = ? AND i.warehouse = 'MAIN' FOR UPDATE`,
        [req.user.tenantId, product_id]
      );
      if (!rows.length) throw Object.assign(new Error('商品库存记录不存在'), { status: 404 });
      const inv = rows[0];
      if (type === 'OUT' && inv.qty_on_hand - inv.qty_reserved < n) {
        throw Object.assign(new Error(`可用库存不足（当前可用 ${inv.qty_on_hand - inv.qty_reserved}）`), { status: 400 });
      }
      const before = inv.qty_on_hand;
      const sql = type === 'IN'
        ? 'UPDATE inventory SET qty_on_hand = qty_on_hand + ? WHERE id = ?'
        : 'UPDATE inventory SET qty_on_hand = qty_on_hand - ? WHERE id = ?';
      await conn.query(sql, [n, inv.id]);
      const [after] = await conn.query('SELECT * FROM inventory WHERE id = ?', [inv.id]);
      // 写流水
      await ledger.record(conn, {
        tenantId: req.user.tenantId, productId: product_id, warehouse: 'MAIN',
        changeType: type === 'IN' ? 'inbound' : 'outbound',
        qtyChange: type === 'IN' ? n : -n,
        qtyBefore: before, qtyAfter: after[0].qty_on_hand, balanceField: 'on_hand',
        refType: 'manual', operator: req.user.username, remark: remark || (type === 'IN' ? '手动入库' : '手动出库')
      });
      return { sku: inv.sku, name: inv.name, type, qty: n, on_hand: after[0].qty_on_hand, reserved: after[0].qty_reserved };
    });
    res.json({ item });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// [P1] 库存流水查询
router.get('/transactions', async (req, res, next) => {
  try {
    const { product_id, change_type, ref_type, ref_id, page, size } = req.query;
    const result = await ledger.list(req.user.tenantId, {
      productId: product_id, changeType: change_type, refType: ref_type, refId: ref_id,
      page: parseInt(page, 10) || 1, size: parseInt(size, 10) || 50
    });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
