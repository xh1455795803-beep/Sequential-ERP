import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Wallet, CalendarDays, Layers, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, insertRow, updateRow, deleteRow, type ExtRow } from "@/lib/data-access";
import { toast } from "sonner";
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

export const Route = createFileRoute("/_layout/finance/fee")({
  component: Fee,
});

const emptyForm = { name: "", category: "平台费用", amount: "", created_at: "" };
const CATEGORIES = ["平台费用", "仓储费", "广告费", "物流费"];
const CATEGORY_STYLE: Record<string, string> = {
  平台费用: "border-violet-200 bg-violet-50 text-violet-600",
  仓储费: "border-amber-200 bg-amber-50 text-amber-600",
  广告费: "border-sky-200 bg-sky-50 text-sky-600",
  物流费: "border-emerald-200 bg-emerald-50 text-emerald-600",
};

function Fee() {
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    fetchTable("fees")
      .then(setRows)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const stats = useMemo(() => {
    const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthTotal = rows
      .filter((r) => String(r.created_at ?? "").startsWith(month))
      .reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const catCount = new Set(rows.map((r) => String(r.category ?? ""))).size;
    return { total, monthTotal, catCount };
  }, [rows]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row: ExtRow) => {
    setEditing(row);
    setForm({
      name: String(row.name ?? ""),
      category: String(row.category ?? "平台费用"),
      amount: String(row.amount ?? ""),
      created_at: String(row.created_at ?? ""),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("请填写费用项名称");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category,
        amount: Number(form.amount) || 0,
        created_at: form.created_at.trim(),
      };
      if (editing) await updateRow("fees", editing.id, payload);
      else await insertRow("fees", payload);
      setDialogOpen(false);
      load();
      toast.success("费用已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("fees", deleting.id);
      setDeleting(null);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
      setDeleting(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="费用管理"
        description="各类平台费用统一管理"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={15} className="mr-1.5" /> 新增费用
          </Button>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="费用总额" value={`$${(stats.total).toLocaleString()}`} icon={<Wallet size={17} />} tone="primary" />
        <StatCard label="本月费用" value={`$${(stats.monthTotal).toLocaleString()}`} icon={<CalendarDays size={17} />} tone="violet" />
        <StatCard label="费用类别" value={String(stats.catCount)} icon={<Layers size={17} />} tone="warning" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">费用项</th>
              <th className="px-4 py-3 font-medium">类别</th>
              <th className="px-4 py-3 font-medium">金额</th>
              <th className="px-4 py-3 font-medium">日期</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> 加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">暂无费用记录，点击「新增费用」添加</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{String(row.name ?? "")}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${CATEGORY_STYLE[String(row.category ?? "")] ?? "border-border bg-muted text-muted-foreground"}`}>
                      <Tag size={11} /> {String(row.category ?? "")}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">${(Number(row.amount) || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(row.created_at ?? "")}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
                        <Pencil size={15} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600 hover:text-rose-600" onClick={() => setDeleting(row)}>
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

      {/* 新增/编辑弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "编辑费用" : "新增费用"}</DialogTitle>
            <DialogDescription>记录平台月租、仓储、广告与物流等费用</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>费用项 <span className="text-rose-500">*</span></Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：平台月租费" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>类别</Label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {CATEGORIES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>金额</Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="如：39.99" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>日期</Label>
              <Input value={form.created_at} onChange={(e) => setForm({ ...form, created_at: e.target.value })} placeholder="如：2026-09-22" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除？</AlertDialogTitle>
            <AlertDialogDescription>删除后该费用记录将被移除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-rose-600 hover:bg-rose-700">删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
