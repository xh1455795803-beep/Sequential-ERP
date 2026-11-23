import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import {
  Plus, ArrowLeft, PackageCheck, Upload, Scissors, Merge, Ban,
  AlertTriangle, CheckCircle2, XCircle, Trash2, Package,
} from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// -------- 列表页 --------
export function ShipmentsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: carriers } = useQuery({
    queryKey: ['wms_carriers'],
    queryFn: async () => { const { data } = await supabase.from('wms_carriers').select('*'); return data || []; },
  });

  const { data: shipments } = useQuery({
    queryKey: ['wms_shipments', statusFilter],
    queryFn: async () => {
      let q = supabase.from('wms_shipments').select('*').order('created_at', { ascending: false });
      if (statusFilter) q = q.eq('status', statusFilter);
      const { data } = await q;
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', released: '已释放', picking: '拣货中',
    packed: '已打包', shipped: '已发货', delivered: '已签收', cancelled: '已取消',
  };

  const tabs = [
    { v: '', l: '全部' }, { v: 'draft', l: '草稿' }, { v: 'picking', l: '拣货中' },
    { v: 'packed', l: '已打包' }, { v: 'shipped', l: '已发货' }, { v: 'cancelled', l: '已取消' },
  ];

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">出库管理</h2>
          <p className="text-sm text-gray-500 mt-1">发货单 → 拣货 → 打包 → 拆合包裹 → 发货</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建发货单
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">发货单号</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-left px-5 py-2.5">收件人/国家</th>
              <th className="text-right px-5 py-2.5">SKU / 件数</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {shipments?.map((s: any) => (
              <tr key={s.id} onClick={() => nav({ to: `/shipments/$id`, params: { id: s.id } })}
                className={`border-t border-gray-50 hover:bg-brand-50/30 cursor-pointer ${s.status === 'cancelled' ? 'bg-red-50/30' : ''}`}>
                <td className="px-5 py-3 font-mono text-brand-600">{s.shipment_no}</td>
                <td className="px-5 py-3">{(warehouses as any[])?.find(w => w.id === s.warehouse_id)?.name || '-'}</td>
                <td className="px-5 py-3">
                  {s.receiver_name || '-'}
                  {s.receiver_country && <span className="text-xs text-gray-400 ml-1">· {s.receiver_country}</span>}
                </td>
                <td className="px-5 py-3 text-right">{s.total_items || 0} / {s.total_qty || 0}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${shipStatusBadge(s.status)}`}>{statusLabel[s.status] || s.status}</span>
                </td>
                <td className="px-5 py-3 text-right text-brand-500 text-xs">点击查看 →</td>
              </tr>
            ))}
            {!shipments?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无发货单</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <ShipmentForm
        warehouses={warehouses!} carriers={carriers!}
        onClose={() => setShowForm(false)}
        onSaved={(id) => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_shipments'] }); nav({ to: `/shipments/$id`, params: { id } }); }} />}
    </div>
  );
}

function shipStatusBadge(s: string) {
  const m: any = {
    draft: 'bg-gray-100 text-gray-500', released: 'bg-blue-50 text-blue-600',
    picking: 'bg-amber-50 text-amber-600', packed: 'bg-purple-50 text-purple-600',
    shipped: 'bg-green-50 text-green-600', delivered: 'bg-green-100 text-green-700',
    cancelled: 'bg-red-50 text-red-500',
  };
  return m[s] || 'bg-gray-100';
}

function ShipmentForm({ warehouses, carriers, onClose, onSaved }: any) {
  const [f, setF] = useState({
    warehouse_id: warehouses?.[0]?.id || '',
    carrier_id: '', tracking_no: '',
    shipment_no: 'SH' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000),
    receiver_name: '', receiver_phone: '', receiver_country: '', receiver_state: '',
    receiver_city: '', receiver_address: '', receiver_postcode: '',
    weight_kg: 0, shipping_cost: 0, remark: '',
  });
  const [items, setItems] = useState<any[]>([{ sku: '', sku_name: '', qty: 1 }]);

  async function save() {
    if (!f.warehouse_id) return alert('请选择仓库');
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('wms_shipments').insert({
      ...f, user_id: user!.id,
      total_items: items.length,
      total_qty: items.reduce((s, i) => s + (+i.qty || 0), 0),
    }).select().single();
    if (error) return alert(error.message);

    const rows = items.map((i) => ({
      ...i, shipment_id: data.id, user_id: user!.id, qty: +i.qty || 0,
    }));
    const { error: ie } = await supabase.from('wms_shipment_items').insert(rows);
    if (ie) return alert(ie.message);
    onSaved(data.id);
  }

  return (
    <Modal title="新建发货单" onClose={onClose}>
      <Grid>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="发货单号 *"><input className="inp" value={f.shipment_no} onChange={(e) => setF({ ...f, shipment_no: e.target.value })} /></Field>
        <Field label="承运商">
          <select className="inp" value={f.carrier_id} onChange={(e) => setF({ ...f, carrier_id: e.target.value })}>
            <option value="">请选择</option>
            {carriers?.map((c: any) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="追踪号"><input className="inp" value={f.tracking_no} onChange={(e) => setF({ ...f, tracking_no: e.target.value })} /></Field>
        <Field label="收件人"><input className="inp" value={f.receiver_name} onChange={(e) => setF({ ...f, receiver_name: e.target.value })} /></Field>
        <Field label="电话"><input className="inp" value={f.receiver_phone} onChange={(e) => setF({ ...f, receiver_phone: e.target.value })} /></Field>
        <Field label="国家"><input className="inp" value={f.receiver_country} onChange={(e) => setF({ ...f, receiver_country: e.target.value })} placeholder="US / DE / CN" /></Field>
        <Field label="省/州"><input className="inp" value={f.receiver_state} onChange={(e) => setF({ ...f, receiver_state: e.target.value })} /></Field>
        <Field label="城市"><input className="inp" value={f.receiver_city} onChange={(e) => setF({ ...f, receiver_city: e.target.value })} /></Field>
        <Field label="邮编"><input className="inp" value={f.receiver_postcode} onChange={(e) => setF({ ...f, receiver_postcode: e.target.value })} /></Field>
        <Field label="详细地址" full><input className="inp" value={f.receiver_address} onChange={(e) => setF({ ...f, receiver_address: e.target.value })} /></Field>
        <Field label="重量 kg"><input className="inp" type="number" step="0.01" value={f.weight_kg} onChange={(e) => setF({ ...f, weight_kg: +e.target.value })} /></Field>
        <Field label="运费"><input className="inp" type="number" step="0.01" value={f.shipping_cost} onChange={(e) => setF({ ...f, shipping_cost: +e.target.value })} /></Field>
      </Grid>

      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">发货明细</span>
          <button onClick={() => setItems([...items, { sku: '', sku_name: '', qty: 1 }])}
            className="text-xs text-brand-500 hover:text-brand-600">+ 添加一行</button>
        </div>
        <table className="w-full text-xs">
          <thead className="text-gray-400"><tr>
            <th className="text-left py-1">SKU *</th><th className="text-left py-1">名称</th><th className="text-right py-1">数量</th>
          </tr></thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1"><input className="inp" value={it.sku} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, sku: e.target.value } : x))} /></td>
                <td className="py-1"><input className="inp" value={it.sku_name} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, sku_name: e.target.value } : x))} /></td>
                <td className="py-1 w-24"><input className="inp text-right" type="number" value={it.qty} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, qty: +e.target.value } : x))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// -------- 详情页（拣货 + 发货 + 拆合包裹 + 截单） --------
export function ShipmentDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: s } = useQuery({
    queryKey: ['shipment', id],
    enabled: !!id,
    queryFn: async () => { const { data } = await supabase.from('wms_shipments').select('*').eq('id', id).single(); return data; },
  });
  const { data: items } = useQuery({
    queryKey: ['shipment_items', id],
    enabled: !!id,
    queryFn: async () => { const { data } = await supabase.from('wms_shipment_items').select('*').eq('shipment_id', id); return data || []; },
  });
  const { data: inv } = useQuery({
    queryKey: ['wms_inventory_for_pick', id],
    enabled: !!id,
    queryFn: async () => { const { data } = await supabase.from('wms_inventory').select('*').order('sku'); return data || []; },
  });

  // 🆕 包裹列表
  const { data: packages } = useQuery({
    queryKey: ['wms_packages', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_packages').select('*').eq('shipment_id', id);
      return data || [];
    },
  });

  // 🆕 截单记录
  const { data: cancellation } = useQuery({
    queryKey: ['wms_shipment_cancellations', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipment_cancellations').select('*').eq('shipment_id', id).maybeSingle();
      return data;
    },
  });

  // 🆕 UI 状态
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([]);

  async function pick() {
    if (!confirm('确认拣货并扣减库存？此操作将从库存中锁定并扣减相应数量。')) return;
    const { data: { user } } = await supabase.auth.getUser();
    for (const it of items!) {
      const available = (inv as any[]).find(i => i.sku === it.sku && i.warehouse_id === s.warehouse_id);
      if (!available) { alert(`SKU ${it.sku} 库存不足，已跳过`); continue; }
      const newQty = (available.qty_on_hand - it.qty);
      if (newQty < 0) { alert(`SKU ${it.sku} 仅剩 ${available.qty_on_hand}`); continue; }
      await supabase.from('wms_inventory').update({ qty_on_hand: newQty }).eq('id', available.id);
      if (newQty === 0) await supabase.from('wms_locations').update({ status: 'empty' }).eq('id', available.location_id);
      await supabase.from('wms_pick_tasks').insert({
        user_id: user!.id, shipment_id: id, shipment_item_id: it.id,
        sku: it.sku, from_location_id: available.location_id, qty: it.qty,
        status: 'done', operator: user?.email, done_at: new Date().toISOString(),
      });
      await supabase.from('wms_inventory_logs').insert({
        user_id: user!.id, warehouse_id: s.warehouse_id, sku: it.sku,
        location_id: available.location_id, qty_change: -it.qty, qty_after: newQty,
        type: 'outbound_pick', ref_type: 'shipment', ref_id: id,
        operator: user?.email, remark: `发货单 ${s.shipment_no} 拣货出库`,
      });
    }
    await supabase.from('wms_shipments').update({ status: 'packed' }).eq('id', id);
    qc.invalidateQueries();
  }

  async function ship() {
    const tracking = prompt('输入最终追踪号（可留空）', s?.tracking_no || '');
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('wms_shipments').update({
      status: 'shipped',
      tracking_no: tracking || s?.tracking_no,
      operator: user?.email,
    }).eq('id', id);
    qc.invalidateQueries();
  }

  // 🆕 拆包
  async function splitPackage(sourcePkg: any, sku: string, splitQty: number) {
    if (!sku || splitQty <= 0) return alert('请填写有效 SKU 和数量');
    if (splitQty >= (sourcePkg.qty || 0)) return alert('拆分数量必须小于原包数量');
    const { data: { user } } = await supabase.auth.getUser();
    const now = new Date().toISOString();

    // 1. 原包减 qty
    await supabase.from('wms_packages').update({
      qty: (sourcePkg.qty || 0) - splitQty,
      updated_at: now,
    }).eq('id', sourcePkg.id);

    // 2. 创建新包
    const pkgNo = `PKG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: newPkg, error } = await supabase.from('wms_packages').insert({
      user_id: user!.id, shipment_id: id,
      package_no: pkgNo,
      carrier_tracking: s?.tracking_no,
      weight_kg: sourcePkg.weight_kg,
      qty: splitQty,
      is_split: true,
      split_from_package_id: sourcePkg.id,
      status: 'pending',
    }).select().single();

    if (error) return alert('拆包失败：' + error.message);

    // 3. 写 wms_package_items
    await supabase.from('wms_package_items').insert({
      user_id: user!.id, package_id: newPkg.id,
      sku, qty: splitQty,
    });

    qc.invalidateQueries();
    alert(`拆包成功！新包 ${pkgNo}，数量 ${splitQty}`);
  }

  // 🆕 合包
  async function mergePackages(pkgIds: string[]) {
    if (pkgIds.length < 2) return alert('请至少选择 2 个包裹');
    const { data: { user } } = await supabase.auth.getUser();
    const now = new Date().toISOString();

    const pkgs = (packages || []).filter((p: any) => pkgIds.includes(p.id));
    const totalQty = pkgs.reduce((s: number, p: any) => s + (p.qty || 0), 0);
    const totalWeight = pkgs.reduce((s: number, p: any) => s + (p.weight_kg || 0), 0);

    // 1. 创建新合并包
    const pkgNo = `PKG-MERGE-${Date.now()}`;
    const mergedIds = pkgs.map((p: any) => p.id);
    const { data: newPkg, error } = await supabase.from('wms_packages').insert({
      user_id: user!.id, shipment_id: id,
      package_no: pkgNo,
      carrier_tracking: s?.tracking_no,
      weight_kg: totalWeight,
      qty: totalQty,
      is_merged: true,
      merged_package_ids: mergedIds,
      status: 'pending',
    }).select().single();

    if (error) return alert('合包失败：' + error.message);

    // 2. 原包标记为 merged（qty 置 0，merged_from_ids 字段记录）
    await supabase.from('wms_packages').update({
      qty: 0,
      updated_at: now,
    }).in('id', pkgIds);

    // 3. 汇总 package_items
    const { data: oldItems } = await supabase.from('wms_package_items').select('sku, qty').in('package_id', pkgIds);
    const skuAgg: Record<string, number> = {};
    (oldItems || []).forEach((it: any) => {
      skuAgg[it.sku] = (skuAgg[it.sku] || 0) + (it.qty || 0);
    });
    const newItems = Object.entries(skuAgg).map(([sku, qty]) => ({
      user_id: user!.id, package_id: newPkg.id, sku, qty,
    }));
    if (newItems.length) await supabase.from('wms_package_items').insert(newItems);

    qc.invalidateQueries();
    setSelectedPackageIds([]);
    alert(`合包成功！新包 ${pkgNo}，共 ${totalQty} 件`);
  }

  // 🆕 截单（取消发货）
  async function requestCancellation(reason: string, remark: string) {
    if (!reason) return alert('请选择取消原因');
    const { data: { user } } = await supabase.auth.getUser();
    const now = new Date().toISOString();

    // 检查是否已有取消记录
    if (cancellation) {
      const upd = await supabase.from('wms_shipment_cancellations').update({
        reason, remark, updated_at: now,
      }).eq('id', cancellation.id);
      if (upd.error) return alert('更新失败：' + upd.error.message);
    } else {
      const { error } = await supabase.from('wms_shipment_cancellations').insert({
        user_id: user!.id, shipment_id: id,
        cancellation_no: 'CAN' + Date.now(),
        reason,
        status: 'pending',
        rollback_inventory: true,
        remark,
      });
      if (error) return alert('截单申请失败：' + error.message);
    }

    // 同时将 shipment 标记为 pending_cancellation
    await supabase.from('wms_shipments').update({
      status: 'cancelled',
      remark: remark || reason,
    }).eq('id', id);

    qc.invalidateQueries();
    setShowCancelModal(false);
    alert('截单申请已提交，等待审批');
  }

  if (!s) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  const isCancelled = s.status === 'cancelled';
  const canOperate = !isCancelled && s.status !== 'shipped';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/shipments' })} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回发货单列表
      </button>

      <div className={`bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4 ${isCancelled ? 'ring-2 ring-red-300' : ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <Upload className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{s.shipment_no}</div>
            <div className="text-xs text-gray-500">状态：<span className={shipStatusBadge(s.status)}>{s.status}</span></div>
          </div>
          <div className="ml-auto flex gap-2">
            {s.status === 'released' && canOperate && (
              <button onClick={pick} className="px-4 py-2 bg-sea-500 text-white rounded-lg text-sm hover:bg-sea-600">拣货并扣库存</button>
            )}
            {s.status === 'packed' && canOperate && (
              <button onClick={ship} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">标记发货</button>
            )}
            {canOperate && s.status !== 'shipped' && (
              <button onClick={() => setShowCancelModal(true)}
                className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 flex items-center gap-1.5">
                <Ban className="w-4 h-4" /> 申请截单
              </button>
            )}
          </div>
        </div>

        {/* 🆕 取消时显示原因 */}
        {isCancelled && cancellation && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm">
            <div className="flex items-center gap-2 text-red-600 font-medium mb-1">
              <AlertTriangle className="w-4 h-4" /> 此发货单已申请截单
            </div>
            <div className="text-red-500">
              原因：{reasonLabel(cancellation.reason)}
              {cancellation.remark && <span className="ml-2">· 备注：{cancellation.remark}</span>}
            </div>
            <div className="text-xs text-red-400 mt-1">
              审批状态：{cancellation.status === 'completed' ? '✓ 已执行回滚' :
                cancellation.status === 'approved' ? '审批通过，执行中' :
                cancellation.status === 'rejected' ? '已驳回' : '待审批'}
            </div>
          </div>
        )}

        <div className="grid grid-cols-4 gap-4 text-sm">
          <Info label="收件人" value={s.receiver_name || '-'} />
          <Info label="国家" value={s.receiver_country || '-'} />
          <Info label="追踪号" value={s.tracking_no || '-'} />
          <Info label="件数" value={`${s.total_qty || 0} 件 / ${s.weight_kg || 0}kg`} />
        </div>
        {s.receiver_address && (
          <div className="mt-3 pt-3 border-t border-gray-100 text-sm text-gray-600">
            <span className="text-gray-400">收件地址：</span>{s.receiver_address}, {s.receiver_city} {s.receiver_postcode}
          </div>
        )}
      </div>

      {/* 发货明细 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-gray-100 font-medium">发货明细</div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr><th className="text-left px-4 py-2">SKU</th><th className="text-left px-4 py-2">名称</th>
              <th className="text-right px-4 py-2">数量</th>
              <th className="text-right px-4 py-2">当前库存</th></tr>
          </thead>
          <tbody>
            {items?.map((it: any) => {
              const stock = (inv as any[]).find(i => i.sku === it.sku);
              return (
                <tr key={it.id} className="border-t border-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{it.sku}</td>
                  <td className="px-4 py-2">{it.sku_name}</td>
                  <td className="px-4 py-2 text-right font-medium">{it.qty}</td>
                  <td className={`px-4 py-2 text-right ${((stock?.qty_on_hand || 0) - it.qty) < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                    {stock?.qty_on_hand || 0}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 🆕 包裹列表 + 拆合按钮 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-gray-100 font-medium flex items-center justify-between">
          <span className="flex items-center gap-1.5"><Package className="w-4 h-4 text-brand-500" /> 包裹列表 ({packages?.length || 0})</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowSplitModal(true)} disabled={!canOperate}
              className="px-3 py-1.5 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 disabled:opacity-50 flex items-center gap-1">
              <Scissors className="w-3 h-3" /> 拆包
            </button>
            <button onClick={() => { if (selectedPackageIds.length < 2) return alert('请先勾选 2 个以上包裹'); setShowMergeModal(true); }}
              disabled={!canOperate}
              className="px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50 flex items-center gap-1">
              <Merge className="w-3 h-3" /> 合包 ({selectedPackageIds.length})
            </button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <th className="text-left px-4 py-2">包裹号</th>
              <th className="text-right px-4 py-2">数量</th>
              <th className="text-right px-4 py-2">重量</th>
              <th className="text-left px-4 py-2">拆合状态</th>
              <th className="text-left px-4 py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {(packages || []).map((p: any) => (
              <tr key={p.id} className={`border-t border-gray-50 ${p.qty === 0 ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={selectedPackageIds.includes(p.id)}
                    onChange={(e) => {
                      if (p.qty === 0) return;
                      setSelectedPackageIds(e.target.checked
                        ? [...selectedPackageIds, p.id]
                        : selectedPackageIds.filter(x => x !== p.id));
                    }}
                    disabled={!canOperate || p.qty === 0}
                    className="w-4 h-4 rounded border-gray-300 text-brand-500"
                  />
                </td>
                <td className="px-4 py-2 font-mono text-brand-600">{p.package_no}</td>
                <td className="px-4 py-2 text-right">{p.qty}</td>
                <td className="px-4 py-2 text-right">{p.weight_kg} kg</td>
                <td className="px-4 py-2">
                  {p.is_split && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-600 inline-flex items-center gap-0.5">
                      <Scissors className="w-2.5 h-2.5" /> 拆自 {p.split_from_package_id?.slice(0, 8)}
                    </span>
                  )}
                  {p.is_merged && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-50 text-purple-600 inline-flex items-center gap-0.5">
                      <Merge className="w-2.5 h-2.5" /> 合自 {p.merged_package_ids?.length || 0} 个
                    </span>
                  )}
                  {!p.is_split && !p.is_merged && <span className="text-gray-400 text-xs">-</span>}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded text-xs ${p.status === 'shipped' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                    {p.status}
                  </span>
                </td>
              </tr>
            ))}
            {!packages?.length && <tr><td colSpan={6} className="p-6 text-center text-gray-400 text-sm">暂无包裹，拣货后自动生成</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 拆包弹窗 */}
      {showSplitModal && (
        <SplitModal
          packages={(packages || []).filter((p: any) => !p.is_merged && (p.qty || 0) > 0)}
          onClose={() => setShowSplitModal(false)}
          onSave={(pkg, sku, qty) => { splitPackage(pkg, sku, qty); setShowSplitModal(false); }}
        />
      )}

      {/* 合包弹窗 */}
      {showMergeModal && (
        <MergeModal
          selected={selectedPackageIds}
          packages={(packages || []).filter((p: any) => selectedPackageIds.includes(p.id) && !p.is_split)}
          onClose={() => setShowMergeModal(false)}
          onSave={() => { mergePackages(selectedPackageIds); setShowMergeModal(false); }}
        />
      )}

      {/* 截单弹窗 */}
      {showCancelModal && (
        <CancelModal onClose={() => setShowCancelModal(false)} onSave={requestCancellation} existing={cancellation} />
      )}
    </div>
  );
}

function reasonLabel(r: string) {
  const m: any = {
    customer_request: '客户要求取消',
    address_change: '地址变更',
    duplicate_order: '重复下单',
    pricing_error: '价格错误',
    other: '其他原因',
  };
  return m[r] || r;
}

function Info({ label, value }: any) {
  return <div><div className="text-xs text-gray-400">{label}</div><div className="font-medium text-gray-800 mt-0.5">{value}</div></div>;
}

// 拆包弹窗
function SplitModal({ packages, onClose, onSave }: any) {
  const [pkgId, setPkgId] = useState(packages[0]?.id || '');
  const [sku, setSku] = useState('');
  const [qty, setQty] = useState(1);
  const pkg = packages.find((p: any) => p.id === pkgId);

  return (
    <Modal title="拆包" onClose={onClose}>
      <div className="text-sm text-gray-500 mb-3 bg-amber-50 p-2 rounded">
        <Scissors className="w-4 h-4 inline mr-1 text-amber-500" />
        原包数量将减少，新建独立包裹
      </div>
      <Grid>
        <Field label="选择原包裹">
          <select className="inp" value={pkgId} onChange={(e) => setPkgId(e.target.value)}>
            {packages.map((p: any) => <option key={p.id} value={p.id}>{p.package_no} ({p.qty}件)</option>)}
          </select>
        </Field>
        <Field label="拆分 SKU">
          <input className="inp" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="与原包 SKU 一致" />
        </Field>
        <Field label="拆分数量">
          <input type="number" min={1} max={pkg ? pkg.qty - 1 : 1} className="inp" value={qty} onChange={(e) => setQty(+e.target.value)} />
          {pkg && <div className="text-xs text-gray-400 mt-1">原包剩余：{pkg.qty - qty} 件</div>}
        </Field>
      </Grid>
      <Footer onClose={onClose} onSave={() => onSave(pkg, sku || pkg?.sku, qty)} />
    </Modal>
  );
}

// 合包弹窗
function MergeModal({ packages, onClose, onSave }: any) {
  const totalQty = packages.reduce((s: number, p: any) => s + (p.qty || 0), 0);
  const totalWeight = packages.reduce((s: number, p: any) => s + (p.weight_kg || 0), 0);

  return (
    <Modal title="合包" onClose={onClose}>
      <div className="text-sm text-gray-500 mb-3 bg-purple-50 p-2 rounded">
        <Merge className="w-4 h-4 inline mr-1 text-purple-500" />
        以下 {packages.length} 个包裹将合并为 1 个
      </div>
      <div className="max-h-48 overflow-auto border border-gray-100 rounded">
        {packages.map((p: any) => (
          <div key={p.id} className="px-3 py-2 flex justify-between text-xs border-b border-gray-50">
            <span className="font-mono">{p.package_no}</span>
            <span>{p.qty} 件 / {p.weight_kg} kg</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-sm font-medium">
        新包：<span className="text-brand-600">{totalQty} 件</span> / {totalWeight.toFixed(2)} kg
      </div>
      <Footer onClose={onClose} onSave={onSave} />
    </Modal>
  );
}

// 截单弹窗
function CancelModal({ onClose, onSave, existing }: any) {
  const [reason, setReason] = useState(existing?.reason || 'customer_request');
  const [remark, setRemark] = useState(existing?.remark || '');

  const reasonOptions = [
    { v: 'customer_request', l: '客户要求取消' },
    { v: 'address_change', l: '地址变更' },
    { v: 'duplicate_order', l: '重复下单' },
    { v: 'pricing_error', l: '价格错误' },
    { v: 'other', l: '其他原因' },
  ];

  return (
    <Modal title="申请截单 / 取消发货" onClose={onClose}>
      <div className="text-sm text-red-500 mb-3 bg-red-50 p-2 rounded flex items-start gap-1">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div>
          <div>确认后将提交截单申请，审批通过后系统自动回滚库存。</div>
          <div className="text-xs text-red-400 mt-1">⚠ 已发货的包裹无法拦截，仅影响未出库部分。</div>
        </div>
      </div>
      <Grid>
        <Field label="取消原因 *">
          <select className="inp" value={reason} onChange={(e) => setReason(e.target.value)}>
            {reasonOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </Field>
        <Field label="备注说明" full>
          <textarea className="inp" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="补充说明（可选）" />
        </Field>
      </Grid>
      <Footer onClose={onClose} onSave={() => onSave(reason, remark)} saveLabel="提交截单申请" />
    </Modal>
  );
}
