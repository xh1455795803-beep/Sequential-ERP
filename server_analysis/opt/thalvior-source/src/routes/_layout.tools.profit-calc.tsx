import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TrendingUp, Percent } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/tools/profit-calc")({
  component: ProfitCalc,
});

function ProfitCalc() {
  const { t } = useLanguage();
  const [price, setPrice] = useState("29.99"); // 售价（外币）
  const [cost, setCost] = useState("45"); // 采购成本（人民币）
  const [freight, setFreight] = useState("15"); // 头程运费（人民币）
  const [commission, setCommission] = useState("15"); // 平台佣金 %
  const [adFee, setAdFee] = useState("10"); // 广告费 %
  const [rate, setRate] = useState("7.25"); // 汇率

  const calc = useMemo(() => {
    const p = Number(price) || 0;
    const c = Number(cost) || 0;
    const f = Number(freight) || 0;
    const comm = Number(commission) || 0;
    const ad = Number(adFee) || 0;
    const r = Number(rate) || 1;

    const revenueCny = p * r; // 售价折人民币
    const commissionCny = revenueCny * (comm / 100);
    const adCny = revenueCny * (ad / 100);
    const totalCost = c + f + commissionCny + adCny;
    const profit = revenueCny - totalCost;
    const margin = revenueCny > 0 ? (profit / revenueCny) * 100 : 0;
    return { revenueCny, commissionCny, adCny, totalCost, profit, margin };
  }, [price, cost, freight, commission, adFee, rate]);

  const rows = [
    { label: t("tools.profit.revenue"), value: calc.revenueCny, tone: "text-foreground" },
    { label: t("tools.profit.productCost"), value: Number(cost) || 0, tone: "text-muted-foreground" },
    { label: t("tools.profit.freight"), value: Number(freight) || 0, tone: "text-muted-foreground" },
    { label: t("tools.profit.commission"), value: calc.commissionCny, tone: "text-muted-foreground" },
    { label: t("tools.profit.ad"), value: calc.adCny, tone: "text-muted-foreground" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("nav.tools.profit")} description={t("tools.profit.desc")} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 输入 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.profit.price")}</Label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.profit.cost")}</Label>
              <Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.profit.freight")}</Label>
              <Input type="number" value={freight} onChange={(e) => setFreight(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.profit.rate")}</Label>
              <Input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.profit.commission")} (%)</Label>
              <Input type="number" value={commission} onChange={(e) => setCommission(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.profit.ad")} (%)</Label>
              <Input type="number" value={adFee} onChange={(e) => setAdFee(e.target.value)} />
            </div>
          </div>
        </div>

        {/* 结果 */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp size={15} className="text-emerald-500" /> {t("tools.profit.profit")}
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-600">
                ¥{calc.profit.toFixed(2)}
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Percent size={15} className="text-primary" /> {t("tools.profit.margin")}
              </div>
              <div className="mt-2 text-2xl font-bold tracking-tight text-primary">
                {calc.margin.toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold">{t("tools.profit.breakdown")}</h3>
            <div className="space-y-2.5">
              {rows.map((r) => (
                <div key={r.label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className={r.tone}>¥{r.value.toFixed(2)}</span>
                </div>
              ))}
              <div className="border-t border-border pt-2.5">
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>{t("tools.profit.totalCost")}</span>
                  <span>¥{calc.totalCost.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}