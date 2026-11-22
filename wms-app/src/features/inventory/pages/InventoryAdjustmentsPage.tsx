import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useState } from 'react';
import { toast } from 'sonner';

export function InventoryAdjustmentsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [productId, setProductId] = useState('');
  const [binId, setBinId] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('盘盈');
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: products } = useQuery({
    queryKey: ['wms_products_min'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_products').select('id, sku_code, name').order('sku_code');
      return data || [];
    },
  });
  const { data: bins } = useQuery({
    queryKey: ['wms_bins_min'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_bins').select('id, bin_code, warehouse_id').order('bin_code');
      return data || [];
    },
  });
  const { data: warehouses } = useQuery({
    queryKey: ['wms_wh_min'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_warehouses').select('id, name').order('name');
      return data || [];
    },
  });
  const { data: inventory, isLoading } = useQuery({
    queryKey: ['wms_inv_for_adj'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_inventory')
        .select('id, product_id, bin_id, warehouse_id, qty_on_hand, qty_locked')
        .order('qty_on_hand');
      return data || [];
    },
  });

  async function submit() {
    if (!productId || !binId || !delta) { toast.error('请填写完整'); return; }
    const d = parseInt(delta);
    if (!d) { toast.error('变动数量必须是非零整数'); return; }
    setSubmitting(true);
    try {
      // 1. 查当前库存
      const { data: rows } = await supabase.from('wms_inventory')
        .select('id, qty_on_hand').eq('product_id', productId).eq('bin_id', binId);
      if (!rows || rows.length === 0) {
        toast.error('该 SKU 在该库位无库存，请先入库'); return;
      }
      const row = rows[0];
      const newQty = row.qty_on_hand + d;
      if (newQty < 0) { toast.error(`调整后库存不能为负（当前 ${row.qty_on_hand}，变动 ${d}）`); return; }

      // 2. 更新库存
      await supabase.from('wms_inventory').update({ qty_on_hand: newQty, last_move_at: new Date().toISOString() }).eq('id', row.id);

      // 3. 写流水
      await supabase.from('wms_inventory_txn').insert({
        product_id: productId, bin_id: binId, warehouse_id: inventory?.[0]?.warehouse_id,
        txn_type: 'ADJUST', qty_delta: d, after_qty: newQty,
        ref_type: 'ADJUSTMENT', ref_no: reason, remark,
      });

      toast.success(`调整成功：${d > 0 ? '+' : ''}${d}`);
      qc.invalidateQueries({ queryKey: ['wms_inv_for_adj', 'wms_txn_all'] });
      setShowForm(false); setDelta(''); setRemark('');
    } catch (e: any) {
      toast.error(e.message || '调整失败');
    } finally { setSubmitting(false); }
  }

  const prodMap = Object.fromEntries((products || []).map((p: any) => [p.id, p]));
  const binMap = Object.fromEntries((bins || []).map((b: any) => [b.id, b]));
  const whMap = Object.fromEntries((warehouses || []).map((w: any) => [w.id, w]));

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">库存调整</h2>
          <p className="text-sm text-muted-foreground mt-1">手动盘盈盘亏 / 质量冻结 / 次品报废</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-md bg-brand text-white text-sm hover:bg-brand-hover">
          + 新建调整
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h3 className="font-semibold mb-4">新建库存调整单</h3>
          <div className="grid grid-cols-2 gap-4 max-w-3xl">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">SKU</label>
              <select value={productId} onChange={e => setProductId(e.target.value)} className="inp w-full">
                <option value="">选择 SKU...</option>
                {products?.map((p: any) => <option key={p.id} value={p.id}>{p.sku_code} — {p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">库位</label>
              <select value={binId} onChange={e => setBinId(e.target.value)} className="inp w-full">
                <option value="">选择库位...</option>
                {bins?.map((b: any) => <option key={b.id} value={b.id}>{b.bin_code} ({whMap[b.warehouse_id]?.name || '-'})</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">变动数量（正=增加，负=减少）</label>
              <input type="number" value={delta} onChange={e => setDelta(e.target.value)} placeholder="如 +5 或 -3" className="inp w-full" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">原因</label>
              <select value={reason} onChange={e => setReason(e.target.value)} className="inp w-full">
                <option>盘盈</option><option>盘亏</option><option>质量问题冻结</option>
                <option>次品报废</option><option>调拨</option><option>其他</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">备注</label>
              <input value={remark} onChange={e => setRemark(e.target.value)} placeholder="可选" className="inp w-full" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={submit} disabled={submitting} className="px-4 py-2 rounded-md bg-brand text-white text-sm disabled:opacity-50">
              {submitting ? '提交中...' : '确认调整'}
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-md border text-sm">取消</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">SKU</th>
              <th className="text-left px-4 py-2.5">库位</th>
              <th className="text-left px-4 py-2.5">仓库</th>
              <th className="text-right px-4 py-2.5">在库</th>
              <th className="text-right px-4 py-2.5">锁定</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="p-8 text-center text-slate-400">加载中...</td></tr>}
            {!isLoading && inventory?.length === 0 && <tr><td colSpan={5} className="p-8 text-center text-slate-400">暂无库存</td></tr>}
            {inventory?.map((r: any) => (
              <tr key={r.id} className="border-t hover:bg-slate-50">
                <td className="px-4 py-2.5 font-mono text-xs">{prodMap[r.product_id]?.sku_code || r.product_id}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{binMap[r.bin_id]?.bin_code || r.bin_id}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{whMap[r.warehouse_id]?.name || '-'}</td>
                <td className="px-4 py-2.5 text-right font-mono">{r.qty_on_hand}</td>
                <td className="px-4 py-2.5 text-right font-mono text-slate-400">{r.qty_locked || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
