import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, ReceiptText, Clock, CheckCircle2, Landmark, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
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

export const Route = createFileRoute("/_layout/finance/")({
  component: Finance,
});

const emptyForm = { bill_no: "", type: "平台佣金", amount: "", created_at: "", status: "待支付" };
const TYPES = ["平台佣金", "物流费用", "广告费用", "销售收入"];
const STATUSES = ["待支付", "待结算", "已结算", "已入账"];

function Finance() {
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ExtRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<ExtRow | null>(null);

  const load = () => {
    setLoading(true);
    fetchTable("bills")
      .then(setRows)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const stats = useMemo(() => {
    const total = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const pending = rows.filter((r) => r.status === "待支付" || r.status === "待结算").length;
    const settled = rows.filter((r) => r.status === "已结算").length;
    const booked = rows.filter((r) => r.status === "已入账").length;
    return { total, pending, settled, booked };
  }, [rows]);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEdit = (row: ExtRow) => {
    setEditing(row);
    setForm({
      bill_no: String(row.bill_no ?? ""),
      type: String(row.type ?? "平台佣金"),
      amount: String(row.amount ?? ""),
      created_at: String(row.created_at ?? ""),
      status: String(row.status ?? "待支付"),
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.bill_no.trim()) {
      toast.error("请填写账单编号");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        bill_no: form.bill_no.trim(),
        type: form.type,
        amount: Number(form.amount) || 0,
        created_at: form.created_at.trim(),
        status: form.status,
      };
      if (editing) await updateRow("bills", editing.id, payload);
      else await insertRow("bills", payload);
      setDialogOpen(false);
      load();
      toast.success("账单已保存");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await deleteRow("bills", deleting.id);
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
        title="账单明细"
        description="精细化财务核算，自动生成账单明细"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={15} className="mr-1.5" /> 新增账单
          </Button>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="账单总额" value={`$${(stats.total).toLocaleString()}`} icon={<ReceiptText size={17} />} tone="primary" />
        <StatCard label="待支付/待结算" value={String(stats.pending)} icon={<Clock size={17} />} tone="warning" />
        <StatCard label="已结算" value={String(stats.settled)} icon={<CheckCircle2 size={17} />} tone="success" />
        <StatCard label="已入账" value={String(stats.booked)} icon={<Landmark size={17} />} tone="violet" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">账单编号</th>
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 font-medium">金额</th>
              <th className="px-4 py-3 font-medium">日期</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> 加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">暂无账单，点击「新增账单」添加</td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3 font-mono text-xs font-medium">{String(row.bill_no ?? "")}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium border-violet-200 bg-violet-50 text-violet-600">
                      {String(row.type ?? "")}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-semibold">${(Number(row.amount) || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-muted-foreground">{String(row.created_at ?? "")}</td>
                  <td className="px-4 py-3"><StatusBadge status={String(row.status ?? "")} /></td>
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
            <DialogTitle>{editing ? "编辑账单" : "新增账单"}</DialogTitle>
            <DialogDescription>记录平台费用与销售收入明细</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>账单编号 <span className="text-rose-500">*</span></Label>
                <Input value={form.bill_no} onChange={(e) => setForm({ ...form, bill_no: e.target.value })} placeholder="如：BL20260922001" />
              </div>
              <div className="grid gap-1.5">
                <Label>类型</Label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {TYPES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>金额</Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="如：1240.50" />
              </div>
              <div className="grid gap-1.5">
                <Label>日期</Label>
                <Input value={form.created_at} onChange={(e) => setForm({ ...form, created_at: e.target.value })} placeholder="如：2026-09-22" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>状态</Label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
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
            <AlertDialogDescription>删除后该账单记录将被移除。</AlertDialogDescription>
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
