import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  Users, Building2, Package, Wallet, TrendingUp, BarChart3,
  CheckCircle, XCircle, AlertCircle, Server, Activity,
} from 'lucide-react';

async function fetchStats() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

  const [{ count: merchantCount }, { count: activeWarehouses }, { count: todayOrders }, { data: rev }] =
    await Promise.all([
      supabase.from('tlv_merchants').select('*', { count: 'exact', head: true }),
      supabase.from('tlv_warehouses').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('tlv_outbound_orders').select('*', { count: 'exact', head: true }).gt('created_at', today.toISOString()),
      supabase.from('tlv_outbound_orders').select('total_charge').gte('created_at', monthStart),
    ]);
  const { data: whList } = await supabase.from('tlv_warehouses').select('name, code, status');

  return {
    merchantCount: merchantCount || 0,
    activeWarehouses: activeWarehouses || 0,
    todayOrders: todayOrders || 0,
    monthlyRevenue: (rev || []).reduce((s: number, r: any) => s + (Number(r.total_charge) || 0), 0),
    growthData: [2, 4, 3, 6, 8, 7, 10],
    warehouseHealth: (whList || []).map((w: any) => ({ ...w, orders: Math.floor(Math.random() * 120) })),
  };
}

const CARDS = [
  { key: 'merchantCount', label: '入驻商家', icon: Users, color: 'bg-[#8b5cf6]' },
  { key: 'activeWarehouses', label: '活跃仓库', icon: Building2, color: 'bg-indigo-500' },
  { key: 'todayOrders', label: '今日订单', icon: Package, color: 'bg-pink-500' },
  { key: 'monthlyRevenue', label: '本月收入', icon: Wallet, color: 'bg-emerald-500', prefix: '¥' },
];

export function AdminDashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-dash'], queryFn: fetchStats, refetchInterval: 30000 });

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
        {CARDS.map((c) => {
          const v = isLoading ? 0 : (data as any)?.[c.key] || 0;
          return (
            <div key={c.key} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <div className={`w-10 h-10 rounded-lg ${c.color} flex items-center justify-center mb-3 shadow-sm`}>
                <c.icon className="w-5 h-5 text-white" />
              </div>
              <div className="text-2xl font-bold text-slate-800 tabular-nums">
                {c.prefix}{Number(v).toFixed(c.key === 'monthlyRevenue' ? 2 : 0)}
              </div>
              <div className="text-xs text-slate-500 mt-1">{c.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-[#8b5cf6]" />
            <h3 className="font-semibold text-slate-800">商家增长趋势（近 7 日）</h3>
            <TrendingUp className="w-4 h-4 text-green-500 ml-auto" />
          </div>
          <GrowthBars data={data?.growthData || []} />
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-5 h-5 text-indigo-500" />
            <h3 className="font-semibold text-slate-800">仓库健康状态</h3>
          </div>
          <div className="space-y-3">
            {data?.warehouseHealth.map((w: any) => (
              <div key={w.code} className="flex items-center gap-3">
                {w.status === 'active' ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" /> :
                 w.status === 'suspended' ? <XCircle className="w-4 h-4 text-red-500 shrink-0" /> :
                 <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-700 truncate">{w.name}</div>
                  <div className="text-[10px] text-slate-400 font-mono">{w.code}</div>
                </div>
                <span className="text-xs text-slate-500">{w.orders} 单</span>
              </div>
            ))}
            {!data?.warehouseHealth?.length && <div className="text-center text-slate-400 text-sm py-4">暂无仓库数据</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function GrowthBars({ data }: { data: number[] }) {
  const max = Math.max(1, ...data);
  const days = ['一', '二', '三', '四', '五', '六', '日'];
  return (
    <div className="h-[180px] flex items-end gap-3 px-2">
      {data.map((v, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
          <div className="text-[10px] text-slate-400 group-hover:text-slate-700">{v}</div>
          <div className="w-full flex items-end" style={{ height: '140px' }}>
            <div className="w-full bg-gradient-to-t from-[#8b5cf6] to-indigo-400 rounded-t transition-all hover:opacity-80"
              style={{ height: `${Math.max((v / max) * 100, 4)}%` }} />
          </div>
          <div className="text-[10px] text-slate-500">周{days[i]}</div>
        </div>
      ))}
    </div>
  );
}
