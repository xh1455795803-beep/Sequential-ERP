// 验证：refresh 请求失败一次，前端是否会被直接踢回 /login
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

await page.goto("https://thalvior.icu/login", { waitUntil: "networkidle", timeout: 30000 });
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(5000);
console.log("登录后:", page.url());

// 让 token 过期
await page.evaluate(() => {
  const k = Object.keys(localStorage).filter((x) => x.includes("auth-token"))[0];
  const raw = JSON.parse(localStorage.getItem(k));
  raw.expires_at = Math.floor(Date.now() / 1000) - 60;
  localStorage.setItem(k, JSON.stringify(raw));
});

// 拦截 refresh 请求，第一次失败（模拟网络抖动），之后放行
let failCount = 0;
await page.route("**/auth/v1/token**", async (route) => {
  const req = route.request();
  if (req.method() === "POST" && failCount === 0) {
    failCount++;
    console.log("   [拦截] 第 1 次 refresh 请求 -> 强制返回 500");
    return route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' });
  }
  console.log("   [放行] refresh 请求");
  return route.continue();
});

console.log("\n== reload /dashboard（refresh 第一次会失败）==");
await page.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(6000);
console.log("最终 URL:", page.url());
console.log("判定:", page.url().includes("/dashboard") ? "✅ 扛住了偶发失败" : "❌ 被踢回登录 —— 这就是用户遇到的现象");
console.log("localStorage 残留:", await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("auth-token"))));

await browser.close();
