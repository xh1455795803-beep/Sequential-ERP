import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { Plus, Trash2, RefreshCw, CheckCircle, XCircle, Store } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../../../components/shared/ui';

// wms_platform_shops: platform, shop_id, shop_name, access_token_enc, refresh_token_enc, token_expires_at, is_active, last_sync_at
// 同时承担 ERP 来源和店铺绑定的角色
const PLATFORMS = [
  { value: 'tiktok_shop', label: 'TikTok Shop' },
  { value: 'shopify',     label: 'Shopify' },
  { value: 'shopee',      label: 'Shopee' },
  { value: 'amazon',      label: 'Amazon' },
  { value: 'temu',        label: 'Temu' },
  { value: 'miaoshou',    label: '妙手 ERP' },
  { value: 'manual',      label: '手动录入' },
];

export default function ErpConnectionPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    platform: 'manual', shop_id: '', shop_name: '',
    access_token_enc: '', refresh_token_enc: '',
  });

  const { data } = useQuery({
    queryKey: ['wms_platform_shops_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_platform_shops').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  async function saveShop() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('请先登录');
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) return alert('账户未绑定租户');
    if (!form.shop_name.trim()) return alert('店铺名称不能为空');

    const { error } = await supabase.from('wms_platform_shops').insert({
      tenant_id, platform: form.platform,
      shop_id: form.shop_id || ('MANUAL-' + Date.now()),
      shop_name: form.shop_name,
      access_token_enc: form.access_token_enc || 'demo_token',
      refresh_token_enc: form.refresh_token_enc || 'demo_token',
      is_active: 1,
    });
    if (error) return alert(error.message);
    setShowForm(false);
    setForm({ platform: 'manual', shop_id: '', shop_name: '', access_token_enc: '', refresh_token_enc: '' });
    qc.invalidateQueries();
  }

  async function toggle(id: number, active: number) {
    await supabase.from('wms_platform_shops').update({ is_active: active === 1 ? 0 : 1 }).eq('id', id);
    qc.invalidateQueries();
  }

  async function remove(id: number) {
    if (!confirm('删除此店铺/ERP 来源？')) return;
    await supabase.from('wms_platform_shops').delete().eq('id', id);
    qc.invalidateQueries();
  }

  async function sync(id: number) {
    await supabase.from('wms_platform_shops').update({ last_sync_at: new Date().toISOString() }).eq('id', id);
    alert('✅ 模拟同步完成（生产环境将触发 ERP 拉单）');
    qc.invalidateQueries();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-fg">ERP 来源 / 店铺绑定</h1>
          <p className="text-sm text-muted-foreground mt-1">wms_platform_shops · 订单从这里进入 WMS</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-brand-500 to-brand-600 text-white rounded-xl font-medium">
          <Plus className="w-4 h-4" /> 添加来源
        </button>
      </div>

      {(data || []).length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-12 text-center">
          <Store className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
          <h3 className="text-fg font-medium mb-1">还没有绑定任何来源</h3>
          <p className="text-sm text-muted-foreground">点右上角开始 · 生产环境这里走 OAuth · 当前演示直接写库</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {data?.map((s: any) => {
            const plat = PLATFORMS.find(p => p.value === s.platform);
            return (
              <div key={s.id} className="bg-card rounded-2xl border border-border overflow-hidden">
                <div className={`h-2 bg-gradient-to-r from-brand-500 to-brand-600`} />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold text-fg">{s.shop_name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {plat?.label || s.platform} · {s.shop_id}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => sync(s.id)} className="p-1.5 text-muted-foreground hover:bg-muted rounded"><RefreshCw className="w-4 h-4" /></button>
                      <button onClick={() => toggle(s.id, s.is_active)} className="p-1.5 hover:bg-muted rounded">
                        {s.is_active === 1 ? <CheckCircle className="w-4 h-4 text-success" /> : <XCircle className="w-4 h-4 text-muted-foreground" />}
                      </button>
                      <button onClick={() => remove(s.id)} className="p-1.5 text-destructive hover:bg-danger-bg rounded"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="mt-4 text-xs text-muted-foreground">
                    {s.last_sync_at ? <>上次同步：{new Date(s.last_sync_at).toLocaleString('zh-CN')}</> : <>从未同步</>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 新增弹窗 */}
      {showForm && (
        <Modal title="添加来源" onClose={() => setShowForm(false)}>
          <Grid>
            <Field label="平台 *">
              <select className="inp" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </Field>
            <Field label="店铺/ERP 名称 *">
              <input className="inp" value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} placeholder="我的 TikTok Shop / 我的妙手" />
            </Field>
            <Field label="平台 ID / 店铺 ID">
              <input className="inp" value={form.shop_id} onChange={(e) => setForm({ ...form, shop_id: e.target.value })} placeholder="可留空，手动录入会自动生成" />
            </Field>
            <Field label="Access Token（演示可留空）">
              <input className="inp" value={form.access_token_enc} onChange={(e) => setForm({ ...form, access_token_enc: e.target.value })} placeholder="生产环境加密存储" />
            </Field>
          </Grid>
          <Footer onClose={() => setShowForm(false)} onSave={saveShop} />
        </Modal>
      )}
    </div>
  );
}
