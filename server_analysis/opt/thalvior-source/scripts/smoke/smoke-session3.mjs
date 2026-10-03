// v2 登录态回归：重点验证「多标签页不再互踢」+「7 天免登录可靠」+「扩展坞可下载安装包」
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

async function login(page, { remember }) {
  await page.goto("https://thalvior.icu/login", { waitUntil: "networkidle", timeout: 30000 });
  await page.fill("#account", env.EMAIL);
  await page.fill("#password", env.PASSWORD);
  const isChecked = await page.evaluate(
    () => document.querySelector("#remember")?.getAttribute("data-state") === "checked",
  );
  if (isChecked !== remember) await page.locator("#remember").click();
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(4500);
}

const expireToken = (page) =>
  page.evaluate(() => {
    const k = Object.keys(localStorage).filter((x) => x.includes("auth-token"))[0];
    if (!k) return false;
    const raw = JSON.parse(localStorage.getItem(k));
    raw.expires_at = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem(k, JSON.stringify(raw));
    return true;
  });

// ===== A：勾选 7 天 → token 过期后自动续期，往返落地页不掉 =====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, { remember: true });
  results.push(["A1 勾选后登录进控制页", page.url().includes("/dashboard")]);

  await page.goto("https://thalvior.icu/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);
  results.push(["A2 往返落地页保持登录", page.url().includes("/dashboard")]);

  await expireToken(page);
  await page.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);
  results.push(["A3 access token 过期后自动续期不掉线", page.url().includes("/dashboard")]);

  const store = await page.evaluate(() => ({
    ls: Object.keys(localStorage).filter((k) => k.includes("auth-token")),
    ss: Object.keys(sessionStorage).filter((k) => k.includes("auth-token")),
  }));
  results.push(["A4 token 恒在 localStorage（无 sessionStorage 残留）", store.ls.length === 1 && store.ss.length === 0]);
  await ctx.close();
}

// ===== B：不勾选 → 同标签页刷新不掉；新标签页需重登 =====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, { remember: false });
  results.push(["B1 不勾选也能登录进控制页", page.url().includes("/dashboard")]);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(4000);
  results.push(["B2 同标签页刷新不掉登录", page.url().includes("/dashboard")]);

  const p2 = await ctx.newPage();
  await p2.goto("https://thalvior.icu/dashboard", { waitUntil: "networkidle" });
  await p2.waitForTimeout(4000);
  results.push(["B3 新标签页需重新登录", p2.url().includes("/login")]);
  await ctx.close();
}

// ===== C：核心回归 —— 多标签页不再互踢（v1 的致命 bug）=====
{
  const ctx = await browser.newContext();
  const p1 = await ctx.newPage();
  await login(p1, { remember: true });
  const t1 = p1.url().includes("/dashboard");
  results.push(["C1 标签页1 勾选登录成功", t1]);

  // 标签页2 用「不勾选」登录 —— v1 会把 token 搬到 sessionStorage，直接把标签页1 踢下线
  const p2 = await ctx.newPage();
  await login(p2, { remember: false });
  results.push(["C2 标签页2 不勾选登录成功", p2.url().includes("/dashboard")]);

  await p1.reload({ waitUntil: "networkidle" });
  await p1.waitForTimeout(4500);
  results.push(["C3 标签页1 未被标签页2 踢下线（核心修复点）", p1.url().includes("/dashboard")]);

  // 反向：标签页2 再以「勾选」登录，不应影响标签页1
  await login(p2, { remember: true });
  await p2.waitForTimeout(1000);
  await p1.reload({ waitUntil: "networkidle" });
  await p1.waitForTimeout(4500);
  results.push(["C4 标签页2 改勾选后，标签页1 仍在线", p1.url().includes("/dashboard")]);
  await ctx.close();
}

// ===== D：扩展坞面板 + 安装包可下载 =====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, { remember: true });

  const dockBtn = page.locator('header button[title]').filter({ hasText: "扩展坞" }).first();
  const hasDockText = await page.locator("header").innerText();
  results.push(["D1 顶栏出现「扩展坞」入口", hasDockText.includes("扩展坞")]);

  await dockBtn.click().catch(async () => {
    await page.locator("header button", { hasText: "扩展坞" }).first().click();
  });
  await page.waitForTimeout(1200);
  const panelText = await page.locator("body").innerText();
  results.push(["D2 面板展示插件安装包下载按钮", panelText.includes("下载安装包")]);
  results.push(["D3 面板展示对接码", panelText.includes("对接码")]);

  // 真实下载安装包
  const link = await page.locator('a[download]').first().getAttribute("href");
  results.push(["D4 下载链接指向安装包", link === "/downloads/thalvior-collect-extension.zip"]);

  const resp = await page.request.get("https://thalvior.icu/downloads/thalvior-collect-extension.zip");
  const buf = await resp.body();
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // PK
  results.push([`D5 安装包真实可下载（${resp.status()} / ${buf.length}B / zip=${isZip}）`, resp.status() === 200 && isZip]);
  await ctx.close();
}

console.log("\n===== 结果 =====");
for (const [name, pass] of results) console.log(`${ok(pass)} ${name}`);
console.log("总判定:", results.every(([, p]) => p) ? "✅ 全部通过" : "❌ 存在失败项");

await browser.close();
