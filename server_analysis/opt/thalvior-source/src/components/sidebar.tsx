import { Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import {
  LayoutDashboard,
  ShieldCheck,
  Package,
  ShoppingCart,
  Truck,
  BarChart3,
  CreditCard,
  Boxes,
  Sparkles,
  Megaphone,
  ShoppingBag,
  Wallet,
  PackageCheck,
  Users,
  Wrench,
  AlertTriangle,
  Zap,
  Plug,
  ChevronDown,
  Bell,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";

type Section = "overview" | "business" | "assets";

interface MenuItem {
  labelKey: string;
  icon: LucideIcon;
  path: string;
  section: Section; // 分组：总览 / 业务 / 资产
  group?: string;   // 激活态路径前缀
  children?: { labelKey: string; path: string }[];
}

// 素白 S1：黑白灰单色导航,分三组
const menu: MenuItem[] = [
  { labelKey: "nav.dashboard", icon: LayoutDashboard, path: "/dashboard", section: "overview" },
  { labelKey: "nav.notifications", icon: Bell, path: "/notifications", section: "overview" },

  { labelKey: "nav.auth", icon: ShieldCheck, path: "/auth", section: "business", group: "/auth" },
  { labelKey: "nav.products", icon: Package, path: "/products", section: "business", group: "/products", children: [
    { labelKey: "nav.products.list", path: "/products" },
    { labelKey: "nav.products.collect", path: "/products/collect" },
    { labelKey: "nav.products.material", path: "/products/material" },
    { labelKey: "nav.products.categories", path: "/products/categories" },
    { labelKey: "nav.products.brands", path: "/products/brands" },
    { labelKey: "nav.products.collect-rules", path: "/products/collect-rules" },
    { labelKey: "nav.products.collect-tasks", path: "/products/collect-tasks" },
  ]},
  { labelKey: "nav.orders", icon: ShoppingCart, path: "/orders", section: "business", group: "/orders", children: [
    { labelKey: "nav.orders.process", path: "/orders" },
    { labelKey: "nav.orders.pendingPayment", path: "/orders/pending-payment" },
    { labelKey: "nav.orders.pending", path: "/orders/pending" },
    { labelKey: "nav.orders.toShip", path: "/orders/to-ship" },
    { labelKey: "nav.orders.partShipped", path: "/orders/part-shipped" },
    { labelKey: "nav.orders.shipped", path: "/orders/shipped" },
    { labelKey: "nav.orders.completed", path: "/orders/completed" },
    { labelKey: "nav.orders.cancelled", path: "/orders/cancelled" },
    { labelKey: "nav.orders.exception", path: "/orders/exception" },
    { labelKey: "nav.orders.aftersale", path: "/orders/after-sale" },
    { labelKey: "nav.orders.aftersalePending", path: "/orders/aftersale-pending" },
    { labelKey: "nav.orders.aftersaleProcessing", path: "/orders/aftersale-processing" },
    { labelKey: "nav.orders.aftersaleDone", path: "/orders/aftersale-done" },
    { labelKey: "nav.orders.aftersaleRejected", path: "/orders/aftersale-rejected" },
    { labelKey: "nav.orders.rules", path: "/orders/rules" },
    { labelKey: "nav.orders.ruleActive", path: "/orders/rule-active" },
    { labelKey: "nav.orders.ruleInactive", path: "/orders/rule-inactive" },
    { labelKey: "nav.orders.settings", path: "/orders/settings" },
  ]},
  { labelKey: "nav.inventory", icon: Boxes, path: "/inventory", section: "business", group: "/inventory", children: [
    { labelKey: "nav.inventory.overview", path: "/inventory" },
    { labelKey: "nav.inventory.skus", path: "/inventory/skus" },
    { labelKey: "nav.inventory.warehouses", path: "/inventory/warehouses" },
    { labelKey: "nav.inventory.locations", path: "/inventory/locations" },
    { labelKey: "nav.inventory.adjustments", path: "/inventory/adjustments" },
    { labelKey: "nav.inventory.counts", path: "/inventory/counts" },
    { labelKey: "nav.inventory.logs", path: "/inventory/logs" },
    { labelKey: "nav.inventory.alerts", path: "/inventory/alerts" },
    { labelKey: "nav.inventory.strategies", path: "/inventory/strategies" },
    { labelKey: "nav.inventory.lowStock", path: "/inventory/low-stock" },
    { labelKey: "nav.inventory.outOfStock", path: "/inventory/out-of-stock" },
    { labelKey: "nav.inventory.locked", path: "/inventory/locked" },
    { labelKey: "nav.inventory.transit", path: "/inventory/transit" },
  ]},
  { labelKey: "nav.listing", icon: Megaphone, path: "/listing", section: "business", group: "/listing", children: [
    { labelKey: "nav.listing.overview", path: "/listing" },
    { labelKey: "nav.listing.pending", path: "/listing/pending" },
    { labelKey: "nav.listing.publishing", path: "/listing/publishing" },
    { labelKey: "nav.listing.published", path: "/listing/published" },
    { labelKey: "nav.listing.failed", path: "/listing/failed" },
    { labelKey: "nav.listing.templates", path: "/listing/templates" },
    { labelKey: "nav.listing.mappings", path: "/listing/mappings" },
    { labelKey: "nav.listing.logs", path: "/listing/logs" },
    { labelKey: "nav.listing.batch", path: "/listing/batch" },
  ]},
  { labelKey: "nav.logistics", icon: Truck, path: "/logistics", section: "business", group: "/logistics", children: [
    { labelKey: "nav.logistics.forwarder", path: "/logistics" },
    { labelKey: "nav.logistics.channel", path: "/logistics/channel" },
    { labelKey: "nav.logistics.tracking", path: "/logistics/tracking" },
    { labelKey: "nav.logistics.waybills", path: "/logistics/waybills" },
    { labelKey: "nav.logistics.parcels", path: "/logistics/parcels" },
    { labelKey: "nav.logistics.reconcile", path: "/logistics/reconcile" },
  ]},
  { labelKey: "nav.purchase", icon: ShoppingBag, path: "/purchase", section: "business", group: "/purchase", children: [
    { labelKey: "nav.purchase.supplier", path: "/purchase" },
    { labelKey: "nav.purchase.suppliers", path: "/purchase/suppliers" },
    { labelKey: "nav.purchase.orders", path: "/purchase/orders" },
    { labelKey: "nav.purchase.returns", path: "/purchase/returns" },
    { labelKey: "nav.purchase.plan", path: "/purchase/plan" },
    { labelKey: "nav.purchase.inbound", path: "/purchase/inbound" },
    { labelKey: "nav.purchase.suggestion", path: "/purchase/suggestion" },
  ]},
  { labelKey: "nav.fulfillment", icon: PackageCheck, path: "/fulfillment", section: "business", group: "/fulfillment", children: [
    { labelKey: "nav.fulfillment.stock", path: "/fulfillment" },
    { labelKey: "nav.fulfillment.shippingTasks", path: "/fulfillment/shipping-tasks" },
    { labelKey: "nav.fulfillment.split", path: "/fulfillment/split-rules" },
    { labelKey: "nav.fulfillment.outbound", path: "/fulfillment/outbound" },
  ]},
  { labelKey: "nav.ads", icon: Megaphone, path: "/ads", section: "business", group: "/ads", children: [
    { labelKey: "nav.ads.data", path: "/ads" },
    { labelKey: "nav.ads.keyword", path: "/ads/keyword" },
    { labelKey: "nav.ads.accounts", path: "/ads/accounts" },
    { labelKey: "nav.ads.groups", path: "/ads/groups" },
    { labelKey: "nav.ads.creatives", path: "/ads/creatives" },
    { labelKey: "nav.ads.budgets", path: "/ads/budgets" },
    { labelKey: "nav.ads.spend", path: "/ads/spend" },
    { labelKey: "nav.ads.orders", path: "/ads/orders" },
    { labelKey: "nav.ads.attribution", path: "/ads/attribution" },
    { labelKey: "nav.ads.analysis", path: "/ads/analysis" },
  ]},
  { labelKey: "nav.tools", icon: Wrench, path: "/tools/currency", section: "business", group: "/tools", children: [
    { labelKey: "nav.tools.currency", path: "/tools/currency" },
    { labelKey: "nav.tools.profit", path: "/tools/profit-calc" },
    { labelKey: "nav.tools.fba", path: "/tools/fba" },
    { labelKey: "nav.tools.tax", path: "/tools/tax" },
    { labelKey: "nav.tools.keyword", path: "/tools/keyword" },
    { labelKey: "nav.tools.competitor", path: "/tools/competitor" },
    { labelKey: "nav.tools.shippingCalc", path: "/tools/shipping-calc" },
    { labelKey: "nav.tools.dimCalc", path: "/tools/dim-calc" },
    { labelKey: "nav.tools.marginCalc", path: "/tools/margin-calc" },
    { labelKey: "nav.tools.priceCalc", path: "/tools/price-calc" },
  ]},

  { labelKey: "nav.finance", icon: Wallet, path: "/finance", section: "assets", group: "/finance", children: [
    { labelKey: "nav.finance.bill", path: "/finance" },
    { labelKey: "nav.finance.fee", path: "/finance/fee" },
    { labelKey: "nav.finance.reconcile", path: "/finance/reconcile" },
    { labelKey: "nav.finance.invoice", path: "/finance/invoice" },
    { labelKey: "nav.finance.income", path: "/finance/income" },
    { labelKey: "nav.finance.receivable", path: "/finance/receivable" },
    { labelKey: "nav.finance.payable", path: "/finance/payable" },
    { labelKey: "nav.finance.cost", path: "/finance/cost" },
    { labelKey: "nav.finance.fx", path: "/finance/fx" },
    { labelKey: "nav.finance.profitAnalysis", path: "/finance/profit-analysis" },
  ]},
  { labelKey: "nav.reports", icon: BarChart3, path: "/reports", section: "assets", group: "/reports", children: [
    { labelKey: "nav.reports.sales", path: "/reports" },
    { labelKey: "nav.reports.orders", path: "/reports/orders" },
    { labelKey: "nav.reports.inventory", path: "/reports/inventory" },
    { labelKey: "nav.reports.purchase", path: "/reports/purchase" },
    { labelKey: "nav.reports.logistics", path: "/reports/logistics" },
    { labelKey: "nav.reports.afterSales", path: "/reports/after-sales" },
    { labelKey: "nav.reports.finance", path: "/reports/finance" },
    { labelKey: "nav.reports.profit", path: "/reports/profit" },
    { labelKey: "nav.reports.shops", path: "/reports/shops" },
    { labelKey: "nav.reports.platform", path: "/reports/platform" },
    { labelKey: "nav.reports.region", path: "/reports/region" },
    { labelKey: "nav.reports.product", path: "/reports/product" },
    { labelKey: "nav.reports.traffic", path: "/reports/traffic" },
  ]},
  { labelKey: "nav.ai", icon: Sparkles, path: "/ai/workbench", section: "assets", group: "/ai", children: [
    { labelKey: "nav.ai.workbench", path: "/ai/workbench" },
    { labelKey: "nav.ai.tools", path: "/ai/tools" },
    { labelKey: "nav.ai.collect", path: "/ai/collect" },
    { labelKey: "nav.ai.resources", path: "/ai/resources" },
  ]},
  { labelKey: "nav.subaccounts", icon: Users, path: "/subaccounts", section: "assets" },
  { labelKey: "nav.subscription", icon: CreditCard, path: "/subscription", section: "assets", group: "/subscription", children: [
    { labelKey: "nav.subscription.home", path: "/subscription" },
    { labelKey: "nav.subscription.bills", path: "/subscription/bills" },
  ]},

  { labelKey: "nav.exceptions", icon: AlertTriangle, path: "/exceptions", section: "business", group: "/exceptions", children: [
    { labelKey: "nav.exceptions.all", path: "/exceptions" },
    { labelKey: "nav.exceptions.orders", path: "/exceptions/orders" },
    { labelKey: "nav.exceptions.inventory", path: "/exceptions/inventory" },
    { labelKey: "nav.exceptions.purchase", path: "/exceptions/purchase" },
    { labelKey: "nav.exceptions.logistics", path: "/exceptions/logistics" },
    { labelKey: "nav.exceptions.aftersale", path: "/exceptions/aftersale" },
    { labelKey: "nav.exceptions.finance", path: "/exceptions/finance" },
    { labelKey: "nav.exceptions.sync", path: "/exceptions/sync" },
    { labelKey: "nav.exceptions.webhook", path: "/exceptions/webhook" },
    { labelKey: "nav.exceptions.fulfillment", path: "/exceptions/fulfillment" },
    { labelKey: "nav.exceptions.handled", path: "/exceptions/handled" },
  ]},
  { labelKey: "nav.automation", icon: Zap, path: "/automation", section: "business", group: "/automation", children: [
    { labelKey: "nav.automation.rules", path: "/automation" },
    { labelKey: "nav.automation.runs", path: "/automation/runs" },
    { labelKey: "nav.automation.failures", path: "/automation/failures" },
    { labelKey: "nav.automation.workflow", path: "/automation/workflow" },
  ]},
  { labelKey: "nav.open", icon: Plug, path: "/open", section: "business", group: "/open", children: [
    { labelKey: "nav.open.keys", path: "/open/keys" },
    { labelKey: "nav.open.apps", path: "/open/apps" },
    { labelKey: "nav.open.webhooks", path: "/open/webhooks" },
    { labelKey: "nav.open.logs", path: "/open/logs" },
    { labelKey: "nav.open.docs", path: "/open/docs" },
  ]},
];

const SECTIONS: { key: Section; labelKey: string }[] = [
  { key: "overview", labelKey: "nav.group.overview" },
  { key: "business", labelKey: "nav.group.business" },
  { key: "assets", labelKey: "nav.group.assets" },
];

function BrandMark() {
  // T monogram：T 字 + 海浪弧，纯黑
  return (
    <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] shrink-0 text-foreground" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden>
      <path d="M5 6.4h14" />
      <path d="M12 6.4v11.2" />
      <path d="M6.8 20.2q2.7-2 5.2 0t5.2 0" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}

export function SidebarContent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLanguage();
  // 手动展开状态；未手动操作过的分组跟随激活态默认展开
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <>
      {/* Logo */}
      <Link to="/" className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4 transition-colors hover:bg-sidebar-accent/60">
        <BrandMark />
        <div className="leading-tight">
          <div className="font-display text-sm font-semibold tracking-tight text-sidebar-foreground">Thalvior</div>
          <div className="text-[11px] text-muted-foreground">{t("nav.logo.subtitle")}</div>
        </div>
      </Link>

      {/* 菜单（三组） */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {SECTIONS.map((sec) => {
          const items = menu.filter((m) => m.section === sec.key);
          if (!items.length) return null;
          return (
            <div key={sec.key} className="mb-4 last:mb-0">
              <div className="px-2 pb-1.5 text-[10.5px] font-medium tracking-[0.12em] text-[#9a9a9e]">
                {t(sec.labelKey)}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const activeBase = item.group ?? item.path;
                  const active = pathname === activeBase || pathname.startsWith(activeBase + "/");
                  const isExpanded = expanded[item.labelKey] ?? active;
                  const Icon = item.icon;
                  return (
                    <div key={item.labelKey}>
                      {item.children ? (
                        <button
                          type="button"
                          onClick={() => setExpanded((p) => ({ ...p, [item.labelKey]: !(p[item.labelKey] ?? active) }))}
                          className={cn(
                            "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                            active
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-[#5a5a5e] hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                          )}
                        >
                          <Icon
                            size={16}
                            strokeWidth={1.9}
                            className={cn(
                              "shrink-0",
                              active ? "text-sidebar-accent-foreground" : "text-[#9a9a9e] group-hover:text-[#5a5a5e]"
                            )}
                          />
                          <span className="flex-1 text-left">{t(item.labelKey)}</span>
                          <ChevronDown
                            size={13}
                            className={cn(
                              "shrink-0 text-[#b0b0b5] transition-transform",
                              isExpanded ? "rotate-180" : ""
                            )}
                          />
                        </button>
                      ) : (
                        <Link
                          to={item.path}
                          className={cn(
                            "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors",
                            active
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-[#5a5a5e] hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                          )}
                        >
                          <Icon
                            size={16}
                            strokeWidth={1.9}
                            className={cn(
                              "shrink-0",
                              active ? "text-sidebar-accent-foreground" : "text-[#9a9a9e] group-hover:text-[#5a5a5e]"
                            )}
                          />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      )}
                      {item.children && isExpanded && (
                        <div className="ml-[27px] mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2.5">
                          {item.children.map((child) => {
                            const childActive = pathname === child.path;
                            return (
                              <Link
                                key={child.path}
                                to={child.path}
                                className={cn(
                                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors",
                                  childActive
                                    ? "font-medium text-sidebar-foreground"
                                    : "text-[#9a9a9e] hover:text-[#5a5a5e]"
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-[3px] w-[3px] shrink-0 rounded-full",
                                    childActive ? "bg-sidebar-foreground" : "bg-[#c8c8cc]"
                                  )}
                                  aria-hidden
                                />
                                {t(child.labelKey)}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* 底部 */}
      <div className="border-t border-sidebar-border p-3">
        <Link to="/subscription" className="block rounded-md px-2.5 py-2 text-[12px] text-[#5a5a5e] transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
          {t("nav.plan")}：<span className="font-medium text-sidebar-foreground">{t("nav.plan.premium")}</span>
        </Link>
      </div>
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <SidebarContent />
    </aside>
  );
}
