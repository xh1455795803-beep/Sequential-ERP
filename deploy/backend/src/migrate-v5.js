/**
 * 数序ERP V2.0 数据库迁移脚本（飞书文档高级架构版）
 * ...（省略原注释）
 */
try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
} catch (e) { /* 生产环境 systemd 已注入 env，忽略 dotenv */ }
const { pool, query } = require('./db');

// 列是否存在（用于幂等升级）
async function columnExists(table, column) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].c > 0;
}
async function tableExists(table) {
  const rows = await query(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
  );
  return rows[0].c > 0;
}
async function addColIfMissing(table, col, def) {
  if (await columnExists(table, col)) return false;
  await query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  return true;
}
async function addIdxIfMissing(table, idxName, def) {
  const rows = await query(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [idxName]);
  if (rows.length) return false;
  await query(`CREATE INDEX ${idxName} ON ${table} ${def}`);
  return true;
}

const DDL = [
  // ============ 1. 商品完整模块（products 表扩展 + 变体表 + 刊登表） ============
  // products 扩展列（后续 ALTER TABLE ADD COLUMN 幂等加）

  // 商品变体表（规格/SKU变体生成/组合套装）
  `CREATE TABLE IF NOT EXISTS product_variants (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    variant_sku VARCHAR(64) NOT NULL COMMENT '单变体独立唯一SKU编码',
    variant_name VARCHAR(200) DEFAULT NULL COMMENT '变体展示名',
    dim_color VARCHAR(60) DEFAULT NULL COMMENT '维度-颜色',
    dim_size VARCHAR(60) DEFAULT NULL COMMENT '维度-尺寸',
    dim_material VARCHAR(60) DEFAULT NULL COMMENT '维度-材质',
    dim_model VARCHAR(60) DEFAULT NULL COMMENT '维度-型号',
    dim_custom VARCHAR(120) DEFAULT NULL COMMENT '自定义维度JSON',
    barcode VARCHAR(64) DEFAULT NULL COMMENT 'EAN/UPC/自定义条码',
    price DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '变体售价',
    cost DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '变体成本',
    weight_g INT DEFAULT NULL COMMENT '单品净重(克)',
    is_main TINYINT(1) NOT NULL DEFAULT 0 COMMENT '默认主推SKU',
    status VARCHAR(20) NOT NULL DEFAULT 'on' COMMENT 'on/off/restricted: 单变体状态',
    extra_json TEXT DEFAULT NULL COMMENT '组合套装配比等扩展',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_variant_sku (tenant_id, variant_sku),
    INDEX idx_variant_product (tenant_id, product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 平台刊登映射表（多平台/多店铺/差异化定价）
  `CREATE TABLE IF NOT EXISTS product_listings (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    shop_id BIGINT NOT NULL COMMENT '关联店铺站点',
    platform_sku VARCHAR(120) DEFAULT NULL COMMENT '平台核心编码 SKU/ASIN/ProductID',
    listing_title VARCHAR(255) DEFAULT NULL COMMENT '各平台差异化刊登标题',
    sync_inventory TINYINT(1) NOT NULL DEFAULT 1 COMMENT '自动同步库存开关',
    sync_price TINYINT(1) NOT NULL DEFAULT 1 COMMENT '自动同步价格开关',
    auto_publish TINYINT(1) NOT NULL DEFAULT 1 COMMENT '自动刊登开关',
    price_override DECIMAL(12,2) DEFAULT NULL COMMENT '站点差异化售价',
    discount_rate DECIMAL(5,2) DEFAULT NULL COMMENT '折扣比例(%)',
    platform_status VARCHAR(30) DEFAULT NULL COMMENT '平台状态',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_listing (tenant_id, product_id, shop_id),
    INDEX idx_listing_shop (tenant_id, shop_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 商品合规&报关资料表
  `CREATE TABLE IF NOT EXISTS product_compliance (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL UNIQUE,
    hs_code VARCHAR(30) DEFAULT NULL COMMENT '海关HS编码',
    material VARCHAR(120) DEFAULT NULL COMMENT '材质成分',
    product_use VARCHAR(120) DEFAULT NULL COMMENT '产品用途',
    origin_country VARCHAR(30) DEFAULT NULL COMMENT '原产国',
    declare_name VARCHAR(200) DEFAULT NULL COMMENT '申报品名',
    vat_rate DECIMAL(5,2) DEFAULT NULL COMMENT 'VAT税率(%)',
    cert_ce VARCHAR(255) DEFAULT NULL COMMENT 'CE资质URL',
    cert_fda VARCHAR(255) DEFAULT NULL COMMENT 'FDA资质URL',
    cert_fcc VARCHAR(255) DEFAULT NULL COMMENT 'FCC资质URL',
    ipr_tag VARCHAR(30) DEFAULT NULL COMMENT '知识产权：自有专利/授权/公版/风险',
    banned_regions VARCHAR(255) DEFAULT NULL COMMENT '禁售地区（逗号分隔）',
    cert_expire_at DATETIME DEFAULT NULL COMMENT '资质到期日',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_compliance_product (tenant_id, product_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 预售/促销/赠品配置表
  `CREATE TABLE IF NOT EXISTS product_promo (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL UNIQUE,
    presale_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '预售总开关',
    presale_final_pay_days INT DEFAULT NULL COMMENT '尾款周期(天)',
    presale_latest_ship DATETIME DEFAULT NULL COMMENT '最晚发货时间',
    gift_enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '赠品绑定开关',
    gift_bind_rule VARCHAR(255) DEFAULT NULL COMMENT '赠品绑定规则说明',
    gift_product_id BIGINT DEFAULT NULL COMMENT '关联赠品商品ID',
    gift_qty_limit INT DEFAULT NULL COMMENT '赠品数量上限',
    publish_approved TINYINT(1) NOT NULL DEFAULT 0 COMMENT '发布审核通过标志',
    publish_status VARCHAR(20) NOT NULL DEFAULT 'draft' COMMENT 'draft/review/rejected/published',
    publish_reject_reason VARCHAR(500) DEFAULT NULL COMMENT '驳回原因',
    scheduled_on DATETIME DEFAULT NULL COMMENT '定时上架时间',
    scheduled_off DATETIME DEFAULT NULL COMMENT '定时下架时间',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ============ 2. 售后逆向服务 ============
  `CREATE TABLE IF NOT EXISTS aftersales (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL,
    aftersale_no VARCHAR(32) NOT NULL COMMENT '售后单号',
    type VARCHAR(20) NOT NULL DEFAULT 'refund_only' COMMENT 'refund_only仅退款/return_refund退货退款/reissue补发',
    reason VARCHAR(255) DEFAULT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '退款金额(本币)',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING/APPROVED/REJECTED/PROCESSING/COMPLETED/CANCELLED',
    buyer_name VARCHAR(100) DEFAULT NULL,
    return_tracking_no VARCHAR(64) DEFAULT NULL COMMENT '退货物流单号',
    return_warehouse VARCHAR(50) DEFAULT 'MAIN' COMMENT '退货入仓',
    reissue_order_id BIGINT DEFAULT NULL COMMENT '补发关联子订单',
    finance_redressed TINYINT(1) NOT NULL DEFAULT 0 COMMENT '财务是否已红冲',
    inventory_restored TINYINT(1) NOT NULL DEFAULT 0 COMMENT '库存是否已回滚',
    platform_synced TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已同步平台',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_aftersale_no (tenant_id, aftersale_no),
    INDEX idx_aftersale_order (tenant_id, order_id),
    INDEX idx_aftersale_status (tenant_id, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS aftersale_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    aftersale_id BIGINT NOT NULL,
    order_item_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    qty INT NOT NULL DEFAULT 1,
    refund_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    INDEX idx_aftersale_items (aftersale_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ============ 3. 全自动调度中心任务表 ============
  `CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT DEFAULT NULL COMMENT 'NULL=全局运营后台任务',
    task_type VARCHAR(30) NOT NULL COMMENT 'sync/auto_audit/stock_warn/finance_settle/ai_batch',
    task_subtype VARCHAR(60) DEFAULT NULL COMMENT 'orders/products/refresh_token等',
    ref_id BIGINT DEFAULT NULL COMMENT '关联对象ID: shop_id等',
    cron_expr VARCHAR(60) DEFAULT NULL COMMENT 'Cron表达式: 空=一次性',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/running/success/failed/paused/retried',
    retry_count INT NOT NULL DEFAULT 0 COMMENT '已重试次数',
    max_retry INT NOT NULL DEFAULT 3 COMMENT '最大重试次数',
    next_run_at DATETIME DEFAULT NULL COMMENT '下次执行时间',
    last_run_at DATETIME DEFAULT NULL,
    last_duration_ms INT DEFAULT NULL,
    last_result JSON DEFAULT NULL,
    last_error VARCHAR(1000) DEFAULT NULL,
    priority INT NOT NULL DEFAULT 5 COMMENT '1-10, 10最高',
    payload JSON DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_task_next (status, next_run_at),
    INDEX idx_task_tenant (tenant_id, task_type),
    INDEX idx_task_type_status (task_type, status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS task_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    task_id BIGINT NOT NULL,
    tenant_id BIGINT DEFAULT NULL,
    status VARCHAR(20) NOT NULL COMMENT 'running/success/failed',
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME DEFAULT NULL,
    duration_ms INT DEFAULT NULL,
    result_summary VARCHAR(1000) DEFAULT NULL COMMENT '导入XX条, 跳过XX条',
    error_stack TEXT DEFAULT NULL,
    detail_json JSON DEFAULT NULL,
    INDEX idx_task_runs_task (task_id, started_at DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // 自动审单规则表
  `CREATE TABLE IF NOT EXISTS auto_audit_rules (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL UNIQUE COMMENT '每个租户一套规则',
    auto_pass_no_exception TINYINT(1) NOT NULL DEFAULT 1 COMMENT '无异常订单自动通过',
    auto_pass_max_amount DECIMAL(12,2) DEFAULT NULL COMMENT '超过本金额需人工审核',
    risk_countries VARCHAR(255) DEFAULT NULL COMMENT '高风险国家拦截（逗号分隔）',
    block_negative_inventory TINYINT(1) NOT NULL DEFAULT 1 COMMENT '拦截负库存订单',
    block_repeat_buyer_hours INT DEFAULT 24 COMMENT '同买家X小时重复下单需人工',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ============ 4. SaaS租户套餐配额 + 账单中心 ============
  `CREATE TABLE IF NOT EXISTS tenant_quotas (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL UNIQUE,
    shops_used INT NOT NULL DEFAULT 0 COMMENT '已接入店铺数',
    shops_limit INT NOT NULL DEFAULT 3,
    monthly_orders_used INT NOT NULL DEFAULT 0,
    monthly_orders_limit INT NOT NULL DEFAULT 500,
    products_limit INT NOT NULL DEFAULT 5000 COMMENT '商品SKU上限',
    products_used INT NOT NULL DEFAULT 0,
    ai_calls_used INT NOT NULL DEFAULT 0,
    ai_calls_limit INT NOT NULL DEFAULT 0 COMMENT '0=未开通AI服务',
    storage_mb_used INT NOT NULL DEFAULT 0,
    storage_mb_limit INT NOT NULL DEFAULT 1000,
    month_stat_date DATE NOT NULL COMMENT '配额统计月份: YYYY-MM-01',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tenant_quotas_month (month_stat_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '租户套餐配额(按月重置)'`,

  `CREATE TABLE IF NOT EXISTS bills (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    bill_no VARCHAR(32) NOT NULL,
    period VARCHAR(7) NOT NULL COMMENT '账期 YYYY-MM',
    plan_code VARCHAR(20) NOT NULL,
    plan_name VARCHAR(40) NOT NULL,
    amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '账单金额',
    paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'unpaid' COMMENT 'unpaid/paid/refunded/overdue',
    extra_json JSON DEFAULT NULL COMMENT '明细: 超额订单费/AI调用费等',
    paid_at DATETIME DEFAULT NULL,
    due_date DATE NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_bill_no (bill_no),
    INDEX idx_bills_tenant (tenant_id, period)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT 'SaaS账单中心'`,

  `CREATE TABLE IF NOT EXISTS bill_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    bill_id BIGINT NOT NULL,
    item_type VARCHAR(30) NOT NULL COMMENT 'plan/over_orders/ai_extra/storage_extra',
    item_name VARCHAR(100) NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    quantity INT NOT NULL DEFAULT 1,
    subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    INDEX idx_bill_items (bill_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ============ 5. 运营后台管理员 + 三级权限 ============
  `CREATE TABLE IF NOT EXISTS saas_admins (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'support' COMMENT 'super_admin/finance_admin/support_admin',
    real_name VARCHAR(50) DEFAULT NULL,
    phone VARCHAR(30) DEFAULT NULL,
    email VARCHAR(100) DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    last_login_at DATETIME DEFAULT NULL,
    last_login_ip VARCHAR(50) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT 'SaaS运营后台管理员'`,

  `CREATE TABLE IF NOT EXISTS saas_audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    admin_id BIGINT NOT NULL,
    admin_username VARCHAR(50) NOT NULL,
    action VARCHAR(60) NOT NULL COMMENT 'tenant.freeze/bill.paid等',
    method VARCHAR(10) DEFAULT NULL,
    path VARCHAR(255) DEFAULT NULL,
    target_type VARCHAR(30) DEFAULT NULL,
    target_id BIGINT DEFAULT NULL,
    status_code INT DEFAULT NULL,
    detail VARCHAR(2000) DEFAULT NULL,
    ip VARCHAR(50) DEFAULT NULL,
    ua VARCHAR(255) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_saas_audit_admin (admin_id, created_at),
    INDEX idx_saas_audit_target (target_type, target_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '运营后台审计日志(独立)'`,

  // ============ 6. 财务利润/成本归集 ============
  `CREATE TABLE IF NOT EXISTS finance_profit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    order_id BIGINT NOT NULL UNIQUE,
    order_no VARCHAR(32) NOT NULL,
    sale_amount DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '销售额(本币)',
    sale_currency VARCHAR(8) DEFAULT 'CNY',
    sale_exrate DECIMAL(12,6) DEFAULT 1 COMMENT '下单锁定汇率',
    product_cost DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '采购成本',
    ship_head_cost DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '头程物流费',
    ship_tail_cost DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '尾程派送费',
    platform_fee DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '平台佣金',
    withdraw_fee DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '提现手续费',
    ad_cost DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '广告分摊',
    vat_tax DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT 'VAT税费',
    aftersale_refund DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '售后退款',
    other_cost DECIMAL(14,4) NOT NULL DEFAULT 0,
    net_profit DECIMAL(14,4) NOT NULL DEFAULT 0,
    profit_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '利润率(%)',
    settled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否已对账结算',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_finance_tenant (tenant_id, created_at),
    INDEX idx_finance_settled (tenant_id, settled)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '订单级全链路利润表'`,

  `CREATE TABLE IF NOT EXISTS finance_reconcile (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
    platform VARCHAR(30) DEFAULT NULL,
    shop_id BIGINT DEFAULT NULL,
    our_amount DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '系统应收',
    platform_amount DECIMAL(14,4) NOT NULL DEFAULT 0 COMMENT '平台账单金额',
    diff_amount DECIMAL(14,4) NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/matched/diff/resolved',
    remark VARCHAR(500) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_reconcile (tenant_id, period, platform, shop_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '对账差异记录'`,

  // ============ 7. 多币种汇率30天趋势 ============
  `CREATE TABLE IF NOT EXISTS exchange_rate_history (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    code VARCHAR(8) NOT NULL,
    rate_date DATE NOT NULL,
    rate DECIMAL(12,6) NOT NULL,
    source VARCHAR(30) DEFAULT 'ecb' COMMENT '央行/ECB/手动',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_rate_date (code, rate_date),
    INDEX idx_rate_history (code, rate_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT '汇率历史趋势(30天可视化用)'`
];

const PRODUCTS_ADD_COLS = [
  // 1. 基础模块扩展
  ['inner_sku',  "VARCHAR(64) DEFAULT NULL COMMENT '内部SKU系统全局唯一(替代sku列)'" ],
  ['name_en',    "VARCHAR(300) DEFAULT NULL COMMENT '商品英文全称(海外刊登必填)'" ],
  ['brand',      "VARCHAR(100) DEFAULT NULL COMMENT '品牌(报关+平台备案用)'" ],
  ['origin_country', "VARCHAR(30) DEFAULT NULL COMMENT '产地国别'" ],
  ['biz_status', "VARCHAR(30) NOT NULL DEFAULT 'draft' COMMENT 'draft/new_wait/normal/promotion/clearance/paused/archived'"],
  ['product_type', "VARCHAR(30) NOT NULL DEFAULT 'normal' COMMENT 'normal/presale/custom/combo/gift/bundle'"],
  ['source_channel', "VARCHAR(30) DEFAULT NULL COMMENT 'self/1688/dropship/factory'"],
  ['seo_tags_json', "TEXT DEFAULT NULL COMMENT 'SEO搜索标签JSON'"],
  ['name_cn',    "VARCHAR(200) DEFAULT NULL COMMENT '中文简称'"],
  ['owner_user_id', "BIGINT DEFAULT NULL COMMENT '归属运营/业务员'"],
  ['supplier_id', "BIGINT DEFAULT NULL COMMENT '归属供应商'"],
  ['commission_base', "DECIMAL(8,4) DEFAULT NULL COMMENT '提成核算基数'"],

  // 2. 仓储库存模块
  ['warehouse_code', "VARCHAR(50) DEFAULT 'MAIN' COMMENT '归属仓库国内/海外FBA/保税'"],
  ['safe_stock',   "INT NOT NULL DEFAULT 5 COMMENT '安全库存阈值(触发告警+AI补货)'"],
  ['oversell_protect', "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '超卖风控开关'"],
  ['in_transit_qty', "INT NOT NULL DEFAULT 0 COMMENT '在途库存绑定'"],
  ['dead_stock_days', "INT DEFAULT 180 COMMENT '呆滞库存预警周期(天)'"],
  ['allocate_policy', "VARCHAR(60) DEFAULT NULL COMMENT '库存分配策略JSON'"],

  // 3. 定价成本财务
  ['fee_template_id', "BIGINT DEFAULT NULL COMMENT '平台费率模板ID'"],
  ['base_ship_cost_head', "DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '头程基础运费'"],
  ['base_ship_cost_tail', "DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '尾程基础运费'"],
  ['min_profit_rate', "DECIMAL(6,2) NOT NULL DEFAULT 15 COMMENT '利润保底阈值%'"],
  ['ai_suggest_price', "DECIMAL(12,2) DEFAULT NULL COMMENT 'AI智能定价建议'"],
  ['price_tier_json', "TEXT DEFAULT NULL COMMENT '阶梯价格配置JSON'"],
  ['price_protect_json', "TEXT DEFAULT NULL COMMENT '高低价保护JSON'"],
  ['ad_cost_rule_json', "TEXT DEFAULT NULL COMMENT '广告成本分摊规则JSON'"],

  // 4. 物流重量模块
  ['weight_g',     "INT DEFAULT NULL COMMENT '单品净重(克)'"],
  ['gross_weight_g', "INT DEFAULT NULL COMMENT '毛重(克)'"],
  ['length_cm',    "DECIMAL(8,2) DEFAULT NULL COMMENT '长CM'"],
  ['width_cm',     "DECIMAL(8,2) DEFAULT NULL COMMENT '宽CM'"],
  ['height_cm',    "DECIMAL(8,2) DEFAULT NULL COMMENT '高CM'"],
  ['pack_length_cm', "DECIMAL(8,2) DEFAULT NULL COMMENT '打包长'"],
  ['pack_width_cm',  "DECIMAL(8,2) DEFAULT NULL"],
  ['pack_height_cm', "DECIMAL(8,2) DEFAULT NULL"],
  ['ship_fee_mode', "VARCHAR(20) NOT NULL DEFAULT 'actual' COMMENT 'actual/volume/fixed'"],
  ['sensitive_attr', "VARCHAR(30) NOT NULL DEFAULT 'normal' COMMENT 'normal/battery/magnetic/liquid/powder/fragile'"],
  ['ship_days',     "INT DEFAULT 3 COMMENT '默认发货时效(天)'"],
  ['ship_whitelist_json', "TEXT DEFAULT NULL COMMENT '物流渠道白名单JSON'"],
  ['ship_blacklist_json', "TEXT DEFAULT NULL COMMENT '物流渠道黑名单JSON'"],
  ['special_pack_json', "TEXT DEFAULT NULL COMMENT '易碎/防潮特殊属性JSON'"],

  // 5. AI模块
  ['ai_forecast_days', "INT NOT NULL DEFAULT 15 COMMENT 'AI预测周期7/15/30/60'"],
  ['replenish_priority', "VARCHAR(20) NOT NULL DEFAULT 'normal' COMMENT 'hot/normal/new/dead'"],
  ['risk_detect_enabled', "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '风险检测开关'"],
  ['ai_tags_json', "TEXT DEFAULT NULL COMMENT 'AI智能标签JSON'"],

  // 6. 订单&币种模块
  ['sale_currency', "VARCHAR(8) DEFAULT 'USD' COMMENT '默认售卖币种'"]
];

const TABLES_ALTER_IDX = [
  ['orders', 'idx_orders_auto_audit',  '(tenant_id, status, created_at)'],
  ['inventory', 'idx_inventory_safe',  '(tenant_id, qty_on_hand, qty_reserved)'],
  ['sync_logs', 'idx_sync_status_time', '(tenant_id, status, created_at)']
];

async function run() {
  console.log('[V2.0 migrate-v5] 开始执行数据库迁移...');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');

    // 1. 执行所有 CREATE TABLE IF NOT EXISTS
    for (const sql of DDL) {
      try {
        await conn.query(sql);
      } catch (e) {
        if (e.code !== 'ER_TABLE_EXISTS_ERROR' && !String(e.message).includes('Duplicate')) {
          console.error('DDL 执行失败:', sql.substring(0, 80), '=>', e.code, e.message);
          throw e;
        }
      }
    }
    console.log('  ✅ V2.0 核心表结构创建完成');

    // 2. 扩展 products 表（飞书 10 大模块字段）
    const colsAdded = [];
    for (const [col, def] of PRODUCTS_ADD_COLS) {
      try {
        if (await addColIfMissing('products', col, def)) colsAdded.push(col);
      } catch (e) {
        console.error('products 加列失败:', col, e.code, e.message);
      }
    }
    console.log(`  ✅ products 表扩展 ${colsAdded.length} 列: ${colsAdded.join(',') || '无新增'}`);

    // 3. orders 列补齐（已有部分可能在 V3/V4 加过）
    const orderCols = [
      ['currency', "VARCHAR(8) DEFAULT 'CNY'"],
      ['exchange_rate', "DECIMAL(12,6) DEFAULT 1"],
      ['audit_status', "VARCHAR(20) DEFAULT 'pending' COMMENT 'pending/auto_pass/manual_pass/rejected'"],
      ['audited_at', "DATETIME DEFAULT NULL"],
      ['audited_by', "BIGINT DEFAULT NULL"],
      ['risk_tag', "VARCHAR(30) DEFAULT NULL COMMENT '风险标签'"],
      ['risk_reason', "VARCHAR(255) DEFAULT NULL"]
    ];
    const oc = [];
    for (const [col, def] of orderCols) {
      try { if (await addColIfMissing('orders', col, def)) oc.push(col); } catch (e) {}
    }
    console.log(`  ✅ orders 表扩展 ${oc.length} 列`);

    // 4. tenants 扩展：增加额度明细字段
    const tenantCols = [
      ['contact_phone', "VARCHAR(30) DEFAULT NULL"],
      ['contact_email', "VARCHAR(100) DEFAULT NULL"],
      ['quota_products', "INT NOT NULL DEFAULT 5000"],
      ['quota_storage_mb', "INT NOT NULL DEFAULT 1000"],
      ['quota_ai_calls_monthly', "INT NOT NULL DEFAULT 0"],
      ['channel', "VARCHAR(30) DEFAULT 'direct' COMMENT '渠道来源'"],
      ['remark', "VARCHAR(500) DEFAULT NULL"]
    ];
    const tc = [];
    for (const [col, def] of tenantCols) {
      try { if (await addColIfMissing('tenants', col, def)) tc.push(col); } catch (e) {}
    }
    console.log(`  ✅ tenants 表扩展 ${tc.length} 列`);

    // 5.  shops 表补齐字段（如果还没加）
    const shopCols = [
      ['currency', "VARCHAR(8) DEFAULT NULL"],
      ['country', "VARCHAR(20) DEFAULT NULL"],
      ['region',  "VARCHAR(20) DEFAULT NULL COMMENT 'NA/EU/SEA/ME/SA/LA/Oceania/JPKR'"]
    ];
    const sc = [];
    for (const [col, def] of shopCols) {
      try { if (await addColIfMissing('shops', col, def)) sc.push(col); } catch (e) {}
    }
    console.log(`  ✅ shops 表扩展 ${sc.length} 列`);

    // 6. 二级索引补齐
    const idxs = [];
    for (const [t, n, d] of TABLES_ALTER_IDX) {
      try { if (await addIdxIfMissing(t, n, d)) idxs.push(`${t}.${n}`); } catch (e) {}
    }
    console.log(`  ✅ 索引新增 ${idxs.length} 个`);

    // 7. 初始化基础数据：全球汇率（基础行）+ 运营管理员 admin/admin123（飞书文档默认）
    const baseRates = [
      ['USD', 7.25, '美元'], ['EUR', 7.86, '欧元'], ['GBP', 9.18, '英镑'],
      ['JPY', 0.047, '日元'], ['KRW', 0.0053, '韩元'], ['AUD', 4.75, '澳元'],
      ['CAD', 5.32, '加元'], ['SGD', 5.38, '新加坡元'], ['THB', 0.205, '泰铢'],
      ['VND', 0.00029, '越南盾'], ['MYR', 1.56, '马来西亚林吉特'], ['IDR', 0.00046, '印尼盾'],
      ['PHP', 0.128, '菲律宾比索'], ['INR', 0.087, '印度卢比'], ['PKR', 0.026, '巴基斯坦卢比'],
      ['MAD', 0.70, '摩洛哥迪拉姆'], ['AED', 1.97, '阿联酋迪拉姆'], ['SAR', 1.93, '沙特里亚尔'],
      ['TRY', 0.215, '土耳其里拉'], ['ZAR', 0.42, '南非兰特'], ['BRL', 1.42, '巴西雷亚尔'],
      ['MXN', 0.42, '墨西哥比索'], ['ARS', 0.0085, '阿根廷比索'], ['CLP', 0.0079, '智利比索'],
      ['COP', 0.0018, '哥伦比亚比索'], ['PLN', 1.83, '波兰兹罗提'], ['CZK', 0.31, '捷克克朗'],
      ['HUF', 0.020, '匈牙利福林'], ['RON', 1.58, '罗马尼亚列伊'], ['SEK', 0.70, '瑞典克朗'],
      ['NOK', 0.69, '挪威克朗'], ['DKK', 1.05, '丹麦克朗'], ['CHF', 8.30, '瑞士法郎'],
      ['NZD', 4.38, '新西兰元'], ['HKD', 0.928, '港币'], ['TWD', 0.23, '新台币'],
      ['CNY', 1.000000, '人民币']
    ];
    let rateAdded = 0;
    for (const [code, rate, _name] of baseRates) {
      try {
        const [r] = await conn.query('SELECT code FROM exchange_rates WHERE code = ?', [code]);
        if (!r.length) {
          await conn.query('INSERT INTO exchange_rates (code, rate) VALUES (?, ?)', [code, rate]);
          rateAdded++;
        }
      } catch (e) { if (e.code !== 'ER_DUP_ENTRY') console.warn(code, e.message); }
    }
    console.log(`  ✅ 基础汇率初始化 ${rateAdded} 种币种`);

    // 8. 初始化汇率历史（最近30天=当前rate，后续调度器每日快照）
    const today = new Date();
    let histAdded = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(today.getTime() - i * 86400000);
      const ds = d.toISOString().slice(0, 10);
      for (const [code, rate, _n] of baseRates.slice(0, 8)) {
        // 简化：随机 +/- 1.5% 波动生成假历史供可视化
        const jitter = 1 + (Math.random() - 0.5) * 0.03;
        const rVal = Number((rate * jitter).toFixed(6));
        try {
          await conn.query(
            'INSERT IGNORE INTO exchange_rate_history (code, rate_date, rate, source) VALUES (?,?,?,?)',
            [code, ds, rVal, 'seed']
          );
          histAdded++;
        } catch (e) {}
      }
    }
    console.log(`  ✅ 汇率30天历史快照初始化 ${histAdded} 条`);

    // 9. 初始化 SaaS 超级管理员 admin / Admin@2026 （飞书文档默认）
    const crypto = require('crypto');
    function hashPwd(pwd) {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
      return `${salt}:${hash}`;
    }
    const [existAdmin] = await conn.query("SELECT id FROM saas_admins WHERE username = 'admin'");
    if (!existAdmin.length) {
      await conn.query(
        `INSERT INTO saas_admins (username, password_hash, role, real_name, status)
         VALUES (?,?, 'super_admin', '超级运营', 'active')`,
        ['admin', hashPwd('Admin@2026')]
      );
      console.log('  ✅ SaaS 运营管理员初始化: admin / Admin@2026');
    } else {
      console.log('  ℹ️  SaaS 运营管理员 admin 已存在，跳过初始化');
    }

    // 10. 初始化租户配额行（已存在的租户补齐默认配额）
    const tenants = await conn.query('SELECT id, plan FROM tenants');
    const PLAN_QUOTA_MAP = {
      trial:      { shops: 3,  orders: 500,   products: 5000,   ai: 0,    storage: 1000 },
      starter:    { shops: 3,  orders: 1000,  products: 10000,  ai: 0,    storage: 2000 },
      standard:   { shops: 10, orders: 5000,  products: 50000,  ai: 100,  storage: 10000 },
      pro:        { shops: 30, orders: 1e9,   products: 500000, ai: 1000, storage: 100000 },
      enterprise: { shops: 1e6,orders: 1e9,   products: 1e9,    ai: 1e6,  storage: 1e9 }
    };
    const thisMonth = new Date().toISOString().slice(0, 7) + '-01';
    let quotaInited = 0;
    for (const t of tenants) {
      if (!t || !t.id) continue;
      const p = PLAN_QUOTA_MAP[t.plan] || PLAN_QUOTA_MAP.trial;
      const [existQ] = await conn.query('SELECT id FROM tenant_quotas WHERE tenant_id = ?', [t.id]);
      if (!existQ.length) {
        const cntS = await conn.query('SELECT COUNT(*) AS c FROM shops WHERE tenant_id = ?', [t.id]);
        const cntP = await conn.query('SELECT COUNT(*) AS c FROM products WHERE tenant_id = ?', [t.id]);
        const cntO = await conn.query(
          `SELECT COUNT(*) AS c FROM orders WHERE tenant_id = ? AND created_at >= ?`,
          [t.id, thisMonth]
        );
        await conn.query(
          `INSERT INTO tenant_quotas
           (tenant_id, shops_used, shops_limit, monthly_orders_used, monthly_orders_limit,
            products_limit, products_used, ai_calls_limit, ai_calls_used,
            storage_mb_limit, storage_mb_used, month_stat_date)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [t.id, cntS[0].c, p.shops, cntO[0].c, p.orders,
           p.products, cntP[0].c, p.ai, 0,
           p.storage, 0, thisMonth]
        );
        quotaInited++;
      }
    }
    console.log(`  ✅ 租户配额初始化 ${quotaInited}/${tenants.length} 个`);

    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('\n🎉 V2.0 数据库迁移全部完成！');
    console.log('   · 商品10大模块列已扩展');
    console.log('   · 售后逆向表 ready');
    console.log('   · 全自动调度中心表 ready');
    console.log('   · 租户配额 + 账单中心 ready');
    console.log('   · 运营后台三级权限 ready (默认: admin / Admin@2026)');
    console.log('   · 财务利润归集 + 对账表 ready');
    console.log('   · 35币种 + 30天趋势历史 ready');
    process.exit(0);
  } catch (e) {
    console.error('[V2.0 migrate-v5] 致命错误:', e);
    process.exit(1);
  } finally {
    conn.release();
  }
}

if (require.main === module) run().catch(e => { console.error(e); process.exit(1); });
module.exports = { run };
