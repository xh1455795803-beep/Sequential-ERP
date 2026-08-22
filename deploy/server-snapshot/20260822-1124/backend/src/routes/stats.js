// 概览统计：租户维度的核心指标
const express = require('express');
const { query } = require('../db');
const { PLANS, isTenantExpired } = require('../util');

const router = express.Router();

router.get('/dashboard', async (req, res, next) => {
  try {
    const tid = req.user.tenantId;
    const [tenant] = await query('SELECT * FROM tenants WHERE id = ?', [tid]);
    const plan = PLANS[tenant.plan] || PLANS.trial;
    const [productCount] = await query('SELECT COUNT(*) AS c FROM products WHERE tenant_id = ?', [tid]);
    const [shopCount] = await query('SELECT COUNT(*) AS c FROM shops WHERE tenant_id = ?', [tid]);
    const [stockQty] = await query('SELECT COALESCE(SUM(qty_on_hand), 0) AS c FROM inventory WHERE tenant_id = ?', [tid]);
    const [reservedQty] = await query('SELECT COALESCE(SUM(qty_reserved), 0) AS c FROM inventory WHERE tenant_id = ?', [tid]);
    const [todayOrders] = await query('SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND DATE(created_at) = CURDATE()', [tid]);
    const [monthOrders] = await query('SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), "%Y-%m-01")', [tid]);
    const [monthSales] = await query(
      'SELECT COALESCE(SUM(total_amount * IFNULL(exchange_rate, 1)), 0) AS c FROM orders WHERE tenant_id = ? AND created_at >= DATE_FORMAT(NOW(), "%Y-%m-01") AND status != "CANCELLED"',
      [tid]
    );
    const byStatus = await query('SELECT status, COUNT(*) AS c FROM orders WHERE tenant_id = ? GROUP BY status', [tid]);

    res.json({
      productCount: productCount.c,
      shopCount: shopCount.c,
      stockQty: stockQty.c,
      reservedQty: reservedQty.c,
      todayOrders: todayOrders.c,
      monthOrders: monthOrders.c,
      monthSales: Number(monthSales.c),
      planQuota: { shops: plan.shops, monthlyOrders: plan.monthlyOrders === Infinity ? null : plan.monthlyOrders },
      ordersByStatus: byStatus,
      tenant: { name: tenant.name, plan: tenant.plan, planName: plan.name, expire_at: tenant.expire_at, expired: isTenantExpired(tenant) }
    });
  } catch (err) { next(err); }
});

module.exports = router;
