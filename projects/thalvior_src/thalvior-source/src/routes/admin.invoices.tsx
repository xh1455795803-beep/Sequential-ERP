import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Search, Receipt, FileText, CheckCircle2, XCircle, Ban, FilePlus2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { fetchTable, callRpc, type ExtRow } from "@/lib/data-access";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/i18n/LanguageContext"
import { fmtDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/admin/invoices")({
  component: AdminInvoices,
});

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "fin.inv.statusPending", cls: "border-warning/30 bg-warning-bg text-warning" },
  issued: { label: "fin.inv.statusIssued", cls: "border-success/30 bg-success-bg text-success" },
  rejected: { label: "fin.inv.statusRejected", cls: "border-destructive/30 bg-danger-bg text-destructive" },
  void: { label: "fin.inv.void", cls: "border-border bg-muted text-muted-foreground" },
};

const CONTENT_I18N: Record<string, string> = {
  "软件订阅服务费": "fin.inv.contentSubscription",
  "平台积分充值": "fin.inv.contentCredits",
  "平台技术服务费": "fin.inv.contentPlatform",
  "信息技术服务费": "fin.inv.contentOther",
};

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? "—" : fmtDateTime(d, lang);
}

function AdminInvoices() {
  const {  t , lang } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [keyword, setKeyword] = useState("");

  // 开票弹窗
  const [issueRow, setIssueRow] = useState<ExtRow | null>(null);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  // 驳回弹窗
  const [rejectRow, setRejectRow] = useState<ExtRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    // 视图 v_admin_invoices：definer 绕 RLS，内部 has_role(admin) 过滤；含申请人账号邮箱
    fetchTable("v_admin_invoices")
      .then((list) =>
        setRows(
          [...list].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
        )
      )
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: rows.length, pending: 0, issued: 0, rejected: 0, void: 0 };
    rows.forEach((r) => {
      const s = String(r.status ?? "");
      if (c[s] !== undefined) c[s] += 1;
    });
    return c;
  }, [rows]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (tab !== "all") list = list.filter((r) => String(r.status ?? "") === tab);
    const kw = keyword.trim().toLowerCase();
    if (kw) {
      list = list.filter((r) =>
        [String(r.applicant_email ?? ""), String(r.title ?? ""), String(r.invoice_no ?? "")]
          .join(" ")
          .toLowerCase()
          .includes(kw),
      );
    }
    return list;
  }, [rows, tab, keyword]);

  const TABS = [
    { key: "all", label: t("fin.invadm.tabAll") },
    { key: "pending", label: t("fin.inv.statusPending") },
    { key: "issued", label: t("fin.inv.statusIssued") },
    { key: "rejected", label: t("fin.inv.statusRejected") },
    { key: "void", label: t("fin.inv.void") },
  ];

  const openIssue = (row: ExtRow) => {
    setIssueRow(row);
    setInvoiceNo("");
    setFileUrl("");
  };

  const openReject = (row: ExtRow) => {
    setRejectRow(row);
    setRejectReason("");
  };

  const handleIssue = async () => {
    const no = invoiceNo.trim();
    if (!no) {
      toast.error(t("fin.invadm.invoiceNoRequired"));
      return;
    }
    const url = fileUrl.trim();
    if (url && !/^https?:\/\//.test(url)) {
      toast.error(t("fin.invadm.fileUrlInvalid"));
      return;
    }
    setSaving(true);
    try {
      await callRpc<string>("request_invoice_issue", {
        p_invoice_id: issueRow?.id,
        p_invoice_no: no,
        p_file_url: url || null,
      });
      setIssueRow(null);
      load();
      toast.success(t("fin.inv.toast.issued", { no }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("fin.invadm.toast.failed"));
    } finally {
      setSaving(false);
    }
  };

  const handleReject = async () => {
    const reason = rejectReason.trim();
    if (!reason) {
      toast.error(t("fin.invadm.reasonRequired"));
      return;
    }
    if (reason.length > 200) {
      toast.error(t("fin.invadm.reasonTooLong"));
      return;
    }
    setSaving(true);
    try {
      await callRpc<string>("request_invoice_reject", {
        p_invoice_id: rejectRow?.id,
        p_reason: reason,
      });
      setRejectRow(null);
      load();
      toast.success(t("fin.invadm.toast.rejected"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("fin.invadm.toast.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("fin.invadm.title")}
        description={t("fin.invadm.desc")}
        actions={
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground">
            <Receipt size={15} /> {counts.all} {t("fin.invadm.countUnit")}
          </span>
        }
      />

      {/* 状态筛选 + 搜索 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-sm transition-colors",
                tab === item.key
                  ? "border-primary/40 bg-primary/10 font-medium text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
              <span className="ml-1.5 text-xs opacity-70">{counts[item.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("fin.invadm.searchPh")}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* 发票列表 */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("fin.invadm.colApplicant")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colType")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colTitle")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colAmount")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colContent")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colStatus")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colNo")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.invadm.colAppliedAt")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> {t("fin.loading")}
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground">
                  {keyword ? t("fin.invadm.noMatch") : t("fin.invadm.empty")}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const status = String(row.status ?? "");
                const meta = STATUS_META[status] ?? { label: status, cls: "border-border bg-muted text-muted-foreground" };
                const voided = status === "void";
                const contentKey = CONTENT_I18N[String(row.content ?? "")];
                const fileUrl = String(row.file_url ?? "");
                return (
                  <tr key={row.id} className={`border-b border-border transition-colors last:border-0 hover:bg-muted/60 ${voided ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="max-w-[200px] truncate text-xs text-muted-foreground" title={String(row.applicant_email ?? "")}>
                        {String(row.applicant_email ?? "—")}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {String(row.invoice_type ?? "normal") === "special" ? t("fin.inv.typeSpecial") : t("fin.inv.typeNormal")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-[220px] truncate font-medium" title={String(row.title ?? "")}>{String(row.title ?? "")}</div>
                      {String(row.title_type ?? "") === "corporate" && (
                        <div className="max-w-[220px] truncate font-mono text-xs text-muted-foreground" title={String(row.tax_no ?? "")}>
                          {String(row.tax_no ?? "")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold">¥{(Number(row.amount) || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">{contentKey ? t(contentKey) : String(row.content ?? "")}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                        {status === "issued" ? <CheckCircle2 size={11} /> : status === "rejected" ? <XCircle size={11} /> : status === "void" ? <Ban size={11} /> : <FilePlus2 size={11} />}
                        {t(meta.label)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {status === "issued" ? (
                        <div className="max-w-[180px] truncate font-mono text-xs font-medium" title={String(row.invoice_no ?? "")}>
                          {String(row.invoice_no ?? "—")}
                        </div>
                      ) : status === "rejected" ? (
                        <div className="max-w-[180px] truncate text-xs text-destructive" title={String(row.reject_reason ?? "")}>
                          {String(row.reject_reason ?? "") || "—"}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(row.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        {status === "pending" && (
                          <>
                            <Button size="sm" className="h-7 px-2.5 text-xs" onClick={() => openIssue(row)}>
                              <FileText size={12} className="mr-1" /> {t("fin.invadm.issueBtn")}
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs text-destructive hover:text-destructive" onClick={() => openReject(row)}>
                              <XCircle size={12} className="mr-1" /> {t("fin.invadm.rejectBtn")}
                            </Button>
                          </>
                        )}
                        {status === "issued" && fileUrl && /^https?:\/\//.test(fileUrl) && (
                          <a href={fileUrl} target="_blank" rel="noreferrer" className="inline-flex">
                            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs">
                              <ExternalLink size={12} className="mr-1" /> {t("fin.invadm.viewFile")}
                            </Button>
                          </a>
                        )}
                        {status === "issued" && !fileUrl && <span className="text-muted-foreground">—</span>}
                        {(status === "void") && <span className="text-muted-foreground">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 开票弹窗 */}
      <Dialog open={!!issueRow} onOpenChange={(o) => !o && setIssueRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("fin.invadm.issueTitle")}</DialogTitle>
            <DialogDescription>{t("fin.invadm.issueDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("fin.inv.colTitle")}</span>
                <span className="max-w-[240px] truncate font-medium">{String(issueRow?.title ?? "")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("fin.inv.colAmount")}</span>
                <span className="font-semibold">¥{(Number(issueRow?.amount) || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("fin.inv.labelEmail")}</span>
                <span className="max-w-[240px] truncate">{String(issueRow?.email ?? "—")}</span>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>
                {t("fin.invadm.labelInvoiceNo")} <span className="text-destructive">*</span>
              </Label>
              <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder={t("fin.invadm.invoiceNoPh")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("fin.invadm.labelFileUrl")}</Label>
              <Input value={fileUrl} onChange={(e) => setFileUrl(e.target.value)} placeholder={t("fin.invadm.fileUrlPh")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueRow(null)}>{t("common.cancel")}</Button>
            <Button onClick={handleIssue} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
              {t("fin.inv.confirmIssue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 驳回弹窗 */}
      <Dialog open={!!rejectRow} onOpenChange={(o) => !o && setRejectRow(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("fin.invadm.rejectTitle")}</DialogTitle>
            <DialogDescription>{t("fin.invadm.rejectDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("fin.inv.colTitle")}</span>
                <span className="max-w-[240px] truncate font-medium">{String(rejectRow?.title ?? "")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("fin.inv.colAmount")}</span>
                <span className="font-semibold">¥{(Number(rejectRow?.amount) || 0).toLocaleString()}</span>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>
                {t("fin.inv.colRejectReason")} <span className="text-destructive">*</span>
              </Label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t("fin.invadm.reasonPh")}
                rows={3}
                maxLength={200}
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectRow(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" onClick={handleReject} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}
              {t("fin.invadm.confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
