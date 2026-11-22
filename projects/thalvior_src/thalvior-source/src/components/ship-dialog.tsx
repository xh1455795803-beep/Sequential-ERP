import { CheckCircle2, Loader2, PackageCheck, XCircle, MinusCircle, Truck, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/i18n/LanguageContext";
import { markShipped, auditOrders, type ShipResult, type AuditFailure } from "@/services/shipService";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// 常用跨境承运商（含自定义）。物流商 API 对接前为手工单号，UI 诚实标注。
const CARRIERS = ["DHL", "FedEx", "UPS", "USPS", "SF Express", "4PX", "Yun Express", "Yanwen", "China Post", "CNE", "__custom__"];

export interface ShipOrderLite {
  id: string;
  buyer: string;
  product: string;
  status: string;
}

export function ShipDialog({
  open,
  onOpenChange,
  orders,
  onShipped,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: ShipOrderLite[] | null;
  onShipped?: () => void;
}) {
  const { t, lang } = useLanguage();
  const list = orders ?? [];
  const [carrier, setCarrier] = useState("");
  const [customCarrier, setCustomCarrier] = useState("");
  const [trackingNo, setTrackingNo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ShipResult | null>(null);
  // 发货前自动审单：order_id → 拦截原因（只读预检，权威拦截以服务端为准）
  const [auditMap, setAuditMap] = useState<Record<string, AuditFailure[]> | null>(null);
  const [auditing, setAuditing] = useState(false);

  useEffect(() => {
    if (open) {
      setCarrier("");
      setCustomCarrier("");
      setTrackingNo("");
      setResult(null);
      setAuditMap(null);
      if (list.length) {
        setAuditing(true);
        auditOrders(list.map((o) => o.id))
          .then((r) => {
            const map: Record<string, AuditFailure[]> = {};
            for (const item of r.results ?? []) if (item.failures?.length) map[item.order_id] = item.failures;
            setAuditMap(map);
          })
          .catch(() => setAuditMap({})) // 预检失败静默：服务端发货时仍会强制审单
          .finally(() => setAuditing(false));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const effectiveCarrier = carrier === "custom" ? customCarrier.trim() : carrier;

  // 审单通过的订单才进入发货请求（被拦截的单只展示原因）
  const shipable = list.filter((o) => !auditMap?.[o.id]?.length);
  const blockedOrders = list.filter((o) => auditMap?.[o.id]?.length);
  const pickReason = (f: AuditFailure) => (lang === "en" ? f.reason_en || f.reason : f.reason);

  const handleSubmit = async () => {
    if (!shipable.length) return;
    if (!effectiveCarrier) {
      toast.error(t("ship.errCarrier"));
      return;
    }
    setSubmitting(true);
    try {
      const r = await markShipped(shipable.map((o) => o.id), effectiveCarrier, trackingNo.trim());
      setResult(r);
      const blocked = r.blocked ?? 0;
      if (r.shipped === 0 && blocked > 0 && r.failed === 0 && r.skipped === 0) toast.error(t("ship.toastAllBlocked"));
      else if (r.failed === 0 && r.skipped === 0 && blocked === 0) toast.success(t("ship.toastOk", { count: r.shipped }));
      else if (r.shipped > 0) toast.warning(t("ship.toastPartial", { shipped: r.shipped, total: r.total }));
      else toast.error(t("ship.toastFail"));
      onShipped?.();
    } catch (e) {
      console.error("[ship-dialog] 发货失败", e);
      toast.error(t("common.failed", { reason: (e as Error).message }));
    } finally {
      setSubmitting(false);
    }
  };

  const wooBadge = (r: { woo_writeback?: string; woo_detail?: string; ok: boolean; error?: string; blocked?: boolean; audit_failures?: AuditFailure[] }) => {
    if (r.blocked) {
      const reasons = (r.audit_failures ?? []).map(pickReason).join("；");
      return <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-xs text-destructive" title={reasons}><ShieldAlert size={12} />{t("ship.result.blocked")}</span>;
    }
    if (!r.ok) return <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-xs text-destructive" title={r.error}><XCircle size={12} />{t("ship.result.fail")}</span>;
    if (r.woo_writeback === "completed") return <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-xs text-success" title={r.woo_detail}><CheckCircle2 size={12} />{t("ship.result.wooOk")}</span>;
    if (r.woo_writeback === "failed") return <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-xs text-destructive" title={r.woo_detail}><XCircle size={12} />{t("ship.result.wooFail")}</span>;
    return <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" title={r.woo_detail}><MinusCircle size={12} />{t("ship.result.wooSkip")}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("ship.title")}{list.length > 1 ? ` × ${list.length}` : ""}</DialogTitle>
          <DialogDescription>{t("ship.desc")}</DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="grid gap-4 py-1">
            {/* 发货前自动审单结果（前置校验，原因明细） */}
            {auditing ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                <span>{t("sh.audit.checking")}</span>
              </div>
            ) : blockedOrders.length > 0 ? (
              <div className="rounded-lg border border-destructive/30 bg-danger-bg px-3 py-2 text-xs text-destructive">
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldAlert size={14} className="shrink-0" />
                  <span>{t("sh.audit.blockedTitle", { count: blockedOrders.length })}</span>
                </div>
                <div className="mt-1.5 max-h-24 space-y-1 overflow-y-auto">
                  {blockedOrders.map((o) => (
                    <div key={o.id} className="flex gap-1.5">
                      <span className="shrink-0 font-medium">{o.id}</span>
                      <span className="min-w-0">{(auditMap?.[o.id] ?? []).map(pickReason).join("；")}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-xs text-success">
                <ShieldCheck size={14} className="shrink-0" />
                <span>{t("sh.audit.passed")}</span>
              </div>
            )}

            {/* 诚实对接说明 */}
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
              <Truck size={14} className="mt-0.5 shrink-0" />
              <span>{t("ship.honestNote")}</span>
            </div>

            {/* 订单摘要（>3 单折叠显示） */}
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border px-3 py-2 text-sm">
              {list.slice(0, 8).map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-primary">{o.id}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{o.buyer} · {o.product}</span>
                </div>
              ))}
              {list.length > 8 && <div className="text-xs text-muted-foreground">{t("ship.moreOrders", { count: list.length - 8 })}</div>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("ship.carrier")} <span className="text-destructive">*</span></Label>
                <select
                  value={carrier}
                  onChange={(e) => setCarrier(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">{t("ship.carrierPick")}</option>
                  {CARRIERS.map((c) => (
                    <option key={c} value={c === "__custom__" ? "custom" : c}>
                      {c === "__custom__" ? t("ship.carrierCustom") : c}
                    </option>
                  ))}
                </select>
                {carrier === "custom" && (
                  <Input value={customCarrier} onChange={(e) => setCustomCarrier(e.target.value)} placeholder={t("ship.carrierCustomPh")} className="mt-1" />
                )}
              </div>
              <div className="grid gap-1.5">
                <Label>{t("ship.tracking")}</Label>
                <Input value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder={t("ship.trackingPh")} />
                <p className="text-xs text-muted-foreground">{t("ship.trackingHint")}</p>
              </div>
            </div>
          </div>
        ) : (
          /* 结果回执：逐单展示 审单/运单号 + Woo 回写状态（诚实） */
          <div className="space-y-2 py-1">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-success-bg px-2.5 py-1 text-success">{t("ship.result.shipped")}: {result.shipped}/{result.total}</span>
              {(result.blocked ?? 0) > 0 && <span className="rounded-full bg-danger-bg px-2.5 py-1 text-destructive">{t("ship.result.blocked")}: {result.blocked}</span>}
              {result.skipped > 0 && <span className="rounded-full bg-warning-bg px-2.5 py-1 text-warning">{t("ship.result.skipped")}: {result.skipped}</span>}
              {result.failed > 0 && <span className="rounded-full bg-danger-bg px-2.5 py-1 text-destructive">{t("ship.result.failed")}: {result.failed}</span>}
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
              {result.results.map((r) => (
                <div key={r.order_id} className="flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40">
                  <span className="min-w-0 flex-1 truncate font-medium">{r.order_id}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{r.tracking_no ?? "—"}</span>
                  {wooBadge(r)}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t("ship.result.note")}</p>
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
              <Button onClick={handleSubmit} disabled={submitting || !shipable.length || auditing}>
                {submitting ? <Loader2 size={14} className="mr-1 animate-spin" /> : <PackageCheck size={14} className="mr-1" />}
                {submitting ? t("ship.submitting") : (shipable.length < list.length ? t("ship.submitPartial", { ok: shipable.length, total: list.length }) : t("ship.submit"))}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
