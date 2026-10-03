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
    <div className="flex items-start justify-between gap-4">
      <div>
        {code && <p className="manifest-eyebrow mb-1.5">{code}</p>}
        <h1 className="font-display text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// 统计卡片：集装箱吊牌——顶部色条 + 等宽大数字
export function StatCard({
  label,
  value,
  delta,
  trend = "up",
  icon,
  tone = "primary",
}: {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down";
  icon?: React.ReactNode;
  tone?: "primary" | "success" | "warning" | "violet";
}) {
  // 五色货盘：每种 tone 有专属芯片色 / 顶条色 / 数值色
  const toneKit = {
    primary: { bar: "bg-cargo-orange", chip: "chip-orange", value: "text-cargo-orange" },
    success: { bar: "bg-cargo-teal", chip: "chip-teal", value: "text-cargo-teal" },
    warning: { bar: "bg-cargo-gold", chip: "chip-gold", value: "text-cargo-gold" },
    violet: { bar: "bg-cargo-violet", chip: "chip-violet", value: "text-cargo-violet" },
  }[tone];
  const washClass = {
    primary: "bg-cargo-orange/12",
    success: "bg-cargo-teal/14",
    warning: "bg-cargo-gold/18",
    violet: "bg-cargo-violet/14",
  }[tone];

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-card shadow-soft transition-all duration-300 hover:-translate-y-0.5 hover:shadow-float">
      <div className={cn("h-[3px] w-full", toneKit.bar)} />
      {/* 角落渐变水洗 */}
      <div className={cn("pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100", washClass)} aria-hidden />
      <div className="relative p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          {icon && (
            <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110", toneKit.chip)}>
              {icon}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className={cn("font-data text-[26px] font-semibold tracking-tight", toneKit.value)}>{value}</span>
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
      </div>
    </div>
  );
}
