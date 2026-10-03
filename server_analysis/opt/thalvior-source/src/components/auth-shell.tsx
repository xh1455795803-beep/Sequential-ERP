import { Link } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";
import { useLanguage } from "@/i18n/LanguageContext";

// Thalvior 品牌标：清新海盐蓝渐变圆角 + 字母 T + 波浪（跨境海洋意象）
export function BrandMark({ size = 36 }: { size?: number }) {
  const uid = useId();
  const gid = `tv-brand-grad-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#38BDF8" />
          <stop offset="1" stopColor="#6366F1" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gid})`} />
      <path d="M10 10.5h12v3.2h-4.3V21.5h-3.4V13.7H10z" fill="white" />
      <path
        d="M8.5 24.5q4-2.8 7.5 0t7.5 0"
        stroke="white"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.85"
      />
    </svg>
  );
}

/**
 * 认证页外壳：桌面端左右分屏——
 * 左侧产品宣传（品牌 + 标题 + 一句话描述），右侧登录注册卡片。
 * 移动端单列：顶部品牌头 + 表单卡片。
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
    <div className="grid min-h-dvh bg-slate-50 lg:grid-cols-[1.05fr_1fr]">
      {/* 左：产品宣传（仅桌面）——简洁深色面板 */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#0A1628] p-12 xl:p-16 lg:flex">
        {/* 装饰：渐变光晕 + 细网格 */}
        <div className="pointer-events-none absolute -left-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-sky-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -right-24 h-[30rem] w-[30rem] rounded-full bg-indigo-500/20 blur-3xl" />
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />

        {/* 顶部品牌 */}
        <Link to="/" className="relative flex items-center gap-3">
          <BrandMark size={38} />
          <div className="leading-tight">
            <div className="font-display text-xl font-semibold text-white">Thalvior</div>
            <div className="text-[11px] tracking-[0.22em] text-sky-200/60">{t("nav.logo.subtitle")}</div>
          </div>
        </Link>

        {/* 产品宣传核心文案 */}
        <div className="relative">
          <h2 className="max-w-xl font-display text-4xl font-bold leading-[1.15] tracking-tight text-white xl:text-5xl">
            {panelTitle}
          </h2>
          <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-slate-300/90">{panelDesc}</p>
        </div>
      </aside>

      {/* 右：登录注册卡片（浅色，自居中） */}
      <main className="relative grid place-items-center px-4 py-10 sm:px-6">
        <div className="pointer-events-none absolute right-0 top-0 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-64 w-64 rounded-full bg-indigo-200/40 blur-3xl" />
        <div className="relative w-full max-w-md">
          {/* 移动端品牌头 */}
          <div className="mb-8 text-center lg:hidden">
            <Link to="/" className="mx-auto mb-3 flex w-fit items-center gap-2.5">
              <BrandMark size={36} />
              <span className="font-display text-lg font-semibold text-foreground">Thalvior</span>
            </Link>
            <p className="text-xs text-muted-foreground">{t("nav.logo.subtitle")}</p>
          </div>
          <div className="rise-in">{children}</div>
        </div>
      </main>
    </div>
  );
}
