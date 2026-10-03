import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, RefreshCw, AlertTriangle, TrendingUp, CheckCircle2, PackagePlus, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow, fetchInventory, type ExtRow } from "@/lib/data-access";
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

export const Route = createFileRoute("/_layout/fulfillment/")({
  component: Fulfillment,
});

const emptyForm = { sku: "", product: "", warehouse: "", qty: "", status: "待备货" };

// 根据库存自动判定备货状态
function stockLevel(available: number, safety: number): "缺货" | "偏低" | "充足" {
  if (available <= 0) return "缺货";
  if (available < safety) return "偏低";
  return "充足";
}

function Fulfillment() {
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [stocks, setStocks] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchTable("fulfillment_plans"), fetchInventory()])
      .then(([plans, inv]) => {
        setRows(plans);
        setStocks(inv);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // 库存维度统计
  const stockStats = useMemo(() => {
    let out = 0, low = 0, ok = 0;
    for (const s of stocks) {
      const lv = stockLevel(Number(s.available) || 0, Number(s.safety_stock) || 0);
      if (lv === "缺货") out++;
      else if (lv === "偏低") low++;
      else ok++;
    }
    return { out, low, ok };
  }, [stocks]);

  const totalQty = useMemo(() => rows.reduce((a, r) => a + (Number(r.qty) || 0), 0), [rows]);

  // 一键生成备货计划：available < safety 的 SKU 自动建单
  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const need = stocks.filter((s) => (Number(s.available) || 0) < (Number(s.safety_stock) || 0));
      if (need.length === 0) {
        toast.success("暂无需要补货的 SKU，库存全部充足");
        return;
      }
      const existing = new Set(rows.map((r) => `${r.sku}|${r.warehouse ?? ""}`));
      let created = 0, updated = 0;
      for (const s of need) {
        const key = `${s.sku}|${s.warehouse ?? ""}`;
        const qty = Math.max(1, (Number(s.safety_stock) || 0) - (Number(s.available) || 0));
        const row = rows.find((r) => r.sku === s.sku && (r.warehouse ?? "") === (s.warehouse ?? ""));
        if (row) {
          await updateRow("fulfillment_plans", row.id, { qty, status: row.status === "已备货" ? "待备货" : row.status });
          updated++;
        } else if (!existing.has(key)) {
          await insertRow("fulfillment_plans", {
            sku: s.sku,
            product: s.name ?? s.sku,
            warehouse: s.warehouse ?? "",
            qty,
            status: "待备货",
          });
          created++;
        }
      }
      toast.success(`已生成 ${created} 条备货计划，更新 ${updated} 条`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "生成备货计划失败");
    } finally {
      setGenerating(false);
    }
  };

  // 一键同步状态：按当前库存刷新计划状态（缺货/偏低/充足）
  const handleSync = async () => {
    setSyncing(true);
    try {
      let updated = 0;
      for (const r of rows) {
        const s = stocks.find((x) => x.sku === r.sku && (x.warehouse ?? "") === (r.warehouse ?? ""));
        if (!s) continue;
        const lv = stockLevel(Number(s.available) || 0, Number(s.safety_stock) || 0);
        const nextStatus = lv === "充足" ? "已备货" : lv === "偏低" ? "备货中" : "待备货";
        if (nextStatus !== r.status) {
          await updateRow("fulfillment_plans", r.id, { status: nextStatus });
          updated++;
        }
      }
      toast.success(`已同步 ${updated} 条备货状态`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "同步状态失败");
    } finally {
      setSyncing(false);
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
      sku: String(row.sku ?? ""),
      product: String(row.product ?? ""),
      warehouse: String(row.warehouse ?? ""),
      qty: String(row.qty ?? ""),
      status: String(row.status ?? "待备货"),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.sku.trim()) {
      toast.error("请填写 SKU");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        sku: form.sku.trim(),
        product: form.product.trim(),
        warehouse: form.warehouse.trim(),
        qty: Number(form.qty) || 0,
        status: form.status,
      };
      if (editing) await updateRow("fulfillment_plans", editing.id, payload);
      else await insertRow("fulfillment_plans", payload);
      setDialogOpen(false);
      load();
      toast.success("备货计划已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("fulfillment_plans", deleting.id);
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
        title="全托管备货"
        description="实时监控备货状态与出库效率，支持按库存一键生成备货计划"
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
              {generating ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <PackagePlus size={15} className="mr-1.5" />}
              一键生成备货计划
            </Button>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <RefreshCw size={15} className="mr-1.5" />}
              同步库存状态
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus size={15} className="mr-1.5" /> 新增备货计划
            </Button>
          </div>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="缺货" value={String(stockStats.out)} icon={<AlertTriangle size={17} />} tone="warning" />
        <StatCard label="库存偏低" value={String(stockStats.low)} icon={<TrendingUp size={17} />} tone="violet" />
        <StatCard label="库存充足" value={String(stockStats.ok)} icon={<CheckCircle2 size={17} />} tone="success" />
        <StatCard label="总备货量" value={String(totalQty)} icon={<Boxes size={17} />} tone="primary" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">商品</th>
              <th className="px-4 py-3 font-medium">仓库</th>
              <th className="px-4 py-3 font-medium">当前库存</th>
              <th className="px-4 py-3 font-medium">备货量</th>
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
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  暂无备货计划，点击「一键生成备货计划」从库存自动创建
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const st = stocks.find((s) => s.sku === row.sku && (s.warehouse ?? "") === (row.warehouse ?? ""));
                return (
                  <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{String(row.sku ?? "")}</td>
                    <td className="px-4 py-3 font-medium">{String(row.product ?? "")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.warehouse ?? "")}</td>
                    <td className="px-4 py-3">
                      <span className={stockLevel(Number(st?.available) || 0, Number(st?.safety_stock) || 0) === "缺货" ? "font-semibold text-rose-600" : "text-muted-foreground"}>
                        {Number(st?.available) || 0}
                      </span>
                    </td>
                    <td className="px-4 py-3">{String(row.qty ?? 0)}</td>
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
            <DialogTitle>{editing ? "编辑备货计划" : "新增备货计划"}</DialogTitle>
            <DialogDescription>按 SKU 与仓库维度维护全托管备货</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>SKU <span className="text-rose-500">*</span></Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="如：BT-001-BK" />
              </div>
              <div className="grid gap-1.5">
                <Label>商品</Label>
                <Input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="如：无线蓝牙耳机 Pro" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>仓库</Label>
                <Input value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder="如：美国加州仓" />
              </div>
              <div className="grid gap-1.5">
                <Label>备货量</Label>
                <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>状态</Label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {["待备货", "备货中", "已备货"].map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
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
            <AlertDialogDescription>删除后该备货计划将被移除。</AlertDialogDescription>
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
