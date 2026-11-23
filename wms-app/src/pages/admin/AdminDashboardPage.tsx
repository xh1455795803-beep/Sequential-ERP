import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  Users, Building2, Package, CalendarDays, Wallet, TrendingUp,
  BarChart3, ArrowUpDown, AlertTriangle, CheckCircle, Clock, Server
} from 'lucide-react';

// Mock 数据 — 实际项目中从 supabase 查询
const STAT_CARDS = [
  { label: '入驻商家', value: 3, icon: Users, color: 'from-purple-500 to-purple-600' },
  { label: '活跃仓库', value: 2, icon: Building2, color: 'from-indigo-500 to-indigo-600' },
  { label: '今日订单', value: 4, icon: Package, color: 'from-pink-500 to-pink-600' },
  { label: '本月订单', value: 142, icon: CalendarDays, color: 'from-violet-500 to-violet-600' },
  { label: 'COD 代收', value: '¥25', icon: Wallet, color: 'from-emerald-500 to-emerald-600' },
  { label: '平台收入', value: '¥8.20', icon: TrendingUp, color: 'from-amber-500 to-amber-600' },
];

const WAREHOUSE_RANK = [
  { name: '深圳大鹏保税仓', code: 'SZX-DP', orders: 78, status: '活跃' },
  { name: '香港葵涌海外仓', code: 'HK-KCT', orders: 64, status: '活跃' },
  { name: '义乌综合保税仓', code: 'YW-ZS', orders: 22, status: '筹备' },
  { name: '上海外高桥仓', code: 'SHA-WGQ', orders: 15, status: '活跃' },
  { name: '德国汉堡仓', code: 'DE-HAM', orders: 9, status: '测试' },
];

const ALERTS = [
  { type: 'warning', title: '1 个商家入驻待审核', time: '5 分钟前', action: '前往审核', path: '/admin/merchants' },
  { type: 'error', title: '平台结算 API Token 已过期', time: '2 小时前', action: '重新生成', path: '/admin/billing-rules' },
];

async function fetchAdminDash() {
  // 预留：真实环境会从 merchant / warehouse / orders 表聚合
  await new Promise((r) => setTimeout(r, 300));
  return {
    merchantCount: 3, warehouseCount: 2, todayOrders: 4, monthOrders: 142,
    codAmount: 25.0, revenue: 8.20,
  };
}

export function AdminDashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-dash'], queryFn: fetchAdminDash, refetchInterval: 30000,
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">平台数据大屏</h2>
          <p className="text-sm text-slate-500 mt-1">Thalvior SaaS · 实时概览入驻、订单与收入</p>
        </div>
        <div className="text-xs text-slate-400">
          数据更新时间：{new Date().toLocaleString('zh-CN')}
        </div>
      </div>

      {/* 6 Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {STAT_CARDS.map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 hover:shadow-md transition">
            <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center mb-3 shadow-sm`}>
              <s.icon className="w-4 h-4 text-white" />
            </div>
            <div className="text-2xl font-bold text-slate-800 tabular-nums">
              {isLoading ? '-' : (s.value ?? 0)}
            </div>
            <div className="text-xs text-slate-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Middle row: Chart + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 商家入驻趋势 */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-5 h-5 text-purple-500" />
            <h3 className="font-semibold text-slate-800">商家入驻趋势</h3>
            <span className="ml-auto text-xs text-slate-400">近 12 个月</span>
          </div>
          <div className="h-[180px] bg-slate-100 rounded-lg flex items-center justify-center">
            {/* Placeholder bar chart */}
            <PlaceholderBarChart />
          </div>
        </div>

        {/* 仓库订单量排行 */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-4">
            <ArrowUpDown className="w-5 h-5 text-indigo-500" />
            <h3 className="font-semibold text-slate-800">仓库订单量排行</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-xs border-b border-slate-100">
              <tr>
                <th className="text-left py-2">仓库</th>
                <th className="text-right py-2">订单</th>
                <th className="text-right py-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {WAREHOUSE_RANK.map((w) => (
                <tr key={w.code} className="border-b border-slate-50 hover:bg-slate-50/50">
                  <td className="py-2.5">
                    <div className="font-medium text-slate-700">{w.name}</div>
                    <div className="text-[10px] text-slate-400 font-mono">{w.code}</div>
                  </td>
                  <td className="text-right py-2.5 font-semibold text-slate-800 tabular-nums">{w.orders}</td>
                  <td className="text-right py-2.5">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                      w.status === '活跃' ? 'bg-green-50 text-green-600' :
                      w.status === '筹备' ? 'bg-amber-50 text-amber-600' :
                      'bg-slate-100 text-slate-500'
                    }`}>{w.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 底部: 系统告警 */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold text-slate-800">系统告警</h3>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">
            {ALERTS.length} 条待处理
          </span>
        </div>
        <div className="space-y-2">
          {ALERTS.map((a, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${
              a.type === 'error' ? 'bg-red-50/50 border-red-100' : 'bg-amber-50/50 border-amber-100'
            }`}>
              {a.type === 'error' ? (
                <Server className="w-4 h-4 text-red-500 shrink-0" />
              ) : (
                <Clock className="w-4 h-4 text-amber-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-700">{a.title}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">{a.time}</div>
              </div>
              <button
                className="text-xs px-3 py-1 rounded-md bg-white shadow-sm border border-slate-200 hover:border-purple-400 hover:text-purple-600 transition"
                onClick={() => alert(`跳转至 ${a.path}`)}
              >
                {a.action}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 占位棒线图（纯 DOM） */
function PlaceholderBarChart() {
  // 12 个月模拟数据
  const data = [2, 3, 5, 4, 6, 8, 7, 9, 12, 10, 14, 16];
  const labels = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const max = Math.max(...data);

  return (
    <div className="w-full h-full flex items-end gap-2 px-2 pb-1">
      {data.map((v, i) => {
        const h = (v / max) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
            <div className="text-[9px] text-slate-400 group-hover:text-slate-700">{v}</div>
            <div className="w-full flex items-end" style={{ height: '140px' }}>
              <div
                className="w-full bg-gradient-to-t from-purple-500 to-indigo-400 rounded-t transition-all hover:opacity-80"
                style={{ height: `${Math.max(h, 5)}%` }}
                title={`${labels[i]}: ${v} 家`}
              />
            </div>
            <div className="text-[9px] text-slate-500">{labels[i]}</div>
          </div>
        );
      })}
    </div>
  );
}
