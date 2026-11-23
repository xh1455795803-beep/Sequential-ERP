import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  LayoutDashboard, Package, ShoppingCart, Truck, Wallet, Store,
  LogOut, Menu, X, User,
} from 'lucide-react';

type MenuItem = { path: string; label: string; icon: any; badge?: string };

const MENU: MenuItem[] = [
  { path: '/merchant/dashboard', label: '工作台', icon: LayoutDashboard },
  { path: '/merchant/inventory', label: '我的库存', icon: Package },
  { path: '/merchant/inbound', label: '入库管理', icon: Store, badge: '2' },
  { path: '/merchant/orders', label: '代打包订单', icon: ShoppingCart, badge: '1' },
  { path: '/merchant/logistics', label: '物流追踪', icon: Truck },
  { path: '/merchant/shops', label: '平台店铺', icon: Store },
  { path: '/merchant/wallet', label: '账单/充值', icon: Wallet },
];

export function MerchantLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  // Check if on login/register page → render Outlet only
  const path = window.location.pathname;
  const isAuth = path.endsWith('/login') || path.endsWith('/register');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setUser(s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (isAuth) return <Outlet />;

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: '/merchant/login' });
  }

  const currentPath = window.location.pathname;

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className={`${collapsed ? 'w-16' : 'w-60'} bg-gradient-to-b from-blue-900 to-blue-800 text-white transition-all flex flex-col shrink-0`}>
        <div className="h-14 flex items-center px-4 border-b border-white/10">
          <ShoppingCart className="w-6 h-6 text-yellow-400 shrink-0" />
          {!collapsed && (
            <div className="ml-2 leading-tight">
              <div className="font-bold text-sm">商家工作台</div>
              <div className="text-[10px] text-blue-300">Thalvior Seller</div>
            </div>
          )}
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {MENU.map((m) => {
            const active = currentPath === m.path || currentPath.startsWith(m.path + '/');
            return (
              <button key={m.path} onClick={() => navigate({ to: m.path })}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition
                  ${active ? 'bg-white/15 text-white border-l-4 border-yellow-400' : 'text-blue-100 hover:bg-white/10'}`}>
                <m.icon className="w-4 h-4 shrink-0" />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{m.label}</span>
                    {m.badge && (
                      <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-500 text-white rounded-full">{m.badge}</span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10 text-xs text-blue-200">
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span className="truncate flex-1">{user?.email || '未登录'}</span>
              </div>
              <button onClick={logout} className="mt-2 text-blue-200 hover:text-white flex items-center gap-1">
                <LogOut className="w-3 h-3" /> 退出
              </button>
            </>
          ) : (
            <button onClick={logout} title="退出登录"><LogOut className="w-4 h-4" /></button>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center px-4 gap-3 shrink-0">
          <button onClick={() => setCollapsed((c) => !c)} className="p-1.5 rounded hover:bg-slate-100">
            {collapsed ? <Menu className="w-4 h-4" /> : <X className="w-4 h-4" />}
          </button>
          <h1 className="font-semibold text-slate-700">{MENU.find((m) => currentPath.startsWith(m.path))?.label || '工作台'}</h1>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <div className="text-[10px] text-slate-400">账户余额</div>
              <div className="font-bold text-blue-600 text-sm">¥ 4,995.30</div>
            </div>
            <button onClick={() => navigate({ to: '/merchant/wallet' })} className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg">充值</button>
          </div>
        </header>
        <div className="flex-1 overflow-auto bg-slate-50 p-4">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
