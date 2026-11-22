import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* v6：徽标统一（语义色底 + 12px 半粗）
   vV1-T5：pill → 4px 直角标签（赛狐/妙手式 tag 形态），基准高度对齐状态徽标的 24px。
   高度取 min-h-6 而不是 h-6：默认档（leading-[18px] + 1px 边框 = 20px）被抬到正好 24px，
   同时给调用点留出长高的余地——现网 95 处 <Badge> 有 3 处显式写了 px-1.5 py-0 text-[10px]
   （logistics.waybills:422,423 / logistics.parcels:786），它们会从 20px 抬到 24px（统一形态，
   见交付报告风险 4）；若写成 h-6，将来任何想要 >24px 的调用点都会被硬截到 24px 并压字。 */
const badgeVariants = cva(
  "inline-flex min-h-6 items-center gap-1 rounded-[3px] border px-2 text-[12px] font-medium leading-[18px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border bg-card text-fg-muted",
        success: "border-transparent bg-success-bg text-success",
        warning: "border-transparent bg-warning-bg text-warning",
        info: "border-transparent bg-info-bg text-info",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
