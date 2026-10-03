// 采集设置与认领规则：对标商用 ERP 的「采集设置 → 认领自动应用」链路
import { supabase } from "@/supabase/client";

export interface CollectSettings {
  price_markup: number;      // 加价率 %
  price_fixed_fee: number;   // 固定费用
  price_ending: string;      // 尾数 .99/.95/空
  default_stock: number;     // 默认库存
  banned_words: string;      // 违禁词（逗号分隔）
  auto_claim_shop: string;   // 自动认领店铺（空=不自动）
}

export const DEFAULT_SETTINGS: CollectSettings = {
  price_markup: 30,
  price_fixed_fee: 0,
  price_ending: "",
  default_stock: 100,
  banned_words: "",
  auto_claim_shop: "",
};

export async function loadCollectSettings(): Promise<CollectSettings> {
  const { data } = await supabase
    .from("collect_settings")
    .select("*")
    .maybeSingle();
  if (!data) return DEFAULT_SETTINGS;
  return {
    price_markup: Number(data.price_markup) || 0,
    price_fixed_fee: Number(data.price_fixed_fee) || 0,
    price_ending: data.price_ending || "",
    default_stock: Number(data.default_stock) || 0,
    banned_words: data.banned_words || "",
    auto_claim_shop: data.auto_claim_shop || "",
  };
}

export async function saveCollectSettings(s: CollectSettings): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user?.id;
  if (!uid) throw new Error("未登录");
  const { error } = await supabase.from("collect_settings").upsert({
    user_id: uid,
    price_markup: s.price_markup,
    price_fixed_fee: s.price_fixed_fee,
    price_ending: s.price_ending,
    default_stock: s.default_stock,
    banned_words: s.banned_words,
    auto_claim_shop: s.auto_claim_shop,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

/** 应用价格公式：采购价 × (1 + markup%) + 固定费，取尾数 */
export function applyPriceFormula(cost: number, s: CollectSettings): number {
  if (!cost || cost <= 0) return 0;
  let price = cost * (1 + s.price_markup / 100) + s.price_fixed_fee;
  if (s.price_ending) {
    const ending = Number(s.price_ending);
    if (Number.isFinite(ending)) {
      const base = Math.floor(price);
      price = base + ending;
    }
  }
  return Math.round(price * 100) / 100;
}

/** 违禁词过滤：从文本中移除命中词 */
export function filterBannedWords(text: string, s: CollectSettings): string {
  if (!text || !s.banned_words) return text || "";
  const words = s.banned_words.split(/[,，]/).map((w) => w.trim()).filter(Boolean);
  let result = text;
  for (const w of words) {
    result = result.split(w).join("");
  }
  return result.replace(/\s{2,}/g, " ").trim();
}
