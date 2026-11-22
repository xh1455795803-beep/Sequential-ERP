import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencySelect } from "@/components/currency-select";
import { useLiveRate } from "@/hooks/use-live-rate";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/tools/price-calc")({
  component: PriceCalcPage,
});

const F = "flex flex-col gap-1.5";

function PriceCalcPage() {
  const [cost, setCost] = useState("45"); // 产品成本 CNY
  const [freight, setFreight] = useState("12"); // 头程运费 CNY
  const [platformRate, setPlatformRate] = useState("15"); // 平台费率 %
  const [adRate, setAdRate] = useState("8"); // 广告费率 %
  const [targetRate, setTargetRate] = useState("25"); // 目标毛利率 %
  const [fx, setFx] = useState("7.2"); // 汇率（1 外币 = x CNY）
  const [currency, setCurrency] = useState("USD");
  const { rate: liveRate, err: rateErr } = useLiveRate(currency);
  const [rateAuto, setRateAuto] = useState(false);
  useEffect(() => {
    if (liveRate) {
      setFx(String(liveRate));
      setRateAuto(true);
    }
  }, [liveRate]);

  const r = useMemo(() => {
    const c = Number(cost) || 0;
    const fr = Number(freight) || 0;
    const pr = Number(platformRate) || 0;
    const ar = Number(adRate) || 0;
    const tr = Number(targetRate) || 0;
    const rate = Number(fx) || 1;
    const denom = 1 - pr / 100 - ar / 100 - tr / 100;
    if (denom <= 0) return null;
    const priceCny = (c + fr) / denom;
    const price = priceCny / rate;
    return {
      priceCny: Math.round(priceCny * 100) / 100,
      price: Math.round(price * 100) / 100,
      currency,
    };
  }, [cost, freight, platformRate, adRate, targetRate, fx, currency]);

  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.tools.priceCalc')} description={tt('tools.price.formula')} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('tools.price.costRates')}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className={F}><Label>{tt('tools.price.prodCost')}(¥)</Label><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            <div className={F}><Label>{tt('tools.price.freight')}(¥)</Label><Input type="number" value={freight} onChange={(e) => setFreight(e.target.value)} /></div>
            <div className={F}><Label>{tt('tools.price.platformRate')}(%)</Label><Input type="number" value={platformRate} onChange={(e) => setPlatformRate(e.target.value)} /></div>
            <div className={F}><Label>{tt('tools.price.adRate')}(%)</Label><Input type="number" value={adRate} onChange={(e) => setAdRate(e.target.value)} /></div>
            <div className={F}><Label>{tt('tools.margin.target')}(%)</Label><Input type="number" value={targetRate} onChange={(e) => setTargetRate(e.target.value)} /></div>
            <div className={F}>
              <Label>{tt('tools.price.currency')}</Label>
              <CurrencySelect value={currency} onChange={setCurrency} className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div className={F}>
              <Label>{tt('tools.price.fxRate')}</Label>
              <Input type="number" value={fx} onChange={(e) => { setFx(e.target.value); setRateAuto(false); }} />
              <p className="text-xs text-muted-foreground">
                {rateErr ? tt('tools.tax.rateLiveFail') : rateAuto ? tt('tools.tax.rateLiveAuto') : tt('tools.tax.rateManual')}
              </p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('tools.result')}</h3>
          <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
            {r ? (
              <>
                <p className="flex justify-between"><span className="text-muted-foreground">{tt('tools.price.totalCostCvt')}</span><b>¥ {r.priceCny}</b></p>
                <p className="flex justify-between border-t pt-3 text-base"><span className="text-muted-foreground">{tt('tools.price.suggested')}</span><b className="text-primary">{r.price} {r.currency}</b></p>
                <p className="text-xs text-muted-foreground">{tt('tools.price.coversFees')}、{tt('tools.price.andMargin')}</p>
              </>
            ) : (
              <p className="text-destructive">{tt('tools.price.ratesExceed')}100%，{tt('tools.price.cannotCalc1')}+{tt('tools.price.adRate')}+{tt('tools.price.marginLessThan')}100%）</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
