/**
 * V2.0 调度中心 API（飞书文档 2.6 scheduler-service）
 * 功能：任务列表/详情/状态/手动触发/暂停恢复/历史运行记录
 * 权限：requireOwner（仅租户 Owner 可见调度监控）
 */
const express = require('express');
const { query, withTransaction } = require('../db');

const router = express.Router();

// ========== 1. 任务列表（租户内 + 可按类型/状态筛选） ==========
router.get('/tasks', async (req, res, next) => {
  try {
    const { task_type, status, page = 1, size = 50 } = req.query;
    const where = ['(tenant_id = ? OR tenant_id IS NULL)'];
    const params = [req.user.tenantId];
    if (task_type) { where.push('task_type = ?'); params.push(task_type); }
    if (status)    { where.push('status = ?');    params.push(status); }
    const p = Math.max(1, parseInt(page) || 1);
    const s = Math.min(200, Math.max(1, parseInt(size) || 50));

    const [count] = await query(
      `SELECT COUNT(*) c FROM scheduled_tasks WHERE ${where.join(' AND ')}`, params
    );
    const rows = await query(
      `SELECT * FROM scheduled_tasks WHERE ${where.join(' AND ')}
       ORDER BY priority DESC, next_run_at ASC LIMIT ? OFFSET ?`,
      [...params, s, (p - 1) * s]
    );
    const total = (count && count[0] && count[0].c) ? Number(count[0].c) : 0;
    res.json({ total, page: p, size: s, items: rows });
  } catch (e) { next(e); }
});

// ========== 2. 任务详情 + 最近N次运行 ==========
router.get('/tasks/:id', async (req, res, next) => {
  try {
    const [t] = await query(
      `SELECT * FROM scheduled_tasks WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`,
      [req.params.id, req.user.tenantId]
    );
    if (!t) return res.status(404).json({ error: '任务不存在' });
    const runs = await query(
      `SELECT * FROM task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ task: t, recent_runs: runs });
  } catch (e) { next(e); }
});

// ========== 3. 手动触发任务（立即跑一次） ==========
router.post('/tasks/:id/trigger', async (req, res, next) => {
  try {
    const [t] = await query(
      `SELECT * FROM scheduled_tasks WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`,
      [req.params.id, req.user.tenantId]
    );
    if (!t) return res.status(404).json({ error: '任务不存在' });
    await query(
      `UPDATE scheduled_tasks SET next_run_at = NOW(), status = 'pending', updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );
    // 尝试唤醒调度循环
    try { req.scheduler && req.scheduler.wakeup && req.scheduler.wakeup(); } catch (_) {}
    res.json({ ok: true, message: '已标记立即执行，下一轮调度循环开始处理' });
  } catch (e) { next(e); }
});

// ========== 4. 暂停 / 恢复任务 ==========
router.post('/tasks/:id/pause', async (req, res, next) => {
  try {
    const [t] = await query(
      `SELECT * FROM scheduled_tasks WHERE id = ? AND (tenant_id = ? OR tenant_id IS NULL)`,
      [req.params.id, req.user.tenantId]
    );
    if (!t) return res.status(404).json({ error: '任务不存在' });
    const target = t.status === 'paused' ? 'pending' : 'paused';
    await query(`UPDATE scheduled_tasks SET status = ?, updated_at = NOW() WHERE id = ?`,
      [target, req.params.id]);
    res.json({ ok: true, status: target });
  } catch (e) { next(e); }
});

// ========== 5. 调度中心状态：全局概览 + 近24h统计 ==========
router.get('/status', async (req, res, next) => {
  try {
    const scheduler = req.scheduler;
    const isRunning = !!(scheduler && scheduler.isRunning && scheduler.isRunning());
    const stats = { running: isRunning };
    if (scheduler && scheduler.getStats) stats.snapshot = scheduler.getStats();

    // 近24h 任务执行统计
    const since = new Date(Date.now() - 86400000);
    const [today] = await query(
      `SELECT COUNT(*) c,
              SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) success,
              SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) failed,
              SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) running
       FROM task_runs WHERE (tenant_id = ? OR tenant_id IS NULL) AND started_at >= ?`,
      [req.user.tenantId, since]
    );
    stats.last24h = today[0];

    // 待处理/失败任务数量
    const [pendingFailed] = await query(
      `SELECT task_type, status, COUNT(*) c
       FROM scheduled_tasks WHERE (tenant_id = ? OR tenant_id IS NULL) AND status IN ('pending','failed','retried')
       GROUP BY task_type, status`,
      [req.user.tenantId]
    );
    stats.backlog = pendingFailed;

    res.json(stats);
  } catch (e) { next(e); }
});

module.exports = router;
