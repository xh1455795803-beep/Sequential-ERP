import { createFileRoute, Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { Plus, Filter, MoreHorizontal, Pencil, Copy, Trash2, Loader2, Store, Send, Rocket, ClipboardList, Columns3, Bookmark, Download, X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTable, type DataTableColumn, useTableDensity } from "@/components/data-table";
import { FilterBar, SearchField } from "@/components/filter-bar";
import { SafeImg } from "@/components/safe-img";
import { ProductStatusBadge } from "@/components/status-badge";
import { fetchProducts, fetchShops, deleteRow, updateRows, updateRow, insertRow, type ProductRow, type ShopRow } from "@/lib/data-access";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { InlineEditCell } from "@/components/inline-edit";
import { useColumnPrefs, useNamedViews, type NamedView } from "@/hooks/use-table-prefs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuCheckboxItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { PublishListingDialog, ListingsDialog } from "@/components/publish-listing-dialog";
import { tt } from "@/i18n/tts";
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
import { devLog } from "@/lib/devlog";

export const Route = createFileRoute("/_layout/products")({
  component: Products,
});

function Products() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  // 子路由（/products/collect、/products/material）激活时，隐藏商品列表视图
  const childActive = useRouterState({ select: (s) => s.location.pathname !== "/products" });
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  // 排序 + 分页
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<ProductRow | null>(null);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchUpdating, setBatchUpdating] = useState(false);
  // 第 2 批：行密度（纯展示偏好，按页持久化）
  const [density, setDensity] = useTableDensity("thv.density.products");
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  // 分发刊登（统一刊登编辑页）
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<ProductRow | null>(null);
  const [dispatchShopId, setDispatchShopId] = useState("");
  const [dispatching, setDispatching] = useState(false);
  // 刊登发布引擎（P0-1）：真实发布到已授权 WooCommerce 店铺
  // 表格第一公民（vis2）：列自定义 + 命名视图 + 售价行内编辑 + 导出
  const prodCols = ["name", "sku", "category", "price", "stock", "sales", "status"] as const;
  const { visible, toggle, reset: resetCols } = useColumnPrefs("products", [...prodCols]);
  const { views, save: saveViewRaw, remove: removeView } = useNamedViews("products");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<ProductRow | null>(null);
  const [listingsOpen, setListingsOpen] = useState(false);

  useEffect(() => {
    fetchShops().then(setShops).catch(() => {});
  }, []);

  const load = () => {
    fetchProducts()
      .then(setProducts)
      .catch((e) => console.error("[products] 加载商品失败", e))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("products", deleting.id);
      devLog("[products] 删除商品成功", { id: deleting.id });
      setDeleting(null);
      toast.success(t("products.deleted", { count: 1 }));
      load();
    } catch (e) {
      console.error("[products] 删除商品失败", e);
      setDeleting(null);
      toast.error(t("products.deleteFail"));
    }
  };

  // 批量上架 / 下架
  const handleBatchStatus = async (status: string) => {
    if (selected.length === 0) return;
    setBatchUpdating(true);
    try {
      await updateRows("products", selected, { status });
      devLog("[products] 批量更新状态成功", { ids: selected, status });
      toast.success(status === "在售" ? t("products.batchListed", { count: selected.length }) : t("products.batchDelisted", { count: selected.length }));
      setSelected([]);
      load();
    } catch (e) {
      console.error("[products] 批量更新状态失败", e);
      toast.error(t("products.batchFail"));
    } finally {
      setBatchUpdating(false);
    }
  };

  // 批量删除
  const handleBatchDelete = async () => {
    if (selected.length === 0) return;
    setBatchDeleting(true);
    try {
      for (const id of selected) {
        await deleteRow("products", id);
      }
      devLog("[products] 批量删除成功", { ids: selected });
      toast.success(t("products.deleted", { count: selected.length }));
      setSelected([]);
      load();
    } catch (e) {
      console.error("[products] 批量删除失败", e);
      toast.error(t("products.deleteFail"));
    } finally {
      setBatchDeleting(false);
    }
  };

  const filtered = products.filter((p) => {
    const matchKw =
      p.name.toLowerCase().includes(keyword.toLowerCase()) ||
      p.sku.toLowerCase().includes(keyword.toLowerCase());
    const matchCategory = !filterCategory || p.category === filterCategory;
    const matchStatus = !filterStatus || p.status === filterStatus;
    return matchKw && matchCategory && matchStatus;
  });

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
  const productColumns: DataTableColumn<ProductRow>[] = [];
  if (visible("name"))
    productColumns.push({
      key: "name", header: t("products.col.info"), sortable: true,
      render: (p) => (
        <div className="flex items-center gap-3">
          <SafeImg src={p.image} alt={p.name} className="h-10 w-10 rounded-xl object-cover" />
          <Link to="/products/$id" params={{ id: p.id }} className="font-medium hover:text-primary">
            {p.name}
          </Link>
        </div>
      ),
    });
  if (visible("sku"))
    productColumns.push({ key: "sku", header: t("orders.sku"), sortable: true, render: (p) => <span className="text-fg-muted">{p.sku}</span> });
  if (visible("category"))
    productColumns.push({ key: "category", header: t("products.col.category"), sortable: true, render: (p) => <span className="text-fg-muted">{p.category}</span> });
  if (visible("price"))
    productColumns.push({
      key: "price", header: t("products.col.price"), sortable: true,
      render: (p) => <span className="font-medium"><InlineEditCell type="number" value={p.price.toFixed(2)} onCommit={(next) => savePrice(p.id, next, p.price)} /></span>,
    });
  if (visible("stock"))
    productColumns.push({
      key: "stock", header: t("products.col.stock"), sortable: true,
      render: (p) => <span className={p.stock === 0 ? "font-medium text-destructive" : "text-fg-muted"}>{p.stock}</span>,
    });
  if (visible("sales"))
    productColumns.push({ key: "sales", header: t("products.col.sales"), sortable: true, render: (p) => <span className="text-fg-muted">{p.sales.toLocaleString()}</span> });
  if (visible("status"))
    productColumns.push({ key: "status", header: t("orders.col.status"), sortable: true, render: (p) => <ProductStatusBadge status={p.status} /> });
  productColumns.push({
    key: "actions", header: t("common.actions"), align: "right",
    render: (p) => (
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem asChild>
              <Link to="/products/$id" params={{ id: p.id }}><Pencil size={14} className="mr-2" />{t("common.edit")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => openDispatch(p)}><Send size={14} className="mr-2" />{t("products.dispatch")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setPublishTarget(p); setPublishOpen(true); }}><Rocket size={14} className="mr-2" />{t("publish.toShop")}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDuplicate(p)}><Copy size={14} className="mr-2" />{t("products.copy")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => setDeleting(p)}><Trash2 size={14} className="mr-2" />{t("common.delete")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
  });

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const categories = Array.from(new Set(products.map((p) => p.category)));

  // 复制商品
  const handleDuplicate = async (p: ProductRow) => {
    try {
      const newProduct = {
        name: `${p.name}${t("products.copySuffix")}`,
        sku: `${p.sku}-copy`,
        category: p.category,
        price: p.price,
        stock: 0,
        status: "草稿",
        image: p.image,
        description: "",
        sales: 0,
      };
      await insertRow("products", newProduct);
      toast.success(t("products.copySuccess", { name: p.name }));
      load();
    } catch (e) {
      console.error("[products] 复制商品失败", e);
      toast.error(t("products.copyFail"));
    }
  };

  // 分发刊登：选择店铺 → 生成绑定该店铺的草稿 → 打开统一刊登编辑页
  const openDispatch = (p: ProductRow) => {
    setDispatchTarget(p);
    setDispatchShopId("");
    setDispatchOpen(true);
  };
  const handleDispatch = async () => {
    if (!dispatchTarget || !dispatchShopId) return;
    setDispatching(true);
    try {
      const src = dispatchTarget as any;
      const extras = (src.extras && typeof src.extras === "object" ? { ...(src.extras as Record<string, unknown>) } : {}) as Record<string, unknown>;
      // 站点专属内容不随分发复制（由编辑页按店铺重新填写）
      delete extras.site;
      delete extras.ean_map;
      const now = new Date().toISOString();
      const newId = await insertRow("products", {
        name: src.name ?? "",
        sku: src.sku ?? "",
        category: src.category ?? "",
        price: src.price ?? null,
        cost: src.cost ?? null,
        stock: src.stock ?? 0,
        status: "草稿",
        image: src.image ?? null,
        description: src.description ?? "",
        images: Array.isArray(src.images) ? src.images : [],
        primary_image: src.primary_image ?? null,
        source_platform: src.source_platform ?? "",
        source_url: src.source_url ?? "",
        shop_id: dispatchShopId,
        extras: { ...extras, source_product_id: src.id },
        created_at: now,
        updated_at: now,
      });
      toast.success(t("products.dispatchCreated"));
      setDispatchOpen(false);
      setDispatchTarget(null);
      setDispatchShopId("");
      navigate({ to: `/products/${newId}` });
    } catch (e) {
      console.error("[products] 分发刊登失败", e);
      toast.error(t("products.dispatchFail", { msg: e instanceof Error ? e.message : t("common.unknownError") }));
    } finally {
      setDispatching(false);
    }
  };

  const toggleAll = () => {
    setSelected(selected.length === filtered.length ? [] : filtered.map((p) => p.id));
  };

  // 命名视图：应用 / 保存 / 删除
  const applyView = (v: NamedView) => {
    const st = v.state as { keyword?: string; category?: string; status?: string };
    setKeyword(st.keyword ?? "");
    setFilterCategory(st.category ?? "");
    setFilterStatus(st.status ?? "");
    setPage(1);
  };
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    saveViewRaw(name, { keyword, category: filterCategory, status: filterStatus });
    setViewName("");
    setSaveViewOpen(false);
  };

  // 售价行内编辑：乐观更新 + 失败回滚 + toast（真实后端：updateRow products.price）
  const savePrice = async (id: string, next: string, prev: number) => {
    const num = Number(next);
    if (Number.isNaN(num) || num < 0) {
      toast.error(t("tbl.priceInvalid"));
      return false;
    }
    setProducts((rows) => rows.map((r) => (r.id === id ? { ...r, price: num } : r)));
    try {
      await updateRow("products", id, { price: num });
      toast.success(t("common.saved"));
      return true;
    } catch (e) {
      setProducts((rows) => rows.map((r) => (r.id === id ? { ...r, price: prev } : r)));
      toast.error(t("common.failed", { reason: (e as Error).message }));
      return false;
    }
  };

  // 导出 CSV：勾选优先，否则当前筛选全量
  const exportCsv = () => {
    const rows = selected.length > 0 ? filtered.filter((p) => selected.includes(p.id)) : filtered;
    if (rows.length === 0) {
      toast.error(t("orders.empty"));
      return;
    }
    const head = ["name", "sku", "category", "price", "stock", "sales", "status", "platform"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const p of rows) {
      lines.push([p.name, p.sku, p.category, p.price, p.stock, p.sales, p.status, (p.extras as { platform?: string } | undefined)?.platform ?? ""].map(esc).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("tbl.exportDone", { v1: rows.length }));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-5">
      {/* 子路由（采集箱 / 素材库）渲染时替换整个列表视图 */}
      <Outlet />
      <div className={childActive ? "hidden" : undefined}>
      <PageHeader
        title={t("products.title")}
        description={t("products.desc")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setListingsOpen(true)}>
              <ClipboardList size={15} /> {t("publish.records")}
            </Button>
            <Link to="/products/$id" params={{ id: "new" }}>
              <Button size="sm">
                <Plus size={15} /> {t("products.add")}
              </Button>
            </Link>
          </div>
        }
      />

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
              {prodCols.map((c) => (
                <DropdownMenuCheckboxItem key={c} checked={visible(c)} onCheckedChange={() => toggle(c)} onSelect={(e) => e.preventDefault()}>
                  {c === "name" ? t("products.col.info") : c === "sku" ? t("orders.sku") : c === "category" ? t("products.col.category") : c === "price" ? t("products.col.price") : c === "stock" ? t("products.col.stock") : c === "sales" ? t("products.col.sales") : t("orders.col.status")}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => resetCols()}><X size={13} /> {t("tbl.colsReset")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download size={14} /> {t("tbl.export")}{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
          </>}
      >
        <SearchField
          value={keyword}
          onChange={(v) => { setKeyword(v); setPage(1); }}
          placeholder={t("products.search")}
        />
        <Button variant="outline" size="sm" onClick={() => setFilterOpen(true)}>
          <Filter size={14} /> {t("orders.filter")}
        </Button>
      </FilterBar>

      {/* 商品表格（第 2 批：通用数据表容器） */}
      <DataTable
        columns={productColumns}
        rows={paged}
        rowKey={(p) => p.id}
        loading={loading}
        emptyState={<EmptyState text={t("products.empty")} />}
        showEmptyState={filtered.length === 0}
        selectable
        selectedKeys={selected}
        allSelected={selected.length === filtered.length && filtered.length > 0}
        someSelected={selected.length > 0 && !(selected.length === filtered.length && filtered.length > 0)}
        onToggleRow={(id) => toggleOne(id)}
        onToggleAll={() => toggleAll()}
        sortKey={sortKey}
        sortDirection={sortDir}
        onSort={handleSort}
        density={density}
        onDensityChange={setDensity}
        densityLabels={{ compact: t("tbl.densityCompact"), cozy: t("tbl.densityCozy") }}
        batchBar={
          selected.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-primary">{t("products.selected", { count: selected.length })}</span>
              <Button size="sm" variant="outline" onClick={() => handleBatchStatus("在售")} disabled={batchUpdating}>{t("products.batchList")}</Button>
              <Button size="sm" variant="outline" onClick={() => handleBatchStatus("下架")} disabled={batchUpdating}>{t("products.batchDelist")}</Button>
              <Button size="sm" variant="outline" className="text-destructive" onClick={handleBatchDelete} disabled={batchDeleting}>
                {batchDeleting ? <Loader2 size={14} className="animate-spin" /> : null}{t("products.batchDelete")}
              </Button>
            </div>
          ) : null
        }
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

      {/* 分发刊登弹窗：选店铺 → 生成草稿 → 打开统一刊登编辑页 */}
      <Dialog open={dispatchOpen} onOpenChange={(o) => { if (!o) { setDispatchOpen(false); setDispatchTarget(null); setDispatchShopId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Store size={16} className="text-primary" />{t("products.dispatch")}</DialogTitle>
            <DialogDescription>
              {t("products.dispatchDesc", { name: dispatchTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("products.dispatchShop")}</Label>
              {shops.filter((s) => s.status === "正常").length === 0 ? (
                <p className="text-sm text-fg-muted">{t("products.dispatchNoShops")}</p>
              ) : (
                <select
                  value={dispatchShopId}
                  onChange={(e) => setDispatchShopId(e.target.value)}
                  className="h-8 rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">{t("publish.selectShop")}</option>
                  {shops.filter((s) => s.status === "正常").map((s) => (
                    <option key={s.id} value={s.id}>{t("products.shopWithRegion", { name: s.name, region: s.region || s.platform })}</option>
                  ))}
                </select>
              )}
              {shops.length > 0 && shops.filter((s) => s.status !== "正常").length > 0 && (
                <p className="text-xs text-fg-muted">{t("products.dispatchDisabledShops", { names: shops.filter((s) => s.status !== "正常").map((s) => s.name).join("、") })}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDispatchOpen(false)}>{t("common.cancel")}</Button>
            <Button size="sm" onClick={() => void handleDispatch()} disabled={!dispatchShopId || dispatching}>
              {dispatching ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Send size={14} className="mr-1.5" />}
              {t("products.dispatchCreate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 刊登发布引擎：刊登到店铺 + 刊登记录 */}
      <PublishListingDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        product={publishTarget ? { id: publishTarget.id, name: publishTarget.name, sku: publishTarget.sku } : null}
      />
      <ListingsDialog open={listingsOpen} onOpenChange={setListingsOpen} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("products.confirmDelete", { name: deleting?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 高级筛选弹窗 */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orders.filter")}</DialogTitle>
            <DialogDescription>{t("products.filterDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("products.col.category")}</Label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-soft focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("products.allCategory")}</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("orders.col.status")}</Label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-soft focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("products.allStatus")}</option>
                <option value="在售">{t("st.onSale")}</option>
                <option value="下架">{t("st.delist")}</option>
                <option value="草稿">{t("st.draft")}</option>
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFilterCategory(""); setFilterStatus(""); }}>{t("orders.reset")}</Button>
            <Button onClick={() => setFilterOpen(false)}>{t("orders.confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
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