import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  LayoutDashboard, Warehouse, MapPin, Truck, Download, Upload, Boxes, ClipboardList,
  LogOut, Menu, X, PackageCheck, Layers, ArrowRightLeft,
} from 'lucide-react';

// 注意：main.tsx 里是手动注册路由，这里直接导出 AppLayout 组件
const MENU = [
  { path: '/dashboard', label: '工作台', icon: LayoutDashboard },
  { path: '/warehouses', label: '仓库管理', icon: Warehouse },
  { path: '/locations', label: '库位管理', icon: MapPin },
  { path: '/inventory', label: '实时库存', icon: Boxes },
  { path: '/asns', label: '入库管理', icon: Download },
  { path: '/shipments', label: '出库管理', icon: Upload },
  { path: '/bom', label: 'BOM 物料清单', icon: Layers },
  { path: '/kitting', label: '组套生产', icon: PackageCheck },
  { path: '/transfers', label: '跨库调拨', icon: ArrowRightLeft },
  { path: '/stocktaking', label: '盘点管理', icon: ClipboardList },
  { path: '/carriers', label: '承运商', icon: Truck },
];

export function AppLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, sess) => setUser(sess?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: '/' });
  }

  const currentPath = window.location.pathname;

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-gradient-to-b from-deep-800 to-deep-700 text-white transition-all duration-200 flex flex-col shrink-0`}>
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          <PackageCheck className="w-6 h-6 text-brand-500 shrink-0" />
          {!collapsed && <span className="ml-2 font-semibold tracking-wide">WMS · 仓管</span>}
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {MENU.map((m) => {
            const active = currentPath.includes('/wms' + m.path) || currentPath.endsWith(m.path) || currentPath.includes('/wms' + m.path + '/');
            return (
              <button
                key={m.path}
                onClick={() => navigate({ to: m.path })}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                  ${active ? 'bg-brand-500/20 text-white border-r-2 border-brand-500' : 'text-white/70 hover:text-white hover:bg-white/5'}`}
                title={collapsed ? m.label : undefined}
              >
                <m.icon className="w-4 h-4 shrink-0" />
                {!collapsed && <span>{m.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10 text-xs text-white/50">
          {!collapsed ? (
            <div>
              <div className="truncate">{user?.email || '未登录'}</div>
              <button onClick={logout} className="mt-2 text-brand-100 hover:text-white flex items-center gap-1">
                <LogOut className="w-3 h-3" /> 退出
              </button>
            </div>
          ) : (
            <button onClick={logout} title="退出"><LogOut className="w-4 h-4" /></button>
          )}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4 gap-3 shrink-0">
          <button onClick={() => setCollapsed((c) => !c)} className="p-1.5 rounded hover:bg-gray-100">
            {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
          <h1 className="text-base font-semibold text-gray-800">仓库管理系统</h1>
          <div className="ml-auto text-xs text-gray-500">Thalvior WMS v1.0</div>
        </header>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

// createFileRoute 兼容导出（TanStack Router 内部会查找，但此处布局是手动注册的）
export const Route = createFileRoute('/_layout')({ component: AppLayout });
