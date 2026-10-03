// 对 4 个真实疑似缺陷做「截图 + 控制台错误 + 接口失败」三重取证
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const CASES = [
  { route: "/profile", btn: "确认修改", shot: "缺陷_profile_确认修改" },
  { route: "/ai/collect", btn: "开始采集", shot: "缺陷_aicollect_开始采集" },
  { route: "/tools/keyword", btn: "挖掘关键词", shot: "缺陷_keyword_挖掘", fill: "wireless earbuds" },
  { route: "/notifications", btn: "标为已读", shot: "缺陷_notif_标为已读" },
  { route: "/subscription", btn: "H5 支付", shot: "缺陷_sub_H5支付" },
];

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

for (const c of CASES) {
  const p = await ctx.newPage();
  const consoleErrors = [];
  const netFails = [];
  p.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  p.on("response", async (r) => {
    if (r.status() >= 400 && (r.url().includes("/rest/") || r.url().includes("/functions/"))) {
      let body = "";
      try { body = (await r.text()).slice(0, 160); } catch {}
      netFails.push(`${r.status()} ${r.url().split("/").slice(-2).join("/")} ${body}`);
    }
  });

  console.log(`\n========== ${c.route} 「${c.btn}」==========`);
  try {
    await p.goto("https://thalvior.icu" + c.route, { waitUntil: "domcontentloaded", timeout: 25000 });
    await p.waitForTimeout(3200);

    if (c.fill) {
      const ta = p.locator("textarea").first();
      if (await ta.count()) await ta.fill(c.fill).catch(() => {});
      else {
        const inp = p.locator('input[type="text"], input:not([type])').first();
        if (await inp.count()) await inp.fill(c.fill).catch(() => {});
      }
      await p.waitForTimeout(300);
    }

    const btns = p.getByRole("button", { name: c.btn, exact: true });
    const n = await btns.count();
    console.log(`按钮数量: ${n}`);
    if (n === 0) {
      // 打印页面上所有按钮名，便于定位文案
      const all = await p.locator("main button").allInnerTexts();
      console.log("页面实际按钮:", all.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 20).join(" | "));
    } else {
      await btns.first().scrollIntoViewIfNeeded().catch(() => {});
      await btns.first().click({ timeout: 5000 });
      await p.waitForTimeout(2600);
      const toaster = await p.locator("[data-sonner-toaster]").innerText().catch(() => "(无 toaster 节点)");
      console.log("toast:", toaster.replace(/\s+/g, " ").trim().slice(0, 120) || "(空)");
      await p.screenshot({ path: `/workspace/${c.shot}.png`, fullPage: false });
    }
  } catch (e) {
    console.log("异常:", String(e).slice(0, 120));
  }
  if (consoleErrors.length) console.log("控制台错误:", consoleErrors.slice(0, 4).join(" || "));
  if (netFails.length) console.log("接口失败:", netFails.slice(0, 5).join(" || "));
  await p.close();
}
await browser.close();
