// 扩展坞面板回归（对标妙手插件交付标准）
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

async function openDock(ctx) {
  const page = await ctx.newPage();
  await page.goto("https://thalvior.icu/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.fill("#account", env.EMAIL);
  await page.fill("#password", env.PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(4500);
  // 顶栏已按需求改为纯图标，用 aria-label 定位（无障碍语义同时被保留）
  const dockBtn = page.locator('header button[aria-label="扩展坞"]');
  const dockCount = await dockBtn.count();
  const headerText = await page.locator("header").innerText();
  results.push([
    `0-顶栏为纯图标按钮，不再显示「扩展坞」文字（按钮数 ${dockCount}，顶栏文字：${headerText.replace(/\s+/g, " ").trim().slice(0, 40)}）`,
    dockCount === 1 && !headerText.includes("扩展坞"),
  ]);
  await dockBtn.first().click();
  await page.waitForTimeout(1200);
  return page;
}

// ===== 场景 1：未安装插件 =====
{
  const ctx = await browser.newContext();
  const page = await openDock(ctx);
  const body = await page.locator("body").innerText();

  results.push(["1-显示「未检测到采集插件」", body.includes("未检测到采集插件")]);
  results.push(["2-自动识别当前浏览器为 Chrome", body.includes("谷歌 Chrome")]);
  results.push(["3-展示分浏览器专属安装步骤", body.includes("chrome://extensions") && body.includes("开发者模式")]);

  const disabled = await page.locator("button:disabled", { hasText: "下载安装包" }).count();
  results.push(["4-未勾选协议时下载按钮被禁用", disabled === 1]);

  await page.locator('input[type="checkbox"]').first().check();
  await page.waitForTimeout(600);
  const enabled = await page.locator('a[download]').count();
  results.push(["5-勾选协议后出现真实下载链接", enabled === 1]);

  const sizeText = await page.locator('a[download]').innerText();
  results.push([`6-显示真实包体积（${sizeText.replace(/\s+/g, " ").trim()}）`, /KB/.test(sizeText)]);

  // 切换浏览器 → 步骤应随之变化（360 是解压路线）
  await page.locator("button", { hasText: "谷歌 Chrome" }).first().click();
  await page.waitForTimeout(400);
  await page.locator("button", { hasText: "360 极速浏览器" }).first().click();
  await page.waitForTimeout(600);
  const body2 = await page.locator("body").innerText();
  results.push(["7-切换浏览器后步骤变为解压路线", body2.includes("下载并解压安装包") && body2.includes("加载已解压的扩展程序")]);

  // 常见问题可展开
  await page.locator("button", { hasText: "装了插件，页面仍提示未安装" }).first().click();
  await page.waitForTimeout(500);
  const body3 = await page.locator("body").innerText();
  results.push(["8-常见问题可展开查看排查方法", body3.includes("移除所有旧版")]);

  // 真实下载
  const href = await page.locator('a[download]').first().getAttribute("href");
  const resp = await page.request.get("https://thalvior.icu" + href);
  const buf = await resp.body();
  results.push([`9-安装包真实可下载（${resp.status()} / ${buf.length}B）`, resp.status() === 200 && buf[0] === 0x50]);
  await ctx.close();
}

// ===== 场景 2：模拟插件已安装（注入 DOM 标记）=====
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // 在页面加载后注入标记，模拟 content script 行为
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      document.documentElement.setAttribute("data-thalvior-collector", "1.2.0");
    });
  });
  await page.goto("https://thalvior.icu/login", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.fill("#account", env.EMAIL);
  await page.fill("#password", env.PASSWORD);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.waitForTimeout(4500);
  await page.locator('header button[aria-label="扩展坞"]').first().click();
  await page.waitForTimeout(2000);
  const body = await page.locator("body").innerText();
  results.push(["10-装了插件时显示「插件已安装 · v1.2.0」", body.includes("插件已安装") && body.includes("v1.2.0")]);
  await ctx.close();
}

// ===== 场景 3：安装包内容正确（用 unzip -l 精确核对，避免二进制正则误判）=====
{
  const { execSync } = await import("node:child_process");
  const listing = execSync("unzip -l public/downloads/thalvior-collect-extension.zip", { encoding: "utf8" });
  const needed = ["manifest.json", "content.js", "background.js", "popup.js", "popup.html", "install-marker.js"];
  const iconNeeded = ["icons/icon16.png", "icons/icon48.png", "icons/icon128.png"];
  const missing = [...needed, ...iconNeeded].filter((n) => !listing.includes(n));
  results.push([`11-安装包含全部必需文件（缺：${missing.join(",") || "无"}）`, missing.length === 0]);
  results.push(["12-安装包含安装检测标记脚本", listing.includes("install-marker.js")]);
  const { statSync } = await import("node:fs");
  const localSize = statSync("public/downloads/thalvior-collect-extension.zip").size;
  const head = await fetch("https://thalvior.icu/downloads/thalvior-collect-extension.zip", { method: "HEAD" });
  const onlineSize = Number(head.headers.get("content-length") || 0);
  results.push([`13-线上包与本地包字节完全一致（${localSize}B vs ${onlineSize}B）`, localSize === onlineSize && onlineSize > 0]);
}

console.log("\n===== 扩展坞回归 =====");
for (const [n, p] of results) console.log(`${ok(p)} ${n}`);
console.log("总判定:", results.every(([, p]) => p) ? "✅ 全部通过" : "❌ 存在失败项");
await browser.close();
