import { useEffect, useState } from "react";
import { supabase, supabaseUrl, projectUrlId } from "@/supabase/client";

// 拉取 1 <currency> = ? CNY 的国际实时汇率（exchangerate.host，经 exchange-rate Edge Function）
export function useLiveRate(currency: string) {
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);

  const fetchRate = async () => {
    if (!currency) return;
    setLoading(true);
    setErr(false);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(`${supabaseUrl}/functions/v1/exchange-rate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "OneDay-App-Id": projectUrlId,
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ source: "USD", currencies: [currency, "CNY"] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "rate failed");
      const r = data.rates ?? {};
      const c = Number(r[currency]) || 0;
      const cny = Number(r["CNY"]) || 0;
      if (c <= 0 || cny <= 0) throw new Error("bad rates");
      const unit = currency === "CNY" ? 1 : (1 / c) * cny;
      setRate(Math.round(unit * 10000) / 10000);
    } catch {
      setErr(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRate();
  }, [currency]);

  return { rate, loading, err, refresh: fetchRate };
}
