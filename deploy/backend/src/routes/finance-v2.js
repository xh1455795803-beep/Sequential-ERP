/**
 * V2.0 财务利润中心（飞书文档 V2.3 财务结算 + 利润看板）
 * 数据源：finance_profit（订单级利润滚存表）+ bills/bill_items（租户账单）
 * 能力：
 *  1. 利润看板 Dashboard（日/周/月/季/年筛选，9大成本口径拆解）
 *  2. 订单级利润明细（支持订单号/SKU/店铺/币种筛选）
 *  3. 月度结算单生成 + 导出 + 对账
 *  4. 租户账单 SaaS 运营后台关联（内部：bills 表）
 */
const express = require('express');
const { query, withTransaction } = require('../db');

const router = express.Router();

// ========== 口径：9 大成本字段（单位 CNY） ==========
const COST_FIELDS = [
  'product_cost',   // 商品成本(COGS)
  'ship_head_cost', // 头程运费
  'ship_tail_cost', // 尾程运费
  'platform_fee',   // 平台佣金
  'withdraw_fee',   // 提现/汇损
  'ad_cost',        // 广告分摊
  'vat_tax',        // VAT/关税
  'other_cost',     // 杂项
  'aftersale_refund'// 售后红冲
];
const ALL_FIELDS = ['sale_amount', ...COST_FIELDS, 'net_profit'];

// ========== 1. 利润看板 Dashboard ==========
router.get('/dashboard', async (req, res, next) => {
  try {
    const { period = 'month', start, end } = req.query;
    // 时间范围：默认当月
    let [sDate, eDate] = (() => {
      if (start && end) return [start, end];
      const now = new Date();
      if (period === 'today') {
        const d = now.toISOString().slice(0, 10);
        return [d, d];
      }
      if (period === 'week') {
        const e = now;
        const s = new Date(now.getTime() - 6 * 86400000);
        return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
      }
      if (period === 'quarter') {
        const q = Math.floor(now.getMonth() / 3);
        const s = new Date(now.getFullYear(), q * 3, 1);
        const e = new Date(now.getFullYear(), q * 3 + 3, 0);
        return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
      }
      if (period === 'year') {
        return [`${now.getFullYear()}-01-01`, `${now.getFullYear()}-12-31`];
      }
      // 当月
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return [s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)];
    })();

    // 汇总
    const params = [req.user.tenantId, sDate, eDate];
    const [sumRow] = await query(
      `SELECT
        COUNT(*) order_count,
        SUM(sale_amount)    sale_amount,
        SUM(product_cost)   product_cost,
        SUM(ship_head_cost) ship_head_cost,
        SUM(ship_tail_cost) ship_tail_cost,
        SUM(platform_fee)   platform_fee,
        SUM(withdraw_fee)   withdraw_fee,
        SUM(ad_cost)        ad_cost,
        SUM(vat_tax)        vat_tax,
        SUM(other_cost)     other_cost,
        SUM(IFNULL(aftersale_refund,0)) aftersale_refund,
        SUM(net_profit)     net_profit
       FROM finance_profit
       WHERE tenant_id = ? AND COALESCE(order_date, created_at) BETWEEN ? AND ?`,
      params
    );
    const sum = sumRow[0] || {};
    Object.keys(sum).forEach(k => { if (k !== 'order_count') sum[k] = Number(sum[k] || 0).toFixed(2); else sum[k] = Number(sum[k] || 0); });

    // 日趋势
    const daily = await query(
      `SELECT DATE(COALESCE(order_date, created_at)) d,
              ROUND(SUM(sale_amount),2) sale_amount,
              ROUND(SUM(net_profit),2) net_profit,
              COUNT(*) order_count
       FROM finance_profit
       WHERE tenant_id = ? AND COALESCE(order_date, created_at) BETWEEN ? AND ?
       GROUP BY DATE(COALESCE(order_date, created_at)) ORDER BY d ASC`,
      params
    );

    // 店铺维度
    const byShop = await query(
      `SELECT COALESCE(s.name, '未分类') shop_name,
              ROUND(SUM(fp.sale_amount),2) sale_amount,
              ROUND(SUM(fp.net_profit),2) net_profit,
              COUNT(*) order_count
       FROM finance_profit fp
       LEFT JOIN orders o  ON o.id = fp.order_id
       LEFT JOIN shops  s  ON s.id = o.shop_id AND s.tenant_id = fp.tenant_id
       WHERE fp.tenant_id = ? AND COALESCE(fp.order_date, fp.created_at) BETWEEN ? AND ?
       GROUP BY s.id, s.name ORDER BY sale_amount DESC LIMIT 20`,
      params
    );

    // 成本结构（雷达图用）
    const structure = {};
    const totalCost = Number(sum.product_cost) + Number(sum.ship_head_cost) + Number(sum.ship_tail_cost)
                    + Number(sum.platform_fee) + Number(sum.withdraw_fee) + Number(sum.ad_cost)
                    + Number(sum.vat_tax) + Number(sum.other_cost) + Number(sum.aftersale_refund);
    for (const f of COST_FIELDS) {
      const v = Number(sum[f] || 0);
      structure[f] = {
        value: v,
        pct: totalCost > 0 ? Number((v / totalCost * 100).toFixed(2)) : 0,
        label: {
          product_cost: '商品成本', ship_head_cost: '头程运费', ship_tail_cost: '尾程运费',
          platform_fee: '平台佣金', withdraw_fee: '提现/汇损', ad_cost: '广告分摊',
          vat_tax: 'VAT/关税', other_cost: '杂项', aftersale_refund: '售后红冲'
        }[f] || f
      };
    }

    res.json({
      period, range: { start: sDate, end: eDate },
      summary: sum,
      daily: daily.map(r => ({ d: String(r.d).slice(0, 10), sale: Number(r.sale_amount), profit: Number(r.net_profit), orders: Number(r.order_count) })),
      byShop,
      structure,
      grossMarginPct: Number(sum.sale_amount) > 0
        ? Number(((Number(sum.sale_amount) - Number(sum.product_cost)) / Number(sum.sale_amount) * 100).toFixed(2))
        : 0,
      netMarginPct: Number(sum.sale_amount) > 0
        ? Number((Number(sum.net_profit) / Number(sum.sale_amount) * 100).toFixed(2))
        : 0
    });
  } catch (e) { next(e); }
});

// ========== 2. 订单级利润明细（分页） ==========
router.get('/orders', async (req, res, next) => {
  try {
    const { order_no, sku, shop, month, settled, page = 1, size = 50 } = req.query;
    const where = ['fp.tenant_id = ?']; const params = [req.user.tenantId];
    if (order_no) { where.push('fp.order_no LIKE ?'); params.push(`%${order_no}%`); }
    if (shop)     { where.push('s.name LIKE ?');       params.push(`%${shop}%`); }
    if (/^\d{4}-\d{2}$/.test(month || '')) {
      where.push("DATE_FORMAT(COALESCE(fp.order_date, fp.created_at), '%Y-%m') = ?"); params.push(month);
    }
    if (settled === '1' || settled === '0') { where.push('fp.settled = ?'); params.push(Number(settled)); }

    const p = Math.max(1, parseInt(page) || 1);
    const s = Math.min(500, Math.max(1, parseInt(size) || 50));
    const [count] = await query(
      `SELECT COUNT(*) c FROM finance_profit fp
       LEFT JOIN orders o ON o.id = fp.order_id
       LEFT JOIN shops  s ON s.id = o.shop_id AND s.tenant_id = fp.tenant_id
       WHERE ${where.join(' AND ')}`, params
    );
    const rows = await query(
      `SELECT fp.*, s.name AS shop_name, o.currency, o.total_amount order_original
       FROM finance_profit fp
       LEFT JOIN orders o ON o.id = fp.order_id
       LEFT JOIN shops  s ON s.id = o.shop_id AND s.tenant_id = fp.tenant_id
       WHERE ${where.join(' AND ')}
       ORDER BY COALESCE(fp.order_date, fp.created_at) DESC, fp.id DESC
       LIMIT ? OFFSET ?`,
      [...params, s, (p - 1) * s]
    );
    res.json({ total: (count && count[0] && count[0].c) ? Number(count[0].c) : 0, page: p, size: s, items: rows });
  } catch (e) { next(e); }
});

// ========== 2. 订单级利润明细（分页） ==========
router.post('/orders/:id/recalc', async (req, res, next) => {
  try {
    const [fp] = await query('SELECT * FROM finance_profit WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!fp) return res.status(404).json({ error: '记录不存在' });
    const net = Number(fp.sale_amount) - (
      Number(fp.product_cost) + Number(fp.ship_head_cost) + Number(fp.ship_tail_cost)
      + Number(fp.platform_fee) + Number(fp.withdraw_fee) + Number(fp.ad_cost)
      + Number(fp.vat_tax) + Number(fp.other_cost) + Number(fp.aftersale_refund || 0)
    );
    await query(
      `UPDATE finance_profit SET net_profit = ?, updated_at = NOW() WHERE id = ?`,
      [Number(net.toFixed(2)), fp.id]
    );
    res.json({ ok: true, net_profit: Number(net.toFixed(2)) });
  } catch (e) { next(e); }
});

// ========== 4. 账单（SaaS 租户对平台的账单：bills + bill_items）==========
// 租户侧：列表 / 详情
router.get('/bills', async (req, res, next) => {
  try {
    const { status, page = 1, size = 20 } = req.query;
    const where = ['tenant_id = ?']; const params = [req.user.tenantId];
    if (status) { where.push('status = ?'); params.push(status); }
    const p = Math.max(1, parseInt(page) || 1);
    const s = Math.min(100, Math.max(1, parseInt(size) || 20));
    const [count] = await query(`SELECT COUNT(*) c FROM bills WHERE ${where.join(' AND ')}`, params);
    const rows = await query(
      `SELECT * FROM bills WHERE ${where.join(' AND ')} ORDER BY bill_month DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, s, (p - 1) * s]
    );
    res.json({ total: (count && count[0] && count[0].c) ? Number(count[0].c) : 0, page: p, size: s, items: rows });
  } catch (e) { next(e); }
});

router.get('/bills/:id', async (req, res, next) => {
  try {
    const [b] = await query('SELECT * FROM bills WHERE tenant_id = ? AND id = ?', [req.user.tenantId, req.params.id]);
    if (!b) return res.status(404).json({ error: '账单不存在' });
    const items = await query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id ASC', [req.params.id]);
    res.json({ bill: b, items });
  } catch (e) { next(e); }
});

module.exports = router;
