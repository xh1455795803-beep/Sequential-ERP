import { useEffect, useState } from 'react';
import {
  Home, QrCode, Download, Upload, Boxes, PackageCheck, User, Plug, Store as StoreIcon,
  AlertTriangle, LogOut, Building2, ArrowLeft,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type ViewMode = 'owner' | 'worker';

const VIEW_LABEL: Record<ViewMode, { label: string }> = {
  owner:  { label: '老板视角' },
  worker: { label: '工人视角' },
};

const PDA_ACTIONS = [
  { path: '/pda/receive', label: '扫码收货',   icon: Download,       color: 'from-emerald-500 to-emerald-600' },
  { path: '/pda/putaway', label: '扫码上架',   icon: PackageCheck,   color: 'from-blue-500 to-blue-600' },
  { path: '/pda/pick',    label: '扫码拣货',   icon: QrCode,         color: 'from-orange-500 to-orange-600' },
  { path: '/pda/pack',    label: '扫码打包',   icon: PackageCheck,   color: 'from-purple-500 to-purple-600' },
  { path: '/inventory',   label: '库存查询',   icon: Boxes,          color: 'from-gray-500 to-gray-600' },
  { path: '/exceptions',  label: '异常处理',   icon: AlertTriangle,  color: 'from-red-500 to-red-600' },
];

export function MobileLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [view, setView] = useState<ViewMode>('owner');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const v = data.user?.user_metadata?.active_view === 'worker' ? 'worker' : 'owner';
      setView(v);
      setUser(data.user);
    });
  }, []);

  const tabsOwner = [
    { path: '/dashboard', label: '首页',   icon: Home },
    { path: '/orders',    label: '订单',   icon: PackageCheck },
    { path: '/inventory', label: '库存',   icon: Boxes },
    { path: '/channels',  label: '渠道',   icon: Plug },
    { path: '/me',        label: '我的',   icon: User },
  ];

  const tabsWorker = [
    { path: '/pda',       label: 'PDA',   icon: QrCode },
    { path: '/asns',      label: '收货',  icon: Download },
    { path: '/inventory', label: '库存',  icon: Boxes },
    { path: '/shipments', label: '出库',  icon: Upload },
    { path: '/me',        label: '我的',  icon: User },
  ];

  const tabs = view === 'owner' ? tabsOwner : tabsWorker;
  const path = window.location.pathname.replace('/wms', '');
  const isPdaHub = path === '/pda';

  const switchView = async (v: ViewMode) => {
    setView(v);
    await supabase.auth.updateUser({ data: { ...(user?.user_metadata || {}), active_view: v } });
    window.location.href = '/wms/' + (v === 'owner' ? 'dashboard' : 'pda');
  };

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/wms/';
  };

  const go = (p: string) => {
    if (p === '/me') {
      const v = view === 'owner' ? '工人' : '老板';
      alert(`当前视角：${VIEW_LABEL[view].label}\n邮箱：${user?.email || '-'}\n\n点顶部的"切换视角"可以切到 ${v} 视角`);
      return;
    }
    window.location.href = '/wms' + p;
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      <header className="shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <PackageCheck className="w-5 h-5 text-brand-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800 text-sm">Thalvior WMS</div>
          <div className={`text-[11px] ${view === 'owner' ? 'text-blue-600' : 'text-emerald-600'}`}>
            {VIEW_LABEL[view].label}
            <select value={view} onChange={(e) => switchView(e.target.value as ViewMode)}
              className="ml-1 text-[11px] bg-transparent border-none outline-none cursor-pointer">
              <option value="owner">老板视角</option>
              <option value="worker">工人视角</option>
            </select>
          </div>
        </div>
        <button onClick={logout} className="p-2 text-gray-500 active:bg-gray-100 rounded-lg">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden pb-20">
        {isPdaHub ? (
          <div className="p-4">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-500 text-white mb-2">
                <QrCode className="w-8 h-8" />
              </div>
              <h2 className="text-lg font-semibold text-gray-800">PDA 作业中心</h2>
              <p className="text-xs text-gray-500">扫码 · 收货 · 上架 · 拣货 · 打包</p>
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

      <nav className="shrink-0 bg-white border-t border-gray-200 flex items-stretch">
        {tabs.map((t) => {
          const active = path.startsWith(t.path);
          return (
            <button key={t.path} onClick={() => go(t.path)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 transition-colors active:bg-gray-100 ${
                active ? 'text-brand-500' : 'text-gray-500'
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
