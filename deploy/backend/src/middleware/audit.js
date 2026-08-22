// 审计日志中间件：记录写操作（POST/PATCH/PUT/DELETE）到 audit_logs
// 用法: 在需要审计的路由前挂载 audit('模块名')
// 异步写入，不阻塞主流程；失败仅 console，不抛错
const { query } = require('../db');

function getClientIp(req) {
  return (req.headers['x-real-ip']) ||
         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         req.socket.remoteAddress || '';
}

function getClientUa(req) {
  return (req.headers['user-agent'] || '').slice(0, 200);
}

// target_id 从 params 提取：:id / :shopId 等常见命名
function extractTarget(req) {
  const p = req.params || {};
  const idKey = Object.keys(p).find(k => /id$/i.test(k));
  let targetType = req.baseUrl.split('/').pop() || (req.route && req.route.path);
  // 路由路径推断 target_type
  const seg = (req.baseUrl + ((req.route && req.route.path) || '')).split('/').filter(Boolean);
  targetType = seg[seg.length - 1] || req.baseUrl;
  return { targetType, targetId: idKey ? p[idKey] : null };
}

module.exports = function audit(module) {
  return async function auditMiddleware(req, res, next) {
    // 仅审计写操作
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
    const start = Date.now();
    // 捕获响应完成
    const writeLog = () => {
      res.removeListener('finish', writeLog);
      setImmediate(async () => {
        try {
          if (!req.user) return; // 未登录操作不记(如登录本身由 auth 单独记)
          const { targetType, targetId } = extractTarget(req);
          let detail = null;
          if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
            try { detail = JSON.stringify(req.body).slice(0, 2000); } catch {}
          }
          await query(
            `INSERT INTO audit_logs (tenant_id, user_id, username, \`action\`, \`method\`, \`path\`, target_type, target_id, status_code, detail, ip, ua, duration_ms)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              req.user.tenantId, req.user.uid, req.user.username,
              `${module || 'op'}.${req.method.toLowerCase()}`,
              req.method, (req.baseUrl + ((req.route && req.route.path) || '')),
              targetType, targetId, res.statusCode,
              detail, getClientIp(req), getClientUa(req), Date.now() - start
            ]
          );
        } catch (e) { console.error('[audit] 写入失败:', e.message); }
      });
    };
    res.on('finish', writeLog);
    next();
  };
};

// 直接写一条审计（供非中间件场景，如登录）
module.exports.log = async function log(opts) {
  try {
    await query(
      `INSERT INTO audit_logs (tenant_id, user_id, username, \`action\`, \`method\`, \`path\`, target_type, target_id, status_code, detail, ip, ua, duration_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [opts.tenantId || null, opts.userId || null, opts.username || null,
       opts.action || 'auth', opts.method || 'POST', opts.path || '/api/v1/auth/login',
       opts.targetType || 'auth', opts.targetId || null, opts.statusCode || 200,
       opts.detail || null, opts.ip || null, opts.ua || null, opts.durationMs || 0]
    );
  } catch (e) { console.error('[audit.log] 失败:', e.message); }
};
