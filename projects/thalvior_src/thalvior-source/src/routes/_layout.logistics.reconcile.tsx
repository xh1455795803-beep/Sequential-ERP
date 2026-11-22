// 物流对账：statements / statement_lines / billing_lines / statement_disputes / statement_import_batches
// 动作全部真调数据库函数：statement_recalc(重算合计) / statement_finalize(审核，必须显式传 p_auditor)
//
// ==================== 实测数据库函数契约（pg_get_function_arguments / prosrc，供 Edge Function 与货代门户对齐） ====================
// 1) statement_recalc(p_statement_id uuid)
//    返回：TABLE(total_amount numeric, line_count integer)  —— 是「表」不是标量 text，
//          PostgREST 恒返回「长度为 1 的 JSON 数组」，取 [0] 的两个字段展示；函数内部已回写 statements 的
//          total_amount / line_count（SECURITY DEFINER，先校验 session_user 权限 + logistics.statement.audit）。
//    异常（message 原样透传到 toast）：STATEMENT_NOT_FOUND: <uuid> / AUTH_REQUIRED: statement_recalc requires login
//                                     / PERMISSION_DENIED: logistics.statement.audit
//
// 2) statement_finalize(p_statement_id uuid, p_auditor uuid)
//    返回：text，两种前缀，端上必须按前缀分支解析（不做任何金额重算，只读回文本）：
//          'APPROVED:'  || COALESCE(total_amount::text,'0')   —— 审核通过，冒号后是账单总额金额
//          'PENDING_AUDIT:' || <n>::text                      —— 仍有 n 条 billing_lines 处于 pending_audit，
//                                                                函数提前返回、账单不置 approved
//    异常（全部原样展示，不本地兜底）：STATEMENT_NOT_FOUND: <uuid>
//                                     / AUTH_REQUIRED: statement_finalize requires login
//                                     / PERMISSION_DENIED: logistics.statement.audit
//                                     / PERMISSION_DENIED: p_auditor must be the caller   —— p_auditor 必须等于 auth.uid()
//                                     / AUDITOR_REQUIRED: 经服务端调用必须显式传 p_auditor（实际审核人 uuid）
//                                     / 对账单已关账（closed），不可重复审核
//                                     / 对账单已作废（voided），不可审核
//    => p_auditor 只能从 supabase.auth.getSession() 取当前登录用户 uuid 显式传入，禁止猜测/写死。
//
// 3) 金额与差异字段一律以库为准：approved 费用行金额被触发器锁死，差异标记由 fn_billing_lines_diff_flag 计算，
//    页面只做展示与调用，不做任何前端金额运算。
// ==================================================================================================================
// ==================== bill-import Edge Function 契约（CSV 导入 → 匹配 → 差异 → 争议） ====================
// 页面不自己解析 CSV、不在前端算钱：全部 POST 到 functions/bill-import，字段与该文件头注释一字不差，
// 失败原样 toast（后端统一 {code, message, details}）。调用范式照抄 src/lib/admin-api.ts:132 与
// _layout.logistics.parcels.tsx 的 unwrapInvokeError（从 error.context 取状态码 + 后端原文），页面里不出现裸 fetch。
//   action         入参（除 action 外）                                                       关键出参
//   template       forwarder_id?                                                     columns[] sample_rows[][] csv_text
//   preview        csv|csv_base64, forwarder_id, file_name, batch_no?, period_from?, period_to?, currency?, warehouse_id?
//                                                                                 dry_run batch_no summary lines[] unknown_headers
//                                                                                 duplicated_headers ragged_rows errors[] warnings[]
//   commit         preview 入参 + allow_errors? / allow_unmatched?                    batch_id statement_id summary write recalc
//   list_batches   limit? offset? forwarder_id?                                       batches[]（match_rate_pct diff_amount_total stage）
//   batch_detail   batch_id | batch_no                                                statement summary lines[] unmatched errors
//   match          batch_id, row_no, shipment_id | billing_line_id                    line statement_recalc weight_locked
//   dispute        mode=create|transition|list（create: statement_id billing_line_id reason claimed_amount? evidence?）
//                                                                                 dispute next_statuses
//   export         batch_id | batch_no, diff_only?                                    csv_text file_name row_count
// EF 侧 checkPerm（fail-closed）：view=logistics.reconcile.view / import=logistics.billing.import /
//   audit=logistics.billing.audit / dispute=logistics.billing.dispute / export=logistics.reconcile.export。
// ==================================================================================================================
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, Download, FileSpreadsheet, FileWarning, Gavel, Link2, Loader2,
  RefreshCw, Scale, ShieldAlert, Upload,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SearchField } from "@/components/filter-bar";
import { callRpc, fetchTable, insertRow, queryTable, updateRow, type ExtRow } from "@/lib/data-access";
import { supabase } from "@/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { tt, tk } from "@/i18n/tts";

export const Route = createFileRoute("/_layout/logistics/reconcile")({
  component: Reconcile,
});

// ============================ 工具 ============================
const STMT_PAGE_SIZE = 20;
const selCls =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";
const labelCls = "mb-1 block text-xs font-medium text-fg-muted";
const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const sv = (o: ExtRow, k: string): string => { const v = o[k]; return v == null ? "" : String(v); };
const nsv = (o: ExtRow, k: string): number | null => {
  const v = o[k];
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const boolv = (o: ExtRow, k: string): boolean => String(o[k]) === "true";
const num = (v: number | string | null | undefined, digits = 4): string => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  let t = n.toFixed(digits);
  if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, "");
  return t;
};
const shortId = (v: string): string => (v ? v.slice(0, 8) : "—");
const dt = (v: string): string => (v ? v.replace("T", " ").slice(0, 19) : "—");
const splitLines = (v: string): string[] => v.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);
// jsonb 列（error_detail / evidence）要原样给财务看，不能 String(obj) 变成 [object Object]
const jsonText = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
};

// ============================ 枚举（与数据库 CHECK 一致） ============================
const ST_STATUS = ["draft", "pending_audit", "approved", "rejected", "closed", "voided"] as const;
const FEE_TYPES = [
  "handling", "domestic_freight", "intl_freight", "packaging", "storage", "duty",
  "volumetric_diff", "surcharge", "vas", "return_fee", "insurance", "adjustment",
] as const;
const DSP_STATUS = ["open", "processing", "accepted", "rejected", "closed"] as const;
// 争议状态机：UI 只放行合法后继状态（数据库 CHECK 只约束取值范围，不约束流转）
const DSP_NEXT: Record<string, string[]> = {
  open: ["processing", "accepted", "rejected"],
  processing: ["accepted", "rejected", "closed"],
  accepted: ["closed"],
  rejected: ["closed"],
  closed: [],
};

const stStatusLabel = (v: string): string =>
  ST_STATUS.includes(v as (typeof ST_STATUS)[number]) ? tt(`lg.rec.status.${v}`) : v || "—";
const stStatusTone = (v: string): BadgeProps["variant"] =>
  v === "approved" || v === "closed" ? "success"
    : v === "pending_audit" ? "warning"
      : v === "rejected" || v === "voided" ? "destructive"
        : "outline";
const feeLabel = (v: string): string =>
  FEE_TYPES.includes(v as (typeof FEE_TYPES)[number]) ? tt(`lg.rec.fee.${v}`) : v || "—";
const dspLabel = (v: string): string =>
  DSP_STATUS.includes(v as (typeof DSP_STATUS)[number]) ? tt(`lg.rec.dsp.${v}`) : v || "—";
const dspTone = (v: string): BadgeProps["variant"] =>
  v === "accepted" || v === "closed" ? "success" : v === "rejected" ? "destructive" : v === "processing" ? "warning" : "outline";
const lineStatusTone = (v: string): BadgeProps["variant"] =>
  v === "approved" ? "success" : v === "pending_audit" ? "warning" : v === "voided" ? "muted" : "destructive";

// ============================ 行类型 ============================
interface Stmt {
  id: string; forwarder_id: string; warehouse_id: string; period_from: string; period_to: string;
  currency: string; total_amount: number | null; line_count: number; status: string; source: string;
  audited_by: string; audited_at: string; closed_at: string; notes: string;
}
interface Line {
  id: string; shipment_id: string; parcel_id: string; fee_type: string; charge_type: string;
  charge_unit: string; charge_qty: number | null; unit_price: number | null; amount: number | null;
  currency: string; weight_charged_g: number | null; weight_declared_g: number | null;
  diff_flag: boolean; source: string; external_ref: string; period: string; status: string;
}
interface Dispute {
  id: string; statement_id: string; billing_line_id: string; reason: string;
  claimed_amount: number | null; evidence: string[]; status: string; resolved_amount: number | null;
  resolved_by: string; resolved_at: string; created_at: string;
}
// ---- bill-import 出参结构（字段与 functions/bill-import/index.ts 的响应逐字对齐）----
interface BillSummary {
  total_records: number; importable_rows: number; error_rows: number; unmatched_rows: number;
  ambiguous_rows: number; duplicate_rows: number; diff_amount_rows: number; diff_weight_rows: number;
  matched_rows: number; match_rate_pct: number;
  charged_amount_total: string; declared_amount_total: string; diff_amount_total: string;
  unmatched_amount_total: string;
}
interface RowIssue { code: string; field?: string; message: string }
interface LineCandidate { billing_line_id: string; fee_type: string; charge_type?: string; amount?: string; status?: string }
interface BillLine {
  row_no: number; seq: number; match_status: string;
  matched_by?: string | null; match_value?: string | null;
  shipment_id?: string | null; shipment_tracking_no?: string | null; shipment_wms_order_no?: string | null;
  billing_line_id?: string | null; line_status?: string | null;
  fee_type?: string; charge_type?: string; currency?: string;
  charged_amount: string | null; declared_amount: string | null;
  amount_diff: string | null; amount_diff_pct: number | null; amount_diff_flag: boolean;
  weight_charged_g: string | null; weight_declared_g: string | null; diff_flag: boolean;
  diff_flag_now?: boolean | null; line_status_now?: string | null; dispute_status?: string | null;
  matched_manually?: boolean;
  errors?: RowIssue[]; warnings?: RowIssue[]; candidates?: LineCandidate[];
}
interface HeaderHit { index: number; header: string }
interface RaggedRow { line: number; cells: number }
interface RowIssues {
  row_no: number; errors?: RowIssue[]; warnings?: RowIssue[]; match_status?: string;
  // commit 的 write_errors 用的是扁平 {code,message}，preview 的 errors/warnings 用的是数组
  code?: string; message?: string;
}
interface BillPreview {
  ok: boolean; dry_run: boolean; already_imported: boolean;
  existing_batch: Record<string, unknown> | null;
  batch_no: string; file_name: string; delimiter: string;
  forwarder_id: string; forwarder_name: string;
  statement: { period_from: string; period_to: string; currency: string; warehouse_id: string | null };
  summary: BillSummary;
  unknown_headers: HeaderHit[]; duplicated_headers: HeaderHit[];
  ragged_rows: RaggedRow[]; blank_lines: number;
  errors: RowIssues[]; warnings: RowIssues[];
  lines: BillLine[]; lines_truncated: boolean;
}
interface CommitResult {
  ok: boolean; already_imported: boolean; batch_id: string; batch_no: string;
  statement_id: string | null; statement_reused: boolean; forwarder_id: string; file_name: string;
  statement: { period_from: string; period_to: string; currency: string; recalc: { total_amount: string; line_count: number } | null };
  summary: BillSummary;
  write: { attached?: number; weight_updated?: number; locked_skipped?: number; attach_failed?: number; external_ref_filled?: number; rows_truncated?: boolean };
  errors: RowIssues[];
  write_errors: RowIssues[];
  message?: string;
  // 注意：already_imported=true（含并发命中）时后端只回 batch_id / batch_no / message（可选 batch、summary），
  // statement / write / file_name 可能缺省，所以这些字段一律用 ?. 读，且命中分支不碰 summary。
  batch?: Record<string, unknown>;
}
interface IBatch {
  id: string; batch_no: string; file_name: string; statement_id: string | null;
  imported_by: string | null; imported_at: string | null;
  row_count: number | null; ok_count: number | null; fail_count: number | null;
  stage: string; forwarder_id: string | null; forwarder_name: string | null;
  period_from: string | null; period_to: string | null; currency: string | null;
  summary?: BillSummary;
  match_rate_pct: number | null; unmatched_rows: number | null; diff_amount_rows: number | null;
  diff_amount_total: string | null; charged_amount_total: string | null; declared_amount_total: string | null;
  error_count: number;
}
interface UnmatchedRow {
  row_no: number; seq?: number; match_status?: string;
  matched_by?: string | null; match_value?: string | null;
  fee_type?: string; charge_type?: string; currency?: string;
  charged_amount?: string | null; weight_charged_g?: string | null;
  errors?: RowIssue[]; warnings?: RowIssue[];
}
interface BillDetail {
  batch: IBatch; statement: ExtRow | null; summary: BillSummary | null;
  write: Record<string, unknown> | null;
  unknown_headers: HeaderHit[]; ragged_rows: RaggedRow[];
  errors: RowIssues[]; warnings: RowIssues[];
  unmatched: UnmatchedRow[];
  lines: BillLine[]; lines_truncated: boolean; disputes: ExtRow[];
}
interface MatchResult {
  ok: boolean; batch_id: string; row_no: number; statement_id: string;
  line: BillLine; weight_locked: boolean; locked_note: string | null;
  recalc_error: string | null;
  statement_recalc: { total_amount: string; line_count: number } | null;
}
interface ExportResult { ok: boolean; file_name: string; csv_text: string; row_count: number; diff_only: boolean }
interface TemplateColumn {
  key: string; label: string; required: boolean; kind: string;
  example: string; aliases: string[]; note?: string;
}
interface TemplateResult {
  ok: boolean; forwarder_id: string | null; forwarder_name: string | null;
  default_currency: string; delimiter: string; encoding: string;
  units: { weight: string; length: string; amount_decimals: number };
  diff_rule: { metric: string; threshold_pct: number; note: string };
  columns: TemplateColumn[]; sample_rows: string[][]; csv_text: string; notes: string[];
}
interface SumRow {
  forwarder_id: string; period_month: string; fee_type: string; currency: string;
  total_amount: number | null; line_count: number | null;
}

const mapStmt = (r: ExtRow): Stmt => ({
  id: r.id, forwarder_id: sv(r, "forwarder_id"), warehouse_id: sv(r, "warehouse_id"),
  period_from: sv(r, "period_from"), period_to: sv(r, "period_to"), currency: sv(r, "currency"),
  total_amount: nsv(r, "total_amount"), line_count: nsv(r, "line_count") ?? 0, status: sv(r, "status"),
  source: sv(r, "source"), audited_by: sv(r, "audited_by"), audited_at: sv(r, "audited_at"),
  closed_at: sv(r, "closed_at"), notes: sv(r, "notes"),
});
const mapLine = (r: ExtRow): Line => ({
  id: r.id, shipment_id: sv(r, "shipment_id"), parcel_id: sv(r, "parcel_id"),
  fee_type: sv(r, "fee_type"), charge_type: sv(r, "charge_type"), charge_unit: sv(r, "charge_unit"),
  charge_qty: nsv(r, "charge_qty"), unit_price: nsv(r, "unit_price"), amount: nsv(r, "amount"),
  currency: sv(r, "currency"), weight_charged_g: nsv(r, "weight_charged_g"),
  weight_declared_g: nsv(r, "weight_declared_g"), diff_flag: boolv(r, "diff_flag"),
  source: sv(r, "source"), external_ref: sv(r, "external_ref"), period: sv(r, "period"),
  status: sv(r, "status"),
});
const mapDispute = (r: ExtRow): Dispute => {
  const ev = r["evidence"];
  return {
    id: r.id, statement_id: sv(r, "statement_id"), billing_line_id: sv(r, "billing_line_id"),
    reason: sv(r, "reason"), claimed_amount: nsv(r, "claimed_amount"),
    evidence: Array.isArray(ev) ? ev.map((x) => String(x)) : [],
    status: sv(r, "status"), resolved_amount: nsv(r, "resolved_amount"),
    resolved_by: sv(r, "resolved_by"), resolved_at: sv(r, "resolved_at"), created_at: sv(r, "created_at"),
  };
};
const mapSum = (r: ExtRow): SumRow => ({
  forwarder_id: sv(r, "forwarder_id"), period_month: sv(r, "period_month"), fee_type: sv(r, "fee_type"),
  currency: sv(r, "currency"), total_amount: nsv(r, "total_amount"), line_count: nsv(r, "line_count"),
});

// ============================ bill-import Edge Function 调用 ============================
const BILL_EF = "bill-import";
const IB_PAGE_SIZE = 20;

/** supabase-js 把原始 Response 藏在 error.context 里：与 admin-api.ts / parcels 同一取法（状态码 + 后端原文） */
async function unwrapBillError(err: unknown): Promise<{ status: number; message: string; body: Record<string, unknown> | null }> {
  const e = err as {
    message?: string; statusCode?: number; status?: number;
    context?: { status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  let status = Number(e?.statusCode ?? e?.status ?? e?.context?.status ?? 0);
  let message = "";
  let body: Record<string, unknown> | null = null;
  const ctx = e?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      body = await ctx.json() as Record<string, unknown> | null;
      message = String(body?.message ?? body?.error ?? body?.msg ?? "");
    } catch {
      if (typeof ctx.text === "function") message = String(await ctx.text().catch(() => "")).slice(0, 400);
    }
  }
  if (!message) message = String(e?.message ?? "");
  if (!message && typeof err === "string") message = err;
  return { status, message, body };
}

/** 统一入口：HTTP 错误、404（EF 未部署）、以及 200 但 ok=false 的业务失败一律抛出原文，不假装成功 */
async function callBillImport<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(BILL_EF, { body });
  if (error) {
    const { status, message } = await unwrapBillError(error);
    throw new Error(status
      ? `HTTP ${status} · ${BILL_EF} · ${message || tt("lg.bill.err.noDetail")}`
      : (message || `${BILL_EF}: ${tt("lg.bill.err.noDetail")}`));
  }
  const p = data as (T & { ok?: boolean; code?: string; message?: string }) | null;
  if (p && p.ok === false) throw new Error(`${p.code ?? "FAILED"} · ${p.message ?? tt("lg.bill.err.noDetail")}`);
  return data as T;
}

/** CSV 落盘下载：前置 UTF-8 BOM，Excel 打开不乱码（bill-import 解析器也吃 BOM） */
function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([`\ufeff${text}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const stageLabel = (v: string): string =>
  ["done", "running", "failed", "unknown"].includes(v) ? tt(`lg.bill.stage.${v}`) : v || "—";
const stageTone = (v: string): BadgeProps["variant"] =>
  v === "done" ? "success" : v === "running" ? "warning" : v === "failed" ? "destructive" : "muted";
const msLabel = (v: string | null | undefined): string => {
  switch (v) {
    case "matched": return tt("lg.bill.ms.matched");
    case "unmatched": return tt("lg.bill.ms.unmatched");
    case "ambiguous": return tt("lg.bill.ms.ambiguous");
    case "error": return tt("lg.bill.ms.error");
    default: return v ? tk(v) : "—";
  }
};
const msTone = (v: string): BadgeProps["variant"] =>
  v === "matched" ? "success" : v === "ambiguous" ? "warning" : v === "error" ? "destructive" : "outline";
// bp（万分比）→ 百分号文本；差异一律用后端给的定点字符串，前端不做金额运算
const bpText = (bp: number | null | undefined): string =>
  bp == null ? "—" : `${bp > 0 ? "+" : ""}${(bp / 100).toFixed(2)}%`;
const issuesText = (arr: RowIssue[] | undefined): string => (arr ?? []).map((e) => e.message).join("；");
// 后端下发的定点金额/重量一律是字符串：只在字符串上裁尾零，绝不经过 Number()，
// 免得 16 位有效数字被双精度截掉末位（页面因此完全不参与金额运算）。
const amtStr = (v: string | null | undefined): string => {
  if (v == null || v === "") return "—";
  return v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
};


function Reconcile() {
  const [tab, setTab] = useState("statements");

  // 引用数据
  const [forwarders, setForwarders] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [uid, setUid] = useState("");
  const [meLabel, setMeLabel] = useState("");

  // 账单列表
  const [stmts, setStmts] = useState<Stmt[]>([]);
  const [loadingStmts, setLoadingStmts] = useState(true);
  const [stmtsErr, setStmtsErr] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selId, setSelId] = useState("");
  // 服务端分页：range 由后端切片、count:"exact" 拿真实总数，前端不再 slice
  const [stmtPage, setStmtPage] = useState(0);
  const [stmtTotal, setStmtTotal] = useState<number | null>(null);
  const [pendingAuditTotal, setPendingAuditTotal] = useState<number | null>(null);

  // 账单详情（费用行）
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [linesErr, setLinesErr] = useState("");
  const [linkCount, setLinkCount] = useState<number | null>(null);

  // RPC 状态
  const [busyRecalc, setBusyRecalc] = useState(false);
  const [busyFinal, setBusyFinal] = useState(false);
  const [finalOpen, setFinalOpen] = useState(false);
  const [lastRpc, setLastRpc] = useState("");

  // 争议
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loadingDisputes, setLoadingDisputes] = useState(true);
  const [disputeFilter, setDisputeFilter] = useState("all");
  const [disputeDlg, setDisputeDlg] = useState<Line | null>(null);
  const [dspForm, setDspForm] = useState({ reason: "", claimed_amount: "", evidence: "", status: "open" });
  const [savingDsp, setSavingDsp] = useState(false);
  const [resolveDlg, setResolveDlg] = useState<Dispute | null>(null);
  const [resolveForm, setResolveForm] = useState({ status: "processing", resolved_amount: "" });
  const [savingResolve, setSavingResolve] = useState(false);

  // 导入批次（走 bill-import）/ 汇总视图
  const [batches, setBatches] = useState<IBatch[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [batchesErr, setBatchesErr] = useState("");
  const [ibTotal, setIbTotal] = useState<number | null>(null);
  const [ibPage, setIbPage] = useState(0);
  const [ibKw, setIbKw] = useState("");
  const [ibForwarder, setIbForwarder] = useState("");
  const [ibNote, setIbNote] = useState("");
  const [sumRows, setSumRows] = useState<SumRow[]>([]);
  const [loadingSum, setLoadingSum] = useState(true);
  const [sumForwarder, setSumForwarder] = useState("");

  // CSV 导入向导
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [impOpen, setImpOpen] = useState(false);
  const [impStep, setImpStep] = useState<"pick" | "preview">("pick");
  const [csvText, setCsvText] = useState("");
  const [csvName, setCsvName] = useState("");
  const [impForwarder, setImpFwd] = useState("");
  const [impBatchNo, setImpBatchNo] = useState("");
  const [impFrom, setImpFrom] = useState("");
  const [impTo, setImpTo] = useState("");
  const [impCurrency, setImpCurrency] = useState("");
  const [impWarehouse, setImpWarehouse] = useState("");
  const [allowErrors, setAllowErrors] = useState(false);
  const [allowUnmatched, setAllowUnmatched] = useState(true);
  const [busyTpl, setBusyTpl] = useState(false);
  const [busyPv, setBusyPv] = useState(false);
  const [busyCommit, setBusyCommit] = useState(false);
  const [pv, setPv] = useState<BillPreview | null>(null);
  const [impErr, setImpErr] = useState("");
  // 表头别名表由 EF 的 template 下发，页面不再抄一份（避免两处口径漂移）
  const [tpl, setTpl] = useState<TemplateResult | null>(null);
  const [showCols, setShowCols] = useState(false);

  // 批次明细抽屉
  const [dtlId, setDtlId] = useState("");
  const [dtl, setDtl] = useState<BillDetail | null>(null);
  const [busyDtl, setBusyDtl] = useState(false);
  const [dtlErr, setDtlErr] = useState("");
  const [dtlRaw, setDtlRaw] = useState(false);

  // 人工匹配
  const [mmRow, setMmRow] = useState<BillLine | null>(null);
  const [mmKw, setMmKw] = useState("");
  const [mmShips, setMmShips] = useState<ExtRow[]>([]);
  const [mmShip, setMmShip] = useState("");
  const [mmLines, setMmLines] = useState<ExtRow[]>([]);
  const [mmLine, setMmLine] = useState("");
  const [busySearch, setBusySearch] = useState(false);
  const [busyMm, setBusyMm] = useState(false);

  // 抽屉内开争议（走 EF，带状态机与重复争议守卫）
  const [bdRow, setBdRow] = useState<BillLine | null>(null);
  const [bdForm, setBdForm] = useState({ reason: "", claimed_amount: "", evidence: "" });
  const [busyBd, setBusyBd] = useState(false);
  const [busyExport, setBusyExport] = useState(false);

  const fwdName = useCallback((id: string) => forwarders.find((f) => f.id === id)?.name || shortId(id), [forwarders]);
  const whName = useCallback((id: string) => (id ? warehouses.find((w) => w.id === id)?.name || shortId(id) : tt("lg.rec.anyWarehouse")), [warehouses]);
  const userLabel = useCallback((id: string) => (id ? users[id] || shortId(id) : "—"), [users]);

  // ---------------- 初始化 ----------------
  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => {
        const u = data.session?.user;
        setUid(u?.id ?? "");
        setMeLabel(u?.email || u?.id?.slice(0, 8) || "");
      })
      .catch(() => { setUid(""); setMeLabel(""); });
    fetchTable("freight_forwarders")
      .then((d) => setForwarders(d.map((r) => ({ id: r.id, name: sv(r, "name") }))))
      .catch((e) => toast.error(errMsg(e)));
    fetchTable("forwarder_warehouses")
      .then((d) => setWarehouses(d.map((r) => ({ id: r.id, name: sv(r, "name") }))))
      .catch(() => setWarehouses([]));
    fetchTable("profiles")
      .then((d) => {
        const m: Record<string, string> = {};
        for (const r of d) m[r.id] = sv(r, "username") || shortId(r.id);
        setUsers(m);
      })
      .catch(() => setUsers({}));
  }, []);

  // ---------------- 账单列表 ----------------
  const loadStmts = useCallback(() => {
    setLoadingStmts(true);
    setStmtsErr("");
    queryTable("statements", {
      filters: statusFilter === "all" ? [] : [{ field: "status", value: statusFilter }],
      order: { field: "created_at", ascending: false },
      range: { from: stmtPage * STMT_PAGE_SIZE, to: stmtPage * STMT_PAGE_SIZE + STMT_PAGE_SIZE - 1 },
      count: "exact",
    })
      .then(({ rows, count }) => { setStmts(rows.map(mapStmt)); setStmtTotal(count); })
      .catch((e) => { const m = errMsg(e); setStmtsErr(m); toast.error(m); })
      .finally(() => setLoadingStmts(false));
    // 「待审核」卡片统计也交给 DB count，避免分页后只数当前页
    queryTable("statements", { filters: [{ field: "status", value: "pending_audit" }], range: { from: 0, to: 0 }, count: "exact" })
      .then(({ count }) => setPendingAuditTotal(count))
      .catch(() => setPendingAuditTotal(null));
  }, [statusFilter, stmtPage]);
  useEffect(() => { loadStmts(); }, [loadStmts]);
  useEffect(() => { setStmtPage(0); }, [statusFilter]);
  const stmtTotalPages = Math.max(1, Math.ceil((stmtTotal ?? 0) / STMT_PAGE_SIZE));

  const sel = useMemo(() => stmts.find((s) => s.id === selId) ?? null, [stmts, selId]);
  useEffect(() => {
    if (selId && !stmts.some((s) => s.id === selId)) { setSelId(""); setLines([]); setLinkCount(null); }
    // 列表非空却没选中时默认打开最新一张账单：落地页第一眼就是真数据，而不是四个 0
    else if (!selId && stmts.length > 0) setSelId(stmts[0].id);
  }, [stmts, selId]);

  // ---------------- 费用行明细（statement_lines 为权威，billing_lines.statement_id 为兼容路径，取并集） ----------------
  const loadLines = useCallback(async (sid: string) => {
    if (!sid) return;
    setLoadingLines(true);
    setLinesErr("");
    try {
      const [sl, bl] = await Promise.all([
        fetchTable("statement_lines", { field: "statement_id", value: sid }),
        fetchTable("billing_lines", { field: "statement_id", value: sid }),
      ]);
      const byId = new Map<string, ExtRow>();
      for (const r of bl) byId.set(r.id, r);
      const missing = Array.from(new Set(sl.map((x) => sv(x, "billing_line_id")).filter((x) => x && !byId.has(x))));
      if (missing.length > 50) {
        const all = await fetchTable("billing_lines");
        for (const r of all) if (missing.includes(r.id)) byId.set(r.id, r);
      } else {
        const groups = await Promise.all(missing.map((bid) => fetchTable("billing_lines", { field: "id", value: bid }).catch(() => [] as ExtRow[])));
        for (const g of groups) for (const r of g) byId.set(r.id, r);
      }
      setLinkCount(sl.length);
      setLines(Array.from(byId.values()).map(mapLine).sort((a, b) => a.fee_type.localeCompare(b.fee_type) || b.period.localeCompare(a.period)));
    } catch (e) {
      const m = errMsg(e);
      setLinesErr(m);
      toast.error(m);
    } finally {
      setLoadingLines(false);
    }
  }, []);
  useEffect(() => { if (selId) void loadLines(selId); }, [selId, loadLines]);

  // ---------------- 争议 / 批次 / 汇总 ----------------
  const loadDisputes = useCallback(() => {
    setLoadingDisputes(true);
    queryTable("statement_disputes", {
      filters: disputeFilter === "all" ? [] : [{ field: "status", value: disputeFilter }],
      order: { field: "created_at", ascending: false },
    })
      .then(({ rows }) => setDisputes(rows.map(mapDispute)))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoadingDisputes(false));
  }, [disputeFilter]);
  useEffect(() => { loadDisputes(); }, [loadDisputes]);

  // ---------------- 导入批次：一律走 bill-import（页面不碰库表拼装） ----------------
  const loadBatches = useCallback(() => {
    setLoadingBatches(true);
    setBatchesErr("");
    callBillImport<{ ok: boolean; total: number; batches: IBatch[]; total_note?: string }>({
      action: "list_batches", limit: IB_PAGE_SIZE, offset: ibPage * IB_PAGE_SIZE,
      ...(ibForwarder ? { forwarder_id: ibForwarder } : {}),
    })
      .then((r) => {
        const list = r.batches ?? [];
        setBatches(list);
        setIbTotal(typeof r.total === "number" ? r.total : list.length);
        setIbNote(r.total_note ? tt("lg.bill.ib.note", { v1: String(IB_PAGE_SIZE) }) : "");
      })
      .catch((e) => { const m = errMsg(e); setBatchesErr(m); toast.error(m); })
      .finally(() => setLoadingBatches(false));
  }, [ibPage, ibForwarder]);
  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { setIbPage(0); }, [ibForwarder]);
  const showBatches = useMemo(() => {
    const k = ibKw.trim().toLowerCase();
    if (!k) return batches;
    return batches.filter((b) => `${b.batch_no} ${b.file_name} ${b.forwarder_name ?? ""}`.toLowerCase().includes(k));
  }, [batches, ibKw]);
  const ibTotalPages = Math.max(1, Math.ceil((ibTotal ?? 0) / IB_PAGE_SIZE));

  const openDetail = useCallback(async (id: string) => {
    setDtlId(id);
    setDtl(null);
    setDtlErr("");
    setDtlRaw(false);
    setBusyDtl(true);
    try {
      setDtl(await callBillImport<BillDetail>({ action: "batch_detail", batch_id: id }));
    } catch (e) {
      const m = errMsg(e);
      setDtlErr(m);
      toast.error(m);
    } finally {
      setBusyDtl(false);
    }
  }, []);
  const refreshDetail = useCallback(() => { if (dtlId) void openDetail(dtlId); }, [dtlId, openDetail]);

  // ---------------- 动作：CSV 导入向导 ----------------
  const fetchTemplate = useCallback(async (fwd: string): Promise<TemplateResult> => {
    const r = await callBillImport<TemplateResult>({ action: "template", ...(fwd ? { forwarder_id: fwd } : {}) });
    setTpl(r);
    return r;
  }, []);
  const openImport = () => {
    setImpStep("pick"); setPv(null); setImpErr(""); setShowCols(false); setImpOpen(true);
    // 别名表/列说明只为展示，拉不到不拦导入
    if (!tpl) void fetchTemplate(impForwarder).catch(() => setTpl(null));
  };
  const importPayload = (): Record<string, unknown> => ({
    csv: csvText,
    file_name: csvName || "bill.csv",
    forwarder_id: impForwarder,
    ...(impBatchNo.trim() ? { batch_no: impBatchNo.trim() } : {}),
    ...(impFrom ? { period_from: impFrom } : {}),
    ...(impTo ? { period_to: impTo } : {}),
    ...(impCurrency ? { currency: impCurrency } : {}),
    ...(impWarehouse ? { warehouse_id: impWarehouse } : {}),
  });
  const onPickFile = async (f: File | null) => {
    if (!f) return;
    setCsvName(f.name);
    try {
      setCsvText(await f.text());
      setImpErr("");
    } catch (e) { setImpErr(errMsg(e)); }
  };
  const doTemplate = async () => {
    setBusyTpl(true);
    try {
      const r = await fetchTemplate(impForwarder);
      downloadCsv("forwarder-bill-template.csv", r.csv_text);
      toast.success(tt("lg.bill.tpl.ok", { v1: String(r.columns.length) }));
    } catch (e) { toast.error(errMsg(e)); } finally { setBusyTpl(false); }
  };
  const doPreview = async () => {
    if (!impForwarder) { setImpErr(tt("lg.bill.needForwarder")); return; }
    if (!csvText.trim()) { setImpErr(tt("lg.bill.needCsv")); return; }
    setBusyPv(true);
    setImpErr("");
    try {
      setPv(await callBillImport<BillPreview>({ action: "preview", ...importPayload() }));
      setImpStep("preview");
    } catch (e) {
      const m = errMsg(e);
      setImpErr(m);
      toast.error(m, { duration: 9000 });
    } finally { setBusyPv(false); }
  };
  const doCommit = async () => {
    if (!pv) return;
    setBusyCommit(true);
    setImpErr("");
    try {
      const r = await callBillImport<CommitResult>({ action: "commit", ...importPayload(), allow_errors: allowErrors, allow_unmatched: allowUnmatched });
      if (r.already_imported) {
        toast.warning(tt("lg.bill.commit.dup", { v1: r.batch_no }));
      } else {
        toast.success(tt("lg.bill.commit.ok", {
          v1: r.batch_no,
          v2: String(r.summary.matched_rows),
          v3: String(r.summary.diff_amount_rows),
          v4: r.summary.diff_amount_total,
        }), { duration: 9000 });
      }
      if (r.statement?.recalc) toast.info(tt("lg.bill.commit.recalc", { v1: r.statement.recalc.total_amount, v2: String(r.statement.recalc.line_count) }));
      if ((r.write_errors ?? []).length > 0) {
        toast.error(tt("lg.bill.commit.writeErr", { v1: String(r.write_errors.length) }), {
          description: r.write_errors.map((w) => `${w.row_no}: ${w.code ?? ""} ${w.message ?? issuesText(w.errors)}`).join("\n"),
          duration: 14000,
        });
      }
      setImpOpen(false);
      setPv(null);
      setCsvText("");
      setCsvName("");
      setImpBatchNo("");
      loadBatches();
      loadStmts();
      if (r.batch_id) void openDetail(r.batch_id);
    } catch (e) {
      const m = errMsg(e);
      setImpErr(m);
      toast.error(m, { duration: 12000 });
    } finally { setBusyCommit(false); }
  };

  // ---------------- 动作：导出差异行 / 人工匹配 / 抽屉内开争议 ----------------
  const doExport = async (diffOnly: boolean) => {
    if (!dtlId) return;
    setBusyExport(true);
    try {
      const r = await callBillImport<ExportResult>({ action: "export", batch_id: dtlId, diff_only: diffOnly });
      downloadCsv(r.file_name, r.csv_text);
      toast.success(tt("lg.bill.export.ok", { v1: String(r.row_count), v2: r.file_name }));
    } catch (e) { toast.error(errMsg(e)); } finally { setBusyExport(false); }
  };
  const openMatch = (l: BillLine) => {
    setMmRow(l);
    setMmKw(l.match_value ?? l.shipment_tracking_no ?? "");
    setMmShips([]);
    setMmShip("");
    setMmLines(l.candidates?.length ? l.candidates.map((c) => ({ id: c.billing_line_id, fee_type: c.fee_type, charge_type: c.charge_type ?? null, amount: c.amount ?? null, status: c.status ?? null, currency: null, weight_charged_g: null, weight_declared_g: null }) as ExtRow) : []);
    setMmLine(l.candidates?.length === 1 ? l.candidates[0].billing_line_id : "");
  };
  const searchShips = async () => {
    const k = mmKw.trim();
    if (!k) { setMmShips([]); return; }
    setBusySearch(true);
    try {
      // 关键字只能是单列等值：三个业务单号列各查一次再按 id 合并（不做前端模糊猜单）
      const cols = ["tracking_no", "wms_order_no", "platform_order_no"] as const;
      const res = await Promise.all(cols.map((c) => queryTable("shipments", { filters: [{ field: c, value: k, op: "eq" }], limit: 10 }).catch(() => null)));
      const m = new Map<string, ExtRow>();
      for (const r of res) for (const row of r?.rows ?? []) m.set(row.id, row);
      setMmShips(Array.from(m.values()));
      if (m.size === 0) toast.info(tt("lg.bill.mm.noShip"));
    } catch (e) { toast.error(errMsg(e)); } finally { setBusySearch(false); }
  };
  const pickShip = async (id: string) => {
    setMmShip(id);
    setMmLine("");
    if (!id) { setMmLines([]); return; }
    try {
      const rows = await fetchTable("billing_lines", { field: "shipment_id", value: id });
      // 与 EF 同口径：voided / rejected 不参与对账
      setMmLines(rows.filter((r) => r.status !== "voided" && r.status !== "rejected"));
    } catch (e) { setMmLines([]); toast.error(errMsg(e)); }
  };
  const doMatch = async () => {
    if (!mmRow || !mmLine) { toast.error(tt("lg.bill.mm.needLine")); return; }
    setBusyMm(true);
    try {
      const r = await callBillImport<MatchResult>({ action: "match", batch_id: dtlId, row_no: mmRow.row_no, billing_line_id: mmLine });
      toast.success(tt("lg.bill.mm.ok", { v1: String(r.row_no), v2: shortId(r.line.billing_line_id ?? "") }));
      if (r.weight_locked) toast.warning(tt("lg.bill.mm.locked"), { description: r.locked_note ?? "" });
      if (r.statement_recalc) toast.info(tt("lg.bill.mm.recalc", { v1: r.statement_recalc.total_amount, v2: String(r.statement_recalc.line_count) }));
      setMmRow(null); setMmKw(""); setMmShips([]); setMmShip(""); setMmLines([]); setMmLine("");
      refreshDetail();
      loadStmts();
    } catch (e) { toast.error(errMsg(e), { duration: 12000 }); } finally { setBusyMm(false); }
  };
  const openBatchDispute = (l: BillLine) => {
    if (!l.billing_line_id) { toast.error(tt("lg.bill.dsp.needMatch")); return; }
    setBdRow(l);
    setBdForm({ reason: "", claimed_amount: l.charged_amount ?? "", evidence: "" });
  };
  const saveBatchDispute = async () => {
    if (!bdRow?.billing_line_id || !dtl?.statement) return;
    if (!bdForm.reason.trim()) { toast.error(tt("lg.rec.dsp.needReason")); return; }
    setBusyBd(true);
    try {
      const r = await callBillImport<{ ok: boolean; dispute: ExtRow; next_statuses: string[] }>({
        action: "dispute", mode: "create",
        statement_id: sv(dtl.statement, "id"),
        billing_line_id: bdRow.billing_line_id,
        reason: bdForm.reason.trim(),
        claimed_amount: bdForm.claimed_amount,
        evidence: splitLines(bdForm.evidence),
      });
      toast.success(tt("lg.bill.dsp.ok", { v1: shortId(sv(r.dispute, "id")) }));
      setBdRow(null);
      setBdForm({ reason: "", claimed_amount: "", evidence: "" });
      refreshDetail();
      loadDisputes();
    } catch (e) { toast.error(errMsg(e), { duration: 12000 }); } finally { setBusyBd(false); }
  };


  const loadSummary = useCallback(() => {
    setLoadingSum(true);
    queryTable("v_forwarder_fee_summary", {
      filters: sumForwarder ? [{ field: "forwarder_id", value: sumForwarder }] : [],
      order: { field: "period_month", ascending: false },
    })
      .then(({ rows }) => setSumRows(rows.map(mapSum)))
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoadingSum(false));
  }, [sumForwarder]);
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // ---------------- 派生统计 ----------------
  const diffLines = useMemo(() => lines.filter((l) => l.diff_flag), [lines]);
  const pendingLines = useMemo(() => lines.filter((l) => l.status === "pending_audit"), [lines]);
  const lockedLines = useMemo(() => lines.filter((l) => l.status === "approved"), [lines]);
  const grouped = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of lines) {
      const arr = m.get(l.fee_type) ?? [];
      arr.push(l);
      m.set(l.fee_type, arr);
    }
    const order = (k: string) => {
      const i = FEE_TYPES.indexOf(k as (typeof FEE_TYPES)[number]);
      return i === -1 ? FEE_TYPES.length : i;
    };
    return Array.from(m.entries())
      .sort((a, b) => order(a[0]) - order(b[0]))
      .map(([fee, rows]) => ({ fee, rows, total: rows.reduce((s, r) => s + (r.amount ?? 0), 0) }));
  }, [lines]);
  const sumByMonth = useMemo(() => {
    const m = new Map<string, SumRow[]>();
    for (const r of sumRows) {
      const arr = m.get(r.period_month) ?? [];
      arr.push(r);
      m.set(r.period_month, arr);
    }
    // 视图已按 period_month desc 由 DB 排序，这里只做分组，不再二次排序
    return Array.from(m.entries());
  }, [sumRows]);
  const selDisputes = useMemo(() => disputes.filter((d) => d.statement_id === selId), [disputes, selId]);
  const auditBlocked = !!sel && (sel.status === "approved" || sel.status === "closed" || sel.status === "voided");
  // 顶部汇总：视图里最新的账期月（货代 × 费用类型），完整月份在「货代费用汇总」tab
  // DB 已 order period_month desc，第一条即最新账期月
  const latestMonth = sumRows[0]?.period_month ?? "";
  const topRows = useMemo(() => sumRows.filter((r) => r.period_month === latestMonth), [sumRows, latestMonth]);

  // ---------------- 动作：重算合计 ----------------
  const doRecalc = async () => {
    if (!selId) return;
    setBusyRecalc(true);
    setLastRpc("");
    try {
      const resp = await callRpc<ExtRow[] | ExtRow>("statement_recalc", { p_statement_id: selId });
      const rows = Array.isArray(resp) ? resp : resp ? [resp] : [];
      const r = rows[0];
      const total = r ? num(nsv(r, "total_amount")) : "—";
      const cnt = r ? nsv(r, "line_count") ?? 0 : 0;
      setLastRpc(`statement_recalc → total_amount=${total}, line_count=${cnt}`);
      toast.success(tt("lg.rec.recalcOk", { v1: total, v2: String(cnt) }));
      loadStmts();
      void loadLines(selId);
    } catch (e) {
      const m = errMsg(e);
      setLastRpc(m);
      toast.error(m);
    } finally {
      setBusyRecalc(false);
    }
  };

  // ---------------- 动作：审核（必须显式传 p_auditor） ----------------
  const doFinalize = async () => {
    if (!selId) return;
    if (!uid) { toast.error(tt("lg.rec.needLogin")); return; }
    setBusyFinal(true);
    setLastRpc("");
    try {
      const raw = await callRpc<string>("statement_finalize", { p_statement_id: selId, p_auditor: uid });
      const text = raw == null ? "" : String(raw);
      setLastRpc(`statement_finalize(p_auditor=${uid.slice(0, 8)}…) → ${text || "—"}`);
      if (text.startsWith("PENDING_AUDIT")) {
        toast.warning(tt("lg.rec.pendingAudit", { v1: text.split(":")[1] ?? "?" }), { description: text, duration: 9000 });
      } else if (text.startsWith("APPROVED")) {
        toast.success(tt("lg.rec.approved", { v1: text.slice("APPROVED:".length) || "—" }), { description: text });
      } else {
        toast.info(text || tt("lg.rec.noReturn"));
      }
      setFinalOpen(false);
      loadStmts();
      void loadLines(selId);
      loadDisputes();
    } catch (e) {
      const m = errMsg(e);
      setLastRpc(m);
      toast.error(m, { description: tt("lg.rec.dbRawBelow"), duration: 9000 });
    } finally {
      setBusyFinal(false);
    }
  };

  // ---------------- 动作：争议 ----------------
  const openDispute = (l: Line) => {
    setDisputeDlg(l);
    setDspForm({ reason: "", claimed_amount: "", evidence: "", status: "open" });
  };
  const saveDispute = async () => {
    if (!selId || !disputeDlg) return;
    if (!dspForm.reason.trim()) { toast.error(tt("lg.rec.dsp.needReason")); return; }
    setSavingDsp(true);
    try {
      await insertRow("statement_disputes", {
        statement_id: selId,
        billing_line_id: disputeDlg.id,
        reason: dspForm.reason.trim(),
        claimed_amount: dspForm.claimed_amount === "" ? null : Number(dspForm.claimed_amount),
        evidence: splitLines(dspForm.evidence),
        status: dspForm.status,
        created_by: uid || null,
      });
      toast.success(tt("lg.rec.dsp.created"));
      setDisputeDlg(null);
      loadDisputes();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSavingDsp(false); }
  };
  const openResolve = (d: Dispute) => {
    setResolveDlg(d);
    setResolveForm({ status: (DSP_NEXT[d.status] ?? [])[0] ?? "closed", resolved_amount: d.resolved_amount == null ? "" : String(d.resolved_amount) });
  };
  const saveResolve = async () => {
    if (!resolveDlg) return;
    if (!uid) { toast.error(tt("lg.rec.needLogin")); return; }
    const needAmount = resolveForm.status === "accepted" || resolveForm.status === "rejected" || resolveForm.status === "closed";
    if (needAmount && resolveForm.resolved_amount === "") { toast.error(tt("lg.rec.dsp.needResolved")); return; }
    setSavingResolve(true);
    try {
      await updateRow("statement_disputes", resolveDlg.id, {
        status: resolveForm.status,
        resolved_amount: resolveForm.resolved_amount === "" ? null : Number(resolveForm.resolved_amount),
        resolved_by: uid,
        resolved_at: new Date().toISOString(),
      });
      toast.success(tt("lg.rec.dsp.updated"));
      setResolveDlg(null);
      loadDisputes();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setSavingResolve(false); }
  };

  // ---------------- 渲染 ----------------
  // 预览步的问题行：errors / warnings 两份数组合并成一张按行号排序的表，方便逐行改 CSV。
  // errors/warnings 是全量（后端按行返回），lines 只回前 500 行，所以匹配状态用 lines 建索引补齐。
  const pvIssues = useMemo(() => {
    if (!pv) return [] as Array<{ row_no: number; match_status?: string; errors: RowIssue[]; warnings: RowIssue[] }>;
    const st = new Map<number, string>();
    for (const l of pv.lines ?? []) st.set(l.row_no, l.match_status);
    const m = new Map<number, { row_no: number; match_status?: string; errors: RowIssue[]; warnings: RowIssue[] }>();
    const put = (row_no: number) => { const v = m.get(row_no) ?? { row_no, errors: [], warnings: [] }; m.set(row_no, v); return v; };
    for (const e of pv.errors ?? []) { const v = put(e.row_no); v.match_status = e.match_status ?? st.get(e.row_no); v.errors.push(...(e.errors ?? [])); }
    for (const w of pv.warnings ?? []) { const v = put(w.row_no); v.match_status = v.match_status ?? w.match_status ?? st.get(w.row_no); v.warnings.push(...(w.warnings ?? [])); }
    return Array.from(m.values()).sort((a, b) => a.row_no - b.row_no);
  }, [pv]);
  const mmLineRow = (r: ExtRow): string[] => [
    feeLabel(sv(r, "fee_type")), sv(r, "charge_type") || "—", num(nsv(r, "amount")), sv(r, "currency") || "—",
    `${nsv(r, "weight_charged_g") == null ? "—" : num(nsv(r, "weight_charged_g"), 3)} / ${nsv(r, "weight_declared_g") == null ? "—" : num(nsv(r, "weight_declared_g"), 3)}`,
    sv(r, "status") ? tk(sv(r, "status")) : "—",
  ];
  const th = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-muted-foreground";
  const td = "px-3 py-2.5 text-sm";

  return (
    <div className="space-y-5">
      <PageHeader
        title={tt("lg.rec.title")}
        description={tt("lg.rec.desc")}
        code="FORWARDER BILLING"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => { setTab("imports"); openImport(); }}>
              <Upload size={14} className="mr-1.5" />{tt("lg.bill.ib.btnImport")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => { loadStmts(); loadDisputes(); loadSummary(); loadBatches(); toast.success(tt("lg.rec.reloaded")); }}>
              <RefreshCw size={14} className="mr-1.5" />{tt("lg.rec.reload")}
            </Button>
          </div>
        }
      />

      {/* 顶部汇总（视图 v_forwarder_fee_summary） */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={tt("lg.rec.stat.bills")} value={String(stmtTotal ?? stmts.length)} icon={<Scale size={14} />} />
        <StatCard label={tt("lg.rec.stat.pendingAudit")} value={String(pendingAuditTotal ?? stmts.filter((s) => s.status === "pending_audit").length)} icon={<ShieldAlert size={14} />} tone="warning" />
        <StatCard label={tt("lg.rec.stat.diff")} value={String(diffLines.length)} icon={<FileWarning size={14} />} tone="danger" />
        <StatCard label={tt("lg.rec.stat.disputes")} value={String(disputes.filter((d) => d.status === "open" || d.status === "processing").length)} icon={<Gavel size={14} />} tone="violet" />
      </div>

      {/* 顶部汇总（视图 v_forwarder_fee_summary 最新账期月） */}
      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">
            {tt("lg.rec.topSummary")}{latestMonth ? ` · ${latestMonth}` : ""}
          </h3>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setTab("summary")}>{tt("lg.rec.viewAll")}</Button>
        </div>
        {loadingSum ? (
          <p className="py-2 text-xs text-muted-foreground"><Loader2 size={14} className="mr-1.5 inline animate-spin" />{tt("lg.common.loading")}</p>
        ) : topRows.length === 0 ? (
          <p className="py-1 text-xs text-muted-foreground">{tt("lg.rec.topSummaryEmpty")}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {topRows.slice(0, 12).map((r) => (
              <div key={`${r.forwarder_id}-${r.fee_type}-${r.currency}`} className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-xs">
                <span className="font-medium text-ink">{tk(fwdName(r.forwarder_id))}</span>
                <span className="ml-1.5 text-fg-muted">{feeLabel(r.fee_type)}</span>
                <span className="ml-1.5 font-data text-primary">{num(r.total_amount)} {r.currency}</span>
                <span className="ml-1.5 font-data text-[11px] text-fg-muted">{r.line_count ?? 0} {tt("lg.rec.unit.line")}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-fg-muted">{tt("lg.rec.sum.viewName")}</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="statements">{tt("lg.rec.tab.bills")}</TabsTrigger>
          <TabsTrigger value="disputes">{tt("lg.rec.tab.disputes")}</TabsTrigger>
          <TabsTrigger value="imports">{tt("lg.rec.tab.imports")}</TabsTrigger>
          <TabsTrigger value="summary">{tt("lg.rec.tab.summary")}</TabsTrigger>
        </TabsList>

        {/* ============== 账单 ============== */}
        <TabsContent value="statements" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className={labelCls}>{tt("lg.rec.statusFilter")}</Label>
              <select className={cn(selCls, "w-44")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">{tt("lg.rec.filter.all")}</option>
                {ST_STATUS.map((s) => <option key={s} value={s}>{stStatusLabel(s)}</option>)}
              </select>
            </div>
            <p className="pb-2 text-xs text-fg-muted">{tt("lg.rec.filterDbNote")}</p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[1000px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[tt("lg.rec.col.forwarder"), tt("lg.rec.col.warehouse"), tt("lg.rec.col.period"), tt("lg.rec.col.currency"),
                    tt("lg.rec.col.total"), tt("lg.rec.col.lines"), tt("lg.common.status"), tt("lg.rec.col.source"),
                    tt("lg.rec.col.auditor"), tt("lg.rec.col.select")].map((h) => <th key={h} className={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {loadingStmts ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt("lg.common.loading")}</td></tr>
                ) : stmtsErr ? (
                  <tr><td colSpan={10} className="px-4 py-10 text-center text-sm text-destructive"><div className="flex items-center justify-center gap-1.5"><AlertTriangle size={15} />{tt("lg.rec.loadFail")}</div><pre className="mt-2 whitespace-pre-wrap break-all font-data text-xs">{stmtsErr}</pre></td></tr>
                ) : stmts.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    <p>{statusFilter === "all" ? tt("lg.rec.billsEmpty") : tt("lg.rec.billsEmptyFiltered")}</p>
                    <p className="mx-auto mt-1 max-w-xl text-xs">{tt("lg.bill.billsEmptyHint")}</p>
                  </td></tr>
                ) : stmts.map((s) => (
                  <tr key={s.id} className={cn("cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-muted/50", selId === s.id && "bg-primary/5")} onClick={() => setSelId(s.id)}>
                    <td className={cn(td, "font-medium text-ink")}>{tk(fwdName(s.forwarder_id))}</td>
                    <td className={cn(td, "text-xs text-fg-muted")}>{tk(whName(s.warehouse_id))}</td>
                    <td className={cn(td, "whitespace-nowrap font-data text-xs")}>{s.period_from} ~ {s.period_to}</td>
                    <td className={cn(td, "font-data")}>{s.currency}</td>
                    <td className={cn(td, "font-data font-semibold text-primary")}>{num(s.total_amount)} {s.currency}</td>
                    <td className={cn(td, "font-data")}>{s.line_count}</td>
                    <td className={td}><Badge variant={stStatusTone(s.status)}>{stStatusLabel(s.status)}</Badge></td>
                    <td className={cn(td, "text-xs text-fg-muted")}>{s.source === "import" ? tt("lg.rec.source.import") : s.source === "auto" ? tt("lg.rec.source.auto") : "—"}</td>
                    <td className={cn(td, "text-xs text-fg-muted")}>{userLabel(s.audited_by)}</td>
                    <td className={cn(td, "text-right")}>
                      <Button size="sm" variant={selId === s.id ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setSelId(s.id); }}>
                        {selId === s.id ? tt("lg.rec.col.selected") : tt("lg.rec.col.open")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页：range/count 全部由 DB 决定 */}
          {!loadingStmts && !stmtsErr && (stmtTotal ?? 0) > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-xs text-fg-muted">{tt("lg.common.pageInfo", { v1: stmtPage + 1, v2: stmtTotalPages, v3: stmtTotal ?? stmts.length })}</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={stmtPage <= 0} onClick={() => setStmtPage((v) => Math.max(0, v - 1))}>{tt("lg.common.prev")}</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={stmtPage + 1 >= stmtTotalPages} onClick={() => setStmtPage((v) => Math.min(stmtTotalPages - 1, v + 1))}>{tt("lg.common.next")}</Button>
              </div>
            </div>
          )}

          {/* 账单详情 */}
          {sel && (
            <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-sm font-semibold text-ink">
                    {tt("lg.rec.detailTitle")} · {tk(fwdName(sel.forwarder_id))} · {sel.period_from} ~ {sel.period_to}
                  </h3>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {tt("lg.rec.col.warehouse")}: {tk(whName(sel.warehouse_id))} · {tt("lg.rec.col.total")}: {num(sel.total_amount)} {sel.currency} · {tt("lg.rec.col.lines")}: {sel.line_count}
                    {linkCount != null ? ` · statement_lines: ${linkCount}` : ""}
                    {sel.audited_at ? ` · ${tt("lg.rec.auditedAt")}: ${dt(sel.audited_at)}` : ""}
                  </p>
                  {sel.notes && <p className="mt-1 text-xs text-fg-muted">{tt("lg.rec.notes")}: {sel.notes}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={doRecalc} disabled={busyRecalc}>
                    {busyRecalc ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RefreshCw size={14} className="mr-1.5" />}{tt("lg.rec.action.recalc")}
                  </Button>
                  <Button size="sm" onClick={() => setFinalOpen(true)} disabled={busyFinal || auditBlocked}>
                    {busyFinal ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Check size={14} className="mr-1.5" />}{tt("lg.rec.action.finalize")}
                  </Button>
                </div>
              </div>

              {auditBlocked && (
                <p className="text-[11px] text-warning">{tt("lg.rec.auditDisabledNote", { v1: stStatusLabel(sel.status) })}</p>
              )}

              {/* 审核署名 + 状态守卫提示 */}
              <div className="grid gap-2 rounded-xl bg-muted/50 px-4 py-3 text-xs text-fg-muted sm:grid-cols-3">
                <div>{tt("lg.rec.auditor")}：<span className="font-medium text-fg">{meLabel ? `${meLabel} · ${shortId(uid)}` : tt("lg.rec.notSignedIn")}</span></div>
                <div>{tt("lg.rec.pendingCount")}：<span className={cn("font-medium", pendingLines.length > 0 ? "text-warning" : "text-fg")}>{pendingLines.length}</span> / {lines.length}</div>
                <div>{tt("lg.rec.lockedCount")}：<span className="font-medium text-fg">{lockedLines.length}</span></div>
              </div>
              <p className="text-[11px] text-fg-muted">{tt("lg.rec.auditorGuard")}</p>

              {lastRpc && (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
                  <div className="text-[11px] text-fg-muted">{tt("lg.rec.rpcRaw")}</div>
                  <pre className="mt-0.5 whitespace-pre-wrap break-all font-data text-xs text-fg">{lastRpc}</pre>
                </div>
              )}

              {/* 称重差异条 */}
              <div className={cn("flex flex-wrap items-center gap-2 rounded-xl px-4 py-2.5 text-xs", diffLines.length > 0 ? "bg-destructive/10 text-destructive" : "bg-success-bg text-success")}>
                <FileWarning size={14} />
                <span className="font-medium">{tt("lg.rec.diffSummary", { v1: diffLines.length })}</span>
                <span className="opacity-80">{tt("lg.rec.diffRule")}</span>
              </div>

              {loadingLines && (
                <div className="py-8 text-center text-sm text-muted-foreground"><Loader2 size={16} className="mx-auto mb-1 animate-spin" />{tt("lg.rec.linesLoading")}</div>
              )}
              {!loadingLines && linesErr && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <div className="font-medium">{tt("lg.rec.loadFail")}</div>
                  <pre className="mt-1 whitespace-pre-wrap break-all font-data">{linesErr}</pre>
                </div>
              )}
              {!loadingLines && !linesErr && lines.length === 0 && (
                <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                  <p>{tt("lg.rec.linesEmpty")}</p>
                  <p className="mt-1 text-xs">{tt("lg.rec.linesEmptyNext")}</p>
                </div>
              )}

              {!loadingLines && lines.length > 0 && grouped.map((g) => (
                <div key={g.fee} className="overflow-hidden rounded-xl border border-border">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
                    <span className="text-sm font-medium text-ink">{feeLabel(g.fee)}<span className="ml-2 text-xs text-fg-muted">{g.fee}</span></span>
                    <span className="font-data text-xs text-fg-muted">{tt("lg.rec.groupSum", { v1: num(g.total, 4), v2: g.rows.length })}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1080px] text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-[11px] text-muted-foreground">
                          {[tt("lg.rec.ln.ref"), tt("lg.rec.ln.chargeType"), tt("lg.rec.ln.qty"), tt("lg.rec.ln.unitPrice"),
                            tt("lg.rec.ln.amount"), tt("lg.rec.ln.charged"), tt("lg.rec.ln.declared"), tt("lg.rec.ln.diffPct"),
                            tt("lg.rec.ln.diffFlag"), tt("lg.rec.ln.source"), tt("lg.common.status"), tt("lg.rec.ln.period"), tt("lg.common.actions")].map((h) => (
                            <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {g.rows.map((l) => {
                          const pct = l.weight_charged_g != null && l.weight_declared_g != null && l.weight_declared_g !== 0
                            ? ((l.weight_charged_g - l.weight_declared_g) / l.weight_declared_g) * 100 : null;
                          return (
                            <tr key={l.id} className={cn("border-b border-border last:border-0", l.diff_flag ? "bg-destructive/5" : "hover:bg-muted/40")}>
                              <td className={cn(td, "font-data text-xs text-fg-muted")} title={`${l.shipment_id || "-"} / ${l.parcel_id || "-"}`}>
                                {l.external_ref ? l.external_ref : `${tt("lg.rec.ln.ship")}:${shortId(l.shipment_id) || "—"}`}
                              </td>
                              <td className={cn(td, "text-xs")}>{l.charge_type ? tk(l.charge_type) : "—"}</td>
                              <td className={cn(td, "font-data text-xs")}>{num(l.charge_qty, 3)} {l.charge_unit ? `(${l.charge_unit})` : ""}</td>
                              <td className={cn(td, "font-data text-xs")}>{num(l.unit_price)}</td>
                              <td className={cn(td, "font-data font-semibold")}>{num(l.amount)} {l.currency}</td>
                              <td className={cn(td, "font-data text-xs", l.diff_flag && "text-destructive")}>{l.weight_charged_g == null ? "—" : `${num(l.weight_charged_g, 3)} g`}</td>
                              <td className={cn(td, "font-data text-xs")}>{l.weight_declared_g == null ? "—" : `${num(l.weight_declared_g, 3)} g`}</td>
                              <td className={cn(td, "font-data text-xs", (pct ?? 0) > 5 && "text-destructive")}>{pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}</td>
                              <td className={td}><Badge variant={l.diff_flag ? "destructive" : "muted"}>{l.diff_flag ? tt("lg.rec.diff.yes") : tt("lg.rec.diff.no")}</Badge></td>
                              <td className={cn(td, "text-xs text-fg-muted")}>{l.source || "—"}</td>
                              <td className={td}><Badge variant={lineStatusTone(l.status)}>{tt(`lg.rec.lineStatus.${l.status}`)}</Badge></td>
                              <td className={cn(td, "whitespace-nowrap font-data text-xs")}>{l.period || "—"}</td>
                              <td className={cn(td, "text-right")}>
                                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openDispute(l)}><Gavel size={12} className="mr-1" />{tt("lg.rec.action.dispute")}</Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}

              {/* 本单争议 */}
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Gavel size={14} />{tt("lg.rec.selDisputes")}（{selDisputes.length}）</h4>
                {selDisputes.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">{tt("lg.rec.selDisputesEmpty")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full min-w-[860px] text-sm">
                      <DisputeHead />
                      <tbody>
                        {selDisputes.map((d) => (
                          <DisputeRow key={d.id} d={d} userLabel={userLabel} onResolve={() => openResolve(d)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ============== 争议 ============== */}
        <TabsContent value="disputes" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className={labelCls}>{tt("lg.rec.dsp.statusFilter")}</Label>
              <select className={cn(selCls, "w-44")} value={disputeFilter} onChange={(e) => setDisputeFilter(e.target.value)}>
                <option value="all">{tt("lg.rec.filter.all")}</option>
                {DSP_STATUS.map((s) => <option key={s} value={s}>{dspLabel(s)}</option>)}
              </select>
            </div>
            <p className="pb-2 text-xs text-fg-muted">{tt("lg.rec.dsp.flowHint")}</p>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[1000px] text-sm">
              <DisputeHead />
              <tbody>
                {loadingDisputes ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt("lg.common.loading")}</td></tr>
                ) : disputes.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    <p>{tt("lg.rec.dspEmpty")}</p>
                    <p className="mt-1 text-xs">{tt("lg.rec.dspEmptyNext")}</p>
                  </td></tr>
                ) : disputes.map((d) => (
                  <DisputeRow key={d.id} d={d} userLabel={userLabel} onResolve={() => openResolve(d)} forwarder={tk(fwdName(stmts.find((s) => s.id === d.statement_id)?.forwarder_id ?? ""))} billPeriod={stmts.find((s) => s.id === d.statement_id) ? `${stmts.find((s) => s.id === d.statement_id)?.period_from} ~ ${stmts.find((s) => s.id === d.statement_id)?.period_to}` : shortId(d.statement_id)} />
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ============== 导入批次（CSV → 预览 → 落库 → 匹配差异，全部走 bill-import） ============== */}
        <TabsContent value="imports" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <SearchField
              value={ibKw}
              onChange={setIbKw}
              width="w-64"
              placeholder={tt("lg.bill.ib.searchPh")}
            />
            <div>
              <Label className={labelCls}>{tt("lg.rec.col.forwarder")}</Label>
              <select className={cn(selCls, "w-56")} value={ibForwarder} onChange={(e) => setIbForwarder(e.target.value)}>
                <option value="">{tt("lg.rec.filter.all")}</option>
                {forwarders.map((f) => <option key={f.id} value={f.id}>{tk(f.name)}</option>)}
              </select>
            </div>
            <Button variant="outline" size="sm" onClick={openImport}>
              <Upload size={14} className="mr-1.5" />{tt("lg.bill.ib.btnImport")}
            </Button>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" disabled={busyTpl} onClick={doTemplate}>
              {busyTpl ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Download size={14} className="mr-1.5" />}{tt("lg.bill.ib.btnTpl")}
            </Button>
            <p className="pb-2 text-xs text-fg-muted">{tt("lg.bill.ib.efNote")}</p>
          </div>

          {batchesErr && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="break-all">{batchesErr}</span>
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[1240px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[tt("lg.rec.ib.batch"), tt("lg.rec.col.forwarder"), tt("lg.rec.ib.bill"), tt("lg.rec.ib.rows"),
                    tt("lg.bill.ib.col.matchRate"), tt("lg.bill.ib.col.diffRows"), tt("lg.bill.ib.col.diffTotal"),
                    tt("lg.bill.ib.col.totals"), tt("lg.common.status"), tt("lg.rec.ib.by"), tt("lg.rec.ib.at"),
                    tt("lg.bill.ib.col.action")].map((h) => <th key={h} className={th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {loadingBatches ? (
                  <tr><td colSpan={12} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt("lg.common.loading")}</td></tr>
                ) : showBatches.length === 0 ? (
                  <tr><td colSpan={12} className="px-0 py-0">
                    <EmptyState
                      text={batches.length === 0 ? tt("lg.bill.ibEmpty") : tt("lg.bill.ib.noHit")}
                      hint={batches.length === 0 ? tt("lg.bill.ib.emptyHint") : tt("lg.bill.ib.noHitHint")}
                      action={batches.length === 0 ? (
                        <Button size="sm" onClick={openImport}><Upload size={14} className="mr-1.5" />{tt("lg.bill.ib.btnImport")}</Button>
                      ) : undefined}
                    />
                  </td></tr>
                ) : showBatches.map((b) => (
                  <tr key={b.id} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className={cn(td, "align-top")}>
                      <div className="font-data font-medium text-ink">{b.batch_no}</div>
                      <div className="mt-0.5 max-w-[220px] truncate text-[11px] text-fg-muted" title={b.file_name}>{b.file_name || "—"}</div>
                    </td>
                    <td className={cn(td, "align-top text-xs")}>{b.forwarder_name ? tk(b.forwarder_name) : (b.forwarder_id ? tk(fwdName(b.forwarder_id)) : "—")}</td>
                    <td className={cn(td, "align-top text-xs text-fg-muted")}>
                      <div className="font-data">{b.statement_id ? shortId(b.statement_id) : "—"}</div>
                      {(b.period_from || b.period_to) && (
                        <div className="mt-0.5 whitespace-nowrap font-data text-[11px]">{b.period_from} ~ {b.period_to} {b.currency ?? ""}</div>
                      )}
                    </td>
                    <td className={cn(td, "align-top font-data")}>
                      {b.row_count ?? "—"}
                      <span className="ml-1 text-[11px] text-success">{b.ok_count ?? 0}</span>
                      <span className={cn("ml-1 text-[11px]", (b.fail_count ?? 0) > 0 ? "text-destructive" : "text-fg-subtle")}>/{b.fail_count ?? 0}</span>
                    </td>
                    <td className={cn(td, "align-top font-data")}>
                      {b.match_rate_pct == null ? "—" : `${num(b.match_rate_pct, 1)}%`}
                      {(b.unmatched_rows ?? 0) > 0 && <div className="mt-0.5 text-[11px] text-warning">{tt("lg.bill.ib.unmatched", { v1: String(b.unmatched_rows) })}</div>}
                    </td>
                    <td className={cn(td, "align-top font-data", (b.diff_amount_rows ?? 0) > 0 ? "text-destructive" : "text-fg-muted")}>{b.diff_amount_rows ?? 0}</td>
                    <td className={cn(td, "align-top font-data", Number(b.diff_amount_total ?? 0) < 0 ? "text-destructive" : "text-success")}>{amtStr(b.diff_amount_total)}</td>
                    <td className={cn(td, "align-top font-data text-[11px]")}>
                      <div>{tt("lg.bill.ib.charged")}: {amtStr(b.charged_amount_total)}</div>
                      <div className="text-fg-muted">{tt("lg.bill.ib.declared")}: {amtStr(b.declared_amount_total)}</div>
                    </td>
                    <td className={cn(td, "align-top")}>
                      <Badge variant={stageTone(b.stage)}>{stageLabel(b.stage)}</Badge>
                      {(b.error_count ?? 0) > 0 && <div className="mt-0.5 text-[11px] text-destructive">{tt("lg.bill.ib.errN", { v1: String(b.error_count) })}</div>}
                    </td>
                    <td className={cn(td, "align-top text-xs text-fg-muted")}>{userLabel(b.imported_by ?? "")}</td>
                    <td className={cn(td, "align-top whitespace-nowrap font-data text-xs")}>{dt(b.imported_at ?? "")}</td>
                    <td className={cn(td, "align-top text-right")}>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void openDetail(b.id)}>
                        {tt("lg.bill.ib.col.detail")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 分页由 EF 的 limit/offset 决定；keyword 只过滤当前页（跨表 or 过滤在 EF 侧不可用） */}
          {!loadingBatches && !batchesErr && (ibTotal ?? 0) > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-xs text-fg-muted">
                {tt("lg.common.pageInfo", { v1: ibPage + 1, v2: ibTotalPages, v3: ibTotal ?? batches.length })}
                {ibKw.trim() ? tt("lg.bill.ib.kwFiltered") : ""}
                {ibNote ? ` · ${ibNote}` : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={ibPage <= 0} onClick={() => setIbPage((v) => Math.max(0, v - 1))}>{tt("lg.common.prev")}</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={ibPage + 1 >= ibTotalPages} onClick={() => setIbPage((v) => Math.min(ibTotalPages - 1, v + 1))}>{tt("lg.common.next")}</Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ============== 货代费用汇总（视图） ============== */}
        <TabsContent value="summary" className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className={labelCls}>{tt("lg.rec.col.forwarder")}</Label>
              <select className={cn(selCls, "w-56")} value={sumForwarder} onChange={(e) => setSumForwarder(e.target.value)}>
                <option value="">{tt("lg.rec.filter.all")}</option>
                {forwarders.map((f) => <option key={f.id} value={f.id}>{tk(f.name)}</option>)}
              </select>
            </div>
            <p className="pb-2 text-xs text-fg-muted">{tt("lg.rec.sum.viewName")}</p>
          </div>
          {loadingSum ? (
            <div className="rounded-2xl border border-border bg-card py-12 text-center text-sm text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt("lg.common.loading")}</div>
          ) : sumRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center text-sm text-muted-foreground">
              <p>{tt("lg.rec.sumEmpty")}</p>
              <p className="mt-1 text-xs">{tt("lg.rec.sumEmptyNext")}</p>
            </div>
          ) : sumByMonth.map(([month, rows]) => {
            const cur = rows[0]?.currency ?? "";
            const total = rows.reduce((s, r) => s + (r.total_amount ?? 0), 0);
            return (
              <div key={month} className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
                  <span className="font-data text-sm font-semibold text-ink">{month}</span>
                  <span className="font-data text-xs text-fg-muted">{tt("lg.rec.sum.monthTotal", { v1: num(total), v2: cur })}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.forwarder_id}-${r.fee_type}-${r.currency}`} className="border-b border-border last:border-0 hover:bg-muted/40">
                        <td className={cn(td, "font-medium text-ink")}>{tk(fwdName(r.forwarder_id))}</td>
                        <td className={td}>{feeLabel(r.fee_type)}<span className="ml-2 text-[11px] text-fg-muted">{r.fee_type}</span></td>
                        <td className={cn(td, "font-data")}>{num(r.total_amount)} {r.currency}</td>
                        <td className={cn(td, "font-data text-xs text-fg-muted")}>{r.line_count ?? 0} {tt("lg.rec.unit.line")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </TabsContent>
      </Tabs>

      {/* ============== 审核确认弹窗 ============== */}
      <AlertDialog open={finalOpen} onOpenChange={setFinalOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tt("lg.rec.finalTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{tt("lg.rec.finalDesc", { v1: sel ? `${tk(fwdName(sel.forwarder_id))} ${sel.period_from} ~ ${sel.period_to}` : "", v2: String(pendingLines.length) })}</p>
                {pendingLines.length > 0 && (
                  <p className="rounded-lg bg-warning-bg px-3 py-2 text-warning">{tt("lg.rec.finalWillPending", { v1: pendingLines.length })}</p>
                )}
                <p className="text-destructive">{tt("lg.rec.finalLockWarn")}</p>
                <p className="font-data text-[11px] text-fg-muted">{tt("lg.rec.auditor")}: {meLabel || "—"} · {shortId(uid)}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt("lg.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={busyFinal} onClick={doFinalize}>{busyFinal ? tt("lg.rec.finalizing") : tt("lg.rec.confirmFinalize")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ============== 新建争议 ============== */}
      <Dialog open={!!disputeDlg} onOpenChange={(o) => { if (!o) setDisputeDlg(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt("lg.rec.dsp.newTitle")}</DialogTitle>
            <DialogDescription>
              {tt("lg.rec.dsp.line")}: {disputeDlg ? `${feeLabel(disputeDlg.fee_type)} · ${num(disputeDlg.amount)} ${disputeDlg.currency}` : "—"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className={labelCls}>{tt("lg.rec.dsp.reason")} *</Label>
              <Textarea rows={3} value={dspForm.reason} onChange={(e) => setDspForm({ ...dspForm, reason: e.target.value })} placeholder={tt("lg.rec.dsp.reasonPh")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={labelCls}>{tt("lg.rec.dsp.claimed")}</Label>
                <Input type="number" value={dspForm.claimed_amount} onChange={(e) => setDspForm({ ...dspForm, claimed_amount: e.target.value })} placeholder="0.00" />
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.common.status")}</Label>
                <select className={selCls} value={dspForm.status} onChange={(e) => setDspForm({ ...dspForm, status: e.target.value })}>
                  <option value="open">{dspLabel("open")}</option>
                  <option value="processing">{dspLabel("processing")}</option>
                </select>
              </div>
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.rec.dsp.evidence")}</Label>
              <Textarea rows={2} value={dspForm.evidence} onChange={(e) => setDspForm({ ...dspForm, evidence: e.target.value })} placeholder={tt("lg.rec.dsp.evidencePh")} />
              <p className="mt-1 text-[11px] text-fg-muted">{tt("lg.rec.dsp.evidenceHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeDlg(null)}>{tt("lg.common.cancel")}</Button>
            <Button onClick={saveDispute} disabled={savingDsp}>{savingDsp ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : null}{tt("lg.common.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== 处理争议 ============== */}
      <Dialog open={!!resolveDlg} onOpenChange={(o) => { if (!o) setResolveDlg(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt("lg.rec.dsp.resolveTitle")}</DialogTitle>
            <DialogDescription>{resolveDlg ? `${tt("lg.rec.dsp.reason")}: ${resolveDlg.reason}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className={labelCls}>{tt("lg.rec.dsp.toStatus")}</Label>
              <select className={selCls} value={resolveForm.status} onChange={(e) => setResolveForm({ ...resolveForm, status: e.target.value })}>
                {(DSP_NEXT[resolveDlg?.status ?? "open"] ?? []).map((s) => <option key={s} value={s}>{dspLabel(s)}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-fg-muted">{tt("lg.rec.dsp.flowHint")}</p>
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.rec.dsp.resolvedAmount")}</Label>
              <Input type="number" value={resolveForm.resolved_amount} onChange={(e) => setResolveForm({ ...resolveForm, resolved_amount: e.target.value })} placeholder="0.00" />
            </div>
            <div className="sm:col-span-2">
              <Label className={labelCls}>{tt("lg.rec.dsp.resolvedBy")}</Label>
              <Input readOnly value={meLabel ? `${meLabel} · ${shortId(uid)}` : tt("lg.rec.notSignedIn")} className="bg-muted/50" />
              <p className="mt-1 text-[11px] text-fg-muted">{tt("lg.rec.dsp.resolvedByHint")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDlg(null)}>{tt("lg.common.cancel")}</Button>
            <Button onClick={saveResolve} disabled={savingResolve}>{savingResolve ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : null}{tt("lg.rec.dsp.submit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== 货代账单 CSV 导入向导（preview 干跑 → commit 落库） ============== */}
      <Dialog open={impOpen} onOpenChange={(o) => { if (!o && !busyCommit) setImpOpen(false); }}>
        <DialogContent className={cn("max-h-[92vh] overflow-y-auto", impStep === "pick" ? "max-w-3xl" : "max-w-5xl")}>
          <DialogHeader>
            <DialogTitle>{impStep === "pick" ? tt("lg.bill.wiz.t1") : tt("lg.bill.wiz.t2")}</DialogTitle>
            <DialogDescription>
              {impStep === "pick"
                ? tt("lg.bill.wiz.d1")
                : (pv ? tt("lg.bill.wiz.d2", { v1: pv.batch_no, v2: pv.file_name, v3: pv.delimiter }) : "")}
            </DialogDescription>
          </DialogHeader>

          {impErr && (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span className="break-all">{impErr}</span>
            </div>
          )}

          {impStep === "pick" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label className={labelCls}>{tt("lg.bill.wiz.file")}</Label>
                <input
                  ref={fileRef} type="file" accept=".csv,text/csv,text/plain" className="hidden"
                  onChange={(e) => { void onPickFile(e.target.files?.[0] ?? null); }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <FileSpreadsheet size={14} className="mr-1.5" />{tt("lg.bill.wiz.pick")}
                  </Button>
                  <span className="max-w-[280px] truncate font-data text-xs text-fg-muted" title={csvName}>{csvName || "—"}</span>
                  {csvText && (
                    <>
                      <span className="font-data text-[11px] text-fg-muted">{tt("lg.bill.wiz.chars", { v1: csvText.length })}</span>
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                        onClick={() => { setCsvText(""); setCsvName(""); if (fileRef.current) fileRef.current.value = ""; }}>
                        {tt("lg.bill.clear")}
                      </Button>
                    </>
                  )}
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={busyTpl} onClick={doTemplate}>
                    {busyTpl ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Download size={14} className="mr-1.5" />}{tt("lg.bill.ib.btnTpl")}
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-fg-muted">{tt("lg.bill.wiz.fileHint")}</p>
              </div>

              <div className="sm:col-span-2">
                <Label className={labelCls}>{tt("lg.bill.wiz.paste")}</Label>
                <Textarea
                  rows={5} className="font-data text-xs" value={csvText}
                  onChange={(e) => setCsvText(e.target.value)} placeholder={tt("lg.bill.wiz.pastePh")}
                />
              </div>

              <div>
                <Label className={labelCls}>{tt("lg.rec.col.forwarder")} *</Label>
                <select className={selCls} value={impForwarder} onChange={(e) => setImpFwd(e.target.value)}>
                  <option value="">{tt("lg.bill.wiz.needFwd")}</option>
                  {forwarders.map((f) => <option key={f.id} value={f.id}>{tk(f.name)}</option>)}
                </select>
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.rec.ib.batch")}</Label>
                <Input value={impBatchNo} onChange={(e) => setImpBatchNo(e.target.value)} placeholder={tt("lg.bill.wiz.batchPh")} />
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.bill.wiz.periodFrom")}</Label>
                <Input type="date" value={impFrom} onChange={(e) => setImpFrom(e.target.value)} />
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.bill.wiz.periodTo")}</Label>
                <Input type="date" value={impTo} onChange={(e) => setImpTo(e.target.value)} />
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.rec.col.currency")}</Label>
                <Input value={impCurrency} onChange={(e) => setImpCurrency(e.target.value.toUpperCase())} placeholder={tpl?.default_currency || "CNY"} />
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.rec.col.warehouse")}</Label>
                <select className={selCls} value={impWarehouse} onChange={(e) => setImpWarehouse(e.target.value)}>
                  <option value="">{tt("lg.bill.wiz.whNone")}</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{tk(w.name)}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-2 sm:col-span-2">
                <label className="flex items-start gap-2 text-xs text-fg">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={allowErrors} onChange={(e) => setAllowErrors(e.target.checked)} />
                  <span>{tt("lg.bill.wiz.allowErrors")}<span className="block text-[11px] text-fg-muted">{tt("lg.bill.wiz.allowErrorsHint")}</span></span>
                </label>
                <label className="flex items-start gap-2 text-xs text-fg">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={allowUnmatched} onChange={(e) => setAllowUnmatched(e.target.checked)} />
                  <span>{tt("lg.bill.wiz.allowUnmatched")}<span className="block text-[11px] text-fg-muted">{tt("lg.bill.wiz.allowUnmatchedHint")}</span></span>
                </label>
              </div>

              {(tpl?.notes ?? []).length > 0 && (
                <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-fg-muted sm:col-span-2">
                  {tpl?.notes.map((n, i) => <div key={i}>· {n}</div>)}
                  <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 px-1.5 text-[11px]" onClick={() => setShowCols((v) => !v)}>
                    {showCols ? tt("lg.bill.hideCols") : tt("lg.bill.showCols")}
                  </Button>
                  {showCols && tpl && (
                    <div className="mt-1 max-h-56 overflow-auto rounded-lg border border-border bg-card">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            {[tt("lg.bill.col.label"), tt("lg.bill.col.required"), tt("lg.bill.col.aliases")].map((h) => (
                              <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-muted-foreground">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tpl.columns.map((c) => (
                            <tr key={c.key} className="border-b border-border last:border-0">
                              <td className="px-2 py-1.5 align-top">
                                <span className="font-medium text-ink">{c.label}</span>
                                <span className="ml-1 font-data text-fg-subtle">{c.key}</span>
                                {c.note ? <span className="block text-fg-subtle">{c.note}</span> : null}
                              </td>
                              <td className="px-2 py-1.5 align-top">{c.required ? <Badge variant="destructive">{tt("lg.bill.yes")}</Badge> : <Badge variant="muted">{tt("lg.bill.no")}</Badge>}</td>
                              <td className="px-2 py-1.5 align-top font-data">{[c.label, ...c.aliases].join(" / ")}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
              <p className="text-[11px] text-fg-muted sm:col-span-2">{tt("lg.bill.wiz.units", { v1: tpl?.units.weight ?? "g", v2: tpl?.units.length ?? "cm" })}</p>
            </div>
          )}

          {impStep === "preview" && pv && (
            <div className="space-y-4">
              {pv.already_imported && (
                <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{tt("lg.bill.wiz.dup", { v1: pv.batch_no })}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label={tt("lg.bill.s.importable")} value={String(pv.summary.importable_rows)} footer={tt("lg.bill.s.ofTotal", { v1: pv.summary.total_records })} icon={<Check size={14} />} tone="success" />
                <StatCard label={tt("lg.bill.s.errorRows")} value={String(pv.summary.error_rows)} icon={<AlertTriangle size={14} />} tone="danger" />
                <StatCard label={tt("lg.bill.s.matched")} value={String(pv.summary.matched_rows)} footer={tt("lg.bill.s.rate", { v1: num(pv.summary.match_rate_pct, 1) })} icon={<Link2 size={14} />} tone="primary" />
                <StatCard label={tt("lg.bill.s.unmatched")} value={String(pv.summary.unmatched_rows)} footer={tt("lg.bill.s.unmatchedAmt", { v1: amtStr(pv.summary.unmatched_amount_total) })} icon={<FileWarning size={14} />} tone="warning" />
              </div>

              {/* 预计差异总额：全部取后端定点字符串，前端不做任何金额运算 */}
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                <div className="mb-1 text-xs font-medium text-ink">{tt("lg.bill.diffPanel")}</div>
                <div className="grid grid-cols-2 gap-2 font-data text-xs sm:grid-cols-4">
                  <div><div className="text-fg-muted">{tt("lg.bill.ib.charged")}</div><div className="font-semibold">{amtStr(pv.summary.charged_amount_total)} {pv.statement.currency}</div></div>
                  <div><div className="text-fg-muted">{tt("lg.bill.ib.declared")}</div><div className="font-semibold">{amtStr(pv.summary.declared_amount_total)} {pv.statement.currency}</div></div>
                  <div><div className="text-fg-muted">{tt("lg.bill.s.diffTotal")}</div><div className={cn("font-semibold", Number(pv.summary.diff_amount_total) < 0 ? "text-destructive" : "text-success")}>{amtStr(pv.summary.diff_amount_total)}</div></div>
                  <div><div className="text-fg-muted">{tt("lg.bill.s.diffRows")}</div><div className="font-semibold">{pv.summary.diff_amount_rows} / {pv.summary.diff_weight_rows}</div></div>
                </div>
                <p className="mt-2 text-[11px] text-fg-muted">{tt("lg.bill.diffRule", { v1: tpl?.diff_rule.note ?? "|charged − declared| / declared > 5%" })}</p>
              </div>

              <div className="flex flex-wrap gap-2 text-[11px] text-fg-muted">
                <Badge variant="outline">{tt("lg.bill.wiz.delimiter")}: {pv.delimiter === "," ? "CSV" : pv.delimiter === "\t" ? "TSV" : pv.delimiter === ";" ? "SEMICOLON" : pv.delimiter}</Badge>
                {pv.statement.warehouse_id && <Badge variant="outline">{tt("lg.rec.col.warehouse")}: {tk(whName(pv.statement.warehouse_id))}</Badge>}
                <Badge variant="outline">{tt("lg.bill.wiz.period")}: {pv.statement.period_from} ~ {pv.statement.period_to}</Badge>
                <Badge variant={pv.unknown_headers.length ? "warning" : "muted"}>{tt("lg.bill.wiz.unknownHdr", { v1: pv.unknown_headers.length })}{pv.unknown_headers.length ? `：${pv.unknown_headers.map((h) => h.header).join("、")}` : ""}</Badge>
                <Badge variant={pv.duplicated_headers.length ? "warning" : "muted"}>{tt("lg.bill.wiz.dupHdr", { v1: pv.duplicated_headers.length })}{pv.duplicated_headers.length ? `：${pv.duplicated_headers.map((h) => h.header).join("、")}` : ""}</Badge>
                <Badge variant={pv.ragged_rows.length ? "destructive" : "muted"}>{tt("lg.bill.wiz.ragged", { v1: pv.ragged_rows.length })}{pv.ragged_rows.length ? `：${pv.ragged_rows.map((r) => `${tt("lg.bill.line")} ${r.line}(${r.cells})`).join("、")}` : ""}</Badge>
                <Badge variant="muted">{tt("lg.bill.wiz.blank", { v1: pv.blank_lines })}</Badge>
              </div>

              {pvIssues.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-ink">
                    {tt("lg.bill.wiz.issueTitle", { v1: pvIssues.length })}
                  </div>
                  <div className="max-h-64 overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {[tt("lg.bill.col.row"), tt("lg.bill.col.ms"), tt("lg.bill.col.errs"), tt("lg.bill.col.warns")].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {pvIssues.map((r) => (
                          <tr key={r.row_no} className="border-b border-border last:border-0 align-top">
                            <td className="px-3 py-2 font-data">{r.row_no}</td>
                            <td className="px-3 py-2"><Badge variant={msTone(r.match_status ?? "error")}>{msLabel(r.match_status)}</Badge></td>
                            <td className="px-3 py-2 text-destructive">
                              {r.errors.length ? r.errors.map((e) => <div key={e.code}>{e.code}: {e.message}</div>) : "—"}
                            </td>
                            <td className="px-3 py-2 text-warning">
                              {r.warnings.length ? r.warnings.map((w) => <div key={w.code}>{w.code}: {w.message}</div>) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[900px] text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {[tt("lg.bill.col.row"), tt("lg.bill.col.ms"), tt("lg.rec.col.lines"), tt("lg.bill.col.charged"),
                        tt("lg.bill.col.declared"), tt("lg.bill.col.diff"), tt("lg.bill.col.diffPct"),
                        tt("lg.bill.col.wCharged"), tt("lg.bill.col.matched")].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pv.lines.slice(0, 30).map((l) => (
                      <tr key={l.row_no} className={cn("border-b border-border last:border-0", l.amount_diff_flag && "bg-destructive/5", l.errors?.length && "bg-muted/40")}>
                        <td className="px-3 py-2 font-data">{l.row_no}</td>
                        <td className="px-3 py-2"><Badge variant={msTone(l.match_status)}>{msLabel(l.match_status)}</Badge></td>
                        <td className="px-3 py-2">{feeLabel(l.fee_type ?? "")}</td>
                        <td className="px-3 py-2 font-data">{amtStr(l.charged_amount)} {l.currency}</td>
                        <td className="px-3 py-2 font-data">{amtStr(l.declared_amount)}</td>
                        <td className={cn("px-3 py-2 font-data", l.amount_diff_flag ? "font-semibold text-destructive" : "")}>{amtStr(l.amount_diff)}</td>
                        <td className="px-3 py-2 font-data">{bpText(l.amount_diff_pct)}{l.amount_diff_flag ? " ⚠" : ""}</td>
                        <td className="px-3 py-2 font-data">{amtStr(l.weight_charged_g)} / {amtStr(l.weight_declared_g)}{l.diff_flag ? " ⚠" : ""}</td>
                        <td className="px-3 py-2 font-data text-fg-muted">{l.shipment_tracking_no || l.match_value || (l.billing_line_id ? shortId(l.billing_line_id) : "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {pv.lines.length > 30 || pv.lines_truncated ? (
                  <p className="border-t border-border bg-muted/30 px-3 py-2 text-[11px] text-fg-muted">{tt("lg.bill.wiz.linesMore", { v1: pv.lines.length })}</p>
                ) : null}
              </div>
            </div>
          )}

          <DialogFooter>
            {impStep === "pick" ? (
              <>
                <Button variant="outline" onClick={() => setImpOpen(false)} disabled={busyCommit}>{tt("lg.common.cancel")}</Button>
                <Button onClick={doPreview} disabled={busyPv}>
                  {busyPv ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : null}{tt("lg.bill.wiz.toPreview")}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" onClick={() => { setImpStep("pick"); setPv(null); }} disabled={busyCommit}>{tt("lg.bill.wiz.back")}</Button>
                <Button onClick={doCommit} disabled={busyCommit || !pv || pv.summary.importable_rows === 0}>
                  {busyCommit ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : null}{tt("lg.bill.wiz.commit")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== 批次明细抽屉（货代值 vs 系统值 / 人工匹配 / 发起争议 / 导出差异行） ============== */}
      <Sheet open={!!dtlId} onOpenChange={(o) => { if (!o) { setDtlId(""); setDtl(null); setMmRow(null); setBdRow(null); } }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[1180px]">
          <SheetHeader className="pr-10">
            <SheetTitle className="font-data text-base">{dtl ? `${tt("lg.bill.dtl.title")} · ${dtl.batch.batch_no}` : tt("lg.bill.dtl.title")}</SheetTitle>
            <SheetDescription className="text-xs">
              {dtl
                ? tt("lg.bill.dtl.sub", {
                  v1: dtl.batch.file_name || "—",
                  v2: dtl.batch.forwarder_name ?? (dtl.batch.forwarder_id ? fwdName(dtl.batch.forwarder_id) : "—"),
                  v3: dtl.batch.match_rate_pct == null ? "—" : `${num(dtl.batch.match_rate_pct, 1)}%`,
                })
                : tt("lg.common.loading")}
            </SheetDescription>
          </SheetHeader>

          {dtlErr && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /><span className="break-all">{dtlErr}</span>
            </div>
          )}
          {busyDtl && <p className="mt-4 text-xs text-muted-foreground"><Loader2 size={14} className="mr-1.5 inline animate-spin" />{tt("lg.common.loading")}</p>}

          {dtl && !busyDtl && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label={tt("lg.bill.s.importable")} value={String(dtl.summary?.importable_rows ?? "—")} footer={tt("lg.bill.s.ofTotal", { v1: dtl.summary?.total_records ?? dtl.batch.row_count ?? 0 })} tone="success" />
                <StatCard label={tt("lg.bill.s.errorRows")} value={String(dtl.summary?.error_rows ?? "—")} tone="danger" />
                <StatCard label={tt("lg.bill.s.diffRows")} value={String(dtl.summary?.diff_amount_rows ?? "—")} footer={tt("lg.bill.s.diffWeightRows", { v1: dtl.summary?.diff_weight_rows ?? 0 })} tone="warning" />
                <StatCard label={tt("lg.bill.s.diffTotal")} value={amtStr(dtl.summary?.diff_amount_total ?? null)} footer={tt("lg.bill.s.unmatchedAmt", { v1: amtStr(dtl.summary?.unmatched_amount_total ?? null) })} tone="violet" />
              </div>

              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-xs">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div><span className="text-fg-muted">{tt("lg.bill.dtl.stage")}: </span><Badge variant={stageTone(dtl.batch.stage)}>{stageLabel(dtl.batch.stage)}</Badge></div>
                  <div><span className="text-fg-muted">{tt("lg.bill.dtl.statement")}: </span><span className="font-data">{dtl.statement ? shortId(sv(dtl.statement, "id")) : "—"}</span>{dtl.statement ? ` ${stStatusLabel(sv(dtl.statement, "status"))}` : ""}</div>
                  <div><span className="text-fg-muted">{tt("lg.rec.col.total")}: </span><span className="font-data">{dtl.statement ? num(nsv(dtl.statement, "total_amount")) : "—"}</span></div>
                  <div><span className="text-fg-muted">{tt("lg.bill.dtl.rows")}: </span><span className="font-data">{dtl.statement ? nsv(dtl.statement, "line_count") ?? 0 : 0}</span></div>
                </div>
                {dtl.write && (
                  <p className="mt-2 font-data text-[11px] text-fg-muted">
                    {tt("lg.bill.dtl.write", {
                      v1: String(dtl.write.attached ?? 0), v2: String(dtl.write.weight_updated ?? 0),
                      v3: String(dtl.write.locked_skipped ?? 0), v4: String(dtl.write.attach_failed ?? 0),
                      v5: String(dtl.write.external_ref_filled ?? 0),
                    })}
                  </p>
                )}
                {dtl.lines_truncated && <p className="mt-1 text-[11px] text-warning">{tt("lg.bill.dtl.truncated")}</p>}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={busyExport} onClick={() => void doExport(true)}>
                  {busyExport ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Download size={14} className="mr-1.5" />}{tt("lg.bill.dtl.exportDiff")}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={busyExport} onClick={() => void doExport(false)}>
                  {tt("lg.bill.dtl.exportAll")}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={refreshDetail}>
                  <RefreshCw size={14} className="mr-1.5" />{tt("lg.bill.dtl.refresh")}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setDtlRaw((v) => !v)}>
                  {dtlRaw ? tt("lg.bill.dtl.hideRaw") : tt("lg.bill.dtl.showRaw")}
                </Button>
                <span className="text-[11px] text-fg-muted">{tt("lg.bill.dtl.hint")}</span>
              </div>

              {dtl.disputes.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-ink">{tt("lg.bill.dtl.disputes", { v1: dtl.disputes.length })}</div>
                  <table className="w-full text-xs">
                    <tbody>
                      {dtl.disputes.map((d) => (
                        <tr key={sv(d, "id")} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-data text-fg-muted">{shortId(sv(d, "billing_line_id"))}</td>
                          <td className="px-3 py-2">{sv(d, "reason")}</td>
                          <td className="px-3 py-2 font-data">{num(nsv(d, "claimed_amount"))}</td>
                          <td className="px-3 py-2"><Badge variant={dspTone(sv(d, "status"))}>{dspLabel(sv(d, "status"))}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[1160px] text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      {[tt("lg.bill.col.row"), tt("lg.bill.col.ms"), tt("lg.rec.col.lines"), tt("lg.bill.col.charged"),
                        tt("lg.bill.col.declared"), tt("lg.bill.col.diff"), tt("lg.bill.col.diffPct"),
                        tt("lg.bill.col.wCharged"), tt("lg.bill.col.matched"), tt("lg.common.status"), tt("lg.common.actions")].map((h) => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dtl.lines.map((l) => (
                      <tr key={l.row_no} className={cn("border-b border-border last:border-0 align-top", l.amount_diff_flag && "bg-destructive/5", l.match_status === "error" && "bg-muted/40")}>
                        <td className="px-3 py-2 font-data">{l.row_no}</td>
                        <td className="px-3 py-2">
                          <Badge variant={msTone(l.match_status)}>{msLabel(l.match_status)}</Badge>
                          {l.matched_by ? <div className="mt-0.5 font-data text-[10px] text-fg-subtle">{l.matched_by}</div> : null}
                          {l.matched_manually ? <div className="mt-0.5 text-[10px] text-info">{tt("lg.bill.dtl.manual")}</div> : null}
                        </td>
                        <td className="px-3 py-2">{feeLabel(l.fee_type ?? "")}</td>
                        <td className="px-3 py-2 font-data">{amtStr(l.charged_amount)} {l.currency}</td>
                        <td className="px-3 py-2 font-data">{amtStr(l.declared_amount)}</td>
                        <td className={cn("px-3 py-2 font-data", l.amount_diff_flag ? "font-semibold text-destructive" : "")}>{amtStr(l.amount_diff)}</td>
                        <td className="px-3 py-2 font-data">{bpText(l.amount_diff_pct)}{l.amount_diff_flag ? " ⚠" : ""}</td>
                        <td className="px-3 py-2 font-data">
                          {amtStr(l.weight_charged_g)} / {amtStr(l.weight_declared_g)}
                          {(l.diff_flag_now ?? l.diff_flag) ? <span className="ml-1 text-destructive">⚠</span> : null}
                        </td>
                        <td className="px-3 py-2 font-data text-fg-muted">
                          {l.shipment_tracking_no || (l.billing_line_id ? shortId(l.billing_line_id) : "—")}
                          {l.shipment_wms_order_no ? <div className="text-[10px]">{l.shipment_wms_order_no}</div> : null}
                        </td>
                        <td className="px-3 py-2">
                          {l.line_status_now ? <Badge variant={lineStatusTone(l.line_status_now)}>{tk(l.line_status_now)}</Badge> : <span className="text-fg-subtle">—</span>}
                          {l.dispute_status ? <div className="mt-0.5"><Badge variant={dspTone(l.dispute_status)}>{dspLabel(l.dispute_status)}</Badge></div> : null}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col items-end gap-1">
                            <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => openMatch(l)}>
                              <Link2 size={12} className="mr-1" />{tt("lg.bill.dtl.manualBtn")}
                            </Button>
                            {l.billing_line_id && (
                              <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => openBatchDispute(l)}>
                                <Gavel size={12} className="mr-1" />{tt("lg.bill.dtl.disputeBtn")}
                              </Button>
                            )}
                            {l.candidates && l.candidates.length > 1 && (
                              <span className="text-[10px] text-warning">{tt("lg.bill.dtl.candN", { v1: l.candidates.length })}</span>
                            )}
                            {(l.errors ?? []).length > 0 && (
                              <span className="max-w-[180px] text-[10px] leading-tight text-destructive" title={issuesText(l.errors)}>{issuesText(l.errors)}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dtl.lines.length === 0 && <p className="border-t border-border px-3 py-6 text-center text-xs text-fg-muted">{tt("lg.bill.dtl.noLines")}</p>}
              </div>

              {dtl.unmatched.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-ink">
                    {tt("lg.bill.dtl.unmatchedTitle", { v1: dtl.unmatched.length, v2: amtStr(dtl.summary?.unmatched_amount_total ?? null) })}
                  </div>
                  <div className="max-h-56 overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {[tt("lg.bill.col.row"), tt("lg.bill.col.ms"), tt("lg.rec.col.lines"), tt("lg.bill.col.charged"), tt("lg.bill.col.key")].map((h) => (
                            <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dtl.unmatched.map((u) => (
                          <tr key={u.row_no} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 font-data">{u.row_no}</td>
                            <td className="px-3 py-2"><Badge variant={msTone(u.match_status ?? "unmatched")}>{msLabel(u.match_status)}</Badge></td>
                            <td className="px-3 py-2">{feeLabel(u.fee_type ?? "")}</td>
                            <td className="px-3 py-2 font-data">{amtStr(u.charged_amount)} {u.currency}</td>
                            <td className="px-3 py-2 font-data text-fg-muted">{u.matched_by ?? "—"}: {u.match_value ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t border-border bg-muted/30 px-3 py-2 text-[11px] text-fg-muted">{tt("lg.bill.dtl.unmatchedNote")}</p>
                </div>
              )}

              {dtlRaw && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium text-ink">{tt("lg.bill.dtl.rawTitle")}</div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-3 py-2 font-data text-[11px] text-fg">
                    {jsonText({ summary: dtl.summary, write: dtl.write, unknown_headers: dtl.unknown_headers, ragged_rows: dtl.ragged_rows, errors: dtl.errors, warnings: dtl.warnings })}
                  </pre>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============== 人工匹配：先挑货件（单号等值查库），再挑该货件下的费用行 ============== */}
      <Dialog open={!!mmRow} onOpenChange={(o) => { if (!o && !busyMm) setMmRow(null); }}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tt("lg.bill.mm.title")}</DialogTitle>
            <DialogDescription>
              {mmRow ? tt("lg.bill.mm.sub", {
                v1: String(mmRow.row_no), v2: feeLabel(mmRow.fee_type ?? ""),
                v3: amtStr(mmRow.charged_amount), v4: mmRow.match_value || "—",
              }) : ""}
            </DialogDescription>
          </DialogHeader>
          {mmRow && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[240px] flex-1">
                  <Label className={labelCls}>{tt("lg.bill.mm.kw")}</Label>
                  <Input value={mmKw} onChange={(e) => setMmKw(e.target.value)} placeholder={tt("lg.bill.mm.kwPh")} onKeyDown={(e) => { if (e.key === "Enter") void searchShips(); }} />
                </div>
                <Button size="sm" variant="outline" disabled={busySearch} onClick={() => void searchShips()}>
                  {busySearch ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}{tt("lg.bill.mm.search")}
                </Button>
              </div>
              <p className="text-[11px] text-fg-muted">{tt("lg.bill.mm.kwHint")}</p>

              {mmShips.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        {[tt("lg.bill.mm.pick"), tt("lg.bill.mm.shipment"), tt("lg.bill.mm.wms"), tt("lg.bill.mm.platform"), tt("lg.bill.mm.weight"), tt("lg.common.status")].map((h) => (
                          <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mmShips.map((s) => (
                        <tr key={sv(s, "id")} className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-muted/40", mmShip === sv(s, "id") && "bg-primary/5")} onClick={() => void pickShip(sv(s, "id"))}>
                          <td className="px-3 py-2"><input type="radio" className="h-4 w-4 accent-primary" checked={mmShip === sv(s, "id")} onChange={() => void pickShip(sv(s, "id"))} /></td>
                          <td className="px-3 py-2 font-data">{sv(s, "tracking_no") || shortId(sv(s, "id"))}</td>
                          <td className="px-3 py-2 font-data text-fg-muted">{sv(s, "wms_order_no") || "—"}</td>
                          <td className="px-3 py-2 font-data text-fg-muted">{sv(s, "platform_order_no") || "—"}</td>
                          <td className="px-3 py-2 font-data">{num(nsv(s, "actual_weight_g") ?? nsv(s, "declared_weight_g"), 3)}</td>
                          <td className="px-3 py-2 text-fg-muted">{sv(s, "status") ? tk(sv(s, "status")) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {mmShip && (
                mmLines.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-fg-muted">
                    {busySearch ? tt("lg.common.loading") : tt("lg.bill.mm.noLines")}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          {[tt("lg.bill.mm.pick"), tt("lg.rec.col.lines"), tt("lg.bill.mm.chargeType"), tt("lg.bill.col.declared"),
                            tt("lg.rec.col.currency"), tt("lg.bill.col.wCharged"), tt("lg.common.status"), tt("lg.bill.mm.lineId")].map((h) => (
                            <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {mmLines.map((r) => (
                          <tr key={sv(r, "id")} className={cn("cursor-pointer border-b border-border last:border-0 hover:bg-muted/40", mmLine === sv(r, "id") && "bg-primary/5")} onClick={() => setMmLine(sv(r, "id"))}>
                            <td className="px-3 py-2"><input type="radio" className="h-4 w-4 accent-primary" checked={mmLine === sv(r, "id")} onChange={() => setMmLine(sv(r, "id"))} /></td>
                            {mmLineRow(r).map((c, i) => <td key={i} className={cn("px-3 py-2", i === 2 && "font-data", i >= 3 && "font-data text-fg-muted")}>{c}</td>)}
                            <td className="px-3 py-2 font-data text-[10px] text-fg-subtle">{shortId(sv(r, "id"))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
              <p className="text-[11px] text-fg-muted">{tt("lg.bill.mm.note")}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMmRow(null)} disabled={busyMm}>{tt("lg.common.cancel")}</Button>
            <Button onClick={doMatch} disabled={busyMm || !mmLine}>
              {busyMm ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : null}{tt("lg.bill.mm.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== 抽屉内发起争议（走 EF：状态机 + 同费用行重复争议守卫） ============== */}
      <Dialog open={!!bdRow} onOpenChange={(o) => { if (!o && !busyBd) setBdRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tt("lg.bill.dsp.title")}</DialogTitle>
            <DialogDescription>
              {bdRow ? tt("lg.bill.dsp.sub", { v1: String(bdRow.row_no), v2: shortId(bdRow.billing_line_id ?? "") }) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className={labelCls}>{tt("lg.rec.dsp.reason")} *</Label>
              <Textarea rows={3} value={bdForm.reason} onChange={(e) => setBdForm({ ...bdForm, reason: e.target.value })} placeholder={tt("lg.rec.dsp.reasonPh")} />
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.rec.dsp.claimed")}</Label>
              <Input value={bdForm.claimed_amount} onChange={(e) => setBdForm({ ...bdForm, claimed_amount: e.target.value })} placeholder="0.0000" />
              <p className="mt-1 text-[11px] text-fg-muted">{tt("lg.bill.dsp.claimedHint", { v1: amtStr(bdRow?.charged_amount ?? null) })}</p>
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.rec.dsp.evidence")}</Label>
              <Textarea rows={2} value={bdForm.evidence} onChange={(e) => setBdForm({ ...bdForm, evidence: e.target.value })} placeholder={tt("lg.rec.dsp.evidencePh")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBdRow(null)} disabled={busyBd}>{tt("lg.common.cancel")}</Button>
            <Button onClick={saveBatchDispute} disabled={busyBd}>{busyBd ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : null}{tt("lg.bill.dsp.submit")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 争议表头（详情区与争议 tab 共用）
function DisputeHead() {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/40">
        {[tt("lg.rec.dsp.reason"), tt("lg.rec.dsp.claimed"), tt("lg.common.status"), tt("lg.rec.dsp.resolvedAmount"),
          tt("lg.rec.dsp.resolvedBy"), tt("lg.rec.dsp.evidence"), tt("lg.rec.dsp.createdAt"), tt("lg.common.actions")].map((h) => (
          <th key={h} className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
        ))}
      </tr>
    </thead>
  );
}

// 争议行（详情区与本单外共用）
function DisputeRow(props: {
  d: Dispute;
  userLabel: (v: string) => string;
  onResolve: () => void;
  forwarder?: string;
  billPeriod?: string;
}) {
  const { d, userLabel, onResolve, forwarder, billPeriod } = props;
  const next = DSP_NEXT[d.status] ?? [];
  return (
    <tr className="border-b border-border last:border-0 hover:bg-muted/40">
      <td className="px-3 py-2.5 align-top">
        <div className="text-sm text-ink">{d.reason}</div>
        <div className="mt-0.5 text-[11px] text-fg-muted">
          {tt("lg.rec.dsp.line")}: {shortId(d.billing_line_id)}
          {forwarder ? ` · ${forwarder}` : ""}{billPeriod ? ` · ${billPeriod}` : ""}
        </div>
      </td>
      <td className="px-3 py-2.5 font-data text-xs">{num(d.claimed_amount)}</td>
      <td className="px-3 py-2.5"><Badge variant={dspTone(d.status)}>{dspLabel(d.status)}</Badge></td>
      <td className="px-3 py-2.5 font-data text-xs">{num(d.resolved_amount)}</td>
      <td className="px-3 py-2.5 text-xs text-fg-muted">{d.resolved_by ? userLabel(d.resolved_by) : "—"}</td>
      <td className="px-3 py-2.5 text-xs text-fg-muted">{d.evidence.length > 0 ? (
        <span title={d.evidence.join("\n")}>{tt("lg.rec.dsp.evidenceCount", { v1: d.evidence.length })}</span>
      ) : "—"}</td>
      <td className="px-3 py-2.5 whitespace-nowrap font-data text-xs text-fg-muted">{dt(d.created_at)}</td>
      <td className="px-3 py-2.5 text-right">
        <Button size="sm" variant={next.length > 0 ? "outline" : "ghost"} className="h-7 px-2 text-xs" disabled={next.length === 0} onClick={onResolve}>
          {next.length > 0 ? tt("lg.rec.dsp.handle") : tt("lg.rec.dsp.done")}
        </Button>
      </td>
    </tr>
  );
}
