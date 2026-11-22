import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Star, Pencil, Save, AlertCircle } from "lucide-react";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/datetime";

type Review = {
  id: string; shop_name: string; product_name: string; channel: string;
  rating: number; title: string; body: string; status: string;
  seller_reply: string | null; seller_reply_at: string | null; created_at: string;
};

const RATING_COLOR: Record<number, string> = {
  5: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  4: "bg-teal-500/10 text-teal-600 border-teal-500/30",
  3: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  2: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  1: "bg-rose-500/10 text-rose-600 border-rose-500/30",
};

export const Route = createFileRoute("/_layout/cs_/reviews")({ component: CSReviews });

function CSReviews() {
  const { t, lang } = useLanguage();
  const [rows, setRows] = useState<Review[]>([]);
  const [filter, setFilter] = useState<string>("全部");
  const [editing, setEditing] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  useEffect(() => {
    supabase.from("reviews").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as Review[]));
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "全部") return true;
      if (filter === "未回复" || filter === "已回复") return r.status === filter;
      return r.rating === Number(filter);
    });
  }, [rows, filter]);

  const saveReply = async (id: string) => {
    await supabase.from("reviews").update({
      seller_reply: replyDraft,
      seller_reply_at: new Date().toISOString(),
      status: "已回复",
    }).eq("id", id);
    setRows((prev) => prev.map((r) => r.id === id
      ? { ...r, seller_reply: replyDraft, seller_reply_at: new Date().toISOString(), status: "已回复" } : r));
    setEditing(null);
    setReplyDraft("");
  };

  const tabs = ["全部", "未回复", "已回复", "5", "4", "3", "2", "1"];

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.cs.reviews")} desc={lang === "en" ? "Manage product reviews & seller replies" : "管理店铺评价与卖家回复"} icon={<Star size={18} />} />

      <div className="flex flex-wrap items-center gap-1">
        {tabs.map((tab) => {
          const active = filter === tab;
          const count = tab === "全部" ? rows.length
            : tab === "未回复" || tab === "已回复" ? rows.filter((r) => r.status === tab).length
            : rows.filter((r) => r.rating === Number(tab)).length;
          return (
            <button key={tab} onClick={() => setFilter(tab)}
              className={cn("rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-fg-muted hover:bg-surface-hover")}>
              {tab === "全部" ? (lang === "en" ? "All" : "全部") : tab}
              <span className="ml-1 tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-[4px] border border-border bg-card py-20 text-center text-sm text-fg-subtle">
          {lang === "en" ? "No reviews" : "暂无评价"}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {filtered.map((r) => {
            const isEditing = editing === r.id;
            return (
              <div key={r.id} className="rounded-[4px] border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-sm font-bold",
                    RATING_COLOR[r.rating] ?? RATING_COLOR[3])}>
                    {r.rating}★
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-fg">{r.product_name}</span>
                      <span className="rounded-[3px] border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] text-fg-muted">{r.channel}</span>
                      <span className="text-[11px] text-fg-subtle tabular-nums">{fmtDateTime(r.created_at, lang)}</span>
                    </div>
                    {r.title && <div className="mt-0.5 text-xs text-fg-muted">{r.title}</div>}
                    {r.body && <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{r.body}</p>}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs text-fg-subtle">
                  <span>{r.shop_name}</span>
                  <span className={cn("ml-auto rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium",
                    r.status === "已回复" ? "bg-success-subtle text-success" : "bg-warning-subtle/60 text-warn-ink")}>
                    {r.status}
                  </span>
                </div>

                {r.seller_reply && !isEditing && (
                  <div className="mt-3 rounded-md border border-border/60 bg-primary/5 p-3">
                    <div className="mb-1 text-[11px] font-medium text-primary">{lang === "en" ? "Seller reply" : "卖家回复"}</div>
                    <p className="whitespace-pre-wrap text-sm text-fg">{r.seller_reply}</p>
                    {r.seller_reply_at && <div className="mt-1 text-[10px] text-fg-subtle tabular-nums">{fmtDateTime(r.seller_reply_at, lang)}</div>}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                  {!isEditing ? (
                    <Button size="sm" variant="outline" onClick={() => { setEditing(r.id); setReplyDraft(r.seller_reply ?? ""); }}>
                      <Pencil size={13} /> {r.seller_reply ? (lang === "en" ? "Edit reply" : "修改回复") : (lang === "en" ? "Reply" : "回复")}
                    </Button>
                  ) : (
                    <>
                      <textarea rows={2} value={replyDraft} onChange={(e) => setReplyDraft(e.target.value)}
                        placeholder={lang === "en" ? "Write a professional reply…" : "撰写专业回复…"}
                        className="flex-1 resize-none rounded-md border border-input bg-surface-raised px-3 py-2 text-sm outline-none focus:border-brand" />
                      <Button size="sm" onClick={() => saveReply(r.id)}><Save size={13} /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>×</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
