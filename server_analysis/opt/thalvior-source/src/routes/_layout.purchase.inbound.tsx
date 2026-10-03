import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Plus, Pencil, Trash2, Loader2, PackagePlus, PackageX, ArrowRightLeft, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow, fetchInventory, type ExtRow } from "@/lib/data-access";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/purchase/inbound")({
  component: Inbound,
});

const emptyForm = { order_no: "", warehouse: "", sku: "", qty: "", status: "待入库" };
const emptyReturn = { order_no: "", warehouse: "", sku: "", qty: "", supplier: "", reason: "", status: "待退货" };

function Inbound() {
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [returns, setReturns] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"inbound" | "return">("inbound");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnEditing, setReturnEditing] = useState<ExtRow | null>(null);
  const [returnForm, setReturnForm] = useState(emptyReturn);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);
  const [returnDeleting, setReturnDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([fetchTable("inbound_orders"), fetchTable("return_orders")])
      .then(([ins, rets]) => { setRows(ins); setReturns(rets); })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  /* ── 入库 ── */
  const openAdd = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (row: ExtRow) => {
    setEditing(row);
    setForm({
      order_no: String(row.order_no ?? ""), warehouse: String(row.warehouse ?? ""),
      sku: String(row.sku ?? ""), qty: String(row.qty ?? ""), status: String(row.status ?? "待入库"),
    });
    setDialogOpen(true);
  };

  // 入库联动：按 sku+warehouse 找到库存记录增加 available；不存在则新建
  const applyStockIn = async (sku: string, warehouse: string, qty: number) => {
    const stocks = await fetchInventory();
    const target = stocks.find((s) => s.sku === sku && s.warehouse === warehouse);
    if (target) {
      await updateRow("inventory", target.id, { available: target.available + qty });
    } else {
      await insertRow("inventory", {
        sku, name: sku, warehouse: warehouse || "默认仓", available: qty,
        locked: 0, in_transit: 0, safety_stock: 0, status: "正常",
      });
    }
  };

  // 出库联动：扣减库存（不允许为负）
  const applyStockOut = async (sku: string, warehouse: string, qty: number) => {
    const stocks = await fetchInventory();
    const target = stocks.find((s) => s.sku === sku && s.warehouse === warehouse);
    if (!target) throw new Error("未找到对应库存记录，请先建立库存");
    const next = Math.max(0, target.available - qty);
    await updateRow("inventory", target.id, { available: next });
  };

  const handleSave = async () => {
    if (!form.order_no.trim()) { toast.error("请填写入库单号"); return; }
    setSaving(true);
    try {
      const payload = {
        order_no: form.order_no.trim(), warehouse: form.warehouse.trim(),
        sku: form.sku.trim(), qty: Number(form.qty) || 0, status: form.status,
      };
      const prevStatus = editing ? String(editing.status ?? "") : "";
      if (editing) { await updateRow("inbound_orders", editing.id, payload); }
      else { await insertRow("inbound_orders", payload); }
      if (payload.status === "已入库" && prevStatus !== "已入库" && payload.sku && payload.qty > 0) {
        await applyStockIn(payload.sku, payload.warehouse, payload.qty);
        toast.success(`已入库 ${payload.qty} 件，库存已更新`);
      }
      setDialogOpen(false); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("inbound_orders", deleting.id);
      setDeleting(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "删除失败"); setDeleting(null); }
  };

  /* ── 退货 ── */
  const openReturnAdd = () => { setReturnEditing(null); setReturnForm(emptyReturn); setReturnDialogOpen(true); };
  const openReturnEdit = (row: ExtRow) => {
    setReturnEditing(row);
    setReturnForm({
      order_no: String(row.order_no ?? ""), warehouse: String(row.warehouse ?? ""),
      sku: String(row.sku ?? ""), qty: String(row.qty ?? ""), supplier: String(row.supplier ?? ""),
      reason: String(row.reason ?? ""), status: String(row.status ?? "待退货"),
    });
    setReturnDialogOpen(true);
  };

  const handleReturnSave = async () => {
    if (!returnForm.order_no.trim() || !returnForm.sku.trim()) { toast.error("请填写退货单号与 SKU"); return; }
    setSaving(true);
    try {
      const payload = {
        order_no: returnForm.order_no.trim(), warehouse: returnForm.warehouse.trim(),
        sku: returnForm.sku.trim(), qty: Number(returnForm.qty) || 0,
        supplier: returnForm.supplier.trim(), reason: returnForm.reason.trim(), status: returnForm.status,
      };
      const prevStatus = returnEditing ? String(returnEditing.status ?? "") : "";
      if (returnEditing) { await updateRow("return_orders", returnEditing.id, payload); }
      else { await insertRow("return_orders", payload); }
      // 退货确认（已退货）时扣减库存
      if (payload.status === "已退货" && prevStatus !== "已退货" && payload.sku && payload.qty > 0) {
        await applyStockOut(payload.sku, payload.warehouse, payload.qty);
        toast.success(`退货 ${payload.qty} 件，库存已扣减`);
      } else if (payload.status === "已退货") {
        toast.success("退货单已保存");
      }
      setReturnDialogOpen(false); setReturnForm(emptyReturn); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  };

  const handleReturnDelete = async () => {
    if (!returnDeleting) return;
    try {
      await deleteRow("return_orders", returnDeleting.id);
      setReturnDeleting(null); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "删除失败"); setReturnDeleting(null); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="入库退货"
        description="采购入库自动联动库存，退货单确认自动扣减"
        actions={
          tab === "inbound" ? (
            <Button size="sm" onClick={openAdd}><Plus size={15} className="mr-1.5" /> 新增入库单</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={openReturnAdd}><Plus size={15} className="mr-1.5" /> 新增退货单</Button>
          )
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label="待入库" value={String(rows.filter((r) => r.status === "待入库").length)} icon={<PackagePlus size={17} />} tone="warning" />
        <StatCard label="已入库" value={String(rows.filter((r) => r.status === "已入库").length)} icon={<CheckCircle2 size={17} />} tone="success" />
        <StatCard label="退货单" value={String(returns.length)} icon={<PackageX size={17} />} tone="primary" />
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab("inbound")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            tab === "inbound" ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/70"
          )}
        >
          <PackagePlus size={15} /> 入库单
          <span className="text-xs opacity-70">（{rows.length}）</span>
        </button>
        <button
          onClick={() => setTab("return")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all",
            tab === "return" ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground hover:bg-muted/70"
          )}
        >
          <PackageX size={15} /> 退货单
          <span className="text-xs opacity-70">（{returns.length}）</span>
        </button>
      </div>

      {/* 入库单列表 */}
      {tab === "inbound" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">入库单号</th>
                <th className="px-4 py-3 font-medium">仓库</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">数量</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />加载中...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">暂无入库单</td></tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3 font-medium">{String(row.order_no ?? "")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.warehouse ?? "")}</td>
                    <td className="px-4 py-3 font-mono text-xs text-primary">{String(row.sku ?? "")}</td>
                    <td className="px-4 py-3">{String(row.qty ?? 0)}</td>
                    <td className="px-4 py-3"><StatusBadge status={String(row.status ?? "")} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
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
      )}

      {/* 退货单列表 */}
      {tab === "return" && (
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">退货单号</th>
                <th className="px-4 py-3 font-medium">SKU</th>
                <th className="px-4 py-3 font-medium">数量</th>
                <th className="px-4 py-3 font-medium">供应商</th>
                <th className="px-4 py-3 font-medium">退货原因</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />加载中...</td></tr>
              ) : returns.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">暂无退货单</td></tr>
              ) : (
                returns.map((row) => (
                  <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                    <td className="px-5 py-3 font-medium">{String(row.order_no ?? "")}</td>
                    <td className="px-4 py-3 font-mono text-xs text-primary">{String(row.sku ?? "")}</td>
                    <td className="px-4 py-3">{String(row.qty ?? 0)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.supplier ?? "—")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.reason ?? "—")}</td>
                    <td className="px-4 py-3"><StatusBadge status={String(row.status ?? "")} /></td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openReturnEdit(row)}><Pencil size={15} /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-600" onClick={() => setReturnDeleting(row)}><Trash2 size={15} /></Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 入库新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑入库单" : "新增入库单"}</DialogTitle>
            <DialogDescription>{editing ? "更新入库信息" : "录入采购到货，状态为「已入库」时自动增加库存"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>入库单号 <span className="text-rose-500">*</span></Label>
              <Input value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} placeholder="如：IB20260922001" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>仓库</Label>
                <Input value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder="如：美国加州仓" />
              </div>
              <div className="grid gap-1.5">
                <Label>状态</Label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  {["待入库", "质检中", "已入库"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>SKU</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="如：BT-001-BK" />
              </div>
              <div className="grid gap-1.5">
                <Label>数量</Label>
                <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 size={14} className="mr-1 animate-spin" />}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 退货新增/编辑弹窗 */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{returnEditing ? "编辑退货单" : "新增退货单"}</DialogTitle>
            <DialogDescription>状态为「已退货」时自动扣减库存</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>退货单号 <span className="text-rose-500">*</span></Label>
                <Input value={returnForm.order_no} onChange={(e) => setReturnForm({ ...returnForm, order_no: e.target.value })} placeholder="如：RT20260922001" />
              </div>
              <div className="grid gap-1.5">
                <Label>状态</Label>
                <select value={returnForm.status} onChange={(e) => setReturnForm({ ...returnForm, status: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                  {["待退货", "退货中", "已退货", "已拒绝"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>SKU <span className="text-rose-500">*</span></Label>
                <Input value={returnForm.sku} onChange={(e) => setReturnForm({ ...returnForm, sku: e.target.value })} placeholder="如：BT-001-BK" />
              </div>
              <div className="grid gap-1.5">
                <Label>数量</Label>
                <Input type="number" value={returnForm.qty} onChange={(e) => setReturnForm({ ...returnForm, qty: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>供应商</Label>
                <Input value={returnForm.supplier} onChange={(e) => setReturnForm({ ...returnForm, supplier: e.target.value })} placeholder="如：深圳华强电子" />
              </div>
              <div className="grid gap-1.5">
                <Label>仓库</Label>
                <Input value={returnForm.warehouse} onChange={(e) => setReturnForm({ ...returnForm, warehouse: e.target.value })} placeholder="如：美国加州仓" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>退货原因</Label>
              <Input value={returnForm.reason} onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })} placeholder="如：质检不合格 / 错发 / 破损" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>取消</Button>
            <Button onClick={handleReturnSave} disabled={saving}>{saving && <Loader2 size={14} className="mr-1 animate-spin" />}保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认（入库） */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>删除后该入库单将被移除，已联动库存不自动回退。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 删除确认（退货） */}
      <AlertDialog open={!!returnDeleting} onOpenChange={(o) => !o && setReturnDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>删除后该退货单将被移除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleReturnDelete} className="bg-rose-600 hover:bg-rose-700">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
