import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";
import { DollarSign, Percent, TrendingUp, Wallet } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_layout/finance/profit-analysis")({
  component: ProfitAnalysisPage,
});

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];

function ProfitAnalysisPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dim, setDim] = useState<"channel" | "product">("channel");

  useEffect(() => {
    fetchTable("profit_records")
      .then(setRows)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const revenue = rows.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
    const cost = rows.reduce((s, r) => s + Number(r.cost ?? 0) + Number(r.shipping ?? 0) + Number(r.platform_fee ?? 0) + Number(r.ad_fee ?? 0), 0);
    const profit = rows.reduce((s, r) => s + Number(r.profit ?? 0), 0);
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    return { revenue, cost, profit, margin };
  }, [rows]);

  const byDim = useMemo(() => {
    const m = new Map<string, { name: string; revenue: number; cost: number; profit: number }>();
    rows.forEach((r) => {
      const key = String(r[dim] ?? "未知");
      const cur = m.get(key) ?? { name: key, revenue: 0, cost: 0, profit: 0 };
      cur.revenue += Number(r.revenue ?? 0);
      cur.cost += Number(r.cost ?? 0) + Number(r.shipping ?? 0) + Number(r.platform_fee ?? 0) + Number(r.ad_fee ?? 0);
      cur.profit += Number(r.profit ?? 0);
      m.set(key, cur);
    });
    return Array.from(m.values()).map((v) => ({
      ...v,
      revenue: Math.round(v.revenue * 100) / 100,
      cost: Math.round(v.cost * 100) / 100,
      profit: Math.round(v.profit * 100) / 100,
    }));
  }, [rows, dim]);

  const costBreakdown = useMemo(() => {
    const sum = (k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
    return [
      { name: "商品成本", value: Math.round(sum("cost") * 100) / 100 },
      { name: "物流", value: Math.round(sum("shipping") * 100) / 100 },
      { name: "平台佣金", value: Math.round(sum("platform_fee") * 100) / 100 },
      { name: "广告", value: Math.round(sum("ad_fee") * 100) / 100 },
    ].filter((x) => x.value > 0);
  }, [rows]);

  return (
    <div className="space-y-5">
      <PageHeader title="利润分析" description="基于利润记录的多维聚合（按渠道 / 按商品切换）" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="总收入" value={totals.revenue.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label="总成本" value={totals.cost.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<Wallet size={18} />} />
        <StatCard label="总利润" value={totals.profit.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<TrendingUp size={18} />} />
        <StatCard label="平均毛利率" value={`${totals.margin.toFixed(2)}%`} icon={<Percent size={18} />} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          {(["channel", "product"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDim(d)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${dim === d ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              {d === "channel" ? "按渠道" : "按商品"}
            </button>
          ))}
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDim}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="revenue" name="收入" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="cost" name="成本" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="profit" name="利润" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">成本构成</h3>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={costBreakdown} dataKey="value" nameKey="name" outerRadius={100} label>
                {costBreakdown.map((_, i) => (
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
      {!loading && rows.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          暂无利润记录数据。可在业务产生利润记录后查看分析（数据源：profit_records）。
        </div>
      )}
    </div>
  );
}
