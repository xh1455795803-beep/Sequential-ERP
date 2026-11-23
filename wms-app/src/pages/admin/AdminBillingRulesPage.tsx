import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Plus, Check, X, DollarSign, Settings } from 'lucide-react';

async function fetchRules() {
  const { data, error } = await supabase.from('tlv_billing_rules').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export function AdminBillingRulesPage() {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newRule, setNewRule] = useState({ rule_name: '', charge_type: 'per_order', unit: 'CNY', rate: '', condition: '' });

  const { data, isLoading } = useQuery({ queryKey: ['admin-rules'], queryFn: fetchRules });

  const updateRate = useMutation({
    mutationFn: async ({ id, rate }: { id: string; rate: number }) => {
      const { error } = await supabase.from('tlv_billing_rules').update({ rate }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-rules'] }); setEditingId(null); },
  });

  const addRule = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('tlv_billing_rules').insert({
        rule_name: newRule.rule_name, charge_type: newRule.charge_type,
        unit: newRule.unit, rate: Number(newRule.rate) || 0, condition: newRule.condition || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-rules'] }); setShowAdd(false);
      setNewRule({ rule_name: '', charge_type: 'per_order', unit: 'CNY', rate: '', condition: '' });
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <DollarSign className="w-6 h-6 text-[#8b5cf6]" /> 计费规则
          </h2>
          <p className="text-sm text-slate-500 mt-1">各仓库计费费率管理，merchant_id=NULL 为默认规则</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-[#8b5cf6] hover:bg-[#7c3aed] text-white rounded-lg text-sm shadow-sm">
          <Plus className="w-4 h-4" /> 新增规则
        </button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Settings className="w-4 h-4 text-[#8b5cf6]" />
            <h3 className="font-semibold text-slate-700">添加新计费规则</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <input placeholder="规则名" value={newRule.rule_name}
              onChange={(e) => setNewRule({ ...newRule, rule_name: e.target.value })}
              className="px-3 py-1.5 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-[#8b5cf6]" />
            <select value={newRule.charge_type} onChange={(e) => setNewRule({ ...newRule, charge_type: e.target.value })}
              className="px-3 py-1.5 border border-slate-200 rounded text-sm">
              <option value="per_order">per_order</option>
              <option value="per_weight">per_weight</option>
              <option value="per_volume">per_volume</option>
              <option value="flat">flat</option>
            </select>
            <input placeholder="单位" value={newRule.unit}
              onChange={(e) => setNewRule({ ...newRule, unit: e.target.value })}
              className="px-3 py-1.5 border border-slate-200 rounded text-sm" />
            <input type="number" step="0.01" placeholder="费率" value={newRule.rate}
              onChange={(e) => setNewRule({ ...newRule, rate: e.target.value })}
              className="px-3 py-1.5 border border-slate-200 rounded text-sm" />
            <input placeholder="条件（可选）" value={newRule.condition}
              onChange={(e) => setNewRule({ ...newRule, condition: e.target.value })}
              className="px-3 py-1.5 border border-slate-200 rounded text-sm" />
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setShowAdd(false)} className="px-4 py-1.5 text-sm text-slate-600 border border-slate-200 rounded hover:bg-slate-50">取消</button>
            <button onClick={() => addRule.mutate()} className="px-4 py-1.5 text-sm bg-[#8b5cf6] text-white rounded hover:bg-[#7c3aed]">保存</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading ? <div className="p-10 text-center text-slate-400">加载中...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">规则名</th>
                <th className="text-left px-4 py-2.5">计费类型</th>
                <th className="text-left px-4 py-2.5">单位</th>
                <th className="text-right px-4 py-2.5">费率</th>
                <th className="text-left px-4 py-2.5">条件</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((r: any) => (
                <tr key={r.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">{r.rule_name}</td>
                  <td className="px-4 py-3 text-xs font-mono text-indigo-600">{r.charge_type}</td>
                  <td className="px-4 py-3 text-slate-600">{r.unit}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">
                    {editingId === r.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input type="number" step="0.001" value={editRate} onChange={(e) => setEditRate(e.target.value)}
                          className="w-20 px-2 py-0.5 border border-slate-200 rounded text-right" />
                        <button onClick={() => updateRate.mutate({ id: r.id, rate: Number(editRate) || 0 })}
                          className="p-1 text-emerald-600"><Check className="w-3 h-3" /></button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-slate-400"><X className="w-3 h-3" /></button>
                      </div>
                    ) : `¥ ${Number(r.rate).toFixed(3)}`}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[200px] truncate">{r.condition || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    {editingId !== r.id && (
                      <button onClick={() => { setEditingId(r.id); setEditRate(String(r.rate)); }}
                        className="text-xs text-[#8b5cf6] hover:underline">编辑费率</button>
                    )}
                  </td>
                </tr>
              ))}
              {!data?.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">暂无计费规则</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
