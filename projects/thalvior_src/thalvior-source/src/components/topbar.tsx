import { Bell, Search, ChevronDown, Globe, LogOut, ShieldCheck, Dock, Menu, Sun, Moon, Monitor, User, Users, CreditCard } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useRouterState, Link } from "@tanstack/react-router";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth, signOut } from "@/lib/auth";
import { clearSessionStorage } from "@/lib/session";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { DockPanel } from "@/components/dock-panel";
import { CommandPalette } from "@/components/cmdk";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { toast } from "sonner";
import { playNotifyDingdong } from "@/lib/notify-sound";
import { tk, tkContent } from "@/i18n/tts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { devLog } from "@/lib/devlog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface NotificationRow {
  id: string;
  title: string;
  content: string;
  type: string;
  is_read: boolean;
  created_at: string;
}

/**
 * vV1-T2：面包屑。路径段 → 现有 i18n key（复用侧栏 nav.* 字典，零新 key）。
 * 只覆盖高频模块段 + 少量二级页；未命中且非末段则跳过，末段未命中显示「详情」。
 */
const PATH_LABEL_MAP: Record<string, string> = {
  dashboard: "nav.dashboard",
  orders: "nav.orders",
  products: "nav.products",
  listing: "nav.listing",
  inventory: "nav.inventory",
  fulfillment: "nav.fulfillment",
  logistics: "nav.logistics",
  purchase: "nav.purchase",
  automation: "nav.automation",
  exceptions: "nav.exceptions",
  auth: "nav.auth",
  finance: "nav.finance",
  reports: "nav.reports",
  ai: "nav.ai",
  tools: "nav.tools",
  subscription: "nav.subscription",
  notifications: "nav.notifications",
  subaccounts: "nav.subaccounts",
  profile: "topbar.profile",
  admin: "topbar.admin",
  "to-ship": "nav.orders.toShip",
  "after-sale": "nav.orders.aftersale",
  rules: "nav.orders.rules",
  settings: "nav.orders.settings",
};

// 末段未命中字典时按形态兜底：疑似 ID → 详情；否则原样显示（英文/数字段）
const looksLikeId = (s: string) =>
  /^[0-9a-f-]{16,}$/i.test(s) || /^\d{6,}$/.test(s) || /^[A-Z0-9]{10,}$/.test(s);

interface Crumb {
  label: string;
  path: string;
  current: boolean;
}

function useBreadcrumbs(): Crumb[] {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t, lang } = useLanguage();
  return useMemo(() => {
    const segs = pathname.split("/").filter(Boolean);
    const crumbs: Crumb[] = [];
    segs.forEach((seg, i) => {
      const key = PATH_LABEL_MAP[seg];
      const to = "/" + segs.slice(0, i + 1).join("/");
      const last = i === segs.length - 1;
      if (key) crumbs.push({ label: t(key), path: to, current: last });
      else if (last)
        crumbs.push({
          label: looksLikeId(seg) ? t("common.detail") : decodeURIComponent(seg),
          path: to,
          current: true,
        });
    });
    return crumbs;
    // lang 决定文案；t 每次渲染新建，作为依赖会让 memo 失效
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, lang]);
}

export function Topbar({ onOpenNav }: { onOpenNav?: () => void }) {
  const [unread, setUnread] = useState(0);
  const [pendingCollect, setPendingCollect] = useState(0);
  const [dockOpen, setDockOpen] = useState(false);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const { lang, toggleLang, t } = useLanguage();
  const { mode: themeMode, resolved: themeResolved, setMode: setThemeMode } = useTheme();
  // vV1-T2：面包屑数据源
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const crumbs = useBreadcrumbs();

  // 全局 Cmd/Ctrl+K 唤起命令面板
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const hotkey = isMac ? "⌘K" : "Ctrl K";
  const themeIcon = themeResolved === "dark" ? Moon : Sun;
  const ThemeIcon = themeIcon;
  const themeCycle: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };
  const themeLabel: Record<ThemeMode, string> = {
    light: t("theme.light"),
    dark: t("theme.dark"),
    system: t("theme.system"),
  };

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
    const { count: unreadCount } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("is_read", false);
    setUnread(unreadCount ?? rows.length);

    // 首次加载只记录已有 id,不弹窗(避免登录时历史通知轰炸)
    if (!options?.popupNew) {
      seenPopupIdsRef.current = new Set(rows.map((r) => r.id));
      return;
    }
    // 检测新增未读 → 弹窗提醒
    const fresh = rows.filter((r) => !seenPopupIdsRef.current?.has(r.id));
    devLog("[topbar] poll popupNew=", options?.popupNew, "total=", rows.length, "fresh=", fresh.length, "seen=", seenPopupIdsRef.current?.size ?? 0);
    devLog("[topbar] rows.ids=", rows.map(r => r.id).slice(0,5), "seen.ids=", Array.from(seenPopupIdsRef.current ?? []).slice(0,5));
    if (fresh.length > 0) {
      seenPopupIdsRef.current = new Set([...(seenPopupIdsRef.current ?? []), ...fresh.map((r) => r.id)]);
      // 收到站内新通知播放叮咚提示音（开关/60s 去重/autoplay 解锁见 lib/notify-sound.ts）
      playNotifyDingdong();
      // 对订单/财务/库存类高优先级通知逐条弹窗
      for (const n of fresh.slice(0, 3)) {
        try {
          devLog("[topbar] 调用 toast.custom:", n.title, "id=", n.id);
          const r = toast.custom(
            () => (
              <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-lift">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                  <Bell size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{tk(n.title)}</span>
                    <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-fg-muted">{n.type}</span>
                  </div>
                  {n.content && <p className="mt-1 text-xs text-fg-muted line-clamp-2">{tkContent(n.content)}</p>}
                </div>
              </div>
            ),
            {
              id: "notif-" + n.id,
              duration: 8000,
              action: {
                label: t("topbar.notifView"),
                onClick: () => navigate({ to: "/notifications" }),
              },
            },
          );
          devLog("[topbar] toast.custom returned:", r, "type:", typeof r);
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
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-raised px-3 sm:px-5">
      {/* 移动端汉堡菜单 */}
      <button
        onClick={onOpenNav}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg md:hidden"
        aria-label={t("topbar.openNav")}
      >
        <Menu size={20} />
      </button>

      {/* vV1-T2：面包屑（实底顶栏承载层级；窄屏隐藏，避免挤压搜索框） */}
      <Breadcrumb className="hidden min-w-0 shrink-0 lg:block">
        <BreadcrumbList className="flex-nowrap gap-1.5 text-[13px] sm:gap-1.5">
          {pathname !== "/dashboard" && (
            <>
              <BreadcrumbItem>
                <Link to="/dashboard" className="text-fg-muted transition-colors hover:text-fg">
                  {t("nav.dashboard")}
                </Link>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="text-fg-subtle [&>svg]:h-3 [&>svg]:w-3">
                /
              </BreadcrumbSeparator>
            </>
          )}
          {crumbs.map((c, i) => (
            <BreadcrumbItem key={c.path} className={i === crumbs.length - 1 ? "min-w-0" : "shrink-0"}>
              {i > 0 && (
                <BreadcrumbSeparator className="text-fg-subtle [&>svg]:h-3 [&>svg]:w-3">
                  /
                </BreadcrumbSeparator>
              )}
              {c.current ? (
                <BreadcrumbPage className="truncate text-sm font-medium text-fg">{c.label}</BreadcrumbPage>
              ) : (
                <Link to={c.path} className="whitespace-nowrap text-fg-muted transition-colors hover:text-fg">
                  {c.label}
                </Link>
              )}
            </BreadcrumbItem>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      {/* 全局搜索（Cmd/Ctrl+K 命令面板入口） */}
      <button
        onClick={() => setCmdkOpen(true)}
        className="hidden h-8 w-72 items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 text-[13px] text-fg-muted transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-fg sm:flex"
        aria-label={t("cmdk.placeholder")}
      >
        <Search size={15} />
        <span className="flex-1 text-left">{t("cmdk.searchLabel")}</span>
        <kbd className="rounded border border-border bg-card px-1.5 py-0.5 font-data text-[10px] text-fg-subtle">{hotkey}</kbd>
      </button>
      {/* 移动端搜索图标 */}
      <button
        onClick={() => setCmdkOpen(true)}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg sm:hidden"
        aria-label={t("cmdk.searchLabel")}
      >
        <Search size={17} />
      </button>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-1.5">
        {/* 扩展坞入口（只显示图标，不占文字宽度） */}
        <button
          onClick={() => setDockOpen(true)}
          className="relative flex h-8 w-8 items-center justify-center rounded-md text-brand transition-colors hover:bg-brand-subtle"
          title={t("topbar.collect")}
          aria-label={t("topbar.collect")}
        >
          <Dock size={18} />
          {pendingCollect > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
              {pendingCollect > 99 ? "99+" : pendingCollect}
            </span>
          )}
        </button>

        {/* AI 助手入口在右下角悬浮按钮（AgentFab），此处不放客服入口 */}

        {/* 主题切换：三态循环（亮 → 暗 → 跟随系统），localStorage 持久化 */}
        <button
          onClick={() => setThemeMode(themeCycle[themeMode])}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
          title={`${t("theme.title")}：${themeLabel[themeMode]} → ${themeLabel[themeCycle[themeMode]]}`}
          aria-label={t("theme.title")}
        >
          <ThemeIcon size={17} />
        </button>

        {/* 语言切换 */}
        <button
          onClick={toggleLang}
          className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <Globe size={16} />
          <span className="hidden sm:inline">{lang === "zh" ? "English" : "Chinese"}</span>
        </button>

        {/* 通知 */}
        <button
          onClick={() => navigate({ to: "/notifications" })}
          className="relative rounded-md p-2 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <Bell size={17} />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-medium text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>

        {/* 头像下拉（系统设置入口） */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-hover">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary text-xs text-primary-foreground">{avatarChar}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium text-fg sm:inline">{displayName}</span>
              <ChevronDown size={14} className="hidden text-fg-subtle sm:block" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/profile">
                <User size={14} className="mr-2" />{t("topbar.profile")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/notifications">
                <Bell size={14} className="mr-2" />{t("nav.notifications")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/subaccounts">
                <Users size={14} className="mr-2" />{t("nav.subaccounts")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/subscription">
                <CreditCard size={14} className="mr-2" />{t("nav.subscription")}
              </Link>
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
            <DropdownMenuItem className="text-destructive" onClick={handleSignOut}>
              <LogOut size={14} className="mr-2" />{t("topbar.signout")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

    {/* 扩展坞面板：采集插件安装包下载 + 分浏览器安装步骤 */}
    <DockPanel open={dockOpen} onClose={() => setDockOpen(false)} />

    {/* 全局命令面板（Cmd/Ctrl+K） */}
    <CommandPalette open={cmdkOpen} onOpenChange={setCmdkOpen} />
    </>
  );
}