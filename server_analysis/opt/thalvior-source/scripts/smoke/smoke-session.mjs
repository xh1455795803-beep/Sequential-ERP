// 冒烟测试：验证「7 天免登录」勾选后，整页刷新是否仍保持登录态
// 用真实浏览器跑，检查 session 落在 localStorage 还是 sessionStorage
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

const readStorage = () => {
  const collect = (s) =>
    Object.keys(s)
      .filter((k) => k.includes("auth-token"))
      .map((k) => k);
  return { localStorage: collect(localStorage), sessionStorage: collect(sessionStorage) };
};

const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

console.log("1) 打开登录页");
await page.goto("https://thalvior.icu/login", { waitUntil: "networkidle", timeout: 30000 });

console.log("2) 填写账号密码");
await page.fill("#account", env.EMAIL);
await page.fill("#password", env.PASSWORD);

const rememberState = await page.evaluate(() => {
  const el = document.querySelector("#remember");
  return el ? { tag: el.tagName, ariaChecked: el.getAttribute("aria-checked"), dataState: el.getAttribute("data-state") } : null;
});
console.log("   记住我复选框状态:", JSON.stringify(rememberState));

console.log("3) 点击登录");
await page.getByRole("button", { name: "登录", exact: true }).click();
await page.waitForTimeout(4000);
console.log("   登录后 URL:", page.url());

console.log("4) 检查 session 存储位置");
const afterLogin = await page.evaluate(readStorage);
console.log("   ", JSON.stringify(afterLogin));

console.log("5) 整页刷新（模拟返回落地页再进控制页）");
await page.reload({ waitUntil: "networkidle", timeout: 30000 });
await page.waitForTimeout(4000);
console.log("   刷新后 URL:", page.url());
const afterReload = await page.evaluate(readStorage);
console.log("   刷新后存储:", JSON.stringify(afterReload));

const verdict = page.url().includes("/login")
  ? "❌ 刷新后被踢回登录页 —— 7天免登录未生效"
  : "✅ 刷新后仍在内页 —— 保持登录";
console.log("6) 结论:", verdict);
if (errors.length) console.log("   页面报错:", errors.slice(0, 3));

await browser.close();
