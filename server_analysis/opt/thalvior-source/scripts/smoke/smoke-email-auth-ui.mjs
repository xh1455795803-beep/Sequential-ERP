// 邮箱登录/注册 + 客服咨询 端到端 UI 回归
// 1) 登录页「验证码登录」支持邮箱：真实发信 → 收信取码 → 错误码被拒 → 正确码登录进后台
// 2) 注册页邮箱重复注册给出中文提示
// 3) 客服面板改为「客服咨询 + 邮箱通道」，不再消耗 AI token
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";

const BASE = "https://thalvior.icu";
const MAIL = "thalvior@foxmail.com";
const results = [];
const push = (n, ok, d = "") => {
  results.push([n, ok, d]);
  console.log(`${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// ---------- A. 登录页邮箱验证码登录 ----------
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 40000 });
await page.waitForTimeout(2500);

// A1 切到验证码登录
await page.getByRole("button", { name: "验证码登录" }).click();
await page.waitForTimeout(400);
const codeTabVisible = await page.locator("#account").isVisible();
push("A1-验证码登录档位出现账号输入框", codeTabVisible);

// A2 输入邮箱后提示语切换为邮箱
await page.fill("#account", MAIL);
await page.waitForTimeout(400);
const hintText = await page.locator("#account").locator("xpath=../following-sibling::p").innerText().catch(() => "");
push("A2-输入邮箱后提示为邮箱通道", /邮箱/.test(hintText), hintText.slice(0, 40));

// A3 点获取验证码（含 60 秒频控重试）
let sent = false;
let sendDetail = "";
for (let i = 0; i < 3; i++) {
  await page.getByRole("button", { name: /获取验证码|^\d+s$/ }).click();
  await page.waitForTimeout(3500);
  const body = await page.locator("body").innerText();
  if (/验证码已发送至/.test(body)) { sent = true; sendDetail = (body.match(/验证码已发送至[^\n]*/) || [""])[0]; break; }
  if (/发送太频繁|请 \d+ 秒后再试/.test(body)) {
    const wait = Number((body.match(/请 (\d+) 秒后再试/) || [0, 45])[1]) + 3;
    sendDetail = `频控生效，等待 ${wait}s 重试`;
    await page.waitForTimeout(wait * 1000);
    continue;
  }
  sendDetail = body.slice(0, 120);
  break;
}
push("A3-邮箱验证码真实发送", sent, sendDetail.slice(0, 90));

// A4 收件箱取码
let code = "";
if (sent) {
  try {
    const out = execFileSync("python3", ["scripts/ops/mail-read-code.py"], { encoding: "utf8", timeout: 120000 });
    code = (out.match(/RESULT_CODE=(\d{6})/) || [])[1] || "";
  } catch { /* ignore */ }
}
push("A4-收件箱收到验证码", !!code, code ? `验证码 ${code}` : "未取到");

// A5 错误验证码被拒绝
if (code) {
  await page.fill("#token", code === "000000" ? "111111" : "000000");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(4000);
  const body = await page.locator("body").innerText();
  push("A5-错误验证码被拒绝", /验证码错误或已过期|Invalid/.test(body), (body.match(/验证码错误或已过期/) || [""])[0]);

  // A6 正确验证码登录进后台
  await page.fill("#token", code);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(6000);
  const url = page.url();
  push("A6-正确验证码登录进入后台", /dashboard/.test(url), url.replace(BASE, ""));
}

// ---------- B. 客服咨询面板（邮箱通道） ----------
if (/dashboard/.test(page.url())) {
  const fab = page.locator('button[aria-label="客服咨询"]');
  const hasFab = await fab.count();
  push("B1-右下角客服咨询入口存在", hasFab > 0, hasFab ? await fab.getAttribute("title") : "未找到");
  if (hasFab) {
    await fab.click();
    await page.waitForTimeout(1200);
    const panel = await page.locator("body").innerText();
    push("B2-面板标题为客服咨询", /客服咨询/.test(panel));
    push("B3-展示客服邮箱 thalvior@foxmail.com", panel.includes("thalvior@foxmail.com"));
    push("B4-无 AI 智能客服残留文案", !/智能客服|正在输入|转人工/.test(panel));

    // 未填描述时按钮禁用
    const genBtn = page.getByRole("button", { name: "生成咨询邮件" });
    const disabled = await genBtn.isDisabled();
    push("B5-未填描述时生成邮件按钮禁用", disabled);

    // 填写描述后按钮可用，并出现 mailto
    await page.locator("textarea").first().fill("测试：订单同步失败，请协助排查");
    await page.waitForTimeout(800);
    const enabled = !(await genBtn.isDisabled());
    push("B6-填写描述后按钮可用", enabled);

    const mailto = page.locator('a[href^="mailto:thalvior@foxmail.com"]');
    const mailtoCount = await mailto.count();
    push("B7-存在客服邮箱 mailto 直达链接", mailtoCount > 0, mailtoCount ? (await mailto.first().getAttribute("href")).slice(0, 60) : "");

    // 正文预览包含问题类型与描述
    const preview = await page.locator("textarea[readonly]").first().inputValue().catch(() => "");
    push("B8-邮件正文自动带问题类型与描述", /问题类型/.test(preview) && /订单同步失败/.test(preview), preview.split("\n")[0].slice(0, 50));
  }
}

// ---------- C. 注册页邮箱重复注册提示 ----------
const rp = await ctx.newPage();
await rp.goto(`${BASE}/register`, { waitUntil: "domcontentloaded", timeout: 40000 });
await rp.waitForTimeout(2500);
await rp.fill("#account", MAIL);
await rp.fill("#password", "test123456");
await rp.getByRole("button", { name: /注册并发送验证码/ }).click();
await rp.waitForTimeout(5000);
const rbody = await rp.locator("body").innerText();
push("C1-已注册邮箱给出中文提示", /该邮箱已注册，请直接登录/.test(rbody), (rbody.match(/该邮箱已注册[^\n]*/) || [rbody.slice(0, 60)])[0]);

// ---------- D. 未注册邮箱登录应被拦截（不建号、不发信） ----------
const dp = await ctx.newPage();
await dp.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 40000 });
await dp.waitForTimeout(2500);
await dp.getByRole("button", { name: "验证码登录" }).click();
await dp.waitForTimeout(400);
await dp.fill("#account", "definitely-not-registered-9527@thalvior.icu");
await dp.getByRole("button", { name: /获取验证码/ }).click();
await dp.waitForTimeout(4000);
const dbody = await dp.locator("body").innerText();
push("D1-未注册邮箱被拦截且提示先注册", /该邮箱尚未注册/.test(dbody), (dbody.match(/该邮箱尚未注册[^\n]*/) || [dbody.slice(0, 80)])[0]);

await browser.close();

const pass = results.filter((r) => r[1]).length;
console.log(`\n结果：${pass}/${results.length} 通过`);
if (pass !== results.length) process.exit(1);
