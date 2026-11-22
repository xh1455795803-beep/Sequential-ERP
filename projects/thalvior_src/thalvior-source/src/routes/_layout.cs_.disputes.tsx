import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDateTime, fmtDate } from "@/lib/datetime";

type Dispute = {
  id: string; shop_name: string; channel: string; type: string;
  reason: string; amount: number; currency: string; status: string;
  resolution: string | null; created_at: string; resolved_at: string | null;
};

const STATUS_BG: Record<string, string> = {
  "处理中": "bg-warning-subtle/70 text-warn-ink",
  "已解决": "bg-success-subtle text-success",
  "已拒绝": "bg-danger-subtle/70 text-destructive",
};

const TYPE_LABEL: Record<string, { zh: string; en: string; color: string }> = {
  refund:    { zh: "退款", en: "Refund",       color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  return:    { zh: "退货", en: "Return",       color: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  claim:     { zh: "平台索赔", en: "Claim",    color: "bg-rose-500/10 text-rose-600 border-rose-500/30" },
  negative_review: { zh: "差评", en: "Negative Review", color: "bg-purple-500/10 text-purple-600 border-purple-500/30" },
  ticket:    { zh: "工单", en: "Ticket",       color: "bg-slate-500/10 text-slate-600 border-slate-500/30" },
};

export const Route = createFileRoute("/_layout/cs_/disputes")({ component: CSDisputes });

function CSDisputes() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<Dispute[]>([]);
  const [filter, setFilter] = useState<string>("全部");

  useEffect(() => {
    supabase.from("disputes").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as Dispute[]));
  }, []);

  const filtered = useMemo(() => {
    return filter === "全部" ? rows : rows.filter((r) => r.status === filter || r.type === filter);
  }, [rows, filter]);

  const resolve = async (id: string, resolution: string, newStatus: "已解决" | "已拒绝") => {
    await supabase.from("disputes").update({ status: newStatus, resolution, resolved_at: new Date().toISOString() }).eq("id", id);
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, status: newStatus, resolution, resolved_at: new Date().toISOString() } : r));
  };

  const tabs = ["全部", "处理中", "已解决", "已拒绝", "refund", "return", "claim"];

  const totalOpen = rows.filter((r) => r.status === "处理中").length;
  const totalAmt = rows.filter((r) => r.status === "处理中").reduce((s, r) => s + Number(r.amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.cs.disputes")} desc={lang === "en" ? "Returns, refunds, claims & tickets" : "聚合退款、退货、索赔与工单"} icon={<AlertTriangle size={18} />} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label={lang === "en" ? "Open disputes" : "处理中"} value={totalOpen} tone="danger" />
        <StatCard label={lang === "en" ? "Open amount" : "待处理金额"} value={rows.filter((r) => r.status === "处理中").reduce((s, r) => s + Number(r.amount ?? 0), 0).toFixed(2).padStart(1, '$') || "$0.00"} tone="warn" />
        <StatCard label={lang === "en" ? "Resolved" : "已解决"} value={rows.filter((r) => r.status === "已解决").length} tone="success" />
        <StatCard label={lang === "en" ? "Total" : "全部"} value={rows.length} />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {tabs.map((tab) => {
          const active = filter === tab;
          const count = tab === "全部" ? rows.length : rows.filter((r) => r.status === tab || r.type === tab).length;
          return (
            <button key={tab} onClick={() => setFilter(tab)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-fg-muted hover:bg-surface-hover")}>
              {tab === "全部" ? (lang === "en" ? "All" : "全部") : (TYPE_LABEL[tab]?.[lang === "en" ? "en" : "zh"] ?? tab)}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[4px] border border-border bg-card py-20 text-center text-sm text-fg-subtle">
          {lang === "en" ? "No disputes" : "暂无纠纷"}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[4px] border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface-sunken text-fg-muted">
              <tr className="text-left">
                <th className="h-9 px-3 text-xs font-medium">{lang === "en" ? "Time" : "时间"}</th>
                <th className="h-9 px-3 text-xs font-medium">{lang === "en" ? "Shop" : "店铺"}</th>
                <th className="h-9 px-3 text-xs font-medium">{lang === "en" ? "Channel" : "渠道"}</th>
                <th className="h-9 px-3 text-xs font-medium">{lang === "en" ? "Type" : "类型"}</th>
                <th className="h-9 px-3 text-xs font-medium">{lang === "en" ? "Reason" : "原因"}</th>
                <th className="h-9 px-3 text-right text-xs font-medium">{lang === "en" ? "Amount" : "金额"}</th>
                <th className="h-9 px-3 text-xs font-medium">{lang === "en" ? "Status" : "状态"}</th>
                <th className="h-9 px-3 text-right text-xs font-medium">{lang === "en" ? "Actions" : "操作"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const tl = TYPE_LABEL[r.type] ?? { zh: r.type, en: r.type, color: "bg-surface-sunken text-fg-muted border border-border" };
                return (
                  <tr key={r.id} className="border-t border-border/60 hover:bg-surface-hover/40">
                    <td className="px-3 py-2 text-xs text-fg-subtle tabular-nums">{fmtDate(r.created_at, lang)}</td>
                    <td className="px-3 py-2 text-fg">{r.shop_name}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{r.channel}</td>
                    <td className="px-3 py-2"><span className={cn("rounded-[3px] border px-1.5 py-0.5 text-[11px] font-medium", tl.color)}>{lang === "en" ? tl.en : tl.zh}</span></td>
                    <td className="px-3 py-2 max-w-[280px] truncate text-fg-muted" title={r.reason}>{r.reason}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-fg">{r.currency} {Number(r.amount ?? 0).toFixed(2)}</td>
                    <td className="px-3 py-2"><span className={cn("rounded-[3px] px-1.5 py-0.5 text-[11px] font-medium", STATUS_BG[r.status] ?? "bg-surface-sunken text-fg-muted")}>{r.status}</span></td>
                    <td className="px-3 py-2 text-right">
                      {r.status === "处理中" ? (
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-success hover:bg-success-subtle hover:text-success"
                            onClick={() => resolve(r.id, lang === "en" ? "Resolved by seller." : "卖家已处理完成。", "已解决")}>
                            <CheckCircle2 size={12} /> {lang === "en" ? "Resolve" : "解决"}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:bg-danger-subtle hover:text-destructive"
                            onClick={() => resolve(r.id, lang === "en" ? "Rejected by seller." : "卖家拒绝此请求。", "已拒绝")}>
                            <XCircle size={12} /> {lang === "en" ? "Reject" : "拒绝"}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-fg-subtle">{r.resolution ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: "danger" | "warn" | "success" }) {
  const toneCls = tone === "danger" ? "text-destructive" : tone === "warn" ? "text-warn-ink" : tone === "success" ? "text-success" : "text-fg";
  return (
    <div className="rounded-[4px] border border-border bg-card p-3">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", toneCls)}>{value}</div>
    </div>
  );
}
