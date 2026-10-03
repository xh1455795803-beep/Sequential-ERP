import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_layout/tools/margin-calc")({
  component: MarginCalcPage,
});

const F = "flex flex-col gap-1.5";

function MarginCalcPage() {
  const [price, setPrice] = useState("199");
  const [cost, setCost] = useState("80");
  const [target, setTarget] = useState("40"); // 目标毛利率 %

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
      <PageHeader title="毛利率计算" description="毛利 = 售价 − 成本；毛利率 = 毛利 ÷ 售价；支持按目标毛利率反推售价" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">输入</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className={F}><Label>售价</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className={F}><Label>成本</Label><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            <div className={F}><Label>目标毛利率 (%)</Label><Input type="number" value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">结果</h3>
          <div className="space-y-3 rounded-lg bg-muted/50 p-4 text-sm">
            <p className="flex justify-between"><span className="text-muted-foreground">单件毛利</span><b>{r.profit}</b></p>
            <p className="flex justify-between border-t pt-3 text-base"><span className="text-muted-foreground">毛利率</span><b className={r.margin >= (Number(target) || 0) ? "text-emerald-600" : "text-rose-600"}>{r.margin}%</b></p>
            <p className="flex justify-between border-t pt-3"><span className="text-muted-foreground">达到 {Number(target) || 0}% 毛利的建议售价</span><b className="text-primary">¥ {r.suggested ?? "—"}</b></p>
            <p className="text-xs text-muted-foreground">当前售价{r.hitTarget ? "已达到" : "未达到"}目标毛利率</p>
          </div>
        </div>
      </div>
    </div>
  );
}
