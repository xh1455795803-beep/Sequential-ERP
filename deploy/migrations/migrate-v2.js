// 数序ERP 增量迁移 v2：安全/审计/流水/通知 新表（幂等，可重复执行）
// 用法: node src/migrate-v2.js
const config = require('./config');
const mysql = require('mysql2/promise');

const STMTS = [
  // P0 登录限流
  `CREATE TABLE IF NOT EXISTS login_attempts (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    ip VARCHAR(45) NOT NULL,
    success TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_la_user_time (username, created_at),
    INDEX idx_la_ip_time (ip, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // P1 库存变动流水
  `CREATE TABLE IF NOT EXISTS inventory_transactions (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    warehouse VARCHAR(50) NOT NULL DEFAULT 'MAIN',
    change_type VARCHAR(20) NOT NULL,
    qty_change INT NOT NULL,
    qty_before INT NOT NULL DEFAULT 0,
    qty_after INT NOT NULL DEFAULT 0,
    balance_field VARCHAR(20) NOT NULL DEFAULT 'on_hand',
    ref_type VARCHAR(20) DEFAULT NULL,
    ref_id BIGINT DEFAULT NULL,
    operator VARCHAR(50) DEFAULT NULL,
    remark VARCHAR(200) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_it_tenant_product_time (tenant_id, product_id, created_at),
    INDEX idx_it_tenant_type_time (tenant_id, change_type, created_at),
    INDEX idx_it_ref (ref_type, ref_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // P1 操作审计日志
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    user_id BIGINT DEFAULT NULL,
    username VARCHAR(50) DEFAULT NULL,
    action VARCHAR(50) NOT NULL,
    method VARCHAR(10) NOT NULL,
    path VARCHAR(255) NOT NULL,
    target_type VARCHAR(30) DEFAULT NULL,
    target_id VARCHAR(64) DEFAULT NULL,
    status_code INT DEFAULT NULL,
    detail TEXT,
    ip VARCHAR(45) DEFAULT NULL,
    ua VARCHAR(200) DEFAULT NULL,
    duration_ms INT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_al_tenant_time (tenant_id, created_at),
    INDEX idx_al_target (target_type, target_id),
    INDEX idx_al_user_time (user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 通知公告
  `CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT DEFAULT NULL,
    category VARCHAR(30) NOT NULL DEFAULT 'system',
    level VARCHAR(10) NOT NULL DEFAULT 'info',
    title VARCHAR(200) NOT NULL,
    body TEXT,
    link VARCHAR(500) DEFAULT NULL,
    audience VARCHAR(20) NOT NULL DEFAULT 'tenant',
    status VARCHAR(20) NOT NULL DEFAULT 'published',
    created_by VARCHAR(50) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME DEFAULT NULL,
    INDEX idx_nt_tenant_status (tenant_id, status, created_at),
    INDEX idx_nt_audience_status (audience, status, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 通知阅读状态（每用户）
  `CREATE TABLE IF NOT EXISTS notification_reads (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    notification_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    tenant_id BIGINT NOT NULL,
    read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_nr_notif_user (notification_id, user_id),
    INDEX idx_nr_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 平台同步任务记录（P2 用）
  `CREATE TABLE IF NOT EXISTS sync_jobs (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    shop_id BIGINT NOT NULL,
    platform VARCHAR(30) NOT NULL,
    job_type VARCHAR(20) NOT NULL DEFAULT 'orders',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    imported INT NOT NULL DEFAULT 0,
    skipped INT NOT NULL DEFAULT 0,
    message TEXT,
    started_at DATETIME DEFAULT NULL,
    finished_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sj_tenant_shop (tenant_id, shop_id, created_at),
    INDEX idx_sj_status (status, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

(async () => {
  const conn = await mysql.createConnection(config.db);
  for (const sql of STMTS) {
    const [tbl] = sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/i) || [];
    await conn.query(sql);
    console.log('[OK]', tbl || sql.slice(0, 60));
  }
  // 索引补丁：inventory 表加 updated_at 已有，确保 products/inventory 索引存在
  await conn.query("CREATE INDEX IF NOT EXISTS idx_inv_tenant_product ON inventory (tenant_id, product_id)").catch(() => {});
  await conn.end();
  console.log('\n[migrate-v2] 完成');
})().catch(e => { console.error('迁移失败:', e.message); process.exit(1); });
