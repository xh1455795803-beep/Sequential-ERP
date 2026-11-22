// ============================================================
// product-translate · P0-2 产品 AI 翻译 · 2026-10-15
// 把产品标题/描述/变体名翻译成目标语言，落库 products.i18n
// 计费：service_pricing.product_translate（credits_per_use），
//       _shared/pool.ts deductFromPool('workbench')，先预校验后扣费，失败不扣
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPoolBalance, deductFromPool } from '../_shared/pool.ts';

const MEOO_AI_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';
const MODEL = 'qwen3.8-omni-flash';
const SERVICE_KEY = 'product_translate';
const SERVICE_NAME = 'AI产品翻译';
const CREDITS_PER_YUAN = 20;

// 目标语言白名单（与前端 TRANSLATE_TARGET_LANGS 对齐）
const LANGS: Record<string, string> = {
  ru: '俄语（Russian）',
  en: '英语（English）',
  ja: '日语（Japanese）',
  ko: '韩语（Korean）',
  es: '西班牙语（Spanish）',
  fr: '法语（French）',
  de: '德语（German）',
  it: '意大利语（Italian）',
  vi: '越南语（Vietnamese）',
  th: '泰语（Thai）',
  ar: '阿拉伯语（Arabic）',
  pt: '葡萄牙语（Portuguese）',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

async function resolveUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = adminClient();
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function getPricing(admin: ReturnType<typeof createClient>) {
  const { data } = await admin
    .from('service_pricing')
    .select('*')
    .eq('service_key', SERVICE_KEY)
    .maybeSingle();
  return data;
}

async function writeUsageLog(
  admin: ReturnType<typeof createClient>,
  userId: string,
  cost: number,
  status: string,
  credits?: number,
) {
  await admin.from('ai_usage_logs').insert({
    user_id: userId,
    service_key: SERVICE_KEY,
    service_name: SERVICE_NAME,
    cost,
    credits: credits ?? null,
    status,
  });
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json/gi, '```').split('```').filter(Boolean);
  const candidates = [text, ...cleaned];
  for (const c of candidates) {
    const start = c.indexOf('{');
    const end = c.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(c.slice(start, end + 1));
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  const functionName = 'product-translate';
  const requestId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  try {
    if (req.method === 'OPTIONS') {
      return new Response('ok', {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
        },
      });
    }

    const admin = adminClient();
    const userId = await resolveUserId(req);
    if (!userId) return json({ error: '未登录或登录已过期' }, 401);

    const body = await req.json().catch(() => ({}));
    const productId = String(body.product_id ?? '').trim();
    const targetLang = String(body.target_lang ?? '').trim().toLowerCase();
    if (!productId || !targetLang) return json({ error: '缺少 product_id 或 target_lang' }, 400);
    if (!LANGS[targetLang]) return json({ error: `不支持的目标语言：${targetLang}` }, 400);

    const pricing = await getPricing(admin);
    if (pricing && pricing.status === '停用') {
      return json({ error: '该 AI 能力已停用，请联系管理员' }, 403);
    }
    const credits = Number(pricing?.credits_per_use) || 2;

    // 1. 产品校验（本人）
    const { data: product, error: pErr } = await admin
      .from('products')
      .select('id, name, description, variants, i18n')
      .eq('id', productId)
      .eq('user_id', userId)
      .maybeSingle();
    if (pErr || !product) return json({ error: '产品不存在或不属于当前用户' }, 404);
    if (!String(product.name ?? '').trim() && !String(product.description ?? '').trim()) {
      return json({ error: '产品标题与描述均为空，无可翻译内容' }, 400);
    }

    // 2. 变体名集合（product_variants.attributes "名:值 / 名:值"）
    const { data: variantRows } = await admin
      .from('product_variants')
      .select('attributes')
      .eq('product_id', productId);
    const variantTerms = new Set<string>();
    for (const row of variantRows ?? []) {
      for (const seg of String((row as { attributes?: string }).attributes || '').split(' / ')) {
        const i = seg.indexOf(':');
        if (i > 0) {
          const name = seg.slice(0, i).trim();
          const option = seg.slice(i + 1).trim();
          if (name) variantTerms.add(name);
          if (option) variantTerms.add(option);
        } else if (seg.trim()) {
          variantTerms.add(seg.trim());
        }
      }
    }
    const variantList = [...variantTerms].slice(0, 40);

    // 3. AI 积分预校验（workbench 池）
    const balance = await getPoolBalance(userId, 'workbench');
    if (balance < credits) {
      return json(
        {
          error: `AI 积分不足：本次翻译需要 ${credits} 积分，当前剩余 ${balance} 积分，请先充值或订阅套餐`,
          code: 'INSUFFICIENT_CREDITS',
          required: credits,
          balance,
        },
        402,
      );
    }

    // 4. LLM 翻译（非流式，强约束 JSON）
    const apiKey =
      Deno.env.get('MEOO_PROJECT_API_KEY') || Deno.env.get('DASHSCOPE_API_KEY') || '';
    if (!apiKey) return json({ error: 'AI 服务凭证未配置，请联系管理员' }, 503);

    const prompt = `你是跨境电商产品资料翻译专家。把下面 JSON 里的产品信息翻译成${LANGS[targetLang]}。
要求：
1) name 是产品标题，description 是产品描述，均需地道、符合电商平台买家习惯；description 为空则返回空字符串。
2) variants 是需要翻译的变体属性词表（属性名或选项值），逐词翻译，输出 { "原文": "译文" } 映射；列表为空则返回空对象。
3) 只输出 JSON，不要任何解释或代码块标记。JSON 结构：{"name":"...","description":"...","variants":{...}}

待翻译内容：
${JSON.stringify({
  name: product.name ?? '',
  description: product.description ?? '',
  variants: variantList,
})}`;

    const llmResp = await fetch(`${MEOO_AI_BASE_URL}/compatible-mode/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        temperature: 0.3,
      }),
    });
    if (!llmResp.ok) {
      const errText = await llmResp.text().catch(() => '');
      console.error(`[${functionName}] ${requestId} upstream ${llmResp.status}: ${errText.slice(0, 300)}`);
      await writeUsageLog(admin, userId, 0, '失败');
      return json({ error: 'AI 翻译服务暂时不可用，请稍后重试' }, 502);
    }
    const llmJson = await llmResp.json().catch(() => null);
    const content: string = llmJson?.choices?.[0]?.message?.content ?? '';
    const parsed = extractJson(content);
    if (!parsed || typeof parsed !== 'object') {
      console.error(`[${functionName}] ${requestId} JSON 解析失败: ${content.slice(0, 200)}`);
      await writeUsageLog(admin, userId, 0, '失败');
      return json({ error: 'AI 返回格式异常，请重试' }, 502);
    }

    const translatedName = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const translatedDesc = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    const variantsOut =
      parsed.variants && typeof parsed.variants === 'object' && !Array.isArray(parsed.variants)
        ? (parsed.variants as Record<string, string>)
        : {};
    if (!translatedName && !translatedDesc) {
      await writeUsageLog(admin, userId, 0, '失败');
      return json({ error: 'AI 未返回有效翻译结果，请重试' }, 502);
    }

    // 5. 成功才扣费（先赠送后充值）+ 写日志 + 落库
    const cost = Math.round((credits / CREDITS_PER_YUAN) * 100) / 100;
    const deducted = await deductFromPool(userId, 'workbench', credits);
    if (!deducted.ok) {
      return json(
        {
          error: `AI 积分不足：本次翻译需要 ${credits} 积分，当前剩余 ${deducted.balance} 积分，请先充值或订阅套餐`,
          code: 'INSUFFICIENT_CREDITS',
          required: credits,
          balance: deducted.balance,
        },
        402,
      );
    }
    await writeUsageLog(admin, userId, cost, '成功', credits);

    const existingI18n =
      product.i18n && typeof product.i18n === 'object' && !Array.isArray(product.i18n)
        ? (product.i18n as Record<string, unknown>)
        : {};
    const nextI18n = {
      ...existingI18n,
      [targetLang]: {
        ...(existingI18n[targetLang] as Record<string, unknown> | undefined),
        name: translatedName || (existingI18n[targetLang] as { name?: string })?.name || '',
        description:
          translatedDesc || (existingI18n[targetLang] as { description?: string })?.description || '',
        variants: variantsOut,
        translated_at: new Date().toISOString(),
      },
    };
    const { error: updErr } = await admin
      .from('products')
      .update({ i18n: nextI18n })
      .eq('id', productId)
      .eq('user_id', userId);
    if (updErr) {
      console.error(`[${functionName}] ${requestId} 落库失败: ${updErr.message}`);
      return json({ error: `翻译完成但落库失败：${updErr.message}` }, 500);
    }

    console.info(
      `[${functionName}] ${requestId} ok product=${productId} lang=${targetLang} credits=${credits} variants=${Object.keys(variantsOut).length} durationMs=${Date.now() - startTime}`,
    );
    return json({
      success: true,
      lang: targetLang,
      credits_charged: credits,
      i18n: nextI18n[targetLang],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${functionName}] ${requestId} ${msg}`);
    return json({ error: msg }, 500);
  }
});
