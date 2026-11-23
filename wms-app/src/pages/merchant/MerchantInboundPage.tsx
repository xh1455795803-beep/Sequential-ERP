import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Plus } from 'lucide-react';

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-600',
  received: 'bg-green-100 text-green-700',
  inspecting: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
};
const STATUS_LABEL: Record<string, string> = {
  pending: '待处理', received: '已收货', inspecting: '质检中',
  completed: '已完成',
};
const STATUSES = ['ALL', 'pending', 'received', 'inspecting', 'completed'];

export async function MerchantInboundPage() {
  const { merchantId } = await getAuthContext();
  if (!merchantId) return <div>未登录</div>;
  const { data, error } = await supabase
    .from('tlv_inbound_orders').select('*').eq('merchant_id', merchantId)
    .order('created_at', { ascending: false });
  if (error) console.error(error);
  return <InboundView rows={data || []} />;
}

function InboundView({ rows }: { rows: any[] }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState('ALL');
  const filtered = status === 'ALL' ? rows : rows.filter((r) => r.status === status);

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {STATUSES.map((s) => (
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
        {filtered.length === 0 ? (
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
              {filtered.map((r: any) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono font-medium text-slate-800">{r.inbound_no || r.id}</td>
                  <td className="px-5 py-3 text-slate-600">{r.created_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-5 py-3 text-slate-600">{r.warehouse || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[r.status || 'pending'] || 'bg-slate-100 text-slate-600'}`}>
                      {STATUS_LABEL[r.status || 'pending'] || r.status}
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
