import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPoolBalance, deductFromPool, addPurchasedCredits, hasBenefit } from '../_shared/pool.ts';

const MEOO_AI_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';

// ===== AI 积分计费（与 ai-image-gen 同口径） =====
// 租户购买/套餐赠送的是「AI 积分」；AI 功能消耗只扣除积分，绝不扣真实现金余额(balance)。
// 兑换口径：1 元 = 20 积分（仅用于未配置固定积分时的兜底折算）
const CREDITS_PER_YUAN = 20;

function toCredits(amountYuan: number): number {
  return Math.round(amountYuan * CREDITS_PER_YUAN * 100) / 100;
}

// 取本次应扣积分：优先用后台配置的「固定积分/次」，未配置则按费用折算
function creditsToCharge(pricing: Record<string, unknown> | null, amountYuan: number): number {
  const fixed = pricing?.credits_per_use;
  if (fixed != null && Number.isFinite(Number(fixed)) && Number(fixed) > 0) return Number(fixed);
  return Math.max(1, Math.ceil(toCredits(amountYuan)));
}

// 计费辅助：解析 user_id、校验额度、扣费、写日志
async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function getPricing(serviceKey: string) {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  const { data } = await admin
    .from('service_pricing')
    .select('*')
    .eq('service_key', serviceKey)
    .maybeSingle();
  return data;
}

// 额度耗尽邮件提醒：fire-and-forget，失败只记日志
function notifyQuotaExhausted(userId: string): void {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return;
  void (async () => {
    try {
      const uRes = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!uRes.ok) return;
      const u = (await uRes.json()) as { email?: string };
      if (!u.email) return;
      await fetch(`${url}/functions/v1/mailer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 网关会改写 Authorization/apikey，服务端互调统一用共享密钥头
          'x-mailer-secret': Deno.env.get('MAILER_SECRET') || '',
        },
        body: JSON.stringify({
          action: 'send',
          scene: 'quota_exhausted',
          email: u.email,
          lang: 'zh',
          userId,
          dedupeHours: 24,
          vars: {},
        }),
      });
    } catch (e) {
      console.error(`[ai-chat] 额度耗尽邮件失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  })();
}

async function writeUsageLog(userId: string, serviceKey: string, serviceName: string, cost: number, status: string, credits?: number) {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  await admin.from('ai_usage_logs').insert({
    user_id: userId,
    service_key: serviceKey,
    service_name: serviceName,
    cost,
    credits: credits ?? null,
    status,
  });
}

Deno.serve(async (req) => {
  const functionName = 'ai-chat';
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  try {
    // 凭证解析顺序（向前兼容多租户项目级覆盖）：
    //   1) MEOO_PROJECT_API_KEY_<项目ID>   —— 项目级独立凭证
    //   2) MEOO_PROJECT_API_KEY            —— 全局项目凭证
    //   3) DASHSCOPE_API_KEY               —— 平台统一百炼凭证（与 ai-vision / ai-image-gen 一致）
    const projectUrlId = req.headers.get('X-Meoo-Project-Url-Id')?.trim() || '';
    const projectSecretName = `MEOO_PROJECT_API_KEY_${projectUrlId}`;
    const projectServiceAK =
      (projectUrlId ? Deno.env.get(projectSecretName) : '') ||
      Deno.env.get('MEOO_PROJECT_API_KEY') ||
      Deno.env.get('DASHSCOPE_API_KEY') ||
      '';
    if (!projectServiceAK) {
      console.error(`[${functionName}] 未找到可用 AI 凭证：MEOO_PROJECT_API_KEY(_${projectUrlId || 'n/a'}) / DASHSCOPE_API_KEY 均为空`);
      return new Response(
        JSON.stringify({ error: 'AI 服务凭证未配置，请联系管理员' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json();
    const messages = body.messages || [];
    const model = body.model || 'qwen3.8-omni-flash';
    const serviceKey = body.service_key || 'copywriting';
    const lastMessage = messages[messages.length - 1]?.content;

    console.info(`[${functionName}] request ${requestId} model=${model} serviceKey=${serviceKey} messages=${messages.length}`);

    // 额度预校验（AI 积分）
    const userId = await resolveUserId(req);
    let billing: { userId: string; serviceKey: string; serviceName: string; cost: number; credits: number } | null = null;
    // 「买 1,000 积分及以上」活动权益：AI 生成标题（title_gen）60 天免费
    let titleFree = false;
    if (userId && serviceKey === 'title_gen') {
      titleFree = await hasBenefit(userId, 'title_free');
    }
    if (userId) {
      const pricing = await getPricing(serviceKey);
      if (pricing && pricing.status === '停用') {
        return new Response(
          JSON.stringify({ error: '该 AI 能力已停用，请联系管理员' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const cost = pricing ? Number(pricing.unit_price) || 0 : 0;
      const credits = titleFree ? 0 : creditsToCharge(pricing, cost);
      const poolBalance = await getPoolBalance(userId, 'workbench');
      if (poolBalance < credits) {
        return new Response(
          JSON.stringify({ error: `AI 工作台积分不足：本次需要 ${credits} 积分，当前可用 ${poolBalance} 积分（含今日赠送），请先充值或订阅套餐` }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        );
      }
      billing = { userId, serviceKey, serviceName: pricing?.service_name || '文案优化', cost, credits };
    }

    const response = await fetch(
      `${MEOO_AI_BASE_URL}/compatible-mode/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${projectServiceAK}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, stream: true }),
      }
    );
    const upstreamDuration = Date.now() - startTime;
    console.info(`[${functionName}] upstream ${requestId} status=${response.status} durationMs=${upstreamDuration}`);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[${functionName}] upstream failed ${requestId} status=${response.status}: ${errorBody.slice(0, 300)}`);
      // 失败不扣费，写失败日志（记录预计消耗积分）
      if (billing?.userId) {
        await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, billing.cost, '失败', billing.credits);
      }
      return new Response(errorBody, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const reader = response.body!.getReader();
    let chunkCount = 0;
    let totalBytes = 0;
    const readable = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunkCount++;
            totalBytes += value.byteLength;
            controller.enqueue(value);
          }
          controller.close();
          // 成功扣费 + 写日志（扣 AI 积分，写 credits 字段）
          if (billing?.userId) {
            await deductFromPool(billing.userId, 'workbench', billing.credits, () => notifyQuotaExhausted(billing!.userId));
            await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, billing.cost, '成功', billing.credits);
          }
          console.info(`[${functionName}] stream done ${requestId} chunks=${chunkCount} bytes=${totalBytes} durationMs=${Date.now() - startTime}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[${functionName}] stream failed ${requestId}: ${message}`);
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});