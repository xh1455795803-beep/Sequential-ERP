import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { BarChart3, Trophy, DollarSign, TrendingUp, Loader2 } from 'lucide-react';

export function WmsReportsPage() {
  const [wid, setWid] = useState<string | null>(null);
  const [daily, setDaily] = useState<{ day: string; qty: number }[]>([]);
  const [cod, setCod] = useState({ count: 0, amount: 0 });
  const [lb, setLb] = useState<any[]>([]);
  const [ld, setLd] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) return;
      setWid(ctx.warehouseId);
      try {
        const today = new Date();
        const dp = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today); d.setDate(d.getDate() - i);
          const s = d.toISOString().slice(0, 10);
          dp.push(supabase.from('tlv_outbound_orders').select('id', { count: 'exact', head: true })
            .eq('warehouse_id', ctx.warehouseId).eq('status', 'shipped')
            .gte('shipped_at', `${s}T00:00:00`).lte('shipped_at', `${s}T23:59:59`)
            .then((r: any) => ({ day: `${s.slice(5, 7)}-${s.slice(8, 10)}`, qty: r.count ?? 0 })));
        }
        const d = await Promise.all(dp); setDaily(d);
        const { data: cd } = await supabase.from('tlv_outbound_orders').select('cod_amount').eq('warehouse_id', ctx.warehouseId).gt('cod_amount', 0);
        if (cd) setCod({ count: cd.length, amount: cd.reduce((a: number, b: any) => a + (b.cod_amount || 0), 0) });
        const fd = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
        const { data: lbd } = await supabase.from('tlv_outbound_orders').select('merchant_name').eq('warehouse_id', ctx.warehouseId).gte('created_at', fd);
        if (lbd) {
          const c: Record<string, number> = {};
          lbd.forEach((r: any) => { c[r.merchant_name] = (c[r.merchant_name] || 0) + 1; });
          setLb(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n, q], i) => ({ rank: i + 1, name: n, qty: q })));
        }
      } catch (e: any) { setErr(e.message); }
      finally { setLd(false); }
    })();
  }, []);

  if (!wid) return <div className="p-12 text-center text-slate-500">未登录</div>;
  if (ld) return <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载报表...</div>;

  const max = Math.max(...daily.map(p => p.qty), 1);
  const avg = daily.length ? Math.round(daily.reduce((a, b) => a + b.qty, 0) / daily.length) : 0;

  const Kpi = ({ i: I, l, v, sf, pf, c }: any) => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${c} text-white flex items-center justify-center shrink-0`}><I className="w-5 h-5" /></div>
      <div><div className="flex items-baseline gap-1">{pf && <span className="text-lg text-slate-500">{pf}</span>}<span className="text-2xl font-bold text-slate-800 tabular-nums">{v}</span>{sf && <span className="text-sm text-slate-400">{sf}</span>}</div><div className="text-xs text-slate-500 mt-0.5">{l}</div></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-emerald-600" />数据报表</h2><p className="text-sm text-slate-500 mt-0.5">运营概览</p></div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Kpi i={TrendingUp} l="今日出库" v={daily[6]?.qty ?? 0} sf="单" c="from-emerald-500 to-teal-600" />
        <Kpi i={BarChart3} l="日均打包(7天)" v={avg} sf="单/天" c="from-amber-500 to-orange-600" />
        <Kpi i={DollarSign} l="COD 应收总额" v={cod.amount} pf="¥" c="from-sky-500 to-blue-600" />
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4"><h3 className="font-semibold text-slate-800">近 7 日出库量趋势</h3><span className="text-xs text-slate-500">单位: 单</span></div>
        <div className="flex items-end justify-between gap-2 h-48 px-2">
          {daily.map((d) => (
            <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
              <span className="text-[10px] text-slate-500 tabular-nums">{d.qty}</span>
              <div className="w-full max-w-[40px] bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-md" style={{ height: `${Math.max((d.qty / max) * 100, 2)}%` }} />
              <span className="text-[10px] text-slate-400">{d.day}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-4"><Trophy className="w-4 h-4 text-amber-500" /><h3 className="font-semibold text-slate-800">本月商家订单 TOP 5</h3></div>
          <div className="space-y-2">
            {lb.map((x: any) => {
              const rc = x.rank === 1 ? 'bg-amber-100 text-amber-700' : x.rank === 2 ? 'bg-slate-200 text-slate-700' : x.rank === 3 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500';
              return <div key={x.rank} className="flex items-center gap-3"><span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${rc}`}>{x.rank}</span><span className="flex-1 text-sm text-slate-700 truncate">{x.name}</span><span className="text-sm font-semibold text-emerald-700 tabular-nums">{x.qty} 单</span></div>;
            })}
            {lb.length === 0 && <div className="text-sm text-slate-400 text-center py-4">暂无数据</div>}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-4"><DollarSign className="w-4 h-4 text-emerald-600" /><h3 className="font-semibold text-slate-800">货到付款 (COD) 汇总</h3></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-emerald-50 rounded-lg"><div className="text-xs text-emerald-700">COD 订单数</div><div className="text-2xl font-bold text-emerald-800 mt-1 tabular-nums">{cod.count}</div></div>
            <div className="p-4 bg-sky-50 rounded-lg"><div className="text-xs text-sky-700">COD 应收总额</div><div className="text-2xl font-bold text-sky-800 mt-1 tabular-nums">¥{cod.amount.toLocaleString()}</div></div>
          </div>
        </div>
      </div>
      {err && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">查询异常 · {err}</div>}
    </div>
  );
}
