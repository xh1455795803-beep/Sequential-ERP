// 通途 ERP2.0 开放平台对接代理
// 鉴权流程：accessKey + secretAccessKey → 获取 app_token → app_token + timestamp + secretAccessKey 做 MD5 签名 → 调业务接口
// 凭证通过环境变量注入：TONGTOOL_ACCESS_KEY / TONGTOOL_SECRET_ACCESS_KEY
// 动作：action = 'getToken'（获取 app_token，调试用）| 其余请求透传 urlKey + params
// 已核对官方接口文档（2026-10-07）：
//   ordersQuery           订单查询        /openapi/tongtool/ordersQuery
//   packagesQuery         商户包裹信息    /openapi/tongtool/packagesQuery
//   merchantPlatformQuery 商户平台及站点  /openapi/tongtool/merchantPlatformQuery

import { createHash } from "node:crypto";

const TONGTOOL_BASE = "https://open.tongtool.com";
const API_VERSION = "3.0"; // 接口版本号，放在协议头，不参与签名（官方开发指南）
const TOKEN_TTL_MS = 25 * 60 * 1000; // app_token 本地缓存，留足时钟余量
const ALLOWED_URL_KEYS = new Set([
  "ordersQuery",
  "packagesQuery",
  "merchantPlatformQuery",
  "goodsQuery",
  "warehouseQuery",
]);

let cachedToken: { value: string; expiresAt: number } | null = null;

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`缺少环境变量 ${name}，请先在云服务面板配置`);
  }
  return value;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// MD5 签名：md5("app_token" + app_token + "timestamp" + timestamp + secretAccessKey)
// 已用官方文档示例自验：结果与 08406606fa2a8479600bb75c39703595 完全一致
function md5(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

// 获取 app_token（带缓存）
async function getAppToken(accessKey: string, secretAccessKey: string): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const url = `${TONGTOOL_BASE}/open-platform-service/devApp/appToken?accessKey=${encodeURIComponent(accessKey)}&secretAccessKey=${encodeURIComponent(secretAccessKey)}`;
  const resp = await fetch(url, { headers: { "Content-Type": "application/json" } });
  const result = await resp.json();
  if (!result.success || !result.datas) {
    cachedToken = null;
    throw new Error(`获取 app_token 失败: ${result.message || JSON.stringify(result)}`);
  }
  cachedToken = { value: result.datas as string, expiresAt: Date.now() + TOKEN_TTL_MS };
  return cachedToken.value;
}

// 调用业务接口（自动签名；requestBody 不参与签名）
async function callBusinessApi(
  appToken: string,
  secretAccessKey: string,
  urlKey: string,
  body: Record<string, unknown>,
): Promise<{ status: number; payload: unknown }> {
  const timestamp = String(Date.now()); // 13 位 unix 毫秒（与官方示例一致）
  const sign = md5(`app_token${appToken}timestamp${timestamp}${secretAccessKey}`);
  const url = `${TONGTOOL_BASE}/api-service/openapi/tongtool/${urlKey}?app_token=${appToken}&timestamp=${timestamp}&sign=${sign}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      api_version: API_VERSION,
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: resp.status, payload: await resp.json().catch(() => null) };
}

Deno.serve(async (req) => {
  const functionName = "tongtool";
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== "POST") {
      return json({ error: "仅支持 POST 请求" }, 405);
    }

    const body = await req.json();
    const { action, urlKey, params } = body as {
      action?: string;
      urlKey?: string;
      params?: Record<string, unknown>;
    };

    const accessKey = getEnv("TONGTOOL_ACCESS_KEY");
    const secretAccessKey = getEnv("TONGTOOL_SECRET_ACCESS_KEY");

    // 获取 app_token（联调/健康检查用）
    if (action === "getToken") {
      const token = await getAppToken(accessKey, secretAccessKey);
      console.info(`[${functionName}] getToken success ${requestId}`);
      return json({ success: true, app_token: token });
    }

    if (!urlKey) {
      return json({ error: "缺少 urlKey" }, 400);
    }
    if (!ALLOWED_URL_KEYS.has(urlKey)) {
      return json({ error: `未开放的接口标识: ${urlKey}` }, 400);
    }

    const appToken = await getAppToken(accessKey, secretAccessKey);
    const { status, payload } = await callBusinessApi(appToken, secretAccessKey, urlKey, params ?? {});
    const code = (payload as { code?: number } | null)?.code;
    // 通途业务成功 code=200；523=未授权（应用未开通该接口，需去开放平台工单申请）
    if (code !== undefined && code !== 200) {
      console.warn(`[${functionName}] ${urlKey} biz fail ${requestId}: code=${code} status=${status}`);
      return json(payload, status === 200 ? 502 : status);
    }
    console.info(`[${functionName}] ${urlKey} success ${requestId}`);
    return json(payload, status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return json({ error: message }, 500);
  }
});
