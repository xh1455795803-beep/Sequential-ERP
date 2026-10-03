// 汇率代理：多源降级，无需强制 API key
// 源 1：exchangerate.dev（配置了 EXCHANGERATE_API_KEY 时带鉴权，未配置时以匿名配额请求）
// 源 2：frankfurter.dev（ECB 参考汇率，完全免 key，覆盖 USD/CNY/EUR/GBP/JPY/AUD/CAD/HKD/KRW/SGD）
// 任一源成功即返回，全部失败才报错——避免「缺 Key 就整页兜底」的死局

const EXCHANGERATE_BASE = 'https://api.exchangerate.dev';
const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RateResult {
  base: string;
  rates: Record<string, number>;
  data_updated_at?: string | null;
  timestamp?: string | number | null;
  provider: string;
}

async function tryExchangeRateDev(
  base: string,
  symbols: string,
  requestId: string,
): Promise<RateResult | null> {
  try {
    const apiKey = Deno.env.get('EXCHANGERATE_API_KEY') || '';
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const url = `${EXCHANGERATE_BASE}/v1/latest/${base}?symbols=${symbols}`;
    const resp = await fetch(url, { headers });
    const result = await resp.json();
    if (!resp.ok || result?.result === 'error' || !result?.rates) {
      console.warn(
        `[exchange-rate] ${requestId} exchangerate.dev 不可用: ${result?.message || `HTTP ${resp.status}`}`,
      );
      return null;
    }
    return {
      base: result.base ?? base,
      rates: result.rates,
      data_updated_at: result.data_updated_at ?? null,
      timestamp: result.timestamp ?? null,
      provider: apiKey ? 'exchangerate.dev(keyed)' : 'exchangerate.dev(anon)',
    };
  } catch (err) {
    console.warn(
      `[exchange-rate] ${requestId} exchangerate.dev 请求异常: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function tryFrankfurter(
  base: string,
  symbols: string,
  requestId: string,
): Promise<RateResult | null> {
  try {
    const url = `${FRANKFURTER_BASE}/latest?base=${base}&symbols=${symbols}`;
    const resp = await fetch(url);
    const result = await resp.json();
    if (!resp.ok || !result?.rates) {
      console.warn(`[exchange-rate] ${requestId} frankfurter 不可用: HTTP ${resp.status}`);
      return null;
    }
    return {
      base: result.base ?? base,
      rates: result.rates,
      data_updated_at: result.date ?? null,
      timestamp: result.date ?? null,
      provider: 'frankfurter(ECB)',
    };
  } catch (err) {
    console.warn(
      `[exchange-rate] ${requestId} frankfurter 请求异常: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

Deno.serve(async (req) => {
  const functionName = 'exchange-rate';
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== 'POST') {
      return json({ error: '仅支持 POST 请求' }, 405);
    }

    const body = await req.json();
    const { source, currencies } = body as {
      source?: string;
      currencies?: string[];
    };

    const base = (source || 'USD').toUpperCase();
    const symbols = Array.isArray(currencies) && currencies.length > 0
      ? currencies.join(',')
      : 'CNY,EUR,GBP,JPY,AUD,CAD,HKD,KRW,SGD';

    console.info(`[${functionName}] request ${requestId} base=${base} symbols=${symbols}`);

    // 源 1 失败即自动切源 2
    const live = (await tryExchangeRateDev(base, symbols, requestId)) ??
      (await tryFrankfurter(base, symbols, requestId));

    if (!live) {
      console.error(`[${functionName}] ${requestId} 全部汇率源均不可用`);
      return json({ error: '汇率服务暂时不可用，请稍后重试' }, 502);
    }

    console.info(
      `[${functionName}] success ${requestId} provider=${live.provider} rates=${Object.keys(live.rates).length}`,
    );
    return json({
      success: true,
      base: live.base,
      rates: live.rates,
      timestamp: live.timestamp,
      data_updated_at: live.data_updated_at,
      provider: live.provider,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return json({ error: message }, 500);
  }
});
