import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Landmark, Info, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { useLanguage } from "@/i18n/LanguageContext";
import { supabase } from "@/supabase/client";

export const Route = createFileRoute("/_layout/tools/tax")({
  component: TaxTool,
});

interface CountryTax {
  id: string;
  country_code: string;
  country_name: string;
  duty_rate: number;
  vat_rate: number;
  tax_free_threshold: number | null;
  note: string | null;
  sort_order: number;
}

function TaxTool() {
  const { t } = useLanguage();
  const [countries, setCountries] = useState<CountryTax[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState("UK");
  const [declared, setDeclared] = useState("100"); // 申报金额（外币）
  const [rate, setRate] = useState("7.25"); // 汇率

  useEffect(() => {
    supabase
      .from("country_tax_rates")
      .select("*")
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        const rows = (data ?? []) as CountryTax[];
        setCountries(rows);
        if (rows.length > 0 && !rows.some((r) => r.country_code === country)) {
          setCountry(rows[0].country_code);
        }
        setLoading(false);
      })
      .catch((e) => {
        console.error("[tax] 加载税率失败", e);
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
      })
  }, []);

  const calc = useMemo(() => {
    const c = countries.find((x) => x.country_code === country) ?? countries[0];
    const amt = Number(declared) || 0;
    const r = Number(rate) || 1;
    const cny = amt * r;
    const duty = cny * ((c?.duty_rate ?? 0) / 100);
    const vat = (cny + duty) * ((c?.vat_rate ?? 0) / 100);
    const total = duty + vat;
    return { c, cny, duty, vat, total };
  }, [country, declared, rate, countries]);

  return (
    <div className="space-y-5">
      <PageHeader title={t("nav.tools.tax")} description={t("tools.tax.desc")} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="grid gap-4">
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.tax.country")}</Label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {countries.map((c) => (
                  <option key={c.id} value={c.country_code}>{c.country_name}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.tax.declared")}</Label>
              <Input type="number" value={declared} onChange={(e) => setDeclared(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.tax.rate")}</Label>
              <Input type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
              <Loader2 size={16} className="mr-2 animate-spin" /> {t("tools.tax.loading")}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-600">
              <div className="font-medium">{t("tools.tax.errorTitle")}</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Landmark size={15} className="text-primary" /> {t("tools.tax.total")}
                </div>
                <div className="mt-2 text-3xl font-bold tracking-tight text-primary">
                  ¥{calc.total.toFixed(2)}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="space-y-2.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("tools.tax.declaredCny")}</span>
                    <span>¥{calc.cny.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("tools.tax.duty")} ({calc.c?.duty_rate ?? 0}%)</span>
                    <span>¥{calc.duty.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("tools.tax.vat")} ({calc.c?.vat_rate ?? 0}%)</span>
                    <span>¥{calc.vat.toFixed(2)}</span>
                  </div>
                </div>
                {calc.c?.note && (
                  <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">{calc.c.note}</p>
                )}
              </div>
            </>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>{t("tools.tax.hint")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}