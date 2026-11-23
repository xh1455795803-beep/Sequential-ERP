import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Building2, Key, ToggleLeft, ToggleRight, Eye, Copy, Check } from 'lucide-react';

async function fetchWarehouses() {
  const { data, error } = await supabase.from('tlv_warehouses').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

const badge: Record<string, string> = {
  active: 'bg-green-50 text-green-600',
  suspended: 'bg-red-50 text-red-600',
  testing: 'bg-amber-50 text-amber-600',
};

export function AdminWarehousesPage() {
  const qc = useQueryClient();
  const [showKey, setShowKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['admin-warehouses'], queryFn: fetchWarehouses });

  const toggleStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('tlv_warehouses').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-warehouses'] }),
  });

  const copyKey = async (key: string) => {
    await navigator.clipboard?.writeText(key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">仓库管理</h2>
          <p className="text-sm text-slate-500 mt-1">所有接入 Thalvior 平台的仓库节点</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading ? <div className="p-10 text-center text-slate-400">加载中...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">仓库名称</th>
                <th className="text-left px-4 py-2.5">编码</th>
                <th className="text-left px-4 py-2.5">国家</th>
                <th className="text-left px-4 py-2.5">联系方式</th>
                <th className="text-center px-4 py-2.5">状态</th>
                <th className="text-left px-4 py-2.5">计费模式</th>
                <th className="text-left px-4 py-2.5">API Key</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((w: any) => (
                <>
                  <tr key={w.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-[#8b5cf6]" />
                        <span className="font-medium text-slate-700">{w.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-600">{w.code}</td>
                    <td className="px-4 py-3 text-slate-600">{w.country || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="text-slate-600">{w.contact_name || '-'}</div>
                      <div className="text-[11px] text-slate-400">{w.contact_email || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge[w.status] || 'bg-slate-100 text-slate-500'}`}>
                        {w.status?.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 text-xs">
                        {w.billing_mode || 'per_order'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => setShowKey(showKey === w.id ? null : w.id)}
                        className="flex items-center gap-1 text-xs text-[#8b5cf6] hover:underline">
                        <Eye className="w-3 h-3" />
                        {showKey === w.id ? '隐藏' : '查看'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleStatus.mutate({ id: w.id, status: w.status === 'active' ? 'suspended' : 'active' })}
                        className="flex items-center justify-end gap-1 text-xs text-slate-600 hover:text-[#8b5cf6]">
                        {w.status === 'active' ? (
                          <><ToggleRight className="w-5 h-5 text-green-500" /> 运行中</>
                        ) : (
                          <><ToggleLeft className="w-5 h-5 text-slate-400" /> 已停用</>
                        )}
                      </button>
                    </td>
                  </tr>
                  {showKey === w.id && w.api_key && (
                    <tr className="bg-purple-50/50">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Key className="w-4 h-4 text-[#8b5cf6]" />
                          <code className="flex-1 text-xs font-mono bg-white px-3 py-1.5 rounded border border-slate-200 break-all">
                            {w.api_key}
                          </code>
                          <button onClick={() => copyKey(w.api_key)}
                            className="flex items-center gap-1 px-3 py-1 rounded bg-[#8b5cf6] text-white text-xs hover:bg-[#7c3aed]">
                            {copied ? <><Check className="w-3 h-3" /> 已复制</> : <><Copy className="w-3 h-3" /> 复制</>}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!data?.length && <tr><td colSpan={8} className="p-10 text-center text-slate-400">暂无仓库数据</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
