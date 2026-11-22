import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/tools/dim-calc")({
  component: DimCalcPage,
});

const F = "flex flex-col gap-1.5";

function DimCalcPage() {
  const [len, setLen] = useState("30");
  const [width, setWidth] = useState("20");
  const [height, setHeight] = useState("10");
  const [factor, setFactor] = useState("6000");
  const [real, setReal] = useState("1.2"); // 实重 kg

  const r = useMemo(() => {
    const l = Number(len) || 0;
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    const k = Number(factor) || 6000;
    const rw = Number(real) || 0;
    const dim = (l * w * h) / k;
    const chargeable = Math.max(dim, rw);
    return {
      dim: Math.round(dim * 1000) / 1000,
      chargeable: Math.round(chargeable * 1000) / 1000,
      useDim: dim > rw,
    };
  }, [len, width, height, factor, real]);

  return (
    <div className="space-y-5">
      <PageHeader title={tt('tools.dim.title')} description={tt('tools.dim.formula')} />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('tools.dim.params')}</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className={F}><Label>{tt('tools.dim.len')}(cm)</Label><Input type="number" value={len} onChange={(e) => setLen(e.target.value)} /></div>
            <div className={F}><Label>{tt('tools.dim.wid')}(cm)</Label><Input type="number" value={width} onChange={(e) => setWidth(e.target.value)} /></div>
            <div className={F}><Label>{tt('tools.dim.hgt')}(cm)</Label><Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} /></div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className={F}>
              <Label>{tt('tools.dim.divisor')}</Label>
              <select value={factor} onChange={(e) => setFactor(e.target.value)} className="flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm">
                {["5000", "6000", "7000", "8000", "9000", "12000"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className={F}><Label>{tt('tools.dim.actual')}(kg)</Label><Input type="number" value={real} onChange={(e) => setReal(e.target.value)} /></div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">{tt('tools.result')}</h3>
          <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
            <p className="flex justify-between"><span className="text-muted-foreground">{tt('tools.dim.volumetric')}</span><b>{r.dim} kg</b></p>
            <p className="flex justify-between"><span className="text-muted-foreground">{tt('tools.dim.actual')}</span><b>{Number(real) || 0} kg</b></p>
            <p className="flex justify-between border-t pt-3 text-base"><span className="text-muted-foreground">{tt('tools.dim.billable')}</span><b className="text-primary">{r.chargeable} kg</b></p>
            <p className="text-xs text-muted-foreground">{tt('tools.dim.billedBy')}{r.useDim ? tt('tools.dim.volumetric') : tt('tools.dim.actual')}{tt("tools.dim.billing")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
