import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// 阿里云短信服务：生成验证码 → 存库 → 调用阿里云短信 API 发送；校验验证码；重置密码
// 凭证通过环境变量注入：ALIYUN_SMS_ACCESS_KEY_ID / ALIYUN_SMS_ACCESS_KEY_SECRET / ALIYUN_SMS_SIGN_NAME / ALIYUN_SMS_TEMPLATE_CODE
// 动作：action = 'send'（发送验证码）| 'verify'（校验验证码）| 'reset-password'（校验验证码并重置密码）

const ALIYUN_SMS_ENDPOINT = 'https://dysmsapi.aliyuncs.com';
const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟有效
const MAX_ATTEMPTS = 5; // 最多尝试 5 次

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

    // ===== 发送验证码 =====
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