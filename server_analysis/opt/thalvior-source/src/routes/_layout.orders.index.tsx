import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Filter, Printer, PackageCheck, Plus, Trash2, Loader2, RefreshCw, AlertTriangle, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchOrders, insertRow, deleteRow, updateRows, type OrderRow } from "@/lib/data-access";
import { ShippingLabelDialog, type ShippingLabelData } from "@/components/shipping-label";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
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

export const Route = createFileRoute("/_layout/orders/")({
  component: Orders,
});

const statusTabs = ["全部", "待审核", "待发货", "已发货", "已完成", "售后中"];

const emptyForm = { buyer: "", product: "", sku: "", channel: "", amount: "", currency: "USD", status: "待审核", address: "" };

function Orders() {
  const { t } = useLanguage();
  const [keyword, setKeyword] = useState("");
  const [tab, setTab] = useState("全部");
  const [selected, setSelected] = useState<string[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<OrderRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [shipping, setShipping] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterChannel, setFilterChannel] = useState("");
  const [labelData, setLabelData] = useState<ShippingLabelData | null>(null);
  // 排序 + 分页
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const load = () => {
    fetchOrders()
      .then(setOrders)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // 一键刷新订单（自动拉单）
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetchOrders().then(setOrders);
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  };

  // 异常订单：待审核超时或售后中订单视为需关注
  const abnormalCount = orders.filter((o) => o.status === "售后中").length;

  const filtered = orders.filter((o) => {
    const matchTab = tab === "全部" || o.status === tab;
    const matchKw =
      o.id.toLowerCase().includes(keyword.toLowerCase()) ||
      o.buyer.toLowerCase().includes(keyword.toLowerCase()) ||
      o.product.toLowerCase().includes(keyword.toLowerCase());
    const matchChannel = !filterChannel || o.channel === filterChannel;
    return matchTab && matchKw && matchChannel;
  });

  const channels = Array.from(new Set(orders.map((o) => o.channel)));

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
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  // 打印面单：打开标准面单弹窗（优先打印选中订单，否则打印当前筛选第一条）
  const handlePrint = () => {
    const target = selected.length > 0
      ? orders.find((o) => o.id === selected[0])
      : filtered[0];
    if (!target) {
      toast.error(t("orders.noPrint"));
      return;
    }
    console.log("[orders] 打开面单", { id: target.id });
    setLabelData({
      orderId: target.id,
      buyer: target.buyer,
      product: target.product,
      sku: target.sku,
      channel: target.channel,
      amount: target.amount,
      currency: target.currency,
      createdAt: target.created_at,
      address: target.address,
    });
  };

  const toggleAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map((o) => o.id));
  const toggleOne = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleSave = async () => {
    if (!form.buyer.trim() || !form.product.trim()) {
      toast.error(t("orders.requiredHint"));
      return;
    }
    setSaving(true);
    try {
      await insertRow("orders", {
        buyer: form.buyer,
        product: form.product,
        sku: form.sku,
        channel: form.channel,
        amount: Number(form.amount) || 0,
        currency: form.currency,
        status: form.status,
        address: form.address,
      });
      setDialogOpen(false);
      setForm(emptyForm);
      toast.success(t("common.created"));
      load();
    } catch (e) {
      console.error(e);
      toast.error(t("common.failed", { reason: (e as Error).message }));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("orders", deleting.id);
      setDeleting(null);
      toast.success(t("common.deleted"));
      load();
    } catch (e) {
      console.error(e);
      toast.error(t("common.failed", { reason: (e as Error).message }));
      setDeleting(null);
    }
  };

  // 批量发货：将选中的「待发货」订单批量更新为「已发货」
  const handleBatchShip = async () => {
    const shippable = selected.filter((id) => {
      const o = orders.find((x) => x.id === id);
      return o && o.status === "待发货";
    });
    if (shippable.length === 0) return;
    setShipping(true);
    try {
      await updateRows("orders", shippable, { status: "已发货" });
      setSelected([]);
      toast.success(t("orders.shipped", { count: shippable.length }));
      load();
    } catch (e) {
      console.error(e);
      toast.error(t("common.failed", { reason: (e as Error).message }));
    } finally {
      setShipping(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("orders.title")}
        description={t("orders.desc")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> {t("orders.refresh")}
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}><Plus size={15} /> {t("orders.add")}</Button>
          </div>
        }
      />

      {/* 异常订单提醒 */}
      {abnormalCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{t("orders.abnormal", { count: abnormalCount })}</span>
        </div>
      )}

      {/* 状态 Tab */}
      <div className="flex items-center gap-1 border-b border-border">
        {statusTabs.map((s) => (
          <button
            key={s}
            onClick={() => setTab(s)}
            className={`relative px-4 py-2.5 text-sm transition-colors ${
              tab === s ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s === "全部" ? t("orders.all") : t(`status.${s}`)}
            {tab === s && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />}
          </button>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("orders.search")} value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <Button variant="outline" size="sm" onClick={() => setFilterOpen(true)}><Filter size={14} /> {t("orders.filter")}</Button>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}><Printer size={14} /> {t("orders.print")}</Button>
          <Button size="sm" onClick={handleBatchShip} disabled={shipping || selected.length === 0}>
            {shipping ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />} {t("orders.batchShip")}
          </Button>
        </div>
      </div>

      {/* 订单表格 */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleAll} className="accent-primary" />
              </th>
              {(["orderNo", "buyer", "product", "channel", "amount", "status", "time"] as const).map((key) => (
                <th
                  key={key}
                  className="cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium hover:text-foreground"
                  onClick={() => handleSort(key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {t(`orders.col.${key}`)}
                    {sortKey === key &&
                      (sortDir === "asc" ? <ArrowUp size={12} className="text-primary" /> : <ArrowDown size={12} className="text-primary" />)}
                  </span>
                </th>
              ))}
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
                  {t("orders.empty")}
                </td>
              </tr>
            ) : paged.map((o) => (
              <tr key={o.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggleOne(o.id)} className="accent-primary" />
                </td>
                <td className="px-4 py-3 font-medium text-primary">
                  <Link to="/orders/$id" params={{ id: o.id }} className="hover:underline">{o.id}</Link>
                </td>
                <td className="px-4 py-3">{o.buyer}</td>
                <td className="px-4 py-3 text-muted-foreground">{o.product}</td>
                <td className="px-4 py-3 text-muted-foreground">{o.channel}</td>
                <td className="px-4 py-3 font-medium">{o.currency === "USD" ? "$" : "¥"}{o.amount.toFixed(2)}</td>
                <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                <td className="px-4 py-3 text-muted-foreground">{o.created_at}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-600" onClick={() => setDeleting(o)}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
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

      {/* 新增订单弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orders.add")}</DialogTitle>
            <DialogDescription>{t("orders.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("orders.buyer")} <span className="text-rose-500">*</span></Label>
              <Input value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} placeholder="如：John Smith" />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("orders.col.product")} <span className="text-rose-500">*</span></Label>
              <Input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder="如：无线蓝牙耳机 Pro" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("orders.sku")}</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="如：BT-001-BK" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("orders.col.channel")}</Label>
                <Input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="如：Amazon US" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("orders.col.amount")}</Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="如：39.99" />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("orders.currency")}</Label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="USD">USD</option>
                  <option value="CNY">CNY</option>
                  <option value="JPY">JPY</option>
                  <option value="EUR">EUR</option>
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("orders.col.status")}</Label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {statusTabs.filter((s) => s !== "全部").map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("orders.address")}</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="如：123 Main St, Los Angeles, CA 90001, USA" />
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
            <AlertDialogDescription>{t("orders.confirmDelete", { id: deleting?.id ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 高级筛选弹窗 */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orders.filter")}</DialogTitle>
            <DialogDescription>{t("orders.filterDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("orders.channel")}</Label>
              <select
                value={filterChannel}
                onChange={(e) => setFilterChannel(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("orders.allChannel")}</option>
                {channels.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFilterChannel("")}>{t("orders.reset")}</Button>
            <Button onClick={() => setFilterOpen(false)}>{t("orders.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 面单打印弹窗 */}
      <ShippingLabelDialog open={!!labelData} onOpenChange={(o) => !o && setLabelData(null)} data={labelData} />
    </div>
  );
}