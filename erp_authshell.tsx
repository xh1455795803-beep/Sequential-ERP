import { type ReactNode } from "react";
import { useLanguage } from "@/i18n/LanguageContext";

// Thalvior 品牌标：品牌蓝圆角方块 + 字母 T + 白色浪弧（全站唯一标识）
export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{ display: "block", borderRadius: size * 0.28 }}
    >
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M10 10.5h12v3.2h-4.3V21.5h-3.4V13.7H10z" fill="var(--brand-ink)" />
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

/**
 * 认证页外壳（2026-10 规范化）：桌面端左右分屏——
 * 左侧规范底色宣传面板（同心细线 + 航线，纯 SVG 零图片请求，中性灰线条），
 * 右侧白色表单区。移动端单列：顶部品牌头 + 表单卡片。
 */
export function AuthShell({
  children,
  panelTitle,
  panelDesc,
}: {
  children: ReactNode;
  panelTitle: string;
  panelDesc: string;
}) {
  const { t } = useLanguage();

  return (
    <div className="grid min-h-dvh bg-card lg:grid-cols-[1.05fr_1fr]">
      {/* 左：产品宣传（仅桌面）——规范底色面板 */}
      <aside
        className="relative hidden flex-col overflow-hidden p-12 xl:p-16 lg:flex"
        style={{
          // A 静白极简：白→极浅灰微渐变，无光晕无彩色
          background: "linear-gradient(180deg, var(--surface-raised) 0%, var(--surface) 100%)",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* 同心细线（右下，中性灰） */}
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
        {/* 航线虚线（左下到中部） */}
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

        {/* 顶部品牌 */}
        <a href="/" className="relative flex items-center gap-3">
          <BrandMark size={38} />
          <div className="leading-tight">
            <div className="font-display text-xl font-semibold text-fg">Thalvior</div>
            <div className="text-[11px] tracking-[0.22em] text-fg-muted">{t("nav.logo.subtitle")}</div>
          </div>
        </a>

        {/* 产品宣传核心文案 */}
        <div className="relative mb-auto mt-20">
          <div className="mb-4 h-[3px] w-11 rounded-full" style={{ background: "var(--brand)" }} />
          <h2 className="max-w-xl font-display text-4xl font-bold leading-[1.18] tracking-tight text-fg xl:text-5xl">
            {panelTitle}
          </h2>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-fg-muted">{panelDesc}</p>
        </div>
      </aside>

      {/* 右：登录注册卡片（纯白，自居中） */}
      <main className="relative grid place-items-center bg-card px-4 py-10 sm:px-6">
        <div className="relative w-full max-w-md">
          {/* 移动端品牌头 */}
          <div className="mb-8 text-center lg:hidden">
            <a href="/" className="mx-auto mb-3 flex w-fit items-center gap-2.5">
              <BrandMark size={36} />
              <span className="font-display text-lg font-semibold text-fg">Thalvior</span>
            </a>
            <p className="text-xs text-fg-muted">{t("nav.logo.subtitle")}</p>
          </div>
          <div className="rise-in">{children}</div>
        </div>
      </main>
    </div>
  );
}
