// 数序ERP 后端入口：仅监听 127.0.0.1，由 nginx 反向代理对外
const express = require('express');
const config = require('./config');
const auth = require('./middleware/auth');

const app = express();
app.use(express.json({ limit: '1mb' }));

// 健康检查
app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'shuxu-erp', ts: Date.now() }));

// 业务路由
app.use('/api/v1/auth', require('./routes/auth'));
app.use('/api/v1/notifications', auth, require('./routes/notifications'));
app.use('/api/v1/shops', auth, require('./routes/shops'));
app.use('/api/v1/products', auth, require('./routes/products'));
app.use('/api/v1/inventory', auth, require('./routes/inventory'));
// 面单打印走 query token 自鉴权（window.open 无法带 Authorization 头）
app.use('/api/v1/orders', (req, res, next) => {
  if (/\/label$/.test(req.path)) return next();
  return auth(req, res, next);
}, require('./routes/orders'));
app.use('/api/v1/stats', auth, require('./routes/stats'));
app.use('/api/v1/carriers', auth, require('./routes/carriers'));
app.use('/api/v1/purchases', auth, require('./routes/purchases'));
app.use('/api/v1/finance', auth, require('./middleware/auth').requireOwner, require('./routes/finance'));
// 审计日志查询（owner 可见本租户）
app.use('/api/v1/audit', auth, require('./middleware/auth').requireOwner, require('./routes/audit'));
// OAuth 平台授权（callback 为平台回跳，路由内部按需鉴权）
app.use('/api/v1/oauth', require('./routes/oauth'));

// 后台定时调度：订单自动同步（ENABLE_SCHEDULER=0 可关闭）
if (process.env.ENABLE_SCHEDULER !== '0') {
  require('./scheduler').start();
}

// 404 与统一错误处理
app.use((req, res) => res.status(404).json({ error: '接口不存在' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体格式错误' });
  console.error(`[${new Date().toISOString()}]`, err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`[shuxu-erp] backend listening on 127.0.0.1:${config.port}`);
});
