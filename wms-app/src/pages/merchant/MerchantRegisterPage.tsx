import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../../lib/supabase';
import { ShoppingCart, Loader2 } from 'lucide-react';

const COUNTRIES = [
  { code: 'CN', name: '中国' }, { code: 'US', name: '美国' }, { code: 'GB', name: '英国' },
  { code: 'DE', name: '德国' }, { code: 'FR', name: '法国' }, { code: 'JP', name: '日本' },
  { code: 'KR', name: '韩国' }, { code: 'SG', name: '新加坡' }, { code: 'MY', name: '马来西亚' },
  { code: 'TH', name: '泰国' }, { code: 'VN', name: '越南' }, { code: 'ID', name: '印度尼西亚' },
];

export function MerchantRegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    merchant_name: '', contact_name: '', email: '', phone: '',
    password: '', warehouse_id: '', country: 'CN',
  });
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.from('tlv_warehouses').select('id, name').then(({ data }) => {
      if (data) setWarehouses(data);
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!form.merchant_name.trim()) return setErr('请填写商户名称');
    if (!form.email.trim() || !form.password || form.password.length < 6) return setErr('请填写邮箱并设置至少 6 位密码');

    setLoading(true);
    try {
      const { data, error: sErr } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            portal_role: 'merchant',
          },
        },
      });
      if (sErr) throw sErr;
      const uid = data.user?.id;
      if (!uid) throw new Error('注册失败');

      // 仓库ID和tenant_id保持一致
      const warehouseId = form.warehouse_id || null;

      const { error: iErr } = await supabase.from('tlv_merchants').insert({
        id: uid,
        warehouse_id: warehouseId,
        business_name: form.merchant_name,
        contact_name: form.contact_name || null,
        contact_email: form.email,
        contact_phone: form.phone || null,
        country: form.country,
        balance: 0,
        frozen_balance: 0,
        status: 'pending',
      });
      if (iErr) throw iErr;

      // 写回 tenant_id 到 user_metadata（使用 RPC，如果有的话）
      try {
        await supabase.rpc('set_user_tenant_metadata', {
          p_user_id: uid,
          p_tenant_id: uid,
          p_portal_role: 'merchant',
        });
      } catch {
        // 如果 RPC 不存在，忽略错误（可能需要通过数据库 trigger 实现）
        console.warn('RPC set_user_tenant_metadata not available');
      }

      navigate({ to: '/merchant/login' });
    } catch (e: any) { setErr(e?.message || '注册失败'); }
    finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-800 via-blue-900 to-slate-900 p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6 text-white">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-7 h-7 text-yellow-300" />
            <h1 className="text-xl font-bold">注册 Thalvior 商家账户</h1>
          </div>
          <p className="text-blue-100 text-sm mt-1">开启你的跨境电商履约之旅</p>
        </div>
        <form onSubmit={submit} className="px-8 py-6 space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <F label="商户名称 *" value={form.merchant_name} onChange={(v) => setForm({ ...form, merchant_name: v })} />
            <F label="联系人" value={form.contact_name} onChange={(v) => setForm({ ...form, contact_name: v })} />
            <F label="邮箱 *" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <F label="联系电话" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
            <F label="密码 *" type="password" value={form.password} onChange={(v) => setForm({ ...form, password: v })} />
            <div>
              <label className="text-sm text-slate-600 font-medium">所在仓库</label>
              <select value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}
                className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="">请选择仓库</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-600 font-medium">所在国家/地区</label>
            <select value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
              className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white">
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </div>
          {err && <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg">{err}</div>}
          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-medium transition flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? '注册中...' : '注册新账户'}
          </button>
          <div className="text-center text-sm text-slate-500 pt-2">
            已有账号？
            <button type="button" onClick={() => navigate({ to: '/merchant/login' })}
              className="ml-1 text-blue-600 hover:text-blue-700 font-medium">返回登录</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function F({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div>
      <label className="text-sm text-slate-600 font-medium">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm" />
    </div>
  );
}
