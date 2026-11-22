import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { useState } from 'react';
import { toast } from 'sonner';

const PO_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: '草稿', cls: 'bg-slate-100 text-slate-600' },
  2: { label: '已下单', cls: 'bg-blue-100 text-blue-600' },
  3: { label: '部分到货', cls: 'bg-amber-100 text-amber-600' },
  4: { label: '已完成', cls: 'bg-emerald-100 text-emerald-600' },
  5: { label: '已取消', cls: 'bg-red-100 text-red-600' },
};

export function PurchaseOrdersPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [remark, setRemark] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['wms_po_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_purchase_orders')
        .select('*, supplier:supplier_id(id, name)')
        .order('created_at', { ascending: false });
      return data || [];
    },
  });
  const { data: suppliers } = useQuery({
    queryKey: ['wms_suppliers_min'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_suppliers').select('id, name').order('name');
      return data || [];
    },
  });

  async function submit() {
    if (!supplierId) { toast.error('请选择供应商'); return; }
    const { error } = await supabase.from('wms_purchase_orders').insert({
      supplier_id: supplierId, status: 1, expected_date: expectedDate || null, remark,
    });
    if (error) { toast.error(error.message); return; }
    toast.success('采购单已创建');
    qc.invalidateQueries({ queryKey: ['wms_po_all'] });
    setShowForm(false); setSupplierId(''); setExpectedDate(''); setRemark('');
  }

  async function advance(id: string, newStatus: number) {
    await supabase.from('wms_purchase_orders').update({ status: newStatus }).eq('id', id);
    qc.invalidateQueries({ queryKey: ['wms_po_all'] });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">采购订单</h2>
          <p className="text-sm text-muted-foreground mt-1">向供应商下达的采购单统一入口</p>
        </div>
        <button onClick={() => setShowForm(true)} className="px-4 py-2 rounded-md bg-brand text-white text-sm hover:bg-brand-hover">
          + 新建采购单
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 mb-6">
          <h3 className="font-semibold mb-4">新建采购单</h3>
          <div className="grid grid-cols-2 gap-4 max-w-3xl">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">供应商 *</label>
              <select value={supplierId} onChange={e => setSupplierId(e.target.value)} className="inp w-full">
                <option value="">选择供应商...</option>
                {suppliers?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">预计到货日期</label>
              <input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className="inp w-full" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-slate-500 mb-1 block">备注</label>
              <input value={remark} onChange={e => setRemark(e.target.value)} className="inp w-full" />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={submit} className="px-4 py-2 rounded-md bg-brand text-white text-sm">创建</button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-md border text-sm">取消</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5">采购单号</th>
              <th className="text-left px-4 py-2.5">供应商</th>
              <th className="text-left px-4 py-2.5">预计到货</th>
              <th className="text-left px-4 py-2.5">备注</th>
              <th className="text-left px-4 py-2.5">状态</th>
              <th className="text-right px-4 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-8 text-center text-slate-400">加载中...</td></tr>}
            {!isLoading && data?.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">暂无采购单</td></tr>}
            {data?.map((p: any) => {
              const st = PO_STATUS[p.status] || { label: p.status, cls: 'bg-slate-100' };
              return (
                <tr key={p.id} className="border-t hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-mono text-brand-600">{p.po_no}</td>
                  <td className="px-4 py-2.5">{p.supplier?.name || '-'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">{p.expected_date || '-'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-500 truncate max-w-[200px]">{p.remark || '-'}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right space-x-1">
                    {p.status === 1 && <button onClick={() => advance(p.id, 2)} className="text-xs text-blue-600 hover:underline">下单</button>}
                    {p.status === 2 && <button onClick={() => advance(p.id, 3)} className="text-xs text-amber-600 hover:underline">部分到货</button>}
                    {p.status === 3 && <button onClick={() => advance(p.id, 4)} className="text-xs text-emerald-600 hover:underline">完成</button>}
                    {p.status === 1 && <button onClick={() => advance(p.id, 5)} className="text-xs text-red-500 hover:underline ml-2">取消</button>}
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
