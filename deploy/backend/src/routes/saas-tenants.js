/**
 * V2.0 SaaS 运营后台 - 租户全生命周期管理（飞书文档 5.2 第2项）
 * 功能：租户列表 / 详情 / 开通 / 续费 / 冻结解冻 / 套餐变更 / 额度调整 / 重置密码
 * 权限：super_admin 全部权限 / finance_admin 仅账单部分 / support_admin 只读列表
 */
const express = require('express');
const crypto = require('crypto');
const { query, withTransaction } = require('../db');
const saasAuth = require('./saas-admin');
const { PLANS } = require('../util');

const router = express.Router();
const { auth, enforceRole, log } = saasAuth;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/* ============= 租户 CRUD ============= */

// 1. 租户列表（支持搜索+分页）
router.get('/tenants', auth, async (req, res, next) => {
  try {
    const { keyword, plan, status, page, size } = req.query;
    const where = []; const params = [];
    if (keyword) { where.push('(t.name LIKE ? OR u.username LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
    if (plan)   { where.push('t.plan = ?'); params.push(plan); }
    if (status) { where.push('t.status = ?'); params.push(status); }
    const pg = parseInt(page, 10) || 1;
    const sz = Math.min(parseInt(size, 10) || 20, 200);
    const offset = (pg - 1) * sz;
    const sqlW = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query(
      `SELECT t.id, t.name, t.plan, t.status, t.expire_at, t.channel, t.contact_phone, t.contact_email, t.created_at,
              (SELECT COUNT(*) FROM shops s WHERE s.tenant_id = t.id) AS shops,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS users,
              (SELECT COUNT(*) FROM orders o WHERE o.tenant_id = t.id AND o.created_at >= DATE_FORMAT(NOW(),'%Y-%m-01')) AS orders_month,
              (SELECT q.monthly_orders_used FROM tenant_quotas q WHERE q.tenant_id = t.id) AS quota_used
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'owner'
       ${sqlW}
       GROUP BY t.id
       ORDER BY t.id DESC LIMIT ? OFFSET ?`,
      [...params, sz, offset]
    );
    const [{ c }] = await query(`SELECT COUNT(DISTINCT t.id) AS c FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id AND u.role='owner' ${sqlW}`, params);
    res.json({ items: rows, total: c, page: pg, size: sz });
  } catch (e) { next(e); }
});

// 2. 租户详情（配额+店铺+账单汇总，禁止具体订单/商品明细 - 飞书文档核心铁则）
router.get('/tenants/:id', auth, async (req, res, next) => {
  try {
    const [t] = await query('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    if (!t) return res.status(404).json({ error: '租户不存在' });
    const [q] = await query('SELECT * FROM tenant_quotas WHERE tenant_id = ?', [req.params.id]);
    const plan = PLANS[t.plan] || PLANS.trial;
    const owners = await query('SELECT id, username, role, created_at FROM users WHERE tenant_id = ? AND role = ?', [req.params.id, 'owner']);
    const shops = await query(
      `SELECT id, name, platform, status, created_at FROM shops WHERE tenant_id = ? ORDER BY id DESC LIMIT 50`,
      [req.params.id]
    );
    const last3 = await query(
      `SELECT period, amount, status, due_date FROM bills WHERE tenant_id = ? ORDER BY id DESC LIMIT 3`,
      [req.params.id]
    );
    res.json({
      tenant: { ...t, planName: plan.name },
      quota: q || null,
      owners,
      shops_summary: shops,
      recent_bills: last3,
      // 只允许统计量，禁止具体业务明细（核心铁则）
      stats: {
        orders_total: (await query('SELECT COUNT(*) c FROM orders WHERE tenant_id = ?', [req.params.id]))[0].c,
        products_total: (await query('SELECT COUNT(*) c FROM products WHERE tenant_id = ?', [req.params.id]))[0].c
      }
    });
  } catch (e) { next(e); }
});

// 3. 新建开通租户（super_admin）- 对应飞书文档 租户开通
router.post('/tenants', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const { company, username, password, plan, days, contactPhone, contactEmail, channel } = req.body || {};
    if (!company || !username || !password) return res.status(400).json({ error: '公司名/用户名/密码必填' });
    if (!PLANS[plan]) return res.status(400).json({ error: `套餐必须是: ${Object.keys(PLANS).join('/')}` });
    const defaultDays = Number(days) || (plan === 'trial' ? 14 : 3650);
    let newTenant = null;
    await withTransaction(async conn => {
      const expire = new Date(Date.now() + defaultDays * 86400000);
      const [tr] = await conn.query(
        `INSERT INTO tenants (name, plan, status, expire_at, channel, contact_phone, contact_email,
          quota_products, quota_storage_mb, quota_ai_calls_monthly)
         VALUES (?,?, 'active', ?,?,?,?,?,?,?)`,
        [company, plan, expire, channel || 'manual', contactPhone || null, contactEmail || null,
         PLANS[plan].productsLimit || 5000,
         PLANS[plan].storageLimit || 1000,
         PLANS[plan].aiLimit || 0]
      );
      await conn.query(
        `INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?,?,?, 'owner')`,
        [tr.insertId, username, hashPassword(password)]
      );
      // 配额表
      const PLAN_QUOTA_MAP = { trial: {shops:3, orders:500, products:5000, ai:0, storage:1000},
        starter:{shops:3, orders:1000, products:10000, ai:0, storage:2000},
        standard:{shops:10,orders:5000, products:50000, ai:100, storage:10000},
        pro:     {shops:30,orders:1e9, products:500000, ai:1000, storage:100000},
        enterprise:{shops:1e6,orders:1e9,products:1e9,ai:1e6,storage:1e9} };
      const L = PLAN_QUOTA_MAP[plan];
      const m = new Date().toISOString().slice(0,7) + '-01';
      await conn.query(
        `INSERT INTO tenant_quotas (tenant_id, shops_used, shops_limit, monthly_orders_used, monthly_orders_limit,
          products_limit, products_used, ai_calls_limit, ai_calls_used, storage_mb_limit, storage_mb_used, month_stat_date)
         VALUES (?,0,?,0,?,?,0,?,0,?,0,?)`,
        [tr.insertId, L.shops, L.orders, L.products, L.ai, L.storage, m]
      );
      newTenant = { id: tr.insertId, company, username, plan, expire_at: expire };
    });
    await log(req, 'saas.tenant.create', 'tenant', newTenant.id, 200, newTenant);
    res.json({ ok: true, tenant: newTenant });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '用户名已存在' });
    next(e);
  }
});

// 4. 冻结 / 解冻
router.post('/tenants/:id/status', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const { status } = req.body || {};
    if (!['active', 'frozen'].includes(status)) return res.status(400).json({ error: 'status 必须 active / frozen' });
    const r = await query('UPDATE tenants SET status = ? WHERE id = ?', [status, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: '租户不存在' });
    await log(req, `saas.tenant.${status}`, 'tenant', Number(req.params.id), 200);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 5. 套餐变更 + 续费延长
router.post('/tenants/:id/plan', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const { plan, addDays, newLimits } = req.body || {};
    if (!plan && !addDays && !newLimits) return res.status(400).json({ error: 'plan/addDays/newLimits 至少一个' });
    const fields = []; const params = [];
    if (plan) {
      if (!PLANS[plan]) return res.status(400).json({ error: `plan 必须是 ${Object.keys(PLANS).join('/')}` });
      fields.push('plan = ?'); params.push(plan);
    }
    if (addDays) {
      const d = Number(addDays);
      if (!Number.isInteger(d) || d <= 0) return res.status(400).json({ error: 'addDays 必须正整数' });
      fields.push(`expire_at = COALESCE(expire_at, NOW()) + INTERVAL ? DAY`); params.push(d);
    }
    if (newLimits) {
      if (newLimits.quota_products != null) { fields.push('quota_products = ?'); params.push(newLimits.quota_products); }
      if (newLimits.quota_storage_mb != null) { fields.push('quota_storage_mb = ?'); params.push(newLimits.quota_storage_mb); }
      if (newLimits.quota_ai_calls_monthly != null) { fields.push('quota_ai_calls_monthly = ?'); params.push(newLimits.quota_ai_calls_monthly); }
    }
    params.push(req.params.id);
    const r = await query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: '租户不存在' });
    // 同步刷新配额表
    if (plan || newLimits) {
      const [t] = await query('SELECT plan, quota_products, quota_storage_mb, quota_ai_calls_monthly FROM tenants WHERE id = ?', [req.params.id]);
      const planLimits = { trial:[3,500,5000,0,1000], starter:[3,1000,10000,0,2000],
        standard:[10,5000,50000,100,10000], pro:[30,1e9,500000,1000,100000], enterprise:[1e6,1e9,1e9,1e6,1e9] };
      const def = planLimits[t.plan] || planLimits.trial;
      await query(
        `INSERT INTO tenant_quotas (tenant_id, shops_limit, monthly_orders_limit, products_limit, ai_calls_limit, storage_mb_limit, month_stat_date)
         VALUES (?,?,?,?,?,?, DATE_FORMAT(NOW(),'%Y-%m-01'))
         ON DUPLICATE KEY UPDATE shops_limit = VALUES(shops_limit), monthly_orders_limit = VALUES(monthly_orders_limit),
           products_limit = VALUES(products_limit), ai_calls_limit = VALUES(ai_calls_limit), storage_mb_limit = VALUES(storage_mb_limit)`,
        [req.params.id, def[0], def[1], t.quota_products || def[2], t.quota_ai_calls_monthly || def[3], t.quota_storage_mb || def[4]]
      );
    }
    await log(req, 'saas.tenant.plan_change', 'tenant', Number(req.params.id), 200, req.body);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 6. 重置 owner 密码
router.post('/tenants/:id/reset-password', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    const r = await query(
      `UPDATE users SET password_hash = ? WHERE tenant_id = ? AND role = 'owner' LIMIT 1`,
      [hashPassword(password), req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: '租户无 owner 账号' });
    await log(req, 'saas.tenant.reset_password', 'tenant', Number(req.params.id), 200);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ============= 套餐商业化配置（飞书文档 5.2 第3项） ============= */
// 套餐额度矩阵 + 价格配置（实际项目可落库 + 灰度租户/渠道白名单）
router.get('/plans/definitions', auth, async (_req, res) => {
  res.json({
    items: Object.entries(PLANS).map(([code, p]) => ({
      code,
      name: p.name,
      shops: p.shops === Infinity ? '不限' : p.shops,
      monthlyOrders: p.monthlyOrders === Infinity ? '不限' : p.monthlyOrders,
      days: p.days || null
    }))
  });
});

module.exports = router;
