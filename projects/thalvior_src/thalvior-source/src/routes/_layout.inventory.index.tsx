import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeftRight, Package, Plus, Trash2, Loader2, RefreshCw, UploadCloud, Columns3, Bookmark, Download, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTable, type DataTableColumn, useTableDensity } from "@/components/data-table";
import { FilterBar, SearchField } from "@/components/filter-bar";
import { fetchInventory, insertRow, deleteRow, updateRow, type InventoryRow } from "@/lib/data-access";
import { getStockSyncStatus, pushStockQueueNow, type StockSyncStatusResult } from "@/services/stockSyncService";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import { useColumnPrefs, useNamedViews, type NamedView } from "@/hooks/use-table-prefs";
import { toast } from "sonner";
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
} from "@/components/ui/alert-dialog"
import { fmtDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/_layout/inventory/")({
  component: Inventory,
});

const emptyForm = { sku: "", name: "", warehouse: "", available: "", locked: "", in_transit: "", safety_stock: "" };

function Inventory() {
  const {  t , lang } = useLanguage();
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
  // 第 2 批：行密度（纯展示偏好，按页持久化）
  const [density, setDensity] = useTableDensity("thv.density.inventory");
  // 排序 + 分页状态
  const [sortKey, setSortKey] = useState<string>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  // 库存同步推送状态（P0-4）
  // 表格第一公民（vis2）：列自定义 + 命名视图 + 导出
  const invCols = ["sku", "name", "warehouse", "available", "locked", "in_transit", "safety_stock"] as const;
  const { visible, toggle, reset: resetCols } = useColumnPrefs("inventory", [...invCols]);
  const { views, save: saveViewRaw, remove: removeView } = useNamedViews("inventory");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [stockSyncOpen, setStockSyncOpen] = useState(false);
  const [stockSyncData, setStockSyncData] = useState<StockSyncStatusResult | null>(null);
  const [stockSyncLoading, setStockSyncLoading] = useState(false);
  const [pushing, setPushing] = useState(false);

  const loadStockSync = () => {
    setStockSyncLoading(true);
    getStockSyncStatus()
      .then(setStockSyncData)
      .catch((e) => { console.error(e); toast.error(t("stockSync.loadFail")); })
      .finally(() => setStockSyncLoading(false));
  };

  const handlePushNow = async () => {
    setPushing(true);
    try {
      const r = await pushStockQueueNow();
      if (r.failed > 0) {
        toast.error(t("stockSync.pushResultFail", { n: r.pushed, s: r.success, f: r.failed }));
      } else {
        toast.success(t("stockSync.pushResultOk", { n: r.pushed, s: r.success, k: r.skipped }));
      }
      loadStockSync();
    } catch (e) {
      console.error(e);
      toast.error(t("stockSync.pushFail"));
    } finally {
      setPushing(false);
    }
  };

  // 队列/批次状态值 → 双语（后端值域封闭：待推送/成功/失败/跳过/部分成功）
  const stLabel = (s: string) =>
    s === "待推送" ? t("stockSync.st.pending")
    : s === "成功" ? t("stockSync.st.success")
    : s === "失败" ? t("stockSync.st.failed")
    : s === "跳过" ? t("stockSync.st.skipped")
    : s === "部分成功" ? t("stockSync.st.partial")
    : t("stockSync.st.unknown");
  const triggerLabel = (s: string) => (s === "cron" ? t("stockSync.trigger.cron") : t("stockSync.trigger.manual"));
  const fmtTime = (v: string | null) => (v ? fmtDateTime(v, lang) : "-");

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

  // 命名视图：应用 / 保存 / 删除
  const applyView = (v: NamedView) => {
    const st = v.state as { keyword?: string };
    setKeyword(st.keyword ?? "");
    setPage(1);
  };
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    saveViewRaw(name, { keyword });
    setViewName("");
    setSaveViewOpen(false);
  };

  // 导出 CSV：当前筛选全量
  const exportCsv = () => {
    if (filtered.length === 0) {
      toast.error(t("inv.empty"));
      return;
    }
    const head = ["sku", "name", "warehouse", "available", "locked", "in_transit", "safety_stock", "status"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const r of filtered) {
      lines.push([r.sku, r.name, r.warehouse, r.available, r.locked, r.in_transit, r.safety_stock, r.status].map(esc).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("tbl.exportDone", { v1: filtered.length }));
  };

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
  // 第 2 批：通用数据表列定义（渲染层；取值与含义与原表一致）
  const invColumns: DataTableColumn<InventoryRow>[] = [];
  if (visible("sku"))
    invColumns.push({ key: "sku", header: "SKU", sortable: true, render: (s) => <span className="text-fg-muted">{s.sku}</span> });
  if (visible("name"))
    invColumns.push({ key: "name", header: t("orders.col.product"), sortable: true, render: (s) => <span className="font-medium">{s.name}</span> });
  if (visible("warehouse"))
    invColumns.push({ key: "warehouse", header: t("outbound.warehouse"), sortable: true, render: (s) => <span className="text-fg-muted">{s.warehouse}</span> });
  if (visible("available"))
    invColumns.push({
      key: "available", header: t("inv.availableStock"), sortable: true,
      render: (s) => <span className={cn("font-medium", s.available < s.safety_stock && "text-destructive")}>{s.available}</span>,
    });
  if (visible("locked"))
    invColumns.push({ key: "locked", header: t("inv.lockedStock"), sortable: true, render: (s) => <span className="text-fg-muted">{s.locked}</span> });
  if (visible("in_transit"))
    invColumns.push({ key: "in_transit", header: t("inv.inTransit"), sortable: true, render: (s) => <span className="text-fg-muted">{s.in_transit}</span> });
  if (visible("safety_stock"))
    invColumns.push({ key: "safety_stock", header: t("inv.safetyStock"), sortable: true, render: (s) => <span className="text-fg-muted">{s.safety_stock}</span> });
  invColumns.push({
    key: "status", header: t("common.statusLabel"),
    render: (s) => (
      <span className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        s.available === 0 ? "bg-danger-bg text-destructive border-destructive/30" : s.available < s.safety_stock ? "bg-warning-bg text-warning border-warning/30" : "bg-success-bg text-success border-success/30"
      )}>
        {s.available === 0 ? t("st.outOfStock") : s.available < s.safety_stock ? t("st.low") : t("inv.normal")}
      </span>
    ),
  });
  invColumns.push({
    key: "actions", header: t("common.actions"), align: "right",
    render: (s) => (
      <div className="flex justify-end">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleting(s)}>
          <Trash2 size={15} />
        </Button>
      </div>
    ),
  });

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
            <Button variant="outline" size="sm" onClick={() => { setStockSyncOpen(true); loadStockSync(); }}><RefreshCw size={14} /> {t("stockSync.entry")}</Button>
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
        <div className="rounded-xl border border-warning/30 bg-warning-bg p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle size={15} /> {t("inv.alertTitle", { count: alertCount })}
          </div>
          <div className="space-y-2">
            {stocks.filter((a) => a.available < a.safety_stock).map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl bg-card/70 px-3 py-2 text-sm">
                <span className="font-medium">{a.name}</span>
                <span className="text-fg-muted">{a.warehouse}</span>
                <span className={cn("font-medium", a.available === 0 ? "text-destructive" : "text-warning")}>
                  {t("inv.available")} {a.available} / {t("inv.safety")} {a.safety_stock}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 筛选栏（第 2 批：通用筛选栏容器） */}
      <FilterBar
        meta={t("products.total", { count: filtered.length })}
        actions={
          <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm"><Bookmark size={14} /> {t("tbl.views")}{views.length > 0 ? ` (${views.length})` : ""}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {views.length === 0 && <div className="px-2 py-1.5 text-[12px] text-fg-muted">{t("tbl.viewsEmpty")}</div>}
            {views.map((v) => (
              <div key={v.name} className="flex items-center justify-between gap-1 rounded px-1.5 hover:bg-surface-hover">
                <button className="flex-1 truncate px-1 py-1.5 text-left text-[13px] hover:text-primary" onClick={() => applyView(v)}>{v.name}</button>
                <button className="p-1 text-fg-muted/40 hover:text-destructive" onClick={() => removeView(v.name)} title={t("tbl.deleteView")}>
                  <X size={12} />
                </button>
              </div>
            ))}
            {views.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setSaveViewOpen(true); }}>
              <Plus size={13} /> {t("tbl.saveView")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm"><Columns3 size={14} /> {t("tbl.cols")}</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
            {invCols.map((c) => (
              <DropdownMenuCheckboxItem key={c} checked={visible(c)} onCheckedChange={() => toggle(c)} onSelect={(e) => e.preventDefault()}>
                {c === "sku" ? "SKU" : c === "name" ? t("orders.col.product") : c === "warehouse" ? t("outbound.warehouse") : c === "available" ? t("inv.availableStock") : c === "locked" ? t("inv.lockedStock") : c === "in_transit" ? t("inv.inTransit") : t("inv.safetyStock")}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => resetCols()}><X size={13} /> {t("tbl.colsReset")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download size={14} /> {t("tbl.export")}
        </Button>
          </>}
      >
        <SearchField
          value={keyword}
          onChange={(v) => { setKeyword(v); setPage(1); }}
          placeholder={t("inv.searchPlaceholder")}
        />
      </FilterBar>

      {/* 库存表格（第 2 批：通用数据表容器） */}
      <DataTable
        columns={invColumns}
        rows={paged}
        rowKey={(s) => s.id}
        loading={loading}
        emptyState={<EmptyState text={t("inv.empty")} />}
        showEmptyState={filtered.length === 0}
        sortKey={sortKey}
        sortDirection={sortDir}
        onSort={handleSort}
        density={density}
        onDensityChange={setDensity}
        densityLabels={{ compact: t("tbl.densityCompact"), cozy: t("tbl.densityCozy") }}
        pagination={
          !loading && sorted.length > 0
            ? {
                page,
                pageCount,
                total: sorted.length,
                info: t("common.pageInfo", { page, pageCount, total: sorted.length }),
                onPageChange: (p) => setPage(Math.max(1, Math.min(pageCount, p))),
                prevLabel: t("common.prev"),
                nextLabel: t("common.next"),
              }
            : undefined
        }
      />

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
                <Label>SKU <span className="text-destructive">*</span></Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder={tt('orders.ph.sku')} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("orders.col.product")} <span className="text-destructive">*</span></Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tt('orders.ph.product')} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("outbound.warehouse")}</Label>
              <Input value={form.warehouse} onChange={(e) => setForm({ ...form, warehouse: e.target.value })} placeholder={tt('ful.ph.warehouse')} />
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
              <Label>SKU <span className="text-destructive">*</span></Label>
              <Input value={transfer.sku} onChange={(e) => setTransfer({ ...transfer, sku: e.target.value })} placeholder={tt('orders.ph.sku')} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("inv.sourceWarehouse")} <span className="text-destructive">*</span></Label>
                <Input value={transfer.from} onChange={(e) => setTransfer({ ...transfer, from: e.target.value })} placeholder={tt('ful.ph.warehouse')} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("inv.targetWarehouse")} <span className="text-destructive">*</span></Label>
                <Input value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })} placeholder={tt('inv.whNamePh')} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("inv.transferQty")} <span className="text-destructive">*</span></Label>
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

      {/* 库存同步状态弹窗（P0-4） */}
      <Dialog open={stockSyncOpen} onOpenChange={setStockSyncOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("stockSync.title")}</DialogTitle>
            <DialogDescription>{t("stockSync.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <StatCard label={t("stockSync.pending")} value={String(stockSyncData?.queue_summary.pending ?? 0)} icon={<UploadCloud size={18} />} />
              <StatCard label={t("stockSync.failed")} value={String(stockSyncData?.queue_summary.failed ?? 0)} icon={<AlertTriangle size={18} />} />
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium">{t("stockSync.recentPushes")}</div>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface-sunken text-left text-fg-muted">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">SKU</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("stockSync.col.shop")}</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("stockSync.col.change")}</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("stockSync.col.status")}</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("stockSync.col.time")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockSyncLoading ? (
                      <tr><td colSpan={5} className="px-3 py-6 text-center text-fg-muted align-middle"><Loader2 size={15} className="mx-auto mb-1 animate-spin" /></td></tr>
                    ) : !stockSyncData?.recent_pushes.length ? (
                      <tr><td colSpan={5}><EmptyState text={t("stockSync.empty")} iconSize={28} className="py-6" /></td></tr>
                    ) : stockSyncData.recent_pushes.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium align-middle">{p.local_sku}</td>
                        <td className="px-3 py-2 text-fg-muted align-middle">{p.shop_auths?.shop_name ?? "-"}</td>
                        <td className="px-3 py-2 align-middle">{p.old_qty} → {p.new_qty}</td>
                        <td className="px-3 py-2 align-middle">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 font-medium"
                            title={p.error ?? undefined}
                          >
                            {stLabel(p.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-fg-muted align-middle">{fmtTime(p.pushed_at ?? p.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium">{t("stockSync.recentLogs")}</div>
              <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-xl border border-border bg-surface-sunken/20 p-2">
                {stockSyncLoading ? (
                  <div className="py-4 text-center text-fg-muted"><Loader2 size={15} className="mx-auto animate-spin" /></div>
                ) : !stockSyncData?.recent_logs.length ? (
                  <EmptyState text={t("stockSync.empty")} iconSize={28} className="py-4" />
                ) : stockSyncData.recent_logs.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card/70 px-2.5 py-1.5 text-xs">
                    <span className="text-fg-muted">{fmtTime(l.created_at)}</span>
                    <span className="rounded-full border px-2 py-0.5">{triggerLabel(l.trigger_type)}</span>
                    <span className="font-medium">{stLabel(l.status)}</span>
                    <span className="text-fg-muted">
                      {t("stockSync.batchStat", { n: l.pushed_count, s: l.success_count, f: l.failed_count, k: l.skipped_count })}
                      <span className="ml-1">({l.duration_ms}ms)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={loadStockSync} disabled={stockSyncLoading}>
              <RefreshCw size={14} /> {t("stockSync.refresh")}
            </Button>
            <Button onClick={handlePushNow} disabled={pushing}>
              {pushing ? <Loader2 size={14} className="mr-1 animate-spin" /> : <UploadCloud size={14} className="mr-1" />}
              {pushing ? t("stockSync.pushing") : t("stockSync.pushNow")}
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
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    {/* 保存命名视图 */}
    <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("tbl.saveView")}</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={viewName}
          placeholder={t("tbl.viewNamePh")}
          onChange={(e) => setViewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveView();
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => setSaveViewOpen(false)}>{t("common.cancel")}</Button>
          <Button onClick={saveView} disabled={!viewName.trim()}>{t("common.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}