import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Plus, Loader2, FileText, Wallet, Hourglass, BadgeCheck, XCircle, CheckCircle2, FilePlus2, Ban, Eye, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, StatCard } from "@/components/page-header";
import { fetchTable, callRpc, type ExtRow } from "@/lib/data-access";
import { supabase } from "@/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/LanguageContext"
import { fmtDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/_layout/finance/invoice")({
  component: Invoice,
});

// 发票申请只允许填写抬头信息；金额/内容/订单由服务端依据已支付订单计算，不接收前端输入
const emptyForm = {
  invoice_type: "normal",
  title_type: "personal",
  title: "",
  tax_no: "",
  email: "",
  remark: "",
};

// 统一社会信用代码：15 位（老版）/ 18 位（GB 32100-2015 字符集）/ 20 位（新一代）
const TAX_NO_RE = /^(?:[0-9A-Z]{15}|[0-9A-HJ-NPQRTUWXY]{18}|[0-9A-Z]{20})$/;

// 电子发票交付邮箱：企业/个人抬头均必填（电子发票通过邮箱交付）
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "fin.inv.statusPending", cls: "border-warning/30 bg-warning-bg text-warning" },
  issued: { label: "fin.inv.statusIssued", cls: "border-success/30 bg-success-bg text-success" },
  rejected: { label: "fin.inv.statusRejected", cls: "border-destructive/30 bg-danger-bg text-destructive" },
  void: { label: "fin.inv.void", cls: "border-border bg-muted text-muted-foreground" },
};

// 支付单用途 → 文案 key（与服务端 invoice_paid_sources.usage_kind 对应）
const USAGE_I18N: Record<string, string> = {
  subscription: "fin.inv.usage.subscription",
  credits: "fin.inv.usage.credits",
  platform: "fin.inv.usage.platform",
  other: "fin.inv.usage.other",
};

// 开票内容（服务端写入的中文枚举值）→ 文案 key，EN 模式显示英文
const CONTENT_I18N: Record<string, string> = {
  "软件订阅服务费": "fin.inv.contentSubscription",
  "平台积分充值": "fin.inv.contentCredits",
  "平台技术服务费": "fin.inv.contentPlatform",
  "信息技术服务费": "fin.inv.contentOther",
};

// 勾选单混合用途时的开票内容优先级（与服务端 request_invoice 映射一致）
const USAGE_CONTENT_PRIORITY = ["subscription", "platform", "credits", "other"];
const USAGE_TO_CONTENT_KEY: Record<string, string> = {
  subscription: "fin.inv.contentSubscription",
  platform: "fin.inv.contentPlatform",
  credits: "fin.inv.contentCredits",
  other: "fin.inv.contentOther",
};

function fmtDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

function fmtDtLocal(v: unknown): string {
  if (!v) return "—";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? "—" : fmtDtLocal(d);
}

// 支付单用途推导（与后端 usage_kind/开票内容映射一致）
function usageKeyOf(o: ExtRow): string {
  if (o.plan_id) return "fin.inv.usage.subscription";
  const pkg = String(o.package_code ?? "");
  if (pkg && !pkg.startsWith("credits")) return "fin.inv.usage.platform";
  if ((pkg && pkg.startsWith("credits")) || o.credits_granted) return "fin.inv.usage.credits";
  return "fin.inv.usage.other";
}

function Invoice() {
  const {  t , lang } = useLanguage();
  const [rows, setRows] = useState<ExtRow[]>([]);
  const [quota, setQuota] = useState<ExtRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // 可开票支付单（弹窗内数据源）
  const [sources, setSources] = useState<ExtRow[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 详情弹窗
  const [detailRow, setDetailRow] = useState<ExtRow | null>(null);
  const [detailOrders, setDetailOrders] = useState<ExtRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

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

  // 打开申请弹窗：拉取本人可开票支付单（paid 且未被活动发票引用）
  const openAdd = () => {
    setForm(emptyForm);
    setSelected(new Set());
    setDialogOpen(true);
    setSourcesLoading(true);
    fetchTable("invoice_paid_sources")
      .then((list) => setSources(list))
      .catch((e) => toast.error(e.message))
      .finally(() => setSourcesLoading(false));
  };

  const toggleSource = (orderNo: string, used: boolean) => {
    if (used) return; // 已被 pending/issued 发票引用的支付单不可再勾选
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderNo)) next.delete(orderNo);
      else next.add(orderNo);
      return next;
    });
  };

  // 已勾选支付单合计（只读展示；提交后由服务端重新计算，前端值仅作预览）
  const selectedTotal = useMemo(
    () => sources.filter((s) => selected.has(String(s.order_no))).reduce((a, s) => a + (Number(s.amount) || 0), 0),
    [sources, selected],
  );

  // 自动开票内容预览：按用途优先级映射（真实值由服务端写入）
  const autoContentKey = useMemo(() => {
    const kinds = new Set(
      sources.filter((s) => selected.has(String(s.order_no))).map((s) => String(s.usage_kind ?? "other")),
    );
    const kind = USAGE_CONTENT_PRIORITY.find((k) => kinds.has(k));
    return kind ? USAGE_TO_CONTENT_KEY[kind] : null;
  }, [sources, selected]);

  // 打开详情弹窗：发票全字段 + 关联支付订单清单（invoice_links → payment_orders）
  const openDetail = (row: ExtRow) => {
    setDetailRow(row);
    setDetailOrders([]);
    setDetailLoading(true);
    fetchTable("invoice_links", { field: "invoice_id", value: row.id })
      .then(async (links) => {
        const nos = links.map((l) => String(l.payment_order_no ?? "")).filter(Boolean);
        if (nos.length === 0) return [] as ExtRow[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from("payment_orders")
          .select("order_no,amount,status,paid_at,plan_id,package_code,credits_granted")
          .in("order_no", nos);
        if (error) throw new Error(error.message);
        return (data ?? []) as ExtRow[];
      })
      .then((orders) => setDetailOrders(orders))
      .catch((e) => toast.error(e.message))
      .finally(() => setDetailLoading(false));
  };

  const handleSave = async () => {
    if (selected.size === 0) {
      toast.error(t("fin.inv.toast.noOrdersSelected"));
      return;
    }
    if (!form.title.trim()) {
      toast.error(t("fin.inv.toast.titleRequired"));
      return;
    }
    // 企业抬头：税号必填，且须符合统一社会信用代码格式（15/18/20 位）
    const taxNo = form.tax_no.trim().toUpperCase();
    if (form.title_type === "corporate") {
      if (!taxNo) {
        toast.error(t("fin.inv.toast.taxNoRequired"));
        return;
      }
      if (!TAX_NO_RE.test(taxNo)) {
        toast.error(t("fin.inv.toast.taxNoInvalid"));
        return;
      }
    }
    // 邮箱：电子发票交付通道，企业/个人抬头均必填，且须符合邮箱格式
    const email = form.email.trim();
    if (!email) {
      toast.error(t("fin.inv.toast.emailRequired"));
      return;
    }
    if (!EMAIL_RE.test(email)) {
      toast.error(t("fin.inv.toast.emailInvalid"));
      return;
    }
    setSaving(true);
    try {
      await callRpc<string>("request_invoice", {
        p_order_nos: Array.from(selected),
        p_invoice_type: form.invoice_type,
        p_title_type: form.title_type,
        p_title: form.title.trim(),
        p_tax_no: taxNo,
        p_email: email,
        p_remark: form.remark.trim(),
      });
      setDialogOpen(false);
      load();
      toast.success(t("fin.inv.toast.submitted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("fin.inv.toast.submitFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("fin.inv.title")}
        description={t("fin.inv.desc")}
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus size={15} className="mr-1.5" /> {t("fin.inv.apply")}
          </Button>
        }
      />

      {/* 统计卡 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label={t("fin.inv.statQuota")} value={`¥${stats.available.toLocaleString()}`} icon={<Wallet size={17} />} tone="primary" />
        <StatCard label={t("fin.inv.statIssuedAmt")} value={`¥${stats.issuedAmt.toLocaleString()}`} icon={<FileText size={17} />} tone="success" />
        <StatCard label={t("fin.inv.statPending")} value={String(stats.pending)} icon={<Hourglass size={17} />} tone="warning" />
        <StatCard label={t("fin.inv.statIssuedCount")} value={String(stats.issued)} icon={<BadgeCheck size={17} />} tone="violet" />
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t("fin.inv.colNo")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colType")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colTitle")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colAmount")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colContent")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colStatus")}</th>
              <th className="px-4 py-3 font-medium">{t("fin.inv.colRejectReason")}</th>
              <th className="px-4 py-3 text-right font-medium">{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                  <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> {t("fin.loading")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">{t("fin.inv.empty")}</td>
              </tr>
            ) : (
              rows.map((row) => {
                const status = String(row.status ?? "");
                const meta = STATUS_META[status] ?? { label: status, cls: "border-border bg-muted text-muted-foreground" };
                const voided = status === "void";
                const contentKey = CONTENT_I18N[String(row.content ?? "")];
                return (
                  <tr key={row.id} className={`border-b border-border transition-colors last:border-0 hover:bg-muted/60 ${voided ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs font-medium">{String(row.invoice_no ?? "—")}</td>
                    <td className="px-4 py-3 text-muted-foreground">{String(row.invoice_type ?? "normal") === "special" ? t("fin.inv.typeSpecial") : t("fin.inv.typeNormal")}</td>
                    <td className="px-4 py-3 font-medium">{String(row.title ?? "")}</td>
                    <td className="px-4 py-3 font-semibold">¥{(Number(row.amount) || 0).toLocaleString()}</td>
                    <td className="px-4 py-3 text-muted-foreground">{contentKey ? t(contentKey) : String(row.content ?? "")}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${meta.cls}`}>
                        {status === "issued" ? <CheckCircle2 size={11} /> : status === "rejected" ? <XCircle size={11} /> : status === "void" ? <Ban size={11} /> : <FilePlus2 size={11} />}
                        {t(meta.label)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-destructive">
                      {voided ? String(row.void_reason ?? row.reject_reason ?? "") || "—" : String(row.reject_reason ?? "") || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openDetail(row)}>
                          <Eye size={12} className="mr-1" /> {t("fin.inv.detail")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 详情弹窗：票面全字段 + 关联支付订单清单 */}
      <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("fin.inv.detailTitle")}</DialogTitle>
            <DialogDescription>
              {String(detailRow?.invoice_no ?? "") || t("fin.inv.statusPending")}
            </DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="grid gap-4 py-2">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.colNo")}</div>
                  <div className="font-mono font-medium">{String(detailRow.invoice_no ?? "—")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.colStatus")}</div>
                  <div className="font-medium">{t((STATUS_META[String(detailRow.status ?? "")] ?? { label: "fin.inv.void" }).label)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.labelType")}</div>
                  <div>{String(detailRow.invoice_type ?? "normal") === "special" ? t("fin.inv.typeSpecial") : t("fin.inv.typeNormal")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.labelTitleType")}</div>
                  <div>{String(detailRow.title_type ?? "personal") === "corporate" ? t("fin.inv.corporate") : t("fin.inv.personal")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.labelTitle")}</div>
                  <div className="font-medium">{String(detailRow.title ?? "—")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.labelTaxNo")}</div>
                  <div className="font-mono text-xs">{String(detailRow.tax_no ?? "—")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.labelAmount")}</div>
                  <div className="font-semibold">¥{(Number(detailRow.amount) || 0).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.labelContent")}</div>
                  <div>{CONTENT_I18N[String(detailRow.content ?? "")] ? t(CONTENT_I18N[String(detailRow.content ?? "")]) : String(detailRow.content ?? "—")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.labelEmail")}</div>
                  <div className="truncate">{String(detailRow.email ?? "—")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.labelRemark")}</div>
                  <div className="truncate" title={String(detailRow.remark ?? "")}>{String(detailRow.remark ?? "—")}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.detailAppliedAt")}</div>
                  <div>{fmtDtLocal(detailRow.created_at)}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("fin.inv.detailIssuedAt")}</div>
                  <div>{fmtDtLocal(detailRow.issued_at)}</div>
                </div>
                {String(detailRow.status ?? "") === "rejected" && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">{t("fin.inv.colRejectReason")}</div>
                    <div className="text-destructive">{String(detailRow.reject_reason ?? "—")}</div>
                  </div>
                )}
                {String(detailRow.status ?? "") === "void" && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">{t("fin.inv.voidReason")}</div>
                    <div className="text-muted-foreground">{String(detailRow.void_reason ?? "—")}</div>
                  </div>
                )}
                {String(detailRow.status ?? "") === "issued" && String(detailRow.file_url ?? "") && /^https?:\/\//.test(String(detailRow.file_url)) && (
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground">{t("fin.inv.detailFileUrl")}</div>
                    <a href={String(detailRow.file_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                      <ExternalLink size={13} /> {t("fin.invadm.viewFile")}
                    </a>
                  </div>
                )}
              </div>

              {/* 关联支付订单清单 */}
              <div className="grid gap-1.5">
                <Label>{t("fin.inv.detailOrders")}</Label>
                <div className="overflow-hidden rounded-lg border border-border">
                  {detailLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                      <Loader2 size={15} className="animate-spin" /> {t("fin.loading")}
                    </div>
                  ) : detailOrders.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">{t("fin.inv.detailNoOrders")}</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">{t("fin.inv.detailOrderNo")}</th>
                          <th className="px-3 py-2 font-medium">{t("fin.inv.colUsage")}</th>
                          <th className="px-3 py-2 font-medium">{t("fin.inv.colAmount")}</th>
                          <th className="px-3 py-2 font-medium">{t("fin.inv.colPaidAt")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailOrders.map((o) => (
                          <tr key={String(o.order_no)} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 font-mono text-xs">{String(o.order_no ?? "")}</td>
                            <td className="px-3 py-2 text-muted-foreground">{t(usageKeyOf(o))}</td>
                            <td className="px-3 py-2 font-semibold">¥{(Number(o.amount) || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDtLocal(o.paid_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* 开票申请弹窗：勾选已支付订单 → 金额/内容自动带出；仅抬头类字段可填 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("fin.inv.apply")}</DialogTitle>
            <DialogDescription>{t("fin.inv.selectBillsDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label>{t("fin.inv.selectBills")}</Label>
              <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border p-2">
                {sourcesLoading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 size={15} className="animate-spin" /> {t("fin.loading")}
                  </div>
                ) : sources.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">{t("fin.inv.noBills")}</div>
                ) : (
                  sources.map((src) => {
                    const orderNo = String(src.order_no ?? "");
                    const used = Boolean(src.is_used);
                    const checked = selected.has(orderNo);
                    const usageKey = USAGE_I18N[String(src.usage_kind ?? "other")] ?? "fin.inv.usage.other";
                    return (
                      <label
                        key={orderNo}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${used ? "cursor-not-allowed opacity-50" : checked ? "border-primary/50 bg-primary/5" : "cursor-pointer hover:bg-muted/40"}`}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-current"
                          disabled={used}
                          checked={checked}
                          onChange={() => toggleSource(orderNo, used)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-xs font-medium">{orderNo}</div>
                          <div className="text-xs text-muted-foreground">
                            {t(usageKey)} · {t("fin.inv.colPaidAt")} {fmtDate(src.paid_at)}
                          </div>
                        </div>
                        {used && (
                          <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {t("fin.inv.statusIssued")}
                          </span>
                        )}
                        <span className="font-semibold">¥{(Number(src.amount) || 0).toLocaleString()}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2.5 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">{t("fin.inv.selectedTotal")}</div>
                <div className="font-semibold">¥{selectedTotal.toLocaleString()}</div>
              </div>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{t("fin.inv.contentAuto")}</div>
                <div className="truncate font-medium">{autoContentKey ? t(autoContentKey) : "—"}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("fin.inv.labelType")}</Label>
                <select
                  value={form.invoice_type}
                  onChange={(e) => {
                    const v = e.target.value;
                    // 增值税专用发票必须企业抬头：选专票时强制企业
                    setForm((f) => (v === "special" ? { ...f, invoice_type: v, title_type: "corporate" } : { ...f, invoice_type: v }));
                  }}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="normal">{t("fin.inv.typeNormal")}</option>
                  <option value="special">{t("fin.inv.typeSpecial")}</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>{t("fin.inv.labelTitleType")}</Label>
                <select
                  value={form.title_type}
                  onChange={(e) => {
                    const v = e.target.value;
                    // 切回个人抬头时自动清空税号
                    setForm((f) => ({ ...f, title_type: v, tax_no: v === "personal" ? "" : f.tax_no }));
                  }}
                  className="h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="personal" disabled={form.invoice_type === "special"}>{t("fin.inv.personal")}</option>
                  <option value="corporate">{t("fin.inv.corporate")}</option>
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("fin.inv.labelTitle")} <span className="text-destructive">*</span></Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.title_type === "personal" ? t("fin.inv.phTitlePersonal") : t("fin.inv.phTitleCorporate")} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-1.5">
                <Label>{t("fin.inv.labelTaxNo")} {form.title_type === "corporate" && <span className="text-destructive">*</span>}</Label>
                <Input value={form.tax_no} onChange={(e) => setForm({ ...form, tax_no: e.target.value })} placeholder={t("fin.inv.phTaxNo")} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t("fin.inv.labelEmail")} <span className="text-destructive">*</span></Label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t("fin.inv.phEmail")} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>{t("fin.inv.labelRemark")}</Label>
              <Input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder={t("fin.inv.phRemark")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={handleSave} disabled={saving || selected.size === 0}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />}{t("fin.inv.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
