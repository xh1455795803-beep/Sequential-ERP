// 拉取 6 套模板的真实渲染 HTML，拼成一个本地预览页（桌面宽屏 + 移动端窄屏并排）
import { execFileSync } from "node:child_process";

// 服务器 SSH 密码从环境变量注入，禁止硬编码
const SSH_PASSWORD = process.env.SSH_PASSWORD ?? "";
import { writeFileSync } from "node:fs";

function callFn(payload) {
  const body = JSON.stringify(payload).replace(/'/g, "'\\''");
  const remote =
    "SEC=$(grep '^MAILER_SECRET=' /opt/supabase/docker/.env | cut -d= -f2- | tr -d '\\r') && " +
    "SRK=$(grep '^SERVICE_ROLE_KEY=' /opt/supabase/docker/.env | cut -d= -f2- | tr -d '\\r') && " +
    `curl -s -m 60 -X POST http://127.0.0.1:8000/functions/v1/mailer ` +
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

const LIST = [
  { scene: "welcome", name: "注册成功模板", vars: { userName: "陈晓明", account: "chenxm@foxmail.com" } },
  {
    scene: "subscription_activated",
    name: "订阅套餐开通模板",
    vars: { userName: "陈晓明", packageName: "专业版年费套餐", startDate: "2026-09-26", endDate: "2027-09-26", aiTokenCount: "12000" },
  },
  {
    scene: "membership_expiring",
    name: "会员到期提醒模板",
    vars: { userName: "陈晓明", packageName: "专业版年费套餐", expireDate: "2026-10-03" },
  },
  {
    scene: "login_alert",
    name: "账号登录安全通知模板",
    vars: { userName: "陈晓明", loginTime: "2026-09-26 10:05:00", loginIp: "203.0.113.42" },
  },
  { scene: "quota_exhausted", name: "AI 额度耗尽提醒模板", vars: { userName: "陈晓明" } },
  { scene: "register_code", name: "注册验证码模板", vars: { code: "482913", minutes: "5" } },
];

const blocks = [];
for (const item of LIST) {
  const r = callFn({ action: "preview", scene: item.scene, lang: "zh", vars: item.vars });
  if (!r.html) {
    console.log(`❌ ${item.scene} 预览失败`, r.error ?? r.raw ?? "");
    continue;
  }
  console.log(`✅ ${item.scene} — ${r.subject}`);
  const b64 = Buffer.from(r.html, "utf8").toString("base64");
  blocks.push(`
  <section class="card">
    <header>
      <div>
        <h2>${item.name}</h2>
        <p class="sub">scene: <code>${item.scene}</code></p>
      </div>
      <div class="subject">主题：${r.subject}</div>
    </header>
    <div class="pair">
      <div class="pane">
        <span class="tag">桌面端 640px</span>
        <iframe src="data:text/html;base64,${b64}" scrolling="yes"></iframe>
      </div>
      <div class="pane narrow">
        <span class="tag">手机端 375px</span>
        <iframe src="data:text/html;base64,${b64}" scrolling="yes"></iframe>
      </div>
    </div>
  </section>`);
}

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Thalvior 邮件模板渲染效果预览</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; background:#0f1115; color:#e6e8ee; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif; }
  .wrap { max-width:1240px; margin:0 auto; padding:32px 24px 64px; }
  h1 { font-size:22px; margin:0 0 6px; }
  .lead { color:#9aa3b2; font-size:13px; margin:0 0 28px; }
  .card { background:#171a21; border:1px solid #262b36; border-radius:14px; padding:18px; margin-bottom:22px; }
  .card header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:14px; }
  .card h2 { font-size:15px; margin:0 0 4px; }
  .sub { margin:0; font-size:12px; color:#79828f; }
  code { background:#222733; padding:1px 6px; border-radius:4px; color:#8ab4f8; font-size:12px; }
  .subject { font-size:12.5px; color:#c9d1de; background:#1d2230; border:1px solid #2b3140; border-radius:8px; padding:6px 12px; }
  .pair { display:flex; gap:16px; align-items:flex-start; flex-wrap:wrap; }
  .pane { flex:1 1 520px; min-width:320px; }
  .pane.narrow { flex:0 0 400px; min-width:340px; }
  .tag { display:inline-block; font-size:11px; color:#8b94a3; margin-bottom:6px; }
  iframe { width:100%; height:560px; border:1px solid #2b3140; border-radius:10px; background:#fff; display:block; }
  .pane.narrow iframe { max-width:375px; height:600px; }
  .foot { color:#79828f; font-size:12px; margin-top:26px; line-height:1.8; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Thalvior 系统邮件 · 渲染效果预览</h1>
  <p class="lead">以下为线上 mailer 服务实时渲染的真实邮件 HTML（变量已用样例数据填充），桌面端与手机端并排对照。同一批邮件已真实发送至 thalvior@foxmail.com。</p>
  ${blocks.join("\n")}
  <p class="foot">渲染链路：读取数据库 email_templates → ${"${变量}"} 插值 → 品牌化响应式外壳包装 → QQ 邮箱 SMTP 直连投递。<br/>后台「邮件模板」页可随时改文案、开关启用、预览与发送测试邮件，保存即生效，无需发版。</p>
</div>
</body>
</html>`;

writeFileSync("/workspace/邮件模板效果预览.html", html, "utf8");
console.log("\n已生成 /workspace/邮件模板效果预览.html");
