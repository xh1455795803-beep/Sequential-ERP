import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Eye, MousePointerClick, PercentCircle, ShoppingBag, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow, type ExtRow } from "@/lib/data-access";
import { toast } from "sonner";
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

export const Route = createFileRoute("/_layout/ads/keyword")({
  component: Keyword,
});

const emptyForm = { keyword: "", campaign: "", impressions: "", clicks: "", conversions: "", spend: "", revenue: "", status: "监控中" };

// 跨境广告热门关键词库
const PRESET_KEYWORDS = [
  { keyword: "wireless earbuds", campaign: "耳机-主推" },
  { keyword: "bluetooth speaker", campaign: "音箱-主推" },
  { keyword: "phone case", campaign: "手机配件" },
  { keyword: "led strip lights", campaign: "家居照明" },
  { keyword: "smart watch", campaign: "智能穿戴" },
  { keyword: "usb c cable", campaign: "数码配件" },
  { keyword: "car phone holder", campaign: "车载配件" },
  { keyword: "ring light", campaign: "直播设备" },
  { keyword: "pet feeder", campaign: "宠物用品" },
  { keyword: "air fryer", campaign: "厨房电器" },
];

function ctr(imp: number, clk: number) {
  return imp > 0 ? (clk / imp) * 100 : 0;
}

function quality(rate: number): { label: string; cls: string } {
  if (rate >= 2) return { label: "优", cls: "text-emerald-600" };
  if (rate >= 1) return { label: "良", cls: "text-amber-600" };
  return { label: "待优化", cls: "text-rose-600" };
}

function Keyword() {
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [addingPreset, setAddingPreset] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    fetchTable("ad_keywords")
      .then(setRows)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const stats = useMemo(() => {
    const imp = rows.reduce((a, r) => a + (Number(r.impressions) || 0), 0);
    const clk = rows.reduce((a, r) => a + (Number(r.clicks) || 0), 0);
    const conv = rows.reduce((a, r) => a + (Number(r.conversions) || 0), 0);
    const rate = imp > 0 ? (clk / imp) * 100 : 0;
    return { imp, clk, rate, conv };
  }, [rows]);

  // 一键批量添加预置关键词
  const handleAddPreset = async () => {
    setAddingPreset(true);
    try {
      const existing = new Set(rows.map((r) => String(r.keyword).toLowerCase()));
      let added = 0;
      for (const p of PRESET_KEYWORDS) {
        if (existing.has(p.keyword.toLowerCase())) continue;
        await insertRow("ad_keywords", {
          keyword: p.keyword,
          campaign: p.campaign,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          spend: 0,
          revenue: 0,
          status: "监控中",
        });
        added++;
      }
      toast.success(`已批量添加 ${added} 个监控关键词`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "批量添加失败");
    } finally {
      setAddingPreset(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row: ExtRow) => {
    setEditing(row);
    setForm({
      keyword: String(row.keyword ?? ""),
      campaign: String(row.campaign ?? ""),
      impressions: String(row.impressions ?? ""),
      clicks: String(row.clicks ?? ""),
      conversions: String(row.conversions ?? ""),
      spend: String(row.spend ?? ""),
      revenue: String(row.revenue ?? ""),
      status: String(row.status ?? "监控中"),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.keyword.trim()) {
      toast.error("请填写关键词");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        keyword: form.keyword.trim(),
        campaign: form.campaign.trim(),
        impressions: Number(form.impressions) || 0,
        clicks: Number(form.clicks) || 0,
        conversions: Number(form.conversions) || 0,
        spend: Number(form.spend) || 0,
        revenue: Number(form.revenue) || 0,
        status: form.status,
      };
      if (editing) await updateRow("ad_keywords", editing.id, payload);
      else await insertRow("ad_keywords", payload);
      setDialogOpen(false);
      load();
      toast.success("关键词已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("ad_keywords", deleting.id);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="关键词监控"
        description="智能监控关键词表现，优化投放策略"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleAddPreset} disabled={addingPreset}>
              {addingPreset ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Sparkles size={15} className="mr-1.5" />}
              一键添加热门关键词
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus size={15} className="mr-1.5" /> 新增关键词
            </Button>
          </div>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="总曝光" value={stats.imp.toLocaleString()} icon={<Eye size={17} />} tone="primary" />
        <StatCard label="总点击" value={stats.clk.toLocaleString()} icon={<MousePointerClick size={17} />} tone="success" />
        <StatCard label="平均 CTR" value={`${stats.rate.toFixed(2)}%`} icon={<PercentCircle size={17} />} tone="violet" />
        <StatCard label="总转化" value={String(stats.conv)} icon={<ShoppingBag size={17} />} tone="warning" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">关键词</th>
              <th className="px-4 py-3 font-medium">所属活动</th>
              <th className="px-4 py-3 font-medium">曝光</th>
              <th className="px-4 py-3 font-medium">点击</th>
              <th className="px-4 py-3 font-medium">CTR</th>
              <th className="px-4 py-3 font-medium">质量</th>
              <th className="px-4 py-3 font-medium">转化</th>
              <th className="px-4 py-3 font-medium">花费</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> 加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-muted-foreground">
                  暂无监控关键词，点击「一键添加热门关键词」快速开始
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const imp = Number(row.impressions) || 0;
                const clk = Number(row.clicks) || 0;
                const rate = ctr(imp, clk);
                const q = quality(rate);
                return (
                  <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{String(row.keyword ?? "")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.campaign ?? "")}</td>
                    <td className="px-4 py-3">{imp.toLocaleString()}</td>
                    <td className="px-4 py-3">{clk.toLocaleString()}</td>
                    <td className="px-4 py-3 font-semibold">{rate.toFixed(2)}%</td>
                    <td className={`px-4 py-3 font-medium ${q.cls}`}>{q.label}</td>
                    <td className="px-4 py-3">{String(row.conversions ?? 0)}</td>
                    <td className="px-4 py-3">${(Number(row.spend) || 0).toLocaleString()}</td>
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑关键词" : "新增关键词"}</DialogTitle>
            <DialogDescription>录入关键词投放数据，CTR 自动计算</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>关键词 <span className="text-rose-500">*</span></Label>
                <Input value={form.keyword} onChange={(e) => setForm({ ...form, keyword: e.target.value })} placeholder="如：wireless earbuds" />
              </div>
              <div className="grid gap-1.5">
                <Label>所属活动</Label>
                <Input value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} placeholder="如：蓝牙耳机-主推" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>曝光</Label>
                <Input type="number" value={form.impressions} onChange={(e) => setForm({ ...form, impressions: e.target.value })} placeholder="如：12400" />
              </div>
              <div className="grid gap-1.5">
                <Label>点击</Label>
                <Input type="number" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} placeholder="如：680" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>转化</Label>
                <Input type="number" value={form.conversions} onChange={(e) => setForm({ ...form, conversions: e.target.value })} placeholder="如：42" />
              </div>
              <div className="grid gap-1.5">
                <Label>花费</Label>
                <Input type="number" value={form.spend} onChange={(e) => setForm({ ...form, spend: e.target.value })} placeholder="如：360" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>营收</Label>
                <Input type="number" value={form.revenue} onChange={(e) => setForm({ ...form, revenue: e.target.value })} placeholder="如：980" />
              </div>
              <div className="grid gap-1.5">
                <Label>状态</Label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {["监控中", "优化中", "观察中"].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
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
            <AlertDialogDescription>删除后该关键词监控记录将被移除。</AlertDialogDescription>
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
