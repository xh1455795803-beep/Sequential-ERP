import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useDevice } from '../hooks/useDevice';
import { MobileLayout } from './MobileLayout';
import {
  LayoutDashboard, Warehouse, MapPin, Truck, Download, Upload, Boxes, ClipboardList,
  LogOut, Menu, X, PackageCheck, Building2, QrCode, AlertTriangle, Store, Plug,
} from 'lucide-react';

// === 角色模型 ===
// 只有一个主角色：seller
// 两个视角：owner（老板）和 worker（工人）
// 货代 = 外部 API 服务，不是系统角色

type ViewMode = 'owner' | 'worker';

const VIEW_LABEL: Record<ViewMode, { label: string; icon: any; desc: string }> = {
  owner:  { label: '老板视角',   icon: Building2, desc: 'ERP对接 · 店铺绑定 · 渠道配置 · 账单' },
  worker: { label: '工人视角',   icon: QrCode,    desc: 'PDA扫码 · 收货 · 拣货 · 打包' },
};

// 老板视角菜单
const OWNER_MENU = [
  { path: '/dashboard',   label: '工作台',     icon: LayoutDashboard },
  { path: '/erp',         label: 'ERP 连接',   icon: Plug },
  { path: '/stores',      label: '店铺绑定',   icon: Store },
  { path: '/orders',      label: 'ERP 订单',   icon: PackageCheck },
  { path: '/products',    label: '商品管理',   icon: Boxes },
  { path: '/inventory',   label: '实时库存',   icon: Boxes },
  { path: '/warehouses',  label: '仓库管理',   icon: Warehouse },
  { path: '/channels',    label: '渠道配置',   icon: Truck },
  { path: '/shipments',   label: '出库管理',   icon: Upload },
  { path: '/exceptions',  label: '异常中心',   icon: AlertTriangle },
];

// 工人视角菜单
const WORKER_MENU = [
  { path: '/pda',         label: 'PDA 作业',   icon: QrCode },
  { path: '/asns',        label: '收货/ASN',   icon: Download },
  { path: '/locations',   label: '库位管理',   icon: MapPin },
  { path: '/inventory',   label: '实时库存',   icon: Boxes },
  { path: '/shipments',   label: '出库拣货',   icon: Upload },
  { path: '/stocktaking', label: '盘点管理',   icon: ClipboardList },
  { path: '/exceptions',  label: '异常中心',   icon: AlertTriangle },
];

export function AppLayout() {
  const navigate = useNavigate();
  const { isMobile } = useDevice();
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<ViewMode>('owner');
  const [collapsed, setCollapsed] = useState(false);

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

  // === 移动端 ===
  if (isMobile) {
    return <MobileLayout><Outlet /></MobileLayout>;
  }

  const menu = view === 'owner' ? OWNER_MENU : WORKER_MENU;
  const currentPath = window.location.pathname;

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className={`${collapsed ? 'w-16' : 'w-56'} bg-gradient-to-b from-deep-800 to-deep-700 text-white transition-all duration-200 flex flex-col shrink-0`}>
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          <PackageCheck className="w-6 h-6 text-brand-500 shrink-0" />
          {!collapsed && (
            <div className="ml-2">
              <div className="font-semibold tracking-wide leading-tight">WMS · 仓管</div>
              <div className="text-[10px] text-white/40">Thalvior WMS · 卖家版</div>
            </div>
          )}
        </div>

        {/* 视角切换器 */}
        {!collapsed && (
          <div className="px-3 py-2 border-b border-white/10">
            <div className="text-[10px] text-white/40 mb-1">切换视角</div>
            <div className="flex gap-1">
              {(['owner', 'worker'] as ViewMode[]).map((v) => {
                const Icon = VIEW_LABEL[v].icon;
                return (
                  <button key={v}
                    onClick={() => switchView(v)}
                    className={`flex-1 px-2 py-1.5 rounded text-[11px] flex items-center justify-center gap-1 transition-colors ${
                      view === v ? 'bg-brand-500 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}>
                    <Icon className="w-3 h-3" />
                    {VIEW_LABEL[v].label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <nav className="flex-1 py-2 overflow-y-auto">
          {menu.map((m) => {
            const active = currentPath.includes('/wms' + m.path) || currentPath.endsWith(m.path) || currentPath.includes('/wms' + m.path + '/');
            return (
              <button key={m.path}
                onClick={() => navigate({ to: m.path })}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
                  ${active ? 'bg-brand-500/20 text-white border-r-2 border-brand-500' : 'text-white/70 hover:text-white hover:bg-white/5'}`}
                title={collapsed ? m.label : undefined}>
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
          <h1 className="text-base font-semibold text-gray-800">
            Thalvior WMS · {VIEW_LABEL[view].label}
          </h1>
          <div className="ml-auto text-xs text-gray-500">{VIEW_LABEL[view].desc}</div>
        </header>
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
