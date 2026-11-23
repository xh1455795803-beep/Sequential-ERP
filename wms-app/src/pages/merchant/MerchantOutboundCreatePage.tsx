import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase, getAuthContext } from '../../lib/supabase';
import { ArrowLeft, Plus, X } from 'lucide-react';

const PLATFORMS = ['MANUAL', 'Shopify', 'TikTok Shop', 'Shopee', 'Lazada', 'Amazon'];
const COUNTRIES = ['CN', 'US', 'GB', 'DE', 'FR', 'JP', 'KR', 'SG', 'MY', 'TH', 'VN', 'ID', 'PH'];
const CARRIERS = ['DHL', 'UPS', 'FedEx', 'USPS', 'Aramex', '顺丰国际', '燕文'];

export async function MerchantOutboundCreatePage() {
  const { merchantId } = await getAuthContext();
  if (!merchantId) return <div>未登录</div>;
  const { data: products } = await supabase
    .from('tlv_merchant_products').select('sku, name').eq('merchant_id', merchantId);
  const { data: merchant } = await supabase
    .from('tlv_merchants').select('warehouse_id, business_name').eq('id', merchantId).maybeSingle();
  return <OutboundCreateView merchantId={merchantId} merchant={merchant} products={products || []} />;
}

function OutboundCreateView({ merchantId, merchant, products }: any) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    platform: 'MANUAL', receiver_name: '', receiver_phone: '', receiver_address: '',
    receiver_country: 'US', carrier: '', is_cod: false, cod_amount: '',
  });
  const [items, setItems] = useState<{ sku: string; qty: number }[]>([{ sku: '', qty: 1 }]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  const upd = (i: number, key: 'sku' | 'qty', val: any) =>
    setItems((p) => p.map((it, idx) => (idx === i ? { ...it, [key]: val } : it)));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!form.receiver_name.trim() || !form.receiver_address.trim()) return setErr('请填写收件人信息');
    if (!merchant?.warehouse_id) return setErr('商家未绑定仓库，请联系管理员');
    const valid = items.filter((it) => it.sku && it.qty > 0);
    if (valid.length === 0) return setErr('请至少添加一条 SKU');
    setSubmitting(true);
    try {
      const orderNo = 'SO' + Date.now();
      const { data: order, error } = await supabase.from('tlv_outbound_orders').insert({
        warehouse_id: merchant.warehouse_id,
        merchant_id: merchantId,
        merchant_name: merchant.business_name,
        order_no: orderNo,
        source: 'MANUAL',
        platform: form.platform,
        receiver_name: form.receiver_name,
        receiver_phone: form.receiver_phone || null,
        receiver_address: form.receiver_address,
        receiver_country: form.receiver_country,
        carrier: form.carrier || null,
        is_cod: form.is_cod,
        cod_amount: form.is_cod && form.cod_amount ? parseFloat(form.cod_amount) : null,
        status: 'pending',
        total_charge: 0,
      }).select('id').single();
      if (error) throw error;
      const { error: iErr } = await supabase.from('tlv_outbound_items').insert(
        valid.map((it) => ({ outbound_id: order!.id, sku: it.sku, qty: it.qty }))
      );
      if (iErr) throw iErr;
      navigate({ to: '/merchant/orders' });
    } catch (e: any) { setErr(e?.message || '创建失败'); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate({ to: '/merchant/orders' })} className="p-2 hover:bg-slate-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h2 className="text-lg font-semibold text-slate-800">手动创建出库单</h2>
      </div>
      <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-slate-100 p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <S label="平台" value={form.platform} onChange={(v) => setForm({ ...form, platform: v })} options={PLATFORMS} />
          <S label="目的国" value={form.receiver_country} onChange={(v) => setForm({ ...form, receiver_country: v })} options={COUNTRIES} />
          <S label="物流渠道" value={form.carrier} onChange={(v) => setForm({ ...form, carrier: v })} options={['', ...CARRIERS]} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <F label="收件人 *" value={form.receiver_name} onChange={(v) => setForm({ ...form, receiver_name: v })} />
          <F label="联系电话" value={form.receiver_phone} onChange={(v) => setForm({ ...form, receiver_phone: v })} />
          <div>
            <label className="text-sm text-slate-600 font-medium">货到付款 (COD)</label>
            <label className="mt-1 flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_cod} onChange={(e) => setForm({ ...form, is_cod: e.target.checked })} className="w-4 h-4 accent-blue-600" />
              <span className="text-sm text-slate-600">启用 COD</span>
            </label>
          </div>
        </div>
        <F label="收件地址 *" value={form.receiver_address} onChange={(v) => setForm({ ...form, receiver_address: v })} />
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700">出库商品</label>
            <button type="button" onClick={() => setItems((p) => [...p, { sku: '', qty: 1 }])}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
              <Plus className="w-4 h-4" /> 添加
            </button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex gap-2 items-center">
                <select value={it.sku} onChange={(e) => upd(i, 'sku', e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                  <option value="">选择 SKU</option>
                  {products.map((p: any) => <option key={p.sku} value={p.sku}>{p.sku} - {p.name}</option>)}
                </select>
                <input type="number" min={1} value={it.qty} onChange={(e) => upd(i, 'qty', Number(e.target.value))}
                  className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                <button type="button" onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))} disabled={items.length === 1}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-30"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg">{err}</div>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate({ to: '/merchant/orders' })}
            className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50">取消</button>
          <button type="submit" disabled={submitting}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium">
            {submitting ? '提交中...' : '提交出库单'}
          </button>
        </div>
      </form>
    </div>
  );
}

function F({ label, value, onChange }: any) {
  return <div>
    <label className="text-sm text-slate-600 font-medium">{label}</label>
    <input value={value} onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
  </div>;
}
function S({ label, value, onChange, options }: any) {
  return <div>
    <label className="text-sm text-slate-600 font-medium">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
      {options.map((o: string) => <option key={o} value={o}>{o || '--'}</option>)}
    </select>
  </div>;
}
