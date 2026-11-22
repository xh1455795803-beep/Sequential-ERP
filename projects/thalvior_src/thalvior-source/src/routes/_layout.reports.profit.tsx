import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";
import { DollarSign, TrendingUp, BarChart3, Activity, Wallet } from "lucide-react";
import { tt } from "@/i18n/tts";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_layout/reports/profit")({
  component: ReportsProfitPage,
});


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
      const k = String(r.channel ?? tt('stockSync.st.unknown'));
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
      const k = String(r.product ?? tt('stockSync.st.unknown'));
      const cur = m.get(k) ?? { name: k, profit: 0, revenue: 0 };
      cur.profit += Number(r.profit ?? 0);
      cur.revenue += Number(r.revenue ?? 0);
      m.set(k, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, profit: r2(v.profit), revenue: r2(v.revenue) })).sort((a, b) => b.profit - a.profit).slice(0, 10);
  }, [rows]);


  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.reports.profit')} description={tt('rpt.profitDesc')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={tt('fin.pay.stat.total')} value={totals.revenue.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label={tt('rpt.totalProfit')} value={totals.profit.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<TrendingUp size={18} />} />
        <StatCard label={tt('rpt.threeFees')} value={totals.fees.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<Wallet size={18} />} />
        <StatCard label={tt('tools.profit.margin')} value={`${totals.margin.toFixed(2)}%`} icon={<BarChart3 size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.channelProfit')}</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byChannel}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="revenue" name={tt('profit.chart.revenue')} fill="var(--chart-cat-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name={tt('tools.profit.profit')} fill="var(--chart-cat-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.productProfit')}Top10</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byProduct}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="profit" name={tt('tools.profit.profit')} fill="var(--chart-cat-6)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      </div>

      {loading && <div className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>}
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {t("rpt.empty.profit")}
        </div>
      )}
    </div>
  );
}
