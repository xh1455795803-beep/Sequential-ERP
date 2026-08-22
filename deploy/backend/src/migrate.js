// 数据库迁移：幂等建表（重复执行安全）
const { pool } = require('./db');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS tenants (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    plan VARCHAR(20) NOT NULL DEFAULT 'trial',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    expire_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'owner',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_users_tenant (tenant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS shops (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    platform VARCHAR(30) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shops_tenant (tenant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS products (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    sku VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50) DEFAULT NULL,
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_products_tenant_sku (tenant_id, sku)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS inventory (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    warehouse VARCHAR(50) NOT NULL DEFAULT 'MAIN',
    qty_on_hand INT NOT NULL DEFAULT 0,
    qty_reserved INT NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_inventory (tenant_id, product_id, warehouse)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    order_no VARCHAR(32) NOT NULL,
    shop_id BIGINT DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    buyer_name VARCHAR(100) DEFAULT NULL,
    country VARCHAR(10) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_orders_tenant_no (tenant_id, order_no),
    INDEX idx_orders_tenant_status (tenant_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    qty INT NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,
    INDEX idx_order_items_order (order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ===== P3/P4 扩展：物流 / 采购 / 财务 =====

  `CREATE TABLE IF NOT EXISTS carriers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(30) DEFAULT NULL,
    tracking_url VARCHAR(255) DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_carriers_tenant (tenant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS shipments (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    carrier_id BIGINT DEFAULT NULL,
    tracking_no VARCHAR(64) DEFAULT NULL,
    shipping_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_shipments_order (tenant_id, order_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS suppliers (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    name VARCHAR(100) NOT NULL,
    contact VARCHAR(50) DEFAULT NULL,
    phone VARCHAR(30) DEFAULT NULL,
    remark VARCHAR(255) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_suppliers_tenant (tenant_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS purchases (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    purchase_no VARCHAR(32) NOT NULL,
    supplier_id BIGINT DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    remark VARCHAR(255) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_purchases_tenant_no (tenant_id, purchase_no),
    INDEX idx_purchases_tenant_status (tenant_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS purchase_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    purchase_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    qty INT NOT NULL,
    unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
    INDEX idx_purchase_items_purchase (purchase_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ===== P5：平台 OAuth 授权 =====

  // 运营商级开发者应用配置（全局，加密存储密钥）
  `CREATE TABLE IF NOT EXISTS platform_apps (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    platform VARCHAR(30) NOT NULL UNIQUE,
    app_id VARCHAR(120) NOT NULL,
    client_id VARCHAR(120) DEFAULT NULL,
    app_secret_enc VARCHAR(512) NOT NULL,
    extra_json TEXT DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // OAuth state（防 CSRF，10 分钟有效）
  `CREATE TABLE IF NOT EXISTS oauth_states (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    state VARCHAR(64) NOT NULL UNIQUE,
    platform VARCHAR(30) NOT NULL,
    tenant_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_oauth_states_exp (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 授权同步日志
  `CREATE TABLE IF NOT EXISTS sync_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    shop_id BIGINT NOT NULL,
    type VARCHAR(20) NOT NULL DEFAULT 'orders',
    status VARCHAR(20) NOT NULL,
    message VARCHAR(500) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sync_logs_shop (tenant_id, shop_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ===== P6：多币种汇率（1 外币 = ? CNY）=====
  `CREATE TABLE IF NOT EXISTS exchange_rates (
    code VARCHAR(8) PRIMARY KEY,
    rate DECIMAL(12,6) NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ===== P6：物流轨迹事件（订阅拉取后落库）=====
  `CREATE TABLE IF NOT EXISTS shipment_events (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    shipment_id BIGINT NOT NULL,
    status VARCHAR(50) DEFAULT NULL COMMENT '轨迹节点状态',
    description VARCHAR(255) DEFAULT NULL,
    location VARCHAR(120) DEFAULT NULL,
    occurred_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shipment_events (tenant_id, shipment_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

// 已有表的结构升级（幂等：先检查列是否存在）
const UPGRADES = [
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='shops' AND COLUMN_NAME='commission_rate'",
    ddl: "ALTER TABLE shops ADD COLUMN commission_rate DECIMAL(5,4) NOT NULL DEFAULT 0 COMMENT '平台佣金率(0-1)'"
  },
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='shops' AND COLUMN_NAME='auth_status'",
    ddl: `ALTER TABLE shops ADD COLUMN auth_status VARCHAR(20) NOT NULL DEFAULT 'manual' COMMENT 'manual未授权/authorized已授权/expired已过期',
      ADD COLUMN ext_shop_id VARCHAR(120) DEFAULT NULL COMMENT '平台侧店铺ID',
      ADD COLUMN ext_shop_name VARCHAR(200) DEFAULT NULL COMMENT '平台侧店铺名',
      ADD COLUMN access_token_enc VARCHAR(1024) DEFAULT NULL COMMENT '访问令牌(加密)',
      ADD COLUMN refresh_token_enc VARCHAR(1024) DEFAULT NULL COMMENT '刷新令牌(加密)',
      ADD COLUMN token_expires_at DATETIME DEFAULT NULL COMMENT '令牌到期时间',
      ADD COLUMN authorized_at DATETIME DEFAULT NULL COMMENT '最近授权时间',
      ADD COLUMN last_sync_at DATETIME DEFAULT NULL COMMENT '最近同步时间'`
  },
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='shops' AND COLUMN_NAME='api_key_enc'",
    ddl: `ALTER TABLE shops ADD COLUMN api_key_enc VARCHAR(1024) DEFAULT NULL COMMENT 'API密钥(加密,密钥型平台)',
      ADD COLUMN api_secret_enc VARCHAR(1024) DEFAULT NULL COMMENT 'API第二密钥(加密)'`
  },
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='oauth_states' AND COLUMN_NAME='code_verifier'",
    ddl: "ALTER TABLE oauth_states ADD COLUMN code_verifier VARCHAR(128) DEFAULT NULL COMMENT 'PKCE verifier(Etsy)'"
  },
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='shops' AND COLUMN_NAME='currency'",
    ddl: "ALTER TABLE shops ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'CNY' COMMENT '店铺结算币种'"
  },
  {
    check: "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='currency'",
    ddl: `ALTER TABLE orders ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'CNY' COMMENT '订单币种',
      ADD COLUMN exchange_rate DECIMAL(12,6) NOT NULL DEFAULT 1 COMMENT '下单时汇率(币种→CNY)'`
  }
];

// 汇率种子数据（1 外币 ≈ X CNY，运营商可在财务-汇率管理中维护）
const RATE_SEEDS = [
  ['CNY', 1], ['USD', 7.24], ['EUR', 7.86], ['GBP', 9.18], ['JPY', 0.0485], ['KRW', 0.0052],
  ['SGD', 5.42], ['MYR', 1.55], ['THB', 0.205], ['VND', 0.00028], ['IDR', 0.00044], ['PHP', 0.127],
  ['TWD', 0.226], ['BRL', 1.32], ['MXN', 0.372], ['RUB', 0.0805], ['PLN', 1.93], ['AUD', 4.72],
  ['CAD', 5.28], ['INR', 0.086], ['HKD', 0.93], ['MOP', 0.9], ['TRY', 0.21], ['AED', 1.97],
  ['SAR', 1.93], ['ILS', 1.96], ['NGN', 0.0044], ['ZAR', 0.39], ['SEK', 0.68], ['NOK', 0.67],
  ['DKK', 1.05], ['CHF', 8.2], ['NZD', 4.35]
];

(async () => {
  try {
    for (const ddl of SCHEMA) {
      await pool.query(ddl);
    }
    for (const up of UPGRADES) {
      const [rows] = await pool.query(up.check);
      if (!rows[0].c) {
        await pool.query(up.ddl);
        console.log('结构升级:', up.ddl.slice(0, 60) + '...');
      }
    }
    // 汇率种子（幂等）
    for (const [code, rate] of RATE_SEEDS) {
      await pool.query('INSERT IGNORE INTO exchange_rates (code, rate) VALUES (?, ?)', [code, rate]);
    }
    const [tables] = await pool.query('SHOW TABLES');
    console.log(`迁移完成，共 ${tables.length} 张表:`);
    tables.forEach(t => console.log(' -', Object.values(t)[0]));
    process.exit(0);
  } catch (err) {
    console.error('迁移失败:', err.message);
    process.exit(1);
  }
})();
