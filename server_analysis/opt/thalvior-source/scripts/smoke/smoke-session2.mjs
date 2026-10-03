// 复现用户真实路径：登录 → 返回落地页 → 再进控制页
// 同时验证「不勾选 7 天免登录」时：当前标签页可用、刷新不掉、新开会话需重登
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

async function login(page, { remember }) {
  await page.goto("https://thalvior.icu/login", { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#account", env.EMAIL);
  await page.fill("#password", env.PASSWORD);
  const isChecked = await page.evaluate(
    () => document.querySelector("#remember")?.getAttribute("data-state") === "checked",
  );
  if (isChecked !== remember) await page.locator("#remember").click();
  const nowState = await page.evaluate(() => document.querySelector("#remember")?.getAttribute("data-state"));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(4000);
  return nowState;
}

const ok = (b) => (b ? "✅" : "❌");
const results = [];

// ===== 场景 A：勾选免登录 → 返回落地页 → 再进控制页 =====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const state = await login(page, { remember: true });
  console.log("【A 勾选 7 天免登录】");
  console.log("   复选框:", state, "| 登录后:", page.url());
  const loginOk = page.url().includes("/dashboard");
  results.push(["A-登录成功进控制页", loginOk]);

  await page.goto("https://thalvior.icu/", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log("   落地页 → /dashboard 最终:", page.url());
  const keepOk = page.url().includes("/dashboard");
  results.push(["A-往返落地页保持登录", keepOk]);

  // 新开会话（模拟关闭浏览器重开）应仍登录
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 });
  await p2.waitForTimeout(4000);
  console.log("   （同浏览器新 context，localStorage 不共享，此处仅参考）:", p2.url());
  await ctx.close();
  await ctx2.close();
}

// ===== 场景 B：不勾选免登录 =====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const state = await login(page, { remember: false });
  console.log("【B 不勾选 7 天免登录】");
  console.log("   复选框:", state, "| 登录后:", page.url());
  const loginOk = page.url().includes("/dashboard");
  results.push(["B-登录成功进控制页（核心修复点）", loginOk]);

  await page.reload({ waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(4000);
  console.log("   刷新后:", page.url());
  const reloadOk = page.url().includes("/dashboard");
  results.push(["B-刷新仍在登录态", reloadOk]);

  // 新开标签页（同 context，sessionStorage 不共享）→ 应需重新登录
  const p3 = await ctx.newPage();
  await p3.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle", timeout: 30000 });
  await p3.waitForTimeout(4000);
  console.log("   新开标签页:", p3.url());
  const newTabOk = p3.url().includes("/login");
  results.push(["B-新开标签页需重新登录", newTabOk]);
  await ctx.close();
}

console.log("\n===== 结果 =====");
for (const [name, pass] of results) console.log(`${ok(pass)} ${name}`);
console.log("总判定:", results.every(([, p]) => p) ? "✅ 全部通过" : "❌ 存在失败项");

await browser.close();
