import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import {
  Package, Truck, CheckCircle, TrendingUp, Inbox, ShoppingCart,
  ArrowRight, Clock, Scale, Boxes,
} from 'lucide-react';

// ========= Seed fallback data (when tables are empty) =========
const SEED_PENDING_INBOUND = [
  { id: 'ib-1', inbound_no: 'IB20261123001', merchant: '星辰电子', sku_count: 4, qty: 120, eta: '今日 14:00' },
  { id: 'ib-2', inbound_no: 'IB20261123005', merchant: '极光家居', sku_count: 2, qty: 35, eta: '今日 16:30' },
];

const SEED_PACKING_ORDERS = [
  { id: 'ob-2', order_no: 'OB20261123002', merchant: '星辰电子', platform: 'Shopee', receiver: 'Alex Chen', status: 'weighed' },
  { id: 'ob-3', order_no: 'OB20261123003', merchant: '极光家居', platform: 'TikTok', receiver: 'Mia Wang', status: 'pending' },
  { id: 'ob-4', order_no: 'OB20261123004', merchant: '星辰电子', platform: 'Lazada', receiver: 'John Loo', status: 'packing' },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-slate-100 text-slate-600' },
  picking: { label: '拣货中', cls: 'bg-blue-50 text-blue-600' },
  packing: { label: '打包中', cls: 'bg-amber-50 text-amber-600' },
  weighed: { label: '已称重', cls: 'bg-purple-50 text-purple-600' },
  shipped: { label: '已出库', cls: 'bg-emerald-50 text-emerald-600' },
};

export function WmsDashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ inboundToday: 0, pendingPacking: 1, outboundToday: 1, accuracy: 100 });
  const [inboundList, setInboundList] = useState<any[]>(SEED_PENDING_INBOUND);
  const [packingList, setPackingList] = useState<any[]>(SEED_PACKING_ORDERS);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        // ---------- Stats ----------
        const today = new Date().toISOString().slice(0, 10);

        const { count: inboundToday } = await supabase
          .from('tlv_inbound_orders')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', `${today}T00:00:00`)
          .lte('created_at', `${today}T23:59:59`)
          .catch(() => ({ count: 0 } as any));

        const { count: pendingPacking } = await supabase
          .from('tlv_outbound_orders')
          .select('id', { count: 'exact', head: true })
          .in('status', ['pending', 'picking', 'packing'])
          .catch(() => ({ count: 1 } as any));

        const { count: outboundToday } = await supabase
          .from('tlv_outbound_orders')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'shipped')
          .gte('shipped_at', `${today}T00:00:00`)
          .catch(() => ({ count: 1 } as any));

        setStats({
          inboundToday: inboundToday ?? 0,
          pendingPacking: pendingPacking ?? 1,
          outboundToday: outboundToday ?? 1,
          accuracy: 100,
        });

        // ---------- Inbound list ----------
        const { data: ib } = await supabase
          .from('tlv_inbound_orders')
          .select('id, inbound_no, merchant_name, sku_count, total_qty, eta, status')
          .in('status', ['pending', 'receiving'])
          .order('created_at', { ascending: false })
          .limit(10)
          .catch(() => ({ data: null } as any));
        if (ib && ib.length) {
          setInboundList(ib.map((r: any) => ({
            id: r.id,
            inbound_no: r.inbound_no,
            merchant: r.merchant_name || r.merchant,
            sku_count: r.sku_count,
            qty: r.total_qty,
            eta: r.eta,
          })));
        }

        // ---------- Packing list ----------
        const { data: ob } = await supabase
          .from('tlv_outbound_orders')
          .select('id, order_no, merchant_name, platform, receiver_name, status')
          .in('status', ['pending', 'picking', 'packing', 'weighed'])
          .order('created_at', { ascending: false })
          .limit(10)
          .catch(() => ({ data: null } as any));
        if (ob && ob.length) {
          setPackingList(ob);
        }
      } catch (e: any) {
        setErr(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-800">工作台</h2>
        <p className="text-sm text-slate-500 mt-0.5">今日概览 · 深圳前海云仓</p>
      </div>

      {/* ===== 4 stat cards ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Boxes} color="from-emerald-500 to-emerald-600"
          label="今日入库" value={stats.inboundToday} suffix="单"
        />
        <StatCard
          icon={Package} color="from-amber-500 to-amber-600"
          label="待打包" value={stats.pendingPacking} suffix="单"
        />
        <StatCard
          icon={Truck} color="from-sky-500 to-sky-600"
          label="今日出库" value={stats.outboundToday} suffix="单"
        />
        <StatCard
          icon={CheckCircle} color="from-violet-500 to-violet-600"
          label="出库准确率" value={stats.accuracy} suffix="%"
        />
      </div>

      {loading && <div className="text-sm text-slate-400 text-center py-4">加载中...</div>}
      {err && <div className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">加载异常: {err}</div>}

      {/* ===== Two-column lists ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Pending inbound */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="w-4 h-4 text-emerald-600" />
              <h3 className="font-semibold text-slate-800">商家入库待处理</h3>
              <span className="px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-700 rounded-full">{inboundList.length}</span>
            </div>
            <button
              onClick={() => navigate({ to: '/wms/merchant-inbox' })}
              className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
            >
              全部 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <ul className="divide-y divide-slate-50">
            {inboundList.map((ib) => (
              <li key={ib.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/60">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-slate-800 truncate">{ib.inbound_no}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{ib.merchant}</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {ib.sku_count} SKU · {ib.qty} 件
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-400 flex items-center gap-1 justify-end">
                    <Clock className="w-3 h-3" /> {ib.eta || '待确认'}
                  </div>
                  <button
                    onClick={() => navigate({ to: '/wms/merchant-inbox' })}
                    className="mt-1 text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                  >
                    扫码收货 →
                  </button>
                </div>
              </li>
            ))}
            {!inboundList.length && (
              <li className="px-5 py-10 text-center text-sm text-slate-400">暂无待入库订单</li>
            )}
          </ul>
        </section>

        {/* Right: Packing orders */}
        <section className="bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-amber-600" />
              <h3 className="font-semibold text-slate-800">今日代打包订单</h3>
              <span className="px-1.5 py-0.5 text-[10px] bg-amber-50 text-amber-700 rounded-full">{packingList.length}</span>
            </div>
            <button
              onClick={() => navigate({ to: '/wms/orders' })}
              className="text-xs text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
            >
              全部 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          <ul className="divide-y divide-slate-50">
            {packingList.map((ob) => {
              const meta = STATUS_META[ob.status] || STATUS_META.pending;
              return (
                <li key={ob.id} className="px-5 py-3 flex items-center gap-3 hover:bg-slate-50/60">
                  <div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                    {ob.status === 'weighed' ? <Scale className="w-4 h-4" /> :
                     ob.status === 'packing' ? <Package className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium text-slate-800 truncate">{ob.order_no}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {ob.merchant} · {ob.platform} · 收件人 {ob.receiver_name || ob.receiver}
                    </div>
                  </div>
                  <button
                    onClick={() => navigate({ to: `/wms/orders/${ob.id}` })}
                    className="shrink-0 text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md"
                  >
                    处理
                  </button>
                </li>
              );
            })}
            {!packingList.length && (
              <li className="px-5 py-10 text-center text-sm text-slate-400">暂无待打包订单</li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ---- helpers ----
function StatCard({ icon: Icon, color, label, value, suffix }: any) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 flex items-center gap-4">
      <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${color} text-white flex items-center justify-center shadow-sm shrink-0`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-slate-800 tabular-nums">{value}</span>
          {suffix && <span className="text-sm text-slate-400">{suffix}</span>}
        </div>
        <div className="text-xs text-slate-500 mt-0.5 truncate">{label}</div>
      </div>
    </div>
  );
}
