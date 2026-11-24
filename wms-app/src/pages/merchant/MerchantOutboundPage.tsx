import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Plus } from 'lucide-react';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  picking: 'bg-indigo-100 text-indigo-700',
  packing: 'bg-purple-100 text-purple-700',
  weighed: 'bg-amber-100 text-amber-700',
  label_printed: 'bg-yellow-100 text-yellow-700',
  shipped: 'bg-teal-100 text-teal-700',
  completed: 'bg-emerald-100 text-emerald-700',
};
const STATUS_LABEL: Record<string, string> = {
  pending: '待处理', picking: '拣货中', packing: '打包中',
  weighed: '已称重', label_printed: '已打标', shipped: '已发货', completed: '已完成',
};
const SOURCE_TABS = [
  { key: 'ALL', label: '全部' },
  { key: 'MANUAL', label: '手动创建' },
  { key: 'PLATFORM', label: '平台同步' },
];

export function MerchantOutboundPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<any[]>([]);
  const [sourceTab, setSourceTab] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    (async () => {
      const { merchantId } = await getAuthContext();
      if (!merchantId) { setLoading(false); return; }
      const { data, error } = await supabase
        .from('tlv_outbound_orders').select('*').eq('merchant_id', merchantId)
        .order('created_at', { ascending: false });
      if (error) console.error(error);
      setRows(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  const filtered = rows.filter((r) => {
    if (sourceTab === 'MANUAL' && (r.source || r.platform || '').toUpperCase() !== 'MANUAL') return false;
    if (sourceTab === 'PLATFORM' && (r.source || r.platform || '').toUpperCase() === 'MANUAL') return false;
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    return true;
  });

  const STATUSES = ['ALL', 'pending', 'picking', 'packing', 'weighed', 'shipped', 'completed'];

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
            {SOURCE_TABS.map((t) => (
              <button key={t.key} onClick={() => setSourceTab(t.key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition ${sourceTab === t.key ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 text-xs rounded-full border ${statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'}`}>
                {s === 'ALL' ? '全部状态' : (STATUS_LABEL[s] || s)}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => navigate({ to: '/merchant/orders/new' })}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium shrink-0">
          <Plus className="w-4 h-4" /> 创建出库单
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">暂无出库单</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-slate-50 text-slate-500 text-xs">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">订单号</th>
                  <th className="text-left px-5 py-3 font-medium">平台</th>
                  <th className="text-left px-5 py-3 font-medium">收件人</th>
                  <th className="text-left px-5 py-3 font-medium">状态</th>
                  <th className="text-right px-5 py-3 font-medium">重量(kg)</th>
                  <th className="text-right px-5 py-3 font-medium">费用</th>
                  <th className="text-center px-5 py-3 font-medium">COD</th>
                  <th className="text-left px-5 py-3 font-medium">物流单号</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono font-medium text-slate-800">{r.order_no || r.id}</td>
                    <td className="px-5 py-3 text-slate-600">{r.platform || '-'}</td>
                    <td className="px-5 py-3 text-slate-700">{r.receiver_name || '-'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[r.status || 'pending'] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABEL[r.status || 'pending'] || r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.weight_kg ?? '-'}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-blue-700">¥{(r.total_charge ?? 0).toFixed(2)}</td>
                    <td className="px-5 py-3 text-center">
                      {r.is_cod ? <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded">是</span> : <span className="text-xs text-slate-400">-</span>}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{r.tracking_no || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
