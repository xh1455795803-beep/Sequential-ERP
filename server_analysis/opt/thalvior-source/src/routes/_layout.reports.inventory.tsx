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

export const Route = createFileRoute("/_layout/reports/inventory")({
  component: ReportsInventoryPage,
});

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#0ea5e9"];
const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsInventoryPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTable("inventory")
      .then(setRows)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const available = rows.reduce((s, r) => s + (Number(r.available) || 0), 0);
    const locked = rows.reduce((s, r) => s + (Number(r.locked) || 0), 0);
    const transit = rows.reduce((s, r) => s + (Number(r.in_transit) || 0), 0);
    const lowStock = rows.filter((r) => Number(r.safety_stock ?? 0) > 0 && (Number(r.available) || 0) <= Number(r.safety_stock ?? 0)).length;
    return { skus: rows.length, available, locked, transit, lowStock };
  }, [rows]);

  const byWarehouse = useMemo(() => {
    const m = new Map<string, { name: string; available: number; locked: number; transit: number }>();
    rows.forEach((r) => {
      const k = String(r.warehouse ?? "未知仓库");
      const cur = m.get(k) ?? { name: k, available: 0, locked: 0, transit: 0 };
      cur.available += Number(r.available) || 0;
      cur.locked += Number(r.locked) || 0;
      cur.transit += Number(r.in_transit) || 0;
      m.set(k, cur);
    });
    return Array.from(m.values());
  }, [rows]);


  return (
    <div className="space-y-5">
      <PageHeader title="库存分析" description="仓库库存结构与低库存预警（数据源：inventory）" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="SKU 数" value={String(totals.skus)} icon={<BarChart3 size={18} />} />
        <StatCard label="总可用库存" value={totals.available.toLocaleString()} icon={<Activity size={18} />} />
        <StatCard label="总锁定" value={totals.locked.toLocaleString()} icon={<TrendingUp size={18} />} />
        <StatCard label="低库存 SKU" value={String(totals.lowStock)} icon={<DollarSign size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">仓库库存分布</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byWarehouse}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="available" name="可用" fill="#6366f1" radius={[4, 4, 0, 0]} stackId="a" />
              <Bar dataKey="locked" name="锁定" fill="#f59e0b" radius={[4, 4, 0, 0]} stackId="a" />
              <Bar dataKey="transit" name="在途" fill="#22c55e" radius={[4, 4, 0, 0]} stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">仓库可用库存占比</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={byWarehouse} dataKey="available" nameKey="name" outerRadius={100} label>
                {byWarehouse.map((_, i) => (
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
          暂无库存数据。建立库存记录后可查看分析。
        </div>
      )}
    </div>
  );
}
