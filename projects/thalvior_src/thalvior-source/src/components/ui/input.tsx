import * as React from "react";

import { cn } from "@/lib/utils";

/* v6：输入框（focus 环 2px 品牌蓝 + 错误态红环 + 控件圆角 6） */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-8 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-soft transition-[border-color,box-shadow] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-placeholder focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-muted-foreground disabled:opacity-70 aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-danger-ring",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
