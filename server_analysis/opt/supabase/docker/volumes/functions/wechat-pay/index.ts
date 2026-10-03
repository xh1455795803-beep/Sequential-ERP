import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPoolBalance, deductFromPool, addPurchasedCredits, hasBenefit } from '../_shared/pool.ts';

// 微信支付 APIv3 集成：Native 扫码 / JSAPI 公众号 / H5 三种下单 + 支付回调 + 主动查单
// 凭证通过环境变量注入（敏感信息，严禁写入源码）：
//   WECHAT_MCH_ID        商户号
//   WECHAT_API_V3_KEY    APIv3 密钥（32 位）
//   WECHAT_SERIAL_NO     商户证书序列号
//   WECHAT_PRIVATE_KEY   商户私钥 PEM（RSA PKCS#8）
//   WECHAT_PUB_KEY_ID    平台公钥 ID
//   WECHAT_PUB_KEY       平台公钥 PEM（用于回调验签）
// 充值档位：从数据库 credit_packages 表动态查询，不再硬编码
// 服务端定档，绝不信任前端传值，防止篡改 credits 低价套积分

// 图片翻译次数包档位：pack_code → { name, count, price }（服务端定档，与前端 TRANSLATE_PACK_OPTIONS 保持一致）
// 次数包为独立资源包（translate_packs 表），不占用 AI 积分池
const TRANSLATE_PACKS: Record<string, { name: string; count: number; price: number }> = {
  tr100: { name: '100 次翻译包', count: 100, price: 9.9 },
  tr500: { name: '500 次翻译包', count: 500, price: 39 },
  tr2000: { name: '2,000 次翻译包', count: 2000, price: 129 },
};

// 动作：action = 'create-order' | 'callback' | 'query-order'

const WX_API_BASE = 'https://api.mch.weixin.qq.com';

// 回调地址：由平台公网地址动态拼接，避免硬编码
function getNotifyUrl(): string {
  const publicUrl = Deno.env.get('SUPABASE_PUBLIC_URL') || Deno.env.get('SUPABASE_URL') || '';
  return `${publicUrl}/functions/v1/wechat-pay`;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请先在云服务面板配置微信支付凭证`);
  }
  return value;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// 解析用户身份
async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// 生成商户订单号：时间戳 + 随机串
function generateOrderNo(): string {
  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return `T${ts}${rand}`;
}

// 生成随机 nonce 串
function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// 商户私钥 RSA-SHA256 签名（用于请求微信接口的 Authorization 头）
async function signWithPrivateKey(privateKeyPem: string, message: string): Promise<string> {
  const pemBody = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// 构造微信请求 Authorization 头
async function buildAuthHeader(
  method: string,
  urlPath: string,
  body: string,
  mchId: string,
  serialNo: string,
  privateKey: string,
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = generateNonce();
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = await signWithPrivateKey(privateKey, message);
  return (
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",` +
    `nonce_str="${nonce}",timestamp="${timestamp}",` +
    `serial_no="${serialNo}",signature="${signature}"`
  );
}

// 调用微信统一下单
async function createTransaction(
  payType: 'native' | 'h5',
  orderNo: string,
  amountFen: number,
  description: string,
  extra: { payerIp?: string },
): Promise<{ code_url?: string; h5_url?: string; prepay_id?: string }> {
  const mchId = getEnv('WECHAT_MCH_ID');
  const serialNo = getEnv('WECHAT_SERIAL_NO');
  const privateKey = getEnv('WECHAT_PRIVATE_KEY');
  const appId = getEnv('WECHAT_APP_ID');

  const urlPathMap: Record<string, string> = {
    native: '/v3/pay/transactions/native',
    h5: '/v3/pay/transactions/h5',
  };
  const urlPath = urlPathMap[payType];

  const payload: Record<string, unknown> = {
    appid: appId,
    mchid: mchId,
    description,
    out_trade_no: orderNo,
    notify_url: getNotifyUrl(),
    amount: { total: amountFen, currency: 'CNY' },
  };
  if (payType === 'h5') {
    payload.scene_info = {
      payer_client_ip: extra.payerIp || '127.0.0.1',
      h5_info: { type: 'Wap' },
    };
  }

  const body = JSON.stringify(payload);
  const authHeader = await buildAuthHeader('POST', urlPath, body, mchId, serialNo, privateKey);

  const resp = await fetch(`${WX_API_BASE}${urlPath}`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
  });

  const result = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (result as { message?: string }).message || `微信下单失败 (${resp.status})`;
    throw new Error(msg);
  }
  return result as { code_url?: string; h5_url?: string; prepay_id?: string };
}

// 平台公钥验签（回调）
async function verifySignature(publicKeyPem: string, message: string, signatureB64: string): Promise<boolean> {
  const pemBody = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, '')
    .replace(/-----END PUBLIC KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'spki',
    binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const sig = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, new TextEncoder().encode(message));
}

// AES-256-GCM 解密回调 resource
async function decryptResource(apiV3Key: string, ciphertext: string, nonce: string, associatedData: string): Promise<string> {
  const keyBytes = new TextEncoder().encode(apiV3Key);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const data = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = new TextEncoder().encode(nonce);
  const ad = new TextEncoder().encode(associatedData);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, data);
  return new TextDecoder().decode(plain);
}

// 幂等入账：更新订单状态 + 累加额度 + 写充值流水（订阅订单则开通套餐）
// ===== 邮件通知：统一走 mailer 服务（模板化），失败只记日志不影响主流程 =====
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function notifyMail(
  scene: string,
  userId: string,
  vars: Record<string, string>,
): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  try {
    const uRes = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!uRes.ok) return;
    const u = (await uRes.json()) as { email?: string };
    if (!u.email) return;
    await fetch(`${url}/functions/v1/mailer`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 网关会改写 Authorization/apikey，服务端互调统一用共享密钥头
        'x-mailer-secret': Deno.env.get('MAILER_SECRET') || '',
      },
      body: JSON.stringify({ action: 'send', scene, email: u.email, lang: 'zh', userId, vars }),
    });
  } catch (e) {
    console.error(`[wechat-pay] 邮件通知失败 ${scene}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function settleOrder(orderNo: string, wechatTradeNo: string, amountFen: number) {
  const admin = adminClient();

  // 查订单
  const { data: order } = await admin
    .from('payment_orders')
    .select('id, user_id, amount, status, plan_id, credits_granted, package_code, platform_code, license_shop_count, license_period, period_months')
    .eq('order_no', orderNo)
    .maybeSingle();

  if (!order) {
    throw new Error(`订单不存在: ${orderNo}`);
  }
  if (order.status === 'paid') {
    // 已入账，幂等返回
    return { settled: false, order };
  }

  const amountYuan = amountFen / 100;
  // 金额校验
  if (Math.abs(Number(order.amount) - amountYuan) > 0.01) {
    throw new Error(`金额不一致: 订单 ${order.amount} vs 回调 ${amountYuan}`);
  }

  // 更新订单状态
  await admin
    .from('payment_orders')
    .update({ status: 'paid', wechat_trade_no: wechatTradeNo, paid_at: new Date().toISOString() })
    .eq('id', order.id);

  // ===== 订阅订单：开通套餐 =====
  if (order.plan_id) {
    const { data: plan } = await admin
      .from('subscription_plans')
      .select('id, name, quota, period')
      .eq('id', order.plan_id)
      .maybeSingle();

    if (!plan) {
      throw new Error(`套餐不存在: ${order.plan_id}`);
    }

    // 套餐期限按实际周期：年=365天、季=90天、月=30天（FR-11）
    const periodText = String(plan.period || '月');
    const planDays = periodText.includes('年') ? 365 : periodText.includes('季') ? 90 : 30;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + planDays * 24 * 60 * 60 * 1000);

    // 写入订阅记录
    await admin.from('subscriptions').insert({
      user_id: order.user_id,
      plan_id: plan.id,
      plan_name: plan.name,
      amount: amountYuan,
      status: 'active',
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    // 更新租户套餐信息 + 赠送 AI 积分（订阅赠送的是积分 credits，不再触碰现金余额 balance）
    const { data: quota } = await admin
      .from('tenant_quotas')
      .select('id, workbench_credits')
      .eq('user_id', order.user_id)
      .maybeSingle();

    const giftCredits = Number(plan.quota) || 0;
    let newCredits = giftCredits;
    if (quota) {
      newCredits = Number(quota.workbench_credits ?? 0) + giftCredits;
      await admin
        .from('tenant_quotas')
        .update({
          workbench_credits: newCredits,
          plan_id: plan.id,
          plan_name: plan.name,
          plan_expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', quota.id);
    } else {
      await admin.from('tenant_quotas').insert({
        user_id: order.user_id,
        workbench_credits: giftCredits,
        plan_id: plan.id,
        plan_name: plan.name,
        plan_expires_at: expiresAt.toISOString(),
      });
    }

    // 套餐开通通知邮件（走统一 mailer 模板；发信失败不影响资金与套餐入账）
    await notifyMail('subscription_activated', order.user_id, {
      packageName: plan.name,
      startDate: ymd(now),
      endDate: ymd(expiresAt),
      aiTokenCount: String(newCredits),
    });

    return { settled: true, order };
  }

  // ===== 店铺授权订单：按平台发放/续费 shop_licenses（FR-10） =====
  if (order.platform_code && order.license_shop_count) {
    const platformCode = String(order.platform_code);
    const addCount = Number(order.license_shop_count);
    const months = Number(order.period_months) > 0 ? Number(order.period_months) : 1;
    const licenseDays = months * 30;
    const now = new Date();
    const DAY_MS = 24 * 60 * 60 * 1000;

    const { data: platformRow } = await admin
      .from('license_platforms')
      .select('name')
      .eq('platform_code', platformCode)
      .maybeSingle();
    const platformName = platformRow?.name ?? platformCode;

    // 同用户同平台已有有效授权：累加店铺数，到期日取 max(now, 原到期日) 后顺延
    const { data: existingLic } = await admin
      .from('shop_licenses')
      .select('id, shop_count, expires_at')
      .eq('user_id', order.user_id)
      .eq('platform_code', platformCode)
      .eq('status', 'active')
      .maybeSingle();

    if (existingLic) {
      const baseTime = Math.max(now.getTime(), new Date(existingLic.expires_at).getTime());
      const newExpiresAt = new Date(baseTime + licenseDays * DAY_MS);
      await admin
        .from('shop_licenses')
        .update({
          shop_count: Number(existingLic.shop_count) + addCount,
          expires_at: newExpiresAt.toISOString(),
        })
        .eq('id', existingLic.id);
    } else {
      await admin.from('shop_licenses').insert({
        user_id: order.user_id,
        platform_code: platformCode,
        plan_code: `${platformCode}_${addCount}`,
        order_no: orderNo,
        shop_count: addCount,
        amount: amountYuan,
        period: String(order.license_period || 'month'),
        status: 'active',
        started_at: now.toISOString(),
        expires_at: new Date(now.getTime() + licenseDays * DAY_MS).toISOString(),
      });
    }

    console.info(
      `[wechat-pay] license granted user=${order.user_id} platform=${platformCode} +${addCount} days=${licenseDays}`,
    );
    return { settled: true, order, platform: platformName };
  }

  // ===== 次数包订单：图片翻译次数包（translate_packs 独立资源包） =====
  if (order.package_code && TRANSLATE_PACKS[order.package_code]) {
    const pkg = TRANSLATE_PACKS[order.package_code];
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 年有效期

    // 同档位续购：累加剩余次数；不同档位则新开一个包
    const { data: existing } = await admin
      .from('translate_packs')
      .select('id, remaining')
      .eq('user_id', order.user_id)
      .eq('pack_code', order.package_code)
      .eq('status', 'active')
      .maybeSingle();

    if (existing) {
      await admin
        .from('translate_packs')
        .update({ remaining: Number(existing.remaining) + pkg.count })
        .eq('id', existing.id);
    } else {
      await admin.from('translate_packs').insert({
        user_id: order.user_id,
        pack_code: order.package_code,
        name: pkg.name,
        total: pkg.count,
        remaining: pkg.count,
        source: 'wechat',
        amount: amountYuan,
        status: 'active',
        purchased_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      });
    }

    await notifyMail('translate_pack_purchased', order.user_id, {
      packName: pkg.name,
      packCount: String(pkg.count),
      endDate: ymd(expiresAt),
    });

    return { settled: true, order };
  }

  // ===== 充值订单：累加 AI 积分（credits） =====
  // 积分数量取自下单时服务端按档位写入的 credits_granted，回调入账时再次校验，避免篡改
  const grantedCredits = Number(order.credits_granted) || 0;
  await addPurchasedCredits(order.user_id, grantedCredits, String(order.package_code || ''));

  // 写充值流水
  await admin.from('quota_recharges').insert({
    user_id: order.user_id,
    amount: amountYuan,
    method: '微信支付',
  });

  return { settled: true, order };
}

Deno.serve(async (req) => {
  const functionName = 'wechat-pay';
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== 'POST') {
      return json({ error: '仅支持 POST 请求' }, 405);
    }

    // body stream 只能消费一次：先取原始报文（回调验签必须用原文），再按需解析 JSON
    const rawBody = await req.text();

    // ===== 支付回调（微信服务器调用，无用户鉴权）=====
    // 必须通过 Wechatpay-Timestamp 请求头识别：微信回调体不含 action 字段
    const wechatpayTimestamp = req.headers.get('Wechatpay-Timestamp');
    if (wechatpayTimestamp) {
      const apiV3Key = getEnv('WECHAT_API_V3_KEY');
      const publicKey = getEnv('WECHAT_PUB_KEY');
      const publicKeyId = getEnv('WECHAT_PUB_KEY_ID');

      const wechatpayNonce = req.headers.get('Wechatpay-Nonce') || '';
      const wechatpaySignature = req.headers.get('Wechatpay-Signature') || '';
      const wechatpaySerial = req.headers.get('Wechatpay-Serial') || '';

      console.info(`[${functionName}] callback received ${requestId}`);

      // 验签
      const message = `${wechatpayTimestamp}\n${wechatpayNonce}\n${rawBody}\n`;
      const ok = await verifySignature(publicKey, message, wechatpaySignature);
      if (!ok) {
        console.error(`[${functionName}] callback verify failed ${requestId}`);
        return json({ code: 'FAIL', message: '验签失败' }, 401);
      }
      if (wechatpaySerial !== publicKeyId) {
        console.error(`[${functionName}] callback serial mismatch ${requestId}`);
        return json({ code: 'FAIL', message: '证书序列号不匹配' }, 401);
      }

      // 解密 resource
      const parsed = JSON.parse(rawBody);
      const resource = parsed.resource || {};
      const plain = await decryptResource(
        apiV3Key,
        resource.ciphertext,
        resource.nonce,
        resource.associated_data || '',
      );
      const event = JSON.parse(plain);

      if (event.trade_state !== 'SUCCESS') {
        console.info(`[${functionName}] callback non-success ${requestId} state=${event.trade_state}`);
        return json({ code: 'SUCCESS', message: '成功' });
      }

      const orderNo = event.out_trade_no;
      const wechatTradeNo = event.transaction_id;
      const amountFen = Number(event.amount?.total || 0);

      await settleOrder(orderNo, wechatTradeNo, amountFen);
      console.info(`[${functionName}] callback settled ${requestId} order=${orderNo}`);
      return json({ code: 'SUCCESS', message: '成功' });
    }

    // ===== 以下为普通 JSON API（create-order / query-order），需要用户鉴权 =====
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return json({ error: '请求体不是有效的 JSON' }, 400);
    }
    const action = String(body.action || '');

    const userId = await resolveUserId(req);
    if (!userId) {
      return json({ error: '未登录' }, 401);
    }

    // ===== 创建订单 =====
    if (action === 'create-order') {
      const amount = Number(body.amount);
      const payType = String(body.pay_type || 'native');
      const planId = body.plan_id ? String(body.plan_id) : null;
      const packageType = String(body.package_type || '');
      const packCode = body.pack_code ? String(body.pack_code) : null;
      if (!amount || amount <= 0) {
        return json({ error: '金额无效' }, 400);
      }
      if (!['native', 'h5'].includes(payType)) {
        return json({ error: '支付方式无效' }, 400);
      }

      const admin = adminClient();

      // 服务端定档，绝不信任前端传值
      let finalAmount = amount;
      let planName = '';
      let grantedCredits: number | null = null;
      let packageCode: string | null = null;
      let description = '';
      // 店铺授权订单的服务端定档要素（公式定价，FR-7/FR-9）
      let licensePlatformCode: string | null = null;
      let licenseShopCount: number | null = null;
      let licensePeriod: string | null = null;
      let licensePeriodMonths: number | null = null;
      if (planId) {
        // 订阅订单：校验套餐存在，金额以套餐价为准
        const { data: plan } = await admin
          .from('subscription_plans')
          .select('id, name, price')
          .eq('id', planId)
          .maybeSingle();
        if (!plan) {
          return json({ error: '套餐不存在' }, 400);
        }
        finalAmount = Number(plan.price);
        planName = plan.name;
        description = `Thalvior 订阅套餐 ${planName}`;
      } else if (packageType === 'shop_license') {
        // 店铺授权订单：平台 × 店铺数 × 周期，服务端公式定价（FR-7~FR-9）
        // 旧前端 pack_code（tk_1/sl_1/shp_1/scale_*）兼容映射，过渡期后可移除
        const LEGACY_PACK_MAP: Record<string, { platform: string; count: number }> = {
          tk_1: { platform: 'tiktok', count: 1 },
          sl_1: { platform: 'shopee', count: 1 },
          shp_1: { platform: 'shopee', count: 1 },
          temu_15: { platform: 'temu', count: 15 },
          temu_50: { platform: 'temu', count: 50 },
          temu_100: { platform: 'temu', count: 100 },
          temu_200: { platform: 'temu', count: 200 },
          scale_15: { platform: 'temu', count: 15 },
          scale_50: { platform: 'temu', count: 50 },
          scale_100: { platform: 'temu', count: 100 },
          scale_200: { platform: 'temu', count: 200 },
        };

        let platformCode = body.platform_code ? String(body.platform_code) : '';
        // 严格整数：1.5 / "3abc" 等一律视为非法（下方区间校验统一拒绝），不得静默取整
        const rawShopCount = Number(body.shop_count);
        let shopCount = Number.isInteger(rawShopCount) ? rawShopCount : 0;
        if ((!platformCode || !shopCount) && packCode && LEGACY_PACK_MAP[packCode]) {
          const legacy = LEGACY_PACK_MAP[packCode];
          if (!platformCode) platformCode = legacy.platform;
          if (!shopCount) shopCount = legacy.count;
        }
        if (!platformCode) {
          return json({ error: '缺少授权平台' }, 400);
        }
        if (!Number.isInteger(shopCount) || shopCount < 1 || shopCount > 10000) {
          return json({ error: '店铺数量无效（需为 1-10000 的整数）' }, 400);
        }

        const { data: platformRow } = await admin
          .from('license_platforms')
          .select('platform_code, name, base_price')
          .eq('platform_code', platformCode)
          .eq('status', '启用')
          .maybeSingle();
        if (!platformRow) {
          return json({ error: '授权平台不存在或已下架' }, 400);
        }

        // 店铺数折扣：标准档精确命中；自定义数量取不超过该数量的最大档折扣
        const { data: exactTier } = await admin
          .from('license_shop_tiers')
          .select('volume_discount')
          .eq('shop_count', shopCount)
          .eq('status', '启用')
          .maybeSingle();
        let volumeDiscount: number;
        if (exactTier) {
          volumeDiscount = Number(exactTier.volume_discount);
        } else {
          const { data: nearTier } = await admin
            .from('license_shop_tiers')
            .select('volume_discount')
            .eq('status', '启用')
            .lte('shop_count', shopCount)
            .order('shop_count', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!nearTier) {
            return json({ error: '店铺数量无效' }, 400);
          }
          volumeDiscount = Number(nearTier.volume_discount);
        }

        const periodCode = String(body.period || 'month');
        const { data: periodRow } = await admin
          .from('license_periods')
          .select('period_code, label, months, discount')
          .eq('period_code', periodCode)
          .eq('status', '启用')
          .maybeSingle();
        if (!periodRow) {
          return json({ error: '订购周期无效' }, 400);
        }

        // price = round(基础价 × 数量折扣 × 店铺数 × 周期月数 × 周期折扣)，四舍五入到元
        const shopPrice = Math.round(
          Number(platformRow.base_price) * volumeDiscount * shopCount *
          Number(periodRow.months) * Number(periodRow.discount),
        );
        if (!(shopPrice > 0)) {
          return json({ error: '该档位价格未配置' }, 400);
        }

        finalAmount = shopPrice;
        packageCode = `${platformCode}_${shopCount}`;
        description = `Thalvior 店铺授权 ${platformRow.name} ${shopCount} 店 ${periodRow.label}`;
        licensePlatformCode = platformRow.platform_code;
        licenseShopCount = shopCount;
        licensePeriod = periodRow.period_code;
        licensePeriodMonths = Number(periodRow.months);
      } else if (packageType === 'translate_pack') {
        // 次数包订单：金额与次数以服务端定档为准
        if (!packCode || !TRANSLATE_PACKS[packCode]) {
          return json({ error: '次数包档位无效' }, 400);
        }
        const pkg = TRANSLATE_PACKS[packCode];
        finalAmount = pkg.price;
        packageCode = packCode;
        description = `Thalvior 图片翻译次数包 ${pkg.name}`;
      } else {
        // 充值订单：从数据库 credit_packages 表动态查询档位（服务端权威）
        const { data: creditPkg } = await admin
          .from('credit_packages')
          .select('id, package_code, name, credits, price')
          .eq('price', finalAmount)
          .eq('status', '启用')
          .maybeSingle();
        if (!creditPkg) {
          return json({ error: `充值金额 ¥${finalAmount} 无对应档位，请联系客服` }, 400);
        }
        grantedCredits = Number(creditPkg.credits);
        packageCode = creditPkg.package_code;
        description = `Thalvior AI 积分充值 ${creditPkg.name}（${grantedCredits} 积分）`;
      }

      const orderNo = generateOrderNo();
      const amountFen = Math.round(finalAmount * 100);

      const { error: insertError } = await admin.from('payment_orders').insert({
        user_id: userId,
        order_no: orderNo,
        amount: finalAmount,
        pay_type: payType,
        status: 'pending',
        plan_id: planId,
        credits_granted: grantedCredits,
        package_code: packageCode,
        platform_code: licensePlatformCode,
        license_shop_count: licenseShopCount,
        license_period: licensePeriod,
        period_months: licensePeriodMonths,
      });
      if (insertError) {
        console.error(`[${functionName}] insert order failed ${requestId}: ${insertError.message}`);
        return json({ error: '订单创建失败' }, 500);
      }

      const result = await createTransaction(
        payType as "native" | "h5",
        orderNo,
        amountFen,
        description,
        { payerIp: body.payer_ip },
      );

      console.info(`[${functionName}] create-order ${requestId} order=${orderNo} type=${payType}`);
      return json({
        data: {
          order_no: orderNo,
          code_url: result.code_url || '',
          h5_url: result.h5_url || '',
          prepay_id: result.prepay_id || '',
        },
      });
    }

    // ===== 主动查单 =====
    if (action === 'query-order') {
      const orderNo = String(body.order_no || '');
      if (!orderNo) {
        return json({ error: '缺少订单号' }, 400);
      }
      const admin = adminClient();
      const { data: order } = await admin
        .from('payment_orders')
        .select('order_no, amount, status, wechat_trade_no, paid_at')
        .eq('order_no', orderNo)
        .eq('user_id', userId)
        .maybeSingle();

      if (!order) {
        return json({ error: '订单不存在' }, 404);
      }
      return json({ data: order });
    }

    return json({ error: '未知动作' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return json({ error: message }, 500);
  }
});