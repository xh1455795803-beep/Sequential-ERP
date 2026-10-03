import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { ArrowLeft, Package, Printer, Truck, MapPin, Mail, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { supabase } from "@/supabase/client";
import { updateRow } from "@/lib/data-access";
import { ShippingLabelDialog, type ShippingLabelData } from "@/components/shipping-label";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/orders_/$id")({
  component: OrderDetailPage,
});

interface Order {
  id: string;
  buyer: string;
  product: string;
  sku: string;
  channel: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
}

function OrderDetailPage() {
  const { t } = useLanguage();
  const { id } = useParams({ from: "/_layout/orders_/$id" });
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [shipping, setShipping] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);

  // 确认发货：将订单状态更新为「已发货」
  const handleShip = async () => {
    if (!order || order.status !== "待发货") return;
    setShipping(true);
    try {
      await updateRow("orders", order.id, { status: "已发货" });
      console.log("[orders.$id] 确认发货成功", { id: order.id });
      toast.success(t("orderDetail.shipDone"));
      setOrder({ ...order, status: "已发货" });
    } catch (e) {
      console.error("[orders.$id] 确认发货失败", e);
      toast.error(t("orderDetail.shipFail"));
    } finally {
      setShipping(false);
    }
  };

  // 打印面单：打开标准面单弹窗
  const handlePrint = () => {
    console.log("[orders.$id] 打开面单", { id: order?.id });
    setLabelOpen(true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
      if (cancelled) return;
      if (error) {
        toast.error(`${t("orderDetail.loadFail")}: ${error.message}`);
        setLoading(false);
        return;
      }
      setOrder((data as Order) ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Package size={40} className="mb-3" />
        <p>{t("orderDetail.notFound")}</p>
        <Link to="/orders" className="mt-3 text-sm text-primary hover:underline">{t("orderDetail.back")}</Link>
      </div>
    );
  }

  const symbol = order.currency === "USD" ? "$" : order.currency === "JPY" ? "¥" : order.currency === "EUR" ? "€" : "¥";

  return (
    <div className="space-y-5">
      {/* 顶部 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/orders">
            <Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft size={17} /></Button>
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{order.id}</h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="text-xs text-muted-foreground">{t("orderDetail.orderTime")} {order.created_at} · {order.channel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint}><Printer size={14} /> {t("orderDetail.printLabel")}</Button>
          <Button size="sm" onClick={handleShip} disabled={shipping || order.status !== "待发货"}>
            {shipping ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />} {t("orderDetail.ship")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* 左：商品明细 + 金额 */}
        <div className="space-y-5 xl:col-span-2">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold">{t("orderDetail.productDetail")}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">SKU</th>
                  <th className="py-2 font-medium">{t("orderDetail.productName")}</th>
                  <th className="py-2 text-right font-medium">{t("orderDetail.unitPrice")}</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border last:border-0">
                  <td className="py-3 text-muted-foreground">{order.sku}</td>
                  <td className="py-3 font-medium">{order.product}</td>
                  <td className="py-3 text-right">{symbol}{order.amount.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>

            <div className="mt-4 ml-auto w-64 space-y-2 text-sm">
              <div className="flex justify-between text-muted-foreground"><span>{t("orderDetail.subtotal")}</span><span>{symbol}{order.amount.toFixed(2)}</span></div>
              <div className="flex justify-between border-t border-border pt-2 font-semibold"><span>{t("orderDetail.total")}</span><span className="text-primary">{symbol}{order.amount.toFixed(2)}</span></div>
            </div>
          </div>

          {/* 订单信息 */}
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold">{t("orderDetail.orderInfo")}</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">{t("orderDetail.channel")}</p>
                <p className="mt-1 font-medium">{order.channel}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderDetail.currency")}</p>
                <p className="mt-1 font-medium">{order.currency}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderDetail.status")}</p>
                <p className="mt-1"><StatusBadge status={order.status} /></p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t("orderDetail.orderTime")}</p>
                <p className="mt-1 font-medium">{order.created_at}</p>
              </div>
            </div>
          </div>
        </div>

        {/* 右：买家信息 */}
        <div className="space-y-5">
          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold">{t("orderDetail.buyerInfo")}</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <MapPin size={15} className="shrink-0 text-muted-foreground" />
                <span className="font-medium">{order.buyer}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail size={15} className="shrink-0" /> {t("orderDetail.buyerSync")}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold">{t("orderDetail.remark")}</h2>
            <p className="text-sm text-muted-foreground">{t("orderDetail.noRemark")}</p>
          </div>
        </div>
      </div>

      {/* 面单打印弹窗 */}
      <ShippingLabelDialog
        open={labelOpen}
        onOpenChange={setLabelOpen}
        data={
          order
            ? {
                orderId: order.id,
                buyer: order.buyer,
                product: order.product,
                sku: order.sku,
                channel: order.channel,
                amount: order.amount,
                currency: order.currency,
                createdAt: order.created_at,
              }
            : null
        }
      />
    </div>
  );
}