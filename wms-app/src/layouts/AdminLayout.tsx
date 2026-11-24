import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  LayoutDashboard, Building2, Store, Wallet, Calculator, FileText,
  LogOut, Menu, X, User, Shield,
} from 'lucide-react';

const MENU = [
  { path: '/admin/dashboard', label: '数据大屏', icon: LayoutDashboard },
  { path: '/admin/merchants', label: '商家管理', icon: Store },
  { path: '/admin/warehouses', label: '仓库管理', icon: Building2 },
  { path: '/admin/billing-rules', label: '计费规则', icon: Calculator },
  { path: '/admin/settlements', label: '结算管理', icon: FileText },
];

export function AdminLayout() {
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
  async function logout() { await supabase.auth.signOut(); navigate({ to: '/admin/login' }); }
  const currentPath = useLocation().pathname;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={`${collapsed ? 'w-16' : 'w-60'} flex flex-col shrink-0 bg-gradient-to-b from-lilac-50/80 via-white/60 to-violet-50/60 border-r border-white/80 backdrop-blur-sm`}>
        <div className="h-14 flex items-center px-4 border-b border-white/60">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-lilac-300 to-violet-200 flex items-center justify-center shadow-sm shadow-lilac-100">
            <Shield className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div className="ml-2.5 leading-tight">
              <div className="font-bold text-sm text-ink-900">Thalvior 管理控制台</div>
              <div className="text-[10px] text-violet-500/80">Platform Console</div>
            </div>
          )}
        </div>
        <nav className="flex-1 py-2 overflow-y-auto px-2 space-y-0.5">
          {MENU.map((m) => {
            const active = currentPath === m.path || currentPath.startsWith(m.path + '/');
            return (
              <button key={m.path} onClick={() => navigate({ to: m.path })}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm transition rounded-xl
                  ${active ? 'bg-gradient-to-r from-lilac-100/80 to-violet-50 text-violet-700 font-medium shadow-sm shadow-lilac-100 border border-white/80' : 'text-ink-500 hover:bg-white/60 hover:text-ink-700'}`}>
                <m.icon className={`w-4 h-4 shrink-0 ${active ? 'text-violet-600' : ''}`} />
                {!collapsed && <span className="flex-1 text-left">{m.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/60 text-xs">
          {!collapsed ? (
            <>
              <div className="flex items-center gap-2 text-ink-500">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-lilac-200 to-violet-100 flex items-center justify-center"><User className="w-3.5 h-3.5 text-violet-700" /></div>
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
          <h1 className="font-semibold text-ink-700">{MENU.find((m) => currentPath.startsWith(m.path))?.label || '数据大屏'}</h1>
          <div className="ml-auto text-xs text-ink-400">
            <span className="glass px-3 py-1.5 flex items-center gap-1.5"><Shield className="w-3 h-3 text-violet-500" />Platform Console · v6.0</span>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4"><Outlet /></div>
      </main>
    </div>
  );
}
