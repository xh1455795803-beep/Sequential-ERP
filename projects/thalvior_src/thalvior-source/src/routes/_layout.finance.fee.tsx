import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet, CalendarDays, Truck, Info } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/finance/fee")({
  component: Fee,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FeeRow = any;

function Fee() {
  const { t } = useLanguage();
  const [rows, setRows] = useState<FeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        // 真实费用来源（全部只读，无手工录入）：
        // waybills.fee —— 物流运费（运单同步后自动产生）
        // 推广花费数据源已随其所属模块一并移除（2026-11-17）：无平台对接、表内无数据
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const way: any = await (supabase as any)
          .from("waybills")
          .select("id, waybill_no, carrier, fee, created_at")
          .gt("fee", 0)
          .order("created_at", { ascending: false });
        if (way.error) throw new Error(way.error.message);
        if (!alive) return;
        const shipRows: FeeRow[] = (way.data ?? []).map((w: FeeRow) => ({
          id: `ship-${w.id}`,
          name: w.carrier ? `${w.carrier} · ${w.waybill_no ?? ""}` : String(w.waybill_no ?? ""),
          cat: "ship",
          amount: Number(w.fee) || 0,
          date: w.created_at,
        }));
        setRows(shipRows);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : t("common.loadFailed"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [t]);

  const stats = useMemo(() => {
    const ship = rows.filter((r) => r.cat === "ship");
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const now = new Date();
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthTotal = rows
      .filter((r) => typeof r.date === "string" && r.date.startsWith(monthPrefix))
      .reduce((a, r) => a + r.amount, 0);
    return { total, monthTotal, shipTotal: ship.reduce((a, r) => a + r.amount, 0) };
  }, [rows]);

  const fmtMoney = (n: number) =>
    `¥${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (v: unknown) => {
    if (!v) return "—";
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString();
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("fin.fee2.title")} description={t("fin.fee2.desc")} />

      {/* 统计卡：来自真实业务数据聚合 */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label={t("fin.fee2.stat.total")} value={fmtMoney(stats.total)} icon={<Wallet size={17} />} tone="primary" />
        <StatCard label={t("fin.fee2.stat.month")} value={fmtMoney(stats.monthTotal)} icon={<CalendarDays size={17} />} tone="violet" />
        <StatCard label={t("fin.fee2.stat.ship")} value={fmtMoney(stats.shipTotal)} icon={<Truck size={17} />} tone="warning" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("fin.fee2.colName")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.fee2.colCat")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.fee2.colAmount")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.fee2.colDate")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> {t("fin.loading")}
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-destructive">{error}</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-14 text-center">
                  <Info size={22} className="mx-auto mb-2 text-muted-foreground" />
                  <div className="text-sm font-medium text-foreground">{t("fin.fee2.empty.title")}</div>
                  <div className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{t("fin.fee2.empty.desc")}</div>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                        "border-success/30 bg-success-bg text-success"
                      }`}
                    >
                      {t("fin.fee2.cat.ship")}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">{fmtMoney(row.amount)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtDate(row.date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 数据来源说明：诚实告知费用接入计划，不提供手工补录 */}
      <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        {t("fin.fee2.source.hint")}
      </div>
    </div>
  );
}
