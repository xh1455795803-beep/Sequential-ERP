// 认证路由：租户注册 / 登录 / 当前身份 / 修改密码 / 子账号管理
// [P0] 登录限流：同一用户名或 IP 15 分钟内失败 5 次锁定
// [P1] 登录/密码修改写审计日志
const express = require('express');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db');
const { hashPassword, verifyPassword, PLANS, isTenantExpired } = require('../util');
const auditLog = require('../middleware/audit').log;

const router = express.Router();

const MAX_FAIL = 5;
const WINDOW_MIN = 15;

function clientIp(req) {
  return (req.headers['x-real-ip']) ||
         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         req.socket.remoteAddress || '';
}

// 记录登录尝试
async function recordAttempt(username, ip, success) {
  try {
    await query('INSERT INTO login_attempts (username, ip, success) VALUES (?,?,?)',
      [username || '', ip, success ? 1 : 0]);
  } catch (e) { console.error('[login_attempts] 写入失败:', e.message); }
}

// 检查是否被限流：返回 {locked, remain}
async function checkLocked(username, ip) {
  const since = new Date(Date.now() - WINDOW_MIN * 60000);
  const byUser = await query(
    'SELECT COUNT(*) AS c FROM login_attempts WHERE username = ? AND success = 0 AND created_at >= ?',
    [username || '', since]
  );
  const byIp = await query(
    'SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND success = 0 AND created_at >= ?',
    [ip, since]
  );
  const userFails = (byUser[0] && byUser[0].c) || 0;
  const ipFails = (byIp[0] && byIp[0].c) || 0;
  return { locked: userFails >= MAX_FAIL || ipFails >= MAX_FAIL, remain: Math.max(0, MAX_FAIL - Math.max(userFails, ipFails)) };
}

function signToken(user) {
  return jwt.sign(
    { uid: user.id, tenantId: user.tenant_id, role: user.role, username: user.username },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

function tenantView(tenant) {
  const plan = PLANS[tenant.plan] || PLANS.trial;
  return {
    id: tenant.id,
    name: tenant.name,
    plan: tenant.plan,
    planName: plan.name,
    status: tenant.status,
    expire_at: tenant.expire_at,
    expired: isTenantExpired(tenant)
  };
}

// 租户注册（默认体验版 14 天）
router.post('/register', async (req, res, next) => {
  try {
    const { company, username, password } = req.body || {};
    if (!company || !String(company).trim()) return res.status(400).json({ error: '请填写公司/团队名称' });
    if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: '用户名需为 3-30 位字母数字下划线' });
    if (!password || password.length < 8) return res.status(400).json({ error: '密码至少 8 位' });

    const exists = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists.length) return res.status(409).json({ error: '用户名已被占用' });

    await require('../db').withTransaction(async conn => {
      const expire = new Date(Date.now() + (PLANS.trial.days || 14) * 86400000);
      const [t] = await conn.query(
        'INSERT INTO tenants (name, plan, status, expire_at) VALUES (?, ?, ?, ?)',
        [String(company).trim(), 'trial', 'active', expire]
      );
      await conn.query(
        'INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, ?)',
        [t.insertId, username, hashPassword(password), 'owner']
      );
    });

    const users = await query('SELECT * FROM users WHERE username = ?', [username]);
    const tenants = await query('SELECT * FROM tenants WHERE id = ?', [users[0].tenant_id]);
    await auditLog({ tenantId: users[0].tenant_id, userId: users[0].id, username, action: 'auth.register', method: 'POST', path: '/api/v1/auth/register', targetType: 'tenant', targetId: tenants[0].id, statusCode: 200, ip: clientIp(req), ua: (req.headers['user-agent'] || '').slice(0, 200) });
    res.json({ token: signToken(users[0]), user: { username: users[0].username, role: users[0].role }, tenant: tenantView(tenants[0]) });
  } catch (err) { next(err); }
});

// 登录（含限流）
router.post('/login', async (req, res, next) => {
  const ip = clientIp(req);
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

    // 限流检查
    const { locked, remain } = await checkLocked(username, ip);
    if (locked) {
      return res.status(429).json({ error: `登录失败次数过多，请 ${WINDOW_MIN} 分钟后再试` });
    }

    const users = await query('SELECT * FROM users WHERE username = ?', [username]);
    const ok = users.length && verifyPassword(password, users[0].password_hash);
    if (!ok) {
      await recordAttempt(username, ip, false);
      await auditLog({ tenantId: (users[0] && users[0].tenant_id) || null, userId: (users[0] && users[0].id) || null, username, action: 'auth.login_failed', method: 'POST', path: '/api/v1/auth/login', targetType: 'auth', targetId: null, statusCode: 401, ip, ua: (req.headers['user-agent'] || '').slice(0, 200), detail: '用户名或密码错误' });
      return res.status(401).json({ error: '用户名或密码错误', remain: Math.max(0, remain - 1) });
    }

    // 成功：清零该用户失败记录，记审计
    await query('DELETE FROM login_attempts WHERE username = ?', [username]);
    const tenants = await query('SELECT * FROM tenants WHERE id = ?', [users[0].tenant_id]);
    await auditLog({ tenantId: users[0].tenant_id, userId: users[0].id, username, action: 'auth.login', method: 'POST', path: '/api/v1/auth/login', targetType: 'auth', targetId: users[0].id, statusCode: 200, ip, ua: (req.headers['user-agent'] || '').slice(0, 200) });
    res.json({ token: signToken(users[0]), user: { username: users[0].username, role: users[0].role }, tenant: tenantView(tenants[0]) });
  } catch (err) { next(err); }
});

// 当前身份（前端刷新时恢复会话）
router.get('/me', require('../middleware/auth'), async (req, res, next) => {
  try {
    const tenants = await query('SELECT * FROM tenants WHERE id = ?', [req.user.tenantId]);
    if (!tenants.length) return res.status(401).json({ error: '租户不存在' });
    res.json({ user: { uid: req.user.uid, username: req.user.username, role: req.user.role }, tenant: tenantView(tenants[0]) });
  } catch (err) { next(err); }
});

// 修改密码
router.post('/password', require('../middleware/auth'), async (req, res, next) => {
  try {
    const { old_password, new_password } = req.body || {};
    if (!old_password || !new_password) return res.status(400).json({ error: '请填写旧密码和新密码' });
    if (new_password.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    const users = await query('SELECT * FROM users WHERE id = ?', [req.user.uid]);
    if (!users.length || !verifyPassword(old_password, users[0].password_hash)) {
      return res.status(401).json({ error: '旧密码不正确' });
    }
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(new_password), req.user.uid]);
    await auditLog({ tenantId: req.user.tenantId, userId: req.user.uid, username: req.user.username, action: 'auth.password_change', method: 'POST', path: '/api/v1/auth/password', targetType: 'user', targetId: req.user.uid, statusCode: 200, ip: clientIp(req), ua: (req.headers['user-agent'] || '').slice(0, 200) });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ===== 子账号管理（仅 owner）=====

router.get('/users', require('../middleware/auth'), require('../middleware/auth').requireOwner, async (req, res, next) => {
  try {
    const rows = await query(
      'SELECT id, username, role, created_at, (SELECT name FROM tenants WHERE id = users.tenant_id) AS tenant_name FROM users WHERE tenant_id = ? ORDER BY id',
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/users', require('../middleware/auth'), require('../middleware/auth').requireOwner, require('../middleware/audit')('user'), async (req, res, next) => {
  try {
    const { username, password, role } = req.body || {};
    if (!username || !/^[a-zA-Z0-9_]{3,30}$/.test(username)) return res.status(400).json({ error: '用户名需为 3-30 位字母数字下划线' });
    if (!password || password.length < 8) return res.status(400).json({ error: '密码至少 8 位' });
    if (!['staff', 'viewer'].includes(role)) return res.status(400).json({ error: '角色仅支持 staff（运营）或 viewer（只读）' });
    const exists = await query('SELECT id FROM users WHERE username = ?', [username]);
    if (exists.length) return res.status(409).json({ error: '用户名已被占用' });
    const r = await query('INSERT INTO users (tenant_id, username, password_hash, role) VALUES (?, ?, ?, ?)', [req.user.tenantId, username, hashPassword(password), role]);
    res.json({ ok: true, id: r.insertId });
  } catch (err) { next(err); }
});

router.post('/users/:id/reset', require('../middleware/auth'), require('../middleware/auth').requireOwner, async (req, res, next) => {
  try {
    const { password } = req.body || {};
    if (!password || password.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    const users = await query('SELECT * FROM users WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!users.length) return res.status(404).json({ error: '子账号不存在' });
    await query('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/users/:id', require('../middleware/auth'), require('../middleware/auth').requireOwner, async (req, res, next) => {
  try {
    const users = await query('SELECT * FROM users WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!users.length) return res.status(404).json({ error: '子账号不存在' });
    if (users[0].id === req.user.uid) return res.status(400).json({ error: '不能删除当前登录账号' });
    if (users[0].role === 'owner') return res.status(400).json({ error: '不能删除管理员账号' });
    await query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
