import { Outlet, createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Navigate } from "@tanstack/react-router";
import { Users, Settings2, Plug, ScrollText, Megaphone, ArrowLeft, BarChart3, Wallet, Crown, Mail, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/admin")({
  component: AdminLayout,
});

const nav = [
  { label: "admin.tenants", path: "/admin/tenants", icon: Users },
  { label: "admin.services", path: "/admin/services", icon: Settings2 },
  { label: "admin.plans", path: "/admin/plans", icon: Crown },
  { label: "admin.usage", path: "/admin/usage", icon: BarChart3 },
  { label: "admin.quotas", path: "/admin/quotas", icon: Wallet },
  { label: "admin.platforms", path: "/admin/platforms", icon: Plug },
  { label: "admin.logs", path: "/admin/logs", icon: ScrollText },
  { label: "admin.announcements", path: "/admin/announcements", icon: Megaphone },
  { label: "admin.emailTemplates", path: "/admin/email-templates", icon: Mail },
  { label: "admin.shopRules", path: "/admin/shop-rules", icon: Store },
];

function AdminLayout() {
  const { t } = useLanguage();
  const { user, role, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

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

  // role 尚未从数据库加载完成时先等待，避免误判把管理员/租户踢错页面
  if (role === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // 仅管理员可访问开发者后台，普通租户重定向回工作台
  if (role !== "admin") {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* 开发者侧边栏 */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <span className="text-sm font-semibold">{t("admin.title")}</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((item) => {
            const active = pathname === item.path || pathname.startsWith(item.path + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon size={16} />
                {t(item.label)}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <Link to="/dashboard" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ArrowLeft size={15} /> {t("admin.back")}
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1400px] p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}