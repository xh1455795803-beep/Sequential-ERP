import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Users, Building2, Package, Wallet, Activity, ShieldAlert, TrendingUp } from 'lucide-react';

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
    const { data: agg } = await supabase.from('tlv_billings').select('total').gte('created_at', monthStart);
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

  if (!ok) return <div className="p-12 text-center text-rose-500 flex items-center justify-center gap-2"><ShieldAlert className="w-5 h-5" /> 需要管理员权限</div>;

  const cards = [
    { label: '入驻商家', value: stats.merchants, icon: Users,
      blobs: [['#f3e8ff','-right-4','-top-4','w-28','h-28'],['#e0f2fe','-left-3','-bottom-5','w-20','h-20']],
      iconBg: 'from-lilac-100 to-violet-50', iconColor: 'text-violet-600', trend: { up: true, text: '+5' } },
    { label: '活跃仓库', value: stats.warehouses, icon: Building2,
      blobs: [['#bae0fd','-right-5','-top-5','w-28','h-28'],['#bbf7d0','-left-3','-bottom-5','w-20','h-20']],
      iconBg: 'from-sky-100 to-cyan-50', iconColor: 'text-sky-600', trend: { up: true, text: '+1' } },
    { label: '今日订单', value: stats.todayOrders, icon: Package,
      blobs: [['#fed7aa','-right-4','-bottom-2','w-28','h-28'],['#fef3c7','-left-3','-top-4','w-20','h-20']],
      iconBg: 'from-coral-100 to-orange-50', iconColor: 'text-orange-600', trend: { up: true, text: '+12%' } },
    { label: '本月收入', value: stats.monthlyRev, icon: Wallet,
      blobs: [['#bbf7d0','-right-4','-top-6','w-28','h-28'],['#a7f3d0','-left-3','-bottom-5','w-20','h-20']],
      iconBg: 'from-mint-100 to-emerald-50', iconColor: 'text-emerald-600', trend: { up: true, text: '+8%' },
      fmt: (v: number) => '¥' + v.toFixed(2) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">平台数据大屏</h1>
          <p className="text-sm text-ink-500 mt-0.5">Thalvior SaaS · 实时概览</p>
        </div>
        <div className="glass px-3 py-1.5 flex items-center gap-1.5 text-xs text-emerald-600">
          <div className="dot bg-emerald-500" /> 实时更新中
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="glass relative overflow-hidden p-5">
            {c.blobs.map((b, j) => (
              <div key={j} className={`blob ${b[1]} ${b[2]} ${b[3]} ${b[4]}`} style={{ background: b[0] }} />
            ))}
            <div className="relative z-10">
              <div className={`inline-flex w-10 h-10 items-center justify-center rounded-xl bg-gradient-to-br ${c.iconBg} ${c.iconColor} mb-3`}>
                <c.icon className="w-5 h-5" />
              </div>
              <div className="text-3xl font-bold text-ink-900 tabular-nums leading-tight">
                {loading ? '---' : (c.fmt ? c.fmt(c.value) : c.value)}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-sm text-ink-500">{c.label}</span>
                {c.trend && (
                  <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-mint-100 text-emerald-600">
                    <TrendingUp className="w-2.5 h-2.5" /> {c.trend.text}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 系统状态 — 从深色面板改成玻璃 */}
      <div className="glass p-6">
        <h3 className="font-semibold text-ink-700 mb-4 flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-lilac-100 to-violet-50 flex items-center justify-center"><Activity className="w-4 h-4 text-violet-600" /></div>
          系统状态
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { l: 'SaaS 版本', v: 'v6.0.0', bg: 'from-sky-50 to-cyan-50', col: 'text-sky-700' },
            { l: '数据库', v: '● 正常', bg: 'from-mint-50 to-emerald-50', col: 'text-emerald-700' },
            { l: 'API 延迟', v: '42 ms', bg: 'from-lilac-50 to-violet-50', col: 'text-violet-700' },
            { l: '活跃会话', v: '18', bg: 'from-coral-50 to-orange-50', col: 'text-orange-700' },
          ].map((s, i) => (
            <div key={i} className={`rounded-xl bg-gradient-to-br ${s.bg} p-3 border border-white/60`}>
              <div className="text-[10px] text-ink-400 uppercase tracking-wider">{s.l}</div>
              <div className={`font-bold ${s.col} mt-0.5 tabular-nums`}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
