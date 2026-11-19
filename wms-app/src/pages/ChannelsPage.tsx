import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Pencil, Truck } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

const ADAPTER_LABEL: Record<string, { label: string; desc: string }> = {
  manual:  { label: '手动运单', desc: '人工填运单号 + 上传面单，兜底渠道' },
  tiktok:  { label: 'TikTok Shop 官方物流', desc: '直接调 TikTok Shop 官方 API' },
  shopee:  { label: 'Shopee 官方物流', desc: '直接调 Shopee 官方 API' },
  '4px':   { label: '递四方 4PX', desc: '4PX 开放平台 API' },
  dhl:     { label: 'DHL Express', desc: 'DHL 开放 API' },
  yanwen:  { label: '燕文物流', desc: '燕文开放 API' },
};

export function ChannelsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data } = useQuery({
    queryKey: ['wms_shipping_channels_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipping_channels').select('*').order('created_at');
      return data || [];
    },
  });

  async function deleteOne(id: number) {
    if (!confirm('确认删除渠道？')) return;
    await supabase.from('wms_shipping_channels').delete().eq('id', id);
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">物流渠道</h2>
          <p className="text-sm text-gray-500 mt-1">wms_shipping_channels · ManualAdapter 兜底 · 未来可切换真实 API</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新增渠道
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">编码</th>
              <th className="text-left px-5 py-2.5">渠道名称</th>
              <th className="text-left px-5 py-2.5">适配器</th>
              <th className="text-left px-5 py-2.5">计费重 (kg)</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((c: any) => (
              <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-5 py-3 font-mono text-brand-600">{c.channel_code}</td>
                <td className="px-5 py-3 font-medium">{c.channel_name}</td>
                <td className="px-5 py-3">
                  <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-600 font-mono">{c.adapter || '-'}</span>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {ADAPTER_LABEL[c.adapter]?.desc || '自定义适配器'}
                  </div>
                </td>
                <td className="px-5 py-3 text-gray-500">{c.weight_limit_kg || '-'}</td>
                <td className="px-5 py-3">
                  {c.is_active === 1
                    ? <span className="px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">启用</span>
                    : <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">停用</span>}
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-1.5 hover:bg-gray-100 rounded"><Pencil className="w-4 h-4 text-gray-500" /></button>
                  <button onClick={() => deleteOne(c.id)} className="p-1.5 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button>
                </td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无渠道</td></tr>}
          </tbody>
        </table>
      </div>
      {showForm && <ChannelForm initial={editing} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

function ChannelForm({ initial, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || {
    channel_code: '', channel_name: '', adapter: 'manual',
    warehouse_code: '', weight_limit_kg: null,
    is_active: 1, remark: '',
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('请先登录');
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) return alert('账户未绑定租户');

    const payload = {
      channel_code: f.channel_code, channel_name: f.channel_name,
      adapter: f.adapter, warehouse_code: f.warehouse_code || null,
      weight_limit_kg: f.weight_limit_kg || null,
      is_active: f.is_active,
    };

    if (!initial) {
      const { error } = await supabase.from('wms_shipping_channels').insert({ ...payload, tenant_id });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_shipping_channels').update(payload).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }

  return (
    <Modal title={initial ? '编辑渠道' : '新增渠道'} onClose={onClose}>
      <Grid>
        <Field label="渠道编码 *"><input className="inp" value={f.channel_code} onChange={(e) => setF({ ...f, channel_code: e.target.value })} placeholder="4PX-ECONOMY" /></Field>
        <Field label="渠道名称 *"><input className="inp" value={f.channel_name} onChange={(e) => setF({ ...f, channel_name: e.target.value })} placeholder="递四方 经济小包" /></Field>
        <Field label="适配器 *">
          <select className="inp" value={f.adapter} onChange={(e) => setF({ ...f, adapter: e.target.value })}>
            {Object.entries(ADAPTER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v.label} ({k})</option>
            ))}
          </select>
        </Field>
        <Field label="计费重上限 (kg)">
          <input className="inp" type="number" step="0.01" value={f.weight_limit_kg || ''} onChange={(e) => setF({ ...f, weight_limit_kg: +e.target.value || null })} />
        </Field>
        <Field label="仓库代码（渠道侧）">
          <input className="inp" value={f.warehouse_code} onChange={(e) => setF({ ...f, warehouse_code: e.target.value })} />
        </Field>
        <Field label="状态">
          <select className="inp" value={f.is_active} onChange={(e) => setF({ ...f, is_active: +e.target.value })}>
            <option value={1}>启用</option><option value={0}>停用</option>
          </select>
        </Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
