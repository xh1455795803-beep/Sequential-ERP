import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_layout/tools/shipping-calc")({
  component: ShippingCalcPage,
});

const F = "flex flex-col gap-1.5";

function ShippingCalcPage() {
  const [weight, setWeight] = useState("500"); // 计费重量 g
  const [first, setFirst] = useState("50"); // 首重 g
  const [firstFee, setFirstFee] = useState("25"); // 首重费
  const [step, setStep] = useState("50"); // 续重 g
  const [stepFee, setStepFee] = useState("8"); // 续重单价
  const [discount, setDiscount] = useState("1"); // 折扣

  const r = useMemo(() => {
    const w = Number(weight) || 0;
    const f = Number(first) || 0;
    const ff = Number(firstFee) || 0;
    const st = Number(step) || 0;
    const sf = Number(stepFee) || 0;
    const d = Number(discount) || 1;
    if (w <= 0 || st <= 0) return null;
    const extra = Math.max(0, w - f);
    const steps = Math.ceil(extra / st);
    const total = (ff + steps * sf) * d;
    return { steps, total: Math.round(total * 100) / 100 };
  }, [weight, first, firstFee, step, stepFee, discount]);

  return (
    <div className="space-y-5">
      <PageHeader title="运费计算" description="按首重 / 续重 / 折扣计算运费（结果为估算值）" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">渠道参数</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className={F}><Label>首重 (g)</Label><Input type="number" value={first} onChange={(e) => setFirst(e.target.value)} /></div>
            <div className={F}><Label>首重费</Label><Input type="number" value={firstFee} onChange={(e) => setFirstFee(e.target.value)} /></div>
            <div className={F}><Label>续重 (g)</Label><Input type="number" value={step} onChange={(e) => setStep(e.target.value)} /></div>
            <div className={F}><Label>续重单价</Label><Input type="number" value={stepFee} onChange={(e) => setStepFee(e.target.value)} /></div>
            <div className={F}><Label>折扣 (1 = 不折)</Label><Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} /></div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-4 text-sm font-semibold">计算</h3>
          <div className={F}><Label>计费重量 (g)</Label><Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
          <div className="mt-5 rounded-lg bg-muted/50 p-4 text-sm">
            {r ? (
              <>
                <p className="text-muted-foreground">超出首重 <b>{r.steps}</b> 个续重段</p>
                <p className="mt-2 text-2xl font-semibold text-primary">¥ {r.total}</p>
              </>
            ) : (
              <p className="text-muted-foreground">请输入有效的计费重量与续重</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
