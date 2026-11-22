import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, FileCheck2, BadgeCheck, Hourglass, Percent } from "lucide-react";
import { PageHeader, StatCard } from "@/components/page-header";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext"
import { fmtDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/_layout/finance/reconcile")({
  component: Reconcile,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PayRow = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReconRow = any;

function payType(r: PayRow): "credits" | "license" | "subscription" | "other" {
  if (Number(r.credits_granted ?? 0) > 0) return "credits";
  if (r.platform_code || Number(r.license_shop_count ?? 0) > 0 || r.period_months) return "license";
  if (r.plan_id) return "subscription";
  return "other";
}

function Reconcile() {
  const {  t , lang } = useLanguage();
  const [rows, setRows] = useState<ReconRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        // 系统自动对账（只读）：支付单 vs 业务生效记录比对
        // - 积分充值：credits_granted 为支付成功时系统写入的到账凭证 → 已核销
        // - 平台授权：比对 shop_licenses.order_no 是否存在对应生效授权
        // - 订阅：比对 subscriptions 是否存在该用户的生效订阅
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const [pays, licenses, subs]: any[] = await Promise.all([
          (supabase as any)
            .from("payment_orders")
            .select("*")
            .eq("status", "paid")
            .order("paid_at", { ascending: false }),
          (supabase as any).from("shop_licenses").select("order_no, platform_code, shop_count, status"),
          (supabase as any).from("subscriptions").select("user_id, plan_name, status"),
        ]);
        if (pays.error) throw new Error(pays.error.message);
        if (!alive) return;
        const licenseNos = new Set((licenses.data ?? []).map((l: PayRow) => String(l.order_no ?? "")));
        const activeSubUserIds = new Set(
          (subs.data ?? []).filter((s: PayRow) => s.status === "active").map((s: PayRow) => String(s.user_id ?? ""))
        );
        const recon: ReconRow[] = (pays.data ?? []).map((p: PayRow) => {
          const tp = payType(p);
          let matched = false;
          let biz = "";
          if (tp === "credits") {
            matched = true;
            biz = `+${Number(p.credits_granted) || 0} ${t("fin.rec2.biz.credits")}`;
          } else if (tp === "license") {
            matched = licenseNos.has(String(p.order_no ?? ""));
            biz = matched
              ? t("fin.rec2.biz.license", { p: String(p.platform_code ?? "") })
              : t("fin.rec2.biz.none");
          } else if (tp === "subscription") {
            matched = activeSubUserIds.has(String(p.user_id ?? ""));
            biz = matched ? t("fin.rec2.biz.subscription") : t("fin.rec2.biz.none");
          } else {
            biz = t("fin.rec2.biz.none");
          }
          return { ...p, tp, matched, biz };
        });
        setRows(recon);
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
    const matched = rows.filter((r) => r.matched).length;
    const pending = rows.length - matched;
    const rate = rows.length > 0 ? Math.round((matched / rows.length) * 100) : 0;
    return { matched, pending, rate, total: rows.length };
  }, [rows]);

  const fmtMoney = (n: number) =>
    `¥${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtTime = (v: unknown) => {
    if (!v) return "—";
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? String(v) : fmtDateTime(d, lang);
  };

  const typeLabel = (tp: string) => {
    if (tp === "credits") return t("fin.pay.type.credits");
    if (tp === "license") return t("fin.pay.type.license");
    if (tp === "subscription") return t("fin.pay.type.subscription");
    return t("fin.pay.type.other");
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("fin.rec2.title")} description={t("fin.rec2.desc")} />

      {/* 统计卡：系统自动比对结果，全只读 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label={t("fin.rec2.stat.total")} value={String(stats.total)} icon={<FileCheck2 size={17} />} tone="primary" />
        <StatCard label={t("fin.rec2.stat.matched")} value={String(stats.matched)} icon={<BadgeCheck size={17} />} tone="success" />
        <StatCard label={t("fin.rec2.stat.pending")} value={String(stats.pending)} icon={<Hourglass size={17} />} tone="warning" />
        <StatCard label={t("fin.rec2.stat.rate")} value={`${stats.rate}%`} icon={<Percent size={17} />} tone="violet" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("fin.rec2.colNo")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.rec2.colType")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.rec2.colAmount")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.rec2.colBiz")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.rec2.colTime")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.rec2.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> {t("fin.loading")}
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-destructive">{error}</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center text-muted-foreground">{t("fin.rec2.empty")}</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/60">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{String(row.order_no ?? "")}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium border-info/30 bg-info-bg text-info">
                      {typeLabel(row.tp)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">{fmtMoney(Number(row.amount) || 0)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.biz}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtTime(row.paid_at || row.created_at)}</td>
                  <td className="px-4 py-3">
                    {row.matched ? (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium border-success/30 bg-success-bg text-success">
                        {t("fin.rec2.matched")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium border-warning/30 bg-warning-bg text-warning">
                        {t("fin.rec2.unmatched")}
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
