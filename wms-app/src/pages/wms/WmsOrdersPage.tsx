import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Search, ShoppingCart, Loader2 } from 'lucide-react';

const TABS = [
  { k: 'all', l: '全部', s: [] as string[] },
  { k: 'pending', l: '待拣货', s: ['pending'] },
  { k: 'packing', l: '打包中', s: ['picking', 'packing'] },
  { k: 'weighed', l: '已称重', s: ['weighed'] },
  { k: 'shipped', l: '已出库', s: ['shipped'] },
  { k: 'exception', l: '异常', s: ['cancelled', 'exception', 'returned'] },
];

const SM: Record<string, { l: string; c: string }> = {
  pending: { l: '待拣货', c: 'bg-slate-100 text-slate-700' },
  picking: { l: '拣货中', c: 'bg-blue-50 text-blue-700' },
  packing: { l: '打包中', c: 'bg-amber-50 text-amber-700' },
  weighed: { l: '已称重', c: 'bg-purple-50 text-purple-700' },
  shipped: { l: '已出库', c: 'bg-emerald-50 text-emerald-700' },
  cancelled: { l: '已取消', c: 'bg-red-50 text-red-700' },
  exception: { l: '异常', c: 'bg-red-50 text-red-700' },
  returned: { l: '退回', c: 'bg-rose-50 text-rose-700' },
};

export function WmsOrdersPage() {
  const navigate = useNavigate();
  const [wid, setWid] = useState<string | null>(null);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [ld, setLd] = useState(true);
  const [err, setErr] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) return;
      setWid(ctx.warehouseId);
      await load(ctx.warehouseId);
      setLd(false);
    })();
  }, []);

  useEffect(() => { if (wid) load(wid); }, [tab]);

  async function load(w: string) {
    setLd(true);
    try {
      const t = TABS.find((x) => x.k === tab)!;
      let q: any = supabase
        .from('tlv_outbound_orders')
        .select('id, order_no, merchant_name, platform, receiver_name, status, tracking_no')
        .eq('warehouse_id', w)
        .order('created_at', { ascending: false })
        .limit(50);
      if (t.s.length) q = q.in('status', t.s);
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);

      const c: Record<string, number> = {};
      for (const x of TABS) {
        if (x.k === 'all') continue;
        const { count } = await supabase.from('tlv_outbound_orders').select('id', { count: 'exact', head: true }).eq('warehouse_id', w).in('status', x.s);
        c[x.k] = count ?? 0;
      }
      setCounts(c);
    } catch (e: any) { setErr(e.message); }
    finally { setLd(false); }
  }

  const filtered = rows.filter((r) => !search || ['order_no', 'merchant_name', 'receiver_name', 'tracking_no'].some(k => (r[k] || '').toLowerCase().includes(search.toLowerCase())));

  if (!wid) return <div className="p-12 text-center text-slate-500">未登录</div>;

  return (
    <div className="space-y-4">
      <div><h2 className="text-xl font-bold text-slate-800">代打包订单</h2><p className="text-sm text-slate-500 mt-0.5">出库订单按状态筛选处理</p></div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="flex overflow-x-auto border-b border-slate-100">
          {TABS.map((t) => {
            const a = t.k === tab;
            return (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition ${a ? 'border-emerald-600 text-emerald-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                {t.l}
                {t.k !== 'all' && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${a ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{counts[t.k] ?? 0}</span>}
              </button>
            );
          })}
        </div>
        <div className="p-3">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="订单号 / 商家 / 收件人 / 物流号..." className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {ld && <div className="p-12 flex items-center justify-center text-slate-400 text-sm"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载中...</div>}
        {!ld && filtered.length === 0 && <div className="p-12 text-center text-slate-400 text-sm">当前筛选下暂无订单</div>}
        {!ld && filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs"><tr>
              <th className="text-left px-5 py-3 font-medium">订单号</th>
              <th className="text-left px-5 py-3 font-medium">商家</th>
              <th className="text-left px-5 py-3 font-medium">平台</th>
              <th className="text-left px-5 py-3 font-medium">收件人</th>
              <th className="text-left px-5 py-3 font-medium">状态</th>
              <th className="text-left px-5 py-3 font-medium">跟踪号</th>
              <th className="px-5 py-3"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r: any) => {
                const m = SM[r.status] || SM.pending;
                return (
                  <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate({ to: `/wms/orders/${r.id}` as any })}>
                    <td className="px-5 py-3 font-mono font-semibold text-slate-800">{r.order_no}</td>
                    <td className="px-5 py-3 text-slate-700">{r.merchant_name}</td>
                    <td className="px-5 py-3 text-slate-600">{r.platform}</td>
                    <td className="px-5 py-3 text-slate-600">{r.receiver_name}</td>
                    <td className="px-5 py-3"><span className={`text-[11px] px-2 py-0.5 rounded-full ${m.c}`}>{m.l}</span></td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{r.tracking_no || '-'}</td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={(e) => { e.stopPropagation(); navigate({ to: `/wms/orders/${r.id}` as any }); }}
                        className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md inline-flex items-center gap-1">
                        <ShoppingCart className="w-3 h-3" /> 处理
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {err && <div className="px-5 py-2 text-xs text-amber-600 bg-amber-50 border-t border-amber-100">查询异常 · {err}</div>}
      </div>
    </div>
  );
}
