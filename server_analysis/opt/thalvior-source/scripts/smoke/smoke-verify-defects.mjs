// 疑似无效按钮定向复检：按名称精确定位（不依赖坐标），检测 dialog / toast / 接口 / 下载
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

// [路由, 按钮名, 前置动作]
const CASES = [
  ["/products", "高级筛选", null],
  ["/products/collect", "公用采集箱", null],
  ["/products/collect", "平台采集箱", null],
  ["/products/collect", "采集失败", null],
  ["/ai/collect", "开始采集", null],
  ["/tools/keyword", "挖掘关键词", { fill: "wireless earbuds" }],
  ["/auth", "一键授权", null],
  ["/subscription", "扫码支付", null],
  ["/subscription", "H5 支付", null],
  ["/profile", "确认修改", null],
  ["/notifications", "标为已读", null],
  ["/orders", "待审核", null],
];

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.goto("https://thalvior.icu/login", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2000);
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(4500);

const results = [];

for (const [route, name, pre] of CASES) {
  const p = await ctx.newPage();
  let net = 0, dl = 0;
  p.on("request", (r) => {
    const u = r.url();
    if (u.includes("/functions/v1/") || u.includes("/rest/v1/") || u.includes("/auth/v1/")) net++;
  });
  p.on("download", () => dl++);
  let dialogBefore = 0, dialogAfter = 0, toast = "", err = "";

  try {
    await p.goto("https://thalvior.icu" + route, { waitUntil: "domcontentloaded", timeout: 25000 });
    await p.waitForTimeout(3000);

    if (pre?.fill) {
      const ta = p.locator("textarea").first();
      if (await ta.count()) await ta.fill(pre.fill).catch(() => {});
      else {
        const inp = p.locator('input[type="text"], input:not([type])').first();
        if (await inp.count()) await inp.fill(pre.fill).catch(() => {});
      }
      await p.waitForTimeout(300);
    }

    const btn = p.getByRole("button", { name, exact: true }).first();
    const count = await p.getByRole("button", { name, exact: true }).count();
    if (count === 0) {
      results.push([route, name, "none", "页面上找不到该按钮"]);
      await p.close();
      continue;
    }
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    dialogBefore = await p.locator('[role="dialog"]').count();
    const before = await p.locator("body").innerText();
    const netBefore = net, dlBefore = dl;

    await btn.click({ timeout: 5000 });
    await p.waitForTimeout(700);
    const mid = await p.locator("body").innerText();
    await p.waitForTimeout(2000);
    const after = await p.locator("body").innerText();
    dialogAfter = await p.locator('[role="dialog"]').count();

    // 抓取 toast 文本（sonner 渲染在 [data-sonner-toaster]）
    toast = await p.locator("[data-sonner-toaster]").innerText().catch(() => "");
    toast = toast.replace(/\s+/g, " ").trim().slice(0, 60);

    const reacted =
      before !== after || mid !== before || net > netBefore || dl > dlBefore || dialogAfter > dialogBefore;
    results.push([
      route, name, reacted ? "OK" : "DEAD",
      `弹窗 ${dialogBefore}→${dialogAfter} | 接口+${net - netBefore} | 下载+${dl - dlBefore} | toast:${toast || "无"}`,
    ]);
  } catch (e) {
    results.push([route, name, "ERR", String(e).slice(0, 80)]);
  }
  await p.close();
}

console.log("\n===== 疑似无效按钮定向复检 =====");
for (const [route, name, verdict, detail] of results) {
  const icon = verdict === "OK" ? "✅" : verdict === "DEAD" ? "❌" : "⚠️";
  console.log(`${icon} ${route} | 「${name}」→ ${verdict}\n   ${detail}`);
}
await browser.close();
