// 数序ERP V2.0 后端入口：仅监听 127.0.0.1，由 nginx 反向代理对外
const express = require('express');
const config = require('./config');
const auth = require('./middleware/auth');
const requireOwner = require('./middleware/auth').requireOwner;
const quota = require('./middleware/quota');

const app = express();
app.use(express.json({ limit: '5mb' }));

// ========== 健康检查 ==========
app.get('/api/health', (req, res) => res.json({
  status: 'ok', service: 'shuxu-erp-v2', version: '2.0.0', ts: Date.now()
}));

// ========== SaaS 运营后台（独立 JWT 体系，飞书文档第5章） ==========
app.use('/api/v1/saas/admin',   require('./routes/saas-admin'));
app.use('/api/v1/saas',         require('./routes/saas-tenants'));

// ========== 基础业务路由（V1.x 保持兼容） ==========
app.use('/api/v1/auth',          require('./routes/auth'));
app.use('/api/v1/notifications', auth, require('./routes/notifications'));
app.use('/api/v1/shops',         auth, require('./routes/shops'));
app.use('/api/v1/products',      auth, require('./routes/products'));
app.use('/api/v1/inventory',     auth, require('./routes/inventory'));
// 面单打印走 query token 自鉴权（window.open 无法带 Authorization 头）
app.use('/api/v1/orders', (req, res, next) => {
  if (/\/label$/.test(req.path)) return next();
  return auth(req, res, next);
}, require('./routes/orders'));
app.use('/api/v1/stats',         auth, require('./routes/stats'));
app.use('/api/v1/carriers',      auth, require('./routes/carriers'));
app.use('/api/v1/purchases',     auth, require('./routes/purchases'));
app.use('/api/v1/finance',       auth, requireOwner, require('./routes/finance'));
// V2.0 财务利润中心（订单级利润滚存 + 利润看板 + SaaS账单）
app.use('/api/v1/finance-v2',    auth, requireOwner, require('./routes/finance-v2'));
// 审计日志查询（owner 可见本租户）
app.use('/api/v1/audit',         auth, requireOwner, require('./routes/audit'));
// OAuth 平台授权（callback 为平台回跳，路由内部按需鉴权）
app.use('/api/v1/oauth',         require('./routes/oauth'));

// ========== V2.0 新增业务模块（飞书文档 V2.0 架构） ==========
// 商品完整模块（10大字段模块 + 变体/刊登/合规/预售）
app.use('/api/v1/products-v2',   auth, require('./routes/products-v2'));
// 售后逆向全流程（仅退款/退货退款/补发）
app.use('/api/v1/aftersales',    auth, require('./routes/aftersales'));
// 自动审单规则 + 批量审核
app.use('/api/v1/auto-audit',    auth, require('./routes/auto-audit'));
// 多币种汇率可视化看板
app.use('/api/v1/exchange-rates', auth, require('./routes/exchange-rates'));
// 租户配额使用查询（前端套餐面板）
app.get('/api/v1/quota/usage', auth, async (req, res) => {
  try {
    const rows = await require('./db').query(
      'SELECT * FROM tenant_quotas WHERE tenant_id = ?', [req.user.tenantId]
    );
    if (!rows.length) return res.json({ usage: null, defs: quota.QUOTA_DEFS || {} });
    return res.json({ usage: rows[0], defs: quota.QUOTA_DEFS || {} });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});
// 调度中心：任务状态查询 / 手动触发
app.use('/api/v1/scheduler', auth, requireOwner, (req, res, next) => {
  req.scheduler = require('./scheduler');
  next();
}, require('./routes/scheduler-routes'));

// ========== 后台定时调度：全自动调度中心（ENABLE_SCHEDULER=0 可关闭） ==========
if (process.env.ENABLE_SCHEDULER !== '0') {
  try { require('./scheduler').start(); }
  catch (e) { console.error('[scheduler] 启动失败:', e.message); }
}

// ========== 404 与统一错误处理 ==========
app.use((req, res) => res.status(404).json({ error: '接口不存在', path: req.path }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体格式错误' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(`[${new Date().toISOString()}] ERR`, err);
  res.status(500).json({ error: '服务器内部错误', debug: process.env.NODE_ENV === 'dev' ? err.message : undefined });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`[shuxu-erp-v2] backend listening on 127.0.0.1:${config.port}`);
});
