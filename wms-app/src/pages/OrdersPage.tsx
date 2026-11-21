import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus, ArrowLeft, Tag, Package, AlertTriangle, Play, Check, X, Truck, PackageCheck, Printer } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from '../components/ui';

// ========== 状态机（smallint 1-7） ==========
const ORDER_STATUS: Record<number, { label: string; cls: string }> = {
  1: { label: '待拣货',   cls: 'bg-muted text-muted-foreground' },
  2: { label: '拣货中',   cls: 'bg-warning-bg text-warning' },
  3: { label: '待打包',   cls: 'bg-brand-subtle text-brand' },
  4: { label: '已打包',   cls: 'bg-brand-subtle text-brand' },
  5: { label: '已出库',   cls: 'bg-success-bg text-success' },
  6: { label: '已同步',   cls: 'bg-success-bg text-success' },
  7: { label: '已取消',   cls: 'bg-muted text-muted-foreground' },
};
const PLATFORM_LABEL: Record<string, string> = {
  tiktok_shop: 'TikTok Shop', shopify: 'Shopify', shopee: 'Shopee',
  manual: '手动', miaoshou: '妙手 ERP', amazon: 'Amazon', temu: 'Temu',
  ERP_PUSH: 'ERP 推送', SELF_INGEST: '手动录入',
};
const CHANNEL_MAP = {
  '4PX-ECONOMY': '递四方 经济小包', 'DHL-EXPRESS': 'DHL Express',
  'USPS-FIRST': 'USPS First Class', 'MANUAL': '手动运单',
};

// ========== 列表页 ==========
export function OrdersPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<number | 0>(0); // 0 = 全部

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const ordersQuery = useQuery({
    queryKey: ['wms_orders_all', filterStatus],
    queryFn: async () => {
      let q = supabase.from('wms_orders').select('*').order('created_at', { ascending: false });
      if (filterStatus > 0) q = q.eq('status', filterStatus);
      if (filterStatus === -1) q = q.eq('exception_flag', 1);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: orders } = ordersQuery;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">出库订单</h2>
          <p className="text-sm text-muted-foreground mt-1">ERP 推送 / 手动录入 · 拣货 → 打包 → 出库</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 手动建订单
        </button>
      </div>

      {/* 状态筛选 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => setFilterStatus(0)}
          className={`px-3 py-1 rounded-full text-xs border ${filterStatus === 0 ? 'bg-brand-500 text-white border-brand-500' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}>全部</button>
        <button onClick={() => setFilterStatus(-1)}
          className={`px-3 py-1 rounded-full text-xs border ${filterStatus === -1 ? 'bg-danger-bg0 text-white border-red-500' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}>异常</button>
        {Object.entries(ORDER_STATUS).map(([k, v]) => (
          <button key={k} onClick={() => setFilterStatus(+k)}
            className={`px-3 py-1 rounded-full text-xs border ${filterStatus === +k ? 'bg-brand-500 text-white border-brand-500' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}>{v.label}</button>
        ))}
      </div>

      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">订单号</th>
              <th className="text-left px-5 py-2.5">平台</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-left px-5 py-2.5">收件人/国家</th>
              <th className="text-right px-5 py-2.5">件数</th>
              <th className="text-left px-5 py-2.5">渠道</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {orders?.map((o: any) => {
              const sl = ORDER_STATUS[o.status] || { label: o.status, cls: 'bg-muted' };
              const wh = (warehouses as any[])?.find(w => w.id === o.warehouse_id);
              return (
                <tr key={o.id} onClick={() => nav({ to: `/orders/$id`, params: { id: o.id } })}
                  className={`border-t border-transparent hover:bg-brand-50/30 cursor-pointer ${o.exception_flag === 1 ? 'bg-danger-bg/30' : ''}`}>
                  <td className="px-5 py-3 font-mono text-brand-600">{o.order_no}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{PLATFORM_LABEL[o.platform] || o.platform}</td>
                  <td className="px-5 py-3">{wh?.warehouse_code || '-'}</td>
                  <td className="px-5 py-3">
                    {o.receiver_name || '-'}
                    {o.receiver_country && <span className="text-xs text-muted-foreground ml-1">· {o.receiver_country}</span>}
                  </td>
                  <td className="px-5 py-3 text-right">{o.total_qty || 0}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{o.channel_code || '-'}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${sl.cls}`}>{sl.label}</span>
                    {o.exception_flag === 1 && <span className="ml-1 text-destructive">⚠{o.exception_type}</span>}
                  </td>
                  <td className="px-5 py-3 text-right text-brand-500 text-xs">点击查看 →</td>
                </tr>
              );
            })}
            {!orders?.length && <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">暂无订单</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <OrderForm warehouses={warehouses!}
        onClose={() => setShowForm(false)}
        onSaved={(id) => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_orders_all'] }); nav({ to: `/orders/$id`, params: { id } }); }} />}
    </div>
  );
}

// ========== 新建订单表单 ==========
function OrderForm({ warehouses, onClose, onSaved }: any) {
  const [f, setF] = useState({
    platform: 'manual',
    warehouse_id: warehouses?.[0]?.id || '',
    channel_code: 'MANUAL',
    receiver_name: '', receiver_phone: '',
    receiver_country: 'US', receiver_state: '', receiver_city: '', receiver_zip: '',
    receiver_address1: '', receiver_address2: '',
  });
  const [items, setItems] = useState<any[]>([{ sku_code: '', qty: 1 }]);

  async function save() {
    if (!f.warehouse_id) return alert('请选择仓库');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return alert('请先登录');

    // 查 tenant_id
    const { data: acc } = await supabase.from('wms_accounts').select('tenant_id').eq('email', user.email).maybeSingle();
    const tenant_id = acc?.tenant_id;
    if (!tenant_id) return alert('账户未绑定租户');

    const order_no = 'OR' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000);

    // 配 product_id
    let total_qty = 0;
    const itemRows: any[] = [];
    for (const it of items) {
      const qty = +it.qty || 0;
      if (!it.sku_code || qty <= 0) continue;
      const { data: prod } = await supabase.from('wms_products').select('id').eq('sku_code', it.sku_code).eq('tenant_id', tenant_id).maybeSingle();
      itemRows.push({
        tenant_id, product_id: prod?.id || null,
        sku_code: it.sku_code, platform_sku: it.sku_code,
        qty, picked_qty: 0, packed_qty: 0,
      });
      total_qty += qty;
    }
    if (itemRows.length === 0) return alert('请至少填写一条有效明细');

    const orderPayload: any = {
      tenant_id, warehouse_id: f.warehouse_id, order_no,
      platform: f.platform,
      source_channel: 'SELF_INGEST',
      channel_code: f.channel_code || null,
      receiver_name: f.receiver_name || null,
      receiver_phone: f.receiver_phone || null,
      receiver_country: f.receiver_country || null,
      receiver_state: f.receiver_state || null,
      receiver_city: f.receiver_city || null,
      receiver_zip: f.receiver_zip || null,
      receiver_address1: f.receiver_address1 || null,
      receiver_address2: f.receiver_address2 || null,
      total_qty, status: 1,
      exception_flag: 0, cancel_flag: 0, priority: 5,
    };
    if (itemRows.some(r => !r.product_id)) {
      orderPayload.exception_flag = 1;
      orderPayload.exception_type = 'sku_unpaired';
    }

    const { data: ins, error } = await supabase.from('wms_orders').insert(orderPayload).select().single();
    if (error) return alert(error.message);

    const orderId = ins!.id;
    for (const r of itemRows) {
      await supabase.from('wms_order_items').insert({ ...r, order_id: orderId });
    }

    // 自动建 PICK 作业任务
    if (orderPayload.exception_flag === 0) {
      await supabase.from('wms_work_tasks').insert({
        tenant_id, warehouse_id: f.warehouse_id,
        task_no: 'TK' + order_no.slice(2),
        task_type: 'PICK',
        ref_type: 'ORDER', ref_id: orderId, ref_no: order_no,
        order_id: orderId, status: 1, priority: 5,
        total_items: itemRows.length, completed_items: 0,
      });
    }

    onSaved(orderId);
  }

  return (
    <Modal title="新建出库订单" onClose={onClose}>
      <Grid>
        <Field label="来源平台 *">
          <select className="inp" value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>
            <option value="manual">手动录入</option>
            <option value="tiktok_shop">TikTok Shop</option>
            <option value="shopify">Shopify</option>
            <option value="shopee">Shopee</option>
            <option value="amazon">Amazon</option>
            <option value="temu">Temu</option>
            <option value="miaoshou">妙手 ERP</option>
          </select>
        </Field>
        <Field label="仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses?.map((w: any) => <option key={w.id} value={w.id}>{w.warehouse_code} · {w.name}</option>)}
          </select>
        </Field>
        <Field label="渠道代码">
          <input className="inp" value={f.channel_code} onChange={(e) => setF({ ...f, channel_code: e.target.value })} placeholder="4PX-ECONOMY / MANUAL" />
        </Field>
        <Field label="收件人"><input className="inp" value={f.receiver_name} onChange={(e) => setF({ ...f, receiver_name: e.target.value })} /></Field>
        <Field label="电话"><input className="inp" value={f.receiver_phone} onChange={(e) => setF({ ...f, receiver_phone: e.target.value })} /></Field>
        <Field label="国家"><input className="inp" value={f.receiver_country} onChange={(e) => setF({ ...f, receiver_country: e.target.value })} placeholder="US" /></Field>
        <Field label="省/州"><input className="inp" value={f.receiver_state} onChange={(e) => setF({ ...f, receiver_state: e.target.value })} /></Field>
        <Field label="城市"><input className="inp" value={f.receiver_city} onChange={(e) => setF({ ...f, receiver_city: e.target.value })} /></Field>
        <Field label="邮编"><input className="inp" value={f.receiver_zip} onChange={(e) => setF({ ...f, receiver_zip: e.target.value })} /></Field>
        <Field label="详细地址" full><input className="inp" value={f.receiver_address1} onChange={(e) => setF({ ...f, receiver_address1: e.target.value })} /></Field>
      </Grid>

      <div className="mt-5 border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium text-sm">订单明细</span>
          <button onClick={() => setItems([...items, { sku_code: '', qty: 1 }])}
            className="text-xs text-brand-500 hover:text-brand-600">+ 添加一行</button>
        </div>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr>
            <th className="text-left py-1">SKU *</th><th className="text-right py-1">数量</th>
          </tr></thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={idx}>
                <td className="py-1"><input className="inp" value={it.sku_code} onChange={(e) => setItems(items.map((x, i) => i === idx ? { ...x, sku_code: e.target.value } : x))} /></td>
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
  const [manualTracking, setManualTracking] = useState(false);

  const { data: order } = useQuery({
    queryKey: ['wms_order', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_orders').select('*').eq('id', id).single();
      return data;
    },
  });
  const { data: items } = useQuery({
    queryKey: ['wms_order_items', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_order_items').select('*').eq('order_id', id).order('id');
      return data || [];
    },
  });
  const { data: inv } = useQuery({
    queryKey: ['wms_inventory_all'],
    queryFn: async () => { const { data } = await supabase.from('wms_inventory').select('*'); return data || []; },
  });
  const { data: label } = useQuery({
    queryKey: ['wms_label_by_order', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipment_labels').select('*').eq('order_id', id).maybeSingle();
      return data;
    },
  });

  async function setStatus(status: number, extra: any = {}) {
    const payload: any = { status, ...extra };
    const { error } = await supabase.from('wms_orders').update(payload).eq('id', id);
    if (error) { alert('状态转移失败：' + error.message); return false; }
    qc.invalidateQueries();
    return true;
  }

  async function pick() {
    // 检查库存
    const invList = (inv as any[]) || [];
    let ok = true;
    for (const it of items!) {
      if ((it.picked_qty || 0) >= (it.qty || 0)) continue;
      const avail = invList.find(i => i.product_id === it.product_id && i.warehouse_id === order!.warehouse_id && (i.qty_onhand || 0) - (i.qty_locked || 0) >= ((it.qty || 0) - (it.picked_qty || 0)));
      if (!avail) ok = false;
    }
    if (!ok) {
      if (!confirm('⚠️ 部分 SKU 库存不足，仍要继续拣货并标记异常吗？')) return;
      await supabase.from('wms_orders').update({ exception_flag: 1, exception_type: 'out_of_stock' }).eq('id', id);
    }

    // 实际扣减：先进到 bin_id 粒度拣货（第一个够的 bin）
    for (const it of items!) {
      const need = +it.qty - (+it.picked_qty || 0);
      if (need <= 0) continue;
      let remaining = need;
      const bins = invList.filter(i => i.product_id === it.product_id && i.warehouse_id === order!.warehouse_id && (+i.qty_onhand || 0) - (+i.qty_locked || 0) > 0);
      // 简单：扣第一个够的 bin
      for (const bin of bins) {
        if (remaining <= 0) break;
        const avail = +bin.qty_onhand - (+bin.qty_locked || 0);
        const take = Math.min(avail, remaining);
        const newLocked = +bin.qty_locked + take;
        await supabase.from('wms_inventory').update({ qty_locked: newLocked, last_move_at: new Date().toISOString() }).eq('id', bin.id);
        // 写拣货记录
        await supabase.from('wms_pick_records').insert({
          tenant_id: order!.tenant_id,
          order_id: order!.id, item_id: it.id, bin_id: bin.id,
          product_id: bin.product_id, qty_picked: take,
        });
        remaining -= take;
      }
      // 更新 item.picked_qty
      await supabase.from('wms_order_items').update({ picked_qty: +it.qty }).eq('id', it.id);
    }

    // 更新状态 → 2 拣货中 → 3 待打包
    await setStatus(3, { picked_at: new Date().toISOString() });
    alert(`✅ 拣货完成，已锁定库存`);
  }

  async function pack() {
    if (!confirm('确认全部已打包？')) return;
    for (const it of items!) {
      // 真正扣减库存（从 qty_onhand 里把 locked 减掉）
      const bins = (inv as any[]).filter(i => i.product_id === it.product_id && i.warehouse_id === order!.warehouse_id && (+i.qty_locked || 0) > 0);
      let remaining = +it.qty - (+it.packed_qty || 0);
      for (const bin of bins) {
        if (remaining <= 0) break;
        const dec = Math.min(+bin.qty_locked, remaining);
        await supabase.from('wms_inventory').update({
          qty_onhand: +bin.qty_onhand - dec,
          qty_locked: +bin.qty_locked - dec,
          last_move_at: new Date().toISOString(),
        }).eq('id', bin.id);
        remaining -= dec;
      }
      await supabase.from('wms_order_items').update({ packed_qty: +it.qty }).eq('id', it.id);
    }
    await setStatus(4, { packed_at: new Date().toISOString() });
    alert('✅ 已打包');
  }

  async function requestLabel() {
    // 如果没有 label，先生成
    let labelId = label?.id;
    if (!labelId) {
      const channel = await supabase.from('wms_shipping_channels').select('id').eq('channel_code', order!.channel_code).maybeSingle();
      const chId = channel.data?.id;
      if (!chId) { alert('未找到渠道：' + order!.channel_code); return; }
      const ln = 'LB' + order!.order_no.slice(2);
      const { data: ins } = await supabase.from('wms_shipment_labels').insert({
        tenant_id: order!.tenant_id,
        warehouse_id: order!.warehouse_id,
        order_id: order!.id, channel_id: chId,
        label_no: ln, status: 1,
      }).select().single();
      labelId = ins!.id;
    }
    await supabase.from('wms_shipment_labels').update({ status: 2, printed_at: new Date().toISOString() }).eq('id', labelId);
    alert('✅ 面单已生成并标记为已打印（生产环境将调用渠道 API 取 PDF）');
    qc.invalidateQueries();
  }

  async function shipManual() {
    const tracking = prompt('输入最终运单号', label?.tracking_no || '');
    if (tracking === null) return;
    const labelUrl = prompt('面单 PDF 地址（可留空）') || '';
    await supabase.from('wms_shipment_labels').update({
      tracking_no: tracking || null,
      label_pdf_url: labelUrl || null,
      status: 3, ship_at: new Date().toISOString(),
    }).eq('id', label!.id);
    await setStatus(5, { shipped_at: new Date().toISOString() });
    setManualTracking(false);
    qc.invalidateQueries();
  }

  async function cancel() {
    if (!confirm('确认取消此订单？')) return;
    await setStatus(7, { cancel_flag: 1 });
  }

  if (!order) return <div className="p-8 text-center text-muted-foreground">加载中...</div>;
  const sl = ORDER_STATUS[order.status] || { label: order.status, cls: 'bg-muted' };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/orders' })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-fg mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回订单列表
      </button>

      {/* 订单卡片 */}
      <div className="bg-card rounded-xl shadow-soft border border-border p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Tag className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{order.order_no}</div>
            <div className="text-xs text-muted-foreground">
              {PLATFORM_LABEL[order.platform] || order.platform} · {order.channel_code || '未指定渠道'}
              {order.exception_flag === 1 && <span className="text-destructive ml-2">⚠ {order.exception_type}</span>}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className={`px-2 py-1 rounded text-xs ${sl.cls}`}>{sl.label}</span>
          </div>
        </div>

        {/* 状态流转 */}
        <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
          {order.status === 1 && (
            <button onClick={pick} className="px-4 py-2 bg-warning text-white rounded-lg text-sm hover:bg-warning flex items-center gap-1">
              <Play className="w-3.5 h-3.5" /> 开始拣货并扣库存
            </button>
          )}
          {order.status === 2 && (
            <button onClick={pick} className="px-4 py-2 bg-warning text-white rounded-lg text-sm hover:bg-warning">继续拣货</button>
          )}
          {(order.status === 2 || order.status === 3) && (
            <button onClick={pack} className="px-4 py-2 bg-brand-subtle0 text-white rounded-lg text-sm hover:bg-primary">
              <Check className="w-3.5 h-3.5 inline mr-1" /> 全部打包完成
            </button>
          )}
          {order.status === 4 && (
            <button onClick={requestLabel} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 flex items-center gap-1">
              <Printer className="w-3.5 h-3.5" /> 生成面单
            </button>
          )}
          {order.status === 4 || order.status === 5 ? (
            <button onClick={() => setManualTracking(true)} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> 填运单号并出库
            </button>
          ) : null}
          {(order.status === 1 || order.status === 2 || order.status === 3 || order.status === 4) && (
            <button onClick={cancel} className="px-4 py-2 bg-border text-fg rounded-lg text-sm hover:bg-input">
              <X className="w-3.5 h-3.5 inline mr-1" /> 取消订单
            </button>
          )}
          {order.status === 5 && (
            <button onClick={() => setStatus(6, { synced_erp_at: new Date().toISOString() })} className="px-4 py-2 bg-success-bg0 text-white rounded-lg text-sm hover:bg-green-600">
              <Check className="w-3.5 h-3.5 inline mr-1" /> 模拟回写 ERP
            </button>
          )}
        </div>
      </div>

      {/* 收件人 + 渠道 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-card rounded-xl shadow-soft border border-border p-4 text-sm">
          <div className="text-xs text-muted-foreground mb-2">收件信息</div>
          <div className="font-medium">{order.receiver_name || '-'}</div>
          <div className="text-muted-foreground text-xs mt-0.5">{order.receiver_phone}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            {order.receiver_address1}{order.receiver_address2 ? ' ' + order.receiver_address2 : ''}, {order.receiver_city || ''} {order.receiver_state || ''} {order.receiver_zip || ''} {order.receiver_country || ''}
          </div>
        </div>
        <div className="bg-card rounded-xl shadow-soft border border-border p-4 text-sm">
          <div className="text-xs text-muted-foreground mb-2">物流 / 面单</div>
          {label ? (
            <div>
              <div className="font-mono text-brand-600">{label.label_no}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {label.tracking_no || '运单号待填写'}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                面单状态：{(['已生成','已打印','已出库','有轨迹','已退件'] as any)[label.status - 1]}
              </div>
            </div>
          ) : (
            <div className="text-muted-foreground text-xs">面单待生成</div>
          )}
        </div>
      </div>

      {/* 订单明细 */}
      <div className="bg-card rounded-xl shadow-soft border border-border overflow-hidden">
        <div className="px-5 py-3 border-b border-border font-medium flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-500" /> 订单明细（{items?.length || 0} 项）
        </div>
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground text-xs">
            <tr>
              <th className="text-left px-4 py-2">SKU</th>
              <th className="text-right px-4 py-2">数量</th>
              <th className="text-right px-4 py-2">已拣</th>
              <th className="text-right px-4 py-2">已打包</th>
              <th className="text-center px-4 py-2">库存</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((it: any) => {
              const avail = (inv as any[]).find(i => i.product_id === it.product_id && i.warehouse_id === order.warehouse_id);
              return (
                <tr key={it.id} className="border-t border-transparent">
                  <td className="px-4 py-2 font-mono text-xs">{it.sku_code}</td>
                  <td className="px-4 py-2 text-right font-medium">{it.qty}</td>
                  <td className="px-4 py-2 text-right text-warning">{it.picked_qty || 0}</td>
                  <td className="px-4 py-2 text-right text-success">{it.packed_qty || 0}</td>
                  <td className={`px-4 py-2 text-center ${(+avail?.qty_onhand || 0) - (+avail?.qty_locked || 0) - (+it.qty || 0) < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {avail ? `${+avail.qty_onhand - +avail.qty_locked} / ${+avail.qty_onhand}` : '未配对'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 手填运单号弹窗 */}
      {manualTracking && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="font-bold mb-4">填运单号出库</h3>
            <input className="inp mb-2" placeholder="运单号" onKeyDown={(e: any) => { if (e.key === 'Enter') shipManual(); }} />
            <div className="flex gap-2">
              <button onClick={() => setManualTracking(false)} className="flex-1 py-2 bg-muted text-muted-foreground rounded-lg">取消</button>
              <button onClick={shipManual} className="flex-1 py-2 bg-brand-500 text-white rounded-lg">确认出库</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
