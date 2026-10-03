// 通途 ERP 开放平台对接代理
// 鉴权流程：accessKey + secretAccessKey → 获取 app_token → 用 app_token + timestamp + secretAccessKey 做 MD5 签名 → 调业务接口
// 凭证通过环境变量注入：TONGTOOL_ACCESS_KEY / TONGTOOL_SECRET_ACCESS_KEY
// 动作：action = 'getToken'（获取 app_token）| 'orders'（订单查询）| 'accounts'（店铺账号）| 'products'（商品）| 'platforms'（平台站点）

const TONGTOOL_BASE = 'https://open.tongtool.com';

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
    headers: { 'Content-Type': 'application/json' },
  });
}

// MD5 签名：md5("app_token" + app_token + "timestamp" + timestamp + secretAccessKey)
async function md5(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('MD5', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// 获取 app_token
async function getAppToken(accessKey: string, secretAccessKey: string): Promise<string> {
  const url = `${TONGTOOL_BASE}/open-platform-service/devApp/appToken?accessKey=${accessKey}&secretAccessKey=${secretAccessKey}`;
  const resp = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  const result = await resp.json();
  if (!result.success) {
    throw new Error(`获取 app_token 失败: ${result.message || JSON.stringify(result)}`);
  }
  return result.datas as string;
}

// 调用业务接口（自动签名）
async function callBusinessApi(
  appToken: string,
  secretAccessKey: string,
  urlKey: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const timestamp = String(Date.now());
  const sign = await md5(`app_token${appToken}timestamp${timestamp}${secretAccessKey}`);
  const url = `${TONGTOOL_BASE}/api-service/openapi/tongtool/${urlKey}?app_token=${appToken}&timestamp=${timestamp}&sign=${sign}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api_version': '3.0',
    },
    body: JSON.stringify(body),
  });
  return await resp.json();
}

Deno.serve(async (req) => {
  const functionName = 'tongtool';
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== 'POST') {
      return json({ error: '仅支持 POST 请求' }, 405);
    }

    const body = await req.json();
    const { action, urlKey, params } = body as {
      action?: string;
      urlKey?: string;
      params?: Record<string, unknown>;
    };

    const accessKey = getEnv('TONGTOOL_ACCESS_KEY');
    const secretAccessKey = getEnv('TONGTOOL_SECRET_ACCESS_KEY');

    // 获取 app_token
    if (action === 'getToken') {
      const token = await getAppToken(accessKey, secretAccessKey);
      console.info(`[${functionName}] getToken success ${requestId}`);
      return json({ success: true, app_token: token });
    }

    // 业务接口调用
    if (!urlKey) {
      return json({ error: '缺少 urlKey' }, 400);
    }

    const appToken = await getAppToken(accessKey, secretAccessKey);
    const result = await callBusinessApi(appToken, secretAccessKey, urlKey, params ?? {});
    console.info(`[${functionName}] ${urlKey} success ${requestId}`);
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return json({ error: message }, 500);
  }
});