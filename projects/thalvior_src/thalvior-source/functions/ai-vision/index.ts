import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPoolBalance, deductFromPool, addPurchasedCredits, hasBenefit } from '../_shared/pool.ts';

// 自建部署：AI 改为阿里云百炼（Bailian MaaS 工作空间），彻底脱离 meoo
// 图片翻译专用引擎：qwen-mt-image-2.0（图进图出，电商排版还原，¥0.003/张，55 语种）
const MT_IMAGE_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';

const BAILIAN_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';

// 百炼真实视觉模型名直接透传。qwen3-vl-plus（¥1/¥10 每百万 Token，≤32K）
// 不得再降级映射到 qwen-vl-max（¥1.6/¥4），否则能力与单价都对不上官方标准。
// 2026-09-28 实测：本工作空间（ws-14w50zl0wvf8lldk）仅开通 qwen3.8-omni-flash（多模态视觉），
// qwen3-vl-plus / qwen-vl-ocr 均未开通（403），统一收敛到 qwen3.8-omni-flash。
const MODEL_MAP: Record<string, string> = {
  'qwen-vl-plus': 'qwen3.8-omni-flash',
  'qwen3-vl-plus': 'qwen3.8-omni-flash',
  'qwen-vl-max': 'qwen3.8-omni-flash',
  'qwen2-vl': 'qwen3.8-omni-flash',
  'qwen-vl-ocr': 'qwen3.8-omni-flash',
};

// ===== 按官方单价精算费用（元 / 百万 Token，含阶梯） =====
function pickTier(tiers: unknown, promptTokens: number): { input: number; output: number } | null {
  if (!Array.isArray(tiers) || tiers.length === 0) return null;
  const sorted = [...tiers].sort(
    (a: Record<string, number>, b: Record<string, number>) => a.up_to_tokens - b.up_to_tokens,
  );
  for (const t of sorted as Record<string, number>[]) {
    if (promptTokens <= t.up_to_tokens) return { input: Number(t.input), output: Number(t.output) };
  }
  const last = sorted[sorted.length - 1] as Record<string, number>;
  return { input: Number(last.input), output: Number(last.output) };
}

// 售价倍率：向租户收取的金额 = 阿里云官方成本 × markup（后台可调）
function markupOf(pricing: Record<string, unknown> | null): number {
  const m = Number(pricing?.markup);
  return Number.isFinite(m) && m > 0 ? m : 1;
}

function calcTokenCost(
  pricing: Record<string, unknown> | null,
  promptTokens: number,
  completionTokens: number,
): number {
  const fallback = {
    input: Number(pricing?.input_price_per_mtok ?? 0) || 0,
    output: Number(pricing?.output_price_per_mtok ?? 0) || 0,
  };
  const unit = pickTier(pricing?.price_tiers, promptTokens) ?? fallback;
  const cost = (promptTokens / 1_000_000) * unit.input + (completionTokens / 1_000_000) * unit.output;
  return Math.round(cost * 1e6) / 1e6;
}

// 成本 → 售价
function sell(cost: number, pricing: Record<string, unknown> | null): number {
  return Math.round(cost * markupOf(pricing) * 1e6) / 1e6;
}

// ===== AI 积分账户体系（2026-09-26 改造）=====
// 租户购买/套餐赠送的是「AI 积分」；AI 功能消耗只扣除积分，绝不扣真实现金余额(balance)。
// 兑换口径：1 元 = 20 积分
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

function estimateCost(pricing: Record<string, unknown> | null, inputChars: number, maxOutputTokens: number): number {
  const promptTokens = Math.max(1, Math.ceil(inputChars / 2));
  return calcTokenCost(pricing, promptTokens, maxOutputTokens);
}

function inputCharsOf(messages: unknown[]): number {
  return messages.reduce((sum: number, m: Record<string, unknown>) => {
    const c = m?.content;
    if (typeof c === 'string') return sum + c.length;
    if (Array.isArray(c)) return sum + JSON.stringify(c).length;
    return sum;
  }, 0);
}

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

// ===== 现金计费（编辑页原位 AI）：图片翻译 ¥0.45/张，新人免费 5 张（独立计数）=====
// 与积分账并行的第二套账：cash_price > 0 的服务只扣现金余额 balance，不动积分。
const FREE_TABLE = 'ai_free_quotas';
const CASH_TABLE = 'ai_cash_usage';

async function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// 读取免费额度（缺失则视为 0，由注册钩子发券）
async function getFreeQuota(userId: string, field: string): Promise<number> {
  const admin = await adminClient();
  const { data } = await admin
    .from(FREE_TABLE)
    .select(field)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return 0;
  const row = data as unknown as Record<string, unknown>;
  return Math.max(0, Number(row[field] ?? 0));
}

// 扣减现金余额
async function deductCash(userId: string, amount: number): Promise<number> {
  const admin = await adminClient();
  const { data: quota } = await admin
    .from('tenant_quotas')
    .select('balance')
    .eq('user_id', userId)
    .maybeSingle();
  if (!quota) return 0;
  const newBalance = Math.max(0, Math.round((Number(quota.balance ?? 0) - amount) * 1e6) / 1e6);
  await admin
    .from('tenant_quotas')
    .update({ balance: newBalance, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return newBalance;
}

// 结算现金账单：优先抵扣免费额度，剩余按单价扣现金
// 返回 { freeUsed, paidUsed, amount, balanceAfter }
async function settleCashBilling(
  userId: string,
  serviceKey: string,
  unitPrice: number,
  quantity: number,
  freeField: string | null,
): Promise<{ freeUsed: number; paidUsed: number; amount: number; balanceAfter: number | null }> {
  const admin = await adminClient();
  let freeUsed = 0;
  let paidUsed = quantity;

  if (freeField) {
    const free = await getFreeQuota(userId, freeField);
    freeUsed = Math.min(free, quantity);
    paidUsed = quantity - freeUsed;
    if (freeUsed > 0) {
      await admin
        .from(FREE_TABLE)
        .update({ [freeField]: free - freeUsed, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    }
  }

  const amount = Math.round(unitPrice * paidUsed * 1e6) / 1e6;
  let balanceAfter: number | null = null;
  if (amount > 0) balanceAfter = await deductCash(userId, amount);

  await admin.from(CASH_TABLE).insert({
    user_id: userId,
    service_key: serviceKey,
    quantity,
    unit_price: unitPrice,
    amount,
    free_used: freeUsed,
    paid_used: paidUsed,
    balance_after: balanceAfter,
  });

  return { freeUsed, paidUsed, amount, balanceAfter };
}

async function writeUsageLog(
  userId: string,
  serviceKey: string,
  serviceName: string,
  cost: number,
  status: string,
  usage?: { promptTokens: number; completionTokens: number; quantity: number; credits?: number },
) {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
  await admin.from('ai_usage_logs').insert({
    user_id: userId,
    service_key: serviceKey,
    service_name: serviceName,
    cost,
    credits: usage?.credits ?? null,
    status,
    prompt_tokens: usage?.promptTokens ?? 0,
    completion_tokens: usage?.completionTokens ?? 0,
    quantity: usage?.quantity ?? 1,
  });
}

Deno.serve(async (req) => {
  const functionName = 'ai-vision';
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();

  try {
    const apiKey = Deno.env.get('DASHSCOPE_API_KEY') || '';
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'AI 服务凭证未配置（DASHSCOPE_API_KEY），请联系管理员' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const body = await req.json();
    let messages;

    if (body.messages) {
      messages = body.messages;
    } else {
      const { text, imageUrl } = body;
      messages = [{
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      }];
    }
    const serviceKey = body.service_key || 'image_translate';
    const model = MODEL_MAP[body.model] || body.model || 'qwen3.8-omni-flash';
    console.info(`[${functionName}] request ${requestId} serviceKey=${serviceKey} model=${model} messages=${Array.isArray(messages) ? messages.length : 0}`);

    // 额度预校验（估算上限，真实费用按 usage 精算）
    const userId = await resolveUserId(req);
    let billing: { userId: string; serviceKey: string; serviceName: string; cost: number; credits: number; cashUnit?: number; cashQty?: number; freeField?: string | null; packUsed?: boolean; packId?: string | null } | null = null;
    let pricing: Record<string, unknown> | null = null;
    // 图片翻译次数包优先：有有效次数包时不再扣积分池（第三方翻译服务接入后启用）
    let translatePackUsed = false;
    let translatePackId: string | null = null;
    if (userId && serviceKey === 'image_translate') {
      const admin = await adminClient();
      const { data: pack } = await admin
        .from('translate_packs')
        .select('id, remaining, expires_at')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gt('remaining', 0)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (pack) {
        const packExpired = pack.expires_at ? new Date(pack.expires_at as string).getTime() < Date.now() : false;
        if (!packExpired) {
          translatePackUsed = true;
          translatePackId = pack.id as string;
        }
      }
    }
    // 妙手式硬门槛：图片翻译只认独立次数包，无包直接拦截（不消耗 AI 积分）
    if (serviceKey === 'image_translate' && !translatePackUsed) {
      return new Response(
        JSON.stringify({ error: '图片翻译采用独立次数包计费（不消耗 AI 积分）。您还没有可用的翻译次数包，请前往「AI 资源」页购买后使用', code: 'TRANSLATE_PACK_REQUIRED' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (userId) {
      if (translatePackUsed) {
        // 次数包内免费使用（不再校验/扣除工作台积分）
        billing = { userId, serviceKey, serviceName: (pricing?.service_name as string) || '图片翻译', cost: 0, credits: 0, packUsed: true, packId: translatePackId };
        pricing = pricing ?? { billing_mode: 'flat', unit_price: 0 };
      } else {
      pricing = await getPricing(serviceKey);
      if (pricing && pricing.status === '停用') {
        return new Response(
          JSON.stringify({ error: '该 AI 能力已停用，请联系管理员' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const expectedOutputTokens = Number(body.max_output_tokens) || 2048;
      const estimated = sell(
        pricing && pricing.billing_mode === 'token'
          ? estimateCost(pricing, inputCharsOf(messages), expectedOutputTokens)
          : Number(pricing?.unit_price) || 0,
        pricing,
      );
      // 统一 AI 积分计费：所有 AI 能力（含图片翻译）只扣积分 credits，不再走现金余额双轨
      // （cash_price 保留在后台仅作参考，不计费）
      const estimatedCredits = creditsToCharge(pricing, estimated);
      // 无额度账户一律按 0 余额处理：不允许"无记录 = 免费使用"的漏洞
      const creditsBalance = await getPoolBalance(userId, 'workbench');
      if (creditsBalance < estimatedCredits) {
        return new Response(
          JSON.stringify({ error: `AI 工作台积分不足，本次预计消耗 ${estimatedCredits} 积分，当前可用 ${creditsBalance} 积分（含今日赠送），请先购买 AI 积分包或订阅套餐` }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        );
      }
      billing = { userId, serviceKey, serviceName: (pricing?.service_name as string) || '图片翻译', cost: estimated, credits: estimatedCredits };
    }
    }

    // ── 图片翻译专用分支：qwen-mt-image-2.0 图进图出（妙手式合成回图） ──
    if (serviceKey === 'image_translate') {
      let mtImageUrl: string | null = body.image_url || body.imageUrl || null;
      if (!mtImageUrl && Array.isArray(messages?.[0]?.content)) {
        const imgPart = (messages[0].content as Array<{ type?: string; image_url?: { url?: string } }>).find((p) => p?.type === 'image_url');
        mtImageUrl = imgPart?.image_url?.url ?? null;
      }
      if (!mtImageUrl || typeof mtImageUrl !== 'string') {
        return new Response(
          JSON.stringify({ error: '缺少图片，请重新上传产品图' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const targetLang = String(body.target_lang || body.targetLang || 'en').toLowerCase();
      const sourceLang = String(body.source_lang || body.sourceLang || 'auto').toLowerCase();
      const admin = await adminClient();
      try {
        // 兼容老客户端传 base64：先转存自有 storage 换公网 URL（mt-image 只收公网 URL）
        if (mtImageUrl.startsWith('data:')) {
          const b64 = mtImageUrl.split(',')[1] || '';
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const tmpPath = `workbench/${billing?.userId || 'anon'}/in-${requestId}.jpg`;
          const { error: inErr } = await admin.storage.from('d1439de1-7fc8-470b-93ba-152887a05385').upload(tmpPath, bytes, { contentType: 'image/jpeg', upsert: true });
          if (inErr) throw new Error(`输入图转存失败: ${inErr.message}`);
          const { data: inPub } = admin.storage.from('d1439de1-7fc8-470b-93ba-152887a05385').getPublicUrl(tmpPath);
          mtImageUrl = inPub?.publicUrl || null;
          if (!mtImageUrl) throw new Error('输入图转存失败');
        }
        // 上游偶发拉图超时，自动重试一次
        let mtJson: Record<string, unknown> | null = null;
        let tempUrl: string | undefined;
        for (let attempt = 1; attempt <= 2; attempt++) {
          const mtResp = await fetch(`${MT_IMAGE_BASE_URL}/api/v1/services/aigc/image2image/image-synthesis`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'qwen-mt-image-2.0',
              input: { image_url: mtImageUrl, source_lang: sourceLang, target_lang: targetLang },
            }),
          });
          mtJson = await mtResp.json().catch(() => null);
          tempUrl = mtJson?.output?.image_url as string | undefined;
          if (mtResp.ok && tempUrl) break;
          console.warn(`[${functionName}] mt-image attempt ${attempt} failed: ${mtJson?.message || mtJson?.error || `status=${mtResp.status}`}`);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
        }
        if (!tempUrl) {
          const mtErr = mtJson?.message || mtJson?.error || '上游未返回结果图';
          console.error(`[${functionName}] mt-image failed ${requestId}: ${mtErr}`);
          if (billing?.userId) await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, 0, '失败');
          return new Response(
            JSON.stringify({ error: `图片翻译失败（${mtErr}），本次未扣除次数，请稍后重试` }),
            { status: 502, headers: { 'Content-Type': 'application/json' } },
          );
        }
        // 上游 OSS 结果链接 24h 过期 → 转存自有 storage 得永久链接
        const imgResp = await fetch(tempUrl);
        if (!imgResp.ok) throw new Error(`结果图下载失败 status=${imgResp.status}`);
        const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
        const objectPath = `workbench/${billing?.userId || 'anon'}/mt-${requestId}.jpg`;
        const { error: upErr } = await admin.storage.from('d1439de1-7fc8-470b-93ba-152887a05385').upload(objectPath, imgBytes, { contentType: 'image/jpeg', upsert: true });
        if (upErr) throw new Error(`结果图转存失败: ${upErr.message}`);
        const { data: pub } = admin.storage.from('d1439de1-7fc8-470b-93ba-152887a05385').getPublicUrl(objectPath);
        const finalUrl = `https://thalvior.icu/storage/v1/object/public/d1439de1-7fc8-470b-93ba-152887a05385/${objectPath}`;
        // 扣次数包 + 记账（成功才扣，失败不扣）
        if (billing?.userId) {
          if (billing.packUsed && billing.packId) {
            const { data: curPack } = await admin.from('translate_packs').select('remaining').eq('id', billing.packId).maybeSingle();
            if (curPack && Number(curPack.remaining) > 0) {
              await admin.from('translate_packs')
                .update({ remaining: Number(curPack.remaining) - 1 })
                .eq('id', billing.packId);
            }
          }
          await writeUsageLog(
            billing.userId,
            billing.serviceKey,
            billing.serviceName,
            0.003,
            '成功',
            { quantity: 1, pack: billing.packId ?? null, model: 'qwen-mt-image-2.0', targetLang },
          );
          console.info(`[${functionName}] mt-image billed ${requestId} via translate_pack=${billing.packId} target=${targetLang}`);
        }
        return new Response(
          JSON.stringify({ mode: 'image', imageUrl: finalUrl }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      } catch (mtErr) {
        const message = mtErr instanceof Error ? mtErr.message : String(mtErr);
        console.error(`[${functionName}] mt-image branch failed ${requestId}: ${message}`);
        if (billing?.userId) await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, 0, '失败');
        return new Response(
          JSON.stringify({ error: `图片翻译失败：${message}` }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    const response = await fetch(
      `${BAILIAN_BASE_URL}/compatible-mode/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(body.enable_thinking === true ? { enable_thinking: true } : {}),
        }),
      }
    );
    const upstreamDuration = Date.now() - startTime;
    console.info(`[${functionName}] upstream ${requestId} status=${response.status} durationMs=${upstreamDuration}`);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[${functionName}] upstream failed ${requestId} status=${response.status}: ${errorBody.slice(0, 300)}`);
      if (billing?.userId) {
        await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, billing.cost, '失败');
      }
      return new Response(errorBody, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let chunkCount = 0;
    let totalBytes = 0;
    let sseBuffer = '';
    let usage: { prompt_tokens: number; completion_tokens: number } | null = null;

    const readable = new ReadableStream({
      async start(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunkCount++;
            totalBytes += value.byteLength;
            controller.enqueue(value);

            sseBuffer += decoder.decode(value, { stream: true });
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const json = JSON.parse(payload);
                if (json?.usage && typeof json.usage.prompt_tokens === 'number') {
                  usage = json.usage;
                }
              } catch {
                // 忽略非 JSON 行
              }
            }
          }
          controller.close();

          if (billing?.userId) {
            const admin = await adminClient();
            const promptTokens = usage?.prompt_tokens ?? 0;
            const completionTokens = usage?.completion_tokens ?? 0;
            const rawCost = usage && (promptTokens > 0 || completionTokens > 0)
              ? calcTokenCost(pricing, promptTokens, completionTokens)
              : billing.cost;
            const realCost = sell(rawCost, pricing);
            if (billing.cashUnit && billing.cashUnit > 0) {
              // 兼容历史：现金分支已停用，统一走积分
            }
            {
              if (billing.packUsed && billing.packId) {
                // 图片翻译次数包：扣次数包剩余，不扣积分池
                const { data: curPack } = await admin.from('translate_packs').select('remaining').eq('id', billing.packId).maybeSingle();
                if (curPack && Number(curPack.remaining) > 0) {
                  await admin.from('translate_packs')
                    .update({ remaining: Number(curPack.remaining) - 1 })
                    .eq('id', billing.packId);
                }
                await writeUsageLog(
                  billing.userId,
                  billing.serviceKey,
                  billing.serviceName,
                  0,
                  '成功',
                  { promptTokens, completionTokens, quantity: 1, pack: billing.packId },
                );
                console.info(`[${functionName}] billed ${requestId} via translate_pack=${billing.packId}`);
              } else {
              // 固定积分/次：按后台配置扣除 AI 积分（不再扣除现金余额）
              const billedCredits = creditsToCharge(pricing, realCost);
              await deductFromPool(billing.userId, 'workbench', billedCredits);
              await writeUsageLog(
                billing.userId,
                billing.serviceKey,
                billing.serviceName,
                realCost,
                '成功',
                { promptTokens, completionTokens, quantity: 1, credits: billedCredits },
              );
              console.info(`[${functionName}] billed ${requestId} tokens=${promptTokens}/${completionTokens} cost=¥${realCost} credits=${billedCredits}`);
              }
            }
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
      JSON.stringify({ error: err instanceof Error ? err.message : 'Internal Server Error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
