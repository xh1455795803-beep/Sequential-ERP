// 通用工具：密码哈希(scrypt)、套餐定义、订单号生成
const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
}

// 套餐额度矩阵（与官网定价一致）
const PLANS = {
  trial:      { name: '体验版',   shops: 3,  monthlyOrders: 500,       days: 14 },
  starter:    { name: '初创版',   shops: 3,  monthlyOrders: 1000 },
  standard:   { name: '标准版',   shops: 10, monthlyOrders: 5000 },
  pro:        { name: '专业版',   shops: 30, monthlyOrders: Infinity },
  enterprise: { name: '企业定制版', shops: Infinity, monthlyOrders: Infinity }
};

// 体验版/订阅到期判断
function isTenantExpired(tenant) {
  if (!tenant || !tenant.expire_at) return false;
  return new Date(tenant.expire_at).getTime() < Date.now();
}

function generateOrderNo() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SX${ymd}${rand}`;
}

module.exports = { hashPassword, verifyPassword, PLANS, isTenantExpired, generateOrderNo };
