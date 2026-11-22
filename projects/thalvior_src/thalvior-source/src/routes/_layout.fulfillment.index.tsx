import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, RefreshCw, AlertTriangle, TrendingUp, CheckCircle2, PackagePlus, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchTable, insertRow, updateRow, deleteRow, fetchInventory, type ExtRow, type InventoryRow } from "@/lib/data-access";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { tt } from "@/i18n/tts";
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
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [stocks, setStocks] = useState<InventoryRow[]>([]);
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
        toast.success(t("ful.toast.noNeed"));
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
      toast.success(t("ful.toast.generated", { created, updated }));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ful.toast.generateFailed"));
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
        const nextStatus = lv === "充足" ? tt('st.stocked') : lv === "偏低" ? tt('st.stocking') : tt('st.toStock');
        if (nextStatus !== r.status) {
          await updateRow("fulfillment_plans", r.id, { status: nextStatus });
          updated++;
        }
      }
      toast.success(t("ful.toast.synced", { count: updated }));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("ful.toast.syncFailed"));
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
      status: String(row.status ?? tt('st.toStock')),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.sku.trim()) {
      toast.error(t("ful.toast.skuRequired"));
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
      toast.success(t("ful.toast.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed"));
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
      toast.error(e instanceof Error ? e.message : t("common.deleteFailed"));
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("ful.title")}
        description={t("ful.desc")}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
              {generating ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <PackagePlus size={15} className="mr-1.5" />}
              {t("ful.generate")}
            </Button>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <RefreshCw size={15} className="mr-1.5" />}
              {t("ful.sync")}
            </Button>
            <Button size="sm" onClick={openAdd}>
              <Plus size={15} className="mr-1.5" /> {t("ful.add")}
            </Button>
          </div>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label={t("ful.stat.out")} value={String(stockStats.out)} icon={<AlertTriangle size={17} />} tone="warning" />
        <StatCard label={t("ful.stat.low")} value={String(stockStats.low)} icon={<TrendingUp size={17} />} tone="violet" />
        <StatCard label={t("ful.stat.ok")} value={String(stockStats.ok)} icon={<CheckCircle2 size={17} />} tone="success" />
        <StatCard label={t("ful.stat.total")} value={String(totalQty)} icon={<Boxes size={17} />} tone="primary" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">{t("ful.col.product")}</th>
              <th className="px-4 py-3 font-medium">{t("ful.col.warehouse")}</th>
              <th className="px-4 py-3 font-medium">{t("ful.col.stock")}</th>
              <th className="px-4 py-3 font-medium">{t("ful.col.qty")}</th>
              <th className="px-4 py-3 font-medium">{t("common.status")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> {t("ful.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  {t("ful.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const st = stocks.find((s) => s.sku === row.sku && (s.warehouse ?? "") === (row.warehouse ?? ""));
                return (
                  <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-primary">{String(row.sku ?? "")}</td>
                    <td className="px-4 py-3 font-medium">{String(row.product ?? "")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.warehouse ?? "")}</td>
                    <td className="px-4 py-3">
                      <span className={stockLevel(Number(st?.available) || 0, Number(st?.safety_stock) || 0) === "缺货" ? "font-semibold text-destructive" : "text-muted-foreground"}>
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
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleting(row)}>
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
            <DialogTitle>{editing ? t("ful.edit") : t("ful.add")}</DialogTitle>
            <DialogDescription>{t("ful.dialogDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>SKU <span className="text-destructive">*</span></Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder={t("orders.ph.sku")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("ful.col.product")}</Label>
                <Input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder={t("orders.ph.product")} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("ful.col.warehouse")}</Label>
                <Input value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder={t("ful.ph.warehouse")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("ful.col.qty")}</Label>
                <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("common.status")}</Label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {[tt('st.toStock'), tt('st.stocking'), tt('st.stocked')].map((o) => (
                  <option key={o} value={o}>{t(`status.${o}`)}</option>
                ))}
              </select>
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
            <AlertDialogTitle>{t("ful.confirmDeleteQ")}</AlertDialogTitle>
            <AlertDialogDescription>{t("ful.deleteDesc")}</AlertDialogDescription>
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
