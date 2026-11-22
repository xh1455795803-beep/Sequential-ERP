import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Landmark, Info, Loader2, Check, ChevronsUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { useLanguage } from "@/i18n/LanguageContext";
import { CurrencySelect } from "@/components/currency-select";
import { useLiveRate } from "@/hooks/use-live-rate";
import { supabase } from "@/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

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

/** 英文国名（EN 展示 + 搜索匹配用）；"UK" 非标准 ISO 码，按 "GB" 取名 */
function countryNameEn(code: string): string {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    const iso = code.toUpperCase() === "UK" ? "GB" : code;
    return dn.of(iso) ?? code;
  } catch {
    return code;
  }
}

function TaxTool() {
  const { t, lang } = useLanguage();
  const [countries, setCountries] = useState<CountryTax[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [country, setCountry] = useState("UK");
  const [combOpen, setCombOpen] = useState(false);
  const [declared, setDeclared] = useState("100"); // 申报金额（外币）
  const [currency, setCurrency] = useState("USD"); // 申报币种，可选
  const [rate, setRate] = useState("7.25"); // 汇率
  const { rate: liveRate, err: rateErr } = useLiveRate(currency);
  const [rateAuto, setRateAuto] = useState(false);
  useEffect(() => {
    if (liveRate) {
      setRate(String(liveRate));
      setRateAuto(true);
    }
  }, [liveRate]);

  useEffect(() => {
    supabase
      .from("country_tax_rates")
      .select("*")
      .order("sort_order", { ascending: true })
      .then(({ data, error: err }) => {
        if (err) {
          console.error("[tax] 加载税率失败", err.message);
          setError(err.message);
          setLoading(false);
          return;
        }
        const rows = (data ?? []) as CountryTax[];
        setCountries(rows);
        if (rows.length > 0 && !rows.some((r) => r.country_code === country)) {
          setCountry(rows[0].country_code);
        }
        setLoading(false);
      });
  }, []);

  const displayOf = (c: CountryTax) => (lang === "en" ? countryNameEn(c.country_code) : c.country_name);
  const current = countries.find((x) => x.country_code === country) ?? countries[0];

  const calc = useMemo(() => {
    const c = countries.find((x) => x.country_code === country) ?? countries[0];
    const raw = Number(declared);
    const negative = Number.isFinite(raw) && raw < 0;
    const amt = Number.isFinite(raw) && raw > 0 ? raw : 0;
    const rr = Number(rate);
    const r = Number.isFinite(rr) && rr > 0 ? rr : 1; // 汇率无效时按 1 兜底，避免税额异常
    const cny = amt * r;
    const duty = cny * ((c?.duty_rate ?? 0) / 100);
    const vat = (cny + duty) * ((c?.vat_rate ?? 0) / 100);
    const total = duty + vat;
    return { c, cny, duty, vat, total, negative };
  }, [country, declared, rate, countries]);

  return (
    <div className="space-y-5">
      <PageHeader title={t("nav.tools.tax")} description={t("tools.tax.desc")} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="grid gap-4">
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.tax.country")}</Label>
              <Popover open={combOpen} onOpenChange={setCombOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={combOpen}
                    className="h-8 w-full justify-between px-3 font-normal"
                  >
                    <span className="truncate">
                      {current ? displayOf(current) : t("tools.tax.selectCountry")}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
                  <Command filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
                    <CommandInput placeholder={t("tools.tax.searchCountry")} />
                    <CommandList>
                      <CommandEmpty>{t("tools.tax.noMatch")}</CommandEmpty>
                      <CommandGroup>
                        {countries.map((c) => (
                          <CommandItem
                            key={c.id}
                            value={`${c.country_name} ${countryNameEn(c.country_code)} ${c.country_code}`}
                            onSelect={() => {
                              setCountry(c.country_code);
                              setCombOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-1 h-4 w-4",
                                c.country_code === country ? "opacity-100" : "opacity-0",
                              )}
                            />
                            <span className="flex-1 truncate">{displayOf(c)}</span>
                            <span className="ml-2 text-xs text-muted-foreground">{c.country_code}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.tax.declared")}</Label>
              <div className="flex gap-2">
                <Input type="number" value={declared} onChange={(e) => setDeclared(e.target.value)} className="flex-1" />
                <CurrencySelect value={currency} onChange={setCurrency} className="h-8 w-36 shrink-0 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring" />
              </div>
              {calc.negative && (
                <p className="mt-1 text-xs text-destructive">{t("tools.tax.negativeWarn")}</p>
              )}
            </div>
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.tax.rate")}</Label>
              <Input type="number" step="0.01" value={rate} onChange={(e) => { setRate(e.target.value); setRateAuto(false); }} />
              <p className="mt-1 text-xs text-muted-foreground">
                {rateErr ? t("tools.tax.rateLiveFail") : rateAuto ? t("tools.tax.rateLiveAuto") : t("tools.tax.rateManual")}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
              <Loader2 size={16} className="mr-2 animate-spin" /> {t("tools.tax.loading")}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-danger-bg p-5 text-sm text-destructive">
              <div className="font-medium">{t("tools.tax.errorTitle")}</div>
              <div className="mt-1">{error}</div>
            </div>
          ) : countries.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
              {t("tools.tax.ratesEmpty")}
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

          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-xs text-warning">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>{t("tools.tax.hint")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
