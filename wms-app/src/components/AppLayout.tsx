import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useDevice } from '../hooks/useDevice';
import { MobileLayout } from './MobileLayout';
import {
  LayoutDashboard, Warehouse, MapPin, Truck, Download, Upload, Boxes, ClipboardList,
  LogOut, Menu, X, PackageCheck, Building2, QrCode, AlertTriangle, Store, Plug,
  ChevronDown, Search, Bell, User, Settings,
} from 'lucide-react';

// === 视角模型（WMS 特有，meoo 没有） ===
type ViewMode = 'owner' | 'worker';

const VIEW_LABEL: Record<ViewMode, { label: string; icon: any }> = {
  owner:  { label: '卖家视角',   icon: Building2 },
  worker: { label: '仓库视角',   icon: QrCode },
};

// === meoo 风格侧边栏菜单（带 section 分组） ===
const MENU: Record<ViewMode, { section: string; items: { path: string; label: string; icon: any }[] }[]> = {
  owner: [
    { section: '概览', items: [
      { path: '/dashboard', label: '工作台',   icon: LayoutDashboard },
    ]},
    { section: '业务', items: [
      { path: '/orders',     label: 'ERP 订单',  icon: PackageCheck },
      { path: '/products',   label: '商品管理',  icon: Boxes },
      { path: '/inventory',  label: '实时库存',  icon: Boxes },
      { path: '/shipments',  label: '出库管理',  icon: Upload },
      { path: '/warehouses', label: '仓库管理',  icon: Warehouse },
      { path: '/channels',   label: '渠道配置',  icon: Truck },
      { path: '/exceptions', label: '异常中心',  icon: AlertTriangle },
    ]},
    { section: '设置', items: [
      { path: '/erp',        label: 'ERP 连接',  icon: Plug },
      { path: '/stores',     label: '店铺绑定',  icon: Store },
    ]},
  ],
  worker: [
    { section: '作业', items: [
      { path: '/pda',         label: 'PDA 扫码',   icon: QrCode },
      { path: '/asns',        label: '收货/ASN',   icon: Download },
      { path: '/shipments',   label: '出库拣货',   icon: Upload },
      { path: '/stocktaking', label: '盘点管理',   icon: ClipboardList },
    ]},
    { section: '资源', items: [
      { path: '/inventory',  label: '实时库存',   icon: Boxes },
      { path: '/warehouses', label: '仓库管理',   icon: Warehouse },
      { path: '/locations',  label: '库位管理',   icon: MapPin },
      { path: '/exceptions', label: '异常中心',   icon: AlertTriangle },
    ]},
  ],
};

export function AppLayout() {
  const navigate = useNavigate();
  const { isMobile } = useDevice();
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<ViewMode>('owner');
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setUser(u);
      const meta = u?.user_metadata || {};
      const v = (meta.active_view === 'worker' ? 'worker' : 'owner') as ViewMode;
      setView(v);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_, sess) => setUser(sess?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function switchView(v: ViewMode) {
    setView(v);
    await supabase.auth.updateUser({
      data: { ...(user?.user_metadata || {}), active_view: v },
    });
    navigate({ to: v === 'owner' ? '/dashboard' : '/pda' });
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: '/' });
  }

  if (isMobile) return <MobileLayout><Outlet /></MobileLayout>;

  const sections = MENU[view];
  const currentPath = window.location.pathname;

  function isActive(path: string) {
    const p = '/wms' + path;
    return currentPath === p || currentPath.startsWith(p + '/');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-fg">
      {/* ============ Sidebar（完全对齐 meoo：w-60 + bg-sidebar + section 分组 + 左侧活跃指示器） ============ */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 flex flex-col border-r border-sidebar-border bg-gradient-to-b from-[var(--sidebar-grad-a)] to-[var(--sidebar-grad-b)] transition-[width] duration-200`}
      >
        {/* 品牌区 */}
        <div className="flex h-12 items-center gap-2.5 px-4 border-b border-sidebar-border">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
            <Warehouse className="h-4 w-4" strokeWidth={2.5} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold tracking-tight text-sidebar-foreground truncate">
                Thalvior WMS
              </div>
              <div className="text-[10.5px] text-sidebar-muted/80 tracking-wide">
                {VIEW_LABEL[view].label}
              </div>
            </div>
          )}
        </div>

        {/* 视角切换（WMS 特有） */}
        {!collapsed && (
          <div className="px-3 py-2 border-b border-sidebar-border">
            <div className="flex gap-1 rounded-md bg-sidebar-muted/10 p-0.5">
              {(['owner', 'worker'] as ViewMode[]).map((v) => {
                const Icon = VIEW_LABEL[v].icon;
                const active = view === v;
                return (
                  <button key={v} onClick={() => switchView(v)}
                    className={`flex-1 flex items-center justify-center gap-1.5 rounded-[3px] py-1.5 text-[11px] font-medium transition-colors ${
                      active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    }`}>
                    <Icon className="w-3 h-3" />
                    {VIEW_LABEL[v].label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 菜单（按 section 分组，meoo 风格） */}
        <nav className="flex-1 overflow-y-auto py-2">
          {sections.map((section) => (
            <div key={section.section} className="mb-1">
              {/* Section header */}
              {!collapsed && (
                <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[10.5px] font-medium tracking-[0.12em] text-sidebar-muted/80 select-none">
                  {section.section}
                </div>
              )}
              {section.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <button key={item.path}
                    onClick={() => navigate({ to: item.path })}
                    title={collapsed ? item.label : undefined}
                    className={`group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring ${
                      active
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-muted hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                    }`}>
                    {/* meoo 风格：活跃指示器在左侧（2px sidebar-primary 竖条） */}
                    {active && !collapsed && (
                      <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-primary" />
                    )}
                    <item.icon className="h-4 w-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* 底部用户区 */}
        <div className="border-t border-sidebar-border p-2">
          {!collapsed ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent/50"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand text-xs font-medium">
                  {(user?.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[12px] font-medium text-sidebar-foreground">
                    {user?.email?.split('@')[0] || '未登录'}
                  </div>
                  <div className="truncate text-[10.5px] text-sidebar-muted">
                    {VIEW_LABEL[view].label}
                  </div>
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-sidebar-muted transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-md border border-border bg-popover p-1 shadow-lift">
                    <button onClick={() => { setUserMenuOpen(false); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-fg hover:bg-surface-hover">
                      <User className="h-3.5 w-3.5" /> 个人设置
                    </button>
                    <button onClick={() => { setUserMenuOpen(false); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-fg hover:bg-surface-hover">
                      <Settings className="h-3.5 w-3.5" /> 偏好设置
                    </button>
                    <div className="my-1 h-px bg-border" />
                    <button onClick={() => { setUserMenuOpen(false); logout(); }}
                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-[12px] text-destructive hover:bg-danger-subtle">
                      <LogOut className="h-3.5 w-3.5" /> 退出登录
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button onClick={logout} title="退出登录"
              className="flex h-9 w-full items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent/50 hover:text-sidebar-foreground">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      {/* ============ 主内容区 ============ */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar（meoo 风格：轻量 border-b + 折叠按钮 + 搜索 + 通知） */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3">
          <button onClick={() => setCollapsed((c) => !c)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg transition">
            {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </button>

          {/* 搜索（WMS 菜单项少，简化版） */}
          <div className="hidden h-8 items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 text-[13px] text-fg-muted transition-colors hover:border-brand/40 hover:bg-surface-hover hover:text-fg sm:flex">
            <Search className="h-3.5 w-3.5" />
            <span>搜索订单、SKU、仓库...</span>
            <kbd className="ml-auto hidden rounded border border-border bg-surface-raised px-1 text-[10px] font-mono text-fg-subtle lg:inline">⌘K</kbd>
          </div>

          <div className="ml-auto flex items-center gap-1">
            <button className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg transition" title="通知">
              <Bell className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* 页面内容 */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
