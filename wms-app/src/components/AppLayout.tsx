import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useDevice } from '../hooks/useDevice';
import { MobileLayout } from './MobileLayout';
import {
  LayoutDashboard, Warehouse, MapPin, Truck, Download, Upload, Boxes, ClipboardList,
  LogOut, Menu, X, PackageCheck, QrCode, AlertTriangle, Store, Plug, Settings, ChevronDown, Search, Bell,
} from 'lucide-react';

/** meoo 风格侧边栏菜单 — 按 section 分组，和货小易完全一致 */
const MENU = [
  {
    section: '概览',
    items: [
      { path: '/dashboard', label: '工作台', icon: LayoutDashboard },
    ],
  },
  {
    section: '业务',
    items: [
      { path: '/orders',     label: 'ERP 订单',  icon: PackageCheck },
      { path: '/products',   label: '商品管理',  icon: Boxes },
      { path: '/inventory',  label: '实时库存',  icon: Boxes },
      { path: '/warehouses', label: '仓库管理',  icon: Warehouse },
      { path: '/locations',  label: '库位管理',  icon: MapPin },
      { path: '/asns',       label: '收货/ASN',  icon: Download },
      { path: '/shipments',  label: '出库管理',  icon: Upload },
      { path: '/channels',   label: '渠道配置',  icon: Truck },
      { path: '/stocktaking',label: '盘点管理',  icon: ClipboardList },
      { path: '/exceptions', label: '异常中心',  icon: AlertTriangle },
    ],
  },
  {
    section: '设置',
    items: [
      { path: '/erp',        label: 'ERP 连接',  icon: Plug },
      { path: '/stores',     label: '店铺绑定',  icon: Store },
    ],
  },
];

export function AppLayout() {
  const navigate = useNavigate();
  const { isMobile } = useDevice();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, sess) => setUser(sess?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: '/' });
  }

  if (isMobile) return <MobileLayout><Outlet /></MobileLayout>;

  const currentPath = window.location.pathname;
  function isActive(path: string) {
    const p = '/wms' + path;
    return currentPath === p || currentPath.startsWith(p + '/');
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-fg">
      {/* ============ Sidebar（完全对齐 meoo：w-60 + bg-sidebar 纯色 + section 分组 + 左侧活跃指示器 + 13px 菜单项） ============ */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-60'} shrink-0 flex flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200`}
      >
        {/* 品牌区 */}
        <div className="flex h-12 items-center gap-2.5 px-4 border-b border-sidebar-border">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
            <Warehouse className="h-4 w-4" strokeWidth={2.2} />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-display text-sm font-semibold tracking-tight text-sidebar-foreground truncate">
                Thalvior
              </div>
              <div className="text-[10.5px] text-sidebar-muted/80 tracking-wide">
                WMS · 仓库管理
              </div>
            </div>
          )}
        </div>

        {/* 菜单（section 分组，完全对齐 meoo） */}
        <nav className="flex-1 overflow-y-auto py-2">
          {MENU.map((section) => (
            <div key={section.section} className="mb-1">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10.5px] font-medium tracking-[0.12em] text-sidebar-muted/80 select-none">
                  {section.section}
                </div>
              )}
              {section.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <button key={item.path}
                    onClick={() => navigate({ to: item.path })}
                    title={collapsed ? item.label : undefined}
                    className={`group relative flex w-full items-center gap-2.5 py-1.5 pl-3 pr-2.5 text-[13px] transition-colors rounded-md outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring ${
                      active
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    }`}>
                    {/* meoo 风格：活跃指示器在左侧 2px */}
                    {active && (
                      <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-primary" />
                    )}
                    <item.icon className={`shrink-0 transition-colors ${
                      active ? 'text-sidebar-accent-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground'
                    }`} size={16} strokeWidth={active ? 2.2 : 1.9} />
                    {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* 底部用户区（meoo 风格：头像 + email + dropdown） */}
        <div className="border-t border-sidebar-border p-2">
          {!collapsed ? (
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand text-xs font-medium">
                  {(user?.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-[12px] font-medium text-sidebar-foreground">
                    {user?.email?.split('@')[0] || '未登录'}
                  </div>
                  <div className="truncate text-[10.5px] text-sidebar-muted">
                    {user?.email || ''}
                  </div>
                </div>
                <ChevronDown className={`h-3.5 w-3.5 text-sidebar-muted transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-md border border-border bg-popover p-1 shadow-lift">
                    <button onClick={() => setUserMenuOpen(false)}
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
              className="flex h-9 w-full items-center justify-center rounded-md text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground">
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>
      </aside>

      {/* ============ 主内容区 ============ */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Top bar（meoo 风格：border-b + 搜索 + 通知） */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3">
          <button onClick={() => setCollapsed((c) => !c)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg transition">
            {collapsed ? <Menu className="h-4 w-4" /> : <X className="h-4 w-4" />}
          </button>

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

        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
