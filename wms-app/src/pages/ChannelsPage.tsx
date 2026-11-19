import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Pencil, Truck, Download, Upload } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

const ADAPTER_LABEL: Record<string, { label: string; desc: string }> = {
  manual:  { label: '手动运单', desc: '人工填运单号+上传面单，兜底渠道' },
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
    queryKey: ['wms_channels'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_channels').select('*').order('created_at');
      return data || [];
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">渠道配置</h2>
          <p className="text-sm text-gray-500 mt-1">物流/货代渠道 · ManualAdapter 兜底 · 未来可切换真实 API</p>
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
              <th className="text-left px-5 py-2.5">取运单</th>
              <th className="text-left px-5 py-2.5">查轨迹</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((c: any) => (
              <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-5 py-3 font-mono text-brand-600">{c.code}</td>
                <td className="px-5 py-3 font-medium">{c.name}</td>
                <td className="px-5 py-3">
                  <span className="px-2 py-0.5 rounded text-xs bg-purple-50 text-purple-600 font-mono">{c.adapter}</span>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {(ADAPTER_LABEL[c.adapter]?.desc) || '自定义适配器'}
                  </div>
                </td>
                <td className="px-5 py-3">{c.supports_label_pdf ? '✅' : '—'}</td>
                <td className="px-5 py-3">{c.supports_tracking ? '✅' : '—'}</td>
                <td className="px-5 py-3">{c.status === 'active'
                  ? <span className="px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">启用</span>
                  : <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">停用</span>}</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-1.5 hover:bg-gray-100 rounded"><Pencil className="w-4 h-4 text-gray-500" /></button>
                  <button onClick={async () => { if (confirm('确认删除？')) {
                    await supabase.from('wms_channels').delete().eq('id', c.id);
                    qc.invalidateQueries({ queryKey: ['wms_channels'] });
                  } }} className="p-1.5 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button>
                </td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={7} className="p-10 text-center text-gray-400">暂无渠道</td></tr>}
          </tbody>
        </table>
      </div>
      {showForm && <ChannelForm initial={editing} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_channels'] }); }} />}
    </div>
  );
}

function ChannelForm({ initial, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || {
    code: '', name: '', adapter: 'manual',
    supports_tracking: false, supports_label_pdf: false,
    config: {}, rate_card: {},
    status: 'active', remark: '',
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!initial) {
      const { error } = await supabase.from('wms_channels').insert({ ...f, user_id: user!.id });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_channels').update(f).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }

  return (
    <Modal title={initial ? '编辑渠道' : '新增渠道'} onClose={onClose}>
      <Grid>
        <Field label="渠道编码 *"><input className="inp" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="4PX-ECONOMY" /></Field>
        <Field label="渠道名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="递四方 经济小包" /></Field>
        <Field label="适配器 *">
          <select className="inp" value={f.adapter} onChange={(e) => setF({ ...f, adapter: e.target.value })}>
            {Object.entries(ADAPTER_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v.label} ({k})</option>
            ))}
          </select>
        </Field>
        <Field label="状态">
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">启用</option><option value="frozen">停用</option>
          </select>
        </Field>
      </Grid>
      <div className="mt-4 flex gap-6 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.supports_label_pdf} onChange={(e) => setF({ ...f, supports_label_pdf: e.target.checked })} />
          支持电子面单 PDF
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={f.supports_tracking} onChange={(e) => setF({ ...f, supports_tracking: e.target.checked })} />
          支持物流轨迹查询
        </label>
      </div>
      <Field label="备注" full>
        <textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} />
      </Field>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
