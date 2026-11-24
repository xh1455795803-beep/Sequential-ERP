import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Package, Search, Filter, ArrowRight, Clock, AlertTriangle } from 'lucide-react';

const STATUS_FLOW: Record<string, string[]> = {
  packing: ['received', 'opened', 'qc_passed', 'shelved', 'picked', 'packed', 'weighed', 'verified', 'shipped'],
  stocking: ['received', 'opened', 'qc_passed', 'qc_failed', 'shelved'],
};

export function WmsPackagePage() {
  const [loading, setLoading] = useState(true);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) { setLoading(false); return; }
      setWarehouseId(ctx.warehouseId);
      await loadPackages(ctx.warehouseId);
    })();
  }, []);

  async function loadPackages(wid: string) {
    const { data } = await supabase.from('tlv_packages')
      .select('*, tlv_merchants(business_name:merchant_id)')
      .eq('warehouse_id', wid).order('created_at', { ascending: false });
    setPackages(data || []);
    setLoading(false);
  }

  async function addSample(wid: string) {
    // 生成一些示例包裹（真实业务里包裹是入库签收时自动生成）
    const now = new Date().toISOString();
    const samples = [
      { warehouse_id: wid, merchant_id: '7e3bf09f-3937-4891-a6f6-75941f39d1b2',
        supplier: '1688-义乌供应商', weight: 2.3, status: 'received',
        location: '暂存区-A01', operator_name: 'wms@thalvior.dev',
        notes: '3 箱混装入库' },
      { warehouse_id: wid, merchant_id: 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5',
        supplier: '深圳华强北', weight: 1.1, status: 'packed',
        outbound_order_id: null, operator_name: 'wms@thalvior.dev',
        notes: '出库打包中' },
      { warehouse_id: wid, merchant_id: '7e3bf09f-3937-4891-a6f6-75941f39d1b2',
        supplier: '东莞工厂直供', weight: 5.8, status: 'shipped',
        tracking_no: 'SF1234567890123', outbound_order_id: null,
        operator_name: 'wms@thalvior.dev', notes: 'COD 件，已出库' },
    ];
    const { data } = await supabase.from('tlv_packages').insert(samples).select();
    if (data) await loadPackages(wid);
  }

  async function advanceStatus(pkg: any, newStatus: string) {
    if (!warehouseId) return;
    await supabase.from('tlv_packages').update({
      status: newStatus,
      updated_at: new Date().toISOString(),
      operator_name: 'wms@thalvior.dev',
    }).eq('id', pkg.id);

    // 写状态变更日志
    await supabase.from('tlv_package_logs').insert({
      package_id: pkg.id,
      from_status: pkg.status,
      to_status: newStatus,
      operator_name: 'wms@thalvior.dev',
      note: `manual advance`,
    });
    await loadPackages(warehouseId);
  }

  const filtered = packages.filter(p => {
    if (filterStatus !== 'all' && p.status !== filterStatus) return false;
    if (search && !JSON.stringify(p).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const statusCounts: Record<string, number> = {};
  packages.forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1; });

  const statusCn: Record<string, string> = {
    received: '已签收', opened: '已拆包', qc_passed: '质检通过', qc_failed: '质检失败',
    shelved: '已上架', picked: '已拣货', packed: '已打包', weighed: '已称重',
    verified: '已核验', shipped: '已出库', returned: '已退回', lost: '已丢失',
  };

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="flex items-center gap-3 justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold text-slate-700">包裹管理</h3>
            <span className="text-xs text-slate-400">独立包裹追踪，状态全链路可追溯</span>
          </div>
          <button onClick={() => warehouseId && addSample(warehouseId)}
            className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-600">
            + 生成示例包裹
          </button>
        </div>

        {/* 状态筛选 tabs */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button onClick={() => setFilterStatus('all')}
            className={`px-3 py-1 text-xs rounded-full ${filterStatus==='all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
            全部 ({packages.length})
          </button>
          {Object.entries(statusCounts).sort(([a],[b]) => (statusFlow.indexOf(a) - statusFlow.indexOf(b))).map(([s, n]) => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 text-xs rounded-full ${filterStatus===s ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {statusCn[s] || s} ({n})
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索 运单号/商家/供应商..."
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm" />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">
          暂无包裹记录
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((p) => (
            <div key={p.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-slate-400">{p.id.slice(0,8)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-sm font-medium text-slate-800 mt-1">
                    {p.supplier || '—'} · {p.weight}kg
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    库位: {p.location || '暂未分配'} · {p.merchant_id?.slice(0,8) || '—'}
                  </div>
                  {p.tracking_no && (
                    <div className="text-xs text-blue-600 mt-0.5">运单号: {p.tracking_no}</div>
                  )}
                  {p.notes && <div className="text-xs text-slate-400 mt-0.5 italic truncate">"{p.notes}"</div>}
                </div>
                <div className="text-[10px] text-slate-400 text-right">
                  {new Date(p.created_at).toLocaleString('zh-CN', { hour12: false })}
                </div>
              </div>

              {/* 状态推进按钮 */}
              <div className="mt-3 flex items-center gap-1.5 flex-wrap">
                {nextStatuses(p.status).map(ns => (
                  <button key={ns} onClick={() => advanceStatus(p, ns)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-700 rounded border border-blue-200">
                    <ArrowRight className="w-2.5 h-2.5" /> {statusCn[ns]}
                  </button>
                ))}
                {p.status !== 'lost' && p.status !== 'returned' && p.status !== 'shipped' && (
                  <button onClick={() => advanceStatus(p, 'lost')}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 text-red-600 rounded border border-red-200">
                    <AlertTriangle className="w-2.5 h-2.5" /> 丢失
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const statusFlow = STATUS_FLOW.packing;

function nextStatuses(current: string): string[] {
  const idx = statusFlow.indexOf(current);
  if (idx === -1 || idx >= statusFlow.length - 1) return [];
  return [statusFlow[idx + 1]];
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    received: 'bg-slate-100 text-slate-600',
    opened: 'bg-amber-100 text-amber-700',
    qc_passed: 'bg-green-100 text-green-700',
    qc_failed: 'bg-red-100 text-red-700',
    shelved: 'bg-blue-100 text-blue-700',
    picked: 'bg-indigo-100 text-indigo-700',
    packed: 'bg-purple-100 text-purple-700',
    weighed: 'bg-cyan-100 text-cyan-700',
    verified: 'bg-emerald-100 text-emerald-700',
    shipped: 'bg-emerald-100 text-emerald-700',
    lost: 'bg-red-100 text-red-700',
    returned: 'bg-orange-100 text-orange-700',
  };
  const cn: Record<string, string> = {
    received: '已签收', opened: '已拆包', qc_passed: '质检通过', qc_failed: '质检失败',
    shelved: '已上架', picked: '已拣货', packed: '已打包', weighed: '已称重',
    verified: '已核验', shipped: '已出库', lost: '已丢失', returned: '已退回',
  };
  return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${colors[status] || 'bg-slate-100 text-slate-600'}`}>{cn[status] || status}</span>;
}
