// 加密工具：AES-256-GCM，用于加密存储平台令牌 / 应用密钥
const crypto = require('crypto');
const config = require('./config');

// 从 JWT 密钥派生加密密钥（服务器唯一，不落库）
if (!config.jwtSecret) throw new Error('JWT_SECRET 未配置：无法初始化加密模块');
const KEY = crypto.scryptSync(config.jwtSecret, 'shuxu-erp-enc-v1', 32);

/** 加密明文 → base64(iv + tag + 密文) */
function encrypt(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** 解密 base64(iv + tag + 密文) → 明文 */
function decrypt(b64) {
  if (!b64) return null;
  try {
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.slice(0, 12);
    const tag = buf.slice(12, 28);
    const data = buf.slice(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Shopee 签名：HMAC-SHA256(partner_key, path + timestamp) */
function shopeeSign(partnerKey, path, timestamp) {
  return crypto.createHmac('sha256', partnerKey).update(path + timestamp).digest('hex');
}

/** 生成 OAuth state（防 CSRF） */
function newState() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = { encrypt, decrypt, shopeeSign, newState };
