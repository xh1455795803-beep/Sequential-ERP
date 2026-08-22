// 数序ERP 终版数据库迁移 V6：官网落地 + 订阅计费 + 素材资源（幂等 IF NOT EXISTS）
require('dotenv').config();
const { query } = require('./db');

const TABLES = [
  // 1. 官网动态配置：单条记录(admin维护)，保存 banner / 功能介绍 / 价格套餐 / 对比表 / 客服微信 / SEO
  `CREATE TABLE IF NOT EXISTS landing_configs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    site_name VARCHAR(120) NOT NULL DEFAULT '数序跨境ERP',
    banner_json TEXT NOT NULL COMMENT '官网首屏banner数组JSON: [{img,title,subTitle,btnText,btnLink}]',
    advantage_json TEXT NOT NULL COMMENT '产品核心优势数组JSON: [{icon,title,desc}]',
    features_json TEXT NOT NULL COMMENT '12大功能模块数组JSON: [{icon,title,desc,points[]}]',
    plans_json TEXT NOT NULL COMMENT '套餐价格数组JSON: [{name,price,period,tag,features[]}]',
    cases_json TEXT NOT NULL COMMENT '用户案例数组JSON: [{logo,industry,title,quote}]',
    compare_json TEXT NOT NULL COMMENT '对比表JSON: [{item,miaoshou,jushuitan,ours}]',
    apply_json TEXT NOT NULL COMMENT '体验申请字段配置JSON: {placeholder,btnText,note}',
    footer_json TEXT NOT NULL COMMENT '底部联系JSON: {copyright,icp,phone,email,wechatQr,address}',
    seo_json TEXT NOT NULL COMMENT 'SEO: {title,keywords,description}',
    updated_by BIGINT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='官网落地页全量动态配置'`,

  // 2. 官网体验申请：手机号+店铺类型
  `CREATE TABLE IF NOT EXISTS site_applications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    contact_name VARCHAR(80) DEFAULT NULL,
    mobile VARCHAR(32) NOT NULL,
    company VARCHAR(180) DEFAULT NULL,
    shop_platform VARCHAR(120) DEFAULT NULL COMMENT '店铺类型/主营平台',
    shop_url VARCHAR(300) DEFAULT NULL,
    monthly_volume VARCHAR(40) DEFAULT NULL COMMENT '月单量区间',
    region VARCHAR(60) DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/contacted/signed/lost',
    assign_to_admin_id BIGINT DEFAULT NULL,
    remark VARCHAR(800) DEFAULT NULL,
    source_utm VARCHAR(200) DEFAULT NULL,
    ip VARCHAR(64) DEFAULT NULL,
    user_agent VARCHAR(300) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_app_status (status),
    INDEX idx_app_mobile (mobile)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='官网体验申请/招商线索'`,

  // 3. 素材资源：图片统一管理（banner/商品/资质/售后凭证）
  `CREATE TABLE IF NOT EXISTS media_assets (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL DEFAULT 0 COMMENT '0=公共/运营后台',
    owner_user_id BIGINT DEFAULT NULL,
    category VARCHAR(40) NOT NULL DEFAULT 'general' COMMENT 'banner/product/cert/aftersale/general',
    original_name VARCHAR(200) DEFAULT NULL,
    stored_name VARCHAR(200) NOT NULL COMMENT '服务器磁盘/OSS文件名',
    stored_path VARCHAR(500) NOT NULL COMMENT '相对路径 /uploads/... 或 http URL',
    access_url VARCHAR(500) NOT NULL COMMENT '外部可访问URL',
    mime_type VARCHAR(80) DEFAULT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    width INT DEFAULT NULL,
    height INT DEFAULT NULL,
    ext_info_json TEXT DEFAULT NULL,
    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
    deleted_at DATETIME DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_media_tenant_cat (tenant_id, category),
    INDEX idx_media_access (access_url(255))
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='统一素材资源（图片）'`,

  // 4. 租户订阅（每个租户当前唯一生效）
  `CREATE TABLE IF NOT EXISTS tenant_subscriptions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL UNIQUE,
    plan_code VARCHAR(40) NOT NULL DEFAULT 'basic' COMMENT 'basic/standard/pro/enterprise',
    plan_name VARCHAR(60) NOT NULL DEFAULT '体验版',
    period_unit VARCHAR(10) NOT NULL DEFAULT 'month' COMMENT 'month/quarter/year',
    price DECIMAL(12,2) NOT NULL DEFAULT 0,
    start_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expire_at DATETIME NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT 'active/expired/frozen/cancelled',
    quotas_json TEXT NOT NULL COMMENT '快照配额：{shops, monthlyOrders, products, aiCalls, storageMB}',
    extras_json TEXT DEFAULT NULL COMMENT '扩容包详情',
    last_billing_order_id BIGINT DEFAULT NULL,
    frozen_reason VARCHAR(400) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_sub_status (status),
    INDEX idx_sub_expire (expire_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='租户当前订阅'`,

  // 5. 订阅/购买订单（支付流）
  `CREATE TABLE IF NOT EXISTS billing_orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    user_id BIGINT DEFAULT NULL,
    order_no VARCHAR(40) NOT NULL UNIQUE,
    order_type VARCHAR(30) NOT NULL DEFAULT 'subscribe' COMMENT 'subscribe/renewal/upgrade/addon',
    plan_code VARCHAR(40) NOT NULL,
    plan_name VARCHAR(60) NOT NULL,
    period_unit VARCHAR(10) NOT NULL DEFAULT 'month',
    period_count INT NOT NULL DEFAULT 1,
    addon_code VARCHAR(40) DEFAULT NULL,
    addon_count INT DEFAULT NULL,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    pay_channel VARCHAR(20) DEFAULT NULL COMMENT 'wechat/alipay/bank/transfer',
    pay_status VARCHAR(20) NOT NULL DEFAULT 'unpaid' COMMENT 'unpaid/paid/refunded/cancelled',
    paid_at DATETIME DEFAULT NULL,
    transaction_no VARCHAR(120) DEFAULT NULL,
    pay_proof_url VARCHAR(500) DEFAULT NULL,
    apply_status VARCHAR(20) DEFAULT NULL COMMENT 'transfer待审核：pending/approved/rejected',
    audit_by_admin_id BIGINT DEFAULT NULL,
    audit_at DATETIME DEFAULT NULL,
    audit_remark VARCHAR(500) DEFAULT NULL,
    invoice_status VARCHAR(20) NOT NULL DEFAULT 'none',
    remark VARCHAR(800) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_bill_tenant (tenant_id, created_at DESC),
    INDEX idx_bill_pay (pay_status, apply_status)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订阅/扩容支付订单'`,

  // 6. 续费/变更历史日志
  `CREATE TABLE IF NOT EXISTS billing_records (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,
    user_id BIGINT DEFAULT NULL,
    action VARCHAR(40) NOT NULL COMMENT 'subscribe/renewal/upgrade/downgrade/freeze/unfreeze/addon',
    before_plan_code VARCHAR(40) DEFAULT NULL,
    after_plan_code VARCHAR(40) DEFAULT NULL,
    before_expire_at DATETIME DEFAULT NULL,
    after_expire_at DATETIME DEFAULT NULL,
    quotas_snapshot TEXT DEFAULT NULL,
    amount DECIMAL(12,2) DEFAULT NULL,
    billing_order_id BIGINT DEFAULT NULL,
    operator_type VARCHAR(20) NOT NULL DEFAULT 'tenant' COMMENT 'tenant/admin/system',
    operator_id BIGINT DEFAULT NULL,
    remark VARCHAR(800) DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_rec_tenant (tenant_id, created_at DESC)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订阅变更流水日志'`,
];

// 7. 对已有表补终版必须列（power by alter 幂等忽略报错）
const ALTERS = [
  `ALTER TABLE tenants ADD COLUMN plan_code VARCHAR(40) DEFAULT NULL AFTER name`,
  `ALTER TABLE tenants ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER plan_code`,
  `ALTER TABLE tenants ADD COLUMN subscribe_expire_at DATETIME DEFAULT NULL AFTER status`,
  `ALTER TABLE users   ADD COLUMN avatar_url VARCHAR(500) DEFAULT NULL AFTER username`,
  `ALTER TABLE users   ADD COLUMN is_owner TINYINT(1) NOT NULL DEFAULT 0 AFTER role`,
];

(async () => {
  console.log('[migrate-v6-final] 开始...');
  for (const sql of TABLES) {
    try {
      await query(sql);
      const name = (sql.match(/CREATE TABLE IF NOT EXISTS (\w+)/) || [,'?'])[1];
      console.log('  ✅ 表', name);
    } catch (e) {
      console.log('  ❌ 建表失败:', e.message.slice(0, 120));
    }
  }
  console.log('[migrate-v6-final] 追加ALTER补列（报错=已存在，忽略）...');
  for (const sql of ALTERS) {
    try {
      await query(sql);
      console.log('  ✅', sql.slice(0, 70));
    } catch (e) {
      console.log('  ⚠️ 忽略:', e.message.slice(0, 80));
    }
  }

  // 给一条默认 landing 配置（当表空时），保证官网首屏不空白
  try {
    const [c] = await query('SELECT COUNT(*) c FROM landing_configs');
    if (!c || !c[0] || Number(c[0].c) === 0) {
      const def = {
        banner: [
          { img: '', title: '数序跨境ERP - 多平台订单 · 库存 · 财务 一体化全自动系统', subTitle: '覆盖全球70+电商平台、AI智能审单、多币种利润结算、SaaS多租户商用版', btnText: '免费体验14天', btnLink: '#apply' },
          { img: '', title: '从店铺授权到财务回款，全流程自动化闭环', subTitle: '告别Excel手工记账，一键同步所有平台订单/发货/库存/售后', btnText: '在线咨询', btnLink: '#contact' },
        ],
        advantage: [
          { icon: '🌐', title: '全球70+平台同步', desc: 'Amazon/Shopee/Walmart/TikTok Shop/Temu/OZON…一键对接，订单实时同步' },
          { icon: '🤖', title: 'AI智能自动审单', desc: '可疑订单自动拦截、批量审核、高危地址标记，人工仅处理1%异常' },
          { icon: '📦', title: '库存精准闭环', desc: '下单锁定/发货扣减/采购入库/盘点差异，10大维度实时库存流水' },
          { icon: '💰', title: '多币种利润中心', desc: '平台费/头程/尾程/广告/VAT全维度分摊，订单级精确利润+月度结算' },
          { icon: '🧠', title: 'AI决策大脑', desc: '销量预测、库存风险预警、订单欺诈识别，智能补货建议' },
        ],
        features: [
          { icon: '🏪', title: '店铺授权', desc: '70+平台可视化接入，OAuth/API密钥双模式，失效自动告警', points: ['密钥探活验证','60+占位适配器','防重复绑定'] },
          { icon: '🗂️', title: '商品完整模块', desc: '10大字段模块+变体SKU+多平台刊登+合规信息', points: ['10大字段模块','变体SKU','跨境合规'] },
          { icon: '📦', title: '订单管理', desc: '自动下载、合并发货、异常拦截、面单打印', points: ['多平台汇总','异常拦截','批量处理'] },
          { icon: '🔍', title: '自动审单', desc: '10+维度规则引擎，白名单+黑名单+待人工三级分类', points: ['规则配置','批量审核','通过率可视化'] },
          { icon: '↩️', title: '售后逆向', desc: '仅退款/退货退款/补发，资金自动回滚财务', points: ['三种类型','流程审批','财务联动'] },
          { icon: '🧾', title: '采购供应链', desc: '采购/供应商/物流商，在途可售自动计算', points: ['采购单','供应商','物流商'] },
          { icon: '💎', title: '库存流水', desc: '事务写入，每笔出入库可追溯到订单', points: ['实时台账','批次追溯','安全库存'] },
          { icon: '📈', title: '利润看板', desc: '订单级利润+店铺维度+日/周/月趋势', points: ['订单级明细','店铺维度','日周月趋势'] },
          { icon: '💱', title: '多币种汇率', desc: '6大区域+32币种实时汇率+30天趋势', points: ['32币种','30天趋势','波动预警'] },
          { icon: '🗓️', title: '全自动调度', desc: '订单/库存/财务/AI/汇率5类任务+失败重试', points: ['5种任务','失败重试','运行监控'] },
          { icon: '🥡', title: '套餐配额', desc: '按套餐管控店铺数/月订单/商品/AI调用', points: ['5维配额','每月重置','超限冻结'] },
          { icon: '🎛️', title: 'SaaS运营后台', desc: '租户生命周期+官网内容可视化+账单审计', points: ['租户生命周期','官网可视化','审计日志'] },
        ],
        plans: [
          { name: '基础版', price: 199, period: '每月', tag: '入门卖家', features: ['3个店铺绑定','每月500单','商品2000个','AI智能100次','客服工单响应'] },
          { name: '标准版', price: 599, period: '每月', tag: '成长卖家 ⭐ 推荐', features: ['10个店铺绑定','每月5000单','商品10000个','AI智能2000次','财务利润V2看板','自动审单规则'] },
          { name: '专业版', price: 1599, period: '每月', tag: '品牌卖家', features: ['30个店铺绑定','每月3万单','不限商品数','AI智能10000次','SHEIN/Temu高级刊登','多币种汇率看板+预警'] },
          { name: '企业版', price: 4999, period: '每月', tag: '大卖/集团', features: ['100+店铺绑定','每月20万单','独立部署','专属客户成功经理','API开放对接','私有化部署可选'] },
        ],
        cases: [
          { logo: '🏷️', industry: '家居 · 亚马逊美站', title: '从日均30单到日均800单', quote: 'AI自动审单把我们审单人员从3个减到0.5个，利润核算从每周一次变成实时。' },
          { logo: '🏷️', industry: '服饰 · Shopee+TikTok', title: '6国站点统一管理', quote: '库存以前每周都错，现在自动锁定+发货扣减，再也没出现过超卖。' },
          { logo: '🏷️', industry: '3C数码 · OZON+Wildberries', title: '俄语区出海第一站', quote: '汇率看板和订单级利润让我们不用再翻Excel，每月财务提前10天出报表。' },
        ],
        compare: [
          { item: '支持平台数', miaoshou: '38个', jushuitan: '32个', ours: '70+全球平台' },
          { item: '订单级利润核算', miaoshou: '仅销售额', jushuitan: '不含尾程分摊', ours: '✅ 12维度全分摊' },
          { item: 'AI自动审单', miaoshou: '规则式', jushuitan: '需加购', ours: '✅ 平台模型+拦截' },
          { item: '多币种趋势30天', miaoshou: '无', jushuitan: '需加购', ours: '✅ 6大区域32币种' },
          { item: 'SaaS多租户商用', miaoshou: '独立部署', jushuitan: '需定制', ours: '✅ 完整商业化' },
          { item: '套餐后台可视化', miaoshou: '工单申请', jushuitan: '工单申请', ours: '✅ 实时自助购买' },
        ],
        apply: { placeholder: '手机号', btnText: '立即申请免费体验', note: '我们将在1个工作日内联系您，并提供1对1店铺配置指导。' },
        footer: { copyright: '© 2025 数序科技 ShuXu Technology. All Rights Reserved.', icp: '沪ICP备2025000000号-1', phone: '400-888-6666', email: 'business@shuxu-erp.cc', wechatQr: '', address: '上海市浦东新区张江高科技园区科苑路88号' },
        seo: { title: '数序跨境ERP | 70+全球平台订单库存财务一体化全自动系统', keywords: '跨境ERP, 亚马逊ERP, ShopeeERP, TikTok Shop ERP, 多币种财务, 自动审单, 库存管理, SaaS多租户', description: '数序跨境ERP，覆盖70+全球电商平台，AI智能自动审单、多币种利润看板、全自动调度中心，为跨境卖家提供从店铺到回款的全流程一体化解决方案。' },
      };
      const j = JSON.stringify;
      await query(
        `INSERT INTO landing_configs
         (site_name, banner_json, advantage_json, features_json, plans_json, cases_json, compare_json, apply_json, footer_json, seo_json)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [def.site_name || '数序跨境ERP', j(def.banner), j(def.advantage), j(def.features), j(def.plans), j(def.cases), j(def.compare), j(def.apply), j(def.footer), j(def.seo)]
      );
      console.log('  ✅ 写入默认landing_config（首屏默认数据）');
    }
  } catch (e) {
    console.log('  ⚠️ landing初始化跳过:', e.message.slice(0, 100));
  }

  console.log('[migrate-v6-final] 全部执行完毕 ✅');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
