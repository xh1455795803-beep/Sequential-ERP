// 验证 AI 功能真实可用 + 按官方单价真实扣费
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("./.smoke.env", "utf8").trim().split("\n").map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  }),
);
const ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw";
const SRK = readFileSync("/tmp/srk.txt", "utf8").trim();
const BASE = "https://thalvior.icu";
const APPID = "pm45exfrqoja";

// 1) 登录拿 token
const loginRes = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: env.EMAIL, password: env.PASSWORD }),
});
const loginJson = await loginRes.json();
if (!loginRes.ok) throw new Error("登录失败: " + JSON.stringify(loginJson));
const token = loginJson.access_token;
const userId = loginJson.user.id;
console.log("登录成功 user:", userId);

const hdr = () => ({
  "Content-Type": "application/json",
  apikey: ANON,
  Authorization: `Bearer ${token}`,
  "OneDay-App-Id": APPID,
});

async function balance() {
  const r = await fetch(`${BASE}/rest/v1/tenant_quotas?select=balance&user_id=eq.${userId}`, {
    headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
  });
  const d = await r.json();
  return d[0] ? Number(d[0].balance) : null;
}

async function lastLog(serviceKey) {
  const r = await fetch(
    `${BASE}/rest/v1/ai_usage_logs?select=*&user_id=eq.${userId}&service_key=eq.${serviceKey}&order=created_at.desc&limit=1`,
    { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } },
  );
  const d = await r.json();
  return d[0] ?? null;
}

// ===== 1. ai-chat（文案优化，qwen3.6-plus）=====
console.log("\n===== 1) ai-chat / copywriting =====");
const before1 = await balance();
const r1 = await fetch(`${BASE}/functions/v1/ai-chat`, {
  method: "POST",
  headers: hdr(),
  body: JSON.stringify({
    model: "qwen3.6-plus",
    service_key: "copywriting",
    stream: true,
    messages: [
      { role: "system", content: "你是跨境电商文案专家" },
      { role: "user", content: "为一款便携式咖啡杯写一句英文广告语，不超过 15 个单词" },
    ],
  }),
});
const t1 = await r1.text();
console.log("HTTP", r1.status, "| 字节数", t1.length);
const usage1 = [...t1.matchAll(/"usage":\{"prompt_tokens":(\d+),"total_tokens":(\d+),"completion_tokens":(\d+)/g)].pop();
console.log("流式 usage:", usage1 ? { prompt: usage1[1], completion: usage1[3] } : "未捕获");
console.log("输出片段:", t1.replace(/\n/g, "").match(/"content":"([^"]{0,60})/g)?.slice(-2)?.join(" "));
const after1 = await balance();
console.log("余额:", before1, "→", after1, "| 扣减:", (before1 - after1).toFixed(6));
console.log("日志:", await lastLog("copywriting"));

// ===== 2. ai-vision（图片翻译，qwen3-vl-plus）=====
console.log("\n===== 2) ai-vision / image_translate =====");
const before2 = await balance();
const r2 = await fetch(`${BASE}/functions/v1/ai-vision`, {
  method: "POST",
  headers: hdr(),
  body: JSON.stringify({
    service_key: "image_translate",
    stream: true,
    model: "qwen3-vl-plus",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "识别图片中的文字并翻译成英文" },
          { type: "image_url", image_url: { url: "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250925/thtclx/input1.png" } },
        ],
      },
    ],
  }),
});
const t2 = await r2.text();
console.log("HTTP", r2.status, "| 字节数", t2.length);
const usage2 = [...t2.matchAll(/"usage":\{"prompt_tokens":(\d+),"total_tokens":(\d+),"completion_tokens":(\d+)/g)].pop();
console.log("流式 usage:", usage2 ? { prompt: usage2[1], completion: usage2[3] } : "未捕获");
console.log("输出片段:", t2.replace(/\n/g, "").match(/"content":"([^"]{0,60})/g)?.slice(-2)?.join(" "));
const after2 = await balance();
console.log("余额:", before2, "→", after2, "| 扣减:", (before2 - after2).toFixed(6));
console.log("日志:", await lastLog("image_translate"));

// ===== 3. ai-image-gen（图片处理，qwen-image-2.0）=====
console.log("\n===== 3) ai-image-gen / image_process =====");
const before3 = await balance();
const r3 = await fetch(`${BASE}/functions/v1/ai-image-gen`, {
  method: "POST",
  headers: hdr(),
  body: JSON.stringify({
    prompt: "一只白色小猫坐在阳光下的窗台，写实风格",
    model: "qwen-image-2.0",
    n: 1,
    service_key: "image_process",
  }),
});
const t3 = await r3.text();
console.log("HTTP", r3.status, "| 响应:", t3.slice(0, 300));
const after3 = await balance();
console.log("余额:", before3, "→", after3, "| 扣减:", (before3 - after3).toFixed(6));
console.log("日志:", await lastLog("image_process"));

// ===== 4. 定价表 =====
console.log("\n===== 4) service_pricing 官方单价 =====");
const rp = await fetch(`${BASE}/rest/v1/service_pricing?select=service_key,service_name,model,billing_mode,unit_price,unit,input_price_per_mtok,output_price_per_mtok`, {
  headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
});
console.table(await rp.json());
