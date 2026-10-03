// 统一邮件发送服务 —— 模板化、双语言、变量插值、品牌化 HTML
//
// 设计要点：
// 1) 模板从 public.email_templates 读取（scene + lang），改文案不必重新发版
// 2) 变量用 ${var} 语法，服务端正则替换（不做任何 eval/evaluate，杜绝注入）
//    · 未知变量保持原样输出，并在日志里列出，方便后台发现模板笔误
// 3) DB 无模板 / 被禁用 / 渲染异常 → 自动回退内置兜底模板，保证关键邮件（验证码）永远发得出去
// 4) 每次发送写入 email_send_logs，同时承担「同场景同收件人去重」职责，
//    避免登录提醒、额度提醒这类高频场景刷屏
//
// 接口：
//   POST { action: "send",    scene, email, lang?, vars?, dedupeHours? }  → 发送
//   POST { action: "preview", scene, lang?, vars? }                       → 只渲染不发送（后台在线预览）
//   POST { action: "cron",    scene }                                     → 批量扫描触发（到期提醒）
//   POST { action: "ping" }                                               → SMTP 连通性自测

const SMTP_HOST = Deno.env.get('SMTP_HOST') || 'smtp.qq.com';
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') || 465);
const SMTP_USER = Deno.env.get('SMTP_USER') || '';
const SMTP_PASS = Deno.env.get('SMTP_PASS') || '';
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER;
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') || 'Thalvior ERP';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SITE_URL = Deno.env.get('SITE_URL') || 'https://thalvior.icu';
const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL') || Deno.env.get('SMTP_USER') || 'thalvior@foxmail.com';

// 服务端互调共享密钥（见 docker-compose.yml functions.environment.MAILER_SECRET）
const MAILER_SECRET = Deno.env.get('MAILER_SECRET') || '';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

async function smtpSend(to: string, subject: string, html: string): Promise<void> {
  if (!SMTP_USER || !SMTP_PASS) throw new Error('SMTP 账号未配置');
  const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
  try {
    const greeting = await readResponse(conn);
    if (!greeting.startsWith('220')) throw new Error(`SMTP 握手失败: ${greeting.slice(0, 80)}`);

    let r = await smtpCmd(conn, 'EHLO thalvior.icu');
    if (!r.startsWith('250')) throw new Error(`EHLO 失败: ${r.slice(0, 80)}`);

    r = await smtpCmd(conn, 'AUTH LOGIN');
    if (!r.startsWith('334')) throw new Error(`AUTH 握手失败: ${r.slice(0, 80)}`);
    r = await smtpCmd(conn, utf8ToBase64(SMTP_USER));
    if (!r.startsWith('334')) throw new Error(`用户名被拒: ${r.slice(0, 80)}`);
    r = await smtpCmd(conn, utf8ToBase64(SMTP_PASS));
    if (!r.startsWith('235')) throw new Error(`密码被拒: ${r.slice(0, 80)}`);

    r = await smtpCmd(conn, `MAIL FROM:<${SMTP_FROM}>`);
    if (!r.startsWith('250')) throw new Error(`发件人被拒: ${r.slice(0, 80)}`);
    r = await smtpCmd(conn, `RCPT TO:<${to}>`);
    if (!r.startsWith('250')) throw new Error(`收件人被拒: ${r.slice(0, 80)}`);
    r = await smtpCmd(conn, 'DATA');
    if (!r.startsWith('354')) throw new Error(`DATA 被拒: ${r.slice(0, 80)}`);

    const raw = [
      `From: ${mimeHeaderValue(SMTP_FROM_NAME)} <${SMTP_FROM}>`,
      `To: <${to}>`,
      `Subject: ${mimeHeaderValue(subject)}`,
      'Date: ' + new Date().toUTCString(),
      `Message-ID: <${crypto.randomUUID()}@thalvior.icu>`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      utf8ToBase64(html).replace(/(.{76})/g, '$1\r\n'),
    ].join('\r\n');

    await conn.write(encoder.encode(raw + '\r\n.\r\n'));
    r = await readResponse(conn);
    if (!r.startsWith('250')) throw new Error(`邮件投递失败: ${r.slice(0, 80)}`);
    await smtpCmd(conn, 'QUIT').catch(() => '');
  } finally {
    try { conn.close(); } catch { /* noop */ }
  }
}

async function smtpPing(): Promise<string> {
  const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
  const greeting = await readResponse(conn);
  const ehlo = await smtpCmd(conn, 'EHLO thalvior.icu');
  await smtpCmd(conn, 'QUIT').catch(() => '');
  try { conn.close(); } catch { /* noop */ }
  return `greeting=${greeting.split('\r\n')[0]} | ehlo=${ehlo.split('\r\n')[0]}`;
}

// ===== 模板渲染 =====
// 只认 ${identifier} 形式，未知变量保持原样（便于发现模板笔误）
function renderTemplate(
  tpl: string,
  vars: Record<string, string>,
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = tpl.replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
    unresolved.push(key);
    return match;
  });
  return { text, unresolved: [...new Set(unresolved)] };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 品牌化邮件外壳：内联样式 + table 布局，兼容 QQ 邮箱 / Outlook
function wrapHtml(bodyText: string, lang: string): string {
  const footerNote = lang === 'en'
    ? 'This is an automated message, please do not reply directly.'
    : '本邮件由系统自动发送，请勿直接回复。';
  const supportLabel = lang === 'en' ? 'Support' : '客服邮箱';
  const bodyHtml = escapeHtml(bodyText)
    .replace(/\n/g, '<br/>')
    .replace(/—/g, '&mdash;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6f9;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.08);">
    <tr>
      <td style="padding:22px 28px;background:linear-gradient(135deg,#1e3a8a,#2563eb);">
        <span style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:.5px;">Thalvior ERP</span>
      </td>
    </tr>
    <tr>
      <td style="padding:26px 28px;color:#1f2937;font-size:14px;line-height:1.85;">
        ${bodyHtml}
      </td>
    </tr>
    <tr>
      <td style="padding:16px 28px 22px;border-top:1px solid #eef1f5;color:#9ca3af;font-size:12px;line-height:1.7;">
        ${footerNote}<br/>
        ${supportLabel}: <a href="mailto:${SUPPORT_EMAIL}" style="color:#6b7280;">${SUPPORT_EMAIL}</a><br/>
        &copy; ${new Date().getFullYear()} Thalvior &middot; <a href="${SITE_URL}" style="color:#6b7280;">${SITE_URL}</a>
      </td>
    </tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

// ===== 内置兜底模板（DB 缺失/异常时使用；与库内默认文案保持一致）=====
type TemplateRow = { subject: string; body: string };
const BUILTIN: Record<string, Record<string, TemplateRow>> = {
  welcome: {
    zh: { subject: '欢迎使用 Thalvior 跨境ERP', body: '尊敬的 ${userName}：\n\n恭喜您成功注册 Thalvior 跨境ERP系统。\n您的登录账号：${account}\n系统访问地址：${systemUrl}\n如有任何问题，欢迎联系客服咨询。' },
    en: { subject: 'Welcome to Thalvior Cross-border ERP', body: 'Dear ${userName},\n\nCongratulations! Your Thalvior Cross-border ERP account has been created successfully.\nLogin account: ${account}\nSystem URL: ${systemUrl}' },
  },
  subscription_activated: {
    zh: { subject: '【Thalvior】您的会员套餐已开通成功', body: '尊敬的 ${userName}：\n\n您购买的会员套餐已成功开通。\n套餐名称：${packageName}\n有效期：${startDate} — ${endDate}\nAI剩余可用额度：${aiTokenCount}' },
    en: { subject: '【Thalvior】Your membership plan is now active', body: 'Dear ${userName},\n\nPlan: ${packageName}\nValidity: ${startDate} — ${endDate}\nRemaining AI credits: ${aiTokenCount}' },
  },
  membership_expiring: {
    zh: { subject: '【Thalvior】您的会员套餐即将到期', body: '尊敬的 ${userName}：\n\n您的会员套餐将于 ${expireDate} 到期。\n到期后会员专属功能与 AI 额度权益将暂停使用。\n\n续费：${systemUrl}/subscription' },
    en: { subject: '【Thalvior】Your membership plan is about to expire', body: 'Dear ${userName},\n\nYour plan will expire on ${expireDate}.\nRenew here: ${systemUrl}/subscription' },
  },
  login_alert: {
    zh: { subject: '【Thalvior】账号登录安全提醒', body: '尊敬的 ${userName}：\n\n您的账号于 ${loginTime} 在 ${loginIp} 地址登录 Thalvior 系统。\n\n如非本人操作，请立即登录系统修改密码。' },
    en: { subject: '【Thalvior】Account login security notice', body: 'Dear ${userName},\n\nYour account was signed in at ${loginTime} from IP ${loginIp}.' },
  },
  quota_exhausted: {
    zh: { subject: '【Thalvior】您的AI调用额度已耗尽', body: '尊敬的 ${userName}：\n\n您的 AI 调用额度已全部耗尽。\n\n充值：${systemUrl}/subscription' },
    en: { subject: '【Thalvior】Your AI credits have been used up', body: 'Dear ${userName},\n\nYour AI credits have been fully used up.\nTop up: ${systemUrl}/subscription' },
  },
  register_code: {
    zh: { subject: '【Thalvior】注册邮箱验证码', body: '尊敬的用户：\n\n您正在注册 Thalvior 跨境ERP，本次验证码：${code}\n验证码有效期${minutes}分钟，请尽快完成验证。\n如非本人操作，请忽略此邮件。' },
    en: { subject: '【Thalvior】Registration email verification code', body: 'Dear user,\n\nYour verification code: ${code}\nValid for ${minutes} minutes.\nIf this was not you, please ignore this email.' },
  },
};

// ===== 读取模板（DB 优先，失败回退内置）=====
async function loadTemplate(scene: string, lang: string): Promise<{ tpl: TemplateRow; fallback: boolean }> {
  const fallback = () => {
    const set = BUILTIN[scene] ?? {};
    return { tpl: set[lang] ?? set.zh ?? { subject: 'Thalvior ERP', body: '' }, fallback: true };
  };
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/email_templates?scene=eq.${encodeURIComponent(scene)}&lang=eq.${encodeURIComponent(lang)}&enabled=eq.true&select=subject,body&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!res.ok) return fallback();
    const rows = await res.json();
    if (Array.isArray(rows) && rows.length > 0 && rows[0].subject && rows[0].body) {
      return { tpl: { subject: String(rows[0].subject), body: String(rows[0].body) }, fallback: false };
    }
    return fallback();
  } catch {
    return fallback();
  }
}

// ===== 自动补全公共变量 =====
async function resolveBaseVars(email: string, userId?: string): Promise<Record<string, string>> {
  const vars: Record<string, string> = {
    systemUrl: SITE_URL,
    supportEmail: SUPPORT_EMAIL,
    year: String(new Date().getFullYear()),
    account: email,
    userName: email.split('@')[0] || '用户',
  };
  // 用户名优先取 profiles.username
  try {
    if (userId) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=username&limit=1`, {
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows[0]?.username) vars.userName = String(rows[0].username);
      }
    }
  } catch { /* 忽略 */ }
  return vars;
}

// ===== 去重：同场景同收件人在窗口期内只发一次 =====
async function recentlySent(scene: string, email: string, hours: number): Promise<boolean> {
  if (!hours) return false;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/email_send_logs?scene=eq.${encodeURIComponent(scene)}&recipient=eq.${encodeURIComponent(email)}&success=eq.true&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
    );
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function writeLog(entry: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/email_send_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(entry),
  }).catch(() => undefined);
}

// ===== 调用身份解析 =====
// 重要：本机 Supabase 网关会改写 Authorization / apikey 两个头（实测 193 字符的 JWT
// 到达函数时只剩 32 字符），所以不能依赖它们判断身份。改为两套可靠通道：
//   · 服务端互调 → 自定义头 x-mailer-secret（与环境变量 MAILER_SECRET 比对）
//   · 前端用户   → 令牌放在请求体 accessToken（避开自定义头可能触发的 CORS 预检）
// 安全约束：服务端可发任意收件人；登录用户只能发给自己邮箱，防止被当邮件轰炸器
async function resolveCaller(req: Request, bodyToken?: unknown): Promise<{ isService: boolean; email?: string; userId?: string }> {
  const secret = req.headers.get('x-mailer-secret') || '';
  if (MAILER_SECRET && secret === MAILER_SECRET) return { isService: true };

  const token = (typeof bodyToken === 'string' ? bodyToken : '').trim();
  if (!token) return { isService: false };
  if (token === SERVICE_ROLE_KEY) return { isService: true };

  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SERVICE_ROLE_KEY },
    });
    if (!r.ok) return { isService: false };
    const u = (await r.json()) as { email?: string; id?: string };
    return { isService: false, email: u.email?.toLowerCase(), userId: u.id };
  } catch {
    return { isService: false };
  }
}

// 纯日期格式（YYYY-MM-DD）：到期日这类变量不应带时分秒
function fmtDay(d: Date | string): string {
  const dt = typeof d === 'string' ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function fmtDate(d: Date | string | undefined): string {
  if (!d) return '-';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }).replace(/\//g, '-');
}

// ===== 渲染一封邮件（send 与 preview 共用）=====
async function renderMail(
  scene: string,
  email: string,
  lang: string,
  inputVars: Record<string, string>,
  userId?: string,
) {
  const baseVars = await resolveBaseVars(email, userId);
  const vars: Record<string, string> = { ...baseVars, ...inputVars };
  const { tpl, fallback } = await loadTemplate(scene, lang);
  const subjectRendered = renderTemplate(tpl.subject, vars);
  const bodyRendered = renderTemplate(tpl.body, vars);
  const unresolved = [...new Set([...subjectRendered.unresolved, ...bodyRendered.unresolved])];
  return {
    subject: subjectRendered.text,
    body: bodyRendered.text,
    html: wrapHtml(bodyRendered.text, lang),
    fallback,
    unresolved,
  };
}

// ===== 到期提醒批量扫描（供服务器 crontab 每日调用）=====
async function runMembershipExpiring(): Promise<Record<string, unknown>> {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/subscriptions?status=eq.active&expires_at=gte.${encodeURIComponent(now.toISOString())}&expires_at=lte.${encodeURIComponent(soon.toISOString())}&select=user_id,plan_name,expires_at`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } },
  );
  if (!res.ok) return { error: '查询订阅失败' };
  const rows = (await res.json()) as Array<{ user_id: string; plan_name: string; expires_at: string }>;

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    // 取用户邮箱
    const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${row.user_id}`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
    });
    if (!uRes.ok) { failed++; continue; }
    const u = await uRes.json() as { email?: string };
    if (!u.email) { failed++; continue; }

    // 7 天内同场景只提醒一次
    if (await recentlySent('membership_expiring', u.email, 7 * 24)) { skipped++; continue; }

    try {
      const mail = await renderMail(
        'membership_expiring',
        u.email,
        'zh',
        { packageName: row.plan_name, expireDate: fmtDay(row.expires_at) },
        row.user_id,
      );
      await smtpSend(u.email, mail.subject, mail.html);
      await writeLog({
        scene: 'membership_expiring',
        recipient: u.email,
        lang: 'zh',
        subject: mail.subject,
        render_ok: mail.unresolved.length === 0,
        fallback: mail.fallback,
        success: true,
      });
      sent++;
    } catch (e) {
      await writeLog({
        scene: 'membership_expiring',
        recipient: u.email,
        lang: 'zh',
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }
  }
  return { scanned: rows.length, sent, skipped, failed };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    if (req.method !== 'POST') return json({ error: '仅支持 POST' }, 405);
    const body = await req.json() as {
      action?: string;
      scene?: string;
      email?: string;
      lang?: string;
      userId?: string;
      dedupeHours?: number;
      vars?: Record<string, string>;
    };
    const { action, scene, email, lang = 'zh', userId, dedupeHours, vars = {} } = body;

    if (action === 'ping') {
      const info = await smtpPing();
      return json({ success: true, smtp: info });
    }

    if (!scene) return json({ error: '缺少 scene' }, 400);

    const caller = await resolveCaller(req, (body as { accessToken?: string }).accessToken);

    // 系统内置模板原文（后台「载入默认文案」用，避免前端再维护一份相同内容）
    if (action === 'builtin') {
      const set = BUILTIN[scene] ?? {};
      const rows = Object.entries(set).map(([lang, v]) => ({ lang, subject: v.subject, body: v.body }));
      return json({ success: true, builtin: rows });
    }

    // 在线预览：只渲染，不发信（需登录或服务角色）
    if (action === 'preview') {
      if (!caller.isService && !caller.email) return json({ error: '未授权' }, 401);
      const mail = await renderMail(scene, email || 'preview@example.com', lang, vars, userId);
      return json({
        success: true,
        subject: mail.subject,
        body: mail.body,
        html: mail.html,
        fallback: mail.fallback,
        unresolved: mail.unresolved,
      });
    }

    if (action === 'cron') {
      if (!caller.isService) return json({ error: '定时任务仅允许服务端调用' }, 403);
      if (scene !== 'membership_expiring') return json({ error: '该场景不支持定时批量' }, 400);
      const result = await runMembershipExpiring();
      console.info(`[mailer] ${requestId} cron membership_expiring ${JSON.stringify(result)}`);
      return json({ success: true, ...result });
    }

    if (action !== 'send') return json({ error: '未知操作' }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: '请输入有效的邮箱地址' }, 400);
    }
    const mail = email.trim().toLowerCase();

    // 非服务端调用只能发给自己的邮箱
    if (!caller.isService) {
      if (!caller.email) return json({ error: '未授权' }, 401);
      if (caller.email !== mail) return json({ error: '无权向该邮箱发送邮件' }, 403);
    }

    // 去重（默认不开启；调用方可按场景指定）
    if (dedupeHours && (await recentlySent(scene, mail, dedupeHours))) {
      return json({ success: true, skipped: true, reason: `${dedupeHours} 小时内已发送过同场景邮件` });
    }

    // 登录安全通知：时间与 IP 由服务端补全，前端不需要关心
    const finalVars: Record<string, string> = { ...(vars || {}) };
    if (scene === 'login_alert') {
      finalVars.loginTime ??= fmtDate(new Date());
      finalVars.loginIp ??=
        req.headers.get('cf-connecting-ip') ||
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        '未知';
    }

    const rendered = await renderMail(scene, mail, lang, finalVars, userId || caller.userId);
    try {
      await smtpSend(mail, rendered.subject, rendered.html);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await writeLog({
        scene, recipient: mail, lang, subject: rendered.subject,
        render_ok: rendered.unresolved.length === 0,
        fallback: rendered.fallback,
        success: false, error: msg,
      });
      console.error(`[mailer] ${requestId} 发信失败 ${scene} → ${mail}: ${msg}`);
      return json({ error: msg }, 502);
    }

    await writeLog({
      scene, recipient: mail, lang, subject: rendered.subject,
      render_ok: rendered.unresolved.length === 0,
      fallback: rendered.fallback,
      success: true,
    });
    if (rendered.unresolved.length > 0) {
      console.warn(`[mailer] ${requestId} 模板存在未解析变量 ${scene}: ${rendered.unresolved.join(',')}`);
    }
    console.info(`[mailer] ${requestId} 已发送 ${scene} → ${mail}（兜底模板=${rendered.fallback}）`);
    return json({ success: true, fallback: rendered.fallback, unresolved: rendered.unresolved });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[mailer] ${requestId} 异常: ${message}`);
    return json({ error: message }, 500);
  }
});
