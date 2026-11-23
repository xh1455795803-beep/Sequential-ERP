import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Wallet, Loader2, CheckCircle, XCircle } from 'lucide-react';

const CL: Record<string, string> = { storage_fee: '仓租', inbound_fee: '入库处理', outbound_fee: '出库打包', shipping_fee: '国际运费', cod_fee: 'COD 手续费', listing_fee: '代上架' };

export function WmsBillingPage() {
  const [wid, setWid] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [ld, setLd] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) return;
      setWid(ctx.warehouseId);
      try {
        const { data, error } = await supabase.from('tlv_billing_rules').select('id, rule_name, rule_type, unit, rate, condition').eq('warehouse_id', ctx.warehouseId).order('rule_type', { ascending: true });
        if (error) throw error;
        setRows((data || []).map((r: any) => ({ ...r, editing: false, _name: r.rule_name, _unit: r.unit, _rate: String(r.rate), _cond: JSON.stringify(r.condition || {}) })));
      } catch (e: any) { setErr(e.message); }
      finally { setLd(false); }
    })();
  }, []);

  async function save(id: string) {
    const r = rows.find(x => x.id === id);
    if (!r || !wid) return;
    try {
      const { error } = await supabase.from('tlv_billing_rules').update({
        rule_name: r._name, unit: r._unit, rate: parseFloat(r._rate),
        condition: JSON.parse(r._cond),
      }).eq('id', id).eq('warehouse_id', wid);
      if (error) throw error;
      setRows(rs => rs.map(x => x.id === id ? { ...x, rule_name: x._name, unit: x._unit, rate: parseFloat(x._rate), editing: false } : x));
    } catch (e: any) { alert('保存失败: ' + e.message); }
  }

  if (!wid) return <div className="p-12 text-center text-slate-500">未登录</div>;
  if (ld) return <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载中...</div>;

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Wallet className="w-5 h-5 text-emerald-600" />计费规则</h2><p className="text-sm text-slate-500 mt-0.5">当前仓库生效中的收费标准 · 行内编辑</p></div>

      {rows.length === 0 && <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 text-center text-slate-400 text-sm">暂无计费规则</div>}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs"><tr>
              <th className="text-left px-4 py-3 font-medium">计费项目</th>
              <th className="text-left px-4 py-3 font-medium">类型</th>
              <th className="text-left px-4 py-3 font-medium">单位</th>
              <th className="text-right px-4 py-3 font-medium">单价</th>
              <th className="text-left px-4 py-3 font-medium">条件(JSON)</th>
              <th className="px-4 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    {r.editing ? <input value={r._name} onChange={(e) => setRows(rs => rs.map(x => x.id === r.id ? { ...x, _name: e.target.value } : x))} className="w-full px-2 py-1 border border-slate-200 rounded text-sm" />
                      : <span className="font-medium text-slate-800">{r.rule_name}</span>}
                  </td>
                  <td className="px-4 py-2"><span className="text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full">{CL[r.rule_type] || r.rule_type}</span></td>
                  <td className="px-4 py-2">
                    {r.editing ? <input value={r._unit} onChange={(e) => setRows(rs => rs.map(x => x.id === r.id ? { ...x, _unit: e.target.value } : x))} className="w-24 px-2 py-1 border border-slate-200 rounded text-xs font-mono" />
                      : <span className="font-mono text-xs text-slate-600">{r.unit}</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.editing ? <input type="number" step="0.01" value={r._rate} onChange={(e) => setRows(rs => rs.map(x => x.id === r.id ? { ...x, _rate: e.target.value } : x))} className="w-24 px-2 py-1 border border-slate-200 rounded text-sm text-right" />
                      : <span className="tabular-nums font-semibold text-emerald-700">{r.rate}{r.unit === 'pct' ? '%' : ''}</span>}
                  </td>
                  <td className="px-4 py-2">
                    {r.editing ? <textarea rows={1} value={r._cond} onChange={(e) => setRows(rs => rs.map(x => x.id === r.id ? { ...x, _cond: e.target.value } : x))} className="w-full max-w-xs px-2 py-1 border border-slate-200 rounded text-[10px] font-mono" />
                      : <pre className="text-[10px] text-slate-600 font-mono bg-slate-50 px-2 py-1 rounded max-w-xs truncate">{JSON.stringify(r.condition || {})}</pre>}
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {r.editing ? (<><button onClick={() => save(r.id)} className="mr-1 p-1 text-emerald-600 hover:bg-emerald-50 rounded"><CheckCircle className="w-4 h-4" /></button><button onClick={() => setRows(rs => rs.map(x => x.id === r.id ? { ...x, editing: false } : x))} className="p-1 text-slate-400 hover:bg-slate-50 rounded"><XCircle className="w-4 h-4" /></button></>)
                      : <button onClick={() => setRows(rs => rs.map(x => x.id === r.id ? { ...x, editing: true } : x))} className="text-xs px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded">编辑</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {err && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">查询异常 · {err}</div>}
    </div>
  );
}
