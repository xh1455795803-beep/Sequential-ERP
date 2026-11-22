import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

// /listing 布局：原文件是完整刊登页且无 <Outlet />，导致 /listing/* 子路由渲染不出。
// 列表已迁移到 _layout.listing.index.tsx，本文件改为纯布局（与 orders 同一修复模式）。
export const Route = createFileRoute("/_layout/listing")({
  component: ListingLayout,
});

// 批量 5（导航分层）：刊登状态态从侧栏下沉到页面内，形态与 /orders 状态带一致。
// 侧栏只保留「总览 / 模板 / 映射 / 批量 / 日志」，状态切换在这里完成。
const statusTabs = [
  { to: "/listing", labelKey: "nav.listing.overview" },
  { to: "/listing/pending", labelKey: "nav.listing.pending" },
  { to: "/listing/publishing", labelKey: "nav.listing.publishing" },
  { to: "/listing/published", labelKey: "nav.listing.published" },
  { to: "/listing/failed", labelKey: "nav.listing.failed" },
] as const;

function ListingLayout() {
  const { t } = useLanguage();
  const { pathname } = useLocation();

  return (
    <div className="space-y-3">
      <div className="no-scrollbar flex w-full max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-surface-sunken/80 p-1 sm:w-fit">
        {statusTabs.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className={cn(
              "shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm transition-colors",
              pathname === s.to ? "bg-card font-medium text-brand shadow-xs" : "text-fg-muted hover:text-fg",
            )}
          >
            {t(s.labelKey)}
          </Link>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
