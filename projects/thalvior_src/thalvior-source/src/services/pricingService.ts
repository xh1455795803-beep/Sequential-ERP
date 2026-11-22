/**
 * pricingService — 定价模板服务（P0-2）
 * 模板 CRUD（pricing_templates 表，owner RLS）+ 定价计算纯函数
 * 联动闭环：采购入库回写 products.cost → 模板读 cost 算价 → 建议售价回填 products.price → publish-listing 发布
 */
import { supabase } from "@/supabase/client";

import { tt } from "@/i18n/tts";
export interface PricingTemplate {
  id: string;
  name: string;
  markup_type: "percent" | "fixed";
  markup_value: number;
  commission_rate: number;
  freight: number;
  target_currency: string;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface PricingBreakdown {
  cost: number;            // 采购成本 ¥
  freight: number;         // 头程运费 ¥
  subtotal: number;        // 成本+运费 ¥
  markup: number;          // 加价金额 ¥（percent: subtotal×p%；fixed: 固定值）
  commission: number;      // 平台佣金 ¥
  priceCny: number;        // 含佣建议售价 ¥
  rate: number | null;     // 1 外币 = ? ¥（实时）
  priceForeign: number | null; // 建议售价（目标币种）
  currency: string;
}

export const PRICING_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "KRW", "RUB", "BRL", "MXN",
  "AUD", "CAD", "HKD", "SGD", "THB", "VND", "PHP", "MYR", "IDR", "SAR", "AED", "PLN",
] as const;

/** 建议售价 = (成本+运费) × (1+加价率) ÷ (1-佣金率)，按实时汇率折算目标币种 */
export function computePricing(
  tpl: Pick<PricingTemplate, "markup_type" | "markup_value" | "commission_rate" | "freight" | "target_currency">,
  cost: number,
  rate: number | null,
): PricingBreakdown {
  const c = Number(cost) || 0;
  const f = Number(tpl.freight) || 0;
  const subtotal = c + f;
  const commissionRate = Math.min(Math.max(Number(tpl.commission_rate) || 0, 0), 99) / 100;
  const markup =
    tpl.markup_type === "fixed"
      ? Math.max(Number(tpl.markup_value) || 0, 0)
      : subtotal * (Math.max(Number(tpl.markup_value) || 0, 0) / 100);
  const base = subtotal + markup;
  const priceCny = commissionRate < 1 ? base / (1 - commissionRate) : base;
  const commission = priceCny - base;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const validRate = rate != null && Number.isFinite(rate) && rate > 0 ? rate : null;
  return {
    cost: round2(c),
    freight: round2(f),
    subtotal: round2(subtotal),
    markup: round2(markup),
    commission: round2(commission),
    priceCny: round2(priceCny),
    rate: validRate,
    priceForeign: validRate ? round2(priceCny / validRate) : null,
    currency: tpl.target_currency,
  };
}

function mapRow(r: Record<string, unknown>): PricingTemplate {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    markup_type: (r.markup_type === "fixed" ? "fixed" : "percent"),
    markup_value: Number(r.markup_value ?? 0),
    commission_rate: Number(r.commission_rate ?? 0),
    freight: Number(r.freight ?? 0),
    target_currency: String(r.target_currency ?? "USD"),
    is_default: Boolean(r.is_default),
    created_at: r.created_at ? String(r.created_at) : undefined,
    updated_at: r.updated_at ? String(r.updated_at) : undefined,
  };
}

export async function listTemplates(): Promise<PricingTemplate[]> {
  const { data, error } = await supabase
    .from("pricing_templates")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapRow);
}

export async function createTemplate(t: Omit<PricingTemplate, "id" | "created_at" | "updated_at">): Promise<PricingTemplate> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error(tt('common.notLoggedIn'));
  const { data, error } = await supabase
    .from("pricing_templates")
    .insert({
      user_id: auth.user.id,
      name: t.name,
      markup_type: t.markup_type,
      markup_value: t.markup_value,
      commission_rate: t.commission_rate,
      freight: t.freight,
      target_currency: t.target_currency,
      is_default: t.is_default,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return mapRow(data);
}

export async function updateTemplate(id: string, patch: Partial<PricingTemplate>): Promise<void> {
  const { error } = await supabase.from("pricing_templates").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteTemplate(id: string): Promise<void> {
  const { error } = await supabase.from("pricing_templates").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** 设为默认（DB 触发器兜底清除其他默认，前端先显式清一遍保证一致） */
export async function setDefaultTemplate(id: string): Promise<void> {
  await supabase.from("pricing_templates").update({ is_default: false }).neq("id", id);
  const { error } = await supabase.from("pricing_templates").update({ is_default: true }).eq("id", id);
  if (error) throw new Error(error.message);
}
