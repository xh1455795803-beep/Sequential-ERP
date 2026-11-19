import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, ClipboardList, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

export function StocktakingPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [active, setActive] = useState<any>(null);
  const [inputs, setInputs] = useState<Record<string, number>>({});

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: list } = useQuery({
    queryKey: ['wms_stocktaking'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_stocktaking').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', in_progress: '盘点中', diff_reviewed: '差异复核',
    completed: '已完成', cancelled: '已取消',
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">盘点管理</h2>
          <p className="text-sm text-gray-500 mt-1">定期盘点实物与系统库存核对</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建盘点
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* 盘点单列表 */}
        <div className="col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm">盘点单</div>
          <div className="max-h-[520px] overflow-auto">
            {list?.map((s: any) => (
              <div key={s.id} onClick={() => openSheet(s)}
                className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${active?.id === s.id ? 'bg-brand-50 border-l-2 border-brand-500' : ''}`}>
                <div className="font-mono text-brand-600 text-sm">{s.stocktaking_no}</div>
                <div className="text-xs text-gray-500 mt-1 flex justify-between">
                  <span>{s.type === 'full' ? '全盘' : s.type}</span>
                  <span className="text-xs">{statusLabel[s.status]}</span>
                </div>
                {s.diff_count > 0 && (
                  <div className="text-xs text-red-500 mt-1">差异 {s.diff_count} 项 / 价值 {s.diff_value?.toFixed(2)}</div>
                )}
              </div>
            ))}
            {!list?.length && <div className="p-10 text-center text-gray-400 text-sm">暂无盘点单</div>}
          </div>
        </div>

        {/* 盘点执行面板 */}
        <div className="col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {!active ? (
            <div className="p-10 text-center text-gray-400">
              <ClipboardList className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <div>从左侧选择一个盘点单开始盘点</div>
            </div>
          ) : (
            <SheetPanel sheet={active} inputs={inputs} setInputs={setInputs} onSaved={() => qc.invalidateQueries()} />
          )}
        </div>
      </div>

      {showForm && <StocktakingForm warehouses={warehouses!} onClose={() => setShowForm(false)}
        onSaved={(id) => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_stocktaking'] }); }} />}
    </div>
  );

  async function openSheet(s: any) {
    setActive(s);
    const { data: items } = await supabase.from('wms_stocktaking_items').select('*').eq('stocktaking_id', s.id);
    const { data: inv } = await supabase.from('wms_inventory').select('*').eq('warehouse_id', s.warehouse_id);
    // 若盘点明细还没生成，从库存自动生成
    if (!items?.length && inv?.length) {
      const rows = inv.map((r: any) => ({
        stocktaking_id: s.id, user_id: s.user_id,
        bin_id: r.bin_id, product_id: r.product_id, sku: r.sku,
        system_qty: r.qty_on_hand, actual_qty: r.qty_on_hand,
      }));
      await supabase.from('wms_stocktaking_items').insert(rows);
      await supabase.from('wms_stocktaking').update({
        total_skus: rows.length, total_system_qty: rows.reduce((a, b) => a + b.system_qty, 0),
        status: 'in_progress',
      }).eq('id', s.id);
    }
    // 初始化 inputs 为 system_qty
    const init: Record<string, number> = {};
    (items || []).forEach((it: any) => init[it.id] = it.actual_qty);
    (inv || []).forEach((r: any, idx: number) => {
      const fakeId = `new_${idx}`;
      if (!init[fakeId]) init[fakeId] = r.qty_on_hand;
    });
    setInputs(init);
    qc.invalidateQueries();
  }
}

// 盘点执行面板
function SheetPanel({ sheet, inputs, setInputs, onSaved }: any) {
  const qc = useQueryClient();
  const { data: items, refetch } = useQuery({
    queryKey: ['sheet_items', sheet.id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_stocktaking_items').select('*').eq('stocktaking_id', sheet.id).order('sku');
      return data || [];
    },
  });
  const { data: locations } = useQuery({
    queryKey: ['wms_bins_map'],
    queryFn: async () => { const { data } = await supabase.from('wms_bins').select('id,code'); return data || []; },
  });

  async function submit() {
    const diffs: any[] = [];
    for (const it of items!) {
      const actual = inputs[it.id] ?? it.actual_qty;
      if (actual !== it.actual_qty) {
        const { error } = await supabase.from('wms_stocktaking_items').update({ actual_qty: actual }).eq('id', it.id);
        if (error) return alert(error.message);
      }
      const diff = actual - it.system_qty;
      if (diff !== 0) diffs.push({ it, actual, diff });
    }
    await supabase.from('wms_stocktaking').update({ status: 'completed' }).eq('id', sheet.id);

    // 有差异提示是否自动调整库存
    if (diffs.length > 0) {
      if (confirm(`存在 ${diffs.length} 项差异，是否自动调整库存账面？（建议先核对实物）`)) {
        const { data: { user } } = await supabase.auth.getUser();
        for (const d of diffs) {
          if (d.diff > 0) {
            await supabase.from('wms_inventory_txn').insert({
              user_id: user!.id, warehouse_id: sheet.warehouse_id,
              sku: d.it.sku, bin_id: d.it.bin_id,
              qty_change: d.diff, qty_after: d.actual, type: 'adjust_in',
              ref_type: 'stocktaking', ref_id: sheet.id, operator: user?.email,
              remark: `盘点盘盈 ${d.diff}`,
            });
          } else {
            await supabase.from('wms_inventory_txn').insert({
              user_id: user!.id, warehouse_id: sheet.warehouse_id,
              sku: d.it.sku, bin_id: d.it.bin_id,
              qty_change: d.diff, qty_after: d.actual, type: 'adjust_out',
              ref_type: 'stocktaking', ref_id: sheet.id, operator: user?.email,
              remark: `盘点盘亏 ${-d.diff}`,
            });
          }
        }
      }
    }

    refetch();
    qc.invalidateQueries();
    onSaved();
    alert('盘点已保存');
  }

  return (
    <div>
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="font-semibold">{sheet.stocktaking_no} <span className="text-xs text-gray-400 ml-2">{sheet.type}</span></div>
        <button onClick={submit} className="flex items-center gap-1 px-4 py-1.5 bg-brand-500 text-white rounded-lg text-xs hover:bg-brand-600">
          <CheckCircle2 className="w-3 h-3" /> 保存盘点结果
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs">
          <tr><th className="text-left px-4 py-2">库位</th><th className="text-left px-4 py-2">SKU</th>
            <th className="text-right px-4 py-2">系统数量</th>
            <th className="text-right px-4 py-2">实盘数量</th>
            <th className="text-right px-4 py-2">差异</th></tr>
        </thead>
        <tbody>
          {items?.map((it: any) => {
            const loc = (locations as any[])?.find((l: any) => l.id === it.bin_id);
            const actual = inputs[it.id] ?? it.actual_qty;
            const diff = actual - it.system_qty;
            return (
              <tr key={it.id} className={`border-t border-gray-50 ${diff !== 0 ? 'bg-red-50/40' : ''}`}>
                <td className="px-4 py-2 font-mono text-xs">{loc?.bin_code || '-'}</td>
                <td className="px-4 py-2 font-mono text-brand-600">{it.sku}</td>
                <td className="px-4 py-2 text-right">{it.system_qty}</td>
                <td className="px-4 py-2 text-right w-24">
                  <input type="number" value={actual} onChange={(e) => setInputs({ ...inputs, [it.id]: +e.target.value })}
                    className="inp text-right text-xs py-1 px-2" />
                </td>
                <td className={`px-4 py-2 text-right ${diff === 0 ? 'text-gray-400' : diff > 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}`}>
                  {diff === 0 ? '-' : (diff > 0 ? '+' : '') + diff}
                </td>
              </tr>
            );
          })}
          {!items?.length && <tr><td colSpan={5} className="p-10 text-center text-gray-400">该盘点单尚未从库存生成明细</td></tr>}
        </tbody>
      </table>

    </div>
  );
}

function StocktakingForm({ warehouses, onClose, onSaved }: any) {
  const [f, setF] = useState({
    warehouse_id: warehouses?.[0]?.id || '',
    stocktaking_no: 'ST' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000),
    type: 'full', remark: '',
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('wms_stocktaking').insert({ ...f, user_id: user!.id });
    if (error) return alert(error.message);
    onSaved();
  }

  return (
    <Modal title="新建盘点单" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{wbin_code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="盘点单号 *"><input className="inp" value={f.stocktaking_no} onChange={(e) => setF({ ...f, stocktaking_no: e.target.value })} /></Field>
        <Field label="类型">
          <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="full">全盘</option><option value="zone">按库区</option>
            <option value="location">按库位</option><option value="sku">按 SKU</option>
          </select>
        </Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
