import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Package, Truck, CheckCircle, Boxes, Inbox, ShoppingCart, ArrowRight, Clock, Scale, Loader2 } from 'lucide-react';

const SM = {
  pending: { l: '待处理', c: 'bg-slate-100 text-slate-600' },
  picking: { l: '拣货中', c: 'bg-blue-50 text-blue-600' },
  packing: { l: '打包中', c: 'bg-amber-50 text-amber-600' },
  weighed: { l: '已称重', c: 'bg-purple-50 text-purple-600' },
  shipped: { l: '已出库', c: 'bg-emerald-50 text-emerald-600' },
};

export function WmsDashboardPage() {
  const navigate = useNavigate();
  const [wid, setWid] = useState<string | null>(null);
  const [s, setS] = useState({ pi: 0, po: 0, st: 0, cod: 0 });
  const [ib, setIb] = useState<any[]>([]);
  const [ob, setOb] = useState<any[]>([]);
  const [ld, setLd] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) return;
      setWid(ctx.warehouseId);
      await load(ctx.warehouseId);
      setLd(false);
    })();
  }, []);

  async function load(w: string) {
    try {
      const t = new Date().toISOString().slice(0, 10);
      const f = `${t}T00:00:00`, e = `${t}T23:59:59`;
      const [pi, po, st, cod, ib, ob] = await Promise.all([
        supabase.from('tlv_inbound_orders').select('id', { count: 'exact', head: true })
          .eq('warehouse_id', w).in('status', ['pending', 'received', 'inspecting']),
        supabase.from('tlv_outbound_orders').select('id', { count: 'exact', head: true })
          .eq('warehouse_id', w).in('status', ['pending', 'picking', 'packing', 'weighed']),
        supabase.from('tlv_outbound_orders').select('id', { count: 'exact', head: true })
          .eq('warehouse_id', w).eq('status', 'shipped').gte('shipped_at', f).lte('shipped_at', e),
        supabase.from('tlv_outbound_orders').select('id', { count: 'exact', head: true })
          .eq('warehouse_id', w).gt('cod_amount', 0),
        supabase.from('tlv_inbound_orders')
          .select('id, inbound_no, merchant_name, sku_count, total_qty, eta, status')
          .eq('warehouse_id', w).in('status', ['pending', 'received', 'inspecting'])
          .order('created_at', { ascending: false }).limit(10),
        supabase.from('tlv_outbound_orders')
          .select('id, order_no, merchant_name, platform, receiver_name, status')
          .eq('warehouse_id', w).in('status', ['pending', 'picking', 'packing', 'weighed'])
          .order('created_at', { ascending: false }).limit(10),
      ]);
      setS({ pi: pi.count ?? 0, po: po.count ?? 0, st: st.count ?? 0, cod: cod.count ?? 0 });
      setIb(ib.data || []); setOb(ob.data || []);
    } catch (e: any) { setErr(e.message); }
  }

  if (!wid) return <div className="p-12 text-center text-slate-500">未登录</div>;
  if (ld) return <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载中...</div>;

  const Card = ({ i: I, c, l, v, sf }: any) => (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${c} text-white flex items-center justify-center shrink-0`}><I className="w-5 h-5" /></div>
      <div><div className="flex items-baseline gap-1"><span className="text-2xl font-bold text-slate-800 tabular-nums">{v}</span>{sf && <span className="text-sm text-slate-400">{sf}</span>}</div><div className="text-xs text-slate-500 mt-0.5 truncate">{l}</div></div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div><h2 className="text-xl font-bold text-slate-800">工作台</h2><p className="text-sm text-slate-500 mt-0.5">今日概览</p></div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card i={Boxes} c="from-emerald-500 to-emerald-600" l="待处理入库" v={s.pi} sf="单" />
        <Card i={Package} c="from-amber-500 to-amber-600" l="待出库订单" v={s.po} sf="单" />
        <Card i={Truck} c="from-sky-500 to-sky-600" l="今日已出库" v={s.st} sf="单" />
        <Card i={CheckCircle} c="from-violet-500 to-violet-600" l="COD 订单" v={s.cod} sf="单" />
      </div>

      {err && <div className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">加载异常: {err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2"><Inbox className="w-4 h-4 text-emerald-600" /><h3 className="font-semibold text-slate-800">商家入库待处理</h3><span className="px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded-full">{ib.length}</span></div>
            <button onClick={() => navigate({ to: '/wms/merchant-inbox' })} className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1">全部 <ArrowRight className="w-3 h-3" /></button>
          </div>
          <ul className="divide-y divide-slate-50">
            {ib.map((r: any) => (
              <li key={r.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/60">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><Package className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0"><div className="font-mono text-sm font-medium text-slate-800 truncate">{r.inbound_no}</div><div className="text-xs text-slate-500 mt-0.5">{r.merchant_name} · {r.sku_count} SKU · {r.total_qty} 件</div></div>
                <div className="text-right shrink-0"><div className="text-xs text-slate-400 flex items-center gap-1 justify-end"><Clock className="w-3 h-3" /> {r.eta || '待确认'}</div></div>
              </li>
            ))}
            {!ib.length && <li className="px-5 py-10 text-center text-sm text-slate-400">暂无待入库订单</li>}
          </ul>
        </section>

        <section className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-amber-600" /><h3 className="font-semibold text-slate-800">待处理出库订单</h3><span className="px-1.5 py-0.5 text-[10px] bg-amber-50 text-amber-700 rounded-full">{ob.length}</span></div>
            <button onClick={() => navigate({ to: '/wms/orders' })} className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1">全部 <ArrowRight className="w-3 h-3" /></button>
          </div>
          <ul className="divide-y divide-slate-50">
            {ob.map((r: any) => {
              const m = SM[r.status as keyof typeof SM] || SM.pending;
              return (
                <li key={r.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ to: `/wms/orders/${r.id}` })}>
                  <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">{r.status === 'weighed' ? <Scale className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}</div>
                  <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-sm font-medium text-slate-800 truncate">{r.order_no}</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${m.c}`}>{m.l}</span></div><div className="text-xs text-slate-500 mt-0.5">{r.merchant_name} · {r.platform} · 收件人 {r.receiver_name}</div></div>
                  <button className="shrink-0 text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md">处理</button>
                </li>
              );
            })}
            {!ob.length && <li className="px-5 py-10 text-center text-sm text-slate-400">暂无待打包订单</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
