import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { AlertTriangle, Plus, XCircle, Clock, CheckCircle, User, Filter, AlertCircle } from 'lucide-react';

export function WmsIssuePage() {
  const [loading, setLoading] = useState(true);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) { setLoading(false); return; }
      setWarehouseId(ctx.warehouseId);
      await loadIssues(ctx.warehouseId);
    })();
  }, []);

  async function loadIssues(wid: string) {
    const { data } = await supabase.from('tlv_issue_items')
      .select('*').eq('warehouse_id', wid).order('created_at', { ascending: false });
    setIssues(data || []);
    setLoading(false);
  }

  async function addSample(wid: string) {
    const samples = [
      { warehouse_id: wid, merchant_id: '7e3bf09f-3937-4891-a6f6-75941f39d1b2',
        sku: 'SKU-001', location: 'A-01-01', issue_type: 'wrong_qty',
        severity: 'high', description: '实际清点少 2 件', status: 'open',
        operator_name: 'wms@thalvior.dev' },
      { warehouse_id: wid, merchant_id: 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5',
        sku: 'SKU-002', location: 'B-02-02', issue_type: 'damaged',
        severity: 'critical', description: '外箱破损，商品可能受损', status: 'assigned',
        assigned_name: '张三', operator_name: 'wms@thalvior.dev' },
      { warehouse_id: wid, merchant_id: '7e3bf09f-3937-4891-a6f6-75941f39d1b2',
        sku: 'SKU-003', location: 'C-03-01', issue_type: 'qc_failed',
        severity: 'medium', description: '抽检发现 3 件外观划痕', status: 'processing',
        assigned_name: '李四', operator_name: 'wms@thalvior.dev' },
    ];
    await supabase.from('tlv_issue_items').insert(samples);
    await loadIssues(wid);
  }

  async function updateStatus(id: string, status: string, resolution?: string) {
    if (!warehouseId) return;
    const patch: any = { status };
    if (resolution !== undefined) patch.resolution = resolution;
    if (status === 'resolved' || status === 'closed') patch.resolved_at = new Date().toISOString();
    await supabase.from('tlv_issue_items').update(patch).eq('id', id);
    await loadIssues(warehouseId);
  }

  async function assignTo(id: string, name: string) {
    if (!warehouseId) return;
    await supabase.from('tlv_issue_items').update({
      status: 'assigned', assigned_name: name,
    }).eq('id', id);
    await loadIssues(warehouseId);
  }

  const filtered = issues.filter(i => {
    if (filterStatus !== 'all' && i.status !== filterStatus) return false;
    if (severityFilter !== 'all' && i.severity !== severityFilter) return false;
    return true;
  });

  const statusCn: Record<string, string> = {
    open: '待处理', assigned: '已分派', processing: '处理中',
    resolved: '已解决', closed: '已关闭', disputed: '争议中',
  };
  const typeCn: Record<string, string> = {
    missing: '丢失', damaged: '破损', wrong_sku: 'SKU 错误',
    wrong_qty: '数量不符', label_mismatch: '标签不符',
    packaging_failed: '包装失败', weight_mismatch: '重量不符',
    qc_failed: '质检不合格', other: '其他',
  };
  const severityCn: Record<string, string> = { low: '低', medium: '中', high: '高', critical: '紧急' };

  const severityColors: Record<string, string> = {
    low: 'bg-slate-100 text-slate-600', medium: 'bg-amber-100 text-amber-700',
    high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700',
  };
  const statusColors: Record<string, string> = {
    open: 'bg-red-50 text-red-700', assigned: 'bg-blue-50 text-blue-700',
    processing: 'bg-amber-50 text-amber-700', resolved: 'bg-green-50 text-green-700',
    closed: 'bg-slate-50 text-slate-600', disputed: 'bg-purple-50 text-purple-700',
  };

  // 统计
  const openCritical = issues.filter(i => i.severity === 'critical' && ['open','assigned','processing'].includes(i.status)).length;
  const openHigh = issues.filter(i => i.severity === 'high' && ['open','assigned','processing'].includes(i.status)).length;

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  return (
    <div className="space-y-4">
      {/* 告警条 */}
      {(openCritical > 0 || openHigh > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4" />
          <b className="font-semibold">⚠ 需紧急处理:</b>
          <span>{openCritical} 个紧急问题件 · {openHigh} 个高优先问题件</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-slate-700">问题件管理</h3>
            <span className="text-xs text-slate-400">异常追踪 · 分派处理 · 关联绩效</span>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Filter className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="pl-6 pr-2 py-1 text-xs border border-slate-200 rounded-lg">
                <option value="all">全部状态</option>
                {Object.keys(statusCn).map(k => <option key={k} value={k}>{statusCn[k]}</option>)}
              </select>
            </div>
            <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
              className="px-2 py-1 text-xs border border-slate-200 rounded-lg">
              <option value="all">全部严重度</option>
              <option value="low">低</option><option value="medium">中</option>
              <option value="high">高</option><option value="critical">紧急</option>
            </select>
            <button onClick={() => warehouseId && addSample(warehouseId)}
              className="px-3 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600">
              + 生成示例
            </button>
            <button onClick={() => setShowNew(true)}
              className="px-3 py-1 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg flex items-center gap-1">
              <Plus className="w-3 h-3" /> 登记问题
            </button>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">
          暂无问题件记录
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">严重度</th>
                <th className="text-left px-4 py-2 font-medium">类型</th>
                <th className="text-left px-4 py-2 font-medium">SKU/库位</th>
                <th className="text-left px-4 py-2 font-medium">描述</th>
                <th className="text-left px-4 py-2 font-medium">状态</th>
                <th className="text-left px-4 py-2 font-medium">处理人</th>
                <th className="text-right px-4 py-2 font-medium">创建时间</th>
                <th className="text-right px-4 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${severityColors[it.severity]}`}>
                      {severityCn[it.severity]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">{typeCn[it.issue_type] || it.issue_type}</td>
                  <td className="px-4 py-2">
                    <div className="font-mono text-xs text-slate-700">{it.sku}</div>
                    <div className="font-mono text-[10px] text-slate-400">{it.location}</div>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600 max-w-[200px] truncate">{it.description}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] ${statusColors[it.status]}`}>
                      {statusCn[it.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-600">{it.assigned_name || '—'}</td>
                  <td className="px-4 py-2 text-[11px] text-slate-400 text-right">
                    {new Date(it.created_at).toLocaleString('zh-CN', { hour12: false })}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      {it.status === 'open' && (
                        <button onClick={() => assignTo(it.id, '张三')}
                          className="px-2 py-0.5 text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200">
                          分派给张三
                        </button>
                      )}
                      {['open','assigned','processing'].includes(it.status) && (
                        <button onClick={() => updateStatus(it.id, 'resolved', it.description)}
                          className="px-2 py-0.5 text-[10px] bg-green-50 hover:bg-green-100 text-green-700 rounded border border-green-200">
                          标记解决
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新问题弹窗 */}
      {showNew && <NewIssueModal onClose={() => setShowNew(false)} warehouseId={warehouseId!} onDone={() => warehouseId && loadIssues(warehouseId)} />}
    </div>
  );
}

function NewIssueModal({ onClose, warehouseId, onDone }: { onClose: () => void; warehouseId: string; onDone: () => void }) {
  const [form, setForm] = useState({
    issue_type: 'wrong_qty', severity: 'medium',
    sku: '', location: '', description: '',
  });
  async function submit() {
    await supabase.from('tlv_issue_items').insert({
      warehouse_id: warehouseId,
      ...form, operator_name: 'wms@thalvior.dev',
    });
    onDone(); onClose();
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-96" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 mb-4">登记问题件</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="text-xs text-slate-500">类型</label>
            <select value={form.issue_type} onChange={e => setForm({...form, issue_type: e.target.value})}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg">
              <option value="wrong_qty">数量不符</option>
              <option value="damaged">破损</option>
              <option value="wrong_sku">SKU 错误</option>
              <option value="qc_failed">质检不合格</option>
              <option value="label_mismatch">标签不符</option>
              <option value="weight_mismatch">重量不符</option>
              <option value="packaging_failed">包装失败</option>
              <option value="missing">丢失</option>
              <option value="other">其他</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">严重度</label>
            <select value={form.severity} onChange={e => setForm({...form, severity: e.target.value})}
              className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg">
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
              <option value="critical">紧急</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500">SKU</label>
              <input value={form.sku} onChange={e => setForm({...form, sku: e.target.value})}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs text-slate-500">库位</label>
              <input value={form.location} onChange={e => setForm({...form, location: e.target.value})}
                className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg font-mono text-xs" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500">描述</label>
            <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})}
              rows={3} className="mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm">取消</button>
          <button onClick={submit} className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm">提交</button>
        </div>
      </div>
    </div>
  );
}
