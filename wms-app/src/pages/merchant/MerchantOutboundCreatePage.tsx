import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Plus, Trash2, Package } from 'lucide-react';

const PLATFORMS = ['TikTok Shop', 'Shopee', 'Lazada', 'Ozon', 'Amazon', 'eBay', 'Manual'];
const CARRIERS = ['4PX', '燕文物流', '云途物流', '速卖通无忧', 'DHL', 'EMS', '其他'];

export function MerchantOutboundCreatePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [products, setProducts] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.merchantId) { setLoading(false); return; }
      setMerchantId(ctx.merchantId);
      const { data } = await supabase.from('tlv_merchant_products').select('id, sku, name').eq('merchant_id', ctx.merchantId);
      setProducts(data || []);
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;
  if (!merchantId) return <div>未登录</div>;

  return <OutboundCreateForm merchantId={merchantId} products={products} navigate={navigate} />;
}

function OutboundCreateForm({ merchantId, products, navigate }: any) {
  const [form, setForm] = useState({
    platform: PLATFORMS[0],
    order_ref: '',
    carrier: CARRIERS[0],
    receiver_name: '',
    receiver_phone: '',
    receiver_address: '',
    receiver_city: '',
    receiver_state: '',
    receiver_postal_code: '',
    receiver_country: '',
    is_cod: false,
    cod_amount: 0,
    items: [{ sku: '', qty: 1 }],
  });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState('');

  const usedSkus = products.map((p: any) => p.sku);

  function updateField(field: string, val: any) {
    setForm((f: any) => ({ ...f, [field]: val }));
  }
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
    if (!form.receiver_name.trim() || !form.receiver_address.trim() || !form.receiver_country.trim()) {
      setMsg('收件人姓名、地址、国家为必填'); return;
    }
    if (form.items.length === 0) { setMsg('请至少添加一个出库商品'); return; }
    for (const it of form.items) {
      if (!it.sku || !usedSkus.includes(it.sku)) { setMsg(`SKU "${it.sku}" 不存在于商家商品库`); return; }
      if (!it.qty || it.qty < 1) { setMsg(`SKU "${it.sku}" 数量必须 ≥ 1`); return; }
    }

    setSubmitting(true);
    try {
      const productMap: Record<string, any> = {};
      for (const p of products) productMap[p.sku] = p;

      const total_qty = form.items.reduce((s: number, it: any) => s + Number(it.qty), 0);

      const { data: order, error: oErr } = await supabase
        .from('tlv_outbound_orders').insert({
          merchant_id: merchantId,
          platform: form.platform,
          order_ref: form.order_ref || null,
          source: 'MANUAL',
          carrier: form.carrier,
          status: 'pending',
          receiver_name: form.receiver_name,
          receiver_phone: form.receiver_phone || null,
          receiver_address: form.receiver_address,
          receiver_city: form.receiver_city || null,
          receiver_state: form.receiver_state || null,
          receiver_postal_code: form.receiver_postal_code || null,
          receiver_country: form.receiver_country,
          total_qty,
          is_cod: form.is_cod,
          cod_amount: form.is_cod ? Number(form.cod_amount) : 0,
        }).select().single();
      if (oErr) throw oErr;

      for (const it of form.items) {
        const p = productMap[it.sku];
        await supabase.from('tlv_outbound_items').insert({
          outbound_id: order.id,
          product_id: p.id,
          sku: p.sku,
          qty: it.qty,
        });
      }
      setMsg(`出库单 ${order.order_no} 创建成功`);
      setTimeout(() => navigate({ to: '/merchant/orders' }), 800);
    } catch (e: any) { setMsg(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <Package className="w-5 h-5 text-blue-600" /> 创建代打包出库单
        </h3>
        <form onSubmit={submit} className="mt-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-slate-500">平台 *</label>
              <select value={form.platform} onChange={(e) => updateField('platform', e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500">外部订单号</label>
              <input value={form.order_ref} onChange={(e) => updateField('order_ref', e.target.value)}
                placeholder="平台订单号"
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500">承运商 *</label>
              <select value={form.carrier} onChange={(e) => updateField('carrier', e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                {CARRIERS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <h4 className="text-sm font-medium text-slate-700 mb-3">收件人信息</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input value={form.receiver_name} onChange={(e) => updateField('receiver_name', e.target.value)}
                placeholder="姓名 *" required
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              <input value={form.receiver_phone} onChange={(e) => updateField('receiver_phone', e.target.value)}
                placeholder="电话"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              <input value={form.receiver_address} onChange={(e) => updateField('receiver_address', e.target.value)}
                placeholder="详细地址 *" required
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              <input value={form.receiver_city} onChange={(e) => updateField('receiver_city', e.target.value)}
                placeholder="城市"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              <input value={form.receiver_state} onChange={(e) => updateField('receiver_state', e.target.value)}
                placeholder="省/州"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              <input value={form.receiver_postal_code} onChange={(e) => updateField('receiver_postal_code', e.target.value)}
                placeholder="邮编"
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
              <input value={form.receiver_country} onChange={(e) => updateField('receiver_country', e.target.value)}
                placeholder="国家 (ISO code, e.g. CN, US) *" required
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div className="border-t border-slate-100 pt-4">
            <label className="text-sm flex items-center gap-2 text-slate-700">
              <input type="checkbox" checked={form.is_cod} onChange={(e) => updateField('is_cod', e.target.checked)} />
              货到付款 (COD)
            </label>
            {form.is_cod && (
              <input type="number" min={0} step="0.01" value={form.cod_amount} onChange={(e) => updateField('cod_amount', Number(e.target.value))}
                placeholder="代收金额"
                className="mt-2 w-40 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
            )}
          </div>
          <div className="border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">出库商品 *</label>
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
            <button type="button" onClick={() => navigate({ to: '/merchant/orders' })}
              className="px-5 py-2 border border-slate-200 rounded-lg text-slate-600 text-sm hover:bg-slate-50">取消</button>
            <button type="submit" disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium">
              {submitting ? '创建中...' : '提交出库单'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
