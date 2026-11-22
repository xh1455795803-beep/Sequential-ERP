import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencySelect } from "@/components/currency-select";
import { currencySymbol } from "@/lib/currencies";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/tools/margin-calc")({
  component: MarginCalcPage,
});

const F = "flex flex-col gap-1.5";

function MarginCalcPage() {
  const [price, setPrice] = useState("199");
  const [cost, setCost] = useState("80");
  const [target, setTarget] = useState("40"); // 目标毛利率 %
  const [currency, setCurrency] = useState("CNY"); // 售价/成本币种，可选
  const sym = currencySymbol(currency);

  const r = useMemo(() => {
    const p = Number(price) || 0;
    const c = Number(cost) || 0;
    const profit = p - c;
    const margin = p > 0 ? (profit / p) * 100 : 0;
    const tg = Number(target) || 0;
    const suggested = tg < 100 && tg >= 0 ? c / (1 - tg / 100) : null;
    return {
      profit: Math.round(profit * 100) / 100,
      margin: Math.round(margin * 100) / 100,
      suggested: suggested !== null ? Math.round(suggested * 100) / 100 : null,
      hitTarget: suggested !== null && p >= suggested,
    };
  }, [price, cost, target]);

  return (
    <div className="space-y-5">
      <PageHeader title={tt('nav.tools.marginCalc')} description={tt('tools.margin.formula')} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('tools.inputLabel')}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className={F}>
              <Label>{tt('tools.priceLabel')}</Label>
              <div className="flex gap-2">
                <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} className="flex-1" />
                <CurrencySelect value={currency} onChange={setCurrency} className="h-8 w-36 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
            </div>
            <div className={F}><Label>{tt('tools.margin.costPrefix')}{currency}）</Label><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            <div className={F}><Label>{tt('tools.margin.target')}(%)</Label><Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('tools.result')}</h3>
          <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
            <p className="flex justify-between"><span className="text-muted-foreground">{tt('tools.margin.perUnit')}</span><b>{sym} {r.profit}</b></p>
            <p className="flex justify-between border-t pt-3 text-base"><span className="text-muted-foreground">{tt('tools.margin.rate')}</span><b className={r.margin >= (Number(target) || 0) ? "text-success" : "text-destructive"}>{r.margin}%</b></p>
            <p className="flex justify-between border-t pt-3"><span className="text-muted-foreground">{tt('tools.margin.suggest', { n: Number(target) || 0 })}</span><b className="text-primary">{sym} {r.suggested ?? "—"}</b></p>
            <p className="text-xs text-muted-foreground">{tt('tools.curPrice')}{r.hitTarget ? tt('tools.margin.reached') : tt('tools.margin.notReached')}{tt("tools.margin.grossTarget")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
