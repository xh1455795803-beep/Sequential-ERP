// 订阅权益：套餐携带的店铺数 / 商品数 / AI 额度上限
// 说明：权益来自 subscriptions（当前生效订阅）→ subscription_plans（套餐定义）
// -1 表示不限。未查到订阅时按免费版处理，避免"无记录 = 无限制"的漏洞。
import { supabase } from "@/supabase/client";

export interface PlanLimits {
  planName: string;
  maxShops: number;
  maxProducts: number;
  quota: number;
}

const FALLBACK: PlanLimits = {
  planName: "免费版",
  maxShops: 1,
  maxProducts: 100,
  quota: 0,
};

export async function getCurrentPlanLimits(): Promise<PlanLimits> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) return FALLBACK;

  const { data: sub } = await supabase
    .from("subscriptions")
    .select("plan_id,plan_name")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub?.plan_id) {
    return { ...FALLBACK, planName: (sub?.plan_name as string) || FALLBACK.planName };
  }

  const { data: plan } = await supabase
    .from("subscription_plans")
    .select("name,max_shops,max_products,quota")
    .eq("id", sub.plan_id)
    .maybeSingle();

  if (!plan) return FALLBACK;

  return {
    planName: (plan.name as string) || (sub.plan_name as string) || FALLBACK.planName,
    maxShops: Number.isFinite(Number(plan.max_shops)) ? Number(plan.max_shops) : FALLBACK.maxShops,
    maxProducts: Number.isFinite(Number(plan.max_products)) ? Number(plan.max_products) : FALLBACK.maxProducts,
    quota: Number(plan.quota) || 0,
  };
}

// 是否还能新增店铺
export async function checkShopLimit(
  currentCount: number,
): Promise<{ ok: boolean; message?: string; limits: PlanLimits }> {
  const limits = await getCurrentPlanLimits();
  if (limits.maxShops >= 0 && currentCount >= limits.maxShops) {
    return {
      ok: false,
      message: `当前套餐（${limits.planName}）最多授权 ${limits.maxShops} 个店铺，已达上限，请升级套餐后继续`,
      limits,
    };
  }
  return { ok: true, limits };
}

// 是否还能新增商品
export async function checkProductLimit(
  currentCount: number,
): Promise<{ ok: boolean; message?: string; limits: PlanLimits }> {
  const limits = await getCurrentPlanLimits();
  if (limits.maxProducts >= 0 && currentCount >= limits.maxProducts) {
    return {
      ok: false,
      message: `当前套餐（${limits.planName}）最多创建 ${limits.maxProducts} 个商品，已达上限，请升级套餐后继续`,
      limits,
    };
  }
  return { ok: true, limits };
}
