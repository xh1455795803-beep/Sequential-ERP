// 通知公告路由：系统公告（audience=platform）+ 租户通知（audience=tenant）
const express = require('express');
const { query } = require('../db');
const audit = require('../middleware/audit');

const router = express.Router();

// 当前用户的通知列表（系统公告 + 本租户通知），未读标记
router.get('/', async (req, res, next) => {
  try {
    const tid = req.user.tenantId;
    const uid = req.user.uid;
    const rows = await query(
      `SELECT n.id, n.category, n.level, n.title, n.body, n.link, n.audience, n.created_at, n.expires_at,
              (r.id IS NOT NULL) AS is_read, r.read_at
       FROM notifications n
       LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
       WHERE n.status = 'published'
         AND (n.expires_at IS NULL OR n.expires_at > NOW())
         AND (n.audience = 'platform' OR n.tenant_id = ?)
       ORDER BY n.created_at DESC LIMIT 100`,
      [uid, tid]
    );
    const unread = rows.filter(r => !r.is_read).length;
    res.json({ items: rows, unread });
  } catch (err) { next(err); }
});

// 标记单条已读
router.post('/:id/read', async (req, res, next) => {
  try {
    await query(
      `INSERT IGNORE INTO notification_reads (notification_id, user_id, tenant_id) VALUES (?, ?, ?)`,
      [req.params.id, req.user.uid, req.user.tenantId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// 标记全部已读
router.post('/read-all', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT n.id FROM notifications n WHERE n.status='published'
         AND (n.audience='platform' OR n.tenant_id=?)
         AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=?)`,
      [req.user.tenantId, req.user.uid]
    );
    for (const r of rows) {
      await query(
        `INSERT IGNORE INTO notification_reads (notification_id, user_id, tenant_id) VALUES (?,?,?)`,
        [r.id, req.user.uid, req.user.tenantId]
      );
    }
    res.json({ ok: true, marked: rows.length });
  } catch (err) { next(err); }
});

// ===== 运营端：发布/管理公告（仅 owner） =====
const ownerGuard = require('../middleware/auth').requireOwner;

router.post('/', ownerGuard, audit('notification'), async (req, res, next) => {
  try {
    const { title, body, level, category, link, audience, expires_at } = req.body || {};
    if (!title || !String(title).trim()) return res.status(400).json({ error: '请填写标题' });
    const aud = ['tenant', 'platform'].includes(audience) ? audience : 'tenant';
    // 仅 tenant 级：绑定本租户；platform 级需更高权限（此处仍允许 owner，线上可加超管校验）
    const r = await query(
      `INSERT INTO notifications (tenant_id, category, level, title, body, link, audience, status, created_by, expires_at)
       VALUES (?,?,?,?,?,?,?, 'published', ?, ?)`,
      [aud === 'platform' ? null : req.user.tenantId,
       category || 'system', level || 'info', String(title).trim(),
       body || null, link || null, aud,
       req.user.username, expires_at || null]
    );
    const rows = await query('SELECT * FROM notifications WHERE id = ?', [r.insertId]);
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id', ownerGuard, audit('notification'), async (req, res, next) => {
  try {
    const { title, body, level, category, link, status, expires_at } = req.body || {};
    const fields = [], params = [];
    if (title !== undefined) { fields.push('title = ?'); params.push(String(title).trim()); }
    if (body !== undefined) { fields.push('body = ?'); params.push(body); }
    if (level !== undefined) { fields.push('level = ?'); params.push(level); }
    if (category !== undefined) { fields.push('category = ?'); params.push(category); }
    if (link !== undefined) { fields.push('link = ?'); params.push(link); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (expires_at !== undefined) { fields.push('expires_at = ?'); params.push(expires_at); }
    if (!fields.length) return res.status(400).json({ error: '无更新字段' });
    params.push(req.user.tenantId, req.params.id);
    const r = await query(`UPDATE notifications SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: '通知不存在或无权操作' });
    const rows = await query('SELECT * FROM notifications WHERE id = ?', [req.params.id]);
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', ownerGuard, audit('notification'), async (req, res, next) => {
  try {
    const r = await query('DELETE FROM notifications WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: '通知不存在或无权操作' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
