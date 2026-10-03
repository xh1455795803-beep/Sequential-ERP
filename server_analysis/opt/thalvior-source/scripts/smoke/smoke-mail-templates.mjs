// 邮件模板端到端回归：6 套场景真实发信 + 变量插值 + 中英双语 + 兜底 + 去重
// 用 service_role 经服务器内网调用（不把服务密钥暴露到公网）
import { execFileSync } from "node:child_process";

// 服务器 SSH 密码从环境变量注入，禁止硬编码
const SSH_PASSWORD = process.env.SSH_PASSWORD ?? "";

const MAIL = "thalvior@foxmail.com";
const results = [];
const push = (n, ok, d = "") => {
  results.push([n, ok, d]);
  console.log(`${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
};

// 经服务器内网调用 mailer / email-otp
function callFn(fn, payload, opts = {}) {
  const body = JSON.stringify(payload).replace(/'/g, "'\\''");
  const remote =
    "SEC=$(grep '^MAILER_SECRET=' /opt/supabase/docker/.env | cut -d= -f2- | tr -d '\\r') && " +
    "SRK=$(grep '^SERVICE_ROLE_KEY=' /opt/supabase/docker/.env | cut -d= -f2- | tr -d '\\r') && " +
    `curl -s -m 60 -X POST http://127.0.0.1:8000/functions/v1/${fn} ` +
    `-H "Content-Type: application/json" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" ` +
    `-H "x-mailer-secret: $SEC" ` +
    `-d '${body}'`;
  const out = execFileSync(
    "sshpass",
    ["-p", SSH_PASSWORD, "ssh", "-o", "StrictHostKeyChecking=no", "ubuntu@43.133.232.81", remote],
    { encoding: "utf8", timeout: 120000 },
  );
  try {
    return JSON.parse(out.trim());
  } catch {
    return { raw: out.trim().slice(0, 200) };
  }
}

// 读取收件箱最新一封
function readLatest(wait = 6) {
  const out = execFileSync("python3", ["scripts/ops/mail-latest.py", String(wait)], { encoding: "utf8", timeout: 180000 });
  const subject = (out.match(/LAST_SUBJECT=(.*)/) || [])[1] || "";
  const body = (out.match(/LAST_BODY=(.*)/) || [])[1] || "";
  return { subject, body: body.replace(/\\n/g, "\n") };
}

const SCENARIOS = [
  {
    key: "welcome",
    name: "注册成功欢迎邮件",
    vars: { userName: "陈晓明", account: "chenxm@foxmail.com" },
    expectSubject: "欢迎使用 Thalvior 跨境ERP",
    expectInBody: ["陈晓明", "chenxm@foxmail.com", "https://thalvior.icu"],
  },
  {
    key: "subscription_activated",
    name: "订阅套餐开通通知",
    vars: {
      userName: "陈晓明",
      packageName: "专业版年费套餐",
      startDate: "2026-09-26",
      endDate: "2027-09-26",
      aiTokenCount: "12000",
    },
    expectSubject: "【Thalvior】您的会员套餐已开通成功",
    expectInBody: ["陈晓明", "专业版年费套餐", "2026-09-26", "2027-09-26", "12000"],
  },
  {
    key: "membership_expiring",
    name: "会员到期提醒",
    vars: { userName: "陈晓明", packageName: "专业版年费套餐", expireDate: "2026-10-03" },
    expectSubject: "【Thalvior】您的会员套餐即将到期",
    expectInBody: ["陈晓明", "2026-10-03", "https://thalvior.icu/subscription"],
  },
  {
    key: "login_alert",
    name: "账号登录安全通知",
    vars: { userName: "陈晓明", loginTime: "2026-09-26 01:50:00", loginIp: "203.0.113.42" },
    expectSubject: "【Thalvior】账号登录安全提醒",
    expectInBody: ["陈晓明", "2026-09-26 01:50:00", "203.0.113.42"],
  },
  {
    key: "quota_exhausted",
    name: "AI额度耗尽提醒",
    vars: { userName: "陈晓明" },
    expectSubject: "【Thalvior】您的AI调用额度已耗尽",
    expectInBody: ["陈晓明", "https://thalvior.icu/subscription"],
  },
];

console.log("===== A. 六套模板真实发信 + 变量插值 =====\n");
for (const s of SCENARIOS) {
  const r = await callFn("mailer", {
    action: "send",
    scene: s.key,
    email: MAIL,
    lang: "zh",
    vars: s.vars,
  });
  if (r.success !== true) {
    push(`A-${s.name} 发送`, false, JSON.stringify(r).slice(0, 120));
    continue;
  }
  const mail = readLatest(7);
  const subjectOk = mail.subject.includes(s.expectSubject);
  const missing = s.expectInBody.filter((v) => !mail.body.includes(v));
  const unresolvedOk = Array.isArray(r.unresolved) && r.unresolved.length === 0;
  push(
    `A-${s.name}`,
    subjectOk && missing.length === 0 && unresolvedOk && r.fallback === false,
    `主题${subjectOk ? "✓" : "✗"} · 变量${missing.length === 0 ? "✓" : `✗ 缺 ${missing.join(",")}`} · 用库模板=${r.fallback === false ? "✓" : "✗"}`,
  );
}

console.log("\n===== B. 验证码模板（注册/登录走 email-otp → mailer）=====\n");
{
  const r = await callFn("email-otp", { action: "send", email: MAIL, scene: "login" });
  // 频控可能拦截，做一次等待重试
  let res = r;
  if (r.error && /频繁/.test(r.error)) {
    const sec = Number((String(r.error).match(/请 (\d+) 秒后再试/) || [0, 45])[1]) + 5;
    await new Promise((res2) => setTimeout(res2, sec * 1000));
    res = await callFn("email-otp", { action: "send", email: MAIL, scene: "login" });
  }
  if (res.success !== true) {
    push("B-登录验证码发送", false, JSON.stringify(res).slice(0, 120));
  } else {
    const mail = readLatest(7);
    const code = (mail.body.match(/验证码[：: ]*(\d{6})/) || [])[1] || "";
    push(
      "B-登录验证码邮件使用模板",
      mail.subject.includes("【Thalvior】登录邮箱验证码") && /验证码有效期5分钟/.test(mail.body) && !!code,
      `主题「${mail.subject}」· 码 ${code || "未取到"}`,
    );
  }
}

console.log("\n===== C. 英文模板 =====\n");
{
  const r = await callFn("mailer", {
    action: "send",
    scene: "welcome",
    email: MAIL,
    lang: "en",
    vars: { userName: "Frank Chen", account: "frank@foxmail.com" },
  });
  if (r.success !== true) {
    push("C-英文模板发送", false, JSON.stringify(r).slice(0, 120));
  } else {
    const mail = readLatest(7);
    push(
      "C-英文欢迎邮件渲染正确",
      mail.subject.includes("Welcome to Thalvior") && mail.body.includes("Frank Chen") && mail.body.includes("Login account:"),
      `主题「${mail.subject}」`,
    );
  }
}

console.log("\n===== D. 安全约束（匿名/越权必须被拦）=====\n");
{
  const anon = await fetch("https://thalvior.icu/functions/v1/mailer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw",
    },
    body: JSON.stringify({ action: "send", scene: "welcome", email: "victim@example.com" }),
  }).then((x) => x.json());
  push("D-匿名调用被拒绝", anon.error === "未授权" || anon.error === "无权向该邮箱发送邮件", JSON.stringify(anon).slice(0, 80));

  const previewAnon = await fetch("https://thalvior.icu/functions/v1/mailer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw",
    },
    body: JSON.stringify({ action: "cron", scene: "membership_expiring" }),
  }).then((x) => x.json());
  push("D-匿名触发定时任务被拒绝", !!previewAnon.error, JSON.stringify(previewAnon).slice(0, 80));
}

console.log("\n===== E. 去重机制（登录提醒不刷屏）=====\n");
{
  const r1 = await callFn("mailer", { action: "send", scene: "login_alert", email: MAIL, lang: "zh", vars: {}, dedupeHours: 24 });
  const r2 = await callFn("mailer", { action: "send", scene: "login_alert", email: MAIL, lang: "zh", vars: {}, dedupeHours: 24 });
  push("E-24 小时内重复发送被去重", r1.success === true && r2.skipped === true, `首次 ${JSON.stringify(r1).slice(0, 40)} · 二次 ${JSON.stringify(r2).slice(0, 60)}`);
}

const pass = results.filter((r) => r[1]).length;
console.log(`\n结果：${pass}/${results.length} 通过`);
if (pass !== results.length) process.exit(1);
