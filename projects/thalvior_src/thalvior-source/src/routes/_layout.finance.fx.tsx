import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Loader2, ArrowDownToLine, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataListPage, type FormField, type ListColumn } from "@/components/data-list-page";
import { CURRENCIES } from "@/lib/currencies";
import { supabase, supabaseUrl, projectUrlId } from "@/supabase/client";
import { toast } from "sonner";

import { tt } from "@/i18n/tts";
export const Route = createFileRoute("/_layout/finance/fx")({
  component: FinanceFxPage,
});

const columns: ListColumn[] = [
  { key: "currency", label: "tools.ship.currency" },
  { key: "rate", label: "fin.fx.rateToCny" },
  { key: "date", label: "adm.plan.effectiveDate" },
  { key: "note", label: "sub.usage.col.note" }
];

const fields: FormField[] = [
  { key: "currency", label: "tools.ship.currency", type: "select", options: CURRENCIES.map((c) => c.code), required: true },
  { key: "rate", label: "fin.fx.rateToCny", type: "number", required: true },
  { key: "date", label: "adm.plan.effectiveDate" },
  { key: "note", label: "sub.usage.col.note" }
];

interface LiveRate {
  code: string;
  name: string;
  rate: number;
}

function FinanceFxPage() {
  const [live, setLive] = useState<LiveRate[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchLive = useCallback(async () => {
    setLoading(true);
    setErr(false);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const codes = CURRENCIES.map((c) => c.code);
      const res = await fetch(`${supabaseUrl}/functions/v1/exchange-rate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OneDay-App-Id": projectUrlId,
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ source: "USD", currencies: codes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || tt("fin.fx.fetchFail"));
      const r = data.rates ?? {};
      const cny = Number(r["CNY"]) || 0;
      if (cny <= 0) throw new Error("bad rates");
      const rows: LiveRate[] = CURRENCIES.filter((c) => Number(r[c.code]) > 0).map((c) => ({
        code: c.code,
        name: tt(`common.currency.${c.code.toLowerCase()}`),
        rate: c.code === "CNY" ? 1 : Math.round((1 / Number(r[c.code])) * cny * 10000) / 10000,
      }));
      setLive(rows);
      setUpdatedAt(data.data_updated_at ?? new Date().toISOString().slice(0, 16).replace("T", " "));
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLive();
  }, [fetchLive]);

  const syncAll = async () => {
    if (live.length === 0) return;
    setSyncing(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const rows = live.map((x) => ({ currency: x.code, rate: x.rate, date: today, note: tt('fin.fx.autoSync') }));
      const { error } = await supabase.from("fx_rates").insert(rows);
      if (error) throw error;
      toast.success(tt('fin.fx.syncedCount', { v1: rows.length }));
    } catch (e) {
      toast.error(tt('fin.fx.syncFailPrefix') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 国际实时汇率（自动拉取） */}
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-primary" />
            <div>
              <h3 className="text-sm font-semibold">{tt('fin.fx.realtimeTitle')}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {err
                  ? tt('fin.fx.fetchFailHint')
                  : updatedAt
                    ? tt('fin.fx.sourceUpdated', { updatedAt: updatedAt })
                    : tt('fin.fx.source')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={fetchLive} disabled={loading}>
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
              {tt("common.refresh")}
            </Button>
            <Button size="sm" onClick={syncAll} disabled={loading || err || syncing || live.length === 0}>
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <ArrowDownToLine size={14} className="mr-1" />}
              {tt("fx.syncLedger")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            <Loader2 size={16} className="mr-2 animate-spin" />{tt('fin.fx.fetching')}
          </div>
        ) : err ? (
          <div className="rounded-lg border border-destructive/30 bg-danger-bg p-4 text-sm text-destructive">
            {tt("fx.refreshFail")}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {live.map((x) => (
              <div key={x.code} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">{x.code}</span>
                  <span className="text-sm tabular-nums text-primary">{x.rate}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{x.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 手工登记台账 */}
      <DataListPage
        addLabel="common.add"
        title="nav.finance.fx"
        description="fin.fx.desc"
        table="fx_rates"
        columns={columns}
        fields={fields}
      />
    </div>
  );
}
