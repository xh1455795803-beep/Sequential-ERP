import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { Suspense, useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../lib/supabase';
import {
  LayoutDashboard, Package, ShoppingCart, Truck, Wallet, Store,
  LogOut, Menu, X, User, Loader2, TrendingUp, Box, ArrowUpRight,
} from 'lucide-react';

type MenuItem = { path: string; label: string; icon: any };

const MENU: MenuItem[] = [
  { path: '/merchant/dashboard', label: '工作台', icon: LayoutDashboard },
  { path: '/merchant/inventory', label: '我的库存', icon: Package },
  { path: '/merchant/packages', label: '包裹追踪', icon: Box },
  { path: '/merchant/inbound', label: '入库管理', icon: Store },
  { path: '/merchant/orders', label: '代打包订单', icon: ShoppingCart },
  { path: '/merchant/logistics', label: '物流追踪', icon: Truck },
  { path: '/merchant/shops', label: '平台店铺', icon: Store },
  { path: '/merchant/wallet', label: '账单/充值', icon: Wallet },
  { path: '/merchant/profit', label: '利润核算', icon: TrendingUp },
];

export function MerchantLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const path = useLocation().pathname;
  const isAuth = path.endsWith('/login') || path.endsWith('/register');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setUser(s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    (async () => {
      const { merchantId } = await getAuthContext();
      if (!merchantId) return;
      const { data } = await supabase.from('tlv_merchants').select('balance').eq('id', merchantId).maybeSingle();
      setBalance(Number((data as any)?.balance) || 0);
    })();
  }, []);

  if (isAuth) return <Outlet />;
  async function logout() { await supabase.auth.signOut(); navigate({ to: '/merchant/login' }); }

  const currentPath = useLocation().pathname;
  const fallback = <div className="p-12 flex items-center justify-center text-ink-300"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载中...</div>;

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 — 柔和渐变 */}
      <aside className={`${collapsed ? 'w-16' : 'w-60'} flex flex-col shrink-0 bg-gradient-to-b from-sky-50/80 via-white/60 to-cyan-50/60 border-r border-white/80 backdrop-blur-sm`}>
        <div className="h-14 flex items-center px-4 border-b border-white/60">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-300 to-cyan-200 flex items-center justify-center shadow-sm shadow-sky-100">
            <ShoppingCart className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="ml-2.5 leading-tight">
              <div className="font-bold text-sm text-ink-900">商家工作台</div>
              <div className="text-[10px] text-sky-500/80">Thalvior Seller</div>
            </div>
          )}
        </div>
        <nav className="flex-1 py-2 overflow-y-auto px-2 space-y-0.5">
          {MENU.map((m) => {
            const active = currentPath === m.path || currentPath.startsWith(m.path + '/');
            return (
              <button key={m.path} onClick={() => navigate({ to: m.path })}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition rounded-xl
                  ${active ? 'bg-gradient-to-r from-sky-100/80 to-cyan-50 text-sky-700 font-medium shadow-sm shadow-sky-100 border border-white/80' : 'text-ink-500 hover:bg-white/60 hover:text-ink-700'}`}>
                <m.icon className={`w-4 h-4 shrink-0 ${active ? 'text-sky-600' : ''}`} />
                {!collapsed && <span className="flex-1 text-left">{m.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/60 text-xs">
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2 text-ink-500">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-200 to-cyan-100 flex items-center justify-center"><User className="w-3.5 h-3.5 text-sky-700" /></div>
                <span className="truncate">{user?.email || '未登录'}</span>
              </div>
              <button onClick={logout} className="mt-2 text-ink-300 hover:text-rose-500 flex items-center gap-1">
                <LogOut className="w-3 h-3" /> 退出
              </button>
            </>
          ) : <button onClick={logout} title="退出" className="text-ink-300 hover:text-rose-500"><LogOut className="w-4 h-4" /></button>}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* 顶栏 — 玻璃 */}
        <header className="h-14 bg-white/60 backdrop-blur-md border-b border-white/80 flex items-center px-4 gap-3 shrink-0">
          <button onClick={() => setCollapsed((c) => !c)} className="p-1.5 rounded-lg hover:bg-white/60 transition">
            {collapsed ? <Menu className="w-4 h-4 text-ink-500" /> : <X className="w-4 h-4 text-ink-500" />}
          </button>
          <h1 className="font-semibold text-ink-700">{MENU.find((m) => currentPath.startsWith(m.path))?.label || '工作台'}</h1>
          <div className="ml-auto flex items-center gap-3">
            {/* 余额小卡 */}
            <div className="glass px-3 py-1.5 flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-sky-100 to-cyan-50 flex items-center justify-center"><Wallet className="w-3 h-3 text-sky-600" /></div>
              <div>
                <div className="text-[10px] text-ink-400 leading-tight">余额</div>
                <div className="text-xs font-bold text-sky-700 leading-tight tabular-nums">
                  {balance === null ? '---' : `¥${balance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`}
                </div>
              </div>
            </div>
            <button onClick={() => navigate({ to: '/merchant/wallet' })}
              className="bg-gradient-to-r from-sky-500 to-cyan-500 hover:from-sky-600 hover:to-cyan-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium shadow-sm shadow-sky-200/50 flex items-center gap-1">
              充值 <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4">
          <Suspense fallback={fallback}><Outlet /></Suspense>
        </div>
      </main>
    </div>
  );
}
