import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Plus, Pencil, Trash2, Loader2, PlayCircle, CheckCircle2, PackagePlus,
  ShoppingCart, ArrowRight, ListChecks, Lightbulb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow } from "@/lib/data-access";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_layout/purchase/plan")({
  component: Plan,
});

const emptyForm = { sku: "", product: "", qty: "", supplier: "", status: "待采购" };

function Plan() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [transiting, setTransiting] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchTable("purchase_plans")
      .then((data) => setRows(data))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openAdd = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      sku: String(row.sku ?? ""), product: String(row.product ?? ""), qty: String(row.qty ?? ""),
      supplier: String(row.supplier ?? ""), status: String(row.status ?? "待采购"),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.sku.trim() || !form.product.trim()) { toast.error("请填写 SKU 与商品名称"); return; }
    setSaving(true);
    try {
      const payload = {
        sku: form.sku.trim(), product: form.product.trim(), qty: Number(form.qty) || 0,
        supplier: form.supplier.trim(), status: form.status,
      };
      if (editing) { await updateRow("purchase_plans", editing.id, payload); toast.success("采购计划已更新"); }
      else { await insertRow("purchase_plans", payload); toast.success("采购计划已创建"); }
      setDialogOpen(false); setForm(emptyForm); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("purchase_plans", deleting.id);
      setDeleting(null); toast.success("已删除"); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "删除失败"); setDeleting(null); }
  };

  // 状态流转：待采购 → 采购中 → 已完成
  const transit = async (row: any, next: string) => {
    setTransiting(row.id);
    try {
      await updateRow("purchase_plans", row.id, { status: next });
      toast.success(next === "采购中" ? "已开始采购" : next === "已完成" ? "采购已完成" : "状态已更新");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "状态更新失败"); }
    finally { setTransiting(null); }
  };

  // 生成入库单：把已完成计划写入 inbound_orders
  const createInbound = async (row: any) => {
    setTransiting(row.id);
    try {
      await insertRow("inbound_orders", {
        order_no: "IB" + Date.now().toString().slice(-8),
        warehouse: "默认仓",
        sku: row.sku,
        qty: row.qty || 0,
        status: "待入库",
      });
      toast.success("已生成入库单，可到「入库退货」执行入库");
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "生成入库单失败"); }
    finally { setTransiting(null); }
  };

  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="采购计划"
        description="从计划到执行，支持状态流转与一键转入库"
        actions={
          <div className="flex gap-2">
            <Link to="/purchase/suggestion">
              <Button size="sm" variant="outline">
                <Lightbulb size={15} className="mr-1.5" /> 采购建议
              </Button>
            </Link>
            <Button size="sm" onClick={openAdd}><Plus size={15} className="mr-1.5" /> 新建计划</Button>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="待采购" value={String(count("待采购"))} icon={<ShoppingCart size={17} />} tone="warning" />
        <StatCard label="采购中" value={String(count("采购中"))} icon={<PlayCircle size={17} />} tone="primary" />
        <StatCard label="已完成" value={String(count("已完成"))} icon={<CheckCircle2 size={17} />} tone="success" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-ink">计划列表（{rows.length} 条）</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-5 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">商品</th>
              <th className="px-4 py-3 font-medium">采购数量</th>
              <th className="px-4 py-3 font-medium">供应商</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />加载中...</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  暂无采购计划，可从「采购建议」一键生成，或手动新建
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3 font-mono text-xs font-medium text-primary">{row.sku}</td>
                  <td className="px-4 py-3 font-medium text-ink">{row.product}</td>
                  <td className="px-4 py-3">{row.qty}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.supplier || "—"}</td>
                  <td className="px-4 py-3"><StatusBadge status={String(row.status ?? "")} /></td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {row.status === "待采购" && (
                        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs text-primary" onClick={() => transit(row, "采购中")} disabled={transiting === row.id}>
                          <PlayCircle size={13} /> 开始采购
                        </Button>
                      )}
                      {row.status === "采购中" && (
                        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs text-emerald-600" onClick={() => transit(row, "已完成")} disabled={transiting === row.id}>
                          <CheckCircle2 size={13} /> 完成
                        </Button>
                      )}
                      {row.status === "已完成" && (
                        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => createInbound(row)} disabled={transiting === row.id}>
                          <PackagePlus size={13} /> 生成入库单
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-600" onClick={() => setDeleting(row)}><Trash2 size={15} /></Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑采购计划" : "新建采购计划"}</DialogTitle>
            <DialogDescription>{editing ? "更新计划信息" : "录入采购计划明细"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>SKU <span className="text-rose-500">*</span></Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="如：BT-001-BK" />
              </div>
              <div className="grid gap-1.5">
                <Label>商品名称 <span className="text-rose-500">*</span></Label>
                <Input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="如：无线蓝牙耳机 Pro" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>采购数量</Label>
                <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="如：500" />
              </div>
              <div className="grid gap-1.5">
                <Label>供应商</Label>
                <Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder="如：深圳华强电子" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>状态</Label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                {["待采购", "采购中", "已完成"].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 size={14} className="mr-1 animate-spin" />}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>删除后该采购计划将被移除。</AlertDialogDescription>
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
