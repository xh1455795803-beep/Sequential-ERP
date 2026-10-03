import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Package, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/supabase/client";
import { updateRow } from "@/lib/data-access";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/orders/after-sale_/$id")({
  component: AfterSaleDetailPage,
});

interface AfterSaleRow {
  id: string;
  order_id: string;
  buyer: string;
  product: string;
  reason: string;
  status: string;
  created_at: string;
}

function AfterSaleDetailPage() {
  const { t } = useLanguage();
  const { id } = useParams({ from: "/_layout/orders/after-sale_/$id" });
  const [detail, setDetail] = useState<AfterSaleRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // 处理售后：同意退款 / 拒绝
  const handleResolve = async (status: string) => {
    if (!detail) return;
    setProcessing(true);
    try {
      await updateRow("after_sales", detail.id, { status });
      console.log("[after-sale.$id] 售后处理成功", { id: detail.id, status });
      toast.success(status === "已完成" ? t("afterSale.refundDone") : t("afterSale.rejectDone"));
      setDetail({ ...detail, status });
    } catch (e) {
      console.error("[after-sale.$id] 售后处理失败", e);
      toast.error(t("afterSale.opFail"));
    } finally {
      setProcessing(false);
    }
  };

  useEffect(() => {
    supabase
      .from("after_sales")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        setDetail((data as AfterSaleRow) ?? null);
        setLoading(false);
      })
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 size={20} className="mr-2 animate-spin" /> {t("common.loading")}
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Package size={40} className="mb-3" />
        <p>{t("afterSale.notFound")}</p>
        <Link to="/orders/after-sale" className="mt-3 text-sm text-primary hover:underline">{t("afterSale.back")}</Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/orders/after-sale">
            <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={17} /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{detail.id}</h1>
              <StatusBadge status={detail.status} />
            </div>
            <p className="text-xs text-muted-foreground">{t("afterSale.relatedOrder")} {detail.order_id} · {new Date(detail.created_at).toLocaleString()}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="text-rose-600" onClick={() => handleResolve("已拒绝")} disabled={processing || detail.status !== "待处理"}>
            <XCircle size={14} /> {t("afterSale.reject")}
          </Button>
          <Button size="sm" onClick={() => handleResolve("已完成")} disabled={processing || detail.status !== "待处理"}>
            {processing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />} {t("afterSale.refund")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* 售后信息 */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold">{t("afterSale.info")}</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">{t("afterSale.buyer")}</div>
                <div className="mt-1 font-medium">{detail.buyer || "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{t("afterSale.product")}</div>
                <div className="mt-1 font-medium">{detail.product || "—"}</div>
              </div>
              <div className="col-span-2">
                <div className="text-xs text-muted-foreground">{t("afterSale.reason")}</div>
                <div className="mt-1">{detail.reason || "—"}</div>
              </div>
            </div>
          </div>
        </div>

        {/* 操作建议 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold">{t("afterSale.suggestion")}</h2>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div className="rounded-lg bg-muted/60 p-3">{t("afterSale.suggest1")}</div>
            <div className="rounded-lg bg-muted/60 p-3">{t("afterSale.suggest2")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}