import { cn } from "@/lib/utils";

// 通用页面标题栏：货单眉标 + 标题
export function PageHeader({
  title,
  description,
  actions,
  code,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  code?: string; // 货单编号眉标（如 ORDERS / FREIGHT），可选
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        {code && <p className="manifest-eyebrow mb-1.5">{code}</p>}
        <h1 className="font-display text-xl font-semibold leading-6 tracking-[-0.02em] text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// 统计卡片：SaaS 紧凑——白卡 + 20px 数字 + 小图标芯片
export function StatCard({
  label,
  value,
  delta,
  trend = "up",
  icon,
  tone = "primary",
  valueClassName,
  footer,
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
  icon?: React.ReactNode;
  tone?: "primary" | "success" | "warning" | "violet" | "blue" | "danger";
  valueClassName?: string;
  footer?: React.ReactNode;
}) {
  // A 静白极简：tone 仅决定图标小块底色（极淡中性/极淡语义），数值统一深灰
  const toneKit = {
    primary: { chip: "chip-orange" },
    success: { chip: "chip-teal" },
    warning: { chip: "chip-gold" },
    violet: { chip: "chip-violet" },
    blue: { chip: "chip-blue" },
    danger: { chip: "chip-danger" },
  }[tone];

  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card shadow-soft transition-all duration-200 hover:shadow-lift">
      <div className="relative p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-fg-muted">{label}</span>
          {icon && (
            <span className={cn("flex h-7 w-7 items-center justify-center rounded-md transition-transform duration-300 group-hover:scale-105", toneKit.chip)}>
              {icon}
            </span>
          )}
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className={cn("font-data text-lg font-semibold tracking-tight text-fg tabular-nums", valueClassName)}>{value}</span>
          {delta && (
            <span
              className={cn(
                "font-data text-xs font-medium",
                trend === "up" ? "text-success" : "text-destructive"
              )}
            >
              {trend === "up" ? "↑" : "↓"} {delta}
            </span>
          )}
        </div>
        {footer}
      </div>
    </div>
  );
}
