import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";
import { DollarSign, TrendingUp, Wallet, Percent, Eye, MousePointerClick, Target, CircleDollarSign } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from "recharts";

export const Route = createFileRoute("/_layout/ads/analysis")({
  component: AdsAnalysisPage,
});

const PIE_COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#14b8a6"];
const r2 = (n: number) => Math.round(n * 100) / 100;

function AdsAnalysisPage() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTable("ad_campaigns")
      .then(setRows)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const spend = rows.reduce((s, r) => s + Number(r.spend ?? 0), 0);
    const revenue = rows.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
    const impressions = rows.reduce((s, r) => s + (Number(r.impressions) || 0), 0);
    const clicks = rows.reduce((s, r) => s + (Number(r.clicks) || 0), 0);
    const conversions = rows.reduce((s, r) => s + (Number(r.conversions) || 0), 0);
    const roas = spend > 0 ? revenue / spend : 0;
    const acos = revenue > 0 ? (spend / revenue) * 100 : 0;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cvr = clicks > 0 ? (conversions / clicks) * 100 : 0;
    const cpc = clicks > 0 ? spend / clicks : 0;
    return { spend: r2(spend), revenue: r2(revenue), impressions, clicks, conversions, roas: r2(roas), acos: r2(acos), ctr: r2(ctr), cvr: r2(cvr), cpc: r2(cpc) };
  }, [rows]);

  const byPlatform = useMemo(() => {
    const m = new Map<string, { name: string; spend: number; revenue: number; conversions: number }>();
    rows.forEach((r) => {
      const key = String(r.platform ?? "未知");
      const cur = m.get(key) ?? { name: key, spend: 0, revenue: 0, conversions: 0 };
      cur.spend += Number(r.spend ?? 0);
      cur.revenue += Number(r.revenue ?? 0);
      cur.conversions += Number(r.conversions) || 0;
      m.set(key, cur);
    });
    return Array.from(m.values()).map((v) => ({ ...v, spend: r2(v.spend), revenue: r2(v.revenue) }));
  }, [rows]);

  const byCampaignRoas = useMemo(() => {
    return rows
      .map((r) => {
        const spend = Number(r.spend ?? 0);
        const revenue = Number(r.revenue ?? 0);
        return { name: String(r.name ?? "未命名"), roas: spend > 0 ? r2(revenue / spend) : 0 };
      })
      .sort((a, b) => b.roas - a.roas);
  }, [rows]);

  return (
    <div className="space-y-5">
      <PageHeader title="广告分析" description="基于 Campaign 数据的广告效果聚合（ROAS / ACOS / CTR / CVR / CPC）" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="总花费" value={totals.spend.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<Wallet size={18} />} />
        <StatCard label="广告收入" value={totals.revenue.toLocaleString("zh-CN", { minimumFractionDigits: 2 })} icon={<DollarSign size={18} />} />
        <StatCard label="ROAS" value={totals.spend > 0 ? totals.roas.toFixed(2) : "-"} icon={<CircleDollarSign size={18} />} />
        <StatCard label="ACOS" value={totals.revenue > 0 ? `${totals.acos.toFixed(2)}%` : "-"} icon={<Percent size={18} />} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <StatCard label="总展示" value={totals.impressions.toLocaleString()} icon={<Eye size={18} />} />
        <StatCard label="总点击" value={totals.clicks.toLocaleString()} icon={<MousePointerClick size={18} />} />
        <StatCard label="CTR" value={totals.impressions > 0 ? `${totals.ctr.toFixed(2)}%` : "-"} icon={<TrendingUp size={18} />} />
        <StatCard label="CVR" value={totals.clicks > 0 ? `${totals.cvr.toFixed(2)}%` : "-"} icon={<Target size={18} />} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold">平台对比（花费 / 收入 / 转化）</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byPlatform}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <Tooltip />
              <Legend />
              <Bar dataKey="spend" name="花费" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="revenue" name="收入" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="conversions" name="转化数" fill="#22c55e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">各 Campaign ROAS</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byCampaignRoas}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip />
                <Bar dataKey="roas" name="ROAS" fill="#14b8a6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">花费构成（按平台）</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={byPlatform} dataKey="spend" nameKey="name" outerRadius={100} label>
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
          暂无广告数据。可在「广告数据」页录入 Campaign 后查看分析（数据源：ad_campaigns）。
        </div>
      )}
    </div>
  );
}
