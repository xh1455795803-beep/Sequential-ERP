import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, StatCard } from "@/components/page-header";
import { DollarSign, ShoppingCart, TrendingUp, Download } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { fetchOrders, type OrderRow } from "@/lib/data-access";
import { exportToCsv } from "@/lib/export";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  AreaChart,
  Area,
} from "recharts";

export const Route = createFileRoute("/_layout/reports/")({
  component: Reports,
});

function Reports() {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<OrderRow[]>([]);

  useEffect(() => {
    fetchOrders()
      .then(setOrders)
      .catch((e) => console.error(e));
  }, []);

  // 按渠道聚合销售额与订单量
  const channelMap = new Map<string, { sales: number; count: number }>();
  orders.forEach((o) => {
    const cur = channelMap.get(o.channel) ?? { sales: 0, count: 0 };
    cur.sales += Number(o.amount);
    cur.count += 1;
    channelMap.set(o.channel, cur);
  });
  const channelData = Array.from(channelMap.entries()).map(([name, v]) => ({
    name,
    sales: Math.round(v.sales),
    orders: v.count,
  }));

  const totalSales = orders.reduce((s, o) => s + Number(o.amount), 0);
  const totalOrders = orders.length;

  // 近 7 天销售趋势
  const trend: { date: string; sales: number; orders: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayOrders = orders.filter((o) => {
      const od = new Date(o.created_at);
      return od.getMonth() === d.getMonth() && od.getDate() === d.getDate() && od.getFullYear() === d.getFullYear();
    });
    trend.push({
      date: key,
      sales: dayOrders.reduce((s, o) => s + Number(o.amount), 0),
      orders: dayOrders.length,
    });
  }

  const handleExport = () => {
    exportToCsv(
      t("report.title"),
      [t("report.channelPerf"), t("report.salesAmount"), t("report.orderCount")],
      channelData.map((d) => [d.name, d.sales, d.orders])
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("report.title")}
        description={t("report.desc")}
        actions={
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download size={15} /> {t("report.export")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label={t("report.totalSales")} value={`$${totalSales.toFixed(2)}`} icon={<DollarSign size={18} />} />
        <StatCard label={t("report.totalOrders")} value={String(totalOrders)} icon={<ShoppingCart size={18} />} />
        <StatCard label={t("report.channelCount")} value={String(channelData.length)} icon={<TrendingUp size={18} />} />
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">{t("report.trend")}</h2>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={trend} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
            <defs>
              <linearGradient id="reportSales" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="sales" name={t("report.salesAmount")} stroke="#3b82f6" strokeWidth={2} fill="url(#reportSales)" />
            <Area type="monotone" dataKey="orders" name={t("report.orderCount")} stroke="#10b981" strokeWidth={2} fill="transparent" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold">{t("report.channelPerf")}</h2>
        {channelData.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t("report.empty")}</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={channelData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="sales" name={t("report.salesAmount")} fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="orders" name={t("report.orderCount")} fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}