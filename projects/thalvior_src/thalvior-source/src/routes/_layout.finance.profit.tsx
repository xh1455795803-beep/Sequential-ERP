import { createFileRoute } from "@tanstack/react-router";
import { tk } from "@/i18n/tts";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, ChevronDown, ChevronRight, Coins, ReceiptText, Boxes, TrendingUp } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext"
import { fmtDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/_layout/finance/profit")({
  component: ProfitPage,
});

const CARD_CLS = "rounded-xl border border-border bg-card p-4 shadow-sm";
type OrderRow = {
  id: string; user_id: string; platform: string | null; shop_id: string | null; external_order_id: string | null;
  customer_name: string | null; items: { name: string; sku: string; qty: number }[] | null;
  amount: number; currency: string; status: string | null; created_at: string;
};
type ProductRow = { id: string; sku: string; name: string | null; cost: number };
type ShopRow = { id: string; shop_name: string };
type FeeRec = {
  id: string; order_id: string | null; platform: string; platform_order_no: string;
  fee_account_id: string; sku: string; item_name: string; amount: number; currency: string;
  allocation_type: string; allocation_group_id: string | null;
  is_abnormal: boolean; abnormal_reason: string; occurred_at: string | null;
};
type FeeAgg = { code: string; amounts: Map<string, number>; count: number };

function ProfitPage() {
  const {  t , lang } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [shops, setShops] = useState<ShopRow[]>([]);
  const [fees, setFees] = useState<FeeRec[]>([]);
  const [acctCode, setAcctCode] = useState<Map<string, string>>(new Map());
  const [range, setRange] = useState<"7" | "30" | "all">("30");
  const [shopFilter, setShopFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [platforms, setPlatforms] = useState<{ id: string; name: string }[]>([]);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, p, s, pc, f, fa] = await Promise.all([
        supabase.from("orders").select("*").order("created_at", { ascending: false }),
        supabase.from("products").select("id, sku, name, cost").not("sku", "is", null),
        supabase.from("shop_auths").select("id, shop_name"),
        supabase.from("platform_configs").select("id, name"),
        supabase.from("platform_fee_records").select("*").order("occurred_at", { ascending: false }),
        supabase.from("fee_accounts").select("id, code"),
      ]);
      if (o.error) throw new Error(o.error.message);
      if (p.error) throw new Error(p.error.message);
      if (s.error) throw new Error(s.error.message);
      if (pc.error) throw new Error(pc.error.message);
      if (f.error) throw new Error(f.error.message);
      if (fa.error) throw new Error(fa.error.message);
      setOrders((o.data ?? []) as unknown as OrderRow[]);
      setProducts((p.data ?? []) as unknown as ProductRow[]);
      setShops((s.data ?? []) as unknown as ShopRow[]);
      setPlatforms((pc.data ?? []) as unknown as { id: string; name: string }[]);
      setFees((f.data ?? []) as unknown as FeeRec[]);
      setAcctCode(new Map(((fa.data ?? []) as { id: string; code: string }[]).map((a) => [a.id, a.code])));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const accName = useCallback((accountId: string) => {
    const code = acctCode.get(accountId) ?? "";
    const key = `fee.account.${code}`;
    const v = t(key);
    return v === key ? (code || t("profit.fee.unknown")) : v;
  }, [acctCode, t]);

  // ── 基准币种：取当前筛选范围内收入金额最多币种 ──
  const fromIso = useMemo(() => (range === "all" ? null : new Date(Date.now() - Number(range) * 86400_000).toISOString()), [range]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (shopFilter !== "all" && o.shop_id !== shopFilter) return false;
      if (platformFilter !== "all" && o.platform !== platformFilter) return false;
      if (fromIso && o.created_at < fromIso) return false;
      if (["已取消", "已退款"].includes(o.status ?? "")) return false;
      return true;
    });
  }, [orders, shopFilter, platformFilter, fromIso]);

  const baseCcy = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of filteredOrders) m.set(o.currency, (m.get(o.currency) ?? 0) + Number(o.amount));
    let best = ""; let max = -1;
    for (const [c, v] of m) if (v > max) { max = v; best = c; }
    return best || null;
  }, [filteredOrders]);

  const filteredIds = useMemo(() => new Set(filteredOrders.map((o) => o.id)), [filteredOrders]);

  // ── 费用：参与利润的订单费用 + 未关联订单费用 ──
  // 聚合口径只用「源行」（allocation_group_id 为空）；SKU 分摊衍生行仅用于订单展开展示，避免双重计费
  const feesOfFiltered = useMemo(
    () => fees.filter((f) => f.order_id && filteredIds.has(f.order_id)),
    [fees, filteredIds],
  );
  const srcFeesOfFiltered = useMemo(
    () => feesOfFiltered.filter((f) => !f.allocation_group_id),
    [feesOfFiltered],
  );
  const unlinkedFees = useMemo(
    () => fees.filter((f) => !f.order_id && !f.allocation_group_id && (!fromIso || (f.occurred_at ?? "") >= fromIso)),
    [fees, fromIso],
  );

  const feeTotalBase = useMemo(
    () => srcFeesOfFiltered.filter((f) => f.currency === baseCcy).reduce((s, f) => s + Number(f.amount), 0),
    [srcFeesOfFiltered, baseCcy],
  );

  const revenueBase = useMemo(
    () => filteredOrders.filter((o) => o.currency === baseCcy).reduce((s, o) => s + Number(o.amount), 0),
    [filteredOrders, baseCcy],
  );

  const costOfOrder = useCallback((o: OrderRow): number | null => {
    const items = Array.isArray(o.items) ? o.items : [];
    if (items.length === 0) return null;
    let total = 0; let missing = false;
    for (const item of items) {
      const p = products.find((x) => x.sku === item.sku);
      if (p && Number(p.cost) > 0) total += Number(p.cost) * Number(item.qty);
      else missing = true;
    }
    return missing && total === 0 ? null : total;
  }, [products]);

  // ── 每单净利（实算/估算） ──
  type OrderNet = {
    order: OrderRow; feeTotal: number; cost: number | null; net: number | null;
    isReal: boolean; feeRows: FeeRec[]; estRows: string[];
  };
  const orderNets: OrderNet[] = useMemo(() => {
    return filteredOrders.map((o) => {
      const rows = feesOfFiltered.filter((f) => f.order_id === o.id);
      const srcSameCcy = rows.filter((f) => !f.allocation_group_id && f.currency === o.currency);
      const feeTotal = srcSameCcy.reduce((s, f) => s + Number(f.amount), 0);
      const cost = costOfOrder(o);
      const isReal = rows.length > 0;
      const net = cost === null ? null : Number(o.amount) - feeTotal - cost;
      const estRows: string[] = [];
      if (cost === null) estRows.push(t("profit.order.est.noCost"));
      if (!isReal) estRows.push(t("profit.order.est.noFees"));
      return { order: o, feeTotal, cost, net, isReal, feeRows: rows, estRows };
    });
  }, [filteredOrders, feesOfFiltered, costOfOrder, t]);

  const hasEstimate = orderNets.some((x) => !x.isReal);

  const profitBase = baseCcy ? revenueBase - feeTotalBase - (filteredOrders.filter((o) => o.currency === baseCcy).reduce((s, o) => s + (costOfOrder(o) ?? 0), 0)) : 0;
  const marginBase = revenueBase > 0 ? (profitBase / revenueBase) * 100 : 0;

  // ── 费用明细：大类 → 科目 两级聚合 ──
  const feeGroups = useMemo(() => {
    const list = [...srcFeesOfFiltered, ...unlinkedFees];
    const catMap = new Map<string, Map<string, FeeAgg>>();
    for (const f of list) {
      const code = acctCode.get(f.fee_account_id) ?? "";
      const cat = code.split(".")[0] || "other";
      const accMap = catMap.get(cat) ?? new Map<string, FeeAgg>();
      const agg = accMap.get(code) ?? { code, amounts: new Map<string, number>(), count: 0 };
      agg.amounts.set(f.currency, (agg.amounts.get(f.currency) ?? 0) + Number(f.amount));
      agg.count += 1;
      accMap.set(code, agg);
      catMap.set(cat, accMap);
    }
    const totalBase = feeTotalBase + unlinkedFees.filter((f) => f.currency === baseCcy).reduce((s, f) => s + Number(f.amount), 0);
    const cats = Array.from(catMap.entries())
      .map(([cat, accMap]) => {
        const accounts = Array.from(accMap.values()).map((a) => {
          const baseAmt = a.amounts.get(baseCcy ?? "") ?? 0;
          return { ...a, baseAmt, share: totalBase > 0 ? baseAmt / totalBase : 0 };
        });
        accounts.sort((x, y) => y.baseAmt - x.baseAmt || x.code.localeCompare(y.code));
        const catBase = accounts.reduce((s, a) => s + a.baseAmt, 0);
        return { cat, accounts, catBase };
      })
      .sort((x, y) => y.catBase - x.catBase);
    return { cats, totalBase };
  }, [srcFeesOfFiltered, unlinkedFees, acctCode, baseCcy, feeTotalBase]);

  const abnormalFees = useMemo(() => fees.filter((f) => f.is_abnormal && !f.allocation_group_id), [fees]);
  const abnormalLinked = useMemo(
    () => abnormalFees.filter((f) => !f.order_id || filteredIds.has(f.order_id)),
    [abnormalFees, filteredIds],
  );

  const fmtMoney = (n: number, ccy?: string) =>
    `${ccy ? ccy + " " : ""}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const platformName = (pid: string | null) => {
    const p = platforms.find((x) => x.id === pid);
    return p ? tk(p.name) : t("common.na");
  };
  const shopName = (sid: string | null) => {
    const s = shops.find((x) => x.id === sid);
    return s ? s.shop_name : t("common.na");
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("fin.menu.profit")} description={t("fin.menu.profit.desc")} />
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={20} className="animate-spin" /> {t("fin.loading")}
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("fin.menu.profit")} description={t("fin.menu.profit.desc")} />
        <div className="rounded-xl border border-border bg-card px-4 py-12 text-center text-sm text-destructive">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t("fin.menu.profit")} description={t("fin.menu.profit.desc")} />

      {/* 筛选器 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-0.5 shadow-sm">
          {([["7", t("fin.filter.7d")], ["30", t("fin.filter.30d")], ["all", t("fin.filter.all")]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setRange(k as "7" | "30" | "all")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${range === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">{t("fin.filter.allPlatforms")}</option>
          {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={shopFilter} onChange={(e) => setShopFilter(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30">
          <option value="all">{t("fin.filter.allShops")}</option>
          {shops.map((s) => <option key={s.id} value={s.id}>{s.shop_name}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-2">
          {baseCcy && (
            <span className="rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              {t("fin.baseCurrency")} {baseCcy}
            </span>
          )}
          {hasEstimate && (
            <span className="rounded-md bg-warning-bg px-2.5 py-1 text-xs text-warning">
              {t("profit.badge.partialEstimate")}
            </span>
          )}
        </div>
      </div>

      {/* 指标卡：彩色数据卡统一组件 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={t("fin.stat.revenue")}
          value={`${revenueBase > 0 && baseCcy ? baseCcy + " " : ""}${revenueBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={<Coins size={17} />}
          tone="primary"
        />
        <StatCard
          label={t("profit.stat.fees")}
          value={`${baseCcy ? baseCcy + " " : ""}${feeTotalBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={<ReceiptText size={17} />}
          tone="danger"
        />
        <StatCard
          label={t("fin.stat.cost")}
          value={`${baseCcy ? baseCcy + " " : ""}${filteredOrders.filter((o) => o.currency === baseCcy).reduce((s, o) => s + (costOfOrder(o) ?? 0), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={<Boxes size={17} />}
          tone="warning"
        />
        <StatCard
          label={t("fin.stat.profit")}
          value={`${baseCcy ? baseCcy + " " : ""}${profitBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={<TrendingUp size={17} />}
          tone="success"
          valueClassName={profitBase >= 0 ? "text-success" : "text-destructive"}
          footer={<p className="mt-1 text-xs text-muted-foreground">{t("fin.stat.margin")}: {marginBase.toFixed(1)}%</p>}
        />
      </div>

      {/* 平台费用明细（大类 → 科目 两级 + 占比条） */}
      <div className={CARD_CLS}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("profit.fee.title")}</h3>
          <span className="text-xs text-muted-foreground">{t("profit.fee.total", { n: srcFeesOfFiltered.length + unlinkedFees.length })}</span>
        </div>
        {feeGroups.cats.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("profit.fee.none")}</div>
        ) : (
          <div className="space-y-4">
            {feeGroups.cats.map(({ cat, accounts, catBase }) => (
              <div key={cat}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground/90">{t(`fee.cat.${cat}`)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {baseCcy ? `${baseCcy} ${catBase.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}
                  </span>
                </div>
                <div className="space-y-1">
                  {accounts.map((a) => {
                    const amounts = Array.from(a.amounts.entries());
                    return (
                      <div key={a.code} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/40">
                        <span className="w-44 shrink-0 truncate text-sm" title={a.code}>{accNameByCode(a.code)}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(a.share * 100, a.baseAmt > 0 ? 2 : 0)}%` }} />
                        </div>
                        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          {(a.share * 100).toFixed(1)}%
                        </span>
                        <span className="w-40 shrink-0 text-right text-sm tabular-nums">
                          {amounts.map(([c, v]) => (
                            <span key={c} className={v < 0 ? "text-success" : ""}>
                              {c} {v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              {amounts.length > 1 ? "　" : ""}
                            </span>
                          ))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="border-t border-border pt-2 text-xs text-muted-foreground">{t("profit.fee.note")}</p>
          </div>
        )}
      </div>

      {/* 订单净利明细（实算/估算） */}
      <div className={CARD_CLS}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t("profit.order.title")}</h3>
          <span className="text-xs text-muted-foreground">{t("profit.order.count", { n: orderNets.length })}</span>
        </div>
        {orderNets.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("profit.order.none")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="w-6 py-2"></th>
                  <th className="px-3 py-2 font-medium">{t("fin.tbl.order")}</th>
                  <th className="px-3 py-2 font-medium">{t("fin.tbl.time")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("fin.tbl.revenue")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("profit.order.col.fee")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("fin.tbl.cost")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("fin.tbl.profit")}</th>
                  <th className="px-3 py-2 font-medium">{t("profit.order.col.source")}</th>
                </tr>
              </thead>
              <tbody>
                {orderNets.slice(0, 100).map((x) => {
                  const open = expandedOrder === x.order.id;
                  return (
                    <Fragment key={x.order.id}>
                      <tr className="cursor-pointer border-t border-border hover:bg-muted/40" onClick={() => setExpandedOrder(open ? null : x.order.id)}>
                        <td className="py-2.5 pl-2 text-muted-foreground">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td className="max-w-48 px-3 py-2.5">
                          <div className="truncate font-mono text-xs">{x.order.external_order_id ?? x.order.id}</div>
                          <div className="truncate text-xs text-muted-foreground">{platformName(x.order.platform)} · {shopName(x.order.shop_id)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDateTime(x.order.created_at, lang)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtMoney(Number(x.order.amount), x.order.currency)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-destructive">
                          {x.isReal ? `− ${fmtMoney(x.feeTotal, x.order.currency)}` : <span className="text-muted-foreground/60">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{x.cost === null ? "—" : fmtMoney(x.cost, x.order.currency)}</td>
                        <td className={`px-3 py-2.5 text-right font-medium tabular-nums ${(x.net ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                          {x.net === null ? "—" : fmtMoney(x.net, x.order.currency)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${x.isReal ? "bg-success-bg text-success" : "bg-warning-bg text-warning"}`}>
                            {x.isReal ? t("profit.badge.real") : t("profit.badge.estimate")}
                          </span>
                        </td>
                      </tr>
                      {open && (
                        <tr key={`${x.order.id}-detail`} className="border-t border-border bg-muted/20">
                          <td></td>
                          <td colSpan={7} className="px-3 py-3">
                            {x.feeRows.length === 0 ? (
                              <p className="text-xs text-muted-foreground">{t("profit.order.noFeeDetail")}</p>
                            ) : (
                              <div className="space-y-1">
                                <p className="text-xs font-semibold">{t("profit.order.feeDetail")}</p>
                                {x.feeRows.map((f) => (
                                  <div key={f.id} className="flex items-center gap-2 text-xs">
                                    <span className="w-40 truncate">{accName(f.fee_account_id)}</span>
                                    {f.sku ? <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{f.sku}</span> : null}
                                    <span className="flex-1 truncate text-muted-foreground">
                                      {f.platform} · {f.platform_order_no || "—"} · {f.allocation_type !== "none" ? t(`feeMgmt.alloc.${f.allocation_type}`) : ""}
                                      {f.is_abnormal ? ` ⚠ ${f.abnormal_reason}` : ""}
                                    </span>
                                    <span className={`tabular-nums ${Number(f.amount) < 0 ? "text-success" : "text-destructive"}`}>
                                      {Number(f.amount) < 0 ? "+" : "−"} {fmtMoney(Math.abs(Number(f.amount)), f.currency)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {x.estRows.length > 0 && (
                              <p className="mt-2 text-xs text-warning">{x.estRows.join("；")}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {orderNets.length > 100 && (
              <p className="py-2 text-center text-xs text-muted-foreground">{t("profit.order.more", { n: orderNets.length - 100 })}</p>
            )}
          </div>
        )}
        <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">{t("profit.order.formula")}</p>
      </div>

      {/* 费用异常 */}
      <div className={CARD_CLS}>
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={15} className={abnormalLinked.length > 0 ? "text-destructive" : "text-muted-foreground"} />
          <h3 className="text-sm font-semibold">{t("profit.abnormal.title")}</h3>
          {abnormalLinked.length > 0 && (
            <span className="rounded-md bg-danger-bg px-2 py-0.5 text-xs font-medium text-destructive">{abnormalLinked.length}</span>
          )}
        </div>
        {abnormalLinked.length === 0 ? (
          <div className="py-5 text-center text-sm text-muted-foreground">{t("profit.abnormal.none")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">{t("profit.abnormal.col.order")}</th>
                  <th className="px-3 py-2 font-medium">{t("profit.abnormal.col.account")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("profit.abnormal.col.amount")}</th>
                  <th className="px-3 py-2 font-medium">{t("profit.abnormal.col.reason")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("profit.abnormal.col.time")}</th>
                </tr>
              </thead>
              <tbody>
                {abnormalLinked.slice(0, 30).map((f) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="max-w-40 truncate py-2.5 pr-3 font-mono text-xs">{f.platform_order_no || (f.order_id ? f.order_id.slice(0, 13) + "…" : "—")}</td>
                    <td className="px-3 py-2.5">{accName(f.fee_account_id)}</td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${Number(f.amount) < 0 ? "text-success" : "text-destructive"}`}>
                      {fmtMoney(Number(f.amount), f.currency)}
                    </td>
                    <td className="max-w-72 px-3 py-2.5 text-xs text-muted-foreground">{f.abnormal_reason}</td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">{f.occurred_at ? fmtDateTime(f.occurred_at, lang) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 口径说明 */}
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        <p>{t("profit.note.method")}</p>
        <p className="mt-1">{t("profit.note.pending")}</p>
      </div>
    </div>
  );

  function accNameByCode(code: string) {
    const key = `fee.account.${code}`;
    const v = t(key);
    return v === key ? (code || t("profit.fee.unknown")) : v;
  }
}
