import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { useParams, useNavigate } from '@tanstack/react-router';
import { MapPin, User, Package, Truck, Scale, Loader2, ChevronLeft, ClipboardList, FileText, AlertTriangle, Download, Printer, QrCode, CheckCircle2, ArrowRight } from 'lucide-react';

const SM: Record<string, { l: string; c: string }> = {
  pending: { l: '待拣货', c: 'bg-slate-100 text-slate-700' }, picking: { l: '拣货中', c: 'bg-blue-50 text-blue-700' },
  packing: { l: '打包中', c: 'bg-amber-50 text-amber-700' }, weighed: { l: '已称重', c: 'bg-purple-50 text-purple-700' },
  shipped: { l: '已出库', c: 'bg-emerald-50 text-emerald-700' }, cancelled: { l: '已取消', c: 'bg-red-50 text-red-700' },
  balance_hold: { l: '余额不足', c: 'bg-red-100 text-red-700' },
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
  const [toast, setToast] = useState('');

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

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 2800);
  }

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
        if (!wg || wg <= 0) { showToast('请输入有效的重量(kg)'); setBusy(false); return; }
        patch.weight_kg = wg;
        // 优先用 DB RPC，不可用时前端算: item_cnt*3 + max(weight, 0.5)*4
        let fee: number | null = null;
        try {
          const { data, error } = await supabase.rpc('calc_outbound_charge', { p_outbound_id: row.id, p_weight_kg: wg });
          if (!error && data != null) fee = Number(data);
        } catch {}
        if (fee == null) {
          const itemCnt = (row.items || []).reduce((s: number, it: any) => s + (it.qty || 0), 0);
          fee = itemCnt * 3.0 + Math.max(wg, 0.5) * 4.0;
        }
        patch.charge_amount = fee;
        await supabase.from('tlv_outbound_operations').insert({ outbound_id: row.id, operation_type: 'weigh', status_from: row.status, status_to: st.t, weight_kg: wg, charge_amount: fee, operator_note: '称重计费完成', warehouse_id: wid });
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
      showToast(`✅ 已推进到「${st.l}」`);
    } catch (e: any) { showToast('❌ 操作失败: ' + e.message); }
    finally { setBusy(false); }
  }

  // === 生成面单 — 调 Edge Function ===
  async function generateLabel() {
    if (!row) return;
    showToast('正在生成面单...');
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.access_token || '';
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL || 'https://thalvior.icu'}/functions/v1/generate-label-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ outbound_id: row.id }),
      });
      if (!resp.ok) { const t = await resp.text(); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 100)}`); }
      const res = await resp.json();
      if (!res.ok) throw new Error(res.error || '生成失败');
      const b64 = res.results?.[0]?.svg_base64;
      if (!b64) throw new Error('未返回面单数据');
      const svgStr = atob(b64);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `label-${row.order_no}.svg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('✅ 面单已下载');
    } catch (e: any) {
      // fallback: 用前端生成 SVG 面单
      const svg = buildLocalLabelSvg(row);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `label-${row.order_no}.svg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('✅ 面单已生成（离线模式）');
    }
  }

  // === 打印拣货单 — INSERT pick_list + window.print ===
  async function printPickList() {
    if (!row || !wid) return;
    showToast('正在创建拣货单...');
    try {
      const ctx = await getAuthContext();
      const { data: pl, error } = await supabase.from('tlv_pick_lists').insert({
        warehouse_id: wid,
        outbound_order_id: row.id,
        order_no: row.order_no,
        merchant_id: row.merchant_id,
        merchant_name: row.merchant_name,
        operator_email: ctx.user?.email || null,
        status: 'created',
        item_count: (row.items || []).length,
        total_qty: (row.items || []).reduce((s: number, it: any) => s + (it.qty || 0), 0),
      }).select().single();
      if (error) throw error;

      const items = (row.items || []).map((it: any) => ({
        pick_list_id: pl.id,
        product_id: it.product_id || null,
        sku: it.sku,
        location: it.location || null,
        qty: it.qty,
        picked_qty: 0,
      }));
      if (items.length) await supabase.from('tlv_pick_list_items').insert(items);

      // 打开打印窗口
      const printWin = window.open('', '_blank', 'width=800,height=600');
      if (!printWin) { showToast('⚠ 请允许弹窗后重试'); return; }
      printWin.document.write(renderPickListHtml(row, items));
      printWin.document.close();
      printWin.focus();
      setTimeout(() => printWin.print(), 400);
      showToast('✅ 拣货单已创建并发送打印');
    } catch (e: any) { showToast('❌ 失败: ' + e.message); }
  }

  // === 通知商家充值 — 弹 merchant info + 一键复制 ===
  function notifyMerchant() {
    if (!row) return;
    const msg = `【余额不足提醒】订单 ${row.order_no} 需要扣费 ¥${(row.estimated_fee ?? 0).toFixed(2)}，请尽快充值。\n商家: ${row.merchant_name}\n商家ID: ${row.merchant_id}`;
    navigator.clipboard?.writeText(msg).catch(() => {});
    alert(msg + '\n\n（已复制到剪贴板，可发送给商家）');
    showToast('✅ 通知文案已复制，可粘贴发送给商家');
  }

  // === 手动放行 — INSERT adjustment → update status ===
  async function manualRelease() {
    if (!row || !wid) return;
    if (!confirm(`确认从商家钱包手动扣除 ¥${(row.estimated_fee ?? 0).toFixed(2)} 并放行？\n此操作会创建一条调整记录。`)) return;
    showToast('正在放行...');
    try {
      const ctx = await getAuthContext();
      const fee = row.estimated_fee ?? 0;

      // 查当前最新余额
      const { data: latest } = await supabase.from('tlv_merchant_wallets')
        .select('balance_after').eq('merchant_id', row.merchant_id).order('created_at', { ascending: false }).limit(1).single();
      const currentBal = latest?.balance_after ?? 0;
      const newBal = Number((currentBal - fee).toFixed(2));

      // 插入 adjustment
      const { error: we } = await supabase.from('tlv_merchant_wallets').insert({
        merchant_id: row.merchant_id,
        warehouse_id: wid,
        type: 'adjustment',
        amount: -fee,
        balance_after: newBal,
        ref_id: row.id,
        ref_no: row.order_no,
        operator_email: ctx.user?.email || null,
        remark: `WMS 手动放行 · 订单 ${row.order_no}`,
      });
      if (we) throw we;

      // 更新订单
      const { error: oe } = await supabase.from('tlv_outbound_orders').update({
        balance_deducted: true,
        status: 'pending',
        estimated_fee: fee,
      }).eq('id', row.id);
      if (oe) throw oe;

      // reload
      const { data } = await supabase.from('tlv_outbound_orders').select('*, tlv_outbound_items(*)').eq('id', id).eq('warehouse_id', wid).single();
      setRow({ ...data, items: (data as any).tlv_outbound_items || [] });
      showToast(`✅ 已放行 · 新余额 ¥${newBal.toFixed(2)}`);
    } catch (e: any) { showToast('❌ 放行失败: ' + e.message); }
  }

  if (!wid) return <div className="p-12 text-center text-slate-500">未登录</div>;
  if (ld) return <div className="p-12 flex items-center justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin mr-2" />加载订单...</div>;
  if (!row) return <div className="p-12 text-center text-slate-500">订单未找到</div>;

  const st = FLOW.find(s => s.f === row.status);
  const meta = SM[row.status] || SM.pending;

  return (
    <div className="space-y-4 relative">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white text-sm px-4 py-2 rounded-lg shadow-xl flex items-center gap-2 animate-[fadeIn_0.2s_ease]">
          <CheckCircle2 className="w-4 h-4" /> {toast}
        </div>
      )}

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
          <div className="flex-1">
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
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Truck className="w-4 h-4 text-slate-500" />
                  <input value={track} onChange={(e) => setTrack(e.target.value)} placeholder="物流跟踪号" className="flex-1 max-w-md px-3 py-2 border border-slate-200 rounded-md text-sm" />
                  <button onClick={generateLabel}
                    className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-xs inline-flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" /> 下载面单
                  </button>
                  <button onClick={printPickList}
                    className="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-xs inline-flex items-center gap-1.5">
                    <Printer className="w-3.5 h-3.5" /> 打印拣货单
                  </button>
                </div>
              )}
              <button disabled={busy} onClick={advance} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-md text-sm font-medium flex items-center gap-2">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}{st.l}</button>
            </div>
          )}
          {row.status === 'balance_hold' && (
            <div className="mt-5 flex gap-2 flex-wrap">
              <button onClick={notifyMerchant}
                className="px-3 py-2 text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-md inline-flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> 通知商家充值
              </button>
              <button onClick={manualRelease}
                className="px-3 py-2 text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md inline-flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> 手动放行（扣费）
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

// ==================== 工具函数 ====================

// 本地 fallback SVG 面单（Edge Function 不可用时）
function buildLocalLabelSvg(row: any): string {
  const items = (row.items || []).map((it: any) => `${it.sku}×${it.qty}`).join(', ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 600" width="400" height="600">
  <rect width="400" height="600" fill="#fff"/>
  <rect x="10" y="10" width="380" height="40" fill="#1f2937"/>
  <text x="20" y="37" font-family="monospace" font-size="16" fill="#fff" font-weight="bold">THALVIOR WMS · 面单</text>
  <text x="20" y="85" font-family="monospace" font-size="12" fill="#666">订单号: ${row.order_no}</text>
  <text x="20" y="110" font-family="monospace" font-size="14" fill="#000" font-weight="bold">${row.receiver_name || '—'}</text>
  <text x="20" y="135" font-family="monospace" font-size="12" fill="#333">${row.receiver_phone || ''}</text>
  <text x="20" y="165" font-family="monospace" font-size="11" fill="#333">${row.receiver_address || ''}</text>
  ${row.is_cod ? '<rect x="280" y="70" width="100" height="40" fill="#f59e0b"/><text x="330" y="95" text-anchor="middle" font-size="12" font-weight="bold" fill="#fff">COD ¥'+(row.cod_amount||0)+'</text>' : ''}
  <rect x="20" y="185" width="360" height="1" fill="#eee"/>
  <text x="20" y="210" font-family="monospace" font-size="10" fill="#888">商家: ${row.merchant_name || ''}</text>
  <text x="20" y="228" font-family="monospace" font-size="10" fill="#888">平台: ${row.platform || ''} · 包裹重: ${row.weight_kg || '-'}kg</text>
  <text x="20" y="246" font-family="monospace" font-size="10" fill="#888">商品: ${items}</text>
  ${row.tracking_no ? '<rect x="20" y="270" width="360" height="60" fill="#0f172a"/><text x="200" y="308" text-anchor="middle" font-family="monospace" font-size="18" fill="#fff" font-weight="bold">'+row.tracking_no+'</text>' : ''}
  <text x="200" y="580" text-anchor="middle" font-size="9" fill="#aaa">Generated by Thalvior WMS</text>
</svg>`;
}

// 打印拣货单 HTML
function renderPickListHtml(row: any, items: any[]): string {
  const rowsHtml = items.map((it: any, i: number) => `
    <tr>
      <td>${i + 1}</td>
      <td style="font-family:monospace;font-weight:bold">${it.sku}</td>
      <td>${it.location || '-'}</td>
      <td style="text-align:right;font-weight:bold">${it.qty}</td>
      <td style="text-align:center;border-bottom:1px dashed #333;width:80px"></td>
    </tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>拣货单 ${row.order_no}</title>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 20px; color: #111; }
    h1 { margin: 0 0 4px 0; }
    .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
    th { background: #f3f4f6; }
    .footer { margin-top: 30px; font-size: 12px; color: #666; display:flex; justify-content:space-between; }
    @media print { body { padding: 0; } }
  </style></head><body>
  <h1>拣货单 · ${row.order_no}</h1>
  <div class="meta">商家: ${row.merchant_name} · 收件: ${row.receiver_name} ${row.receiver_phone} · ${row.receiver_address || ''}</div>
  <table>
    <thead><tr><th>#</th><th>SKU</th><th>库位</th><th style="text-align:right">数量</th><th>实拣</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="footer"><span>生成时间: ${new Date().toLocaleString()}</span><span>拣货员签字: ____________</span></div>
  </body></html>`;
}
