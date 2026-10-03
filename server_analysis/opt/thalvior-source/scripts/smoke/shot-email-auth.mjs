// 取证截图：邮箱验证码登录 / 邮箱注册 / 客服咨询面板
import { chromium } from "playwright-core";

const BASE = "https://thalvior.icu";
const MAIL = "thalvior@foxmail.com";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

// 1) 登录页 · 验证码登录（邮箱态 + 已发送提示）
const p1 = await ctx.newPage();
await p1.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
await p1.waitForTimeout(2500);
await p1.getByRole("button", { name: "验证码登录" }).click();
await p1.waitForTimeout(400);
await p1.fill("#account", MAIL);
await p1.getByRole("button", { name: /获取验证码|^\d+s$/ }).click();
await p1.waitForTimeout(4000);
await p1.screenshot({ path: "/workspace/邮箱登录_验证码档位.png" });
console.log("1 登录页验证码档位:", (await p1.locator("body").innerText()).includes("验证码已发送至") ? "已发送" : "频控/未发送");

// 2) 注册页 · 已注册提示
const p2 = await ctx.newPage();
await p2.goto(`${BASE}/register`, { waitUntil: "domcontentloaded", timeout: 90000 });
await p2.waitForTimeout(2500);
await p2.fill("#account", MAIL);
await p2.fill("#password", "test123456");
await p2.getByRole("button", { name: /注册并发送验证码/ }).click();
await p2.waitForTimeout(5000);
await p2.screenshot({ path: "/workspace/邮箱注册_已注册提示.png" });

// 3) 客服咨询面板（登录后）
const p3 = await ctx.newPage();
await p3.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
await p3.waitForTimeout(2500);
await p3.fill("#account", MAIL);
await p3.fill("#password", "Thalvior#2026");
await p3.getByRole("button", { name: "登录", exact: true }).click();
await p3.waitForTimeout(6000);
await p3.locator('button[aria-label="客服咨询"]').click();
await p3.waitForTimeout(1200);
await p3.locator("textarea").first().fill("店铺授权一直提示失败，订单同步也有延迟，麻烦帮忙排查。");
await p3.waitForTimeout(800);
await p3.screenshot({ path: "/workspace/客服咨询_邮箱通道.png" });
console.log("3 客服面板已截图");

await browser.close();
