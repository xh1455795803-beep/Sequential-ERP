import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
      <PageHeader title="定价计算" description="售价 =（产品成本 + 头程运费）÷（1 − 平台费率 − 广告费率 − 目标毛利率）÷ 汇率" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">成本与费率</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className={F}><Label>产品成本 (¥)</Label><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            <div className={F}><Label>头程运费 (¥)</Label><Input type="number" value={freight} onChange={(e) => setFreight(e.target.value)} /></div>
            <div className={F}><Label>平台费率 (%)</Label><Input type="number" value={platformRate} onChange={(e) => setPlatformRate(e.target.value)} /></div>
            <div className={F}><Label>广告费率 (%)</Label><Input type="number" value={adRate} onChange={(e) => setAdRate(e.target.value)} /></div>
            <div className={F}><Label>目标毛利率 (%)</Label><Input type="number" value={targetRate} onChange={(e) => setTargetRate(e.target.value)} /></div>
            <div className={F}>
              <Label>结算币种</Label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                {["USD", "EUR", "GBP", "JPY"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className={F}><Label>汇率 (1 {currency} = ? ¥)</Label><Input type="number" value={fx} onChange={(e) => setFx(e.target.value)} /></div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">结果</h3>
          <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
            {r ? (
              <>
                <p className="flex justify-between"><span className="text-muted-foreground">总成本折算</span><b>¥ {r.priceCny}</b></p>
                <p className="flex justify-between border-t pt-3 text-base"><span className="text-muted-foreground">建议售价</span><b className="text-primary">{r.price} {r.currency}</b></p>
                <p className="text-xs text-muted-foreground">已覆盖平台费、广告费并保留目标毛利</p>
              </>
            ) : (
              <p className="text-rose-600">费率之和已超过 100%，无法定价（平台费率 + 广告费率 + 目标毛利率须小于 100%）</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
