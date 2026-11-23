import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useParams, useNavigate } from '@tanstack/react-router';
import {
  MapPin, User, Package, Truck, Scale, Loader2, ChevronLeft, ClipboardList, XCircle,
} from 'lucide-react';

const WH_ID = '00000000-0000-0000-0000-000000000001';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: '待拣货', cls: 'bg-slate-100 text-slate-700' },
  picking: { label: '拣货中', cls: 'bg-blue-50 text-blue-700' },
  packing: { label: '打包中', cls: 'bg-amber-50 text-amber-700' },
  weighed: { label: '已称重', cls: 'bg-purple-50 text-purple-700' },
  shipped: { label: '已出库', cls: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: '已取消', cls: 'bg-red-50 text-red-700' },
};

const FLOW = [
  { from: 'pending', to: 'picking', label: '确认拣货', timeKey: 'picked_at' },
  { from: 'picking', to: 'packing', label: '开始打包', timeKey: 'packed_at' },
  { from: 'packing', to: 'weighed', label: '称重完成', timeKey: 'weighed_at' },
  { from: 'weighed', to: 'shipped', label: '确认出库', timeKey: 'shipped_at' },
];

const FALLBACK = {
  id: 'ob-demo', order_no: 'OB20261123002', merchant_name: '星辰电子', platform: 'Shopee',
  status: 'weighed', tracking_no: 'SPX-MY-88291023', cod_amount: 0,
  receiver_name: 'Alex Chen', receiver_phone: '+60 12-8899123',
  receiver_address: 'Jalan Petaling 123, Kuala Lumpur, 50000, MY',
  weight: 1.25, created_at: '2026-11-23T08:12:00Z', picked_at: '2026-11-23T09:02:00Z',
  packed_at: '2026-11-23T10:30:00Z', weighed_at: '2026-11-23T11:15:00Z', shipped_at: null,
  items: [
    { sku: 'CH-001', product_name: 'USB-C 充电线 1m', qty: 2, location: 'A-01-01' },
    { sku: 'CH-003', product_name: 'USB-C 快充头 65W', qty: 1, location: 'A-02-01' },
  ],
};

export function WmsOrderDetailPage() {
  const params = useParams({ strict: false } as any);
  const navigate = useNavigate();
  const id = (params as any).id as string;

  const [row, setRow] = useState<any>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [weight, setWeight] = useState('');
  const [track, setTrack] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { load(); }, [id]);

  async function load() {
    try {
      const { data, error } = await supabase
        .from('tlv_outbound_orders')
        .select('*, tlv_outbound_order_items(*)')
        .eq('id', id)
        .eq('warehouse_id', WH_ID)
        .single();
      if (error || !data) throw new Error(error?.message || '订单未找到');
      setRow({ ...data, items: (data as any).tlv_outbound_order_items || [] });
    } catch (e: any) {
      setErr(e.message);
      if (!row) setRow(FALLBACK);
    } finally {
      setLoading(false);
    }
  }

  async function advance() {
    const step = FLOW.find((s) => s.from === row.status);
    if (!step) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const patch: any = { status: step.to, [step.timeKey]: now };
      if (step.to === 'weighed' && weight) patch.weight_kg = parseFloat(weight);
      if (step.to === 'shipped' && track) patch.tracking_no = track;
      const { error } = await supabase.from('tlv_outbound_orders').update(patch).eq('id', row.id);
      if (error) throw error;
      await load();
    } catch (e: any) {
      alert('操作失败: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  const currentFlow = FLOW.find((s) => s.from === row.status);
  const meta = STATUS_META[row.status] || STATUS_META.pending;

  if (loading) {
    return (
      <div className="p-12 flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载订单...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate({ to: '/wms/orders' })} className="p-2 hover:bg-white rounded-lg">
          <ChevronLeft className="w-5 h-5 text-slate-500" />
        </button>
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <span className="font-mono">{row.order_no}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">{row.merchant_name} · {row.platform}</p>
        </div>
      </div>

      {err && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">读取异常 · {err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Receiver */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><User className="w-4 h-4 text-emerald-600" />收件人信息</h3>
          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex justify-between"><span className="text-slate-400">姓名</span><b className="text-slate-800">{row.receiver_name}</b></div>
            <div className="flex justify-between"><span className="text-slate-400">电话</span><b className="text-slate-800">{row.receiver_phone || '-'}</b></div>
            <div className="flex justify-between items-start"><span className="text-slate-400">地址</span><span className="text-right max-w-[70%]">{row.receiver_address || '-'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">COD</span><b className={row.cod_amount ? 'text-amber-600' : 'text-slate-400'}>{row.cod_amount ? `¥${row.cod_amount}` : '否'}</b></div>
          </div>
        </div>

        {/* Items */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 lg:col-span-2">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-emerald-600" />商品明细</h3>
          <div className="divide-y divide-slate-100">
            {(row.items || []).map((it: any, i: number) => (
              <div key={i} className="py-2 flex items-center gap-3 text-sm">
                <span className="font-mono font-semibold text-emerald-700">{it.sku}</span>
                <span className="flex-1 text-slate-700">{it.product_name}</span>
                <span className="text-xs text-slate-500">{it.location || '-'}</span>
                <span className="font-semibold text-slate-800 tabular-nums">×{it.qty}</span>
              </div>
            ))}
            {(!row.items || !row.items.length) && <div className="text-sm text-slate-400 py-3">无明细</div>}
          </div>
        </div>

        {/* Timeline + Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 lg:col-span-3">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-emerald-600" />时间线与操作</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            {[
              { label: '创建', t: row.created_at },
              { label: '拣货完成', t: row.picked_at },
              { label: '打包完成', t: row.packed_at },
              { label: '称重完成', t: row.weighed_at },
              { label: '出库', t: row.shipped_at },
            ].map((s, i) => (
              <div key={i} className={`p-3 rounded-lg border ${s.t ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                <div className="font-medium">{s.label}</div>
                <div className="text-[10px] mt-0.5">{s.t ? new Date(s.t).toLocaleString() : '—'}</div>
              </div>
            ))}
          </div>

          {currentFlow && (
            <div className="mt-5 p-4 border border-emerald-100 bg-emerald-50 rounded-lg">
              <div className="font-medium text-emerald-800 mb-3">下一步: {currentFlow.label}</div>
              {currentFlow.to === 'weighed' && (
                <div className="flex items-center gap-2 mb-3">
                  <Scale className="w-4 h-4 text-slate-500" />
                  <input value={weight} onChange={(e) => setWeight(e.target.value)}
                    placeholder="包裹重量 (kg)" type="number" step="0.01"
                    className="px-3 py-2 w-40 border border-slate-200 rounded-md text-sm" />
                </div>
              )}
              {currentFlow.to === 'shipped' && (
                <div className="flex items-center gap-2 mb-3">
                  <Truck className="w-4 h-4 text-slate-500" />
                  <input value={track} onChange={(e) => setTrack(e.target.value)}
                    placeholder="物流跟踪号"
                    className="flex-1 max-w-md px-3 py-2 border border-slate-200 rounded-md text-sm" />
                </div>
              )}
              <button disabled={busy} onClick={advance}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-md text-sm font-medium flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                {currentFlow.label}
              </button>
            </div>
          )}
          {!currentFlow && row.status !== 'shipped' && (
            <div className="mt-5 text-sm text-slate-500">
              <XCircle className="w-4 h-4 inline mr-1" /> 订单已终态或被取消
            </div>
          )}
          {row.status === 'shipped' && (
            <div className="mt-5 text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg p-3">
              <Truck className="w-4 h-4 inline mr-1" /> 已出库 · 跟踪号 <b className="font-mono">{row.tracking_no || '-'}</b>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
