import { LucideIcon } from 'lucide-react';

/** PageHeader — 专业企业风格页面头部 */
export function PageHeader({
  code, title, description, actions,
}: {
  code?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {code && (
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-border bg-surface-sunken px-2 py-0.5 text-[10.5px] font-medium tracking-[0.14em] text-fg-muted uppercase">
            {code}
          </div>
        )}
        <h1 className="font-display text-xl font-semibold leading-6 tracking-[-0.01em] text-fg">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** StatCard — 克制、专业的数据卡片 */
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
  const iconTone: Record<string, string> = {
    primary: 'text-brand',
    success: 'text-success',
    warning: 'text-warn',
    danger: 'text-danger',
    info: 'text-fg-muted',
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-border-strong">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] text-fg-muted">{label}</span>
        {Icon && <Icon className={`h-3.5 w-3.5 ${iconTone[tone]}`} strokeWidth={1.8} />}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-data text-[22px] font-semibold tracking-tight text-fg tabular-nums">{value}</span>
        {delta && (
          <span className={`font-data text-[11.5px] font-medium ${trend === 'up' ? 'text-success' : 'text-danger'}`}>
            {trend === 'up' ? '↑' : '↓'} {delta}
          </span>
        )}
      </div>
      {footer && <div className="mt-1 text-[11px] text-fg-subtle">{footer}</div>}
    </div>
  );
}

/** Badge — 精致状态标签 */
export function Badge({
  children, tone = 'info', className = '',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'primary';
  className?: string;
}) {
  const map: Record<string, string> = {
    info:     'bg-info-subtle text-info-ink ring-1 ring-info/15',
    success:  'bg-success-subtle text-success-ink ring-1 ring-success/15',
    warning:  'bg-warn-subtle text-warn-ink ring-1 ring-warn/15',
    danger:   'bg-danger-subtle text-danger-ink ring-1 ring-danger/15',
    primary:  'bg-brand-subtle text-brand-ink-text ring-1 ring-brand/15',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${map[tone]} ${className}`}>
      {children}
    </span>
  );
}

export interface TableColumn<T> {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  render?: (row: T, idx: number) => React.ReactNode;
  headerClassName?: string;
}

/** DataTable — 专业企业风格数据表格 */
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
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={col.width != null ? { width: typeof col.width === 'number' ? `${col.width}px` : col.width } : undefined}
                  className={`whitespace-nowrap px-4 py-2.5 text-[11.5px] font-medium uppercase tracking-[0.04em] text-fg-muted ${alignMap[col.align ?? 'left']} ${stickyHeader ? 'sticky top-0 z-20 bg-surface-raised' : ''} ${col.headerClassName ?? ''}`}
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
                <tr key={rowKey(row)} className="border-b border-border/60 last:border-0 transition-colors hover:bg-surface-sunken/60">
                  {columns.map((col) => (
                    <td key={col.key} className={`px-4 py-2.5 align-middle ${alignMap[col.align ?? 'left']}`}>
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

/** 简易 Modal */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-lg border border-border bg-card shadow-lift p-6">
        {title && <h3 className="font-display text-base font-semibold text-fg mb-4">{title}</h3>}
        {children}
      </div>
    </div>
  );
}
export function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  return <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{children}</div>;
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
    </label>
  );
}
export function Footer({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-4 border-t border-border">{children}</div>;
}
