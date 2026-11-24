import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Check, X, ShieldAlert } from 'lucide-react';

export function AdminBillingRulesPage() {
  const [ok, setOk] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');

  useEffect(() => { (async () => {
    const { portalRole } = await getAuthContext();
    if (portalRole !== 'admin') { setOk(false); return; }
    setOk(true);
    await load();
  })(); }, []);

  async function load() {
    setLoading(true);
    // 管理员无过滤 —— 查看所有规则（merchant_id IS NULL = 默认规则，NOT NULL = 商家自定义）
    const { data, error } = await supabase
      .from('tlv_billing_rules')
      .select('*, merchant:tlv_merchants(business_name)')
      .order('created_at', { ascending: false });
    if (!error) setRows(data || []);
    setLoading(false);
  }

  async function saveRate() {
    if (!editId) return;
    await supabase.from('tlv_billing_rules').update({ rate: Number(editVal) || 0 }).eq('id', editId);
    setEditId(null);
    await load();
  }

  if (!ok) return <div className="p-12 text-center text-red-500 flex items-center justify-center gap-2"><ShieldAlert className="w-5 h-5" /> 需要管理员权限</div>;

  return (
    <div className="p-6 space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">计费规则</h2>
        <p className="text-sm text-slate-500 mt-1">默认规则（merchant_id=NULL）与商家自定义规则</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? <div className="p-10 text-center text-slate-400">加载中...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2.5">规则名</th>
                <th className="text-left px-4 py-2.5">适用范围</th>
                <th className="text-left px-4 py-2.5">计费类型</th>
                <th className="text-left px-4 py-2.5">单位</th>
                <th className="text-right px-4 py-2.5">费率</th>
                <th className="text-right px-4 py-2.5">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-slate-50 hover:bg-slate-50/50">
                  <td className="px-4 py-3 font-medium text-slate-700">{r.rule_name}</td>
                  <td className="px-4 py-3">
                    {r.merchant_id === null ? (
                      <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 text-xs font-medium">默认 · 全平台</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-600 text-xs font-medium">
                        自定义 · {r.merchant?.business_name || r.merchant_id?.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-indigo-600">{r.rule_type}</td>
                  <td className="px-4 py-3 text-slate-600">{r.unit}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-600">
                    {editId === r.id ? (
                      <div className="inline-flex items-center gap-1">
                        <input type="number" step="0.001" value={editVal} onChange={(e) => setEditVal(e.target.value)}
                          className="w-24 px-2 py-0.5 border border-slate-200 rounded text-right text-sm" />
                        <button onClick={saveRate} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check className="w-3 h-3" /></button>
                        <button onClick={() => setEditId(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X className="w-3 h-3" /></button>
                      </div>
                    ) : `¥ ${Number(r.rate).toFixed(3)}`}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editId !== r.id && (
                      <button onClick={() => { setEditId(r.id); setEditVal(String(r.rate)); }}
                        className="text-xs text-[#8b5cf6] hover:underline">编辑费率</button>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="p-10 text-center text-slate-400">暂无计费规则</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
