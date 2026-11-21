/**
 * meoo EmptyState —— 自定义 SVG 插画 + text + hint + CTA
 * 源码反推自 meoo production empty-state-hTlzZwJf.js
 */
interface EmptyStateProps {
  text?: string;
  hint?: string;
  iconSize?: number;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  text = '暂无数据',
  hint,
  iconSize = 40,
  action,
  className,
}: EmptyStateProps) {
  const scale = iconSize >= 36 ? 1 : 0.72;
  const w = Math.round(72 * scale);
  const h = Math.round(60 * scale);

  return (
    <div className={cn('flex flex-col items-center justify-center py-12 text-fg-muted', className)}>
      <svg
        width={w}
        height={h}
        viewBox="0 0 72 60"
        fill="none"
        aria-hidden
        className="mb-3"
      >
        {/* 底座阴影椭圆 */}
        <ellipse cx="36" cy="53" rx="27" ry="4" fill="var(--surface-sunken)" opacity="0.9" />
        {/* 散落小装饰 */}
        <circle cx="12" cy="16" r="2" fill="var(--border)" />
        <circle cx="61" cy="11" r="1.6" fill="var(--brand-subtle)" />
        {/* 小包裹 */}
        <g transform="rotate(-6 36 15)">
          <rect x="27" y="7" width="18" height="15" rx="2" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1.5" />
          <path d="M31 13h10M31 16.5h7" stroke="var(--text-subtle)" strokeOpacity="0.7" strokeWidth="1.4" strokeLinecap="round" />
        </g>
        {/* 大购物车/包裹 */}
        <path d="M14 28h44l-3 22a3 3 0 0 1-3 2.6H20a3 3 0 0 1-3-2.6L14 28Z" fill="var(--surface-raised)" stroke="var(--text-subtle)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M14 28l4-10h36l4 10" stroke="var(--text-subtle)" strokeWidth="1.5" strokeLinecap="round" fill="var(--surface)" />
        <path d="M14 28h15.5l3 5h6l3-5H58" stroke="var(--text-subtle)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="var(--surface-raised)" />
        <circle cx="59.5" cy="33.5" r="1.5" fill="var(--brand)" />
      </svg>
      <p className="text-sm text-fg-muted">{text}</p>
      {hint && <p className="mt-1 text-xs text-fg-subtle">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
