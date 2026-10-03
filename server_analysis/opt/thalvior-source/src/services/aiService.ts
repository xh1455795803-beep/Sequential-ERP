// 前端 AI 能力封装：统一通过自建 Supabase Edge Function 调用（AI 供应商：阿里云百炼）
// 文本（ai-chat）、视觉理解（ai-vision）、图片生成/编辑（ai-image-gen）
// 所有消耗型能力走「额度预校验 → 调用 → 成功扣费/失败不扣费」链路
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// ===== 额度查询 / 充值（模拟到账） =====

// 获取当前租户 AI 积分余额（无记录时返回 0）
// 注意：AI 功能统一消耗「积分(credits)」，不再读现金余额(balance)
export async function getQuotaBalance(): Promise<number> {
  const b = await getPoolBalances();
  return b.workbench.total;
}

// ===== 双积分池（2026-09-28 订阅与AI积分体系一期）=====
// 池A：AI 工作台积分（每日赠送 20，当日清零）——文生图/抠图/翻译/图生标题/编辑页内嵌 AI
// 池B：AI Agent 积分（每日赠送 100，当日清零）——Agent 对话/选品/数据
// 充值积分进工作台充值池，会员期内永久有效；扣分顺序：先赠送后充值
export const DAILY_WORKBENCH_FREE = 20;
export const DAILY_AGENT_FREE = 100;

export interface PoolBalance {
  freeToday: number; // 今日赠送（未发放时按应得值展示）
  purchased: number; // 充值积分（永久）
  total: number; // 可用 = 赠送 + 充值
}

export interface PoolBalances {
  workbench: PoolBalance;
  agent: PoolBalance;
}

export async function getPoolBalances(): Promise<PoolBalances> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  const empty = (): PoolBalances => ({
    workbench: { freeToday: DAILY_WORKBENCH_FREE, purchased: 0, total: DAILY_WORKBENCH_FREE },
    agent: { freeToday: DAILY_AGENT_FREE, purchased: 0, total: DAILY_AGENT_FREE },
  });
  if (!userId) return empty();
  const { data } = await supabase
    .from("tenant_quotas")
    .select(
      "workbench_credits,workbench_free_date,workbench_free_today,agent_credits,agent_free_date,agent_free_today",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return empty();
  const today = new Date().toISOString().slice(0, 10);
  const wbFree = data.workbench_free_date === today ? Number(data.workbench_free_today ?? 0) : DAILY_WORKBENCH_FREE;
  const agFree = data.agent_free_date === today ? Number(data.agent_free_today ?? 0) : DAILY_AGENT_FREE;
  const wbPurchased = Number(data.workbench_credits ?? 0);
  const agPurchased = Number(data.agent_credits ?? 0);
  return {
    workbench: { freeToday: wbFree, purchased: wbPurchased, total: wbFree + wbPurchased },
    agent: { freeToday: agFree, purchased: agPurchased, total: agFree + agPurchased },
  };
}

// ===== 活动权益（买 1000+ 积分解锁 AI 标题免费等）=====
export interface BenefitRow {
  id: string;
  benefit_key: string;
  source_package: string | null;
  granted_at: string;
  expires_at: string;
  status: string;
}

export async function getActiveBenefits(): Promise<BenefitRow[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return [];
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("benefit_grants")
    .select("id,benefit_key,source_package,granted_at,expires_at,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .gte("expires_at", now)
    .order("expires_at", { ascending: true });
  return (data ?? []) as BenefitRow[];
}

// 充值档位（服务端权威，前端展示用；对齐方案：100/1000/3000/10000）
export interface CreditPackageRow {
  id: string;
  package_code: string;
  name: string;
  credits: number;
  price: number;
  original_price: number;
  per_credit: number;
  tag: string;
  recommended: boolean;
}

export async function getCreditPackages(): Promise<CreditPackageRow[]> {
  const { data } = await supabase
    .from("credit_packages")
    .select("*")
    .eq("status", "启用")
    .order("sort_order", { ascending: true });
  return (data ?? []) as CreditPackageRow[];
}

// ===== 店铺授权额度（shop_plans 按店铺付费） =====

export const FREE_SHOP_LIMIT = 2;

// 店铺授权档位（与后端 wechat-pay SHOP_PLANS 保持一致，按 PDF「单平台单店定价」）
// TikTok/Temu/Ozon 单店 20 元/店/月（年付低至 4.5 元/店/月 = 54 元/年）
// Shopee/Lazada 单店 18 元/店/月；规模阶梯（Temu 多店档）15 店 180 / 50 店 550 / 100 店 1000 / 200 店 2000 元/月
// 速卖通（1 店 30 / 5 店 150 / 10 店 300 元/月）走服务市场订购，不在此接入
export interface ShopPlanOption {
  code: string;
  name: string;
  platform: string;
  shopCount: number;
  prices: Record<string, number>; // period → price
  badge?: string;
}

export const SHOP_PLAN_OPTIONS: ShopPlanOption[] = [
  { code: "tk_1", name: "TikTok / Temu / Ozon", platform: "TikTok/Temu/Ozon", shopCount: 1, prices: { month: 20, year: 54 }, badge: "年付 4.5 元/店/月" },
  { code: "shp_1", name: "Shopee / Lazada", platform: "Shopee/Lazada", shopCount: 1, prices: { month: 18 } },
  { code: "scale_15", name: "规模档 · 15 店", platform: "Temu 多店档", shopCount: 15, prices: { month: 180 } },
  { code: "scale_50", name: "规模档 · 50 店", platform: "Temu 多店档", shopCount: 50, prices: { month: 550 } },
  { code: "scale_100", name: "规模档 · 100 店", platform: "Temu 多店档", shopCount: 100, prices: { month: 1000 } },
  { code: "scale_200", name: "规模档 · 200 店", platform: "Temu 多店档", shopCount: 200, prices: { month: 2000 } },
];

export const SHOP_PERIOD_LABEL: Record<string, string> = { month: "月付", quarter: "季付", year: "年付" };

export interface ShopLicenseRow {
  id: string;
  plan_code: string;
  shop_count: number;
  amount: number;
  period: string;
  status: string;
  expires_at: string | null;
}

export async function getShopLicenses(): Promise<ShopLicenseRow[]> {
  const { data } = await supabase
    .from("shop_licenses")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false });
  return (data ?? []) as ShopLicenseRow[];
}

export async function countBoundShops(): Promise<number> {
  const { count } = await supabase
    .from("shops")
    .select("id", { count: "exact", head: true });
  return count ?? 0;
}

// ===== 增值资源：图片翻译次数包（第三方翻译服务接入后启用） =====

export interface TranslatePackRow {
  id: string;
  pack_code: string;
  name: string;
  total: number;
  remaining: number;
  source: string;
  amount: number;
  status: string;
  purchased_at: string | null;
  expires_at: string | null;
}

export async function getTranslatePacks(): Promise<TranslatePackRow[]> {
  const { data } = await supabase
    .from("translate_packs")
    .select("*")
    .eq("status", "active")
    .order("purchased_at", { ascending: false });
  return (data ?? []) as TranslatePackRow[];
}

export const TRANSLATE_PACK_OPTIONS = [
  { code: "tr100", name: "100 次翻译包", count: 100, price: 9.9, tag: "", desc: "适合低频翻译" },
  { code: "tr500", name: "500 次翻译包", count: 500, price: 39, tag: "热门", desc: "适合中小卖家" },
  { code: "tr2000", name: "2,000 次翻译包", count: 2000, price: 129, tag: "划算", desc: "适合高频批量" },
];

// ===== 订阅套餐 =====

export interface SubscriptionPlan {
  id: string;
  plan_key: string;
  name: string;
  price: number;
  period: string;
  description: string | null;
  quota: number;
  features: string[];
  sort_order: number;
  status: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  plan_name: string;
  amount: number;
  status: string;
  started_at: string | null;
  expires_at: string | null;
  created_at: string;
}

// 获取所有启用中的套餐
export async function getSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const { data } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("status", "启用")
    .order("sort_order", { ascending: true });
  return (data ?? []).map((p) => ({
    ...p,
    features: Array.isArray(p.features) ? p.features : [],
  })) as SubscriptionPlan[];
}

// 获取当前生效的订阅（未过期）
export async function getCurrentSubscription(): Promise<Subscription | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Subscription) ?? null;
}

// 获取当前租户消耗明细
export async function getUsageLogs(limit = 50) {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return [];
  const { data } = await supabase
    .from("ai_usage_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

// ===== 微信支付（真实支付） =====

export type WechatPayType = "native" | "h5";

export interface WechatPayOrderResult {
  order_no: string;
  code_url: string;
  h5_url: string;
  prepay_id: string;
}

export interface WechatPayOrderStatus {
  order_no: string;
  amount: number;
  status: string;
  wechat_trade_no: string | null;
  paid_at: string | null;
}

// 创建微信支付订单（Native 返回二维码，H5 返回 h5_url）
// planId 传入时表示「订阅套餐」下单；packageType=translate_pack+packCode 为次数包；
// packageType=shop_license+packCode+period 为店铺授权；否则为「额度充值」
export async function createWechatPayOrder(
  amount: number,
  payType: WechatPayType = "native",
  extra?: { payerIp?: string; planId?: string; packageType?: string; packCode?: string; period?: string }
): Promise<WechatPayOrderResult> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${supabaseUrl}/functions/v1/wechat-pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
      ...authHeaders,
    },
    body: JSON.stringify({
      action: "create-order",
      amount,
      pay_type: payType,
      payer_ip: extra?.payerIp,
      plan_id: extra?.planId,
      package_type: extra?.packageType,
      pack_code: extra?.packCode,
      period: extra?.period,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error((result as { error?: string }).error || `下单失败 (${response.status})`);
  }
  return (result as { data: WechatPayOrderResult }).data;
}

// 主动查询订单支付状态
export async function queryWechatPayOrder(orderNo: string): Promise<WechatPayOrderStatus> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${supabaseUrl}/functions/v1/wechat-pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
      ...authHeaders,
    },
    body: JSON.stringify({ action: "query-order", order_no: orderNo }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error((result as { error?: string }).error || `查询订单失败 (${response.status})`);
  }
  return (result as { data: WechatPayOrderStatus }).data;
}

// 获取充值流水
export async function getRecharges(limit = 50) {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return [];
  const { data } = await supabase
    .from("quota_recharges")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

// 查询某能力的单价（用于调用前展示「本次消耗 X 额度」）
export async function getServicePrice(serviceKey: string): Promise<number> {
  const { data } = await supabase
    .from("service_pricing")
    .select("unit_price")
    .eq("service_key", serviceKey)
    .maybeSingle();
  return data ? Number(data.unit_price) : 0;
}

// AI 能力计费标准（对齐阿里云百炼官方单价，2026-09-25 核对）
export interface ServicePricing {
  service_name: string;
  model: string;
  billing_mode: string; // flat | token | per_image
  unit_price: number;
  unit: string;
  input_price_per_mtok: number;
  output_price_per_mtok: number;
  markup: number; // 售价倍率：售价 = 官方成本 × markup
  credits_per_use: number; // 固定积分/次（后台可调），AI 功能实际扣的是积分
}

export async function getServicePricing(serviceKey: string): Promise<ServicePricing | null> {
  const { data } = await supabase
    .from("service_pricing")
    .select(
      "service_name,model,billing_mode,unit_price,unit,input_price_per_mtok,output_price_per_mtok,markup,credits_per_use",
    )
    .eq("service_key", serviceKey)
    .maybeSingle();
  if (!data) return null;
  return {
    service_name: data.service_name as string,
    model: (data.model as string) ?? "",
    billing_mode: (data.billing_mode as string) ?? "flat",
    unit_price: Number(data.unit_price) || 0,
    unit: (data.unit as string) ?? "次",
    input_price_per_mtok: Number(data.input_price_per_mtok) || 0,
    output_price_per_mtok: Number(data.output_price_per_mtok) || 0,
    markup: Number(data.markup) || 1,
    credits_per_use: Number(data.credits_per_use) || 0,
  };
}

// 把计费标准格式化为面向用户的一句话（AI 功能按积分扣费，展示积分口径；1 元 = 20 积分）
export function formatPricing(p: ServicePricing | null): string {
  if (!p) return "";
  const perUse = Number(p.credits_per_use);
  if (perUse > 0) {
    return `本次消耗 ${perUse} 积分/次`;
  }
  const m = p.markup > 0 ? p.markup : 1;
  if (p.billing_mode === "per_image") {
    const price = p.unit_price * m;
    const credits = Math.max(1, Math.ceil(price * 20));
    return `本次消耗约 ${credits} 积分/张`;
  }
  if (p.billing_mode === "token") {
    const inPrice = p.input_price_per_mtok * m;
    const outPrice = p.output_price_per_mtok * m;
    const creditsIn = Math.max(1, Math.ceil(inPrice * 20));
    const creditsOut = Math.max(1, Math.ceil(outPrice * 20));
    return `计费标准：输入约 ${creditsIn} 积分/百万 tokens、输出约 ${creditsOut} 积分/百万 tokens`;
  }
  const price = p.unit_price * m;
  const credits = Math.max(1, Math.ceil(price * 20));
  return `本次消耗约 ${credits} 积分/次`;
}

// ===== AI 历史记录（保存/查询/删除） =====

export interface AiHistoryRow {
  id: string;
  service_key: string;
  service_name: string;
  input_text: string;
  output_text: string;
  cost: number;
  status: string;
  created_at: string;
}

// 保存一次 AI 调用历史
export async function saveAiHistory(params: {
  serviceKey: string;
  serviceName: string;
  inputText: string;
  outputText: string;
  cost: number;
  status?: string;
}): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return;
  await supabase.from("ai_history").insert({
    user_id: userId,
    service_key: params.serviceKey,
    service_name: params.serviceName,
    input_text: params.inputText,
    output_text: params.outputText,
    cost: params.cost,
    status: params.status ?? "成功",
  });
}

// 查询当前租户的 AI 历史（可按能力过滤）
export async function getAiHistory(serviceKey?: string, limit = 50): Promise<AiHistoryRow[]> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return [];
  let query = supabase
    .from("ai_history")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (serviceKey) query = query.eq("service_key", serviceKey);
  const { data } = await query;
  return (data ?? []) as AiHistoryRow[];
}

// 删除一条 AI 历史
export async function deleteAiHistory(id: string): Promise<void> {
  const { data, error } = await supabase.from("ai_history").delete().eq("id", id).select();
  if (error) throw new Error(`删除失败: ${error.message}`);
  if (!data || data.length === 0) throw new Error("删除失败：可能被权限策略拦截");
}

// ===== 文本 AI（文案优化等）流式调用 =====
export async function requestLLMStream(
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  options?: { model?: string; signal?: AbortSignal; serviceKey?: string }
) {
  const { model = "qwen3.8-omni-flash", signal, serviceKey = "copywriting" } = options ?? {};
  const authHeaders = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/ai-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
      ...authHeaders,
    },
    body: JSON.stringify({ messages, model, stream: true, service_key: serviceKey }),
    signal,
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const msg = (errBody as { error?: string }).error || `请求失败: ${response.status}`;
    throw new Error(msg);
  }
  if (!response.body) throw new Error("当前环境不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return fullText;
        try {
          const json = JSON.parse(payload);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            onChunk(content);
          }
        } catch {
          // 忽略非法 JSON 行
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return fullText;
    throw err;
  }
  return fullText;
}

// ===== 视觉理解（图片翻译：识别图中文字）流式调用 =====
type VisionContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };
type VisionMessage = {
  role: "system" | "user" | "assistant";
  content: string | VisionContent[];
};

export async function requestVisionStream(
  messages: VisionMessage[],
  onChunk: (text: string) => void,
  options?: { signal?: AbortSignal; serviceKey?: string }
) {
  const { signal, serviceKey = "image_translate" } = options ?? {};
  const authHeaders = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/ai-vision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
      ...authHeaders,
    },
    body: JSON.stringify({ messages, stream: true, service_key: serviceKey }),
    signal,
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const msg = (errBody as { error?: string }).error || `请求失败: ${response.status}`;
    throw new Error(msg);
  }
  if (!response.body) throw new Error("当前环境不支持流式响应");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") return fullText;
        try {
          const json = JSON.parse(payload);
          const content = json.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            onChunk(content);
          }
        } catch {
          // 忽略非法 JSON 行
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") return fullText;
    throw err;
  }
  return fullText;
}

// ===== 图片生成/编辑（图片处理） =====
export async function generateImage(
  prompt: string,
  model: "qwen-image-2.0" | "qwen-image-3.0" | "wan2.7-image" = "wan2.7-image",
  size?: string,
  options: {
    images?: string[];
    n?: number;
    watermark?: boolean;
    thinking_mode?: boolean;
    serviceKey?: string;
  } = {}
) {
  const n = options.n ?? 1;
  const { serviceKey = "image_process", ...restOptions } = options;
  const authHeaders = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/ai-image-gen`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
      ...authHeaders,
    },
    body: JSON.stringify({ prompt, model, size, n, service_key: serviceKey, ...restOptions }),
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const msg = (errBody as { error?: string }).error || `请求失败: ${response.status}`;
    throw new Error(msg);
  }
  return response.json();
}

// 提取生成图片 URL（兼容百炼 wanx 返回 {output:{results:[{url}]}}）
export function extractImageUrl(response: unknown): string | null {
  const r = response as {
    output?: {
      choices?: { message?: { content?: { image?: string }[] } }[];
      results?: { url?: string }[];
    };
  };
  const fromResults = r?.output?.results?.[0]?.url;
  if (fromResults) return fromResults;
  return r?.output?.choices?.[0]?.message?.content?.[0]?.image ?? null;
}