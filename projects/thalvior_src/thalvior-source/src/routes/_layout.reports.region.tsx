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

export const Route = createFileRoute("/_layout/reports/region")({
  component: ReportsRegionPage,
});


const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsRegionPage() {
  const { t } = useLanguage();
  const [shipRows, setShipRows] = useState<ExtRow[]>([]);
  const [shopRows, setShopRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchTable("shipments"), fetchTable("shops")])
      .then(([a, b]) => { setShipRows(a); setShopRows(b); })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const dests = new Set(shipRows.map((r) => String(r.destination ?? ""))).size;
    const regions = new Set(shopRows.map((r) => String(r.region ?? ""))).size;
    return { dests, regions, ships: shipRows.length, shops: shopRows.length };
  }, [shipRows, shopRows]);

  const byDest = useMemo(() => {
    const m = new Map<string, number>();
    shipRows.forEach((r) => {
      const k = String(r.destination ?? tt('stockSync.st.unknown'));
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);
  }, [shipRows]);

  const byRegion = useMemo(() => {
    const m = new Map<string, { name: string; shops: number; sales: number }>();
    shopRows.forEach((r) => {
      const k = String(r.region ?? tt('stockSync.st.unknown'));
      const cur = m.get(k) ?? { name: k, shops: 0, sales: 0 };
      cur.shops += 1;
      cur.sales += Number(r.today_sales ?? 0);
      m.set(k, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, sales: r2(v.sales) })).sort((a, b) => b.sales - a.sales);
  }, [shopRows]);

  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.reports.region')} description={tt('rpt.regionDesc')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={tt('rpt.destCount')} value={String(totals.dests)} icon={<BarChart3 size={18} />} />
        <StatCard label={tt('rpt.waybillTotal')} value={String(totals.ships)} icon={<Activity size={18} />} />
        <StatCard label={tt('rpt.shopRegionCount')} value={String(totals.regions)} icon={<TrendingUp size={18} />} />
        <StatCard label={tt('rpt.shopTotal')} value={String(totals.shops)} icon={<DollarSign size={18} />} />
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
                <Bar dataKey="value" name={tt('rpt.waybillCount')} fill="var(--chart-cat-1)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('rpt.regionShops')}</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byRegion}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} />
                <Tooltip />
                <Legend />
                <Bar dataKey="shops" name={tt('rpt.shopCount')} fill="var(--chart-cat-5)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sales" name={tt('rpt.todaySales')} fill="var(--chart-cat-2)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('rpt.destWaybillShare')}</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={byDest} dataKey="value" nameKey="name" outerRadius={100} label>
                {byDest.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {loading && <div className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>}
      {!loading && shipRows.length === 0 && shopRows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          {t("rpt.empty.region")}
        </div>
      )}
    </div>
  );
}
