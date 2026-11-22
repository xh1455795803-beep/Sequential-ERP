// 通用数据表容器（纯视觉 / 结构层）
// ---------------------------------------------------------------------------
// 职责：统一 表头 / 行 / hover / 选中 / 加载态 / 错误态 / 空态 / 分页 / 列宽 /
//       排序指示 / 密度切换 / 批量操作条 的「渲染形态」。
// 边界：**不取数、不筛选、不改字段语义、不改事件绑定**。
//       页面自己怎么取数、怎么筛、怎么排序、怎么分页，仍由页面自己掌控；
//       本组件只负责把这些结果画成一致的表格长相。
// 设计约束：沿用 v6 设计系统（批 1 已落地）的 2 套 token，不另起一套。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Loader2, Rows3, Rows4 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";

export type DataTableDensity = "compact" | "cozy";
export type DataTableAlign = "left" | "right" | "center";

export interface DataTableColumn<T> {
  /** 列标识（用于排序回调与 React key） */
  key: string;
  /** 表头内容（传 ReactNode，可含排序箭头） */
  header: ReactNode;
  /** 单元格渲染；不传则渲染原始值 */
  render?: (row: T, index: number) => ReactNode;
  align?: DataTableAlign;
  /** 列宽（数字=px，字符串原样） */
  width?: number | string;
  /** 表头 class 追加 */
  headerClassName?: string;
  /** 单元格 class 追加 */
  cellClassName?: string;
  /** 可排序（需配合 onSort） */
  sortable?: boolean;
}

export interface DataTablePagination {
  page: number;
  pageCount: number;
  total: number;
  /** 预格式化页码信息文案（不传则用 「共 N 条」） */
  info?: string;
  onPageChange?: (page: number) => void;
  prevLabel?: string;
  nextLabel?: string;
  /**
   * vV1-T6：每页条数（受控）。页面用 useTablePageSize() 拿到值与回调再传进来，
   * 容器本身不切片 —— 分页数据仍由页面自己决定，这里只负责呈现与交互。
   * 不传 onPageSizeChange 时不渲染条数选择器（旧页面零改动继续可用）。
   */
  pageSize?: number;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /** 错误内容（字符串或节点）；非空时整表替换为错误态 */
  error?: ReactNode;
  /** 空态节点（通常传 <EmptyState/>） */
  emptyState?: ReactNode;
  /**
   * 是否展示空态。默认按当前页行数判定；
   * 页面若以「整个筛选结果集」判定空态，可显式传入，保持原语义不变。
   */
  showEmptyState?: boolean;
  /** 复选框列 */
  selectable?: boolean;
  selectedKeys?: ReadonlyArray<string>;
  onToggleRow?: (key: string) => void;
  onToggleAll?: (checked: boolean) => void;
  /**
   * 表头「全选」勾选态覆盖值。
   * 当页面的「全选」语义跨越整个筛选结果集（而非当前页行）时，
   * 由页面传入真实状态，避免容器按当前页行数误判。
   */
  allSelected?: boolean;
  /** 半选态（部分选中）覆盖值 */
  someSelected?: boolean;
  /** 排序状态（受控） */
  sortKey?: string | null;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
  /** 行密度 */
  density?: DataTableDensity;
  onDensityChange?: (density: DataTableDensity) => void;
  densityLabels?: { compact: string; cozy: string };
  /** 分页条 */
  pagination?: DataTablePagination;
  /** 批量操作条（有选中行时显示在表格上方） */
  batchBar?: ReactNode;
  /** 表头吸顶（配合 maxHeight 使用） */
  stickyHeader?: boolean;
  /** 表格区最大高度（超出滚动） */
  maxHeight?: string;
  className?: string;
  /** 表格区 class 追加 */
  bodyClassName?: string;
}

const ALIGN: Record<DataTableAlign, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/**
 * 行密度偏好（按页独立持久化到 localStorage）。
 * 纯展示偏好，不影响任何取数与业务语义。
 */
export function useTableDensity(storageKey: string): [DataTableDensity, (d: DataTableDensity) => void] {
  const [density, setDensity] = useState<DataTableDensity>(() => {
    if (typeof window === "undefined") return "compact";
    // vV1-T10：默认档改 compact（ERP 列表首屏看更多行）；只有显式存过 cozy 才回到 cozy
    return localStorage.getItem(storageKey) === "cozy" ? "cozy" : "compact";
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, density);
    } catch {
      /* 隐私模式等场景下写入失败可忽略：密度只是展示偏好 */
    }
  }, [storageKey, density]);
  return [density, setDensity];
}

/** vV1-T6：每页条数档位 + 全站共用的持久化 key */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const PAGE_SIZE_STORAGE_KEY = "thalvior.pageSize";

/**
 * 每页条数偏好（全站一档，localStorage 持久化，默认 20）。
 * 与 useTableDensity 不同：条数是「一次选择全站生效」的列表偏好，故不分页独立。
 * 仍由页面持有状态并自行切片，容器只做交互回调。
 */
export function useTablePageSize(defaultSize = 20): [number, (size: number) => void] {
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") return defaultSize;
    const v = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY));
    return PAGE_SIZE_OPTIONS.includes(v) ? v : defaultSize;
  });
  const save = useCallback((size: number) => {
    setPageSize(size);
    try {
      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size));
    } catch {
      /* 隐私模式写入失败可忽略：条数只是展示偏好 */
    }
  }, []);
  return [pageSize, save];
}

/**
 * 页码窗口：当前页 ±2，两端常显，缺口用省略号。
 * 例：pageCount=20 page=8 → 1 … 6 7 8 9 10 … 20
 */
export function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  const from = Math.max(1, page - 2);
  const to = Math.min(pageCount, page + 2);
  if (from > 1) {
    out.push(1);
    if (from > 2) out.push("gap");
  }
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pageCount) {
    if (to < pageCount - 1) out.push("gap");
    out.push(pageCount);
  }
  return out;
}

/** 上一页 / 下一页：窄屏只留箭头，label 作为 title */
function PageStepButton({
  dir,
  disabled,
  label,
  onClick,
}: {
  dir: "prev" | "next";
  disabled?: boolean;
  label?: string;
  onClick: () => void;
}) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      disabled={disabled}
      title={label}
      aria-label={label ?? dir}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-[3px] border border-border text-fg-muted transition-colors",
        disabled ? "cursor-not-allowed opacity-40" : "hover:bg-surface-hover hover:text-fg",
      )}
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}

/** vV1-T6：分页条新短语（字典不在本波文件清单内，就近双语兜底） */
const PG_STRINGS: Record<"zh" | "en", { goto: string; unit: string; perPage: string; confirm: string }> = {
  zh: { goto: "前往", unit: "页", perPage: "条/页", confirm: "跳转" },
  en: { goto: "Go to", unit: "page", perPage: "/ page", confirm: "Jump" },
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  emptyState = null,
  showEmptyState,
  selectable = false,
  selectedKeys = [],
  onToggleRow,
  onToggleAll,
  allSelected,
  someSelected,
  sortKey = null,
  sortDirection = "asc",
  onSort,
  density = "compact",
  onDensityChange,
  densityLabels,
  pagination,
  batchBar,
  stickyHeader = false,
  maxHeight,
  className,
  bodyClassName,
}: DataTableProps<T>) {
  const compact = density === "compact";
  const { t, lang } = useLanguage();
  const pg = PG_STRINGS[lang === "en" ? "en" : "zh"];
  // vV1-T6：跳页输入（本地态，跳转后清空，避免与真实页码打架）
  const [jumpValue, setJumpValue] = useState("");
  const selectedSet = new Set(selectedKeys);
  // 页面若显式给出全选/半选态则以其为准（跨页全选语义），否则按当前页行数推断
  const allChecked =
    selectable && allSelected !== undefined
      ? allSelected
      : selectable && rows.length > 0 && selectedKeys.length === rows.length;
  const partialChecked =
    selectable && someSelected !== undefined
      ? someSelected
      : selectable && selectedKeys.length > 0 && !allChecked;

  // 全选框的半选态（indeterminate）需要直接操作 DOM 属性
  const headCheckRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (headCheckRef.current) headCheckRef.current.indeterminate = partialChecked;
  }, [partialChecked]);

  const colSpan = columns.length + (selectable ? 1 : 0);
  // vV1-T10：cozy 由 py-3（~42px）收到 py-2（~34px），compact 维持 py-1.5（~30px）
  const cellPad = compact ? "px-3 py-1.5" : "px-4 py-2";
  const textSize = compact ? "text-sm" : "text-sm";

  const jumpToPage = () => {
    const cb = pagination?.onPageChange;
    const raw = Number(jumpValue);
    setJumpValue("");
    if (!cb || !Number.isFinite(raw) || raw <= 0) return;
    cb(Math.min(Math.max(1, Math.round(raw)), Math.max(1, pagination?.pageCount ?? 1)));
  };

  const renderSortIcon = (key: string) => {
    if (!onSort || sortKey !== key) return null;
    return sortDirection === "asc" ? (
      <ArrowUp size={12} className="text-primary" aria-hidden />
    ) : (
      <ArrowDown size={12} className="text-primary" aria-hidden />
    );
  };

  return (
    <div className={cn("overflow-hidden rounded-[4px] border border-border bg-card", compact && "dt-compact", className)}>
      {/* 批量操作条：仅在有选中行时出现，位置固定在表格上方 */}
      {batchBar ? (
        <div className="border-b border-border bg-brand-subtle/60 px-4 py-2.5">{batchBar}</div>
      ) : null}

      <div
        className={cn("overflow-x-auto", bodyClassName)}
        style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}
      >
        <table className={cn("w-full", textSize)}>
          <thead>
            <tr className="border-b border-border/70">
              {selectable ? (
                <th className={cn("w-10", cellPad, stickyHeader && "sticky top-0 z-20 bg-surface-sunken")}>
                  <input
                    ref={headCheckRef}
                    type="checkbox"
                    className="accent-primary"
                    checked={allChecked}
                    onChange={(e) => onToggleAll?.(e.target.checked)}
                    aria-label={t("tbl.selectAll")}
                  />
                </th>
              ) : null}
              {columns.map((c) => (
                <th
                  key={c.key}
                  style={c.width != null ? { width: typeof c.width === "number" ? `${c.width}px` : c.width } : undefined}
                  className={cn(
                    "whitespace-nowrap px-4 py-2 text-sm font-medium text-fg-muted",
                    ALIGN[c.align ?? "left"],
                    c.sortable && onSort && "cursor-pointer select-none hover:text-fg",
                    stickyHeader && "sticky top-0 z-20 bg-surface-sunken",
                    c.headerClassName,
                  )}
                  onClick={c.sortable && onSort ? () => onSort(c.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.header}
                    {renderSortIcon(c.key)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-12 text-center text-fg-muted">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" aria-hidden />
                  <span className="text-sm">{t("common.loading")}</span>
                </td>
              </tr>
            ) : error ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-destructive">
                  {error}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={colSpan}>{(showEmptyState ?? true) ? emptyState : null}</td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const k = rowKey(row);
                const isSelected = selectedSet.has(k);
                return (
                  <tr
                    key={k}
                    className={cn(
                      "border-b border-border/70 transition-colors last:border-0 hover:bg-surface-hover/70",
                      isSelected && "bg-primary/8",
                    )}
                  >
                    {selectable ? (
                      <td className={cn(cellPad)}>
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={isSelected}
                          onChange={() => onToggleRow?.(k)}
                          aria-label={t("tbl.selectRow", { key: k })}
                        />
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cn(cellPad, "align-middle", ALIGN[c.align ?? "left"], c.cellClassName)}
                      >
                        {c.render ? c.render(row, idx) : String((row as Record<string, unknown> | undefined)?.[c.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 + 密度切换 */}
      {pagination || onDensityChange ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 px-4 py-3">
          {pagination ? (
            <span className="text-xs text-fg-muted">
              {/* vV1-T6：左侧统一「共 N 条」；页面显式给了 info 才尊重 info */}
              {pagination.info ?? t("common.total", { count: pagination.total })}
            </span>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            {onDensityChange ? (
              <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => onDensityChange("compact")}
                  title={densityLabels?.compact ?? "Compact"}
                  aria-label={densityLabels?.compact ?? "Compact"}
                  aria-pressed={compact}
                  className={cn(
                    "flex h-6 w-7 items-center justify-center rounded transition-colors",
                    compact ? "bg-brand-subtle text-primary" : "text-fg-subtle hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  <Rows3 size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onDensityChange("cozy")}
                  title={densityLabels?.cozy ?? "Standard"}
                  aria-label={densityLabels?.cozy ?? "Standard"}
                  aria-pressed={!compact}
                  className={cn(
                    "flex h-6 w-7 items-center justify-center rounded transition-colors",
                    !compact ? "bg-brand-subtle text-primary" : "text-fg-subtle hover:bg-surface-hover hover:text-fg",
                  )}
                >
                  <Rows4 size={13} aria-hidden />
                </button>
              </div>
            ) : null}
            {pagination?.onPageChange ? (
              <>
                {/* vV1-T6：数字页码（±2 窗口 + 省略号） */}
                <div className="flex items-center gap-0.5">
                  <PageStepButton
                    dir="prev"
                    disabled={pagination.page <= 1}
                    label={pagination.prevLabel}
                    onClick={() => pagination.onPageChange?.(pagination.page - 1)}
                  />
                  {pageWindow(pagination.page, pagination.pageCount).map((p, i) =>
                    p === "gap" ? (
                      <span key={`gap-${i}`} className="select-none px-1 text-xs text-fg-subtle" aria-hidden>
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        aria-current={p === pagination.page ? "page" : undefined}
                        onClick={() => pagination.onPageChange?.(p)}
                        className={cn(
                          "h-7 min-w-7 rounded-[3px] px-1.5 text-xs tabular-nums transition-colors",
                          p === pagination.page
                            ? "bg-brand-subtle font-medium text-primary"
                            : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                        )}
                      >
                        {p}
                      </button>
                    ),
                  )}
                  <PageStepButton
                    dir="next"
                    disabled={pagination.page >= pagination.pageCount}
                    label={pagination.nextLabel}
                    onClick={() => pagination.onPageChange?.(pagination.page + 1)}
                  />
                </div>
                {/* vV1-T6：每页条数 */}
                {pagination.onPageSizeChange ? (
                  <Select
                    value={String(pagination.pageSize ?? 20)}
                    onValueChange={(v) => pagination.onPageSizeChange?.(Number(v))}
                  >
                    <SelectTrigger
                      className="h-7 w-[104px] text-xs"
                      aria-label={pg.perPage}
                      title={pg.perPage}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(pagination.pageSizeOptions ?? PAGE_SIZE_OPTIONS).map((n) => (
                        <SelectItem key={n} value={String(n)}>{`${n} ${pg.perPage}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {/* vV1-T6：前往 N 页（Enter / 失焦跳转，越界钳到 [1, pageCount]） */}
                <div className="flex items-center gap-1 text-xs text-fg-muted">
                  <span className="whitespace-nowrap">{pg.goto}</span>
                  <Input
                    value={jumpValue}
                    inputMode="numeric"
                    aria-label={pg.confirm}
                    onChange={(e) => setJumpValue(e.target.value.replace(/[^\d]/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        jumpToPage();
                      }
                    }}
                    onBlur={jumpToPage}
                    className="h-7 w-14 text-center text-xs tabular-nums"
                  />
                  <span className="whitespace-nowrap">{pg.unit}</span>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
