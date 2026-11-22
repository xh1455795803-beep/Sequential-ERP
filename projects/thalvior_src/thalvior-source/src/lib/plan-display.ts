// DB 文案 i18n（自订阅页抽出的共享模块，供 sidebar 顶栏与订阅中心同一数据源/同一渲染规则）：
// 套餐名/权益/描述来自 subscription_plans（中文种子数据）。
// en 下按规则映射为翻译 key，未命中回退 DB 原文（同 platformLabel 先例）。
/* DB 文案 i18n：套餐名/权益/描述来自 subscription_plans（中文种子数据）。
   en 下按规则映射为翻译 key，未命中回退 DB 原文（同 platformLabel 先例）。 */
type TFunc = (k: string, vars?: Record<string, string | number>) => string;
const DB_PERIOD_KEY: Record<string, string> = { 季: "sub.period.quarter", 年: "sub.period.year", 月: "sub.period.month" };
export function dbPlanPeriod(p: string | null | undefined, lang: string, t: TFunc): string {
  if (!p) return "";
  if (lang !== "en") return p;
  const k = DB_PERIOD_KEY[p];
  return k ? t(k) : p;
}
export function dbPlanText(s: string | null | undefined, lang: string, t: TFunc): string {
  const v = (s ?? "").trim();
  if (!v || lang !== "en") return v;
  let m: RegExpMatchArray | null;
  if (v === "免费版") return t("sub.freeTier");
  if ((m = v.match(/^可授权店铺 (\d+)[~～](\d+) 个\/平台$/))) return t("sub.dbPlan.shopsRange", { a: m[1], b: m[2] });
  if ((m = v.match(/^可授权店铺 (\d+) 个\/平台$/))) return t("sub.dbPlan.shops", { n: m[1] });
  if ((m = v.match(/^可授权店铺 (\d+) 个（全平台合计）$/))) return t("sub.dbPlan.shopsTotal", { n: m[1] });
  if ((m = v.match(/^子账号 (\d+) 个$/))) return t("sub.dbPlan.subacc", { n: m[1] });
  if (v === "子账号不限") return t("sub.dbPlan.subaccUnlimited");
  if (v === "子账号：不支持") return t("sub.dbPlan.subaccNo");
  if ((m = v.match(/^图片空间 (\d+)MB$/))) return t("sub.dbPlan.storage", { n: m[1] });
  if ((m = v.match(/^1688采集链接 (\d+)万条\/月$/))) return t("sub.dbPlan.collect1688", { n: Number(m[1]) * 10000 });
  if (v === "刊登额度同按店铺付费版") return t("sub.dbPlan.listingSamePaid");
  if (v === "基础刊登额度，每店每日限量") return t("sub.dbPlan.listingBasic");
  // 「营销全功能开放 / 仅开放基础营销活动」两条分支随 subscription_plans 文案清理一并移除（2026-11-17）：系统无营销模块
  if (v === "AI 能力按积分充值使用") return t("sub.dbPlan.aiCredits");
  if ((m = v.match(/^每季赠送 ([\d,]+) AI 积分$/))) return t("sub.dbPlan.giftQuarterly", { n: m[1] });
  if ((m = v.match(/^每月赠送 ([\d,]+) AI 积分$/))) return t("sub.dbPlan.giftMonthly", { n: m[1] });
  if ((m = v.match(/^每年赠送 ([\d,]+) AI 积分$/))) return t("sub.dbPlan.giftYearly", { n: m[1] });
  if ((m = v.match(/^(\d+)[–—-](\d+) 个\/平台店铺 · 子账号 (\d+) 个 · (\d+)MB 图片空间$/))) return t("sub.dbPlan.descShopsRangeSub", { a: m[1], b: m[2], c: m[3], d: m[4] });
  if ((m = v.match(/^(\d+) 个店铺 · (\d+)MB 图片空间$/))) return t("sub.dbPlan.descShops", { a: m[1], b: m[2] });
  if ((m = v.match(/^(\d+) 个\/平台店铺 · 子账号不限 · (\d+)MB 图片空间$/))) return t("sub.dbPlan.descShopsUnlSub", { a: m[1], b: m[2] });
  if ((m = v.match(/^店铺不限 · 子账号不限 · (\d+)MB 图片空间$/))) return t("sub.dbPlan.descUnlAll", { n: m[1] });
  if ((m = v.match(/^免费版做获客钩子，(\d+) 个店铺任意平台合计$/))) return t("sub.dbPlan.descFreeHook", { n: m[1] });
  return v;
}

