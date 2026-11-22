// AI Listing 服务封装（2026-10-22）
// 生成/优化/改写/评分走 ai-listing Edge Function（真实 LLM 输出）
// 历史记录走 listing_generations（RLS：user_id = uid()）
import { supabase, supabaseUrl, projectUrlId } from "@/supabase/client";

export interface ListingResult {
  title: string;
  bullet_points: string[];
  description: string;
  search_terms: string[];
  rule_notes?: string[];
}

export interface ScoreDimension {
  score: number;
  comment: string;
}

export interface ScoreDetail {
  dimensions: Record<string, ScoreDimension>;
  suggestions: string[];
  error?: string;
}

export interface ListingGeneration {
  id: string;
  product_id: string | null;
  platform: string;
  language: string;
  generation_type: "generate" | "optimize" | "rewrite" | "score";
  result: ListingResult;
  score: number | null;
  score_detail: ScoreDetail | null;
  model: string | null;
  tokens_used: number;
  created_at: string;
}

export interface AiListingResponse {
  success: boolean;
  id?: string;
  created_at?: string;
  result?: ListingResult;
  score?: number | null;
  score_detail?: ScoreDetail | null;
  model?: string;
  tokens_used?: number;
  rule_label?: string;
  credits_charged?: number;
  balance?: number;
  error?: string;
  code?: string;
}

// 目标语言（与 EF 白名单对齐；zh = 直接生成中文 Listing）
export const LISTING_LANGS = [
  { code: "en", key: "ai.tr.lang.en" },
  { code: "zh", key: "ai.listing.lang.zh" },
  { code: "ru", key: "ai.tr.lang.ru" },
  { code: "ja", key: "ai.tr.lang.ja" },
  { code: "ko", key: "ai.tr.lang.ko" },
  { code: "es", key: "ai.tr.lang.es" },
  { code: "fr", key: "ai.tr.lang.fr" },
  { code: "de", key: "ai.tr.lang.de" },
  { code: "it", key: "ai.tr.lang.it" },
  { code: "vi", key: "ai.tr.lang.vi" },
  { code: "th", key: "ai.tr.lang.th" },
  { code: "ar", key: "ai.tr.lang.ar" },
  { code: "pt", key: "ai.tr.lang.pt" },
] as const;

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// 统一错误码 → 请求异常（保留 code 供调用方 i18n 映射）
export class AiListingError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function callAiListing(payload: Record<string, unknown>): Promise<AiListingResponse> {
  const headers = await getAuthHeaders();
  const resp = await fetch(`${supabaseUrl}/functions/v1/ai-listing`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "OneDay-App-Id": projectUrlId, ...headers },
    body: JSON.stringify(payload),
  });
  const j = (await resp.json().catch(() => ({}))) as AiListingResponse;
  if (!resp.ok) throw new AiListingError(j.error || `HTTP ${resp.status}`, j.code || "REQUEST_FAILED");
  return j;
}

function uiLang(): "zh" | "en" {
  return localStorage.getItem("thalvior_lang") === "en" ? "en" : "zh";
}

export async function generateListing(params: {
  productId: string;
  platform: string;
  language: string;
  instruction?: string;
}): Promise<AiListingResponse> {
  return callAiListing({
    action: "generate",
    product_id: params.productId,
    platform: params.platform,
    language: params.language,
    instruction: params.instruction || undefined,
    ui_lang: uiLang(),
  });
}

export async function refineListing(params: {
  action: "optimize" | "rewrite";
  platform: string;
  language: string;
  listing: ListingResult;
  direction?: string;
  productId?: string | null;
}): Promise<AiListingResponse> {
  return callAiListing({
    action: params.action,
    platform: params.platform,
    language: params.language,
    listing: {
      title: params.listing.title,
      bullet_points: params.listing.bullet_points,
      description: params.listing.description,
      search_terms: params.listing.search_terms,
    },
    direction: params.direction || undefined,
    product_id: params.productId || undefined,
    ui_lang: uiLang(),
  });
}

export async function scoreListing(listingId: string): Promise<AiListingResponse> {
  return callAiListing({ action: "score", listing_id: listingId, ui_lang: uiLang() });
}

// 历史记录（RLS 自动按用户过滤）
export async function listGenerations(filters?: {
  productId?: string;
  platform?: string;
  language?: string;
  since?: string;
  limit?: number;
}): Promise<ListingGeneration[]> {
  let q = supabase
    .from("listing_generations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(filters?.limit ?? 100);
  if (filters?.productId) q = q.eq("product_id", filters.productId);
  if (filters?.platform) q = q.eq("platform", filters.platform);
  if (filters?.language) q = q.eq("language", filters.language);
  if (filters?.since) q = q.gte("created_at", filters.since);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ListingGeneration[];
}

export async function deleteGeneration(id: string): Promise<void> {
  const { error } = await supabase.from("listing_generations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// 平台清单：platform_configs 全量（60 家），保证与授权/刊登同一套平台目录
export async function fetchPlatformNames(): Promise<string[]> {
  const { data, error } = await supabase
    .from("platform_configs")
    .select("name")
    .eq("status", "启用")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Array<{ name: string }>).map((r) => r.name).filter(Boolean);
}

// 把生成结果写入商品多语言资料（publish-listing 刊登时按店铺语言自动取用）
export async function applyListingToI18n(
  productId: string,
  lang: string,
  result: ListingResult,
): Promise<void> {
  const { data: cur, error: selErr } = await supabase
    .from("products")
    .select("i18n")
    .eq("id", productId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  const i18n = { ...(((cur?.i18n as Record<string, unknown>) ?? {}) as Record<string, Record<string, unknown>>) };
  i18n[lang] = {
    ...(i18n[lang] ?? {}),
    name: result.title,
    description: result.description,
    bullet_points: result.bullet_points,
    search_terms: result.search_terms,
    listing_updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("products")
    .update({ i18n: i18n as any, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (error) throw new Error(error.message);
}
