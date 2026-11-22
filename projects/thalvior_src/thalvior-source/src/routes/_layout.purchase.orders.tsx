import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Plus, Loader2, ShoppingCart, PackageCheck, Truck, ClipboardList, Search,
  ExternalLink, Ban, ArrowRight, Boxes, Coins,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { DataTable, type DataTableColumn, useTableDensity } from "@/components/data-table";
import { FilterBar, SearchField } from "@/components/filter-bar";
import { EmptyState } from "@/components/empty-state";
import { fetchTable, insertRow, updateRow, callRpc, fetchProducts, fetchInventory, type ExtRow, type ProductRow, type InventoryRow } from "@/lib/data-access";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/purchase/orders")({
  component: Page_PurchaseOrders,
});

const STATUSES = ["待采购", "已下单", "运输中", "已入库", "已取消"] as const;
const OPEN_STATUSES = ["待采购", "已下单", "运输中"];

interface PickItem {
  product_id: string;
  sku: string;
  name: string;
  image: string;
  stock: number;
  suggest_qty: number;
  cost: number | null;
  source_url: string;
  qty: number;
  price: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function genPoNo() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `PO${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${Math.floor(Math.random() * 90 + 10)}`;
}

function Page_PurchaseOrders() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<string>("all");
  const [keyword, setKeyword] = useState("");
  // 第 2 批：行密度（纯展示偏好，按页持久化）
  const [density, setDensity] = useTableDensity("thv.density.purchase");
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<ExtRow | null>(null);
  const [detailItems, setDetailItems] = useState<ExtRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [canceling, setCanceling] = useState<ExtRow | null>(null);
  const [transiting, setTransiting] = useState<string | null>(null);

  // 新建表单
  const [suppliers, setSuppliers] = useState<ExtRow[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [expectDate, setExpectDate] = useState("");
  const [note, setNote] = useState("");
  const [prodKeyword, setProdKeyword] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [picked, setPicked] = useState<PickItem[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // 下单弹窗（1688 订单号）
  const [ordering, setOrdering] = useState<ExtRow | null>(null);
  const [platformOrderNo, setPlatformOrderNo] = useState("");
  const [placingOrder, setPlacingOrder] = useState(false);

  // 入库弹窗
  const [inbounding, setInbounding] = useState<ExtRow | null>(null);
  const [inboundQty, setInboundQty] = useState<Record<string, string>>({});
  const [inboundPrice, setInboundPrice] = useState<Record<string, string>>({});
  const [inboundItems, setInboundItems] = useState<ExtRow[]>([]);
  const [doingInbound, setDoingInbound] = useState(false);

  const load = () => {
    setLoading(true);
    fetchTable("purchase_orders")
      .then((data) => setRows(data.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = async () => {
    setCreateOpen(true);
    setSupplierId(""); setExpectDate(""); setNote(""); setPicked([]); setProdKeyword("");
    setLoadingProducts(true);
    try {
      const [sups, prods, inv] = await Promise.all([fetchTable("suppliers"), fetchProducts(), fetchInventory()]);
      setSuppliers(sups);
      setProducts(prods);
      setInventory(inv);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setLoadingProducts(false);
    }
  };

  // 建议补货量：安全库存（仓库维度匹配 sku，缺省 10）− 当前产品库存，不足补足
  const suggestQty = (p: ExtRow) => {
    const inv = inventory.find((i) => i.sku === p.sku);
    const safety = Number(inv?.safety_stock ?? 10) || 10;
    return Math.max(0, safety - Number(p.stock ?? 0));
  };

  const filteredProducts = useMemo(() => {
    const kw = prodKeyword.trim().toLowerCase();
    if (!kw) return products.slice(0, 50);
    return products.filter((p) =>
      String(p.name ?? "").toLowerCase().includes(kw) || String(p.sku ?? "").toLowerCase().includes(kw)
    ).slice(0, 50);
  }, [products, prodKeyword]);

  const togglePick = (p: ExtRow) => {
    const pid = String(p.id);
    setPicked((prev) => {
      if (prev.some((x) => x.product_id === pid)) return prev.filter((x) => x.product_id !== pid);
      const cost = p.cost == null ? null : Number(p.cost);
      return [...prev, {
        product_id: pid,
        sku: String(p.sku ?? ""),
        name: String(p.name ?? ""),
        image: String(p.image ?? p.primary_image ?? ""),
        stock: Number(p.stock ?? 0),
        suggest_qty: suggestQty(p),
        cost,
        source_url: String(p.source_url ?? ""),
        qty: Math.max(1, suggestQty(p)),
        price: cost != null && cost > 0 ? String(cost) : "",
      }];
    });
  };

  const createTotal = useMemo(() =>
    r2(picked.reduce((s, x) => s + (Number(x.qty) || 0) * (Number(x.price) || 0), 0)),
  [picked]);

  const handleCreate = async () => {
    if (picked.length === 0) { toast.error(t("po.create.needProduct")); return; }
    const valid = picked.filter((x) => Number(x.qty) > 0);
    if (valid.length === 0) { toast.error(t("po.create.needQty")); return; }
    setCreating(true);
    try {
      const sup = suppliers.find((s) => s.id === supplierId);
      const poNo = genPoNo();
      const orderId = await insertRow("purchase_orders", {
        po_no: poNo,
        supplier_id: supplierId || null,
        supplier_name: sup ? String(sup.name ?? "") : null,
        status: "待采购",
        expect_date: expectDate || null,
        note: note.trim() || null,
        total_amount: createTotal,
        item_count: valid.length,
      });
      for (const x of valid) {
        await insertRow("purchase_items", {
          order_id: orderId,
          product_id: x.product_id,
          sku: x.sku,
          name: x.name,
          image: x.image || null,
          qty: Number(x.qty),
          price: Number(x.price) || 0,
          amount: r2((Number(x.qty) || 0) * (Number(x.price) || 0)),
          source_url: x.source_url || null,
        });
      }
      toast.success(t("po.toast.created", { no: poNo }));
      setCreateOpen(false);
      setPicked([]);
      load();
      setDetail(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed"));
    } finally {
      setCreating(false);
    }
  };

  const openDetail = async (row: ExtRow) => {
    setDetail(row);
    setDetailLoading(true);
    try {
      const items = await fetchTable("purchase_items", { field: "order_id", value: row.id });
      setDetailItems(items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (id: string) => {
    const [items, all] = await Promise.all([
      fetchTable("purchase_items", { field: "order_id", value: id }),
      fetchTable("purchase_orders", { field: "id", value: id }),
    ]);
    setDetailItems(items);
    if (all[0]) setDetail(all[0]);
    load();
  };

  // 状态流转：待采购→已下单（可填 1688 订单号）→运输中→已入库（RPC）；非终态可取消
  const openOrder = (row: ExtRow) => {
    setOrdering(row);
    setPlatformOrderNo(String(row.platform_order_no ?? ""));
  };
  const handlePlaceOrder = async () => {
    if (!ordering) return;
    setPlacingOrder(true);
    try {
      await updateRow("purchase_orders", ordering.id, {
        status: "已下单",
        platform_order_no: platformOrderNo.trim() || null,
        updated_at: new Date().toISOString(),
      });
      toast.success(t("po.toast.ordered"));
      setOrdering(null);
      if (detail?.id === ordering.id) await refreshDetail(ordering.id); else load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed"));
    } finally {
      setPlacingOrder(false);
    }
  };

  const handleTransit = async (row: ExtRow) => {
    setTransiting(row.id);
    try {
      await updateRow("purchase_orders", row.id, { status: "运输中", updated_at: new Date().toISOString() });
      toast.success(t("po.toast.inTransit"));
      if (detail?.id === row.id) await refreshDetail(row.id); else load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed"));
    } finally {
      setTransiting(null);
    }
  };

  const openInbound = async (row: ExtRow) => {
    setInbounding(row);
    try {
      const items = await fetchTable("purchase_items", { field: "order_id", value: row.id });
      setInboundItems(items);
      const q: Record<string, string> = {};
      const pr: Record<string, string> = {};
      items.forEach((it) => {
        q[it.id] = String(it.received_qty ?? it.qty ?? 0);
        pr[it.id] = String(it.price ?? "");
      });
      setInboundQty(q);
      setInboundPrice(pr);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.unknownError"));
    }
  };

  const handleInbound = async () => {
    if (!inbounding) return;
    setDoingInbound(true);
    try {
      const payload = inboundItems.map((it) => ({
        item_id: it.id,
        received_qty: Number(inboundQty[it.id] ?? 0) || 0,
        price: inboundPrice[it.id] === "" ? null : Number(inboundPrice[it.id]) || 0,
      }));
      const res = await callRpc<{ ok: boolean; po_no: string; stock_updated: number; cost_updated: number }>(
        "purchase_inbound", { p_order_id: inbounding.id, p_items: payload },
      );
      toast.success(t("po.toast.inboundDone", {
        stock: res?.stock_updated ?? 0,
        cost: res?.cost_updated ?? 0,
      }));
      setInbounding(null);
      if (detail?.id === inbounding.id) await refreshDetail(inbounding.id); else load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed"));
    } finally {
      setDoingInbound(false);
    }
  };

  const handleCancel = async () => {
    if (!canceling) return;
    try {
      await updateRow("purchase_orders", canceling.id, { status: "已取消", updated_at: new Date().toISOString() });
      toast.success(t("po.toast.canceled"));
      setCanceling(null);
      if (detail) { setDetail(null); }
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.saveFailed"));
    }
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== "all" && r.status !== tab) return false;
      if (!kw) return true;
      return [r.po_no, r.supplier_name, r.note].some((v) => String(v ?? "").toLowerCase().includes(kw));
    });
  }, [rows, tab, keyword]);

  const kpi = useMemo(() => {
    const c = (s: string) => rows.filter((r) => r.status === s).length;
    const month = new Date().toISOString().slice(0, 7);
    const amount = rows
      .filter((r) => String(r.created_at ?? "").slice(0, 7) === month && r.status !== "已取消")
      .reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
    return { waiting: c("待采购"), ordered: c("已下单"), transit: c("运输中"), amount: r2(amount) };
  }, [rows]);

  // 第 2 批：通用数据表列定义（渲染层；取值与含义与原表一致）
  const poColumns: DataTableColumn<ExtRow>[] = [
    { key: "po_no", header: t("po.col.no"), render: (r) => <span className="font-mono text-xs">{String(r.po_no ?? "—")}</span> },
    { key: "supplier_name", header: t("po.col.supplier"), render: (r) => String(r.supplier_name ?? "—") },
    { key: "item_count", header: t("po.col.items"), align: "right", render: (r) => Number(r.item_count ?? 0) },
    { key: "total_amount", header: t("po.col.amount"), align: "right", render: (r) => <span className="font-medium">¥{money(Number(r.total_amount ?? 0))}</span> },
    { key: "status", header: t("po.col.status"), render: (r) => <StatusBadge status={String(r.status ?? "")} /> },
    { key: "created_at", header: t("po.col.createdAt"), render: (r) => <span className="text-xs text-fg-muted">{String(r.created_at ?? "").slice(0, 16).replace("T", " ")}</span> },
    {
      key: "actions", header: t("po.col.actions"), align: "right",
      render: (r) => (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openDetail(r)}>
          {t("po.detail")}
        </Button>
      ),
    },
  ];

  const detailOpenQty = (it: ExtRow) => Number(it.received_qty ?? it.qty ?? 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("po.title")}
        description={t("po.desc")}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={14} className="mr-1.5" /> {t("po.create")}
          </Button>
        }
      />

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("po.kpi.waiting")} value={String(kpi.waiting)} icon={<ClipboardList size={17} />} tone="warning" />
        <StatCard label={t("po.kpi.ordered")} value={String(kpi.ordered)} icon={<ShoppingCart size={17} />} tone="primary" />
        <StatCard label={t("po.kpi.transit")} value={String(kpi.transit)} icon={<Truck size={17} />} tone="violet" />
        <StatCard label={t("po.kpi.monthAmount")} value={`¥${money(kpi.amount)}`} icon={<Coins size={17} />} tone="success" />
      </div>

      {/* 筛选栏（第 2 批：通用筛选栏容器；状态胶囊在左、搜索在右） */}
      <FilterBar
        actions={
          <>
          <SearchField
            value={keyword}
            onChange={setKeyword}
            placeholder={t("po.search")}
            width="w-56"
          />
          </>}
      >
        <button
          className={cn("rounded-full px-3 py-1 text-xs border", tab === "all" ? "bg-primary text-primary-foreground border-primary" : "border-border text-fg-muted hover:bg-surface-hover")}
          onClick={() => setTab("all")}
        >
          {t("po.filter.all")} ({rows.length})
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            className={cn("rounded-full px-3 py-1 text-xs border", tab === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-fg-muted hover:bg-surface-hover")}
            onClick={() => setTab(s)}
          >
            {t(`po.status.${s}`)} ({rows.filter((r) => r.status === s).length})
          </button>
        ))}
      </FilterBar>

      {/* 采购单列表（第 2 批：通用数据表容器） */}
      <DataTable
        columns={poColumns}
        rows={filtered}
        rowKey={(r) => String(r.id)}
        loading={loading}
        emptyState={<EmptyState text={t("po.empty")} />}
        showEmptyState={filtered.length === 0}
        density={density}
        onDensityChange={setDensity}
        densityLabels={{ compact: t("tbl.densityCompact"), cozy: t("tbl.densityCozy") }}
      />

      {/* 新建采购单 */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("po.create")}</DialogTitle>
            <DialogDescription>{t("po.create.desc")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("po.create.supplier")}</Label>
              <select
                className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">{t("po.create.noSupplier")}</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={String(s.id)}>{String(s.name ?? "")}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("po.create.expectDate")}</Label>
              <Input type="date" value={expectDate} onChange={(e) => setExpectDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("po.create.note")}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("po.create.notePh")} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("po.create.pickProducts")}</Label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted/60" />
              <Input value={prodKeyword} onChange={(e) => setProdKeyword(e.target.value)} placeholder={t("po.create.searchPh")} className="h-8 pl-8 text-sm" />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-xl border divide-y">
              {loadingProducts ? (
                <div className="py-8 text-center text-fg-muted/60"><Loader2 className="mx-auto animate-spin" size={18} /></div>
              ) : filteredProducts.length === 0 ? (
                <div className="py-8 text-center text-sm text-fg-muted/60">{t("po.create.noProduct")}</div>
              ) : filteredProducts.map((p) => {
                const pid = String(p.id);
                const isPicked = picked.some((x) => x.product_id === pid);
                return (
                  <div
                    key={pid}
                    className={cn("flex items-center gap-3 px-3 py-2 cursor-pointer", isPicked ? "bg-info-bg/60" : "hover:bg-surface-hover")}
                    onClick={() => togglePick(p as any)}
                  >
                    <input type="checkbox" checked={isPicked} readOnly className="h-4 w-4" />
                    {p.image ? (
                      <img src={String(p.image)} alt="" className="h-9 w-9 rounded object-cover border" />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded border bg-surface-sunken/50 text-fg-muted/40"><Boxes size={16} /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{String(p.name ?? "")}</div>
                      <div className="text-xs text-fg-muted/60">{String(p.sku ?? "")}</div>
                    </div>
                    <div className="text-right text-xs text-fg-muted w-40 shrink-0">
                      <div>{t("po.create.stock")} {Number(p.stock ?? 0)}</div>
                      <div>{t("po.create.suggest")} <span className="font-medium text-info">{suggestQty(p as any)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {picked.length > 0 && (
            <div className="rounded-xl border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-surface-sunken text-left text-xs text-fg-muted">
                    <th className="px-3 py-2 font-medium whitespace-nowrap">{t("po.col.product")}</th>
                    <th className="px-3 py-2 font-medium w-28 whitespace-nowrap">{t("po.col.qty")}</th>
                    <th className="px-3 py-2 font-medium w-32 whitespace-nowrap">{t("po.col.price")}</th>
                    <th className="px-3 py-2 font-medium w-28 text-right whitespace-nowrap">{t("po.col.amount")}</th>
                    <th className="px-3 py-2 w-10 whitespace-nowrap" />
                  </tr>
                </thead>
                <tbody>
                  {picked.map((x) => (
                    <tr key={x.product_id} className="border-b last:border-0">
                      <td className="px-3 py-2 align-middle">
                        <div className="truncate max-w-56" title={x.name}>{x.name}</div>
                        <div className="text-xs text-fg-muted/60">{x.sku}</div>
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <Input type="number" min={1} className="h-8" value={x.qty}
                          onChange={(e) => setPicked((prev) => prev.map((y) => y.product_id === x.product_id ? { ...y, qty: Number(e.target.value) } : y))} />
                      </td>
                      <td className="px-3 py-2 align-middle">
                        <Input type="number" min={0} step="0.01" className="h-8" placeholder="0.00" value={x.price}
                          onChange={(e) => setPicked((prev) => prev.map((y) => y.product_id === x.product_id ? { ...y, price: e.target.value } : y))} />
                      </td>
                      <td className="px-3 py-2 text-right font-medium align-middle">¥{money((Number(x.qty) || 0) * (Number(x.price) || 0))}</td>
                      <td className="px-3 py-2 text-center align-middle">
                        <button className="text-fg-muted/60 hover:text-destructive" onClick={() => togglePick(products.find((p) => String(p.id) === x.product_id) as any)}>
                          <Ban size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between px-3 py-2 bg-surface-sunken/50 text-sm">
                <span className="text-xs text-fg-muted">{t("po.create.itemsCount", { n: picked.length })}</span>
                <span className="font-semibold">{t("po.create.total")} <span className="text-info">¥{money(createTotal)}</span></span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleCreate} disabled={creating || picked.length === 0}>
              {creating ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Plus size={14} className="mr-1" />}
              {t("po.create.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 详情弹窗 */}
      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-sm">{String(detail.po_no ?? "")}</span>
                  <StatusBadge status={String(detail.status ?? "")} />
                </DialogTitle>
                <DialogDescription>{t("po.detail.desc")}</DialogDescription>
              </DialogHeader>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border bg-surface-sunken p-3 text-sm sm:grid-cols-3">
                <div><span className="text-fg-muted/60 text-xs">{t("po.create.supplier")}</span><div>{String(detail.supplier_name ?? "—")}</div></div>
                <div><span className="text-fg-muted/60 text-xs">{t("po.create.expectDate")}</span><div>{detail.expect_date ? String(detail.expect_date) : "—"}</div></div>
                <div><span className="text-fg-muted/60 text-xs">{t("po.col.amount")}</span><div className="font-semibold">¥{money(Number(detail.total_amount ?? 0))}</div></div>
                <div><span className="text-fg-muted/60 text-xs">{t("po.detail.platformOrderNo")}</span><div className="font-mono text-xs">{String(detail.platform_order_no ?? "—")}</div></div>
                <div><span className="text-fg-muted/60 text-xs">{t("po.create.note")}</span><div className="truncate" title={String(detail.note ?? "")}>{String(detail.note ?? "—")}</div></div>
                <div><span className="text-fg-muted/60 text-xs">{t("po.col.createdAt")}</span><div className="text-xs">{String(detail.created_at ?? "").slice(0, 16).replace("T", " ")}</div></div>
              </div>

              <div className="rounded-xl border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-surface-sunken text-left text-xs text-fg-muted">
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("po.col.product")}</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("po.col.qty")}</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("po.col.price")}</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("po.col.amount")}</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">{t("po.detail.received")}</th>
                      <th className="px-3 py-2 font-medium whitespace-nowrap">1688</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailLoading ? (
                      <tr><td colSpan={6} className="py-8 text-center text-fg-muted/60 align-middle"><Loader2 className="mx-auto animate-spin" size={18} /></td></tr>
                    ) : detailItems.length === 0 ? (
                      <tr><td colSpan={6} className="py-8 text-center text-sm text-fg-muted/60 align-middle">{t("po.detail.noItems")}</td></tr>
                    ) : detailItems.map((it) => (
                      <tr key={it.id} className="border-b last:border-0">
                        <td className="px-3 py-2 align-middle">
                          <div className="flex items-center gap-2">
                            {it.image ? <img src={String(it.image)} alt="" className="h-8 w-8 rounded object-cover border" /> : <div className="flex h-8 w-8 items-center justify-center rounded border bg-surface-sunken/50 text-fg-muted/40"><Boxes size={14} /></div>}
                            <div className="min-w-0">
                              <div className="truncate max-w-52" title={String(it.name ?? "")}>{String(it.name ?? "")}</div>
                              <div className="text-xs text-fg-muted/60">{String(it.sku ?? "")}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle">{Number(it.qty ?? 0)}</td>
                        <td className="px-3 py-2 align-middle">¥{money(Number(it.price ?? 0))}</td>
                        <td className="px-3 py-2 font-medium align-middle">¥{money(Number(it.amount ?? 0))}</td>
                        <td className="px-3 py-2 align-middle">{it.received_qty == null ? "—" : Number(it.received_qty)}</td>
                        <td className="px-3 py-2 align-middle">
                          {it.source_url ? (
                            <a href={String(it.source_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-info hover:underline">
                              {t("po.detail.open1688")} <ExternalLink size={12} />
                            </a>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2">
                {detail.status === "待采购" && (
                  <Button size="sm" onClick={() => openOrder(detail)}>
                    <ShoppingCart size={14} className="mr-1" /> {t("po.action.placeOrder")}
                  </Button>
                )}
                {detail.status === "已下单" && (
                  <Button size="sm" onClick={() => handleTransit(detail)} disabled={transiting === detail.id}>
                    {transiting === detail.id ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Truck size={14} className="mr-1" />}
                    {t("po.action.transit")}
                  </Button>
                )}
                {detail.status === "运输中" && (
                  <Button size="sm" onClick={() => openInbound(detail)}>
                    <PackageCheck size={14} className="mr-1" /> {t("po.action.inbound")}
                  </Button>
                )}
                {OPEN_STATUSES.includes(String(detail.status)) && (
                  <>
                    {detail.status !== "待采购" && detail.status !== "运输中" && (
                      <Button size="sm" variant="outline" onClick={() => openInbound(detail)}>
                        <PackageCheck size={14} className="mr-1" /> {t("po.action.inbound")}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setCanceling(detail)}>
                      <Ban size={14} className="mr-1" /> {t("po.action.cancel")}
                    </Button>
                  </>
                )}
                {detail.status === "已入库" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-3 py-1 text-xs text-success">
                    <PackageCheck size={13} /> {t("po.detail.inboundAt")} {detail.inbound_at ? String(detail.inbound_at).slice(0, 16).replace("T", " ") : ""}
                  </span>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* 标记已下单（填 1688 订单号） */}
      <Dialog open={!!ordering} onOpenChange={(o) => { if (!o) setOrdering(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("po.order.title")}</DialogTitle>
            <DialogDescription>{t("po.order.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("po.order.no")}</Label>
            <Input value={platformOrderNo} onChange={(e) => setPlatformOrderNo(e.target.value)} placeholder={t("po.order.noPh")} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrdering(null)}>{t("common.cancel")}</Button>
            <Button onClick={handlePlaceOrder} disabled={placingOrder}>
              {placingOrder ? <Loader2 size={14} className="mr-1 animate-spin" /> : <ArrowRight size={14} className="mr-1" />}
              {t("po.order.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 入库弹窗 */}
      <Dialog open={!!inbounding} onOpenChange={(o) => { if (!o) setInbounding(null); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("po.inbound.title")}</DialogTitle>
            <DialogDescription>{t("po.inbound.desc")}</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-surface-sunken text-left text-xs text-fg-muted">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">{t("po.col.product")}</th>
                  <th className="px-3 py-2 font-medium w-28 whitespace-nowrap">{t("po.inbound.qty")}</th>
                  <th className="px-3 py-2 font-medium w-32 whitespace-nowrap">{t("po.col.price")}</th>
                </tr>
              </thead>
              <tbody>
                {inboundItems.map((it) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="px-3 py-2 align-middle">
                      <div className="truncate max-w-52" title={String(it.name ?? "")}>{String(it.name ?? "")}</div>
                      <div className="text-xs text-fg-muted/60">{String(it.sku ?? "")}</div>
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Input type="number" min={0} className="h-8" value={inboundQty[it.id] ?? ""}
                        onChange={(e) => setInboundQty((prev) => ({ ...prev, [it.id]: e.target.value }))} />
                    </td>
                    <td className="px-3 py-2 align-middle">
                      <Input type="number" min={0} step="0.01" className="h-8" value={inboundPrice[it.id] ?? ""}
                        onChange={(e) => setInboundPrice((prev) => ({ ...prev, [it.id]: e.target.value }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl bg-warning-bg border border-warning/30 px-3 py-2 text-xs text-warning">
            {t("po.inbound.warn")}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInbounding(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleInbound} disabled={doingInbound}>
              {doingInbound ? <Loader2 size={14} className="mr-1 animate-spin" /> : <PackageCheck size={14} className="mr-1" />}
              {t("po.inbound.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 取消确认 */}
      <AlertDialog open={!!canceling} onOpenChange={(o) => { if (!o) setCanceling(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("po.cancel.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("po.cancel.desc", { no: String(canceling?.po_no ?? "") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive" onClick={handleCancel}>
              {t("po.cancel.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
