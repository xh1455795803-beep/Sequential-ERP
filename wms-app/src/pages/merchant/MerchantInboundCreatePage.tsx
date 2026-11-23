import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { ArrowLeft, Plus, X } from 'lucide-react';

export async function MerchantInboundCreatePage() {
  const { merchantId } = await getAuthContext();
  if (!merchantId) return <div>未登录</div>;
  const [merchantRes, prodRes] = await Promise.all([
    supabase.from('tlv_merchants').select('warehouse_id, business_name').eq('id', merchantId).maybeSingle(),
    supabase.from('tlv_merchant_products').select('sku, name').eq('merchant_id', merchantId),
  ]);
  return <InboundCreateView merchantId={merchantId} merchant={merchantRes.data} products={prodRes.data || []} />;
}

function InboundCreateView({ merchantId, merchant, products }: any) {
  const navigate = useNavigate();
  const [tracking_no, setTrackingNo] = useState('');
  const [carrier, setCarrier] = useState('');
  const [items, setItems] = useState<{ sku: string; product_name: string; expected_qty: number; location: string }[]>([{ sku: '', product_name: '', expected_qty: 1, location: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  function upd(i: number, key: 'sku' | 'product_name' | 'expected_qty' | 'location', val: any) {
    setItems((p) => p.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!merchant?.warehouse_id) return setErr('商家未绑定仓库，请联系管理员');
    const valid = items.filter((it) => it.sku && it.expected_qty > 0);
    if (valid.length === 0) return setErr('请至少添加一条 SKU');
    setSubmitting(true);
    try {
      const inboundNo = 'IN' + Date.now();
      const skuCount = valid.length;
      const totalQty = valid.reduce((s, it) => s + it.expected_qty, 0);
      const { data: order, error } = await supabase.from('tlv_inbound_orders')
        .insert({
          warehouse_id: merchant.warehouse_id,
          merchant_id: merchantId,
          merchant_name: merchant.business_name,
          inbound_no: inboundNo,
          source: 'MANUAL',
          tracking_no: tracking_no || null,
          carrier: carrier || null,
          status: 'pending',
          sku_count: skuCount,
          total_qty: totalQty,
        })
        .select('id').single();
      if (error) throw error;
      const { error: itemErr } = await supabase.from('tlv_inbound_items').insert(
        valid.map((it) => ({
          inbound_id: order!.id,
          sku: it.sku,
          product_name: it.product_name,
          expected_qty: it.expected_qty,
          location: it.location || null,
          status: 'pending',
        }))
      );
      if (itemErr) throw itemErr;
      navigate({ to: '/merchant/inbound' });
    } catch (e: any) { setErr(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate({ to: '/merchant/inbound' })} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h2 className="text-lg font-semibold text-slate-800">创建入库单</h2>
      </div>
      <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-5">
        {merchant?.warehouse_id && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 text-sm text-emerald-700">
            入库仓库: {merchant.business_name} 绑定的仓库 (ID: {merchant.warehouse_id})
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <F label="Tracking No." value={tracking_no} onChange={setTrackingNo} placeholder="物流单号 (选填)" />
          <F label="承运商" value={carrier} onChange={setCarrier} placeholder="DHL / UPS / 顺丰..." />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">入库商品</label>
            <button type="button" onClick={() => setItems((p) => [...p, { sku: '', product_name: '', expected_qty: 1, location: '' }])}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <Plus className="w-4 h-4" /> 添加
            </button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-center flex-wrap">
                <select value={it.sku} onChange={(e) => {
                  const sku = e.target.value;
                  const prod = products.find((p: any) => p.sku === sku);
                  upd(i, 'sku', sku);
                  if (prod && !it.product_name) upd(i, 'product_name', prod.name);
                }}
                  className="flex-1 min-w-[150px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                  <option value="">选择 SKU</option>
                  {products.map((p: any) => <option key={p.sku} value={p.sku}>{p.sku} - {p.name}</option>)}
                </select>
                <input value={it.product_name} onChange={(e) => upd(i, 'product_name', e.target.value)}
                  placeholder="商品名" className="flex-1 min-w-[120px] px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                <input type="number" min={1} value={it.expected_qty} onChange={(e) => upd(i, 'expected_qty', Number(e.target.value))}
                  className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm" placeholder="数量" />
                <input value={it.location} onChange={(e) => upd(i, 'location', e.target.value)}
                  placeholder="库位" className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                <button type="button" onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))} disabled={items.length === 1}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg">{err}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate({ to: '/merchant/inbound' })}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50">取消</button>
          <button type="submit" disabled={submitting}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium">
            {submitting ? '提交中...' : '提交入库单'}
          </button>
        </div>
      </form>
    </div>
  );
}

function F({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-sm text-slate-600 font-medium">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}
