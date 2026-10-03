// 邮箱验证码登录 / 注册 —— 只负责「把验证码送到用户邮箱」
//
// 设计要点（为什么这样做）：
// 1) 验证码由 GoTrue 原生签发（admin generate_link 返回的 email_otp），
//    过期时间、尝试次数、一次性校验全部由 GoTrue 负责，不自建校验逻辑，避免安全漏洞。
// 2) 邮件由统一邮件服务 mailer 投递（模板 + 品牌化 HTML + 审计日志），本函数不再直连 SMTP，
//    仅保留 ping 自测能力用于排查链路。
// 3) 前端拿到用户填写的 6 位码后调用 supabase.auth.verifyOtp({ email, token, type: 'email' })，
//    由 GoTrue 完成登录并下发会话。
//
// 接口：
//   POST { action: "send", email, scene } → 发送验证码（scene: login | register | reset）
//   POST { action: "ping" }               → SMTP 连通性自测

const MAILER_SECRET = Deno.env.get('MAILER_SECRET') || '';
const SMTP_HOST = Deno.env.get('SMTP_HOST') || 'smtp.qq.com';
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') || 465);
const SMTP_USER = Deno.env.get('SMTP_USER') || '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') || '';
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER;
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') || 'Thalvior ERP';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const RESEND_INTERVAL_SECONDS = 60;
const DAILY_LIMIT_PER_EMAIL = 10;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function utf8ToBase64(s: string): string {
  const bytes = encoder.encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function mimeHeaderValue(name: string): string {
  return `=?UTF-8?B?${utf8ToBase64(name)}?=`;
}

// ===== SMTP（TLS 直连 465）=====
async function readResponse(conn: Deno.TlsConn): Promise<string> {
  let data = '';
  const buf = new Uint8Array(2048);
  while (true) {
    const n = await conn.read(buf);
    if (n === null) break;
    data += decoder.decode(buf.subarray(0, n));
    const lines = data.split('\r\n').filter((l) => l.length >= 4);
    const last = lines[lines.length - 1];
    if (last && last[3] === ' ') break; // 多行响应末行形如 "250 xxx"
    if (data.length > 65536) break;
  }
  return data;
}

async function smtpCmd(conn: Deno.TlsConn, line: string): Promise<string> {
  await conn.write(encoder.encode(line + '\r\n'));
  return await readResponse(conn);
}

async function smtpPing(): Promise<string> {
  const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
  const greeting = await readResponse(conn);
  const ehlo = await smtpCmd(conn, 'EHLO thalvior.icu');
  await smtpCmd(conn, 'QUIT').catch(() => '');
  try { conn.close(); } catch { /* noop */ }
  return `greeting=${greeting.split('\r\n')[0]} | ehlo=${ehlo.split('\r\n')[0]}`;
}

// ===== 发送频控（email_codes 表仅用于审计与频控，不参与校验）=====
async function lastSentAt(email: string, scene: string): Promise<number | null> {
  const url = `${SUPABASE_URL}/rest/v1/email_codes?email=eq.${encodeURIComponent(email)}&scene=eq.${encodeURIComponent(scene)}&order=created_at.desc&limit=1&select=created_at`;
  const res = await fetch(url, { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } });
  if (!res.ok) return null;
  const rows = await res.json();
  if (Array.isArray(rows) && rows.length > 0) return new Date(String(rows[0].created_at)).getTime();
  return null;
}

async function countToday(email: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/email_codes?email=eq.${encodeURIComponent(email)}&created_at=gte.${encodeURIComponent(since)}&select=id`;
  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'count=exact' },
  });
  const m = (res.headers.get('content-range') || '').match(/\/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

async function logSent(email: string, scene: string): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/email_codes`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      email,
      scene,
      code_hash: 'gotue-native-otp', // 验证码本体由 GoTrue 保管，此处不落库
      expires_at: new Date(Date.now() + 600 * 1000).toISOString(),
    }),
  }).catch(() => undefined);
}

// ===== 查询邮箱是否已注册（admin 接口精确过滤）=====
// 作用：登录场景不允许「顺手把未注册邮箱建成账号」，注册场景不允许「覆盖已有账号」
async function userExists(email: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=1`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    },
  );
  if (!res.ok) return true; // 查询失败时放行，避免误伤正常流程
  const data = await res.json().catch(() => ({ users: [] }));
  return Array.isArray(data?.users) && data.users.length > 0;
}

// ===== 向 GoTrue 申请原生 OTP（已存在用户用 magiclink / recovery，新用户用 signup）=====
async function issueOtp(email: string, scene: string): Promise<{ otp: string; created: boolean }> {
  const call = async (type: string) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ type, email }),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try { data = JSON.parse(text); } catch { /* 非 JSON */ }
    return { ok: res.ok, status: res.status, data };
  };

  const exists = await userExists(email);

  if (scene === 'register') {
    // 已存在：说明前端已用 auth.signUp 建好号（带密码），这里只负责发码，
    // 走 magiclink 通道（与登录同源，验证方式一致）
    const type = exists ? 'magiclink' : 'signup';
    const link = await call(type);
    if (link.ok && link.data.email_otp) {
      return { otp: String(link.data.email_otp), created: !exists };
    }
    throw Object.assign(
      new Error(`注册验证码签发失败（${type} HTTP ${link.status}）`),
      { status: 500 },
    );
  }

  // login / reset：必须是已注册邮箱
  if (!exists) {
    throw Object.assign(new Error('该邮箱尚未注册，请先注册账号'), { status: 404 });
  }

  const type = scene === 'reset' ? 'recovery' : 'magiclink';
  const link = await call(type);
  if (link.ok && link.data.email_otp) {
    return { otp: String(link.data.email_otp), created: false };
  }
  throw Object.assign(
    new Error(`验证码签发失败（${type} HTTP ${link.status}）`),
    { status: 500 },
  );
}

// ===== 邮件发送：统一交给 mailer（模板化 + 品牌化 HTML + 审计日志）=====
// 验证码本体仍由 GoTrue 签发，本函数只负责触发投递
const TEMPLATE_SCENE: Record<string, string> = {
  register: 'register_code',
  login: 'login_code',
  reset: 'reset_code',
};

// 必须与 auth 服务的 GOTRUE_MAILER_OTP_EXP 保持一致（见 docker-compose.yml：300 秒 = 5 分钟），
// 否则邮件里写的有效期会和实际有效期不一致
const OTP_MINUTES = Number(Deno.env.get('OTP_MINUTES') || 5);

async function sendViaMailer(scene: string, to: string, code: string, minutes: number): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mailer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 网关会改写 Authorization/apikey，服务端互调统一用共享密钥头
      'x-mailer-secret': MAILER_SECRET,
    },
    body: JSON.stringify({
      action: 'send',
      scene,
      email: to,
      lang: 'zh',
      vars: { code, minutes: String(minutes) },
    }),
  });
  let data: Record<string, unknown> = {};
  try { data = await res.json(); } catch { /* 非 JSON */ }
  if (!res.ok || data.success === false) {
    throw new Error(typeof data?.error === 'string' ? data.error : `邮件服务返回 ${res.status}`);
  }
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405);
    const { action, email, scene = 'login' } = await req.json() as {
      action?: string; email?: string; scene?: string;
    };

    if (action === 'ping') {
      const info = await smtpPing();
      console.info(`[email-otp] ${requestId} ping ${info}`);
      return json({ success: true, smtp: info });
    }

    // 校验邮箱格式（下面所有 action 共用）
    if (action === 'check' || action === 'send') {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: '请输入有效的邮箱地址' }, 400);
      }
    }

    // 查询邮箱是否已注册（供前端在发送验证码前给出准确提示，不消耗发送额度）
    if (action === 'check') {
      const exists = await userExists(email!.trim().toLowerCase());
      return json({ success: true, exists });
    }

    if (action !== 'send') return json({ error: '未知操作' }, 400);
    const mail = email!.trim().toLowerCase();

    const last = await lastSentAt(mail, scene);
    if (last && Date.now() - last < RESEND_INTERVAL_SECONDS * 1000) {
      const wait = Math.ceil((RESEND_INTERVAL_SECONDS * 1000 - (Date.now() - last)) / 1000);
      return json({ error: `发送太频繁，请 ${wait} 秒后再试` }, 429);
    }
    if ((await countToday(mail)) >= DAILY_LIMIT_PER_EMAIL) {
      return json({ error: '今日验证码发送次数已达上限，请稍后再试' }, 429);
    }

    const { otp, created } = await issueOtp(mail, scene);

    // 统一走 mailer：模板由后台可编辑，此处只传业务变量
    try {
      await sendViaMailer(TEMPLATE_SCENE[scene] ?? 'login_code', mail, otp, OTP_MINUTES);
    } catch (e) {
      console.error(`[email-otp] ${requestId} 发信失败: ${e instanceof Error ? e.message : String(e)}`);
      return json({ error: e instanceof Error ? e.message : '邮件发送失败' }, 502);
    }

    await logSent(mail, scene);
    console.info(`[email-otp] ${requestId} 已向 ${mail} 发送 ${scene} 验证码（新用户=${created}）`);
    return json({ success: true, ttl: 600, isNewUser: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = typeof (err as { status?: number })?.status === 'number'
      ? (err as { status: number }).status
      : 500;
    console.error(`[email-otp] ${requestId} 异常(${status}): ${message}`);
    return json({ error: message }, status);
  }
});
