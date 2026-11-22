// ============================================================
// cn-listing · 国内电商平台 Listing 生成 / 优化 / 改写 / 评分 / 合规校验 · 2026-10-28
// 链路：products → cn-listing → 刊登草稿（国内平台暂不接 API，仅产出合规文案）
// 计费：service_pricing.cn_listing(生成/优化/改写) + cn_listing_score(评分) + cn_listing_compliance(合规校验)
//       _shared/pool.ts deductFromPool('workbench')，先预校验后扣费，失败不扣
// 数据真实铁律：平台数值/词库/资质全部来自 DB（cn_platform_rules / cn_sensitive_words /
//               cn_category_qualifications），EF 内不硬编码平台规则；词库命中即真实命中。
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPoolBalance, deductFromPool } from '../_shared/pool.ts';

const MEOO_AI_BASE_URL = 'https://ws-14w50zl0wvf8lldk.cn-beijing.maas.aliyuncs.com';
const MODEL = 'qwen3.8-omni-flash';
const GEN_KEY = 'cn_listing';
const SCORE_KEY = 'cn_listing_score';
const COMPLIANCE_KEY = 'cn_listing_compliance';
const SERVICE_NAME = '国内 Listing';
const CREDITS_PER_YUAN = 20;

// ─── DB 规则模型 ────────────────────────────────────────────────────────
interface PlatformRule {
  id: string;
  platform_key: string;
  platform_name: string;
  platform_name_en: string | null;
  title_max_chars: number;
  title_max_bytes: number | null;
  main_image_count: number | null;
  main_image_min_px: number | null;
  detail_image_max_px: number | null;
  sku_max_count: number | null;
  sales_attr_max: number | null;
  sku_code_max_len: number | null;
  price_min: number | null;
  price_unit: number | null;
  weight_required: boolean;
  desc_max_chars: number | null;
  rule_notes: Record<string, unknown>;
  source_url: string;
  source_note: string | null;
}

interface SensitiveWord {
  id: string;
  word: string;
  category: string;
  platform_scope: string[];
  severity: 'high' | 'medium' | 'low';
  suggestion: string | null;
  suggestion_en: string | null;
  source_url: string | null;
}

interface CategoryQual {
  id: string;
  platform_key: string;
  category_path: string;
  category_keywords?: string[] | null;
  required_qualifications: Array<{ type?: string; name?: string; name_en?: string; required?: boolean; note?: string }>;
  notes: string | null;
  notes_en: string | null;
  source_url: string | null;
}

// ─── 通用工具 ──────────────────────────────────────────────────────────
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
/**
 * 平台字符单位计数：中文/全角按 2 计，ASCII 按 1 计。
 * 这是淘宝（60 字节/30 汉字）、拼多多（60 字符/30 汉字）、抖店（60 字符/30 汉字）、
 * 快手（60 字符/30 汉字）四平台官方统一口径，不是 UTF-8 字节数。
 */
function platformUnits(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp > 0xFF ? 2 : 1;
  }
  return n;
}

// ─── 国内 Listing 结构 ──────────────────────────────────────────────────
interface CnListing {
  title: string;              // 商品标题
  selling_points: string[];   // 卖点（国内平台不用 bullet_points，用卖点序列）
  description: string;        // 商品描述 / 详情文案
  keywords: string[];         // 搜索关键词（中文词）
  sku_specs: string[];        // 规格项名称（颜色/尺码…）
  category_path: string;      // 建议类目路径
}
function normalizeCn(parsed: Record<string, unknown>): CnListing | null {
  const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
  const selling_points = Array.isArray(parsed.selling_points)
    ? (parsed.selling_points as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const keywords = Array.isArray(parsed.keywords)
    ? (parsed.keywords as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
    : typeof parsed.keywords === 'string'
      ? String(parsed.keywords).split(/[,，、;；\s]+/).map((s) => s.trim()).filter(Boolean)
      : [];
  const sku_specs = Array.isArray(parsed.sku_specs)
    ? (parsed.sku_specs as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  const category_path = typeof parsed.category_path === 'string' ? parsed.category_path.trim() : '';
  if (!title && !selling_points.length && !description) return null;
  return { title, selling_points, description, keywords, sku_specs, category_path };
}

// ─── 规则收敛：按 DB 规则截断 ──────────────────────────────────────────
function applyRule(listing: CnListing, rule: PlatformRule): { listing: CnListing; notes: string[] } {
  const notes: string[] = [];
  const out: CnListing = { ...listing, selling_points: [...listing.selling_points], keywords: [...listing.keywords], sku_specs: [...listing.sku_specs] };

  // 标题：平台单位上限（中文按 2 计）；字节上限仅当平台明确用 UTF-8 字节时才生效
  let title = listing.title;
  if (rule.title_max_bytes && platformUnits(title) > rule.title_max_bytes) {
    while (title.length > 1 && platformUnits(title) > rule.title_max_bytes) title = title.slice(0, -1);
    notes.push('TITLE_TRUNCATED_BY_BYTES');
  }
  if (platformUnits(title) > rule.title_max_chars) {
    while (title.length > 1 && platformUnits(title) > rule.title_max_chars) title = title.slice(0, -1);
    notes.push('TITLE_TRUNCATED');
  }
  out.title = title;

  // 描述
  if (rule.desc_max_chars && out.description.length > rule.desc_max_chars) {
    out.description = out.description.slice(0, rule.desc_max_chars);
    notes.push('DESC_TRUNCATED');
  }

  // 销售属性上限
  if (rule.sales_attr_max && out.sku_specs.length > rule.sales_attr_max) {
    out.sku_specs = out.sku_specs.slice(0, rule.sales_attr_max);
    notes.push('SKU_SPECS_CAPPED');
  }
  return { listing: out, notes };
}

// ─── 合规校验：词库 + 类目资质 + 规则硬约束 ─────────────────────────────
// issue 只输出结构化 code + params，文案模板由前端 i18n 渲染（禁服务端硬编码中文）
interface ComplianceIssue {
  level: 'error' | 'warning';
  code: string;
  field: string;
  params: Record<string, string | number>;
  hintCode?: string;
  hintParams?: Record<string, string | number>;
}
// 违规类别 key（前端按 key 翻译，不传中文标签）
const CATEGORY_KEYS = ['absolute', 'false_claim', 'medical', 'prohibited', 'trademark', 'spam'] as const;
const SEVERITY_LEVEL: Record<string, 'error' | 'warning'> = { high: 'error', medium: 'warning', low: 'warning' };

function scanSensitive(text: string, words: SensitiveWord[], platformKey: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  if (!text) return issues;
  const lower = text.toLowerCase();
  for (const w of words) {
    // platform_scope 为空 = 全平台通用；否则按 platform_key 命中
    const applies = !w.platform_scope?.length || w.platform_scope.includes(platformKey);
    if (!applies) continue;
    const hit = w.word.toLowerCase();
    if (!hit) continue;
    if (lower.includes(hit)) {
      issues.push({
        level: SEVERITY_LEVEL[w.severity] ?? 'warning',
        code: 'SENSITIVE_WORD',
        field: 'text',
        params: { category: w.category, word: w.word, suggestion: w.suggestion ?? '', suggestion_en: w.suggestion_en ?? '' },
        hintCode: w.suggestion ? 'SENSITIVE_SUGGESTION' : undefined,
        hintParams: w.suggestion ? { suggestion: w.suggestion ?? '', suggestion_en: w.suggestion_en ?? '' } : undefined,
      });
    }
  }
  return issues;
}

function checkQualification(listing: CnListing, quals: CategoryQual[], platformKey: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  if (!listing.category_path) return issues;
  const cat = listing.category_path.trim();
  // 匹配优先级：
  //  1) 路径精确/后缀（用户填的可能是叶子类目，规则表存的是完整路径）
  //  2) 关键词命中（顶级类目如「服饰」需匹配「女装/针织衫」这类叶子路径）
  const matched = quals.find((q) => {
    if (q.platform_key !== platformKey) return false;
    if (cat === q.category_path || cat.endsWith(q.category_path) || q.category_path.endsWith(cat)) return true;
    const kws = q.category_keywords ?? [];
    return kws.some((kw) => kw && cat.includes(kw));
  });
  if (!matched) return issues;
  for (const req of matched.required_qualifications ?? []) {
    if (req.required === false) continue;
    issues.push({
      level: 'warning',
      code: 'CATEGORY_QUALIFICATION_REQUIRED',
      field: 'category_path',
      params: {
        name: req.name ?? req.type ?? '',
        name_en: req.name_en ?? '',
        category_path: cat,
      },
      hintCode: (req.note ?? matched.notes) ? 'QUALIFICATION_NOTE' : undefined,
      hintParams: (req.note ?? matched.notes) ? { note: req.note ?? matched.notes ?? '', note_en: matched.notes_en ?? '' } : undefined,
    });
  }
  return issues;
}

function checkHardRules(listing: CnListing, rule: PlatformRule): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  const units = platformUnits(listing.title);
  if (rule.title_max_bytes && units > rule.title_max_bytes) {
    issues.push({ level: 'error', code: 'TITLE_TOO_LONG_BYTES', field: 'title', params: { limit: rule.title_max_bytes, current: units }, hintCode: 'HINT_UNITS_CURRENT', hintParams: { current: units } });
  }
  if (units > rule.title_max_chars) {
    issues.push({ level: 'error', code: 'TITLE_TOO_LONG', field: 'title', params: { limit: rule.title_max_chars, current: units }, hintCode: 'HINT_UNITS_CURRENT_CJK', hintParams: { current: units } });
  }
  if (rule.sales_attr_max && listing.sku_specs.length > rule.sales_attr_max) {
    issues.push({ level: 'error', code: 'TOO_MANY_SALES_ATTRS', field: 'sku_specs', params: { limit: rule.sales_attr_max, current: listing.sku_specs.length }, hintCode: 'HINT_COUNT_CURRENT', hintParams: { current: listing.sku_specs.length } });
  }
  if (rule.sku_max_count && listing.sku_specs.length > rule.sku_max_count) {
    issues.push({ level: 'error', code: 'SKU_LIMIT', field: 'sku_specs', params: { limit: rule.sku_max_count, current: listing.sku_specs.length }, hintCode: 'HINT_COUNT_CURRENT', hintParams: { current: listing.sku_specs.length } });
  }
  // 标题堆砌：连续重复片段（中文标题典型形态）或空格分隔 token 重复 3 次以上
  const stuffing = detectStuffing(listing.title);
  if (stuffing) {
    issues.push({
      level: 'warning',
      code: 'TITLE_KEYWORD_STUFFING',
      field: 'title',
      params: { word: stuffing.word, count: stuffing.count },
      hintCode: 'HINT_REDUCE_REPEAT',
    });
  }
  // 字符级禁则（抖店等平台明文规则）——只回 code，禁服务端硬编码中文
  for (const bad of forbiddenCharCodes(listing.title)) {
    issues.push({
      level: 'error',
      code: `TITLE_FORBIDDEN_${bad}`,
      field: 'title',
      params: {},
      hintCode: 'HINT_REMOVE_FORBIDDEN',
    });
  }
  if (/[，,。.]$/.test(listing.title)) {
    issues.push({
      level: 'error',
      code: 'TITLE_TRAILING_PUNCT',
      field: 'title',
      params: {},
      hintCode: 'HINT_REMOVE_TRAILING',
    });
  }
  return issues;
}

/** 标题字符级禁则（返回 code 片段，禁硬编码中文） */
function forbiddenCharCodes(title: string): string[] {
  const bad: string[] = [];
  if (/\s{2,}/.test(title)) bad.push('MULTI_SPACE');
  if (/^\s|\s$/.test(title)) bad.push('EDGE_SPACE');
  if (/[\n\r\t]/.test(title)) bad.push('NEWLINE_TAB');
  if (title.includes('\\')) bad.push('BACKSLASH');
  // Emoji：代理对 / 变体选择符 / 常见符号区
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u.test(title)) {
    bad.push('EMOJI');
  }
  return bad;
}

/** 检测标题堆砌：① 连续重复片段 ② 空格/标点分隔 token 重复 */
function detectStuffing(title: string): { word: string; count: number } | null {
  for (const len of [4, 3, 2]) {
    for (let i = 0; i + len * 3 <= title.length; i++) {
      const seg = title.substr(i, len);
      let c = 1;
      while (title.substr(i + c * len, len) === seg) c++;
      if (c >= 3) return { word: seg, count: c };
    }
  }
  const toks = title.split(/[\s,，、|/\-—]+/).filter(Boolean);
  const cnt = new Map<string, number>();
  for (const tk of toks) cnt.set(tk, (cnt.get(tk) ?? 0) + 1);
  for (const [tk, c] of cnt) {
    if (c >= 3 && tk.length >= 2) return { word: tk, count: c };
  }
  return null;
}

async function runCompliance(
  listing: CnListing,
  rule: PlatformRule,
  words: SensitiveWord[],
  quals: CategoryQual[],
): Promise<ComplianceIssue[]> {
  const issues: ComplianceIssue[] = [];
  issues.push(...checkHardRules(listing, rule));
  // 词库扫描覆盖标题 / 卖点 / 描述 / 关键词
  const haystack = [listing.title, ...listing.selling_points, listing.description, ...listing.keywords].join('\n');
  issues.push(...scanSensitive(haystack, words, rule.platform_key));
  issues.push(...checkQualification(listing, quals, rule.platform_key));
  return issues;
}

// ─── LLM 调用 ──────────────────────────────────────────────────────────
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
    console.error(`[cn-listing] upstream ${resp.status}: ${errText.slice(0, 300)}`);
    throw new LlmError('UPSTREAM_ERROR', 502, 'AI 服务暂时不可用，请稍后重试');
  }
  const j = await resp.json().catch(() => null);
  const content = j?.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) throw new LlmError('EMPTY_RESPONSE', 502, 'AI 未返回内容，请重试');
  return {
    content,
    tokens: { prompt: Number(j?.usage?.prompt_tokens ?? 0), completion: Number(j?.usage?.completion_tokens ?? 0) },
  };
}

// ─── Prompt ────────────────────────────────────────────────────────────
function ruleText(rule: PlatformRule): string {
  const parts = [
    `- 商品标题 ≤ ${rule.title_max_chars} 字符${rule.title_max_bytes ? `（且 ≤ ${rule.title_max_bytes} 字节）` : ''}`,
  ];
  if (rule.desc_max_chars) parts.push(`- 商品描述 ≤ ${rule.desc_max_chars} 字符`);
  if (rule.sales_attr_max) parts.push(`- 销售属性最多 ${rule.sales_attr_max} 项`);
  if (rule.sku_max_count) parts.push(`- SKU 规格组合不超过 ${rule.sku_max_count}`);
  if (rule.weight_required) parts.push('- 该平台需填重量');
  const notes = rule.rule_notes ?? {};
  for (const [k, v] of Object.entries(notes)) {
    if (v === null || v === undefined || v === '') continue;
    parts.push(`- ${k}：${String(v)}`);
  }
  return parts.join('\n');
}

function buildGeneratePrompt(input: {
  rule: PlatformRule; product: Record<string, unknown>; instruction?: string;
}): string {
  return `你是国内电商平台商品文案专家。为「${input.rule.platform_name}」平台生成一份中文商品 Listing。
平台规则（必须严格遵守）：
${ruleText(input.rule)}
要求：
1) title：中文标题，结构为「品牌/核心词 + 关键属性 + 品类词 + 卖点/场景词」，不堆砌、不加特殊符号（如 ★ ~ !! @），不使用「最」「第一」「国家级」等绝对化用语，不出现平台禁售承诺
2) selling_points：3-5 条中文卖点，每条独立成句，覆盖材质/功能/规格/场景/售后，不出现夸大承诺
3) description：结构化中文详情文案，可用换行与短句，说明规格参数与使用场景
4) keywords：5-10 个中文搜索关键词（词组），包含品类词、属性词、场景词，不含品牌词堆砌
5) sku_specs：该商品的规格项名称数组（如 颜色、尺码、容量），没有则返回 []
6) category_path：建议的类目路径（中文，从一级到叶子类目），不确定时给最接近的品类路径
只输出 JSON，不要任何解释或代码块标记。JSON 结构：{"title":"...","selling_points":["..."],"description":"...","keywords":["..."],"sku_specs":["..."],"category_path":"..."}

产品信息：
${JSON.stringify(input.product)}
${input.instruction ? `\n卖家额外要求：${input.instruction}` : ''}`;
}

function buildRefinePrompt(input: {
  action: 'optimize' | 'rewrite'; rule: PlatformRule; listing: CnListing; direction?: string;
}): string {
  const task = input.action === 'optimize'
    ? '在保持商品事实不变的前提下优化这份文案（提升搜索词覆盖、卖点与结构）'
    : '按优化方向改写这份文案（表达重构，事实不变）';
  return `你是国内电商平台商品文案专家。${task}。目标平台「${input.rule.platform_name}」。
平台规则（必须严格遵守）：
${ruleText(input.rule)}
输出结构不变：title/selling_points/description/keywords/sku_specs/category_path。
${input.direction ? `优化方向：${input.direction}\n` : ''}只输出 JSON：{"title":"...","selling_points":["..."],"description":"...","keywords":["..."],"sku_specs":["..."],"category_path":"..."}

现有文案：
${JSON.stringify(input.listing)}`;
}

async function scoreCnListing(listing: CnListing, rule: PlatformRule, uiLang: string): Promise<{ score: number; detail: Record<string, unknown>; tokens: { prompt: number; completion: number } }> {
  const langNote = uiLang === 'en' ? 'Write comments and suggestions in English.' : '评语与建议用中文。';
  const prompt = `你是国内电商平台商品文案质检专家。按以下 5 个维度给这份「${rule.platform_name}」平台 Listing 打分（0-100 总分，按维度权重加权）：
- keyword_coverage（权重 30）：中文核心品类词/属性词/场景词覆盖与搜索词布局
- title_structure（权重 20）：标题结构（核心词前置、属性完整、可读性，无堆砌、无绝对化用语）
- selling_points（权重 25）：卖点完整、差异化、买家利益清晰
- compliance（权重 15）：字符合规（该平台标题上限 ${rule.title_max_chars} 字符${rule.title_max_bytes ? `、${rule.title_max_bytes} 字节` : ''}、描述上限 ${rule.desc_max_chars ?? '不限'}、销售属性 ≤${rule.sales_attr_max ?? '不限'}）
- sensitive_words（权重 10）：敏感词/绝对化夸大/侵权风险/虚假宣传风险
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

// ─── 计费与日志 ────────────────────────────────────────────────────────
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
    if (!userId) return fail('未登录或登录已过期', 401, 'UNAUTHORIZED');

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '').trim();
    if (!['generate', 'optimize', 'rewrite', 'score', 'compliance', 'platforms'].includes(action)) {
      return fail(`不支持的 action：${action || '(空)'}`, 400, 'UNSUPPORTED_ACTION');
    }
    const platformKey = String(body.platform_key ?? body.platform ?? '').trim();

    // ── 读平台规则（DB 唯一真源） ──
    const { data: ruleRows, error: ruleErr } = await admin
      .from('cn_platform_rules')
      .select('*')
      .eq('status', '启用')
      .order('platform_key');
    if (ruleErr) return fail(`读取平台规则失败：${ruleErr.message}`, 500, 'RULE_LOAD_FAILED');
    const allRules = (ruleRows ?? []) as PlatformRule[];
    if (!allRules.length) {
      return fail('国内平台规则尚未配置，请联系管理员', 503, 'NO_CN_RULES');
    }
    // 平台列表（供前端下拉，无需登录也可读，但本 EF 需登录）
    if (action === 'platforms') {
      return json({
        success: true,
        platforms: allRules.map((r) => ({
          platform_key: r.platform_key,
          platform_name: r.platform_name,
          platform_name_en: r.platform_name_en,
          title_max_chars: r.title_max_chars,
          title_max_bytes: r.title_max_bytes,
          main_image_count: r.main_image_count,
          main_image_min_px: r.main_image_min_px,
          sku_max_count: r.sku_max_count,
          sales_attr_max: r.sales_attr_max,
          desc_max_chars: r.desc_max_chars,
          source_url: r.source_url,
        })),
      });
    }
    if (!platformKey) return fail('缺少 platform_key（目标平台）', 400, 'MISSING_PLATFORM_KEY');
    const rule = allRules.find((r) => r.platform_key === platformKey);
    if (!rule) return fail(`不支持的平台：${platformKey}`, 400, 'UNKNOWN_PLATFORM');

    // ── 读词库 + 资质表 ──
    const [{ data: wordRows }, { data: qualRows }] = await Promise.all([
      admin.from('cn_sensitive_words').select('*').eq('status', '启用'),
      admin.from('cn_category_qualifications').select('*').eq('status', '启用'),
    ]);
    const words = (wordRows ?? []) as SensitiveWord[];
    const quals = (qualRows ?? []) as CategoryQual[];

    const uiLang = String(body.ui_lang ?? 'zh').trim().toLowerCase() === 'en' ? 'en' : 'zh';

    // ── action=compliance：只做规则+词库校验，不调 LLM ──
    if (action === 'compliance') {
      const inputListing = normalizeCn((body.listing ?? {}) as Record<string, unknown>);
      if (!inputListing) return fail('缺少有效的文案内容（title/selling_points/description）', 400, 'MISSING_LISTING_CONTENT');
      const issues = await runCompliance(inputListing, rule, words, quals);
      const errors = issues.filter((i) => i.level === 'error').length;
      const warnings = issues.filter((i) => i.level === 'warning').length;
      return json({
        success: true,
        compliance: { issues, error_count: errors, warning_count: warnings, passed: errors === 0 },
        platform_key: rule.platform_key,
        platform_name: rule.platform_name,
        source_url: rule.source_url,
      });
    }

    // ── action=score：对已存记录重新评分 ──
    if (action === 'score') {
      const listingId = String(body.listing_id ?? '').trim();
      if (!listingId) return fail('缺少 listing_id', 400, 'MISSING_LISTING_ID');
      const { data: row } = await admin
        .from('cn_listing_generations')
        .select('id, user_id, platform_key, result')
        .eq('id', listingId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!row) return fail('生成记录不存在或不属于当前用户', 404, 'RECORD_NOT_FOUND');
      const listing = normalizeCn((row.result ?? {}) as Record<string, unknown>);
      if (!listing) return fail('该记录缺少有效文案内容，无法评分', 400, 'RECORD_CONTENT_INVALID');
      const r = allRules.find((x) => x.platform_key === row.platform_key) ?? rule;

      const pricing = await getPricing(admin, SCORE_KEY);
      if (pricing && pricing.status === '停用') return fail('该 AI 能力已停用，请联系管理员', 403, 'AI_DISABLED');
      const credits = Number(pricing?.credits_per_use) || 2;
      const balance = await getPoolBalance(userId, 'workbench');
      if (balance < credits) {
        return fail(`AI 积分不足：本次评分需要 ${credits} 积分，当前剩余 ${balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance });
      }
      const s = await scoreCnListing(listing, r, uiLang).catch((e) => {
        if (e instanceof LlmError) {
          void writeUsageLog(admin, userId, SCORE_KEY, 0, '失败');
          throw e;
        }
        throw e;
      });
      const cost = Math.round((credits / CREDITS_PER_YUAN) * 100) / 100;
      const deducted = await deductFromPool(userId, 'workbench', credits);
      if (!deducted.ok) {
        return fail(`AI 积分不足：本次评分需要 ${credits} 积分，当前剩余 ${deducted.balance} 积分`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance: deducted.balance });
      }
      const remaining = await getPoolBalance(userId, 'workbench');
      await writeUsageLog(admin, userId, SCORE_KEY, cost, '成功', credits);
      const { error: updErr } = await admin
        .from('cn_listing_generations')
        .update({ score: s.score, score_detail: s.detail, updated_at: new Date().toISOString() })
        .eq('id', listingId)
        .eq('user_id', userId);
      if (updErr) return fail(`评分完成但落库失败：${updErr.message}`, 500, 'SCORE_SAVE_FAILED');
      console.info(`[cn-listing] ${requestId} ok score id=${listingId} score=${s.score} durationMs=${Date.now() - startTime}`);
      return json({ success: true, id: listingId, score: s.score, score_detail: s.detail, credits_charged: credits, balance: remaining });
    }

    // ── action=generate ──
    if (action === 'generate') {
      const productId = String(body.product_id ?? '').trim();
      if (!productId) return fail('缺少 product_id', 400, 'MISSING_PRODUCT_ID');
      const instruction = String(body.instruction ?? '').trim().slice(0, 500) || undefined;

      const { data: product, error: pErr } = await admin
        .from('products')
        .select('id, name, description, category, sku, price, cost, images, source_platform, source_url, extras')
        .eq('id', productId)
        .eq('user_id', userId)
        .maybeSingle();
      if (pErr || !product) return fail('商品不存在或不属于当前用户', 404, 'PRODUCT_NOT_FOUND');
      if (!String(product.name ?? '').trim() && !String(product.description ?? '').trim()) {
        return fail('商品名称与描述均为空，无可生成内容', 400, 'PRODUCT_EMPTY');
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
      if (pricing && pricing.status === '停用') return fail('该 AI 能力已停用，请联系管理员', 403, 'AI_DISABLED');
      const credits = Number(pricing?.credits_per_use) || 4;
      const balance = await getPoolBalance(userId, 'workbench');
      if (balance < credits) {
        return fail(`AI 积分不足：本次生成需要 ${credits} 积分，当前剩余 ${balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance });
      }

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
        image_count: Array.isArray(product.images) ? (product.images as unknown[]).length : 0,
      };

      let genTokens = { prompt: 0, completion: 0 };
      let listing: CnListing;
      try {
        const { content, tokens } = await callLLM(
          buildGeneratePrompt({ rule, product: productSnapshot, instruction }),
          0.6,
          90000,
        );
        genTokens = tokens;
        const parsed = extractJson(content);
        if (!parsed) throw new LlmError('PARSE_FAILED', 502, 'AI 返回格式异常，请重试');
        const norm = normalizeCn(parsed);
        if (!norm) throw new LlmError('EMPTY_RESPONSE', 502, 'AI 未返回有效文案，请重试');
        listing = norm;
      } catch (e) {
        if (e instanceof LlmError) {
          await writeUsageLog(admin, userId, GEN_KEY, 0, '失败');
          return fail(e.message, e.status, e.code);
        }
        throw e;
      }

      const { listing: ruled, notes } = applyRule(listing, rule);
      const issues = await runCompliance(ruled, rule, words, quals);

      let score: number | null = null;
      let scoreDetail: Record<string, unknown> | null = null;
      let scoreTokens = { prompt: 0, completion: 0 };
      try {
        const s = await scoreCnListing(ruled, rule, uiLang);
        score = s.score;
        scoreDetail = s.detail;
        scoreTokens = s.tokens;
      } catch (e) {
        console.error(`[cn-listing] ${requestId} score failed: ${e instanceof Error ? e.message : e}`);
        scoreDetail = { error: 'score_failed' };
      }

      const cost = Math.round((credits / CREDITS_PER_YUAN) * 100) / 100;
      const deducted = await deductFromPool(userId, 'workbench', credits);
      if (!deducted.ok) {
        return fail(`AI 积分不足：本次生成需要 ${credits} 积分，当前剩余 ${deducted.balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance: deducted.balance });
      }
      const remaining = await getPoolBalance(userId, 'workbench');
      await admin.from('ai_usage_logs').insert({
        user_id: userId,
        service_key: GEN_KEY,
        service_name: SERVICE_NAME,
        cost,
        credits,
        status: '成功',
        prompt_tokens: genTokens.prompt + scoreTokens.prompt,
        completion_tokens: genTokens.completion + scoreTokens.completion,
      });

      const row = {
        user_id: userId,
        product_id: productId,
        platform_key: rule.platform_key,
        generation_type: 'generate',
        prompt_snapshot: {
          platform_key: rule.platform_key, instruction: instruction ?? null,
          product: productSnapshot, rule_source: rule.source_url,
        },
        result: { ...ruled, rule_notes: notes },
        compliance: { issues, error_count: issues.filter((i) => i.level === 'error').length, warning_count: issues.filter((i) => i.level === 'warning').length },
        score,
        score_detail: scoreDetail,
        model: MODEL,
        tokens_used: genTokens.prompt + genTokens.completion + scoreTokens.prompt + scoreTokens.completion,
      };
      const { data: inserted, error: insErr } = await admin
        .from('cn_listing_generations')
        .insert(row)
        .select('id, created_at')
        .maybeSingle();
      if (insErr) return fail(`生成完成但落库失败：${insErr.message}`, 500, 'GENERATE_SAVE_FAILED');

      console.info(`[cn-listing] ${requestId} ok generate product=${productId} platform=${rule.platform_key} score=${score} credits=${credits} durationMs=${Date.now() - startTime}`);
      return json({
        success: true,
        id: inserted?.id,
        created_at: inserted?.created_at,
        result: row.result,
        compliance: row.compliance,
        score,
        score_detail: scoreDetail,
        model: MODEL,
        tokens_used: row.tokens_used,
        platform_key: rule.platform_key,
        platform_name: rule.platform_name,
        source_url: rule.source_url,
        credits_charged: credits,
        balance: remaining,
      });
    }

    // ── action=optimize / rewrite ──
    if (action === 'optimize' || action === 'rewrite') {
      const inputListing = normalizeCn((body.listing ?? {}) as Record<string, unknown>);
      if (!inputListing) return fail('缺少有效的文案内容（title/selling_points/description）', 400, 'MISSING_LISTING_CONTENT');
      const direction = String(body.direction ?? '').trim().slice(0, 500) || undefined;

      const pricing = await getPricing(admin, GEN_KEY);
      if (pricing && pricing.status === '停用') return fail('该 AI 能力已停用，请联系管理员', 403, 'AI_DISABLED');
      const credits = Number(pricing?.credits_per_use) || 4;
      const balance = await getPoolBalance(userId, 'workbench');
      if (balance < credits) {
        return fail(`AI 积分不足：本次需要 ${credits} 积分，当前剩余 ${balance} 积分，请先充值或订阅套餐`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance });
      }

      const { content, tokens } = await callLLM(
        buildRefinePrompt({ action, rule, listing: inputListing, direction }),
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
        await writeUsageLog(admin, userId, GEN_KEY, 0, '失败');
        return fail('AI 返回格式异常，请重试', 502, 'PARSE_FAILED');
      }
      const norm = normalizeCn(parsed);
      if (!norm) {
        await writeUsageLog(admin, userId, GEN_KEY, 0, '失败');
        return fail('AI 未返回有效文案，请重试', 502, 'EMPTY_RESPONSE');
      }
      const { listing: ruled, notes } = applyRule(norm, rule);
      const issues = await runCompliance(ruled, rule, words, quals);

      let score: number | null = null;
      let scoreDetail: Record<string, unknown> | null = null;
      let allTokens = { ...tokens };
      try {
        const s = await scoreCnListing(ruled, rule, uiLang);
        score = s.score;
        scoreDetail = s.detail;
        allTokens = { prompt: tokens.prompt + s.tokens.prompt, completion: tokens.completion + s.tokens.completion };
      } catch {
        scoreDetail = { error: 'score_failed' };
      }

      const cost = Math.round((credits / CREDITS_PER_YUAN) * 100) / 100;
      const deducted = await deductFromPool(userId, 'workbench', credits);
      if (!deducted.ok) {
        return fail(`AI 积分不足：本次需要 ${credits} 积分，当前剩余 ${deducted.balance} 积分`, 402, 'INSUFFICIENT_CREDITS', { required: credits, balance: deducted.balance });
      }
      const remaining = await getPoolBalance(userId, 'workbench');
      await writeUsageLog(admin, userId, GEN_KEY, cost, '成功', credits, allTokens);

      const row = {
        user_id: userId,
        product_id: String(body.product_id ?? '').trim() || null,
        platform_key: rule.platform_key,
        generation_type: action,
        prompt_snapshot: { platform_key: rule.platform_key, direction: direction ?? null, input_listing: inputListing },
        result: { ...ruled, rule_notes: notes },
        compliance: { issues, error_count: issues.filter((i) => i.level === 'error').length, warning_count: issues.filter((i) => i.level === 'warning').length },
        score,
        score_detail: scoreDetail,
        model: MODEL,
        tokens_used: allTokens.prompt + allTokens.completion,
      };
      const { data: inserted, error: insErr } = await admin
        .from('cn_listing_generations')
        .insert(row)
        .select('id, created_at')
        .maybeSingle();
      if (insErr) return fail(`完成但落库失败：${insErr.message}`, 500, 'REFINE_SAVE_FAILED');

      console.info(`[cn-listing] ${requestId} ok ${action} platform=${rule.platform_key} score=${score} durationMs=${Date.now() - startTime}`);
      return json({
        success: true,
        id: inserted?.id,
        created_at: inserted?.created_at,
        result: row.result,
        compliance: row.compliance,
        score,
        score_detail: scoreDetail,
        model: MODEL,
        tokens_used: row.tokens_used,
        platform_key: rule.platform_key,
        platform_name: rule.platform_name,
        source_url: rule.source_url,
        credits_charged: credits,
        balance: remaining,
      });
    }
  } catch (err) {
    if (err instanceof LlmError) return fail(err.message, err.status, err.code);
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cn-listing] ${requestId} ${msg}`);
    return fail(msg, 500, 'INTERNAL_ERROR');
  }
});
