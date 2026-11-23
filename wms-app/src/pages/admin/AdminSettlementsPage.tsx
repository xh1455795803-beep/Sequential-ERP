import { useEffect, useMemo, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { CheckCircle, ArrowRight, ShieldAlert } from 'lucide-react';

const BADGE: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-600',
  confirmed: 'bg-indigo-50 text-indigo-600',
  paid: 'bg-emerald-50 text-emerald-600',
};

export function AdminSettlementsPage() {
  const [ok, setOk] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');

  useEffect(() => { (async () => {
    const { portalRole } = await getAuthContext();
    if (portalRole !== 'admin') { setOk(false); return; }
    setOk(true);
    await load();
  })(); }, []);

  async function load() {
    setLoading(true);
    // 管理员无过滤 —— 查看所有仓库结算
    const { data, error } = await supabase
      .from('tlv_warehouse_settlements')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error) setRows(data || []);
    setLoading(false);
  }

  async function markStatus(id: string, status: string) {
    await supabase.from('tlv_warehouse_settlements').update({ status }).eq('id', id);
    await load();
  }

  const filtered = useMemo(() => tab === 'all' ? rows : rows.filter((s: any) => s.status === tab), [rows, tab]);

  const summary = useMemo(() => rows.reduce((acc: any, s: any) => {
    const k = s.status || 'pending';
    acc[k] = (acc[k] || 0) + (Number(s.net_amount) || 0);
    return acc;
  }, {}), [rows]);

  if (!ok) return <div className="p-12 text-center text-red-500 flex items-center justify-center gap-2"><ShieldAlert className="w-5 h-5" /> 需要管理员权限</div>;

  const fmtPeriod = (s: any) => {
    if (!s.period_start || !s.period_end) return '-';
    return `${new Date(s.period_start).toLocaleDateString('zh-CN')} ~ ${new Date(s.period_end).toLocaleDateString('zh-CN')}`;
  };

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">仓库结算</h2>
        <p className="text-sm text-slate-500 mt-1">确认 / 支付各仓库结算单</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <div className="text-xs text-slate-500 mb-1">待确认</div>
          <div className="text-xl font-bold text-amber-600 tabular-nums">¥ {(summary.pending || 0).toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <div className="text-xs text-slate-500 mb-1">已确认待付</div>
          <div className="text-xl font-bold text-indigo-600 tabular-nums">¥ {(summary.confirmed || 0).toFixed(2)}</div>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
          <div className="text-xs text-slate-500 mb-1">已支付</div>
          <div className="text-xl font-bold text-emerald-600 tabular-nums">¥ {(summary.paid || 0).toFixed(2)}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3 flex gap-1">
        {(['all', 'pending', 'confirmed', 'paid'] as const).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`py-1.5 px-3 rounded-md text-sm transition ${tab === k ? 'bg-[#8b5cf6] text-white shadow' : 'text-slate-500 hover:text-slate-700'}`}>
            {{ all: '全部', pending: '待确认', confirmed: '已确认', paid: '已支付' }[k]}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? <div className="p-10 text-center text-slate-400">加载中...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">仓库</th>
                <th className="text-left px-4 py-2.5">周期</th>
                <th className="text-right px-4 py-2.5">金额</th>
                <th className="text-center px-4 py-2.5">状态</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: any) => (
                <tr key={s.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">-</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtPeriod(s)}</td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-800">¥ {Number(s.net_amount || 0).toFixed(2)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${BADGE[s.status] || 'bg-slate-100 text-slate-500'}`}>
                      {(s.status || '').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {s.status === 'pending' && (
                      <button onClick={() => markStatus(s.id, 'confirmed')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-indigo-50 text-indigo-600 hover:bg-indigo-100">
                        <CheckCircle className="w-3 h-3" /> 确认
                      </button>
                    )}
                    {s.status === 'confirmed' && (
                      <button onClick={() => markStatus(s.id, 'paid')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-emerald-50 text-emerald-600 hover:bg-emerald-100">
                        <ArrowRight className="w-3 h-3" /> 标记已付
                      </button>
                    )}
                    {s.status === 'paid' && <span className="text-xs text-slate-400">已结清</span>}
                  </td>
                </tr>
              ))}
              {!filtered.length && <tr><td colSpan={5} className="p-10 text-center text-slate-400">暂无结算记录</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
