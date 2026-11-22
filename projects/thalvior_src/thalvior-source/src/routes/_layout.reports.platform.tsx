import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";
import { DollarSign, TrendingUp, BarChart3, Activity } from "lucide-react";
import { tt } from "@/i18n/tts";
import { CHART_CATEGORICAL as PIE_COLORS } from "@/components/chart-theme";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_layout/reports/platform")({
  component: ReportsPlatformPage,
});


const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsPlatformPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTable("shops")
      .then(setRows)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const platforms = new Set(rows.map((r) => String(r.platform ?? tt('stockSync.st.unknown')))).size;
    const sales = rows.reduce((s, r) => s + Number(r.today_sales ?? 0), 0);
    const orders = rows.reduce((s, r) => s + (Number(r.today_orders) || 0), 0);
    return { platforms, count: rows.length, sales: r2(sales), orders };
  }, [rows]);

  const byPlatform = useMemo(() => {
    const m = new Map<string, { name: string; shops: number; sales: number; orders: number }>();
    rows.forEach((r) => {
      const k = String(r.platform ?? tt('stockSync.st.unknown'));
      const cur = m.get(k) ?? { name: k, shops: 0, sales: 0, orders: 0 };
      cur.shops += 1;
      cur.sales += Number(r.today_sales ?? 0);
      cur.orders += Number(r.today_orders) || 0;
      m.set(k, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, sales: r2(v.sales) })).sort((a, b) => b.sales - a.sales);
  }, [rows]);


  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.reports.platform')} description={tt('rpt.platformDesc')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={tt('rpt.platformCount')} value={String(totals.platforms)} icon={<BarChart3 size={18} />} />
        <StatCard label={tt('rpt.shopTotal')} value={String(totals.count)} icon={<Activity size={18} />} />
        <StatCard label={tt('rpt.todaySalesTotal')} value={totals.sales.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label={tt('rpt.todayOrdersTotal')} value={String(totals.orders)} icon={<TrendingUp size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.platformCompare')}</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byPlatform}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="shops" name={tt('rpt.shopCount')} fill="var(--chart-cat-5)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sales" name={tt('rpt.todaySales')} fill="var(--chart-cat-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="orders" name={tt('rpt.todayOrders')} fill="var(--chart-cat-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.platformSalesShare')}</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={byPlatform} dataKey="sales" nameKey="name" outerRadius={100} label>
                {byPlatform.map((_, i) => (
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
          {t("rpt.empty.platform")}
        </div>
      )}
    </div>
  );
}
