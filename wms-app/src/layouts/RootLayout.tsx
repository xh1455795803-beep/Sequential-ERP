import { Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { MerchantLayout } from './MerchantLayout';
import { WmsLayout } from './WmsLayout';
import { AdminLayout } from './AdminLayout';

/**
 * RootLayout — 路径感知分发器
 * 根据 window.location.pathname 判断当前属于哪个 portal，
 * 渲染对应的 Layout + <Outlet />
 */
export function RootLayout() {
  const pathname = window.location.pathname;

  // Index redirect
  const navigate = useNavigate();
  useEffect(() => {
    if (pathname === '/' || pathname === '') {
      navigate({ to: '/merchant/login' });
    }
  }, [pathname, navigate]);

  if (pathname.startsWith('/merchant')) {
    return <MerchantLayout />;
  }
  if (pathname.startsWith('/wms')) {
    return <WmsLayout />;
  }
  if (pathname.startsWith('/admin')) {
    return <AdminLayout />;
  }

  // Fallback landing
  return <LandingPage />;
}

function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center text-white">
      <div className="text-center max-w-2xl px-6">
        <div className="text-6xl mb-4">📦</div>
        <h1 className="text-4xl font-bold mb-2">Thalvior 跨境代打包 SaaS</h1>
        <p className="text-slate-400 mb-10">专业的跨境电商订单代打包管理系统</p>
        <div className="grid grid-cols-3 gap-4">
          <a href="/merchant/login" className="bg-blue-500 hover:bg-blue-600 rounded-xl p-6 transition">
            <div className="text-2xl mb-2">🛍️</div>
            <div className="font-semibold">商家端</div>
            <div className="text-xs text-blue-200 mt-1">Seller Portal</div>
          </a>
          <a href="/wms/login" className="bg-emerald-500 hover:bg-emerald-600 rounded-xl p-6 transition">
            <div className="text-2xl mb-2">🏭</div>
            <div className="font-semibold">仓库端</div>
            <div className="text-xs text-emerald-200 mt-1">WMS Portal</div>
          </a>
          <a href="/admin/login" className="bg-purple-500 hover:bg-purple-600 rounded-xl p-6 transition">
            <div className="text-2xl mb-2">⚙️</div>
            <div className="font-semibold">平台管理</div>
            <div className="text-xs text-purple-200 mt-1">Platform Admin</div>
          </a>
        </div>
      </div>
    </div>
  );
}
