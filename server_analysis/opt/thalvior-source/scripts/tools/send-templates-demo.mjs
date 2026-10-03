// 把用户指定的 6 套邮件模板真实重发到测试邮箱，用于人工查看渲染效果
// 经服务器内网调用 mailer（service_role + x-mailer-secret），不把密钥暴露到公网
import { execFileSync } from "node:child_process";

// 服务器 SSH 密码从环境变量注入，禁止硬编码
const SSH_PASSWORD = process.env.SSH_PASSWORD ?? "";

const MAIL = "thalvior@foxmail.com";

function callFn(fn, payload) {
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

// 用户指定的 6 套模板（顺序与文案来源一致）
const LIST = [
  {
    scene: "welcome",
    name: "1. 注册成功模板",
    vars: { userName: "陈晓明", account: "chenxm@foxmail.com", systemUrl: "https://thalvior.icu" },
  },
  {
    scene: "subscription_activated",
    name: "2. 订阅套餐开通模板",
    vars: {
      userName: "陈晓明",
      packageName: "专业版年费套餐",
      startDate: "2026-09-26",
      endDate: "2027-09-26",
      aiTokenCount: "12000",
      systemUrl: "https://thalvior.icu",
    },
  },
  {
    scene: "membership_expiring",
    name: "3. 会员到期提醒模板",
    vars: {
      userName: "陈晓明",
      packageName: "专业版年费套餐",
      expireDate: "2026-10-03",
      systemUrl: "https://thalvior.icu",
    },
  },
  {
    scene: "login_alert",
    name: "4. 账号登录安全通知模板",
    vars: {
      userName: "陈晓明",
      loginTime: "2026-09-26 10:05:00",
      loginIp: "203.0.113.42",
      systemUrl: "https://thalvior.icu",
    },
  },
  {
    scene: "quota_exhausted",
    name: "5. AI 额度耗尽提醒模板",
    vars: { userName: "陈晓明", systemUrl: "https://thalvior.icu" },
  },
  {
    scene: "register_code",
    name: "6. 注册验证码模板",
    vars: { code: "482913", minutes: "5" },
  },
];

console.log(`收件人：${MAIL}\n`);
for (const item of LIST) {
  const r = callFn("mailer", {
    action: "send",
    scene: item.scene,
    email: MAIL,
    lang: "zh",
    vars: item.vars,
  });
  console.log(
    `${r.success ? "✅" : "❌"} ${item.name.padEnd(22)} scene=${item.scene.padEnd(24)} ` +
      `subject=${r.subject ?? "-"} ${r.error ? "err=" + r.error : ""}${r.fallback ? " (fallback)" : ""}`,
  );
  await new Promise((res) => setTimeout(res, 2500));
}
console.log("\n全部完成，请到收件箱查看。");
