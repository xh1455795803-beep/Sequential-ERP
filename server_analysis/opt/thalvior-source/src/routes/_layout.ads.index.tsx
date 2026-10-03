import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Megaphone, Wallet, DollarSign, Percent, Activity, TrendingUp, ChartColumn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow, type ExtRow } from "@/lib/data-access";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_layout/ads/")({
  component: Ads,
});

const emptyForm = { name: "", platform: "Amazon US", budget: "", spend: "", status: "投放中" };
const PLATFORMS = ["Amazon US", "Amazon JP", "TikTok Shop", "Temu", "Shopee", "Etsy"];

function Ads() {
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    fetchTable("ad_campaigns")
      .then(setRows)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === "投放中").length;
    const budget = rows.reduce((a, r) => a + (Number(r.budget) || 0), 0);
    const spend = rows.reduce((a, r) => a + (Number(r.spend) || 0), 0);
    const conv = rows.reduce((a, r) => a + (Number(r.conversions) || 0), 0);
    const revenue = rows.reduce((a, r) => a + (Number(r.revenue) || 0), 0);
    const roi = spend > 0 ? revenue / spend : 0;
    const rate = budget > 0 ? Math.round((spend / budget) * 100) : 0;
    return { active, budget, spend, conv, revenue, roi, rate };
  }, [rows]);

  const chartData = useMemo(
    () =>
      rows.map((r) => ({
        name: String(r.name ?? "").slice(0, 10),
        spend: Number(r.spend) || 0,
        revenue: Number(r.revenue) || 0,
      })),
    [rows]
  );

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row: ExtRow) => {
    setEditing(row);
    setForm({
      name: String(row.name ?? ""),
      platform: String(row.platform ?? "Amazon US"),
      budget: String(row.budget ?? ""),
      spend: String(row.spend ?? ""),
      status: String(row.status ?? "投放中"),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("请填写广告活动名称");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        platform: form.platform,
        budget: Number(form.budget) || 0,
        spend: Number(form.spend) || 0,
        status: form.status,
      };
      if (editing) await updateRow("ad_campaigns", editing.id, payload);
      else await insertRow("ad_campaigns", payload);
      setDialogOpen(false);
      load();
      toast.success("广告活动已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("ad_campaigns", deleting.id);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
      setDeleting(null);
    }
  };

  const spendRate = (row: ExtRow) => {
    const b = Number(row.budget) || 0;
    const s = Number(row.spend) || 0;
    return b > 0 ? Math.min(100, Math.round((s / b) * 100)) : 0;
  };

  const roiOf = (row: ExtRow) => {
    const s = Number(row.spend) || 0;
    const r = Number(row.revenue) || 0;
    return s > 0 ? (r / s).toFixed(2) : "—";
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="广告投放"
        description="广告活动管理与效果报表，监控预算与 ROI"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={15} className="mr-1.5" /> 新建广告
          </Button>
        }
      />

      <Tabs defaultValue="data">
        <TabsList>
          <TabsTrigger value="data">数据管理</TabsTrigger>
          <TabsTrigger value="report">效果报表</TabsTrigger>
        </TabsList>

        <TabsContent value="data" className="space-y-5">
          {/* 统计卡 */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="投放中活动" value={String(stats.active)} icon={<Megaphone size={17} />} tone="success" />
            <StatCard label="总预算" value={`$${stats.budget.toLocaleString()}`} icon={<Wallet size={17} />} tone="primary" />
            <StatCard label="总花费" value={`$${stats.spend.toLocaleString()}`} icon={<DollarSign size={17} />} tone="warning" />
            <StatCard label="预算使用率" value={`${stats.rate}%`} icon={<Percent size={17} />} tone="violet" />
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">广告活动</th>
                  <th className="px-4 py-3 font-medium">渠道</th>
                  <th className="px-4 py-3 font-medium">预算</th>
                  <th className="px-4 py-3 font-medium">花费</th>
                  <th className="px-4 py-3 font-medium">预算使用率</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                      <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> 加载中…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">暂无广告活动，点击「新建广告」添加</td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{String(row.name ?? "")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{String(row.platform ?? "")}</td>
                      <td className="px-4 py-3">${(Number(row.budget) || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">${(Number(row.spend) || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${spendRate(row) >= 90 ? "bg-rose-500" : spendRate(row) >= 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                              style={{ width: `${spendRate(row)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{spendRate(row)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={String(row.status ?? "")} /></td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                            <Pencil size={15} />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-600" onClick={() => setDeleting(row)}>
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="report" className="space-y-5">
          {/* 报表统计卡 */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="总花费" value={`$${stats.spend.toLocaleString()}`} icon={<DollarSign size={17} />} tone="warning" />
            <StatCard label="总预算" value={`$${stats.budget.toLocaleString()}`} icon={<Wallet size={17} />} tone="primary" />
            <StatCard label="总营收" value={`$${stats.revenue.toLocaleString()}`} icon={<TrendingUp size={17} />} tone="success" />
            <StatCard label="平均 ROI" value={stats.roi ? `${stats.roi.toFixed(2)}x` : "—"} icon={<ChartColumn size={17} />} tone="violet" />
          </div>

          {/* 花费 vs 营收柱状图 */}
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold">活动花费 vs 营收</h3>
            {chartData.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">暂无广告活动数据</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="spend" name="花费" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="revenue" name="营收" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">广告活动</th>
                  <th className="px-4 py-3 font-medium">渠道</th>
                  <th className="px-4 py-3 font-medium">花费</th>
                  <th className="px-4 py-3 font-medium">预算</th>
                  <th className="px-4 py-3 font-medium">预算使用率</th>
                  <th className="px-4 py-3 font-medium">转化</th>
                  <th className="px-4 py-3 font-medium">ROI</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> 加载中…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">暂无广告活动数据</td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium">{String(row.name ?? "")}</td>
                      <td className="px-4 py-3 text-muted-foreground">{String(row.platform ?? "")}</td>
                      <td className="px-4 py-3">${(Number(row.spend) || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">${(Number(row.budget) || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full ${spendRate(row) >= 90 ? "bg-rose-500" : spendRate(row) >= 60 ? "bg-amber-500" : "bg-emerald-500"}`}
                              style={{ width: `${spendRate(row)}%` }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground">{spendRate(row)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">{String(row.conversions ?? 0)}</td>
                      <td className="px-4 py-3 font-semibold">{roiOf(row)}</td>
                      <td className="px-4 py-3"><StatusBadge status={String(row.status ?? "")} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑广告活动" : "新建广告"}</DialogTitle>
            <DialogDescription>配置广告预算与投放状态</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>广告活动 <span className="text-rose-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：蓝牙耳机-主推" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>渠道</Label>
                <select
                  value={form.platform}
                  onChange={(e) => setForm({ ...form, platform: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {PLATFORMS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>状态</Label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {["投放中", "已暂停", "已结束"].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>预算</Label>
                <Input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="如：2000" />
              </div>
              <div className="grid gap-1.5">
                <Label>花费</Label>
                <Input type="number" value={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.value })} placeholder="如：1240" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>删除后该广告活动及其数据将被移除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
