/**
 * /orders — 订单模块布局（含子页 tab：订单处理 / 售后管理 / 审单规则）
 *
 * 修复说明：原 _layout.orders.tsx 是完整列表页且无 <Outlet />，
 * 导致 /orders/after-sale、/orders/rules 子路由无法渲染（点开仍是订单列表）。
 * 现将列表迁移到 _layout.orders.index.tsx，本文件改为纯布局。
 */
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/orders")({
  component: OrdersLayout,
});

const tabs = [
  { to: "/orders", key: "orders.home", end: true },
  { to: "/orders/after-sale", key: "nav.orders.aftersale", end: true },
  { to: "/orders/rules", key: "nav.orders.rules", end: true },
] as const;

function OrdersLayout() {
  const { t } = useLanguage();
  const { pathname } = useLocation();

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      {/* 子页 tab（页面内已有 PageHeader 标题，此处只做模块导航） */}
      <div className="mb-4 flex items-center gap-5 overflow-x-auto border-b border-border/70">
        {tabs.map((tab) => {
          const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 pb-2 text-[13px] font-medium transition-colors",
                active
                  ? "border-brand text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
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
