// v4 迁移：给 shops 表扩展 ext_fields_enc（用于密钥型平台存第 3+ 个字段，如 Rakuten/Gmarket 等多字段）
const { query } = require('./db');

async function up() {
  try {
    await query(`ALTER TABLE shops ADD COLUMN ext_fields_enc TEXT NULL COMMENT '扩展字段加密 JSON（密钥型平台 3+ 字段或其它结构化凭证）' AFTER api_secret_enc`);
    console.log('[migrate-v4] shops.ext_fields_enc 列已添加');
  } catch (e) {
    if (/Duplicate column name/.test(e.message)) console.log('[migrate-v4] shops.ext_fields_enc 已存在，跳过');
    else throw e;
  }

  // 再加一个唯一索引：(tenant_id, name, platform) 避免"随便录入"同名店铺重复堆积
  try {
    await query(`ALTER TABLE shops ADD UNIQUE KEY uk_tenant_name_platform (tenant_id, name, platform)`);
    console.log('[migrate-v4] uk_tenant_name_platform 唯一索引已添加');
  } catch (e) {
    if (/Duplicate key name|Duplicate entry/.test(e.message)) console.log('[migrate-v4] 唯一索引已存在或数据有重复（跳过），原错：' + e.message.split('\n')[0]);
    else throw e;
  }
}

if (require.main === module) up().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

module.exports = { up };
