// JWT 鉴权中间件：解析 token 并注入租户上下文；requireOwner 限制仅 owner（子账号管理/财务/汇率）
const jwt = require('jsonwebtoken');
const config = require('../config');

module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(token, config.jwtSecret); // { uid, tenantId, role, username }
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
};

module.exports.requireOwner = function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: '该操作仅租户管理员（owner）可执行' });
  next();
};

