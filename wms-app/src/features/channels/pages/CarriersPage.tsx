import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../../../components/shared/ui';

export function CarriersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data } = useQuery({
    queryKey: ['wms_shipping_channels'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipping_channels').select('*').order('created_at');
      return data || [];
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">承运商</h2>
          <p className="text-sm text-muted-foreground mt-1">维护常用承运商信息</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新增承运商
        </button>
      </div>
      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr><th className="text-left px-5 py-2.5">编码</th><th className="text-left px-5 py-2.5">名称</th>
              <th className="text-left px-5 py-2.5">追踪地址</th><th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th></tr>
          </thead>
          <tbody>
            {data?.map((c: any) => (
              <tr key={c.id} className="border-t border-transparent hover:bg-muted/50">
                <td className="px-5 py-3 font-mono text-brand-600">{cbin_code}</td>
                <td className="px-5 py-3 font-medium">{c.name}</td>
                <td className="px-5 py-3 text-muted-foreground text-xs">{c.tracking_url || '-'}</td>
                <td className="px-5 py-3">{c.status === 'active' ? <span className="px-2 py-0.5 rounded text-xs bg-success-bg text-success">启用</span> : <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">停用</span>}</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setEditing(c); setShowForm(true); }} className="p-1.5 hover:bg-muted rounded"><Pencil className="w-4 h-4 text-muted-foreground" /></button>
                  <button onClick={async () => { if (confirm('确认删除？')) { await supabase.from('wms_shipping_channels').delete().eq('id', c.id); qc.invalidateQueries({ queryKey: ['wms_shipping_channels'] }); } }}
                    className="p-1.5 hover:bg-danger-bg rounded"><Trash2 className="w-4 h-4 text-destructive" /></button>
                </td>
              </tr>
            ))}
            {!data?.length && <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">暂无承运商</td></tr>}
          </tbody>
        </table>
      </div>
      {showForm && <CarrierForm initial={editing} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_shipping_channels'] }); }} />}
    </div>
  );
}

function CarrierForm({ initial, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || { bin_code: '', name: '', tracking_url: '', contact_name: '', contact_phone: '', status: 'active' });
  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!initial) {
      const { error } = await supabase.from('wms_shipping_channels').insert({ ...f, user_id: user!.id });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_shipping_channels').update(f).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }
  return (
    <Modal title={initial ? '编辑承运商' : '新增承运商'} onClose={onClose}>
      <Grid>
        <Field label="编码 *"><input className="inp" value={fbin_code} onChange={(e) => setF({ ...f, bin_code: e.target.value })} /></Field>
        <Field label="名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="追踪网址" full><input className="inp" value={f.tracking_url} onChange={(e) => setF({ ...f, tracking_url: e.target.value })} placeholder="https://...?no=" /></Field>
        <Field label="联系人"><input className="inp" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
        <Field label="联系电话"><input className="inp" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
        <Field label="状态">
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">启用</option><option value="frozen">停用</option>
          </select>
        </Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
