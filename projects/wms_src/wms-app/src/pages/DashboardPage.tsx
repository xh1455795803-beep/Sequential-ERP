import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Warehouse, Boxes, Download, Upload, Clock, TrendingUp, AlertTriangle } from 'lucide-react';

async function getStats() {
  const [warehouses, inv, asns, shipments, pendingAsn, pendingShip, tasks, logs] = await Promise.all([
    supabase.from('wms_warehouses').select('id', { count: 'exact', head: true }),
    supabase.from('wms_inventory').select('qty_on_hand', { count: 'exact', head: true }),
    supabase.from('wms_asns').select('*', { count: 'exact', head: true }),
    supabase.from('wms_shipments').select('*', { count: 'exact', head: true }),
    supabase.from('wms_asns').select('*').in('status', ['arrived', 'receiving', 'putaway']),
    supabase.from('wms_shipments').select('*').in('status', ['released', 'picking', 'packed']),
    supabase.from('wms_putaway_tasks').select('*').eq('status', 'pending'),
    supabase.from('wms_inventory_logs').select('*').order('created_at', { ascending: false }).limit(10),
  ]);

  const { data: invSum } = await supabase.from('wms_inventory')
    .select('qty_on_hand');

  const total = (invSum || []).reduce((s, r) => s + (r.qty_on_hand || 0), 0);

  return {
    warehouses: warehouses.count || 0,
    skuTypes: inv.count || 0,
    total,
    asns: asns.count || 0,
    shipments: shipments.count || 0,
    pendingAsn: pendingAsn.data?.length || 0,
    pendingShip: pendingShip.data?.length || 0,
    taskCount: tasks.data?.length || 0,
    recentLogs: logs.data || [],
  };
}

export function DashboardPage() {
  const { data, isLoading } = useQuery({ queryKey: ['wms-dash'], queryFn: getStats, refetchInterval: 15000 });

  const cards = [
    { label: '仓库数量', value: data?.warehouses, icon: Warehouse, color: 'bg-sea-500' },
    { label: 'SKU 种类', value: data?.skuTypes, icon: Boxes, color: 'bg-brand-500' },
    { label: '在库总数', value: data?.total, icon: TrendingUp, color: 'bg-deep-700' },
    { label: '入库待处理', value: data?.pendingAsn, icon: Download, color: 'bg-green-500' },
    { label: '出库待处理', value: data?.pendingShip, icon: Upload, color: 'bg-purple-500' },
    { label: '上架任务', value: data?.taskCount, icon: Clock, color: 'bg-orange-500' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">工作台</h2>
        <p className="text-sm text-gray-500 mt-1">实时掌握仓库运行状态</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className={`w-9 h-9 rounded-lg ${c.color} text-white flex items-center justify-center mb-3`}>
              <c.icon className="w-4 h-4" />
            </div>
            <div className="text-2xl font-bold text-gray-800">{isLoading ? '-' : c.value ?? 0}</div>
            <div className="text-xs text-gray-500 mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      {/* 待办提醒 */}
      {data && (data.pendingAsn > 0 || data.pendingShip > 0 || data.taskCount > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-800">
            <div className="font-medium mb-1">待处理任务</div>
            <div>有 <b>{data.pendingAsn}</b> 个入库单在等待处理，
                 <b>{data.pendingShip}</b> 个出库单在等待发货，
                 <b>{data.taskCount}</b> 个上架任务待执行。</div>
          </div>
        </div>
      )}

      {/* 最近流水 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium text-gray-700">最近库存流水</div>
        {isLoading ? (
          <div className="p-8 text-center text-gray-400">加载中...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="text-left px-5 py-2.5">时间</th>
                <th className="text-left px-5 py-2.5">SKU</th>
                <th className="text-left px-5 py-2.5">类型</th>
                <th className="text-right px-5 py-2.5">变动</th>
                <th className="text-right px-5 py-2.5">变动后</th>
              </tr>
            </thead>
            <tbody>
              {((data?.recentLogs as any[]) || []).map((l) => (
                <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-2.5 text-gray-500">{new Date(l.created_at).toLocaleString('zh-CN')}</td>
                  <td className="px-5 py-2.5 font-medium">{l.sku}</td>
                  <td className="px-5 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs ${l.qty_change >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      {typeLabel(l.type)}
                    </span>
                  </td>
                  <td className={`px-5 py-2.5 text-right ${l.qty_change >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {l.qty_change > 0 ? '+' : ''}{l.qty_change}
                  </td>
                  <td className="px-5 py-2.5 text-right font-medium">{l.qty_after}</td>
                </tr>
              ))}
              {(!data?.recentLogs?.length) && (
                <tr><td colSpan={5} className="p-8 text-center text-gray-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function typeLabel(t: string) {
  const m: Record<string, string> = {
    inbound_putaway: '上架入库', outbound_pick: '出库拣货',
    move: '库位移动', adjust_in: '盘盈', adjust_out: '盘亏',
  };
  return m[t] || t;
}
