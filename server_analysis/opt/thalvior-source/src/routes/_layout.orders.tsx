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
  { to: "/orders", key: "orders.home", zh: "订单处理", en: "Orders", end: true },
  { to: "/orders/after-sale", key: "nav.orders.aftersale", zh: "售后管理", en: "After-sales", end: true },
  { to: "/orders/rules", key: "nav.orders.rules", zh: "审单规则", en: "Order Rules", end: true },
] as const;

function OrdersLayout() {
  const { t } = useLanguage();
  const { pathname } = useLocation();

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8">
      {/* 子页 tab（页面内已有 PageHeader 标题，此处只做模块导航） */}
      <div className="mb-6 flex items-center gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1">
        {tabs.map((tab) => {
          const active = tab.end ? pathname === tab.to : pathname.startsWith(tab.to);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
            >
              {t(tab.key, { fallback: tab.zh })}
            </Link>
          );
        })}
      </div>

      <Outlet />
    </div>
  );
}
