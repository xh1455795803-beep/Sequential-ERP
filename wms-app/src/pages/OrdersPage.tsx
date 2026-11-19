import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus, ArrowLeft, Tag, Package, AlertTriangle, Play, Check, X, Truck, PackageCheck } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

// ========== 公共常量 ==========
const ORDER_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending:      { label: '待处理',   cls: 'bg-gray-100 text-gray-600' },
  confirmed:    { label: '已确认',   cls: 'bg-blue-50 text-blue-600' },
  picking:      { label: '拣货中',   cls: 'bg-amber-50 text-amber-600' },
  packing:      { label: '打包中',   cls: 'bg-purple-50 text-purple-600' },
  ready_to_ship:{ label: '待发货',   cls: 'bg-indigo-50 text-indigo-600' },
  shipped:      { label: '已发货',   cls: 'bg-green-50 text-green-600' },
  in_transit:   { label: '运输中',   cls: 'bg-cyan-50 text-cyan-600' },
  delivered:    { label: '已签收',   cls: 'bg-green-100 text-green-700' },
  exception:    { label: '异常',     cls: 'bg-red-50 text-red-600' },
  cancelled:    { label: '已取消',   cls: 'bg-gray-100 text-gray-400' },
};

const PLATFORM_LABEL: Record<string, string> = {
  tiktok_shop: 'TikTok Shop', shopify: 'Shopify', shopee: 'Shopee',
  manual: '手动', miaoshou: '妙手 ERP', amazon: 'Amazon', temu: 'Temu',
};

// ========== 列表页 ==========
export function OrdersPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>('');

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });
  const { data: channels } = useQuery({
    queryKey: ['wms_channels'],
    queryFn: async () => { const { data } = await supabase.from('wms_channels').select('*'); return data || []; },
  });

  const ordersQuery = useQuery({
    queryKey: ['erp_orders', filterStatus],
    queryFn: async () => {
      let q = supabase.from('erp_orders')
        .select(`*, warehouse:wms_warehouses(id,name,code), channel:wms_channels(id,name,code)`)
        .order('created_at', { ascending: false });
      if (filterStatus) q = q.eq('status', filterStatus);
      const { data } = await q;
      return data || [];
    },
  });

  // Realtime 刷新
  useEffect(() => {
    const { data: sub } = supabase.channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_orders' }, () => {
        qc.invalidateQueries({ queryKey: ['erp_orders'] });
      }).subscribe();
    return () => sub.unsubscribe();
  }, []);

  const { data: orders } = ordersQuery;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">ERP 订单</h2>
          <p className="text-sm text-gray-500 mt-1">三端联动核心 · 状态自动流转 · Realtime 同步</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 手动建订单（模拟 ERP 推送）
        </button>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {[{ k: '', l: '全部' }, ...Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => ({ k, l: v.label }))].map(({ k, l }) => (
          <button key={k || 'all'} onClick={() => setFilterStatus(k)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors
              ${filterStatus === k ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            {l}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">订单号</th>
              <th className="text-left px-5 py-2.5">平台</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-left px-5 py-2.5">收件人</th>
              <th className="text-right px-5 py-2.5">SKU/件数</th>
              <th className="text-left px-5 py-2.5">渠道</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {orders?.map((o: any) => {
              const sl = ORDER_STATUS_LABEL[o.status] || { label: o.status, cls: 'bg-gray-100' };
              const itemCount = (o as any)._item_count;
              return (
                <tr key={o.id} onClick={() => nav({ to: `/orders/$id`, params: { id: o.id } })}
                  className={`border-t border-gray-50 hover:bg-brand-50/30 cursor-pointer ${o.status === 'exception' ? 'bg-red-50/30' : ''}`}>
                  <td className="px-5 py-3 font-mono text-brand-600">{o.erp_order_no}</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{PLATFORM_LABEL[o.platform] || o.platform}</td>
                  <td className="px-5 py-3">{o.warehouse?.code || '-'}</td>
                  <td className="px-5 py-3">
                    {o.receiver_name || '-'}
                    {o.receiver_country && <span className="text-xs text-gray-400 ml-1">· {o.receiver_country}</span>}
                  </td>
                  <td className="px-5 py-3 text-right">{o.package_count || 1} 包裹</td>
                  <td className="px-5 py-3 text-xs text-gray-500">{o.channel?.code || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${sl.cls}`}>
                      {sl.label}
                      {o.exception_type && <span className="ml-1 text-red-500">⚠{o.exception_type}</span>}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right text-brand-500 text-xs">点击查看 →</td>
                </tr>
              );
            })}
            {!orders?.length && <tr><td colSpan={8} className="p-10 text-center text-gray-400">暂无订单</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <OrderForm warehouses={warehouses!} channels={channels!}
        onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['erp_orders'] }); }} />}
    </div>
  );
}

// ========== 新建订单表单 ==========
function OrderForm({ warehouses, channels, onClose, onSaved }: any) {
  const [f, setF] = useState({
    erp_order_no: 'ORD' + Date.now(),
    platform: 'manual',
    warehouse_id: warehouses?.[0]?.id || '',
    channel_id: channels?.find((c: any) => c.code === 'MANUAL')?.id || channels?.[0]?.id || '',
    receiver_name: '', receiver_phone: '', receiver_email: '',
    receiver_country: 'US', receiver_state: '', receiver_city: '',
    receiver_address: '', receiver_postbin_code: '',
    weight_kg: 0, package_count: 1,
  });
  const [items, setItems] = useState<any[]>([{ sku: '', sku_name: '', qty: 1 }]);

  async function save() {
    if (!f.warehouse_id) return alert('请选择仓库');
    const { data: { user } } = await supabase.auth.getUser();

    // 检查 SKU 是否配对
    const unpairedItems: any[] = [];
    for (const it of items) {
      const { data: prod } = await supabase.from('wms_products')
        .select('id').eq('sku', it.sku).eq('warehouse_id', f.warehouse_id).maybeSingle();
      it.product_id = prod?.id || null;
      if (!prod) unpairedItems.push(it.sku);
    }

    const status = unpairedItems.length ? 'exception' : 'pending';
    const exceptionType = unpairedItems.length ? 'sku_unpaired' : null;
    const exceptionDetail = unpairedItems.length ? { unpaired_skus: unpairedItems } : null;

    const { data, error } = await supabase.from('erp_orders').insert({
      ...f, user_id: user!.id, status, exception_type: exceptionType, exception_detail: exceptionDetail,
    }).select().single();
    if (error) return alert(error.message);

    await supabase.from('erp_order_items').insert(items.map((it) => ({
      order_id: data.id, user_id: user!.id,
      sku: it.sku, sku_name: it.sku_name, qty: +it.qty, product_id: it.product_id,
    })));

    // 写入 webhook_deliveries（模拟外部系统推过来的）
    await supabase.from('webhook_deliveries').insert({
      user_id: user!.id, direction: 'inbound', source: f.platform,
      event_type: 'order.created', payload: { order_no: f.erp_order_no },
      success: true, http_status: 200,
    });

    onSaved();
  }

  return (
    <Modal title="新建 ERP 订单（模拟）" onClose={onClose}>
      <Grid>
        <Field label="订单号 *"><input className="inp" value={f.erp_order_no} onChange={(e) => setF({ ...f, erp_order_no: e.target.value })} /></Field>
        <Field label="来源平台 *">
          <select className="inp" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
            <option value="tiktok_shop">TikTok Shop</option>
            <option value="shopify">Shopify</option>
            <option value="shopee">Shopee</option>
            <option value="amazon">Amazon</option>
            <option value="temu">Temu</option>
            <option value="miaoshou">妙手 ERP</option>
            <option value="manual">手动录入</option>
          </select>
        </Field>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{wbin_code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="渠道">
          <select className="inp" value={f.channel_id} onChange={(e) => setF({ ...f, channel_id: e.target.value })}>
            <option value="">不指定</option>
            {channels?.map((c: any) => <option key={c.id} value={c.id}>{cbin_code} · {c.name}</option>)}
          </select>
        </Field>
        <Field label="收件人"><input className="inp" value={f.receiver_name} onChange={(e) => setF({ ...f, receiver_name: e.target.value })} /></Field>
        <Field label="电话"><input className="inp" value={f.receiver_phone} onChange={(e) => setF({ ...f, receiver_phone: e.target.value })} /></Field>
        <Field label="国家"><input className="inp" value={f.receiver_country} onChange={(e) => setF({ ...f, receiver_country: e.target.value })} placeholder="US" /></Field>
        <Field label="省/州"><input className="inp" value={f.receiver_state} onChange={(e) => setF({ ...f, receiver_state: e.target.value })} /></Field>
        <Field label="城市"><input className="inp" value={f.receiver_city} onChange={(e) => setF({ ...f, receiver_city: e.target.value })} /></Field>
        <Field label="邮编"><input className="inp" value={f.receiver_postcode} onChange={(e) => setF({ ...f, receiver_postbin_code: e.target.value })} /></Field>
        <Field label="详细地址" full><input className="inp" value={f.receiver_address} onChange={(e) => setF({ ...f, receiver_address: e.target.value })} /></Field>
        <Field label="重量 kg"><input className="inp" type="number" step="0.01" value={f.weight_kg} onChange={(e) => setF({ ...f, weight_kg: +e.target.value })} /></Field>
      </Grid>

      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">订单明细</span>
          <button onClick={() => setItems([...items, { sku: '', sku_name: '', qty: 1 }])}
            className="text-xs text-brand-500 hover:text-brand-600">+ 添加一行</button>
        </div>
        <table className="w-full text-xs">
          <thead className="text-gray-400">
            <tr><th className="text-left py-1">SKU *</th><th className="text-left py-1">名称</th><th className="text-right py-1">数量</th></tr>
          </thead>
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

// ========== 详情页（状态流转 + 拣货 + 打包 + 发货） ==========
export function OrderDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const [packingResults, setPackingResults] = useState<any[]>([]);
  const [showPackModal, setShowPackModal] = useState(false);
  const [manualTracking, setManualTracking] = useState(false);

  const { data: order } = useQuery({
    queryKey: ['erp_order', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('erp_orders')
        .select('*, warehouse:wms_warehouses(id,name,code), channel:wms_channels(id,name,code,adapter,supports_label_pdf)')
        .eq('id', id).single();
      return data;
    },
  });
  const { data: items } = useQuery({
    queryKey: ['erp_order_items', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('erp_order_items').select('*').eq('order_id', id);
      return data || [];
    },
  });
  const { data: inventory } = useQuery({
    queryKey: ['wms_inventory_all'],
    queryFn: async () => { const { data } = await supabase.from('wms_inventory').select('*'); return data || []; },
  });

  // Realtime
  useEffect(() => {
    if (!id) return;
    const { data: sub } = supabase.channel(`order-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'erp_orders', filter: `id=eq.${id}` }, () => {
        qc.invalidateQueries();
      }).subscribe();
    return () => sub.unsubscribe();
  }, [id]);

  async function transition(newStatus: string, extra: any = {}) {
    const { data: { user } } = await supabase.auth.getUser();
    try {
      const { error } = await supabase.from('erp_orders')
        .update({ ...extra, status: newStatus, operator: user?.email })
        .eq('id', id);
      if (error) {
        // 状态机可能拦截了
        alert('状态转移失败：' + error.message);
        return;
      }
      qc.invalidateQueries();
    } catch (e: any) {
      alert('状态转移异常：' + e.message);
    }
  }

  async function confirmAndStartPicking() {
    // 检查库存
    const unpaired = (items || []).filter(i => !i.is_paired);
    if (unpaired.length) {
      return alert(`还有 ${unpaired.length} 个 SKU 未配对商品，请先在商品管理里创建并配对`);
    }

    // 检查库存
    const invList = (inventory as any[]) || [];
    let outOfStock: string[] = [];
    for (const it of items!) {
      const stock = invList.find(i => i.sku === it.sku && i.warehouse_id === order!.warehouse_id);
      const avail = (stock?.qty_on_hand || 0) - (stock?.qty_reserved || 0);
      if (avail < it.qty) outOfStock.push(`${it.sku} 需要 ${it.qty}，只剩 ${avail}`);
    }

    if (outOfStock.length) {
      // 部分缺货也进入 picking，异常标记
      await transition('confirmed');
      await transition('picking');
      alert('⚠️ 部分 SKU 库存不足（仓库可以分批发货）：\n' + outOfStock.join('\n'));
    } else {
      await transition('confirmed');
      await transition('picking');
    }
  }

  async function packAndVerify() {
    if (!confirm('确认逐件打包校验？系统会核对本单所有 SKU 并扣减库存。')) return;
    const { data: { user } } = await supabase.auth.getUser();
    const invList = (inventory as any[]) || [];

    let allMatch = true;
    const results: any[] = [];

    for (const it of items!) {
      const stock = invList.find(i => i.sku === it.sku && i.warehouse_id === order!.warehouse_id);
      const qtyToPick = it.qty - (it.picked_qty || 0);

      if (!stock) {
        allMatch = false;
        results.push({ sku: it.sku, result: '❌ 库存不存在' });
        continue;
      }
      if ((stock.qty_on_hand || 0) < qtyToPick) {
        allMatch = false;
        results.push({ sku: it.sku, result: `❌ 库存不足（需 ${qtyToPick}，有 ${stock.qty_on_hand}）` });
        continue;
      }

      // 扣减库存
      const newQty = stock.qty_on_hand - qtyToPick;
      await supabase.from('wms_inventory').update({ qty_on_hand: newQty }).eq('id', stock.id);

      // 如果有 bin_id 关联
      if (stock.bin_id && newQty === 0) {
        await supabase.from('wms_bins').update({ status: 'empty' }).eq('id', stock.bin_id);
      }

      // 写流水
      await supabase.from('wms_inventory_txn').insert({
        user_id: user!.id, warehouse_id: order!.warehouse_id,
        sku: it.sku, bin_id: stock.bin_id,
        qty_change: -qtyToPick, qty_after: newQty,
        type: 'pack', ref_type: 'erp_order', ref_id: id,
        operator: user?.email, remark: `订单 ${order!.erp_order_no} 打包出库`,
      });

      // 更新 item
      await supabase.from('erp_order_items').update({
        picked_qty: (it.picked_qty || 0) + qtyToPick,
        packed_qty: (it.packed_qty || 0) + qtyToPick,
      }).eq('id', it.id);

      results.push({ sku: it.sku, result: `✅ ${qtyToPick} 件` });
    }

    // 关联 shipment
    const existingShp = await supabase.from('wms_shipment_labels').select('id').eq('erp_order_id', id).maybeSingle();
    let shipmentId = existingShp.data?.id;
    if (!shipmentId) {
      const { data: shp } = await supabase.from('wms_shipment_labels').insert({
        user_id: user!.id, erp_order_id: id,
        warehouse_id: order!.warehouse_id,
        channel_id: order!.channel_id,
        shipment_no: 'SHP-' + order!.erp_order_no,
        receiver_name: order!.receiver_name, receiver_phone: order!.receiver_phone,
        receiver_country: order!.receiver_country, receiver_state: order!.receiver_state,
        receiver_city: order!.receiver_city, receiver_address: order!.receiver_address,
        receiver_postcode: order!.receiver_postcode,
        total_items: items!.length,
        total_qty: items!.reduce((s, i) => s + (+i.qty || 0), 0),
        status: 'packed',
        weight_kg: order!.weight_kg,
        actual_weight_kg: order!.weight_kg,
        packed_at: new Date().toISOString(),
      }).select().single();
      shipmentId = shp!.id;

      // shipment items
      await supabase.from('wms_shipment_items').insert(items!.map((it: any) => ({
        shipment_id: shipmentId!, user_id: user!.id,
        product_id: it.product_id, sku: it.sku, sku_name: it.sku_name, qty: it.qty, packed_qty: it.qty,
      })));
    }

    setPackingResults(results);
    await transition('packing');
    await transition('ready_to_ship');
    setShowPackModal(true);
  }

  async function requestLabel() {
    // 1) 如果有真实渠道 API → 调用
    // 2) 否则走 ManualAdapter → 让用户手动填运单号
    const useManual = !order?.channel?.supports_label_pdf || order?.channel?.adapter === 'manual';
    if (useManual) {
      setManualTracking(true);
      return;
    }
    // TODO: 调用真实渠道 API（4PX/TikTok Shop 等）
    // 当前统一 fallback 到手动模式
    setManualTracking(true);
  }

  async function shipWithManual() {
    const tracking = prompt('输入运单号（从渠道获取）');
    if (!tracking) return;
    const labelUrl = prompt('面单 PDF 地址（可留空，粘贴 PDF 链接）') || '';
    await supabase.from('wms_shipment_labels').update({
      tracking_no: tracking, label_pdf_url: labelUrl, ship_at: new Date().toISOString(),
    }).eq('erp_order_id', id);
    await supabase.from('erp_orders').update({
      tracking_no: tracking, shipped_at: new Date().toISOString(),
    }).eq('id', id);
    await transition('shipped');

    // 写 webhook（模拟回传 ERP）
    await supabase.from('webhook_deliveries').insert({
      user_id: order.user_id, direction: 'outbound', source: order.platform,
      event_type: 'order.shipped',
      payload: { order_no: order.erp_order_no, tracking_no: tracking, channel: order.channel?.code },
      success: true, http_status: 200,
    });

    alert(`✅ 已发货\n运单号: ${tracking}\n渠道: ${order.channel?.name || '手动'}`);
    setManualTracking(false);
    setShowPackModal(false);
    qc.invalidateQueries();
  }

  if (!order) return <div className="p-8 text-center text-gray-400">加载中...</div>;
  const sl = ORDER_STATUS_LABEL[order.status] || { label: order.status, cls: 'bg-gray-100' };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/orders' })} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回订单列表
      </button>

      {/* 订单卡片 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Tag className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{order.erp_order_no}</div>
            <div className="text-xs text-gray-500">
              {PLATFORM_LABEL[order.platform] || order.platform} · {order.warehouse?.warehouse_code} · {order.channel?.name || '未指定渠道'}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-xs ${sl.cls}`}>{sl.label}</span>
            {order.exception_type && <span className="px-2 py-1 rounded text-xs bg-red-50 text-red-600">⚠{order.exception_type}</span>}
          </div>
        </div>

        {/* 状态流转按钮 */}
        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
          {order.status === 'pending' && (
            <button onClick={confirmAndStartPicking} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 flex items-center gap-1">
              <Play className="w-3.5 h-3.5" /> 确认并开始拣货
            </button>
          )}
          {order.status === 'picking' && (
            <button onClick={async () => { await transition('packing'); }}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm hover:bg-purple-600">
              <Check className="w-3.5 h-3.5 inline mr-1" /> 拣货完成 → 进入打包
            </button>
          )}
          {order.status === 'packing' && (
            <button onClick={packAndVerify} className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm hover:bg-indigo-600 flex items-center gap-1">
              <PackageCheck className="w-3.5 h-3.5" /> 逐件打包校验
            </button>
          )}
          {order.status === 'ready_to_ship' && (
            <button onClick={requestLabel} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> 申请运单号 / 面单
            </button>
          )}
          {order.status === 'exception' && (
            <>
              <button onClick={async () => { await transition('pending'); alert('异常已处理，订单回到待处理'); }}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
                处理异常 → 回到待处理
              </button>
              <button onClick={async () => { if (confirm('确认取消此订单？')) await transition('cancelled'); }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300">
                放弃订单
              </button>
            </>
          )}
          {['pending','confirmed','picking','packing','ready_to_ship'].includes(order.status) && (
            <button onClick={async () => { if (confirm('确认取消此订单？')) await transition('cancelled'); }}
              className="px-4 py-2 bg-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-300">
              <X className="w-3.5 h-3.5 inline mr-1" /> 取消订单
            </button>
          )}
          {order.status === 'shipped' && (
            <button onClick={async () => { await transition('in_transit'); alert('模拟物流轨迹更新'); }}
              className="px-4 py-2 bg-cyan-500 text-white rounded-lg text-sm hover:bg-cyan-600">
              模拟轨迹 → 运输中
            </button>
          )}
          {order.status === 'in_transit' && (
            <button onClick={async () => { await transition('delivered'); alert('订单已签收'); }}
              className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600">
              确认签收
            </button>
          )}
        </div>
      </div>

      {/* 收件人 + 渠道信息 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-sm">
          <div className="text-xs text-gray-400 mb-2">收件信息</div>
          <div className="font-medium">{order.receiver_name || '-'}</div>
          <div className="text-gray-500 text-xs mt-0.5">{order.receiver_phone}</div>
          <div className="mt-2 text-xs text-gray-600">
            {order.receiver_address}, {order.receiver_city} {order.receiver_postcode} {order.receiver_country}
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 text-sm">
          <div className="text-xs text-gray-400 mb-2">物流信息</div>
          {order.tracking_no ? (
            <div>
              <div className="font-mono text-brand-600">{order.tracking_no}</div>
              {order.channel?.code && <div className="text-xs text-gray-500 mt-0.5">{order.channelbin_code}</div>}
            </div>
          ) : (
            <div className="text-gray-400 text-xs">等待申请运单号...</div>
          )}
          {order.shipped_at && <div className="mt-2 text-xs text-gray-500">发货时间：{new Date(order.shipped_at).toLocaleString()}</div>}
        </div>
      </div>

      {/* 订单明细 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-500" /> 订单明细（{items?.length || 0} 项 · {items?.reduce((s: number, i: any) => s + (+i.qty || 0), 0) || 0} 件）
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2">SKU</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-left px-4 py-2">条码</th>
              <th className="text-right px-4 py-2">数量</th>
              <th className="text-right px-4 py-2">已拣</th>
              <th className="text-right px-4 py-2">已打包</th>
              <th className="text-center px-4 py-2">配对</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((it: any) => (
              <tr key={it.id} className="border-t border-gray-50">
                <td className="px-4 py-2 font-mono text-xs">{it.sku}</td>
                <td className="px-4 py-2">{it.sku_name}</td>
                <td className="px-4 py-2 text-xs text-gray-400">{it.barcode || '-'}</td>
                <td className="px-4 py-2 text-right font-medium">{it.qty}</td>
                <td className="px-4 py-2 text-right text-amber-600">{it.picked_qty || 0}</td>
                <td className="px-4 py-2 text-right text-green-600">{it.packed_qty || 0}</td>
                <td className="px-4 py-2 text-center">
                  {it.is_paired
                    ? <span className="text-green-600 text-xs">✅ 已配对</span>
                    : <span className="text-red-500 text-xs">❌ 未配对</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 异常提示 */}
      {order.status === 'exception' && order.exception_detail && (
        <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm">
          <div className="font-medium text-red-700 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> 异常：{order.exception_type}
          </div>
          <pre className="mt-2 text-xs text-red-600 whitespace-pre-wrap">{JSON.stringify(order.exception_detail, null, 2)}</pre>
        </div>
      )}

      {/* 打包结果弹窗 */}
      {showPackModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="font-bold mb-4">打包校验结果</h3>
            <div className="space-y-1 text-xs mb-4">
              {packingResults.map((r, i) => <div key={i}>{r.sku} → {r.result}</div>)}
            </div>
            {manualTracking ? (
              <div>
                <div className="text-xs text-gray-500 mb-2">手动模式：请输入运单号（后续可接入真实渠道 API）</div>
                <input className="inp mb-2" placeholder="运单号" onKeyDown={(e: any) => { if (e.key === 'Enter') shipWithManual(); }} />
                <button onClick={shipWithManual} className="w-full px-4 py-2 bg-brand-500 text-white rounded-lg">确认发货</button>
              </div>
            ) : (
              <button onClick={() => setShowPackModal(false)} className="w-full px-4 py-2 bg-gray-100 text-gray-600 rounded-lg">完成</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
