import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { Wallet, Package, Store, Box, Loader2, ArrowRight } from 'lucide-react';

const MERCHANT_ID = '00000000-0000-0000-0000-000000000101';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '待处理', cls: 'bg-slate-100 text-slate-600' },
  RECEIVING: { label: '收货中', cls: 'bg-blue-100 text-blue-700' },
  INSPECTING: { label: '质检中', cls: 'bg-amber-100 text-amber-700' },
  PACKING: { label: '打包中', cls: 'bg-purple-100 text-purple-700' },
  SHIPPED: { label: '已出库', cls: 'bg-teal-100 text-teal-700' },
  COMPLETED: { label: '已完成', cls: 'bg-green-100 text-green-700' },
};

export function MerchantDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [
          { count: invQty }, { count: pendingInbound }, { count: pendingOutbound },
          { data: merchant }, { data: inbound }, { data: outbound },
        ] = await Promise.all([
          supabase.from('tlv_merchant_inventory').select('id', { count: 'exact', head: true }).eq('merchant_id', MERCHANT_ID),
          supabase.from('tlv_inbound_orders').select('id', { count: 'exact', head: true }).eq('merchant_id', MERCHANT_ID).in('status', ['PENDING', 'RECEIVING']),
          supabase.from('tlv_outbound_orders').select('id', { count: 'exact', head: true }).eq('merchant_id', MERCHANT_ID).in('status', ['PENDING', 'CONFIRMED', 'PACKING']),
          supabase.from('tlv_merchants').select('balance').eq('id', MERCHANT_ID).maybeSingle(),
          supabase.from('tlv_inbound_orders').select('*').eq('merchant_id', MERCHANT_ID).order('created_at', { ascending: false }).limit(5),
          supabase.from('tlv_outbound_orders').select('*').eq('merchant_id', MERCHANT_ID).order('created_at', { ascending: false }).limit(5),
        ]);
        setData({
          balance: (merchant as any)?.balance ?? 0,
          invQty: invQty ?? 0,
          pendingInbound: pendingInbound ?? 0,
          pendingOutbound: pendingOutbound ?? 0,
          inbound: inbound || [],
          outbound: outbound || [],
        });
      } catch (e: any) { setErr(e?.message || '加载失败'); }
      finally { setLoading(false); }
    })();
  }, []);

  const cards = [
    { label: '账户余额', value: data ? `¥${data.balance?.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}` : '-', icon: Wallet, color: 'from-blue-500 to-blue-600', route: '/merchant/wallet' },
    { label: '库存 SKU', value: data?.invQty ?? 0, icon: Box, color: 'from-violet-500 to-violet-600', route: '/merchant/inventory' },
    { label: '待处理入库', value: data?.pendingInbound ?? 0, icon: Store, color: 'from-amber-500 to-amber-600', route: '/merchant/inbound' },
    { label: '待出库订单', value: data?.pendingOutbound ?? 0, icon: Package, color: 'from-teal-500 to-teal-600', route: '/merchant/outbound' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((s) => (
          <button key={s.label} onClick={() => navigate({ to: s.route as any })}
            className="group relative overflow-hidden bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md hover:-translate-y-0.5 transition-all text-left">
            <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full bg-gradient-to-br ${s.color} opacity-10`} />
            <div className={`inline-flex w-10 h-10 items-center justify-center rounded-lg bg-gradient-to-br ${s.color} text-white mb-3 shadow-sm`}>
              <s.icon className="w-5 h-5" />
            </div>
            <div className="text-2xl font-bold text-slate-800 tabular-nums">
              {loading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : s.value}
            </div>
            <div className="text-sm text-slate-500 mt-1">{s.label}</div>
          </button>
        ))}
      </div>

      {err && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 p-3 rounded-lg">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="最近入库单" route="/merchant/inbound" navigate={navigate} rows={data?.inbound || []} colKey="inbound" />
        <Panel title="最新出库订单" route="/merchant/outbound" navigate={navigate} rows={data?.outbound || []} colKey="outbound" />
      </div>
    </div>
  );
}

function Panel({ title, route, navigate, rows, colKey }: any) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">{title}</h3>
        <button onClick={() => navigate({ to: route })} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-0.5">
          查看全部 <ArrowRight className="w-3 h-3" />
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">暂无数据</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5 font-medium">单号</th>
              <th className="text-left px-5 py-2.5 font-medium">{colKey === 'inbound' ? '仓库' : '收件人'}</th>
              <th className="text-left px-5 py-2.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map((r: any) => {
              const st = STATUS_LABEL[(r.status || '').toUpperCase()] || { label: r.status, cls: 'bg-slate-100 text-slate-600' };
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-mono font-medium text-slate-800">{r.id}</td>
                  <td className="px-5 py-3 text-slate-600">{colKey === 'inbound' ? (r.warehouse || '-') : (r.recipient_name || r.recipient || '-')}</td>
                  <td className="px-5 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${st.cls}`}>{st.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
