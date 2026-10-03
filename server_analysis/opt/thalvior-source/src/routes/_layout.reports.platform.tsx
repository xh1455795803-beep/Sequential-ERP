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

export const Route = createFileRoute("/_layout/reports/platform")({
  component: ReportsPlatformPage,
});

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6", "#ec4899", "#0ea5e9"];
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
    const platforms = new Set(rows.map((r) => String(r.platform ?? "未知"))).size;
    const sales = rows.reduce((s, r) => s + Number(r.today_sales ?? 0), 0);
    const orders = rows.reduce((s, r) => s + (Number(r.today_orders) || 0), 0);
    return { platforms, count: rows.length, sales: r2(sales), orders };
  }, [rows]);

  const byPlatform = useMemo(() => {
    const m = new Map<string, { name: string; shops: number; sales: number; orders: number }>();
    rows.forEach((r) => {
      const k = String(r.platform ?? "未知");
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
      <PageHeader title="平台分析" description="跨平台店铺与销售对比（数据源：shops）" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="平台数" value={String(totals.platforms)} icon={<BarChart3 size={18} />} />
        <StatCard label="店铺总数" value={String(totals.count)} icon={<Activity size={18} />} />
        <StatCard label="今日总销售" value={totals.sales.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label="今日总订单" value={String(totals.orders)} icon={<TrendingUp size={18} />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">平台对比（店铺 / 销售 / 订单）</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byPlatform}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="shops" name="店铺数" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="sales" name="今日销售" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="orders" name="今日订单" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">平台销售额占比</h3>
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
          暂无店铺数据。接入店铺后可查看平台分析。
        </div>
      )}
    </div>
  );
}
