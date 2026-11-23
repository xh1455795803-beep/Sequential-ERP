import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from '@tanstack/react-router';
import { Search, ShoppingCart, Loader2 } from 'lucide-react';

const WH_ID = '00000000-0000-0000-0000-000000000001';

const TABS = [
  { key: 'all', label: '全部', statuses: [] as string[] },
  { key: 'pending', label: '待拣货', statuses: ['pending'] },
  { key: 'packing', label: '打包中', statuses: ['picking', 'packing'] },
  { key: 'weighed', label: '已称重', statuses: ['weighed'] },
  { key: 'shipped', label: '已出库', statuses: ['shipped'] },
  { key: 'exception', label: '异常', statuses: ['cancelled', 'exception', 'returned'] },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待拣货', cls: 'bg-slate-100 text-slate-700' },
  picking: { label: '拣货中', cls: 'bg-blue-50 text-blue-700' },
  packing: { label: '打包中', cls: 'bg-amber-50 text-amber-700' },
  weighed: { label: '已称重', cls: 'bg-purple-50 text-purple-700' },
  shipped: { label: '已出库', cls: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: '已取消', cls: 'bg-red-50 text-red-700' },
  exception: { label: '异常', cls: 'bg-red-50 text-red-700' },
  returned: { label: '退回', cls: 'bg-rose-50 text-rose-700' },
};

const FALLBACK = [
  { id: 'ob-1', order_no: 'OB20261123002', merchant_name: '星辰电子', platform: 'Shopee', receiver_name: 'Alex Chen', status: 'weighed', tracking_no: 'SPX-MY-88291023' },
  { id: 'ob-2', order_no: 'OB20261123003', merchant_name: '极光家居', platform: 'TikTok', receiver_name: 'Mia Wang', status: 'pending', tracking_no: null },
  { id: 'ob-3', order_no: 'OB20261123004', merchant_name: '星辰电子', platform: 'Lazada', receiver_name: 'John Loo', status: 'packing', tracking_no: null },
  { id: 'ob-4', order_no: 'OB20261122098', merchant_name: 'FunToy', platform: 'Amazon', receiver_name: 'Sarah Lee', status: 'shipped', tracking_no: 'AMZ-442-990112' },
];

export function WmsOrdersPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<any[]>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => { load(); }, [tab]);

  async function load() {
    setLoading(true);
    try {
      const tabCfg = TABS.find((t) => t.key === tab)!;
      let q = supabase
        .from('tlv_outbound_orders')
        .select('id, order_no, merchant_name, platform, receiver_name, status, tracking_no')
        .eq('warehouse_id', WH_ID)
        .order('created_at', { ascending: false })
        .limit(50);
      if (tabCfg.statuses.length) q = q.in('status', tabCfg.statuses as any);
      const { data, error } = await q;
      if (error) throw error;
      if (data && data.length) setRows(data);

      // Count per tab (lightweight)
      const c: Record<string, number> = { all: data?.length || 0 };
      for (const t of TABS) {
        if (t.key === 'all') continue;
        const { count } = await supabase
          .from('tlv_outbound_orders')
          .select('id', { count: 'exact', head: true })
          .eq('warehouse_id', WH_ID)
          .in('status', t.statuses as any);
        c[t.key] = count ?? 0;
      }
      setCounts(c);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = rows.filter((r) =>
    !search ||
    (r.order_no || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.merchant_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.receiver_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (r.tracking_no || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-slate-800">代打包订单</h2>
        <p className="text-sm text-slate-500 mt-0.5">出库订单按状态筛选处理</p>
      </div>

      {/* Tabs + search */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="flex overflow-x-auto border-b border-slate-100">
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition ${
                  active ? 'border-emerald-600 text-emerald-700 font-medium' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {counts[t.key] ?? (t.key === tab ? rows.length : 0)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="p-3">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="订单号 / 商家 / 收件人 / 物流号..."
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading && (
          <div className="p-12 flex items-center justify-center text-slate-400 text-sm">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中...
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-12 text-center text-slate-400 text-sm">当前筛选下暂无订单</div>
        )}
        {!loading && filtered.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">订单号</th>
                <th className="text-left px-5 py-3 font-medium">商家</th>
                <th className="text-left px-5 py-3 font-medium">平台</th>
                <th className="text-left px-5 py-3 font-medium">收件人</th>
                <th className="text-left px-5 py-3 font-medium">状态</th>
                <th className="text-left px-5 py-3 font-medium">跟踪号</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r: any) => {
                const meta = STATUS_META[r.status] || STATUS_META.pending;
                return (
                  <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate({ to: `/wms/orders/${r.id}` })}>
                    <td className="px-5 py-3 font-mono font-semibold text-slate-800">{r.order_no}</td>
                    <td className="px-5 py-3 text-slate-700">{r.merchant_name}</td>
                    <td className="px-5 py-3 text-slate-600">{r.platform}</td>
                    <td className="px-5 py-3 text-slate-600">{r.receiver_name}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-500">{r.tracking_no || '-'}</td>
                    <td className="px-5 py-3 text-right">
                      <button className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md inline-flex items-center gap-1">
                        <ShoppingCart className="w-3 h-3" /> 处理
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {err && (
          <div className="px-5 py-2 text-xs text-amber-600 bg-amber-50 border-t border-amber-100">查询异常 · {err}</div>
        )}
      </div>
    </div>
  );
}
