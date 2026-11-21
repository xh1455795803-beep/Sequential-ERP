import { Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useDevice } from '../hooks/useDevice';
import { MobileLayout } from './MobileLayout';
import {
  LayoutDashboard, PackageCheck, Boxes, Truck, Download, Upload,
  AlertTriangle, Plug, Store, Settings, LogOut, Menu, X, Search, Bell,
  ChevronDown, ChevronRight, XCircle, Plus, QrCode, ClipboardList,
  Wallet, BarChart3, Zap, Building2, MapPin, Clipboard,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from './ui/dropdown-menu';

/**
 * meoo 完整菜单结构 —— 1:1 对齐 meoo production layout chunk
 * 字段: label(显示名), icon, path, section, group, children[]
 * children 只有 label + path（meoo 子项没 icon）
 */
type MenuChild = { label: string; path: string };
type MenuItem = {
  label: string;
  icon?: any;
  path: string;
  section: string;
  group?: string;
  children?: MenuChild[];
};

const MENU: MenuItem[] = [
  // ============ section: overview ============
  { label: '工作台', icon: LayoutDashboard, path: '/dashboard', section: 'overview' },

  // ============ section: business ============
  {
    label: 'ERP 订单', icon: PackageCheck, path: '/orders', section: 'business', group: '/orders',
    children: [
      { label: '订单列表', path: '/orders' },
      { label: '出库管理', path: '/shipments' },
      { label: '收货 / ASN', path: '/asns' },
    ],
  },
  {
    label: '商品', icon: Boxes, path: '/products', section: 'business', group: '/products',
    children: [
      { label: '商品列表', path: '/products' },
      { label: '实时库存', path: '/inventory' },
      { label: '盘点管理', path: '/stocktaking' },
    ],
  },
  {
    label: '仓库', icon: Building2, path: '/warehouses', section: 'business', group: '/warehouses',
    children: [
      { label: '仓库列表', path: '/warehouses' },
      { label: '库位管理', path: '/locations' },
      { label: '渠道配置', path: '/channels' },
    ],
  },
  { label: '异常中心', icon: AlertTriangle, path: '/exceptions', section: 'business', group: '/exceptions' },

  // ============ section: settings ============
  {
    label: '集成', icon: Plug, path: '/erp', section: 'settings', group: '/erp',
    children: [
      { label: 'ERP 连接', path: '/erp' },
      { label: '店铺绑定', path: '/stores' },
    ],
  },
];

/** meoo section 显示名映射 */
const SECTION_LABEL: Record<string, string> = {
  overview: '概览',
  business: '业务',
  settings: '设置',
  assets: '资产',
};

/** meoo openTabs 多标签路由系统 */
interface OpenTab {
  path: string;
  title: string;
  closable: boolean;
}

const TABS_KEY = 'thalvior.openTabs';
const ACTIVE_KEY = 'thalvior.activePath';
const DEFAULT_TAB: OpenTab = { path: '/dashboard', title: '工作台', closable: false };

function loadTabs(): OpenTab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch {}
  return [DEFAULT_TAB];
}
function saveTabs(tabs: OpenTab[]) {
  try { localStorage.setItem(TABS_KEY, JSON.stringify(tabs)); } catch {}
}
function loadActive(): string {
  try { return localStorage.getItem(ACTIVE_KEY) || '/dashboard'; } catch { return '/dashboard'; }
}
function saveActive(p: string) {
  try { localStorage.setItem(ACTIVE_KEY, p); } catch {}
}

/** 找菜单里某个 path 对应的 label */
function findTitleForPath(path: string): string {
  for (const item of MENU) {
    if (item.path === path) return item.label;
    if (item.children) {
      const child = item.children.find((c) => c.path === path);
      if (child) return child.label;
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

  // ===== meoo openTabs 状态 =====
  const [tabs, setTabs] = useState<OpenTab[]>(loadTabs);
  const [activePath, setActivePath] = useState<string>(loadActive());
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // 默认展开包含当前路径的 group
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

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: '/' });
  }

  // ===== meoo openTabs syncPath =====
  const syncPath = useCallback(
    (path: string, title?: string) => {
      setTabs((prev) => {
        const exists = prev.find((t) => t.path === path);
        if (exists) {
          return prev; // 已存在，不重复加
        }
        const newTab: OpenTab = {
          path,
          title: title || findTitleForPath(path),
          closable: path !== '/dashboard',
        };
        return [...prev, newTab];
      });
      setActivePath(path);
      saveActive(path);
    },
    []
  );

  // ===== meoo openTabs closeTab =====
  const closeTab = useCallback(
    (path: string) => {
      setTabs((prev) => {
        const tab = prev.find((t) => t.path === path);
        if (!tab || !tab.closable) return prev;
        const filtered = prev.filter((t) => t.path !== path);
        // 如果关闭的是当前激活的，跳到最后一个
        setActivePath((cur) => {
          if (cur === path) {
            const fallback = filtered[filtered.length - 1]?.path || '/dashboard';
            navigate({ to: fallback });
            saveActive(fallback);
            return fallback;
          }
          return cur;
        });
        return filtered;
      });
    },
    [navigate]
  );

  // ===== location 变化 → sync openTabs =====
  useEffect(() => {
    const p = location.pathname.replace('/wms', '') || '/dashboard';
    syncPath(p);
    saveActive(p);
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

  function toggleGroup(path: string) {
    setOpenGroups((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  function handleNav(path: string) {
    navigate({ to: path });
  }

  function isActive(path: string) {
    return activePath === path;
  }

  if (isMobile) return <MobileLayout><Outlet /></MobileLayout>;

  // ===== 渲染菜单项（完全复刻 meoo 模式） =====
  function renderItem(item: MenuItem) {
    const hasChildren = !!item.children && item.children.length > 0;
    const active = isActive(item.path) || (item.children && item.children.some((c) => isActive(c.path)));
    const open = openGroups[item.path] ?? !!active;
    const Icon = item.icon;

    if (hasChildren) {
      // ====== 有 children → 可折叠 group（meoo 标准模式）======
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
                className={`shrink-0 transition-colors ${
                  active ? 'text-sidebar-accent-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground'
                }`}
                size={16}
                strokeWidth={active ? 2.2 : 1.9}
              />
            )}
            {!collapsed && (
              <>
                <span className="flex-1 text-left truncate">{item.label}</span>
                <ChevronDown
                  className={`h-3.5 w-3.5 shrink-0 text-sidebar-muted transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </>
            )}
          </button>
          {/* meoo 子项缩进: ml-[27px] border-l border-sidebar-border pl-2.5 */}
          {!collapsed && open && (
            <div className="ml-[27px] mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2.5">
              {item.children!.map((child) => {
                const childActive = isActive(child.path);
                return (
                  <button
                    key={child.path}
                    onClick={() => handleNav(child.path)}
                    className={`group relative flex w-full items-center gap-2 rounded-md py-1 pl-2 pr-2 text-[12.5px] transition-colors ${
                      childActive
                        ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                        : 'text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground'
                    }`}
                  >
                    {/* meoo 子项小圆点: h-[3px] w-[3px] bg-sidebar-primary */}
                    {childActive && (
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

    // ====== 叶子项 ======
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
            className={`shrink-0 transition-colors ${
              leafActive ? 'text-sidebar-accent-foreground' : 'text-sidebar-muted group-hover:text-sidebar-foreground'
            }`}
            size={16}
            strokeWidth={leafActive ? 2.2 : 1.9}
          />
        )}
        {!collapsed && <span className="flex-1 text-left truncate">{item.label}</span>}
      </button>
    );
  }

  // ====== 按 section 分组 ======
  const bySection: Record<string, MenuItem[]> = {};
  for (const item of MENU) {
    if (!bySection[item.section]) bySection[item.section] = [];
    bySection[item.section].push(item);
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
              <div className="truncate font-display text-sm font-semibold tracking-tight text-sidebar-foreground">
                Thalvior
              </div>
              <div className="text-[10.5px] tracking-wide text-sidebar-muted/80">WMS · 仓库管理</div>
            </div>
          )}
        </div>

        {/* 菜单（section 分组 —— 完全照 meoo） */}
        <nav className="flex-1 overflow-y-auto py-2">
          {Object.entries(bySection).map(([section, items]) => (
            <div key={section} className="mb-1">
              {!collapsed && (
                <div className="pb-1 pl-3 text-[10.5px] font-medium tracking-[0.12em] text-sidebar-muted/80 select-none">
                  {SECTION_LABEL[section] || section}
                </div>
              )}
              {items.map(renderItem)}
            </div>
          ))}
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
                    <div className="truncate text-[12px] font-medium text-sidebar-foreground">
                      {user?.email?.split('@')[0] || '未登录'}
                    </div>
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
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar —— meoo 风格: border-b + 搜索 + 通知 */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-3">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-8 w-8 items-center justify-center rounded-md text-fg-muted transition hover:bg-surface-hover hover:text-fg"
          >
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
                  onClick={() => { handleNav(tab.path); }}
                  className={`group flex h-6 shrink-0 items-center gap-1.5 rounded px-2.5 text-[12px] transition-colors ${
                    active
                      ? 'bg-accent text-fg font-medium shadow-[0_-1px_0_var(--brand)_inset]'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg'
                  }`}
                  title={tab.path}
                >
                  <span className="truncate max-w-[160px]">{tab.title}</span>
                  {tab.closable && (
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => { e.stopPropagation(); closeTab(tab.path); }}
                      className={`flex h-4 w-4 items-center justify-center rounded transition-colors ${
                        active
                          ? 'text-fg-muted hover:bg-surface-hover hover:text-fg'
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
