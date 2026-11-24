import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { Package, Search, Clock } from 'lucide-react';

export function MerchantPackagePage() {
  const [loading, setLoading] = useState(true);
  const [merchantId, setMerchantId] = useState<string | null>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.merchantId) { setLoading(false); return; }
      setMerchantId(ctx.merchantId);
      await loadPackages(ctx.merchantId);
    })();
  }, []);

  async function loadPackages(mid: string) {
    const { data } = await supabase.from('tlv_packages')
      .select('*').eq('merchant_id', mid).order('created_at', { ascending: false });
    setPackages(data || []);
    setLoading(false);
  }

  const filtered = packages.filter(p => {
    if (search && !JSON.stringify(p).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const statusCn: Record<string, string> = {
    received: '已签收', opened: '已拆包', qc_passed: '质检通过', qc_failed: '质检失败',
    shelved: '已上架', picked: '已拣货', packed: '已打包', weighed: '已称重',
    verified: '已核验', shipped: '已出库', returned: '已退回', lost: '已丢失',
  };

  const statusColors: Record<string, string> = {
    received: 'bg-slate-100 text-slate-600', opened: 'bg-amber-100 text-amber-700',
    qc_passed: 'bg-green-100 text-green-700', qc_failed: 'bg-red-100 text-red-700',
    shelved: 'bg-blue-100 text-blue-700', picked: 'bg-indigo-100 text-indigo-700',
    packed: 'bg-purple-100 text-purple-700', weighed: 'bg-cyan-100 text-cyan-700',
    verified: 'bg-emerald-100 text-emerald-700', shipped: 'bg-green-100 text-green-700',
    lost: 'bg-red-100 text-red-700', returned: 'bg-orange-100 text-orange-700',
  };

  const shippedCount = packages.filter(p => p.status === 'shipped').length;
  const inWarehouse = packages.filter(p => !['shipped','returned','lost'].includes(p.status)).length;

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;

  return (
    <div className="space-y-4">
      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="全部包裹" value={packages.length} color="slate" />
        <StatCard label="仓内处理中" value={inWarehouse} color="blue" />
        <StatCard label="已出库" value={shippedCount} color="green" />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
        <div className="flex items-center gap-3 justify-between mb-3">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-600" />
            <h3 className="font-semibold text-slate-700">我的包裹</h3>
            <span className="text-xs text-slate-400">包裹在仓状态全链路可查</span>
          </div>
        </div>
        <div className="relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="搜索 供应商/运单号/库位..."
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">
          暂无包裹记录
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2 font-medium">供应商</th>
                <th className="text-left px-4 py-2 font-medium">重量</th>
                <th className="text-left px-4 py-2 font-medium">当前状态</th>
                <th className="text-left px-4 py-2 font-medium">库位</th>
                <th className="text-left px-4 py-2 font-medium">运单号</th>
                <th className="text-right px-4 py-2 font-medium">入库时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{p.supplier || '—'}</td>
                  <td className="px-4 py-2.5 tabular-nums">{p.weight} kg</td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${statusColors[p.status]}`}>
                      {statusCn[p.status] || p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{p.location || '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-blue-600">{p.tracking_no || '—'}</td>
                  <td className="px-4 py-2.5 text-[11px] text-slate-400 text-right">
                    {new Date(p.created_at).toLocaleString('zh-CN', { hour12: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: any) {
  const colors: Record<string, string> = {
    slate: 'from-slate-50 to-slate-100 text-slate-700',
    blue: 'from-blue-50 to-blue-100 text-blue-700',
    green: 'from-green-50 to-green-100 text-green-700',
  };
  return (
    <div className={`p-4 rounded-xl bg-gradient-to-br ${colors[color]} border border-white/60`}>
      <div className="text-[11px] opacity-75">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
    </div>
  );
}
