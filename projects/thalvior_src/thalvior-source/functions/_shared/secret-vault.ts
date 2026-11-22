// secret-vault.ts — 平台应用密钥的 AES-256-GCM 封装约定（Batch A · 平台运营后台地基）
//
// 约定（与 shops 凭据那套 PBKDF2/JWT_SECRET 完全独立，勿混用）：
//   密文格式 = `v1:<base64(iv)>:<base64(ct||tag)>`
//     - v1        封装版本，未来换算法/换主密钥只需新增 v2 分支，历史密文仍可读
//     - iv        12 字节随机（Web Crypto AES-GCM 推荐长度）
//     - ct||tag   crypto.subtle.encrypt 的原始输出（GCM tag 恒为末尾 16 字节）
//   主密钥 = 环境变量 SECRET_MASTER_KEY（base64 编码的 32 字节，openssl rand -base64 32）
//     - 由 /opt/supabase/docker/.env 提供，并经 docker-compose.yml 注入 edge_functions 容器
//     - 缺失时 encrypt/decrypt 直接抛错（宁可失败，也不用默认/硬编码密钥加密生产数据）
//   轮换 = platform_credentials.key_version 记录该行为第几代主密钥；
//     读旧密文时按 KEY_PROVIDERS 里对应的版本号取历史密钥，写新密文恒用当前版本。
//
// 只在 Edge Runtime（Deno）里使用；浏览器端永不导入本模块（前端只看到 has_secret）。

const IV_BYTES = 12;
const CURRENT_VERSION = 'v1';

/** 版本号 → 主密钥环境变量名。轮换时在此登记历史密钥， decrypt 自动按前缀选择。 */
const KEY_PROVIDERS: Record<string, string> = {
  v1: 'SECRET_MASTER_KEY',
};

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  return raw;
}
function bytesToB64(b: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}

let keyCache: { envName: string; key: CryptoKey } | null = null;

async function masterKey(envName: string): Promise<CryptoKey> {
  const raw = (Deno.env.get(envName) ?? '').trim();
  if (!raw) {
    throw new Error(`secret-vault: 缺少环境变量 ${envName}（base64 32 字节主密钥），无法加解密平台密钥`);
  }
  if (keyCache && keyCache.envName === envName) return keyCache.key;
  const bytes = b64ToBytes(raw);
  if (bytes.length !== 32) {
    throw new Error(`secret-vault: ${envName} 必须是 32 字节（base64 解码后得到 ${bytes.length} 字节）`);
  }
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt', 'decrypt',
  ]);
  keyCache = { envName, key };
  return key;
}

/** 加密明文 → `v1:<b64iv>:<b64ct>`。无主密钥时抛错。 */
export async function encrypt(plain: string): Promise<string> {
  const key = await masterKey(KEY_PROVIDERS[CURRENT_VERSION]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${CURRENT_VERSION}:${bytesToB64(iv)}:${bytesToB64(new Uint8Array(sealed))}`;
}

/** 解密 `v1:<b64iv>:<b64ct>` → 明文。版本未知 / 主密钥缺失 / tag 校验失败均抛错。 */
export async function decrypt(cipher: string): Promise<string> {
  const parts = String(cipher ?? '').split(':');
  if (parts.length !== 3) throw new Error('secret-vault: 密文格式应为 vN:<b64iv>:<b64ct>');
  const [version, ivB64, ctB64] = parts;
  const envName = KEY_PROVIDERS[version];
  if (!envName) throw new Error(`secret-vault: 未知的封装版本 ${version}`);
  const key = await masterKey(envName);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(ivB64) },
    key,
    b64ToBytes(ctB64),
  );
  return new TextDecoder().decode(plain);
}

/** 主密钥是否可用（admin-api 在 rotate 前给出可操作错误，而不是 500） */
export function hasMasterKey(): boolean {
  return (Deno.env.get(KEY_PROVIDERS[CURRENT_VERSION]) ?? '').trim().length > 0;
}
