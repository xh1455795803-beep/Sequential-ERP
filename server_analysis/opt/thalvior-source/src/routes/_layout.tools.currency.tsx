import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { useLanguage } from "@/i18n/LanguageContext";
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

export const Route = createFileRoute("/_layout/tools/currency")({
  component: CurrencyTool,
});

// 支持的币种
const CURRENCY_NAMES: Record<string, string> = {
  USD: "美元",
  CNY: "人民币",
  EUR: "欧元",
  GBP: "英镑",
  JPY: "日元",
  AUD: "澳元",
  CAD: "加元",
  HKD: "港币",
  KRW: "韩元",
  SGD: "新加坡元",
};

const SUPPORTED = Object.keys(CURRENCY_NAMES);

// 以 USD 为基准的兜底汇率（仅在接口不可用时使用，避免页面空白）
const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1,
  CNY: 7.25,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 150,
  AUD: 1.52,
  CAD: 1.36,
  HKD: 7.8,
  KRW: 1350,
  SGD: 1.34,
};

interface RatesState {
  usdRates: Record<string, number>; // 各币种对 USD 的汇率
  updatedAt: string | null;
  source: "live" | "fallback";
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function CurrencyTool() {
  const { t } = useLanguage();
  const [state, setState] = useState<RatesState>({
    usdRates: FALLBACK_USD_RATES,
    updatedAt: null,
    source: "fallback",
  });
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("100");
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("CNY");

  const fetchRates = async () => {
    setLoading(true);
    try {
      const authHeaders = await getAuthHeaders();
      const res = await fetch(`${supabaseUrl}/functions/v1/exchange-rate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OneDay-App-Id": projectUrlId,
          ...authHeaders,
        },
        body: JSON.stringify({ source: "USD", currencies: SUPPORTED }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "汇率获取失败");

      // rates 格式：{ CNY: 6.7, EUR: 0.87, ... }，各币种对 USD 的汇率
      const usdRates: Record<string, number> = { USD: 1 };
      for (const [code, value] of Object.entries(data.rates ?? {})) {
        if (SUPPORTED.includes(code)) {
          usdRates[code] = Number(value);
        }
      }
      setState({ usdRates, updatedAt: data.data_updated_at ?? null, source: "live" });
    } catch {
      setState({ usdRates: FALLBACK_USD_RATES, updatedAt: null, source: "fallback" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRates();
  }, []);

  // 任意两币种换算：先折 USD 再转目标币种
  const result = useMemo(() => {
    const amt = Number(amount) || 0;
    const fromUsd = state.usdRates[from] ?? 1;
    const toUsd = state.usdRates[to] ?? 1;
    return (amt / fromUsd) * toUsd;
  }, [amount, from, to, state.usdRates]);

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("nav.tools.currency")} description={t("tools.currency.desc")} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 换算器 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="grid gap-4">
            <div>
              <Label className="mb-1.5 block text-sm">{t("tools.currency.amount")}</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div>
                <Label className="mb-1.5 block text-sm">{t("tools.currency.from")}</Label>
                <select
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {SUPPORTED.map((c) => (
                    <option key={c} value={c}>{c} · {CURRENCY_NAMES[c]}</option>
                  ))}
                </select>
              </div>
              <Button variant="outline" size="icon" onClick={swap} className="mb-0.5">
                <ArrowRightLeft size={16} />
              </Button>
              <div>
                <Label className="mb-1.5 block text-sm">{t("tools.currency.to")}</Label>
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {SUPPORTED.map((c) => (
                    <option key={c} value={c}>{c} · {CURRENCY_NAMES[c]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-border bg-muted/50 p-5 text-center">
            <p className="text-sm text-muted-foreground">{t("tools.currency.result")}</p>
            <p className="mt-2 text-3xl font-bold tracking-tight text-primary">
              {result.toFixed(4)} <span className="text-base font-medium">{to}</span>
            </p>
          </div>
        </div>

        {/* 汇率表 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t("tools.currency.rates")}</h3>
            <Button variant="ghost" size="sm" onClick={fetchRates} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
              {t("tools.currency.refresh")}
            </Button>
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {state.source === "live"
              ? `${t("tools.currency.liveHint")}${state.updatedAt ? ` · ${state.updatedAt}` : ""}`
              : t("tools.currency.fallbackHint")}
          </p>
          <div className="space-y-2">
            {SUPPORTED.map((c) => {
              // 展示 1 单位该币种 = 多少人民币
              const cny = (1 / (state.usdRates[c] ?? 1)) * (state.usdRates.CNY ?? 1);
              return (
                <div key={c} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm font-medium">{c}</span>
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">{CURRENCY_NAMES[c]}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {c === "CNY" ? "1.0000" : cny.toFixed(4)} CNY
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}