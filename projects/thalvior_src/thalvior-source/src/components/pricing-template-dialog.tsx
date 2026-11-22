/**
 * PricingTemplateDialog — 定价模板新建/编辑弹窗（P0-2）
 * 字段：名称 / 加价方式（固定加价率% | 固定加价额¥）/ 加价值 / 平台佣金% / 头程运费¥ / 取价币种 / 设为默认
 */
import { useEffect, useState } from "react";
import { Loader2, Save, Percent } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/LanguageContext";
import {
  createTemplate, updateTemplate, PRICING_CURRENCIES,
  type PricingTemplate,
} from "@/services/pricingService";

export function PricingTemplateDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editing: PricingTemplate | null;   // null = 新建
  defaultCurrency?: string;
  onSaved: () => void;
}) {
  const { open, onOpenChange, editing, defaultCurrency, onSaved } = props;
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [markupType, setMarkupType] = useState<"percent" | "fixed">("percent");
  const [markupValue, setMarkupValue] = useState("30");
  const [commission, setCommission] = useState("5");
  const [freight, setFreight] = useState("0");
  const [currency, setCurrency] = useState("USD");
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setMarkupType(editing.markup_type);
      setMarkupValue(String(editing.markup_value));
      setCommission(String(editing.commission_rate));
      setFreight(String(editing.freight));
      setCurrency(editing.target_currency);
      setIsDefault(editing.is_default);
    } else {
      setName("");
      setMarkupType("percent");
      setMarkupValue("30");
      setCommission("5");
      setFreight("0");
      setCurrency(defaultCurrency || "USD");
      setIsDefault(false);
    }
  }, [open, editing, defaultCurrency]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error(t("pt.nameRequired")); return; }
    const mv = Number(markupValue);
    if (!Number.isFinite(mv) || mv < 0) { toast.error(t("pt.markupInvalid")); return; }
    const cr = Number(commission);
    if (!Number.isFinite(cr) || cr < 0 || cr >= 100) { toast.error(t("pt.commissionInvalid")); return; }
    const fr = Number(freight);
    if (!Number.isFinite(fr) || fr < 0) { toast.error(t("pt.freightInvalid")); return; }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        markup_type: markupType,
        markup_value: mv,
        commission_rate: cr,
        freight: fr,
        target_currency: currency,
        is_default: isDefault,
      };
      if (editing) {
        await updateTemplate(editing.id, payload);
        toast.success(t("common.saved"));
      } else {
        await createTemplate(payload);
        toast.success(t("pt.created"));
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.unknownError"));
    } finally {
      setBusy(false);
    }
  };

  const F = "flex flex-col gap-1.5";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Percent size={16} className="text-primary" />
            {editing ? t("pt.editTitle") : t("pt.newTitle")}
          </DialogTitle>
          <DialogDescription>{t("pt.dialogDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className={F}>
            <Label>{t("pt.name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("pt.namePh")} />
          </div>

          <div>
            <Label className="mb-1.5 block">{t("pt.markupType")}</Label>
            <div className="flex gap-2">
              <button
                onClick={() => setMarkupType("percent")}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
                  markupType === "percent" ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {t("pt.markupPercent")}
              </button>
              <button
                onClick={() => setMarkupType("fixed")}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs transition-colors ${
                  markupType === "fixed" ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground"
                }`}
              >
                {t("pt.markupFixed")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={F}>
              <Label>{markupType === "percent" ? t("pt.markupValuePercent") : t("pt.markupValueFixed")}</Label>
              <Input type="number" step="0.01" min="0" value={markupValue} onChange={(e) => setMarkupValue(e.target.value)} />
            </div>
            <div className={F}>
              <Label>{t("pt.commission")}</Label>
              <Input type="number" step="0.01" min="0" max="99.99" value={commission} onChange={(e) => setCommission(e.target.value)} />
            </div>
            <div className={F}>
              <Label>{t("pt.freight")}</Label>
              <Input type="number" step="0.01" min="0" value={freight} onChange={(e) => setFreight(e.target.value)} />
            </div>
            <div className={F}>
              <Label>{t("pt.currency")}</Label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {PRICING_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4 accent-primary" />
            {t("pt.setDefault")}
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel")}</Button>
          <Button onClick={handleSave} disabled={busy}>
            {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
