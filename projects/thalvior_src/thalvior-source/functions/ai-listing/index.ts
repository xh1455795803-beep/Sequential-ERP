// ============================================================
// ai-listing · AI 多平台 Listing 生成 / 优化 / 改写 / 评分 · 2026-10-22
// 链路：collect 采集 → products → AI Listing → publish-listing 刊登
// 计费：service_pricing.ai_listing(生成/优化/改写 4 积分) + ai_listing_score(评分 2 积分)
//       _shared/pool.ts deductFromPool('workbench')，先预校验后扣费，失败不扣
// 平台规则内置（Amazon/Shopee/AliExpress/eBay/...），规则外平台走通用规则
// 数据真实铁律：评分与生成都来自真实 LLM 输出；不硬编码 key（DASHSCOPE 从 env 读）
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPoolBalance, deductFromPool } from '../_shared/pool.ts';

const MEOO_AI_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';
const MODEL = 'qwen3.8-omni-flash';
const GEN_KEY = 'ai_listing';
const SCORE_KEY = 'ai_listing_score';
const SERVICE_NAME = 'AI Listing';
const CREDITS_PER_YUAN = 20;

// 目标语言白名单（与 product-translate / 前端 LISTING_LANGS 对齐，另支持 zh）
const LANGS: Record<string, string> = {
  zh: '简体中文（Simplified Chinese）',
  en: '英语（English）',
  ru: '俄语（Russian）',
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

// ─── 平台规则表（内置可扩展；match 为正则按平台名匹配，顺序即优先级） ───
interface PlatformRule {
  titleMax: number;        // 标题字符上限
  titleRec?: string;       // 建议区间（写进 prompt）
  bullets: number;         // 五点条数
  bulletMax: number;       // 每条五点字符上限
  descMax: number;         // 描述字符上限
  searchTermsChars?: number;  // 搜索词字符上限
  searchTermsBytes?: number;  // 搜索词字节上限（Amazon 后台 249 字节）
}
const RULES: Array<{ match: RegExp; label: string; rule: PlatformRule }> = [
  { match: /amazon/i, label: 'Amazon', rule: { titleMax: 200, titleRec: '80-150', bullets: 5, bulletMax: 200, descMax: 2000, searchTermsBytes: 249 } },
  { match: /aliexpress|速卖通/i, label: 'AliExpress', rule: { titleMax: 128, bullets: 5, bulletMax: 120, descMax: 5000, searchTermsChars: 128 } },
  { match: /shopee/i, label: 'Shopee', rule: { titleMax: 120, bullets: 5, bulletMax: 100, descMax: 3000, searchTermsChars: 60 } },
  { match: /lazada/i, label: 'Lazada', rule: { titleMax: 128, bullets: 5, bulletMax: 120, descMax: 3000, searchTermsChars: 100 } },
  { match: /ebay/i, label: 'eBay', rule: { titleMax: 80, bullets: 5, bulletMax: 160, descMax: 4000, searchTermsChars: 80 } },
  { match: /temu/i, label: 'Temu', rule: { titleMax: 250, bullets: 5, bulletMax: 180, descMax: 3000, searchTermsChars: 120 } },
  { match: /tiktok/i, label: 'TikTok Shop', rule: { titleMax: 255, bullets: 5, bulletMax: 160, descMax: 3000, searchTermsChars: 100 } },
  { match: /walmart/i, label: 'Walmart', rule: { titleMax: 100, bullets: 5, bulletMax: 160, descMax: 4000, searchTermsChars: 100 } },
  { match: /etsy/i, label: 'Etsy', rule: { titleMax: 140, bullets: 5, bulletMax: 160, descMax: 8000, searchTermsChars: 260 } },
  { match: /wish/i, label: 'Wish', rule: { titleMax: 200, bullets: 5, bulletMax: 160, descMax: 5000 } },
  { match: /ozon/i, label: 'Ozon', rule: { titleMax: 200, bullets: 5, bulletMax: 200, descMax: 6000, searchTermsChars: 200 } },
  { match: /wildberries/i, label: 'Wildberries', rule: { titleMax: 60, bullets: 5, bulletMax: 120, descMax: 5000, searchTermsChars: 1000 } },
  { match: /mercado\s*libre/i, label: 'Mercado Libre', rule: { titleMax: 60, bullets: 5, bulletMax: 160, descMax: 5000 } },
  { match: /shein/i, label: 'SHEIN', rule: { titleMax: 200, bullets: 5, bulletMax: 160, descMax: 3000 } },
  { match: /alibaba|敦煌网|dhgate/i, label: 'Alibaba/DHgate', rule: { titleMax: 128, bullets: 5, bulletMax: 150, descMax: 5000, searchTermsChars: 128 } },
  { match: /woocommerce|^woo/i, label: 'WooCommerce', rule: { titleMax: 255, bullets: 5, bulletMax: 200, descMax: 10000, searchTermsChars: 255 } },
  { match: /shopify|wix|bigcommerce|magento|prestashop|shopline|shopyy|shopbase|ueeshop|allvalue|funpinpin|店匠|shoplazza/i, label: '独立站', rule: { titleMax: 255, bullets: 5, bulletMax: 200, descMax: 10000, searchTermsChars: 255 } },
];
const DEFAULT_RULE: PlatformRule = { titleMax: 255, titleRec: '80-180', bullets: 5, bulletMax: 200, descMax: 5000, searchTermsChars: 128 };
function matchRule(platform: string): { label: string; rule: PlatformRule } {
  for (const r of RULES) if (r.match.test(platform)) return { label: r.label, rule: r.rule };
  return { label: platform || '通用', rule: DEFAULT_RULE };
}

// ─── 通用工具 ────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
function fail(error: string, status: number, code?: string, extra?: Record<string, unknown>): Response {
  return json({ error, ...(code ? { code } : {}), ...(extra ?? {}) }, status);
}
function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}
async function resolveUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const admin = adminClient();
    const { data } = await admin.auth.getUser(token);
    return data.user?.id ?? null;
  } catch {
    return null;
  }
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

// LLM 调用：超时/限流映射为明确错误码（前端 Toast 提示不崩）
class LlmError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
async function callLLM(prompt: string, temperature: number, timeoutMs: number): Promise<{ content: string; tokens: { prompt: number; completion: number } }> {
  const apiKey = Deno.env.get('MEOO_PROJECT_API_KEY') || Deno.env.get('DASHSCOPE_API_KEY') || '';
  if (!apiKey) throw new LlmError('NO_KEY', 503, 'AI 服务凭证未配置，请联系管理员');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp: Response;
  try {
    resp = await fetch(`${MEOO_AI_BASE_URL}/compatible-mode/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], stream: false, temperature, enable_thinking: false }),
      signal: ctrl.signal,
    });
  } catch {
    clearTimeout(timer);
    throw new LlmError('UPSTREAM_TIMEOUT', 504, 'AI 生成超时，请稍后重试');
  }
  clearTimeout(timer);
  if (resp.status === 429) throw new LlmError('RATE_LIMITED', 429, 'AI 服务繁忙（限流），请稍后重试');
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    console.error(`[ai-listing] upstream ${resp.status}: ${errText.slice(0, 300)}`);
    throw new LlmError('UPSTREAM_ERROR', 502, 'AI 服务暂时不可用，请稍后重试');
  }
  const j = await resp.json().catch(() => null);
  const content: string = j?.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new LlmError('EMPTY_RESPONSE', 502, 'AI 未返回内容，请重试');
  return {
    content,
    tokens: {
      prompt: Number(j?.usage?.prompt_tokens ?? 0),
      completion: Number(j?.usage?.completion_tokens ?? 0),
    },
  };
}

// ─── Listing 归一化 + 平台规则收敛 ───────────────────────────────────
interface Listing {
  title: string;
  bullet_points: string[];
  description: string;
  search_terms: string[];
}
function normalizeListing(parsed: Record<string, unknown>): Listing | null {
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const bullets = Array.isArray(parsed.bullet_points)
    ? (parsed.bullet_points as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const terms = Array.isArray(parsed.search_terms)
    ? (parsed.search_terms as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
    : typeof parsed.search_terms === 'string'
      ? String(parsed.search_terms).split(/[,，;；]/).map((s) => s.trim()).filter(Boolean)
      : [];
  if (!title && !bullets.length && !description) return null;
  return { title, bullet_points: bullets, description, search_terms: terms };
}
function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
function applyPlatformRules(listing: Listing, rule: PlatformRule): { listing: Listing; notes: string[] } {
  const notes: string[] = [];
  const out: Listing = {
    title: listing.title.slice(0, rule.titleMax),
    bullet_points: listing.bullet_points.slice(0, rule.bullets).map((b) => b.slice(0, rule.bulletMax)),
    description: listing.description.slice(0, rule.descMax),
    search_terms: [...listing.search_terms],
  };
  if (out.title.length < listing.title.length) notes.push('TITLE_TRUNCATED');
  if (out.bullet_points.length < listing.bullet_points.length) notes.push('BULLETS_CAPPED');
  if (out.description.length < listing.description.length) notes.push('DESC_TRUNCATED');
  // 搜索词：字节上限（Amazon 249B）优先于字符上限；逐词精简
  if (rule.searchTermsBytes || rule.searchTermsChars) {
    const limitBytes = rule.searchTermsBytes ?? Infinity;
    const limitChars = rule.searchTermsChars ?? Infinity;
    const kept: string[] = [];
    let bytes = 0;
    for (const t of out.search_terms) {
      const add = utf8Bytes((kept.length ? ' ' : '') + t);
      if (bytes + add > limitBytes || (kept.join(' ') + (kept.length ? ' ' : '') + t).length > limitChars) break;
      kept.push(t);
      bytes += add;
    }
    if (kept.length < out.search_terms.length) notes.push('TERMS_TRIMMED');
    out.search_terms = kept;
  }
  return { listing: out, notes };
}

// ─── 评分（真实 LLM 输出） ───────────────────────────────────────────
async function scoreListingText(listing: Listing, ruleLabel: string, rule: PlatformRule, uiLang: string): Promise<{ score: number; detail: Record<string, unknown>; tokens: { prompt: number; completion: number } }> {
  const langNote = uiLang === 'en' ? 'Write comments and suggestions in English.' : '评语与建议用中文。';
  const prompt = `你是跨境电商 Listing 质检专家。按以下 5 个维度给这份「${ruleLabel}」平台 Listing 打分（0-100 总分，按维度权重加权）：
- keyword_coverage（权重 30）：核心品类词/属性词/场景词覆盖与搜索词布局
- title_structure（权重 20）：标题结构（核心词前置、属性完整、可读性，无堆砌）
- selling_points（权重 25）：卖点完整、差异化、买家利益清晰
- compliance（权重 15）：字符合规（该平台标题上限 ${rule.titleMax} 字符、五点 ${rule.bullets} 条每条 ≤${rule.bulletMax}）
- sensitive_words（权重 10）：敏感词/绝对化夸大（best/No.1/100% 等）/侵权风险
${langNote}
只输出 JSON：{"total":数字,"dimensions":{"keyword_coverage":{"score":数字,"comment":"一句话"},"title_structure":{...},"selling_points":{...},"compliance":{...},"sensitive_words":{...}},"suggestions":["建议1","建议2"]}

Listing：
${JSON.stringify(listing)}`;
  const { content, tokens } = await callLLM(prompt, 0.1, 60000);
  const parsed = extractJson(content);
  if (!parsed) throw new LlmError('PARSE_FAILED', 502, 'AI 评分返回格式异常，请重试');
  const total = Math.max(0, Math.min(100, Number(parsed.total ?? 0)));
  const dims = (parsed.dimensions && typeof parsed.dimensions === 'object' ? parsed.dimensions : {}) as Record<string, unknown>;
  const dimensions: Record<string, { score: number; comment: string }> = {};
  for (const key of ['keyword_coverage', 'title_structure', 'selling_points', 'compliance', 'sensitive_words']) {
    const d = dims[key] as { score?: unknown; comment?: unknown } | undefined;
    dimensions[key] = {
      score: Math.max(0, Math.min(100, Number(d?.score ?? 0))),
      comment: typeof d?.comment === 'string' ? d.comment : '',
    };
  }
  const suggestions = Array.isArray(parsed.suggestions) ? (parsed.suggestions as unknown[]).map((s) => String(s)).filter(Boolean).slice(0, 5) : [];
  return { score: Math.round(total * 100) / 100, detail: { dimensions, suggestions }, tokens };
}

// ─── Prompt 构建 ─────────────────────────────────────────────────────
function ruleText(rule: PlatformRule): string {
  const parts = [
    `- 标题 ≤ ${rule.titleMax} 字符${rule.titleRec ? `（建议 ${rule.titleRec}）` : ''}`,
    `- 五点描述恰好 ${rule.bullets} 条，每条 ≤ ${rule.bulletMax} 字符`,
    `- 商品描述 ≤ ${rule.descMax} 字符`,
  ];
  if (rule.searchTermsBytes) parts.push(`- 后台搜索词总量 ≤ ${rule.searchTermsBytes} 字节（按 UTF-8 计，含空格）`);
  else if (rule.searchTermsChars) parts.push(`- 后台搜索词总量 ≤ ${rule.searchTermsChars} 字符`);
  return parts.join('\n');
}
function buildGeneratePrompt(input: {
  platform: string; ruleLabel: string; rule: PlatformRule; language: string;
  product: Record<string, unknown>; instruction?: string; i18nRef?: Record<string, unknown> | null;
}): string {
  const langName = LANGS[input.language] ?? input.language;
  return `你是跨境电商 Listing 专家。为以下产品生成「${input.platform}」平台的「${langName}」Listing。
平台规则（必须严格遵守）：
${ruleText(input.rule)}
要求：
1) title：核心品类词+关键属性+卖点/场景词，符合 ${langName} 买家搜索习惯，不堆砌、不加特殊符号（如 ★ ~!!）
2) bullet_points：恰好 ${input.rule.bullets} 条，覆盖材质/功能/场景/兼容或适配/售后，每条以要点词开头
3) description：结构化卖点段落，可用换行与短句，符合平台风格，不出现平台违禁承诺
4) search_terms：后台搜索词数组，小写短语，不含品牌名与标题重复堆砌
5) 只输出 JSON，不要任何解释或代码块标记。JSON 结构：{"title":"...","bullet_points":["..."],"description":"...","search_terms":["..."]}

产品信息：
${JSON.stringify(input.product)}
${input.instruction ? `\n卖家额外要求：${input.instruction}` : ''}
${input.i18nRef ? `\n已有翻译资料参考（术语保持一致）：${JSON.stringify(input.i18nRef)}` : ''}`;
}
function buildRefinePrompt(input: {
  action: 'optimize' | 'rewrite'; platform: string; ruleLabel: string; rule: PlatformRule; language: string;
  listing: Listing; direction?: string; i18nRef?: Record<string, unknown> | null;
}): string {
  const langName = LANGS[input.language] ?? input.language;
  const task = input.action === 'optimize'
    ? '在保持商品事实不变的前提下优化这份 Listing（提升关键词覆盖、卖点与结构）'
    : '按优化方向改写这份 Listing（表达重构，事实不变）';
  return `你是跨境电商 Listing 专家。${task}。目标平台「${input.platform}」（${input.ruleLabel}），输出语言「${langName}」。
平台规则（必须严格遵守）：
${ruleText(input.rule)}
输出结构不变：title/bullet_points（恰好 ${input.rule.bullets} 条）/description/search_terms。
${input.direction ? `优化方向：${input.direction}` : ''}
只输出 JSON：{"title":"...","bullet_points":["..."],"description":"...","search_terms":["..."]}

现有 Listing：
${JSON.stringify(input.listing)}
${input.i18nRef ? `\n已有翻译资料参考（术语保持一致）：${JSON.stringify(input.i18nRef)}` : ''}`;
}

// ─── 计费与日志 ──────────────────────────────────────────────────────
async function getPricing(admin: ReturnType<typeof createClient>, serviceKey: string) {
  const { data } = await admin.from('service_pricing').select('*').eq('service_key', serviceKey).maybeSingle();
  return data;
}
async function writeUsageLog(admin: ReturnType<typeof createClient>, userId: string, serviceKey: string, cost: number, status: string, credits?: number, tokens?: { prompt: number; completion: number }) {
  await admin.from('ai_usage_logs').insert({
    user_id: userId,
    service_key: serviceKey,
    service_name: SERVICE_NAME,
    cost,
    credits: credits ?? null,
    status,
    prompt_tokens: tokens?.prompt ?? 0,
    completion_tokens: tokens?.completion ?? 0,
  });
}

Deno.serve(async (req) => {
  const functionName = 'ai-listing';
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
    if (!userId) return fail('未登录或登录已过期', 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '').trim();
    if (!['generate', 'optimize', 'rewrite', 'score'].includes(action)) {
      return fail(`不支持的 action：${action || '(空)'}`, 400);
    }
    const platform = String(body.platform ?? '').trim();
    const language = String(body.language ?? 'en').trim().toLowerCase();
    const uiLang = String(body.ui_lang ?? 'zh').trim().toLowerCase() === 'en' ? 'en' : 'zh';
    if (action !== 'score') {
      if (!platform) return fail('缺少 platform（目标平台）', 400);
      if (!LANGS[language]) return fail(`不支持的目标语言：${language}`, 400);
    }
    const { label: ruleLabel, rule } = matchRule(platform || 'generic');

    // ── action=generate：读产品 → 生成 → 规则收敛 → 评分 → 落库 ──
    if (action === 'generate') {
      const productId = String(body.product_id ?? '').trim();
      if (!productId) return fail('缺少 product_id', 400);
      const instruction = String(body.instruction ?? '').trim().slice(0, 500) || undefined;

      const { data: product, error: pErr } = await admin
        .from('products')
        .select('id, name, description, category, sku, price, cost, images, source_platform, source_url, i18n, extras')
        .eq('id', productId)
        .eq('user_id', userId)
        .maybeSingle();
      if (pErr || !product) return fail('产品不存在或不属于当前用户', 404);
      if (!String(product.name ?? '').trim() && !String(product.description ?? '').trim()) {
        return fail('产品标题与描述均为空，无可生成内容', 400);
      }

      const { data: variantRows } = await admin
        .from('product_variants')
        .select('attributes, price, stock')
        .eq('product_id', productId);
      const variantList = (variantRows ?? []).slice(0, 30).map((v) => ({
        attributes: String((v as { attributes?: string }).attributes ?? ''),
        price: (v as { price?: number }).price ?? null,
      }));

      const pricing = await getPricing(admin, GEN_KEY);
      if (pricing && pricing.status === '停用') return fail('该 AI 能力已停用，请联系管理员', 403);
      const credits = Number(pricing?.credits_per_use) || 4;
      const balance = await getPoolBalance(userId, 'workbench');
      if (balance < credits) {
        return fail(`AI 积分不足：本次生成需要 ${credits} 积分，当前剩余 ${balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance });
      }

      const i18n = (product.i18n && typeof product.i18n === 'object' ? product.i18n : {}) as Record<string, unknown>;
      const i18nRef = i18n[language] && typeof i18n[language] === 'object' ? i18n[language] : null;
      const extras = (product.extras && typeof product.extras === 'object' ? product.extras : {}) as Record<string, unknown>;
      const productSnapshot = {
        name: product.name ?? '',
        description: (product.description ?? '').slice(0, 1500),
        category: product.category ?? '',
        sku: product.sku ?? '',
        price: product.price ?? null,
        currency: 'CNY',
        variants: variantList,
        tags: Array.isArray(extras.tags) ? (extras.tags as unknown[]).slice(0, 10) : [],
        attributes: Array.isArray(extras.attributes) ? (extras.attributes as unknown[]).slice(0, 20) : [],
        source_platform: product.source_platform ?? '',
        source_url: product.source_url ?? '',
        image_count: Array.isArray(product.images) ? (product.images as unknown[]).length : 0,
      };

      // 1. 生成
      let genTokens = { prompt: 0, completion: 0 };
      let listing: Listing;
      try {
        const { content, tokens } = await callLLM(
          buildGeneratePrompt({ platform, ruleLabel, rule, language, product: productSnapshot, instruction, i18nRef }),
          0.6,
          90000,
        );
        genTokens = tokens;
        const parsed = extractJson(content);
        if (!parsed) throw new LlmError('PARSE_FAILED', 502, 'AI 返回格式异常，请重试');
        const norm = normalizeListing(parsed);
        if (!norm) throw new LlmError('EMPTY_RESPONSE', 502, 'AI 未返回有效 Listing，请重试');
        listing = norm;
      } catch (e) {
        if (e instanceof LlmError) {
          await writeUsageLog(admin, userId, GEN_KEY, 0, '失败');
          return fail(e.message, e.status, e.code);
        }
        throw e;
      }

      // 2. 平台规则收敛
      const { listing: ruled, notes } = applyPlatformRules(listing, rule);

      // 3. 评分（自动跑）
      let score: number | null = null;
      let scoreDetail: Record<string, unknown> | null = null;
      let scoreTokens = { prompt: 0, completion: 0 };
      try {
        const s = await scoreListingText(ruled, ruleLabel, rule, uiLang);
        score = s.score;
        scoreDetail = s.detail;
        scoreTokens = s.tokens;
      } catch (e) {
        // 评分失败不阻断生成结果（诚实标注）
        console.error(`[ai-listing] ${requestId} score failed: ${e instanceof Error ? e.message : e}`);
        scoreDetail = { error: 'score_failed' };
      }

      // 4. 扣费 + 日志 + 落库
      const cost = Math.round((credits / CREDITS_PER_YUAN) * 100) / 100;
      const deducted = await deductFromPool(userId, 'workbench', credits);
      if (!deducted.ok) {
        return fail(`AI 积分不足：本次生成需要 ${credits} 积分，当前剩余 ${deducted.balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance: deducted.balance });
      }
      const remaining = await getPoolBalance(userId, 'workbench');
      const { data: logRow } = await admin.from('ai_usage_logs').insert({
        user_id: userId,
        service_key: GEN_KEY,
        service_name: SERVICE_NAME,
        cost,
        credits,
        status: '成功',
        prompt_tokens: genTokens.prompt + scoreTokens.prompt,
        completion_tokens: genTokens.completion + scoreTokens.completion,
      }).select('id').maybeSingle();

      const row = {
        user_id: userId,
        product_id: productId,
        platform,
        language,
        generation_type: 'generate',
        prompt_snapshot: {
          platform, language, instruction: instruction ?? null, rule_label: ruleLabel,
          product: productSnapshot, ref_log_id: logRow?.id ?? null,
        },
        result: { ...ruled, rule_notes: notes },
        score,
        score_detail: scoreDetail,
        model: MODEL,
        tokens_used: genTokens.prompt + genTokens.completion + scoreTokens.prompt + scoreTokens.completion,
      };
      const { data: inserted, error: insErr } = await admin
        .from('listing_generations').insert(row).select('id, created_at').maybeSingle();
      if (insErr) {
        console.error(`[ai-listing] ${requestId} 落库失败: ${insErr.message}`);
        return fail(`生成完成但落库失败：${insErr.message}`, 500);
      }

      console.info(`[ai-listing] ${requestId} ok generate product=${productId} platform=${platform} lang=${language} score=${score} credits=${credits} tokens=${row.tokens_used} durationMs=${Date.now() - startTime}`);
      return json({
        success: true,
        id: inserted?.id,
        created_at: inserted?.created_at,
        result: row.result,
        score,
        score_detail: scoreDetail,
        model: MODEL,
        tokens_used: row.tokens_used,
        rule_label: ruleLabel,
        credits_charged: credits,
        balance: remaining,
      });
    }

    // ── action=optimize / rewrite：输入现有 Listing → 优化/改写 → 评分 → 落库 ──
    if (action === 'optimize' || action === 'rewrite') {
      const inputListing = normalizeListing((body.listing ?? {}) as Record<string, unknown>);
      if (!inputListing) return fail('缺少有效的 listing 内容（title/bullet_points/description）', 400);
      const direction = String(body.direction ?? '').trim().slice(0, 500) || undefined;
      let productId = String(body.product_id ?? '').trim() || null;

      const pricing = await getPricing(admin, GEN_KEY);
      if (pricing && pricing.status === '停用') return fail('该 AI 能力已停用，请联系管理员', 403);
      const credits = Number(pricing?.credits_per_use) || 4;
      const balance = await getPoolBalance(userId, 'workbench');
      if (balance < credits) {
        return fail(`AI 积分不足：本次需要 ${credits} 积分，当前剩余 ${balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance });
      }

      // 关联产品（可选，用于翻译参考与联动）
      let i18nRef: Record<string, unknown> | null = null;
      if (productId) {
        const { data: p } = await admin.from('products').select('id, i18n').eq('id', productId).eq('user_id', userId).maybeSingle();
        if (!p) productId = null;
        else {
          const i18n = (p.i18n && typeof p.i18n === 'object' ? p.i18n : {}) as Record<string, unknown>;
          i18nRef = i18n[language] && typeof i18n[language] === 'object' ? i18n[language] : null;
        }
      }

      const { content, tokens } = await callLLM(
        buildRefinePrompt({ action, platform, ruleLabel, rule, language, listing: inputListing, direction, i18nRef }),
        0.5,
        90000,
      ).catch((e) => {
        if (e instanceof LlmError) {
          void writeUsageLog(admin, userId, GEN_KEY, 0, '失败');
          throw e;
        }
        throw e;
      });
      const parsed = extractJson(content);
      if (!parsed) {
        await writeUsageLog(admin, userId, SCORE_KEY, 0, '失败');
        return fail('AI 返回格式异常，请重试', 502, 'PARSE_FAILED');
      }
      const norm = normalizeListing(parsed);
      if (!norm) {
        await writeUsageLog(admin, userId, SCORE_KEY, 0, '失败');
        return fail('AI 未返回有效 Listing，请重试', 502, 'EMPTY_RESPONSE');
      }
      const { listing: ruled, notes } = applyPlatformRules(norm, rule);

      let score: number | null = null;
      let scoreDetail: Record<string, unknown> | null = null;
      let allTokens = { ...tokens };
      try {
        const s = await scoreListingText(ruled, ruleLabel, rule, uiLang);
        score = s.score;
        scoreDetail = s.detail;
        allTokens = { prompt: tokens.prompt + s.tokens.prompt, completion: tokens.completion + s.tokens.completion };
      } catch {
        scoreDetail = { error: 'score_failed' };
      }

      const cost = Math.round((credits / CREDITS_PER_YUAN) * 100) / 100;
      const deducted = await deductFromPool(userId, 'workbench', credits);
      if (!deducted.ok) {
        return fail(`AI 积分不足：本次需要 ${credits} 积分，当前剩余 ${deducted.balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance: deducted.balance });
      }
      const remaining = await getPoolBalance(userId, 'workbench');
      await writeUsageLog(admin, userId, GEN_KEY, cost, '成功', credits, allTokens);

      const row = {
        user_id: userId,
        product_id: productId,
        platform,
        language,
        generation_type: action,
        prompt_snapshot: {
          platform, language, direction: direction ?? null, rule_label: ruleLabel, input_listing: inputListing,
        },
        result: { ...ruled, rule_notes: notes },
        score,
        score_detail: scoreDetail,
        model: MODEL,
        tokens_used: allTokens.prompt + allTokens.completion,
      };
      const { data: inserted, error: insErr } = await admin
        .from('listing_generations').insert(row).select('id, created_at').maybeSingle();
      if (insErr) return fail(`完成但落库失败：${insErr.message}`, 500);

      console.info(`[ai-listing] ${requestId} ok ${action} platform=${platform} lang=${language} score=${score} durationMs=${Date.now() - startTime}`);
      return json({
        success: true,
        id: inserted?.id,
        created_at: inserted?.created_at,
        result: row.result,
        score,
        score_detail: scoreDetail,
        model: MODEL,
        tokens_used: row.tokens_used,
        rule_label: ruleLabel,
        credits_charged: credits,
        balance: remaining,
      });
    }

    // ── action=score：对已存 Listing 重新评分（listing_id 必填） ──
    // action=score：listing_id 必填（重评分既有记录）；评分真实 LLM 输出
    {
      const listingId = String(body.listing_id ?? '').trim();
      if (!listingId) return fail('缺少 listing_id', 400);
      const { data: row } = await admin
        .from('listing_generations')
        .select('id, user_id, platform, language, result')
        .eq('id', listingId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!row) return fail('生成记录不存在或不属于当前用户', 404);

      const pricing = await getPricing(admin, SCORE_KEY);
      if (pricing && pricing.status === '停用') return fail('该 AI 能力已停用，请联系管理员', 403);
      const credits = Number(pricing?.credits_per_use) || 2;
      const balance = await getPoolBalance(userId, 'workbench');
      if (balance < credits) {
        return fail(`AI 积分不足：本次评分需要 ${credits} 积分，当前剩余 ${balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance });
      }

      const { label: rl, rule: rr } = matchRule(String(row.platform ?? ''));
      const listing = normalizeListing((row.result ?? {}) as Record<string, unknown>);
      if (!listing) return fail('该记录缺少有效 Listing 内容，无法评分', 400);
      const s = await scoreListingText(listing, rl, rr, uiLang).catch((e) => {
        if (e instanceof LlmError) {
          void writeUsageLog(admin, userId, GEN_KEY, 0, '失败');
          throw e;
        }
        throw e;
      });

      const cost = Math.round((credits / CREDITS_PER_YUAN) * 100) / 100;
      const deducted = await deductFromPool(userId, 'workbench', credits);
      if (!deducted.ok) {
        return fail(`AI 积分不足：本次评分需要 ${credits} 积分，当前剩余 ${deducted.balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance: deducted.balance });
      }
      const remaining = await getPoolBalance(userId, 'workbench');
      await writeUsageLog(admin, userId, SCORE_KEY, cost, '成功', credits);

      const { error: updErr } = await admin
        .from('listing_generations')
        .update({ score: s.score, score_detail: s.detail })
        .eq('id', listingId)
        .eq('user_id', userId);
      if (updErr) return fail(`评分完成但落库失败：${updErr.message}`, 500);

      console.info(`[ai-listing] ${requestId} ok score id=${listingId} score=${s.score} durationMs=${Date.now() - startTime}`);
      return json({ success: true, id: listingId, score: s.score, score_detail: s.detail, credits_charged: credits, balance: remaining });
    }
  } catch (err) {
    if (err instanceof LlmError) return fail(err.message, err.status, err.code);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-listing] ${requestId} ${msg}`);
    return fail(msg, 500);
  }
});
