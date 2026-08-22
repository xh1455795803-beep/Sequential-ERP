// 审计日志查询路由（仅 owner 可见本租户）
const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/logs', async (req, res, next) => {
  try {
    const { action, user_id, target_type, page, size } = req.query;
    const where = ['tenant_id = ?'];
    const params = [req.user.tenantId];
    if (action) { where.push('action LIKE ?'); params.push(`%${action}%`); }
    if (user_id) { where.push('user_id = ?'); params.push(user_id); }
    if (target_type) { where.push('target_type = ?'); params.push(target_type); }
    const pg = parseInt(page, 10) || 1;
    const sz = Math.min(parseInt(size, 10) || 50, 200);
    const offset = (pg - 1) * sz;
    const rows = await query(
      `SELECT * FROM audit_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, sz, offset]
    );
    const [{ c }] = await query(
      `SELECT COUNT(*) AS c FROM audit_logs WHERE ${where.join(' AND ')}`, params
    );
    res.json({ items: rows, total: c, page: pg, size: sz });
  } catch (err) { next(err); }
});

module.exports = router;
