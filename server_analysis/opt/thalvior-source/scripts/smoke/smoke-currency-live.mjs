// 汇率页面 live 状态验证
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("https://thalvior.icu/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(4500);
const p = await ctx.newPage();
await p.goto("https://thalvior.icu/tools/currency", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(5000);
const body = await p.locator("body").innerText();
const isLive = !body.includes("兜底") && (body.includes("实时") || body.includes("更新"));
// 汇率应接近真实值（CNY≈6.7x 而非兜底 7.25）
const cnyRow = body.split("\n").find((l) => l.includes("CNY") && l.includes("人民币"));
console.log(`${isLive ? "✅" : "❌"} 汇率页为实时数据`);
console.log(`   CNY 行: ${(cnyRow || "").replace(/\s+/g, " ").trim()}`);
console.log(`   ${/6\.7/.test(body) ? "✅ CNY≈6.71（真实 ECB 汇率）" : "❌ 未检测到真实汇率 6.7x（可能仍为兜底 7.25）"}`);
await p.screenshot({ path: "/workspace/修复_汇率实时.png", fullPage: true });
await browser.close();
