import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";
import { DollarSign, TrendingUp, BarChart3, Activity } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_layout/reports/purchase")({
  component: ReportsPurchasePage,
});

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#0ea5e9"];
const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsPurchasePage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTable("purchase_orders")
      .then(setRows)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const amount = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const skus = new Set(rows.map((r) => String(r.sku ?? ""))).size;
    const suppliers = new Set(rows.map((r) => String(r.supplier_id ?? ""))).size;
    return { count: rows.length, amount: r2(amount), skus, suppliers };
  }, [rows]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const k = String(r.status ?? "未知");
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [rows]);

  const bySku = useMemo(() => {
    const m = new Map<string, { name: string; amount: number; qty: number }>();
    rows.forEach((r) => {
      const k = String(r.name || r.sku || "未知");
      const cur = m.get(k) ?? { name: k, amount: 0, qty: 0 };
      cur.amount += Number(r.amount ?? 0);
      cur.qty += Number(r.qty) || 0;
      m.set(k, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, amount: r2(v.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 10);
  }, [rows]);


  return (
    <div className="space-y-5">
      <PageHeader title="采购分析" description="采购金额与供应商维度聚合（数据源：purchase_orders）" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="采购单数" value={String(totals.count)} icon={<BarChart3 size={18} />} />
        <StatCard label="采购总金额" value={totals.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label="涉及 SKU" value={String(totals.skus)} icon={<Activity size={18} />} />
        <StatCard label="供应商数" value={String(totals.suppliers)} icon={<TrendingUp size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">SKU 采购金额 Top10</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bySku}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="amount" name="采购金额" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">采购单状态分布</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={byStatus} dataKey="value" nameKey="name" outerRadius={100} label>
                {byStatus.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>

      {loading && <div className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>}
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          暂无采购单数据。创建采购单后可查看分析。
        </div>
      )}
    </div>
  );
}
