// 全新邮箱注册端到端（真实建号 + 真实收信 + 真实验证 + 密码可用）
// 前置：先把测试残留账号 thalvior@foxmail.com 删掉，保证走的是「全新注册」路径
import { chromium } from "playwright-core";

// 服务器 SSH 密码从环境变量注入，禁止硬编码
const SSH_PASSWORD = process.env.SSH_PASSWORD ?? "";
import { execFileSync } from "node:child_process";

const BASE = "https://thalvior.icu";
const MAIL = "thalvior@foxmail.com";
const PWD = "Thalvior#2026";
const results = [];
const push = (n, ok, d = "") => {
  results.push([n, ok, d]);
  console.log(`${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
};

// 0) 删除测试残留账号（真删，确保走全新注册链路）
try {
  const remote =
    "SRK=$(grep '^SERVICE_ROLE_KEY=' /opt/supabase/docker/.env | cut -d= -f2-) && " +
    "curl -s -X DELETE -H \"apikey: $SRK\" -H \"Authorization: Bearer $SRK\" " +
    "http://127.0.0.1:8000/auth/v1/admin/users/c8aa9080-4eb6-4452-829d-dcc2d776dcdb " +
    "-o /dev/null -w '%{http_code}'";
  const out = execFileSync(
    "sshpass",
    ["-p", SSH_PASSWORD, "ssh", "-o", "StrictHostKeyChecking=no", "ubuntu@43.133.232.81", remote],
    { encoding: "utf8", timeout: 60000 },
  );
  push("0-清理测试残留账号", /20[04]/.test(out.trim()), `HTTP ${out.trim()}`);
} catch (e) {
  push("0-清理测试残留账号", false, String(e).slice(0, 80));
}

// 1) 确认邮箱处于未注册状态
{
  const r = await fetch(`${BASE}/functions/v1/email-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw" },
    body: JSON.stringify({ action: "check", email: MAIL }),
  }).then((x) => x.json());
  push("1-邮箱当前为未注册状态", r.exists === false, JSON.stringify(r));
}

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/register`, { waitUntil: "domcontentloaded", timeout: 40000 });
await page.waitForTimeout(2500);

// 2) 填表并注册（含频控等待）
await page.fill("#account", MAIL);
await page.fill("#password", PWD);
await page.getByRole("button", { name: /注册并发送验证码/ }).click();
await page.waitForTimeout(6000);
let body = await page.locator("body").innerText();
if (/发送太频繁|请 \d+ 秒后再试/.test(body)) {
  const wait = Number((body.match(/请 (\d+) 秒后再试/) || [0, 45])[1]) + 5;
  await page.waitForTimeout(wait * 1000);
  await page.getByRole("button", { name: /注册并发送验证码/ }).click();
  await page.waitForTimeout(6000);
  body = await page.locator("body").innerText();
}
push("2-进入验证步骤并提示已发信", /验证码已发送至/.test(body), (body.match(/验证码已发送至[^\n]*/) || [body.slice(0, 90)])[0].slice(0, 80));

// 3) 收件箱取码
let code = "";
try {
  const out = execFileSync("python3", ["scripts/ops/mail-read-code.py"], { encoding: "utf8", timeout: 120000 });
  code = (out.match(/RESULT_CODE=(\d{6})/) || [])[1] || "";
} catch { /* ignore */ }
push("3-收件箱收到注册验证码", !!code, code ? `验证码 ${code}` : "未取到");

// 4) 填码完成注册
if (code && /验证码已发送至/.test(body)) {
  await page.fill("#token", code);
  await page.getByRole("button", { name: /完成注册/ }).click();
  await page.waitForTimeout(8000);
  const url = page.url();
  push("4-完成注册并进入后台", /dashboard/.test(url), url.replace(BASE, ""));
}

// 5) 用刚注册的邮箱 + 密码登录（验证密码确实写入）
{
  const lp = await ctx.newPage();
  await lp.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 40000 });
  await lp.waitForTimeout(2500);
  await lp.fill("#account", MAIL);
  await lp.fill("#password", PWD);
  await lp.getByRole("button", { name: "登录", exact: true }).click();
  await lp.waitForTimeout(6000);
  push("5-注册邮箱可用密码登录", /dashboard/.test(lp.url()), lp.url().replace(BASE, ""));
}

await browser.close();
const pass = results.filter((r) => r[1]).length;
console.log(`\n结果：${pass}/${results.length} 通过`);
if (pass !== results.length) process.exit(1);
