import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useDevice } from '../hooks/useDevice';
import { MobileLayout } from './MobileLayout';
import {
  LayoutDashboard, Warehouse, MapPin, Truck, Download, Upload, Boxes, ClipboardList,
  LogOut, Menu, X, PackageCheck, QrCode, AlertTriangle, Store, Plug, Settings, ChevronDown, Search, Bell,
  ChevronRight,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from './ui/dropdown-menu';

/** meoo 风格侧边栏菜单 — 支持子菜单折叠/展开 */
type MenuChild = { path: string; label: string; icon?: any; badge?: string };
type MenuItem = MenuChild | { label: string; icon: any; children: MenuChild[] };

const MENU: { section: string; items: MenuItem[] }[] = [
  {
    section: '概览',
    items: [
      { path: '/dashboard', label: '工作台', icon: LayoutDashboard },
    ],
  },
  {
    section: '业务',
    items: [
      // 订单组（子菜单）
      {
        label: '订单管理', icon: PackageCheck,
        children: [
          { path: '/orders', label: 'ERP 订单' },
          { path: '/asns',   label: '收货 / ASN' },
          { path: '/shipments', label: '出库管理' },
        ],
      },
      // 库存组
      {
        label: '库存与商品', icon: Boxes,
        children: [
          { path: '/products',  label: '商品管理' },
          { path: '/inventory',  label: '实时库存' },
          { path: '/stocktaking', label: '盘点管理' },
        ],
      },
      // 仓库组
      {
        label: '仓库与库位', icon: Warehouse,
        children: [
          { path: '/warehouses', label: '仓库管理' },
          { path: '/locations',  label: '库位管理' },
          { path: '/channels',   label: '渠道配置' },
        ],
      },
      // 异常
      { path: '/exceptions', label: '异常中心', icon: AlertTriangle },
    ],
  },
  {
    section: '设置',
    items: [
      { path: '/erp',    label: 'ERP 连接',  icon: Plug },
      { path: '/stores', label: '店铺绑定',  icon: Store },
    ],
  },
];

export function AppLayout() {
  const navigate = useNavigate();
  const { isMobile } = useDevice();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    '订单管理': true, '库存与商品': true, '仓库与库位': false,
  });

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
  function isGroupActive(item: MenuItem): boolean {
    if ('path' in item) return isActive(item.path);
    if ('children' in item) return item.children.some(c => isActive(c.path));
    return false;
  }
  function getIcon(item: MenuItem) {
    if ('icon' in item) return item.icon;
    return undefined;
  }
  function getLabel(item: MenuItem) {
    return 'label' in item ? item.label : '';
  }

  function toggleGroup(label: string) {
    setOpenGroups((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  function renderMenuItem(item: MenuItem, depth = 0) {
    const active = isGroupActive(item);
    const icon = getIcon(item);

    // 有 children → 可折叠组
    if ('children' in item) {
      const open = openGroups[item.label] ?? active;
      return (
        <div key={item.label}>
          <button
            onClick={() => toggleGroup(item.label)}
            title={collapsed ? item.label : undefined}
            className={`group relative flex w-full items-center gap-2.5 py-1.5 pl-3 pr-2.5 text-[13px] rounded-md transition-colors outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring ${
              active
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
            }`}
          >
            {active && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-primary" />}
            {icon && (
              <icon className={`shrink-0 ${active ? 'text-sidebar-accent-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground'}`} size={16} strokeWidth={active ? 2.2 : 1.9} />
            )}
            {!collapsed && (
              <>
                <span className="flex-1 text-left truncate">{item.label}</span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''} text-sidebar-muted group-hover:text-sidebar-foreground`} />
              </>
            )}
          </button>
          {/* children 折叠区（meoo 风格：ml-[27px] border-l border-sidebar-border pl-2.5） */}
          {!collapsed && open && (
            <div className="ml-[27px] mt-0.5 border-l border-sidebar-border pl-2.5 space-y-0.5">
              {item.children.map((child) => {
                const childActive = isActive(child.path);
                return (
                  <button key={child.path}
                    onClick={() => navigate({ to: child.path })}
                    className={`group relative flex w-full items-center gap-2 py-1 pl-2 pr-2 text-[12.5px] rounded-md transition-colors ${
                      childActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
                        : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    }`}>
                    {/* meoo 风格子项：小圆点指示器 */}
                    {childActive && <span className="absolute -left-[10px] top-1/2 -translate-y-1/2 h-[3px] w-[3px] rounded-full bg-sidebar-primary" />}
                    <span className="flex-1 text-left truncate">{child.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    // 叶子项
    const leafActive = isActive(item.path);
    return (
      <button key={item.path}
        onClick={() => navigate({ to: item.path })}
        title={collapsed ? item.label : undefined}
        className={`group relative flex w-full items-center gap-2.5 py-1.5 pl-3 pr-2.5 text-[13px] rounded-md transition-colors outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring ${
          leafActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
        }`}>
        {leafActive && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-sidebar-primary" />}
        {icon && (
          <icon className={`shrink-0 ${leafActive ? 'text-sidebar-accent-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground'}`} size={16} strokeWidth={leafActive ? 2.2 : 1.9} />
        )}
        {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
      </button>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface text-fg">
      {/* ============ Sidebar ============ */}
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
              <div className="font-display text-sm font-semibold tracking-tight text-sidebar-foreground truncate">Thalvior</div>
              <div className="text-[10.5px] text-sidebar-muted/80 tracking-wide">WMS · 仓库管理</div>
            </div>
          )}
        </div>

        {/* 菜单（section 分组 + 子菜单折叠） */}
        <nav className="flex-1 overflow-y-auto py-2">
          {MENU.map((section) => (
            <div key={section.section} className="mb-1">
              {!collapsed && (
                <div className="px-3 pb-1 text-[10.5px] font-medium tracking-[0.12em] text-sidebar-muted/80 select-none">
                  {section.section}
                </div>
              )}
              {section.items.map((item) => renderMenuItem(item))}
            </div>
          ))}
        </nav>

        {/* 底部用户区（Radix Dropdown Menu 替换手写） */}
        <div className="border-t border-sidebar-border p-2">
          {!collapsed ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-sidebar-accent outline-none">
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
                <DropdownMenuItem className="gap-2"><Settings className="h-4 w-4" /> 偏好设置</DropdownMenuItem>
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
      <main className="flex-1 flex flex-col min-w-0">
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
