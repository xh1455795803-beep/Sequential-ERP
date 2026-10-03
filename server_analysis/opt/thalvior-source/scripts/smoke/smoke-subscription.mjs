// 验证订阅页真实可用：套餐渲染、当前套餐、计费标准展示
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
const page = await browser.newPage();

await page.goto("https://thalvior.icu/login", { waitUntil: "networkidle", timeout: 30000 });
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(4000);
console.log("登录后:", page.url());

// 订阅页
await page.goto("https://thalvior.icu/subscription", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3000);
const text = await page.innerText("body");
console.log("\n=== 订阅页关键内容检查 ===");
for (const kw of ["免费版", "专业版", "旗舰版", "199", "599", "赠送", "当前", "余额", "消耗"]) {
  console.log(`  ${text.includes(kw) ? "✅" : "❌"} 含「${kw}」`);
}
console.log("\n=== 套餐卡片数 ===");
const cards = await page.locator("text=/¥(199|599|1999|5999)/").count();
console.log("  匹配到价格卡片:", cards);
console.log("\n=== 充值档位 ===");
for (const v of ["10", "50", "100", "500"]) {
  console.log(`  ${text.includes(`¥${v}`) || text.includes(`${v} `) ? "✅" : "❌"} ¥${v}`);
}

// AI 页面计费标准展示
await page.goto("https://thalvior.icu/ai/select", { waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(3000);
const aiText = await page.innerText("body");
console.log("\n=== AI 选品页计费标准 ===");
const m = aiText.match(/计费标准[^\n]*/);
console.log("  ", m ? m[0] : "❌ 未展示计费标准");
console.log("  含「¥30」（输入售价 2×15）:", aiText.includes("¥30") ? "✅" : "❌");
console.log("  含「¥180」（输出售价 12×15）:", aiText.includes("¥180") ? "✅" : "❌");
console.log("  仍显示「免费」:", aiText.includes("本次调用免费") ? "⚠️ 是" : "✅ 否");

await browser.close();
