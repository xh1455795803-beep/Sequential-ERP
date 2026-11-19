import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Pencil, Package, Search } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

export function ProductsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState('');

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: products } = useQuery({
    queryKey: ['wms_products'],
    queryFn: async () => {
      let q = supabase.from('wms_products').select('*').order('created_at', { ascending: false });
      if (search) q = q.or(`sku.ilike.%${search}%,name.ilike.%${search}%,barcode.cs.%${search}%`);
      const { data } = await q;
      return data || [];
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">商品管理</h2>
          <p className="text-sm text-gray-500 mt-1">SKU 主数据 · 一个商品可以有多个条码</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 SKU/名称/条码" className="pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-64" />
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
            <Plus className="w-4 h-4" /> 新增商品
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">SKU</th>
              <th className="text-left px-5 py-2.5">名称</th>
              <th className="text-left px-5 py-2.5">条码</th>
              <th className="text-left px-5 py-2.5">所属仓库</th>
              <th className="text-left px-5 py-2.5">规格 (L×W×H cm)</th>
              <th className="text-left px-5 py-2.5">重量</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {products?.map((p: any) => (
              <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                <td className="px-5 py-3 font-mono text-brand-600">{p.sku}</td>
                <td className="px-5 py-3 font-medium">{p.name}</td>
                <td className="px-5 py-3 text-xs text-gray-500">{(p.barcode || []).join(', ') || '-'}</td>
                <td className="px-5 py-3 text-gray-500">
                  {(warehouses as any[])?.find(w => w.id === p.warehouse_id)?.code || '-'}
                </td>
                <td className="px-5 py-3 text-xs text-gray-500">
                  {Number(p.length_cm || 0).toFixed(0)}×{Number(p.width_cm || 0).toFixed(0)}×{Number(p.height_cm || 0).toFixed(0)}
                </td>
                <td className="px-5 py-3 text-xs text-gray-500">{p.weight_kg || 0} kg</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setEditing(p); setShowForm(true); }} className="p-1.5 hover:bg-gray-100 rounded"><Pencil className="w-4 h-4 text-gray-500" /></button>
                  <button onClick={async () => {
                    if (confirm('确认删除？删除后不会自动清理库存关联。')) {
                      await supabase.from('wms_products').delete().eq('id', p.id);
                      qc.invalidateQueries({ queryKey: ['wms_products'] });
                    }
                  }} className="p-1.5 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4 text-red-500" /></button>
                </td>
              </tr>
            ))}
            {!products?.length && <tr><td colSpan={7} className="p-10 text-center text-gray-400">暂无商品，点击右上角新增</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <ProductForm initial={editing} warehouses={warehouses!}
        onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_products'] }); }} />}
    </div>
  );
}

function ProductForm({ initial, warehouses, onClose, onSaved }: any) {
  const [f, setF] = useState(initial || {
    warehouse_id: warehouses?.[0]?.id || '',
    sku: '', name: '', barcode: [],
    weight_kg: 0, length_cm: 0, width_cm: 0, height_cm: 0,
    category: '', is_fragile: false, is_cod_supported: true, safe_stock: 0,
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    const payload = { ...f, user_id: user!.id, barcode: f.barcode };
    if (!initial) {
      const { error } = await supabase.from('wms_products').insert(payload);
      if (error) return alert(error.message);
    } else {
      const { error } = await supabase.from('wms_products').update(payload).eq('id', initial.id);
      if (error) return alert(error.message);
    }
    onSaved();
  }

  return (
    <Modal title={initial ? '编辑商品' : '新增商品'} onClose={onClose}>
      <Grid>
        <Field label="SKU *"><input className="inp" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
        <Field label="商品名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="所属仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="条码（多个用逗号分隔）">
          <input className="inp" value={(f.barcode || []).join(',')}
            onChange={(e) => setF({ ...f, barcode: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
            placeholder="BC-10001,BC-10002" />
        </Field>
        <Field label="重量 kg"><input className="inp" type="number" step="0.01" value={f.weight_kg} onChange={(e) => setF({ ...f, weight_kg: +e.target.value })} /></Field>
        <Field label="品类"><input className="inp" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="electronics / home / general" /></Field>
      </Grid>
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Field label="长 cm"><input className="inp" type="number" value={f.length_cm} onChange={(e) => setF({ ...f, length_cm: +e.target.value })} /></Field>
        <Field label="宽 cm"><input className="inp" type="number" value={f.width_cm} onChange={(e) => setF({ ...f, width_cm: +e.target.value })} /></Field>
        <Field label="高 cm"><input className="inp" type="number" value={f.height_cm} onChange={(e) => setF({ ...f, height_cm: +e.target.value })} /></Field>
        <Field label="安全库存"><input className="inp" type="number" value={f.safe_stock} onChange={(e) => setF({ ...f, safe_stock: +e.target.value })} /></Field>
      </div>
      <div className="mt-4 flex gap-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_fragile} onChange={(e) => setF({ ...f, is_fragile: e.target.checked })} /> 易碎品</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.is_cod_supported} onChange={(e) => setF({ ...f, is_cod_supported: e.target.checked })} /> 支持 COD</label>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
