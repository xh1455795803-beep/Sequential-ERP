// notifications「标为已读」单项回归
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("https://thalvior.icu/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(4500);

const p = await ctx.newPage();
await p.goto("https://thalvior.icu/notifications", { waitUntil: "domcontentloaded" });
await p.waitForTimeout(3000);
const before = await p.locator("body").innerText();
const btns = p.getByRole("button", { name: /标为已读/ });
const n = await btns.count();
let ok = false, detail = `未读按钮数 ${n}`;
if (n > 0) {
  await btns.first().click();
  await p.waitForTimeout(2000);
  const after = await p.locator("body").innerText();
  const t = (await p.locator("[data-sonner-toaster]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  const nowN = await btns.count();
  ok = nowN === n - 1 || before !== after;
  detail = `未读按钮 ${n} → ${nowN}，toast:「${t.slice(0, 40)}」`;
}
console.log(`${ok ? "✅" : "❌"} notifications「标为已读」 ${detail}`);
await p.screenshot({ path: "/workspace/修复_notifications.png" });
await browser.close();
