import { useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Store, Link2, Plus } from 'lucide-react';

const PLATFORMS = ['Shopify', 'TikTok Shop', 'Shopee', 'Lazada', 'Amazon', 'eBay', 'WooCommerce'];

export async function MerchantShopsPage() {
  const { merchantId } = await getAuthContext();
  if (!merchantId) return <div>未登录</div>;
  const { data, error } = await supabase
    .from('tlv_merchant_shops').select('*').eq('merchant_id', merchantId);
  if (error) console.error(error);
  return <ShopsView merchantId={merchantId} shops={data || []} />;
}

function ShopsView({ merchantId, shops }: any) {
  const [list, setList] = useState<any[]>(shops);
  const [form, setForm] = useState({ platform: 'Shopify', shop_name: '', api_token: '' });
  const [connecting, setConnecting] = useState(false);
  const [msg, setMsg] = useState('');

  async function connect(e: React.FormEvent) {
    e.preventDefault(); setMsg('');
    if (!form.shop_name.trim()) { setMsg('请填写店铺名称'); return; }
    setConnecting(true);
    try {
      const { error } = await supabase.from('tlv_merchant_shops').insert({
        merchant_id: merchantId, platform: form.platform, shop_name: form.shop_name,
        api_token: form.api_token || null, status: 'connected',
      });
      if (error) throw error;
      setMsg(`已成功连接 ${form.platform}: ${form.shop_name}`);
      setForm({ platform: 'Shopify', shop_name: '', api_token: '' });
      const { data } = await supabase.from('tlv_merchant_shops').select('*').eq('merchant_id', merchantId);
      setList(data || []);
    } catch (e: any) { setMsg(e?.message || '连接失败'); }
    finally { setConnecting(false); }
  }

  async function disconnect(id: string) {
    const { error } = await supabase.from('tlv_merchant_shops').update({ status: 'disconnected' }).eq('id', id);
    if (!error) {
      setList((s) => s.map((x) => (x.id === id ? { ...x, status: 'disconnected' } : x)));
      setMsg('已断开连接');
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Link2 className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-slate-800">添加新店铺</h3>
        </div>
        <form onSubmit={connect} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-500">平台</label>
            <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
              {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">店铺名称</label>
            <input value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })}
              placeholder="my-shop"
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs text-slate-500">API Token (可选)</label>
            <input value={form.api_token} onChange={(e) => setForm({ ...form, api_token: e.target.value })}
              placeholder="如暂无，可留空" type="password"
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex items-end">
            <button type="submit" disabled={connecting}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium">
              <Plus className="w-4 h-4" />{connecting ? '连接中...' : '连接店铺'}
            </button>
          </div>
        </form>
        {msg && <div className="mt-3 text-sm text-green-700 bg-green-50 border border-green-100 p-2.5 rounded-lg">{msg}</div>}
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
          <Store className="w-4 h-4 text-slate-500" />
          <h3 className="font-semibold text-slate-700">已连接店铺</h3>
        </div>
        {list.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">暂无已连接店铺</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">平台</th>
                <th className="text-left px-5 py-3 font-medium">店铺名称</th>
                <th className="text-left px-5 py-3 font-medium">状态</th>
                <th className="text-left px-5 py-3 font-medium">连接时间</th>
                <th className="text-right px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {list.map((s: any) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-800">{s.platform}</td>
                  <td className="px-5 py-3 text-slate-700">{s.shop_name}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.status === 'connected' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {s.status === 'connected' ? '已连接' : '已断开'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs">{s.created_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-5 py-3 text-right">
                    {s.status === 'connected' && (
                      <button onClick={() => disconnect(s.id)} className="text-xs text-red-500 hover:text-red-700">断开</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
