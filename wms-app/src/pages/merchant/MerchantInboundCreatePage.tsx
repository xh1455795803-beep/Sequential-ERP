import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Plus, Trash2, Package } from 'lucide-react';

export function MerchantInboundCreatePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.merchantId) { setLoading(false); return; }
      setMerchantId(ctx.merchantId);
      const [wRes, pRes] = await Promise.all([
        supabase.from('tlv_warehouses').select('id, name, code'),
        supabase.from('tlv_merchant_products').select('id, sku, name').eq('merchant_id', ctx.merchantId),
      ]);
      setWarehouses(wRes.data || []);
      setProducts(pRes.data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;
  if (!merchantId) return <div>未登录</div>;

  return <InboundCreateForm merchantId={merchantId} warehouses={warehouses} products={products} navigate={navigate} />;
}

function InboundCreateForm({ merchantId, warehouses, products, navigate }: any) {
  const [form, setForm] = useState({
    warehouse_id: warehouses[0]?.id || '',
    reference_no: '',
    supplier_name: '',
    items: [{ sku: '', qty: 1 }],
  });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');

  const usedSkus = products.map((p: any) => p.sku);

  function updateItem(idx: number, field: string, val: any) {
    setForm((f: any) => {
      const items = [...f.items];
      items[idx] = { ...items[idx], [field]: val };
      return { ...f, items };
    });
  }
  function addItem() {
    setForm((f: any) => ({ ...f, items: [...f.items, { sku: '', qty: 1 }] }));
  }
  function removeItem(idx: number) {
    setForm((f: any) => ({ ...f, items: f.items.filter((_: any, i: number) => i !== idx) }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    if (!form.warehouse_id) { setMsg('请选择仓库'); return; }
    if (form.items.length === 0) { setMsg('请至少添加一个入库商品'); return; }
    for (const it of form.items) {
      if (!it.sku || !usedSkus.includes(it.sku)) { setMsg(`SKU "${it.sku}" 不存在于商家商品库`); return; }
      if (!it.qty || it.qty < 1) { setMsg(`SKU "${it.sku}" 数量必须 ≥ 1`); return; }
    }

    setSubmitting(true);
    try {
      const { data: order, error: oErr } = await supabase
        .from('tlv_inbound_orders').insert({
          merchant_id: merchantId,
          warehouse_id: form.warehouse_id,
          status: 'pending',
          reference_no: form.reference_no || null,
          supplier_name: form.supplier_name || null,
        }).select().single();
      if (oErr) throw oErr;

      const productMap: Record<string, any> = {};
      for (const p of products) productMap[p.sku] = p;

      for (const it of form.items) {
        const p = productMap[it.sku];
        await supabase.from('tlv_inbound_items').insert({
          inbound_id: order.id,
          product_id: p.id,
          sku: p.sku,
          qty: it.qty,
          expected_qty: it.qty,
          received_qty: 0,
        });
      }
      setMsg(`入库单 ${order.inbound_no || order.id} 创建成功`);
      setTimeout(() => navigate({ to: '/merchant/inbound' }), 800);
    } catch (e: any) { setMsg(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <Package className="w-5 h-5 text-blue-600" /> 创建入库单
        </h3>
        <form onSubmit={submit} className="mt-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-slate-500">目标仓库 *</label>
              <select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">供应商</label>
              <input value={form.supplier_name} onChange={(e) => setForm({ ...form, supplier_name: e.target.value })}
                placeholder="选填"
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500">参考号</label>
              <input value={form.reference_no} onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
                placeholder="采购单号/发货单号"
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-slate-500">入库商品 *</label>
              <button type="button" onClick={addItem} className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> 添加商品
              </button>
            </div>
            <div className="space-y-2">
              {form.items.map((it: any, idx: number) => (
                <div key={idx} className="flex gap-2 items-center">
                  <select value={it.sku} onChange={(e) => updateItem(idx, 'sku', e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white font-mono">
                    <option value="">选择 SKU</option>
                    {products.map((p: any) => <option key={p.id} value={p.sku}>{p.sku} - {p.name}</option>)}
                  </select>
                  <input type="number" min={1} value={it.qty} onChange={(e) => updateItem(idx, 'qty', Number(e.target.value))}
                    className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm tabular-nums text-right" />
                  <button type="button" onClick={() => removeItem(idx)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {msg && <div className="text-sm bg-amber-50 text-amber-700 border border-amber-100 p-2.5 rounded-lg">{msg}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => navigate({ to: '/merchant/inbound' })}
              className="px-5 py-2 border border-slate-200 rounded-lg text-slate-600 text-sm hover:bg-slate-50">取消</button>
            <button type="submit" disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium">
              {submitting ? '创建中...' : '提交入库单'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
