// 刊登发布引擎 · 共享弹窗组件
// PublishListingDialog：选已授权 WooCommerce 店铺 → 真实发布 → 展示结果
// ListingsDialog：刊登记录列表（分页 + 下架远程商品）
import { useEffect, useState } from "react";
import { Rocket, Store, Loader2, ClipboardList, ExternalLink, Ban, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { listMyAuth } from "@/services/shopOAuth";
import { isActiveAuthStatus } from "@/lib/shop-status";
import { useLanguage } from "@/i18n/LanguageContext";
import { createListing, listListings, deleteListing, type ListingRecord } from "@/services/listingService";

interface WooShop {
  id: string;
  shop_name: string;
  shop_domain?: string;
  region?: string;
}

// ─── 状态徽章 ────────────────────────────────────────────────────────
function ListingStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const cls =
    status === "成功" ? "bg-success-bg text-success border-success/30"
    : status === "失败" ? "bg-danger-bg text-destructive border-destructive/30"
    : status === "已下线" ? "bg-muted text-muted-foreground border-border"
    : "bg-warning-bg text-warning border-warning/30";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>{t(`status.${status}`)}</span>;
}

// ─── 刊登到店铺弹窗 ──────────────────────────────────────────────────
export function PublishListingDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  product: { id: string; name: string; sku?: string } | null;
  onPublished?: () => void;
}) {
  const { open, onOpenChange, product, onPublished } = props;
  const { t } = useLanguage();
  const [shops, setShops] = useState<WooShop[]>([]);
  const [loadingShops, setLoadingShops] = useState(false);
  const [shopId, setShopId] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setShopId("");
    setShops([]);
    setLoadingShops(true);
    listMyAuth()
      .then((items) => {
        // 红线：只允许仍有效授权（已授权 / 即将到期）的 WooCommerce 店铺
        setShops(
          (items as Array<Record<string, unknown>>)
            .filter((s) => String(s.platform ?? "").toLowerCase() === "woocommerce" && isActiveAuthStatus(s.status))
            .map((s) => ({ id: String(s.id), shop_name: String(s.shop_name ?? t("publish.unnamedShop")), shop_domain: String(s.shop_domain ?? ""), region: String(s.region ?? "") })),
        );
      })
      .catch((e) => toast.error(t("publish.loadShopsFail", { msg: e instanceof Error ? e.message : t("common.unknownError") })))
      .finally(() => setLoadingShops(false));
  }, [open]);

  const handlePublish = async () => {
    if (!product || !shopId) return;
    setPublishing(true);
    setResult(null);
    try {
      const r = await createListing(product.id, shopId);
      setResult({ ok: true, message: r.message });
      toast.success(t("publish.success"));
      onPublished?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("common.unknownError");
      setResult({ ok: false, message: msg });
      toast.error(t("publish.failWithReason", { msg }));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!publishing) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Rocket size={16} className="text-primary" />{t("publish.toShop")}</DialogTitle>
          <DialogDescription>
            {t("publish.desc", { name: product?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          {result ? (
            <div className={`rounded-lg border p-3 text-sm ${result.ok ? "border-success/30 bg-success-bg text-success" : "border-destructive/30 bg-danger-bg text-destructive"}`}>
              <div className="flex items-center gap-1.5 font-medium">
                {result.ok ? t("publish.success") : t("publish.fail")}
              </div>
              <p className="mt-1 break-all text-xs leading-relaxed">{result.message}</p>
            </div>
          ) : (
            <div className="grid gap-1.5">
              <Label>{t("publish.shopLabel")}</Label>
              {loadingShops ? (
                <div className="flex h-8 items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" />{t("publish.loadingShops")}</div>
              ) : shops.length === 0 ? (
                <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
                  {t("publish.noShops")}
                </p>
              ) : (
                <select
                  value={shopId}
                  onChange={(e) => setShopId(e.target.value)}
                  className="h-8 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary"
                >
                  <option value="">{t("publish.selectShop")}</option>
                  {shops.map((s) => (
                    <option key={s.id} value={s.id}>{s.shop_domain ? t("publish.shopWithDomain", { name: s.shop_name, domain: s.shop_domain }) : s.shop_name}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          {result && result.ok ? (
            <Button size="sm" onClick={() => onOpenChange(false)}>{t("common.done")}</Button>
          ) : (
            <>
              <Button variant="outline" size="sm" disabled={publishing} onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button size="sm" onClick={() => void handlePublish()} disabled={!shopId || publishing || shops.length === 0}>
                {publishing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Rocket size={14} className="mr-1.5" />}
                {publishing ? t("publish.publishing") : t("publish.publishNow")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 刊登记录弹窗 ────────────────────────────────────────────────────
export function ListingsDialog(props: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { open, onOpenChange } = props;
  const { t } = useLanguage();
  const [items, setItems] = useState<ListingRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [offlining, setOfflining] = useState<string | null>(null);
  const PAGE_SIZE = 8;

  const load = (p: number) => {
    setLoading(true);
    listListings(p, PAGE_SIZE)
      .then((r) => { setItems(r.items); setTotal(r.total); setPage(p); })
      .catch((e) => toast.error(t("publish.loadFail", { msg: e instanceof Error ? e.message : t("common.unknownError") })))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) { setPage(1); load(1); }
  }, [open]);

  const handleOffline = async (rec: ListingRecord) => {
    setOfflining(rec.id);
    try {
      const r = await deleteListing(rec.id);
      toast.success(r.message || t("publish.offlineDone"));
      load(page);
    } catch (e) {
      toast.error(t("publish.offlineFail", { msg: e instanceof Error ? e.message : t("common.unknownError") }));
    } finally {
      setOfflining(null);
    }
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fmtTime = (t: string | null) => (t ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : "-");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ClipboardList size={16} className="text-primary" />{t("publish.records")}</DialogTitle>
          <DialogDescription>{t("publish.listingsDesc", { total })}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">{t("publish.col.time")}</th>
                <th className="px-3 py-2.5 font-medium">{t("publish.col.product")}</th>
                <th className="px-3 py-2.5 font-medium">{t("publish.col.shop")}</th>
                <th className="px-3 py-2.5 font-medium">{t("publish.col.status")}</th>
                <th className="px-3 py-2.5 font-medium">{t("publish.col.remoteId")}</th>
                <th className="px-3 py-2.5 font-medium">{t("publish.col.message")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground"><Loader2 size={16} className="mx-auto mb-1.5 animate-spin" />{t("common.loading")}</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">{t("publish.empty")}</td></tr>
              ) : items.map((rec) => (
                <tr key={rec.id} className="border-b border-border last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted-foreground">{fmtTime(rec.created_at)}</td>
                  <td className="max-w-36 truncate px-3 py-2.5 font-medium" title={rec.products?.name ?? rec.product_id ?? ""}>{rec.products?.name ?? rec.product_id ?? "-"}</td>
                  <td className="max-w-32 truncate px-3 py-2.5" title={rec.shop_auths?.shop_name ?? ""}>{rec.shop_auths?.shop_name ?? "-"}</td>
                  <td className="px-3 py-2.5"><ListingStatusBadge status={rec.status} /></td>
                  <td className="px-3 py-2.5 font-mono text-xs">{rec.wc_product_id ?? "-"}</td>
                  <td className="max-w-52 px-3 py-2.5 text-xs text-muted-foreground">
                    <span className="line-clamp-2 break-all" title={rec.error_message ?? ""}>{rec.error_message ?? "-"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {rec.status === "成功" && rec.wc_product_id ? (
                      <Button variant="ghost" size="sm" className="h-7 text-destructive" disabled={offlining === rec.id} onClick={() => void handleOffline(rec)}>
                        {offlining === rec.id ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Ban size={12} className="mr-1" />}{t("publish.offline")}
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <span className="text-xs text-muted-foreground">{t("publish.pageInfo", { page, pageCount })}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={loading} onClick={() => load(page)}><RefreshCw size={13} className="mr-1" />{t("common.refresh")}</Button>
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => load(page - 1)}><ChevronLeft size={13} /></Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount || loading} onClick={() => load(page + 1)}><ChevronRight size={13} /></Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
