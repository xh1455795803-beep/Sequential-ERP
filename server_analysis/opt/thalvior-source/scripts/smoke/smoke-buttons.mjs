// 全站按钮体检：遍历所有路由，点击每个按钮，检测「点了没反应 / 点了只提示未开放」
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

// 路由清单（由 src/routes 文件名推导）
const ROUTES = [
  "/dashboard",
  "/products", "/products/collect", "/products/material",
  "/orders", "/orders/rules", "/orders/after-sale",
  "/listing",
  "/inventory",
  "/purchase", "/purchase/plan", "/purchase/suggestion", "/purchase/inbound",
  "/fulfillment", "/fulfillment/outbound",
  "/logistics", "/logistics/channel", "/logistics/quote", "/logistics/tracking",
  "/finance", "/finance/fee", "/finance/reconcile",
  "/profit",
  "/reports", "/reports/product", "/reports/traffic",
  "/ads", "/ads/keyword", "/ads/report",
  "/ai/collect", "/ai/select", "/ai/market", "/ai/review", "/ai/competitor",
  "/tools/currency", "/tools/fba", "/tools/profit-calc", "/tools/tax", "/tools/keyword", "/tools/competitor",
  "/shops", "/auth", "/auth/source",
  "/subaccounts",
  "/subscription",
  "/profile",
  "/notifications",
];

// 危险/破坏性按钮：只记录不点击
const DANGER = ["删除", "移除", "注销", "退出", "重置", "清空", "解绑", "停用", "终止", "作废", "驳回", "强制"];
// 纯导航/展开类：不判定
const SKIP = ["上一页", "下一页", "收起", "展开", "关闭", "返回", "取消"];
// 「未开放」类提示词
const NOTOPEN = ["暂未", "敬请期待", "未开放", "开发中", "建设中", "即将上线", "coming soon", "不可用"];

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

// 登录
await page.goto("https://thalvior.icu/login", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2500);
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(4500);
await ctx.storageState({ path: "/tmp/smoke-state.json" });

const dead = [];       // 点了完全没反应
const notOpen = [];    // 点了只提示未开放
const clickedTotal = [];

for (const route of ROUTES) {
  const p = await ctx.newPage();
  const requests = [];
  p.on("request", (r) => {
    if (r.url().includes("/functions/v1/") || r.url().includes("/rest/v1/") || r.url().includes("/auth/v1/")) {
      requests.push(r.url());
    }
  });

  let btnCount = 0;
  try {
    await p.goto("https://thalvior.icu" + route, { waitUntil: "domcontentloaded", timeout: 25000 });
    await p.waitForTimeout(2500);

    const buttons = await p.locator("main button, [role=main] button, .space-y-5 button").all();
    // 去重（按文本+位置）
    const seen = new Set();
    const targets = [];
    for (const b of buttons) {
      if (!(await b.isVisible().catch(() => false))) continue;
      if (await b.isDisabled().catch(() => false)) continue;
      const txt = (await b.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
      const box = await b.boundingBox().catch(() => null);
      if (!box) continue;
      const key = `${txt}@${Math.round(box.x)},${Math.round(box.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ b, txt });
    }

    btnCount = targets.length;
    for (const { b, txt } of targets.slice(0, 16)) {
      if (!txt) continue;
      if (DANGER.some((d) => txt.includes(d))) continue;
      if (SKIP.some((d) => txt === d)) continue;

      const before = await p.locator("body").innerText().catch(() => "");
      const reqBefore = requests.length;

      await b.click({ timeout: 4000, force: true }).catch(() => {});
      await p.waitForTimeout(1600);

      const after = await p.locator("body").innerText().catch(() => "");
      const reqAfter = requests.length;
      const domChanged = before !== after;
      const netFired = reqAfter > reqBefore;

      clickedTotal.push(`${route} | ${txt}`);

      if (!domChanged && !netFired) {
        dead.push(`${route} | 「${txt}」点击后无任何反应（无 DOM 变化、无接口请求）`);
      }
      // 检测新增文本里是否含未开放提示
      const added = after.replace(before, "");
      if (NOTOPEN.some((w) => added.includes(w))) {
        notOpen.push(`${route} | 「${txt}」→ ${added.replace(/\s+/g, " ").trim().slice(0, 60)}`);
      }
      // 关掉可能弹出的弹窗
      await p.keyboard.press("Escape").catch(() => {});
      await p.waitForTimeout(300);
    }
  } catch (err) {
    dead.push(`${route} | 页面加载失败：${String(err).slice(0, 80)}`);
  }
  process.stdout.write(`扫描 ${route}（${btnCount} 个按钮）\n`);
  await p.close();
}

console.log("\n===== 全站按钮体检 =====");
console.log(`已扫描路由 ${ROUTES.length} 个，共点击按钮 ${clickedTotal.length} 次`);
console.log(`\n--- 点击无反应（${dead.length}）---`);
dead.forEach((d) => console.log("❌ " + d));
console.log(`\n--- 点击提示未开放（${notOpen.length}）---`);
notOpen.forEach((d) => console.log("⚠️  " + d));
writeFileSync("/tmp/dead-buttons.txt", [...dead, ...notOpen].join("\n"));
await browser.close();
