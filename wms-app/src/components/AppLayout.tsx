import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  LayoutDashboard, Download, Package, Boxes, Truck, RotateCcw, ClipboardList,
  Wallet, Wrench, Settings, BarChart3, Barcode, MapPin, ArrowRightLeft,
  RefreshCw, FileText, Layers, ShoppingCart, ClipboardCheck, Bell,
  LogOut, Menu, X, Users, Globe, Cog, Database, Shield, UserCircle,
  ChevronDown, ChevronRight, Smartphone, Zap, PackagePlus, Upload, Calendar,
} from 'lucide-react';

// ============================================================
// WMS v5 Admin 布局 — 分组侧边栏 + 顶栏
// ============================================================

type MenuItem = {
  path: string;
  label: string;
  icon: any;
  badge?: string;
};

type MenuGroup = {
  title: string;
  icon: any;
  items: MenuItem[];
};

const MENU_GROUPS: MenuGroup[] = [
  {
    title: '工作台',
    icon: LayoutDashboard,
    items: [
      { path: '/dashboard', label: '首页', icon: LayoutDashboard },
    ],
  },
  {
    title: '入库',
    icon: Download,
    items: [
      { path: '/asns', label: '到货通知', icon: FileText, badge: '3' },
      { path: '/putaway-tasks', label: '上架任务', icon: PackagePlus },
    ],
  },
  {
    title: '出库',
    icon: Upload,
    items: [
      { path: '/shipments', label: '发货单', icon: Truck },
      { path: '/wave-strategies', label: '波次策略', icon: Cog },
      { path: '/waves', label: '波次管理', icon: Zap },
      { path: '/wave-tasks', label: '拣货任务', icon: ClipboardCheck },
      { path: '/shipment-cancellations', label: '截单/取消', icon: RotateCcw },
    ],
  },
  {
    title: '库存',
    icon: Boxes,
    items: [
      { path: '/inventory', label: '实时库存', icon: Boxes },
      { path: '/inventory/move', label: '移库', icon: ArrowRightLeft },
      { path: '/inventory/adjust', label: '库存调整', icon: RefreshCw },
      { path: '/locations', label: '库位管理', icon: MapPin },
      { path: '/skus', label: 'SKU管理', icon: Barcode },
    ],
  },
  {
    title: '转运',
    icon: ArrowRightLeft,
    items: [
      { path: '/transfers', label: '跨仓调拨', icon: ArrowRightLeft },
    ],
  },
  {
    title: '退件/换货',
    icon: RefreshCw,
    items: [
      { path: '/returns', label: '退件处理', icon: RefreshCw },
      { path: '/fba-returns', label: 'FBA退货换标', icon: Package },
    ],
  },
  {
    title: '盘点',
    icon: ClipboardList,
    items: [
      { path: '/stocktaking', label: '盘点管理', icon: ClipboardList },
    ],
  },
  {
    title: '计费',
    icon: Wallet,
    items: [
      { path: '/billing', label: '费用管理', icon: Wallet },
      { path: '/carriers', label: '承运商', icon: Truck },
    ],
  },
  {
    title: '智能作业',
    icon: Wrench,
    items: [
      { path: '/bom', label: '组装清单', icon: Layers },
      { path: '/supplies', label: '耗材管理', icon: ShoppingCart },
      { path: '/staff/performance', label: '绩效统计', icon: BarChart3 },
    ],
  },
  {
    title: '设置',
    icon: Settings,
    items: [
      { path: '/settings', label: '系统设置', icon: Settings },
      { path: '/work-orders', label: '工单系统', icon: ClipboardList },
      { path: '/erp-sync', label: 'ERP同步', icon: Database },
      { path: '/webhooks', label: 'Webhooks', icon: Bell },
      { path: '/audit', label: '操作审计', icon: Shield },
      { path: '/settings/roles', label: '角色权限', icon: Users },
      { path: '/customer', label: '客户门户', icon: Globe },
    ],
  },
];

export function AppLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['工作台', '入库', '出库', '库存', '转运', '退件/换货', '盘点', '计费', '智能作业', '设置']),
  );

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, sess) => setUser(sess?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: '/wms/login' });
  }

  function toggleGroup(title: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  const currentPath = window.location.pathname;
  const fullPath = currentPath.startsWith('/wms') ? currentPath : `/wms${currentPath}`;

  const totalMenuItems = MENU_GROUPS.reduce((acc, g) => acc + g.items.length, 0);

  return (
    <div className="flex h-screen bg-gray-50">
      {/* ===== 侧边栏 ===== */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-64'} bg-gradient-to-b from-slate-900 to-slate-800 text-white transition-all duration-200 flex flex-col shrink-0`}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          <Package className="w-6 h-6 text-blue-400 shrink-0" />
          {!collapsed && (
            <div className="ml-2 leading-tight">
              <div className="font-semibold tracking-wide text-sm">WMS v5</div>
              <div className="text-[10px] text-white/40">仓管系统 · 领星版</div>
            </div>
          )}
        </div>

        {/* 分组菜单 */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {MENU_GROUPS.map((group) => {
            const isExpanded = expandedGroups.has(group.title);
            return (
              <div key={group.title} className="mb-1">
                {/* 分组标题 */}
                <button
                  onClick={() => toggleGroup(group.title)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-white/40 hover:text-white/70 transition-colors ${collapsed ? 'justify-center' : ''}`}
                  title={collapsed ? group.title : undefined}
                >
                  {!collapsed && (isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />)}
                  <group.icon className="w-3.5 h-3.5" />
                  {!collapsed && <span>{group.title}</span>}
                </button>

                {/* 菜单项 */}
                {isExpanded && (
                  <div className={`${collapsed ? '' : 'pl-2'}`}>
                    {group.items.map((item) => {
                      const fullItemPath = `/wms${item.path}`;
                      const active =
                        fullPath === fullItemPath ||
                        fullPath.startsWith(fullItemPath + '/') ||
                        (item.path !== '/' && fullPath.includes(fullItemPath));

                      return (
                        <button
                          key={item.path}
                          onClick={() => navigate({ to: item.path.startsWith('/') ? item.path : `/${item.path}` })}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors
                            ${active
                              ? 'bg-blue-500/20 text-white border-r-2 border-blue-500'
                              : 'text-white/60 hover:text-white hover:bg-white/5'}`}
                          title={collapsed ? item.label : undefined}
                        >
                          <item.icon className="w-4 h-4 shrink-0" />
                          {!collapsed && (
                            <>
                              <span className="flex-1 text-left">{item.label}</span>
                              {item.badge && (
                                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-amber-500 text-amber-900 rounded-full">
                                  {item.badge}
                                </span>
                              )}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* 作业员模式 — 跳转移动端 */}
          <div className="mt-4 pt-3 border-t border-white/10">
            <button
              onClick={() => window.open('/wms/m/', '_blank')}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-emerald-400 hover:text-emerald-300 hover:bg-white/5 transition-colors"
              title="作业员模式"
            >
              <Smartphone className="w-4 h-4 shrink-0" />
              {!collapsed && <span>📱 作业员模式</span>}
            </button>
          </div>
        </nav>

        {/* 底部用户信息 */}
        <div className="p-3 border-t border-white/10 text-xs text-white/50">
          {!collapsed ? (
            <div>
              <div className="flex items-center gap-2">
                <UserCircle className="w-4 h-4 shrink-0" />
                <div className="truncate flex-1">{user?.email || '未登录'}</div>
              </div>
              <div className="text-[10px] text-white/30 mt-1">{totalMenuItems} 菜单项</div>
              <button
                onClick={logout}
                className="mt-2 text-white/50 hover:text-white flex items-center gap-1"
              >
                <LogOut className="w-3 h-3" /> 退出登录
              </button>
            </div>
          ) : (
            <button onClick={logout} title="退出">
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </aside>

      {/* ===== 主内容区 ===== */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* 顶栏 */}
        <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded hover:bg-gray-100"
          >
            {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-600">
              {new Date().toLocaleDateString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                weekday: 'short',
              })}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Bell className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer" />
            <div className="h-6 w-px bg-gray-200" />
            <span className="text-xs text-gray-500">WMS v5 · Thalvior</span>
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

// createFileRoute 兼容导出（手动注册不使用文件约定式）
export const Route = createFileRoute('/wms/_layout')({ component: AppLayout });
