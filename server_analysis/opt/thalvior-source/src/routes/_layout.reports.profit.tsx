import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";
import { DollarSign, TrendingUp, BarChart3, Activity, Wallet } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_layout/reports/profit")({
  component: ReportsProfitPage,
});

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#0ea5e9"];
const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsProfitPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTable("profit_records")
      .then(setRows)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
    const profit = rows.reduce((s, r) => s + Number(r.profit ?? 0), 0);
    const fees = rows.reduce((s, r) => s + Number(r.shipping ?? 0) + Number(r.platform_fee ?? 0) + Number(r.ad_fee ?? 0), 0);
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { revenue: r2(revenue), profit: r2(profit), fees: r2(fees), margin: r2(margin) };
  }, [rows]);

  const byChannel = useMemo(() => {
    const m = new Map<string, { name: string; revenue: number; profit: number }>();
    rows.forEach((r) => {
      const k = String(r.channel ?? "未知");
      const cur = m.get(k) ?? { name: k, revenue: 0, profit: 0 };
      cur.revenue += Number(r.revenue ?? 0);
      cur.profit += Number(r.profit ?? 0);
      m.set(k, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, revenue: r2(v.revenue), profit: r2(v.profit) })).sort((a, b) => b.profit - a.profit);
  }, [rows]);

  const byProduct = useMemo(() => {
    const m = new Map<string, { name: string; profit: number; revenue: number }>();
    rows.forEach((r) => {
      const k = String(r.product ?? "未知");
      const cur = m.get(k) ?? { name: k, profit: 0, revenue: 0 };
      cur.profit += Number(r.profit ?? 0);
      cur.revenue += Number(r.revenue ?? 0);
      m.set(k, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, profit: r2(v.profit), revenue: r2(v.revenue) })).sort((a, b) => b.profit - a.profit).slice(0, 10);
  }, [rows]);


  return (
    <div className="space-y-5">
      <PageHeader title="利润报表" description="渠道与商品维度利润排行（数据源：profit_records）" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="总收入" value={totals.revenue.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label="总利润" value={totals.profit.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<TrendingUp size={18} />} />
        <StatCard label="三项费用合计" value={totals.fees.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<Wallet size={18} />} />
        <StatCard label="利润率" value={`${totals.margin.toFixed(2)}%`} icon={<BarChart3 size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">渠道收入与利润</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byChannel}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="revenue" name="收入" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name="利润" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">商品利润 Top10</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byProduct}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="profit" name="利润" fill="#14b8a6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>

      {loading && <div className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>}
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          暂无利润记录数据。产生利润记录后可查看分析。
        </div>
      )}
    </div>
  );
}
