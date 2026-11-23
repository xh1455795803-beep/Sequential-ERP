import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, ClipboardList, CheckCircle2, AlertTriangle, Snowflake, Lock, Unlock } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

export function StocktakingPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [active, setActive] = useState<any>(null);
  const [inputs, setInputs] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: list } = useQuery({
    queryKey: ['wms_stocktaking', statusFilter],
    queryFn: async () => {
      let q = supabase.from('wms_stocktaking').select('*').order('created_at', { ascending: false });
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data } = await q;
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', in_progress: '盘点中', diff_reviewed: '差异复核',
    completed: '已完成', cancelled: '已取消',
  };

  const tabs = [
    { v: '', l: '全部' }, { v: 'draft', l: '草稿' },
    { v: 'in_progress', l: '盘点中' }, { v: 'completed', l: '已完成' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">盘点管理</h2>
          <p className="text-sm text-gray-500 mt-1">定期盘点实物与系统库存核对 · 支持冻结盘点区域</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建盘点
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.v} onClick={() => setStatusFilter(t.v)}
            className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors
              ${statusFilter === t.v ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-brand-300'}`}>
            {t.l}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* 盘点单列表 */}
        <div className="col-span-1 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-gray-100 font-semibold text-sm">盘点单</div>
          <div className="max-h-[560px] overflow-auto">
            {list?.map((s: any) => (
              <div key={s.id} onClick={() => openSheet(s)}
                className={`px-4 py-3 border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${active?.id === s.id ? 'bg-brand-50 border-l-2 border-brand-500' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-brand-600 text-sm">{s.stocktaking_no}</span>
                  {/* 🆕 冻结标记 */}
                  {s.freeze_inventory && (
                    <span className="px-1 py-0.5 rounded text-[10px] bg-blue-50 text-blue-600 inline-flex items-center gap-0.5">
                      <Snowflake className="w-2.5 h-2.5" /> 冻结
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1 flex justify-between">
                  <span>{s.type === 'full' ? '全盘' : s.type}</span>
                  <span>{statusLabel[s.status]}</span>
                </div>
                {s.diff_count > 0 && (
                  <div className="text-xs text-red-500 mt-1">差异 {s.diff_count} 项 / 价值 {s.diff_value?.toFixed(2)}</div>
                )}
                {/* 🆕 盘点中 + 冻结时显示冻结区域数量 */}
                {s.status === 'in_progress' && s.freeze_inventory && s.frozen_zones?.length > 0 && (
                  <div className="text-xs text-blue-500 mt-1">
                    <Lock className="w-2.5 h-2.5 inline" /> 已冻结 {s.frozen_zones.length} 个库区
                  </div>
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
        onSaved={(id) => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_stocktaking'] }); navToSheet(id); }} />}
    </div>
  );

  function navToSheet(id: string) {
    const s = list?.find((x: any) => x.id === id);
    if (s) openSheet(s);
  }

  async function openSheet(s: any) {
    setActive(s);
    const { data: items } = await supabase.from('wms_stocktaking_items').select('*').eq('stocktaking_id', s.id);
    const { data: inv } = await supabase.from('wms_inventory').select('*').eq('warehouse_id', s.warehouse_id);
    if (!items?.length && inv?.length) {
      const rows = inv.map((r: any) => ({
        stocktaking_id: s.id, user_id: s.user_id,
        location_id: r.location_id, product_id: r.product_id, sku: r.sku,
        system_qty: r.qty_on_hand, actual_qty: r.qty_on_hand,
      }));
      await supabase.from('wms_stocktaking_items').insert(rows);

      // 🆕 盘点开始时 freeze_inventory → 自动填 frozen_zones
      let frozenZones = s.frozen_zones || [];
      if (s.freeze_inventory && (!frozenZones || frozenZones.length === 0)) {
        // 从 inventory 中提取该仓库所有 zone_ids 作为默认冻结范围
        const zoneIds = [...new Set((inv || []).map((r: any) => r.zone_id).filter(Boolean))];
        frozenZones = zoneIds;
        await supabase.from('wms_stocktaking').update({
          frozen_zones: zoneIds,
          total_skus: rows.length,
          total_system_qty: rows.reduce((a, b) => a + b.system_qty, 0),
          status: 'in_progress',
        }).eq('id', s.id);
      } else {
        await supabase.from('wms_stocktaking').update({
          total_skus: rows.length,
          total_system_qty: rows.reduce((a, b) => a + b.system_qty, 0),
          status: 'in_progress',
        }).eq('id', s.id);
      }
    }
    const init: Record<string, number> = {};
    (items || []).forEach((it: any) => init[it.id] = it.actual_qty);
    setInputs(init);
    qc.invalidateQueries();
    // 刷新 active 以更新 frozen_zones
    qc.refetchQueries({ queryKey: ['wms_stocktaking'] });
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
    queryKey: ['wms_locations_map'],
    queryFn: async () => { const { data } = await supabase.from('wms_locations').select('id,code'); return data || []; },
  });

  // 🆕 当 freeze_inventory=true 时，查询冻结区域内的拣货任务警告
  const { data: pickWarnings } = useQuery({
    queryKey: ['pick_warnings', sheet.warehouse_id, sheet.frozen_zones],
    enabled: sheet.freeze_inventory && sheet.status === 'in_progress',
    queryFn: async () => {
      // 通过 locations 表关联 zone_id 查 pick_tasks 的 from_location_id
      const { data: locs } = await supabase.from('wms_locations')
        .select('id, zone_id')
        .eq('warehouse_id', sheet.warehouse_id)
        .in('zone_id', sheet.frozen_zones || []);
      const frozenLocIds = (locs || []).map((l: any) => l.id);
      if (!frozenLocIds.length) return [];
      const { data: tasks } = await supabase.from('wms_pick_tasks')
        .select('id, shipment_id, from_location_id, status, created_at')
        .in('from_location_id', frozenLocIds)
        .in('status', ['pending', 'in_progress', 'done']);
      return tasks || [];
    },
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

    // 🆕 盘点完成 → 解除冻结（DB 触发器/应用层都可）
    const { error: upderr } = await supabase.from('wms_stocktaking').update({
      status: 'completed',
      frozen_zones: [], // 清空冻结列表
    }).eq('id', sheet.id);
    if (upderr) return alert('状态更新失败：' + upderr.message);

    if (diffs.length > 0) {
      if (confirm(`存在 ${diffs.length} 项差异，是否自动调整库存账面？（建议先核对实物）`)) {
        const { data: { user } } = await supabase.auth.getUser();
        for (const d of diffs) {
          if (d.diff > 0) {
            await supabase.from('wms_inventory_logs').insert({
              user_id: user!.id, warehouse_id: sheet.warehouse_id,
              sku: d.it.sku, location_id: d.it.location_id,
              qty_change: d.diff, qty_after: d.actual, type: 'adjust_in',
              ref_type: 'stocktaking', ref_id: sheet.id, operator: user?.email,
              remark: `盘点盘盈 ${d.diff}`,
            });
          } else {
            await supabase.from('wms_inventory_logs').insert({
              user_id: user!.id, warehouse_id: sheet.warehouse_id,
              sku: d.it.sku, location_id: d.it.location_id,
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
    alert('盘点已保存，冻结已解除');
  }

  return (
    <div>
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="font-semibold flex items-center gap-2">
          {sheet.stocktaking_no}
          <span className="text-xs text-gray-400">· {sheet.type}</span>
          {/* 🆕 冻结警告 */}
          {sheet.freeze_inventory && sheet.status === 'in_progress' && (
            <span className="px-2 py-0.5 rounded text-xs bg-blue-50 text-blue-600 inline-flex items-center gap-1">
              <Snowflake className="w-3 h-3" /> 盘点冻结中
            </span>
          )}
        </div>
        <button onClick={submit} className="flex items-center gap-1 px-4 py-1.5 bg-brand-500 text-white rounded-lg text-xs hover:bg-brand-600">
          <CheckCircle2 className="w-3 h-3" /> 保存盘点结果
        </button>
      </div>

      {/* 🆕 冻结警告区：当前有拣货任务正在冻结区域内 */}
      {pickWarnings && pickWarnings.length > 0 && sheet.freeze_inventory && sheet.status === 'in_progress' && (
        <div className="mx-4 mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          <div className="flex items-center gap-1.5 font-medium mb-1">
            <AlertTriangle className="w-4 h-4" /> 盘点冻结中：发现 {pickWarnings.length} 个拣货任务位于冻结库区
          </div>
          <div className="text-amber-600">
            这些拣货任务可能与盘点冲突，建议先完成或取消拣货，再进行盘点操作。
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-gray-500 text-xs">
          <tr><th className="text-left px-4 py-2">库位</th><th className="text-left px-4 py-2">SKU</th>
            <th className="text-right px-4 py-2">系统数量</th>
            <th className="text-right px-4 py-2">实盘数量</th>
            <th className="text-right px-4 py-2">差异</th>
            {sheet.freeze_inventory && <th className="text-center px-4 py-2">冻结状态</th>}
          </tr>
        </thead>
        <tbody>
          {items?.map((it: any) => {
            const loc = (locations as any[])?.find((l: any) => l.id === it.location_id);
            const actual = inputs[it.id] ?? it.actual_qty;
            const diff = actual - it.system_qty;
            return (
              <tr key={it.id} className={`border-t border-gray-50 ${diff !== 0 ? 'bg-red-50/40' : ''}`}>
                <td className="px-4 py-2 font-mono text-xs">{loc?.code || '-'}</td>
                <td className="px-4 py-2 font-mono text-brand-600">{it.sku}</td>
                <td className="px-4 py-2 text-right">{it.system_qty}</td>
                <td className="px-4 py-2 text-right w-24">
                  <input type="number" value={actual} onChange={(e) => setInputs({ ...inputs, [it.id]: +e.target.value })}
                    className="inp text-right text-xs py-1 px-2" />
                </td>
                <td className={`px-4 py-2 text-right ${diff === 0 ? 'text-gray-400' : diff > 0 ? 'text-green-600 font-medium' : 'text-red-500 font-medium'}`}>
                  {diff === 0 ? '-' : (diff > 0 ? '+' : '') + diff}
                </td>
                {sheet.freeze_inventory && (
                  <td className="px-4 py-2 text-center">
                    {sheet.status === 'in_progress' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-blue-600">
                        <Lock className="w-3 h-3" /> 冻结中
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-green-600">
                        <Unlock className="w-3 h-3" /> 已解除
                      </span>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {!items?.length && <tr><td colSpan={sheet.freeze_inventory ? 6 : 5} className="p-10 text-center text-gray-400">该盘点单尚未从库存生成明细</td></tr>}
        </tbody>
      </table>
      <style>{`.inp{width:100%;padding:4px 6px;border:1px solid #e5e7eb;border-radius:6px;outline:none;background:#fff}.inp:focus{border-color:#f97316}`}</style>
    </div>
  );
}

// 🆕 新建盘点表单（增加冻结选项）
function StocktakingForm({ warehouses, onClose, onSaved }: any) {
  const { data: zones } = useQuery({
    queryKey: ['wms_zones_form'],
    queryFn: async () => { const { data } = await supabase.from('wms_zones').select('*'); return data || []; },
  });

  const [f, setF] = useState({
    warehouse_id: warehouses?.[0]?.id || '',
    stocktaking_no: 'ST' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000),
    type: 'full', remark: '',
  });

  // 🆕 冻结相关状态
  const [freezeInventory, setFreezeInventory] = useState(false);
  const [selectedZoneIds, setSelectedZoneIds] = useState<string[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string>(''); // 筛选"全部"或按仓库

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    const frozen = freezeInventory ? (selectedZoneIds.length ? selectedZoneIds : null) : null;

    const { error } = await supabase.from('wms_stocktaking').insert({
      ...f, user_id: user!.id,
      freeze_inventory: freezeInventory,
      frozen_zones: frozen,
    });
    if (error) return alert(error.message);
    onSaved();
  }

  const availZones = (zones as any[])?.filter((z: any) => !zoneFilter || z.warehouse_id === zoneFilter) || [];

  function toggleZone(id: string) {
    setSelectedZoneIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <Modal title="新建盘点单" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
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

      {/* 🆕 冻结选项区 */}
      <div className="mt-5 border-t border-dashed pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium flex items-center gap-1.5">
            <Snowflake className="w-4 h-4 text-blue-500" />
            盘点冻结设置
          </div>
          <label className="inline-flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={freezeInventory}
              onChange={(e) => {
                setFreezeInventory(e.target.checked);
                if (!e.target.checked) setSelectedZoneIds([]);
              }}
              className="w-4 h-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            <span>是否冻结盘点区域库存</span>
          </label>
        </div>

        {freezeInventory && (
          <div className="bg-blue-50 rounded-lg p-3 text-xs text-blue-700">
            <div className="flex items-center gap-1 mb-2">
              <Lock className="w-3 h-3" />
              盘点期间，这些区域的拣货任务将显示警告提示，避免库存变动干扰盘点结果。
            </div>
            <div className="max-h-36 overflow-y-auto border border-blue-200 rounded bg-white">
              {(f.type === 'zone' ? availZones : availZones).map((z: any) => (
                <label key={z.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 cursor-pointer">
                  <input type="checkbox" checked={selectedZoneIds.includes(z.id)} onChange={() => toggleZone(z.id)} />
                  <span className="font-mono">{z.code}</span>
                  <span className="text-gray-500">· {z.name}</span>
                </label>
              ))}
              {!availZones.length && <div className="px-3 py-2 text-gray-400">暂无库区</div>}
            </div>
            <div className="mt-2 text-[11px] text-blue-500">
              已选 {selectedZoneIds.length} 个库区（留空 = 开始盘点时自动锁定该仓库全部库区）
            </div>
          </div>
        )}
      </div>

      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}
