// 采集插件端到端验证
// 1. 内置的 url + anonKey 是否真实可用（能否登录、能否写入 collect_items）
// 2. 插件采集 -> REST 入库整条链路
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);

// 从 popup.js / background.js 中提取实际内置的 CONFIG，避免测试与代码脱节
const popupSrc = readFileSync("./extension/popup.js", "utf8");
const bgSrc = readFileSync("./extension/background.js", "utf8");
const keyMatch = popupSrc.match(/anonKey:\s*\n?\s*"([^"]+)"/);
const urlMatch = popupSrc.match(/url:\s*"([^"]+)"/);
const CONFIG = { url: urlMatch?.[1], anonKey: keyMatch?.[1] };

const ok = (b) => (b ? "✅" : "❌");
const results = [];

console.log("内置服务地址:", CONFIG.url);
console.log("内置 anonKey :", CONFIG.anonKey.slice(0, 40) + "…");

results.push(["1-popup.js 内置的是真实密钥（非占位符）", !!CONFIG.anonKey && !/template|PLACEHOLDER|demo/i.test(CONFIG.anonKey)]);
results.push(["2-background.js 与 popup.js 使用同一份配置", bgSrc.includes(CONFIG.anonKey)]);

// ===== 用内置 key 调 REST API（证明 key 有效）=====
{
  const resp = await fetch(`${CONFIG.url}/rest/v1/collect_items?select=id&limit=1`, {
    headers: { apikey: CONFIG.anonKey, Authorization: `Bearer ${CONFIG.anonKey}` },
  });
  results.push([`3-内置 key 调 REST 通过（HTTP ${resp.status}）`, resp.status < 400]);
}

// ===== 用内置 key + 账号密码登录（模拟插件 sbLogin）=====
let token = null;
let userId = null;
{
  const resp = await fetch(`${CONFIG.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CONFIG.anonKey },
    body: JSON.stringify({ email: env.EMAIL, password: env.PASSWORD }),
  });
  const data = await resp.json();
  token = data.access_token;
  userId = data.user?.id;
  results.push([`4-插件登录流程可用（HTTP ${resp.status}，拿到 token=${!!token}）`, resp.ok && !!token]);

  if (token) {
    // refresh token 流程（插件 ensureFreshAuth 依赖它）
    const rr = await fetch(`${CONFIG.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: CONFIG.anonKey },
      body: JSON.stringify({ refresh_token: data.refresh_token }),
    });
    results.push([`5-refresh token 续期可用（HTTP ${rr.status}）`, rr.ok]);
  }
}

// ===== 模拟 content.js 产出 -> 插件 REST 入库 =====
if (token) {
  const item = {
    name: "【插件链路验证】Thalvior 采集插件冒烟测试商品",
    source: "https://example.com/dp/B000TEST0",
    category: "插件采集",
    price: 19.99,
    original_price: 29.99,
    currency: "USD",
    image: "https://example.com/main.jpg",
    images: ["https://example.com/main.jpg", "https://example.com/2.jpg"],
    detail_images: ["https://example.com/detail1.jpg", "https://example.com/detail2.jpg"],
    description: "冒烟验证用，可删除",
    sku: "TEST-SKU-001",
    brand: "Thalvior",
    seller: "Test Seller",
    rating: 4.5,
    reviews: 128,
    sales: 500,
    variants: [{ name: "Red", sku: "R-1", price: 19.99, image: "", stock: 0 }],
    platform: "Amazon",
    status: "待处理",
    // RLS 要求 user_id = auth.uid()，插件登录后会带上真实 user_id
    user_id: userId,
  };
  const resp = await fetch(`${CONFIG.url}/rest/v1/collect_items`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.anonKey,
      Authorization: `Bearer ${token}`,
      Prefer: "return=representation",
    },
    body: JSON.stringify(item),
  });
  const body = await resp.json();
  const row = Array.isArray(body) ? body[0] : null;
  results.push([`6-采集数据真实入库成功（HTTP ${resp.status}）`, resp.ok || resp.status === 201]);

  if (row?.id) {
    const hasDetail = row.detail_images?.length === 2;
    results.push(["7-详情图字段正确写入（本次之前该字段恒为空）", hasDetail]);
    results.push(["8-变体/币种/评分等扩展字段写入成功", row.currency === "USD" && row.variants?.length === 1 && row.platform === "Amazon"]);
    // 清理测试数据
    await fetch(`${CONFIG.url}/rest/v1/collect_items?id=eq.${row.id}`, {
      method: "DELETE",
      headers: { apikey: CONFIG.anonKey, Authorization: `Bearer ${token}` },
    });
  } else {
    results.push(["7-详情图字段正确写入", false]);
    results.push(["8-扩展字段写入成功", false]);
    console.log("   入库返回:", JSON.stringify(body).slice(0, 300));
  }
} else {
  results.push(["6-采集数据入库", false]);
  results.push(["7-详情图字段写入", false]);
  results.push(["8-扩展字段写入", false]);
}

// ===== 插件不再需要对接口码 =====
results.push(["9-popup.html 已移除对接码输入框", !readFileSync("./extension/popup.html", "utf8").includes("pairCode")]);
results.push(["10-插件代码中已无对接码解析逻辑", !popupSrc.includes("parsePairCode")]);

console.log("\n===== 采集插件链路 =====");
for (const [n, p] of results) console.log(`${ok(p)} ${n}`);
console.log("总判定:", results.every(([, p]) => p) ? "✅ 全部通过" : "❌ 存在失败项");
