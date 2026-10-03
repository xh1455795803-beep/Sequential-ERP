import { createFileRoute } from "@tanstack/react-router";
import { Bell, CheckCheck, Trash2, Loader2, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { supabase } from "@/supabase/client";
import { toast } from "sonner";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/notifications")({
  component: Notifications,
});

interface Notification {
  id: string;
  title: string;
  content: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

const typeTone: Record<string, string> = {
  系统: "bg-blue-50 text-blue-600",
  订单: "bg-emerald-50 text-emerald-600",
  库存: "bg-amber-50 text-amber-600",
  财务: "bg-violet-50 text-violet-600",
};

function Notifications() {
  const { t, lang } = useLanguage();
  const [list, setList] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(`${t("notif.loadFail")}: ${error.message}`);
    } else {
      setList((data ?? []) as Notification[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const unreadCount = list.filter((n) => !n.is_read).length;

  const markRead = async (id: string) => {
    const { data, error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id)
      .select();
    if (error || !data || data.length === 0) {
      toast.error(t("notif.markFail"));
      return;
    }
    setList((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    const { data, error } = await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("is_read", false)
      .select();
    if (error || !data) {
      toast.error(t("notif.opFail"));
    } else {
      setList((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success(t("notif.allReadDone"));
    }
    setMarkingAll(false);
  };

  const remove = async (id: string) => {
    const { data, error } = await supabase.from("notifications").delete().eq("id", id).select();
    if (error || !data || data.length === 0) {
      toast.error(t("notif.deleteFail"));
      return;
    }
    setList((prev) => prev.filter((n) => n.id !== id));
    toast.success(t("notif.deleted"));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("notif.title")}
        description={t("notif.desc")}
        actions={
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={markingAll || unreadCount === 0}>
            {markingAll ? <Loader2 size={15} className="animate-spin" /> : <CheckCheck size={15} />} {t("notif.allRead")}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <p className="text-xs text-muted-foreground">{t("notif.unread")}</p>
          <p className="mt-1 text-xl font-semibold tracking-tight">{unreadCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-soft">
          <p className="text-xs text-muted-foreground">{t("notif.all")}</p>
          <p className="mt-1 text-xl font-semibold tracking-tight">{list.length}</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 size={18} className="mr-2 animate-spin" /> {t("common.loading")}
          </div>
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Inbox size={32} className="mb-3 opacity-40" />
            <p className="text-sm">{t("notif.empty")}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((n) => (
              <li
                key={n.id}
                className={`flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30 ${n.is_read ? "" : "bg-primary/5"}`}
              >
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${typeTone[n.type] ?? "bg-muted text-muted-foreground"}`}>
                  <Bell size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{n.title}</span>
                    {!n.is_read && <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" />}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{n.content}</p>
                  <p className="mt-1 text-xs text-muted-foreground/70">
                    {t(n.type)} · {new Date(n.created_at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!n.is_read && (
                    <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>
                      {t("notif.markRead")}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-rose-600" onClick={() => remove(n.id)}>
                    <Trash2 size={15} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}