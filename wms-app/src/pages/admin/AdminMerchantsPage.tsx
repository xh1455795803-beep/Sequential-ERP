import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { Plus, Check, Eye, Ban, Unlock, Search, Filter } from 'lucide-react';

// 种子商家数据
const SEED_MERCHANTS = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    name: '深圳市蓝海电商有限公司',
    contact_name: '陈明',
    contact_email: 'chenming@bluesea.com',
    plan: '专业版',
    balance: 328.50,
    warehouse_ids: ['00000000-0000-0000-0000-000000000001'],
    status: 'active',
    registered_at: '2026-10-15',
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    name: '广州星驰科技贸易',
    contact_name: 'Lily Wong',
    contact_email: 'lily@xingchi.com',
    plan: '企业版',
    balance: 1280.00,
    warehouse_ids: ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'],
    status: 'active',
    registered_at: '2026-09-02',
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    name: '义乌优品供应链',
    contact_name: '王海',
    contact_email: 'wanghai@youpin.com',
    plan: '试用版',
    balance: 0.00,
    warehouse_ids: [],
    status: 'pending',
    registered_at: '2026-11-20',
  },
];

const TABS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'active', label: '活跃' },
  { key: 'frozen', label: '已冻结' },
] as const;
type TabKey = typeof TABS[number]['key'];

export function AdminMerchantsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('all');
  const [keyword, setKeyword] = useState('');

  // 尝试从 supabase 获取，失败则回退到 seed 数据
  const { data, isLoading } = useQuery({
    queryKey: ['admin-merchants'],
    queryFn: async () => {
      try {
        const { data: db, error } = await supabase.from('merchants').select('*');
        if (error || !db || db.length === 0) throw new Error('empty');
        return db as any[];
      } catch {
        return SEED_MERCHANTS as any[];
      }
    },
  });

  const approveMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('merchants').update({ status: 'active' }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-merchants'] }),
  });

  const freezeMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('merchants').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-merchants'] }),
  });

  const filtered = useMemo(() => {
    let list = data || [];
    if (tab !== 'all') list = list.filter((m: any) => m.status === tab);
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase();
      list = list.filter((m: any) =>
        (m.name || '').toLowerCase().includes(kw) ||
        (m.contact_name || '').toLowerCase().includes(kw) ||
        (m.contact_email || '').toLowerCase().includes(kw)
      );
    }
    return list;
  }, [data, tab, keyword]);

  // Tab counts
  const counts = useMemo(() => {
    const list = data || [];
    return {
      all: list.length,
      pending: list.filter((m: any) => m.status === 'pending').length,
      active: list.filter((m: any) => m.status === 'active').length,
      frozen: list.filter((m: any) => m.status === 'frozen').length,
    };
  }, [data]);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">商家管理</h2>
          <p className="text-sm text-slate-500 mt-1">审核、冻结平台入驻商家</p>
        </div>
        <button className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-lg text-sm shadow-sm">
          <Plus className="w-4 h-4" /> 新增商家
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-1">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex gap-1 bg-slate-50 rounded-lg p-1">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-1 py-1.5 px-3 rounded-md text-sm transition ${
                    active ? 'bg-white shadow text-purple-700 font-medium' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label}
                  <span className="ml-1 text-xs text-slate-400">({counts[t.key]})</span>
                </button>
              );
            })}
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索商家名称 / 联系人"
              className="pl-8 pr-3 py-1.5 w-56 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-slate-400">加载中...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">商家名称</th>
                <th className="text-left px-4 py-2.5">联系人</th>
                <th className="text-left px-4 py-2.5">套餐</th>
                <th className="text-right px-4 py-2.5">余额</th>
                <th className="text-left px-4 py-2.5">合作仓库</th>
                <th className="text-center px-4 py-2.5">状态</th>
                <th className="text-left px-4 py-2.5">注册时间</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m: any) => (
                <tr key={m.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-700">{m.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono truncate max-w-[180px]">{m.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-600">{m.contact_name || '-'}</div>
                    <div className="text-[11px] text-slate-400">{m.contact_email || '-'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${planBadge(m.plan)}`}>{m.plan}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-600">
                    ¥ {Number(m.balance || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {m.warehouse_ids?.length ? `${m.warehouse_ids.length} 个` : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(m.status)}`}>{statusLabel(m.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 tabular-nums text-xs">{m.registered_at || '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {m.status === 'pending' && (
                        <button
                          onClick={() => approveMut.mutate(m.id)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                        >
                          <Check className="w-3 h-3" /> 审核通过
                        </button>
                      )}
                      <button
                        className="flex items-center gap-1 px-2 py-1 rounded text-xs text-purple-600 hover:bg-purple-50"
                        onClick={() => alert(`查看详情: ${m.name}`)}
                      >
                        <Eye className="w-3 h-3" /> 详情
                      </button>
                      {m.status === 'active' && (
                        <button
                          onClick={() => { if (confirm(`冻结 ${m.name}？`)) freezeMut.mutate({ id: m.id, status: 'frozen' }); }}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-red-600 hover:bg-red-50"
                        >
                          <Ban className="w-3 h-3" /> 冻结
                        </button>
                      )}
                      {m.status === 'frozen' && (
                        <button
                          onClick={() => freezeMut.mutate({ id: m.id, status: 'active' })}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs text-emerald-600 hover:bg-emerald-50"
                        >
                          <Unlock className="w-3 h-3" /> 解冻
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={8} className="p-10 text-center text-slate-400">暂无符合条件的商家</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function statusLabel(s: string) {
  return ({ pending: '待审核', active: '活跃', frozen: '已冻结' } as any)[s] || s;
}
function statusBadge(s: string) {
  return ({
    pending: 'bg-amber-50 text-amber-600',
    active: 'bg-green-50 text-green-600',
    frozen: 'bg-red-50 text-red-600',
  } as any)[s] || 'bg-slate-100 text-slate-500';
}
function planBadge(p: string) {
  return ({
    '专业版': 'bg-purple-50 text-purple-600',
    '企业版': 'bg-indigo-50 text-indigo-600',
    '试用版': 'bg-slate-100 text-slate-500',
  } as any)[p] || 'bg-slate-100 text-slate-500';
}
