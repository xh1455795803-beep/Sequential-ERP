import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeftRight, Package, Search, Plus, Trash2, Loader2, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchInventory, insertRow, deleteRow, updateRow, type InventoryRow } from "@/lib/data-access";
import { cn } from "@/lib/utils";
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

export const Route = createFileRoute("/_layout/inventory/")({
  component: Inventory,
});

const emptyForm = { sku: "", name: "", warehouse: "", available: "", locked: "", in_transit: "", safety_stock: "" };

function Inventory() {
  const { t } = useLanguage();
  const [keyword, setKeyword] = useState("");
  const [stocks, setStocks] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<InventoryRow | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState({ sku: "", from: "", to: "", qty: "" });
  const [transferring, setTransferring] = useState(false);
  // 排序 + 分页状态
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = () => {
    fetchInventory()
      .then(setStocks)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = stocks.filter(
    (s) =>
      s.sku.toLowerCase().includes(keyword.toLowerCase()) ||
      s.name.toLowerCase().includes(keyword.toLowerCase()) ||
      s.warehouse.toLowerCase().includes(keyword.toLowerCase())
  );

  // 排序 + 分页
  const sorted = [...filtered].sort((a, b) => {
    if (!sortKey) return 0;
    const av = a[sortKey as keyof typeof a] as unknown;
    const bv = b[sortKey as keyof typeof b] as unknown;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp =
      typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), "zh-Hans-CN");
    return sortDir === "asc" ? cmp : -cmp;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const handleSort = (key: string) => {
    setPage(1);
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const totalAvailable = stocks.reduce((sum, s) => sum + s.available, 0);
  const alertCount = stocks.filter((s) => s.available < s.safety_stock).length;

  const handleSave = async () => {
    if (!form.sku.trim() || !form.name.trim()) {
      toast.error(t("inv.requiredHint"));
      return;
    }
    setSaving(true);
    try {
      await insertRow("inventory", {
        sku: form.sku,
        name: form.name,
        warehouse: form.warehouse,
        available: Number(form.available) || 0,
        locked: Number(form.locked) || 0,
        in_transit: Number(form.in_transit) || 0,
        safety_stock: Number(form.safety_stock) || 0,
      });
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success(t("common.created"));
      load();
    } catch (e) {
      console.error(e);
      toast.error(t("common.failed", { reason: e instanceof Error ? e.message : "" }));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("inventory", deleting.id);
      setDeleting(null);
      toast.success(t("common.deleted"));
      load();
    } catch (e) {
      console.error(e);
      setDeleting(null);
      toast.error(t("common.failed", { reason: e instanceof Error ? e.message : "" }));
    }
  };

  // 创建调拨单：从源仓扣减可用库存，目标仓增加在途库存
  const handleTransfer = async () => {
    const qty = Number(transfer.qty);
    if (!transfer.sku.trim() || !transfer.from.trim() || !transfer.to.trim() || qty <= 0) return;
    const source = stocks.find((s) => s.sku === transfer.sku && s.warehouse === transfer.from);
    if (!source || source.available < qty) return;
    setTransferring(true);
    try {
      await updateRow("inventory", source.id, { available: source.available - qty });
      const target = stocks.find((s) => s.sku === transfer.sku && s.warehouse === transfer.to);
      if (target) {
        await updateRow("inventory", target.id, { in_transit: target.in_transit + qty });
      }
      toast.success(t("inv.transferred", { qty, sku: transfer.sku }));
      setTransferOpen(false);
      setTransfer({ sku: "", from: "", to: "", qty: "" });
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setTransferring(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("inv.title")}
        description={t("inv.desc")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)}><ArrowLeftRight size={14} /> {t("inv.transfer")}</Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}><Plus size={14} /> {t("inv.add")}</Button>
          </div>
        }
      />

      {/* 统计 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t("inv.totalAvailable")} value={totalAvailable.toLocaleString()} icon={<Package size={18} />} />
        <StatCard label={t("inv.alert")} value={String(alertCount)} delta={t("inv.needHandle")} trend="down" icon={<AlertTriangle size={18} />} />
        <StatCard label={t("inv.inTransit")} value={stocks.reduce((s, x) => s + x.in_transit, 0).toLocaleString()} icon={<ArrowLeftRight size={18} />} />
      </div>

      {/* 预警条 */}
      {alertCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700">
            <AlertTriangle size={15} /> {t("inv.alertTitle", { count: alertCount })}
          </div>
          <div className="space-y-2">
            {stocks.filter((a) => a.available < a.safety_stock).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-sm">
                <span className="font-medium">{a.name}</span>
                <span className="text-muted-foreground">{a.warehouse}</span>
                <span className={cn("font-medium", a.available === 0 ? "text-rose-600" : "text-amber-600")}>
                  {t("inv.available")} {a.available} / {t("inv.safety")} {a.safety_stock}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 搜索 */}
      <div className="relative w-64">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder={t("inv.searchPlaceholder")} value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} className="pl-9" />
      </div>

      {/* 库存表格 */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              {(["sku", "name", "warehouse", "available", "locked", "in_transit", "safety_stock"] as const).map((key) => (
                <th
                  key={key}
                  className="cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium hover:text-foreground"
                  onClick={() => handleSort(key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {key === "sku" ? "SKU" : key === "name" ? t("商品") : key === "warehouse" ? t("仓库") : key === "available" ? t("inv.availableStock") : key === "locked" ? t("inv.lockedStock") : key === "in_transit" ? t("inv.inTransit") : t("inv.safetyStock")}
                    {sortKey === key &&
                      (sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />)}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 font-medium">{t("状态")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
                  {t("common.loading")}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  {t("inv.empty")}
                </td>
              </tr>
            ) : paged.map((s) => {
              const low = s.available < s.safety_stock;
              return (
                <tr key={s.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 text-muted-foreground">{s.sku}</td>
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.warehouse}</td>
                  <td className={cn("px-4 py-3 font-medium", low && "text-rose-600")}>{s.available}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.locked}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.in_transit}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.safety_stock}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                      s.available === 0 ? "bg-rose-50 text-rose-600 border-rose-200" : low ? "bg-amber-50 text-amber-600 border-amber-200" : "bg-emerald-50 text-emerald-600 border-emerald-200"
                    )}>
                      {s.available === 0 ? t("缺货") : low ? t("偏低") : t("inv.normal")}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-600" onClick={() => setDeleting(s)}>
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 分页栏 */}
      {!loading && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <span className="text-xs text-muted-foreground">
            {t("common.pageInfo", { page, pageCount, total: sorted.length })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={14} /> {t("common.prev")}
            </Button>
            <span className="min-w-10 text-center text-sm text-muted-foreground">{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              {t("common.next")} <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* 新增库存弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inv.addTitle")}</DialogTitle>
            <DialogDescription>{t("inv.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>SKU <span className="text-rose-500">*</span></Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="如：BT-001-BK" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("商品")} <span className="text-rose-500">*</span></Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：无线蓝牙耳机 Pro" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("仓库")}</Label>
              <Input value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder="如：美国加州仓" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("inv.availableStock")}</Label>
                <Input type="number" value={form.available} onChange={(e) => setForm({ ...form, available: e.target.value })} placeholder="0" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("inv.lockedStock")}</Label>
                <Input type="number" value={form.locked} onChange={(e) => setForm({ ...form, locked: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("inv.inTransit")}</Label>
                <Input type="number" value={form.in_transit} onChange={(e) => setForm({ ...form, in_transit: e.target.value })} placeholder="0" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("inv.safetyStock")}</Label>
                <Input type="number" value={form.safety_stock} onChange={(e) => setForm({ ...form, safety_stock: e.target.value })} placeholder="0" />
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

      {/* 创建调拨单弹窗 */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inv.transferTitle")}</DialogTitle>
            <DialogDescription>{t("inv.transferDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>SKU <span className="text-rose-500">*</span></Label>
              <Input value={transfer.sku} onChange={(e) => setTransfer({ ...transfer, sku: e.target.value })} placeholder="如：BT-001-BK" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("inv.sourceWarehouse")} <span className="text-rose-500">*</span></Label>
                <Input value={transfer.from} onChange={(e) => setTransfer({ ...transfer, from: e.target.value })} placeholder="如：美国加州仓" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("inv.targetWarehouse")} <span className="text-rose-500">*</span></Label>
                <Input value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })} placeholder="如：德国法兰克福仓" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("inv.transferQty")} <span className="text-rose-500">*</span></Label>
              <Input type="number" value={transfer.qty} onChange={(e) => setTransfer({ ...transfer, qty: e.target.value })} placeholder="0" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleTransfer} disabled={transferring}>
              {transferring && <Loader2 size={14} className="mr-1 animate-spin" />}{t("inv.confirmTransfer")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("inv.deleteDesc", { name: deleting?.name ?? "" })}</AlertDialogDescription>
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