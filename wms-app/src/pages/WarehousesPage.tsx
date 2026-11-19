import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Pencil, Trash2, MapPin } from 'lucide-react';
import { useState } from 'react';

type Warehouse = any;

export function WarehousesPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wms_warehouses').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => supabase.from('wms_warehouses').delete().eq('id', id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wms_warehouses'] }),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">仓库管理</h2>
          <p className="text-sm text-gray-500 mt-1">维护仓库基础信息</p>
        </div>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm"
        >
          <Plus className="w-4 h-4" /> 新增仓库
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">编码</th>
              <th className="text-left px-5 py-2.5">名称</th>
              <th className="text-left px-5 py-2.5">类型</th>
              <th className="text-left px-5 py-2.5">所在国家/地区</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((w: Warehouse) => (
              <tr key={w.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-5 py-3 font-mono text-brand-600">{wbin_code}</td>
                <td className="px-5 py-3 font-medium">{w.name}</td>
                <td className="px-5 py-3">{typeLabel(w.type)}</td>
                <td className="px-5 py-3 text-gray-500">{w.country || '-'}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${statusBadge(w.status)}`}>{statusLabel(w.status)}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setEditing(w); setShowForm(true); }} className="p-1.5 hover:bg-gray-100 rounded text-gray-500">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => { if (confirm('确认删除该仓库？')) del.mutate(w.id); }} className="p-1.5 hover:bg-red-50 rounded text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!isLoading && !data?.length && (
              <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无仓库，请先新增</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <WarehouseForm
          initial={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_warehouses'] }); }}
        />
      )}
    </div>
  );
}

function WarehouseForm({ initial, onClose, onSaved }: { initial: Warehouse | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(initial || {
    bin_code: '', name: '', type: 'self', country: '', province: '', city: '', address: '',
    contact_name: '', contact_phone: '', status: 'active', remark: '', capacity_pallets: 0,
  });

  async function save() {
    const payload = { ...f };
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (initial) {
      const { error } = await supabase.from('wms_warehouses').update(payload).eq('id', initial.id);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_warehouses').insert({ ...payload, user_id: user.id });
      if (error) return alert(error.message);
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <h3 className="text-lg font-bold mb-4">{initial ? '编辑仓库' : '新增仓库'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <Field label="编码 *"><input className="inp" value={fbin_code} onChange={(e) => setF({ ...f, bin_code: e.target.value })} /></Field>
          <Field label="名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="类型">
            <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="self">自有仓</option><option value="3pl">第三方 3PL</option><option value="overseas">海外仓</option>
            </select>
          </Field>
          <Field label="国家"><input className="inp" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} placeholder="CN / DE / US" /></Field>
          <Field label="省"><input className="inp" value={f.province} onChange={(e) => setF({ ...f, province: e.target.value })} /></Field>
          <Field label="市"><input className="inp" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="地址" full><input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="联系人"><input className="inp" value={f.contact_name} onChange={(e) => setF({ ...f, contact_name: e.target.value })} /></Field>
          <Field label="联系电话"><input className="inp" value={f.contact_phone} onChange={(e) => setF({ ...f, contact_phone: e.target.value })} /></Field>
          <Field label="托盘容量"><input className="inp" type="number" value={f.capacity_pallets} onChange={(e) => setF({ ...f, capacity_pallets: +e.target.value })} /></Field>
          <Field label="状态">
            <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">启用</option><option value="frozen">冻结</option><option value="archived">归档</option>
            </select>
          </Field>
          <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">取消</button>
          <button onClick={save} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">保存</button>
        </div>
      </div>

    </div>
  );
}

function Field({ label, children, full }: any) {
  return (
    <label className={`block ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs text-gray-600 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

// helpers
function typeLabel(t: string) { return ({ self: '自有仓', '3pl': '3PL', overseas: '海外仓' } as any)[t] || t; }
function statusLabel(s: string) { return ({ active: '启用', frozen: '冻结', archived: '归档' } as any)[s] || s; }
function statusBadge(s: string) {
  return ({ active: 'bg-green-50 text-green-600', frozen: 'bg-gray-100 text-gray-500', archived: 'bg-gray-100 text-gray-400' } as any)[s] || 'bg-gray-100 text-gray-500';
}

export { MapPin };
