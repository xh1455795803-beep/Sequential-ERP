import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { Plus, Loader2 } from 'lucide-react';

const MERCHANT_ID = '00000000-0000-0000-0000-000000000101';

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  RECEIVED: 'bg-green-100 text-green-700',
  INSPECTING: 'bg-amber-100 text-amber-700',
  STOCKING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: '待处理', RECEIVED: '已收货', INSPECTING: '质检中',
  STOCKING: '上架中', COMPLETED: '已完成',
};

export function MerchantInboundPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('ALL');

  useEffect(() => {
    let q = supabase.from('tlv_inbound_orders').select('*').eq('merchant_id', MERCHANT_ID).order('created_at', { ascending: false });
    if (status !== 'ALL') q = q.eq('status', status);
    q.then(({ data, error }) => { if (!error) setRows(data || []); setLoading(false); });
  }, [status]);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {['ALL', 'PENDING', 'RECEIVED', 'INSPECTING', 'STOCKING', 'COMPLETED'].map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 text-xs rounded-full border ${status === s ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'}`}>
              {s === 'ALL' ? '全部' : (STATUS_LABEL[s] || s)}
            </button>
          ))}
        </div>
        <button onClick={() => navigate({ to: '/merchant/inbound/new' })}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" /> 创建入库单
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">暂无入库单</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">入库单号</th>
                <th className="text-left px-5 py-3 font-medium">创建时间</th>
                <th className="text-left px-5 py-3 font-medium">仓库</th>
                <th className="text-left px-5 py-3 font-medium">状态</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono font-medium text-slate-800">{r.id}</td>
                  <td className="px-5 py-3 text-slate-600">{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-5 py-3 text-slate-600">{r.warehouse || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[(r.status || '').toUpperCase()] || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABEL[(r.status || '').toUpperCase()] || r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
