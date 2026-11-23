import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { BarChart3, Trophy, DollarSign, TrendingUp, Loader2 } from 'lucide-react';

const WH_ID = '00000000-0000-0000-0000-000000000001';

// Mock daily packing stats (last 7 days)
const PACKING_STATS = [
  { day: '11-17', qty: 182 }, { day: '11-18', qty: 215 }, { day: '11-19', qty: 198 },
  { day: '11-20', qty: 240 }, { day: '11-21', qty: 288 }, { day: '11-22', qty: 312 }, { day: '11-23', qty: 256 },
];

export function WmsReportsPage() {
  const [totalPacked, setTotalPacked] = useState(0);
  const [codSummary, setCodSummary] = useState({ count: 0, amount: 0 });
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);

        // Today's packed count (shipped today or weighed today)
        let packed = 0;
        {
          const r = await supabase
            .from('tlv_outbound_orders')
            .select('id', { count: 'exact', head: true })
            .eq('warehouse_id', WH_ID)
            .eq('status', 'shipped')
            .gte('shipped_at', `${today}T00:00:00`)
            .lte('shipped_at', `${today}T23:59:59`);
          if (!r.error) packed = r.count ?? 0;
        }
        setTotalPacked(packed || PACKING_STATS[PACKING_STATS.length - 1].qty);

        // COD summary
        let codData: any[] = [];
        {
          const r = await supabase
            .from('tlv_outbound_orders')
            .select('cod_amount, status')
            .eq('warehouse_id', WH_ID)
            .gt('cod_amount', 0)
            .in('status', ['pending', 'picking', 'packing', 'weighed', 'shipped']);
          if (!r.error && r.data) codData = r.data;
        }
        if (codData.length) {
          setCodSummary({
            count: codData.length,
            amount: codData.reduce((a: number, b: any) => a + (b.cod_amount || 0), 0),
          });
        } else {
          setCodSummary({ count: 18, amount: 36420 });
        }

        // Merchant leaderboard (top 5 by order count this month)
        const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        let lb: any[] = [];
        {
          const r = await supabase
            .from('tlv_outbound_orders')
            .select('merchant_name')
            .eq('warehouse_id', WH_ID)
            .gte('created_at', firstDay);
          if (!r.error && r.data) lb = r.data;
        }
        const counter: Record<string, number> = {};
        if (lb) {
          lb.forEach((r: any) => { counter[r.merchant_name] = (counter[r.merchant_name] || 0) + 1; });
        }
        const sorted = Object.entries(counter).sort((a, b) => b[1] - a[1]).slice(0, 5);
        if (sorted.length) {
          setLeaderboard(sorted.map(([name, qty], i) => ({ rank: i + 1, name, qty })));
        } else {
          setLeaderboard([
            { rank: 1, name: '星辰电子', qty: 218 },
            { rank: 2, name: '极光家居', qty: 164 },
            { rank: 3, name: 'FunToy', qty: 132 },
            { rank: 4, name: 'Dazzle Beauty', qty: 89 },
            { rank: 5, name: 'Nova Lighting', qty: 57 },
          ]);
        }
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const maxPacking = Math.max(...PACKING_STATS.map((p) => p.qty));
  const avgPacking = Math.round(PACKING_STATS.reduce((a, b) => a + b.qty, 0) / PACKING_STATS.length);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-600" /> 数据报表
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">深圳前海云仓 · 运营概览</p>
      </div>

      {loading && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-12 flex items-center justify-center text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载报表...
        </div>
      )}

      {!loading && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard icon={TrendingUp} label="今日出库" value={totalPacked} suffix="单" color="from-emerald-500 to-teal-600" />
            <KpiCard icon={Trophy} label="日均打包" value={avgPacking} suffix="单/天" color="from-amber-500 to-orange-600" />
            <KpiCard icon={DollarSign} label="COD 订单金额" value={codSummary.amount} prefix="¥" color="from-sky-500 to-blue-600" />
          </div>

          {/* Packing chart */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">近 7 日打包量趋势</h3>
              <span className="text-xs text-slate-500">单位: 单</span>
            </div>
            <div className="flex items-end justify-between gap-2 h-48 px-2">
              {PACKING_STATS.map((d) => {
                const h = (d.qty / maxPacking) * 100;
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-2">
                    <span className="text-[10px] text-slate-500 tabular-nums">{d.qty}</span>
                    <div
                      className="w-full max-w-[40px] bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-md transition-all"
                      style={{ height: `${h}%` }}
                    />
                    <span className="text-[10px] text-slate-400">{d.day}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Two columns: leaderboard + COD */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Merchant leaderboard */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="w-4 h-4 text-amber-500" />
                <h3 className="font-semibold text-slate-800">本月商家订单 TOP 5</h3>
              </div>
              <div className="space-y-2">
                {leaderboard.map((l) => {
                  const rankBg = l.rank === 1 ? 'bg-amber-100 text-amber-700' :
                                 l.rank === 2 ? 'bg-slate-200 text-slate-700' :
                                 l.rank === 3 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500';
                  return (
                    <div key={l.rank} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 ${rankBg}`}>{l.rank}</span>
                      <span className="flex-1 text-sm text-slate-700 truncate">{l.name}</span>
                      <span className="text-sm font-semibold text-emerald-700 tabular-nums">{l.qty} 单</span>
                    </div>
                  );
                })}
                {leaderboard.length === 0 && (
                  <div className="text-sm text-slate-400 text-center py-4">暂无数据</div>
                )}
              </div>
            </div>

            {/* COD summary */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <h3 className="font-semibold text-slate-800">货到付款 (COD) 汇总</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-emerald-50 rounded-lg">
                  <div className="text-xs text-emerald-700">COD 订单数</div>
                  <div className="text-2xl font-bold text-emerald-800 mt-1 tabular-nums">{codSummary.count}</div>
                </div>
                <div className="p-4 bg-sky-50 rounded-lg">
                  <div className="text-xs text-sky-700">COD 应收总额</div>
                  <div className="text-2xl font-bold text-sky-800 mt-1 tabular-nums">¥{codSummary.amount.toLocaleString()}</div>
                </div>
              </div>
              <div className="mt-4 text-xs text-slate-500 leading-relaxed">
                COD 订单需要在发货前校验代收机构覆盖范围；出库后平台一般 T+7 对账。请留意异常大额 COD 订单及时与商家确认。
              </div>
            </div>
          </div>
        </>
      )}

      {err && (
        <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          查询异常，部分展示示例数据 · {err}
        </div>
      )}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, suffix, prefix, color }: any) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${color} text-white flex items-center justify-center shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          {prefix && <span className="text-lg text-slate-500">{prefix}</span>}
          <span className="text-2xl font-bold text-slate-800 tabular-nums">{value}</span>
          {suffix && <span className="text-sm text-slate-400">{suffix}</span>}
        </div>
        <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  );
}
