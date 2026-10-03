import { Bell, Search, ChevronDown, Globe, LogOut, ShieldCheck, Dock, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth, signOut } from "@/lib/auth";
import { clearSessionStorage } from "@/lib/session";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { DockPanel } from "@/components/dock-panel";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface NotificationRow {
  id: string;
  title: string;
  content: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

export function Topbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const [unread, setUnread] = useState(0);
  const [pendingCollect, setPendingCollect] = useState(0);
  const [dockOpen, setDockOpen] = useState(false);
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const { lang, toggleLang, t } = useLanguage();

  const displayName = user?.user_metadata?.username || user?.email || user?.phone || t("topbar.user");
  const avatarChar = displayName.charAt(0).toUpperCase();

  // 已弹窗过的通知 ID,防止重复弹
  const seenPopupIdsRef = useRef<Set<string> | null>(null);

  // 统一加载未读数 + 最新未读列表(用于弹窗去重)
  const loadUnread = async (options?: { popupNew?: boolean }) => {
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) return;
    const rows = (data ?? []) as NotificationRow[];
    setUnread(rows.length);

    // 首次加载只记录已有 id,不弹窗(避免登录时历史通知轰炸)
    if (!options?.popupNew) {
      seenPopupIdsRef.current = new Set(rows.map((r) => r.id));
      return;
    }
    // 检测新增未读 → 弹窗提醒
    const fresh = rows.filter((r) => !seenPopupIdsRef.current?.has(r.id));
    console.log("[topbar] poll popupNew=", options?.popupNew, "total=", rows.length, "fresh=", fresh.length, "seen=", seenPopupIdsRef.current?.size ?? 0);
    console.log("[topbar] rows.ids=", rows.map(r => r.id).slice(0,5), "seen.ids=", Array.from(seenPopupIdsRef.current ?? []).slice(0,5));
    if (fresh.length > 0) {
      seenPopupIdsRef.current = new Set([...(seenPopupIdsRef.current ?? []), ...fresh.map((r) => r.id)]);
      // 对订单/财务/库存类高优先级通知逐条弹窗
      for (const n of fresh.slice(0, 3)) {
        try {
          console.log("[topbar] 调用 toast.custom:", n.title, "id=", n.id);
          const r = toast.custom(
            () => (
              <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-lg">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Bell size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{n.title}</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{n.type}</span>
                  </div>
                  {n.content && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.content}</p>}
                </div>
              </div>
            ),
            {
              id: "notif-" + n.id,
              duration: 8000,
              action: {
                label: "查看",
                onClick: () => navigate({ to: "/notifications" }),
              },
            },
          );
          console.log("[topbar] toast.custom returned:", r, "type:", typeof r);
        } catch (e) {
          console.error("[topbar] toast.custom 异常:", e);
        }
      }
    }
  };

  const loadPendingCollect = async () => {
    const { data, error } = await supabase
      .from("collect_items")
      .select("id", { count: "exact", head: true })
      .eq("status", "待处理");
    if (!error) setPendingCollect(data?.length ?? 0);
  };

  useEffect(() => {
    if (!user) return;
    // 首次加载
    loadUnread();
    loadPendingCollect();

    // 轮询(前台/后台都弹,refetchIntervalInBackground 保持浏览器标签失焦也能收到)
    const pollTimer = setInterval(() => {
      loadUnread({ popupNew: true });
      loadPendingCollect();
    }, 20000);

    // Supabase Realtime 订阅 — 表 INSERT/UPDATE 时立即推送
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel("notifications-topbar")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications" },
          () => loadUnread({ popupNew: true }),
        )
        .subscribe();
    } catch (e) {
      // Realtime 未启用或权限不足时静默降级,轮询保底
      console.debug("[topbar] realtime subscribe skipped:", e);
      channel = null;
    }

    return () => {
      clearInterval(pollTimer);
      try { channel && supabase.removeChannel(channel); } catch {}
    };
  }, [user]);

  async function handleSignOut() {
    try {
      await signOut();
      clearSessionStorage();
      navigate({ to: "/login" });
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <>
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/70 bg-card/80 px-3 backdrop-blur-md sm:px-5">
      {/* 移动端汉堡菜单 */}
      <button
        onClick={onOpenNav}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
        aria-label={t("topbar.openNav")}
      >
        <Menu size={20} />
      </button>

      {/* 搜索 */}
      <div className="relative hidden w-72 sm:block">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          placeholder={t("topbar.search")}
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-1.5">
        {/* 扩展坞入口（只显示图标，不占文字宽度） */}
        <button
          onClick={() => setDockOpen(true)}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-primary transition-colors hover:bg-primary/10"
          title={t("topbar.collect")}
          aria-label={t("topbar.collect")}
        >
          <Dock size={18} />
          {pendingCollect > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-medium text-white">
              {pendingCollect > 99 ? "99+" : pendingCollect}
            </span>
          )}
        </button>

        {/* AI 助手入口在右下角悬浮按钮（AgentFab），此处不放客服入口 */}

        {/* 语言切换 */}
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Globe size={16} />
          <span className="hidden sm:inline">{lang === "zh" ? "English" : "中文"}</span>
        </button>

        {/* 通知 */}
        <button
          onClick={() => navigate({ to: "/notifications" })}
          className="relative rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Bell size={17} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-medium text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {/* 头像下拉（系统设置入口） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">{avatarChar}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">{displayName}</span>
              <ChevronDown size={14} className="hidden text-muted-foreground sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/profile">{t("topbar.profile")}</Link>
            </DropdownMenuItem>
            {role === "admin" && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin/tenants">
                    <ShieldCheck size={14} className="mr-2" />{t("topbar.admin")}
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-rose-600" onClick={handleSignOut}>
              <LogOut size={14} className="mr-2" />{t("topbar.signout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

    {/* 扩展坞面板：采集插件安装包下载 + 分浏览器安装步骤 */}
    <DockPanel open={dockOpen} onClose={() => setDockOpen(false)} />
    </>
  );
}