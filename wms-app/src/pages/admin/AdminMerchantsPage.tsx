import { useEffect, useMemo, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Check, Ban, ShieldAlert } from 'lucide-react';

const BADGE: Record<string, string> = {
  active: 'bg-green-50 text-green-600',
  pending: 'bg-amber-50 text-amber-600',
  suspended: 'bg-red-50 text-red-600',
};

export function AdminMerchantsPage() {
  const [ok, setOk] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [tab, setTab] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { (async () => {
    const { portalRole } = await getAuthContext();
    if (portalRole !== 'admin') { setOk(false); return; }
    setOk(true);
    await load();
  })(); }, []);

  async function load() {
    setLoading(true);
    // 管理员无过滤 —— 查看所有商家 + JOIN 仓库名
    const { data, error } = await supabase
      .from('tlv_merchants')
      .select('id, business_name, contact_name, contact_email, status, balance, warehouse_id, created_at, tlv_warehouses(name)')
      .order('created_at', { ascending: false });
    if (!error) setRows(data || []);
    setLoading(false);
  }

  async function setStatus(id: string, status: string) {
    await supabase.from('tlv_merchants').update({ status }).eq('id', id);
    await load();
  }

  const filtered = useMemo(() => tab === 'all' ? rows : rows.filter((m: any) => m.status === tab), [rows, tab]);
  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter((m: any) => m.status === 'pending').length,
    active: rows.filter((m: any) => m.status === 'active').length,
    suspended: rows.filter((m: any) => m.status === 'suspended').length,
  }), [rows]);

  if (!ok) return <div className="p-12 text-center text-red-500 flex items-center justify-center gap-2"><ShieldAlert className="w-5 h-5" /> 需要管理员权限</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">商家管理</h2>
        <p className="text-sm text-slate-500 mt-1">平台所有商家 · 审核 / 暂停</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3 flex gap-1">
        {(['all', 'pending', 'active', 'suspended'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`py-1.5 px-3 rounded-md text-sm transition ${tab === k ? 'bg-[#8b5cf6] text-white shadow' : 'text-slate-500 hover:text-slate-700'}`}>
            {{ all: '全部', pending: '待审核', active: '活跃', suspended: '已暂停' }[k]} ({counts[k]})
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? <div className="p-10 text-center text-slate-400">加载中...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">商家</th>
                <th className="text-left px-4 py-2.5">绑定仓库</th>
                <th className="text-left px-4 py-2.5">联系方式</th>
                <th className="text-center px-4 py-2.5">状态</th>
                <th className="text-right px-4 py-2.5">余额</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m: any) => (
                <tr key={m.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">{m.business_name}</td>
                  <td className="px-4 py-3 text-xs text-indigo-600">
                    {m.tlv_warehouses?.name || '未绑定'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-600">{m.contact_name || '-'}</div>
                    <div className="text-[11px] text-slate-400">{m.contact_email || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${BADGE[m.status] || 'bg-slate-100 text-slate-500'}`}>
                      {(m.status || '').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-emerald-600">
                    ¥{(m.balance || 0).toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {m.status === 'pending' && (
                      <button onClick={() => setStatus(m.id, 'active')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100">
                        <Check className="w-3 h-3" /> 审核
                      </button>
                    )}
                    {m.status !== 'suspended' && (
                      <button onClick={() => setStatus(m.id, 'suspended')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-red-600 hover:bg-red-50">
                        <Ban className="w-3 h-3" /> 暂停
                      </button>
                    )}
                    {m.status === 'suspended' && (
                      <button onClick={() => setStatus(m.id, 'active')}
                        className="px-2 py-1 rounded text-xs text-emerald-600 hover:bg-emerald-50">恢复</button>
                    )}
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">暂无数据</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
