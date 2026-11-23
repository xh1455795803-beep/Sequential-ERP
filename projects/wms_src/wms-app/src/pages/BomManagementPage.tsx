import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus, Trash2, Pencil, Layers, ArrowLeft, PackageCheck } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// -------- BOM 列表页 --------
export function BomManagementPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingBom, setEditingBom] = useState<any>(null);

  const { data: boms } = useQuery({
    queryKey: ['wms_bom'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wms_bom').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: bomItems } = useQuery({
    queryKey: ['wms_bom_items'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wms_bom_items').select('*');
      if (error) throw error;
      return data || [];
    },
  });

  const bomItemCount = (bomId: string) => (bomItems as any[])?.filter((i: any) => i.bom_id === bomId).length || 0;

  async function deleteBom(id: string) {
    if (!confirm('确定删除此 BOM？相关组件也会被删除。')) return;
    const { error } = await supabase.from('wms_bom').delete().eq('id', id);
    if (error) return alert(error.message);
    qc.invalidateQueries({ queryKey: ['wms_bom', 'wms_bom_items'] });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">BOM 物料清单</h2>
          <p className="text-sm text-gray-500 mt-1">成品 SKU → 组件 SKU 明细，用于组套生产</p>
        </div>
        <button onClick={() => { setEditingBom(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建 BOM
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">BOM 单号</th>
              <th className="text-left px-5 py-2.5">成品 SKU</th>
              <th className="text-left px-5 py-2.5">名称</th>
              <th className="text-center px-5 py-2.5">组件数</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {boms?.map((bom: any) => (
              <tr key={bom.id}
                className="border-t border-gray-50 hover:bg-brand-50/30">
                <td className="px-5 py-3 font-mono text-brand-600">{bom.bom_no}</td>
                <td className="px-5 py-3 font-mono text-xs">{bom.sku}</td>
                <td className="px-5 py-3">{bom.sku_name || '-'}</td>
                <td className="px-5 py-3 text-center">{bomItemCount(bom.id)}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${bom.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    {bom.status === 'active' ? '启用' : '停用'}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setEditingBom(bom); setShowForm(true); }}
                    className="text-brand-500 hover:text-brand-600 mr-3">
                    <Pencil className="w-4 h-4 inline" />
                  </button>
                  <button onClick={() => deleteBom(bom.id)}
                    className="text-red-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4 inline" />
                  </button>
                </td>
              </tr>
            ))}
            {!boms?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无 BOM，点击右上角新建</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <BomForm initial={editingBom} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_bom', 'wms_bom_items'] }); }} />}
    </div>
  );
}

// -------- BOM 表单（含组件明细） --------
function BomForm({ initial, onClose, onSaved }: any) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>(initial || {
    bom_no: 'BOM' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000),
    sku: '', sku_name: '', status: 'active', remark: '',
  });

  const [items, setItems] = useState<any[]>(initial ? [] : [{ component_sku: '', component_name: '', qty_per_unit: 1, required: true }]);

  // 如果是编辑，加载已有组件
  const { data: existingItems } = useQuery({
    queryKey: ['bom_items_edit', initial?.id],
    enabled: !!initial?.id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_bom_items').select('*').eq('bom_id', initial.id);
      return data || [];
    },
  });

  // 当 existingItems 加载完成时，填充组件列表
  useState(() => {
    if (existingItems && items.length === 1 && !initial) {
      setItems((existingItems as any[]).map((i: any) => ({
        ...i, _existing: true, _id: i.id,
      })));
    }
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('请先登录');
    if (!f.sku) return alert('请填写成品 SKU');
    if (!items.length) return alert('请至少添加一个组件');

    let bomId = initial?.id;

    if (!initial) {
      // 新建 BOM
      const { data, error } = await supabase.from('wms_bom').insert({
        ...f, user_id: user.id,
      }).select().single();
      if (error) return alert(error.message);
      bomId = data.id;
    } else {
      // 更新 BOM
      const { error } = await supabase.from('wms_bom').update(f).eq('id', initial.id);
      if (error) return alert(error.message);
    }

    // 保存组件
    const newItems = items.filter(i => !i._existing).map(i => ({
      bom_id: bomId, user_id: user.id,
      component_sku: i.component_sku, component_name: i.component_name,
      qty_per_unit: i.qty_per_unit, required: i.required,
    }));

    // 删除被移除的组件
    if (initial) {
      const removedIds = (existingItems as any[])
        ?.filter((ei: any) => !items.find(i => i._id === ei.id))
        ?.map((ei: any) => ei.id) || [];
      if (removedIds.length) {
        await supabase.from('wms_bom_items').delete().in('id', removedIds);
      }
      // 更新修改过的组件
      for (const it of items.filter(i => i._existing)) {
        await supabase.from('wms_bom_items').update({
          component_sku: it.component_sku, component_name: it.component_name,
          qty_per_unit: it.qty_per_unit, required: it.required,
        }).eq('id', it._id);
      }
    }

    if (newItems.length) {
      const { error } = await supabase.from('wms_bom_items').insert(newItems);
      if (error) return alert('组件保存失败：' + error.message);
    }

    onSaved(bomId);
  }

  function addItem() {
    setItems([...items, { component_sku: '', component_name: '', qty_per_unit: 1, required: true }]);
  }
  function updateItem(idx: number, key: string, val: any) {
    setItems(items.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
  }
  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  return (
    <Modal title={initial ? '编辑 BOM' : '新建 BOM'} onClose={onClose}>
      <Grid>
        <Field label="BOM 单号 *"><input className="inp" value={f.bom_no} onChange={(e) => setF({ ...f, bom_no: e.target.value })} /></Field>
        <Field label="状态">
          <select className="inp" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
        </Field>
        <Field label="成品 SKU *"><input className="inp" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} placeholder="如 ASSEMBLY-001" /></Field>
        <Field label="成品名称"><input className="inp" value={f.sku_name} onChange={(e) => setF({ ...f, sku_name: e.target.value })} /></Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>

      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm flex items-center gap-1.5"><Layers className="w-4 h-4 text-brand-500" /> 组件明细</span>
          <button onClick={addItem} className="text-xs text-brand-500 hover:text-brand-600">+ 添加组件</button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400">
              <tr>
                <th className="text-left py-1">组件 SKU *</th>
                <th className="text-left py-1">名称</th>
                <th className="text-right py-1 w-20">用量</th>
                <th className="text-center py-1 w-16">必选</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx}>
                  <td className="py-1.5"><input className="inp" value={it.component_sku} onChange={(e) => updateItem(idx, 'component_sku', e.target.value)} /></td>
                  <td className="py-1.5"><input className="inp" value={it.component_name} onChange={(e) => updateItem(idx, 'component_name', e.target.value)} /></td>
                  <td className="py-1.5"><input className="inp text-right" type="number" min={1} value={it.qty_per_unit} onChange={(e) => updateItem(idx, 'qty_per_unit', +e.target.value)} /></td>
                  <td className="py-1.5 text-center">
                    <input type="checkbox" checked={it.required} onChange={(e) => updateItem(idx, 'required', e.target.checked)} />
                  </td>
                  <td className="py-1.5 text-center">
                    <button onClick={() => removeItem(idx)} className="text-red-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={5} className="py-4 text-center text-gray-400">点击"+ 添加组件"</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// -------- BOM 详情 + 生成组套单 --------
export function BomDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();

  const { data: bom } = useQuery({
    queryKey: ['bom', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_bom').select('*').eq('id', id).single();
      return data;
    },
  });

  const { data: bomItems } = useQuery({
    queryKey: ['bom_items', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_bom_items').select('*').eq('bom_id', id);
      return data || [];
    },
  });

  const { data: inventory } = useQuery({
    queryKey: ['inv_for_bom', bomItems?.map((i: any) => i.component_sku)],
    enabled: !!bomItems?.length,
    queryFn: async () => {
      const skus = (bomItems || []).map((i: any) => i.component_sku);
      const { data } = await supabase.from('wms_inventory').select('sku, qty_available, warehouse_id').in('sku', skus);
      return data || [];
    },
  });

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  async function createKittingOrder() {
    if (!bom) return;
    const warehouse_id = prompt('选择仓库（输入仓库 ID 或让我帮你选第一个）') || (warehouses as any[])?.[0]?.id;
    if (!warehouse_id) return alert('没有可用仓库');
    const output_qty = parseInt(prompt('组套数量：', '1') || '1', 10);
    if (!output_qty || output_qty < 1) return alert('数量无效');

    const { data: { user } } = await supabase.auth.getUser();
    const order_no = 'KIT' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000);

    const { data, error } = await supabase.from('wms_kitting_orders').insert({
      user_id: user!.id,
      order_no, bom_id: bom.id, warehouse_id, output_qty,
      output_sku: bom.sku, output_sku_name: bom.sku_name,
      total_components: (bomItems || []).length,
      status: 'released',
    }).select().single();

    if (error) return alert(error.message);
    alert(`组套单已创建：${order_no}`);
    nav({ to: `/kitting/$id`, params: { id: data.id } });
  }

  if (!bom) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/bom' })} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回 BOM 列表
      </button>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <PackageCheck className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{bom.bom_no}</div>
            <div className="text-xs text-gray-500">
              成品 <span className="font-mono">{bom.sku}</span> {bom.sku_name && `· ${bom.sku_name}`}
            </div>
          </div>
          <div className="ml-auto">
            <button onClick={createKittingOrder}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 flex items-center gap-1.5">
              <Layers className="w-4 h-4" /> 生成组套单
            </button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-400">组件种类</div>
            <div className="font-medium">{bomItems?.length || 0}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">状态</div>
            <div className={`font-medium ${bom.status === 'active' ? 'text-green-600' : 'text-gray-400'}`}>
              {bom.status === 'active' ? '启用' : '停用'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400">备注</div>
            <div className="font-medium text-gray-600">{bom.remark || '-'}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium">组件明细（库存可用性）</div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2">组件 SKU</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-right px-4 py-2">单套用量</th>
              <th className="text-right px-4 py-2">总组件数</th>
              <th className="text-center px-4 py-2">库存状态</th>
            </tr>
          </thead>
          <tbody>
            {(bomItems || []).map((it: any) => {
              const invSum = (inventory as any[])
                ?.filter((i: any) => i.sku === it.component_sku)
                ?.reduce((s, i) => s + (i.qty_available || 0), 0) || 0;
              return (
                <tr key={it.id} className="border-t border-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{it.component_sku}</td>
                  <td className="px-4 py-2">{it.component_name || '-'}</td>
                  <td className="px-4 py-2 text-right">{it.qty_per_unit}</td>
                  <td className="px-4 py-2 text-right">{(bomItems || []).length}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs ${invSum > 0 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                      {invSum > 0 ? `✓ ${invSum} 可用` : '库存不足'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
