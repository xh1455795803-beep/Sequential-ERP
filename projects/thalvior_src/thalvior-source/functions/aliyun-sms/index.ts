import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 阿里云短信服务：生成验证码 → 存库 → 调用阿里云短信 API 发送；校验验证码；重置密码
// 凭证通过环境变量注入：ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE
// 动作：action = 'send'（发送验证码）| 'verify'（校验验证码）| 'reset-password'（校验验证码并重置密码）

const ALIYUN_SMS_ENDPOINT = 'https://dysmsapi.aliyuncs.com';
const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟有效
const MAX_ATTEMPTS = 5; // 最多尝试 5 次

// 发送频率限制（防短信轰炸/盗刷；闸门必须在调用阿里云之前拦截，被拦即零短信费用）
const RESEND_INTERVAL_SECONDS = 60; // 同一手机号 60 秒内仅可重发一次
const DAILY_LIMIT_PER_PHONE = 10; // 同一手机号滚动 24 小时最多 10 条
const HOURLY_LIMIT_PER_IP = 20; // 同一来源 IP 滚动 1 小时最多 20 条
const DAILY_LIMIT_PER_IP = 50; // 同一来源 IP 滚动 24 小时最多 50 条

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请先在云服务面板配置`);
  }
  return value;
}

// 生成 6 位数字验证码
function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// 归一化手机号为 E.164 +86 格式
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('86') && digits.length === 13) return `+${digits}`;
  if (digits.length === 11) return `+86${digits}`;
  return phone.startsWith('+') ? phone : `+${phone}`;
}

// 取真实来源 IP（网关透传 x-forwarded-for，第一跳为客户端地址；取不到则为 unknown）
function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for') ?? '';
  return xff.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim() || 'unknown';
}

// 阿里云短信签名（RPC 风格 V1 签名算法）
async function signRequest(
  accessKeyId: string,
  accessKeySecret: string,
  method: string,
  query: Record<string, string>,
): Promise<Record<string, string>> {
  const encoder = new TextEncoder();
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  const params: Record<string, string> = {
    ...query,
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: timestamp,
    Format: 'JSON',
    Version: '2017-05-25',
    Action: 'SendSms',
  };

  const sortedKeys = Object.keys(params).sort();
  const canonicalizedQuery = sortedKeys
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  const stringToSign = `${method}&${encodeURIComponent('/')}&${encodeURIComponent(canonicalizedQuery)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${accessKeySecret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(stringToSign));
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return { ...params, Signature: signatureBase64 };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const functionName = 'aliyun-sms';
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== 'POST') {
      return json({ error: '仅支持 POST 请求' }, 405);
    }

    const body = await req.json();
    const { phone, action, code, password } = body as {
      phone?: string;
      action?: string;
      code?: string;
      password?: string;
    };

    if (!phone) {
      return json({ error: '缺少手机号' }, 400);
    }

    const normalizedPhone = normalizePhone(phone);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ===== 校验验证码（verify / reset-password 共用） =====
    if (action === 'verify' || action === 'reset-password') {
      if (!code) {
        return json({ error: '缺少验证码' }, 400);
      }

      const { data: rows, error: queryError } = await admin
        .from('sms_codes')
        .select('id, code, expires_at, used')
        .eq('phone', normalizedPhone)
        .eq('used', false)
        .order('created_at', { ascending: false })
        .limit(1);

      if (queryError) {
        console.error(`[${functionName}] query failed ${requestId}: ${queryError.message}`);
        return json({ error: '验证码查询失败' }, 500);
      }

      const record = rows?.[0];
      if (!record) {
        return json({ error: '验证码不存在或已过期，请重新获取' }, 400);
      }

      if (new Date(record.expires_at).getTime() < Date.now()) {
        return json({ error: '验证码已过期，请重新获取' }, 400);
      }

      if (record.code !== code) {
        return json({ error: '验证码错误' }, 400);
      }

      // 标记验证码已使用
      await admin.from('sms_codes').update({ used: true }).eq('id', record.id);

      // ===== 重置密码 =====
      if (action === 'reset-password') {
        if (!password || password.length < 6) {
          return json({ error: '密码至少 6 位' }, 400);
        }

        // 通过手机号查找用户（GoTrue Admin API；auth.users 不在 PostgREST 暴露的 schema 中，不能用 .from('auth.users')）
        // 兼容两种存储格式：auth.users.phone = '8617601293462'，sms_codes.phone = '+8617601293462'
        const { data: listData, error: listError } = await admin.auth.admin.listUsers({
          perPage: 1000,
        });

        if (listError) {
          console.error(`[${functionName}] list users failed ${requestId}: ${listError.message}`);
          return json({ error: '用户查询失败' }, 500);
        }

        const phoneE164 = normalizedPhone; // +8617601293462
        const phonePlain = normalizedPhone.replace(/^\+/, ''); // 8617601293462
        const userRow = listData?.users?.find(
          (u) => u.phone === phoneE164 || u.phone === phonePlain,
        );

        const userId = userRow?.id;
        if (!userId) {
          return json({ error: '该手机号未注册' }, 404);
        }

        const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
          password,
        });
        if (updateError) {
          console.error(`[${functionName}] update password failed ${requestId}: ${updateError.message}`);
          return json({ error: '密码重置失败' }, 500);
        }

        console.info(`[${functionName}] reset-password success ${requestId}`);
        return json({ success: true });
      }

      console.info(`[${functionName}] verify success ${requestId}`);
      return json({ success: true });
    }

    // ===== 发送验证码（显式校验 action，未识别动作不放行） =====
    if (action !== 'send') {
      return json({ error: '不支持的操作' }, 400);
    }

    // 频率限制（必须位于生成验证码/调阿里云之前，命中即直接返回，不产生短信费用）
    const clientIp = getClientIp(req);
    const now = Date.now();
    const since60s = new Date(now - RESEND_INTERVAL_SECONDS * 1000).toISOString();
    const since1h = new Date(now - 60 * 60 * 1000).toISOString();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    // 1) 同一手机号 60 秒重发间隔
    const { count: recentCount, error: recentError } = await admin
      .from('sms_codes')
      .select('id', { count: 'exact', head: true })
      .eq('phone', normalizedPhone)
      .gte('created_at', since60s);
    if (recentError) {
      console.error(`[${functionName}] ratelimit query failed ${requestId}: ${recentError.message}`);
      return json({ error: '服务繁忙，请稍后再试' }, 500);
    }
    if ((recentCount ?? 0) > 0) {
      return json({ error: '发送太频繁，请 60 秒后再试' }, 429);
    }

    // 2) 同一手机号滚动 24 小时上限
    const { count: phoneDayCount } = await admin
      .from('sms_codes')
      .select('id', { count: 'exact', head: true })
      .eq('phone', normalizedPhone)
      .gte('created_at', since24h);
    if ((phoneDayCount ?? 0) >= DAILY_LIMIT_PER_PHONE) {
      return json({ error: '该手机号验证码已达每日上限，请明天再试' }, 429);
    }

    // 3) 同一来源 IP 小时/24 小时上限（unknown 出口跳过 IP 维度，手机号维度仍生效）
    if (clientIp !== 'unknown') {
      const [ipHour, ipDay] = await Promise.all([
        admin
          .from('sms_codes')
          .select('id', { count: 'exact', head: true })
          .eq('client_ip', clientIp)
          .gte('created_at', since1h),
        admin
          .from('sms_codes')
          .select('id', { count: 'exact', head: true })
          .eq('client_ip', clientIp)
          .gte('created_at', since24h),
      ]);
      if ((ipHour.count ?? 0) >= HOURLY_LIMIT_PER_IP) {
        return json({ error: '当前网络请求过于频繁，请稍后再试' }, 429);
      }
      if ((ipDay.count ?? 0) >= DAILY_LIMIT_PER_IP) {
        return json({ error: '当前网络验证码已达每日上限' }, 429);
      }
    }

    const accessKeyId = getEnv('ALIYUN_SMS_ACCESS_KEY_ID');
    const accessKeySecret = getEnv('ALIYUN_SMS_ACCESS_KEY_SECRET');
    const signName = getEnv('ALIYUN_SMS_SIGN_NAME');
    const templateCode = getEnv('ALIYUN_SMS_TEMPLATE_CODE');

    const generatedCode = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);

    const { error: insertError } = await admin.from('sms_codes').insert({
      phone: normalizedPhone,
      code: generatedCode,
      expires_at: expiresAt.toISOString(),
      client_ip: clientIp,
    });
    if (insertError) {
      console.error(`[${functionName}] insert failed ${requestId}: ${insertError.message}`);
      return json({ error: '验证码存储失败' }, 500);
    }

    const query: Record<string, string> = {
      PhoneNumbers: normalizedPhone,
      SignName: signName,
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code: generatedCode, time: CODE_TTL_MS / 60000 }),
    };

    const signedParams = await signRequest(accessKeyId, accessKeySecret, 'POST', query);
    const formBody = new URLSearchParams(signedParams).toString();

    console.info(`[${functionName}] send ${requestId} phone=${normalizedPhone}`);

    const response = await fetch(ALIYUN_SMS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });

    const result = await response.json();
    const aliyunCode = (result as { Code?: string }).Code;

    if (aliyunCode !== 'OK') {
      console.error(`[${functionName}] aliyun failed ${requestId}: ${JSON.stringify(result)}`);
      return json(
        { error: `短信发送失败: ${(result as { Message?: string }).Message || aliyunCode}` },
        502,
      );
    }

    console.info(`[${functionName}] send success ${requestId}`);
    return json({ success: true, expiresIn: 300 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return json({ error: message }, 500);
  }
});