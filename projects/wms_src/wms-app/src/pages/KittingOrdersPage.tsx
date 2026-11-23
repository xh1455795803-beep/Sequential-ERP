import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Plus, ArrowLeft, Layers, Package, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// -------- 组套单列表页 --------
export function KittingOrdersPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: kitting } = useQuery({
    queryKey: ['wms_kitting_orders'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wms_kitting_orders')
        .select('*, bom:bom_id(bom_no, sku, sku_name), warehouse:warehouse_id(name, code)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const statusLabel: any = {
    draft: '草稿', released: '已释放', picking: '拣货中',
    kitting: '组套中', completed: '已完成', cancelled: '已取消',
  };

  async function createFromBom(bomId: string) {
    const warehouse_id = prompt('目标仓库（输入仓库 ID）');
    const output_qty = parseInt(prompt('组套数量：', '1') || '1', 10);
    if (!warehouse_id || !output_qty) return;
    const { data: { user } } = await supabase.auth.getUser();
    const order_no = 'KIT' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000);
    const { error } = await supabase.from('wms_kitting_orders').insert({
      user_id: user!.id, order_no, bom_id: bomId, warehouse_id,
      output_qty, status: 'released',
    });
    if (error) return alert(error.message);
    qc.invalidateQueries();
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">组套管理 (Kitting)</h2>
          <p className="text-sm text-gray-500 mt-1">基于 BOM 清单，对组件进行拣配、组装、产出成品</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建组套单
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">组套单号</th>
              <th className="text-left px-5 py-2.5">BOM / 成品</th>
              <th className="text-left px-5 py-2.5">仓库</th>
              <th className="text-right px-5 py-2.5">数量</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {kitting?.map((k: any) => (
              <tr key={k.id} onClick={() => nav({ to: `/kitting/$id`, params: { id: k.id } })}
                className="border-t border-gray-50 hover:bg-brand-50/30 cursor-pointer">
                <td className="px-5 py-3 font-mono text-brand-600">{k.order_no}</td>
                <td className="px-5 py-3">
                  <div className="text-xs text-gray-500">{k.bom?.bom_no}</div>
                  <div className="font-mono text-xs">{k.bom?.sku}</div>
                </td>
                <td className="px-5 py-3">{k.warehouse?.name || '-'}</td>
                <td className="px-5 py-3 text-right">{k.output_qty}</td>
                <td className="px-5 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs ${kittingStatusBadge(k.status)}`}>{statusLabel[k.status] || k.status}</span>
                </td>
                <td className="px-5 py-3 text-right text-brand-500 text-xs">点击处理 →</td>
              </tr>
            ))}
            {!kitting?.length && <tr><td colSpan={6} className="p-10 text-center text-gray-400">暂无组套单</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <KittingForm onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_kitting_orders'] }); }} />}
    </div>
  );
}

function kittingStatusBadge(s: string) {
  const m: any = {
    draft: 'bg-gray-100 text-gray-500', released: 'bg-blue-50 text-blue-600',
    picking: 'bg-amber-50 text-amber-600', kitting: 'bg-purple-50 text-purple-600',
    completed: 'bg-green-50 text-green-600', cancelled: 'bg-gray-100 text-gray-400',
  };
  return m[s] || 'bg-gray-100';
}

function KittingForm({ onClose, onSaved }: any) {
  const { data: boms } = useQuery({
    queryKey: ['wms_bom_active'],
    queryFn: async () => {
      const { data } = await supabase.from('wms_bom').select('*').eq('status', 'active');
      return data || [];
    },
  });
  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const [f, setF] = useState({
    bom_id: '', warehouse_id: '', output_qty: 1, remark: '',
  });

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!f.bom_id || !f.warehouse_id) return alert('请选择 BOM 和仓库');
    const bom = (boms as any[])?.find((b: any) => b.id === f.bom_id);
    const { error } = await supabase.from('wms_kitting_orders').insert({
      user_id: user!.id,
      order_no: 'KIT' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + Math.floor(Math.random() * 9000 + 1000),
      bom_id: f.bom_id, warehouse_id: f.warehouse_id,
      output_qty: f.output_qty,
      output_sku: bom?.sku, output_sku_name: bom?.sku_name,
      status: 'released', remark: f.remark,
    });
    if (error) return alert(error.message);
    onSaved();
  }

  return (
    <Modal title="新建组套单" onClose={onClose}>
      <Grid>
        <Field label="BOM 清单 *">
          <select className="inp" value={f.bom_id} onChange={(e) => setF({ ...f, bom_id: e.target.value })}>
            <option value="">选择 BOM</option>
            {(boms as any[])?.map((b: any) => (
              <option key={b.id} value={b.id}>{b.bom_no} · {b.sku}</option>
            ))}
          </select>
        </Field>
        <Field label="目标仓库 *">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            <option value="">选择仓库</option>
            {(warehouses as any[])?.map((w: any) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </Field>
        <Field label="组套数量 *"><input className="inp" type="number" min={1} value={f.output_qty} onChange={(e) => setF({ ...f, output_qty: +e.target.value })} /></Field>
        <Field label="备注"><input className="inp" value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// -------- 组套单详情页 --------
export function KittingDetailPage() {
  const params = useParams({ strict: false }) as any;
  const id = params?.id;
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: order } = useQuery({
    queryKey: ['kitting', id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_kitting_orders')
        .select('*, bom:bom_id(*), warehouse:warehouse_id(*)')
        .eq('id', id).single();
      return data;
    },
  });

  const { data: bomItems } = useQuery({
    queryKey: ['kitting_bom_items', order?.bom_id],
    enabled: !!order?.bom_id,
    queryFn: async () => {
      const { data } = await supabase.from('wms_bom_items').select('*').eq('bom_id', order.bom_id);
      return data || [];
    },
  });

  const { data: inventory } = useQuery({
    queryKey: ['kitting_inv', order?.warehouse_id, bomItems],
    enabled: !!order?.warehouse_id && !!bomItems?.length,
    queryFn: async () => {
      const skus = (bomItems || []).map((i: any) => i.component_sku);
      const { data } = await supabase.from('wms_inventory')
        .select('sku, location_id, qty_available, qty_on_hand, warehouse_id')
        .eq('warehouse_id', order.warehouse_id)
        .in('sku', skus);
      return data || [];
    },
  });

  async function completeKitting() {
    if (!order) return;
    if (!confirm('确认完成组套？将扣减组件库存并增加成品库存。')) return;

    const { data: { user } } = await supabase.auth.getUser();
    const qty = order.output_qty;
    const logs: any[] = [];

    // 1. 扣减组件库存
    for (const it of (bomItems || [])) {
      const needed = it.qty_per_unit * qty;
      const available = (inventory as any[])
        ?.filter((i: any) => i.sku === it.component_sku)
        ?.reduce((s, i) => s + (i.qty_available || 0), 0) || 0;

      if (available < needed) {
        alert(`组件 ${it.component_sku} 库存不足：需要 ${needed}，只有 ${available}`);
        return;
      }

      // 逐个库位扣减（FIFO）
      let remaining = needed;
      const sortedLocs = (inventory as any[])
        ?.filter((i: any) => i.sku === it.component_sku)
        ?.sort((a, b) => (a.inbound_at || '').localeCompare(b.inbound_at || '')) || [];

      for (const loc of sortedLocs) {
        if (remaining <= 0) break;
        const deduct = Math.min(loc.qty_available, remaining);
        await supabase.from('wms_inventory').update({
          qty_on_hand: loc.qty_on_hand - deduct,
        }).eq('id', loc.id);

        logs.push({
          user_id: user!.id, warehouse_id: order.warehouse_id,
          sku: it.component_sku, location_id: loc.location_id,
          qty_change: -deduct, qty_after: loc.qty_on_hand - deduct,
          type: 'kitting_deduct', ref_type: 'kitting', ref_id: order.id,
          operator: user?.email, remark: `组套单 ${order.order_no} 组件扣减`,
        });
        remaining -= deduct;
      }
    }

    // 2. 增加成品库存（放在空库位中第一个）
    const { data: emptyLocs } = await supabase.from('wms_locations')
      .select('id').eq('warehouse_id', order.warehouse_id).eq('status', 'empty').limit(1);
    const targetLoc = emptyLocs?.[0]?.id;

    let newInvId: string | null = null;
    if (targetLoc) {
      await supabase.from('wms_locations').update({ status: 'occupied' }).eq('id', targetLoc);

      const { data: newInv } = await supabase.from('wms_inventory').insert({
        user_id: user!.id, warehouse_id: order.warehouse_id,
        location_id: targetLoc, sku: order.output_sku,
        qty_on_hand: qty, inbound_at: new Date().toISOString(),
      }).select().single();
      newInvId = newInv?.id || null;

      logs.push({
        user_id: user!.id, warehouse_id: order.warehouse_id,
        sku: order.output_sku, location_id: targetLoc,
        qty_change: qty, qty_after: qty,
        type: 'kitting_output', ref_type: 'kitting', ref_id: order.id,
        operator: user?.email, remark: `组套单 ${order.order_no} 成品入库`,
      });
    } else {
      // 没有空库位 → 找到有相同 SKU 的库位累加
      const { data: sameLoc } = await supabase.from('wms_inventory')
        .select('id, location_id, qty_on_hand')
        .eq('warehouse_id', order.warehouse_id)
        .eq('sku', order.output_sku).limit(1);
      if (sameLoc?.[0]) {
        await supabase.from('wms_inventory').update({
          qty_on_hand: sameLoc[0].qty_on_hand + qty,
        }).eq('id', sameLoc[0].id);
        logs.push({
          user_id: user!.id, warehouse_id: order.warehouse_id,
          sku: order.output_sku, location_id: sameLoc[0].location_id,
          qty_change: qty, qty_after: sameLoc[0].qty_on_hand + qty,
          type: 'kitting_output', ref_type: 'kitting', ref_id: order.id,
          operator: user?.email, remark: `组套单 ${order.order_no} 成品入库（合批）`,
        });
      } else {
        alert('警告：无法找到合适的库位放置成品，库存已扣组件但未加成品！');
        return;
      }
    }

    // 3. 写库存日志
    if (logs.length) {
      await supabase.from('wms_inventory_logs').insert(logs);
    }

    // 4. 更新状态
    await supabase.from('wms_kitting_orders').update({ status: 'completed' }).eq('id', order.id);

    qc.invalidateQueries();
    alert('组套完成！');
  }

  async function releaseOrder() {
    await supabase.from('wms_kitting_orders').update({ status: 'released' }).eq('id', order.id);
    qc.invalidateQueries();
  }

  async function cancelOrder() {
    if (!confirm('确定取消此组套单？')) return;
    await supabase.from('wms_kitting_orders').update({ status: 'cancelled' }).eq('id', order.id);
    qc.invalidateQueries();
  }

  if (!order) return <div className="p-8 text-center text-gray-400">加载中...</div>;

  const canComplete = order.status === 'released' || order.status === 'picking' || order.status === 'kitting';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <button onClick={() => nav({ to: '/kitting' })} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowLeft className="w-4 h-4" /> 返回组套单列表
      </button>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
        <div className="flex items-center gap-3 mb-4">
          <Layers className="w-6 h-6 text-brand-500" />
          <div>
            <div className="text-lg font-bold">{order.order_no}</div>
            <div className="text-xs text-gray-500">
              <span className={`px-2 py-0.5 rounded text-xs mr-2 ${kittingStatusBadge(order.status)}`}>{order.status}</span>
              BOM: <span className="font-mono">{order.bom?.bom_no}</span> · 仓库 {order.warehouse?.name}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            {order.status === 'draft' && (
              <button onClick={releaseOrder} className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600">
                释放（进入作业）
              </button>
            )}
            {canComplete && (
              <button onClick={completeKitting} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4" /> 完成组套
              </button>
            )}
            {order.status !== 'completed' && order.status !== 'cancelled' && (
              <button onClick={cancelOrder} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200">
                取消
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-xs text-gray-400">成品 SKU</div>
            <div className="font-mono">{order.output_sku || order.bom?.sku}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">组套数量</div>
            <div className="font-semibold text-brand-600">{order.output_qty}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">组件种类</div>
            <div className="font-medium">{bomItems?.length || 0}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400">备注</div>
            <div className="font-medium text-gray-600">{order.remark || '-'}</div>
          </div>
        </div>
      </div>

      {/* 组件明细表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-medium flex items-center gap-1.5">
          <Package className="w-4 h-4 text-brand-500" /> 组件清单（×{order.output_qty} = 实际需求量）
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-4 py-2">组件 SKU</th>
              <th className="text-left px-4 py-2">名称</th>
              <th className="text-right px-4 py-2">单套</th>
              <th className="text-right px-4 py-2">实际需求</th>
              <th className="text-right px-4 py-2">仓库现有</th>
              <th className="text-center px-4 py-2">状态</th>
            </tr>
          </thead>
          <tbody>
            {(bomItems || []).map((it: any) => {
              const needed = it.qty_per_unit * order.output_qty;
              const available = (inventory as any[])
                ?.filter((i: any) => i.sku === it.component_sku)
                ?.reduce((s, i) => s + (i.qty_available || 0), 0) || 0;
              return (
                <tr key={it.id} className="border-t border-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{it.component_sku}</td>
                  <td className="px-4 py-2">{it.component_name || '-'}</td>
                  <td className="px-4 py-2 text-right">{it.qty_per_unit}</td>
                  <td className="px-4 py-2 text-right font-semibold">{needed}</td>
                  <td className="px-4 py-2 text-right">{available}</td>
                  <td className="px-4 py-2 text-center">
                    {available >= needed ? (
                      <span className="px-2 py-0.5 rounded text-xs bg-green-50 text-green-600">✓ 充足</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-600">⚠ 不足 {needed - available}</span>
                    )}
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
