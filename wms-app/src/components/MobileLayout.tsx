import { useEffect, useState } from 'react';
import {
  Home, QrCode, Download, Upload, Boxes, PackageCheck, User,
  LayoutDashboard, Tag, MapPin, AlertTriangle, LogOut,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

type Role = 'merchant' | 'warehouse' | 'forwarder';

const ROLE_LABEL: Record<Role, { label: string; color: string }> = {
  merchant:  { label: '商家端', color: 'text-blue-600' },
  warehouse: { label: '仓库端', color: 'text-emerald-600' },
  forwarder: { label: '货代端', color: 'text-purple-600' },
};

const TAB_BAR: Record<Role, { path: string; label: string; icon: any }[]> = {
  merchant: [
    { path: '/dashboard', label: '首页',    icon: Home },
    { path: '/orders',    label: '订单',    icon: Tag },
    { path: '/inventory', label: '库存',    icon: Boxes },
    { path: '/products',  label: '商品',    icon: PackageCheck },
    { path: '/me',        label: '我的',    icon: User },
  ],
  warehouse: [
    { path: '/pda',       label: 'PDA',     icon: QrCode },
    { path: '/asns',      label: '收货',    icon: Download },
    { path: '/inventory', label: '库存',    icon: Boxes },
    { path: '/shipments', label: '出库',    icon: Upload },
    { path: '/me',        label: '我的',    icon: User },
  ],
  forwarder: [
    { path: '/dashboard', label: '首页',    icon: Home },
    { path: '/orders',    label: '订单',    icon: Tag },
    { path: '/channels',  label: '渠道',    icon: LayoutDashboard },
    { path: '/shipments', label: '出库',    icon: Upload },
    { path: '/me',        label: '我的',    icon: User },
  ],
};

const PDA_ACTIONS = [
  { path: '/pda/receive',  label: '扫码收货',  icon: Download,   color: 'from-emerald-500 to-emerald-600' },
  { path: '/pda/putaway',  label: '扫码上架',  icon: MapPin,     color: 'from-blue-500 to-blue-600' },
  { path: '/pda/pick',     label: '扫码拣货',  icon: QrCode,     color: 'from-orange-500 to-orange-600' },
  { path: '/pda/pack',     label: '扫码打包',  icon: PackageCheck, color: 'from-purple-500 to-purple-600' },
  { path: '/inventory',    label: '库存查询',  icon: Boxes,      color: 'from-gray-500 to-gray-600' },
  { path: '/exceptions',   label: '异常处理',  icon: AlertTriangle, color: 'from-red-500 to-red-600' },
];

export function MobileLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [activeRole, setActiveRole] = useState<Role>('warehouse');
  const [allRoles, setAllRoles] = useState<Role[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setUser(u);
      const meta = u?.user_metadata || {};
      const roles: Role[] = (meta.roles || []).filter((r: string) =>
        ['merchant', 'warehouse', 'forwarder'].includes(r)) as Role[];
      setAllRoles(roles.length ? roles : ['merchant']);
      if (meta.active_role && roles.includes(meta.active_role)) {
        setActiveRole(meta.active_role);
      } else {
        setActiveRole(roles[0] || 'merchant');
      }
    });
  }, []);

  const path = window.location.pathname.replace('/wms', '');
  const tabs = TAB_BAR[activeRole] || TAB_BAR.merchant;

  const handleTabClick = (p: string) => {
    if (p === '/me') {
      // 简单个人面板，不占路由
      alert(`当前角色: ${ROLE_LABEL[activeRole].label}\n邮箱: ${user?.email || '-'}\n\n切换角色后请手动刷新`);
      return;
    }
    const u = new URL(window.location.href);
    u.pathname = '/wms' + p;
    window.location.href = u.toString();
  };

  const switchRole = async (r: Role) => {
    setActiveRole(r);
    await supabase.auth.updateUser({
      data: { ...(user?.user_metadata || {}), active_role: r },
    });
    window.location.href = '/wms/dashboard';
  };

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = '/wms/';
  };

  const isPdaHub = path === '/pda';

  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">
      {/* 顶部状态栏 */}
      <header className="shrink-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <PackageCheck className="w-5 h-5 text-brand-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-800 text-sm">Thalvior WMS</div>
          <div className={`text-[11px] ${ROLE_LABEL[activeRole].color}`}>
            {ROLE_LABEL[activeRole].label}
            {allRoles.length > 1 && (
              <select
                value={activeRole}
                onChange={(e) => switchRole(e.target.value as Role)}
                className="ml-1 text-[11px] bg-transparent border-none outline-none cursor-pointer"
              >
                {allRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r].label}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <button onClick={logout} className="p-2 text-gray-500 hover:text-gray-700 active:bg-gray-100 rounded-lg">
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* 主内容区 */}
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
                <button key={a.path}
                  onClick={() => {
                    const u = new URL(window.location.href);
                    u.pathname = '/wms' + a.path;
                    window.location.href = u.toString();
                  }}
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

      {/* 底部 Tab Bar */}
      <nav className="shrink-0 bg-white border-t border-gray-200 flex items-stretch">
        {tabs.map((t) => {
          const active = path.startsWith(t.path);
          return (
            <button
              key={t.path}
              onClick={() => handleTabClick(t.path)}
              className={`flex-1 flex flex-col items-center justify-center py-2.5 transition-colors active:bg-gray-100 ${
                active ? 'text-brand-500' : 'text-gray-500'
              }`}
            >
              <t.icon className="w-5 h-5 mb-0.5" />
              <span className="text-[10px]">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
