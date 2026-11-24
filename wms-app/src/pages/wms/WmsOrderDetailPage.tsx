import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { useParams, useNavigate } from '@tanstack/react-router';
import { MapPin, User, Package, Truck, Scale, Loader2, ChevronLeft, ClipboardList, FileText, AlertTriangle, Download, Printer, QrCode } from 'lucide-react';

const SM: Record<string, { l: string; c: string }> = {
  pending: { l: '待拣货', c: 'bg-slate-100 text-slate-700' }, picking: { l: '拣货中', c: 'bg-blue-50 text-blue-700' },
  packing: { l: '打包中', c: 'bg-amber-50 text-amber-700' }, weighed: { l: '已称重', c: 'bg-purple-50 text-purple-700' },
  shipped: { l: '已出库', c: 'bg-emerald-50 text-emerald-700' }, cancelled: { l: '已取消', c: 'bg-red-50 text-red-700' },
};

const FLOW = [
  { f: 'pending', t: 'picking', l: '确认拣货', k: 'picked_at' },
  { f: 'picking', t: 'packing', l: '开始打包', k: 'packed_at' },
  { f: 'packing', t: 'weighed', l: '完成称重计费', k: 'weighed_at' },
  { f: 'weighed', t: 'shipped', l: '确认出库', k: 'shipped_at' },
];

export function WmsOrderDetailPage() {
  const params = useParams({ strict: false } as any);
  const id = (params as any).id as string;
  const navigate = useNavigate();
  const [wid, setWid] = useState<string | null>(null);
  const [row, setRow] = useState<any>(null);
  const [ops, setOps] = useState<any[]>([]);
  const [ld, setLd] = useState(true);
  const [err, setErr] = useState('');
  const [w, setW] = useState('');
  const [track, setTrack] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) return;
      setWid(ctx.warehouseId);
      try {
        const { data, error } = await supabase.from('tlv_outbound_orders').select('*, tlv_outbound_items(*)').eq('id', id).eq('warehouse_id', ctx.warehouseId).single();
        if (error || !data) throw new Error(error?.message || '订单未找到');
        setRow({ ...data, items: (data as any).tlv_outbound_items || [] });
        const { data: o } = await supabase.from('tlv_outbound_operations').select('id, operation_type, status_from, status_to, weight_kg, charge_amount, operator_note, created_at').eq('outbound_id', id).order('created_at', { ascending: false });
        setOps(o || []);
      } catch (e: any) { setErr(e.message); }
      finally { setLd(false); }
    })();
  }, [id]);

  async function advance() {
    if (!row || !wid) return;
    const st = FLOW.find(s => s.f === row.status);
    if (!st) return;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const patch: any = { status: st.t, [st.k]: now };
      if (st.t === 'weighed') {
        const wg = parseFloat(w);
        if (!wg || wg <= 0) { alert('请输入有效的重量(kg)'); setBusy(false); return; }
        patch.weight_kg = wg;
        const { data: fee, error: re } = await supabase.rpc('calc_outbound_charge', { p_outbound_id: row.id, p_weight_kg: wg });
        if (re) throw re;
        if (fee) patch.charge_amount = fee;
        await supabase.from('tlv_outbound_operations').insert({ outbound_id: row.id, operation_type: 'weigh', status_from: row.status, status_to: st.t, weight_kg: wg, charge_amount: fee ?? null, operator_note: '称重计费完成', warehouse_id: wid });
      } else {
        await supabase.from('tlv_outbound_operations').insert({ outbound_id: row.id, operation_type: st.l, status_from: row.status, status_to: st.t, warehouse_id: wid, created_at: now });
      }
      if (st.t === 'shipped' && track) patch.tracking_no = track;
      const { error } = await supabase.from('tlv_outbound_orders').update(patch).eq('id', row.id);
      if (error) throw error;
      // reload
      const { data } = await supabase.from('tlv_outbound_orders').select('*, tlv_outbound_items(*)').eq('id', id).eq('warehouse_id', wid).single();
      setRow({ ...data, items: (data as any).tlv_outbound_items || [] });
      const { data: o } = await supabase.from('tlv_outbound_operations').select('id, operation_type, status_from, status_to, weight_kg, charge_amount, operator_note, created_at').eq('outbound_id', id).order('created_at', { ascending: false });
      setOps(o || []);
    } catch (e: any) { alert('操作失败: ' + e.message); }
    finally { setBusy(false); }
  }

  if (!wid) return <div className="p-12 text-center text-slate-500">未登录</div>;
  if (ld) return <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载订单...</div>;
  if (!row) return <div className="p-12 text-center text-slate-500">订单未找到</div>;

  const st = FLOW.find(s => s.f === row.status);
  const meta = SM[row.status] || SM.pending;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate({ to: '/wms/orders' })} className="p-2 hover:bg-white rounded-lg"><ChevronLeft className="w-5 h-5 text-slate-500" /></button>
        <div><h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><span className="font-mono">{row.order_no}</span>
          <span className={`text-[11px] px-2 py-0.5 rounded-full ${meta.c}`}>{meta.l}</span>
          {row.is_cod && <span className="text-[10px] px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full font-semibold">COD ¥{row.cod_amount || 0}</span>}
        </h2><p className="text-sm text-slate-500 mt-0.5">{row.merchant_name} · {row.platform} · 创建于 {new Date(row.created_at).toLocaleString('zh-CN')}</p></div>
      </div>

      {row.status === 'balance_hold' && (
        <div className="p-4 border border-red-200 bg-red-50 rounded-lg flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-red-800">⚠ 余额不足</div>
            <div className="text-sm text-red-700 mt-0.5">{row.merchant_note || '当前商家钱包余额不足以支付本次出库预计扣费'}</div>
            <div className="text-xs text-red-600 mt-1">
              预计扣费 <b>¥{(row.estimated_fee ?? 0).toFixed(2)}</b> · 请通知商家充值后再处理
            </div>
          </div>
        </div>
      )}

      {err && <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{err}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><User className="w-4 h-4 text-emerald-600" />收件人</h3>
          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex justify-between"><span className="text-slate-400">姓名</span><b className="text-slate-800">{row.receiver_name}</b></div>
            <div className="flex justify-between"><span className="text-slate-400">电话</span><b className="text-slate-800">{row.receiver_phone || '-'}</b></div>
            <div className="flex justify-between items-start"><span className="text-slate-400">地址</span><span className="text-right max-w-[70%]">{row.receiver_address || '-'}</span></div>
            <div className="flex justify-between"><span className="text-slate-400">COD</span><b className={row.cod_amount ? 'text-amber-600' : 'text-slate-400'}>{row.cod_amount ? `¥${row.cod_amount}` : '否'}</b></div>
            {row.weight_kg && <div className="flex justify-between"><span className="text-slate-400">包裹重量</span><b className="text-slate-800">{row.weight_kg} kg</b></div>}
            {row.estimated_fee != null && (
              <div className="border-t border-slate-100 mt-2 pt-2">
                <div className="flex justify-between"><span className="text-slate-400">预计扣费</span><b className={row.balance_deducted ? 'text-slate-800' : 'text-red-600'}>¥{row.estimated_fee.toFixed(2)}</b></div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  {row.items?.length || 0}件 × ¥3.00 + {row.weight_kg ? `${row.weight_kg}kg × ¥4.00/kg` : '最低¥2.00'}
                </div>
              </div>
            )}
            {row.charge_amount != null && (
              <div className="flex justify-between"><span className="text-slate-400">实际扣费</span><b className="text-emerald-700">¥{row.charge_amount}</b></div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 lg:col-span-2">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2"><Package className="w-4 h-4 text-emerald-600" />商品明细</h3>
          <div className="divide-y divide-slate-100">
            {(row.items || []).map((it: any, i: number) => (
              <div key={i} className="py-2 flex items-center gap-3 text-sm"><span className="font-mono font-semibold text-emerald-700">{it.sku}</span><span className="flex-1 text-slate-700">{it.product_name}</span><span className="text-xs text-slate-500">{it.location || '-'}</span><span className="font-semibold text-slate-800 tabular-nums">×{it.qty}</span></div>
            ))}
            {(!row.items || !row.items.length) && <div className="text-sm text-slate-400 py-3">无明细</div>}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 lg:col-span-3">
          <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-emerald-600" />时间线与操作</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            {[{ l: '创建', t: row.created_at }, { l: '拣货完成', t: row.picked_at }, { l: '打包完成', t: row.packed_at }, { l: '称重完成', t: row.weighed_at }, { l: '出库', t: row.shipped_at }].map((s, i) => (
              <div key={i} className={`p-3 rounded-lg border ${s.t ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-slate-50 border-slate-100 text-slate-400'}`}><div className="font-medium">{s.l}</div><div className="text-[10px] mt-0.5">{s.t ? new Date(s.t).toLocaleString() : '—'}</div></div>
            ))}
          </div>
          {st && row.status !== 'balance_hold' && (
            <div className="mt-5 p-4 border border-emerald-100 bg-emerald-50 rounded-lg">
              <div className="font-medium text-emerald-800 mb-3">下一步: {st.l}</div>
              {st.t === 'weighed' && <div className="flex items-center gap-2 mb-3"><Scale className="w-4 h-4 text-slate-500" /><input value={w} onChange={(e) => setW(e.target.value)} placeholder="包裹重量 (kg)" type="number" step="0.01" className="px-3 py-2 w-40 border border-slate-200 rounded-md text-sm" /></div>}
              {st.t === 'shipped' && (
                <div className="flex items-center gap-2 mb-3">
                  <Truck className="w-4 h-4 text-slate-500" />
                  <input value={track} onChange={(e) => setTrack(e.target.value)} placeholder="物流跟踪号" className="flex-1 max-w-md px-3 py-2 border border-slate-200 rounded-md text-sm" />
                  <button onClick={() => alert('调用 generate-label-pdf Edge Function 下载面单 PDF')}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs inline-flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5" /> 生成面单
                  </button>
                  <button onClick={() => alert('打印拣货单功能')}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-xs inline-flex items-center gap-1.5">
                    <Printer className="w-3.5 h-3.5" /> 打印拣货单
                  </button>
                </div>
              )}
              <button disabled={busy} onClick={advance} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-md text-sm font-medium flex items-center gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}{st.l}</button>
            </div>
          )}
          {row.status === 'balance_hold' && (
            <div className="mt-5 flex gap-2">
              <button onClick={() => alert('通知商家充值 — 通过 MerchantShopsPage 或钱包充值页')}
                className="px-3 py-2 text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-md inline-flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> 通知商家充值
              </button>
              <button onClick={() => alert('管理员手动扣除商家余额后放行')}
                className="px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md inline-flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> 手动放行
              </button>
            </div>
          )}
          {ops.length > 0 && (
            <div className="mt-5">
              <div className="text-sm font-medium text-slate-700 mb-2">操作日志</div>
              <div className="space-y-1">
                {ops.map((op: any) => (
                  <div key={op.id} className="text-xs text-slate-500 flex justify-between py-1 border-b border-slate-50"><span>{op.operation_type} {op.status_from && `[${op.status_from}→${op.status_to}]`}</span><span className="font-mono">{op.weight_kg ? `${op.weight_kg}kg` : ''}{op.charge_amount != null ? ` ¥${op.charge_amount}` : ''}</span><span>{new Date(op.created_at).toLocaleString()}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
