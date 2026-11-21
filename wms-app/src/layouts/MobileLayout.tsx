import { useEffect, useState } from 'react';
import {
  Home, QrCode, Download, Upload, Boxes, PackageCheck, User, Plug,
  AlertTriangle, LogOut,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getBasepath } from '../lib/env';

const PDA_ACTIONS = [
  { path: '/pda/receive', label: '扫码收货', icon: Download, color: 'from-emerald-500 to-emerald-600' },
  { path: '/pda/putaway', label: '扫码上架', icon: PackageCheck, color: 'from-blue-500 to-blue-600' },
  { path: '/pda/pick', label: '扫码拣货', icon: QrCode, color: 'from-orange-500 to-orange-600' },
  { path: '/pda/pack', label: '扫码打包', icon: PackageCheck, color: 'from-purple-500 to-purple-600' },
  { path: '/inventory', label: '库存查询', icon: Boxes, color: 'from-gray-500 to-gray-600' },
  { path: '/exceptions', label: '异常处理', icon: AlertTriangle, color: 'from-red-500 to-red-600' },
];

const TABS = [
  { path: '/dashboard', label: '工作台', icon: Home },
  { path: '/pda',       label: 'PDA',    icon: QrCode },
  { path: '/orders',    label: '订单',   icon: PackageCheck },
  { path: '/inventory', label: '库存',   icon: Boxes },
  { path: '/channels',  label: '渠道',   icon: Plug },
];

export function MobileLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
  }, []);

  const bp = getBasepath();
  const path = window.location.pathname.replace(bp, '');
  const isPdaHub = path === '/pda';

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = bp + (bp.endsWith('/') ? '' : '/');
  };

  const go = (p: string) => {
    window.location.href = bp.replace(/\/$/, '') + p;
  };

  return (
    <div className="flex flex-col h-screen bg-muted overflow-hidden">
      <header className="shrink-0 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
        <PackageCheck className="w-5 h-5 text-brand shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-fg text-sm">Thalvior WMS</div>
          <div className="text-[11px] text-fg-muted truncate">{user?.email || '-'}</div>
        </div>
        <button onClick={logout} className="p-2 text-fg-muted active:bg-surface-hover rounded-lg">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
        {isPdaHub ? (
          <div className="p-4">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand text-brand-ink mb-2">
                <QrCode className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-semibold text-fg">PDA 作业中心</h2>
              <p className="text-xs text-fg-muted">扫码 · 收货 · 上架 · 拣货 · 打包</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {PDA_ACTIONS.map((a) => (
                <button key={a.path} onClick={() => go(a.path)}
                  className={`relative bg-gradient-to-br ${a.color} text-white rounded-2xl p-4 aspect-square flex flex-col items-center justify-center shadow-lg shadow-black/10 active:scale-95 transition-transform`}>
                  <a.icon className="w-8 h-8 mb-2" />
                  <span className="text-sm font-medium">{a.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          children
        )}
      </main>

      <nav className="shrink-0 bg-card border-t border-border flex items-stretch">
        {TABS.map((t) => {
          const active = path.startsWith(t.path);
          return (
            <button key={t.path} onClick={() => go(t.path)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 transition-colors active:bg-surface-hover ${
                active ? 'text-brand' : 'text-fg-muted'
              }`}>
              <t.icon className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
