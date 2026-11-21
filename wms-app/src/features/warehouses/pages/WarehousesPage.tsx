import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../../../components/shared/ui';

const WH_TYPE: Record<number, string> = { 0: '自有仓', 1: '3PL 托管仓' };
const WH_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: '启用', cls: 'bg-success-bg text-success' },
  0: { label: '停用', cls: 'bg-muted text-muted-foreground' },
};

export function WarehousesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['wms_warehouses_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_warehouses').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  async function del(id: number) {
    if (!confirm('确认删除仓库？关联的库区/库位/库存/入库/订单/盘点会被级联或保留。')) return;
    await supabase.from('wms_warehouses').update({ deleted_at: new Date().toISOString() }).eq('id', id);
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">仓库管理</h2>
          <p className="text-sm text-muted-foreground mt-1">wms_warehouses · warehouse_code / is_3pl / status smallint</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新增仓库
        </button>
      </div>

      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">编码</th>
              <th className="text-left px-5 py-2.5">名称</th>
              <th className="text-left px-5 py-2.5">类型</th>
              <th className="text-left px-5 py-2.5">地址</th>
              <th className="text-left px-5 py-2.5">联系方式</th>
              <th className="text-right px-5 py-2.5">容量 / 状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.filter((w: any) => !w.deleted_at).map((w: any) => {
              const st = WH_STATUS[w.status] || { label: w.status, cls: 'bg-muted' };
              return (
                <tr key={w.id} className="border-t border-transparent hover:bg-muted/50">
                  <td className="px-5 py-3 font-mono text-brand-600">{w.warehouse_code}</td>
                  <td className="px-5 py-3 font-medium">{w.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{WH_TYPE[w.is_3pl] || '自有仓'}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground max-w-xs truncate">{w.address || '-'}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {w.contact_name ? <div>{w.contact_name}</div> : null}
                    {w.contact_phone ? <div>{w.contact_phone}</div> : null}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="text-muted-foreground">{w.capacity || '-'} m³</div>
                    <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => { setEditing(w); setShowForm(true); }} className="p-1.5 hover:bg-muted rounded"><Pencil className="w-4 h-4 text-muted-foreground" /></button>
                    <button onClick={() => del(w.id)} className="p-1.5 hover:bg-danger-bg rounded"><Trash2 className="w-4 h-4 text-destructive" /></button>
                  </td>
                </tr>
              );
            })}
            {!isLoading && !data?.filter((w: any) => !w.deleted_at).length && (
              <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">暂无仓库</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && <WarehouseForm initial={editing} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

function WarehouseForm({ initial, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || {
    warehouse_code: '', name: '', is_3pl: 0, address: '',
    contact_name: '', contact_phone: '', capacity: null, status: 1,
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('请先登录');
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) return alert('账户未绑定租户');

    const payload: any = {
      warehouse_code: f.warehouse_code, name: f.name,
      is_3pl: +f.is_3pl, address: f.address || null,
      contact_name: f.contact_name || null, contact_phone: f.contact_phone || null,
      capacity: +f.capacity || null, status: +f.status,
    };

    if (!initial) {
      const { error } = await supabase.from('wms_warehouses').insert({ ...payload, tenant_id });
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_warehouses').update(payload).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }

  return (
    <Modal title={initial ? '编辑仓库' : '新增仓库'} onClose={onClose}>
      <Grid>
        <Field label="仓库编码 *"><input className="inp" value={f.warehouse_code} onChange={(e) => setF({ ...f, warehouse_code: e.target.value })} placeholder="WH-GZ / WH-SH" /></Field>
        <Field label="名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="类型">
          <select className="inp" value={f.is_3pl} onChange={(e) => setF({ ...f, is_3pl: +e.target.value })}>
            <option value={0}>自有仓</option><option value={1}>3PL 托管仓</option>
          </select>
        </Field>
        <Field label="容量 (m³)">
          <input className="inp" type="number" value={f.capacity || ''} onChange={(e) => setF({ ...f, capacity: +e.target.value || null })} />
        </Field>
        <Field label="联系人"><input className="inp" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
        <Field label="联系电话"><input className="inp" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
        <Field label="地址" full><input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="状态">
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: +e.target.value })}>
            <option value={1}>启用</option><option value={0}>停用</option>
          </select>
        </Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
