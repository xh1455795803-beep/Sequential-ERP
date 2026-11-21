import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { Plus, ClipboardList, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Modal, Grid, Field, Footer } from '../../../components/shared/ui';

// 盘点状态 smallint 1-5
const STOCKTAKE_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: '草稿',     cls: 'bg-muted text-muted-foreground' },
  2: { label: '盘点中',   cls: 'bg-warning-bg text-warning' },
  3: { label: '差异复核', cls: 'bg-danger-bg text-destructive' },
  4: { label: '已完成',   cls: 'bg-success-bg text-success' },
  5: { label: '已取消',   cls: 'bg-muted text-muted-foreground' },
};

export function StocktakingPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [active, setActive] = useState<any>(null);
  const [inputs, setInputs] = useState<Record<string, number>>({});

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: zones } = useQuery({
    queryKey: ['wms_zones_all'],
    queryFn: async () => { const { data } = await supabase.from('wms_zones').select('*'); return data || []; },
  });

  const { data: list } = useQuery({
    queryKey: ['wms_stocktaking_all'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_stocktaking').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  async function openSheet(s: any) {
    setActive(s);
    // 查 items
    const { data: items } = await supabase.from('wms_stocktaking_items').select('*').eq('stocktake_id', s.id).order('sku_code');
    // 若还没生成，从当前库存生成
    if (!items?.length) {
      const { data: inv } = await supabase.from('wms_inventory').select('*').eq('warehouse_id', s.warehouse_id);
      if (inv?.length) {
        const rows = inv.map((r: any) => ({
          tenant_id: r.tenant_id, stocktake_id: s.id,
          product_id: r.product_id, sku_code: null, // 稍后补
          bin_id: r.bin_id, system_qty: +r.qty_onhand,
          actual_qty: +r.qty_onhand,
        }));
        // 补 sku_code（从 products）
        const productIds = [...new Set(inv.map((r: any) => r.product_id))];
        const { data: prods } = await supabase.from('wms_products').select('id, sku_code').in('id', productIds);
        const prodMap = Object.fromEntries((prods || []).map((p: any) => [p.id, p.sku_code]));
        const finalRows = rows.map((r: any, idx: number) => ({ ...r, sku_code: prodMap[inv[idx].product_id] }));
        const { data: insItems } = await supabase.from('wms_stocktaking_items').insert(finalRows).select();
        const total = finalRows.reduce((a, b) => a + +b.system_qty, 0);
        const diffQty = finalRows.reduce((a, b) => a + Math.abs(+b.system_qty - +b.actual_qty), 0);
        await supabase.from('wms_stocktaking').update({
          total_qty: total, diff_qty: diffQty, diff_flag: 0, status: 2, started_at: new Date().toISOString(),
        }).eq('id', s.id);
        (insItems || []).forEach((it: any) => { inputs[it.id] = it.actual_qty; });
      }
    } else {
      items.forEach((it: any) => { inputs[it.id] = it.actual_qty; });
    }
    setInputs({ ...inputs });
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">盘点管理</h2>
          <p className="text-sm text-muted-foreground mt-1">定期盘点实物与系统库存核对</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建盘点
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* 盘点单列表 */}
        <div className="col-span-1 bg-card rounded-xl shadow-soft border border-border overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-border font-semibold text-sm">盘点单</div>
          <div className="max-h-[520px] overflow-auto">
            {list?.map((s: any) => {
              const st = STOCKTAKE_STATUS[s.status] || { label: s.status, cls: 'bg-muted' };
              const zone = (zones as any[])?.find((z: any) => z.id === s.zone_id);
              return (
                <div key={s.id} onClick={() => openSheet(s)}
                  className={`px-4 py-3 border-b border-transparent cursor-pointer hover:bg-muted ${active?.id === s.id ? 'bg-brand-50 border-l-2 border-brand-500' : ''}`}>
                  <div className="font-mono text-brand-600 text-sm">{s.stocktake_no}</div>
                  <div className="text-xs text-muted-foreground mt-1 flex justify-between">
                    <span>{zone ? `按库区 ${zone.zone_code}` : '全盘'}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${st.cls}`}>{st.label}</span>
                  </div>
                  {(+s.diff_qty || 0) > 0 && (
                    <div className="text-xs text-destructive mt-1">差异量 {s.diff_qty}</div>
                  )}
                </div>
              );
            })}
            {!list?.length && <div className="p-10 text-center text-muted-foreground text-sm">暂无盘点单</div>}
          </div>
        </div>

        {/* 盘点执行面板 */}
        <div className="col-span-2 bg-card rounded-xl shadow-soft border border-border overflow-hidden">
          {!active ? (
            <div className="p-10 text-center text-muted-foreground">
              <ClipboardList className="w-12 h-12 mx-auto mb-2 opacity-30" />
              <div>从左侧选择一个盘点单开始盘点</div>
            </div>
          ) : (
            <SheetPanel sheet={active} inputs={inputs} setInputs={setInputs} onSaved={() => qc.invalidateQueries()} />
          )}
        </div>
      </div>

      {showForm && <StocktakingForm warehouses={warehouses!} zones={zones!} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries(); }} />}
    </div>
  );
}

function SheetPanel({ sheet, inputs, setInputs, onSaved }: any) {
  const qc = useQueryClient();
  const { data: items, refetch } = useQuery({
    queryKey: ['sheet_items', sheet.id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_stocktaking_items').select('*').eq('stocktake_id', sheet.id).order('sku_code');
      return data || [];
    },
  });
  const { data: bins } = useQuery({
    queryKey: ['wms_bins_map'],
    queryFn: async () => { const { data } = await supabase.from('wms_bins').select('id, bin_code'); return data || []; },
  });

  async function submit() {
    const { data: { user } } = await supabase.auth.getUser();
    let total = 0, diff = 0;
    for (const it of items!) {
      const actual = inputs[it.id] ?? it.actual_qty;
      total += +actual;
      const d = +actual - +it.system_qty;
      diff += Math.abs(d);
      if (+actual !== +it.actual_qty || +d !== +it.diff_qty) {
        await supabase.from('wms_stocktaking_items').update({ actual_qty: +actual, diff_qty: d }).eq('id', it.id);
      }
      if (d !== 0) {
        // 调整库存
        const newOnHand = +it.system_qty + d;
        if (newOnHand >= 0) {
          await supabase.from('wms_inventory').update({
            qty_onhand: newOnHand, last_move_at: new Date().toISOString(),
          }).eq('warehouse_id', sheet.warehouse_id).eq('product_id', it.product_id).eq('bin_id', it.bin_id);
        }
      }
    }
    await supabase.from('wms_stocktaking').update({
      status: 4, total_qty: total, diff_qty: diff, diff_flag: diff > 0 ? 1 : 0,
      completed_at: new Date().toISOString(),
    }).eq('id', sheet.id);

    refetch(); qc.invalidateQueries(); onSaved();
    toast.success(`盘点已保存（差异量 ${diff}）`);
  }

  return (
    <div>
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="font-semibold">{sheet.stocktake_no}</div>
        <button onClick={submit} className="flex items-center gap-1 px-4 py-1.5 bg-brand-500 text-white rounded-lg text-xs hover:bg-brand-600">
          <CheckCircle2 className="w-3 h-3" /> 保存盘点结果
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground text-xs">
          <tr>
            <th className="text-left px-4 py-2">库位</th>
            <th className="text-left px-4 py-2">SKU</th>
            <th className="text-right px-4 py-2">系统数量</th>
            <th className="text-right px-4 py-2">实盘数量</th>
            <th className="text-right px-4 py-2">差异</th>
          </tr>
        </thead>
        <tbody>
          {items?.map((it: any) => {
            const loc = (bins as any[])?.find((l: any) => l.id === it.bin_id);
            const actual = inputs[it.id] ?? it.actual_qty;
            const d = +actual - +it.system_qty;
            return (
              <tr key={it.id} className={`border-t border-transparent ${d !== 0 ? 'bg-danger-bg/40' : ''}`}>
                <td className="px-4 py-2 font-mono text-xs">{loc?.bin_code || '-'}</td>
                <td className="px-4 py-2 font-mono text-brand-600">{it.sku_code || '-'}</td>
                <td className="px-4 py-2 text-right">{it.system_qty}</td>
                <td className="px-4 py-2 text-right w-24">
                  <input type="number" value={actual} onChange={(e) => setInputs({ ...inputs, [it.id]: +e.target.value })}
                    className="inp text-right text-xs py-1 px-2" />
                </td>
                <td className={`px-4 py-2 text-right ${d === 0 ? 'text-muted-foreground' : d > 0 ? 'text-success font-medium' : 'text-destructive font-medium'}`}>
                  {d === 0 ? '-' : (d > 0 ? '+' : '') + d}
                </td>
              </tr>
            );
          })}
          {!items?.length && <tr><td colSpan={5} className="p-10 text-center text-muted-foreground">该盘点单尚未生成明细</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function StocktakingForm({ warehouses, zones, onClose, onSaved }: any) {
  const [f, setF] = useState({
    warehouse_id: warehouses?.[0]?.id || '',
    zone_id: '',
    remark: '',
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) toast.error('请先登录'); return;
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) toast.error('账户未绑定租户'); return;

    const stocktake_no = 'ST' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000);
    const { error } = await supabase.from('wms_stocktaking').insert({
      tenant_id, warehouse_id: f.warehouse_id,
      stocktake_no, zone_id: f.zone_id || null,
      status: 1, diff_qty: 0, total_qty: 0, diff_flag: 0,
      remark: f.remark || null,
    });
    if (error) toast.error(error.message); return;
    onSaved();
  }

  const whZones = (zones as any[])?.filter((z: any) => z.warehouse_id === f.warehouse_id) || [];

  return (
    <Modal title="新建盘点单" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value, zone_id: '' })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.warehouse_code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="按库区（留空=全盘）">
          <select className="inp" value={f.zone_id} onChange={(e) => setF({ ...f, zone_id: e.target.value })}>
            <option value="">全盘</option>
            {whZones.map((z: any) => <option key={z.id} value={z.id}>{z.zone_code} · {z.name}</option>)}
          </select>
        </Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
