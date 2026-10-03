import { Printer, X } from "lucide-react";
import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// 标准物流面单数据
export interface ShippingLabelData {
  orderId: string;
  buyer: string;
  product: string;
  sku: string;
  channel: string;
  amount: number;
  currency: string;
  createdAt: string;
  address?: string;
}

// 生成规范运单号：TL + 时间戳 + 校验位（本地生成，可注册到 17TRACK 供轨迹查询）
function genTrackingNo(orderId: string): string {
  const seed = orderId.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8).padEnd(8, "0").toUpperCase();
  const ts = Date.now().toString().slice(-8);
  const raw = `${seed}${ts}`;
  // 简单校验位：字符码求和取模 36，转大写字母数字
  const sum = raw.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const check = (sum % 36).toString(36).toUpperCase();
  return `TL${raw}${check}`;
}

// 标准 Code128 条码（jsbarcode 生成 SVG，扫码枪可识别）
function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: "CODE128",
        displayValue: false,
        height: 48,
        width: 1.6,
        margin: 0,
        background: "transparent",
        lineColor: "#000000",
      });
    } catch (e) {
      console.error("[shipping-label] 条码生成失败", e);
    }
  }, [value]);
  return <svg ref={ref} className="h-12 w-full" />;
}

export function ShippingLabelDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ShippingLabelData | null;
}) {
  if (!data) return null;
  const { t } = useLanguage();
  const trackingNo = genTrackingNo(data.orderId);
  const symbol = data.currency === "USD" ? "$" : data.currency === "JPY" ? "¥" : data.currency === "EUR" ? "€" : "¥";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("label.title")}</DialogTitle>
          <DialogDescription>{t("label.desc")}</DialogDescription>
        </DialogHeader>

        {/* 面单主体 */}
        <div id="shipping-label" className="rounded-lg border border-border bg-white p-5 text-foreground">
          {/* 顶部：渠道 + 单号 */}
          <div className="flex items-start justify-between border-b border-border pb-3">
            <div>
              <div className="text-xs text-muted-foreground">{t("label.channel")}</div>
              <div className="text-sm font-semibold">{data.channel}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">{t("label.trackingNo")}</div>
              <div className="font-mono text-sm font-semibold tracking-wide">{trackingNo}</div>
            </div>
          </div>

          {/* 收件人 */}
          <div className="mt-4">
            <div className="text-xs text-muted-foreground">{t("label.recipient")}</div>
            <div className="mt-1 text-base font-semibold">{data.buyer}</div>
            <div className="text-xs text-muted-foreground">{data.address || t("label.addressPending")}</div>
          </div>

          {/* 商品明细 */}
          <div className="mt-4 rounded-md bg-muted/40 p-3">
            <div className="flex items-center justify-between text-sm">
              <div>
                <div className="font-medium">{data.product}</div>
                <div className="text-xs text-muted-foreground">SKU: {data.sku}</div>
              </div>
              <div className="text-right">
                <div className="font-semibold">{symbol}{data.amount.toFixed(2)}</div>
                <div className="text-xs text-muted-foreground">{t("label.order")} {data.orderId}</div>
              </div>
            </div>
          </div>

          {/* 条码 */}
          <div className="mt-4 flex flex-col items-center">
            <Barcode value={trackingNo} />
            <div className="mt-1 font-mono text-xs text-muted-foreground">{trackingNo}</div>
          </div>

          {/* 底部信息 */}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
            <span>{t("label.orderTime")} {data.createdAt}</span>
            <span>{t("label.brand")}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X size={14} /> {t("label.close")}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer size={14} /> {t("label.print")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}