// 验证额度闭环：余额不足拒绝 → 充值 → 按官方单价真实扣费
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
const adminHdr = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

const lr = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: env.EMAIL, password: env.PASSWORD }),
});
const lj = await lr.json();
const token = lj.access_token;
const userId = lj.user.id;
const hdr = () => ({ "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${token}`, "OneDay-App-Id": APPID });

async function balance() {
  const r = await fetch(`${BASE}/rest/v1/tenant_quotas?select=balance&user_id=eq.${userId}`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  const d = await r.json();
  return d[0] ? Number(d[0].balance) : null;
}

async function callChat() {
  const r = await fetch(`${BASE}/functions/v1/ai-chat`, {
    method: "POST",
    headers: hdr(),
    body: JSON.stringify({
      model: "qwen3.6-plus",
      service_key: "copywriting",
      stream: true,
      messages: [{ role: "user", content: "用一句话介绍便携咖啡杯" }],
    }),
  });
  const t = await r.text();
  const u = [...t.matchAll(/"usage":\{"prompt_tokens":(\d+),"total_tokens":(\d+),"completion_tokens":(\d+)/g)].pop();
  return { status: r.status, body: t, usage: u ? { prompt: +u[1], completion: +u[3] } : null };
}

// 1) 余额为 0 时应被拒绝
console.log("初始余额:", await balance());
const r1 = await callChat();
console.log("① 余额 0 时调用 →", r1.status, r1.status === 200 ? "⚠️ 未被拦截" : r1.body.slice(0, 160));

// 2) 充值 ¥5（走 quota_recharges 流水，与真实充值同一条链路）
await fetch(`${BASE}/rest/v1/quota_recharges`, {
  method: "POST",
  headers: { ...adminHdr, Prefer: "return=minimal" },
  body: JSON.stringify({ user_id: userId, amount: 5, method: "管理员增补（测试）" }),
});
await fetch(`${BASE}/rest/v1/tenant_quotas?user_id=eq.${userId}`, {
  method: "PATCH",
  headers: { ...adminHdr, Prefer: "return=minimal" },
  body: JSON.stringify({ balance: 5, updated_at: new Date().toISOString() }),
});
const afterTopUp = await balance();
console.log("② 充值后余额:", afterTopUp);

// 3) 再次调用，应成功并按真实用量扣费
const r3 = await callChat();
console.log("③ 充值后调用 →", r3.status, "| usage:", r3.usage);
const after3 = await balance();
console.log("   余额:", afterTopUp, "→", after3, "| 实际扣减:", (afterTopUp - after3).toFixed(6));
if (r3.usage) {
  const expected = (r3.usage.prompt / 1e6) * 2 + (r3.usage.completion / 1e6) * 12;
  console.log("   按官方价应扣:", expected.toFixed(6), "| 吻合:", Math.abs(expected - (afterTopUp - after3)) < 1e-6 ? "✅" : "❌");
}

// 4) 最近一条消耗流水
const lg = await fetch(`${BASE}/rest/v1/ai_usage_logs?select=*&user_id=eq.${userId}&order=created_at.desc&limit=2`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
console.log("④ 消耗流水:", await lg.json());
