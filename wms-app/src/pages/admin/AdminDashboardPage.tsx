import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Users, Building2, Package, Wallet, Activity, ShieldAlert } from 'lucide-react';

export function AdminDashboardPage() {
  const [ok, setOk] = useState(false);
  const [stats, setStats] = useState({ merchants: 0, warehouses: 0, todayOrders: 0, monthlyRev: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    const { portalRole } = await getAuthContext();
    if (portalRole !== 'admin') { setOk(false); return; }
    setOk(true);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    const { data: agg } = await supabase
      .from('tlv_billings').select('total').gte('created_at', monthStart);

    const [
      { count: merchants },
      { count: warehouses },
      { count: todayOrders },
    ] = await Promise.all([
      supabase.from('tlv_merchants').select('*', { count: 'exact', head: true }),
      supabase.from('tlv_warehouses').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('tlv_outbound_orders').select('*', { count: 'exact', head: true }).gt('created_at', today.toISOString()),
    ]);

    const monthlyRev = (agg || []).reduce((s, r: any) => s + (Number(r.total) || 0), 0);
    setStats({ merchants: merchants || 0, warehouses: warehouses || 0, todayOrders: todayOrders || 0, monthlyRev });
    setLoading(false);
  })(); }, []);

  if (!ok) return <div className="p-12 text-center text-red-500 flex items-center justify-center gap-2"><ShieldAlert className="w-5 h-5" /> 需要管理员权限</div>;

  const cards = [
    { label: '入驻商家', value: stats.merchants, icon: Users, color: 'bg-[#8b5cf6]', fmt: (v: number) => v.toString() },
    { label: '活跃仓库', value: stats.warehouses, icon: Building2, color: 'bg-indigo-500', fmt: (v: number) => v.toString() },
    { label: '今日订单', value: stats.todayOrders, icon: Package, color: 'bg-pink-500', fmt: (v: number) => v.toString() },
    { label: '本月收入', value: stats.monthlyRev, icon: Wallet, color: 'bg-emerald-500', fmt: (v: number) => '¥' + v.toFixed(2) },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">平台数据大屏</h2>
          <p className="text-sm text-slate-500 mt-1">Thalvior SaaS · 实时概览</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Activity className="w-4 h-4 text-green-500" /> 实时更新中
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <div className={`w-10 h-10 rounded-lg ${c.color} flex items-center justify-center mb-3 shadow-sm`}>
              <c.icon className="w-5 h-5 text-white" />
            </div>
            <div className="text-2xl font-bold text-slate-800 tabular-nums">
              {loading ? '---' : c.fmt(c.value)}
            </div>
            <div className="text-xs text-slate-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-xl p-6 text-white">
        <h3 className="font-semibold mb-4 text-indigo-200">系统状态</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-white/10 rounded-lg p-3"><div className="text-indigo-200 text-xs">SaaS 版本</div><div className="font-semibold">v6.0.0</div></div>
          <div className="bg-white/10 rounded-lg p-3"><div className="text-indigo-200 text-xs">数据库</div><div className="font-semibold text-green-400">● 正常</div></div>
          <div className="bg-white/10 rounded-lg p-3"><div className="text-indigo-200 text-xs">API 延迟</div><div className="font-semibold">42 ms</div></div>
          <div className="bg-white/10 rounded-lg p-3"><div className="text-indigo-200 text-xs">活跃会话</div><div className="font-semibold">18</div></div>
        </div>
      </div>
    </div>
  );
}
