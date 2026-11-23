import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, Ban, XCircle, AlertTriangle, CheckCircle2, Clock, Package } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// ========================================================
// 截单 / 取消发货 — wms_shipment_cancellations
// Trigger: trg_cancellation_inventory_rollback auto rollback pick_tasks + qty_reserved on status → completed
// ========================================================

const REASON_OPTIONS = [
  { v: 'customer_request', l: '客户主动取消' },
  { v: 'address_change', l: '地址变更' },
  { v: 'duplicate_order', l: '重复下单' },
  { v: 'pricing_error', l: '价格错误' },
  { v: 'stock_mismatch', l: '库存差异' },
  { v: 'other', l: '其他原因' },
];
const STATUS_OPTIONS = [
  { v: 'pending', l: '待审批', color: 'bg-amber-50 text-amber-600' },
  { v: 'approved', l: '已审批', color: 'bg-blue-50 text-blue-600' },
  { v: 'processing', l: '处理中', color: 'bg-purple-50 text-purple-600' },
  { v: 'completed', l: '已完成 (库存已回滚)', color: 'bg-green-50 text-green-600' },
  { v: 'rejected', l: '已驳回', color: 'bg-red-50 text-red-600' },
];

export function ShipmentCancellationPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const { data: cancellations, isLoading } = useQuery({
    queryKey: ['wms_shipment_cancellations', statusFilter],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      let q: any = supabase.from('wms_shipment_cancellations').select('*').eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data } = await q;
      return data || [];
    },
  });

  const { data: shipments } = useQuery({
    queryKey: ['wms_shipments_for_cancel'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await supabase.from('wms_shipments').select('*')
        .eq('user_id', uid).order('created_at', { ascending: false });
      return data || [];
    },
  });

  // 关联 shipment details
  const shipmentMap = (shipments as any[])?.reduce((m: any, s: any) => {
    m[s.id] = s;
    return m;
  }, {});

  const { data: counts } = useQuery({
    queryKey: ['wms_cancel_counts'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const [pending, approved, completed, rejected] = await Promise.all([
        supabase.from('wms_shipment_cancellations').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'pending'),
        supabase.from('wms_shipment_cancellations').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'approved'),
        supabase.from('wms_shipment_cancellations').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'completed'),
        supabase.from('wms_shipment_cancellations').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'rejected'),
      ]);
      return { pending: pending.count || 0, approved: approved.count || 0, completed: completed.count || 0, rejected: rejected.count || 0 };
    },
  });

  async function quickCancelShipment(shipment: any) {
    if (!confirm(`确认对发货单 ${shipment.shipment_no} 发起截单申请？将自动触发库存回滚。`)) return;
    const reason = prompt('请选择原因输入代码（customer_request / address_change / duplicate_order / pricing_error / stock_mismatch / other）：', 'customer_request');
    if (!reason) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('wms_shipment_cancellations').insert({
      user_id: user!.id,
      shipment_id: shipment.id,
      cancellation_no: 'CAN' + Date.now().toString().slice(-8),
      reason, status: 'pending', rollback_inventory: true,
    });
    qc.invalidateQueries();
    alert('截单申请已提交');
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">截单 / 取消发货</h2>
          <p className="text-sm text-gray-500 mt-1">
            防资损拦截 — 审批通过后由 DB Trigger 自动回滚拣货任务与 qty_reserved
          </p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建截单申请
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <Stat label="待审批" value={counts?.pending || 0} icon={Clock} color="text-amber-600" />
        <Stat label="已审批待处理" value={counts?.approved || 0} icon={CheckCircle2} color="text-blue-600" />
        <Stat label="已完成回滚" value={counts?.completed || 0} icon={Package} color="text-green-600" />
        <Stat label="已驳回" value={counts?.rejected || 0} icon={XCircle} color="text-red-500" />
      </div>

      {/* Quick cancel from shipments */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex items-start gap-3">
        <Ban className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-medium text-amber-800 mb-1">
            从发货单快速发起截单
          </div>
          <div className="text-xs text-amber-700 mb-2">
            下面列出最近的发货单（排除已完成/已取消），点击"快速截单"一键创建申请
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(shipments as any[])
              ?.filter((s: any) => !['shipped', 'delivered', 'cancelled'].includes(s.status))
              .slice(0, 8)
              .map((s: any) => {
                const alreadyCanceled = (cancellations as any[])?.some((c: any) => c.shipment_id === s.id);
                return (
                  <button key={s.id} disabled={alreadyCanceled}
                    onClick={() => quickCancelShipment(s)}
                    className={`text-xs px-2 py-1 rounded border ${
                      alreadyCanceled
                        ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                        : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-100'
                    }`}>
                    {s.shipment_no} · {s.receiver_name || '-'}
                    {alreadyCanceled && ' (已申请)'}
                  </button>
                );
              })}
          </div>
        </div>
      </div>

      {/* Filter + List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">状态筛选：</span>
          {[{ v: 'all', l: '全部' }, ...STATUS_OPTIONS].map(s => (
            <button key={s.v} onClick={() => setStatusFilter(s.v)}
              className={`px-3 py-1 rounded-full text-xs transition ${
                statusFilter === s.v ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{s.l}</button>
          ))}
        </div>

        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5">截单号</th>
              <th className="text-left px-5 py-2.5">关联发货单</th>
              <th className="text-left px-5 py-2.5">收件人</th>
              <th className="text-left px-5 py-2.5">原因</th>
              <th className="text-left px-5 py-2.5">库存回滚</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-left px-5 py-2.5">时间</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {(cancellations as any[])?.map((c: any) => {
              const ship = shipmentMap[c.shipment_id];
              return (
                <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-3 font-mono text-brand-600">{c.cancellation_no}</td>
                  <td className="px-5 py-3">
                    <div className="font-mono text-xs">{ship?.shipment_no || c.shipment_id?.slice(0, 8)}</div>
                    {ship && <div className="text-[10px] text-gray-400">原状态：{ship.status}</div>}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">{ship?.receiver_name || '-'}</td>
                  <td className="px-5 py-3 text-xs text-gray-600">
                    {REASON_OPTIONS.find(r => r.v === c.reason)?.l || c.reason}
                  </td>
                  <td className="px-5 py-3">
                    {c.rollback_inventory ? (
                      <span className="text-xs text-green-600">✓ 启用</span>
                    ) : (
                      <span className="text-xs text-gray-400">— 关闭</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${STATUS_OPTIONS.find(s => s.v === c.status)?.color || 'bg-gray-100'}`}>
                      {STATUS_OPTIONS.find(s => s.v === c.status)?.l || c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500 tabular-nums">
                    {new Date(c.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setDetail(c)}
                        className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100">详情</button>
                      {c.status === 'pending' && (
                        <>
                          <button onClick={() => approve(c)}
                            className="px-2 py-1 text-xs bg-green-50 text-green-600 rounded hover:bg-green-100">审批</button>
                          <button onClick={() => reject(c)}
                            className="px-2 py-1 text-xs bg-red-50 text-red-500 rounded hover:bg-red-100">驳回</button>
                        </>
                      )}
                      {c.status === 'approved' && (
                        <button onClick={() => processCancel(c)}
                          className="px-2 py-1 text-xs bg-purple-50 text-purple-600 rounded hover:bg-purple-100">执行截单</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!cancellations?.length && <tr><td colSpan={8} className="p-10 text-center text-gray-400">{isLoading ? '加载中...' : '暂无截单申请'}</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <CancellationForm shipments={shipments!} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_shipment_cancellations'] }); }} />}

      {detail && <CancellationDetail cancellation={detail} onClose={() => { setDetail(null); qc.invalidateQueries(); }} />}
    </div>
  );
}

// ========================================================
// Action handlers — state machine
// ========================================================

async function approve(c: any) {
  const approver = prompt('审批人姓名');
  if (!approver) return;
  const { error } = await supabase.from('wms_shipment_cancellations').update({
    status: 'approved', approved_by: approver,
  }).eq('id', c.id);
  if (error) alert(error.message);
}

async function reject(c: any) {
  if (!confirm('确认驳回此截单申请？')) return;
  const { error } = await supabase.from('wms_shipment_cancellations').update({
    status: 'rejected',
  }).eq('id', c.id);
  if (error) alert(error.message);
}

async function processCancel(c: any) {
  if (!confirm('执行截单将触发 DB Trigger 自动回滚拣货任务与库存。确认？')) return;
  // Step 1: processing
  await supabase.from('wms_shipment_cancellations').update({ status: 'processing' }).eq('id', c.id);
  // Step 2: completed — trigger fires trg_cancellation_inventory_rollback()
  await supabase.from('wms_shipment_cancellations').update({
    status: 'completed', cancelled_at: new Date().toISOString(),
  }).eq('id', c.id);
  alert('截单完成，DB Trigger 已自动回滚库存');
}

// ========================================================
// Form: New cancellation
// ========================================================

function CancellationForm({ shipments, onClose, onSaved }: any) {
  const [f, setF] = useState<any>({
    shipment_id: '', reason: 'customer_request',
    cancellation_no: 'CAN' + Date.now().toString().slice(-8),
    rollback_inventory: true, remark: '',
  });

  const available = (shipments as any[])
    ?.filter((s: any) => !['shipped', 'delivered', 'cancelled'].includes(s.status));

  async function save() {
    if (!f.shipment_id) return alert('请选择要截单的发货单');
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('wms_shipment_cancellations').insert({
      ...f, user_id: user!.id, status: 'pending',
    });
    if (error) return alert(error.message);
    onSaved();
  }

  return (
    <Modal title="新建截单申请" onClose={onClose}>
      <div className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
        ⚠ 审批通过并执行后，DB Trigger 将自动回滚该发货单的拣货任务和库存（qty_reserved → 0, pick_tasks.status → cancelled）。
      </div>
      <Grid>
        <Field label="发货单 *">
          <select className="inp" value={f.shipment_id} onChange={(e) => setF({ ...f, shipment_id: e.target.value })}>
            <option value="">请选择待发货/拣货中/已打包的发货单</option>
            {available?.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.shipment_no} · {s.receiver_name || '-'} · {s.status}
              </option>
            ))}
          </select>
        </Field>
        <Field label="截单号"><input className="inp" value={f.cancellation_no} onChange={(e) => setF({ ...f, cancellation_no: e.target.value })} /></Field>
        <Field label="原因">
          <select className="inp" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
            {REASON_OPTIONS.map(r => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
        </Field>
        <Field label="库存回滚">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.rollback_inventory} onChange={(e) => setF({ ...f, rollback_inventory: e.target.checked })} />
            执行自动回滚
          </label>
        </Field>
        <Field label="备注" full><textarea className="inp" rows={2} value={f.remark} onChange={(e) => setF({ ...f, remark: e.target.value })} /></Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// ========================================================
// Detail — show rollback items
// ========================================================

function CancellationDetail({ cancellation, onClose }: any) {
  const { data: ship } = useQuery({
    queryKey: ['ship_for_cancel_detail', cancellation.shipment_id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipments').select('*').eq('id', cancellation.shipment_id).single();
      return data;
    },
  });
  const { data: items } = useQuery({
    queryKey: ['wms_cancel_items', cancellation.id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_shipment_cancellation_items').select('*')
        .eq('cancellation_id', cancellation.id);
      return data || [];
    },
  });
  const { data: pickTasks } = useQuery({
    queryKey: ['pick_tasks_for_cancel', cancellation.shipment_id],
    queryFn: async () => {
      const { data } = await supabase.from('wms_pick_tasks').select('*')
        .eq('shipment_id', cancellation.shipment_id);
      return data || [];
    },
  });

  return (
    <Modal title={`截单详情 — ${cancellation.cancellation_no}`} onClose={onClose}>
      <div className="space-y-4 max-h-[600px] overflow-auto pr-1">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3 text-xs bg-gray-50 rounded p-3">
          <Info2 label="发货单" value={ship?.shipment_no || cancellation.shipment_id?.slice(0, 8)} />
          <Info2 label="原因" value={REASON_OPTIONS.find(r => r.v === cancellation.reason)?.l || cancellation.reason} />
          <Info2 label="状态" value={STATUS_OPTIONS.find(s => s.v === cancellation.status)?.l || cancellation.status} />
          <Info2 label="库存回滚" value={cancellation.rollback_inventory ? '✓ 启用' : '× 关闭'} />
          <Info2 label="审批人" value={cancellation.approved_by || '-'} />
          <Info2 label="创建时间" value={new Date(cancellation.created_at).toLocaleString('zh-CN')} />
          {cancellation.remark && <Info2 label="备注" value={cancellation.remark} colSpan={2} />}
        </div>

        {/* Pick tasks affected */}
        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1">
            <Package className="w-3.5 h-3.5 text-gray-500" /> 受影响的拣货任务
          </h4>
          {!(pickTasks as any[])?.length ? (
            <div className="text-xs text-gray-400 p-3 bg-gray-50 rounded">无拣货任务</div>
          ) : (
            <table className="w-full text-xs border border-gray-100 rounded overflow-hidden">
              <thead className="bg-gray-50 text-gray-500"><tr>
                <th className="text-left px-3 py-1.5">SKU</th>
                <th className="text-right px-3 py-1.5">数量</th>
                <th className="text-left px-3 py-1.5">状态</th>
              </tr></thead>
              <tbody>
                {(pickTasks as any[]).map((p: any) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 font-mono">{p.sku}</td>
                    <td className="px-3 py-1.5 text-right">{p.qty}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded ${pickStatusBadge(p.status)}`}>{p.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Cancellation Items */}
        {(items as any[])?.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold mb-2">已拣货返上架明细</h4>
            <table className="w-full text-xs border border-gray-100 rounded overflow-hidden">
              <thead className="bg-gray-50 text-gray-500"><tr>
                <th className="text-left px-3 py-1.5">SKU</th>
                <th className="text-right px-3 py-1.5">拣回</th>
                <th className="text-right px-3 py-1.5">回库</th>
                <th className="text-left px-3 py-1.5">状态</th>
              </tr></thead>
              <tbody>
                {(items as any[]).map((it: any) => (
                  <tr key={it.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5 font-mono">{it.sku}</td>
                    <td className="px-3 py-1.5 text-right">{it.qty_picked_back}</td>
                    <td className="px-3 py-1.5 text-right text-green-600">{it.qty_returned_to_stock}</td>
                    <td className="px-3 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded ${rollbackBadge(it.rollback_status)}`}>{it.rollback_status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Trigger note */}
        {cancellation.status === 'completed' && (
          <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded p-2">
            ✓ DB Trigger <code className="font-mono">trg_cancellation_inventory_rollback()</code> 已自动完成：
            pick_tasks.status → cancelled, qty_reserved 释放, inventory_log 已记录。
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm">关闭</button>
      </div>
    </Modal>
  );
}

// ---------- helpers ----------
function Stat({ label, value, icon: Icon, color }: any) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{label}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${color}`}>{value}</div>
    </div>
  );
}
function Info2({ label, value, colSpan }: any) {
  return (
    <div className={colSpan === 2 ? 'col-span-2' : ''}>
      <div className="text-[10px] text-gray-400 mb-0.5">{label}</div>
      <div className="font-medium text-gray-800">{value}</div>
    </div>
  );
}
function pickStatusBadge(s: string) {
  const m: any = {
    done: 'bg-green-50 text-green-600',
    in_progress: 'bg-amber-50 text-amber-600',
    pending: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-red-50 text-red-500',
  };
  return m[s] || 'bg-gray-100';
}
function rollbackBadge(s: string) {
  const m: any = {
    pending: 'bg-gray-100 text-gray-500',
    rolled_back: 'bg-green-50 text-green-600',
    failed: 'bg-red-50 text-red-500',
  };
  return m[s] || 'bg-gray-100';
}
