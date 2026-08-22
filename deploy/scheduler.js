// 后台定时调度：每 30 分钟自动同步所有已授权店铺的订单（可配 SYNC_INTERVAL_MIN）
// 单飞（同一时刻仅一轮）；失败写 sync_logs 并发租户通知
// [P2] 调度支持 OAuth 型自动刷新令牌 + 密钥型店铺
const { query } = require('./db');
const { syncOrders, refreshToken } = require('./sync-service');
const adapters = require('./platforms');

const INTERVAL_MIN = parseInt(process.env.SYNC_INTERVAL_MIN || '30', 10);
let running = false;
let timer = null;

// [P1] 同步失败给租户发通知
async function notifySyncFailure(tenantId, shopId, platform, message) {
  try {
    await query(
      `INSERT INTO notifications (tenant_id, category, level, title, body, link, audience, status, created_by)
       VALUES (?, 'sync', 'warn', ?, ?, '/app/shops', 'tenant', 'published', 'scheduler')`,
      [tenantId,
       `${platform} 订单同步失败`,
       `店铺#${shopId}（${platform}）自动同步失败：${message}。请检查授权状态或在店铺页手动同步。`]
    );
  } catch (e) { console.error('[notify] 写入失败:', e.message); }
}

// 令牌快过期时自动刷新：返回 true=刷新成功；false=不刷新或刷新失败（由调用方决定是否跳过本轮）
async function tryRefreshToken(shop, app) {
  const FRESH_WINDOW_S = 10 * 60; // 距离过期 ≤ 10 分钟时尝试刷新
  if (!shop.refresh_token_enc) return false;
  if (shop.token_expires_at && (new Date(shop.token_expires_at) - Date.now()) > FRESH_WINDOW_S * 1000) return false;
  try {
    const newToken = await refreshToken(shop, app);
    if (!newToken || !newToken.accessToken) return false;
    const expiresAt = new Date(Date.now() + (newToken.expiresIn || 3600) * 1000);
    await query('UPDATE shops SET access_token_enc=?, token_expires_at=?, authorized_at=NOW() WHERE id=?',
      [require('./util-crypto').encrypt(newToken.accessToken), expiresAt, shop.id]);
    console.log(`[scheduler] 已刷新 ${shop.platform} 店铺#${shop.id} 令牌，新过期时间 ${expiresAt.toISOString()}`);
    return true;
  } catch (e) {
    console.warn(`[scheduler] ${shop.platform} 店铺#${shop.id} 令牌刷新失败:`, e.message);
    return false;
  }
}

async function runRound() {
  if (running) return;
  running = true;
  try {
    // [P2] 跨租户拉取：OAuth 型（有令牌）+ 密钥型（有 api_key_enc），全部纳入
    const shops = await query(
      `SELECT * FROM shops WHERE status = 'active'
        AND (access_token_enc IS NOT NULL OR api_key_enc IS NOT NULL)
        AND (auth_status IS NULL OR auth_status = 'authorized')`
    );
    for (const shop of shops) {
      try {
        const apps = await query("SELECT * FROM platform_apps WHERE platform = ? AND status = 'active'", [shop.platform]);
        const app = apps[0] || null;
        // OAuth 型自动刷新（密钥型无需刷新）
        if (shop.access_token_enc) await tryRefreshToken(shop, app);
        const { imported, skipped } = await syncOrders(shop, app);
        await query(
          'INSERT INTO sync_logs (tenant_id, shop_id, platform, job_type, imported, skipped, status, finished_at) VALUES (?,?,?,?,?,?,?, NOW())',
          [shop.tenant_id, shop.id, shop.platform, 'orders', imported, skipped, 'success']
        );
      } catch (err) {
        await query(
          'INSERT INTO sync_logs (tenant_id, shop_id, platform, job_type, status, message, finished_at) VALUES (?,?,?,?,?,?, NOW())',
          [shop.tenant_id, shop.id, shop.platform, 'orders', 'failed', err.message]
        );
        await notifySyncFailure(shop.tenant_id, shop.id, shop.platform, err.message);
      }
    }
  } catch (e) {
    console.error('[scheduler] 轮询异常:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  // 启动后延迟 60s 再首轮，避免与应用启动抢资源
  timer = setInterval(runRound, INTERVAL_MIN * 60 * 1000);
  setTimeout(runRound, 60 * 1000);
  console.log(`[scheduler] 已启动，每 ${INTERVAL_MIN} 分钟同步一轮订单`);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, runRound };
