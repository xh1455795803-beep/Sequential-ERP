import { createFileRoute, Link } from "@tanstack/react-router";
import { tk } from "@/i18n/tts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, Check, ExternalLink, Printer, RefreshCw, Loader2, Coins } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/orders_/$id")({
  component: OrderDetailPage,
});

type OrderItem = { name: string; sku: string; qty: number };
type OrderRow = {
  id: string; user_id: string; platform: string | null; shop_id: string | null;
  external_order_id: string | null; customer_name: string | null; customer_email: string | null;
  customer_phone: string | null; address: Record<string, unknown> | null;
  items: OrderItem[] | null; amount: number; currency: string; status: string | null;
  created_at: string; updated_at: string | null;
  shops: { shop_name: string } | null;
  platform_configs: { name: string; display_name: string } | null;
};
type TimelineEvent = { id: string; event_type: string; message: string | null; created_at: string };
type VariantRow = { id: string; sku: string; cost: number; price: number };
type ProductRow = { id: string; sku: string; name: string | null; cost: number; price: number };
type FeeRec = {
  id: string; order_id: string | null; platform: string; platform_order_no: string;
  fee_account_id: string; sku: string; item_name: string; amount: number; currency: string;
  allocation_type: string; allocation_group_id: string | null;
  is_abnormal: boolean; abnormal_reason: string; occurred_at: string | null;
};
type FeeAccRow = { id: string; code: string; is_active: boolean };

const ALLOC_MODES = ["none", "order_amount_ratio", "sku_quantity_ratio", "order_even"] as const;

function OrderDetailPage() {
  const { id } = Route.useParams();
  const { t, lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [copied, setCopied] = useState(false);
  // 费用区块
  const [fees, setFees] = useState<FeeRec[]>([]);
  const [feeAccs, setFeeAccs] = useState<Map<string, string>>(new Map());
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [feesLoading, setFeesLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);

  const accName = useCallback((accountId: string) => {
    const code = feeAccs.get(accountId) ?? "";
    const key = `fee.account.${code}`;
    const v = t(key);
    return v === key ? (code || "—") : v;
  }, [feeAccs, t]);

  const loadFees = useCallback(async (orderId: string) => {
    setFeesLoading(true);
    try {
      const [f, fa, v, p] = await Promise.all([
        supabase.from("platform_fee_records").select("*").eq("order_id", orderId).order("occurred_at", { ascending: true }),
        supabase.from("fee_accounts").select("id, code, is_active"),
        supabase.from("product_variants").select("id, sku, cost, price").not("sku", "is", null),
        supabase.from("products").select("id, sku, name, cost, price").not("sku", "is", null),
      ]);
      if (f.error) throw new Error(f.error.message);
      if (fa.error) throw new Error(fa.error.message);
      setFees((f.data ?? []) as unknown as FeeRec[]);
      setFeeAccs(new Map(((fa.data ?? []) as FeeAccRow[]).map((a) => [a.id, a.code])));
      setVariants((v.data ?? []) as unknown as VariantRow[]);
      setProducts((p.data ?? []) as unknown as ProductRow[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setFeesLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("orders")
        .select("*, shops(shop_name), platform_configs(name, display_name)")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) {
        setLoading(false);
        return;
      }
      setOrder(data as unknown as OrderRow);
      setLoading(false);
      const { data: tl } = await supabase
        .from("order_events")
        .select("id, event_type, message, created_at")
        .eq("order_id", id)
        .order("created_at", { ascending: false });
      setTimeline((tl ?? []) as unknown as TimelineEvent[]);
      await loadFees(id);
    };
    run();
  }, [id, loadFees]);

  // ── 分摊计算（客户端展示层） ──
  const sourceRows = useMemo(() => fees.filter((f) => f.sku === ""), [fees]);
  const derivedRows = useMemo(() => fees.filter((f) => f.sku !== ""), [fees]);
  const currentMode = sourceRows.find((f) => f.allocation_type !== "none")?.allocation_type ?? "none";
  const feeTotalOrder = useMemo(() => sourceRows.reduce((s, f) => s + Number(f.amount), 0), [sourceRows]);
  const unallocated = currentMode === "none" ? feeTotalOrder : 0;

  const unitPrice = useCallback((sku: string): number | null => {
    const v = variants.find((x) => x.sku === sku);
    if (v && Number(v.price) > 0) return Number(v.price);
    const p = products.find((x) => x.sku === sku);
    return p && Number(p.price) > 0 ? Number(p.price) : null;
  }, [variants, products]);
  const unitCost = useCallback((sku: string): number | null => {
    const v = variants.find((x) => x.sku === sku);
    if (v && Number(v.cost) > 0) return Number(v.cost);
    const p = products.find((x) => x.sku === sku);
    return p && Number(p.cost) > 0 ? Number(p.cost) : null;
  }, [variants, products]);

  type SkuNet = {
    sku: string; name: string; qty: number;
    revenue: number | null; feeShare: number; cost: number | null; net: number | null;
  };
  const skuNets: SkuNet[] = useMemo(() => {
    const items = Array.isArray(order?.items) ? order!.items! : [];
    const map = new Map<string, SkuNet>();
    for (const it of items) {
      const cur = map.get(it.sku) ?? { sku: it.sku, name: it.name, qty: 0, revenue: null as number | null, feeShare: 0, cost: null as number | null, net: null as number | null };
      cur.qty += Number(it.qty) || 0;
      const up = unitPrice(it.sku);
      if (up !== null) cur.revenue = (cur.revenue ?? 0) + up * (Number(it.qty) || 0);
      map.set(it.sku, cur);
    }
    for (const d of derivedRows) {
      const cur = map.get(d.sku);
      if (cur) cur.feeShare += Number(d.amount);
    }
    const arr = Array.from(map.values());
    for (const s of arr) {
      const uc = unitCost(s.sku);
      s.cost = uc !== null ? uc * s.qty : null;
      s.net = s.revenue === null || s.cost === null ? null : s.revenue - s.feeShare - s.cost;
    }
    return arr;
  }, [order, derivedRows, unitPrice, unitCost]);

  const applyAllocation = async (mode: string) => {
    if (!order) return;
    setApplying(mode);
    try {
      const { error } = await supabase.rpc("allocate_fees", { p_order_id: order.id, p_mode: mode });
      if (error) throw error;
      await loadFees(order.id);
      toast.success(t("orderDetail.fee.applied"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("orderDetail.fee.applyFailed"));
    } finally {
      setApplying(null);
    }
  };

  const copyOrderId = () => {
    if (!order) return;
    void navigator.clipboard.writeText(order.external_order_id ?? order.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fmtMoney = (n: number, ccy?: string) =>
    `${ccy ? ccy + " " : ""}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={20} className="animate-spin" /> {t("common.loading")}
      </div>
    );
  }
  if (!order) {
    return (
      <div className="space-y-4">
        <PageHeader title={t("orders.detail.title")} description={t("orders.detail.desc")} />
        <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">{t("common.notFound")}</div>
      </div>
    );
  }

  const rawStatus = String(order.status ?? "unknown");
  const statusKey = `orderStatus.${rawStatus}`;
  const statusText = t(statusKey) === statusKey ? rawStatus : t(statusKey);
  const statusColor = ["待付款", "处理中"].includes(rawStatus)
    ? "bg-warning-bg text-warning"
    : ["已发货", "已签收", "已完成"].includes(rawStatus)
      ? "bg-success-bg text-success"
      : ["已取消", "已退款"].includes(rawStatus)
        ? "bg-danger-bg text-destructive"
        : "bg-muted text-muted-foreground";

  const platform = tk(order.platform_configs?.display_name || order.platform_configs?.name || order.platform) || "—";
  const shopName = order.shops?.shop_name || "—";
  const address = order.address as Record<string, string> | null;
  const hasFees = fees.length > 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title={order.external_order_id ?? order.id}
        description={t("orders.detail.desc")}
        actions={
          <>
            <Link to="/orders">
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                <ArrowLeft size={14} /> {t("common.back")}
              </Button>
            </Link>
            <Button variant="outline" size="sm" className="gap-1" onClick={copyOrderId}>
              {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />} {t("common.copy")}
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => window.print()}>
              <Printer size={14} /> {t("orders.detail.print")}
            </Button>
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        {/* 左：商品 + 平台费用分摊 */}
        <div className="space-y-5 lg:col-span-2">
          {/* 商品明细 */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">{t("orders.detail.products")}</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t("orders.detail.th.product")}</th>
                  <th className="px-3 py-2 font-medium">{t("orders.detail.th.sku")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("orders.detail.th.qty")}</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(order.items) ? order.items : []).map((item, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-4 py-3">{item.name}</td>
                    <td className="px-3 py-3 font-mono text-xs">{item.sku || "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">× {item.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 平台费用与分摊 */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Coins size={15} /> {t("orderDetail.fee.title")}
              </div>
              <div className="flex items-center gap-2">
                {hasFees && (
                  <span className="rounded-md bg-danger-bg px-2 py-0.5 text-xs font-medium text-destructive tabular-nums">
                    {t("orderDetail.fee.total")} {fmtMoney(feeTotalOrder, order.currency)}
                  </span>
                )}
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => loadFees(order.id)}>
                  <RefreshCw size={13} /> {t("common.refresh")}
                </Button>
              </div>
            </div>

            {feesLoading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 size={18} className="mr-2 animate-spin" /> {t("common.loading")}
              </div>
            ) : !hasFees ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">{t("orderDetail.fee.none")}</div>
            ) : (
              <div className="space-y-4 px-4 py-3">
                {/* 分摊方式 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("orderDetail.fee.mode")}</span>
                  <div className="inline-flex rounded-lg border border-border p-0.5">
                    {ALLOC_MODES.map((m) => (
                      <button
                        key={m}
                        disabled={applying !== null}
                        onClick={() => applyAllocation(m)}
                        className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60 ${
                          currentMode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {applying === m ? <Loader2 size={11} className="mr-1 inline animate-spin" /> : null}
                        {t(`feeMgmt.alloc.${m}`)}
                      </button>
                    ))}
                  </div>
                  {unallocated > 0 && (
                    <span className="rounded-md bg-warning-bg px-2 py-0.5 text-xs text-warning">
                      {t("orderDetail.fee.unallocated", { n: fmtMoney(unallocated, order.currency) })}
                    </span>
                  )}
                </div>

                {/* 费用记录（源行） */}
                <div className="space-y-1">
                  {sourceRows.map((f) => (
                    <div key={f.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40">
                      <span className="w-40 shrink-0 truncate">{accName(f.fee_account_id)}</span>
                      <span className="flex-1 truncate text-xs text-muted-foreground">
                        {f.platform} · {f.platform_order_no || "—"} · {f.occurred_at ? new Date(f.occurred_at).toLocaleDateString() : "—"}
                        {f.is_abnormal ? <span className="ml-1 text-destructive">⚠ {f.abnormal_reason}</span> : null}
                      </span>
                      <span className={`tabular-nums ${Number(f.amount) < 0 ? "text-success" : "text-foreground"}`}>
                        {Number(f.amount) < 0 ? "+" : ""} {fmtMoney(Number(f.amount), f.currency)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* SKU 级净利（分摊后） */}
                {currentMode !== "none" && skuNets.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-semibold">{t("orderDetail.fee.skuNetTitle")}</p>
                    <div className="overflow-hidden rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/40 text-left text-xs text-muted-foreground">
                            <th className="px-3 py-2 font-medium">{t("orderDetail.fee.col.sku")}</th>
                            <th className="px-2 py-2 text-right font-medium">{t("orderDetail.fee.col.qty")}</th>
                            <th className="px-2 py-2 text-right font-medium">{t("orderDetail.fee.col.revenue")}</th>
                            <th className="px-2 py-2 text-right font-medium">{t("orderDetail.fee.col.feeShare")}</th>
                            <th className="px-2 py-2 text-right font-medium">{t("orderDetail.fee.col.cost")}</th>
                            <th className="px-3 py-2 text-right font-medium">{t("orderDetail.fee.col.net")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {skuNets.map((s) => (
                            <tr key={s.sku} className="border-t border-border">
                              <td className="px-3 py-2">
                                <div className="font-mono text-xs">{s.sku}</div>
                                <div className="text-xs text-muted-foreground">{s.name}</div>
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums">× {s.qty}</td>
                              <td className="px-2 py-2 text-right tabular-nums">
                                {s.revenue === null ? <span title={t("orderDetail.fee.noPrice")}>—</span> : fmtMoney(s.revenue, order.currency)}
                              </td>
                              <td className="px-2 py-2 text-right tabular-nums text-destructive">{s.feeShare !== 0 ? `− ${fmtMoney(s.feeShare, order.currency)}` : "—"}</td>
                              <td className="px-2 py-2 text-right tabular-nums">{s.cost === null ? "—" : fmtMoney(s.cost, order.currency)}</td>
                              <td className={`px-3 py-2 text-right font-medium tabular-nums ${(s.net ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                                {s.net === null ? "—" : fmtMoney(s.net, order.currency)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t border-border bg-muted/20 text-xs font-medium">
                            <td className="px-3 py-2" colSpan={2}>{t("orderDetail.fee.total")}</td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {skuNets.every((s) => s.revenue === null) ? "—" : fmtMoney(skuNets.reduce((a, s) => a + (s.revenue ?? 0), 0), order.currency)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums text-destructive">− {fmtMoney(derivedRows.reduce((a, d) => a + Number(d.amount), 0), order.currency)}</td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {skuNets.every((s) => s.cost === null) ? "—" : fmtMoney(skuNets.reduce((a, s) => a + (s.cost ?? 0), 0), order.currency)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{t("orderDetail.fee.perSku")}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-1.5 text-xs text-muted-foreground">{t("orderDetail.fee.skuNote")}</p>
                  </div>
                )}
                {currentMode === "none" && (
                  <p className="text-xs text-muted-foreground">{t("orderDetail.fee.hint")}</p>
                )}
              </div>
            )}
          </div>

          {/* 收货地址 */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">{t("orders.detail.address")}</div>
            <div className="grid gap-3 px-4 py-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">{t("orders.detail.customer")}</p>
                <p>{order.customer_name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orders.detail.phone")}</p>
                <p>{order.customer_phone ?? "—"}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs text-muted-foreground">{t("orders.detail.addressLine")}</p>
                <p>{address ? [address.line1, address.line2, address.city, address.province, address.postal_code, address.country].filter(Boolean).join(", ") || "—" : "—"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 右：状态 + 金额 + 时间线 */}
        <div className="space-y-5">
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">{t("orders.detail.statusCard")}</div>
            <div className="space-y-3 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("orders.detail.status")}</span>
                <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${statusColor}`}>{statusText}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("orders.detail.platform")}</span>
                <span className="inline-flex items-center gap-1">{platform} <ExternalLink size={12} className="text-muted-foreground" /></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("orders.detail.shop")}</span>
                <span>{shopName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("orders.detail.createdAt")}</span>
                <span className="text-xs">{new Date(order.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</span>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">{t("orders.detail.amountCard")}</div>
            <div className="space-y-3 px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t("orders.detail.orderAmount")}</span>
                <span className="text-lg font-bold tabular-nums">{fmtMoney(Number(order.amount), order.currency)}</span>
              </div>
              {hasFees && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t("orderDetail.fee.total")}</span>
                  <span className="tabular-nums text-destructive">− {fmtMoney(feeTotalOrder, order.currency)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">{t("orders.detail.timeline")}</div>
            <div className="px-4 py-3">
              {timeline.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">{t("orders.detail.noTimeline")}</div>
              ) : (
                <div className="space-y-0">
                  {timeline.map((ev, i) => (
                    <div key={ev.id} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < timeline.length - 1 && <div className="absolute left-[5px] top-4 h-full w-px bg-border" />}
                      <div className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                      <div className="min-w-0">
                        <p className="text-sm">{(() => { const k = `orderEvent.${ev.event_type}`; const v = t(k); return v === k ? (ev.message || ev.event_type) : v; })()}</p>
                        {ev.message && <p className="text-xs text-muted-foreground">{ev.message}</p>}
                        <p className="text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
