import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Loader2, FileText, Wallet, Hourglass, BadgeCheck, XCircle, CheckCircle2, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, insertRow, updateRow, type ExtRow } from "@/lib/data-access";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_layout/finance/invoice")({
  component: Invoice,
});

const emptyForm = {
  invoice_type: "normal",
  title_type: "personal",
  title: "",
  tax_no: "",
  amount: "",
  content: "信息技术服务费",
  email: "",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "待开票", cls: "border-amber-200 bg-amber-50 text-amber-600" },
  issued: { label: "已开票", cls: "border-emerald-200 bg-emerald-50 text-emerald-600" },
  rejected: { label: "已驳回", cls: "border-rose-200 bg-rose-50 text-rose-600" },
};

function Invoice() {
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [quota, setQuota] = useState<ExtRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [issuingId, setIssuingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetchTable("invoices"),
      fetchTable("invoice_quota").catch(() => [] as ExtRow[]),
    ])
      .then(([inv, q]) => {
        setRows(inv);
        setQuota(Array.isArray(q) && q.length > 0 ? q[0] : null);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const stats = useMemo(() => {
    const pending = rows.filter((r) => r.status === "pending").length;
    const issued = rows.filter((r) => r.status === "issued").length;
    const issuedAmt = rows.filter((r) => r.status === "issued").reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const available = Number(quota?.available_amount ?? 0);
    return { pending, issued, issuedAmt, available };
  }, [rows, quota]);

  const openAdd = () => {
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error("请填写发票抬头");
      return;
    }
    if (!(Number(form.amount) > 0)) {
      toast.error("请填写开票金额");
      return;
    }
    setSaving(true);
    try {
      await insertRow("invoices", {
        invoice_type: form.invoice_type,
        title_type: form.title_type,
        title: form.title.trim(),
        tax_no: form.tax_no.trim(),
        amount: Number(form.amount),
        content: form.content.trim(),
        email: form.email.trim(),
        status: "pending",
        order_nos: [],
      });
      setDialogOpen(false);
      load();
      toast.success("开票申请已提交");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSaving(false);
    }
  };

  // 确认开票：待开票 → 已开票，生成票号
  const handleIssue = async (row: ExtRow) => {
    setIssuingId(String(row.id));
    try {
      const ts = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const no = `IV${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}${Math.floor(1000 + Math.random() * 9000)}`;
      await updateRow("invoices", row.id, {
        status: "issued",
        invoice_no: no,
        issued_at: ts.toISOString(),
        file_url: "",
      });
      load();
      toast.success(`已开票：${no}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "开票失败");
    } finally {
      setIssuingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="发票管理"
        description="开票申请、额度查询与电子发票管理"
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={15} className="mr-1.5" /> 申请开票
          </Button>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="可开票额度" value={`$${stats.available.toLocaleString()}`} icon={<Wallet size={17} />} tone="primary" />
        <StatCard label="已开票金额" value={`$${stats.issuedAmt.toLocaleString()}`} icon={<FileText size={17} />} tone="success" />
        <StatCard label="待处理申请" value={String(stats.pending)} icon={<Hourglass size={17} />} tone="warning" />
        <StatCard label="已开票数" value={String(stats.issued)} icon={<BadgeCheck size={17} />} tone="violet" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">发票号</th>
              <th className="px-4 py-3 font-medium">类型</th>
              <th className="px-4 py-3 font-medium">抬头</th>
              <th className="px-4 py-3 font-medium">金额</th>
              <th className="px-4 py-3 font-medium">内容</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">驳回原因</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> 加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">暂无发票记录，点击「申请开票」提交</td>
              </tr>
            ) : (
              rows.map((row) => {
                const meta = STATUS_META[String(row.status ?? "")] ?? { label: String(row.status ?? ""), cls: "border-border bg-muted text-muted-foreground" };
                return (
                  <tr key={row.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3 font-mono text-xs font-medium">{String(row.invoice_no ?? "—")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.invoice_type ?? "normal") === "special" ? "增值税专用发票" : "增值税普通发票"}</td>
                    <td className="px-4 py-3 font-medium">{String(row.title ?? "")}</td>
                    <td className="px-4 py-3 font-semibold">${(Number(row.amount) || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.content ?? "")}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                        {row.status === "issued" ? <CheckCircle2 size={11} /> : row.status === "rejected" ? <XCircle size={11} /> : <FilePlus2 size={11} />}
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-rose-600">{String(row.reject_reason ?? "") || "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {row.status === "pending" && (
                          <Button size="sm" variant="outline" onClick={() => handleIssue(row)} disabled={issuingId === String(row.id)}>
                            {issuingId === String(row.id) ? <Loader2 size={14} className="mr-1 animate-spin" /> : <BadgeCheck size={14} className="mr-1" />}
                            确认开票
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 开票申请弹窗 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>申请开票</DialogTitle>
            <DialogDescription>提交后将进入开票队列，额度内可开票</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>发票类型</Label>
                <select
                  value={form.invoice_type}
                  onChange={(e) => setForm({ ...form, invoice_type: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="normal">增值税普通发票</option>
                  <option value="special">增值税专用发票</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>抬头类型</Label>
                <select
                  value={form.title_type}
                  onChange={(e) => setForm({ ...form, title_type: e.target.value })}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="personal">个人</option>
                  <option value="corporate">企业</option>
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>发票抬头 <span className="text-rose-500">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如：深圳市XX科技有限公司" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>税号</Label>
                <Input value={form.tax_no} onChange={(e) => setForm({ ...form, tax_no: e.target.value })} placeholder="企业抬头时填写" />
              </div>
              <div className="grid gap-1.5">
                <Label>开票金额 <span className="text-rose-500">*</span></Label>
                <Input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="如：199" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>开票内容</Label>
              <Input value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="如：信息技术服务费" />
            </div>
            <div className="grid gap-1.5">
              <Label>接收邮箱</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="如：billing@example.com" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}提交申请
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
