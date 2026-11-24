import { Outlet, useLocation, Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { MerchantLayout } from './MerchantLayout';
import { WmsLayout } from './WmsLayout';
import { AdminLayout } from './AdminLayout';
import { UnifiedLoginPage } from '../pages/UnifiedLoginPage';

export function RootLayout() {
  const location = useLocation();
  const pathname = location.pathname;

  // 根路径 → 直接显示登录页（不跳转，不 landing）
  if (pathname === '/') return <UnifiedLoginPage />;

  // 统一登录/注册页 → 全屏
  if (pathname === '/login' || pathname.startsWith('/merchant/register')) {
    return <Outlet />;
  }
  // 三个 Portal
  if (pathname.startsWith('/merchant')) return <MerchantLayout />;
  if (pathname.startsWith('/wms')) return <WmsLayout />;
  if (pathname.startsWith('/admin')) return <AdminLayout />;
  return <Outlet />;
}

function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const portals = [
    { href: '/merchant/login', emoji: '🛍️', label: '商家工作台', sub: 'Seller Portal',
      grad: 'from-sky-100 to-cyan-50', ring: 'ring-sky-200', text: 'text-sky-700',
      desc: '订单管理 · 钱包充值 · 面单下载 · 利润分析' },
    { href: '/wms/login', emoji: '🏭', label: '仓库后台', sub: 'WMS Portal',
      grad: 'from-mint-100 to-emerald-50', ring: 'ring-mint-200', text: 'text-emerald-700',
      desc: '入库拣货 · 称重打包 · 物流轨迹 · 盘点管理' },
    { href: '/admin/login', emoji: '⚙️', label: '平台管理', sub: 'Platform Admin',
      grad: 'from-lilac-100 to-violet-50', ring: 'ring-lilac-200', text: 'text-violet-700',
      desc: '商家管理 · 计费规则 · 结算系统 · SaaS 运营' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* 背景光晕 */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute top-0 -left-40 w-[500px] h-[500px] rounded-full bg-sky-200/40 blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-0 w-[600px] h-[600px] rounded-full bg-violet-200/30 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-[500px] h-[500px] rounded-full bg-mint-200/40 blur-3xl pointer-events-none" />
      </div>

      {/* 顶部导航 */}
      <nav className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'glass border-b border-white/30' : ''}`}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 via-cyan-400 to-mint-400 flex items-center justify-center text-white font-bold shadow-lg shadow-sky-200/60">
              📦
            </div>
            <span className="font-semibold text-ink-800 text-lg">Thalvior</span>
            <span className="text-xs text-ink-400 ml-1 self-end mb-0.5">跨境代打包</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link to="/login" className="px-4 py-2 text-sm font-medium text-ink-700 hover:text-ink-900 transition-colors">
              登录
            </Link>
            <Link to="/merchant/register" className="px-4 py-2 text-sm font-medium rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-md shadow-sky-200/50 hover:shadow-lg hover:shadow-sky-300/60 transition-all">
              免费注册
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-16 pb-12 text-center">
        <div className="inline-block mb-5 float-anim">
          <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-sky-200 via-cyan-100 to-mint-200 flex items-center justify-center text-5xl shadow-xl shadow-sky-200/40">
            🚀
          </div>
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold bg-gradient-to-br from-sky-700 via-indigo-700 to-emerald-700 bg-clip-text text-transparent mb-4">
          把中国货卖向全球
        </h1>
        <p className="text-lg text-ink-500 max-w-xl mx-auto mb-10">
          一站式跨境电商代打包 SaaS · 订单自动同步 · 仓库智能拣货 · 面单自动生成 · 资金实时结算
        </p>

        {/* Portal 入口卡 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {portals.map(p => (
            <Link key={p.href} to={p.href}
              className={`glass glass-hover p-6 flex flex-col items-start text-left transition-all ring-1 ${p.ring}`}>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${p.grad} flex items-center justify-center text-2xl mb-4`}>
                {p.emoji}
              </div>
              <div className={`font-semibold text-lg ${p.text}`}>{p.label}</div>
              <div className="text-xs text-ink-400 mb-2">{p.sub}</div>
              <div className="text-xs text-ink-500 leading-relaxed">{p.desc}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* 功能亮点 */}
      <section className="max-w-6xl mx-auto px-6 py-12">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
          {[
            { n: '5+', l: '跨境平台对接', s: 'TikTok · Shopee · Lazada · Ozon · Mercado' },
            { n: '自动', l: '订单同步', s: '平台下单即刻入库，无需手动录入' },
            { n: '智能', l: '面单生成', s: '主流物流商自动匹配 · 条码/RFID' },
            { n: '实时', l: '资金结算', s: '钱包充值 · 自动扣费 · 月结发票' },
          ].map((f, i) => (
            <div key={i} className="glass p-5">
              <div className="text-2xl font-bold text-sky-600 mb-1">{f.n}</div>
              <div className="font-medium text-ink-800 text-sm">{f.l}</div>
              <div className="text-xs text-ink-400 mt-1 leading-relaxed">{f.s}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-10 text-center text-xs text-ink-400">
        <div className="mb-2">Thalvior · 专业的跨境代打包服务平台</div>
        <div className="flex items-center justify-center gap-4">
          <Link to="/privacy" className="hover:text-ink-600">隐私政策</Link>
          <span>·</span>
          <Link to="/terms" className="hover:text-ink-600">用户协议</Link>
        </div>
      </footer>
    </div>
  );
}
