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
import { useLanguage } from "@/i18n/LanguageContext";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/purchase/plan")({
  component: Plan,
});

const emptyForm = { sku: "", product: "", qty: "", supplier: "", status: "待采购" };

function Plan() {
  const { t } = useLanguage();
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
      supplier: String(row.supplier ?? ""), status: String(row.status ?? tt('st.toPurchase')),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.sku.trim() || !form.product.trim()) { toast.error(t("pur.toast.planSkuProductRequired")); return; }
    setSaving(true);
    try {
      const payload = {
        sku: form.sku.trim(), product: form.product.trim(), qty: Number(form.qty) || 0,
        supplier: form.supplier.trim(), status: form.status,
      };
      if (editing) { await updateRow("purchase_plans", editing.id, payload); toast.success(t("pur.toast.planUpdated")); }
      else { await insertRow("purchase_plans", payload); toast.success(t("pur.toast.planCreated")); }
      setDialogOpen(false); setForm(emptyForm); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : t("common.saveFailed")); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("purchase_plans", deleting.id);
      setDeleting(null); toast.success(t("pur.toast.deleted")); load();
    } catch (e) { toast.error(e instanceof Error ? e.message : t("common.deleteFailed")); setDeleting(null); }
  };

  // 状态流转：待采购 → 采购中 → 已完成
  const transit = async (row: any, next: string) => {
    setTransiting(row.id);
    try {
      await updateRow("purchase_plans", row.id, { status: next });
      toast.success(next === "采购中" ? t("pur.toast.purchaseStarted") : next === "已完成" ? t("pur.toast.purchaseCompleted") : t("pur.toast.statusUpdated"));
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : t("pur.toast.statusUpdateFailed")); }
    finally { setTransiting(null); }
  };

  // 生成入库单：把已完成计划写入 inbound_orders
  const createInbound = async (row: any) => {
    setTransiting(row.id);
    try {
      await insertRow("inbound_orders", {
        order_no: "IB" + Date.now().toString().slice(-8),
        warehouse: tt('pur.defaultWarehouse'),
        sku: row.sku,
        qty: row.qty || 0,
        status: "待入库",
      });
      toast.success(t("pur.toast.inboundCreated"));
      load();
    } catch (e) { toast.error(e instanceof Error ? e.message : t("pur.toast.inboundCreateFailed")); }
    finally { setTransiting(null); }
  };

  const count = (s: string) => rows.filter((r) => r.status === s).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("pur.plan.title")}
        description={t("pur.plan.desc")}
        actions={
          <div className="flex gap-2">
            <Link to="/purchase/suggestion">
              <Button size="sm" variant="outline">
                <Lightbulb size={15} className="mr-1.5" /> {t("pur.plan.suggestion")}
              </Button>
            </Link>
            <Button size="sm" onClick={openAdd}><Plus size={15} className="mr-1.5" /> {t("pur.plan.addBtn")}</Button>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-4">
        <StatCard label={t("st.toPurchase")} value={String(count("待采购"))} icon={<ShoppingCart size={17} />} tone="warning" />
        <StatCard label={t("st.purchasing")} value={String(count("采购中"))} icon={<PlayCircle size={17} />} tone="primary" />
        <StatCard label={t("nav.orders.completed")} value={String(count("已完成"))} icon={<CheckCircle2 size={17} />} tone="success" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h3 className="font-display text-sm font-semibold text-fg">{t("pur.plan.listTitle", { n: rows.length })}</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-sunken text-left text-xs text-fg-muted">
              <th className="px-5 py-3 font-medium whitespace-nowrap">SKU</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">{t("orders.col.product")}</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">{t("pur.plan.colQty")}</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">{t("common.supplier")}</th>
              <th className="px-4 py-3 font-medium whitespace-nowrap">{t("common.statusLabel")}</th>
              <th className="px-4 py-3 text-right font-medium whitespace-nowrap">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-fg-muted align-middle"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{t("common.loading")}</td></tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-fg-muted align-middle">
                  {t("pur.plan.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-surface-hover">
                  <td className="px-5 py-3 font-mono text-xs font-medium text-primary align-middle whitespace-nowrap">{row.sku}</td>
                  <td className="px-4 py-3 font-medium text-fg align-middle">{row.product}</td>
                  <td className="px-4 py-3 align-middle">{row.qty}</td>
                  <td className="px-4 py-3 text-fg-muted align-middle">{row.supplier || "—"}</td>
                  <td className="px-4 py-3 align-middle"><StatusBadge status={String(row.status ?? "")} /></td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex justify-end gap-1">
                      {row.status === "待采购" && (
                        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs text-primary" onClick={() => transit(row, tt('st.purchasing'))} disabled={transiting === row.id}>
                          <PlayCircle size={13} /> {t("pur.plan.startBtn")}
                        </Button>
                      )}
                      {row.status === "采购中" && (
                        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs text-success" onClick={() => transit(row, tt('nav.orders.completed'))} disabled={transiting === row.id}>
                          <CheckCircle2 size={13} /> {t("pur.plan.doneBtn")}
                        </Button>
                      )}
                      {row.status === "已完成" && (
                        <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" onClick={() => createInbound(row)} disabled={transiting === row.id}>
                          <PackagePlus size={13} /> {t("pur.plan.inboundBtn")}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}><Pencil size={15} /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleting(row)}><Trash2 size={15} /></Button>
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
            <DialogTitle>{editing ? t("pur.plan.editTitle") : t("pur.plan.addTitle")}</DialogTitle>
            <DialogDescription>{editing ? t("pur.plan.editDesc") : t("pur.plan.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>SKU <span className="text-destructive">*</span></Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder={t("pur.ph.sku")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("pur.plan.productName")} <span className="text-destructive">*</span></Label>
                <Input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder={t("pur.ph.product")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("pur.plan.colQty")}</Label>
                <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder={t("pur.ph.qty")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("common.supplier")}</Label>
                <Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} placeholder={t("pur.ph.supplier")} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("common.statusLabel")}</Label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-soft focus:outline-none focus:ring-1 focus:ring-ring">
                {[tt('st.toPurchase'), tt('st.purchasing'), tt('nav.orders.completed')].map((s) => <option key={s} value={s}>{t(s)}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>{saving && <Loader2 size={14} className="mr-1 animate-spin" />}{t("common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pur.confirmQ")}</AlertDialogTitle>
            <AlertDialogDescription>{t("pur.plan.delDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
