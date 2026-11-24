import { useEffect, useState } from 'react';
import { supabase, getAuthContext } from '../../lib/supabase';
import { TrendingUp, Package, Box, Scale, Truck, AlertTriangle, DollarSign, Calendar, Users } from 'lucide-react';

const ROLE_ICON: Record<string, any> = {
  picker: Package, packer: Box, inspector: AlertTriangle, shipper: Truck, manager: TrendingUp,
};
const ROLE_LABEL: Record<string, string> = {
  picker: '拣货', packer: '打包', inspector: '质检', shipper: '发货', manager: '管理',
};

export function WmsPerformancePage() {
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const ctx = await getAuthContext();
      if (!ctx.warehouseId) { setLoading(false); return; }
      setWarehouseId(ctx.warehouseId);
      await load(ctx.warehouseId, range);
    })();
  }, [range]);

  async function load(wid: string, days: number) {
    const start = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const end = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc('tlv_calc_employee_performance', {
      p_warehouse_id: wid, p_start_date: start, p_end_date: end,
    });
    if (error) console.error(error);
    setRows(data || []);
    setLoading(false);
  }

  if (loading) return <div className="p-12 text-center text-slate-400">加载中...</div>;
  if (!warehouseId) return <div>未绑定仓库</div>;

  const totals = {
    total_employees: rows.length,
    total_ops: rows.reduce((s, r) => s + (Number(r.total_ops) || 0), 0),
    total_revenue: rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0),
    avg_ops: rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (Number(r.total_ops) || 0), 0) / rows.length) : 0,
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-700 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" /> 员工绩效报表
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">基于出库操作日志自动统计</p>
        </div>
        <div className="flex gap-2">
          {([7, 30, 90] as const).map((d) => (
            <button key={d} onClick={() => setRange(d)}
              className={`px-3 py-1.5 text-xs rounded-full border ${range === d ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-400'}`}>
              最近 {d} 天
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label="员工总数" value={totals.total_employees} />
        <StatCard icon={Package} label="总操作数" value={totals.total_ops} />
        <StatCard icon={TrendingUp} label="人均操作" value={totals.avg_ops} />
        <StatCard icon={DollarSign} label="累计营收" value={`¥${totals.total_revenue.toFixed(2)}`} />
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-100 p-12 text-center text-slate-400 text-sm">
          该时间段内暂无绩效数据（请先在「员工管理」录入员工）
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-5 py-3 font-medium">员工</th>
                <th className="text-center px-5 py-3 font-medium">角色</th>
                <th className="text-center px-5 py-3 font-medium">总操作</th>
                <th className="text-center px-5 py-3 font-medium">拣货</th>
                <th className="text-center px-5 py-3 font-medium">打包</th>
                <th className="text-center px-5 py-3 font-medium">称重</th>
                <th className="text-center px-5 py-3 font-medium">发货</th>
                <th className="text-center px-5 py-3 font-medium">问题件</th>
                <th className="text-right px-5 py-3 font-medium">创造营收</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r: any, idx: number) => {
                const Icon = ROLE_ICON[r.role] || Package;
                return (
                  <tr key={r.employee_id} className="hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium text-slate-800">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold mr-2">{idx + 1}</span>
                      {r.employee_name}
                    </td>
                    <td className="px-5 py-3 text-center text-xs text-slate-500">
                      <Icon className="w-4 h-4 inline mr-1" />{ROLE_LABEL[r.role] || r.role}
                    </td>
                    <td className="px-5 py-3 text-center font-semibold text-blue-700 tabular-nums">{r.total_ops || 0}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-slate-600">{r.picked || 0}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-slate-600">{r.packed || 0}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-slate-600">{r.weighed || 0}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-slate-600">{r.shipped || 0}</td>
                    <td className="px-5 py-3 text-center tabular-nums text-amber-600">{r.problem_count || 0}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-green-700 font-medium">¥{(Number(r.revenue) || 0).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: any) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Icon className="w-4 h-4 text-blue-600" /> {label}
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums text-slate-800">{value}</div>
    </div>
  );
}


