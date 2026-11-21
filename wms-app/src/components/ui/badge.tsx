/**
 * meoo Badge + StatusBadge —— 源码反推自 meoo production
 * badge-vY0KnIVn.js + status-badge-D7tyuZe-.js
 *
 * Badge: 8 个 variant (default/secondary/destructive/outline/success/warning/info/muted)
 * StatusBadge: 50+ 硬编码状态字典（待审核/已完成/异常/已取消...）
 */
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

// ============ Badge ============
const badgeVariants = cva(
  'inline-flex min-h-6 items-center gap-1 rounded-[3px] border px-2 text-[12px] font-medium leading-[18px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  {
    variants: {
      variant: {
        default:      'border-transparent bg-primary text-primary-foreground',
        secondary:    'border-transparent bg-secondary text-secondary-foreground',
        destructive:  'border-transparent bg-destructive text-destructive-foreground',
        outline:      'border-border bg-card text-fg-muted',
        success:      'border-transparent bg-success-bg text-success',
        warning:      'border-transparent bg-warning-bg text-warning',
        info:         'border-transparent bg-info-bg text-info',
        muted:        'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
Badge.displayName = 'Badge';

// ============ StatusBadge（50+ 状态字典） ============
const STATUS_MAP: Record<string, string> = {
  // 通用状态
  '启用': 'bg-success-bg text-success',
  '停用': 'bg-muted text-muted-foreground',
  '已取消': 'bg-muted text-muted-foreground',
  '已删除': 'bg-muted text-muted-foreground',
  '已过期': 'bg-muted text-muted-foreground',
  // 订单/审批
  '待审核': 'bg-warning-bg text-warning',
  '待发货': 'bg-warning-bg text-warning',
  '待处理': 'bg-warning-bg text-warning',
  '待入库': 'bg-warning-bg text-warning',
  '待出库': 'bg-warning-bg text-warning',
  '待备货': 'bg-warning-bg text-warning',
  '已发货': 'bg-info-bg text-info',
  '已完成': 'bg-success-bg text-success',
  '已签收': 'bg-success-bg text-success',
  '已授权': 'bg-success-bg text-success',
  '合作中': 'bg-success-bg text-success',
  '正常': 'bg-success-bg text-success',
  '异常': 'bg-danger-bg text-destructive',
  '售后中': 'bg-danger-bg text-destructive',
  '售罄': 'bg-danger-bg text-destructive',
  '运输中': 'bg-info-bg text-info',
  '审核中': 'bg-warning-bg text-warning',
  '待验证': 'bg-warning-bg text-warning',
  '即将到期': 'bg-warning-bg text-warning',
  '未授权': 'bg-danger-bg text-destructive',
  '已上架': 'bg-success-bg text-success',
  '下架': 'bg-muted text-muted-foreground',
  '草稿': 'bg-muted text-muted-foreground',
  // 英文状态
  created: 'bg-muted/50 text-muted-foreground',
  notfound: 'bg-muted/50 text-muted-foreground',
  in_transit: 'bg-info-bg text-info',
  delivered: 'bg-success-bg text-success',
  exception: 'bg-danger-bg text-destructive',
  expired: 'bg-muted text-muted-foreground',
  pending_register: 'bg-warning-bg text-warning',
  active: 'bg-success-bg text-success',
  inactive: 'bg-muted text-muted-foreground',
  shipped: 'bg-info-bg text-info',
  cancelled: 'bg-muted text-muted-foreground',
};

/** WMS 订单/出库/收货状态映射（数字→中文） */
export const WMS_STATUS_LABEL: Record<string | number, string> = {
  1: '待处理', 2: '处理中', 3: '已完成', 4: '部分完成', 5: '已取消',
  pending: '待处理', processing: '处理中', completed: '已完成', cancelled: '已取消',
};

function StatusBadge({ status, label, className }: { status: string | number; label?: string; className?: string }) {
  const key = typeof status === 'number' ? (WMS_STATUS_LABEL[status] ?? String(status)) : status;
  const cls = STATUS_MAP[key] ?? 'bg-muted/50 text-muted-foreground';
  return (
    <span className={cn('inline-flex h-6 items-center whitespace-nowrap rounded-[3px] px-2 text-xs font-medium leading-4', cls, className)}>
      {label ?? key}
    </span>
  );
}
StatusBadge.displayName = 'StatusBadge';

export { Badge, StatusBadge, badgeVariants };
