import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { Plus, Loader2 } from 'lucide-react';

const MERCHANT_ID = '00000000-0000-0000-0000-000000000101';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  CONFIRMED: 'bg-blue-100 text-blue-700',
  PICKING: 'bg-indigo-100 text-indigo-700',
  PACKING: 'bg-purple-100 text-purple-700',
  WEIGHED: 'bg-amber-100 text-amber-700',
  SHIPPED: 'bg-teal-100 text-teal-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
};
const STATUS_LABEL: Record<string, string> = {
  PENDING: '待处理', CONFIRMED: '已确认', PICKING: '拣货中',
  PACKING: '打包中', WEIGHED: '已称重', SHIPPED: '已发货', COMPLETED: '已完成',
};

export function MerchantOutboundPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    let q = supabase.from('tlv_outbound_orders').select('*').eq('merchant_id', MERCHANT_ID).order('created_at', { ascending: false });
    if (filter !== 'ALL') q = q.eq('status', filter);
    q.then(({ data, error }) => { if (!error) setRows(data || []); setLoading(false); });
  }, [filter]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex flex-wrap gap-2">
          {['ALL', 'PENDING', 'CONFIRMED', 'PICKING', 'PACKING', 'WEIGHED', 'SHIPPED', 'COMPLETED'].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-full border ${filter === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'}`}>
              {s === 'ALL' ? '全部' : (STATUS_LABEL[s] || s)}
            </button>
          ))}
        </div>
        <button onClick={() => navigate({ to: '/merchant/orders/new' })}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" /> 创建出库单
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...</div>
        ) : rows.length === 0 ? (
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
                {rows.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-mono font-medium text-slate-800">{r.id}</td>
                    <td className="px-5 py-3 text-slate-600">{r.platform || '-'}</td>
                    <td className="px-5 py-3 text-slate-700">{r.recipient_name || r.recipient || '-'}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[(r.status || '').toUpperCase()] || 'bg-slate-100 text-slate-600'}`}>
                        {STATUS_LABEL[(r.status || '').toUpperCase()] || r.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{r.weight_kg ?? '-'}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-blue-700">¥{(r.fee ?? 0).toFixed(2)}</td>
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
