// 诊断「7 天免密登录还是要来回重新登录」
// 手法：登录后把 access token 的 expires_at 改到过去（模拟 1 小时过期），
//       再 reload，观察 supabase-js 是否能用 refresh_token 静默续期。
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

// 捕获 auth 相关网络请求
const authCalls = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/auth/v1/")) authCalls.push(`${r.method()} ${u.replace("https://thalvior.icu", "")}`);
});
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/auth/v1/token")) {
    authCalls.push(`   -> token 响应 ${r.status()}`);
  }
});
page.on("console", (m) => {
  if (/token|refresh|session|401|invalid/i.test(m.text())) console.log("   [console]", m.text().slice(0, 160));
});

console.log("== 1. 登录（勾选 7 天免登录）==");
await page.goto("https://thalvior.icu/login", { waitUntil: "networkidle", timeout: 30000 });
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(5000);
console.log("   登录后 URL:", page.url());

const readToken = () =>
  page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.includes("auth-token"));
    if (!keys.length) return null;
    const raw = JSON.parse(localStorage.getItem(keys[0]));
    return {
      key: keys[0],
      hasRefresh: !!raw.refresh_token,
      expires_at: raw.expires_at,
      nowSec: Math.floor(Date.now() / 1000),
    };
  });

const before = await readToken();
console.log("   localStorage token:", JSON.stringify(before));

console.log("\n== 2. 把 access token 改成已过期（模拟 1 小时后）==");
await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.includes("auth-token"));
  const raw = JSON.parse(localStorage.getItem(keys[0]));
  raw.expires_at = Math.floor(Date.now() / 1000) - 60; // 60 秒前就过期
  localStorage.setItem(keys[0], JSON.stringify(raw));
});
console.log("   已改写 expires_at =", (await readToken())?.expires_at);

console.log("\n== 3. reload /dashboard，观察是否静默续期 ==");
authCalls.length = 0;
await page.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(6000);
console.log("   reload 后 URL:", page.url());
console.log("   auth 请求:", authCalls.filter((c) => c.includes("token")).join("\n            ") || "(无)");

const after = await readToken();
console.log("   token 变化:", JSON.stringify(after));
console.log("   判定:", page.url().includes("/dashboard") ? "✅ 仍在登录态（refresh 生效）" : "❌ 被踢回登录（refresh 失效）");

console.log("\n== 4. 并发双标签页 refresh（检测 refresh token 轮转冲突）==");
// 先把 token 再次改过期，然后两个标签页同时加载
await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => k.includes("auth-token"));
  const raw = JSON.parse(localStorage.getItem(keys[0]));
  raw.expires_at = Math.floor(Date.now() / 1000) - 60;
  localStorage.setItem(keys[0], JSON.stringify(raw));
});
const p2 = await ctx.newPage();
const p3 = await ctx.newPage();
await Promise.all([
  p2.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 }),
  p3.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 }),
]);
await p2.waitForTimeout(3000);
await p3.waitForTimeout(3000);
console.log("   标签页2:", p2.url());
console.log("   标签页3:", p3.url());

await browser.close();
