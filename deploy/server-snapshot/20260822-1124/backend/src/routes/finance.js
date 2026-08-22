// 财务路由：订单级利润核算（收入×汇率 - 货成本 - 运费 - 平台佣金）+ 月度汇总 + 多维度报表 + 汇率管理
// 说明：所有金额统一折算为 CNY（人民币）口径；订单按下单时汇率折算，商品成本/运费/佣金按 CNY 记录
const express = require('express');
const { query } = require('../db');
const auth = require('../middleware/auth');
const { requireOwner } = require('../middleware/auth');

const router = express.Router();

// 利润口径：只核算有效订单（已付款/已发货/已完成），取消单不计
const PROFIT_WHERE = "o.status IN ('PAID','SHIPPED','COMPLETED')";
// CNY 折算列：原币金额 × 下单时汇率
const CNY = 'ROUND(o.total_amount * IFNULL(o.exchange_rate, 1), 2)';
const COMMISSION_CNY = `ROUND(o.total_amount * IFNULL(o.exchange_rate, 1) * IFNULL(sp.commission_rate, 0), 2)`;
const COGS_SUB = `(SELECT IFNULL(SUM(oi.qty * p.cost), 0) FROM order_items oi
                   JOIN products p ON p.tenant_id = oi.tenant_id AND p.id = oi.product_id
                   WHERE oi.order_id = o.id)`;

// 订单级利润明细
router.get('/profit', auth, async (req, res, next) => {
  try {
    const { month } = req.query; // 格式 YYYY-MM，缺省当月
    const m = /^\d{4}-\d{2}$/.test(month || '') ? month : null;
    const params = [req.user.tenantId];
    let where = `WHERE o.tenant_id = ? AND ${PROFIT_WHERE}`;
    if (m) { where += " AND DATE_FORMAT(o.created_at, '%Y-%m') = ?"; params.push(m); }

    const rows = await query(
      `SELECT o.id, o.order_no, o.status, o.total_amount, o.currency, o.exchange_rate, o.created_at,
              s.name AS shop_name,
              IFNULL(sh.shipping_cost, 0) AS shipping_cost,
              ${COMMISSION_CNY} AS commission,
              IFNULL(${COGS_SUB}, 0) AS cogs,
              ROUND(${CNY} - IFNULL(${COGS_SUB}, 0) - IFNULL(sh.shipping_cost, 0) - o.total_amount * IFNULL(o.exchange_rate, 1) * IFNULL(sp.commission_rate, 0), 2) AS profit
       FROM orders o
       LEFT JOIN shops sp ON sp.tenant_id = o.tenant_id AND sp.id = o.shop_id
       LEFT JOIN shipments sh ON sh.tenant_id = o.tenant_id AND sh.order_id = o.id
       LEFT JOIN shops s ON s.tenant_id = o.tenant_id AND s.id = o.shop_id
       ${where}
       ORDER BY o.id DESC LIMIT 500`,
      params
    );

    // 汇总（CNY）
    const totals = rows.reduce((acc, r) => ({
      revenue: acc.revenue + Number(r.total_amount) * Number(r.exchange_rate || 1),
      cogs: acc.cogs + Number(r.cogs),
      shipping: acc.shipping + Number(r.shipping_cost),
      commission: acc.commission + Number(r.commission),
      profit: acc.profit + Number(r.profit),
      count: acc.count + 1
    }), { revenue: 0, cogs: 0, shipping: 0, commission: 0, profit: 0, count: 0 });

    const margin = totals.revenue > 0 ? (totals.profit / totals.revenue * 100) : 0;
    res.json({
      month: m,
      items: rows,
      totals: {
        revenue: Number(totals.revenue.toFixed(2)), cogs: Number(totals.cogs.toFixed(2)),
        shipping: Number(totals.shipping.toFixed(2)), commission: Number(totals.commission.toFixed(2)),
        profit: Number(totals.profit.toFixed(2)), count: totals.count,
        margin: Number(margin.toFixed(2))
      }
    });
  } catch (err) { next(err); }
});

// 月度财务报表（近 12 个月趋势，CNY 口径）
router.get('/report', auth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT DATE_FORMAT(o.created_at, '%Y-%m') AS month,
              COUNT(*) AS order_count,
              ROUND(SUM(${CNY}), 2) AS revenue,
              IFNULL(SUM(${COMMISSION_CNY}), 0) AS commission,
              IFNULL(SUM((SELECT IFNULL(SUM(oi.qty * p.cost), 0) FROM order_items oi
                          JOIN products p ON p.tenant_id = oi.tenant_id AND p.id = oi.product_id
                          WHERE oi.order_id = o.id)), 0) AS cogs,
              IFNULL((SELECT SUM(sh.shipping_cost) FROM shipments sh
                      JOIN orders o2 ON o2.id = sh.order_id AND o2.tenant_id = sh.tenant_id
                      WHERE sh.tenant_id = o.tenant_id
                        AND DATE_FORMAT(o2.created_at, '%Y-%m') = DATE_FORMAT(o.created_at, '%Y-%m')
                        AND o2.status IN ('PAID','SHIPPED','COMPLETED')), 0) AS shipping
       FROM orders o
       LEFT JOIN shops sp ON sp.tenant_id = o.tenant_id AND sp.id = o.shop_id
       WHERE o.tenant_id = ? AND ${PROFIT_WHERE}
       GROUP BY DATE_FORMAT(o.created_at, '%Y-%m')
       ORDER BY month DESC LIMIT 12`,
      [req.user.tenantId]
    );
    rows.forEach(r => {
      r.profit = Number((Number(r.revenue) - Number(r.cogs) - Number(r.shipping) - Number(r.commission)).toFixed(2));
      r.margin = Number(r.revenue) > 0 ? Number(((r.profit / r.revenue) * 100).toFixed(2)) : 0;
    });
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// ===== 多维度报表（月份可选，缺省当月；金额 CNY）=====

function monthWhere(month) {
  return month ? " AND DATE_FORMAT(o.created_at, '%Y-%m') = ?" : " AND DATE_FORMAT(o.created_at, '%Y-%m') = DATE_FORMAT(NOW(), '%Y-%m')";
}

// 按平台
router.get('/report/by-platform', auth, async (req, res, next) => {
  try {
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
    const params = [req.user.tenantId];
    let extra = monthWhere(m); if (m) params.push(m);
    const rows = await query(
      `SELECT IFNULL(sp.platform, '未关联店铺') AS dim, COUNT(*) AS order_count,
              ROUND(SUM(${CNY}), 2) AS revenue, IFNULL(SUM(${COMMISSION_CNY}), 0) AS commission,
              IFNULL(SUM(${COGS_SUB}), 0) AS cogs
       FROM orders o LEFT JOIN shops sp ON sp.tenant_id = o.tenant_id AND sp.id = o.shop_id
       WHERE o.tenant_id = ? AND ${PROFIT_WHERE}${extra}
       GROUP BY dim ORDER BY revenue DESC`,
      params
    );
    rows.forEach(r => { r.profit = Number((Number(r.revenue) - Number(r.cogs) - Number(r.commission)).toFixed(2)); });
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// 按店铺
router.get('/report/by-shop', auth, async (req, res, next) => {
  try {
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
    const params = [req.user.tenantId];
    let extra = monthWhere(m); if (m) params.push(m);
    const rows = await query(
      `SELECT IFNULL(s.name, '未关联店铺') AS dim, IFNULL(s.platform, '-') AS platform, COUNT(*) AS order_count,
              ROUND(SUM(${CNY}), 2) AS revenue, IFNULL(SUM(${COMMISSION_CNY}), 0) AS commission,
              IFNULL(SUM(${COGS_SUB}), 0) AS cogs
       FROM orders o
       LEFT JOIN shops s ON s.tenant_id = o.tenant_id AND s.id = o.shop_id
       LEFT JOIN shops sp ON sp.tenant_id = o.tenant_id AND sp.id = o.shop_id
       WHERE o.tenant_id = ? AND ${PROFIT_WHERE}${extra}
       GROUP BY dim, platform ORDER BY revenue DESC`,
      params
    );
    rows.forEach(r => { r.profit = Number((Number(r.revenue) - Number(r.cogs) - Number(r.commission)).toFixed(2)); });
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// 按商品（Top 50）
router.get('/report/by-product', auth, async (req, res, next) => {
  try {
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
    const params = [req.user.tenantId];
    let extra = monthWhere(m); if (m) params.push(m);
    const rows = await query(
      `SELECT p.sku AS dim, p.name AS product_name, SUM(oi.qty) AS qty_sold,
              ROUND(SUM(oi.qty * oi.unit_price * IFNULL(o.exchange_rate, 1)), 2) AS revenue,
              ROUND(SUM(oi.qty * p.cost), 2) AS cogs
       FROM order_items oi
       JOIN orders o ON o.tenant_id = oi.tenant_id AND o.id = oi.order_id
       JOIN products p ON p.tenant_id = oi.tenant_id AND p.id = oi.product_id
       WHERE o.tenant_id = ? AND ${PROFIT_WHERE}${extra}
       GROUP BY p.sku, p.name ORDER BY revenue DESC LIMIT 50`,
      params
    );
    rows.forEach(r => { r.profit = Number((Number(r.revenue) - Number(r.cogs)).toFixed(2)); });
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// 按国家/地区
router.get('/report/by-country', auth, async (req, res, next) => {
  try {
    const m = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : null;
    const params = [req.user.tenantId];
    let extra = monthWhere(m); if (m) params.push(m);
    const rows = await query(
      `SELECT IFNULL(NULLIF(o.country, ''), '未知') AS dim, COUNT(*) AS order_count,
              ROUND(SUM(${CNY}), 2) AS revenue, IFNULL(SUM(${COMMISSION_CNY}), 0) AS commission,
              IFNULL(SUM(${COGS_SUB}), 0) AS cogs
       FROM orders o LEFT JOIN shops sp ON sp.tenant_id = o.tenant_id AND sp.id = o.shop_id
       WHERE o.tenant_id = ? AND ${PROFIT_WHERE}${extra}
       GROUP BY dim ORDER BY revenue DESC`,
      params
    );
    rows.forEach(r => { r.profit = Number((Number(r.revenue) - Number(r.cogs) - Number(r.commission)).toFixed(2)); });
    res.json({ items: rows });
  } catch (err) { next(err); }
});

// ===== 汇率管理（owner 维护，用于订单折算）=====

router.get('/rates', auth, async (req, res, next) => {
  try {
    const rows = await query('SELECT code, rate, updated_at FROM exchange_rates ORDER BY code');
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/rates', auth, requireOwner, async (req, res, next) => {
  try {
    const { code, rate } = req.body || {};
    if (!code || !/^[A-Z]{3}$/.test(code)) return res.status(400).json({ error: '币种代码需为 3 位大写字母（如 USD）' });
    const r = Number(rate);
    if (!Number.isFinite(r) || r <= 0) return res.status(400).json({ error: '汇率需为正数' });
    await query(
      'INSERT INTO exchange_rates (code, rate) VALUES (?, ?) ON DUPLICATE KEY UPDATE rate = VALUES(rate)',
      [code, r]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
