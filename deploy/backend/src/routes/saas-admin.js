/**
 * V2.0 SaaS 运营后台 - 管理员登录 / 身份 / 注销（飞书文档第5章 三级权限）
 * 角色：super_admin / finance_admin / support_admin
 * 权限矩阵（路由层 enforceRole）：
 *   - 超级运营(super_admin)：全功能
 *   - 财务运营(finance_admin)：账单 / 对账 / 发票，禁止租户配置 & 商品订单数据
 *   - 客服运营(support_admin)：工单 / 同步异常查看，禁止财务 & 配置
 * 独立 JWT 密钥：JWT_SAAS_SECRET，JWT 默认 8h 过期
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const { query } = require('../db');

const router = express.Router();
const SAAS_SECRET = process.env.JWT_SAAS_SECRET || config.jwtSecret + '_saas_v2';
const SAAS_EXPIRES = process.env.JWT_SAAS_EXPIRES || '8h';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
}
function signToken(admin) {
  return jwt.sign(
    { adminId: admin.id, role: admin.role, username: admin.username },
    SAAS_SECRET,
    { expiresIn: SAAS_EXPIRES }
  );
}

/** SaaS 运营后台 JWT 校验中间件（挂载到 /api/v2/saas/* 路由） */
function auth(req, res, next) {
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: '请登录运营后台' });
  try {
    req.admin = jwt.verify(token, SAAS_SECRET);
    next();
  } catch (e) { res.status(401).json({ error: '登录已过期，请重新登录' }); }
}
/** 角色强制：允许的角色列表 */
function enforceRole(...allowed) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: '未登录' });
    if (!allowed.includes(req.admin.role)) {
      return res.status(403).json({ error: `无权限操作（允许角色: ${allowed.join('/')}）` });
    }
    next();
  };
}
function clientIp(req) {
  return (req.headers['x-real-ip']) ||
         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         req.socket.remoteAddress || '';
}
async function log(req, action, targetType, targetId, statusCode, detail) {
  try {
    await query(
      `INSERT INTO saas_audit_logs (admin_id, admin_username, action, method, path, target_type, target_id, status_code, detail, ip, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [(req.admin && req.admin.adminId) || null, (req.admin && req.admin.username) || 'SYSTEM', action, req.method, req.originalUrl,
       targetType || null, targetId || null, statusCode || 200,
       detail ? JSON.stringify(detail).slice(0, 2000) : null,
       clientIp(req), (req.headers['user-agent'] || '').slice(0, 255)]
    );
  } catch (e) { /* 审计日志失败不阻断主流程 */ }
}

/* ================ 路由 ================ */

// 1. 登录
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名/密码必填' });
    const rows = await query('SELECT * FROM saas_admins WHERE username = ?', [String(username).trim()]);
    if (!rows.length) return res.status(401).json({ error: '用户名或密码错误' });
    const admin = rows[0];
    if (admin.status !== 'active') return res.status(403).json({ error: '账号已停用' });
    if (!verifyPassword(password, admin.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    await query(
      `UPDATE saas_admins SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?`,
      [clientIp(req), admin.id]
    );
    const token = signToken(admin);
    // 临时赋 req.admin 用于写审计
    req.admin = { adminId: admin.id, username, role: admin.role };
    await log(req, 'saas.login', 'admin', admin.id, 200);
    res.json({
      token,
      admin: { id: admin.id, username, role: admin.role, realName: admin.real_name, email: admin.email }
    });
  } catch (e) { next(e); }
});

// 2. 当前运营身份
router.get('/me', auth, async (req, res, next) => {
  try {
    const rows = await query('SELECT id, username, role, real_name, phone, email, status, last_login_at, last_login_ip FROM saas_admins WHERE id = ?', [req.admin.adminId]);
    if (!rows.length) return res.status(401).json({ error: '账号不存在' });
    res.json({ admin: rows[0] });
  } catch (e) { next(e); }
});

// 3. 管理员列表（仅 super_admin）
router.get('/admins', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT id, username, role, real_name, phone, email, status, last_login_at, last_login_ip, created_at
       FROM saas_admins ORDER BY id DESC`
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// 4. 新增/重置管理员（仅 super_admin）
router.post('/admins', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const { username, password, role, realName, phone, email } = req.body || {};
    if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: '用户名 3-30 位字母数字下划线' });
    if (!password || password.length < 8) return res.status(400).json({ error: '密码至少 8 位' });
    const VALID_ROLES = ['super_admin', 'finance_admin', 'support_admin'];
    if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: `角色必须是: ${VALID_ROLES.join('/')}` });
    try {
      await query(
        `INSERT INTO saas_admins (username, password_hash, role, real_name, phone, email) VALUES (?,?,?,?,?,?)`,
        [username, hashPassword(password), role, realName || null, phone || null, email || null]
      );
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: '用户名已存在' });
      throw e;
    }
    await log(req, 'saas.admin.create', 'admin', null, 200, { username, role });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 5. 修改自身密码
router.post('/change-password', auth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword || newPassword.length < 8)
      return res.status(400).json({ error: '旧密码必填，新密码至少 8 位' });
    const rows = await query('SELECT password_hash FROM saas_admins WHERE id = ?', [req.admin.adminId]);
    if (!rows.length || !verifyPassword(oldPassword, rows[0].password_hash))
      return res.status(400).json({ error: '旧密码错误' });
    await query('UPDATE saas_admins SET password_hash = ? WHERE id = ?', [hashPassword(newPassword), req.admin.adminId]);
    await log(req, 'saas.admin.chpass', 'admin', req.admin.adminId, 200);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 6. 运营后台审计日志查询（全量，仅 super_admin / support_admin 只读）
router.get('/audit-logs', auth, enforceRole('super_admin', 'support_admin'), async (req, res, next) => {
  try {
    const { action, admin_id, target_type, page, size } = req.query;
    const where = []; const params = [];
    if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
    if (admin_id) { where.push('admin_id = ?'); params.push(admin_id); }
    if (target_type) { where.push('target_type = ?'); params.push(target_type); }
    const pg = parseInt(page, 10) || 1;
    const sz = Math.min(parseInt(size, 10) || 50, 200);
    const offset = (pg - 1) * sz;
    const sqlWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = await query(
      `SELECT * FROM saas_audit_logs ${sqlWhere} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, sz, offset]
    );
    const cnt = await query(`SELECT COUNT(*) AS c FROM saas_audit_logs ${sqlWhere}`, params);
    res.json({ items: rows, total: (cnt && cnt[0] && cnt[0].c) ? Number(cnt[0].c) : 0, page: pg, size: sz });
  } catch (e) { next(e); }
});

/* ================= 终版 A. 官网落地页可视化编辑器 ================= */
router.get('/landing/config', auth, enforceRole('super_admin','support_admin'), async (req, res, next) => {
  try {
    const rows = await query('SELECT * FROM landing_configs ORDER BY id DESC LIMIT 1');
    if (!rows.length) return res.json({ id: null, siteName: '', banner: [], advantage: [], features: [], plans: [], cases: [], compare: [], apply: {}, footer: {}, seo: {} });
    const r = rows[0];
    const p = s => { try { return JSON.parse(s); } catch { return null; } };
    res.json({
      id: r.id, siteName: r.site_name,
      banner: p(r.banner_json) || [], advantage: p(r.advantage_json) || [],
      features: p(r.features_json) || [], plans: p(r.plans_json) || [],
      cases: p(r.cases_json) || [], compare: p(r.compare_json) || [],
      apply: p(r.apply_json) || {}, footer: p(r.footer_json) || {}, seo: p(r.seo_json) || {},
      updatedAt: r.updated_at,
    });
  } catch (e) { next(e); }
});

router.post('/landing/config', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const b = req.body || {};
    const keys = ['banner','advantage','features','plans','cases','compare','apply','footer','seo'];
    const valid = {};
    for (const k of keys) valid[k] = Array.isArray(b[k]) || typeof b[k] === 'object' ? b[k] : (b[k] ? JSON.parse(b[k]) : (k==='apply'||k==='footer'||k==='seo' ? {} : []));
    const id = Number(b.id) || 0;
    if (id) {
      await query(
        `UPDATE landing_configs SET site_name=?, banner_json=?, advantage_json=?, features_json=?, plans_json=?, cases_json=?, compare_json=?, apply_json=?, footer_json=?, seo_json=?, updated_by=? WHERE id=?`,
        [String(b.siteName||'数序跨境ERP').slice(0,120),
         JSON.stringify(valid.banner), JSON.stringify(valid.advantage), JSON.stringify(valid.features),
         JSON.stringify(valid.plans), JSON.stringify(valid.cases), JSON.stringify(valid.compare),
         JSON.stringify(valid.apply), JSON.stringify(valid.footer), JSON.stringify(valid.seo),
         req.admin.adminId, id]
      );
      await log(req, 'landing.config.edit', 'landing_configs', id, 200);
    } else {
      const [r] = await query(
        `INSERT INTO landing_configs
         (site_name, banner_json, advantage_json, features_json, plans_json, cases_json, compare_json, apply_json, footer_json, seo_json, updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [String(b.siteName||'数序跨境ERP').slice(0,120),
         JSON.stringify(valid.banner), JSON.stringify(valid.advantage), JSON.stringify(valid.features),
         JSON.stringify(valid.plans), JSON.stringify(valid.cases), JSON.stringify(valid.compare),
         JSON.stringify(valid.apply), JSON.stringify(valid.footer), JSON.stringify(valid.seo),
         req.admin.adminId]
      );
      await log(req, 'landing.config.create', 'landing_configs', r.insertId, 200);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// 终版 A+: 运营后台素材（tenant_id=0，和官网图共享）
router.use('/media', auth, enforceRole('super_admin','support_admin'), (req, res, next) => {
  // 把运营身份转成虚拟user，复用 media 路由的 tenantId=0 隔离
  req.admin = req.admin;
  // 复用 media 内部需要 req.admin 或 req.user：media router 已支持 req.admin
  // 直接把 req 设为管理员模式，media 内 getScope(req) 处理 req.admin -> tenantId 0
  require('./media')(req, res, next);
});

/* ================= 终版 B. 官网体验申请线索管理 ================= */
router.get('/applications', auth, enforceRole('super_admin','support_admin'), async (req, res, next) => {
  try {
    const { status, keyword, page, size } = req.query;
    const pg = parseInt(page, 10) || 1;
    const sz = Math.min(parseInt(size, 10) || 20, 200);
    const where = []; const params = [];
    if (status) { where.push('status = ?'); params.push(String(status).slice(0,20)); }
    if (keyword) { where.push('(mobile LIKE ? OR contact_name LIKE ? OR company LIKE ? OR shop_platform LIKE ?)');
      const k = `%${keyword}%`; params.push(k, k, k, k); }
    const sqlWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const cnt = await query(`SELECT COUNT(*) c FROM site_applications ${sqlWhere}`, params);
    const rows = await query(
      `SELECT id, contact_name, mobile, company, shop_platform, shop_url, monthly_volume, region,
              status, assign_to_admin_id, remark, source_utm, ip, created_at, updated_at
       FROM site_applications ${sqlWhere} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, sz, (pg-1)*sz]
    );
    res.json({ items: rows, total: (cnt && cnt[0] && cnt[0].c) ? Number(cnt[0].c) : 0, page: pg, size: sz });
  } catch (e) { next(e); }
});
router.post('/applications/:id/status', auth, enforceRole('super_admin','support_admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, remark } = req.body || {};
    if (!['pending','contacted','signed','lost'].includes(status)) return res.status(400).json({ error: '状态非法' });
    await query('UPDATE site_applications SET status = ?, assign_to_admin_id = COALESCE(assign_to_admin_id, ?), remark = ? WHERE id = ?',
      [status, req.admin.adminId, String(remark||'').slice(0,800) || null, id]);
    await log(req, 'application.status', 'application', id, 200, { status });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

/* ================= 终版 C. 订阅账单审核：财务审核转账凭证 -> 开通/续费 ================= */
const BILLING = require('./billing');
const addMonths = BILLING.addMonths || function(d,m){const x=new Date(d);x.setMonth(x.getMonth()+Number(m||0));return x;};

router.get('/billing/orders', auth, enforceRole('super_admin','finance_admin'), async (req, res, next) => {
  try {
    const { payStatus, applyStatus, page, size, tenantId } = req.query;
    const pg = parseInt(page,10)||1;
    const sz = Math.min(parseInt(size,10)||50, 200);
    const where = []; const params = [];
    if (tenantId) { where.push('tenant_id = ?'); params.push(Number(tenantId)); }
    if (payStatus) { where.push('pay_status = ?'); params.push(String(payStatus)); }
    if (applyStatus) { where.push('apply_status = ?'); params.push(String(applyStatus)); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const cnt = await query(`SELECT COUNT(*) c FROM billing_orders ${w}`, params);
    const rows = await query(
      `SELECT id, order_no, tenant_id, order_type, plan_code, plan_name, period_unit, period_count,
              addon_code, addon_count, total_amount, pay_channel, pay_status, paid_at,
              apply_status, pay_proof_url, audit_remark, created_at
       FROM billing_orders ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, sz, (pg-1)*sz]
    );
    res.json({ items: rows, total: (cnt&&cnt[0]&&cnt[0].c)?Number(cnt[0].c):0, page: pg, size: sz });
  } catch (e) { next(e); }
});

router.post('/billing/orders/:id/audit', auth, enforceRole('super_admin','finance_admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { action, remark } = req.body || {};
    if (!['approve','reject'].includes(action)) return res.status(400).json({ error: '操作非法' });
    const conn = await require('../db').pool.getConnection();
    try {
      await conn.query('START TRANSACTION');
      const [[o]] = await conn.query('SELECT * FROM billing_orders WHERE id = ? FOR UPDATE', [id]);
      if (!o) return res.status(404).json({ error: '订单不存在' });
      if (o.pay_status !== 'unpaid') return res.status(400).json({ error: '订单已审核或已取消' });
      if (action === 'reject') {
        await conn.query('UPDATE billing_orders SET pay_status = ?, audit_by_admin_id = ?, audit_at = NOW(), audit_remark = ? WHERE id = ?',
          ['cancelled', req.admin.adminId, String(remark||'').slice(0,500) || null, id]);
        await conn.query(
          `INSERT INTO billing_records (tenant_id, user_id, action, billing_order_id, operator_type, operator_id, remark, created_at)
           VALUES (?,?,?,?,?,?,?, NOW())`,
          [o.tenant_id, o.user_id, (o.order_type === 'addon' ? 'addon' : 'renewal') + '_reject', id, 'admin', req.admin.adminId, String(remark||'').slice(0,800) || null]
        );
        await conn.query('COMMIT');
        return res.json({ ok: true });
      }
      // approve: 写 paid + 变更 tenant_subscriptions + 写 records + 写 quota 表 并刷新 tenants 快照
      await conn.query(
        `UPDATE billing_orders SET pay_status='paid', apply_status='approved', paid_at=NOW(),
                 audit_by_admin_id=?, audit_at=NOW(), audit_remark=? WHERE id=?`,
        [req.admin.adminId, String(remark||'').slice(0,500) || null, id]
      );
      const [[curSub]] = await conn.query('SELECT * FROM tenant_subscriptions WHERE tenant_id = ? FOR UPDATE', [o.tenant_id]);
      let beforePlan = curSub ? curSub.plan_code : null;
      let beforeExpire = curSub ? curSub.expire_at : null;
      const today = new Date();
      const monthsCount = (BILLING.MONTHS_OF && BILLING.MONTHS_OF[o.period_unit] ? BILLING.MONTHS_OF[o.period_unit] : 1) * (o.period_count || 1);
      if (o.order_type === 'addon') {
        // 扩容包：在订阅配额上加，不改变plan
        if (!curSub) {
          await conn.rollback(); return res.status(400).json({ error: '该租户暂无订阅，请先购买套餐' });
        }
        const def = BILLING.ADDONS && BILLING.ADDONS[o.addon_code] ? BILLING.ADDONS[o.addon_code] : null;
        const extras0 = (() => { try { return JSON.parse(curSub.extras_json || '{}'); } catch { return {}; } })();
        const quotas0 = (() => { try { return JSON.parse(curSub.quotas_json || '{}'); } catch { return {}; } })();
        if (def && def.affect) {
          for (const k of Object.keys(def.affect)) quotas0[k] = Number(quotas0[k]||0) + Number(def.affect[k]) * (o.addon_count||1);
        }
        extras0.addons = extras0.addons || [];
        extras0.addons.push({ code: o.addon_code, count: o.addon_count, orderId: id, at: new Date().toISOString() });
        await conn.query(`UPDATE tenant_subscriptions SET quotas_json=?, extras_json=? WHERE id=?`,
          [JSON.stringify(quotas0), JSON.stringify(extras0), curSub.id]);
        await conn.query(
          `INSERT INTO billing_records
           (tenant_id, user_id, action, billing_order_id, operator_type, operator_id, before_plan_code, after_plan_code, before_expire_at, after_expire_at, quotas_snapshot, amount, remark, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, NOW())`,
          [o.tenant_id, o.user_id, 'addon', id, 'admin', req.admin.adminId, curSub.plan_code, curSub.plan_code,
           curSub.expire_at, curSub.expire_at, JSON.stringify(quotas0), Number(o.total_amount||0), String(remark||'').slice(0,800) || null]
        );
      } else {
        // subscribe/renewal/upgrade：重算到期，写入新plan快照配额
        const plan = BILLING.PLAN_CATALOG && BILLING.PLAN_CATALOG[o.plan_code] ? BILLING.PLAN_CATALOG[o.plan_code] : null;
        const quotasSnap = plan ? plan.quotas : { shops: 3, monthlyOrders: 500, products: 2000, aiCalls: 100, storageMB: 1024 };
        const baseStart = (curSub && curSub.status === 'active' && new Date(curSub.expire_at) > today) ? new Date(curSub.expire_at) : today;
        const newExpire = addMonths(baseStart, monthsCount);
        const extrasSnap = (curSub && curSub.extras_json) || JSON.stringify({});
        if (curSub) {
          await conn.query(
            `UPDATE tenant_subscriptions SET plan_code=?, plan_name=?, period_unit=?, price=?, start_at=?, expire_at=?, status='active',
                     quotas_json=?, last_billing_order_id=?, frozen_reason=NULL WHERE id=?`,
            [o.plan_code, o.plan_name, o.period_unit, Number(o.total_amount||0)/Math.max(1,monthsCount)||0,
             baseStart, newExpire, JSON.stringify(quotasSnap), id, curSub.id]
          );
        } else {
          await conn.query(
            `INSERT INTO tenant_subscriptions
             (tenant_id, plan_code, plan_name, period_unit, price, start_at, expire_at, status, quotas_json, extras_json, last_billing_order_id, created_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?, NOW())`,
            [o.tenant_id, o.plan_code, o.plan_name, o.period_unit,
             Number(o.total_amount||0)/Math.max(1,monthsCount)||0,
             baseStart, newExpire, 'active', JSON.stringify(quotasSnap), extrasSnap, id]
          );
        }
        // tenants 表反填快照（过期联动）
        await conn.query(
          `UPDATE tenants SET plan_code=?, status='active', subscribe_expire_at=? WHERE id=?`,
          [o.plan_code, newExpire, o.tenant_id]
        );
        // 同时刷新 tenant_quotas 配额表，确保配额生效
        const [[tq]] = await conn.query('SELECT id FROM tenant_quotas WHERE tenant_id = ? LIMIT 1', [o.tenant_id]);
        const q = quotasSnap;
        if (tq) {
          await conn.query(
            `UPDATE tenant_quotas SET shops_limit=?, monthly_orders=?, products_limit=?, ai_calls_limit=?, storage_mb_limit=?
             WHERE id=?`,
            [q.shops, q.monthlyOrders, q.products, q.aiCalls, q.storageMB, tq.id]
          );
        } else {
          await conn.query(
            `INSERT INTO tenant_quotas (tenant_id, shops_limit, monthly_orders, products_limit, ai_calls_limit, storage_mb_limit, reset_at, created_at, updated_at)
             VALUES (?,?,?,?,?,?, DATE_ADD(CURDATE(),INTERVAL 30 DAY), NOW(), NOW())`,
            [o.tenant_id, q.shops, q.monthlyOrders, q.products, q.aiCalls, q.storageMB]
          );
        }
        await conn.query(
          `INSERT INTO billing_records
           (tenant_id, user_id, action, billing_order_id, operator_type, operator_id, before_plan_code, after_plan_code, before_expire_at, after_expire_at, quotas_snapshot, amount, remark, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, NOW())`,
          [o.tenant_id, o.user_id, o.order_type, id, 'admin', req.admin.adminId,
           beforePlan, o.plan_code, beforeExpire, newExpire, JSON.stringify(quotasSnap),
           Number(o.total_amount||0), String(remark||'').slice(0,800) || null]
        );
      }
      await conn.query('COMMIT');
      await log(req, 'billing.audit.approve', 'billing_order', id, 200, { action });
      res.json({ ok: true });
    } catch (e) { await conn.query('ROLLBACK'); throw e; }
    finally { try { conn.release(); } catch {} }
  } catch (e) { next(e); }
});

/* ================= 终版 D. 租户生命周期：改套餐/改额度/冻结/续费 ================= */
router.get('/tenants', auth, enforceRole('super_admin','support_admin'), async (req, res, next) => {
  try {
    const { page, size, keyword, status } = req.query;
    const pg = parseInt(page,10)||1; const sz = Math.min(parseInt(size,10)||50,200);
    const where = ['1=1']; const params = [];
    if (keyword) { where.push('(name LIKE ? OR code LIKE ?)'); const k=`%${keyword}%`; params.push(k,k); }
    if (status) { where.push('status = ?'); params.push(status); }
    const w = 'WHERE ' + where.join(' AND ');
    const cnt = await query(`SELECT COUNT(*) c FROM tenants ${w}`, params);
    const rows = await query(
      `SELECT id, code, name, contact, email, plan_code, status, subscribe_expire_at, created_at
       FROM tenants ${w} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, sz, (pg-1)*sz]
    );
    res.json({ items: rows, total: (cnt&&cnt[0]&&cnt[0].c)?Number(cnt[0].c):0, page: pg, size: sz });
  } catch (e) { next(e); }
});
router.post('/tenants/:id/status', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, reason } = req.body || {};
    if (!['active','frozen'].includes(status)) return res.status(400).json({ error: '状态非法' });
    await query('UPDATE tenants SET status = ? WHERE id = ?', [status, id]);
    if (status === 'frozen') {
      await query('UPDATE tenant_subscriptions SET status = ?, frozen_reason = ? WHERE tenant_id = ?',
        ['frozen', String(reason||'').slice(0,400) || '运营后台冻结', id]);
    } else {
      await query('UPDATE tenant_subscriptions SET status = ?, frozen_reason = NULL WHERE tenant_id = ?', ['active', id]);
    }
    await query(
      `INSERT INTO billing_records (tenant_id, action, operator_type, operator_id, remark, created_at) VALUES (?,?,?,?,?, NOW())`,
      [id, status === 'frozen' ? 'freeze' : 'unfreeze', 'admin', req.admin.adminId, String(reason||'').slice(0,800) || null]
    );
    await log(req, 'tenant.status.'+status, 'tenant', id, 200);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.post('/tenants/:id/quotas', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const shops = Math.max(0, parseInt(b.shopsLimit) || 0);
    const orders = Math.max(0, parseInt(b.monthlyOrders) || 0);
    const prods = Math.max(0, parseInt(b.productsLimit) || 0);
    const ai = Math.max(0, parseInt(b.aiCallsLimit) || 0);
    const storage = Math.max(0, parseInt(b.storageMBLimit) || 0);
    const [[tq]] = await query('SELECT id FROM tenant_quotas WHERE tenant_id = ? LIMIT 1', [id]);
    if (tq) {
      await query(
        'UPDATE tenant_quotas SET shops_limit=?, monthly_orders=?, products_limit=?, ai_calls_limit=?, storage_mb_limit=?, updated_at=NOW() WHERE id=?',
        [shops, orders, prods, ai, storage, tq.id]
      );
    } else {
      await query(
        `INSERT INTO tenant_quotas (tenant_id, shops_limit, monthly_orders, products_limit, ai_calls_limit, storage_mb_limit, reset_at, created_at, updated_at)
         VALUES (?,?,?,?,?, DATE_ADD(CURDATE(),INTERVAL 30 DAY), NOW(), NOW())`,
        [id, shops, orders, prods, ai, storage]
      );
    }
    await log(req, 'tenant.quotas.edit', 'tenant_quota', id, 200, b);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
router.post('/tenants/:id/subscription', auth, enforceRole('super_admin'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const planCode = String(b.planCode || 'basic').slice(0,40);
    const months = Math.max(1, parseInt(b.extendMonths) || 1);
    const plan = BILLING.PLAN_CATALOG && BILLING.PLAN_CATALOG[planCode] ? BILLING.PLAN_CATALOG[planCode] : null;
    const quotas = plan ? plan.quotas : BILLING.PLAN_CATALOG.basic.quotas;
    const today = new Date();
    const [[curSub]] = await query('SELECT * FROM tenant_subscriptions WHERE tenant_id = ? LIMIT 1', [id]);
    const base = (curSub && curSub.status === 'active' && new Date(curSub.expire_at) > today) ? new Date(curSub.expire_at) : today;
    const expire = addMonths(base, months);
    const price = plan ? Number(plan.prices.month || 0) * months : 0;
    const name = plan ? plan.name : '体验版';
    if (curSub) {
      await query(
        `UPDATE tenant_subscriptions SET plan_code=?, plan_name=?, period_unit='month', price=?, start_at=?, expire_at=?, status='active',
                 quotas_json=?, frozen_reason=NULL WHERE id=?`,
        [planCode, name, price, base, expire, JSON.stringify(quotas), curSub.id]
      );
    } else {
      await query(
        `INSERT INTO tenant_subscriptions (tenant_id, plan_code, plan_name, period_unit, price, start_at, expire_at, status, quotas_json, extras_json, created_at)
         VALUES (?,?,?,'month',?,?,?,?, 'active', ?,'{}', NOW())`,
        [id, planCode, name, price, base, expire, JSON.stringify(quotas)]
      );
    }
    await query('UPDATE tenants SET plan_code=?, status="active", subscribe_expire_at=? WHERE id=?', [planCode, expire, id]);
    await query(
      `INSERT INTO billing_records (tenant_id, action, operator_type, operator_id, before_plan_code, after_plan_code, before_expire_at, after_expire_at, amount, remark, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, NOW())`,
      [id, 'renewal', 'admin', req.admin.adminId, curSub && curSub.plan_code, planCode, curSub && curSub.expire_at, expire, price, String(b.remark||'').slice(0,800)||null]
    );
    await log(req, 'tenant.subscription.edit', 'tenant_subscription', id, 200, { planCode, months });
    res.json({ ok: true, expireAt: expire });
  } catch (e) { next(e); }
});

/* ================= 终版 E. 简单任务监控 & 运营统计看板（干净商用版，不吐SQL/列） ================= */
router.get('/dashboard', auth, enforceRole('super_admin','finance_admin','support_admin'), async (req, res, next) => {
  try {
    const [[tenants]] = await query('SELECT COUNT(*) c FROM tenants');
    const [[active]]  = await query(`SELECT COUNT(*) c FROM tenants WHERE status='active'`);
    const [[apps]]    = await query(`SELECT COUNT(*) c FROM site_applications WHERE status='pending'`);
    const [[pendingPays]] = await query(`SELECT COUNT(*) c FROM billing_orders WHERE apply_status='pending' AND pay_status='unpaid'`);
    const [[todayOrds]] = await query(`SELECT COUNT(*) c FROM orders WHERE DATE(created_at) = CURDATE()`);
    const [[todayRev]]  = await query(`SELECT IFNULL(SUM(total_amount),0) s FROM billing_orders WHERE DATE(paid_at) = CURDATE() AND pay_status='paid'`);
    res.json({
      tenantCount: Number(tenants.c||0),
      activeTenants: Number(active.c||0),
      pendingApplications: Number(apps.c||0),
      pendingPayAudits: Number(pendingPays.c||0),
      todayOrders: Number(todayOrds.c||0),
      todayRevenue: Number(todayRev.s||0),
    });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.auth = auth;
module.exports.enforceRole = enforceRole;
module.exports.log = log;
