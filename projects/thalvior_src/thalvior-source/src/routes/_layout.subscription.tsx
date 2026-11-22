/**
 * /subscription — 订阅中心布局（含子页 tab：订阅管理 / 账单中心）
 *
 * 修复说明：原 _layout.subscription.tsx 是完整订阅页且无 <Outlet />，
 * 导致 /subscription/bills 子路由无法渲染。现将完整页迁移到
 * _layout.subscription.index.tsx，本文件改为纯布局。
 */
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/subscription")({
  component: SubscriptionLayout,
});

const tabs = [
  { to: "/subscription", key: "nav.subscription.home", end: true },
  { to: "/subscription/bills", key: "nav.subscription.bills", end: true },
] as const;

function SubscriptionLayout() {
  const { t } = useLanguage();
  const { pathname } = useLocation();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
      {/* 子页 tab（页面内已有 PageHeader 标题，此处只做模块导航） */}
      <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-xl bg-surface-sunken/60 p-1">
        {tabs.map((tab) => {
          const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-card text-primary shadow-soft"
                  : "text-fg-muted hover:bg-card/60 hover:text-fg",
              )}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </div>

      <Outlet />
    </div>
  );
}
