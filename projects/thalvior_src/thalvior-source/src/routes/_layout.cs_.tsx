import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  MessageSquare, Send, ChevronLeft, Star, AlertTriangle, CheckCircle2,
  Filter, Search,
} from "lucide-react";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import { fmtDateTime } from "@/lib/datetime";

type ConvStatus = "待回复" | "进行中" | "已关闭";
type Conv = {
  id: string; user_id: string; shop_name: string; channel: string;
  buyer: string; subject: string; status: ConvStatus; priority: string;
  last_message_at: string | null; unread_count: number; created_at: string;
};
type Msg = {
  id: string; conversation_id: string; role: "buyer" | "seller" | "system";
  channel: string | null; subject: string | null; body: string; sent_at: string;
};

const STATUS_BADGE: Record<ConvStatus, { bg: string; fg: string; dot: string }> = {
  "待回复":   { bg: "bg-danger-subtle/70", fg: "text-destructive",        dot: "bg-destructive" },
  "进行中":   { bg: "bg-warning-subtle/60", fg: "text-warn-ink",        dot: "bg-warning" },
  "已关闭":   { bg: "bg-surface-sunken",    fg: "text-fg-subtle",        dot: "bg-fg-subtle/70" },
};

const CHANNEL_BADGE: Record<string, string> = {
  amazon: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  shopee: "bg-orange-500/10 text-orange-600 border-orange-500/30",
  temu:   "bg-rose-500/10 text-rose-600 border-rose-500/30",
  ebay:   "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
  aliexpress: "bg-red-500/10 text-red-600 border-red-500/30",
  email:  "bg-sky-500/10 text-sky-600 border-sky-500/30",
};

export const Route = createFileRoute("/_layout/cs_")({
  component: CSInbox,
});

function CSInbox() {
  const { t, lang } = useLanguage();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ConvStatus | "全部">("全部");
  const [kw, setKw] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .order("last_message_at", { ascending: false, nullsLast: true });
      if (!alive) return;
      setConvs(((data ?? []) as Conv[]).sort((a, b) => {
        const at = a.last_message_at ?? a.created_at;
        const bt = b.last_message_at ?? b.created_at;
        return bt.localeCompare(at);
      }));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const active = convs.find((c) => c.id === activeId) ?? convs[0] ?? null;

  useEffect(() => {
    if (!active) { setMsgs([]); return; }
    supabase.from("messages").select("*").eq("conversation_id", active.id).order("sent_at", { ascending: true })
      .then(({ data }) => setMsgs((data ?? []) as Msg[]));
    // 标记已读
    supabase.from("conversations").update({ unread_count: 0 }).eq("id", active.id).then();
    setConvs((cs) => cs.map((c) => (c.id === active.id ? { ...c, unread_count: 0 } : c)));
  }, [active?.id]);

  const filtered = useMemo(() => {
    return convs.filter((c) => {
      if (filter !== "全部" && c.status !== filter) return false;
      if (kw.trim()) {
        const k = kw.toLowerCase();
        return (c.subject + c.buyer + c.shop_name + c.channel).toLowerCase().includes(k);
      }
      return true;
    });
  }, [convs, filter, kw]);

  const sendReply = async () => {
    if (!active || !draft.trim()) return;
    const body = draft.trim();
    const { error } = await supabase.from("messages").insert({
      conversation_id: active.id,
      role: "seller",
      channel: active.channel,
      body,
      sent_at: new Date().toISOString(),
    });
    if (error) { console.error(error); return; }
    await supabase.from("conversations").update({
      status: "进行中",
      last_message_at: new Date().toISOString(),
    }).eq("id", active.id);
    setMsgs((prev) => [...prev, {
      id: crypto.randomUUID(), conversation_id: active.id, role: "seller",
      channel: active.channel, subject: null, body, sent_at: new Date().toISOString(),
    }]);
    setConvs((cs) => cs.map((c) => c.id === active.id
      ? { ...c, status: "进行中", last_message_at: new Date().toISOString() }
      : c));
    setDraft("");
  };

  const channels: ConvStatus[] = ["待回复", "进行中", "已关闭"];
  const tabs: (ConvStatus | "全部")[] = ["全部", ...channels];

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.cs")} desc={lang === "en" ? "Inbox, reviews & disputes" : "聚合站内信、邮件、评价与纠纷"} icon={<MessageSquare size={18} />} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* 左侧列表 */}
        <div className="rounded-[4px] border border-border bg-card">
          <div className="flex items-center gap-1 border-b border-border p-2">
            <Filter size={14} className="text-fg-subtle" />
            <div className="flex items-center gap-0.5 overflow-x-auto">
              {tabs.map((t2) => {
                const count = t2 === "全部"
                  ? convs.length
                  : convs.filter((c) => c.status === t2).length;
                const active = filter === t2;
                return (
                  <button key={t2}
                    onClick={() => setFilter(t2)}
                    className={cn(
                      "whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium transition-colors",
                      active ? "bg-primary/10 text-primary" : "text-fg-muted hover:bg-surface-hover"
                    )}
                  >
                    {t2 === "全部" ? (lang === "en" ? "All" : "全部") : t2}
                    <span className="ml-1 tabular-nums text-[10px] opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="px-2 pt-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <Input value={kw} onChange={(e) => setKw(e.target.value)}
                placeholder={lang === "en" ? "Search buyer / subject" : "搜索买家 / 主题"}
                className="h-8 pl-8 text-xs" />
            </div>
          </div>
          <div className="mt-2 max-h-[64vh] overflow-y-auto">
            {loading ? (
              <div className="p-8 text-center text-sm text-fg-subtle">…</div>
            ) : filtered.length === 0 ? (
              <EmptyState text={lang === "en" ? "No conversations" : "暂无对话"} className="py-12" />
            ) : filtered.map((c) => {
              const sb = STATUS_BADGE[c.status];
              const cb = CHANNEL_BADGE[c.channel] ?? "bg-surface-sunken text-fg-muted border border-border";
              const sel = active?.id === c.id;
              return (
                <button key={c.id} onClick={() => setActiveId(c.id)}
                  className={cn(
                    "flex w-full flex-col gap-1 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0",
                    sel ? "bg-primary/5" : "hover:bg-surface-hover"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sb.dot)} />
                    <span className="truncate text-sm font-medium text-fg">{c.buyer}</span>
                    <span className={cn("ml-auto rounded-[3px] border px-1.5 py-0.5 text-[10px] font-medium uppercase tabular-nums", cb)}>{c.channel}</span>
                  </div>
                  <div className="truncate text-xs text-fg-muted">{c.subject}</div>
                  <div className="flex items-center gap-2 text-[11px] text-fg-subtle tabular-nums">
                    <span className="truncate">{c.shop_name}</span>
                    <span className="ml-auto shrink-0">{fmtDateTime(c.last_message_at ?? c.created_at, lang)}</span>
                    {c.unread_count > 0 && (
                      <span className="ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white tabular-nums">{c.unread_count}</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 右侧对话详情 */}
        <div className="rounded-[4px] border border-border bg-card">
          {!active ? (
            <EmptyState text={lang === "en" ? "Select a conversation to view messages" : "选择左侧对话查看消息"} className="py-24" />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <MessageSquare size={16} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg">{active.buyer}</span>
                      <span className={cn("rounded-[3px] border px-1.5 py-0.5 text-[10px] font-medium", CHANNEL_BADGE[active.channel] ?? "bg-surface-sunken text-fg-muted border border-border")}>{active.channel}</span>
                      <span className={cn("rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium", sb => STATUS_BADGE[active.status])}
                        style={{ background: STATUS_BADGE[active.status].bg.replace("/70","").replace("/60",""), color: STATUS_BADGE[active.status].fg }}
                      >{active.status}</span>
                    </div>
                    <div className="text-xs text-fg-subtle">{active.shop_name} · {active.subject}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {active.status !== "已关闭" && (
                    <Button size="sm" variant="outline" onClick={async () => {
                      await supabase.from("conversations").update({ status: "已关闭" }).eq("id", active.id);
                      setConvs((cs) => cs.map((c) => c.id === active.id ? { ...c, status: "已关闭" } : c));
                    }}><CheckCircle2 size={13} /> {lang === "en" ? "Close" : "关闭对话"}</Button>
                  )}
                </div>
              </div>

              <div className="flex max-h-[52vh] min-h-[360px] flex-col-reverse overflow-y-auto px-4 py-3">
                <div className="flex flex-col gap-3">
                  {msgs.length === 0 && (
                    <div className="text-center text-sm text-fg-subtle">{lang === "en" ? "No messages yet" : "暂无消息"}</div>
                  )}
                  {msgs.map((m) => {
                    const mine = m.role === "seller";
                    return (
                      <div key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                        <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
                          mine ? "bg-brand" : "bg-fg-subtle")}>
                          {mine ? "我" : m.role === "buyer" ? "买" : "系"}
                        </div>
                        <div className={cn("max-w-[70%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                          mine ? "bg-primary text-white" : "bg-surface-sunken text-fg")}>
                          <div className="whitespace-pre-wrap">{m.body}</div>
                          <div className={cn("mt-1 text-right text-[10px] tabular-nums", mine ? "text-white/70" : "text-fg-subtle")}>
                            {fmtDateTime(m.sent_at, lang)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {active.status !== "已关闭" && (
                <div className="border-t border-border p-3">
                  <div className="flex items-end gap-2">
                    <textarea
                      rows={2}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); }
                      }}
                      placeholder={lang === "en" ? "Reply to buyer… (Enter to send)" : "回复买家（Enter 发送）"}
                      className="flex-1 resize-none rounded-md border border-input bg-surface-raised px-3 py-2 text-sm outline-none transition-colors focus:border-brand"
                    />
                    <Button size="sm" onClick={sendReply} disabled={!draft.trim()}>
                      <Send size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
