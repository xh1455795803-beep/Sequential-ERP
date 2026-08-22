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
    const [{ c }] = await query(`SELECT COUNT(*) AS c FROM saas_audit_logs ${sqlWhere}`, params);
    res.json({ items: rows, total: c, page: pg, size: sz });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.auth = auth;
module.exports.enforceRole = enforceRole;
module.exports.log = log;
