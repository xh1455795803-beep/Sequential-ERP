import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Home, Package, Download, ClipboardList, User,
  Barcode, Box, RotateCcw, ArrowRightLeft, LogOut, QrCode,
} from 'lucide-react';

// ============================================================
// WMS v5 Mobile 布局 — 底部 5 Tab + 顶栏 + Outlet
// ============================================================

type TabItem = {
  path: string;
  label: string;
  icon: any;
};

const BOTTOM_TABS: TabItem[] = [
  { path: '/', label: '工作台', icon: Home },
  { path: '/wave-tasks', label: '拣货', icon: Package },
  { path: '/asns/receive', label: '上架', icon: Download },
  { path: '/stocktaking', label: '盘点', icon: ClipboardList },
  { path: '/my-stats', label: '我的', icon: User },
];

export function MobileLayout() {
  const navigate = useNavigate();
  const currentPath = window.location.pathname;

  // /wms/m 下的相对路径
  const relPath = currentPath.replace(/^\/wms\/m/, '') || '/';

  function handleTabClick(path: string) {
    navigate({ to: path === '/' ? '/' : path });
  }

  function isActive(path: string): boolean {
    if (path === '/') return relPath === '/' || relPath === '';
    return relPath.startsWith(path);
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50 max-w-md mx-auto border-x border-gray-200">
      {/* ===== 移动端顶栏 ===== */}
      <header className="h-12 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex items-center px-3 shrink-0">
        <QrCode className="w-5 h-5 text-emerald-400 shrink-0" />
        <div className="ml-2 flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">WMS 作业员</div>
          <div className="text-[10px] text-white/50">移动作业台</div>
        </div>
        <button
          onClick={() => window.open('/wms/', '_blank')}
          className="text-[10px] px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-colors flex items-center gap-1"
          title="切换到 PC 端"
        >
          <LogOut className="w-3 h-3" />
          PC端
        </button>
      </header>

      {/* ===== 页面内容 ===== */}
      <main className="flex-1 overflow-y-auto pb-16">
        <Outlet />
      </main>

      {/* ===== 底部 Tab 栏 ===== */}
      <nav className="h-14 bg-white border-t border-gray-200 flex items-center justify-around shrink-0 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        {BOTTOM_TABS.map((tab) => {
          const active = isActive(tab.path);
          return (
            <button
              key={tab.path}
              onClick={() => handleTabClick(tab.path)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 transition-colors
                ${active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <tab.icon className={`w-5 h-5 ${active ? 'scale-110' : ''} transition-transform`} />
              <span className="text-[10px] font-medium">{tab.label}</span>
              {active && <span className="w-1 h-1 rounded-full bg-blue-600 mt-0.5" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

export const Route = createFileRoute('/wms/m/_layout')({ component: MobileLayout });

// ============================================================
// MobileHomePage — 工作台首页（快捷按钮 grid）
// ============================================================

const SHORTCUT_GRIDS = [
  { path: '/wave-tasks', label: '波次拣货', icon: Package, color: 'from-blue-500 to-blue-600' },
  { path: '/asns/receive', label: '扫码上架', icon: Download, color: 'from-emerald-500 to-emerald-600' },
  { path: '/asns/receive', label: '收货扫码', icon: Barcode, color: 'from-violet-500 to-violet-600' },
  { path: '/stocktaking', label: '盘点', icon: ClipboardList, color: 'from-amber-500 to-amber-600' },
  { path: '/returns', label: '退件处理', icon: RotateCcw, color: 'from-rose-500 to-rose-600' },
  { path: '/move', label: '移库', icon: ArrowRightLeft, color: 'from-cyan-500 to-cyan-600' },
];

// 注意：MobileHomePage 本身作为路由组件，从 pages/ 导入
// 这里只定义布局（已由 pages/MobileHomePage.tsx 提供页面内容）
