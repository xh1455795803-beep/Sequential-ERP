import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, PackageMinus, PackageCheck, Truck, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow, fetchInventory, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";
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

export const Route = createFileRoute("/_layout/fulfillment/outbound")({
  component: Outbound,
});

const emptyForm = { order_no: "", warehouse: "", sku: "", qty: "", status: "待出库" };

function Outbound() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    fetchTable("outbound_orders")
      .then(setRows)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row: ExtRow) => {
    setEditing(row);
    setForm({
      order_no: String(row.order_no ?? ""),
      warehouse: String(row.warehouse ?? ""),
      sku: String(row.sku ?? ""),
      qty: String(row.qty ?? ""),
      status: String(row.status ?? "待出库"),
    });
    setDialogOpen(true);
  };

  // 保存：新增或编辑出库单；状态改为「已出库」时联动扣减库存
  const handleSave = async () => {
    if (!form.order_no.trim()) {
      toast.error(t("common.required", { label: t("outbound.orderNo") }));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        order_no: form.order_no.trim(),
        warehouse: form.warehouse.trim(),
        sku: form.sku.trim(),
        qty: Number(form.qty) || 0,
        status: form.status,
      };
      const prevStatus = editing ? String(editing.status ?? "") : "";
      if (editing) {
        await updateRow("outbound_orders", editing.id, payload);
      } else {
        await insertRow("outbound_orders", payload);
      }
      // 状态流转到「已出库」时联动扣减库存（仅从非终态变为终态时触发一次）
      if (payload.status === "已出库" && prevStatus !== "已出库" && payload.sku && payload.qty > 0) {
        await applyStockOut(payload.sku, payload.warehouse, payload.qty);
        toast.success(t("outbound.stockOutDone", { qty: payload.qty }));
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("outbound.stockOutFail"));
    } finally {
      setSaving(false);
    }
  };

  // 出库联动：按 sku+warehouse 找到库存记录扣减 available
  const applyStockOut = async (sku: string, warehouse: string, qty: number) => {
    const stocks = await fetchInventory();
    const target = stocks.find((s) => s.sku === sku && s.warehouse === warehouse);
    if (!target) {
      throw new Error(t("outbound.noSku"));
    }
    if (target.available < qty) {
      throw new Error(t("outbound.insufficient", { available: target.available }));
    }
    await updateRow("inventory", target.id, { available: target.available - qty });
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("outbound_orders", deleting.id);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.delete"));
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("outbound.title")}
        description={t("outbound.desc")}
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={15} /> {t("outbound.add")}
          </Button>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="待出库"
          value={String(rows.filter((r) => r.status === "待出库" || r.status === "出库中").length)}
          icon={<PackageMinus size={17} />}
          tone="warning"
        />
        <StatCard
          label="已出库"
          value={String(rows.filter((r) => r.status === "已出库").length)}
          icon={<PackageCheck size={17} />}
          tone="success"
        />
        <StatCard
          label="累计出库量"
          value={String(rows.filter((r) => r.status === "已出库").reduce((a, r) => a + (Number(r.qty) || 0), 0))}
          icon={<Truck size={17} />}
          tone="primary"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("outbound.orderNo")}</th>
              <th className="px-4 py-3 font-medium">{t("outbound.warehouse")}</th>
              <th className="px-4 py-3 font-medium">{t("outbound.sku")}</th>
              <th className="px-4 py-3 font-medium">{t("outbound.qty")}</th>
              <th className="px-4 py-3 font-medium">{t("outbound.status")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> {t("common.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">{t("common.empty")}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{String(row.order_no ?? "")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(row.warehouse ?? "")}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(row.sku ?? "")}</td>
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t("common.edit") : t("outbound.add")}</DialogTitle>
            <DialogDescription>{editing ? t("common.editDesc") : t("common.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("outbound.orderNo")} <span className="text-rose-500">*</span></Label>
              <Input value={form.order_no} onChange={(e) => setForm({ ...form, order_no: e.target.value })} placeholder="如：OB20260922001" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("outbound.warehouse")}</Label>
                <Input value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder="如：美国加州仓" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("outbound.status")}</Label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {["待出库", "出库中", "已出库"].map((o) => (
                    <option key={o} value={o}>{t(o)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("outbound.sku")}</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="如：BT-001-BK" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("outbound.qty")}</Label>
                <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}{t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("common.confirmDeleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}