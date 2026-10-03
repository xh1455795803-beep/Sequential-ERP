import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Package, Info, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { useLanguage } from "@/i18n/LanguageContext";
import { supabase } from "@/supabase/client";

export const Route = createFileRoute("/_layout/tools/fba")({
  component: FbaTool,
});

interface FbaTier {
  id: string;
  tier_key: string;
  tier_label: string;
  max_dimension: number;
  max_weight: number;
  delivery_fee: number;
  storage_rate: number;
  sort_order: number;
}

function FbaTool() {
  const { t } = useLanguage();
  const [tiers, setTiers] = useState<FbaTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [length, setLength] = useState("10");
  const [width, setWidth] = useState("8");
  const [height, setHeight] = useState("2");
  const [weight, setWeight] = useState("1.2");

  useEffect(() => {
    supabase
      .from("fba_fee_tiers")
      .select("*")
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        setTiers((data ?? []) as FbaTier[]);
        setLoading(false);
      })
      .catch((e) => {
        console.error("[fba] 加载费率失败", e);
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
      })
  }, []);

  const calc = useMemo(() => {
    const dims = [Number(length) || 0, Number(width) || 0, Number(height) || 0].sort((a, b) => b - a);
    const longest = dims[0];
    const w = Number(weight) || 0;

    // 体积重（磅）= 长×宽×高 / 139
    const dimWeight = (dims[0] * dims[1] * dims[2]) / 139;
    const billableWeight = Math.max(w, dimWeight);

    let tier = tiers.length > 0 ? tiers[tiers.length - 1] : null;
    for (const t of tiers) {
      if (longest <= t.max_dimension && billableWeight <= t.max_weight) {
        tier = t;
        break;
      }
    }

    // 仓储费（月，按立方英尺估算）
    const cubicFt = (dims[0] * dims[1] * dims[2]) / 1728;
    const storageRate = tier?.storage_rate ?? 0.87;
    const storageFee = cubicFt * storageRate;

    return { longest, billableWeight, tier, storageFee };
  }, [length, width, height, weight, tiers]);

  return (
    <div className="space-y-5">
      <PageHeader title={t("nav.tools.fba")} description={t("tools.fba.desc")} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.fba.length")} (in)</Label>
              <Input type="number" value={length} onChange={(e) => setLength(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.fba.width")} (in)</Label>
              <Input type="number" value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.fba.height")} (in)</Label>
              <Input type="number" value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.fba.weight")} (lb)</Label>
              <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
              <Loader2 size={16} className="mr-2 animate-spin" /> {t("tools.fba.loading")}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">
              <div className="font-medium">{t("tools.fba.errorTitle")}</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Package size={15} className="text-primary" /> {t("tools.fba.tier")}
                </div>
                <div className="mt-2 text-xl font-bold">{calc.tier?.tier_label ?? "-"}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {t("tools.fba.billableWeight")}: {calc.billableWeight.toFixed(2)} lb
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="text-sm text-muted-foreground">{t("tools.fba.deliveryFee")}</div>
                <div className="mt-2 text-3xl font-bold tracking-tight text-primary">
                  ${(calc.tier?.delivery_fee ?? 0).toFixed(2)}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {t("tools.fba.storageFee")}: ${calc.storageFee.toFixed(2)}/月
                </div>
              </div>
            </>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>{t("tools.fba.hint")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}