// 快递鸟（KDNiao）物流轨迹代理：服务端代理调用快递鸟 API，密钥留在后端
// 凭证通过环境变量 KDNIAO_EBUSINESS_ID / KDNIAO_API_KEY 注入，不暴露给前端
// 动作：action = 'track'（快递查询，RequestType=8002，自动识别物流公司）
// 端点：POST https://api.kdniao.com/Ebusiness/EbusinessOrderHandle.aspx
// 鉴权：DataSign = URLEncode(base64(md5(RequestData + APIKey)))

const KDNIAO_BASE = 'https://api.kdniao.com/Ebusiness/EbusinessOrderHandle.aspx';

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

// 计算快递鸟签名：URLEncode(base64(md5(RequestData + APIKey)))
async function md5Base64(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('MD5', data);
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// 快递鸟轨迹节点 → 统一 TrackingEvent 结构
interface KdniaoTrace {
  AcceptTime?: string;
  AcceptStation?: string;
  Remark?: string;
}

interface TrackingEvent {
  time: string;
  location: string;
  description: string;
  status: string;
}

function toEvents(traces: KdniaoTrace[]): TrackingEvent[] {
  return traces.map((tr) => {
    const description = tr.AcceptStation ?? tr.Remark ?? '';
    return {
      time: tr.AcceptTime ?? '',
      location: '',
      description,
      status: description,
    };
  });
}

// 快递查询轨迹（RequestType=8002，自动识别物流公司）
async function queryTracking(
  eBusinessId: string,
  apiKey: string,
  trackingNo: string,
): Promise<{ events: TrackingEvent[]; raw: unknown }> {
  const requestData = JSON.stringify({ OrderCode: trackingNo });
  // 签名：URLEncode(base64(md5(RequestData + APIKey)))
  const dataSign = encodeURIComponent(await md5Base64(requestData + apiKey));

  const form = new URLSearchParams();
  form.set('EBusinessID', eBusinessId);
  form.set('RequestType', '8002');
  form.set('RequestData', encodeURIComponent(requestData));
  form.set('DataSign', dataSign);
  form.set('DataType', '2');

  const resp = await fetch(KDNIAO_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: form.toString(),
  });
  const result = (await resp.json()) as {
    Success?: boolean;
    Reason?: string;
    Traces?: KdniaoTrace[];
    State?: string;
  };

  if (!resp.ok) {
    throw new Error(`查询轨迹失败: HTTP ${resp.status}`);
  }
  if (result.Success === false) {
    throw new Error(result.Reason || '快递鸟查询失败');
  }

  return { events: toEvents(result.Traces ?? []), raw: result };
}

Deno.serve(async (req) => {
  const functionName = 'tracking';
  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    if (req.method !== 'POST') {
      return json({ error: '仅支持 POST 请求' }, 405);
    }

    const body = await req.json();
    const { action, tracking_no } = body as {
      action?: string;
      tracking_no?: string;
    };

    if (!tracking_no) {
      return json({ error: '缺少运单号 tracking_no' }, 400);
    }

    const eBusinessId = getEnv('KDNIAO_EBUSINESS_ID');
    const apiKey = getEnv('KDNIAO_API_KEY');

    if (action === 'track') {
      console.info(`[${functionName}] track ${requestId} no=${tracking_no}`);
      const { events } = await queryTracking(eBusinessId, apiKey, tracking_no);
      // 保持与前端解析逻辑对齐的返回结构：data.accepted[0].track.e
      return json({
        success: true,
        data: { accepted: [{ number: tracking_no, track: { e: events } }] },
      });
    }

    // 快递鸟 8001 无需 register，register 动作直接返回成功占位
    if (action === 'register') {
      return json({ success: true, data: { accepted: [{ number: tracking_no }] } });
    }

    return json({ error: '未知 action，仅支持 track' }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return json({ error: message }, 500);
  }
});