import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Printer, PackageCheck, Loader2, ChevronLeft, ChevronRight, Filter, AlertTriangle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { fetchOrders, fetchTable, type OrderRow } from "@/lib/data-access";
import { ShippingLabelDialog, type ShippingLabelData } from "@/components/shipping-label";
import { ShipDialog } from "@/components/ship-dialog";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/orders/to-ship")({
  component: PageOrdersToShip,
});

interface ShopLite { id: string; shop_name: string; platform: string; region: string; status: string; }

// P0-6 待发货工作台：按店铺/渠道筛选 + 勾选多单 → 批量打单 / 批量标记发货
function PageOrdersToShip() {
  const { t, lang } = useLanguage();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [shops, setShops] = useState<ShopLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [filterShop, setFilterShop] = useState("");
  const [filterChannel, setFilterChannel] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 15;
  const [labelData, setLabelData] = useState<ShippingLabelData[] | null>(null);
  const [shipOrders, setShipOrders] = useState<OrderRow[] | null>(null);

  const load = () => {
    fetchOrders()
      .then(setOrders)
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetchTable("shop_auths")
      .then((items) => setShops((items as unknown as ShopLite[]).filter((x) => x.status !== "已失效")))
      .catch((e) => console.error("[to-ship] 加载授权店铺失败", e));
  }, []);

  // 仅待发货（含部分发货）订单进入工作台
  const pending = useMemo(() => orders.filter((o) => o.status === "待发货" || o.status === "部分发货"), [orders]);
  const channels = useMemo(() => Array.from(new Set(pending.map((o) => o.channel).filter(Boolean))), [pending]);

  const filtered = pending.filter((o) => {
    const kw = keyword.toLowerCase();
    const matchKw = !kw || o.id.toLowerCase().includes(kw) || o.buyer.toLowerCase().includes(kw) || o.product.toLowerCase().includes(kw);
    const matchShop = !filterShop || o.shop_id === filterShop;
    const matchChannel = !filterChannel || o.channel === filterChannel;
    return matchKw && matchShop && matchChannel;
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalAmount = filtered.reduce((s, o) => s + (Number(o.amount) || 0), 0);

  const toggleAll = () => {
    const ids = paged.filter((o) => o.status === "待发货").map((o) => o.id);
    const allOn = ids.length > 0 && ids.every((id) => selected.includes(id));
    setSelected((prev) => (allOn ? prev.filter((x) => !ids.includes(x)) : [...new Set([...prev, ...ids])]));
  };
  const toggleOne = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const selectedOrders = useMemo(
    () => filtered.filter((o) => selected.includes(o.id) && o.status === "待发货"),
    [filtered, selected],
  );

  const toLabel = (o: OrderRow): ShippingLabelData => ({
    orderId: o.id,
    buyer: o.buyer,
    phone: (o as unknown as { phone?: string }).phone || "",
    product: o.product,
    sku: o.sku,
    channel: o.channel,
    shopName: o.shop_name,
    amount: Number(o.amount) || 0,
    currency: o.currency,
    createdAt: o.created_at ? new Date(o.created_at).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "",
    address: o.address,
    items: (o as unknown as { items?: { name: string; sku?: string; qty: number }[] })?.items?.filter((x) => x && x.name) || [],
  });

  // 打单：勾选订单 → 批量面单打印页（A4/热敏版式可切换）
  const handlePrint = () => {
    const targets = selectedOrders.length > 0 ? selectedOrders : filtered.filter((o) => o.status === "待发货");
    if (targets.length === 0) {
      toast.error(t("sh.noPrint"));
      return;
    }
    setLabelData(targets.map(toLabel));
  };

  // 发货标记：勾选订单 → 发货弹窗（运单号/承运商 → 状态流转+Woo 回写）
  const handleShip = () => {
    if (selectedOrders.length === 0) {
      toast.error(t("sh.noShip"));
      return;
    }
    setShipOrders(selectedOrders);
  };

  const fmtTime = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "";

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("sh.title")}
        description={t("sh.desc")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer size={15} /> {t("sh.printBtn")}{selectedOrders.length > 0 ? ` (${selectedOrders.length})` : ""}
            </Button>
            <Button size="sm" onClick={handleShip}>
              <PackageCheck size={15} /> {t("sh.shipBtn")}{selectedOrders.length > 0 ? ` (${selectedOrders.length})` : ""}
            </Button>
          </div>
        }
      />

      {/* KPI 摘要 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <div className="text-xs text-muted-foreground">{t("sh.kpi.pending")}</div>
          <div className="mt-1 text-2xl font-semibold">{pending.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <div className="text-xs text-muted-foreground">{t("sh.kpi.filtered")}</div>
          <div className="mt-1 text-2xl font-semibold">{filtered.length}</div>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <div className="text-xs text-muted-foreground">{t("sh.kpi.selected")}</div>
          <div className="mt-1 text-2xl font-semibold text-primary">{selectedOrders.length}</div>
        </div>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-56">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("sh.search")} value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        <select
          value={filterShop}
          onChange={(e) => { setFilterShop(e.target.value); setPage(1); }}
          className="h-8 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t("sh.allShop")}</option>
          {shops.map((x) => (
            <option key={x.id} value={x.id}>{x.shop_name} · {x.platform}</option>
          ))}
        </select>
        <select
          value={filterChannel}
          onChange={(e) => { setFilterChannel(e.target.value); setPage(1); }}
          className="h-8 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t("sh.allChannel")}</option>
          {channels.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {(filterShop || filterChannel || keyword) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterShop(""); setFilterChannel(""); setKeyword(""); }}>
            <Filter size={13} /> {t("sh.reset")}
          </Button>
        )}
      </div>

      {/* 待发货表格 */}
      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={paged.some((o) => o.status === "待发货") && paged.filter((o) => o.status === "待发货").every((o) => selected.includes(o.id))}
                  onChange={toggleAll}
                  className="accent-primary"
                />
              </th>
              {(["orderNo", "buyer", "product", "amount", "channel", "status", "time"] as const).map((key) => (
                <th key={key} className="whitespace-nowrap px-4 py-3 font-medium">{t(`orders.col.${key}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
                  {t("common.loading")}
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  <AlertTriangle size={18} className="mx-auto mb-2 opacity-40" />
                  {t("sh.empty")}
                </td>
              </tr>
            ) : paged.map((o) => (
              <tr key={o.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(o.id)}
                    onChange={() => toggleOne(o.id)}
                    className="accent-primary"
                  />
                </td>
                <td className="px-4 py-3 font-medium text-primary">
                  <Link to="/orders/$id" params={{ id: o.id }} className="hover:underline">{o.id}</Link>
                </td>
                <td className="px-4 py-3">{o.buyer}</td>
                <td className="max-w-56 truncate px-4 py-3 text-muted-foreground" title={o.product}>{o.product}</td>
                <td className="whitespace-nowrap px-4 py-3 font-medium">{o.currency === "USD" ? "$" : "¥"}{Number(o.amount || 0).toFixed(2)}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {o.channel}
                  {o.shop_name && <span className="ml-1.5 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[11px]">{o.shop_name}</span>}
                </td>
                <td className="px-4 py-3"><StatusBadge status={o.status} /></td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{fmtTime(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页栏 */}
      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <span className="text-xs text-muted-foreground">
            {t("common.pageInfo", { page, pageCount, total: filtered.length })} · {t("sh.totalAmount", { amount: totalAmount.toFixed(2) })}
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

      {/* 批量面单打印 */}
      <ShippingLabelDialog open={!!labelData} onOpenChange={(o) => !o && setLabelData(null)} data={labelData} />
      {/* 批量标记发货（状态流转 + waybills + Woo 回写） */}
      <ShipDialog open={!!shipOrders} onOpenChange={(o) => { if (!o) setShipOrders(null); }} orders={shipOrders} onShipped={() => { setSelected([]); load(); }} />
    </div>
  );
}
