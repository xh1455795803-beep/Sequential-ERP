import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPoolBalance, deductFromPool, addPurchasedCredits, hasBenefit } from '../_shared/pool.ts';

// 自建部署：AI 改为阿里云百炼（Bailian MaaS 工作空间），彻底脱离 meoo
//
// 2026-09-28 实测：本工作空间（ws-14w50zl0wvf8lldk）仅开通 wan2.7-image（文生图）。
// qwen-image-2.0 / qwen-image-3.0 / qwen-image-edit-* 均未开通（403 AccessDenied.Unpurchased）。
// 文生图统一走 wan2.7-image（OpenAI 兼容 chat/completions，¥0.2/张），
// 返回 choices[].message.content[].image（OSS URL），与下方 URL 解析逻辑兼容。
const BAILIAN_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';

// 旧模型名兼容映射（统一收敛到 qwen-image-2.0）
const MODEL_MAP: Record<string, string> = {
  'wanx': 'wan2.7-image',
  'wanx2.1-t2i-turbo': 'wan2.7-image',
  'wanx-v1': 'wan2.7-image',
  'qwen-image': 'wan2.7-image',
  'qwen-image-2.0': 'wan2.7-image',
  'qwen-image-3.0': 'wan2.7-image',
};

// ===== 抠图（matting）模式 =====
// 2026-09-28 实测：qwen-image-3.0 支持「同步」图生图（compatible-mode），
// content 元素必须用 DashScope 风格 { text, image }，不能用 OpenAI 风格 { type:'image_url', image_url }。
// 输出为纯 RGB PNG（不支持 alpha 通道），因此后端引导模型输出纯绿屏背景，
// 由前端 canvas 做色度键（chroma key）去绿，转透明底 PNG 后回传 storage。
const MATTING_MODEL = (Deno.env.get('MATTING_MODEL') || 'qwen-image-3.0').trim();
const MATTING_PROMPT =
  'Remove the background from the image. Replace the background with a solid pure green screen (#00FF00). ' +
  'Keep the main subject exactly the same, do not change its shape, colors or details.';


// storage bucket：本部署 storage-api v1.74 与 schema 不匹配，名称解析失效（name 一律 NoSuchBucket），
// 所有读写必须使用 bucket UUID（与 storage.objects.bucket_id 一致）。
const STORAGE_BUCKET_ID = 'd1439de1-7fc8-470b-93ba-152887a05385';
// ArrayBuffer → base64（Deno 全局 btoa 需要二进制字符串）
function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
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

async function writeUsageLog(
  userId: string,
  serviceKey: string,
  serviceName: string,
  cost: number,
  status: string,
  usage?: { quantity: number; credits?: number },
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
    quantity: usage?.quantity ?? 1,
  });
}

Deno.serve(async (req) => {
  const functionName = 'ai-image-gen';
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
    const { prompt: _prompt, model = 'wan2.7-image', size, n = 1 } = body;
    const prompt: string = typeof _prompt === 'string' ? _prompt : '';
    const images: string[] = Array.isArray(body.images) ? body.images : [];
    const serviceKey = body.service_key || 'image_process';
    const hasRefImages = Array.isArray(body.images) && body.images.some((u: unknown) => typeof u === 'string' && (u as string).trim() !== '');
    const refImages = images.filter((u) => typeof u === 'string' && u.trim() !== '');
    const isMatting = serviceKey === 'image_matting';
    const isEditMode = refImages.length > 0 && !isMatting;
    // 校验规则：
    //   - 文生图：prompt 必填、images 必须为空（百炼要求 text/image 互斥）
    //   - 图像编辑：prompt（编辑指令）必填 + images 至少 1 张
    //   - 抠图：prompt 由后端内置（引导绿屏），只需 images 至少 1 张
    if (!isMatting && (!prompt || typeof prompt !== 'string')) {
      return new Response(
        JSON.stringify({ error: hasRefImages ? '缺少编辑指令（prompt）' : '缺少参数 prompt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (isMatting && refImages.length === 0) {
      return new Response(
        JSON.stringify({ error: '抠图模式需要至少一张参考图（images）' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (typeof n !== 'number' || n < 1 || n > 4) {
      return new Response(
        JSON.stringify({ error: 'Parameter "n" is required and must be an integer between 1 and 4' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (isMatting && n !== 1) {
      return new Response(
        JSON.stringify({ error: '抠图模式一次仅支持处理 1 张图片（n=1）' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const finalModel = MODEL_MAP[model] || model;
    console.info(`[${functionName}] request ${requestId} model=${finalModel} serviceKey=${serviceKey} promptChars=${prompt.length} n=${n} images=${images.length}`);

    // 额度预校验：按张计费，单价取自 service_pricing（官方 ¥0.2/张）
    const userId = await resolveUserId(req);
    let billing: { userId: string; serviceKey: string; serviceName: string; unitPrice: number } | null = null;
    if (userId) {
      const pricing = await getPricing(serviceKey);
      if (pricing && pricing.status === '停用') {
        return new Response(
          JSON.stringify({ error: '该 AI 能力已停用，请联系管理员' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
      // 售价 = 官方成本单价 × markup（markup 在后台「增值服务配置」可调）
      const costPrice = Number(pricing?.unit_price) || 0;
      const markupRaw = Number(pricing?.markup);
      const markup = Number.isFinite(markupRaw) && markupRaw > 0 ? markupRaw : 1;
      const unitPrice = Math.round(costPrice * markup * 1e6) / 1e6;
      const estimated = unitPrice * n;
      // 每张应扣 AI 积分（固定积分/次，后台 service_pricing.credits_per_use 可调）
      const perImageCredits = creditsToCharge(pricing, unitPrice);
      const estimatedCredits = perImageCredits * n;
      // 无额度账户一律按 0 余额处理：不允许"无记录 = 免费使用"的漏洞
      const creditsBalance = await getPoolBalance(userId, 'workbench');
      if (creditsBalance < estimatedCredits) {
        return new Response(
          JSON.stringify({ error: `AI 工作台积分不足，本次预计消耗 ${estimatedCredits} 积分（${n} 张 × ${perImageCredits} 积分/张），当前可用 ${creditsBalance} 积分（含今日赠送），请先购买 AI 积分包或订阅套餐` }),
          { status: 402, headers: { 'Content-Type': 'application/json' } },
        );
      }
      billing = { userId, serviceKey, serviceName: (pricing?.service_name as string) || '图片处理', unitPrice };
    }

    // 百炼兼容模式约束：单条 user 消息内 'text' 与 'image_url' 互斥，不可同时出现。
    //   - 抠图（matting）→ qwen-image-3.0 同步图生图，content 用 DashScope 风格 { text, image }
    //   - 有参考图 → 走图像编辑模型（如 qwen-image-edit），content 仅含 image_url
    //   - 无参考图 → 纯文生图（qwen-image-2.0），content 仅含 text

    // 图像编辑（参考图 + 指令）在百炼「OpenAI 兼容模式」下不可用：
    //   qwen-image-edit 属异步任务式 API，经 compatible-mode 路由会返回空 choices（无图片内容）。
    //   若未显式配置 BAILIAN_EDIT_MODEL，则直接拒绝，避免返回静默空结果。
    const editModelEnv = (Deno.env.get('BAILIAN_EDIT_MODEL') || '').trim();
    if (isEditMode && !editModelEnv) {
      return new Response(
        JSON.stringify({
          error: '当前部署不支持「参考图编辑」模式：请仅传 prompt 使用文生图（wan2.7-image）；如需图像编辑（换场景/高清放大），请由管理员在百炼控制台开通图像编辑模型并配置 BAILIAN_EDIT_MODEL。',
          code: 'IMAGE_EDIT_UNSUPPORTED',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let effectiveModel = finalModel;
    let content: Record<string, unknown>[];
    if (isMatting) {
      // 参考图归一化：支持 storage 路径（如 workbench/xxx.jpg，服务端下载转 base64）或 http(s) URL
      // 说明：本部署 storage 公开 URL 需用 bucket UUID 才能匿名访问（name 会 404），
      // 而 supabase-js 的 getPublicUrl 返回 name 形式，故前端一律传 storage 路径，避免 URL 不可达。
      let mattingRefImage = refImages[0];
      if (!/^https?:\/\//i.test(mattingRefImage)) {
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        const { data: refBlob, error: refErr } = await admin.storage.from(STORAGE_BUCKET_ID).download(mattingRefImage);
        if (refErr || !refBlob) {
          return new Response(
            JSON.stringify({ error: `参考图读取失败：${refErr?.message ?? '未找到文件'}` }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        const refBuf = await refBlob.arrayBuffer();
        const ext = mattingRefImage.split('.').pop()?.toLowerCase() ?? '';
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
          : ext === 'gif' ? 'image/gif'
          : 'image/png';
        mattingRefImage = `data:${mime};base64,${bytesToBase64(refBuf)}`;
      }
      effectiveModel = MATTING_MODEL;
      content = [
        { text: MATTING_PROMPT },
        { image: mattingRefImage },
      ];
    } else if (isEditMode) {
      effectiveModel = editModelEnv;
      content = [
          { type: 'text', text: prompt || '' },
          ...refImages.map((url) => ({ type: 'image_url', image_url: { url } })),
        ];
    } else {
      content = [{ type: 'text', text: prompt }];
    }
    console.info(`[${functionName}] mode=${isEditMode ? 'edit' : 'text2img'} model=${effectiveModel} refs=${refImages.length}`);

    const payload: Record<string, unknown> = {
      model: effectiveModel,
      messages: [{ role: 'user', content }],
      stream: false,
      n,
    };
    if (size) payload.size = size;
    if (body.watermark === false) payload.watermark = false;

    const response = await fetch(
      `${BAILIAN_BASE_URL}/compatible-mode/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );

    const raw = await response.text();
    if (!response.ok) {
      console.error(`[${functionName}] upstream failed ${requestId} status=${response.status}: ${raw.slice(0, 300)}`);
      if (billing?.userId) await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, 0, '失败', { quantity: n });
      // 模型未开通（403 AccessDenied.Unpurchased）→ 给用户可读提示，避免裸 403
      if (response.status === 403 && /AccessDenied|Unpurchased|eligib/i.test(raw)) {
        const hint = isMatting
          ? '抠图功能暂不可用：百炼工作空间未开通图像编辑模型（qwen-image-3.0）。请联系管理员在百炼控制台开通后重试。'
          : `文生图模型（${effectiveModel}）未开通，请联系管理员在百炼控制台开通。`;
        return new Response(JSON.stringify({ error: hint, code: 'MODEL_UNPURCHASED' }), {
          status: 503, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(raw, { status: response.status, headers: { 'Content-Type': 'application/json' } });
    }

    // 解析图片 URL：工作空间端点返回 { output: { choices: [...] } }，标准端点为 { choices: [...] }
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw);
    } catch {
      console.error(`[${functionName}] bad json ${requestId}: ${raw.slice(0, 200)}`);
      return new Response(
        JSON.stringify({ error: '图片服务返回了非 JSON 响应', detail: raw.slice(0, 300) }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const choices = (json?.output as Record<string, unknown>)?.choices ?? json?.choices;
    const list = Array.isArray(choices) ? choices : [];
    const urls: string[] = [];
    for (const choice of list as Record<string, unknown>[]) {
      const contentList = (choice?.message as Record<string, unknown>)?.content;
      if (Array.isArray(contentList)) {
        for (const part of contentList as Record<string, unknown>[]) {
          if (typeof part?.image === 'string' && part.image) urls.push(part.image);
        }
      }
    }
    if (urls.length === 0) {
      // 兼容 base64 data url
      for (const choice of list as Record<string, unknown>[]) {
        const contentList = (choice?.message as Record<string, unknown>)?.content;
        if (typeof contentList === 'string' && contentList.startsWith('http')) urls.push(contentList);
      }
    }
    if (urls.length === 0) {
      console.error(`[${functionName}] no image url ${requestId}: ${raw.slice(0, 300)}`);
      if (billing?.userId) await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, 0, '失败', { quantity: n });
      return new Response(
        JSON.stringify({ error: '图像生成成功但未返回图片地址', detail: json }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // 按实际生成张数计费（usage.image_count 优先）
    const usage = json?.usage as Record<string, unknown> | undefined;
    const imageCount = Number(usage?.image_count) > 0 ? Number(usage?.image_count) : urls.length;
    const cost = Math.round((billing?.unitPrice ?? 0) * imageCount * 1e6) / 1e6;

    if (billing?.userId) {
      // 按实际生成张数 × 固定积分单价扣除 AI 积分（不再扣除现金余额）
      const finalPricing = await getPricing(billing.serviceKey);
      const perImageCredits = creditsToCharge(finalPricing, billing.unitPrice ?? 0);
      const billedCredits = perImageCredits * imageCount;
      await deductFromPool(billing.userId, 'workbench', billedCredits);
      await writeUsageLog(billing.userId, billing.serviceKey, billing.serviceName, cost, '成功', { quantity: imageCount, credits: billedCredits });
      console.info(`[${functionName}] billed ${requestId} images=${imageCount} cost=¥${cost} credits=${billedCredits}`);
    }
    console.info(`[${functionName}] success ${requestId} durationMs=${Date.now() - startTime}`);

    // 抠图模式后处理：qwen-image-3.0 返回的是 OSS 临时 URL（RGB 绿屏图）。
    // 服务器端下载绿屏图 → 上传到用户自己的 supabase storage（公开可读）→ 返回 storage 公开 URL，
    // 前端即可通过 supabase client download 安全取图做色度键（避开跨域/CORS 与临时链接过期）。
    if (isMatting && urls.length > 0) {
      try {
        const admin = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
        );
        const greenResp = await fetch(urls[0]);
        if (greenResp.ok) {
          const buf = await greenResp.arrayBuffer();
          const mime = greenResp.headers.get('content-type')?.split(';')[0].trim() || 'image/png';
          const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
          const path = `workbench/matting-${crypto.randomUUID()}.${ext}`;
          const { error: upErr } = await admin.storage
            .from(STORAGE_BUCKET_ID)
            .upload(path, new Blob([buf], { type: mime }), { upsert: false });
          if (!upErr) {
            const { data } = admin.storage.from(STORAGE_BUCKET_ID).getPublicUrl(path);
            // admin client 的 SUPABASE_URL 是内网 api-gw，需替换为公网域名（前端/浏览器可访问）
            const pubBase = (Deno.env.get('SUPABASE_PUBLIC_URL') || 'https://thalvior.icu').replace(/\/$/, '');
            urls[0] = data.publicUrl.replace(/^https?:\/\/[^/]+/, pubBase);
            console.info(`[${functionName}] matting stored ${requestId} path=${path}`);
          } else {
            console.warn(`[${functionName}] matting upload failed ${requestId}: ${upErr.message}（回退 OSS 临时 URL）`);
          }
        }
      } catch (e) {
        console.warn(`[${functionName}] matting store error ${requestId}: ${e instanceof Error ? e.message : String(e)}（回退 OSS 临时 URL）`);
      }
    }

    // 维持原前端结构 { output: { results: [{ url }] } }
    return new Response(
      JSON.stringify({ output: { results: urls.map((url) => ({ url })) } }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    console.error(`[${functionName}] failed ${requestId}: ${message}`);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
