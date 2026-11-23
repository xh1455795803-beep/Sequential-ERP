import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Pencil, Layers, Package, ArrowLeft, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// -------- 组装清单（原 BOM 降级版） --------
// 简化为单表 CRUD：成品 SKU → 组件清单（多行）
// 去掉 Edge Function 调用、去掉复杂的库存联动、去掉与组套单的强耦合
export function BomManagementPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);

  const { data: boms } = useQuery({
    queryKey: ['wms_bom'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_bom').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: bomItems } = useQuery({
    queryKey: ['wms_bom_items'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_bom_items').select('*');
      return data || [];
    },
  });

  function itemCount(bomId: string) {
    return (bomItems as any[])?.filter((i: any) => i.bom_id === bomId).length || 0;
  }

  async function delBom(id: string) {
    if (!confirm('确定删除此组装清单？组件也会被删除。')) return;
    await supabase.from('wms_bom').delete().eq('id', id);
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ListChecks className="w-6 h-6 text-brand-500" /> 组装清单
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            （原 BOM 物料清单简化版）
            定义成品 SKU 由哪些组件组成 · 支持拆行 · 用于出库打包时一键触发组装
          </p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建组装清单
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">清单编号</th>
              <th className="text-left px-5 py-2.5">成品 SKU</th>
              <th className="text-left px-5 py-2.5">成品名称</th>
              <th className="text-center px-5 py-2.5">组件数</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {(boms || []).map((bom: any) => (
              <tr key={bom.id} className="border-t border-gray-50 hover:bg-brand-50/30">
                <td className="px-5 py-3 font-mono text-brand-600">{bom.bom_no}</td>
                <td className="px-5 py-3 font-mono text-xs">{bom.sku}</td>
                <td className="px-5 py-3">{bom.sku_name || '-'}</td>
                <td className="px-5 py-3 text-center">{itemCount(bom.id)}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${bom.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                    {bom.status === 'active' ? '启用' : '停用'}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => { setEditing(bom); setShowForm(true); }}
                    className="text-brand-500 hover:text-brand-600 mr-3">
                    <Pencil className="w-4 h-4 inline" />
                  </button>
                  <button onClick={() => delBom(bom.id)} className="text-red-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4 inline" />
                  </button>
                </td>
              </tr>
            ))}
            {!boms?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无组装清单</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 使用提示 */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
        <div className="font-medium flex items-center gap-1.5 mb-1">
          <Layers className="w-4 h-4" /> 何时会触发组装？
        </div>
        <p className="text-blue-600 text-xs leading-relaxed">
          当你在"出库管理 → 发货单"打包发货时，若发货明细中的某个 SKU 在此有组装清单，
          打包页面会提示一键从组件中组装出成品 SKU（扣组件库存 + 加成品库存）。
          不需要手动创建组套单，组装逻辑在发货打包过程中一次性完成。
        </p>
      </div>

      {showForm && <BomForm initial={editing} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

// 简化版表单（纯 CRUD，无 Edge Function）
function BomForm({ initial, onClose, onSaved }: any) {
  const qc = useQueryClient();
  const [f, setF] = useState<any>(initial || {
    bom_no: 'BOM' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000),
    sku: '', sku_name: '', status: 'active', remark: '',
  });

  const [items, setItems] = useState<any[]>(initial ? [] : [{ component_sku: '', component_name: '', qty_per_unit: 1 }]);

  // 编辑时加载已有组件
  const { data: existingItems } = useQuery({
    queryKey: ['bom_items_edit', initial?.id],
    enabled: !!initial?.id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_bom_items').select('*').eq('bom_id', initial.id);
      return data || [];
    },
  });

  // existingItems 加载完成时填充
  useState(() => {
    if (existingItems && items.length === 1 && !initial) {
      setItems((existingItems as any[]).map((i: any) => ({
        ...i, _existing: true, _id: i.id,
      })));
    }
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!f.sku) return alert('请填写成品 SKU');

    let bomId = initial?.id;

    if (!initial) {
      const { data, error } = await supabase.from('wms_bom').insert({
        ...f, user_id: user.id,
      }).select().single();
      if (error) return alert(error.message);
      bomId = data.id;
    } else {
      const { error } = await supabase.from('wms_bom').update(f).eq('id', initial.id);
      if (error) return alert(error.message);
    }

    // 组件保存
    const newItems = items.filter(i => !i._existing).map(i => ({
      bom_id: bomId, user_id: user.id,
      component_sku: i.component_sku, component_name: i.component_name,
      qty_per_unit: i.qty_per_unit, required: i.required ?? true,
    }));

    if (initial) {
      const removedIds = (existingItems as any[])
        ?.filter((ei: any) => !items.find(i => i._id === ei.id))
        ?.map((ei: any) => ei.id) || [];
      if (removedIds.length) {
        await supabase.from('wms_bom_items').delete().in('id', removedIds);
      }
      for (const it of items.filter(i => i._existing)) {
        await supabase.from('wms_bom_items').update({
          component_sku: it.component_sku, component_name: it.component_name,
          qty_per_unit: it.qty_per_unit, required: it.required,
        }).eq('id', it._id);
      }
    }

    if (newItems.length) {
      await supabase.from('wms_bom_items').insert(newItems);
    }

    onSaved();
  }

  function addItem() {
    setItems([...items, { component_sku: '', component_name: '', qty_per_unit: 1, required: true }]);
  }
  function updItem(idx: number, key: string, val: any) {
    setItems(items.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
  }
  function rmItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }

  return (
    <Modal title={initial ? '编辑组装清单' : '新建组装清单'} onClose={onClose}>
      <Grid>
        <Field label="清单编号 *"><input className="inp" value={f.bom_no} onChange={(e) => setF({ ...f, bom_no: e.target.value })} /></Field>
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
          <span className="font-medium text-sm flex items-center gap-1.5">
            <Package className="w-4 h-4 text-brand-500" /> 组件明细
          </span>
          <button onClick={addItem} className="text-xs text-brand-500 hover:text-brand-600">+ 添加组件</button>
        </div>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-gray-400">
              <tr>
                <th className="text-left py-1">组件 SKU *</th>
                <th className="text-left py-1">名称</th>
                <th className="text-right py-1 w-20">用量</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx}>
                  <td className="py-1.5"><input className="inp" value={it.component_sku} onChange={(e) => updItem(idx, 'component_sku', e.target.value)} /></td>
                  <td className="py-1.5"><input className="inp" value={it.component_name} onChange={(e) => updItem(idx, 'component_name', e.target.value)} /></td>
                  <td className="py-1.5"><input className="inp text-right" type="number" min={1} value={it.qty_per_unit} onChange={(e) => updItem(idx, 'qty_per_unit', +e.target.value)} /></td>
                  <td className="py-1.5 text-center">
                    <button onClick={() => rmItem(idx)} className="text-red-400 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={4} className="py-4 text-center text-gray-400">点击"+ 添加组件"</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// 导出占位详情页（保持 main.tsx 路由引用不崩）
export function BomDetailPage() {
  return (
    <div className="p-8 text-center text-gray-400">
      <ArrowLeft className="w-4 h-4 inline mr-2" /> 组装清单已简化，请直接在列表页编辑
    </div>
  );
}
