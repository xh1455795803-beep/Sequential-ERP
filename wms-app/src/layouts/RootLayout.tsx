import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { MerchantLayout } from './MerchantLayout';
import { WmsLayout } from './WmsLayout';
import { AdminLayout } from './AdminLayout';

export function RootLayout() {
  const location = useLocation();
  const pathname = location.pathname;
  const navigate = useNavigate();

  useEffect(() => {
    if (pathname === '/' || pathname === '') {
      navigate({ to: '/merchant/login' });
    }
  }, [pathname, navigate]);

  if (!pathname.startsWith('/merchant') && !pathname.startsWith('/wms') && !pathname.startsWith('/admin')) {
    return <LandingPage />;
  }
  if (pathname.startsWith('/merchant')) return <MerchantLayout />;
  if (pathname.startsWith('/wms')) return <WmsLayout />;
  if (pathname.startsWith('/admin')) return <AdminLayout />;
  return <LandingPage />;
}

function LandingPage() {
  const portals = [
    { href: '/merchant/login', emoji: '🛍️', label: '商家端', sub: 'Seller Portal',
      grad: 'from-sky-100 to-cyan-50', ring: 'ring-sky-200', text: 'text-sky-700' },
    { href: '/wms/login', emoji: '🏭', label: '仓库端', sub: 'WMS Portal',
      grad: 'from-mint-100 to-emerald-50', ring: 'ring-mint-200', text: 'text-emerald-700' },
    { href: '/admin/login', emoji: '⚙️', label: '平台管理', sub: 'Platform Admin',
      grad: 'from-lilac-100 to-violet-50', ring: 'ring-lilac-200', text: 'text-violet-700' },
  ];
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-center max-w-2xl">
        <div className="inline-block mb-4 float-anim">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-sky-200 via-cyan-100 to-mint-200 flex items-center justify-center text-4xl shadow-lg shadow-sky-200/40">
            📦
          </div>
        </div>
        <h1 className="text-4xl font-bold bg-gradient-to-br from-sky-700 via-slate-700 to-emerald-700 bg-clip-text text-transparent mb-2">
          Thalvior 跨境代打包 SaaS
        </h1>
        <p className="text-ink-500 mb-10">专业的跨境电商订单代打包管理系统</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {portals.map(p => (
            <a key={p.href} href={p.href}
              className={`glass glass-hover p-6 flex flex-col items-center transition-all ring-1 ${p.ring}`}>
              <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${p.grad} flex items-center justify-center text-2xl mb-3`}>
                {p.emoji}
              </div>
              <div className={`font-semibold ${p.text}`}>{p.label}</div>
              <div className="text-xs text-ink-500 mt-1">{p.sub}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
