import { Search, Plus, Pencil, Trash2, Loader2, Download, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { exportToCsv } from "@/lib/export";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fetchTable, insertRow, updateRow, deleteRow, type ExtRow } from "@/lib/data-access";
import { useLanguage } from "@/i18n/LanguageContext";

// 表单字段定义：用于新增/编辑弹窗
export interface FormField {
  key: string; // 数据库列名
  label: string;
  type?: "text" | "number" | "select";
  options?: (string | { label: string; value: string })[]; // type=select 时的选项（支持 {label,value} 展示中文标签）
  required?: boolean;
  placeholder?: string;
}

// 列表列定义
export interface ListColumn {
  key: string;
  label: string;
  render?: (row: Record<string, string>) => React.ReactNode;
}

// 配置驱动的 CRUD 列表页：传入 table 名 + 字段定义，自动完成加载/搜索/增删改
export function DataListPage({
  title,
  description,
  table,
  columns,
  fields,
  addLabel,
  filter,
  stats,
  statusKey = "status",
  exportable = false,
  batchDelete = false,
  batchActions,
}: {
  title: string;
  description: string;
  table: string; // 数据库表名
  columns: ListColumn[];
  fields: FormField[]; // 表单字段（新增/编辑用）
  addLabel?: string;
  // 等值过滤：异常中心"按类型子页"复用同一张表时按 type 过滤
  filter?: { field: string; value: string | number; op?: "eq" | "gt" | "gte" | "lt" | "lte" };
  stats?: {
    label: string;
    value?: string;
    tone?: "primary" | "success" | "warning" | "violet";
    // 动态统计：按某字段值统计数量（如 status === "待结算"），或按某字段求和
    countBy?: { field: string; value: string };
    sumBy?: { field: string };
  }[];
  statusKey?: string; // 状态字段名，用于 StatusBadge 渲染
  exportable?: boolean; // 是否显示导出按钮
  batchDelete?: boolean; // 是否启用批量删除（复选框 + 批量删除按钮）
  // 批量状态操作：勾选行后一键改状态（批量发布/下架/同步）
  batchActions?: { label: string; status: string }[];
}) {
  const { t } = useLanguage();
  const [keyword, setKeyword] = useState("");
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  // 排序 + 分页
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  // 弹窗状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    setError("");
    fetchTable(table, filter)
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [table, filter?.field, filter?.value]);

  const filtered = rows.filter((row) =>
    Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(keyword.toLowerCase()))
  );

  // 排序：点击表头切换 asc/desc
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv), "zh-Hans-CN");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const paged = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // 吊牌顶条颜色：集装箱信号橙 / 落箱绿 / 落日金 / 雾紫
  const toneClass = {
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    violet: "bg-chart-4",
  };

  const openAdd = () => {
    setEditing(null);
    setForm({});
    setDialogOpen(true);
  };

  const openEdit = (row: ExtRow) => {
    setEditing(row);
    const init: Record<string, string> = {};
    fields.forEach((f) => {
      init[f.key] = String(row[f.key] ?? "");
    });
    setForm(init);
    setDialogOpen(true);
  };

  const setField = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    // 校验必填
    for (const f of fields) {
      if (f.required && !form[f.key]?.trim()) {
        setError(t("common.required", { label: f.label }));
        return;
      }
    }
    setSaving(true);
    setError("");
    try {
      // 数值字段转 number
      const payload: Record<string, unknown> = {};
      fields.forEach((f) => {
        const v = form[f.key] ?? "";
        if (v === "") return; // 空值不发送，走数据库默认值（not null 列传 null 会被 PostgREST 400 拒绝）
        if (f.type === "number") {
          payload[f.key] = Number(v);
        } else {
          payload[f.key] = v;
        }
      });
      if (editing) {
        await updateRow(table, editing.id, payload);
      } else {
        await insertRow(table, payload);
      }
      setDialogOpen(false);
      toast.success(editing ? t("common.saved") : t("common.created"));
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setError("");
    try {
      await deleteRow(table, deleting.id);
      setDeleting(null);
      toast.success(t("common.deleted"));
      load();
    } catch (e) {
      setError((e as Error).message);
      setDeleting(null);
    }
  };

  const handleExport = () => {
    const headers = columns.map((c) => c.label);
    const data = filtered.map((row) => columns.map((c) => String(row[c.key] ?? "")));
    exportToCsv(title, headers, data);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (prev.size === filtered.length && filtered.length > 0) return new Set();
      return new Set(filtered.map((r) => r.id));
    });
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    setBatchDeleting(true);
    setError("");
    try {
      for (const id of Array.from(selected)) {
        await deleteRow(table, id);
      }
      setSelected(new Set());
      toast.success(t("common.batchDeleted", { count: selected.size }));
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBatchDeleting(false);
    }
  };

  const [batchActionLoading, setBatchActionLoading] = useState<string | null>(null);
  const handleBatchStatus = async (label: string, status: string) => {
    if (selected.size === 0) return;
    const n = selected.size;
    setBatchActionLoading(label);
    setError("");
    try {
      for (const id of Array.from(selected)) {
        await updateRow(table, id, { status });
      }
      setSelected(new Set());
      toast.success(`${label} · ${t("common.batchUpdated", { count: n })}`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBatchActionLoading(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t(title)}
        description={t(description)}
        actions={
          <div className="flex items-center gap-2">
            {exportable && (
              <Button variant="outline" size="sm" onClick={handleExport}>
                <Download size={15} /> {t("common.export")}
              </Button>
            )}
            {addLabel && (
              <Button size="sm" onClick={openAdd}>
                <Plus size={15} /> {t(addLabel)}
              </Button>
            )}
          </div>
        }
      />

      {stats && stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => {
            // 动态统计：优先按 countBy/sumBy 从已加载数据实时计算，否则用静态 value
            let display = s.value ?? "0";
            if (s.countBy) {
              display = String(rows.filter((r) => String(r[s.countBy!.field] ?? "") === s.countBy!.value).length);
            } else if (s.sumBy) {
              display = rows.reduce((sum, r) => sum + (Number(r[s.sumBy!.field]) || 0), 0).toFixed(2);
            }
            return (
              <div
                key={s.label}
                className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-soft"
              >
                <span
                  className={`absolute inset-x-0 top-0 h-[3px] ${toneClass[s.tone ?? "primary"]}`}
                />
                <p className="text-xs text-muted-foreground">{t(s.label)}</p>
                <p className="font-data mt-1 text-xl font-semibold tracking-tight text-ink">{display}</p>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-600">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t("common.search")} value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} className="pl-9" />
        </div>
        {batchActions && batchActions.length > 0 && selected.size > 0 && (
          batchActions.map((a) => (
            <Button
              key={a.label}
              variant="outline"
              size="sm"
              onClick={() => handleBatchStatus(a.label, a.status)}
              disabled={batchActionLoading !== null}
            >
              {batchActionLoading === a.label && <Loader2 size={14} className="mr-1 animate-spin" />}
              {a.label}
            </Button>
          ))
        )}
        {batchDelete && selected.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleBatchDelete}
            disabled={batchDeleting}
          >
            {batchDeleting && <Loader2 size={14} className="mr-1 animate-spin" />}
            {t("common.batchDelete", { count: selected.size })}
          </Button>
        )}
        <div className="ml-auto text-sm text-muted-foreground">{t("common.total", { count: filtered.length })}</div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              {batchDelete && (
                <th className="w-10 px-4 py-3">
                  <Checkbox
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
              )}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="cursor-pointer select-none whitespace-nowrap px-4 py-3 font-medium hover:text-foreground"
                  onClick={() => handleSort(c.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {t(c.label)}
                    {sortKey === c.key &&
                      (sortDir === "asc" ? (
                        <ArrowUp size={12} className="text-primary" />
                      ) : (
                        <ArrowDown size={12} className="text-primary" />
                      ))}
                  </span>
                </th>
              ))}
              <th className="px-4 py-3 text-right font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
                  {t("common.loading")}
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-muted-foreground">
                  {addLabel ? t("common.emptyHint", { label: t(addLabel) }) : t("common.empty")}
                </td>
              </tr>
            ) : (
              paged.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  {batchDelete && (
                    <td className="px-4 py-3">
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggleSelect(row.id)}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-3">
                      {c.render ? (
                        c.render(row as Record<string, string>)
                      ) : c.key === statusKey ? (
                        <StatusBadge status={String(row[c.key] ?? "")} />
                      ) : (
                        <span className="text-muted-foreground">{String(row[c.key] ?? "")}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                        <Pencil size={15} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-600 hover:text-rose-600"
                        onClick={() => setDeleting(row)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 分页栏 */}
      {!loading && sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <span className="text-xs text-muted-foreground">
            {t("common.pageInfo", { page, pageCount, total: sorted.length })}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={14} /> {t("common.prev")}
            </Button>
            <span className="min-w-10 text-center text-sm text-muted-foreground">
              {page} / {pageCount}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
              {t("common.next")} <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t("common.edit") : (addLabel ? t(addLabel) : t("common.add"))}</DialogTitle>
            <DialogDescription>{editing ? t("common.editDesc") : t("common.addDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {fields.map((f) => (
              <div key={f.key} className="grid gap-1.5">
                <Label htmlFor={`field-${f.key}`}>
                  {t(f.label)}
                  {f.required && <span className="text-rose-500"> *</span>}
                </Label>
                {f.type === "select" ? (
                  <select
                    id={`field-${f.key}`}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">{t("common.pleaseSelect")}</option>
                    {(f.options ?? []).map((o) => (
                      <option key={typeof o === "string" ? o : o.value} value={typeof o === "string" ? o : o.value}>
                        {typeof o === "string" ? t(o) : o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    id={`field-${f.key}`}
                    type={f.type === "number" ? "number" : "text"}
                    placeholder={f.placeholder ? t(f.placeholder) : undefined}
                    value={form[f.key] ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirmDelete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("common.confirmDeleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}