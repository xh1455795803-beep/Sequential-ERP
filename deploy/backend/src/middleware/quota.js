/**
 * V2.0 租户套餐配额校验中间件（飞书文档 租户服务）
 * 在关键写操作前校验：店铺数 / 月订单量 / 商品SKU数 / AI调用量 / 存储空间
 * 对应表：tenant_quotas，每月1日自动重置 monthly_orders_used / ai_calls_used
 */
const { query } = require('../db');
const { PLANS } = require('../util');

const QUOTA_DEFS = {
  shop:     { field: 'shops_used',           limit: 'shops_limit',           label: '店铺数' },
  order:    { field: 'monthly_orders_used',  limit: 'monthly_orders_limit',  label: '本月订单量' },
  product:  { field: 'products_used',        limit: 'products_limit',        label: '商品SKU数' },
  ai:       { field: 'ai_calls_used',        limit: 'ai_calls_limit',        label: 'AI调用量' },
  storage:  { field: 'storage_mb_used',      limit: 'storage_mb_limit',      label: '存储空间(MB)' }
};

/** 取配额行（无则按套餐初始化） */
async function ensureQuota(conn, tenantId, planCode) {
  const [rows] = await conn.query('SELECT * FROM tenant_quotas WHERE tenant_id = ?', [tenantId]);
  if (rows.length) return rows[0];
  const plan = PLANS[planCode] || PLANS.trial;
  const month = new Date().toISOString().slice(0, 7) + '-01';
  const LIMITS = {
    trial:      { shops: 3,  orders: 500,   products: 5000,   ai: 0,    storage: 1000 },
    starter:    { shops: 3,  orders: 1000,  products: 10000,  ai: 0,    storage: 2000 },
    standard:   { shops: 10, orders: 5000,  products: 50000,  ai: 100,  storage: 10000 },
    pro:        { shops: 30, orders: 1e9,   products: 500000, ai: 1000, storage: 100000 },
    enterprise: { shops: 1e6,orders: 1e9,   products: 1e9,    ai: 1e6,  storage: 1e9 }
  };
  const L = LIMITS[planCode] || LIMITS.trial;
  await conn.query(
    `INSERT INTO tenant_quotas (tenant_id, shops_used, shops_limit, monthly_orders_used, monthly_orders_limit,
      products_limit, products_used, ai_calls_limit, ai_calls_used, storage_mb_limit, storage_mb_used, month_stat_date)
     VALUES (?,0,?,0,?,?,0,?,0,?,0,?)`,
    [tenantId, L.shops, L.orders, L.products, L.ai, L.storage, month]
  );
  const [r2] = await conn.query('SELECT * FROM tenant_quotas WHERE tenant_id = ?', [tenantId]);
  return r2[0];
}

/** 校验配额：usage + add <= limit ? */
function checkQuota(q, type, add = 1) {
  const d = QUOTA_DEFS[type];
  if (!d) return { ok: true };
  const used = Number(q[d.field] || 0);
  const limit = Number(q[d.limit] || 0);
  if (limit <= 0 || used + add <= limit) return { ok: true };
  return { ok: false, label: d.label, used, limit, need: add };
}

/** 增加使用量 */
async function bumpUsage(conn, tenantId, type, add = 1) {
  const d = QUOTA_DEFS[type];
  if (!d) return;
  await conn.query(`UPDATE tenant_quotas SET ${d.field} = ${d.field} + ? WHERE tenant_id = ?`, [add, tenantId]);
}

/** Express 中间件：校验指定类型配额（参数型：quota.guard('shop', 1)） */
function guard(type, add = 1) {
  return async function quotaGuard(req, res, next) {
    try {
      if (!req.user || !req.user.tenantId) return res.status(401).json({ error: '未登录' });
      const rows = await query('SELECT * FROM tenant_quotas WHERE tenant_id = ?', [req.user.tenantId]);
      if (!rows.length) {
        // 懒初始化
        const [t] = await query('SELECT plan FROM tenants WHERE id = ?', [req.user.tenantId]);
        if (!t.length) return res.status(403).json({ error: '租户不存在' });
        const conn = await require('../db').pool.getConnection();
        try { await ensureQuota(conn, req.user.tenantId, t[0].plan); } finally { conn.release(); }
        return next();
      }
      const r = checkQuota(rows[0], type, add);
      if (!r.ok) {
        return res.status(403).json({
          error: `套餐「${r.label}」已达上限（已用 ${r.used}/${r.limit === 1e9 ? '不限' : r.limit}），请升级套餐`,
          quota: r
        });
      }
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { guard, ensureQuota, checkQuota, bumpUsage, QUOTA_DEFS };
