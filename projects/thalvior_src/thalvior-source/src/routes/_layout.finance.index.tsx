import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ReceiptText, CalendarDays, Hash, Coins } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTable, type DataTableColumn, useTableDensity } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext"
import { fmtDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/_layout/finance/")({
  component: Finance,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PayRow = any;

function payType(r: PayRow): "credits" | "license" | "subscription" | "other" {
  if (Number(r.credits_granted ?? 0) > 0) return "credits";
  if (r.platform_code || Number(r.license_shop_count ?? 0) > 0 || r.period_months) return "license";
  if (r.plan_id) return "subscription";
  return "other";
}

function Finance() {
  const {  t , lang } = useLanguage();
  const [rows, setRows] = useState<PayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 第 2 批：行密度（纯展示偏好，按页持久化）
  const [density, setDensity] = useTableDensity("thv.density.finance");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        // 真实支付流水：只取已支付订单，RLS 自动过滤（用户只见自己的，admin 可见全部）
        const { data, error: e } = await (supabase as any)
          .from("payment_orders")
          .select("*")
          .eq("status", "paid")
          .order("paid_at", { ascending: false });
        if (e) throw new Error(e.message);
        if (alive) setRows(data ?? []);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : t("common.loadFailed"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [t]);

  const stats = useMemo(() => {
    const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthTotal = rows
      .filter((r) => {
        const d = r.paid_at || r.created_at;
        return typeof d === "string" && d.startsWith(monthPrefix);
      })
      .reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const creditsCount = rows.filter((r) => payType(r) === "credits").length;
    return { total, monthTotal, count: rows.length, creditsCount };
  }, [rows]);

  const fmtMoney = (n: number) =>
    `¥${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtTime = (v: unknown) => {
    if (!v) return "—";
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? String(v) : fmtDateTime(d, lang);
  };

  const typeLabel = (r: PayRow) => {
    const tp = payType(r);
    if (tp === "credits") return t("fin.pay.type.credits");
    if (tp === "license") return t("fin.pay.type.license");
    if (tp === "subscription") return t("fin.pay.type.subscription");
    return t("fin.pay.type.other");
  };

  // 第 2 批：通用数据表列定义（渲染层；取值与含义与原表一致）
  const payColumns: DataTableColumn<PayRow>[] = [
    { key: "order_no", header: t("fin.pay.colNo"), render: (r) => <span className="font-mono text-xs font-medium">{String(r.order_no ?? "")}</span> },
    {
      key: "type", header: t("fin.pay.colType"),
      render: (r) => (
        <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium border-info/30 bg-info-bg text-info">
          {typeLabel(r)}
        </span>
      ),
    },
    { key: "amount", header: t("fin.pay.colAmount"), align: "right", render: (r) => <span className="font-semibold">{fmtMoney(Number(r.amount) || 0)}</span> },
    { key: "time", header: t("fin.pay.colTime"), render: (r) => <span className="text-muted-foreground">{fmtTime(r.paid_at || r.created_at)}</span> },
    {
      key: "status", header: t("fin.pay.colStatus"),
      render: () => (
        <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium border-success/30 bg-success-bg text-success">
          {t("fin.pay.status.paid")}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("fin.pay.title")} description={t("fin.pay.desc")} />

      {/* 统计卡：全部来自真实支付流水 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label={t("fin.pay.stat.total")} value={fmtMoney(stats.total)} icon={<ReceiptText size={17} />} tone="primary" />
        <StatCard label={t("fin.pay.stat.month")} value={fmtMoney(stats.monthTotal)} icon={<CalendarDays size={17} />} tone="violet" />
        <StatCard label={t("fin.pay.stat.count")} value={String(stats.count)} icon={<Hash size={17} />} tone="success" />
        <StatCard label={t("fin.pay.stat.credits")} value={String(stats.creditsCount)} icon={<Coins size={17} />} tone="warning" />
      </div>

      {/* 工具栏（第 2 批：通用筛选栏容器；本页无筛选逻辑，仅承载计数） */}
      <FilterBar meta={t("products.total", { count: rows.length })} />

      {/* 支付流水表（第 2 批：通用数据表容器） */}
      <DataTable
        columns={payColumns}
        rows={rows}
        rowKey={(r) => String(r.id)}
        loading={loading}
        error={error || null}
        emptyState={<EmptyState text={t("fin.pay.empty")} />}
        showEmptyState={rows.length === 0}
        density={density}
        onDensityChange={setDensity}
        densityLabels={{ compact: t("tbl.densityCompact"), cozy: t("tbl.densityCozy") }}
      />
    </div>
  );
}
