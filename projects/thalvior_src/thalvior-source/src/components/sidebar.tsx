import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  Globe,
  ExternalLink,
  ChevronDown,
  Bell,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext";
import { BrandMark } from "@/components/auth-shell";
import { getCurrentSubscription, getSubscriptionPlans } from "@/services/aiService";
import { dbPlanText } from "@/lib/plan-display";
import { HOME_PATH, tabsApi } from "@/stores/tabs";

type Section = "overview" | "business" | "assets";

interface MenuItem {
  labelKey: string;
  icon: LucideIcon;
  path: string;
  section: Section; // 分组：总览 / 业务 / 资产
  group?: string;   // 激活态路径前缀
  children?: { labelKey: string; path: string }[];
  href?: string;    // 站外链接（external=true 时用）
  external?: boolean;
}

// 素白 S2：赛狐式扁平横向菜单——高频业务在前，低频能力靠后
export const menu: MenuItem[] = [
  // ===== 总览 =====
  { labelKey: "nav.dashboard", icon: LayoutDashboard, path: "/dashboard", section: "overview" },

  // ===== 业务：主链路在前，异常与自动化殿后 =====
  { labelKey: "nav.orders", icon: ShoppingCart, path: "/orders", section: "business", group: "/orders", children: [
    { labelKey: "nav.orders.process", path: "/orders" },
    { labelKey: "nav.orders.toShip", path: "/orders/to-ship" },
    { labelKey: "nav.orders.aftersale", path: "/orders/after-sale" },
    { labelKey: "nav.orders.rules", path: "/orders/rules" },
    { labelKey: "nav.orders.settings", path: "/orders/settings" },
  ]},
  { labelKey: "nav.cs", icon: MessageSquare, path: "/cs", section: "business", group: "/cs", children: [
    { labelKey: "nav.cs.inbox", path: "/cs" },
    { labelKey: "nav.cs.reviews", path: "/cs/reviews" },
    { labelKey: "nav.cs.disputes", path: "/cs/disputes" },
  ]},
  { labelKey: "nav.products", icon: Package, path: "/products", section: "business", group: "/products", children: [
    { labelKey: "nav.products.list", path: "/products" },
    { labelKey: "nav.products.collect", path: "/products/collect" },
    { labelKey: "nav.products.material", path: "/products/material" },
    { labelKey: "nav.products.categories", path: "/products/categories" },
    { labelKey: "nav.products.brands", path: "/products/brands" },
    { labelKey: "nav.products.pricingTemplates", path: "/products/pricing" },
  ]},
  { labelKey: "nav.listing", icon: Megaphone, path: "/listing", section: "business", group: "/listing", children: [
    { labelKey: "nav.listing.overview", path: "/listing" },
    { labelKey: "nav.listing.templates", path: "/listing/templates" },
    { labelKey: "nav.listing.mappings", path: "/listing/mappings" },
    { labelKey: "nav.listing.batch", path: "/listing/batch" },
    { labelKey: "nav.listing.logs", path: "/listing/logs" },
  ]},
  { labelKey: "nav.inventory", icon: Boxes, path: "/inventory", section: "business", group: "/inventory", children: [
    { labelKey: "nav.inventory.overview", path: "/inventory" },
    { labelKey: "nav.inventory.skus", path: "/inventory/skus" },
    { labelKey: "nav.inventory.warehouses", path: "/inventory/warehouses" },
    { labelKey: "nav.inventory.locations", path: "/inventory/locations" },
    { labelKey: "nav.inventory.adjustments", path: "/inventory/adjustments" },
    { labelKey: "nav.inventory.counts", path: "/inventory/counts" },
    { labelKey: "nav.inventory.alerts", path: "/inventory/alerts" },
    { labelKey: "nav.inventory.lowStock", path: "/inventory/low-stock" },
    { labelKey: "nav.inventory.outOfStock", path: "/inventory/out-of-stock" },
    { labelKey: "nav.inventory.strategies", path: "/inventory/strategies" },
    { labelKey: "nav.inventory.logs", path: "/inventory/logs" },
  ]},
  { labelKey: "nav.fulfillment", icon: PackageCheck, path: "/fulfillment", section: "business", group: "/fulfillment", children: [
    { labelKey: "nav.fulfillment.stock", path: "/fulfillment" },
    { labelKey: "nav.fulfillment.shippingTasks", path: "/fulfillment/shipping-tasks" },
    { labelKey: "nav.fulfillment.split", path: "/fulfillment/split-rules" },
    { labelKey: "nav.fulfillment.outbound", path: "/fulfillment/outbound" },
  ]},
  { labelKey: "nav.logistics", icon: Truck, path: "/logistics", section: "business", group: "/logistics", children: [
    { labelKey: "nav.logistics.forwarder", path: "/logistics" },
    { labelKey: "nav.logistics.channel", path: "/logistics/channel" },
    { labelKey: "nav.logistics.quote", path: "/logistics/quote" },
    { labelKey: "nav.logistics.shipments", path: "/logistics/parcels" },
    { labelKey: "nav.logistics.waybills", path: "/logistics/waybills" },
    { labelKey: "nav.logistics.tracking", path: "/logistics/tracking" },
    { labelKey: "nav.logistics.reconcile", path: "/logistics/reconcile" },
  ]},
  { labelKey: "nav.purchase", icon: ShoppingBag, path: "/purchase", section: "business", group: "/purchase", children: [
    { labelKey: "nav.purchase.orders", path: "/purchase/orders" },
    { labelKey: "nav.purchase.suppliers", path: "/purchase/suppliers" },
    { labelKey: "nav.purchase.returns", path: "/purchase/returns" },
    { labelKey: "nav.purchase.plan", path: "/purchase/plan" },
    { labelKey: "nav.purchase.inbound", path: "/purchase/inbound" },
    { labelKey: "nav.purchase.suggestion", path: "/purchase/suggestion" },
  ]},
  { labelKey: "nav.automation", icon: Zap, path: "/automation", section: "business", group: "/automation", children: [
    { labelKey: "nav.automation.rules", path: "/automation" },
    { labelKey: "nav.automation.runs", path: "/automation/runs" },
    { labelKey: "nav.automation.failures", path: "/automation/failures" },
  ]},
  { labelKey: "nav.exceptions", icon: AlertTriangle, path: "/exceptions", section: "business", group: "/exceptions" },
  { labelKey: "nav.auth", icon: ShieldCheck, path: "/auth", section: "business", group: "/auth" },

  // ===== 资产：钱、数据、能力 =====
  { labelKey: "nav.finance", icon: Wallet, path: "/finance", section: "assets", group: "/finance", children: [
    { labelKey: "nav.finance.bill", path: "/finance" },
    { labelKey: "nav.finance.fee", path: "/finance/fee" },
    { labelKey: "nav.finance.fees", path: "/finance/fees" },
    { labelKey: "nav.finance.reconcile", path: "/finance/reconcile" },
    { labelKey: "nav.finance.invoice", path: "/finance/invoice" },
    { labelKey: "nav.finance.income", path: "/finance/income" },
    { labelKey: "nav.finance.receivable", path: "/finance/receivable" },
    { labelKey: "nav.finance.payable", path: "/finance/payable" },
    { labelKey: "nav.finance.cost", path: "/finance/cost" },
    { labelKey: "nav.finance.fx", path: "/finance/fx" },
    { labelKey: "nav.finance.profit", path: "/finance/profit" },
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
  ]},
  { labelKey: "nav.ai", icon: Sparkles, path: "/ai/workbench", section: "assets", group: "/ai", children: [
    { labelKey: "nav.ai.workbench", path: "/ai/workbench" },
    { labelKey: "nav.ai.listing", path: "/ai/listing" },
    { labelKey: "nav.ai.listing-cn", path: "/ai/listing-cn" },
    { labelKey: "nav.ai.tools", path: "/ai/tools" },
    { labelKey: "nav.ai.collect", path: "/ai/collect" },
    { labelKey: "nav.ai.resources", path: "/ai/resources" },
  ]},
  { labelKey: "nav.tools", icon: Wrench, path: "/tools/currency", section: "assets", group: "/tools", children: [
    { labelKey: "nav.tools.currency", path: "/tools/currency" },
    { labelKey: "nav.tools.profit", path: "/tools/profit-calc" },
    { labelKey: "nav.tools.priceCalc", path: "/tools/price-calc" },
    { labelKey: "nav.tools.marginCalc", path: "/tools/margin-calc" },
    { labelKey: "nav.tools.shippingCalc", path: "/tools/shipping-calc" },
    { labelKey: "nav.tools.dimCalc", path: "/tools/dim-calc" },
    { labelKey: "nav.tools.fba", path: "/tools/fba" },
    { labelKey: "nav.tools.tax", path: "/tools/tax" },
    { labelKey: "nav.tools.keyword", path: "/tools/keyword" },
    { labelKey: "nav.tools.competitor", path: "/tools/competitor" },
  ]},
];

/**
 * 已从侧栏收编、但路由仍然在线的页面（批量 5：导航分层）。
 * 侧栏只保留模块 + 真实子页面；状态筛选态、账号级入口一律下沉。
 * 这些页面仍可通过 ⌘K 搜索直达（见 cmdk.tsx），也可用 URL 直接访问。
 */
export const hiddenPages: { labelKey: string; path: string }[] = [
  // 批量 6 已删除：订单状态态 12 条、/automation/workflow、广告 4 条模板页、报表 2 条列表页、
  // /orders/pending、/products/collect-rules|tasks、/src/_layout.dashboard.tsx、horizontal-nav.tsx、56 个 .bak
  // 归档：/home/ubuntu/thalvior-backups/batch6-del-20261117-1518.tar.gz
  // 刊登状态态（/listing 页内状态带已覆盖，路由仍在线）
  { labelKey: "nav.listing.pending", path: "/listing/pending" },
  { labelKey: "nav.listing.publishing", path: "/listing/publishing" },
  { labelKey: "nav.listing.published", path: "/listing/published" },
  { labelKey: "nav.listing.failed", path: "/listing/failed" },
  // 库存快捷视图（锁定/在途两列在 /inventory 表内可排序）
  { labelKey: "nav.inventory.locked", path: "/inventory/locked" },
  { labelKey: "nav.inventory.transit", path: "/inventory/transit" },
  // 异常分类态（/exceptions 列表已含 type 列）
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
  // 账号级：已迁入顶栏头像下拉
  { labelKey: "nav.notifications", path: "/notifications" },
  { labelKey: "nav.subaccounts", path: "/subaccounts" },
  { labelKey: "nav.subscription", path: "/subscription" },
  { labelKey: "nav.subscription.bills", path: "/subscription/bills" },
];

const SECTIONS: { key: Section; labelKey: string }[] = [
  { key: "overview", labelKey: "nav.group.overview" },
  { key: "business", labelKey: "nav.group.business" },
  { key: "assets", labelKey: "nav.group.assets" },
];

// 模块身份色：A 静白极简——单色灰系（active 深灰字 / 静默中灰字），彩色身份点移除
const TINTS: Record<string, { on: string; off: string }> = {
  "nav.dashboard": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.notifications": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.auth": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.products": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.orders": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.inventory": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.listing": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.logistics": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.purchase": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.fulfillment": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.tools": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.finance": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.reports": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.ai": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.subaccounts": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.subscription": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.exceptions": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
  "nav.automation": { on: "text-sidebar-accent-foreground", off: "text-sidebar-muted group-hover:text-sidebar-foreground" },
};

export function SidebarContent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t, lang } = useLanguage();
  // 手动展开状态；未手动操作过的分组跟随激活态默认展开
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // P1-4: 套餐名统一真实数据源 —— 与订阅中心同源（subscriptions+subscription_plans），无订阅=免费版，禁止硬编码
  const [planName, setPlanName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sub = await getCurrentSubscription();
        let name: string | null = null;
        if (sub && sub.plan_id) {
          const plans = await getSubscriptionPlans();
          const plan = plans.find((p) => p.id === sub.plan_id);
          name = plan ? (dbPlanText(plan.name, lang, t) || null) : null;
        }
        if (alive) setPlanName(name || t("sub.freeTier"));
      } catch {
        if (alive) setPlanName(t("sub.freeTier"));
      }
    })();
    return () => { alive = false; };
  }, [lang]);

  return (
    <>
      {/* Logo */}
      <a href="/" className="flex h-12 items-center gap-2.5 px-4 transition-colors hover:bg-sidebar-accent">
        <BrandMark size={26} />
        <div className="leading-tight">
          <div className="font-display text-sm font-semibold tracking-tight text-sidebar-foreground">Thalvior</div>
          <div className="text-[11px] text-sidebar-muted">{t("nav.logo.subtitle")}</div>
        </div>
      </a>

      {/* 菜单（三组） */}
      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        {SECTIONS.map((sec) => {
          const items = menu.filter((m) => m.section === sec.key);
          if (!items.length) return null;
          return (
            <div key={sec.key} className="mb-4 last:mb-0">
              <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[10.5px] font-medium tracking-[0.12em] text-sidebar-muted/80">
                {t(sec.labelKey)}
              </div>
              <div className="space-y-0.5">
                {items.map((item) => {
                  const activeBase = item.group ?? item.path;
                  const active = !item.external && (pathname === activeBase || pathname.startsWith(activeBase + "/"));
                  const isExpanded = expanded[item.labelKey] ?? active;
                  const Icon = item.icon;
                  return (
                    <div key={item.labelKey}>
                      {item.external && item.href ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className={cn(
                            "group relative flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2.5 text-[13px] transition-colors",
                            "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          )}
                        >
                          <Icon
                            size={16}
                            strokeWidth={1.9}
                            className={cn(
                              "shrink-0 transition-colors",
                              TINTS[item.labelKey]?.off ?? "text-sidebar-muted group-hover:text-sidebar-foreground"
                            )}
                          />
                          <span className="flex-1">{t(item.labelKey)}</span>
                          <ExternalLink
                            size={12}
                            className="shrink-0 text-sidebar-muted/60"
                          />
                        </a>
                      ) : item.children ? (
                        <button
                          type="button"
                          onClick={() => setExpanded((p) => ({ ...p, [item.labelKey]: !(p[item.labelKey] ?? active) }))}
                          className={cn(
                            "group relative flex w-full items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2.5 text-[13px] transition-colors",
                            active
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          )}
                        >
                          {active ? (
                            <span
                              className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-primary"
                              aria-hidden
                            />
                          ) : null}
                          <Icon
                            size={16}
                            strokeWidth={1.9}
                            className={cn(
                              "shrink-0 transition-colors",
                              active ? TINTS[item.labelKey]?.on ?? "text-sidebar-accent-foreground" : TINTS[item.labelKey]?.off ?? "text-sidebar-muted group-hover:text-sidebar-foreground"
                            )}
                          />
                          <span className="flex-1 text-left">{t(item.labelKey)}</span>
                          <ChevronDown
                            size={13}
                            className={cn(
                              "shrink-0 text-sidebar-muted/60 transition-transform",
                              isExpanded ? "rotate-180" : ""
                            )}
                          />
                        </button>
                      ) : (
                        <Link
                          to={item.path}
                          onClick={() => tabsApi.openTab({ path: item.path, title: t(item.labelKey) })}
                          className={cn(
                            "group relative flex items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2.5 text-[13px] transition-colors",
                            active
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground"
                          )}
                        >
                          {active ? (
                            <span
                              className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-primary"
                              aria-hidden
                            />
                          ) : null}
                          <Icon
                            size={16}
                            strokeWidth={1.9}
                            className={cn(
                              "shrink-0 transition-colors",
                              active ? TINTS[item.labelKey]?.on ?? "text-sidebar-accent-foreground" : TINTS[item.labelKey]?.off ?? "text-sidebar-muted group-hover:text-sidebar-foreground"
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
                                onClick={() =>
                                  tabsApi.openTab({
                                    path: child.path,
                                    title: child.path === HOME_PATH ? t("nav.dashboard") : t(child.labelKey),
                                  })
                                }
                                className={cn(
                                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] transition-colors",
                                  childActive
                                    ? "font-medium text-sidebar-accent-foreground"
                                    : "text-sidebar-muted/85 hover:text-sidebar-foreground"
                                )}
                              >
                                <span
                                  className={cn(
                                    "h-[3px] w-[3px] shrink-0 rounded-full",
                                    childActive ? "bg-sidebar-primary" : "bg-sidebar-muted/50"
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
      <div className="p-3">
        <Link
          to="/subscription"
          onClick={() => tabsApi.openTab({ path: "/subscription", title: t("nav.subscription") })}
          className="block rounded-md px-2.5 py-2 text-[12px] text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          {t("nav.plan")}: <span className="font-medium text-sidebar-foreground">{planName ?? t("sub.state.loading")}</span>
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
