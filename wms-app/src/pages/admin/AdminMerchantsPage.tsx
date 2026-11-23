import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Check, Ban, Pencil, Search, Plus, X } from 'lucide-react';

async function fetchMerchants() {
  const { data, error } = await supabase.from('tlv_merchants').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

const TABS = [
  { key: 'all', label: '全部' }, { key: 'pending', label: '待审核' },
  { key: 'active', label: '活跃' }, { key: 'suspended', label: '已暂停' },
] as const;

const LABEL: Record<string, string> = { pending: 'PENDING', active: 'ACTIVE', suspended: 'SUSPENDED' };
const BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  active: 'bg-green-50 text-green-600',
  suspended: 'bg-red-50 text-red-600',
};

export function AdminMerchantsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>('all');
  const [kw, setKw] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [balanceInput, setBalanceInput] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['admin-merchants'], queryFn: fetchMerchants });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('tlv_merchants').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-merchants'] }),
  });

  const updateBalance = useMutation({
    mutationFn: async ({ id, balance }: { id: string; balance: number }) => {
      const { error } = await supabase.from('tlv_merchants').update({ balance }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-merchants'] }); setEditing(null); },
  });

  const filtered = useMemo(() => {
    let list = data || [];
    if (tab !== 'all') list = list.filter((m: any) => m.status === tab);
    if (kw.trim()) {
      const lower = kw.toLowerCase();
      list = list.filter((m: any) =>
        (m.name || '').toLowerCase().includes(lower) || (m.contact_email || '').toLowerCase().includes(lower),
      );
    }
    return list;
  }, [data, tab, kw]);

  const counts = useMemo(() => {
    const list = data || [];
    return {
      all: list.length,
      pending: list.filter((m: any) => m.status === 'pending').length,
      active: list.filter((m: any) => m.status === 'active').length,
      suspended: list.filter((m: any) => m.status === 'suspended').length,
    };
  }, [data]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">商家管理</h2>
          <p className="text-sm text-slate-500 mt-1">审核 · 暂停 · 余额调整</p>
        </div>
        <button className="flex items-center gap-1.5 px-4 py-2 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-lg text-sm shadow-sm">
          <Plus className="w-4 h-4" /> 新增商家
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex items-center gap-3">
        <div className="flex gap-1 bg-slate-50 rounded-lg p-1">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`py-1.5 px-3 rounded-md text-sm transition ${tab === t.key ? 'bg-white shadow text-[#8b5cf6] font-medium' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.label} ({counts[t.key as keyof typeof counts]})
            </button>
          ))}
        </div>
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="搜索名称 / 邮箱"
            className="pl-8 pr-3 py-1.5 w-60 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]" />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading ? <div className="p-10 text-center text-slate-400">加载中...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">商家名称</th>
                <th className="text-left px-4 py-2.5">联系方式</th>
                <th className="text-center px-4 py-2.5">状态</th>
                <th className="text-left px-4 py-2.5">套餐</th>
                <th className="text-right px-4 py-2.5">余额</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m: any) => (
                <tr key={m.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">{m.name}</td>
                  <td className="px-4 py-3">
                    <div className="text-slate-600">{m.contact_name || '-'}</div>
                    <div className="text-[11px] text-slate-400">{m.contact_email || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${BADGE[m.status] || 'bg-slate-100 text-slate-500'}`}>
                      {LABEL[m.status] || m.status?.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{m.plan || '-'}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-600">¥{(m.balance || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {m.status === 'pending' && (
                        <button onClick={() => updateStatus.mutate({ id: m.id, status: 'active' })}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100">
                          <Check className="w-3 h-3" /> 审核
                        </button>
                      )}
                      {m.status !== 'suspended' ? (
                        <button onClick={() => updateStatus.mutate({ id: m.id, status: 'suspended' })}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-600 hover:bg-red-50">
                          <Ban className="w-3 h-3" /> 暂停
                        </button>
                      ) : (
                        <button onClick={() => updateStatus.mutate({ id: m.id, status: 'active' })}
                          className="px-2 py-1 rounded text-xs text-emerald-600 hover:bg-emerald-50">恢复</button>
                      )}
                      <button onClick={() => { setEditing(m); setBalanceInput(String(m.balance || 0)); }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[#8b5cf6] hover:bg-purple-50">
                        <Pencil className="w-3 h-3" /> 余额
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">暂无数据</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-xl p-5 w-72 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-800">调整余额</h3>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="text-xs text-slate-500 mb-2">{editing.name}</div>
            <input type="number" step="0.01" value={balanceInput} onChange={(e) => setBalanceInput(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]" />
            <button onClick={() => updateBalance.mutate({ id: editing.id, balance: Number(balanceInput) || 0 })}
              className="w-full py-2 bg-[#8b5cf6] text-white rounded-lg text-sm hover:bg-[#7c3aed]">保存</button>
          </div>
        </div>
      )}
    </div>
  );
}
