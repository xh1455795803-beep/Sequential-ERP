import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { supabase } from "@/supabase/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export const Route = createFileRoute("/admin/usage")({
  component: Usage,
});

interface UsageRow {
  service_key: string;
  service_name: string;
  cost: number;
  status: string;
  created_at: string;
}

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1"];

type RangeKey = "all" | "today" | "7d" | "30d";

const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: "all", label: "admin.all", days: null },
  { key: "today", label: "admin.today", days: 0 },
  { key: "7d", label: "admin.7d", days: 7 },
  { key: "30d", label: "admin.30d", days: 30 },
];

function Usage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("30d");

  useEffect(() => {
    setLoading(true);
    supabase
      .from("ai_usage_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        setRows((data ?? []) as UsageRow[]);
        setLoading(false);
      });
  }, []);

  // 按时间范围过滤
  const filtered = useMemo(() => {
    const cfg = RANGES.find((r) => r.key === range)!;
    if (cfg.days === null) return rows;
    const now = new Date();
    const start = new Date(now);
    if (cfg.days === 0) {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(start.getDate() - cfg.days);
    }
    return rows.filter((r) => new Date(r.created_at) >= start);
  }, [rows, range]);

  const totalCalls = filtered.length;
  const successCalls = filtered.filter((r) => r.status === "成功").length;
  const totalCost = filtered.reduce((sum, r) => sum + Number(r.cost), 0);

  // 按能力聚合
  const byService = useMemo(() => {
    return filtered.reduce<Record<string, { name: string; count: number; cost: number }>>((acc, r) => {
      const key = r.service_key || "unknown";
      if (!acc[key]) acc[key] = { name: r.service_name || key, count: 0, cost: 0 };
      acc[key].count += 1;
      acc[key].cost += Number(r.cost);
      return acc;
    }, {});
  }, [filtered]);

  // 饼图数据
  const pieData = useMemo(
    () =>
      Object.entries(byService).map(([key, v]) => ({
        name: v.name,
        value: v.cost,
      })),
    [byService]
  );

  // 趋势数据：按天聚合消耗额度
  const trendData = useMemo(() => {
    const byDay = filtered.reduce<Record<string, number>>((acc, r) => {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      acc[day] = (acc[day] ?? 0) + Number(r.cost);
      return acc;
    }, {});
    return Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, cost]) => ({ day: day.slice(5), cost: Number(cost.toFixed(2)) }));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("admin.usageTitle")}
        description={t("admin.usageDesc")}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  range === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t(r.label)}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label={t("admin.totalCalls")} value={String(totalCalls)} tone="primary" icon={<BarChart3 size={17} />} />
        <StatCard label={t("admin.successCalls")} value={String(successCalls)} tone="success" icon={<BarChart3 size={17} />} />
        <StatCard label={t("admin.totalCost")} value={totalCost.toFixed(2)} tone="warning" icon={<BarChart3 size={17} />} />
      </div>

      {/* 趋势 + 分布 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm lg:col-span-2">
          <h3 className="mb-4 text-sm font-semibold">{t("admin.trend")}</h3>
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : trendData.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t("admin.noData")}</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area type="monotone" dataKey="cost" name={t("admin.costQuota")} stroke="#3b82f6" strokeWidth={2} fill="url(#costGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{t("admin.distribution")}</h3>
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : pieData.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{t("admin.noData")}</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 按能力明细 */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">{t("admin.byCapability")}</div>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : Object.keys(byService).length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("admin.noUsage")}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">{t("admin.capability")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.calls")}</th>
                <th className="px-5 py-3 font-medium">{t("admin.costQuota")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byService).map(([key, v]) => (
                <tr key={key} className="border-b border-border last:border-0">
                  <td className="px-5 py-3 font-medium">{v.name}</td>
                  <td className="px-5 py-3 text-muted-foreground">{v.count}</td>
                  <td className="px-5 py-3 text-muted-foreground">{v.cost.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}