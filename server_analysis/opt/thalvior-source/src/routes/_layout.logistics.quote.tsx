import { createFileRoute } from "@tanstack/react-router";
import { Calculator, Star, Package, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/supabase/client";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/logistics/quote")({
  component: Quote,
});

/* 内置主流渠道参考报价（shipping_quotes 表为空时兜底展示） */
const FALLBACK_QUOTES: QuoteRow[] = [
  { id: "fb-1", carrier: "云途物流", channel: "美国专线小包", price: 17.5, currency: "USD", days: "7-12 天", features: "可追踪,末端USPS,双清包税", recommended: true },
  { id: "fb-2", carrier: "燕文物流", channel: "欧洲经济专线", price: 14.2, currency: "USD", days: "10-18 天", features: "经济型,覆盖欧盟,半追踪", recommended: false },
  { id: "fb-3", carrier: "递四方 4PX", channel: "FBA 空运头程", price: 22.8, currency: "USD", days: "6-12 天", features: "FBA头程,入仓无忧,可追踪", recommended: true },
  { id: "fb-4", carrier: "飞盒跨境", channel: "英国空运专线", price: 19.9, currency: "USD", days: "5-9 天", features: "空运快线,末端DPD", recommended: false },
  { id: "fb-5", carrier: "万邑通 WINIT", channel: "美国海外仓一件代发", price: 9.8, currency: "USD", days: "1-3 天(本地)", features: "海外仓,本地派送,可追踪", recommended: false },
  { id: "fb-6", carrier: "安骏物流", channel: "巴西专线", price: 26.5, currency: "USD", days: "8-16 天", features: "巴西清关,可追踪", recommended: false },
  { id: "fb-7", carrier: "DHL eCommerce", channel: "国际快递", price: 38.0, currency: "USD", days: "3-7 天", features: "全球网络,门到门,最快", recommended: false },
  { id: "fb-8", carrier: "USPS Priority", channel: "美国国际小包", price: 12.6, currency: "USD", days: "7-14 天", features: "美国全境,经济,可追踪", recommended: false },
];

interface QuoteRow {
  id: string;
  carrier: string;
  channel: string;
  price: number;
  currency: string;
  days: string;
  features: string;
  recommended: boolean;
}

function Quote() {
  const { t } = useLanguage();
  const [weight, setWeight] = useState("0.35");
  const [destination, setDestination] = useState("美国");
  const [calculated, setCalculated] = useState(false);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("shipping_quotes")
      .select("*")
      .order("price", { ascending: true })
      .then(({ data }) => {
        const list = (data ?? []) as QuoteRow[];
        setQuotes(list.length > 0 ? list : FALLBACK_QUOTES);
        setLoading(false);
      })
  }, []);

  // 按重量与目的国实时计算运费：基础价 × 重量系数 × 目的国系数
  const calcPrice = (base: number) => {
    const w = Number(weight) || 0;
    const weightFactor = w <= 0.5 ? 1 : w <= 1 ? 1.15 : w <= 2 ? 1.4 : 1.4 + (w - 2) * 0.35;
    const destFactor = /美国|加拿大|墨西哥/i.test(destination) ? 1 : /英国|德国|法国|欧洲/i.test(destination) ? 1.25 : /日本|韩国/i.test(destination) ? 1.1 : 1.3;
    return base * weightFactor * destFactor;
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("quote.title")} description={t("quote.desc")} />

      {/* 试算表单 */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label className="mb-1.5 block text-sm">{t("quote.weight")}</Label>
            <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </div>
          <div>
            <Label className="mb-1.5 block text-sm">{t("quote.destination")}</Label>
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button className="w-full" onClick={() => setCalculated(true)}>
              <Calculator size={15} /> {t("quote.calc")}
            </Button>
          </div>
        </div>
      </div>

      {/* 比价结果 */}
      {calculated && (
        <div className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 size={18} className="mr-2 animate-spin" /> {t("common.loading")}
            </div>
          ) : quotes.length === 0 ? (
            <div className="rounded-xl border border-border bg-card py-12 text-center text-sm text-muted-foreground">
              {t("quote.empty")}
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t("quote.result", { weight, destination, count: quotes.length })}
              </p>
              {quotes.map((q) => {
                const features = q.features ? q.features.split(",").filter(Boolean) : [];
                return (
                  <div
                    key={q.id}
                    className={cn(
                      "rounded-xl border bg-card p-4 shadow-sm transition-all",
                      q.recommended ? "border-primary ring-2 ring-primary/20" : "border-border hover:shadow-md"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                          <Package size={18} className="text-muted-foreground" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{q.carrier}</span>
                            <span className="text-xs text-muted-foreground">{q.channel}</span>
                            {q.recommended && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                                <Star size={11} /> {t("quote.recommended")}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {features.map((f) => (
                              <span key={f} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{f}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-lg font-semibold text-primary">${calcPrice(Number(q.price)).toFixed(2)}</div>
                          <div className="text-xs text-muted-foreground">{q.days}</div>
                        </div>
                        <Button size="sm" variant={q.recommended ? "default" : "outline"}>{t("quote.select")}</Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}