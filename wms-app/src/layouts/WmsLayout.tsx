import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  LayoutDashboard, Package, Truck, Inbox, ShoppingCart, ClipboardList,
  Wallet, BarChart3, LogOut, Menu, X, User, Building2,
} from 'lucide-react';

const MENU = [
  { path: '/wms/dashboard', label: '工作台', icon: LayoutDashboard },
  { path: '/wms/merchant-inbox', label: '商家入库待处理', icon: Inbox, badge: '2' },
  { path: '/wms/orders', label: '代打包订单', icon: ShoppingCart, badge: '1' },
  { path: '/wms/inventory', label: '库存管理', icon: Package },
  { path: '/wms/warehouses', label: '仓库管理', icon: Building2 },
  { path: '/wms/billing', label: '计费规则', icon: Wallet },
  { path: '/wms/reports', label: '数据报表', icon: BarChart3 },
];

export function WmsLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  const path = useLocation().pathname;
  const isAuth = path.endsWith('/login');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setUser(s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (isAuth) return <Outlet />;

  async function logout() { await supabase.auth.signOut(); navigate({ to: '/wms/login' }); }
  const currentPath = useLocation().pathname;

  return (
    <div className="flex h-screen bg-slate-50">
      <aside className={`${collapsed ? 'w-16' : 'w-60'} bg-gradient-to-b from-emerald-900 to-emerald-800 text-white transition-all flex flex-col shrink-0`}>
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          <Building2 className="w-6 h-6 text-emerald-300 shrink-0" />
          {!collapsed && (
            <div className="ml-2 leading-tight">
              <div className="font-bold text-sm">仓库操作后台</div>
              <div className="text-[10px] text-emerald-300">Thalvior WMS</div>
            </div>
          )}
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {MENU.map((m) => {
            const active = currentPath === m.path || currentPath.startsWith(m.path + '/');
            return (
              <button key={m.path} onClick={() => navigate({ to: m.path })}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition
                  ${active ? 'bg-white/15 text-white border-l-4 border-yellow-400' : 'text-emerald-100 hover:bg-white/10'}`}>
                <m.icon className="w-4 h-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{m.label}</span>
                    {m.badge && <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-500 text-white rounded-full">{m.badge}</span>}
                  </>
                )}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10 text-xs text-emerald-200">
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2"><User className="w-4 h-4" /><span className="truncate flex-1">{user?.email || '未登录'}</span></div>
              <button onClick={logout} className="mt-2 text-emerald-200 hover:text-white flex items-center gap-1"><LogOut className="w-3 h-3" /> 退出</button>
            </>
          ) : <button onClick={logout} title="退出"><LogOut className="w-4 h-4" /></button>}
        </div>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
          <button onClick={() => setCollapsed((c) => !c)} className="p-1.5 rounded hover:bg-slate-100">
            {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
          <h1 className="font-semibold text-slate-700">{MENU.find((m) => currentPath.startsWith(m.path))?.label || '工作台'}</h1>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span>当前仓库: <b className="text-emerald-700">深圳前海云仓</b></span>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-slate-50 p-4"><Outlet /></div>
      </main>
    </div>
  );
}
