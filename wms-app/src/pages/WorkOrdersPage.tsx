import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Plus, AlertTriangle, AlertCircle, XCircle, CheckCircle2, Clock, Filter, Search } from 'lucide-react';
import { useState } from 'react';
import { Modal, Grid, Field, Footer } from './LocationsPage';

// ========================================================
// 工单系统 — Work Orders (wms_work_orders)
// ========================================================

const TYPE_OPTIONS = [
  { v: 'picking_issue', l: '拣货问题' },
  { v: 'location_issue', l: '库位问题' },
  { v: 'inventory_discrepancy', l: '库存差异' },
  { v: 'damage', l: '货物破损' },
  { v: 'equipment', l: '设备故障' },
  { v: 'other', l: '其他' },
];
const PRIORITY_OPTIONS = [
  { v: 'low', l: '低', color: 'bg-gray-100 text-gray-500' },
  { v: 'normal', l: '普通', color: 'bg-blue-50 text-blue-600' },
  { v: 'high', l: '高', color: 'bg-amber-50 text-amber-600' },
  { v: 'urgent', l: '紧急', color: 'bg-red-100 text-red-600' },
];
const STATUS_OPTIONS = [
  { v: 'pending', l: '待分配', color: 'bg-gray-100 text-gray-500', icon: Clock },
  { v: 'assigned', l: '已分配', color: 'bg-blue-50 text-blue-600', icon: AlertCircle },
  { v: 'in_progress', l: '处理中', color: 'bg-amber-50 text-amber-600', icon: AlertTriangle },
  { v: 'resolved', l: '已解决', color: 'bg-green-50 text-green-600', icon: CheckCircle2 },
  { v: 'closed', l: '已关闭', color: 'bg-gray-100 text-gray-400', icon: XCircle },
];

export function WorkOrdersPage() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const { data: warehouses } = useQuery({
    queryKey: ['wms_warehouses'],
    queryFn: async () => { const { data } = await supabase.from('wms_warehouses').select('*'); return data || []; },
  });

  const { data: workOrders, isLoading } = useQuery({
    queryKey: ['wms_work_orders', typeFilter, priorityFilter, statusFilter, search],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      let q: any = supabase.from('wms_work_orders').select('*').eq('user_id', uid)
        .order('created_at', { ascending: false });
      if (typeFilter !== 'all') q = q.eq('type', typeFilter);
      if (priorityFilter !== 'all') q = q.eq('priority', priorityFilter);
      if (statusFilter !== 'all') q = q.eq('status', statusFilter);
      const { data } = await q;
      const rows = data || [];
      if (search.trim()) {
        const s = search.trim().toLowerCase();
        return rows.filter((r: any) =>
          r.work_order_no?.toLowerCase().includes(s) ||
          r.title?.toLowerCase().includes(s) ||
          r.description?.toLowerCase().includes(s) ||
          r.reporter?.toLowerCase().includes(s) ||
          r.assignee?.toLowerCase().includes(s)
        );
      }
      return rows;
    },
  });

  // Counts for quick status summary
  const { data: counts } = useQuery({
    queryKey: ['wms_wo_counts'],
    queryFn: async () => {
      const uid = (await supabase.auth.getUser()).data.user?.id;
      const [pending, urgent, total] = await Promise.all([
        supabase.from('wms_work_orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'pending'),
        supabase.from('wms_work_orders').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('priority', 'urgent').in('status', ['pending', 'assigned', 'in_progress']),
        supabase.from('wms_work_orders').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      ]);
      return { pending: pending.count || 0, urgent: urgent.count || 0, total: total.count || 0 };
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">工单系统</h2>
          <p className="text-sm text-gray-500 mt-1">仓库内部问题追踪 — 分配 / 处理 / 解决 / 关闭</p>
        </div>
        <button onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-500 text-white rounded-lg hover:bg-brand-600 text-sm">
          <Plus className="w-4 h-4" /> 新建工单
        </button>
      </div>

      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">总工单</div>
          <div className="text-2xl font-bold text-gray-800">{counts?.total ?? '-'}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
          <div className="text-xs text-gray-500 mb-1">待分配</div>
          <div className="text-2xl font-bold text-blue-600">{counts?.pending ?? '-'}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-red-100 shadow-sm">
          <div className="text-xs text-red-500 mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> 紧急/高优先级
          </div>
          <div className="text-2xl font-bold text-red-500">{counts?.urgent ?? '-'}</div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-xl border border-gray-100 p-3 mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Filter className="w-3 h-3 text-gray-400" />
        <span className="text-gray-500">类型</span>
        {[{ v: 'all', l: '全部' }, ...TYPE_OPTIONS].map(t => (
          <button key={t.v} onClick={() => setTypeFilter(t.v)}
            className={`px-2.5 py-1 rounded ${typeFilter === t.v ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{t.l}</button>
        ))}
        <span className="text-gray-500 ml-2">优先级</span>
        {[{ v: 'all', l: '全部' }, ...PRIORITY_OPTIONS].map(p => (
          <button key={p.v} onClick={() => setPriorityFilter(p.v)}
            className={`px-2.5 py-1 rounded ${priorityFilter === p.v ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{p.l}</button>
        ))}
        <span className="text-gray-500 ml-2">状态</span>
        {[{ v: 'all', l: '全部' }, ...STATUS_OPTIONS].map(s => (
          <button key={s.v} onClick={() => setStatusFilter(s.v)}
            className={`px-2.5 py-1 rounded ${statusFilter === s.v ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600'}`}>{s.l}</button>
        ))}
        <div className="ml-auto relative">
          <Search className="w-3 h-3 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input placeholder="搜索工单号 / 标题 / 处理人"
            value={search} onChange={(e) => setSearch(e.target.value)}
            className="pl-6 pr-2 py-1 border border-gray-200 rounded text-xs w-56" />
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="text-left px-5 py-2.5 w-10"></th>
              <th className="text-left px-5 py-2.5">工单号</th>
              <th className="text-left px-5 py-2.5">标题 / 描述</th>
              <th className="text-left px-5 py-2.5">类型</th>
              <th className="text-left px-5 py-2.5">优先级</th>
              <th className="text-left px-5 py-2.5">处理人</th>
              <th className="text-left px-5 py-2.5">状态</th>
              <th className="text-left px-5 py-2.5">创建时间</th>
              <th className="text-right px-5 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody>
            {(workOrders as any[])?.map((wo: any) => {
              const priority = PRIORITY_OPTIONS.find(p => p.v === wo.priority) || PRIORITY_OPTIONS[1];
              const status = STATUS_OPTIONS.find(s => s.v === wo.status) || STATUS_OPTIONS[0];
              const urgentPulse = wo.priority === 'urgent' && !['resolved', 'closed'].includes(wo.status);
              return (
                <tr key={wo.id} onClick={() => setDetail(wo)}
                  className={`border-t border-gray-50 cursor-pointer hover:bg-gray-50/50 ${urgentPulse ? 'bg-red-50/40' : ''}`}>
                  <td className="px-5 py-3">
                    {wo.priority === 'urgent' && (
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                    )}
                    {wo.priority === 'high' && !urgentPulse && (
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-brand-600">{wo.work_order_no}</td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800">{wo.title}</div>
                    {wo.description && (
                      <div className="text-xs text-gray-500 truncate max-w-[260px]">{wo.description}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">
                    {TYPE_OPTIONS.find(t => t.v === wo.type)?.l || wo.type}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${priority.color} ${urgentPulse ? 'animate-pulse' : ''}`}>
                      {priority.l}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-600">{wo.assignee || '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${status.color}`}>{status.l}</span>
                  </td>
                  <td className="px-5 py-3 text-xs text-gray-500 tabular-nums">
                    {new Date(wo.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-5 py-3 text-right text-xs text-brand-500">
                    详情 →
                  </td>
                </tr>
              );
            })}
            {!workOrders?.length && <tr><td colSpan={9} className="p-10 text-center text-gray-400">{isLoading ? '加载中...' : '暂无工单'}</td></tr>}
          </tbody>
        </table>
      </div>

      {showForm && <WorkOrderForm warehouses={warehouses!} onClose={() => setShowForm(false)}
        onSaved={() => { setShowForm(false); qc.invalidateQueries({ queryKey: ['wms_work_orders'] }); }} />}

      {detail && <WorkOrderDetail wo={detail} warehouses={warehouses!} onClose={() => { setDetail(null); qc.invalidateQueries({ queryKey: ['wms_work_orders'] }); }} />}
    </div>
  );
}

// ========================================================
// New Work Order Form
// ========================================================

function WorkOrderForm({ warehouses, onClose, onSaved }: any) {
  const [f, setF] = useState<any>({
    warehouse_id: warehouses?.[0]?.id || '',
    work_order_no: 'WO' + Date.now().toString().slice(-8),
    type: 'picking_issue', priority: 'normal',
    title: '', description: '', reporter: '',
    related_entity_type: '', related_entity_id: '',
  });

  async function save() {
    if (!f.title.trim()) return alert('请填写标题');
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('wms_work_orders').insert({
      ...f, user_id: user!.id, status: 'pending',
    });
    if (error) return alert(error.message);
    onSaved();
  }

  return (
    <Modal title="新建工单" onClose={onClose}>
      <Grid>
        <Field label="仓库">
          <select className="inp" value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {(warehouses as any[])?.map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label="工单号"><input className="inp" value={f.work_order_no} onChange={(e) => setF({ ...f, work_order_no: e.target.value })} /></Field>
        <Field label="类型">
          <select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {TYPE_OPTIONS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
        </Field>
        <Field label="优先级">
          <select className="inp" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            {PRIORITY_OPTIONS.map(p => <option key={p.v} value={p.v}>{p.l}</option>)}
          </select>
        </Field>
        <Field label="标题 *" full><input className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="简短描述问题" /></Field>
        <Field label="描述" full><textarea className="inp" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="报告人"><input className="inp" value={f.reporter} onChange={(e) => setF({ ...f, reporter: e.target.value })} placeholder="可选" /></Field>
        <Field label="关联实体类型">
          <select className="inp" value={f.related_entity_type} onChange={(e) => setF({ ...f, related_entity_type: e.target.value })}>
            <option value="">不关联</option>
            <option value="shipment">发货单</option>
            <option value="asn">入库单</option>
            <option value="inventory">库存</option>
            <option value="location">库位</option>
          </select>
        </Field>
        <Field label="关联 ID" full><input className="inp" value={f.related_entity_id} onChange={(e) => setF({ ...f, related_entity_id: e.target.value })} placeholder="UUID 或业务单号" /></Field>
      </Grid>
      <Footer onClose={onClose} onSave={save} />
    </Modal>
  );
}

// ========================================================
// Work Order Detail — full lifecycle
// ========================================================

function WorkOrderDetail({ wo, warehouses, onClose }: any) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(wo.title);
  const [description, setDescription] = useState(wo.description || '');
  const [assignee, setAssignee] = useState(wo.assignee || '');
  const [resolution, setResolution] = useState(wo.resolution || '');

  async function transition(status: string, extras: any = {}) {
    const payload: any = { ...extras, status, title, description };
    if (status === 'in_progress' && !wo.assignee) {
      const name = prompt('请输入处理人姓名', assignee || '') || assignee;
      if (name) payload.assignee = name;
      else return;
    }
    if (status === 'resolved') {
      const res = prompt('解决方案描述', resolution) || resolution;
      payload.resolution = res;
      payload.resolved_at = new Date().toISOString();
    }
    if (status === 'closed') {
      payload.closed_at = new Date().toISOString();
    }
    const { error } = await supabase.from('wms_work_orders').update(payload).eq('id', wo.id);
    if (error) return alert(error.message);
    qc.invalidateQueries({ queryKey: ['wms_work_orders'] });
    onClose();
  }

  return (
    <Modal title={`工单详情 — ${wo.work_order_no}`} onClose={onClose}>
      <div className="space-y-4">
        {/* Header meta */}
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-gray-400 mb-0.5">类型</div>
            <div>{TYPE_OPTIONS.find(t => t.v === wo.type)?.l || wo.type}</div>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">优先级</div>
            <span className={`px-2 py-0.5 rounded ${PRIORITY_OPTIONS.find(p => p.v === wo.priority)?.color || 'bg-gray-100'}`}>
              {PRIORITY_OPTIONS.find(p => p.v === wo.priority)?.l || wo.priority}
            </span>
          </div>
          <div>
            <div className="text-gray-400 mb-0.5">状态</div>
            <span className={`px-2 py-0.5 rounded ${STATUS_OPTIONS.find(s => s.v === wo.status)?.color || 'bg-gray-100'}`}>
              {STATUS_OPTIONS.find(s => s.v === wo.status)?.l || wo.status}
            </span>
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">标题</label>
          <input className="inp" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">问题描述</label>
          <textarea className="inp" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {/* Assignee / reporter */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">处理人 (Assignee)</label>
            <input className="inp" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="例如 张三" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">报告人</label>
            <input className="inp" disabled value={wo.reporter || ''} placeholder="—" />
          </div>
        </div>

        {/* Related */}
        {(wo.related_entity_type || wo.related_entity_id) && (
          <div className="text-xs p-2 bg-gray-50 rounded">
            <span className="text-gray-400">关联实体：</span>
            {wo.related_entity_type}
            {wo.related_entity_id && <span className="ml-1 font-mono">{wo.related_entity_id}</span>}
          </div>
        )}

        {/* Resolution (visible after resolved) */}
        {['resolved', 'closed'].includes(wo.status) && (
          <div>
            <label className="text-xs text-gray-500 mb-1 block">解决方案</label>
            <textarea className="inp" rows={2} disabled value={wo.resolution || resolution} />
          </div>
        )}

        {/* Timeline */}
        <div className="text-xs text-gray-500 pt-2 border-t border-gray-100">
          <div className="flex justify-between py-1"><span>创建时间</span><span className="tabular-nums">{new Date(wo.created_at).toLocaleString('zh-CN')}</span></div>
          {wo.resolved_at && <div className="flex justify-between py-1"><span>解决时间</span><span className="tabular-nums">{new Date(wo.resolved_at).toLocaleString('zh-CN')}</span></div>}
          {wo.closed_at && <div className="flex justify-between py-1"><span>关闭时间</span><span className="tabular-nums">{new Date(wo.closed_at).toLocaleString('zh-CN')}</span></div>}
        </div>

        {/* Action buttons — state machine */}
        <div className="flex flex-wrap gap-2 pt-3 border-t border-gray-100">
          {wo.status === 'pending' && (
            <button onClick={() => transition('assigned', { assignee: assignee || '未分配' })}
              className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">分配</button>
          )}
          {['pending', 'assigned'].includes(wo.status) && (
            <button onClick={() => transition('in_progress', { assignee: assignee || '未分配' })}
              className="px-3 py-1.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-600">开始处理</button>
          )}
          {wo.status === 'in_progress' && (
            <button onClick={() => transition('resolved')}
              className="px-3 py-1.5 text-xs bg-green-500 text-white rounded hover:bg-green-600">标记已解决</button>
          )}
          {wo.status === 'resolved' && (
            <button onClick={() => transition('closed')}
              className="px-3 py-1.5 text-xs bg-gray-500 text-white rounded hover:bg-gray-600">关闭工单</button>
          )}
          {wo.status === 'closed' && (
            <button onClick={() => transition('in_progress')}
              className="px-3 py-1.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-600">重新打开</button>
          )}
          {['pending', 'assigned', 'in_progress', 'resolved'].includes(wo.status) && (
            <button onClick={() => {
              if (!confirm('确认放弃工单？')) return;
              transition('closed', { resolution: resolution || '用户放弃，无需处理' });
            }} className="px-3 py-1.5 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100 ml-auto">放弃</button>
          )}
        </div>
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm">关闭</button>
      </div>
    </Modal>
  );
}
