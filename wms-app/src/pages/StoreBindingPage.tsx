import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Store, Plus, Trash2, RefreshCw, CheckCircle, XCircle, ExternalLink } from 'lucide-react';

interface StoreBinding {
  id: string;
  store_name: string;
  platform: string;
  store_id: string | null;
  is_active: boolean;
  last_order_sync_at: string | null;
  order_count_synced: number;
  erp_connection_id: string | null;
  erp_conn_name?: string;
}

const PLATFORMS = [
  { value: 'tiktok_shop', label: 'TikTok Shop', color: 'from-pink-500 to-purple-600' },
  { value: 'shopify',     label: 'Shopify',     color: 'from-emerald-500 to-green-600' },
  { value: 'shopee',      label: 'Shopee',      color: 'from-orange-500 to-red-600' },
  { value: 'amazon',      label: 'Amazon',      color: 'from-yellow-500 to-orange-600' },
  { value: 'temu',        label: 'Temu',        color: 'from-red-500 to-pink-600' },
  { value: 'manual',      label: '手动录入',    color: 'from-gray-500 to-gray-600' },
];

export default function StoreBindingPage() {
  const [stores, setStores] = useState<StoreBinding[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [erpConns, setErpConns] = useState<any[]>([]);
  const [form, setForm] = useState({
    platform: 'tiktok_shop',
    store_name: '',
    erp_connection_id: '',
  });

  useEffect(() => { load(); loadErp(); }, []);

  async function loadErp() {
    const { data } = await supabase.from('wms_erp_connections').select('*');
    setErpConns(data || []);
  }

  async function load() {
    const { data } = await supabase
      .from('wms_store_bindings')
      .select('*, wms_erp_connections(connection_name)')
      .order('created_at', { ascending: false });

    setStores((data as any || []).map((s: any) => ({
      ...s,
      erp_conn_name: s.wms_erp_connections?.connection_name,
    })));
  }

  async function saveStore() {
    if (!form.store_name.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();

    if (form.platform === 'manual') {
      // 手动录入不做 OAuth，直接保存
      await supabase.from('wms_store_bindings').insert({
        user_id: user!.id,
        platform: form.platform,
        store_name: form.store_name,
        erp_connection_id: form.erp_connection_id || null,
      });
      setShowForm(false);
      setForm({ platform: 'tiktok_shop', store_name: '', erp_connection_id: '' });
      await load();
      return;
    }

    // 真实 OAuth（演示用）——生产环境这里跳转到 TikTok/Shopify 官方 OAuth
    alert(`即将跳转到 ${PLATFORMS.find((p) => p.value === form.platform)?.label} 官方 OAuth 授权页。\n\n生产环境：\n1. 用户扫码/登录平台账号\n2. 平台返回 access_token\n3. WMS 存 token 开始自动抓订单`);
  }

  async function syncOrders(id: string) {
    await supabase.from('wms_store_bindings').update({ last_order_sync_at: new Date().toISOString(), order_count_synced: 0 }).eq('id', id);
    await load();
  }

  async function toggleActive(id: string, active: boolean) {
    await supabase.from('wms_store_bindings').update({ is_active: !active }).eq('id', id);
    await load();
  }

  async function remove(id: string) {
    if (!confirm('删除店铺绑定？')) return;
    await supabase.from('wms_store_bindings').delete().eq('id', id);
    await load();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-800">店铺绑定</h1>
          <p className="text-sm text-gray-500 mt-1">
            绑定你的电商平台店铺，订单会自动同步到 WMS 出库
          </p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-xl font-medium">
          <Plus className="w-4 h-4" />
          绑定店铺
        </button>
      </div>

      {stores.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <Store className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <h3 className="text-gray-700 font-medium mb-1">还没有绑定任何店铺</h3>
          <p className="text-sm text-gray-500">
            支持 TikTok Shop / Shopify / Shopee / Amazon / Temu
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {stores.map((s) => {
            const plat = PLATFORMS.find((p) => p.value === s.platform)!;
            return (
              <div key={s.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className={`h-2 bg-gradient-to-r ${plat.color}`} />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${plat.color} text-white flex items-center justify-center font-bold text-xs`}>
                        {plat.label.slice(0, 6)}
                      </div>
                      <div>
                        <div className="font-semibold text-gray-800">{s.store_name}</div>
                        <div className="text-xs text-gray-500">
                          {plat.label}
                          {s.erp_conn_name && <span className="text-brand-600 ml-1">· {s.erp_conn_name}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => syncOrders(s.id)} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded">
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button onClick={() => toggleActive(s.id, s.is_active)} className="p-1.5 hover:bg-gray-100 rounded">
                        {s.is_active ? <CheckCircle className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-gray-400" />}
                      </button>
                      <button onClick={() => remove(s.id)} className="p-1.5 text-red-500 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {s.is_active && (
                    <div className="mt-4 text-xs text-gray-500 flex items-center gap-3">
                      {s.last_order_sync_at && (
                        <span>上次同步：{new Date(s.last_order_sync_at).toLocaleString('zh-CN')}</span>
                      )}
                      <span>已同步 {s.order_count_synced} 单</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 新增弹窗 */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <h2 className="text-lg font-bold mb-1">绑定新店铺</h2>
            <p className="text-xs text-gray-500 mb-4">选择平台 → 授权 → 开始自动同步订单</p>

            <div className="grid grid-cols-3 gap-2 mb-4">
              {PLATFORMS.map((p) => (
                <button key={p.value} onClick={() => setForm({ ...form, platform: p.value })}
                  className={`p-3 rounded-xl border text-xs font-medium transition-all ${
                    form.platform === p.value
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">店铺名称 *</label>
                <input value={form.store_name} onChange={(e) => setForm({ ...form, store_name: e.target.value })}
                  placeholder="给这个店铺起个名字（你自己能识别就行）"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-xl" />
              </div>

              {erpConns.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-500 mb-1">关联 ERP（可选）</label>
                  <select value={form.erp_connection_id} onChange={(e) => setForm({ ...form, erp_connection_id: e.target.value })}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-xl bg-white">
                    <option value="">不关联 ERP（店铺直接绑平台）</option>
                    {erpConns.map((e) => (
                      <option key={e.id} value={e.id}>{e.connection_name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 border border-gray-300 rounded-xl font-medium">取消</button>
              <button onClick={saveStore} disabled={!form.store_name.trim()}
                className="flex-1 py-2.5 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-xl font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                <ExternalLink className="w-4 h-4" />
                {form.platform === 'manual' ? '保存' : '去授权'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
