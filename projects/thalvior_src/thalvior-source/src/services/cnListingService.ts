// 国内 Listing 服务封装（2026-10-28）
// 生成/优化/改写/评分走 cn-listing Edge Function（真实 LLM 输出 + DB 规则/词库/资质校验）
// 合规校验（compliance）为纯规则计算，不调 LLM，不计费
// 历史记录走 cn_listing_generations（RLS：user_id = uid()）
import { supabase, supabaseUrl, projectUrlId } from "@/supabase/client";

export interface CnListingResult {
  title: string;
  selling_points: string[];
  description: string;
  keywords: string[];
  sku_specs: string[];
  category_path: string;
  rule_notes?: string[];
}

export interface CnScoreDimension {
  score: number;
  comment: string;
}

export interface CnScoreDetail {
  dimensions?: Record<string, CnScoreDimension>;
  suggestions?: string[];
  error?: string;
}

export interface CnComplianceIssue {
  level: "error" | "warning";
  code: string;
  field: string;
  /** i18n 模板变量；含 zh/_en 双值的字段按当前语言取 _en 变体 */
  params: Record<string, string | number>;
  /** 建议文案的 i18n key 后缀（ai.cn.hint.<hintCode>） */
  hintCode?: string;
  hintParams?: Record<string, string | number>;
}

export interface CnCompliance {
  issues: CnComplianceIssue[];
  error_count: number;
  warning_count: number;
  passed: boolean;
}

export interface CnPlatformRule {
  platform_key: string;
  platform_name: string;
  platform_name_en?: string | null;
  title_max_chars: number;
  title_max_bytes: number | null;
  main_image_count: number | null;
  main_image_min_px: number | null;
  sku_max_count: number | null;
  sales_attr_max: number | null;
  desc_max_chars: number | null;
  source_url: string;
}

export interface CnListingGeneration {
  id: string;
  user_id: string | null;
  product_id: string | null;
  platform_key: string;
  generation_type: "generate" | "optimize" | "rewrite" | "score";
  result: CnListingResult;
  compliance: CnCompliance | null;
  score: number | null;
  score_detail: CnScoreDetail | null;
  model: string | null;
  tokens_used: number;
  created_at: string;
}

export interface CnListingResponse {
  success: boolean;
  id?: string;
  created_at?: string;
  result?: CnListingResult;
  compliance?: CnCompliance;
  score?: number | null;
  score_detail?: CnScoreDetail | null;
  model?: string;
  tokens_used?: number;
  platform_key?: string;
  platform_name?: string;
  source_url?: string;
  credits_charged?: number;
  balance?: number;
  platforms?: CnPlatformRule[];
  error?: string;
  code?: string;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// 统一错误码 → 请求异常（保留 code 供调用方 i18n 映射）
export class CnListingError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function callCnListing(payload: Record<string, unknown>): Promise<CnListingResponse> {
  const headers = await getAuthHeaders();
  const resp = await fetch(`${supabaseUrl}/functions/v1/cn-listing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "OneDay-App-Id": projectUrlId, ...headers },
    body: JSON.stringify(payload),
  });
  const j = (await resp.json().catch(() => ({}))) as CnListingResponse;
  if (!resp.ok) throw new CnListingError(j.error || `HTTP ${resp.status}`, j.code || "REQUEST_FAILED");
  return j;
}

function uiLang(): "zh" | "en" {
  return localStorage.getItem("thalvior_lang") === "en" ? "en" : "zh";
}

// 平台清单（DB 唯一真源，含官方规则上限与来源链接）
export async function fetchCnPlatforms(): Promise<CnPlatformRule[]> {
  const j = await callCnListing({ action: "platforms", ui_lang: uiLang() });
  return j.platforms ?? [];
}

// 生成：读 products 表商品资料，LLM 生成 + 规则收敛 + 合规校验 + 评分
export async function generateCnListing(params: {
  productId: string;
  platformKey: string;
  instruction?: string;
}): Promise<CnListingResponse> {
  return callCnListing({
    action: "generate",
    product_id: params.productId,
    platform_key: params.platformKey,
    instruction: params.instruction || undefined,
    ui_lang: uiLang(),
  });
}

// 优化 / 改写
export async function refineCnListing(params: {
  action: "optimize" | "rewrite";
  platformKey: string;
  listing: CnListingResult;
  direction?: string;
}): Promise<CnListingResponse> {
  return callCnListing({
    action: params.action,
    platform_key: params.platformKey,
    listing: {
      title: params.listing.title,
      selling_points: params.listing.selling_points,
      description: params.listing.description,
      keywords: params.listing.keywords,
      sku_specs: params.listing.sku_specs,
      category_path: params.listing.category_path,
    },
    direction: params.direction || undefined,
    ui_lang: uiLang(),
  });
}

// 重新评分（对已存记录）
export async function scoreCnListing(listingId: string): Promise<CnListingResponse> {
  return callCnListing({ action: "score", listing_id: listingId, ui_lang: uiLang() });
}

// 合规校验：纯规则（标题长度/堆砌/字符禁则 + 违禁词 + 类目资质），不调 LLM
export async function checkCnCompliance(params: {
  platformKey: string;
  listing: CnListingResult;
}): Promise<CnCompliance> {
  const j = await callCnListing({
    action: "compliance",
    platform_key: params.platformKey,
    listing: {
      title: params.listing.title,
      selling_points: params.listing.selling_points,
      description: params.listing.description,
      keywords: params.listing.keywords,
      sku_specs: params.listing.sku_specs,
      category_path: params.listing.category_path,
    },
    ui_lang: uiLang(),
  });
  return j.compliance ?? { issues: [], error_count: 0, warning_count: 0, passed: true };
}

// 历史记录（RLS 自动按用户过滤）
export async function listCnGenerations(filters?: {
  productId?: string;
  platformKey?: string;
  since?: string;
  limit?: number;
}): Promise<CnListingGeneration[]> {
  let q = supabase
    .from("cn_listing_generations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters?.limit ?? 100);
  if (filters?.productId) q = q.eq("product_id", filters.productId);
  if (filters?.platformKey) q = q.eq("platform_key", filters.platformKey);
  if (filters?.since) q = q.gte("created_at", filters.since);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as CnListingGeneration[];
}

export async function deleteCnGeneration(id: string): Promise<void> {
  const { error } = await supabase.from("cn_listing_generations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// 应用：写入商品名称/描述（国内平台无多语言刊登，走中文主字段）
export async function applyCnListingToProduct(
  productId: string,
  result: CnListingResult,
): Promise<void> {
  const { error } = await supabase
    .from("products")
    .update({
      name: result.title,
      description: result.description,
      updated_at: new Date().toISOString(),
    })
    .eq("id", productId);
  if (error) throw new Error(error.message);
}
