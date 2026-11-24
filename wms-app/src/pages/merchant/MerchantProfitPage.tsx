import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { TrendingUp, TrendingDown, DollarSign, Package } from 'lucide-react';

export function MerchantProfitPage() {
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.merchantId) { setLoading(false); return; }
      setMerchantId(ctx.merchantId);
      await load(ctx.merchantId, range);
    })();
  }, [range]);

  async function load(mid: string, days: number) {
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('tlv_calc_profit', {
      p_merchant_id: mid, p_start_date: start, p_end_date: end,
    });
    if (error) console.error(error);
    setRows(data || []);
    setLoading(false);
  }

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;
  if (!merchantId) return <div>未登录</div>;

  const totals = rows.reduce((acc, r) => ({
    qty_sold: acc.qty_sold + (Number(r.qty_sold) || 0),
    revenue: acc.revenue + (Number(r.revenue) || 0),
    total_cost: acc.total_cost + (Number(r.total_cost) || 0),
    shipping_fee: acc.shipping_fee + (Number(r.shipping_fee) || 0),
    packing_fee: acc.packing_fee + (Number(r.packing_fee) || 0),
    net_profit: acc.net_profit + (Number(r.net_profit) || 0),
  }), { qty_sold: 0, revenue: 0, total_cost: 0, shipping_fee: 0, packing_fee: 0, net_profit: 0 });
  totals.margin_pct = totals.revenue > 0 ? (totals.net_profit / totals.revenue * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-700 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-600" /> 利润核算
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">销售价 - 进货成本 - 运费 - 仓内费用 = 净利润</p>
        </div>
        <div className="flex gap-2">
          {([7, 30, 90] as const).map((d) => (
            <button key={d} onClick={() => setRange(d)}
              className={`px-3 py-1.5 text-xs rounded-full border ${range === d ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'}`}>
              最近 {d} 天
            </button>
          ))}
        </div>
      </div>

      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-xl p-6 text-white shadow-md">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <Metric label="销量" value={totals.qty_sold} />
          <Metric label="营收" value={`¥${totals.revenue.toFixed(2)}`} />
          <Metric label="进货成本" value={`-¥${totals.total_cost.toFixed(2)}`} />
          <Metric label="运费" value={`-¥${totals.shipping_fee.toFixed(2)}`} />
          <Metric label="仓内费用" value={`-¥${totals.packing_fee.toFixed(2)}`} />
          <Metric label="净利润" value={`¥${totals.net_profit.toFixed(2)}`} highlight />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">
          该时间段内没有已发货/已完成的订单
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">SKU 利润明细</div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">SKU</th>
                <th className="text-left px-5 py-3 font-medium">商品</th>
                <th className="text-right px-5 py-3 font-medium">销量</th>
                <th className="text-right px-5 py-3 font-medium">营收</th>
                <th className="text-right px-5 py-3 font-medium">进货成本</th>
                <th className="text-right px-5 py-3 font-medium">运费</th>
                <th className="text-right px-5 py-3 font-medium">仓内费</th>
                <th className="text-right px-5 py-3 font-medium">净利润</th>
                <th className="text-right px-5 py-3 font-medium">利润率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => (
                <tr key={r.sku} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono font-semibold text-blue-700">{r.sku}</td>
                  <td className="px-5 py-3 text-slate-700">{r.product_name || '-'}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{r.qty_sold}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{Number(r.revenue).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-amber-700">-{Number(r.total_cost).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-500">-{Number(r.shipping_fee).toFixed(2)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-slate-500">-{Number(r.packing_fee).toFixed(2)}</td>
                  <td className={`px-5 py-3 text-right tabular-nums font-bold ${Number(r.net_profit) >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {Number(r.net_profit) >= 0 ? '+' : ''}{Number(r.net_profit).toFixed(2)}
                  </td>
                  <td className={`px-5 py-3 text-right tabular-nums ${Number(r.margin_pct) >= 20 ? 'text-emerald-600' : Number(r.margin_pct) >= 0 ? 'text-amber-600' : 'text-red-600'}`}>
                    {Number(r.margin_pct).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, highlight }: any) {
  return (
    <div>
      <div className="text-xs text-emerald-200">{label}</div>
      <div className={`text-lg font-bold tabular-nums mt-1 ${highlight ? 'text-yellow-300 text-xl' : ''}`}>{value}</div>
    </div>
  );
}
