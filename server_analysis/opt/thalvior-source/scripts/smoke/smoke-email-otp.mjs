// 邮箱验证码登录端到端：发码 → 真实收信 → 验码登录 → 会话可访问业务接口
import { execFileSync } from "node:child_process";

const ANON = "eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw";
const BASE = "https://thalvior.icu";
const MAIL = "thalvior@foxmail.com";
const results = [];
const push = (n, ok, d = "") => { results.push([n, ok, d]); console.log(`${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

// 0) SMTP 连通性
{
  const r = await fetch(`${BASE}/functions/v1/email-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "OneDay-App-Id": "pm45exfrqoja", apikey: ANON },
    body: JSON.stringify({ action: "ping" }),
  });
  const d = await r.json();
  push("0-SMTP 连通性自测", d.success === true, String(d.smtp || d.error).slice(0, 80));
}

// 1) 发送验证码（频控：先测重复发送的拦截）
{
  const r = await fetch(`${BASE}/functions/v1/email-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "OneDay-App-Id": "pm45exfrqoja", apikey: ANON },
    body: JSON.stringify({ action: "send", email: MAIL, scene: "login" }),
  }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
  // 60 秒内重复发送应被拦截（也可能是新窗口，两种情况都记录）
  push("1-发送验证码", r.success === true || /频繁/.test(r.error || ""), JSON.stringify(r).slice(0, 100));
}

// 2) 真实收信取码
let code = "";
{
  try {
    const out = execFileSync("python3", ["scripts/ops/mail-read-code.py"], { encoding: "utf8", timeout: 90000 });
    code = (out.match(/RESULT_CODE=(\d{6})/) || [])[1] || "";
  } catch (e) { /* 取码失败 */ }
  push("2-收件箱真实收到验证码", !!code, code ? `验证码 ${code}` : "未取到");
}

// 3) 错误验证码应被拒绝
if (code) {
  const wrong = String((Number(code) + 111111) % 1000000).padStart(6, "0");
  const r = await fetch(`${BASE}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ type: "email", email: MAIL, token: wrong === code ? "000000" : wrong }),
  }).then((x) => x.json());
  push("3-错误验证码被拒绝", !r.access_token, (r.msg || r.error_description || "已拒绝").slice(0, 60));
}

// 4) 正确验证码登录并访问业务接口
if (code) {
  const r = await fetch(`${BASE}/auth/v1/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON },
    body: JSON.stringify({ type: "email", email: MAIL, token: code }),
  }).then((x) => x.json());
  const okLogin = !!r.access_token;
  push("4-验证码登录成功并下发会话", okLogin, okLogin ? `用户 ${r.user?.email} · 有效期 ${r.expires_in}s` : (r.msg || "").slice(0, 80));

  if (okLogin) {
    const rows = await fetch(`${BASE}/rest/v1/orders?select=id&limit=3`, {
      headers: { apikey: ANON, Authorization: `Bearer ${r.access_token}` },
    });
    push("5-会话可正常访问业务数据", rows.status === 200, `orders HTTP ${rows.status}`);
  }
}

console.log("\n总判定:", results.every(([, ok]) => ok) ? "✅ 全部通过" : "❌ 存在失败项");
