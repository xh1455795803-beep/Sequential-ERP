// 通用筛选栏容器（纯视觉 / 结构层）
// ---------------------------------------------------------------------------
// 职责：统一「搜索框 + 下拉筛选 + 右侧操作按钮组」的间距、分组、换行与响应式折叠。
// 边界：**不取数、不筛选、不改业务语义**。页面自己管筛选状态，本组件只负责排版长相。
// 响应式：窄屏时右侧操作组整体换行并左对齐，避免按钮挤压搜索框。
import { Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";

export interface FilterBarProps {
  /** 左侧主区：通常是搜索框 + 下拉筛选 */
  children?: ReactNode;
  /** 右侧操作区：视图 / 列设置 / 导出 / 主操作等 */
  actions?: ReactNode;
  /** 计数等次级信息（放在右侧组之前） */
  meta?: ReactNode;
  className?: string;
  /** 吸顶（长列表滚动时筛选条跟随） */
  sticky?: boolean;
}

/** 统一搜索框：左放大镜 + 右清除按钮，宽度与各页一致 */
export function SearchField({
  value,
  onChange,
  placeholder,
  className,
  width = "w-64",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  width?: string;
}) {
  const { t } = useLanguage();
  return (
    <div className={cn("relative", width, className)}>
      <Search
        size={15}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
        aria-hidden
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-8"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("tbl.clearSearch")}
          className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg"
        >
          <X size={13} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

export function FilterBar({ children, actions, meta, className, sticky = false }: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5",
        sticky && "sticky top-0 z-30 -mx-1 bg-surface/90 px-1 py-2 backdrop-blur-sm",
        className,
      )}
    >
      {children}
      {meta ? <span className="text-sm text-fg-muted">{meta}</span> : null}
      {actions ? (
        <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
