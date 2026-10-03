// 全站按钮体检 v2：带数据环境 + 下载事件监听 + toast 捕获 + 前置输入
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const ROUTES = [
  "/dashboard",
  "/products", "/products/collect", "/products/material",
  "/orders", "/orders/rules", "/orders/after-sale",
  "/listing", "/inventory",
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
  "/subaccounts", "/subscription", "/profile", "/notifications",
];

// 需要前置输入的页面：给输入框填内容，让「生成/挖掘/查询」类按钮能真正执行
const PREFILL = {
  "/ai/collect": "无线蓝牙耳机",
  "/ai/select": "无线蓝牙耳机 降噪 长续航",
  "/ai/market": "美国站 无线耳机 市场分析",
  "/ai/review": "这款耳机音质不错，续航也很长",
  "/ai/competitor": "Anker 无线耳机",
  "/tools/keyword": "wireless earbuds",
  "/logistics/tracking": "TK10000137",
  "/tools/profit-calc": "",
  "/tools/fba": "",
  "/tools/tax": "",
};

const DANGER = ["删除", "移除", "注销", "退出", "重置", "清空", "解绑", "停用", "终止", "作废", "驳回"];
const NOTOPEN = ["暂未", "敬请期待", "未开放", "开发中", "建设中", "即将上线"];

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

const dead = [];
const notOpen = [];
const okList = [];

for (const route of ROUTES) {
  const p = await ctx.newPage();
  const requests = [];
  let downloads = 0;
  p.on("request", (r) => {
    const u = r.url();
    if (u.includes("/functions/v1/") || u.includes("/rest/v1/") || u.includes("/auth/v1/")) requests.push(u);
  });
  p.on("download", () => { downloads++; });

  try {
    await p.goto("https://thalvior.icu" + route, { waitUntil: "domcontentloaded", timeout: 25000 });
    await p.waitForTimeout(2800);

    // 前置输入：填 textarea 或第一个可见文本输入框
    const pre = PREFILL[route];
    if (pre) {
      const ta = p.locator("textarea").first();
      if (await ta.count()) {
        await ta.fill(pre).catch(() => {});
      } else {
        const inp = p.locator('input[type="text"], input[type="search"], input:not([type])').first();
        if (await inp.count()) await inp.fill(pre).catch(() => {});
      }
      await p.waitForTimeout(400);
    }

    const buttons = await p.locator("main button, [role=main] button, .space-y-5 button").all();
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

    for (const { b, txt } of targets.slice(0, 16)) {
      if (!txt) continue;
      if (DANGER.some((d) => txt.includes(d))) continue;

      const before = await p.locator("body").innerText().catch(() => "");
      const rowBefore = await p.locator("tbody tr").count().catch(() => 0);
      const reqBefore = requests.length;
      const dlBefore = downloads;

      await b.click({ timeout: 4000, force: true }).catch(() => {});
      await p.waitForTimeout(600);
      const mid = await p.locator("body").innerText().catch(() => ""); // 捕获短命 toast
      await p.waitForTimeout(1500);
      const after = await p.locator("body").innerText().catch(() => "");
      const rowAfter = await p.locator("tbody tr").count().catch(() => 0);

      const reacted =
        before !== after ||            // 界面变化
        mid !== before ||              // toast 闪现
        requests.length > reqBefore || // 接口调用
        downloads > dlBefore ||        // 触发下载
        rowAfter !== rowBefore;        // 列表行数变化

      if (reacted) {
        okList.push(`${route} | ${txt}`);
        const added = (mid + after).replace(before, "");
        if (NOTOPEN.some((w) => added.includes(w))) {
          notOpen.push(`${route} | 「${txt}」→ ${added.replace(/\s+/g, " ").trim().slice(0, 70)}`);
        }
      } else {
        dead.push(`${route} | 「${txt}」点击后无任何反应（无界面变化 / 无接口请求 / 无下载）`);
      }

      await p.keyboard.press("Escape").catch(() => {});
      await p.waitForTimeout(250);
    }
  } catch (err) {
    dead.push(`${route} | 页面异常：${String(err).slice(0, 90)}`);
  }
  process.stdout.write(`· ${route}\n`);
  await p.close();
}

console.log("\n===== 全站按钮体检 v2（数据环境）=====");
console.log(`有效反应 ${okList.length} 个，疑似无效 ${dead.length} 个，提示未开放 ${notOpen.length} 个\n`);
console.log(`--- 疑似无效（${dead.length}）---`);
dead.forEach((d) => console.log("❌ " + d));
console.log(`\n--- 提示未开放（${notOpen.length}）---`);
notOpen.forEach((d) => console.log("⚠️  " + d));
writeFileSync("/tmp/dead-buttons-v2.txt", [...dead, ...notOpen].join("\n"));
await browser.close();
