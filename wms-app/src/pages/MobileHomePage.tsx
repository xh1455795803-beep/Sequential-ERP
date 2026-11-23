import { useNavigate } from '@tanstack/react-router';
import {
  Package, Download, Barcode, ClipboardList, RotateCcw, ArrowRightLeft,
  TrendingUp, PackageCheck, Truck, AlertCircle,
} from 'lucide-react';

// ============================================================
// 移动工作台首页 — 快捷按钮 Grid + 今日数据
// ============================================================

const SHORTCUTS = [
  { path: '/wave-tasks', label: '波次拣货', icon: Package, color: 'from-blue-500 to-blue-600', badge: '8' },
  { path: '/asns/receive', label: '扫码上架', icon: Download, color: 'from-emerald-500 to-emerald-600' },
  { path: '/asns/receive', label: '收货扫码', icon: Barcode, color: 'from-violet-500 to-violet-600' },
  { path: '/stocktaking', label: '盘点', icon: ClipboardList, color: 'from-amber-500 to-amber-600', badge: '3' },
  { path: '/returns', label: '退件处理', icon: RotateCcw, color: 'from-rose-500 to-rose-600' },
  { path: '/move', label: '移库', icon: ArrowRightLeft, color: 'from-cyan-500 to-cyan-600' },
];

const TODAY_STATS = [
  { label: '今日拣货', value: '156', unit: '件', icon: PackageCheck, color: 'text-blue-600', bg: 'bg-blue-50' },
  { label: '今日上架', value: '42', unit: '件', icon: Download, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  { label: '待发货', value: '12', unit: '单', icon: Truck, color: 'text-amber-600', bg: 'bg-amber-50' },
  { label: '异常', value: '3', unit: '单', icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-50' },
];

export function MobileHomePage() {
  const navigate = useNavigate();

  return (
    <div className="p-4 space-y-4">
      {/* 欢迎区 */}
      <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl p-4 text-white shadow-sm">
        <div className="text-sm opacity-80">早上好, 作业员 👋</div>
        <div className="text-lg font-semibold mt-1">今日工作 8 项任务</div>
        <div className="flex items-center gap-2 mt-2 text-xs opacity-90">
          <TrendingUp className="w-3 h-3" />
          进度 62% · 效率良好
        </div>
      </div>

      {/* 今日数据 */}
      <div className="grid grid-cols-2 gap-2">
        {TODAY_STATS.map((s) => (
          <div key={s.label} className={`${s.bg} rounded-lg p-3`}>
            <div className={`${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
            <div className="flex items-baseline gap-0.5 mt-1">
              <span className="text-xl font-bold text-gray-800">{s.value}</span>
              <span className="text-[10px] text-gray-500">{s.unit}</span>
            </div>
            <div className="text-[11px] text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>

      {/* 快捷操作 Grid */}
      <div>
        <div className="text-sm font-medium text-gray-600 mb-2">快捷操作</div>
        <div className="grid grid-cols-3 gap-3">
          {SHORTCUTS.map((sc) => (
            <button
              key={sc.path + sc.label}
              onClick={() => navigate({ to: sc.path })}
              className="flex flex-col items-center gap-1.5 group"
            >
              <div
                className={`relative w-14 h-14 rounded-xl bg-gradient-to-br ${sc.color} flex items-center justify-center shadow-sm group-active:scale-95 transition-transform`}
              >
                <sc.icon className="w-6 h-6 text-white" />
                {sc.badge && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-white text-rose-600 text-[10px] font-bold flex items-center justify-center shadow">
                    {sc.badge}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-gray-600">{sc.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 待办任务列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
          <span className="text-sm font-medium text-gray-700">待办任务</span>
          <button
            onClick={() => navigate({ to: '/wave-tasks' })}
            className="text-xs text-blue-600"
          >
            查看全部 →
          </button>
        </div>
        <div className="divide-y divide-gray-50">
          {[
            { title: '波次拣货 W-20241123-001', sub: '12 件 · 库位 A-01~B-03', tag: '拣货中' },
            { title: '上架 ASN-08892 批次 3', sub: 'SKU × 5 · 数量 84', tag: '待上架' },
            { title: '盘点 仓位 C-02 区域', sub: '抽盘 · 20 SKU', tag: '盘点中' },
          ].map((task, i) => (
            <button
              key={i}
              className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3"
            >
              <div className="w-1 h-10 rounded-full bg-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{task.title}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{task.sub}</div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 shrink-0">
                {task.tag}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
