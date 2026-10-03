import { createFileRoute, Link, Outlet, useRouterState, useNavigate } from "@tanstack/react-router";
import { Plus, Search, Filter, MoreHorizontal, Pencil, Copy, Trash2, Loader2, Store, Send, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { ProductStatusBadge } from "@/components/status-badge";
import { fetchProducts, fetchShops, deleteRow, updateRows, insertRow, type ProductRow, type ShopRow } from "@/lib/data-access";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  // 分发刊登（统一刊登编辑页）
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchTarget, setDispatchTarget] = useState<ProductRow | null>(null);
  const [dispatchShopId, setDispatchShopId] = useState("");
  const [dispatching, setDispatching] = useState(false);

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
      console.log("[products] 删除商品成功", { id: deleting.id });
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
      console.log("[products] 批量更新状态成功", { ids: selected, status });
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
      console.log("[products] 批量删除成功", { ids: selected });
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
  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const categories = Array.from(new Set(products.map((p) => p.category)));

  // 复制商品
  const handleDuplicate = async (p: ProductRow) => {
    try {
      const newProduct = {
        name: `${p.name} (副本)`,
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
      toast.success("已生成店铺草稿，正在打开统一刊登编辑页...");
      setDispatchOpen(false);
      setDispatchTarget(null);
      setDispatchShopId("");
      navigate({ to: `/products/${newId}` });
    } catch (e) {
      console.error("[products] 分发刊登失败", e);
      toast.error("分发失败：" + (e instanceof Error ? e.message : "未知错误"));
    } finally {
      setDispatching(false);
    }
  };

  const toggleAll = () => {
    setSelected(selected.length === filtered.length ? [] : filtered.map((p) => p.id));
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
          <Link to="/products/$id" params={{ id: "new" }}>
            <Button size="sm">
              <Plus size={15} /> {t("products.add")}
            </Button>
          </Link>
        }
      />

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("products.search")}
            value={keyword}
            onChange={(e) => { setKeyword(e.target.value); setPage(1); }}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setFilterOpen(true)}>
          <Filter size={14} /> {t("orders.filter")}
        </Button>
        <div className="ml-auto text-sm text-muted-foreground">
          {t("products.total", { count: filtered.length })}
        </div>
      </div>

      {/* 批量操作条 */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5 text-sm">
          <span className="font-medium text-primary">{t("products.selected", { count: selected.length })}</span>
          <Button size="sm" variant="outline" onClick={() => handleBatchStatus("在售")} disabled={batchUpdating}>{t("products.batchList")}</Button>
          <Button size="sm" variant="outline" onClick={() => handleBatchStatus("下架")} disabled={batchUpdating}>{t("products.batchDelist")}</Button>
          <Button size="sm" variant="outline" className="text-rose-600" onClick={handleBatchDelete} disabled={batchDeleting}>
            {batchDeleting ? <Loader2 size={14} className="animate-spin" /> : null}{t("products.batchDelete")}
          </Button>
        </div>
      )}

      {/* 商品表格 */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={selected.length === filtered.length && filtered.length > 0} onChange={toggleAll} className="accent-primary" />
              </th>
              {(["name", "sku", "category", "price", "stock", "sales", "status"] as const).map((key) => (
                <th
                  key={key}
                  className="cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium hover:text-foreground"
                  onClick={() => handleSort(key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {key === "name" ? t("products.col.info") : key === "sku" ? t("orders.sku") : key === "category" ? t("products.col.category") : key === "price" ? t("products.col.price") : key === "stock" ? t("products.col.stock") : key === "sales" ? t("products.col.sales") : t("orders.col.status")}
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
                  {t("products.empty")}
                </td>
              </tr>
            ) : paged.map((p) => (
              <tr key={p.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggleOne(p.id)} className="accent-primary" />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <img src={p.image} alt={p.name} className="h-10 w-10 rounded-lg object-cover" />
                    <Link to="/products/$id" params={{ id: p.id }} className="font-medium hover:text-primary">
                      {p.name}
                    </Link>
                  </div>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{p.sku}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.category}</td>
                <td className="px-4 py-3 font-medium">${p.price.toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={p.stock === 0 ? "font-medium text-rose-600" : "text-muted-foreground"}>
                    {p.stock}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{p.sales.toLocaleString()}</td>
                <td className="px-4 py-3"><ProductStatusBadge status={p.status} /></td>
                <td className="px-4 py-3">
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
                        <DropdownMenuItem onClick={() => openDispatch(p)}><Send size={14} className="mr-2" />分发刊登</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(p)}><Copy size={14} className="mr-2" />{t("products.copy")}</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-rose-600" onClick={() => setDeleting(p)}><Trash2 size={14} className="mr-2" />{t("common.delete")}</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分发刊登弹窗：选店铺 → 生成草稿 → 打开统一刊登编辑页 */}
      <Dialog open={dispatchOpen} onOpenChange={(o) => { if (!o) { setDispatchOpen(false); setDispatchTarget(null); setDispatchShopId(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Store size={16} className="text-primary" />分发刊登</DialogTitle>
            <DialogDescription>
              将「{dispatchTarget?.name ?? ""}」分发到目标店铺：系统会生成一份绑定该店铺的刊登草稿，公共基础信息从产品基础库复制，站点专属内容在统一刊登编辑页中按店铺规则填写。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>目标店铺</Label>
              {shops.filter((s) => s.status === "正常").length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无可用店铺，请先到「店铺管理」添加并启用店铺</p>
              ) : (
                <select
                  value={dispatchShopId}
                  onChange={(e) => setDispatchShopId(e.target.value)}
                  className="h-9 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">请选择店铺</option>
                  {shops.filter((s) => s.status === "正常").map((s) => (
                    <option key={s.id} value={s.id}>{s.name}（{s.region || s.platform}）</option>
                  ))}
                </select>
              )}
              {shops.length > 0 && shops.filter((s) => s.status !== "正常").length > 0 && (
                <p className="text-xs text-muted-foreground">已停用店铺：{shops.filter((s) => s.status !== "正常").map((s) => s.name).join("、")}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDispatchOpen(false)}>取消</Button>
            <Button size="sm" onClick={() => void handleDispatch()} disabled={!dispatchShopId || dispatching}>
              {dispatching ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Send size={14} className="mr-1.5" />}
              生成草稿并打开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">{t("common.delete")}</AlertDialogAction>
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
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{t("products.allStatus")}</option>
                <option value="在售">{t("status.在售")}</option>
                <option value="下架">{t("status.下架")}</option>
                <option value="草稿">{t("status.草稿")}</option>
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
    </div>
  );
}