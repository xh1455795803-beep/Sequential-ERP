import { LucideIcon } from 'lucide-react';

/** 简易 Modal（旧页面兼容） */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-lift p-6">
        {title && <h3 className="font-display text-base font-semibold text-fg mb-4">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
/** 简易 Grid */
export function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>;
}
/** 简易 Field */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
    </label>
  );
}
/** 简易 Footer */
export function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-4 border-t border-border">{children}</div>;
}

/** meoo 风格 page-header：统一页面顶部标题区 */
export function PageHeader({
  code, title, description, actions,
}: {
  code?: string;          // 顶部小字标签，如 "WMS PORTAL"
  title: string;          // 页面大标题
  description?: string;   // 副标题说明
  actions?: React.ReactNode; // 右侧操作按钮
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {code && <p className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-brand">{code}</p>}
        <h1 className="font-display text-xl font-semibold leading-6 tracking-[-0.02em] text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** meoo 风格 StatCard：带 icon + 数字 + 可选 delta 趋势 */
export function StatCard({
  label, value, delta, trend = 'up', icon: Icon, tone = 'primary', footer,
}: {
  label: string;
  value: string | number;
  delta?: string;
  trend?: 'up' | 'down';
  icon?: LucideIcon;
  tone?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  footer?: React.ReactNode;
}) {
  const toneBg: Record<string, string> = {
    primary: 'bg-brand-subtle text-brand',
    success: 'bg-success-subtle text-success',
    warning: 'bg-warn-subtle text-warn',
    danger: 'bg-danger-subtle text-danger',
    info: 'bg-info-subtle text-info',
  };
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-all duration-200 hover:shadow-lift">
      <div className="relative p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg-muted">{label}</span>
          {Icon && (
            <span className={`flex h-7 w-7 items-center justify-center rounded-md transition-transform duration-300 group-hover:scale-105 ${toneBg[tone]}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="font-data text-lg font-semibold tracking-tight text-fg tabular-nums">{value}</span>
          {delta && (
            <span className={`font-data text-xs font-medium ${trend === 'up' ? 'text-success' : 'text-destructive'}`}>
              {trend === 'up' ? '↑' : '↓'} {delta}
            </span>
          )}
        </div>
        {footer && <div className="mt-2 text-xs text-fg-muted">{footer}</div>}
      </div>
    </div>
  );
}

/** meoo 风格 Badge / Chip：状态标记 */
export function Badge({
  children, tone = 'info', className = '',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'primary';
  className?: string;
}) {
  const map: Record<string, string> = {
    info:     'bg-info-subtle text-info-ink',
    success:  'bg-success-subtle text-success-ink',
    warning:  'bg-warn-subtle text-warn-ink',
    danger:   'bg-danger-subtle text-danger-ink',
    primary:  'bg-brand-subtle text-brand-ink-text',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${map[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** 简化版 meoo DataTable：支持 selectable / stickyHeader / 分页 */
export interface TableColumn<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  render?: (row: T, idx: number) => React.ReactNode;
  headerClassName?: string;
}

export function DataTable<T extends Record<string, any>>({
  columns, rows, rowKey, loading, emptyState, stickyHeader,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  emptyState?: React.ReactNode;
  stickyHeader?: boolean;
}) {
  const alignMap = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

  return (
    <div className="overflow-hidden rounded-[4px] border border-border bg-card shadow-soft">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/70">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width != null ? { width: typeof col.width === 'number' ? `${col.width}px` : col.width } : undefined}
                  className={`whitespace-nowrap px-4 py-2 text-sm font-medium text-fg-muted ${alignMap[col.align ?? 'left']} ${stickyHeader ? 'sticky top-0 z-20 bg-surface-sunken' : ''} ${col.headerClassName ?? ''}`}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-fg-muted text-sm">加载中...</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-fg-muted text-sm">
                  {emptyState ?? '暂无数据'}
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={rowKey(row)} className="border-b border-border/70 last:border-0 transition-colors hover:bg-surface-hover/70">
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-2 align-middle ${alignMap[col.align ?? 'left']}`}>
                      {col.render ? col.render(row, idx) : String(row?.[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
