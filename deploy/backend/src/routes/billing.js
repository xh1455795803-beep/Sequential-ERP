/**
 * 订阅套餐路由（头像下拉→套餐订阅入口，主账号可见，子账号隐藏+403双重拦截）
 * GET  /api/v1/billing/overview    当前套餐 + 用量 + 到期
 * GET  /api/v1/billing/records     续费/变更日志
 * POST /api/v1/billing/create      创建购买订单（subscribe/renewal/addon）
 * POST /api/v1/billing/pay/confirm 转账上传凭证 -> 待审核
 * GET  /api/v1/billing/orders      租户订阅订单记录
 */
const express = require('express');
const crypto = require('crypto');
const { query } = require('../db');
const quota = require('../middleware/quota');

const router = express.Router();

const PLAN_CATALOG = {
  basic:      { name: '基础版',   prices: { month: 199,  quarter: 529,  year: 1980 },
                quotas: { shops: 3,   monthlyOrders: 500,    products: 2000,   aiCalls: 100,    storageMB: 1024   } },
  standard:   { name: '标准版',   prices: { month: 599,  quarter: 1599, year: 5980 },
                quotas: { shops: 10,  monthlyOrders: 5000,   products: 10000,  aiCalls: 2000,   storageMB: 10240  } },
  pro:        { name: '专业版',   prices: { month: 1599, quarter: 4299, year: 15980 },
                quotas: { shops: 30,  monthlyOrders: 30000,  products: 999999, aiCalls: 10000,  storageMB: 102400 } },
  enterprise: { name: '企业版',   prices: { month: 4999, quarter: 13499, year: 47980 },
                quotas: { shops: 100, monthlyOrders: 200000, products: 999999, aiCalls: 50000,  storageMB: 524288 } },
};

const ADDONS = {
  shops_5:      { name: '追加5店铺',     price: 129,   unit: 'month', affect: { shops: 5 } },
  orders_2k:    { name: '追加2千单/月',   price: 99,    unit: 'month', affect: { monthlyOrders: 2000 } },
  aicalls_2k:   { name: '追加2千AI次/月', price: 59,    unit: 'month', affect: { aiCalls: 2000 } },
  storage_10g:  { name: '追加10G存储',    price: 39,    unit: 'month', affect: { storageMB: 10240 } },
};

const MONTHS_OF = { month: 1, quarter: 3, year: 12 };

function requireOwnerStrict(req, res, next) {
  const user = req.user;
  if (!user) return res.status(401).json({ error: '请先登录' });
  const isOwner = (user.role === 'owner') || (Number(user.is_owner) === 1);
  if (!isOwner) return res.status(403).json({ error: '仅主账号可查看与购买套餐' });
  next();
}
router.use(requireOwnerStrict);

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + Number(months || 0));
  return d;
}
function fmtDate(d) {
  if (!d) return null;
  const x = new Date(d);
  if (isNaN(x)) return null;
  const p = n => String(n).padStart(2,'0');
  return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`;
}
function genOrderNo() {
  const t = new Date();
  const p = n => String(n).padStart(2,'0');
  const ymd = `${t.getFullYear()}${p(t.getMonth()+1)}${p(t.getDate())}${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`;
  return 'SX' + ymd + String(Math.floor(Math.random()*9000)+1000);
}
function jp(v) { try { return v == null ? null : typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } }

/** 1. 订阅总览（当前套餐 + 用量）*/
router.get('/overview', async (req, res, next) => {
  try {
    const tid = req.user.tenantId;
    const [sub] = await query('SELECT * FROM tenant_subscriptions WHERE tenant_id = ? ORDER BY id DESC LIMIT 1', [tid]);
    // 真实 quota 用量
    const usageRow = await query('SELECT * FROM tenant_quotas WHERE tenant_id = ?', [tid]);
    const quotas = usageRow && usageRow[0] ? usageRow[0] : null;
    // 套餐目录
    const catalog = Object.keys(PLAN_CATALOG).map(code => ({
      code, name: PLAN_CATALOG[code].name,
      prices: PLAN_CATALOG[code].prices,
      quotas: PLAN_CATALOG[code].quotas,
    }));
    const addonCatalog = Object.keys(ADDONS).map(code => ({ code, ...ADDONS[code] }));
    let current = null;
    if (sub) {
      current = {
        planCode: sub.plan_code,
        planName: sub.plan_name,
        periodUnit: sub.period_unit,
        price: Number(sub.price || 0),
        startAt: fmtDate(sub.start_at),
        expireAt: fmtDate(sub.expire_at),
        status: sub.status,
        frozenReason: sub.frozen_reason,
        quotas: jp(sub.quotas_json) || {},
        extras: jp(sub.extras_json) || {},
        daysLeft: Math.max(0, Math.ceil((new Date(sub.expire_at).getTime() - Date.now()) / 86400000)),
      };
    }
    res.json({
      current,
      quotaUsage: quotas ? {
        shops: Number(quotas.shops_used||0), shopsLimit: Number(quotas.shops_limit||0),
        monthlyOrders: Number(quotas.orders_used||0), monthlyOrdersLimit: Number(quotas.monthly_orders||0),
        products: Number(quotas.products_used||0), productsLimit: Number(quotas.products_limit||0),
        aiCalls: Number(quotas.ai_calls_used||0), aiCallsLimit: Number(quotas.ai_calls_limit||0),
        storageMB: Number(quotas.storage_mb_used||0), storageMBLimit: Number(quotas.storage_mb_limit||0),
        resetAt: quotas.reset_at ? fmtDate(quotas.reset_at) : null,
      } : null,
      catalog,
      addonCatalog,
    });
  } catch (e) { next(e); }
});

/** 2. 创建订阅订单 */
router.post('/create', async (req, res, next) => {
  const conn = await require('../db').pool.getConnection();
  try {
    await conn.query('START TRANSACTION');
    const tid = req.user.tenantId;
    const uid = req.user.id;
    const { orderType = 'subscribe', planCode, periodUnit = 'month', periodCount = 1, addonCode, addonCount, payChannel = 'transfer' } = req.body || {};
    if (!['subscribe','renewal','upgrade','addon'].includes(orderType)) {
      return res.status(400).json({ error: '订单类型非法' });
    }
    if (orderType !== 'addon') {
      if (!PLAN_CATALOG[planCode]) return res.status(400).json({ error: '未知套餐类型' });
      if (!MONTHS_OF[periodUnit] || !(periodCount >= 1 && periodCount <= 12)) {
        return res.status(400).json({ error: '周期参数非法' });
      }
    } else {
      if (!ADDONS[addonCode]) return res.status(400).json({ error: '未知扩容包' });
      addonCount = Math.max(1, Math.min(20, parseInt(addonCount) || 1));
    }

    // 计算价格
    let totalAmount = 0;
    let planName = '';
    let addonName = '';
    if (orderType === 'addon') {
      totalAmount = ADDONS[addonCode].price * addonCount;
      addonName = ADDONS[addonCode].name;
      planName = `${addonName} x${addonCount}`;
    } else {
      const unitPrice = PLAN_CATALOG[planCode].prices[periodUnit];
      planName = PLAN_CATALOG[planCode].name;
      totalAmount = unitPrice * periodCount;
    }

    const orderNo = genOrderNo();
    const applyStatus = payChannel === 'transfer' ? 'pending' : null;
    const [r] = await conn.query(
      `INSERT INTO billing_orders
       (tenant_id, user_id, order_no, order_type, plan_code, plan_name, period_unit, period_count,
        addon_code, addon_count, unit_price, total_amount, pay_channel, pay_status, apply_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [tid, uid, orderNo, orderType, planCode || 'addon', planName, periodUnit, Number(periodCount)||1,
       addonCode || null, addonCount || null,
       orderType === 'addon' ? Number(ADDONS[addonCode].price) : Number(PLAN_CATALOG[planCode].prices[periodUnit]),
       Number(totalAmount), payChannel, 'unpaid', applyStatus]
    );
    await conn.query('COMMIT');
    res.json({
      ok: true, orderId: Number(r.insertId), orderNo, totalAmount,
      payGuide: payChannel === 'transfer'
        ? '请使用对公账户或指定收款方式转账，并上传转账凭证，财务审核通过后自动开通'
        : '我们将跳转到在线支付页面（支付通道对接中，先使用转账+凭证审核方式）'
    });
  } catch (e) {
    try { await conn.query('ROLLBACK'); } catch { /* ignore */ }
    next(e);
  } finally {
    try { conn.release(); } catch { /* ignore */ }
  }
});

/** 3. 上传转账凭证 -> apply_status 已提交 */
router.post('/pay/confirm', async (req, res, next) => {
  try {
    const { orderId, payProofUrl, remark } = req.body || {};
    if (!orderId) return res.status(400).json({ error: '订单ID必填' });
    const [o] = await query('SELECT * FROM billing_orders WHERE id = ? AND tenant_id = ?', [orderId, req.user.tenantId]);
    if (!o) return res.status(404).json({ error: '订单不存在' });
    if (o.pay_status !== 'unpaid') return res.status(400).json({ error: '该订单已完成支付或已取消' });
    if (!payProofUrl) return res.status(400).json({ error: '请上传转账凭证图片' });
    await query(
      `UPDATE billing_orders SET pay_proof_url = ?, apply_status = 'pending', remark = ? WHERE id = ?`,
      [String(payProofUrl).slice(0,500), String(remark||'').slice(0,800) || null, orderId]
    );
    res.json({ ok: true, msg: '凭证已提交，财务将在24小时内审核，审核通过自动开通' });
  } catch (e) { next(e); }
});

/** 4. 订阅订单历史（租户端）*/
router.get('/orders', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
    const where = ['tenant_id = ?']; const params = [req.user.tenantId];
    const [cnt] = await query(`SELECT COUNT(*) c FROM billing_orders WHERE ${where.join(' AND ')}`, params);
    const rows = await query(
      `SELECT id, order_no, order_type, plan_code, plan_name, period_unit, period_count,
              addon_code, addon_count, total_amount, pay_channel, pay_status, paid_at,
              apply_status, audit_remark, pay_proof_url, created_at
       FROM billing_orders WHERE ${where.join(' AND ')}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, size, (page-1)*size]
    );
    res.json({
      total: (cnt && cnt[0] && cnt[0].c) ? Number(cnt[0].c) : 0,
      page, size, items: rows.map(r => ({
        id: r.id, orderNo: r.order_no, orderType: r.order_type,
        planCode: r.plan_code, planName: r.plan_name,
        periodUnit: r.period_unit, periodCount: r.period_count,
        addonCode: r.addon_code, addonCount: r.addon_count,
        totalAmount: Number(r.total_amount||0),
        payChannel: r.pay_channel, payStatus: r.pay_status,
        applyStatus: r.apply_status, paidAt: fmtDate(r.paid_at),
        payProofUrl: r.pay_proof_url,
        auditRemark: r.audit_remark,
        createdAt: fmtDate(r.created_at),
      })),
    });
  } catch (e) { next(e); }
});

/** 5. 订阅变更日志（续费/扩容/冻结）*/
router.get('/records', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
    const tid = req.user.tenantId;
    const [cnt] = await query('SELECT COUNT(*) c FROM billing_records WHERE tenant_id = ?', [tid]);
    const rows = await query(
      `SELECT id, action, before_plan_code, after_plan_code, before_expire_at, after_expire_at,
              amount, billing_order_id, operator_type, remark, created_at
       FROM billing_records WHERE tenant_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
      [tid, size, (page-1)*size]
    );
    res.json({
      total: (cnt && cnt[0] && cnt[0].c) ? Number(cnt[0].c) : 0,
      page, size, items: rows.map(r => ({
        id: r.id, action: r.action,
        beforePlan: r.before_plan_code, afterPlan: r.after_plan_code,
        beforeExpireAt: fmtDate(r.before_expire_at), afterExpireAt: fmtDate(r.after_expire_at),
        amount: r.amount != null ? Number(r.amount) : null,
        orderId: r.billing_order_id,
        operatorType: r.operator_type,
        remark: r.remark,
        createdAt: fmtDate(r.created_at),
      })),
    });
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.PLAN_CATALOG = PLAN_CATALOG;
module.exports.ADDONS = ADDONS;
module.exports.MONTHS_OF = MONTHS_OF;
module.exports.addMonths = addMonths;
