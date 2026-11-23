import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  Plus, ArrowLeft, ArrowRightLeft, Truck, CheckCircle, Package,
  MapPin, Building, ClipboardCheck, LogIn, AlertTriangle, Plane,
} from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// -------- 调拨单列表 + 状态 Tab 过滤 --------
export function TransferPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: transfers } = useQuery({
    queryKey: ['wms_transfers_v2', statusFilter],
    queryFn: async () => {
      let q = supabase.from('wms_transfers')
        .select('*, from_wh:from_warehouse_id(name, code), to_wh:to_warehouse_id(name, code), carrier:carrier_id(name)')
        .order('created_at', { ascending: false });
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data } = await q;
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', released: '已释放', shipped: '已发货',
    in_transit: '运输中', received: '已签收', completed: '已完成', cancelled: '已取消',
  };

  const tabs = [
    { v: '', l: '全部' },
    { v: 'draft', l: '草稿' },
    { v: 'released', l: '已释放' },
    { v: 'shipped', l: '已发货' },
    { v: 'in_transit', l: '运输中' },
    { v: 'received', l: '已签收' },
    { v: 'completed', l: '已完成' },
    { v: 'cancelled', l: '已取消' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-7 h-7 text-brand-500" /> 跨库调拨
          </h2>
          <p className="text-sm text-gray-500 mt-1">仓库 A → 仓库 B，支持全流程状态管理 · 签收入库自动双向日志</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建调拨单
        </button>
      </div>

      {/* 状态 Tab 过滤 */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto">
        {tabs.map(t => (
          <button key={t.v} onClick={() => setStatusFilter(t.v)}
            className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors
              ${statusFilter === t.v ? 'bg-brand-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-brand-300'}`}>
            {t.l}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">调拨单号</th>
              <th className="text-left px-5 py-2.5">源仓库 → 目标仓库</th>
              <th className="text-right px-5 py-2.5">SKU / 件数</th>
              <th className="text-left px-5 py-2.5">承运商</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {transfers?.map((t: any) => (
              <tr key={t.id} onClick={() => nav({ to: `/transfers/$id`, params: { id: t.id } })}
                className="border-t border-gray-50 hover:bg-brand-50/30 cursor-pointer">
                <td className="px-5 py-3 font-mono text-brand-600">{t.transfer_no}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-700">{t.from_wh?.code}</span>
                    <ArrowRightLeft className="w-3 h-3 text-brand-500" />
                    <span className="text-gray-700">{t.to_wh?.code}</span>
                  </div>
                  <div className="text-xs text-gray-400">{t.from_wh?.name} → {t.to_wh?.name}</div>
                </td>
                <td className="px-5 py-3 text-right">{t.total_skus || 0} / {t.total_qty || 0}</td>
                <td className="px-5 py-3">{t.carrier?.name || '-'}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${transferStatusBadge(t.status)}`}>{statusLabel[t.status] || t.status}</span>
                </td>
                <td className="px-5 py-3 text-right text-brand-500 text-xs">点击处理 →</td>
              </tr>
            ))}
            {!transfers?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无调拨单</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <TransferForm onClose={() => setShowForm(false)}
        onSaved={(id) => {
          setShowForm(false);
          qc.invalidateQueries();
          nav({ to: `/transfers/$id`, params: { id } });
        }} />}
    </div>
  );
}

function transferStatusBadge(s: string) {
  const m: any = {
    draft: 'bg-gray-100 text-gray-500', released: 'bg-blue-50 text-blue-600',
    shipped: 'bg-amber-50 text-amber-600', in_transit: 'bg-amber-100 text-amber-700',
    received: 'bg-purple-50 text-purple-600', completed: 'bg-green-50 text-green-600',
    cancelled: 'bg-gray-100 text-gray-400',
  };
  return m[s] || 'bg-gray-100';
}

// 新建调拨单（自动选源 location）
function TransferForm({ onClose, onSaved }: any) {
  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: carriers } = useQuery({
    queryKey: ['wms_carriers'],
    queryFn: async () => { const { data } = await supabase.from('wms_carriers').select('*'); return data || []; },
  });

  const [f, setF] = useState({
    from_warehouse_id: '', to_warehouse_id: '',
    carrier_id: '', tracking_no: '', remark: '',
  });
  const [items, setItems] = useState<any[]>([{ sku: '', sku_name: '', qty: 1 }]);

  // 🆕 源仓库库存（用于自动选源 location 预览）
  const { data: invPreview } = useQuery({
    queryKey: ['inv_preview', f.from_warehouse_id],
    enabled: !!f.from_warehouse_id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_inventory')
        .select('sku, location_id, qty_on_hand, zone_id')
        .eq('warehouse_id', f.from_warehouse_id)
        .gt('qty_on_hand', 0);
      return data || [];
    },
  });

  // 🆕 自动估算所选 SKU 是否有足够库存
  const inventoryOK = useMemo(() => {
    if (!invPreview) return true;
    for (const it of items) {
      const avail = (invPreview as any[])
        .filter((i: any) => i.sku === it.sku)
        .reduce((s: number, i: any) => s + (i.qty_on_hand || 0), 0);
      if (avail < (it.qty || 0)) return false;
    }
    return true;
  }, [items, invPreview]);

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!f.from_warehouse_id || !f.to_warehouse_id) return alert('请选择源仓库和目标仓库');
    if (f.from_warehouse_id === f.to_warehouse_id) return alert('源仓库和目标仓库不能相同');
    if (!items.length) return alert('请至少添加一个调拨 SKU');
    if (!inventoryOK) return alert('部分 SKU 源仓库库存不足，请检查明细');

    const { data, error } = await supabase.from('wms_transfers').insert({
      user_id: user!.id,
      transfer_no: 'TRF' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000),
      from_warehouse_id: f.from_warehouse_id, to_warehouse_id: f.to_warehouse_id,
      carrier_id: f.carrier_id || null, tracking_no: f.tracking_no || null,
      total_skus: items.length,
      total_qty: items.reduce((s, i) => s + (+i.qty || 0), 0),
      remark: f.remark,
    }).select().single();

    if (error) return alert(error.message);

    // 🆕 自动选源 location（FIFO 最早的库位优先）
    const itemRows: any[] = [];
    for (const it of items) {
      const matchedLocs = (invPreview as any[])
        ?.filter((i: any) => i.sku === it.sku && i.qty_on_hand > 0)
        ?.sort((a, b) => (a.inbound_at || '').localeCompare(b.inbound_at || '')) || [];

      let remaining = it.qty;
      const selectedLocs: string[] = [];
      for (const loc of matchedLocs) {
        if (remaining <= 0) break;
        selectedLocs.push(loc.location_id);
        remaining -= loc.qty_on_hand;
      }
      itemRows.push({
        user_id: user!.id, transfer_id: data.id,
        sku: it.sku, sku_name: it.sku_name, qty: +it.qty || 0,
        from_location_id: selectedLocs[0] || null,
        selected_from_location_ids: selectedLocs,
      });
    }

    const { error: ie } = await supabase.from('wms_transfer_items').insert(itemRows);
    if (ie) return alert('明细保存失败：' + ie.message);

    onSaved(data.id);
  }

  return (
    <Modal title="新建跨库调拨单" onClose={onClose}>
      <Grid>
        <Field label="源仓库 *">
          <select className="inp" value={f.from_warehouse_id} onChange={(e) => setF({ ...f, from_warehouse_id: e.target.value })}>
            <option value="">选择仓库</option>
            {(warehouses as any[])?.filter(w => w.id !== f.to_warehouse_id).map((w: any) =>
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="目标仓库 *">
          <select className="inp" value={f.to_warehouse_id} onChange={(e) => setF({ ...f, to_warehouse_id: e.target.value })}>
            <option value="">选择仓库</option>
            {(warehouses as any[])?.filter(w => w.id !== f.from_warehouse_id).map((w: any) =>
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="承运商">
          <select className="inp" value={f.carrier_id} onChange={(e) => setF({ ...f, carrier_id: e.target.value })}>
            <option value="">暂不指定</option>
            {(carriers as any[])?.map((c: any) =>
              <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="跟踪号"><input className="inp" value={f.tracking_no} onChange={(e) => setF({ ...f, tracking_no: e.target.value })} /></Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>

      {/* 🆕 库存校验提示 */}
      {f.from_warehouse_id && !inventoryOK && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          警告：部分 SKU 在源仓库库存不足，保存后可能导致调拨入库不完整
        </div>
      )}

      <div className="mt-4 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm flex items-center gap-1.5"><Package className="w-4 h-4 text-brand-500" /> 调拨明细</span>
          <button onClick={() => setItems([...items, { sku: '', sku_name: '', qty: 1 }])}
            className="text-xs text-brand-500 hover:text-brand-600">+ 添加 SKU</button>
        </div>
        <table className="w-full text-xs">
          <thead className="text-gray-400">
            <tr>
              <th className="text-left py-1">SKU *</th>
              <th className="text-left py-1">名称</th>
              <th className="text-right py-1 w-20">数量 *</th>
              <th className="text-right py-1 w-20">源仓库存</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, idx) => {
              const stock = (invPreview as any[])?.filter((i: any) => i.sku === it.sku)
                .reduce((s: number, i: any) => s + (i.qty_on_hand || 0), 0) || 0;
              const low = stock < (it.qty || 0);
              return (
                <tr key={idx}>
                  <td className="py-1"><input className="inp" value={it.sku} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, sku: e.target.value } : x))} /></td>
                  <td className="py-1"><input className="inp" value={it.sku_name} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, sku_name: e.target.value } : x))} /></td>
                  <td className="py-1"><input className="inp text-right" type="number" min={1} value={it.qty} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))} /></td>
                  <td className={`py-1 text-right font-medium ${low ? 'text-red-500' : 'text-gray-500'}`}>{stock}</td>
                  <td className="py-1 text-center">
                    {items.length > 1 && (
                      <button onClick={() => setItems(items.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-500">×</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// -------- 调拨单详情页 --------
export function TransferDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: transfer } = useQuery({
    queryKey: ['transfer_v2', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_transfers')
        .select('*, from_wh:from_warehouse_id(*), to_wh:to_warehouse_id(*), carrier:carrier_id(*)')
        .eq('id', id).single();
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ['transfer_items_v2', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_transfer_items').select('*').eq('transfer_id', id);
      return data || [];
    },
  });

  const { data: locations } = useQuery({
    queryKey: ['wms_locations_v2', transfer?.to_warehouse_id],
    enabled: !!transfer?.to_warehouse_id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_locations')
        .select('id, code, status, zone_id').eq('warehouse_id', transfer.to_warehouse_id);
      return data || [];
    },
  });

  const { data: targetZones } = useQuery({
    queryKey: ['target_zones', transfer?.to_warehouse_id],
    enabled: !!transfer?.to_warehouse_id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_zones').select('id, code, name').eq('warehouse_id', transfer.to_warehouse_id);
      return data || [];
    },
  });

  async function transition(newStatus: string, extra: any = {}) {
    const { error } = await supabase.from('wms_transfers').update({
      status: newStatus,
      ...extra,
    }).eq('id', id);
    if (error) return alert(error.message);
    qc.invalidateQueries();
  }

  async function shipTransfer() {
    await transition('shipped', { shipped_at: new Date().toISOString() });
  }

  async function markInTransit() {
    await transition('in_transit');
  }

  // 🆕 签收入库：选空库位 → upsert wms_inventory → 写双向 inventory_logs
  async function receiveTransfer() {
    if (!transfer) return;
    if (!confirm('确认已签收？库存将写入目标仓库。')) return;

    const { data: { user } } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const logs: any[] = [];

    // 1. 源仓库扣减 + 出库日志
    for (const it of (items || [])) {
      let remaining = it.qty;

      // 如果 item 有指定 from_location_ids（多选），依次扣
      const selectedIds: string[] = it.selected_from_location_ids || (it.from_location_id ? [it.from_location_id] : []);

      if (selectedIds.length > 0) {
        for (const locId of selectedIds) {
          if (remaining <= 0) break;
          const { data: inv } = await supabase.from('wms_inventory')
            .select('id, qty_on_hand')
            .eq('warehouse_id', transfer.from_warehouse_id)
            .eq('location_id', locId)
            .eq('sku', it.sku)
            .gt('qty_on_hand', 0);

          if (inv?.length) {
            const row = inv[0];
            const deduct = Math.min(row.qty_on_hand, remaining);
            const newQty = row.qty_on_hand - deduct;

            await supabase.from('wms_inventory').update({ qty_on_hand: newQty }).eq('id', row.id);
            if (newQty === 0) {
              await supabase.from('wms_locations').update({ status: 'empty' }).eq('id', locId);
            }

            logs.push({
              user_id: user!.id, warehouse_id: transfer.from_warehouse_id,
              sku: it.sku, location_id: locId,
              qty_change: -deduct, qty_after: newQty,
              type: 'transfer_out', ref_type: 'transfer', ref_id: transfer.id,
              operator: user?.email, remark: `调拨单 ${transfer.transfer_no} 出库`,
              created_at: now,
            });
            remaining -= deduct;
          }
        }
      } else {
        // 回退：源仓所有相同 SKU 按 FIFO 扣
        const { data: srcInv } = await supabase.from('wms_inventory')
          .select('id, qty_on_hand, location_id')
          .eq('warehouse_id', transfer.from_warehouse_id)
          .eq('sku', it.sku)
          .gt('qty_on_hand', 0)
          .order('inbound_at');

        for (const inv of (srcInv || [])) {
          if (remaining <= 0) break;
          const deduct = Math.min(inv.qty_on_hand, remaining);
          const newQty = inv.qty_on_hand - deduct;
          await supabase.from('wms_inventory').update({ qty_on_hand: newQty }).eq('id', inv.id);
          if (newQty === 0) {
            await supabase.from('wms_locations').update({ status: 'empty' }).eq('id', inv.location_id);
          }
          logs.push({
            user_id: user!.id, warehouse_id: transfer.from_warehouse_id,
            sku: it.sku, location_id: inv.location_id,
            qty_change: -deduct, qty_after: newQty,
            type: 'transfer_out', ref_type: 'transfer', ref_id: transfer.id,
            operator: user?.email, remark: `调拨单 ${transfer.transfer_no} 出库`,
            created_at: now,
          });
          remaining -= deduct;
        }
      }
    }

    // 2. 目标仓库入库：找空库位
    const emptyLocs = (locations as any[])?.filter((l: any) => l.status === 'empty') || [];
    const usedLocIds: string[] = [];

    for (const it of (items || [])) {
      // 优先合入已有同 SKU 的库位
      const { data: sameLoc } = await supabase.from('wms_inventory')
        .select('id, location_id, qty_on_hand')
        .eq('warehouse_id', transfer.to_warehouse_id)
        .eq('sku', it.sku)
        .limit(1);

      if (sameLoc?.[0]) {
        const newQty = sameLoc[0].qty_on_hand + it.qty;
        await supabase.from('wms_inventory').update({ qty_on_hand: newQty, updated_at: now })
          .eq('id', sameLoc[0].id);
        logs.push({
          user_id: user!.id, warehouse_id: transfer.to_warehouse_id,
          sku: it.sku, location_id: sameLoc[0].location_id,
          qty_change: it.qty, qty_after: newQty,
          type: 'transfer_in', ref_type: 'transfer', ref_id: transfer.id,
          operator: user?.email, remark: `调拨单 ${transfer.transfer_no} 入库（合批）`,
          created_at: now,
        });
        await supabase.from('wms_transfer_items').update({ to_location_id: sameLoc[0].location_id }).eq('id', it.id);
      } else {
        // 找空库位
        const emptyLoc = emptyLocs.shift();
        if (!emptyLoc) {
          alert(`⚠ 目标仓库空库位不足，SKU ${it.sku} 未能入库！请先创建空库位。`);
          continue;
        }
        usedLocIds.push(emptyLoc.id);
        await supabase.from('wms_locations').update({ status: 'occupied' }).eq('id', emptyLoc.id);

        const { data: newInv } = await supabase.from('wms_inventory').insert({
          user_id: user!.id, warehouse_id: transfer.to_warehouse_id,
          location_id: emptyLoc.id, sku: it.sku,
          qty_on_hand: it.qty, inbound_at: now, updated_at: now,
        }).select().single();

        logs.push({
          user_id: user!.id, warehouse_id: transfer.to_warehouse_id,
          sku: it.sku, location_id: emptyLoc.id,
          qty_change: it.qty, qty_after: it.qty,
          type: 'transfer_in', ref_type: 'transfer', ref_id: transfer.id,
          operator: user?.email, remark: `调拨单 ${transfer.transfer_no} 入库`,
          created_at: now,
        });
        await supabase.from('wms_transfer_items').update({ to_location_id: emptyLoc.id }).eq('id', it.id);
      }
    }

    // 3. 批量写 inventory_logs（双向：源仓出库 + 目标仓入库）
    if (logs.length) {
      await supabase.from('wms_inventory_logs').insert(logs);
    }

    await transition('completed', { received_at: now });
    alert(`调拨完成！源仓出库 + 目标仓入库，共 ${logs.length} 条库存日志`);
  }

  async function releaseTransfer() { await transition('released'); }
  async function cancelTransfer() {
    if (!confirm('确定取消此调拨单？')) return;
    await transition('cancelled');
  }

  if (!transfer) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  const st = transfer.status;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/transfers' })} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回调拨单列表
      </button>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <ArrowRightLeft className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{transfer.transfer_no}</div>
            <div className="text-xs text-gray-500">
              <span className={`px-2 py-0.5 rounded text-xs mr-2 ${transferStatusBadge(st)}`}>{st}</span>
              <span className="font-semibold text-brand-600">{transfer.from_wh?.code}</span>
              <ArrowRightLeft className="w-3 h-3 inline mx-1" />
              <span className="font-semibold text-sea-600">{transfer.to_wh?.code}</span>
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            {st === 'draft' && (
              <button onClick={releaseTransfer} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
                释放（开始作业）
              </button>
            )}
            {st === 'released' && (
              <button onClick={shipTransfer} className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 flex items-center gap-1.5">
                <Truck className="w-4 h-4" /> 发货
              </button>
            )}
            {st === 'shipped' && (
              <button onClick={markInTransit} className="px-4 py-2 bg-amber-100 text-amber-700 rounded-lg text-sm hover:bg-amber-200 flex items-center gap-1">
                <Plane className="w-4 h-4" /> 标记运输中
              </button>
            )}
            {(st === 'shipped' || st === 'in_transit') && (
              <button onClick={receiveTransfer} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> 签收并入库
              </button>
            )}
            {st !== 'completed' && st !== 'cancelled' && (
              <button onClick={cancelTransfer} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">
                取消
              </button>
            )}
          </div>
        </div>

        {/* 状态流 */}
        <div className="flex items-center gap-1 mb-4">
          {['draft', 'released', 'shipped', 'in_transit', 'received', 'completed'].map((s, i) => {
            const idx = ['draft', 'released', 'shipped', 'in_transit', 'received', 'completed'].indexOf(st);
            const active = idx >= i;
            return (
              <div key={s} className="flex items-center flex-1">
                <div className={`flex-1 text-center py-1 rounded text-xs ${active ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-400'}`}>
                  {({ draft: '草稿', released: '释放', shipped: '发货', in_transit: '在途', received: '签收', completed: '完成' } as any)[s]}
                </div>
                {i < 5 && <div className={`h-0.5 w-2 ${idx > i ? 'bg-brand-500' : 'bg-gray-200'}`} />}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-400 flex items-center gap-1"><Building className="w-3 h-3" /> 源仓库</div>
            <div className="font-medium text-brand-600">{transfer.from_wh?.name}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 flex items-center gap-1"><Building className="w-3 h-3" /> 目标仓库</div>
            <div className="font-medium text-sea-600">{transfer.to_wh?.name}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">承运商</div>
            <div className="font-medium">{transfer.carrier?.name || '未指定'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">跟踪号</div>
            <div className="font-mono text-xs">{transfer.tracking_no || '-'}</div>
          </div>
        </div>
      </div>

      {/* 调拨明细 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium flex items-center gap-1.5">
          <ClipboardCheck className="w-4 h-4 text-brand-500" />
          调拨明细（{items?.length || 0} SKU，{items?.reduce((s, i: any) => s + i.qty, 0) || 0} 件）
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2">SKU</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-right px-4 py-2">数量</th>
              <th className="text-left px-4 py-2">源库位（自动选）</th>
              <th className="text-left px-4 py-2">目标库位（签收时分配）</th>
            </tr>
          </thead>
          <tbody>
            {(items || []).map((it: any) => {
              const fromLocs = (it.selected_from_location_ids || [it.from_location_id])
                .filter(Boolean)
                .map((id: string) => (locations as any[])?.find((l: any) => l.id === id))
                .filter(Boolean);
              const toLoc = (locations as any[])?.find((l: any) => l.id === it.to_location_id);
              return (
                <tr key={it.id} className="border-t border-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{it.sku}</td>
                  <td className="px-4 py-2">{it.sku_name || '-'}</td>
                  <td className="px-4 py-2 text-right font-semibold">{it.qty}</td>
                  <td className="px-4 py-2">
                    {fromLocs.length > 0 ? (
                      <span className="inline-flex flex-wrap gap-1">
                        {fromLocs.map((l: any, i: number) => (
                          <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-brand-50 text-brand-600 font-mono">{l?.code}</span>
                        ))}
                      </span>
                    ) : <span className="text-gray-400 text-xs">自动选择</span>}
                  </td>
                  <td className="px-4 py-2 text-sea-600">
                    {toLoc ? <span className="font-mono">{toLoc.code}</span> : <span className="text-gray-400 text-xs">签收时自动分配</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <style>{`.inp{width:100%;padding:6px 8px;border:1px solid #e5e7eb;border-radius:6px;outline:none;background:#fff;font-size:12px}.inp:focus{border-color:#f97316}`}</style>
    </div>
  );
}
