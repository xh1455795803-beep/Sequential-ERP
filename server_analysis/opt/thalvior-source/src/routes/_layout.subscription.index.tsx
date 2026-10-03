/**
 * /subscription — 订阅中心（按方案 PDF 重做，店铺授权额度合并在本页，购买链路独立于套餐）
 *
 * 页面结构：
 *   1. Hero 状态区
 *   2. 店铺授权额度（免费 2 店 + 已购授权汇总；按 PDF 单平台单店定价独立购买，不绑定订阅套餐）
 *   3. VIP 大套餐（VIP1-4）
 *   4. 快捷充值
 *   5. 积分总览
 *   6. 消耗明细
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowUpRight, Crown, Zap, Copy, Check, X, Loader2,
  Sparkles, Image, FileText, Video, BrainCircuit,
  Coins, TrendingUp, ShieldCheck, CreditCard, Gift, ChevronRight,
  Calendar, Receipt, Store, BadgeCheck, Hourglass, ExternalLink,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import {
  type SubscriptionPlan,
  type Subscription,
  type WechatPayOrderResult,
  type PoolBalances,
  type BenefitRow,
  type ShopLicenseRow,
  FREE_SHOP_LIMIT,
  SHOP_PLAN_OPTIONS,
  SHOP_PERIOD_LABEL,
  getSubscriptionPlans,
  getCurrentSubscription,
  getPoolBalances,
  getActiveBenefits,
  getShopLicenses,
  countBoundShops,
  createWechatPayOrder,
  queryWechatPayOrder,
  getUsageLogs,
} from "@/services/aiService";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_layout/subscription/")({
  component: Subscription,
});

/* ───────── 充值档位（对齐 PDF：100/1000/3000/10000，仅保留 PDF 折扣标签） ───────── */
const RECHARGE_OPTIONS = [
  { amount: 5,   credits: 100,   tag: "",      label: "100 积分" },
  { amount: 49,  credits: 1000,  tag: "9折",   label: "1,000 积分" },
  { amount: 120, credits: 3000,  tag: "8折",   label: "3,000 积分" },
  { amount: 350, credits: 10000, tag: "7折",   label: "10,000 积分" },
];

/* ───────── 额度消耗类型图标映射 ───────── */
const TYPE_META: Record<string, { icon: typeof Sparkles; color: string; label: string }> = {
  chat:     { icon: Sparkles,    color: "text-primary",          label: "AI 对话" },
  vision:   { icon: FileText,    color: "text-success",          label: "图片理解" },
  copy:     { icon: Copy,        color: "text-chart-2",          label: "商品文案" },
  "image-gen": { icon: Image,    color: "text-chart-4",          label: "图片生成" },
  "video-gen": { icon: Video,    color: "text-chart-3",          label: "视频生成" },
};

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? { icon: BrainCircuit, color: "text-muted-foreground", label: type };
}

/* ═══════════════════════════════════════════════════════════
   圆形进度环
   ═══════════════════════════════════════════════════════════ */
function QuotaRing({
  value, max, label, icon: Icon, color, unit, footnote,
}: {
  value: number; max: number; label: string;
  icon: typeof Zap; color: string; unit: string; footnote?: string;
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const R = 44;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - pct);

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-6 shadow-soft">
      <div className="relative">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle cx="60" cy="60" r={R} fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/40" />
          <circle
            cx="60" cy="60" r={R} fill="none" strokeWidth="8" strokeLinecap="round"
            className={color}
            stroke="currentColor"
            strokeDasharray={C}
            strokeDashoffset={offset}
            transform="rotate(-90 60 60)"
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Icon size={18} className={cn("mb-0.5", color)} />
          <span className="font-data text-xl font-bold text-ink">{Math.round(pct * 100)}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-data mt-0.5 text-sm font-semibold text-ink">
          {value.toLocaleString()} <span className="text-muted-foreground font-normal">/ {max > 0 ? max.toLocaleString() : "∞"} {unit}</span>
        </p>
        {footnote && <p className="mt-1 text-[11px] leading-tight text-muted-foreground/80">{footnote}</p>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   VIP 套餐卡片
   ═══════════════════════════════════════════════════════════ */
function PlanCard({
  plan, recommended, onSelect,
}: {
  plan: SubscriptionPlan; recommended?: boolean; onSelect: (p: SubscriptionPlan) => void;
}) {
  const price = plan.price;
  const period = plan.period || "季";
  const features = (plan.features || []).map((f) => ({ label: f, ok: true }));
  if (features.length === 0) {
    features.push({ label: `含可绑店铺 / 子账号 / 图片空间等全部 VIP 权益`, ok: true });
  }

  return (
    <div className={cn(
      "relative flex flex-col rounded-2xl border p-6 transition-all",
      recommended
        ? "border-primary bg-card shadow-lg scale-[1.02] ring-1 ring-primary/20"
        : "border-border bg-card shadow-sm hover:shadow-md",
    )}>
      {recommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground shadow-sm">
            <Crown size={12} className="mr-1" /> 推荐
          </Badge>
        </div>
      )}

      <div className="mb-4">
        <h3 className="font-display text-lg font-semibold text-ink">{plan.name}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {plan.description || period}
        </p>
      </div>

      <div className="mb-5">
        <div className="flex items-baseline gap-1">
          <span className="text-sm text-muted-foreground">¥</span>
          <span className="font-data text-3xl font-bold text-ink">{price}</span>
          <span className="text-sm text-muted-foreground">/ {period}</span>
        </div>
      </div>

      <ul className="mb-6 flex-1 space-y-2.5">
        {features.map((f, idx) => (
          <li key={idx} className="flex items-center gap-2 text-sm">
            {f.ok ? (
              <Check size={14} className="shrink-0 text-success" />
            ) : (
              <X size={14} className="shrink-0 text-muted-foreground/40" />
            )}
            <span className={f.ok ? "text-foreground" : "text-muted-foreground/50 line-through"}>{f.label}</span>
          </li>
        ))}
      </ul>

      <Button
        onClick={() => onSelect(plan)}
        className="w-full"
        variant={recommended ? "default" : "outline"}
        size="lg"
      >
        选择此套餐
        <ChevronRight size={14} className="ml-1" />
      </Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   店铺授权档位卡片
   ═══════════════════════════════════════════════════════════ */
function ShopPlanCard({
  plan, selected, onSelect,
}: {
  plan: (typeof SHOP_PLAN_OPTIONS)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const hasYear = plan.prices.year != null;
  return (
    <button
      onClick={onSelect}
      className={cn(
        "group relative flex flex-col rounded-2xl border p-4 text-left transition-all",
        selected
          ? "border-primary bg-card shadow-md ring-1 ring-primary/25"
          : "border-border bg-card shadow-sm hover:shadow-md",
      )}
    >
      {selected && (
        <div className="absolute -top-2.5 right-3">
          <Badge className="bg-primary text-primary-foreground"><Check size={11} className="mr-1" /> 已选</Badge>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Store size={16} className={cn("shrink-0", selected ? "text-primary" : "text-muted-foreground")} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{plan.name}</p>
          <p className="text-[11px] text-muted-foreground">{plan.platform}</p>
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-xs text-muted-foreground">¥</span>
        <span className="font-data text-2xl font-bold text-ink">{plan.prices.month}</span>
        <span className="text-xs text-muted-foreground">/店·月</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
        {hasYear && <span className="rounded-md bg-muted px-1.5 py-0.5">年 ¥{plan.prices.year}</span>}
        {plan.badge && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-emerald-600">{plan.badge}</span>}
      </div>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   微信支付全屏覆盖
   ═══════════════════════════════════════════════════════════ */
function WechatPayOverlay({
  order, amount, title, onClose, onPaid,
}: {
  order: WechatPayOrderResult; amount: number; title?: string; onClose: () => void; onPaid: () => void;
}) {
  const [seconds, setSeconds] = useState(300);
  const [querying, setQuerying] = useState(false);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const handleCheck = useCallback(async () => {
    setQuerying(true);
    try {
      const r = await queryWechatPayOrder(order.order_no);
      if (r.status === "paid" || r.status === "SUCCESS") {
        toast.success("支付成功！权益已即时生效");
        onPaid();
      } else {
        toast.error("尚未完成支付，请扫码后在微信中确认");
      }
    } catch {
      toast.error("查询失败，请稍后重试");
    } finally {
      setQuerying(false);
    }
  }, [order.order_no, onPaid]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X size={16} />
        </button>

        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M8.5 11.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm7 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="#07C160"/>
              <path d="M12 2C6.48 2 2 5.92 2 10.67c0 2.87 1.69 5.42 4.27 7.07l-.94 2.83c-.1.3.22.57.5.4l3.33-1.95c.9.22 1.86.35 2.84.35 5.52 0 10-3.92 10-8.67S17.52 2 12 2z" fill="#07C160"/>
            </svg>
          </div>
          <h3 className="font-display text-lg font-semibold text-ink">微信扫码支付</h3>
          {title && <p className="mt-1 text-sm text-muted-foreground">{title}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
            扫码支付 · <span className="font-semibold text-ink">¥{amount.toFixed(2)}</span>
          </p>
        </div>

        <div className="relative mx-auto my-6 aspect-square w-56 overflow-hidden rounded-xl border border-border bg-white p-3">
          <QRCodeSVG value={order.code_url} size={200} className="h-full w-full" />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Calendar size={14} className="text-muted-foreground" />
            <span className="text-muted-foreground">
              剩余 <span className={cn("font-data font-semibold", seconds < 60 ? "text-rose-500" : "text-ink")}>
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </span>
            </span>
          </div>
          <Button className="w-full" variant="outline" onClick={handleCheck} disabled={querying}>
            {querying && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            <Check size={14} className="mr-1.5 text-success" />
            我已完成支付
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   主页面
   ═══════════════════════════════════════════════════════════ */
function Subscription() {
  const { t } = useLanguage();
  const { user, status: authStatus } = useAuth();

  /* ── 状态 ── */
  const [sub, setSub] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [currentPlan, setCurrentPlan] = useState<SubscriptionPlan | null>(null);
  const [pools, setPools] = useState<PoolBalances | null>(null);
  const [benefits, setBenefits] = useState<BenefitRow[]>([]);
  const [licenses, setLicenses] = useState<ShopLicenseRow[]>([]);
  const [boundShops, setBoundShops] = useState(0);
  const [usage, setUsage] = useState<any[]>([]);
  const [usageFilter, setUsageFilter] = useState<string>("all");

  const [loadingSub, setLoadingSub] = useState(true);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [loadingUsage, setLoadingUsage] = useState(true);

  const [payingCredits, setPayingCredits] = useState<number | null>(null);
  const [payingPlanId, setPayingPlanId] = useState<string | null>(null);
  const [payingAmount, setPayingAmount] = useState<number>(0);
  const [order, setOrder] = useState<WechatPayOrderResult | null>(null);

  /* ── 店铺授权选择 ── */
  const [selectedShopCode, setSelectedShopCode] = useState<string>("tk_1");
  const [selectedShopPeriod, setSelectedShopPeriod] = useState<string>("month");
  const [payingShop, setPayingShop] = useState(false);

  /* ── 加载 ── */
  const loadAll = useCallback(async () => {
    setLoadingSub(true);
    setLoadingPlans(true);
    setLoadingUsage(true);

    getCurrentSubscription()
      .then((s) => { setSub(s); })
      .catch(() => setSub(null))
      .finally(() => setLoadingSub(false));

    getPoolBalances()
      .then(setPools)
      .catch(() => setPools(null));

    getActiveBenefits()
      .then(setBenefits)
      .catch(() => setBenefits([]));

    getShopLicenses()
      .then(setLicenses)
      .catch(() => setLicenses([]));

    countBoundShops()
      .then(setBoundShops)
      .catch(() => setBoundShops(0));

    getSubscriptionPlans()
      .then((p) => setPlans(p))
      .catch(() => setPlans([]))
      .finally(() => setLoadingPlans(false));

    getUsageLogs(100)
      .then(setUsage)
      .catch(() => setUsage([]))
      .finally(() => setLoadingUsage(false));
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  useEffect(() => {
    if (sub?.plan_id && plans.length > 0) {
      setCurrentPlan(plans.find((p) => p.id === sub.plan_id) ?? null);
    }
  }, [sub, plans]);

  /* ── 计算 ── */
  const totalCreditsAll = usage.reduce((s, u) => s + (u.credits ?? u.cost ?? 0), 0);
  // 近 30 天真实消耗（统一积分池后套餐月配额不再单独追踪，改用时间窗统计）
  const now30d = Date.now() - 30 * 24 * 3600 * 1000;
  const usage30d = usage.reduce((s, u) => {
    const ts = u.created_at ? new Date(u.created_at).getTime() : 0;
    return s + (ts >= now30d ? (u.credits ?? u.cost ?? 0) : 0);
  }, 0);

  const filteredUsage = usageFilter === "all" ? usage : usage.filter((u) => u.type === usageFilter);

  const isVip = !!currentPlan && /vip/i.test(currentPlan.plan_key || "");

  /* ── 店铺授权额度 ── */
  const nowTs = Date.now();
  const activeLicenses = licenses.filter((l) => !l.expires_at || new Date(l.expires_at).getTime() >= nowTs);
  const purchasedCount = activeLicenses.reduce((s, l) => s + (l.shop_count ?? 0), 0);
  const shopQuota = FREE_SHOP_LIMIT + purchasedCount;

  const selectedShopPlan = SHOP_PLAN_OPTIONS.find((p) => p.code === selectedShopCode) ?? SHOP_PLAN_OPTIONS[0];
  const shopUnitPrice = selectedShopPlan.prices[selectedShopPeriod];
  const shopPeriodOptions = Object.keys(selectedShopPlan.prices);

  /* ── 充值 ── */
  const handleRecharge = async (credits: number, amount: number) => {
    if (!user) { toast.error("请先登录"); return; }
    setPayingCredits(credits);
    setPayingAmount(amount);
    const loadingId = toast.loading("正在创建微信支付订单…");
    try {
      const o = await createWechatPayOrder(amount, "native");
      toast.dismiss(loadingId);
      setOrder(o);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(e instanceof Error ? e.message : "创建订单失败");
      setPayingCredits(null);
    }
  };

  /* ── VIP 订阅 ── */
  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    if (!user) { toast.error("请先登录"); return; }
    if (sub?.plan_id === plan.id) { toast.info("当前已是此套餐"); return; }
    const amount = plan.price;
    setPayingPlanId(plan.id);
    setPayingAmount(amount);
    const loadingId = toast.loading("正在创建微信支付订单…");
    try {
      const o = await createWechatPayOrder(amount, "native", { planId: plan.id });
      toast.dismiss(loadingId);
      setOrder(o);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(e instanceof Error ? e.message : "创建订单失败");
      setPayingPlanId(null);
    }
  };

  /* ── 店铺授权购买（独立链路，不绑定套餐） ── */
  const handleBuyShop = async () => {
    if (!user) { toast.error("请先登录"); return; }
    if (!shopUnitPrice) { toast.error("该档位不支持所选周期"); return; }
    setPayingShop(true);
    const loadingId = toast.loading("正在创建微信支付订单…");
    try {
      const o = await createWechatPayOrder(shopUnitPrice, "native", {
        packageType: "shop_license",
        packCode: selectedShopCode,
        period: selectedShopPeriod,
      });
      toast.dismiss(loadingId);
      setOrder(o);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(e instanceof Error ? e.message : "创建订单失败");
    } finally {
      setPayingShop(false);
    }
  };

  const handlePaid = () => { setOrder(null); setPayingCredits(null); setPayingPlanId(null); void loadAll(); };

  /* ── 复制消耗明细 ── */
  const handleCopyUsage = () => {
    const lines = [
      `导出时间：${new Date().toLocaleString("zh-CN")}`,
      `总消耗：${totalCreditsAll} 积分`,
      "",
      "时间, 类型, 消耗积分, 备注",
      ...filteredUsage.map((u) =>
        `${new Date(u.created_at).toLocaleString("zh-CN")}, ${getTypeMeta(u.type).label}, ${u.credits ?? u.cost ?? 0}, ${u.note ?? ""}`
      ),
    ].join("\n");
    navigator.clipboard.writeText(lines);
    toast.success("已复制到剪贴板");
  };

  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-8">
      <PageHeader
        title={t("subscription.title")}
        description={t("subscription.desc")}
      />

      {/* ═══ 1. Hero 状态区 ═══ */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-4/5" />
        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-4">
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl",
              isVip ? "bg-primary/10" : "bg-muted",
            )}>
              {isVip
                ? <Crown size={24} className="text-primary" />
                : <Coins size={24} className="text-muted-foreground" />
              }
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-xl font-bold text-ink">
                  {user?.email ? `${user.email}，你好` : "你好"}
                </h2>
                <Badge variant={isVip ? "default" : "outline"} className="text-[11px]">
                  {currentPlan?.name ?? "加载中"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {sub?.expires_at
                  ? <>套餐到期：<span className="font-medium text-foreground">{new Date(sub.expires_at).toLocaleDateString("zh-CN")}</span></>
                  : "当前为免费版；店铺授权按店铺数独立购买，VIP 大套餐可选"
                }
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById("usage-section")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <Receipt size={14} className="mr-1.5" /> 开通记录
            </Button>
            {!isVip && (
              <Button size="sm" onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}>
                <TrendingUp size={14} className="mr-1.5" /> 升级套餐
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ 2. 店铺授权额度（独立于套餐购买） ═══ */}
      <section id="shop-license">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <Store size={16} className="text-primary" /> 店铺授权额度
            <span className="text-xs font-normal text-muted-foreground">（按店铺数购买，与订阅套餐独立）</span>
          </h3>
        </div>

        {/* 当前额度汇总 */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Store size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">可绑店铺额度</p>
              <p className="font-data text-lg font-bold text-ink">
                {shopQuota} <span className="text-xs font-normal text-muted-foreground">个</span>
              </p>
              <p className="text-[11px] text-muted-foreground">含免费授权 {FREE_SHOP_LIMIT} 店</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-4/10">
              <ShieldCheck size={18} className="text-chart-4" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">已绑定店铺</p>
              <p className="font-data text-lg font-bold text-ink">
                {boundShops} <span className="text-xs font-normal text-muted-foreground">个</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {boundShops >= shopQuota ? "额度已用满，请扩容" : `还可绑定 ${Math.max(shopQuota - boundShops, 0)} 店`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-2/10">
              <BadgeCheck size={18} className="text-chart-2" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">已购授权记录</p>
              <p className="font-data text-lg font-bold text-ink">
                {activeLicenses.length} <span className="text-xs font-normal text-muted-foreground">条有效</span>
              </p>
              <p className="text-[11px] text-muted-foreground">共授权 {purchasedCount} 店</p>
            </div>
          </div>
        </div>

        {/* 按平台购买档位 */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-soft">
          <p className="mb-3 text-xs text-muted-foreground">
            单平台单店定价：TikTok/Temu/Ozon 20 元/店/月（年付低至 4.5 元/店/月）· Shopee/Lazada 18 元/店/月 · 规模档（Temu 多店档）15/50/100/200 店 180/550/1000/2000 元/月。速卖通按服务市场订购。
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {SHOP_PLAN_OPTIONS.map((plan) => (
              <ShopPlanCard
                key={plan.code}
                plan={plan}
                selected={selectedShopCode === plan.code}
                onSelect={() => { setSelectedShopCode(plan.code); setSelectedShopPeriod(Object.keys(plan.prices)[0] ?? "month"); }}
              />
            ))}
          </div>

          {/* 结算条 */}
          <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">{selectedShopPlan.name}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {shopPeriodOptions.map((p) => (
                  <button
                    key={p}
                    onClick={() => setSelectedShopPeriod(p)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      selectedShopPeriod === p
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border text-muted-foreground hover:border-primary/40",
                    )}
                  >
                    {SHOP_PERIOD_LABEL[p] ?? p}
                    <span className="ml-1.5 font-data">¥{selectedShopPlan.prices[p]}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">应付</p>
                <p className="font-data text-2xl font-bold text-ink">
                  ¥{shopUnitPrice ?? 0}<span className="text-xs font-normal text-muted-foreground"> / {SHOP_PERIOD_LABEL[selectedShopPeriod] ?? selectedShopPeriod}</span>
                </p>
              </div>
              <Button onClick={handleBuyShop} disabled={payingShop || !shopUnitPrice} size="lg" className="min-w-36">
                {payingShop ? <Loader2 size={16} className="mr-1.5 animate-spin" /> : <Store size={16} className="mr-1.5" />}
                立即购买
                <ChevronRight size={14} className="ml-1" />
              </Button>
            </div>
          </div>

          {/* 速卖通引导 */}
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
                <ExternalLink size={18} className="text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-ink">速卖通店铺授权</p>
                <p className="text-xs text-muted-foreground">按速卖通服务市场订购（1 店 30 / 5 店 150 / 10 店 300 元/月），费用由服务市场收取</p>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0">走速卖通服务市场</Badge>
          </div>
        </div>

        {/* 授权记录 */}
        <div className="mt-4">
          {licenses.length === 0 ? (
            <div className="flex h-16 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
              暂无购买记录，免费版默认授权 {FREE_SHOP_LIMIT} 个店铺
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {licenses.map((l, idx) => {
                const expired = l.expires_at && new Date(l.expires_at).getTime() < nowTs;
                return (
                  <div key={l.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", idx > 0 && "border-t border-border/70")}>
                    <div className="flex items-center gap-3">
                      <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", expired ? "bg-muted" : "bg-emerald-50")}>
                        <Store size={16} className={expired ? "text-muted-foreground" : "text-emerald-600"} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-ink">
                          店铺授权 {l.shop_count} 店
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{l.plan_code}</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          购买 ¥{Number(l.amount ?? 0).toFixed(2)} · {l.period}付
                          {l.expires_at && <> · {expired ? "已到期" : `有效期至 ${new Date(l.expires_at).toLocaleDateString("zh-CN")}`}</>}
                        </p>
                      </div>
                    </div>
                    <Badge variant={expired ? "outline" : "default"} className={cn("shrink-0", expired && "text-muted-foreground")}>
                      {expired ? "已过期" : "生效中"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ═══ 3. VIP 套餐 ═══ */}
      <section id="plans" className="scroll-mt-28">
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Crown size={16} className="text-chart-4" /> VIP 套餐
        </h3>
        {loadingPlans ? (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : plans.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-sm text-muted-foreground">
            VIP 大套餐暂未上架，请先使用免费版或店铺授权
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
            {plans.filter((p) => /vip/i.test(p.plan_key || "")).map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                recommended={p.plan_key === "vip2"}
                onSelect={handleSelectPlan}
              />
            ))}
          </div>
        )}
      </section>

      {/* ═══ 4. 快捷充值 ═══ */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-ink">
          <CreditCard size={16} className="text-success" /> 快捷充值
          <span className="text-xs font-normal text-muted-foreground">（随用随充，永不过期）</span>
        </h3>

        {benefits.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <Gift size={15} className="shrink-0" />
            {benefits.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1">
                {b.benefit_key === "title_free" && <>已解锁「AI 生成标题免费」至 {new Date(b.expires_at).toLocaleDateString("zh-CN")}</>}
                {b.benefit_key !== "title_free" && <>权益 {b.benefit_key} 生效至 {new Date(b.expires_at).toLocaleDateString("zh-CN")}</>}
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {RECHARGE_OPTIONS.map((opt) => (
            <button
              key={opt.amount}
              onClick={() => handleRecharge(opt.credits, opt.amount)}
              disabled={payingCredits !== null}
              className={cn(
                "relative flex flex-col items-center rounded-xl border border-border bg-card p-4 text-center transition-all hover:border-primary/40 hover:shadow-md",
                payingCredits === opt.credits && "opacity-60",
                opt.tag && "border-primary/30",
              )}
            >
              {opt.tag && (
                <span className="absolute -top-2 right-3 rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold text-white">
                  {opt.tag}
                </span>
              )}
              <span className="font-data text-2xl font-bold text-ink">{opt.credits.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground">积分</span>
              <span className="mt-2 font-data text-lg font-semibold text-primary">¥{opt.amount}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          充值积分永久有效；买 1,000 积分及以上资源包，自动解锁「AI 生成标题」60 天免费权益。
        </p>
      </section>

      {/* ═══ 5. 积分总览 ═══ */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-ink">
          <Zap size={16} className="text-primary" /> 积分总览
        </h3>
        {loadingSub ? (
          <div className="flex h-40 items-center justify-center rounded-2xl border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <QuotaRing
              value={pools?.workbench.total ?? 0}
              max={Math.max(pools?.workbench.total ?? 0, 1)}
              label="AI 工作台积分"
              icon={Zap}
              color="text-primary"
              unit="积分"
              footnote={`今日赠送 ${pools?.workbench.freeToday ?? 0}（当日清零）· 充值 ${pools?.workbench.purchased ?? 0}（永久）`}
            />
            <QuotaRing
              value={pools?.agent.total ?? 0}
              max={Math.max(pools?.agent.total ?? 0, 1)}
              label="AI Agent 积分"
              icon={BrainCircuit}
              color="text-chart-4"
              unit="积分"
              footnote={`今日赠送 ${pools?.agent.freeToday ?? 0}（当日清零）· 充值 ${pools?.agent.purchased ?? 0}（永久）`}
            />
            <QuotaRing
              value={usage30d}
              max={Math.max(usage30d, 1)}
              label="近 30 天消耗"
              icon={Coins}
              color="text-warning"
              unit="积分"
            />
          </div>
        )}
      </section>

      {/* ═══ 6. 消耗明细 ═══ */}
      <section id="usage-section" className="scroll-mt-28">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <TrendingUp size={16} className="text-chart-2" /> 消耗明细
            <span className="text-xs font-normal text-muted-foreground">（近 3 个月，共 {filteredUsage.length} 条）</span>
          </h3>
          <div className="flex items-center gap-2">
            {/* 类型筛选 */}
            <div className="flex rounded-lg bg-muted p-0.5 text-xs">
              {[
                { key: "all", label: "全部" },
                { key: "chat", label: "对话" },
                { key: "copy", label: "文案" },
                { key: "image-gen", label: "图片" },
                { key: "vision", label: "理解" },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setUsageFilter(f.key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition-colors",
                    usageFilter === f.key ? "bg-card text-foreground shadow-sm font-medium" : "text-muted-foreground",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={handleCopyUsage} disabled={filteredUsage.length === 0}>
              <Copy size={13} className="mr-1" /> 复制
            </Button>
          </div>
        </div>

        {loadingUsage ? (
          <div className="flex h-32 items-center justify-center rounded-xl border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredUsage.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card py-12 text-center">
            <FileText size={24} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">暂无消耗记录</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">时间</th>
                  <th className="px-4 py-3 font-medium">类型</th>
                  <th className="px-4 py-3 text-right font-medium">消耗积分</th>
                  <th className="px-4 py-3 font-medium">备注</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsage.map((u) => {
                  const meta = getTypeMeta(u.type);
                  const Icon = meta.icon;
                  return (
                    <tr key={u.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-data text-muted-foreground">
                        {new Date(u.created_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon size={14} className={meta.color} />
                          <span className="text-foreground">{meta.label}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-data font-medium text-rose-500">
                        -{u.credits ?? u.cost ?? 0}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{u.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══ 微信支付弹窗 ═══ */}
      {order && (
        <WechatPayOverlay
          order={order}
          amount={payingAmount}
          title={payingPlanId ? (currentPlan ? `VIP 套餐 · ${currentPlan.name}` : undefined) : payingCredits !== null ? undefined : `店铺授权 · ${selectedShopPlan.name} · ${SHOP_PERIOD_LABEL[selectedShopPeriod] ?? selectedShopPeriod}`}
          onClose={() => { setOrder(null); setPayingCredits(null); setPayingPlanId(null); }}
          onPaid={handlePaid}
        />
      )}
    </div>
  );
}
