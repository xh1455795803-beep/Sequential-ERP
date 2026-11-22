import { Printer, X, FileText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

// 标准物流面单数据（P0-6：支持批量 + 电话 + 商品明细 + A4/热敏两种版式）
export interface ShippingLabelItem {
  name: string;
  sku?: string;
  qty: number;
}

export interface ShippingLabelData {
  orderId: string;
  buyer: string;
  phone?: string;
  product: string;
  sku: string;
  channel: string;
  shopName?: string;
  amount: number;
  currency: string;
  createdAt: string;
  address?: string;
  items?: ShippingLabelItem[];
}

export type LabelSize = "a4" | "thermal";

// 生成规范运单号：TL + 时间戳 + 校验位（本地生成，可注册到 17TRACK 供轨迹查询）
export function genTrackingNo(orderId: string): string {
  const seed = orderId.replace(/[^0-9a-zA-Z]/g, "").slice(0, 8).padEnd(8, "0").toUpperCase();
  const ts = Date.now().toString().slice(-8);
  const raw = `${seed}${ts}`;
  // 简单校验位：字符码求和取模 36，转大写字母数字
  const sum = raw.split("").reduce((s, c) => s + c.charCodeAt(0), 0);
  const check = (sum % 36).toString(36).toUpperCase();
  return `TL${raw}${check}`;
}

// 标准 Code128 条码（jsbarcode 生成 SVG，扫码枪可识别）
function Barcode({ value, regRef }: { value: string; regRef?: (el: SVGSVGElement | null) => void }) {
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
        lineColor: "black",
      });
    } catch (e) {
      console.error("[shipping-label] 条码生成失败", e);
    }
    regRef?.(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <svg ref={ref} className="h-12 w-full" />;
}

function symbolOf(currency: string): string {
  return currency === "USD" ? "$" : currency === "JPY" ? "¥" : currency === "EUR" ? "€" : currency === "CNY" ? "¥" : currency === "GBP" ? "£" : currency;
}

// ─── 单张面单（预览与打印共用结构） ──────────────────────────────────
function LabelSheet({
  data,
  trackingNo,
  size,
  index,
  total,
  regRef,
  t,
}: {
  data: ShippingLabelData;
  trackingNo: string;
  size: LabelSize;
  index: number;
  total: number;
  regRef?: (el: SVGSVGElement | null) => void;
  t: (k: string) => string;
}) {
  const thermal = size === "thermal";
  const items = (data.items && data.items.length ? data.items : [{ name: data.product, sku: data.sku, qty: 1 }]);
  return (
    <div
      className={`label-sheet mx-auto border-2 border-black bg-card p-4 text-black ${
        thermal ? "w-[100mm]" : "w-[180mm]"
      }`}
      style={thermal ? { minHeight: "150mm" } : { minHeight: "128mm" }}
    >
      {/* 头部：品牌 + 序号 + 渠道/店铺 */}
      <div className="flex items-start justify-between border-b border-black pb-1.5">
        <div className="text-[11px] font-bold tracking-widest">{t("label.brand")}</div>
        <div className="text-[10px] text-black/70">
          {total > 1 ? `${index + 1}/${total} · ` : ""}{data.shopName || data.channel}
        </div>
      </div>

      {/* 收件人（热敏版放大） */}
      <div className="mt-2">
        <div className={`font-bold leading-snug ${thermal ? "text-xl" : "text-lg"}`}>{data.buyer}</div>
        {data.phone && <div className={`font-mono ${thermal ? "text-base" : "text-sm"}`}>{t("label.phone")}: {data.phone}</div>}
        <div className={`whitespace-pre-wrap font-semibold leading-snug ${thermal ? "text-sm" : "text-sm"}`}>
          {data.address || t("label.addressPending")}
        </div>
      </div>

      {/* 商品明细 */}
      <div className="mt-2 border border-black/60 p-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-black/70">{t("label.items")}</div>
        <div className={`mt-0.5 space-y-0.5 ${thermal ? "text-xs" : "text-xs"}`}>
          {items.map((it, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{it.name}</span>
              {it.sku && <span className="shrink-0 font-mono text-[10px] text-black/60">SKU: {it.sku}</span>}
              <span className="shrink-0 font-bold">×{it.qty || 1}</span>
            </div>
          ))}
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-black/30 pt-1 text-[10px] text-black/70">
          <span>{t("label.order")} {data.orderId}</span>
          <span className="font-bold text-black">{symbolOf(data.currency)}{Number(data.amount || 0).toFixed(2)}</span>
        </div>
      </div>

      {/* 条码 + 运单号 */}
      <div className="mt-2 flex flex-col items-center">
        <Barcode value={trackingNo} regRef={regRef} />
        <div className="mt-0.5 font-mono text-sm font-bold tracking-[0.2em]">{trackingNo}</div>
      </div>

      {/* 底部 */}
      <div className="mt-1.5 flex items-center justify-between border-t border-black pt-1 text-[9px] text-black/60">
        <span>{t("label.orderTime")} {data.createdAt}</span>
        <span>{t("label.manualNote")}</span>
      </div>
    </div>
  );
}

export function ShippingLabelDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ShippingLabelData[] | null;
}) {
  const labels = useMemo(() => data ?? [], [data]);
  const [size, setSize] = useState<LabelSize>("a4");
  const svgRefs = useRef<Record<string, SVGSVGElement | null>>({});
  const { t } = useLanguage();

  // 每次打开重置条码注册表
  useEffect(() => {
    if (open) svgRefs.current = {};
  }, [open]);

  // 打印：写入隐藏 iframe（含 @page 版式），避免整页 CSS 串染
  const handlePrint = () => {
    if (!labels.length) return;
    const thermal = size === "thermal";
    const sheets = labels
      .map((d, i) => {
        const svg = svgRefs.current[d.orderId];
        const node = document.querySelector<HTMLElement>(`[data-label-idx="${i}"]`);
        const clone = node?.cloneNode(true) as HTMLElement | undefined;
        if (clone) {
          // 用真实条码 SVG 替换占位（iframe 里无法再跑 jsbarcode）
          if (svg) {
            const holder = clone.querySelector("[data-barcode-slot]");
            if (holder) {
              holder.innerHTML = "";
              holder.appendChild(svg.cloneNode(true));
            }
          }
          clone.classList.remove("mx-auto");
        }
        return clone?.outerHTML ?? "";
      })
      .join("");
    const css = thermal
      ? `@page { size: 100mm 150mm; margin: 2mm; } body { margin:0; -webkit-print-color-adjust: exact; } .label-sheet { border-width:1px !important; page-break-after: always; width: 96mm !important; } .label-sheet:last-child { page-break-after: auto; }`
      : `@page { size: A4 portrait; margin: 8mm; } body { margin:0; -webkit-print-color-adjust: exact; } .label-sheet { border-width:1px !important; page-break-after: always; width: 180mm !important; } .label-sheet:last-child { page-break-after: auto; }`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Shipping Labels</title><style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color:#000; }
      ${css}
    </style></head><body>${sheets}</body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 3000);
    };
    // 兜底：部分浏览器 onload 不触发（同步 write 场景）
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => iframe.remove(), 3000);
    }, 600);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("label.title")}{labels.length > 1 ? ` × ${labels.length}` : ""}</DialogTitle>
          <DialogDescription>{t("label.desc")}</DialogDescription>
        </DialogHeader>

        {/* 版式切换 + 打印（诚实标注：物流商对接中，当前为手工单号） */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning">
          <span>{t("label.carrierPending")}</span>
          <div className="flex items-center gap-1.5">
            <Button variant={size === "a4" ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setSize("a4")}>
              <FileText size={13} className="mr-1" /> {t("label.sizeA4")}
            </Button>
            <Button variant={size === "thermal" ? "default" : "outline"} size="sm" className="h-7 px-2.5 text-xs" onClick={() => setSize("thermal")}>
              {t("label.sizeThermal")}
            </Button>
          </div>
        </div>

        {/* 面单预览（可滚动） */}
        <div className="max-h-[52vh] space-y-4 overflow-y-auto rounded-lg bg-muted/40 p-4">
          {labels.map((d, i) => (
            <div key={d.orderId} data-label-idx={i}>
              <LabelSheet
                data={d}
                trackingNo={genTrackingNo(d.orderId)}
                size={size}
                index={i}
                total={labels.length}
                regRef={(el) => { svgRefs.current[d.orderId] = el; }}
                t={t}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X size={14} /> {t("label.close")}
          </Button>
          <Button onClick={handlePrint}>
            <Printer size={14} /> {t("label.print")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
