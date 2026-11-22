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

export const Route = createFileRoute("/_layout/reports/logistics")({
  component: ReportsLogisticsPage,
});


const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsLogisticsPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTable("shipments")
      .then(setRows)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const dests = new Set(rows.map((r) => String(r.destination ?? ""))).size;
    const carriers = new Set(rows.map((r) => String(r.carrier ?? ""))).size;
    const origins = new Set(rows.map((r) => String(r.origin ?? ""))).size;
    return { count: rows.length, dests, carriers, origins };
  }, [rows]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const k = String(r.status ?? tt('stockSync.st.unknown'));
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [rows]);

  const byDest = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const k = String(r.destination ?? tt('stockSync.st.unknown'));
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  }, [rows]);


  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.reports.logistics')} description={tt('rpt.waybillDesc')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={tt('rpt.waybillTotal')} value={String(totals.count)} icon={<BarChart3 size={18} />} />
        <StatCard label={tt('rpt.destCount2')} value={String(totals.dests)} icon={<TrendingUp size={18} />} />
        <StatCard label={tt('rpt.carrierCount')} value={String(totals.carriers)} icon={<Activity size={18} />} />
        <StatCard label={tt('rpt.originCount')} value={String(totals.origins)} icon={<DollarSign size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.destWaybillCount')}Top10</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDest}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="value" name={tt('rpt.waybillCount')} fill="var(--chart-cat-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.waybillStatusDist')}</h3>
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
          {t("rpt.empty.logistics")}
        </div>
      )}
    </div>
  );
}
