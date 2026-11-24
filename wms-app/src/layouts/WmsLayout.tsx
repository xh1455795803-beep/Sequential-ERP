import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../lib/supabase';
import {
  LayoutDashboard, Package, Truck, Inbox, ShoppingCart, ClipboardList,
  Wallet, BarChart3, LogOut, Menu, X, User, Building2, CalendarDays,
  ClipboardCheck, Users, TrendingUp, AlertTriangle, GitBranch, Heart, FileBox,
} from 'lucide-react';

const MENU = [
  { path: '/wms/dashboard', label: '工作台', icon: LayoutDashboard },
  { path: '/wms/merchant-inbox', label: '商家入库待处理', icon: Inbox },
  { path: '/wms/orders', label: '代打包订单', icon: ShoppingCart },
  { path: '/wms/packages', label: '包裹管理', icon: FileBox },
  { path: '/wms/inventory', label: '库存管理', icon: Package },
  { path: '/wms/inventory/age', label: '库龄分析', icon: CalendarDays },
  { path: '/wms/stock-take', label: '库存盘点', icon: ClipboardCheck },
  { path: '/wms/issues', label: '问题件管理', icon: AlertTriangle, badge: true },
  { path: '/wms/flow-config', label: '仓库流程设置', icon: GitBranch },
  { path: '/wms/employees', label: '员工管理', icon: Users },
  { path: '/wms/performance', label: '绩效报表', icon: TrendingUp },
  { path: '/wms/customers', label: '客户管理', icon: Heart },
  { path: '/wms/warehouses', label: '仓库管理', icon: Building2 },
  { path: '/wms/billing', label: '计费规则', icon: Wallet },
  { path: '/wms/reports', label: '数据报表', icon: BarChart3 },
];

export function WmsLayout() {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [warehouseName, setWarehouseName] = useState('加载中...');
  const path = useLocation().pathname;
  const isAuth = path.endsWith('/login');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (ctx.warehouseId) {
        const { data } = await supabase.from('tlv_warehouses').select('name').eq('id', ctx.warehouseId).maybeSingle();
        setWarehouseName(data?.name || '未知仓库');
      } else setWarehouseName('未绑定仓库');
    })();
  }, []);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_, s) => setUser(s?.user));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (isAuth) return <Outlet />;
  async function logout() { await supabase.auth.signOut(); navigate({ to: '/wms/login' }); }
  const currentPath = useLocation().pathname;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={`${collapsed ? 'w-16' : 'w-60'} flex flex-col shrink-0 bg-gradient-to-b from-mint-50/80 via-white/60 to-emerald-50/60 border-r border-white/80 backdrop-blur-sm`}>
        <div className="h-14 flex items-center px-4 border-b border-white/60">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-mint-300 to-emerald-200 flex items-center justify-center shadow-sm shadow-mint-100">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="ml-2.5 leading-tight">
              <div className="font-bold text-sm text-ink-900">仓库操作后台</div>
              <div className="text-[10px] text-emerald-600/70">Thalvior WMS</div>
            </div>
          )}
        </div>
        <nav className="flex-1 py-2 overflow-y-auto px-2 space-y-0.5">
          {MENU.map((m) => {
            const active = currentPath === m.path || currentPath.startsWith(m.path + '/');
            return (
              <button key={m.path} onClick={() => navigate({ to: m.path })}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition rounded-xl
                  ${active ? 'bg-gradient-to-r from-mint-100/80 to-emerald-50 text-emerald-700 font-medium shadow-sm shadow-mint-100 border border-white/80' : 'text-ink-500 hover:bg-white/60 hover:text-ink-700'}`}>
                <m.icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-600' : ''}`} />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left">{m.label}</span>
                    {m.badge && <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-coral-500 text-white rounded-full">!</span>}
                  </>
                )}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/60 text-xs">
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2 text-ink-500">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-mint-200 to-emerald-100 flex items-center justify-center"><User className="w-3.5 h-3.5 text-emerald-700" /></div>
                <span className="truncate">{user?.email || '未登录'}</span>
              </div>
              <button onClick={logout} className="mt-2 text-ink-300 hover:text-rose-500 flex items-center gap-1"><LogOut className="w-3 h-3" /> 退出</button>
            </>
          ) : <button onClick={logout} title="退出" className="text-ink-300 hover:text-rose-500"><LogOut className="w-4 h-4" /></button>}
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-white/60 backdrop-blur-md border-b border-white/80 flex items-center px-4 gap-3 shrink-0">
          <button onClick={() => setCollapsed((c) => !c)} className="p-1.5 rounded-lg hover:bg-white/60">
            {collapsed ? <Menu className="w-4 h-4 text-ink-500" /> : <X className="w-4 h-4 text-ink-500" />}
          </button>
          <h1 className="font-semibold text-ink-700">{MENU.find((m) => currentPath.startsWith(m.path))?.label || '工作台'}</h1>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <div className="glass px-3 py-1.5 flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-mint-100 to-emerald-50 flex items-center justify-center"><Building2 className="w-3 h-3 text-emerald-600" /></div>
              <div>
                <div className="text-[10px] text-ink-400 leading-tight">当前仓库</div>
                <div className="text-xs font-bold text-emerald-700 leading-tight">{warehouseName}</div>
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4"><Outlet /></div>
      </main>
    </div>
  );
}
