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

export const Route = createFileRoute("/_layout/reports/purchase")({
  component: ReportsPurchasePage,
});


const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsPurchasePage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [items, setItems] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 采购单主表 + 明细表：SKU/数量/金额聚合来自 purchase_items（P0-5 主子表结构）
    Promise.all([fetchTable("purchase_orders"), fetchTable("purchase_items")])
      .then(([orders, its]) => { setRows(orders); setItems(its); })
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const amount = rows
      .filter((r) => r.status !== "已取消")
      .reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
    const skus = new Set(items.map((r) => String(r.sku ?? ""))).size;
    const suppliers = new Set(rows.map((r) => String(r.supplier_id ?? ""))).size;
    return { count: rows.length, amount: r2(amount), skus, suppliers };
  }, [rows, items]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const k = String(r.status ?? tt('stockSync.st.unknown'));
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [rows]);

  const bySku = useMemo(() => {
    const m = new Map<string, { name: string; amount: number; qty: number }>();
    items.forEach((r) => {
      const k = String(r.name || r.sku || tt('stockSync.st.unknown'));
      const cur = m.get(k) ?? { name: k, amount: 0, qty: 0 };
      cur.amount += Number(r.amount ?? 0);
      cur.qty += Number(r.qty) || 0;
      m.set(k, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, amount: r2(v.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 10);
  }, [items]);


  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.reports.purchase')} description={tt('pur.rep.desc')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label={tt('pur.rep.orders')} value={String(totals.count)} icon={<BarChart3 size={18} />} />
        <StatCard label={tt('pur.rep.amount')} value={totals.amount.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label={tt('pur.rep.skus')} value={String(totals.skus)} icon={<Activity size={18} />} />
        <StatCard label={tt('pur.rep.suppliers')} value={String(totals.suppliers)} icon={<TrendingUp size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('pur.rep.skuTop')}</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bySku}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
              <YAxis stroke="var(--muted-foreground)" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="amount" name={tt('pur.rep.amount')} fill="var(--chart-cat-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">{tt('pur.rep.statusDist')}</h3>
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
          {t("rpt.empty.purchase")}
        </div>
      )}
    </div>
  );
}
