import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";
import { DollarSign, TrendingUp, BarChart3, Wallet } from "lucide-react";
import { tt } from "@/i18n/tts";
import { CHART_CATEGORICAL as PIE_COLORS } from "@/components/chart-theme";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_layout/reports/finance")({
  component: ReportsFinancePage,
});


const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsFinancePage() {
  const { t } = useLanguage();
  const [income, setIncome] = useState<ExtRow[]>([]);
  const [costs, setCosts] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchTable("income_records"), fetchTable("cost_records")])
      .then(([a, b]) => { setIncome(a); setCosts(b); })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const inc = income.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const cost = costs.reduce((s, r) => s + Number(r.amount ?? 0), 0);
    const incCount = income.length + costs.length;
    return { inc: r2(inc), cost: r2(cost), net: r2(inc - cost), count: incCount };
  }, [income, costs]);

  const byPlatform = useMemo(() => {
    const m = new Map<string, number>();
    income.forEach((r) => {
      const k = String(r.platform ?? tt('stockSync.st.unknown'));
      m.set(k, (m.get(k) ?? 0) + Number(r.amount ?? 0));
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value: r2(value) })).sort((a, b) => b.value - a.value);
  }, [income]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    costs.forEach((r) => {
      const k = String(r.category ?? tt('stockSync.st.unknown'));
      m.set(k, (m.get(k) ?? 0) + Number(r.amount ?? 0));
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value: r2(value) })).sort((a, b) => b.value - a.value);
  }, [costs]);

  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.reports.finance')} description={tt('rpt.financeDesc')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={tt('fin.pay.stat.total')} value={totals.inc.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label={tt('tools.profit.totalCost')} value={totals.cost.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<Wallet size={18} />} />
        <StatCard label={tt('rpt.netAmount')} value={totals.net.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<TrendingUp size={18} />} />
        <StatCard label={tt('rpt.txCount')} value={String(totals.count)} icon={<BarChart3 size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('rpt.incomeByPlatform')}</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byPlatform}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" name={tt('profit.chart.revenue')} fill="var(--chart-cat-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('rpt.costByCategory')}</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCategory}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip />
                <Bar dataKey="value" name={tt('pd.cost')} fill="var(--chart-cat-3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('rpt.incomeCompPlatform')}</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byPlatform} dataKey="value" nameKey="name" outerRadius={100} label>
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
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('rpt.costCompCategory')}</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byCategory} dataKey="value" nameKey="name" outerRadius={100} label>
                  {byCategory.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />
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
      {!loading && income.length === 0 && costs.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {t("rpt.empty.finance")}
        </div>
      )}
    </div>
  );
}
