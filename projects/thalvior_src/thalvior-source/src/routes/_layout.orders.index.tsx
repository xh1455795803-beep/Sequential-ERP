import { createFileRoute, Link } from "@tanstack/react-router";
import { Printer, PackageCheck, Plus, Trash2, Loader2, RefreshCw, AlertTriangle, CloudDownload, Download, RadioTower, Columns3, Bookmark, X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTable, type DataTableColumn, useTableDensity, useTablePageSize } from "@/components/data-table";
import { FilterBar, SearchField } from "@/components/filter-bar";
import { StatusBadge } from "@/components/status-badge";
import { InlineEditCell } from "@/components/inline-edit";
import { useColumnPrefs, useNamedViews, type NamedView } from "@/hooks/use-table-prefs";
import {
  deleteRow,
  fetchOrders,
  fetchTable,
  fetchTrackingMap,
  insertRow,
  queryTable,
  updateRow,
  type OrderRow,
  type TableFilter,
} from "@/lib/data-access";
import { TrackingUnavailableError } from "@/services/tracking";
import { syncAllShops, getSyncStatus, type SyncStatusResult } from "@/services/orderSyncService";
import { ShippingLabelDialog, type ShippingLabelData } from "@/components/shipping-label";
import { ShipDialog } from "@/components/ship-dialog";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";
import { tt, tk } from "@/i18n/tts";
import { cn } from "@/lib/utils";
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
import { devLog } from "@/lib/devlog";

export const Route = createFileRoute("/_layout/orders/")({
  component: Orders,
});

const statusTabs = ["全部", "待审核", "待付款", "待发货", "部分发货", "已发货", "已完成", "异常", "已取消", "售后中"];

// vV1-T8：本波新增短语（i18n 字典不在本波可改清单内，先就近双语兜底）
const ORD_STRINGS: Record<"zh" | "en", { search: string; clear: string; to: string; amount: string }> = {
  zh: { search: "搜索", clear: "清除", to: "至", amount: "金额" },
  en: { search: "Search", clear: "Clear", to: "to", amount: "Amount" },
};

/**
 * vV1-T8a：内联筛选字段 —— 妙手式「左对齐标签 + 冒号」，13px 次级色标签。
 * 外层用 div 而非 <label>：Radix Select 的 trigger 自带焦点管理，
 * 真 label 会把「点标签」变成「打开下拉」的二次触发。
 */
function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  const { lang } = useLanguage();
  return (
    <div className="flex items-center gap-1.5">
      <Label className="shrink-0 text-[13px] font-normal text-muted-foreground">
        {label}
        {lang === "en" ? ": " : "："}
      </Label>
      {children}
    </div>
  );
}

const emptyForm = { buyer: "", phone: "", product: "", sku: "", channel: "", shop_id: "", amount: "", currency: "USD", status: "待审核", address: "" };

interface ShopLite { id: string; shop_name: string; platform: string; region: string; status: string; }

function Orders() {
  const { t, lang } = useLanguage();
  const os = ORD_STRINGS[lang === "en" ? "en" : "zh"];
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
  // vV1-T8a：高级筛选由弹窗改为常驻筛选区（filterOpen 与筛选弹窗一并移除）
  const [filterChannel, setFilterChannel] = useState("");
  const [shops, setShops] = useState<ShopLite[]>([]);
  const [filterShop, setFilterShop] = useState("");
  // vV1-T8a 新增两组条件：下单时间区间、金额区间
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  // vV1-T7：状态带计数（DB 端 head count）
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [labelData, setLabelData] = useState<ShippingLabelData[] | null>(null);
  const [shipOrders, setShipOrders] = useState<OrderRow[] | null>(null);
  // 订单自动同步（P0-3）：同步状态弹窗 / 立即同步
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatusResult | null>(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  // 排序 + 分页
  const [trackingMap, setTrackingMap] = useState<Record<string, { tracking_status: string; tracking_no: string }>>({});
  const [trackServiceOk, setTrackServiceOk] = useState(true);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  // vV1-T6：每页条数改为全站偏好（localStorage "thalvior.pageSize"，默认 20；原硬编码 10）
  const [pageSize, setPageSizePref] = useTablePageSize(20);
  const changePageSize = (n: number) => {
    setPageSizePref(n);
    setPage(1);
  };
  // 表格第一公民（vis2）：列自定义 + 命名视图 + 备注行内编辑 + 导出
  const orderCols = ["orderNo", "buyer", "product", "channel", "amount", "status", "tracking", "time", "remark"] as const;
  const { visible, toggle, reset: resetCols } = useColumnPrefs("orders", [...orderCols]);
  const { views, save: saveViewRaw, remove: removeView } = useNamedViews("orders");
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [exporting, setExporting] = useState(false);
  // 第 2 批：行密度（纯展示偏好，按页持久化）
  const [density, setDensity] = useTableDensity("thv.density.orders");

  const load = () => {
    fetchOrders()
      .then(setOrders)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  // 联动：加载已授权店铺（订单与店铺授权打通）
  useEffect(() => {
    fetchTable("shop_auths")
      .then((items) =>
        setShops(
          (items as unknown as ShopLite[]).filter((x) => x.status !== "已失效"),
        ),
      )
      .catch((e) => console.error("[orders] 加载授权店铺失败", e));
  }, []);

  useEffect(load, []);

  useEffect(() => {
    fetchTrackingMap()
      .then(setTrackingMap)
      .catch((e) => {
        if (e instanceof TrackingUnavailableError) setTrackServiceOk(false);
        console.error("[orders] tracking map failed", e);
      });
  }, [orders]);

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

  const kw = keyword.trim().toLowerCase();
  const filtered = orders.filter((o) => {
    const matchTab = tab === "全部" || o.status === tab;
    // vV1-T9：运单号也纳入搜索（trackingMap 已随行加载，不额外发请求）
    const matchKw =
      !kw ||
      o.id.toLowerCase().includes(kw) ||
      o.buyer.toLowerCase().includes(kw) ||
      o.product.toLowerCase().includes(kw) ||
      (trackingMap[o.id]?.tracking_no ?? "").toLowerCase().includes(kw);
    const matchChannel = !filterChannel || o.channel === filterChannel;
    const matchShop = !filterShop || o.shop_id === filterShop;
    // vV1-T8a：下单时间区间 + 金额区间
    const ts = o.created_at ? new Date(o.created_at).getTime() : 0;
    const matchFrom = !filterFrom || ts >= new Date(`${filterFrom}T00:00:00`).getTime();
    const matchTo = !filterTo || ts <= new Date(`${filterTo}T23:59:59`).getTime();
    const matchAmtMin = !amountMin || o.amount >= Number(amountMin);
    const matchAmtMax = !amountMax || o.amount <= Number(amountMax);
    return matchTab && matchKw && matchChannel && matchShop && matchFrom && matchTo && matchAmtMin && matchAmtMax;
  });

  const channels = Array.from(new Set(orders.map((o) => o.channel)));

  // vV1-T7：状态带计数 —— 与工作台同一 head count 口径（count:"exact"，只取 1 行 id，不随全表传数）。
  // 过滤条件与列表保持一致（店铺 / 渠道 / 时间 / 金额），唯独不带 status，
  // 于是每个状态 tab 的数字 = 「切过去会看到的条数」；「全部」= 同条件下的总条数。
  // 可见范围交给 RLS（与 fetchOrders 同源），不在前端再 eq("user_id")：
  // 存量订单里有 user_id 为空的历史行，前端再加等值会把它们从计数里漏掉，数字反而对不上列表。
  const statusList = statusTabs.filter((x) => x !== "全部");
  const loadStatusCounts = useCallback(async () => {
    const filters: TableFilter[] = [];
    if (filterShop) filters.push({ field: "shop_id", value: filterShop });
    if (filterChannel) filters.push({ field: "channel", value: filterChannel });
    if (filterFrom) filters.push({ field: "created_at", value: new Date(`${filterFrom}T00:00:00`).toISOString(), op: "gte" });
    if (filterTo) filters.push({ field: "created_at", value: new Date(`${filterTo}T23:59:59`).toISOString(), op: "lte" });
    if (amountMin) filters.push({ field: "amount", value: Number(amountMin), op: "gte" });
    if (amountMax) filters.push({ field: "amount", value: Number(amountMax), op: "lte" });
    const countOf = async (extra?: TableFilter) =>
      (
        await queryTable("orders", {
          filters: extra ? [...filters, extra] : filters,
          select: "id",
          count: "exact",
          limit: 1,
        })
      ).count ?? 0;
    try {
      const [all, ...per] = await Promise.all([
        countOf(),
        ...statusList.map((x) => countOf({ field: "status", value: x })),
      ]);
      const next: Record<string, number> = { 全部: all };
      statusList.forEach((x, i) => {
        next[x] = per[i] ?? 0;
      });
      setStatusCounts(next);
    } catch (e) {
      console.error("[orders] 状态计数加载失败", e);
    }
    // statusList 派生自模块级常量 statusTabs，引用稳定，不入依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterShop, filterChannel, filterFrom, filterTo, amountMin, amountMax]);

  // 挂载取一次；筛选条件变化后重取（列表本身是内存过滤，无需重新拉单）
  useEffect(() => {
    void loadStatusCounts();
  }, [loadStatusCounts, orders]);

  // vV1-T8a：重置 = 清空全部筛选（原弹窗 footer 的「重置」升级为整区重置）
  const resetFilters = () => {
    setKeyword("");
    setTab("全部");
    setFilterChannel("");
    setFilterShop("");
    setFilterFrom("");
    setFilterTo("");
    setAmountMin("");
    setAmountMax("");
    setPage(1);
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
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);
  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  // 第 2 批：通用数据表列定义（渲染层）
  // 字段取值、含义、可排序列均与原表一致；列序统一为 orderCols 声明序
  // （原表头按 orderCols 序渲染、单元格却把 remark 排在 time 之前，备注列默认可见时会表头错位）
  const orderColumns: DataTableColumn<OrderRow>[] = [];
  if (visible("orderNo"))
    orderColumns.push({
      key: "orderNo", header: tk("orders.col.orderNo"), sortable: true, cellClassName: "whitespace-nowrap",
      render: (o) => (
        <Link to="/orders/$id" params={{ id: o.id }} className="font-medium tabular-nums text-primary hover:underline">{o.id}</Link>
      ),
    });
  if (visible("buyer"))
    orderColumns.push({ key: "buyer", header: tk("orders.col.buyer"), sortable: true, render: (o) => o.buyer });
  if (visible("product"))
    orderColumns.push({
      key: "product", header: tk("orders.col.product"), sortable: true,
      render: (o) => <span className="text-muted-foreground">{o.product}</span>,
    });
  if (visible("channel"))
    orderColumns.push({
      key: "channel", header: tk("orders.col.channel"), sortable: true,
      render: (o) => (
        <span className="text-muted-foreground">
          {o.channel}
          {o.shop_name && (
            <span className="ml-1.5 inline-flex items-center rounded-[3px] bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" title={t("orders.shopBadgeTitle")}>
              {o.shop_name}
            </span>
          )}
        </span>
      ),
    });
  if (visible("amount"))
    orderColumns.push({
      key: "amount", header: tk("orders.col.amount"), sortable: true,
      render: (o) => <span className="font-medium tabular-nums">{o.currency === "USD" ? "$" : "¥"}{o.amount.toFixed(2)}</span>,
    });
  if (visible("status"))
    orderColumns.push({ key: "status", header: tk("orders.col.status"), sortable: true, render: (o) => <StatusBadge status={o.status} /> });
  if (visible("tracking"))
    orderColumns.push({
      key: "tracking", header: tk("orders.col.tracking"), sortable: true,
      render: (o) => (
        trackingMap[o.id] ? (
          <span className={`inline-flex h-6 items-center rounded-[3px] border px-2.5 text-xs font-medium ${
            trackingMap[o.id].tracking_status === "delivered" ? "bg-success-bg text-success border-success/30"
            : trackingMap[o.id].tracking_status === "in_transit" ? "bg-info-bg text-info border-info/30"
            : trackingMap[o.id].tracking_status === "exception" ? "bg-danger-bg text-destructive border-destructive/30"
            : trackingMap[o.id].tracking_status === "expired" ? "bg-muted text-muted-foreground border-border"
            : "bg-muted/50 text-muted-foreground border-border"
          }`}>
            {t(`track.status.${trackingMap[o.id].tracking_status}`)}
          </span>
        ) : trackServiceOk ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-warning" title={t("track.serviceInactiveDesc")}>
            <RadioTower size={12} /> {t("track.serviceInactive")}
          </span>
        )
      ),
    });
  if (visible("time"))
    orderColumns.push({
      key: "time", header: tk("orders.col.time"), sortable: true,
      render: (o) => (
        <span className="text-muted-foreground">
          {o.created_at ? new Date(o.created_at).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : ""}
        </span>
      ),
    });
  if (visible("remark"))
    orderColumns.push({
      key: "remark", header: tk("orders.col.remark"), cellClassName: "max-w-44",
      render: (o) => <InlineEditCell value={o.remark} placeholder={t("orders.remarkEmpty")} onCommit={(next) => saveRemark(o.id, next, o.remark ?? "")} />,
    });
  orderColumns.push({
    key: "actions", header: t("common.actions"), align: "right",
    render: (o) => (
      <div className="flex justify-end">
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleting(o)}>
          <Trash2 size={15} />
        </Button>
      </div>
    ),
  });

  // 打印面单：勾选订单 → 批量面单打印页（A4/热敏切换）；未勾选时打印当前筛选第一条
  const toLabel = (o: OrderRow): ShippingLabelData => ({
    orderId: o.id,
    buyer: o.buyer,
    phone: (o as unknown as { phone?: string }).phone || "",
    product: o.product,
    sku: o.sku,
    channel: o.channel,
    shopName: o.shop_name,
    amount: o.amount,
    currency: o.currency,
    createdAt: o.created_at ? new Date(o.created_at).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "",
    address: o.address,
    items: (o as unknown as { items?: { name: string; sku?: string; qty: number }[] })?.items?.filter((x) => x && x.name) || [],
  });
  const handlePrint = () => {
    const targets = selected.length > 0 ? filtered.filter((o) => selected.includes(o.id)) : filtered.slice(0, 1);
    if (targets.length === 0) {
      toast.error(t("orders.noPrint"));
      return;
    }
    devLog("[orders] 打开面单", { count: targets.length });
    setLabelData(targets.map(toLabel));
  };

  const toggleAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map((o) => o.id));

  // 命名视图：应用（恢复筛选快照）/ 保存 / 删除
  const applyView = (v: NamedView) => {
    const st = v.state as {
      keyword?: string; tab?: string; channel?: string; shop?: string;
      from?: string; to?: string; amtMin?: string; amtMax?: string;
    };
    setKeyword(st.keyword ?? "");
    setTab(st.tab ?? "全部");
    setFilterChannel(st.channel ?? "");
    setFilterShop(st.shop ?? "");
    setFilterFrom(st.from ?? "");
    setFilterTo(st.to ?? "");
    setAmountMin(st.amtMin ?? "");
    setAmountMax(st.amtMax ?? "");
    setPage(1);
  };
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    saveViewRaw(name, {
      keyword, tab, channel: filterChannel, shop: filterShop,
      from: filterFrom, to: filterTo, amtMin: amountMin, amtMax: amountMax,
    });
    setViewName("");
    setSaveViewOpen(false);
  };

  // 备注行内编辑：乐观更新 + 失败回滚 + toast
  const saveRemark = async (id: string, next: string, prev: string) => {
    setOrders((rows) => rows.map((r) => (r.id === id ? { ...r, remark: next } : r)));
    try {
      await updateRow("orders", id, { remark: next });
      toast.success(t("common.saved"));
      return true;
    } catch (e) {
      setOrders((rows) => rows.map((r) => (r.id === id ? { ...r, remark: prev } : r)));
      toast.error(t("common.failed", { reason: (e as Error).message }));
      return false;
    }
  };

  // 导出 CSV：勾选优先，否则当前筛选全量
  const exportCsv = () => {
    const rows = selected.length > 0 ? filtered.filter((o) => selected.includes(o.id)) : filtered;
    if (rows.length === 0) {
      toast.error(t("orders.empty"));
      return;
    }
    const head = ["orderNo", "buyer", "product", "sku", "channel", "shop", "currency", "amount", "status", "address", "phone", "remark", "createdAt"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.join(",")];
    for (const o of rows) {
      lines.push([o.id, o.buyer, o.product, o.sku, o.channel, o.shop_name, o.currency, o.amount, o.status, o.address, o.phone, o.remark, o.created_at].map(esc).join(","));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("tbl.exportDone", { v1: rows.length }));
  };
  const toggleOne = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // 同步状态弹窗：加载最近批次 + 各店水位
  const openSyncDialog = () => {
    setSyncOpen(true);
    setSyncStatusLoading(true);
    getSyncStatus()
      .then(setSyncStatus)
      .catch((e) => {
        console.error("[orders] 加载同步状态失败", e);
        toast.error(t("common.failed", { reason: (e as Error).message }));
      })
      .finally(() => setSyncStatusLoading(false));
  };

  // 同步结果 → i18n 文案（数据状态值与翻译 key 静态映射，避免未注册 key 直接外露）
  const syncStatusText = (s: string) =>
    s === "成功" ? t("orders.sync.status.ok")
    : s === "部分成功" ? t("orders.sync.status.partial")
    : s === "失败" ? t("orders.sync.status.fail")
    : s;

  // 立即同步全部 WooCommerce 店铺（增量拉单），完成后刷新订单列表与状态
  const handleSyncNow = async () => {
    setSyncingNow(true);
    try {
      const r = await syncAllShops();
      if (r.ok) {
        toast.success(t("orders.sync.toastSuccess", { fetched: r.total.fetched, inserted: r.total.inserted, updated: r.total.updated }));
      } else {
        const firstErr = r.shops.find((s) => !s.ok)?.error;
        toast.error(`${t("orders.sync.toastFailed")}${firstErr ? `: ${firstErr}` : ""}`);
      }
      getSyncStatus().then(setSyncStatus).catch((e) => console.error(e));
      load();
    } catch (e) {
      console.error(e);
      toast.error(t("common.failed", { reason: (e as Error).message }));
    } finally {
      setSyncingNow(false);
    }
  };

  // 同步时间格式化（跟随界面语言，i18n 铁律）
  const fmtSyncTime = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";

  const handleSave = async () => {
    if (!form.buyer.trim() || !form.product.trim()) {
      toast.error(t("orders.requiredHint"));
      return;
    }
    setSaving(true);
    try {
      const pickedShop = shops.find((x) => x.id === form.shop_id);
      await insertRow("orders", {
        buyer: form.buyer,
        phone: form.phone,
        product: form.product,
        sku: form.sku,
        channel: pickedShop ? pickedShop.platform : form.channel,
        shop_id: pickedShop ? pickedShop.id : null,
        shop_name: pickedShop ? pickedShop.shop_name : "",
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

  // 批量发货（P0-6）：勾选「待发货」订单 → 发货弹窗（运单号/承运商 → 状态流转 + shipments/waybills 落库 + Woo 回写）
  const handleBatchShip = () => {
    const shippable = filtered.filter((o) => selected.includes(o.id) && o.status === "待发货");
    if (shippable.length === 0) {
      toast.error(t("orders.noShip"));
      return;
    }
    setShipOrders(shippable);
  };

  // vV1-T8b：批量操作条 —— 只在有选中行时由 DataTable 的 batchBar 槽渲染
  const bulkBar = (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="font-medium text-fg">{t("tbl.selectedCount", { count: selected.length })}</span>
      <span className="text-border" aria-hidden>
        |
      </span>
      <Button variant="outline" size="sm" onClick={handleBatchShip}>
        <PackageCheck size={14} /> {t("orders.batchShip")}
      </Button>
      <Button variant="outline" size="sm" onClick={handlePrint}>
        <Printer size={14} /> {t("orders.print")}
      </Button>
      <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
        <Download size={14} /> {t("tbl.export")}
      </Button>
      <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelected([])}>
        <X size={14} /> {os.clear}
      </Button>
    </div>
  );

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
            <Button variant="outline" size="sm" onClick={openSyncDialog}>
              <CloudDownload size={15} /> {t("orders.sync.entry")}
            </Button>
            <Button size="sm" onClick={() => setDialogOpen(true)}><Plus size={15} /> {t("orders.add")}</Button>
          </div>
        }
      />

      {/* 异常订单提醒 */}
      {abnormalCount > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/25 bg-warning-bg px-4 py-2.5 text-[13px] text-warning shadow-soft">
          <AlertTriangle size={16} className="shrink-0" />
          <span>{t("orders.abnormal", { count: abnormalCount })}</span>
        </div>
      )}

      {/* 状态 Tab（vV1-T7：每个状态带真实条数；激活态 = 橙色 2px 下划线 + 加粗数字，不再用卡片阴影） */}
      <div className="no-scrollbar flex w-full max-w-full items-center gap-1 overflow-x-auto border-b border-border">
        {statusTabs.map((x) => {
          const on = tab === x;
          const c = statusCounts[x];
          return (
            <button
              key={x}
              onClick={() => {
                setTab(x);
                setPage(1);
              }}
              className={cn(
                "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 pb-2 pt-1.5 text-[13px] transition-colors",
                on ? "border-warning font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {x === "全部" ? t("orders.all") : t(`status.${x}`)}
              <span className={cn("ml-1.5 font-data tabular-nums", on ? "font-semibold text-warning" : "text-fg-subtle")}>
                {c == null ? "—" : c}
              </span>
            </button>
          );
        })}
      </div>

      {/* 筛选区（vV1-T8a：常驻两行内联筛选，原「高级筛选」弹窗已移除） */}
      <div className="space-y-2 rounded-[4px] border border-border bg-surface-raised/60 px-3 py-2.5">
        {/* 第 1 行：店铺 · 平台(渠道) · 状态 · 下单时间区间 */}
        <FilterBar>
          <FilterField label={t("orders.filter.shop")}>
            <Select value={filterShop || "__all"} onValueChange={(v) => { setFilterShop(v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t("orders.allShop")}</SelectItem>
                {shops.map((x) => (
                  <SelectItem key={x.id} value={x.id}>{x.shop_name} · {x.platform}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label={t("orders.channel")}>
            <Select value={filterChannel || "__all"} onValueChange={(v) => { setFilterChannel(v === "__all" ? "" : v); setPage(1); }}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">{t("orders.allChannel")}</SelectItem>
                {channels.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          {/* 状态与上方状态带共用 tab，两处入口互通，不会各筛各的 */}
          <FilterField label={t("orders.col.status")}>
            <Select value={tab} onValueChange={(v) => { setTab(v); setPage(1); }}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {statusTabs.map((x) => (
                  <SelectItem key={x} value={x}>{x === "全部" ? t("orders.all") : t(`status.${x}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label={t("orders.col.time")}>
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={filterFrom}
                max={filterTo || undefined}
                onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
                className="h-8 w-[148px] text-xs"
                aria-label={`${t("orders.col.time")} ${os.to}`}
              />
              <span className="text-xs text-fg-subtle">{os.to}</span>
              <Input
                type="date"
                value={filterTo}
                min={filterFrom || undefined}
                onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
                className="h-8 w-[148px] text-xs"
                aria-label={t("orders.col.time")}
              />
            </div>
          </FilterField>
        </FilterBar>

        {/* 第 2 行：金额区间 · 关键字（含运单号）；右侧 = 视图 / 列设置 / 搜索 / 重置 */}
        <FilterBar
          actions={
            <>
          {/* 命名视图：保存/应用当前筛选 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Bookmark size={14} /> {t("tbl.views")}{views.length > 0 ? ` (${views.length})` : ""}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {views.length === 0 && <div className="px-2 py-1.5 text-[12px] text-muted-foreground">{t("tbl.viewsEmpty")}</div>}
              {views.map((v) => (
                <div key={v.name} className="flex items-center justify-between gap-1 rounded px-1.5 hover:bg-muted">
                  <button
                    className="flex-1 truncate px-1 py-1.5 text-left text-[13px] hover:text-primary"
                    onClick={() => applyView(v)}
                  >
                    {v.name}
                  </button>
                  <button className="p-1 text-muted-foreground/40 hover:text-destructive" onClick={() => removeView(v.name)} title={t("tbl.deleteView")}>
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
          {/* 列显示自定义：localStorage 持久化 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm"><Columns3 size={14} /> {t("tbl.cols")}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
              {orderCols.map((c) => (
                <DropdownMenuCheckboxItem key={c} checked={visible(c)} onCheckedChange={() => toggle(c)} onSelect={(e) => e.preventDefault()}>
                  {c === "remark" ? t("orders.col.remark") : tk(`orders.col.${c}`)}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => resetCols()}><X size={13} /> {t("tbl.colsReset")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

              <Button size="sm" onClick={() => { setPage(1); load(); void loadStatusCounts(); }}>{os.search}</Button>
              <Button variant="outline" size="sm" onClick={resetFilters}>{t("orders.reset")}</Button>
            </>
          }
        >
          <FilterField label={os.amount}>
            <div className="flex items-center gap-1.5">
              <Input
                inputMode="decimal"
                value={amountMin}
                onChange={(e) => { setAmountMin(e.target.value.replace(/[^\d.]/g, "")); setPage(1); }}
                placeholder="Min"
                className="h-8 w-24 text-xs tabular-nums"
                aria-label={`${os.amount} Min`}
              />
              <span className="text-xs text-fg-subtle">{os.to}</span>
              <Input
                inputMode="decimal"
                value={amountMax}
                onChange={(e) => { setAmountMax(e.target.value.replace(/[^\d.]/g, "")); setPage(1); }}
                placeholder="Max"
                className="h-8 w-24 text-xs tabular-nums"
                aria-label={`${os.amount} Max`}
              />
            </div>
          </FilterField>
          <FilterField label={os.search}>
            <SearchField
              value={keyword}
              onChange={(v) => { setKeyword(v); setPage(1); }}
              placeholder={t("orders.search")}
              width="w-60"
            />
          </FilterField>
        </FilterBar>
      </div>

      {/* 订单表格（第 2 批：通用数据表容器） */}
      <DataTable
        columns={orderColumns}
        rows={paged}
        rowKey={(o) => o.id}
        loading={loading}
        emptyState={<EmptyState text={t("orders.empty")} />}
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
        /* vV1-T8b：批量操作条改由 batchBar 槽承载（勾选后才出现，右端「清除」取消选择） */
        batchBar={selected.length > 0 ? bulkBar : undefined}
        pagination={
          !loading && sorted.length > 0
            ? {
                page,
                pageCount,
                total: sorted.length,
                onPageChange: (p) => setPage(Math.max(1, Math.min(pageCount, p))),
                prevLabel: t("common.prev"),
                nextLabel: t("common.next"),
                // vV1-T6：每页条数受控 + 全站持久化（默认 20，档位 10/20/50/100）
                pageSize,
                onPageSizeChange: changePageSize,
              }
            : undefined
        }
      />

      {/* 新增订单弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("orders.add")}</DialogTitle>
            <DialogDescription>{t("orders.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("orders.buyer")} <span className="text-destructive">*</span></Label>
              <Input value={form.buyer} onChange={(e) => setForm({ ...form, buyer: e.target.value })} placeholder={t("orders.ph.buyer")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("orders.col.product")} <span className="text-destructive">*</span></Label>
              <Input value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })} placeholder={t("orders.ph.product")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("orders.sku")}</Label>
                <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder={t("orders.ph.sku")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("orders.form.shopAuth")}</Label>
                <select
                  value={form.shop_id}
                  onChange={(e) => {
                    const sid = e.target.value;
                    const picked = shops.find((x) => x.id === sid);
                    setForm({ ...form, shop_id: sid, channel: picked ? picked.platform : form.channel });
                  }}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("orders.shopManual")}</option>
                  {shops.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.shop_name} · {x.platform}{x.region ? ` (${x.region})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("orders.col.amount")}</Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder={t("orders.ph.amount")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("orders.currency")}</Label>
                <select
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
                className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {statusTabs.filter((s) => s !== "全部").map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("orders.col.channel")}{form.shop_id && <span className="ml-1 text-xs text-muted-foreground">{t("orders.channelAuto")}</span>}</Label>
              <Input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder={t("orders.ph.channel")} disabled={!!form.shop_id} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("orders.phone")}</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={t("orders.ph.phone")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("orders.address")}</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder={t("orders.ph.address")} />
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
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive">{t("common.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 订单同步状态弹窗（P0-3 订单自动同步引擎） */}
      <Dialog open={syncOpen} onOpenChange={setSyncOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("orders.sync.title")}</DialogTitle>
            <DialogDescription>{t("orders.sync.desc")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-1">
            {/* 店铺增量水位 */}
            <div>
              <div className="mb-2 text-sm font-medium">{t("orders.sync.shops")}</div>
              {syncStatusLoading ? (
                <div className="py-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 animate-spin" size={18} />{t("common.loading")}
                </div>
              ) : !syncStatus || syncStatus.shops.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("orders.sync.noShops")}</div>
              ) : (
                <div className="space-y-2">
                  {syncStatus.shops.map((s) => (
                    <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                      <div>
                        <div className="font-medium">{s.shop_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t("orders.sync.lastSync", { time: s.shop_sync_state?.last_synced_at ? fmtSyncTime(s.shop_sync_state.last_synced_at) : t("orders.sync.never") })}
                        </div>
                        {s.shop_sync_state?.last_error && (
                          <div className="mt-0.5 max-w-md truncate text-xs text-destructive" title={s.shop_sync_state.last_error}>{s.shop_sync_state.last_error}</div>
                        )}
                      </div>
                      {s.shop_sync_state?.last_status && (
                        <span className={`rounded-[3px] px-2 py-0.5 text-xs ${
                          s.shop_sync_state.last_status === "成功" ? "bg-success-bg text-success"
                          : s.shop_sync_state.last_status === "失败" ? "bg-danger-bg text-destructive"
                          : "bg-warning-bg text-warning"}`}>
                          {syncStatusText(s.shop_sync_state.last_status)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* 最近同步批次 */}
            <div>
              <div className="mb-2 text-sm font-medium">{t("orders.sync.batches")}</div>
              {!syncStatus || syncStatus.recent_logs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("orders.sync.noLogs")}</div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="whitespace-nowrap px-2.5 py-2 font-medium">{t("orders.sync.col.time")}</th>
                        <th className="px-2.5 py-2 font-medium">{t("orders.sync.col.shop")}</th>
                        <th className="px-2.5 py-2 font-medium">{t("orders.sync.col.source")}</th>
                        <th className="px-2.5 py-2 font-medium">{t("orders.sync.col.result")}</th>
                        <th className="px-2.5 py-2 text-right font-medium">{t("orders.sync.col.fetched")}</th>
                        <th className="px-2.5 py-2 text-right font-medium">{t("orders.sync.col.inserted")}</th>
                        <th className="px-2.5 py-2 text-right font-medium">{t("orders.sync.col.updated")}</th>
                        <th className="px-2.5 py-2 text-right font-medium">{t("orders.sync.col.failed")}</th>
                        <th className="px-2.5 py-2 text-right font-medium">{t("orders.sync.col.duration")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncStatus.recent_logs.map((l) => (
                        <tr key={l.id} className="border-b border-border last:border-0">
                          <td className="whitespace-nowrap px-2.5 py-2 text-muted-foreground">{fmtSyncTime(l.created_at)}</td>
                          <td className="max-w-28 truncate px-2.5 py-2" title={l.shop_name}>{l.shop_name}</td>
                          <td className="whitespace-nowrap px-2.5 py-2 text-muted-foreground">{l.trigger_type === "cron" ? t("orders.sync.source.cron") : t("orders.sync.source.manual")}</td>
                          <td className="whitespace-nowrap px-2.5 py-2">
                            <span className={l.status === "成功" ? "text-success" : l.status === "失败" ? "text-destructive" : "text-warning"}>
                              {syncStatusText(l.status)}
                            </span>
                          </td>
                          <td className="px-2.5 py-2 text-right">{l.fetched_count}</td>
                          <td className="px-2.5 py-2 text-right">{l.inserted_count}</td>
                          <td className="px-2.5 py-2 text-right">{l.updated_count}</td>
                          <td className={`px-2.5 py-2 text-right ${l.failed_count > 0 ? "text-destructive" : ""}`}>{l.failed_count}</td>
                          <td className="px-2.5 py-2 text-right text-muted-foreground">{(l.duration_ms / 1000).toFixed(1)}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSyncOpen(false)}>{t("common.close")}</Button>
            <Button onClick={handleSyncNow} disabled={syncingNow}>
              {syncingNow ? <Loader2 size={15} className="animate-spin" /> : <CloudDownload size={15} />}
              {syncingNow ? t("orders.sync.syncing") : t("orders.sync.syncNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

      {/* 面单打印弹窗（P0-6：批量 + A4/热敏 + 电话/商品明细） */}
      <ShippingLabelDialog open={!!labelData} onOpenChange={(o) => !o && setLabelData(null)} data={labelData} />
      {/* 发货标记弹窗（P0-6：状态流转 + shipments/waybills + Woo 回写） */}
      <ShipDialog open={!!shipOrders} onOpenChange={(o) => { if (!o) setShipOrders(null); }} orders={shipOrders} onShipped={() => { setSelected([]); load(); }} />
    </div>
  );
}