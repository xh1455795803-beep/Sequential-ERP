/**
 * meoo Auth Shell —— 登录/注册页两侧布局
 * 源码反推自 meoo production auth-shell-kZCZaQH-.js
 *
 * 左侧: 装饰区(渐变背景 + 同心圆 SVG + 曲线 + Thalvior logo + 大标题)
 * 右侧: 表单区
 * lg 断点以上显示两侧，以下隐藏左侧只显示右侧
 */
import { LucideWarehouse } from 'lucide-react';

/** meoo 风格品牌 Logo SVG */
function BrandLogo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{ display: 'block', borderRadius: size * 0.28 }}
    >
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      {/* W 字母 — Thalvior T */}
      <path
        d="M10 10.5h12v3.2h-4.3V21.5h-3.4V13.7H10z"
        fill="var(--brand-ink)"
      />
      {/* 底座波浪 */}
      <path
        d="M8.5 24.5q4-2.8 7.5 0t7.5 0"
        stroke="var(--brand-ink)"
        strokeOpacity="0.55"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.95"
      />
    </svg>
  );
}

interface AuthShellProps {
  children: React.ReactNode;
  panelTitle: string;
  panelDesc?: string;
  brandSubtitle?: string;
}

export function AuthShell({ children, panelTitle, panelDesc, brandSubtitle = 'WMS · 仓库管理系统' }: AuthShellProps) {
  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[1.05fr_1fr]">
      {/* ============ 左侧装饰区（lg+ 显示） ============ */}
      <aside
        className="relative hidden flex-col overflow-hidden p-12 xl:p-16 lg:flex"
        style={{
          background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface) 100%)',
          borderRight: '1px solid var(--border)',
        }}
      >
        {/* 背景装饰 SVG —— 同心圆 + 虚线 */}
        <svg
          className="pointer-events-none absolute"
          style={{ right: -90, bottom: -70, width: 380, height: 380, opacity: 0.55 }}
          viewBox="0 0 380 380"
          fill="none"
          aria-hidden
        >
          <circle cx="260" cy="300" r="70" stroke="var(--border)" strokeWidth="1" />
          <circle cx="260" cy="300" r="118" stroke="var(--border)" strokeWidth="1" strokeOpacity="0.7" />
          <circle cx="260" cy="300" r="166" stroke="var(--border)" strokeWidth="1" strokeOpacity="0.4" />
          <circle cx="260" cy="300" r="214" stroke="var(--border)" strokeWidth="1" strokeOpacity="0.2" strokeDasharray="2 7" />
        </svg>

        {/* 底部曲线 + 散点装饰 */}
        <svg
          className="pointer-events-none absolute"
          style={{ left: 0, bottom: 64, width: 420, height: 130, opacity: 0.5 }}
          viewBox="0 0 420 130"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden
        >
          <path
            d="M-10,118 Q150,30 300,66 T430,30"
            stroke="var(--border-strong)"
            strokeWidth="1.2"
            strokeDasharray="4 8"
            strokeLinecap="round"
          />
          <circle cx="74" cy="88" r="3" fill="var(--text-subtle)" fillOpacity="0.35" />
          <circle cx="210" cy="62" r="2.4" fill="var(--text-subtle)" fillOpacity="0.45" />
        </svg>

        {/* Logo + 品牌名 */}
        <a href="/" className="relative flex items-center gap-3">
          <BrandLogo size={38} />
          <div className="leading-tight">
            <div className="font-display text-xl font-semibold text-fg">Thalvior</div>
            <div className="text-[11px] tracking-[0.22em] text-fg-muted">{brandSubtitle}</div>
          </div>
        </a>

        {/* 标题区 */}
        <div className="relative mb-auto mt-20">
          <div className="mb-4 h-[3px] w-11 rounded-full" style={{ background: 'var(--brand)' }} />
          <h2 className="max-w-xl font-display text-4xl xl:text-5xl font-bold leading-[1.18] tracking-tight text-fg">
            {panelTitle}
          </h2>
          {panelDesc && (
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-fg-muted">{panelDesc}</p>
          )}
        </div>
      </aside>

      {/* ============ 右侧表单区 ============ */}
      <main className="relative grid place-items-center bg-card px-4 py-10 sm:px-6">
        <div className="relative w-full max-w-md">
          {/* 移动端显示品牌 */}
          <div className="mb-8 text-center lg:hidden">
            <a href="/" className="mx-auto mb-3 flex w-fit items-center gap-2.5">
              <BrandLogo size={36} />
              <span className="font-display text-lg font-semibold text-fg">Thalvior</span>
            </a>
            <p className="text-xs text-fg-muted">{brandSubtitle}</p>
          </div>

          {/* rise-in 动画容器 */}
          <div className="rise-in">{children}</div>
        </div>
      </main>
    </div>
  );
}

/** Auth Shell 专属 rise-in 动画 */
export function injectAuthShellStyles() {
  const css = `
    .rise-in { animation: riseIn 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
    @keyframes riseIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
  `;
  const id = 'auth-shell-styles';
  if (!document.getElementById(id)) {
    const el = document.createElement('style');
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
  }
}
