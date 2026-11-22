/**
 * /subscription/bills — 账单中心
 *
 * 内容：
 * 1. 统计卡：当前余额 / 累计充值 / 近 30 天消耗 / 累计消耗
 * 2. 充值记录：quota_recharges 流水（时间 / 金额 / 方式）
 * 3. 支付订单：payment_orders（订单号 / 类型 / 金额 / 状态 / 时间）
 * 4. 消耗明细：ai_usage_logs（时间 / 类型 / 消耗 / 备注），可按类型筛选 + 复制导出
 */
import { createFileRoute } from "@tanstack/react-router";
import {
  Zap, Sparkles, Coins, Copy, Loader2, BrainCircuit,
  FileText, Image as ImageIcon, CreditCard, ReceiptText,
  Wallet, TrendingUp, ShoppingCart,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageHeader, StatCard } from "@/components/page-header";
import {
  getQuotaBalance,
  getRecharges,
  getUsageLogs,
} from "@/services/aiService";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/subscription/bills")({
  component: SubscriptionBills,
});

/* ───────── 额度消耗类型图标映射 ─────────
   ai_usage_logs 无 type 字段，按 service_key / service_name 识别 */
const TYPE_PATTERNS: { re: RegExp; icon: typeof Sparkles; color: string; label: string }[] = [
  { re: /chat|conversation|对话/i, icon: Sparkles,   color: "text-primary",     label: "sub.usage.type.chat" },
  { re: /vision|understand|理解/i, icon: FileText,   color: "text-success",     label: "sub.usage.type.vision" },
  { re: /copy|writing|文案/i,      icon: Copy,       color: "text-chart-2",     label: "sub.usage.type.copy" },
  { re: /image|pic|图片/i,         icon: ImageIcon,  color: "text-chart-4",     label: "sub.usage.type.imageGen" },
  { re: /video|视频/i,             icon: TrendingUp, color: "text-chart-3",     label: "sub.usage.type.videoGen" },
];

function getTypeMeta(u: any) {
  const key = String(u.service_key ?? u.type ?? "");
  const hit = TYPE_PATTERNS.find((m) => m.re.test(key));
  const label = u.service_name || hit?.label || key || "sub.bills.typeOther";
  return { icon: hit?.icon ?? BrainCircuit, color: hit?.color ?? "text-muted-foreground", label };
}

/* ───────── 支付订单状态映射 ───────── */
const ORDER_STATUS_META: Record<string, { label: string; cls: string }> = {
  pending:  { label: "sub.bills.status.pending", cls: "bg-warning-bg text-warning" },
  paid:     { label: "sub.bills.status.paid", cls: "bg-success-bg text-success" },
  closed:   { label: "sub.bills.status.closed", cls: "bg-muted text-muted-foreground" },
  failed:   { label: "sub.bills.status.failed", cls: "bg-danger-bg text-destructive" },
};

function getOrderStatusMeta(s: string) {
  return ORDER_STATUS_META[s] ?? { label: s, cls: "bg-muted text-muted-foreground" };
}

/* ───────── 格式化 ───────── */
function fmtTime(ts?: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN");
}

/* ═══════════════════════════════════════════════════════════
   主页面
   ═══════════════════════════════════════════════════════════ */
function SubscriptionBills() {
  const { t } = useLanguage();

  /* ── 状态 ── */
  const [balance, setBalance] = useState<number>(0);
  const [recharges, setRecharges] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [usageFilter, setUsageFilter] = useState<string>("all");

  const [loading, setLoading] = useState(true);

  /* ── 加载 ── */
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [bal, rec, logs, sess] = await Promise.all([
        getQuotaBalance().catch(() => 0),
        getRecharges(100).catch(() => []),
        getUsageLogs(100).catch(() => []),
        supabase.auth.getSession(),
      ]);
      setBalance(bal);
      setRecharges(rec);
      setUsage(logs);

      // 支付订单（套餐订阅 / 积分充值）
      const userId = sess?.data?.session?.user?.id;
      if (userId) {
        const { data: ord } = await supabase
          .from("payment_orders")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100);
        setOrders(ord ?? []);
      } else {
        setOrders([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadAll(); }, [loadAll]);

  /* ── 计算 ── */
  const totalRecharge = recharges.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  const totalCreditsAll = usage.reduce((s, u) => s + (u.credits ?? u.cost ?? 0), 0);
  const now30d = Date.now() - 30 * 24 * 3600 * 1000;
  const usage30d = usage.reduce((s, u) => {
    const ts = u.created_at ? new Date(u.created_at).getTime() : 0;
    return s + (ts >= now30d ? (u.credits ?? u.cost ?? 0) : 0);
  }, 0);
  const pendingOrders = orders.filter((o) => o.status === "pending").length;

  const filteredUsage = usageFilter === "all" ? usage : usage.filter((u) => u.type === usageFilter);

  /* ── 复制消耗明细 ── */
  const handleCopyUsage = () => {
    const lines = [
      `${t("sub.usage.exportTime")}：${new Date().toLocaleString("zh-CN")}`,
      t("sub.usage.totalCost", { n: totalCreditsAll }),
      "",
      t("sub.usage.csvHeader"),
      ...filteredUsage.map((u) =>
        `${fmtTime(u.created_at)}, ${t(getTypeMeta(u).label)}, ${u.credits ?? u.cost ?? 0}, ${u.note ?? ""}`
      ),
    ].join("\n");
    navigator.clipboard.writeText(lines);
    toast.success(t("sub.toast.copied"));
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-fg-muted" />
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-8">
      <PageHeader
        title={t("subscription.bills.title")}
        description={t("subscription.bills.desc")}
      />

      {/* ═══ 1. 统计卡 ═══ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("sub.bills.balance")}
          value={t("sub.bills.balanceValue", { n: balance.toLocaleString() })}
          icon={<Wallet size={17} />}
          tone="primary"
        />
        <StatCard
          label={t("sub.bills.totalRecharge")}
          value={`¥${totalRecharge.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          icon={<CreditCard size={17} />}
          tone="success"
        />
        <StatCard
          label={t("sub.quota.used30d")}
          value={t("sub.bills.balanceValue", { n: usage30d.toLocaleString() })}
          icon={<TrendingUp size={17} />}
          tone="warning"
        />
        <StatCard
          label={t("sub.bills.pendingOrders")}
          value={String(pendingOrders)}
          icon={<ShoppingCart size={17} />}
          tone="violet"
        />
      </div>

      {/* ═══ 2. 支付订单 ═══ */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-fg">
          <ReceiptText size={16} className="text-chart-4" /> {t("sub.bills.ordersTitle")}
          <span className="text-xs font-normal text-fg-muted">{t("sub.bills.ordersCount", { n: orders.length })}</span>
        </h3>
        {orders.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card py-12 text-center">
            <ReceiptText size={24} className="text-fg-muted" />
            <p className="text-sm text-fg-muted">{t("sub.bills.ordersEmpty")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-sunken text-left text-xs text-fg-muted">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.bills.col.orderNo")}</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.usage.col.type")}</th>
                  <th className="px-4 py-3 text-right font-medium whitespace-nowrap">{t("sub.bills.col.amount")}</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.bills.col.status")}</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.bills.col.createdAt")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const st = getOrderStatusMeta(o.status);
                  const isPlan = Boolean(o.plan_id);
                  return (
                    <tr key={o.id} className="border-b border-border transition-colors last:border-0 hover:bg-surface-hover">
                      <td className="px-4 py-3 font-data text-fg-muted align-middle whitespace-nowrap">{o.order_no}</td>
                      <td className="px-4 py-3 align-middle">
                        <Badge variant="outline" className="text-[11px]">
                          {isPlan ? t("sub.bills.typePlan") : t("sub.bills.typeRecharge")}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-data font-semibold text-fg align-middle whitespace-nowrap">¥{Number(o.amount).toFixed(2)}</td>
                      <td className="px-4 py-3 align-middle">
                        <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", st.cls)}>
                          {t(st.label)}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-data text-fg-muted align-middle whitespace-nowrap">{fmtTime(o.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══ 3. 充值记录 ═══ */}
      <section>
        <h3 className="mb-4 flex items-center gap-2 font-display text-base font-semibold text-fg">
          <CreditCard size={16} className="text-success" /> {t("sub.bills.rechargeTitle")}
          <span className="text-xs font-normal text-fg-muted">{t("sub.bills.rechargeCount", { n: recharges.length, total: totalRecharge.toLocaleString(undefined, { maximumFractionDigits: 2 }) })}</span>
        </h3>
        {recharges.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card py-12 text-center">
            <CreditCard size={24} className="text-fg-muted" />
            <p className="text-sm text-fg-muted">{t("sub.bills.rechargeEmpty")}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-sunken text-left text-xs text-fg-muted">
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.usage.col.time")}</th>
                  <th className="px-4 py-3 text-right font-medium whitespace-nowrap">{t("sub.bills.col.amount")}</th>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">{t("sub.bills.col.method")}</th>
                </tr>
              </thead>
              <tbody>
                {recharges.map((r) => (
                  <tr key={r.id} className="border-b border-border transition-colors last:border-0 hover:bg-surface-hover">
                    <td className="px-4 py-3 font-data text-fg-muted align-middle whitespace-nowrap">{fmtTime(r.created_at)}</td>
                    <td className="px-4 py-3 text-right font-data font-semibold text-success align-middle whitespace-nowrap">+¥{Number(r.amount).toFixed(2)}</td>
                    <td className="px-4 py-3 align-middle">
                      <Badge variant="outline" className="text-[11px]">{r.method ? t(r.method) : t("sub.bills.mockPay")}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ═══ 4. 消耗明细 ═══ */}
      <section id="usage-section" className="scroll-mt-28">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <TrendingUp size={16} className="text-chart-2" /> {t("sub.usage.title")}
            <span className="text-xs font-normal text-fg-muted">{t("sub.bills.usageSubtitle", { n: filteredUsage.length, total: totalCreditsAll.toLocaleString() })}</span>
          </h3>
          <div className="flex items-center gap-2">
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

        {filteredUsage.length === 0 ? (
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
                  const meta = getTypeMeta(u);
                  const Icon = meta.icon;
                  return (
                    <tr key={u.id} className="border-b border-border transition-colors last:border-0 hover:bg-surface-hover">
                      <td className="px-4 py-3 font-data text-fg-muted align-middle whitespace-nowrap">{fmtTime(u.created_at)}</td>
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
    </div>
  );
}
