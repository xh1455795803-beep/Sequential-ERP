// #13 修复回归：Toaster 挂载后各交互应有可见反馈
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
const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("https://thalvior.icu/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(4500);

const results = [];
const push = (n, ok, d = "") => results.push([n, ok, d]);
const toastText = async (p) =>
  (await p.locator("[data-sonner-toaster]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();

// 1) profile 空表单点「确认修改」→ 应出现校验 toast
{
  const p = await ctx.newPage();
  await p.goto("https://thalvior.icu/profile", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  await p.getByRole("button", { name: "确认修改", exact: true }).click();
  await p.waitForTimeout(1200);
  const t = await toastText(p);
  push("1-profile 空表单提示「请填写密码」", /填写|密码/.test(t), `toast:「${t}」`);
  await p.screenshot({ path: "/workspace/修复_profile_toast.png" });
  await p.close();
}

// 2) ai/collect 空输入点「开始采集」→ 应出现提示 toast
{
  const p = await ctx.newPage();
  await p.goto("https://thalvior.icu/ai/collect", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  await p.getByRole("button", { name: "开始采集", exact: true }).first().click();
  await p.waitForTimeout(1200);
  const t = await toastText(p);
  push("2-ai/collect 空输入有提示", t.length > 0, `toast:「${t}」`);
  await p.close();
}

// 3) tools/keyword 填入核心词 → 点「挖掘关键词」→ 应真实调 AI 输出关键词
{
  const p = await ctx.newPage();
  await p.goto("https://thalvior.icu/tools/keyword", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  const inp = p.locator("main input").first();
  await inp.fill("wireless earbuds");
  await p.getByRole("button", { name: "挖掘关键词", exact: true }).click();
  let got = false, count = 0;
  try {
    await p.locator("text=个关键词").first().waitFor({ timeout: 70000 });
    const label = await p.locator("text=个关键词").first().innerText();
    count = Number((label.match(/(\d+)/) || [])[1] || 0);
    got = count > 0;
  } catch {}
  push(`3-keyword 挖掘出 ${count} 个长尾词（真实 AI 生成）`, got);
  await p.screenshot({ path: "/workspace/修复_keyword_挖掘结果.png" });
  await p.close();
}

// 4) notifications 点「标为已读」→ toast/状态变化（若全部已读则先发一条测试通知）
{
  const p = await ctx.newPage();
  await p.goto("https://thalvior.icu/notifications", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3000);
  const btns = p.getByRole("button", { name: /标为已读/ });
  const n = await btns.count();
  if (n === 0) {
    push("4-notifications「标为已读」", false, "页面无未读通知可测");
  } else {
    const before = await p.locator("body").innerText();
    await btns.first().click();
    await p.waitForTimeout(1800);
    const after = await p.locator("body").innerText();
    const t = await toastText(p);
    push(`4-notifications 标为已读生效（未读按钮 ${n}→${await btns.count()}）`, before !== after || /已读/.test(t), `toast:「${t}」`);
  }
  await p.screenshot({ path: "/workspace/修复_notifications.png" });
  await p.close();
}

// 5) subscription 支付方式 Tab 选中态切换
{
  const p = await ctx.newPage();
  await p.goto("https://thalvior.icu/subscription", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  const h5 = p.getByRole("button", { name: /H5 支付/ }).first();
  const clsBefore = await h5.getAttribute("class").catch(() => "");
  await h5.click().catch(() => {});
  await p.waitForTimeout(600);
  const clsAfter = await h5.getAttribute("class").catch(() => "");
  push("5-subscription 支付方式 Tab 高亮切换", clsBefore !== clsAfter, `class 变化 ${clsBefore !== clsAfter}`);
  await p.close();
}

// 6) orders 有数据后状态 Tab 过滤生效
{
  const p = await ctx.newPage();
  await p.goto("https://thalvior.icu/orders", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(3200);
  const allRows = await p.locator("tbody tr").count();
  await p.getByRole("button", { name: "售后中", exact: true }).first().click();
  await p.waitForTimeout(800);
  const afterRows = await p.locator("tbody tr").count();
  push(`6-orders 状态筛选（全部 ${allRows} 行 → 售后中 ${afterRows} 行）`, allRows > 0 && afterRows < allRows);
  await p.close();
}

console.log("\n===== #13 修复回归 =====");
for (const [n, ok, d] of results) console.log(`${ok ? "✅" : "❌"} ${n}${d ? `\n   ${d}` : ""}`);
console.log("总判定:", results.every(([, ok]) => ok) ? "✅ 全部通过" : "❌ 存在失败项");
await browser.close();
