import { Link } from '@tanstack/react-router';
import { Package, Warehouse, Truck, BarChart3, Users, ScanLine } from 'lucide-react';

export function WmsLandingPage() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      {/* 背景光晕 */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute top-0 -left-40 w-[500px] h-[500px] rounded-full bg-emerald-200/40 blur-3xl" />
        <div className="absolute top-40 right-0 w-[600px] h-[600px] rounded-full bg-cyan-200/30 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-teal-200/40 blur-3xl" />
      </div>

      {/* 顶部导航 */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-white/60 border-b border-white/30">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-400 via-teal-400 to-cyan-400 flex items-center justify-center text-white font-bold shadow-lg shadow-emerald-200/60">
              🏭
            </div>
            <span className="font-semibold text-lg">Thalvior WMS</span>
            <span className="text-xs text-ink-400 self-end mb-0.5">智能仓储管理</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link to="/login" className="px-4 py-2 text-sm font-medium text-ink-700 hover:text-ink-900 transition-colors">
              登录
            </Link>
            <Link to="/register" className="px-4 py-2 text-sm font-medium rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-200/50 hover:shadow-lg hover:shadow-emerald-300/60 transition-all">
              免费注册
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-12 text-center">
        <div className="inline-block mb-6 float-anim">
          <div className="w-28 h-28 rounded-3xl bg-gradient-to-br from-emerald-200 via-teal-100 to-cyan-200 flex items-center justify-center shadow-xl shadow-emerald-200/40">
            <Warehouse className="w-14 h-14 text-emerald-600" />
          </div>
        </div>
        <h1 className="text-5xl font-bold bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-700 bg-clip-text text-transparent mb-5">
          智能仓储 · 高效代打包
        </h1>
        <p className="text-lg text-ink-500 max-w-xl mx-auto mb-10">
          入库上架 · 智能拣货 · 称重打包 · 波次管理 · 自动面单 · 实时盘点
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link to="/login" className="px-6 py-3 text-base font-semibold rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-200/50 hover:shadow-xl transition-all">
            仓库登录
          </Link>
          <Link to="/register" className="px-6 py-3 text-base font-semibold rounded-xl bg-white/70 backdrop-blur border border-white shadow-sm hover:bg-white transition-all">
            免费注册仓库
          </Link>
        </div>
      </section>

      {/* 功能亮点 */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {features.map((f) => (
            <div key={f.title} className="glass p-6 hover:shadow-md transition-shadow">
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.grad} flex items-center justify-center mb-4`}>
                <f.icon className="w-6 h-6 text-white" />
              </div>
              <div className="font-semibold text-lg mb-1.5 text-ink-900">{f.title}</div>
              <div className="text-sm text-ink-500 leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-10 text-center text-xs text-ink-400">
        <div className="mb-2">© {new Date().getFullYear()} Thalvior WMS · 专业的跨境电商仓储管理系统</div>
      </footer>
    </div>
  );
}

const features = [
  { icon: Package, title: "智能入库", desc: "ASN 预约 · 扫码收货 · 质检上架 · 库位推荐", grad: "from-emerald-400 to-teal-500" },
  { icon: ScanLine, title: "波次拣货", desc: "订单自动分波 · 路径优化 · 扫码拣货确认 · 漏拣预警", grad: "from-cyan-400 to-sky-500" },
  { icon: Truck, title: "称重打包", desc: "自动计费 · 耗材管理 · 装箱建议 · 面单自动打印", grad: "from-violet-400 to-indigo-500" },
  { icon: BarChart3, title: "实时盘点", desc: "动态/静态盘点 · 差异分析 · 库存调整自动流水", grad: "from-amber-400 to-orange-500" },
  { icon: Users, title: "绩效统计", desc: "员工拣货量 · 打包效率 · 问题件处理 · 多维度报表", grad: "from-rose-400 to-pink-500" },
  { icon: Warehouse, title: "多仓管理", desc: "多仓独立核算 · 调拨管理 · 库存联动 · 统一结算", grad: "from-blue-400 to-cyan-500" },
];
