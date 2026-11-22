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
import { Save,
  ArrowUpRight, Crown, Zap, Copy, Check, X, Loader2,
  Sparkles, Image, FileText, Video, BrainCircuit,
  Coins, TrendingUp, ShieldCheck, CreditCard, Gift, ChevronRight,
  Calendar, Receipt, Store, BadgeCheck, Hourglass, ExternalLink,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { detectPayEnv } from "@/lib/payEnv";
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
  type LicensePlatformRow,
  FREE_SHOP_LIMIT,
  SHOP_PLATFORM_GROUPS,
  SHOP_COUNT_TIERS,
  SHOP_PERIODS,
  estimateShopPrice,
  getSubscriptionPlans,
  getCurrentSubscription,
  getPoolBalances,
  getActiveBenefits,
  getShopLicenses,
  getLicensePlatforms,
  countBoundShops,
  createWechatPayOrder,
  queryWechatPayOrder,
  getUsageLogs,
} from "@/services/aiService";
import { useLanguage } from "@/i18n/LanguageContext";
import { useAuth } from "@/lib/auth";
import { dbPlanPeriod, dbPlanText } from "@/lib/plan-display";

export const Route = createFileRoute("/_layout/subscription/")({
  component: Subscription,
});

/* ───────── 充值档位（对齐 PDF：100/1000/3000/10000，仅保留 PDF 折扣标签） ───────── */
const RECHARGE_OPTIONS = [
  { amount: 5,   credits: 100,   tag: "",      label: "sub.recharge.label.100" },
  { amount: 49,  credits: 1000,  tag: "sub.recharge.tag.90",   label: "sub.recharge.label.1000" },
  { amount: 120, credits: 3000,  tag: "sub.recharge.tag.80",   label: "sub.recharge.label.3000" },
  { amount: 350, credits: 10000, tag: "sub.recharge.tag.70",   label: "sub.recharge.label.10000" },
];

/* ───────── 额度消耗类型图标映射 ───────── */
const TYPE_META: Record<string, { icon: typeof Sparkles; color: string; label: string }> = {
  chat:     { icon: Sparkles,    color: "text-primary",          label: "sub.usage.type.chat" },
  vision:   { icon: FileText,    color: "text-success",          label: "sub.usage.type.vision" },
  copy:     { icon: Copy,        color: "text-chart-2",          label: "sub.usage.type.copy" },
  "image-gen": { icon: Image,    color: "text-chart-4",          label: "sub.usage.type.imageGen" },
  "video-gen": { icon: Video,    color: "text-chart-3",          label: "sub.usage.type.videoGen" },
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
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 shadow-soft">
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
          <span className="font-data text-xl font-bold text-fg">{Math.round(pct * 100)}%</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs text-fg-muted">{label}</p>
        <p className="font-data mt-0.5 text-sm font-semibold text-fg">
          {value.toLocaleString()} <span className="text-fg-muted font-normal">/ {max > 0 ? max.toLocaleString() : "∞"} {unit}</span>
        </p>
        {footnote && <p className="mt-1 text-[11px] leading-tight text-fg-muted/80">{footnote}</p>}
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
  const { t, lang } = useLanguage();
  const price = plan.price;
  const period = dbPlanPeriod(plan.period, lang, t) || t("sub.plan.periodFallback");
  const features = (plan.features || []).map((f) => ({ label: dbPlanText(f, lang, t), ok: true }));
  if (features.length === 0) {
    features.push({ label: t("sub.plan.defaultFeature"), ok: true });
  }

  return (
    <div className={cn(
      "relative flex flex-col rounded-xl border p-6 transition-all",
      recommended
        ? "border-primary bg-card shadow-lift scale-[1.02] ring-1 ring-primary/20"
        : "border-border bg-card shadow-soft hover:shadow-lift",
    )}>
      {recommended && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <Badge className="bg-primary text-primary-foreground shadow-soft">
            <Crown size={12} className="mr-1" /> {t("sub.plan.recommended")}
          </Badge>
        </div>
      )}

      <div className="mb-4">
        <h3 className="font-display text-lg font-semibold text-fg">{dbPlanText(plan.name, lang, t)}</h3>
        <p className="mt-1 text-xs text-fg-muted">
          {dbPlanText(plan.description, lang, t) || period}
        </p>
      </div>

      <div className="mb-5">
        <div className="flex items-baseline gap-1">
          <span className="text-sm text-fg-muted">¥</span>
          <span className="font-data text-3xl font-bold text-fg">{price}</span>
          <span className="text-sm text-fg-muted">/ {period}</span>
        </div>
      </div>

      <ul className="mb-6 flex-1 space-y-2.5">
        {features.map((f, idx) => (
          <li key={idx} className="flex items-center gap-2 text-sm">
            {f.ok ? (
              <Check size={14} className="shrink-0 text-success" />
            ) : (
              <X size={14} className="shrink-0 text-fg-muted/40" />
            )}
            <span className={f.ok ? "text-fg" : "text-fg-muted/50 line-through"}>{f.label}</span>
          </li>
        ))}
      </ul>

      <Button
        onClick={() => onSelect(plan)}
        className="w-full"
        variant={recommended ? "default" : "outline"}
        size="lg"
      >
        {t("sub.plan.selectBtn")}
        <ChevronRight size={14} className="ml-1" />
      </Button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   店铺授权 · 按店铺订购（选平台 → 店铺数 → 周期）
   平台数据来自 license_platforms 表：全部开放购买，无白名单、无"即将开放"
   ═══════════════════════════════════════════════════════════ */
type ShopGroupOption = {
  code: string;
  label: string;
  platformCode: string;
  basePrice: number;
  category: string;
  open: boolean;
};

// license_platforms.category → 分组标题 i18n key（未知分类归入"其他"）
const SHOP_CATEGORY_KEYS: Record<string, string> = {
  "主流平台": "sub.shop.cat.main",
  "全托管": "sub.shop.cat.hosted",
  "独立站": "sub.shop.cat.indie",
};
const SHOP_CATEGORY_ORDER = ["sub.shop.cat.main", "sub.shop.cat.hosted", "sub.shop.cat.indie", "sub.shop.cat.other"];
const shopGroupCatKey = (g: ShopGroupOption): string => SHOP_CATEGORY_KEYS[g.category] ?? "sub.shop.cat.other";

// 平台名 i18n：zh 显示 DB 中文名（license_platforms.name），en 查 platform.name.<code>（未命中回退 DB 名）
function platformLabel(name: string, code: string, lang: string, tf: (k: string) => string): string {
  if (lang !== "en") return name;
  const k = `platform.name.${code}`;
  const v = tf(k);
  return v === k ? name : v;
}

function ShopTierPicker({
  groups, selGroup, selCount, selPeriod, onGroup, onCount, onPeriod,
}: {
  groups: ShopGroupOption[];
  selGroup: number; selCount: number; selPeriod: string;
  onGroup: (i: number) => void; onCount: (n: number) => void; onPeriod: (c: string) => void;
}) {
  const { t, lang } = useLanguage();
  const group = groups[selGroup];
  const price = group ? estimateShopPrice(group.basePrice, selCount, selPeriod) : 0;
  const selPeriodDef = SHOP_PERIODS.find((p) => p.code === selPeriod);
  const perShopPerMonth = selCount > 0 ? price / (selCount * (selPeriodDef?.months ?? 1)) : 0;
  return (
    <div className="space-y-4">
      {/* 第 1 步：平台（license_platforms 全量启用平台，按分类分组，全部可买） */}
      <div>
        <p className="mb-2 text-xs font-medium text-fg-muted">{t("sub.shop.step1")}</p>
        {SHOP_CATEGORY_ORDER.map((catKey) => {
          const items = groups.map((g, i) => ({ g, i })).filter(({ g }) => shopGroupCatKey(g) === catKey);
          if (items.length === 0) return null;
          return (
            <div key={catKey} className="mb-3 last:mb-0">
              <p className="mb-1.5 text-[11px] font-semibold text-fg-muted">{t(catKey)}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {items.map(({ g, i }) => (
                  <button
                    key={g.code}
                    onClick={() => onGroup(i)}
                    className={cn(
                      "relative flex flex-col rounded-xl border p-3 text-left transition-all",
                      i === selGroup ? "border-primary bg-card shadow-lift ring-1 ring-primary/25" : "border-border bg-card hover:shadow-float",
                    )}
                  >
                    {i === selGroup && <Check size={13} className="absolute right-2 top-2 text-primary" />}
                    <p className="truncate text-xs font-semibold text-fg" title={platformLabel(g.label, g.code, lang, t)}>{platformLabel(g.label, g.code, lang, t)}</p>
                    <p className="mt-1.5 font-data text-sm font-bold text-primary">¥{g.basePrice}<span className="text-[10px] font-normal text-fg-muted">{t("sub.shop.perShopMonth")}</span></p>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {/* 第 2 步：店铺数 */}
      <div>
        <p className="mb-2 text-xs font-medium text-fg-muted">{t("sub.shop.step2")}</p>
        <div className="flex flex-wrap gap-2">
          {SHOP_COUNT_TIERS.map((n) => (
            <button
              key={n}
              onClick={() => onCount(n)}
              className={cn(
                "rounded-xl border px-4 py-2 text-sm transition-colors",
                n === selCount ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-fg-muted hover:border-primary/40",
              )}
            >
              {n} {t("sub.shop.countUnit")}
            </button>
          ))}
        </div>
      </div>
      {/* 第 3 步：周期 */}
      <div>
        <p className="mb-2 text-xs font-medium text-fg-muted">{t("sub.shop.step3")}</p>
        <div className="flex flex-wrap gap-2">
          {SHOP_PERIODS.map((p) => {
            const pv = estimateShopPrice(group.basePrice, selCount, p.code);
            return (
              <button
                key={p.code}
                onClick={() => onPeriod(p.code)}
                className={cn(
                  "rounded-xl border px-4 py-2 text-sm transition-colors",
                  p.code === selPeriod ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-fg-muted hover:border-primary/40",
                )}
              >
                {t(p.label)} <span className="ml-1 font-data">¥{pv}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* 结算条 */}
      <div className="flex flex-col gap-3 border-t border-border/70 pt-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-fg-muted">
            {t("sub.shop.payable")} <span className="font-data text-2xl font-bold text-fg">¥{price}</span>
            <span className="ml-2 text-xs">/{t({ month: "sub.period.month", quarter: "sub.period.quarter", half_year: "sub.period.halfYear", year: "sub.period.year" }[selPeriod] ?? selPeriod)}</span>
          </p>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            {group ? platformLabel(group.label, group.code, lang, t) : ""} · {selCount} {t("sub.shop.shopUnit")} · {selPeriodDef ? t(selPeriodDef.label) : ""}
            {perShopPerMonth > 0 && <> · {t("sub.shop.perShopCalcPre")} <span className="font-data">{perShopPerMonth.toFixed(1)}</span> {t("sub.shop.perShopCalcUnit")}</>}
            {selPeriod === "year" && selCount === 1 && <> · <span className="text-success">{t("sub.shop.lowest")}</span></>}
          </p>
        </div>
      </div>
    </div>
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
  const { t } = useLanguage();
  const payEnv = useMemo(() => detectPayEnv(), []); // wechat / mobile / pc 分流
  const [seconds, setSeconds] = useState(300);
  const [querying, setQuerying] = useState(false);
  const [polling, setPolling] = useState(true);
  // 防止轮询回调与手动按钮在支付成功瞬间重复触发
  const paidRef = useRef(false);

  const finishPaid = useCallback(() => {
    if (paidRef.current) return;
    paidRef.current = true;
    toast.success(t("sub.pay.success"));
    onPaid();
  }, [onPaid]);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleSaveQr = () => {
    const cv = qrCanvasRef.current;
    if (!cv) return;
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png");
    a.download = `thalvior-pay-${(amount || 0).toFixed(2)}-${order.order_no.slice(-6)}.png`;
    a.click();
    toast.success(t("sub.pay.qrSaved"));
  };

  /* 弹窗打开即自动轮询真实订单状态：支付成功后自动关闭弹窗并刷新权益（最长轮询 5 分钟，与二维码有效期一致） */
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const startedAt = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        const r = await queryWechatPayOrder(order.order_no);
        if (stopped) return;
        if (r.status === "paid" || r.status === "SUCCESS") {
          finishPaid();
          return;
        }
      } catch {
        // 单次查询失败（网络抖动等）静默处理，下一轮继续
      }
      if (stopped) return;
      if (Date.now() - startedAt >= 295_000) { setPolling(false); return; }
      timer = setTimeout(tick, 2500);
    };
    timer = setTimeout(tick, 1500); // 首次延后 1.5s，给用户打开微信扫码留出时间
    return () => { stopped = true; clearTimeout(timer); };
  }, [order.order_no, finishPaid]);

  // 倒计时归零时停止轮询提示
  useEffect(() => {
    if (seconds <= 0) setPolling(false);
  }, [seconds]);

  const handleCheck = useCallback(async () => {
    setQuerying(true);
    try {
      const r = await queryWechatPayOrder(order.order_no);
      if (r.status === "paid" || r.status === "SUCCESS") {
        finishPaid();
      } else {
        toast.error(t("sub.pay.notPaidYet"));
      }
    } catch {
      toast.error(t("sub.pay.queryFailed"));
    } finally {
      setQuerying(false);
    }
  }, [order.order_no, finishPaid]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-lift" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-md p-1 text-fg-muted hover:bg-surface-hover hover:text-fg">
          <X size={16} />
        </button>

        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-success-bg">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M8.5 11.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm7 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" fill="var(--wechat)"/>
              <path d="M12 2C6.48 2 2 5.92 2 10.67c0 2.87 1.69 5.42 4.27 7.07l-.94 2.83c-.1.3.22.57.5.4l3.33-1.95c.9.22 1.86.35 2.84.35 5.52 0 10-3.92 10-8.67S17.52 2 12 2z" fill="var(--wechat)"/>
            </svg>
          </div>
          <h3 className="font-display text-lg font-semibold text-fg">
            {payEnv === "wechat" ? t("sub.pay.envWechatTitle") : payEnv === "mobile" ? t("sub.pay.envMobileTitle") : t("sub.pay.scanTitle")}
          </h3>
          {title && <p className="mt-1 text-sm text-fg-muted">{title}</p>}
          <p className="mt-1 text-sm text-fg-muted">
            {t("sub.pay.scanPay")} <span className="font-semibold text-fg">¥{amount.toFixed(2)}</span>
          </p>
        </div>

        <div className={cn("relative mx-auto my-6 aspect-square overflow-hidden rounded-xl border border-border bg-card p-3", payEnv === "wechat" ? "w-64" : "w-56")}>
          <QRCodeCanvas ref={qrCanvasRef} value={order.code_url} size={200} className="h-full w-full" />
        </div>

        <p className="-mt-3 mb-3 text-center text-[11px] text-fg-muted">
          {payEnv === "wechat" ? t("sub.pay.envWechatHint") : payEnv === "mobile" ? t("sub.pay.envMobileHint") : t("sub.pay.saveHint")}
        </p>
        {payEnv === "pc" && (
          <Button className="mb-3 w-full" variant="outline" onClick={handleSaveQr}>
            <Save size={14} className="mr-1.5" />
            {t("sub.pay.saveQr")}
          </Button>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 text-sm">
            <Calendar size={14} className="text-fg-muted" />
            <span className="text-fg-muted">
              {t("sub.pay.remaining")} <span className={cn("font-data font-semibold", seconds < 60 ? "text-destructive" : "text-fg")}>
                {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
              </span>
            </span>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-xs text-fg-muted">
            {seconds <= 0 ? (
              <span className="text-destructive">{t("sub.pay.qrExpired")}</span>
            ) : polling ? (
              <>
                <Loader2 size={12} className="animate-spin text-primary" />
                {t("sub.pay.waiting")}
              </>
            ) : (
              <span>{t("sub.pay.manualCheckHint")}</span>
            )}
          </p>
          <Button className="w-full" variant="outline" onClick={handleCheck} disabled={querying || seconds <= 0}>
            {querying && <Loader2 size={14} className="mr-1.5 animate-spin" />}
            <Check size={14} className="mr-1.5 text-success" />
            {t("sub.pay.paidBtn")}
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
  const { t, lang } = useLanguage();
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
  const [selShopGroup, setSelShopGroup] = useState(0);
  const [selShopCount, setSelShopCount] = useState<number>(1);
  const [selShopPeriod, setSelShopPeriod] = useState<string>("month");
  const [payingShop, setPayingShop] = useState(false);
  const [licensePlatforms, setLicensePlatforms] = useState<LicensePlatformRow[]>([]);

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

    getLicensePlatforms()
      .then(setLicensePlatforms)
      .catch(() => setLicensePlatforms([])); // 查询失败回退内置分组

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

  // 动态购买组：license_platforms 全量启用平台（按 category 分组，全部开放购买）；
  // 表查询失败时回退内置 SHOP_PLATFORM_GROUPS（同样不再禁买）
  const shopGroups: ShopGroupOption[] = useMemo(() => {
    if (licensePlatforms.length > 0) {
      return licensePlatforms.map((p) => ({
        code: p.platform_code,
        label: p.name,
        platformCode: p.platform_code,
        basePrice: Number(p.base_price) || 0,
        category: p.category,
        open: true,
      }));
    }
    return SHOP_PLATFORM_GROUPS.map((g) => ({ ...g, category: "" }));
  }, [licensePlatforms]);
  const selGroupDef = shopGroups[selShopGroup] ?? shopGroups[0];
  const shopUnitPrice = selGroupDef ? estimateShopPrice(selGroupDef.basePrice, selShopCount, selShopPeriod) : 0;
  const shopPeriodCn = t({ month: "sub.period.month", quarter: "sub.period.quarter", half_year: "sub.period.halfYear", year: "sub.period.year" }[selShopPeriod] ?? selShopPeriod);

  /* ── 充值 ── */
  const handleRecharge = async (credits: number, amount: number) => {
    if (!user) { toast.error(t("sub.toast.loginRequired")); return; }
    setPayingCredits(credits);
    setPayingAmount(amount);
    const loadingId = toast.loading(t("sub.toast.creatingOrder"));
    try {
      const o = await createWechatPayOrder(amount, "native");
      toast.dismiss(loadingId);
      setOrder(o);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(e instanceof Error ? e.message : t("sub.toast.orderFailed"));
      setPayingCredits(null);
    }
  };

  /* ── VIP 订阅 ── */
  const handleSelectPlan = async (plan: SubscriptionPlan) => {
    if (!user) { toast.error(t("sub.toast.loginRequired")); return; }
    if (sub?.plan_id === plan.id) { toast.info(t("sub.toast.alreadyOnPlan")); return; }
    const amount = plan.price;
    setPayingPlanId(plan.id);
    setPayingAmount(amount);
    const loadingId = toast.loading(t("sub.toast.creatingOrder"));
    try {
      const o = await createWechatPayOrder(amount, "native", { planId: plan.id });
      toast.dismiss(loadingId);
      setOrder(o);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(e instanceof Error ? e.message : t("sub.toast.orderFailed"));
      setPayingPlanId(null);
    }
  };

  /* ── 店铺授权购买（独立链路，不绑定套餐）：platform_code + shop_count + period 服务端定档 ── */
  const handleBuyShop = async () => {
    if (!user) { toast.error(t("sub.toast.loginRequired")); return; }
    if (!shopUnitPrice || shopUnitPrice <= 0) { toast.error(t("sub.toast.tierUnavailable")); return; }
    setPayingAmount(shopUnitPrice);
    setPayingShop(true);
    const loadingId = toast.loading(t("sub.toast.creatingOrder"));
    try {
      if (!selGroupDef) { toast.error(t("sub.toast.tierUnavailable")); return; }
      const o = await createWechatPayOrder(shopUnitPrice, "native", {
        packageType: "shop_license",
        platformCode: selGroupDef.platformCode,
        shopCount: selShopCount,
        period: selShopPeriod,
      });
      toast.dismiss(loadingId);
      setOrder(o);
    } catch (e) {
      toast.dismiss(loadingId);
      toast.error(e instanceof Error ? e.message : t("sub.toast.orderFailed"));
    } finally {
      setPayingShop(false);
    }
  };

  const handlePaid = useCallback(() => {
    setOrder(null); setPayingCredits(null); setPayingPlanId(null); void loadAll();
  }, [loadAll]);

  /* ── 复制消耗明细 ── */
  const handleCopyUsage = () => {
    const lines = [
      `${t("sub.usage.exportTime")}：${new Date().toLocaleString("zh-CN")}`,
      t("sub.usage.totalCost", { n: totalCreditsAll }),
      "",
      t("sub.usage.csvHeader"),
      ...filteredUsage.map((u) =>
        `${new Date(u.created_at).toLocaleString("zh-CN")}, ${t(getTypeMeta(u.type).label)}, ${u.credits ?? u.cost ?? 0}, ${u.note ?? ""}`
      ),
    ].join("\n");
    navigator.clipboard.writeText(lines);
    toast.success(t("sub.toast.copied"));
  };

  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-8">
      <PageHeader
        title={t("subscription.title")}
        description={t("subscription.desc")}
      />

      {/* ═══ 1. Hero 状态区 ═══ */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-chart-4/5" />
        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-4">
            <div className={cn(
              "flex h-14 w-14 items-center justify-center rounded-xl",
              isVip ? "bg-primary/10" : "bg-surface-sunken",
            )}>
              {isVip
                ? <Crown size={24} className="text-primary" />
                : <Coins size={24} className="text-fg-muted" />
              }
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-base font-medium text-fg">
                  {user?.email ? t("sub.helloWithName", { name: user.email }) : t("sub.hello")}
                </h2>
                <Badge variant={isVip ? "default" : "outline"} className="text-[11px]">
                  {currentPlan ? dbPlanText(currentPlan.name, lang, t) : t("sub.state.loading")}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-fg-muted">
                {sub?.expires_at
                  ? <>{t("sub.planExpires")}<span className="font-medium text-fg">{new Date(sub.expires_at).toLocaleDateString("zh-CN")}</span></>
                  : t("sub.freeDesc")
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
              <Receipt size={14} className="mr-1.5" /> {t("sub.btn.openRecords")}
            </Button>
            {!isVip && (
              <Button size="sm" onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}>
                <TrendingUp size={14} className="mr-1.5" /> {t("sub.btn.upgrade")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ 2. 店铺授权额度（独立于套餐购买） ═══ */}
      <section id="shop-license">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <Store size={16} className="text-primary" /> {t("sub.shopLicense.title")}
            <span className="text-xs font-normal text-fg-muted">{t("sub.shopLicense.subtitle")}</span>
          </h3>
        </div>

        {/* 当前额度汇总 */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <Store size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-xs text-fg-muted">{t("sub.shopLicense.bindQuota")}</p>
              <p className="font-data text-lg font-bold text-fg">
                {shopQuota} <span className="text-xs font-normal text-fg-muted">{t("sub.unit.shops")}</span>
              </p>
              <p className="text-[11px] text-fg-muted">{t("sub.shopLicense.freeIncluded", { n: FREE_SHOP_LIMIT })}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-4/10">
              <ShieldCheck size={18} className="text-chart-4" />
            </div>
            <div>
              <p className="text-xs text-fg-muted">{t("sub.shopLicense.bound")}</p>
              <p className="font-data text-lg font-bold text-fg">
                {boundShops} <span className="text-xs font-normal text-fg-muted">{t("sub.unit.shops")}</span>
              </p>
              <p className="text-[11px] text-fg-muted">
                {boundShops >= shopQuota ? t("sub.shopLicense.quotaFull") : t("sub.shopLicense.canBindMore", { n: Math.max(shopQuota - boundShops, 0) })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-chart-2/10">
              <BadgeCheck size={18} className="text-chart-2" />
            </div>
            <div>
              <p className="text-xs text-fg-muted">{t("sub.shopLicense.records")}</p>
              <p className="font-data text-lg font-bold text-fg">
                {activeLicenses.length} <span className="text-xs font-normal text-fg-muted">{t("sub.unit.records")}</span>
              </p>
              <p className="text-[11px] text-fg-muted">{t("sub.shopLicense.totalLicensed", { n: purchasedCount })}</p>
            </div>
          </div>
        </div>

        {/* 按店铺订购（妙手式三步：平台组 → 店铺数 → 周期） */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-soft">
          <p className="mb-4 text-xs text-fg-muted">
            {t("sub.shopLicense.intro")}
          </p>
          <ShopTierPicker
            groups={shopGroups}
            selGroup={selShopGroup}
            selCount={selShopCount}
            selPeriod={selShopPeriod}
            onGroup={setSelShopGroup}
            onCount={setSelShopCount}
            onPeriod={setSelShopPeriod}
          />
          <div className="mt-4 flex justify-end">
            <Button onClick={handleBuyShop} disabled={payingShop || shopUnitPrice <= 0} size="lg" className="min-w-36">
              {payingShop ? <Loader2 size={16} className="mr-1.5 animate-spin" /> : <Store size={16} className="mr-1.5" />}
              {t("sub.shopLicense.buyNow")}
              <ChevronRight size={14} className="ml-1" />
            </Button>
          </div>

          {/* 速卖通引导 */}
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-dashed border-border bg-card/60 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-sunken">
                <ExternalLink size={18} className="text-fg-muted" />
              </div>
              <div>
                <p className="text-sm font-medium text-fg">{t("sub.shopLicense.aliTitle")}</p>
                <p className="text-xs text-fg-muted">{t("sub.shopLicense.aliDesc")}</p>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0">{t("sub.shopLicense.aliBadge")}</Badge>
          </div>
        </div>

        {/* 授权记录 */}
        <div className="mt-4">
          {licenses.length === 0 ? (
            <div className="flex h-16 items-center justify-center rounded-xl border border-dashed border-border text-xs text-fg-muted">
              {t("sub.shopLicense.empty", { n: FREE_SHOP_LIMIT })}
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              {licenses.map((l, idx) => {
                const expired = l.expires_at && new Date(l.expires_at).getTime() < nowTs;
                return (
                  <div key={l.id} className={cn("flex items-center justify-between gap-3 px-4 py-3", idx > 0 && "border-t border-border/70")}>
                    <div className="flex items-center gap-3">
                      <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", expired ? "bg-surface-sunken" : "bg-success-bg")}>
                        <Store size={16} className={expired ? "text-fg-muted" : "text-success"} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-fg">
                          {t("sub.shopLicense.licensedN", { n: l.shop_count })}
                          <span className="ml-2 text-xs font-normal text-fg-muted">{l.plan_code}</span>
                        </p>
                        <p className="text-[11px] text-fg-muted">
                          {t("sub.shopLicense.paidAmount", { amount: Number(l.amount ?? 0).toFixed(2), period: l.period })}
                          {l.expires_at && <> · {expired ? t("sub.shopLicense.expiredShort") : t("sub.shopLicense.validUntil", { date: new Date(l.expires_at).toLocaleDateString("zh-CN") })}</>}
                        </p>
                      </div>
                    </div>
                    <Badge variant={expired ? "outline" : "default"} className={cn("shrink-0", expired && "text-fg-muted")}>
                      {expired ? t("sub.badge.expired") : t("sub.badge.active")}
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
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-fg">
          <Crown size={16} className="text-chart-4" /> {t("sub.vip.title")}
        </h3>
        {loadingPlans ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
          </div>
        ) : plans.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-fg-muted">
            {t("sub.vip.empty")}
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
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-fg">
          <CreditCard size={16} className="text-success" /> {t("sub.recharge.title")}
          <span className="text-xs font-normal text-fg-muted">{t("sub.recharge.subtitle")}</span>
        </h3>

        {benefits.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-success/30 bg-success-bg px-4 py-3 text-sm text-success">
            <Gift size={15} className="shrink-0" />
            {benefits.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1">
                {b.benefit_key === "title_free" && <>{t("sub.benefit.titleFree", { date: new Date(b.expires_at).toLocaleDateString("zh-CN") })}</>}
                {b.benefit_key !== "title_free" && <>{t("sub.benefit.generic", { key: b.benefit_key, date: new Date(b.expires_at).toLocaleDateString("zh-CN") })}</>}
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
                "relative flex flex-col items-center rounded-xl border border-border bg-card p-4 text-center transition-all hover:border-primary/40 hover:shadow-lift",
                payingCredits === opt.credits && "opacity-60",
                opt.tag && "border-primary/30",
              )}
            >
              {opt.tag && (
                <span className="absolute -top-2 right-3 rounded-full bg-success px-2 py-0.5 text-[10px] font-semibold text-white">
                  {t(opt.tag)}
                </span>
              )}
              <span className="font-data text-2xl font-bold text-fg">{opt.credits.toLocaleString()}</span>
              <span className="text-xs text-fg-muted">{t("sub.recharge.creditsUnit")}</span>
              <span className="mt-2 font-data text-lg font-semibold text-primary">¥{opt.amount}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          {t("sub.recharge.note")}
        </p>
        {/* 支付前显著提示：虚拟商品退款规则 */}
        <p className="mt-1.5 text-xs text-fg-muted">
          {t("sub.refund.agree")}
          <a href="/refund" target="_blank" rel="noreferrer" className="text-primary hover:underline">{t("sub.refund.link")}</a>
          {t("sub.refund.suffix")}
        </p>
      </section>

      {/* ═══ 5. 积分总览 ═══ */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-fg">
          <Zap size={16} className="text-primary" /> {t("sub.quota.title")}
        </h3>
        {loadingSub ? (
          <div className="flex h-40 items-center justify-center rounded-xl border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <QuotaRing
              value={pools?.workbench.total ?? 0}
              max={Math.max(pools?.workbench.total ?? 0, 1)}
              label={t("sub.quota.workbench")}
              icon={Zap}
              color="text-primary"
              unit={t("sub.quota.unit")}
              footnote={t("sub.quota.todayFree", { free: pools?.workbench.freeToday ?? 0, purchased: pools?.workbench.purchased ?? 0 })}
            />
            <QuotaRing
              value={pools?.agent.total ?? 0}
              max={Math.max(pools?.agent.total ?? 0, 1)}
              label={t("sub.quota.agent")}
              icon={BrainCircuit}
              color="text-chart-4"
              unit={t("sub.quota.unit")}
              footnote={t("sub.quota.todayFree", { free: pools?.agent.freeToday ?? 0, purchased: pools?.agent.purchased ?? 0 })}
            />
            <QuotaRing
              value={usage30d}
              max={Math.max(usage30d, 1)}
              label={t("sub.quota.used30d")}
              icon={Coins}
              color="text-warning"
              unit={t("sub.quota.unit")}
            />
          </div>
        )}
      </section>

      {/* ═══ 6. 消耗明细 ═══ */}
      <section id="usage-section" className="scroll-mt-28">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <TrendingUp size={16} className="text-chart-2" /> {t("sub.usage.title")}
            <span className="text-xs font-normal text-fg-muted">{t("sub.usage.subtitle", { n: filteredUsage.length })}</span>
          </h3>
          <div className="flex items-center gap-2">
            {/* 类型筛选 */}
            <div className="flex rounded-xl bg-surface-sunken p-0.5 text-xs">
              {[
                { key: "all", label: t("sub.usage.filter.all") },
                { key: "chat", label: t("sub.usage.filter.chat") },
                { key: "copy", label: t("sub.usage.filter.copy") },
                { key: "image-gen", label: t("sub.usage.filter.image") },
                { key: "vision", label: t("sub.usage.filter.vision") },
              ].map((f) => (
                <button
                  key={f.key}
                  onClick={() => setUsageFilter(f.key)}
                  className={cn(
                    "rounded-md px-2.5 py-1 transition-colors",
                    usageFilter === f.key ? "bg-card text-fg shadow-soft font-medium" : "text-fg-muted",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={handleCopyUsage} disabled={filteredUsage.length === 0}>
              <Copy size={13} className="mr-1" /> {t("sub.usage.copyBtn")}
            </Button>
          </div>
        </div>

        {loadingUsage ? (
          <div className="flex h-32 items-center justify-center rounded-xl border border-border bg-card">
            <Loader2 className="h-5 w-5 animate-spin text-fg-muted" />
          </div>
        ) : filteredUsage.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card py-12 text-center">
            <FileText size={24} className="text-fg-muted" />
            <p className="text-sm text-fg-muted">{t("sub.usage.empty")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-sunken text-left text-xs text-fg-muted">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.usage.col.time")}</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.usage.col.type")}</th>
                  <th className="px-4 py-3 text-right font-medium whitespace-nowrap">{t("sub.usage.col.credits")}</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.usage.col.note")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsage.map((u) => {
                  const meta = getTypeMeta(u.type);
                  const Icon = meta.icon;
                  return (
                    <tr key={u.id} className="border-b border-border transition-colors last:border-0 hover:bg-surface-hover">
                      <td className="px-4 py-3 font-data text-fg-muted align-middle whitespace-nowrap">
                        {new Date(u.created_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <span className="inline-flex items-center gap-1.5">
                          <Icon size={14} className={meta.color} />
                          <span className="text-fg">{t(meta.label)}</span>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-data font-medium text-destructive align-middle whitespace-nowrap">
                        -{u.credits ?? u.cost ?? 0}
                      </td>
                      <td className="px-4 py-3 text-fg-muted align-middle">{u.note ?? "—"}</td>
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
          title={payingPlanId ? (currentPlan ? t("sub.payTitle.vip", { name: dbPlanText(currentPlan.name, lang, t) }) : undefined) : payingCredits !== null ? undefined : t("sub.payTitle.shop", { group: selGroupDef ? platformLabel(selGroupDef.label, selGroupDef.code, lang, t) : "", n: selShopCount, period: shopPeriodCn })}
          onClose={() => { setOrder(null); setPayingCredits(null); setPayingPlanId(null); }}
          onPaid={handlePaid}
        />
      )}
    </div>
  );
}
