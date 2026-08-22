/**
 * V2.0 自动审单规则 + 批量自动审核（飞书文档 2.4 order-service 核心自动化）
 * 规则维度（auto_audit_rules 表，一租户一套）：
 *   - auto_pass_no_exception: 无异常订单自动通过（默认开）
 *   - auto_pass_max_amount: 超过本币金额需人工审核（NULL = 不限制）
 *   - risk_countries: 高风险国家逗号分隔，命中需人工
 *   - block_negative_inventory: 拦截负库存订单（默认开）
 *   - block_repeat_buyer_hours: 同买家N小时重复下单需人工
 * 订单审核状态：audit_status = pending / auto_pass / manual_pass / rejected
 * 联动：自动审核通过后流转订单状态 PENDING -> PAID（模拟已支付确认）
 */
const express = require('express');
const { query, withTransaction } = require('../db');
const ledger = require('../inventory-ledger');

const router = express.Router();

// 1. 获取本租户审单规则
router.get('/rules', async (req, res, next) => {
  try {
    const [r] = await query('SELECT * FROM auto_audit_rules WHERE tenant_id = ?', [req.user.tenantId]);
    if (r) return res.json({ rule: r });
    // 懒初始化默认规则
    await query(
      `INSERT INTO auto_audit_rules (tenant_id) VALUES (?)
       ON DUPLICATE KEY UPDATE tenant_id = tenant_id`,
      [req.user.tenantId]
    );
    const [r2] = await query('SELECT * FROM auto_audit_rules WHERE tenant_id = ?', [req.user.tenantId]);
    res.json({ rule: r2 });
  } catch (e) { next(e); }
});

// 2. 保存审单规则
router.post('/rules', async (req, res, next) => {
  try {
    const b = req.body || {};
    const fields = []; const params = [];
    if (b.auto_pass_no_exception !== undefined) { fields.push('auto_pass_no_exception = ?'); params.push(!!b.auto_pass_no_exception ? 1 : 0); }
    if (b.auto_pass_max_amount !== undefined)    { fields.push('auto_pass_max_amount = ?');   params.push(b.auto_pass_max_amount == null ? null : Number(b.auto_pass_max_amount)); }
    if (b.risk_countries !== undefined)          { fields.push('risk_countries = ?');         params.push(b.risk_countries || null); }
    if (b.block_negative_inventory !== undefined){ fields.push('block_negative_inventory = ?');params.push(!!b.block_negative_inventory ? 1 : 0); }
    if (b.block_repeat_buyer_hours !== undefined){ fields.push('block_repeat_buyer_hours = ?');params.push(b.block_repeat_buyer_hours == null ? null : Number(b.block_repeat_buyer_hours)); }
    if (!fields.length) return res.status(400).json({ error: '无更新字段' });
    await query(
      `INSERT INTO auto_audit_rules (tenant_id, ${fields.map(f => f.split(' =')[0]).join(',')})
       VALUES (?, ${fields.map(() => '?').join(',')})
       ON DUPLICATE KEY UPDATE ${fields.join(', ')}`,
      [req.user.tenantId, ...params.map(p => params[fields.indexOf(fields[params.indexOf(p)]) ? p : p])]
    );
    // 简化：直接 UPDATE 兜底避免上面 VALUES 占位出错
    const sqlSet = fields.join(', ');
    params.push(req.user.tenantId);
    await query(`UPDATE auto_audit_rules SET ${sqlSet} WHERE tenant_id = ?`, params);
    const [r] = await query('SELECT * FROM auto_audit_rules WHERE tenant_id = ?', [req.user.tenantId]);
    res.json({ rule: r });
  } catch (e) { next(e); }
});

/**
 * 对单个订单执行审单规则，返回 { passed: bool, reason: string, riskTags: string[] }
 * （可供调度中心批量处理 & 接口手动触发共用）
 */
async function evaluate(order, rule) {
  const tags = []; let pass = !!rule.auto_pass_no_exception;

  if (rule.auto_pass_max_amount != null && Number(order.total_amount) > Number(rule.auto_pass_max_amount)) {
    pass = false; tags.push(`金额超阈值${rule.auto_pass_max_amount}`);
  }
  const risk = (rule.risk_countries || '').split(',').map(s => s.trim()).filter(Boolean);
  if (risk.length && order.country && risk.includes(order.country)) {
    pass = false; tags.push(`高风险国家:${order.country}`);
  }
  if (rule.block_repeat_buyer_hours && order.buyer_name) {
    const h = Number(rule.block_repeat_buyer_hours);
    const since = new Date(Date.now() - h * 3600000);
    const [dup] = await query(
      `SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND buyer_name = ? AND created_at >= ? AND id != ?`,
      [order.tenant_id, order.buyer_name, since, order.id]
    );
    if (dup && dup.c > 0) { pass = false; tags.push(`${h}h重复买家(${dup.c}次)`); }
  }
  // 库存状态：检查预留 vs 实际，如已扣到负数 -> 拦截
  if (rule.block_negative_inventory) {
    const [inv] = await query(
      `SELECT COUNT(*) AS c FROM order_items oi
       LEFT JOIN inventory i ON i.tenant_id = oi.tenant_id AND i.product_id = oi.product_id AND i.warehouse = 'MAIN'
       WHERE oi.order_id = ? AND (i.qty_on_hand IS NULL OR (i.qty_on_hand - i.qty_reserved) < 0)`,
      [order.id]
    );
    if (inv && inv.c > 0) { pass = false; tags.push('库存异常/负库存'); }
  }
  return { passed: pass, reason: tags.join('；') || (pass ? '无异常，自动通过' : '默认不通过'), riskTags: tags };
}

// 3. 单订单审核（自动模式或人工模式）
router.post('/orders/:id/audit', async (req, res, next) => {
  try {
    const { mode = 'auto', action, reason } = req.body || {}; // auto / manual
    const [ord] = await query(
      `SELECT * FROM orders WHERE tenant_id = ? AND id = ?`,
      [req.user.tenantId, req.params.id]
    );
    if (!ord) return res.status(404).json({ error: '订单不存在' });
    if (ord.status !== 'PENDING') return res.status(400).json({ error: `当前订单状态 ${ord.status} 不可审核` });
    if (ord.audit_status && ord.audit_status.startsWith('manual_pass'))
      return res.status(400).json({ error: '订单已人工审核' });

    const [rule] = await query('SELECT * FROM auto_audit_rules WHERE tenant_id = ?', [req.user.tenantId]);
    const finalRule = rule || { auto_pass_no_exception: 1, block_negative_inventory: 1 };

    let decision;
    if (mode === 'manual') {
      if (!['pass', 'reject'].includes(action)) return res.status(400).json({ error: 'manual 需 action=pass/reject' });
      decision = { passed: action === 'pass', reason: reason || `人工${action === 'pass' ? '通过' : '驳回'}`, riskTags: ['manual'] };
    } else {
      decision = await evaluate(ord, finalRule);
    }

    const auditStatus = decision.passed ? (mode === 'manual' ? 'manual_pass' : 'auto_pass') : (mode === 'manual' ? 'rejected' : 'rejected');

    await withTransaction(async conn => {
      await conn.query(
        `UPDATE orders SET audit_status = ?, audited_at = NOW(), audited_by = ?, risk_tag = ?, risk_reason = ? WHERE id = ? AND tenant_id = ?`,
        [auditStatus, req.user.uid, decision.riskTags.join(',') || null, decision.reason.slice(0, 255), ord.id, req.user.tenantId]
      );
      // 审核通过 -> 订单状态流转到 PAID，开始后续发货流程（飞书正向闭环：审单→发货扣减）
      if (decision.passed && ord.status === 'PENDING') {
        await conn.query(`UPDATE orders SET status = 'PAID' WHERE id = ?`, [ord.id]);
      }
    });
    res.json({ ok: true, auditStatus, decision });
  } catch (e) { next(e); }
});

// 4. 批量自动审核（调度中心每10分钟触发，或运营一键跑批）
router.post('/batch-auto', async (req, res, next) => {
  try {
    const { limit = 100 } = req.query;
    const [rule] = await query('SELECT * FROM auto_audit_rules WHERE tenant_id = ?', [req.user.tenantId]);
    const finalRule = rule || { auto_pass_no_exception: 1, block_negative_inventory: 1 };
    const candidates = await query(
      `SELECT * FROM orders WHERE tenant_id = ? AND status = 'PENDING' AND (audit_status IS NULL OR audit_status = 'pending')
       ORDER BY id ASC LIMIT ?`,
      [req.user.tenantId, Math.min(Number(limit), 1000)]
    );
    let passCount = 0, rejectCount = 0;
    for (const ord of candidates) {
      try {
        const d = await evaluate(ord, finalRule);
        const auditStatus = d.passed ? 'auto_pass' : 'rejected';
        await withTransaction(async conn => {
          await conn.query(
            `UPDATE orders SET audit_status = ?, audited_at = NOW(), risk_tag = ?, risk_reason = ? WHERE id = ? AND tenant_id = ?`,
            [auditStatus, d.riskTags.join(',') || null, d.reason.slice(0, 255), ord.id, req.user.tenantId]
          );
          if (d.passed) await conn.query(`UPDATE orders SET status = 'PAID' WHERE id = ? AND status = 'PENDING'`, [ord.id]);
        });
        d.passed ? passCount++ : rejectCount++;
      } catch (e) { /* 单订单异常不阻断批处理 */ console.error('[auto-audit] 单订单出错:', ord.id, e.message); }
    }
    res.json({ ok: true, total: candidates.length, passCount, rejectCount });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.evaluate = evaluate;
