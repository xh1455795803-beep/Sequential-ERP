// GoTrue SMS Hook 转发端：接收 GoTrue pg-functions hook 经 pg_net 转来的 OTP 消息，
// 调阿里云短信 API 发送。签名实现与 aliyun-sms 函数保持一致。
// 输入（GoTrue hooks 规范）: { "messages": [{ "type": "sms.send", "phone": "+8613800138000", "content": "Your code is 123456" }] }
// 输出: { "messages": [{ "status": "sent", "provider_id": "<RequestId>" }] }

const ALIYUN_SMS_ENDPOINT = 'https://dysmsapi.aliyuncs.com';

async function getSecret(): Promise<string> {
  // 1) 首选环境变量（PostgREST 默认不暴露 private schema，走 DB 会因权限/schema 不可达而失败）
  const envSecret = (Deno.env.get('GOTRUE_SMS_HOOK_SECRET') ?? '').trim();
  if (envSecret) return envSecret;

  // 2) 兜底：从 private.gotrue_hooks 读取（需 PostgREST 暴露 private 且授权 service_role）
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data, error } = await admin
    .schema('private')
    .from('gotrue_hooks')
    .select('value')
    .eq('key', 'sms_hook')
    .maybeSingle();
  if (error || !data?.value) throw new Error('hook secret not found');
  return data.value;
}

function normalizePhone(raw: string): string {
  let p = raw.replace(/^\+/, '').replace(/[\s-]/g, '');
  if (p.startsWith('86') && p.length === 13) p = p.slice(2);
  return p;
}

function extractCode(content: string): string {
  const m = content.match(/\b(\d{4,8})\b/);
  if (!m) throw new Error(`no code found in content: ${content}`);
  return m[1];
}

// 阿里云短信签名（RPC 风格 V1 签名算法，与 aliyun-sms 保持一致）
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

async function aliyunSendSms(
  phone: string,
  code: string,
  signName: string,
  templateCode: string,
): Promise<string> {
  const accessKeyId = Deno.env.get('ALIYUN_SMS_ACCESS_KEY_ID') ?? '';
  const accessKeySecret = Deno.env.get('ALIYUN_SMS_ACCESS_KEY_SECRET') ?? '';
  if (!accessKeyId || !accessKeySecret) throw new Error('missing ALIYUN_SMS credentials');

  const query: Record<string, string> = {
    PhoneNumbers: phone,
    SignName: signName,
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code, time: 5 }),
  };

  const signedParams = await signRequest(accessKeyId, accessKeySecret, 'POST', query);
  const formBody = new URLSearchParams(signedParams).toString();

  const response = await fetch(ALIYUN_SMS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody,
  });

  const result = await response.json().catch(() => ({} as any));
  const aliyunCode = result?.Code;
  if (aliyunCode !== 'OK') {
    throw new Error(`aliyun failed: ${JSON.stringify(result)}`);
  }
  return result?.RequestId ?? '';
}

Deno.serve(async (req) => {
  const rid = crypto.randomUUID().slice(0, 8);
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: '仅支持 POST 请求' }), { status: 405 });
    }

    const secret = await getSecret();
    if (!req.headers.get('x-internal-hook') || req.headers.get('x-internal-hook') !== secret) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
    }

    const payload = await req.json();
    // GoTrue pg-functions hook 实际格式: { metadata, user, sms: { otp, phone } }
    // 标准 hooks HTTP 格式: { messages: [{ type, phone, content }] }
    let phone = '';
    let code = '';
    if (Array.isArray(payload?.messages) && payload.messages.length > 0) {
      phone = String(payload.messages[0]?.phone ?? '');
      code = extractCode(String(payload.messages[0]?.content ?? ''));
    } else if (payload?.sms) {
      phone = String(payload.sms?.phone ?? '');
      code = String(payload.sms?.otp ?? '');
    }
    if (!phone || !code) {
      return new Response(JSON.stringify({ error: 'no messages', got: JSON.stringify(payload).slice(0, 200) }), { status: 400 });
    }

    const signName = Deno.env.get('ALIYUN_SMS_SIGN_NAME') ?? '';
    const templateCode = Deno.env.get('ALIYUN_SMS_TEMPLATE_CODE') ?? '';

    const results: Record<string, string>[] = [];
    try {
      const normalized = normalizePhone(phone);
      if (!/^1\d{10}$/.test(normalized)) throw new Error(`invalid CN phone: ${normalized}`);
      const signName = Deno.env.get('ALIYUN_SMS_SIGN_NAME') ?? '';
      const templateCode = Deno.env.get('ALIYUN_SMS_TEMPLATE_CODE') ?? '';
      const providerId = await aliyunSendSms(normalized, code, signName, templateCode);
      console.info(`[gotrue-sms] sent ${rid} phone=${normalized} provider=${providerId}`);
      results.push({ status: 'sent', provider_id: providerId });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.error(`[gotrue-sms] failed ${rid}: ${m}`);
      results.push({ status: 'failed', error: m });
    }

    return new Response(JSON.stringify({ messages: results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[gotrue-sms] failed ${rid}: ${message}`);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
