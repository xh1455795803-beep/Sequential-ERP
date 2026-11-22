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

export const Route = createFileRoute("/_layout/reports/orders")({
  component: ReportsOrdersPage,
});


const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsOrdersPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTable("orders")
      .then(setRows)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const amount = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const channels = new Set(rows.map((r) => String(r.channel ?? tt('stockSync.st.unknown')))).size;
    const avg = rows.length > 0 ? amount / rows.length : 0;
    return { count: rows.length, amount: r2(amount), channels, avg: r2(avg) };
  }, [rows]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const k = String(r.status ?? tt('stockSync.st.unknown'));
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [rows]);

  const byChannel = useMemo(() => {
    const m = new Map<string, { name: string; amount: number; count: number }>();
    rows.forEach((r) => {
      const k = String(r.channel ?? tt('stockSync.st.unknown'));
      const cur = m.get(k) ?? { name: k, amount: 0, count: 0 };
      cur.amount += Number(r.amount ?? 0);
      cur.count += 1;
      m.set(k, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, amount: r2(v.amount) })).sort((a, b) => b.amount - a.amount);
  }, [rows]);


  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.reports.orders')} description={tt('rpt.ordersDesc')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={tt('rpt.orderTotal')} value={totals.count.toLocaleString()} icon={<BarChart3 size={18} />} />
        <StatCard label={tt('exc.totalAmount')} value={totals.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label={tt('rpt.aov')} value={totals.avg.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<Activity size={18} />} />
        <StatCard label={tt('rpt.channelCount')} value={String(totals.channels)} icon={<TrendingUp size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.channelAmtOrders')}</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byChannel}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="amount" name={tt('orders.col.amount')} fill="var(--chart-cat-1)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="count" name={tt('common.orderCount')} fill="var(--chart-cat-2)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.orderStatusDist')}</h3>
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
          {t("rpt.empty.orders")}
        </div>
      )}
    </div>
  );
}
