import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Loader2, Plus, X } from 'lucide-react';

const MERCHANT_ID = '00000000-0000-0000-0000-000000000101';

export function MerchantInboundCreatePage() {
  const navigate = useNavigate();
  const [tracking_no, setTrackingNo] = useState('');
  const [carrier, setCarrier] = useState('');
  const [warehouse_id, setWh] = useState('');
  const [items, setItems] = useState<{ sku: string; qty: number }[]>([{ sku: '', qty: 1 }]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.from('tlv_warehouses').select('id, name').then(({ data }) => data && setWarehouses(data));
    supabase.from('tlv_merchant_products').select('sku, name').eq('merchant_id', MERCHANT_ID).then(({ data }) => data && setProducts(data));
  }, []);

  function updateItem(i: number, key: 'sku' | 'qty', val: any) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));
  }
  function addItem() { setItems((p) => [...p, { sku: '', qty: 1 }]); }
  function removeItem(i: number) { setItems((p) => p.filter((_, idx) => idx !== i)); }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!tracking_no.trim()) return setErr('请填写 tracking_no');
    if (!warehouse_id) return setErr('请选择仓库');
    const valid = items.filter((it) => it.sku && it.qty > 0);
    if (valid.length === 0) return setErr('请至少添加一条 SKU');

    setSubmitting(true);
    try {
      const { data: order, error } = await supabase
        .from('tlv_inbound_orders')
        .insert({
          merchant_id: MERCHANT_ID, tracking_no, carrier: carrier || null,
          warehouse_id, status: 'PENDING',
        })
        .select('id')
        .single();
      if (error) throw error;

      const { error: itemErr } = await supabase.from('tlv_inbound_items').insert(
        valid.map((it) => ({ inbound_id: order!.id, sku: it.sku, qty: it.qty }))
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Tracking No.*" value={tracking_no} onChange={setTrackingNo} placeholder="物流单号" />
          <Field label="承运商" value={carrier} onChange={setCarrier} placeholder="DHL / UPS / 顺丰..." />
          <div>
            <label className="text-sm text-slate-600 font-medium">仓库 *</label>
            <select value={warehouse_id} onChange={(e) => setWh(e.target.value)}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
              <option value="">请选择</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">入库商品</label>
            <button type="button" onClick={addItem} className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <Plus className="w-4 h-4" /> 添加
            </button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={it.sku} onChange={(e) => updateItem(i, 'sku', e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                  <option value="">选择 SKU</option>
                  {products.map((p) => <option key={p.sku} value={p.sku}>{p.sku} - {p.name}</option>)}
                </select>
                <input type="number" min={1} value={it.qty} onChange={(e) => updateItem(i, 'qty', Number(e.target.value))}
                  className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                <button type="button" onClick={() => removeItem(i)} disabled={items.length === 1}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg">{err}</div>}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate({ to: '/merchant/inbound' })}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50">取消</button>
          <button type="submit" disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? '提交中...' : '提交入库单'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="text-sm text-slate-600 font-medium">{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
    </div>
  );
}
