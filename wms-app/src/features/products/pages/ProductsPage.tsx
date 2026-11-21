import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { Plus, Trash2, Pencil, Package, Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Modal, Grid, Field, Footer } from '../../../components/shared/ui';

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
    queryKey: ['wms_products_all', search],
    queryFn: async () => {
      let q: any = supabase.from('wms_products').select('*').order('created_at', { ascending: false });
      if (search) q = q.or(`sku_code.ilike.%${search}%,name.ilike.%${search}%`);
      const { data } = await q;
      return data || [];
    },
  });

  // 查所有主条码（独立表）
  const { data: barcodes } = useQuery({
    queryKey: ['wms_barcodes_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_product_barcodes').select('product_id, barcode').order('product_id');
      return data || [];
    },
  });
  const bcMap: Record<number, string[]> = {};
  (barcodes || []).forEach((b: any) => {
    if (!bcMap[b.product_id]) bcMap[b.product_id] = [];
    bcMap[b.product_id].push(b.barcode);
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">商品管理</h2>
          <p className="text-sm text-muted-foreground mt-1">SKU 主数据 · 一个商品可以有多个条码（wms_product_barcodes）</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索 SKU/名称" className="pl-9 pr-3 py-2 border border-border rounded-lg text-sm w-64" />
          </div>
          <button onClick={() => { setEditing(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
            <Plus className="w-4 h-4" /> 新增商品
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">SKU</th>
              <th className="text-left px-5 py-2.5">名称</th>
              <th className="text-left px-5 py-2.5">条码</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-left px-5 py-2.5">规格 (L×W×H cm)</th>
              <th className="text-left px-5 py-2.5">重量/成本</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {products?.map((p: any) => {
              const wh = (warehouses as any[])?.find((w: any) => w.id === p.warehouse_id);
              return (
                <tr key={p.id} className="border-t border-transparent hover:bg-muted/50">
                  <td className="px-5 py-3 font-mono text-brand-600">{p.sku_code}</td>
                  <td className="px-5 py-3 font-medium">{p.name}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">{(bcMap[p.id] || []).join(', ') || '-'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{wh?.warehouse_code || '-'}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">
                    {Number(p.length_cm || 0).toFixed(0)}×{Number(p.width_cm || 0).toFixed(0)}×{Number(p.height_cm || 0).toFixed(0)}
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{p.weight_kg || 0} kg / ¥{p.unit_cost || 0}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => { setEditing(p); setShowForm(true); }} className="p-1.5 hover:bg-muted rounded"><Pencil className="w-4 h-4 text-muted-foreground" /></button>
                    <button onClick={async () => {
                      if (!confirm('确认删除？库存关联不会自动清理。')) return;
                      await supabase.from('wms_products').delete().eq('id', p.id);
                      qc.invalidateQueries();
                    }} className="p-1.5 hover:bg-danger-bg rounded"><Trash2 className="w-4 h-4 text-destructive" /></button>
                  </td>
                </tr>
              );
            })}
            {!products?.length && <tr><td colSpan={7} className="p-10 text-center text-muted-foreground">暂无商品，点击右上角新增</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <ProductForm initial={editing} warehouses={warehouses!} bcMap={bcMap}
        onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

function ProductForm({ initial, warehouses, bcMap, onClose, onSaved }: any) {
  const initialBcs = initial ? (bcMap[initial.id] || []).join(',') : '';
  const [f, setF] = useState(initial || {
    warehouse_id: warehouses?.[0]?.id || '',
    sku_code: '', name: '', weight_kg: 0, length_cm: 0, width_cm: 0, height_cm: 0,
    category: '', unit_cost: 0, is_active: 1,
  });
  const [bcText, setBcText] = useState(initialBcs);

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) toast.error('请先登录'); return;
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) toast.error('账户未绑定租户'); return;

    const productPayload: any = {
      tenant_id, warehouse_id: f.warehouse_id || null,
      sku_code: f.sku_code, name: f.name,
      weight_kg: +f.weight_kg || null, length_cm: +f.length_cm || null,
      width_cm: +f.width_cm || null, height_cm: +f.height_cm || null,
      category: f.category || null, unit_cost: +f.unit_cost || null,
      is_active: +f.is_active,
    };

    let productId = initial?.id;
    if (!initial) {
      const { data, error } = await supabase.from('wms_products').insert(productPayload).select().single();
      if (error) toast.error(error.message); return;
      productId = data!.id;
    } else {
      const { error } = await supabase.from('wms_products').update(productPayload).eq('id', initial.id);
      if (error) toast.error(error.message); return;
    }

    // 写条码（先清再插）
    if (productId) {
      await supabase.from('wms_product_barcodes').delete().eq('product_id', productId);
      const codes = bcText.split(',').map(s => s.trim()).filter(Boolean);
      if (codes.length) {
        const bcRows = codes.map((c, i) => ({
          tenant_id, product_id: productId,
          warehouse_id: f.warehouse_id || null,
          barcode: c, is_primary: i === 0,
        }));
        await supabase.from('wms_product_barcodes').insert(bcRows);
      }
    }

    onSaved();
  }

  return (
    <Modal title={initial ? '编辑商品' : '新增商品'} onClose={onClose}>
      <Grid>
        <Field label="SKU *"><input className="inp" value={f.sku_code} onChange={(e) => setF({ ...f, sku_code: e.target.value })} /></Field>
        <Field label="商品名称 *"><input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="所属仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            <option value="">不指定</option>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.warehouse_code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="条码（多个用逗号分隔）">
          <input className="inp" value={bcText} onChange={(e) => setBcText(e.target.value)} placeholder="BC-10001,BC-10002" />
        </Field>
        <Field label="重量 kg"><input className="inp" type="number" step="0.01" value={f.weight_kg} onChange={(e) => setF({ ...f, weight_kg: +e.target.value })} /></Field>
        <Field label="成本"><input className="inp" type="number" step="0.01" value={f.unit_cost} onChange={(e) => setF({ ...f, unit_cost: +e.target.value })} /></Field>
        <Field label="品类"><input className="inp" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="状态">
          <select className="inp" value={f.is_active} onChange={(e) => setF({ ...f, is_active: +e.target.value })}>
            <option value={1}>启用</option><option value={0}>停用</option>
          </select>
        </Field>
      </Grid>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Field label="长 cm"><input className="inp" type="number" value={f.length_cm} onChange={(e) => setF({ ...f, length_cm: +e.target.value })} /></Field>
        <Field label="宽 cm"><input className="inp" type="number" value={f.width_cm} onChange={(e) => setF({ ...f, width_cm: +e.target.value })} /></Field>
        <Field label="高 cm"><input className="inp" type="number" value={f.height_cm} onChange={(e) => setF({ ...f, height_cm: +e.target.value })} /></Field>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
