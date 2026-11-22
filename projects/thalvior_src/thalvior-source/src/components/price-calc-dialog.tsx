/**
 * PriceCalcDialog — 产品一键算价弹窗（P0-2）
 * 选模板 → 读 products.cost → 实时汇率折算 → 分项展示 → 回填售价
 * 公式：建议售价¥ = (成本+运费+加价) ÷ (1-佣金率)；外币售价 = 售价¥ ÷ 实时汇率
 */
import { useEffect, useMemo, useState } from "react";
import { Calculator, Loader2, RefreshCw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/LanguageContext";
import { useLiveRate } from "@/hooks/use-live-rate";
import { listTemplates, computePricing, type PricingTemplate } from "@/services/pricingService";

export function PriceCalcDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  product: { id: string; cost?: number | null } | null;
  onApply: (price: number, currency: string) => void;
  onManage?: () => void;
}) {
  const { open, onOpenChange, product, onApply, onManage } = props;
  const { t } = useLanguage();
  const [templates, setTemplates] = useState<PricingTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [tplId, setTplId] = useState("");
  const [costInput, setCostInput] = useState("");
  const [applied, setApplied] = useState(false);

  const tpl = useMemo(() => templates.find((x) => x.id === tplId) ?? null, [templates, tplId]);
  const { rate, loading: rateLoading, err: rateErr, refresh } = useLiveRate(tpl?.target_currency ?? "USD");

  useEffect(() => {
    if (!open) return;
    setApplied(false);
    setCostInput(product?.cost != null && Number(product.cost) > 0 ? String(product.cost) : "");
    setLoading(true);
    listTemplates()
      .then((items) => {
        setTemplates(items);
        const def = items.find((x) => x.is_default) ?? items[0];
        if (def) setTplId(def.id);
        else setTplId("");
      })
      .catch((e) => toast.error(t("pt.loadFail", { msg: e instanceof Error ? e.message : "" })))
      .finally(() => setLoading(false));
  }, [open]);

  const breakdown = useMemo(() => {
    if (!tpl) return null;
    return computePricing(tpl, Number(costInput) || 0, rate);
  }, [tpl, costInput, rate]);

  const handleApply = () => {
    if (!breakdown?.priceForeign) {
      toast.error(t("pc.noRate"));
      return;
    }
    if (!breakdown.priceCny || breakdown.priceCny <= 0) {
      toast.error(t("pc.needCost"));
      return;
    }
    onApply(breakdown.priceForeign, tpl?.target_currency ?? "USD");
    setApplied(true);
    toast.success(t("pc.applied", { price: breakdown.priceForeign, currency: tpl?.target_currency ?? "" }));
  };

  const row = (label: string, value: string, extra?: string) => (
    <p className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}{extra ? <span className="ml-1 text-xs opacity-70">{extra}</span> : null}</span>
      <b className={value.startsWith("-") ? "text-destructive" : ""}>{value}</b>
    </p>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator size={16} className="text-primary" />
            {t("pc.title")}
          </DialogTitle>
          <DialogDescription>{t("pc.desc")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 size={16} className="mr-2 animate-spin" />{t("common.loading")}
          </div>
        ) : templates.length === 0 ? (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-muted-foreground">{t("pc.noTemplate")}</p>
            <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); onManage?.(); }}>
              <Wand2 size={14} className="mr-1.5" />{t("pc.goCreate")}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block text-sm">{t("pc.template")}</Label>
              <select
                value={tplId}
                onChange={(e) => { setTplId(e.target.value); setApplied(false); }}
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}{x.is_default ? `（${t("pt.defaultTag")}）` : ""}
                  </option>
                ))}
              </select>
              {tpl && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("pc.tplSummary", {
                    markup: tpl.markup_type === "percent" ? `${tpl.markup_value}%` : `¥${tpl.markup_value}`,
                    commission: `${tpl.commission_rate}%`,
                    freight: `${tpl.freight}`,
                    currency: tpl.target_currency,
                  })}
                </p>
              )}
            </div>

            <div>
              <Label className="mb-1.5 block text-sm">{t("pc.cost")}</Label>
              <Input
                type="number" step="0.01" min="0"
                value={costInput}
                onChange={(e) => { setCostInput(e.target.value); setApplied(false); }}
                placeholder={t("pc.costPh")}
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("pc.costHint")}</p>
            </div>

            {breakdown && (
              <div className="space-y-2.5 rounded-lg bg-muted/50 p-4">
                {row(t("pc.rowCost"), `¥ ${breakdown.cost.toFixed(2)}`)}
                {row(t("pc.rowFreight"), `¥ ${breakdown.freight.toFixed(2)}`)}
                <p className="flex items-center justify-between border-t border-border/60 pt-2.5 text-sm">
                  <span className="text-muted-foreground">{t("pc.rowSubtotal")}</span>
                  <b>¥ {breakdown.subtotal.toFixed(2)}</b>
                </p>
                {row(
                  t("pc.rowMarkup"),
                  `+ ¥ ${breakdown.markup.toFixed(2)}`,
                  tpl?.markup_type === "percent" ? `(${tpl?.markup_value}%)` : "",
                )}
                {row(t("pc.rowCommission"), `- ¥ ${breakdown.commission.toFixed(2)}`, tpl ? `(${tpl.commission_rate}%)` : "")}
                <p className="flex items-center justify-between border-t border-border/60 pt-2.5 text-sm">
                  <span className="text-muted-foreground">{t("pc.rowPriceCny")}</span>
                  <b>¥ {breakdown.priceCny.toFixed(2)}</b>
                </p>
                <p className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    {t("pc.rowRate")}
                    <button onClick={refresh} className="text-primary hover:opacity-80" title={t("pc.refreshRate")}>
                      <RefreshCw size={12} className={rateLoading ? "animate-spin" : ""} />
                    </button>
                  </span>
                  <b>
                    {rateErr ? t("pc.rateFail") : `1 ${breakdown.currency} = ¥${(breakdown.rate ?? 0).toFixed(4)}`}
                  </b>
                </p>
                <p className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2.5 text-base">
                  <span className="font-medium text-primary">{t("pc.rowPriceForeign")}</span>
                  <b className="text-primary">
                    {breakdown.priceForeign != null
                      ? `${breakdown.currency} ${breakdown.priceForeign.toFixed(2)}`
                      : t("pc.rateFail")}
                  </b>
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.close")}</Button>
          {templates.length > 0 && (
            <Button onClick={handleApply} disabled={!breakdown || applied}>
              <Wand2 size={14} className="mr-1.5" />
              {applied ? t("pc.appliedBtn") : t("pc.applyBtn")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
