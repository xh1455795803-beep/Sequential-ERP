// 补充验证：
// E. 真正「关闭浏览器再打开」（导出 storageState 到新 context）——7 天免登录的核心承诺
// F. 退出登录必须真的登出（不能因为容错复核而登不掉）
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
const ok = (b) => (b ? "✅" : "❌");
const results = [];

async function login(page, remember) {
  await page.goto("https://thalvior.icu/login", { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#account", env.EMAIL);
  await page.fill("#password", env.PASSWORD);
  const checked = await page.evaluate(() => document.querySelector("#remember")?.getAttribute("data-state") === "checked");
  if (checked !== remember) await page.locator("#remember").click();
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(4500);
}

// ===== E：关闭浏览器再打开（勾选）=====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, true);
  results.push(["E1 勾选登录后进控制页", page.url().includes("/dashboard")]);

  // 模拟「关闭浏览器」：把 localStorage 快照下来，开一个全新浏览器上下文
  const state = await ctx.storageState();
  await ctx.close();

  const ctx2 = await browser.newContext({ storageState: state });
  const p2 = await ctx2.newPage();
  await p2.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 });
  await p2.waitForTimeout(5000);
  results.push(["E2 重开浏览器仍免登录（7 天免登录核心）", p2.url().includes("/dashboard")]);

  // 再把 access token 改成过期，重开一次：应能自动续期
  await p2.evaluate(() => {
    const k = Object.keys(localStorage).filter((x) => x.includes("auth-token"))[0];
    const raw = JSON.parse(localStorage.getItem(k));
    raw.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(k, JSON.stringify(raw));
  });
  const state2 = await ctx2.storageState();
  await ctx2.close();

  const ctx3 = await browser.newContext({ storageState: state2 });
  const p3 = await ctx3.newPage();
  await p3.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 });
  await p3.waitForTimeout(6000);
  results.push(["E3 token 过期后重开浏览器自动续期", p3.url().includes("/dashboard")]);
  await ctx3.close();
}

// ===== E'：不勾选 —— 重开浏览器应需重新登录 =====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, false);
  const state = await ctx.storageState();
  await ctx.close();

  const ctx2 = await browser.newContext({ storageState: state });
  const p2 = await ctx2.newPage();
  await p2.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 });
  await p2.waitForTimeout(5000);
  results.push(["E4 不勾选时重开浏览器需重新登录", p2.url().includes("/login")]);
  await ctx2.close();
}

// ===== F：退出登录必须真的登出 =====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, true);
  results.push(["F1 登录成功", page.url().includes("/dashboard")]);

  await page.locator("header button", { hasText: "退出登录" }).first().click().catch(async () => {
    // 先点头像展开菜单
    await page.locator("header button").last().click();
    await page.waitForTimeout(800);
    await page.locator("text=退出登录").first().click();
  });
  await page.waitForTimeout(4000);
  results.push(["F2 退出登录后跳回登录页", page.url().includes("/login")]);

  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("auth-token")).length);
  results.push(["F3 本地 token 已清除", left === 0]);

  await page.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(4500);
  results.push(["F4 退出后直闯控制页仍被拦截", page.url().includes("/login")]);
  await ctx.close();
}

console.log("\n===== 结果 =====");
for (const [n, p] of results) console.log(`${ok(p)} ${n}`);
console.log("总判定:", results.every(([, p]) => p) ? "✅ 全部通过" : "❌ 存在失败项");
await browser.close();
