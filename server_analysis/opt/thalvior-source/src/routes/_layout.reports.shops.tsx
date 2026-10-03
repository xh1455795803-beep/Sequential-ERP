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

export const Route = createFileRoute("/_layout/reports/shops")({
  component: ReportsShopsPage,
});

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#0ea5e9"];
const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsShopsPage() {
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
    const sales = rows.reduce((s, r) => s + Number(r.today_sales ?? 0), 0);
    const orders = rows.reduce((s, r) => s + (Number(r.today_orders) || 0), 0);
    const withRating = rows.filter((r) => Number(r.rating ?? 0) > 0);
    const rating = withRating.length > 0 ? withRating.reduce((s, r) => s + Number(r.rating ?? 0), 0) / withRating.length : 0;
    return { count: rows.length, sales: r2(sales), orders, rating: r2(rating) };
  }, [rows]);

  const byShop = useMemo(() => {
    return rows
      .map((r) => ({ name: String(r.name ?? "未命名"), sales: r2(Number(r.today_sales ?? 0)), orders: Number(r.today_orders) || 0 }))
      .sort((a, b) => b.sales - a.sales)
      .slice(0, 10);
  }, [rows]);

  const byPlatform = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r) => {
      const k = String(r.platform ?? "未知");
      m.set(k, (m.get(k) ?? 0) + 1);
    });
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  }, [rows]);


  return (
    <div className="space-y-5">
      <PageHeader title="店铺分析" description="店铺销售表现与平台分布（数据源：shops）" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="店铺数" value={String(totals.count)} icon={<BarChart3 size={18} />} />
        <StatCard label="今日销售额" value={totals.sales.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label="今日订单数" value={String(totals.orders)} icon={<TrendingUp size={18} />} />
        <StatCard label="平均评分" value={totals.rating > 0 ? String(totals.rating) : "-"} icon={<Activity size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">店铺今日销售额 Top10</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byShop}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="sales" name="销售额" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="orders" name="订单数" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">平台店铺数分布</h3>
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
      </div>

      {loading && <div className="py-10 text-center text-sm text-muted-foreground">{t("common.loading")}</div>}
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          暂无店铺数据。接入店铺后可查看分析。
        </div>
      )}
    </div>
  );
}
