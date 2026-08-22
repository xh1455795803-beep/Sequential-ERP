// migrate-v3: P2 多平台适配器扩展 sync_logs 表（幂等）
const { pool } = require('./db');

const UPGRADES = [
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sync_logs' AND COLUMN_NAME='platform'",
    ddl: "ALTER TABLE sync_logs ADD COLUMN platform VARCHAR(30) DEFAULT NULL COMMENT '平台名' AFTER shop_id"
  },
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sync_logs' AND COLUMN_NAME='imported'",
    ddl: "ALTER TABLE sync_logs ADD COLUMN imported INT NOT NULL DEFAULT 0 COMMENT '本轮导入数' AFTER type"
  },
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sync_logs' AND COLUMN_NAME='skipped'",
    ddl: "ALTER TABLE sync_logs ADD COLUMN skipped INT NOT NULL DEFAULT 0 COMMENT '本轮跳过数' AFTER imported"
  },
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sync_logs' AND COLUMN_NAME='finished_at'",
    ddl: "ALTER TABLE sync_logs ADD COLUMN finished_at DATETIME DEFAULT NULL COMMENT '完成时间' AFTER created_at"
  },
  // 把 sync_logs.type 重命名为 job_type（MariaDB 兼容：保留列改名）
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sync_logs' AND COLUMN_NAME='job_type'",
    ddl: "ALTER TABLE sync_logs CHANGE COLUMN `type` `job_type` VARCHAR(20) NOT NULL DEFAULT 'orders' COMMENT '任务类型 orders/products'"
  },
];

(async () => {
  try {
    for (const up of UPGRADES) {
      const [rows] = await pool.query(up.check);
      if (!rows[0].c) {
        await pool.query(up.ddl);
        console.log('结构升级:', up.ddl.slice(0, 80).replace(/\s+/g, ' ') + '...');
      }
    }
    const [cols] = await pool.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sync_logs' ORDER BY ORDINAL_POSITION");
    console.log('sync_logs 当前列:', cols.map(c => c.COLUMN_NAME).join(', '));
    process.exit(0);
  } catch (err) {
    console.error('迁移失败:', err.message);
    process.exit(1);
  }
})();
