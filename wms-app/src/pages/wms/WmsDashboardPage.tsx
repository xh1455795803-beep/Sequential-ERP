import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Package, Truck, CheckCircle, Boxes, Inbox, ShoppingCart, ArrowRight, Clock, Scale, Loader2, TrendingUp } from 'lucide-react';

const SM = {
  pending: { l: '待处理', c: 'bg-slate-100 text-slate-600' },
  picking: { l: '拣货中', c: 'bg-sky-100 text-sky-700' },
  packing: { l: '打包中', c: 'bg-coral-100 text-orange-700' },
  weighed: { l: '已称重', c: 'bg-lilac-100 text-violet-700' },
  shipped: { l: '已出库', c: 'bg-mint-100 text-emerald-700' },
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

  if (!wid) return <div className="p-12 text-center text-ink-300">未登录</div>;
  if (ld) return <div className="p-12 flex items-center justify-center text-ink-300"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载中...</div>;

  const cards = [
    { i: Boxes, v: s.pi, sf: '单', l: '待处理入库', blobs: [['#bbf7d0','-right-4','-top-4','w-28','h-28'],['#a7f3d0','-left-3','-bottom-5','w-20','h-20']], bg: 'from-mint-100 to-emerald-50', col: 'text-emerald-600' },
    { i: Package, v: s.po, sf: '单', l: '待出库订单', blobs: [['#fed7aa','-right-5','-bottom-3','w-28','h-28'],['#fde68a','-left-3','-top-4','w-20','h-20']], bg: 'from-coral-100 to-orange-50', col: 'text-orange-600' },
    { i: Truck, v: s.st, sf: '单', l: '今日已出库', blobs: [['#bae0fd','-right-3','-top-5','w-28','h-28'],['#e0f2fe','-left-4','-bottom-4','w-20','h-20']], bg: 'from-sky-100 to-cyan-50', col: 'text-sky-600' },
    { i: CheckCircle, v: s.cod, sf: '单', l: 'COD 订单', blobs: [['#f3e8ff','-right-5','-top-3','w-28','h-28'],['#fce7f3','-left-4','-bottom-5','w-20','h-20']], bg: 'from-lilac-100 to-violet-50', col: 'text-violet-600' },
  ];

  return (
    <div className="space-y-6">
      {/* 顶部 */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">你好 👋 仓库管理员</h1>
          <p className="text-sm text-ink-500 mt-0.5">今日概览</p>
        </div>
      </div>

      {/* 4 大数字卡 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c, i) => (
          <div key={i} className="glass relative overflow-hidden p-5 group">
            {c.blobs.map((b, j) => (
              <div key={j} className={`blob ${b[1]} ${b[2]} ${b[3]} ${b[4]}`} style={{ background: b[0] }} />
            ))}
            <div className="relative z-10">
              <div className={`inline-flex w-10 h-10 items-center justify-center rounded-xl bg-gradient-to-br ${c.bg} ${c.col} mb-3`}>
                <c.i className="w-5 h-5" />
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-ink-900 tabular-nums">{c.v}</span>
                <span className="text-sm text-ink-300">{c.sf}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="text-sm text-ink-500">{c.l}</span>
                <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 bg-mint-100 px-1 py-0.5 rounded-full">
                  <TrendingUp className="w-2.5 h-2.5" /> 今日
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {err && <div className="text-sm text-rose-600 bg-rose-50/80 border border-rose-100 px-4 py-2 rounded-xl">加载异常: {err}</div>}

      {/* 双面板 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="glass overflow-hidden">
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-white/60">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-mint-100 text-emerald-600 flex items-center justify-center"><Inbox className="w-4 h-4" /></div>
              <h3 className="font-semibold text-ink-700">商家入库待处理</h3>
              <span className="px-2 py-0.5 text-[10px] bg-mint-100 text-emerald-700 rounded-full font-medium">{ib.length}</span>
            </div>
            <button onClick={() => navigate({ to: '/wms/merchant-inbox' })} className="text-xs text-sky-600 hover:text-sky-700 flex items-center gap-1">全部 <ArrowRight className="w-3 h-3" /></button>
          </div>
          <ul>
            {ib.map((r: any) => (
              <li key={r.id} className="px-5 py-3 flex items-center gap-3 hover:bg-white/40 transition-colors border-b border-white/30 last:border-b-0">
                <div className="w-9 h-9 rounded-xl bg-mint-50 text-emerald-600 flex items-center justify-center shrink-0"><Package className="w-4 h-4" /></div>
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-sm font-medium text-ink-700 truncate">{r.inbound_no}</div>
                  <div className="text-xs text-ink-500 mt-0.5">{r.merchant_name} · {r.sku_count} SKU · {r.total_qty} 件</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-ink-300 flex items-center gap-1 justify-end"><Clock className="w-3 h-3" /> {r.eta || '待确认'}</div>
                </div>
              </li>
            ))}
            {!ib.length && <li className="px-5 py-10 text-center text-sm text-ink-300">暂无待入库订单</li>}
          </ul>
        </section>

        <section className="glass overflow-hidden">
          <div className="px-5 py-3.5 flex items-center justify-between border-b border-white/60">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-coral-100 text-orange-600 flex items-center justify-center"><ShoppingCart className="w-4 h-4" /></div>
              <h3 className="font-semibold text-ink-700">待处理出库订单</h3>
              <span className="px-2 py-0.5 text-[10px] bg-coral-100 text-orange-700 rounded-full font-medium">{ob.length}</span>
            </div>
            <button onClick={() => navigate({ to: '/wms/orders' })} className="text-xs text-sky-600 hover:text-sky-700 flex items-center gap-1">全部 <ArrowRight className="w-3 h-3" /></button>
          </div>
          <ul>
            {ob.map((r: any) => {
              const m = SM[r.status as keyof typeof SM] || SM.pending;
              return (
                <li key={r.id} className="px-5 py-3 flex items-center gap-3 hover:bg-white/40 transition-colors cursor-pointer border-b border-white/30 last:border-b-0" onClick={() => navigate({ to: `/wms/orders/${r.id}` })}>
                  <div className="w-9 h-9 rounded-xl bg-coral-50 text-orange-600 flex items-center justify-center shrink-0">{r.status === 'weighed' ? <Scale className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-ink-700 truncate">{r.order_no}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${m.c}`}>{m.l}</span>
                    </div>
                    <div className="text-xs text-ink-500 mt-0.5">{r.merchant_name} · {r.platform} · 收件人 {r.receiver_name}</div>
                  </div>
                  <button className="shrink-0 text-xs px-3 py-1.5 bg-gradient-to-r from-mint-500 to-emerald-500 hover:from-mint-600 hover:to-emerald-600 text-white rounded-lg font-medium shadow-sm shadow-emerald-200/50">处理</button>
                </li>
              );
            })}
            {!ob.length && <li className="px-5 py-10 text-center text-sm text-ink-300">暂无待打包订单</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
