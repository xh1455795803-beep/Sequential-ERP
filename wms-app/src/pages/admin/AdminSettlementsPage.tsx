import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Wallet, CheckCircle, DollarSign, ArrowRight } from 'lucide-react';

async function fetchSettlements() {
  const { data, error } = await supabase.from('tlv_warehouse_settlements').select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: 'PENDING' },
  { key: 'confirmed', label: 'CONFIRMED' },
  { key: 'paid', label: 'PAID' },
] as const;

const badge: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  confirmed: 'bg-indigo-50 text-indigo-600',
  paid: 'bg-emerald-50 text-emerald-600',
};

export function AdminSettlementsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({ queryKey: ['admin-settlements'], queryFn: fetchSettlements });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('tlv_warehouse_settlements').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-settlements'] }),
  });

  const filtered = (data || []).filter((s: any) => filter === 'all' || s.status === filter);

  const summary = (data || []).reduce(
    (acc: any, s: any) => {
      if (s.status === 'pending') acc.pending += Number(s.amount) || 0;
      if (s.status === 'confirmed') acc.confirmed += Number(s.amount) || 0;
      if (s.status === 'paid') acc.paid += Number(s.amount) || 0;
      return acc;
    },
    { pending: 0, confirmed: 0, paid: 0 },
  );

  const fmtPeriod = (s: any) => {
    if (!s.period_start || !s.period_end) return '-';
    return `${new Date(s.period_start).toLocaleDateString('zh-CN')} ~ ${new Date(s.period_end).toLocaleDateString('zh-CN')}`;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Wallet className="w-6 h-6 text-[#8b5cf6]" /> 仓库结算
          </h2>
          <p className="text-sm text-slate-500 mt-1">按周期确认并支付各仓库结算单</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <div className="text-xs text-slate-500 mb-2">待确认</div>
          <div className="text-xl font-bold text-amber-600 tabular-nums">¥ {summary.pending.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <div className="text-xs text-slate-500 mb-2">已确认待付</div>
          <div className="text-xl font-bold text-indigo-600 tabular-nums">¥ {summary.confirmed.toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <div className="text-xs text-slate-500 mb-2">本月已付</div>
          <div className="text-xl font-bold text-emerald-600 tabular-nums">¥ {summary.paid.toFixed(2)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-1">
        <div className="flex gap-1 bg-slate-50 rounded-lg p-1 w-fit">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`py-1.5 px-4 rounded-md text-sm transition ${filter === f.key ? 'bg-white shadow text-[#8b5cf6] font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading ? <div className="p-10 text-center text-slate-400">加载中...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">仓库</th>
                <th className="text-left px-4 py-2.5">商户</th>
                <th className="text-left px-4 py-2.5">类型</th>
                <th className="text-left px-4 py-2.5">周期</th>
                <th className="text-right px-4 py-2.5">金额</th>
                <th className="text-center px-4 py-2.5">状态</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: any) => (
                <tr key={s.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">{s.warehouse_name || '-'}</td>
                  <td className="px-4 py-3 text-slate-600">{s.merchant_name || '-'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded bg-purple-50 text-[#8b5cf6] text-xs font-medium">
                      {s.settlement_type || 'standard'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtPeriod(s)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800">
                    ¥ {Number(s.amount).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge[s.status] || 'bg-slate-100 text-slate-500'}`}>
                      {s.status?.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {s.status === 'pending' && (
                        <button onClick={() => updateStatus.mutate({ id: s.id, status: 'confirmed' })}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100">
                          <CheckCircle className="w-3 h-3" /> 确认
                        </button>
                      )}
                      {s.status === 'confirmed' && (
                        <button onClick={() => updateStatus.mutate({ id: s.id, status: 'paid' })}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100">
                          <ArrowRight className="w-3 h-3" /> 标记已付
                        </button>
                      )}
                      {s.status === 'paid' && <span className="text-xs text-slate-400">已结清</span>}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={7} className="p-10 text-center text-slate-400">暂无结算记录</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
