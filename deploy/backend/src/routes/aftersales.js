/**
 * V2.0 售后逆向全流程（飞书文档 2.5 aftersale-service）
 * 售后类型（type）：
 *   refund_only  - 仅退款：自动财务红冲 aftersale_refund 列
 *   return_refund - 退货退款：入库回滚库存 + 财务红冲
 *   reissue       - 补发：生成补发子订单（锁库+走发运）
 * 状态机：PENDING → APPROVED → PROCESSING → COMPLETED（可驳回 / 取消）
 * 联动：finance_profit 自动红冲、inventory 回滚、platform_synced 平台状态同步标记、审计日志
 */
const express = require('express');
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const ledger = require('../inventory-ledger');

const router = express.Router();

function genNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  return `AS${ymd}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

// 1. 售后列表（租户内分页）
router.get('/', async (req, res, next) => {
  try {
    const { status, type, keyword, page, size } = req.query;
    const where = ['a.tenant_id = ?']; const params = [req.user.tenantId];
    if (status) { where.push('a.status = ?'); params.push(status); }
    if (type)   { where.push('a.type = ?');   params.push(type); }
    if (keyword){ where.push('(a.aftersale_no LIKE ? OR o.order_no LIKE ? OR a.buyer_name LIKE ?)');
                  const k = `%${keyword}%`; params.push(k, k, k); }
    const pg = parseInt(page, 10) || 1;
    const sz = Math.min(parseInt(size, 10) || 30, 200);
    const offset = (pg - 1) * sz;
    const rows = await query(
      `SELECT a.*, o.order_no, o.total_amount, o.currency
       FROM aftersales a
       LEFT JOIN orders o ON o.tenant_id = a.tenant_id AND o.id = a.order_id
       WHERE ${where.join(' AND ')}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`,
      [...params, sz, offset]
    );
    const [{ c }] = await query(
      `SELECT COUNT(*) AS c FROM aftersales a LEFT JOIN orders o ON o.id = a.order_id
       WHERE ${where.join(' AND ')}`, params
    );
    res.json({ items: rows, total: c, page: pg, size: sz });
  } catch (e) { next(e); }
});

// 2. 发起售后（必填：order_id + type + items/refund_items）
router.post('/', async (req, res, next) => {
  try {
    const { order_id, type, reason, buyer_name, return_tracking_no, items } = req.body || {};
    if (!order_id) return res.status(400).json({ error: 'order_id 必填' });
    if (!['refund_only', 'return_refund', 'reissue'].includes(type))
      return res.status(400).json({ error: 'type 必须是 refund_only / return_refund / reissue' });

    const [ord] = await query(
      `SELECT * FROM orders WHERE tenant_id = ? AND id = ?`, [req.user.tenantId, order_id]
    );
    if (!ord) return res.status(404).json({ error: '订单不存在' });
    if (ord.status === 'CANCELLED') return res.status(400).json({ error: '已取消订单不可售后' });

    // 计算退款金额：items = [{ order_item_id, qty, refund_amount }]
    let totalRefund = 0;
    const refundItems = [];
    if (Array.isArray(items) && items.length) {
      for (const it of items) {
        const [oi] = await query(
          `SELECT oi.* FROM order_items oi WHERE oi.order_id = ? AND oi.id = ?`,
          [order_id, it.order_item_id]
        );
        if (!oi) continue;
        const q = Math.min(parseInt(it.qty, 10) || oi.qty, oi.qty);
        const amt = Number(it.refund_amount != null ? it.refund_amount : (q * oi.unit_price));
        totalRefund += amt;
        refundItems.push({ order_item_id: oi.id, product_id: oi.product_id, qty: q, refund_amount: amt });
      }
    } else {
      totalRefund = Number(ord.total_amount);
      const allItems = await query(`SELECT * FROM order_items WHERE order_id = ?`, [order_id]);
      for (const oi of allItems)
        refundItems.push({ order_item_id: oi.id, product_id: oi.product_id, qty: oi.qty, refund_amount: Number(oi.unit_price) * oi.qty });
    }

    const no = genNo();
    let aftersaleId = null;
    await withTransaction(async conn => {
      const [r] = await conn.query(
        `INSERT INTO aftersales (tenant_id, order_id, aftersale_no, type, reason, amount, buyer_name, status, return_tracking_no)
         VALUES (?,?,?,?,?,?,?,'PENDING',?)`,
        [req.user.tenantId, order_id, no, type, reason || null, totalRefund.toFixed(2), buyer_name || ord.buyer_name || null,
         return_tracking_no || null]
      );
      aftersaleId = r.insertId;
      for (const it of refundItems) {
        await conn.query(
          `INSERT INTO aftersale_items (tenant_id, aftersale_id, order_item_id, product_id, qty, refund_amount)
           VALUES (?,?,?,?,?,?)`,
          [req.user.tenantId, aftersaleId, it.order_item_id, it.product_id, it.qty, Number(it.refund_amount).toFixed(2)]
        );
      }
    });
    res.json({ ok: true, aftersale: { id: aftersaleId, aftersale_no: no, type, amount: totalRefund.toFixed(2), status: 'PENDING' } });
  } catch (e) { next(e); }
});

// 3. 审核售后：通过 / 驳回（通过后触发对应的自动化逻辑）
router.post('/:id/audit', async (req, res, next) => {
  try {
    const { action, remark } = req.body || {};
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'action 必须 approve / reject' });
    const [a] = await query('SELECT * FROM aftersales WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!a) return res.status(404).json({ error: '售后单不存在' });
    if (a.status !== 'PENDING') return res.status(400).json({ error: `当前状态 ${a.status} 不可审核` });
    const [ord] = await query('SELECT * FROM orders WHERE id = ?', [a.order_id]);

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED';
    await withTransaction(async conn => {
      await conn.query('UPDATE aftersales SET status = ? WHERE id = ?', [newStatus, a.id]);
      if (action === 'approve') {
        // APPROVED → 按类型触发自动化（飞书文档：自动红冲 + 库存回滚 + 补发子订单）
        if (a.type === 'refund_only' || a.type === 'return_refund') {
          // 财务红冲：finance_profit 增加售后退款金额，重算净利润
          const amount = Number(a.amount || 0);
          await conn.query(
            `INSERT INTO finance_profit (tenant_id, order_id, order_no, sale_amount, aftersale_refund, net_profit, settled)
             VALUES (?,?,?,?,?,?, 0)
             ON DUPLICATE KEY UPDATE
               aftersale_refund = aftersale_refund + VALUES(aftersale_refund),
               net_profit = sale_amount - (product_cost + ship_head_cost + ship_tail_cost + platform_fee + withdraw_fee + ad_cost + vat_tax + aftersale_refund + other_cost)`,
            [req.user.tenantId, a.order_id, (ord && ord.order_no) || '', 0, amount, -amount]
          );
          // 标记已红冲
          await conn.query('UPDATE aftersales SET finance_redressed = 1 WHERE id = ?', [a.id]);
        }
        if (a.type === 'return_refund') {
          // 退货入库：查询 aftersale_items → 每个 product 增加 qty_on_hand
          const items = await conn.query('SELECT * FROM aftersale_items WHERE aftersale_id = ?', [a.id]);
          for (const it of items) {
            const [before] = await conn.query(
              `SELECT qty_on_hand FROM inventory WHERE tenant_id = ? AND product_id = ? AND warehouse = 'MAIN' FOR UPDATE`,
              [req.user.tenantId, it.product_id]
            );
            const qtyBefore = before.length ? before[0].qty_on_hand : 0;
            await conn.query(
              `INSERT INTO inventory (tenant_id, product_id, warehouse, qty_on_hand, qty_reserved)
               VALUES (?,?, 'MAIN', ?, 0)
               ON DUPLICATE KEY UPDATE qty_on_hand = qty_on_hand + VALUES(qty_on_hand)`,
              [req.user.tenantId, it.product_id, it.qty]
            );
            await ledger.record(conn, {
              tenantId: req.user.tenantId, productId: it.product_id, warehouse: 'MAIN',
              changeType: 'return_in', qtyChange: it.qty, qtyBefore, qtyAfter: qtyBefore + it.qty,
              balanceField: 'on_hand', refType: 'aftersale', refId: a.id,
              operator: req.user.username, remark: `售后退货入库 #${a.aftersale_no}`
            });
          }
          await conn.query('UPDATE aftersales SET inventory_restored = 1 WHERE id = ?', [a.id]);
          await conn.query('UPDATE aftersales SET status = ? WHERE id = ?', ['COMPLETED', a.id]);
        }
        if (a.type === 'refund_only') {
          // 仅退款直接完成
          await conn.query('UPDATE aftersales SET status = ? WHERE id = ?', ['COMPLETED', a.id]);
        }
        if (a.type === 'reissue') {
          // 补发：创建补发子订单 + 锁库存（复用 orders PENDING -> PAID 机制简化处理）
          const items = await conn.query('SELECT * FROM aftersale_items WHERE aftersale_id = ?', [a.id]);
          if (items.length && ord) {
            const suffix = crypto.randomBytes(2).toString('hex').toUpperCase();
            const reissueNo = `${ord.order_no}-R${suffix}`;
            const total = items.reduce((s, i) => s + Number(i.refund_amount), 0);
            const [rOrd] = await conn.query(
              `INSERT INTO orders (tenant_id, order_no, shop_id, status, total_amount, buyer_name, country, currency, exchange_rate, audit_status)
               VALUES (?, ?, ?, 'PAID', 0, ?, ?, ?, 1, 'auto_pass')`,
              [req.user.tenantId, reissueNo, ord.shop_id || null, ord.buyer_name || null, ord.country || null, ord.currency || 'CNY']
            );
            for (const it of items) {
              await conn.query(
                `INSERT INTO order_items (tenant_id, order_id, product_id, qty, unit_price) VALUES (?,?,?,?,0)`,
                [req.user.tenantId, rOrd.insertId, it.product_id, it.qty]
              );
            }
            await conn.query('UPDATE aftersales SET reissue_order_id = ?, status = ? WHERE id = ?', [rOrd.insertId, 'COMPLETED', a.id]);
          }
        }
      }
    });
    res.json({ ok: true, status: newStatus });
  } catch (e) { next(e); }
});

// 4. 标记平台已同步（正向同步售后结果到平台后调用）
router.post('/:id/platform-sync', async (req, res, next) => {
  try {
    const r = await query('UPDATE aftersales SET platform_synced = 1 WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: '售后单不存在' });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 5. 统计汇总（Dashboard）
router.get('/summary', async (req, res, next) => {
  try {
    const [row] = await query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN type = 'refund_only' THEN amount ELSE 0 END) AS refund_only_amount,
        SUM(CASE WHEN type = 'return_refund' THEN amount ELSE 0 END) AS return_refund_amount,
        SUM(amount) AS total_amount
       FROM aftersales WHERE tenant_id = ?`,
      [req.user.tenantId]
    );
    res.json({ summary: row });
  } catch (e) { next(e); }
});

module.exports = router;
