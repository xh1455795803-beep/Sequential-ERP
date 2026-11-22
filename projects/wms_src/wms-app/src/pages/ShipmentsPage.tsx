import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus, ArrowLeft, PackageCheck, Upload } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// -------- 列表页 --------
export function ShipmentsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: carriers } = useQuery({
    queryKey: ['wms_carriers'],
    queryFn: async () => { const { data } = await supabase.from('wms_carriers').select('*'); return data || []; },
  });

  const { data: shipments } = useQuery({
    queryKey: ['wms_shipments'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipments').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', released: '已释放', picking: '拣货中',
    packed: '已打包', shipped: '已发货', delivered: '已签收', cancelled: '已取消',
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">出库管理</h2>
          <p className="text-sm text-gray-500 mt-1">发货单 → 拣货 → 打包 → 发货</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建发货单
        </button>
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
                className="border-t border-gray-50 hover:bg-brand-50/30 cursor-pointer">
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
    cancelled: 'bg-gray-100 text-gray-400',
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
                <td className="py-1"><input className="inp" value={it.sku} onChange={(e) => updateItem(idx, 'sku', e.target.value)} /></td>
                <td className="py-1"><input className="inp" value={it.sku_name} onChange={(e) => updateItem(idx, 'sku_name', e.target.value)} /></td>
                <td className="py-1 w-24"><input className="inp text-right" type="number" value={it.qty} onChange={(e) => updateItem(idx, 'qty', +e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );

  function updateItem(idx: number, key: string, val: any) {
    setItems(items.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
  }
}

// -------- 详情页（拣货 + 发货） --------
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

  async function pick() {
    if (!confirm('确认拣货并扣减库存？此操作将从库存中锁定并扣减相应数量。')) return;
    const { data: { user } } = await supabase.auth.getUser();
    for (const it of items!) {
      const available = (inv as any[]).find(i => i.sku === it.sku && i.warehouse_id === s.warehouse_id);
      if (!available) { alert(`SKU ${it.sku} 库存不足，已跳过`); continue; }
      const newQty = (available.qty_on_hand - it.qty);
      if (newQty < 0) { alert(`SKU ${it.sku} 仅剩 ${available.qty_on_hand}`); continue; }
      // 更新库存
      await supabase.from('wms_inventory').update({ qty_on_hand: newQty }).eq('id', available.id);
      // 库位如果扣完置 empty
      if (newQty === 0) await supabase.from('wms_locations').update({ status: 'empty' }).eq('id', available.location_id);
      // 写拣货任务 + 日志
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

  if (!s) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/shipments' })} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回发货单列表
      </button>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Upload className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{s.shipment_no}</div>
            <div className="text-xs text-gray-500">状态：<span className={shipStatusBadge(s.status)}>{s.status}</span></div>
          </div>
          <div className="ml-auto flex gap-2">
            {s.status === 'released' && <button onClick={pick} className="px-4 py-2 bg-sea-500 text-white rounded-lg text-sm hover:bg-sea-600">拣货并扣库存</button>}
            {s.status === 'packed' && <button onClick={ship} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">标记发货</button>}
            {s.status === 'shipped' && <button disabled className="px-4 py-2 bg-gray-200 text-gray-500 rounded-lg text-sm">已发货</button>}
          </div>
        </div>
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
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
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
    </div>
  );
}

function Info({ label, value }: any) {
  return <div><div className="text-xs text-gray-400">{label}</div><div className="font-medium text-gray-800 mt-0.5">{value}</div></div>;
}
