// 物流商路由：CRUD（发货时选择，运费计入利润核算）
const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT c.*, (SELECT COUNT(*) FROM shipments s WHERE s.carrier_id = c.id) AS shipment_count
       FROM carriers c WHERE c.tenant_id = ? ORDER BY c.id DESC`,
      [req.user.tenantId]
    );
    res.json({ items: rows });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, code, tracking_url } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请填写物流商名称' });
    const r = await query(
      'INSERT INTO carriers (tenant_id, name, code, tracking_url) VALUES (?, ?, ?, ?)',
      [req.user.tenantId, String(name).trim(), code || null, tracking_url || null]
    );
    const rows = await query('SELECT * FROM carriers WHERE id = ?', [r.insertId]);
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { name, code, tracking_url, status } = req.body || {};
    const fields = [], params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(String(name).trim()); }
    if (code !== undefined) { fields.push('code = ?'); params.push(code); }
    if (tracking_url !== undefined) { fields.push('tracking_url = ?'); params.push(tracking_url); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (!fields.length) return res.status(400).json({ error: '无更新字段' });
    params.push(req.user.tenantId, req.params.id);
    const r = await query(`UPDATE carriers SET ${fields.join(', ')} WHERE tenant_id = ? AND id = ?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: '物流商不存在' });
    const rows = await query('SELECT * FROM carriers WHERE id = ?', [req.params.id]);
    res.json({ item: rows[0] });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const used = await query('SELECT COUNT(*) AS c FROM shipments WHERE tenant_id = ? AND carrier_id = ?', [req.user.tenantId, req.params.id]);
    if (used[0].c > 0) return res.status(400).json({ error: '该物流商已有发货记录，无法删除（可改为停用）' });
    const r = await query('DELETE FROM carriers WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: '物流商不存在' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
