// 前端 AI 能力封装：统一通过自建 Supabase Edge Function 调用（AI 供应商：阿里云百炼）
// 文本（ai-chat）、视觉理解（ai-vision）、图片生成/编辑（ai-image-gen）
// 所有消耗型能力走「额度预校验 → 调用 → 成功扣费/失败不扣费」链路
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";
import { translate, type Lang } from "@/i18n/translations";
import { ACTIVE_AUTH_STATUSES } from "@/lib/shop-status";

// 服务模块（无 hook 上下文）用的翻译：与 LanguageContext 的 localStorage 口径一致
function tt(key: string, vars?: Record<string, string | number>): string {
  let lang: Lang = "zh";
  if (typeof window !== "undefined") lang = localStorage.getItem("thalvior_lang") === "en" ? "en" : "zh";
  return translate(key, lang, vars);
}

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
// ===== 店铺授权额度 · 按店铺订购（对齐妙手模式）=====
// 免费版每账号可授权 2 店（任意平台合计）；超出按"平台组 × 店铺数 × 周期"购买
// 价目锚点：1 店 20 元/月，年付低至 4.5 元/店/月；速卖通按服务市场订购，不在此接入
// 服务端公式定价：round(base_price × 数量折扣 × 店铺数 × 周期月数 × 周期折扣)
export interface ShopPlatformGroup {
  code: string;
  label: string;
  platformCode: string; // 下单时传给 wechat-pay 的 platform_code（组代表）
  basePrice: number;
  members: string;
  open: boolean; // 授权入口是否已开放该组
}

export const SHOP_PLATFORM_GROUPS: ShopPlatformGroup[] = [
  { code: "tiktok", label: "TikTok / Temu / Ozon", platformCode: "tiktok", basePrice: 20, members: "ai.svc.group.members.tiktok", open: true },
  { code: "shopee", label: "Shopee / Lazada", platformCode: "shopee", basePrice: 18, members: "ai.svc.group.members.shopee", open: true },
  { code: "shein", label: "SHEIN / Amazon / Yandex", platformCode: "shein", basePrice: 16, members: "ai.svc.group.members.shein", open: true },
  { code: "regional", label: "ai.svc.group.label.regional", platformCode: "coupang", basePrice: 15, members: "ai.svc.group.members.regional", open: false },
  { code: "indie", label: "ai.svc.group.label.indie", platformCode: "shopify", basePrice: 29, members: "ai.svc.group.members.indie", open: true },
];

// license_platforms 表行：店铺额度购买选择器的动态数据源（服务端 wechat-pay 同表取价）
export interface LicensePlatformRow {
  platform_code: string;
  name: string;
  category: string;
  base_price: number;
  icon_key: string | null;
  sort_order: number;
  status: string;
}

// 拉取全部启用平台：全部开放购买，前端不再维护平台白名单（SHOP_PLATFORM_GROUPS 仅作查询失败兜底）
export async function getLicensePlatforms(): Promise<LicensePlatformRow[]> {
  const { data, error } = await supabase
    .from("license_platforms")
    .select("platform_code,name,category,base_price,icon_key,sort_order,status")
    .eq("status", "启用")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LicensePlatformRow[];
}

export const SHOP_COUNT_TIERS = [1, 5, 10, 15, 50, 100, 200, 500] as const;

// 前端预估展示用；服务端以 license_shop_tiers / license_periods 表为准
export const SHOP_TIERS_DISCOUNT: Record<number, number> = { 1: 1, 5: 0.8, 10: 0.65, 15: 0.6, 50: 0.55, 100: 0.5, 200: 0.5, 500: 0.45 };

export interface ShopPeriodOption { code: string; label: string; months: number; discount: number; }
export const SHOP_PERIODS: ShopPeriodOption[] = [
  { code: "month", label: "sub.period.pay.month", months: 1, discount: 1 },
  { code: "quarter", label: "sub.period.pay.quarter", months: 3, discount: 0.9 },
  { code: "half_year", label: "sub.period.pay.halfYear", months: 6, discount: 0.8 },
  { code: "year", label: "sub.period.pay.year", months: 12, discount: 0.75 },
];

export function estimateShopPrice(basePrice: number, shopCount: number, periodCode: string): number {
  const period = SHOP_PERIODS.find((p) => p.code === periodCode) ?? SHOP_PERIODS[0];
  const tier = SHOP_TIERS_DISCOUNT[shopCount] ?? 1;
  return Math.round(basePrice * tier * shopCount * period.months * period.discount);
}

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

// 已绑定店铺数 = shop_auths 中仍有效的授权记录（已授权 / 即将到期）
// ⚠️ 与 EF authorize-shop 的额度校验同口径：即将到期的店仍占用额度、仍是有效授权
export async function countBoundShops(): Promise<number> {
  const { count } = await supabase
    .from("shop_auths")
    .select("id", { count: "exact", head: true })
    .in("status", [...ACTIVE_AUTH_STATUSES]);
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
  return (data ?? []) as unknown as TranslatePackRow[];
}

export const TRANSLATE_PACK_OPTIONS = [
  { code: "tr100", name: tt('ai.pkg.tr100.name'), count: 100, price: 45, tag: "", desc: tt('ai.pkg.tr100.desc') },
  { code: "tr500", name: tt('ai.pkg.tr500.name'), count: 500, price: 200, tag: tt('ai.pkg.tagHot'), desc: tt('ai.pkg.tr500.desc') },
  { code: "tr2000", name: tt('ai.pkg.tr2000.name'), count: 2000, price: 700, tag: tt('ai.pkg.tagValue'), desc: tt('ai.pkg.tr2000.desc') },
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
// packageType=shop_license+platformCode+shopCount+period 为店铺授权；否则为「额度充值」
export async function createWechatPayOrder(
  amount: number,
  payType: WechatPayType = "native",
  extra?: { payerIp?: string; planId?: string; packageType?: string; packCode?: string; period?: string; platformCode?: string; shopCount?: number }
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
      platform_code: extra?.platformCode,
      shop_count: extra?.shopCount,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error((result as { error?: string }).error || tt("ai.svc.err.orderCreate", { n: response.status }));
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
    throw new Error((result as { error?: string }).error || tt("ai.svc.err.orderQuery", { n: response.status }));
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
    unit: (data.unit as string) ?? tt("ai.svc.unitFallback"),
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
    return tt("ai.svc.costFlatPerUse", { n: perUse });
  }
  const m = p.markup > 0 ? p.markup : 1;
  if (p.billing_mode === "per_image") {
    const price = p.unit_price * m;
    const credits = Math.max(1, Math.ceil(price * 20));
    return tt("ai.svc.costPerImage", { n: credits });
  }
  if (p.billing_mode === "token") {
    const inPrice = p.input_price_per_mtok * m;
    const outPrice = p.output_price_per_mtok * m;
    const creditsIn = Math.max(1, Math.ceil(inPrice * 20));
    const creditsOut = Math.max(1, Math.ceil(outPrice * 20));
    return tt("ai.svc.costToken", { in: creditsIn, out: creditsOut });
  }
  const price = p.unit_price * m;
  const credits = Math.max(1, Math.ceil(price * 20));
  return tt("ai.svc.costPerUseApprox", { n: credits });
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
    status: params.status ?? "部分成功",
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
  if (error) throw new Error(tt("ai.svc.err.delete", { msg: error.message }));
  if (!data || data.length === 0) throw new Error(tt("ai.svc.err.deleteBlocked"));
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
    const msg = (errBody as { error?: string }).error || tt("ai.svc.err.request", { n: response.status });
    throw new Error(msg);
  }
  if (!response.body) throw new Error(tt("ai.svc.err.noStream"));

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
    const msg = (errBody as { error?: string }).error || tt("ai.svc.err.request", { n: response.status });
    throw new Error(msg);
  }
  if (!response.body) throw new Error(tt("ai.svc.err.noStream"));

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

// ===== 图片翻译（qwen-mt-image-2.0：图进图出，妙手式合成回图，当页出成品图） =====
// label 仅为 zh 兼容保留；UI 渲染一律用 labelKey（i18n），EN 模式不再显示中文语言名
export const TRANSLATE_TARGET_LANGS = [
  { code: "ru", labelKey: "pd.lang.ru" },
  { code: "en", labelKey: "pd.lang.en" },
  { code: "ja", labelKey: "pd.lang.ja" },
  { code: "ko", labelKey: "pd.lang.ko" },
  { code: "es", labelKey: "pd.lang.es" },
  { code: "fr", labelKey: "pd.lang.fr" },
  { code: "de", labelKey: "pd.lang.de" },
  { code: "it", labelKey: "pd.lang.it" },
  { code: "vi", labelKey: "pd.lang.vi" },
  { code: "th", labelKey: "pd.lang.th" },
  { code: "ar", labelKey: "pd.lang.ar" },
  { code: "pt", labelKey: "pd.lang.pt" },
] as const;

export async function translateImage(
  imageUrl: string,
  targetLang: string,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const authHeaders = await getAuthHeaders();
  const response = await fetch(`${supabaseUrl}/functions/v1/ai-vision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "OneDay-App-Id": projectUrlId,
      ...authHeaders,
    },
    body: JSON.stringify({
      service_key: "image_translate",
      image_url: imageUrl,
      source_lang: "auto",
      target_lang: targetLang,
    }),
    signal: options?.signal,
  });
  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const msg = (errBody as { error?: string }).error || tt("ai.svc.err.request", { n: response.status });
    throw new Error(msg);
  }
  const json = await response.json();
  if (!json?.imageUrl) throw new Error(tt("ai.svc.err.noTranslateImg"));
  return json.imageUrl as string;
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
    const msg = (errBody as { error?: string }).error || tt("ai.svc.err.request", { n: response.status });
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