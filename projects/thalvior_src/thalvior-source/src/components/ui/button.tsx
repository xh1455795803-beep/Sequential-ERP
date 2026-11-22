import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

/* v6：主 / 次 / 幽灵 / 危险 四态 + loading（default / hover / active / disabled） */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer select-none transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-btn hover:bg-brand-hover active:bg-brand-active disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground shadow-btn hover:bg-danger-hover active:bg-danger-active disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none",
        outline:
          "border border-border-strong bg-card text-fg hover:bg-surface-hover hover:border-brand/40 active:bg-surface-inset disabled:border-border disabled:bg-muted disabled:text-muted-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-surface-inset active:bg-surface-inset disabled:bg-muted disabled:text-muted-foreground",
        ghost:
          "text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-inset disabled:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline disabled:text-muted-foreground",
      },
      size: {
        default: "h-8 rounded-md px-3",
        sm: "h-8 rounded-md px-3 text-sm",
        lg: "h-9 rounded-md px-4",
        icon: "h-8 w-8 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** 载入态：禁用交互 + 转圈指示（新增可选 prop，不影响既有调用方） */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const isDisabled = disabled || loading;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={asChild ? undefined : isDisabled}
        aria-busy={loading || undefined}
        data-loading={loading ? "true" : undefined}
        {...props}
      >
        {loading && !asChild ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
