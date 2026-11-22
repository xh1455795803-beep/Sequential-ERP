import { Outlet, createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, Snowflake } from "lucide-react";
import { Sidebar, SidebarContent } from "@/components/sidebar";
import { TabBar } from "@/components/tab-bar";
import { Topbar } from "@/components/topbar";
import { AgentFab } from "@/components/agent-fab";
import { useAuth } from "@/lib/auth";
import { useTabs } from "@/stores/tabs";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout")({
  component: Layout,
});

function Layout() {
  const { t } = useLanguage();
  const { user, status, loading } = useAuth();
  // 必须在任何提前 return 之前调用（React Hooks 规则）
  const { reloadNonce } = useTabs();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // 冻结租户拦截：账号被管理员冻结后禁止进入后台
  if (status === "frozen") {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-danger-bg text-destructive">
          <Snowflake size={26} />
        </div>
        <h1 className="text-lg font-semibold text-foreground">{t("auth.frozenTitle")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("auth.frozenDesc")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-background">
      <Topbar onOpenNav={() => setMobileNavOpen(true)} />
      {/* vV1-T3：可关闭多标签带（Topbar 之下、内容区之上，32px） */}
      <TabBar />
      {/* md+ 走左侧层级导航（19 个模块 / 176 路由，横向标签带承载不了）；md 以下用抽屉 */}
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto">
          {/* reloadNonce 自增 = 右键「刷新」当前标签：整页重挂载，触发页面自身 useEffect 取数 */}
          <div key={reloadNonce} className="mx-auto w-full max-w-[1680px] px-4 pt-4 pb-28 sm:px-5 lg:px-6 lg:pt-5 lg:pb-28">
            <Outlet />
          </div>
          {/* 全站统一页脚：法律文档由 nginx 静态页提供，新标签页打开 */}
          <footer className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
            <span>© 2026 Thalvior</span>
            <span className="mx-2 text-border">|</span>
            <a href="/terms" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{t("footer.terms")}</a>
            <span className="mx-1.5">·</span>
            <a href="/refund" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{t("footer.refund")}</a>
            <span className="mx-1.5">·</span>
            <a href="/privacy" target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">{t("footer.privacy")}</a>
          </footer>
        </main>
      </div>

      {/* 移动端导航抽屉 */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">{t("nav.menu")}</SheetTitle>
          <div className="flex h-full flex-col bg-sidebar">
            <SidebarContent />
          </div>
        </SheetContent>
      </Sheet>

      {/* 右下角客服咨询悬浮图标（邮箱通道，不消耗 AI 额度） */}
      <AgentFab />
    </div>
  );
}