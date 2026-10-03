import { Outlet, createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { Menu, Snowflake } from "lucide-react";
import { Sidebar, SidebarContent } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { AgentFab } from "@/components/agent-fab";
import { useAuth } from "@/lib/auth";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout")({
  component: Layout,
});

function Layout() {
  const { t } = useLanguage();
  const { user, status, loading } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
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
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-50 text-rose-500">
          <Snowflake size={26} />
        </div>
        <h1 className="text-lg font-semibold text-foreground">{t("auth.frozenTitle")}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t("auth.frozenDesc")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenNav={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
            <Outlet />
          </div>
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