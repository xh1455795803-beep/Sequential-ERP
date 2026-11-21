import { Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useDevice } from '../hooks/useDevice';
import { MobileLayout } from './MobileLayout';
import {
  ShieldCheck, ClipboardList, MessageSquare, Boxes, Tag, Archive,
  Package, Truck, ShoppingCart, Zap, AlertTriangle, Shield,
  Wallet, BarChart3, Sparkles, Wrench, LogOut, Menu, X, Search, Bell,
  ChevronDown, ChevronRight, XCircle, Building2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from '../components/ui/dropdown-menu';

/**
 * ========================================================
 * meoo 完整菜单 —— 1:1 复刻自 meoo production layout chunk
 * 原始来源: _layout-gjXQ2pXw.js offset 3981
 * 结构: section → group → children
 * 字段含义:
 *   label:     显示名（meoo 用 labelKey 做 i18n 翻译）
 *   icon:      组图标（meoo 用压缩后的变量名 Ee/$e/$t/Dt/...）
 *   path:      点击跳转路径（meoo 直接用 React Router Link to）
 *   section:   顶层分组（meoo 只有 overview / business / assets 三个）
 *   group:     分组标识（meoo 用 group 字段判断 activePath）
 *   children:  子菜单数组（只有 label + path，meoo 子项无 icon）
 *
 * 约束: 禁止任何自主发挥 —— section 数量、group 数量、children 数量、
 *       顺序必须与 meoo 完全一致
 * ========================================================
 */
type MeooMenuChild = { label: string; path: string };
type MeooMenuItem = {
  label: string;
  icon: any;
  path: string;
  section: string;
  group?: string;
  children?: MeooMenuChild[];
};

const MENU: MeooMenuItem[] = [
  // ======================================================
  // section: overview  —— meoo 只有 1 项
  // ======================================================
  { label: '工作台', icon: ShieldCheck, path: '/dashboard', section: 'overview' },

  // ======================================================
  // section: business  —— meoo 11 项（9 个带 children + 2 个叶子）
  // 顺序严格按照 meoo 原数组
  // ======================================================
  {
    label: '订单', icon: ClipboardList, path: '/orders', section: 'business', group: '/orders',
    children: [
      { label: '订单处理', path: '/orders' },
      { label: '待发货', path: '/orders/to-ship' },
      { label: '售后', path: '/orders/after-sale' },
      { label: '规则', path: '/orders/rules' },
      { label: '设置', path: '/orders/settings' },
    ],
  },
  {
    label: '客服', icon: MessageSquare, path: '/cs', section: 'business', group: '/cs',
    children: [
      { label: '收件箱', path: '/cs' },
      { label: '评价', path: '/cs/reviews' },
      { label: '纠纷', path: '/cs/disputes' },
    ],
  },
  {
    label: '商品', icon: Boxes, path: '/products', section: 'business', group: '/products',
    children: [
      { label: '商品列表', path: '/products' },
      { label: '采集', path: '/products/collect' },
      { label: '素材', path: '/products/material' },
      { label: '分类', path: '/products/categories' },
      { label: '品牌', path: '/products/brands' },
      { label: '定价模板', path: '/products/pricing' },
    ],
  },
  {
    label: 'Listing', icon: Tag, path: '/listing', section: 'business', group: '/listing',
    children: [
      { label: '概览', path: '/listing' },
      { label: '模板', path: '/listing/templates' },
      { label: '映射', path: '/listing/mappings' },
      { label: '批量', path: '/listing/batch' },
      { label: '日志', path: '/listing/logs' },
    ],
  },
  {
    label: '库存', icon: Archive, path: '/inventory', section: 'business', group: '/inventory',
    children: [
      { label: '概览', path: '/inventory' },
      { label: 'SKU', path: '/inventory/skus' },
      { label: '仓库', path: '/inventory/warehouses' },
      { label: '库位', path: '/inventory/locations' },
      { label: '调整', path: '/inventory/adjustments' },
      { label: '盘点', path: '/inventory/counts' },
      { label: '告警', path: '/inventory/alerts' },
      { label: '低库存', path: '/inventory/low-stock' },
      { label: '缺货', path: '/inventory/out-of-stock' },
      { label: '策略', path: '/inventory/strategies' },
      { label: '日志', path: '/inventory/logs' },
    ],
  },
  {
    label: '履约', icon: Package, path: '/fulfillment', section: 'business', group: '/fulfillment',
    children: [
      { label: '库存', path: '/fulfillment' },
      { label: '发货任务', path: '/fulfillment/shipping-tasks' },
      { label: '拆分规则', path: '/fulfillment/split-rules' },
      { label: '出库', path: '/fulfillment/outbound' },
    ],
  },
  {
    label: '物流', icon: Truck, path: '/logistics', section: 'business', group: '/logistics',
    children: [
      { label: '货代', path: '/logistics' },
      { label: '渠道', path: '/logistics/channel' },
      { label: '报价', path: '/logistics/quote' },
      { label: '包裹', path: '/logistics/parcels' },
      { label: '运单', path: '/logistics/waybills' },
      { label: '追踪', path: '/logistics/tracking' },
      { label: '对账', path: '/logistics/reconcile' },
    ],
  },
  {
    label: '采购', icon: ShoppingCart, path: '/purchase', section: 'business', group: '/purchase',
    children: [
      { label: '采购单', path: '/purchase/orders' },
      { label: '供应商', path: '/purchase/suppliers' },
      { label: '退货', path: '/purchase/returns' },
      { label: '计划', path: '/purchase/plan' },
      { label: '入库', path: '/purchase/inbound' },
      { label: '建议', path: '/purchase/suggestion' },
    ],
  },
  {
    label: '自动化', icon: Zap, path: '/automation', section: 'business', group: '/automation',
    children: [
      { label: '规则', path: '/automation' },
      { label: '运行', path: '/automation/runs' },
      { label: '失败', path: '/automation/failures' },
    ],
  },
  // meoo 的两个叶子项（无 children）
  { label: '异常', icon: AlertTriangle, path: '/exceptions', section: 'business', group: '/exceptions' },
  { label: '认证', icon: Shield, path: '/auth', section: 'business', group: '/auth' },

  // ======================================================
  // section: assets  —— meoo 4 项（全部带 children）
  // ======================================================
  {
    label: '财务', icon: Wallet, path: '/finance', section: 'assets', group: '/finance',
    children: [
      { label: '账单', path: '/finance' },
      { label: '费用', path: '/finance/fee' },
      { label: '手续费', path: '/finance/fees' },
      { label: '对账', path: '/finance/reconcile' },
      { label: '发票', path: '/finance/invoice' },
      { label: '收入', path: '/finance/income' },
      { label: '应收', path: '/finance/receivable' },
      { label: '应付', path: '/finance/payable' },
      { label: '成本', path: '/finance/cost' },
      { label: '汇率', path: '/finance/fx' },
      { label: '利润', path: '/finance/profit' },
    ],
  },
  {
    label: '报表', icon: BarChart3, path: '/reports', section: 'assets', group: '/reports',
    children: [
      { label: '销售', path: '/reports' },
      { label: '订单', path: '/reports/orders' },
      { label: '库存', path: '/reports/inventory' },
      { label: '采购', path: '/reports/purchase' },
      { label: '物流', path: '/reports/logistics' },
      { label: '售后', path: '/reports/after-sales' },
      { label: '财务', path: '/reports/finance' },
      { label: '利润', path: '/reports/profit' },
      { label: '店铺', path: '/reports/shops' },
      { label: '平台', path: '/reports/platform' },
      { label: '区域', path: '/reports/region' },
    ],
  },
  {
    label: 'AI', icon: Sparkles, path: '/ai/workbench', section: 'assets', group: '/ai',
    children: [
      { label: '工作台', path: '/ai/workbench' },
      { label: 'Listing', path: '/ai/listing' },
      { label: 'Listing CN', path: '/ai/listing-cn' },
      { label: '工具', path: '/ai/tools' },
      { label: '采集', path: '/ai/collect' },
      { label: '资源', path: '/ai/resources' },
    ],
  },
  {
    label: '工具', icon: Wrench, path: '/tools/currency', section: 'assets', group: '/tools',
    children: [
      { label: '汇率', path: '/tools/currency' },
      { label: '利润计算', path: '/tools/profit-calc' },
      { label: '价格计算', path: '/tools/price-calc' },
      { label: '利润差', path: '/tools/margin-calc' },
      { label: '运费计算', path: '/tools/shipping-calc' },
      { label: '尺寸计算', path: '/tools/dim-calc' },
      { label: 'FBA', path: '/tools/fba' },
      { label: '税率', path: '/tools/tax' },
      { label: '关键词', path: '/tools/keyword' },
      { label: '竞品', path: '/tools/competitor' },
    ],
  },
];

/** meoo section label（meoo 用 labelKey + i18n，WMS 直接用中文） */
const SECTION_LABEL: Record<string, string> = {
  overview: '概览',
  business: '业务',
  assets: '资产',
};

/** meoo openTabs 多标签路由系统 —— 完整复刻 */
interface OpenTab { path: string; title: string; closable: boolean; }
const TABS_KEY = 'thalvior.openTabs';
const ACTIVE_KEY = 'thalvior.activePath';
const DEFAULT_TAB: OpenTab = { path: '/dashboard', title: '工作台', closable: false };

function loadTabs(): OpenTab[] {
  try { const raw = localStorage.getItem(TABS_KEY); if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length > 0) return arr; } } catch {}
  return [DEFAULT_TAB];
}
function saveTabs(tabs: OpenTab[]) { try { localStorage.setItem(TABS_KEY, JSON.stringify(tabs)); } catch {} }
function loadActive(): string { try { return localStorage.getItem(ACTIVE_KEY) || '/dashboard'; } catch { return '/dashboard'; } }
function saveActive(p: string) { try { localStorage.setItem(ACTIVE_KEY, p); } catch {} }

/** 从 MENU 找 path 对应的 label —— 递归查 children */
function findTitleForPath(path: string): string {
  for (const item of MENU) {
    if (item.path === path) return item.label;
    if (item.children) {
      const c = item.children.find((x) => x.path === path);
      if (c) return c.label;
    }
  }
  return path;
}

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useDevice();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);

  // ===== openTabs 状态 =====
  const [tabs, setTabs] = useState<OpenTab[]>(loadTabs);
  const [activePath, setActivePath] = useState<string>(loadActive());
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const result: Record<string, boolean> = {};
    for (const item of MENU) {
      if (item.children) {
        const active = item.path === activePath || item.children.some((c) => c.path === activePath);
        result[item.path] = active;
      }
    }
    return result;
  });

  // ===== Auth =====
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, sess) => setUser(sess?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() { await supabase.auth.signOut(); navigate({ to: '/' }); }

  // ===== meoo openTabs syncPath =====
  const syncPath = useCallback((path: string, title?: string) => {
    setTabs((prev) => {
      if (prev.find((t) => t.path === path)) return prev;
      return [...prev, { path, title: title || findTitleForPath(path), closable: path !== '/dashboard' }];
    });
    setActivePath(path); saveActive(path);
  }, []);

  // ===== meoo openTabs closeTab =====
  const closeTab = useCallback((path: string) => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.path === path);
      if (!tab || !tab.closable) return prev;
      const filtered = prev.filter((t) => t.path !== path);
      setActivePath((cur) => {
        if (cur === path) {
          const fb = filtered[filtered.length - 1]?.path || '/dashboard';
          navigate({ to: fb }); saveActive(fb); return fb;
        }
        return cur;
      });
      return filtered;
    });
  }, [navigate]);

  // ===== location 变化 → sync openTabs =====
  useEffect(() => {
    const p = location.pathname.replace('/wms', '') || '/dashboard';
    syncPath(p); saveActive(p);
  }, [location.pathname, syncPath]);

  // ===== tabs 变化 → localStorage =====
  useEffect(() => { saveTabs(tabs); }, [tabs]);

  // ===== 自动展开包含当前路径的 group =====
  useEffect(() => {
    setOpenGroups((prev) => {
      const changed = { ...prev };
      for (const item of MENU) {
        if (item.children) {
          const active = item.path === activePath || item.children.some((c) => c.path === activePath);
          if (active && !changed[item.path]) changed[item.path] = true;
        }
      }
      return changed;
    });
  }, [activePath]);

  function toggleGroup(path: string) { setOpenGroups((prev) => ({ ...prev, [path]: !prev[path] })); }
  function handleNav(path: string) { navigate({ to: path }); }
  function isActive(path: string) { return activePath === path; }

  if (isMobile) return <MobileLayout><Outlet /></MobileLayout>;

  // ===== 渲染菜单项 —— 完全照 meoo =====
  function renderItem(item: MeooMenuItem) {
    const hasChildren = !!item.children && item.children.length > 0;
    const active = isActive(item.path) || (item.children && item.children.some((c) => isActive(c.path)));
    const open = openGroups[item.path] ?? !!active;
    const Icon = item.icon;

    if (hasChildren) {
      // ====== group with children —— meoo 标准模式 ======
      return (
        <div key={item.path}>
          <button
            onClick={() => toggleGroup(item.path)}
            title={collapsed ? item.label : undefined}
            className={`group relative flex w-full items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2.5 text-[13px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-sidebar-ring ${
              active
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-primary" />
            )}
            {Icon && (
              <Icon
                className={`shrink-0 transition-colors ${active ? 'text-sidebar-accent-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground'}`}
                size={16}
                strokeWidth={active ? 2.2 : 1.9}
              />
            )}
            {!collapsed && (
              <>
                <span className="flex-1 text-left truncate">{item.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-sidebar-muted transition-transform ${open ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>
          {/* meoo 子项缩进: margin-left:27px + border-left:1px solid var(--sidebar-border) + padding-left:10px */}
          {!collapsed && open && (
            <div className="mt-0.5 space-y-0.5" style={{ marginLeft: 27, borderLeft: '1px solid var(--sidebar-border)', paddingLeft: 10 }}>
              {item.children!.map((child) => {
                const ca = isActive(child.path);
                return (
                  <button
                    key={child.path}
                    onClick={() => handleNav(child.path)}
                    className={`group relative flex w-full items-center gap-2 rounded-md py-1 pl-2 pr-2 text-[12.5px] transition-colors ${
                      ca
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    }`}
                  >
                    {ca && (
                      <span className="absolute -left-[10px] top-1/2 h-[3px] w-[3px] -translate-y-1/2 rounded-full bg-sidebar-primary" />
                    )}
                    <span className="flex-1 text-left truncate">{child.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // ====== 叶子项（无 children）======
    const leafActive = isActive(item.path);
    return (
      <button
        key={item.path}
        onClick={() => handleNav(item.path)}
        title={collapsed ? item.label : undefined}
        className={`group relative flex w-full items-center gap-2.5 rounded-md py-1.5 pl-3 pr-2.5 text-[13px] outline-none transition-colors focus-visible:ring-1 focus-visible:ring-sidebar-ring ${
          leafActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
        }`}
      >
        {leafActive && (
          <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-primary" />
        )}
        {Icon && (
          <Icon
            className={`shrink-0 transition-colors ${leafActive ? 'text-sidebar-accent-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground'}`}
            size={16} strokeWidth={leafActive ? 2.2 : 1.9}
          />
        )}
        {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
      </button>
    );
  }

  // ===== 按 section 分组（严格 meoo 顺序）=====
  const SECTION_ORDER = ['overview', 'business', 'assets'];
  const bySection: Record<string, MeooMenuItem[]> = {};
  for (const sec of SECTION_ORDER) bySection[sec] = [];
  for (const item of MENU) {
    if (bySection[item.section]) bySection[item.section].push(item);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-fg">
      {/* ============ Sidebar ============ */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200`}
      >
        {/* 品牌区 */}
        <div className="flex h-12 items-center gap-2.5 border-b border-sidebar-border px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
            <Building2 className="h-4 w-4" strokeWidth={2.2} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate font-display text-sm font-semibold tracking-tight text-sidebar-foreground">Thalvior</div>
              <div className="text-[10.5px] tracking-wide text-sidebar-muted/80">WMS · 仓库管理</div>
            </div>
          )}
        </div>

        {/* 菜单（section 分组 —— 完全照 meoo 原数组） */}
        <nav className="flex-1 overflow-y-auto py-2">
          {SECTION_ORDER.map((sec) => {
            const items = bySection[sec];
            if (!items || items.length === 0) return null;
            return (
              <div key={sec} className="mb-1">
                {!collapsed && (
                  <div className="pb-1 pl-3 text-[10.5px] font-medium tracking-[0.12em] text-sidebar-muted/80 select-none">
                    {SECTION_LABEL[sec] || sec}
                  </div>
                )}
                {items.map(renderItem)}
              </div>
            );
          })}
        </nav>

        {/* 底部用户区 —— Radix Dropdown Menu */}
        <div className="border-t border-sidebar-border p-2">
          {!collapsed ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-sidebar-accent">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand text-xs font-medium">
                    {(user?.email || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[12px] font-medium text-sidebar-foreground">{user?.email?.split('@')[0] || '未登录'}</div>
                    <div className="truncate text-[10.5px] text-sidebar-muted">{user?.email || ''}</div>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-sidebar-muted" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="text-sm font-medium">{user?.email?.split('@')[0] || '未登录'}</div>
                  <div className="text-xs text-muted-foreground">{user?.email || ''}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2"><Wrench className="h-4 w-4" /> 偏好设置</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="gap-2 text-destructive focus:text-destructive focus:bg-danger-subtle/30">
                  <LogOut className="h-4 w-4" /> 退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button title={user?.email || ''} className="flex h-9 w-full items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-subtle text-brand text-xs font-medium">
                    {(user?.email || '?').charAt(0).toUpperCase()}
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4} className="w-40">
                <DropdownMenuItem onClick={logout} className="gap-2 text-destructive focus:text-destructive">
                  <LogOut className="h-4 w-4" /> 退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </aside>

      {/* ============ 主内容区 ============ */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3">
          <button onClick={() => setCollapsed((c) => !c)} className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition hover:bg-surface-hover hover:text-fg">
            {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </button>
          <div className="hidden h-8 items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 text-[13px] text-fg-muted transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-fg sm:flex">
            <Search className="h-3.5 w-3.5" />
            <span>搜索订单、SKU、仓库...</span>
            <kbd className="ml-auto hidden rounded border border-border bg-surface-raised px-1 text-[10px] font-mono text-fg-subtle lg:inline">⌘K</kbd>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition hover:bg-surface-hover hover:text-fg" title="通知">
              <Bell className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* ============ meoo openTabs 多标签栏 ============ */}
        {tabs.length > 1 && (
          <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-border bg-surface-raised px-2 overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.path === activePath;
              return (
                <button
                  key={tab.path}
                  onClick={() => handleNav(tab.path)}
                  className={`group flex h-6 shrink-0 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors ${
                    active ? 'bg-accent text-fg font-medium shadow-[0_-1px_0_var(--brand)_inset]'
                           : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                  }`}
                  title={tab.path}
                >
                  <span className="truncate max-w-[160px]">{tab.title}</span>
                  {tab.closable && (
                    <span
                      role="button" tabIndex={-1}
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                      className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${
                        active ? 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                               : 'text-transparent group-hover:text-fg-muted hover:bg-surface-hover hover:text-fg'
                      }`}
                    >
                      <XCircle className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
