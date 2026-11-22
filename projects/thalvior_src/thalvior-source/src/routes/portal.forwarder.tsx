import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Boxes, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, Coins,
  History, Loader2, LogOut, PackageCheck, RefreshCw, ShieldAlert, Truck, X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { tt, tk } from "@/i18n/tts";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/portal/forwarder")({
  component: ForwarderPortal,
});

/* ------------------------------------------------------------------ *
 * 货代门户（/portal/forwarder）—— 独立页面，不在 _layout 之内
 *
 * 为什么不走 _layout：_layout 需要平台用户 JWT + 侧边栏导航，而货代没有平台账号（见
 * functions/forwarder-portal 文件头「为什么这里不用 checkPerm」）。这一页只认自己的门户令牌，
 * 存 sessionStorage：关掉标签页就没了，公共电脑不会留下可复用凭据。
 *
 * 数据来源：只有 forwarder-portal 这一个 Edge Function。页面不查库、不碰 supabase 表 ——
 * 货代既没有 RLS 策略也没有直连凭据，任何"顺手用 queryTable 读一下"的做法都会越界。
 * 调用范式照抄 src/lib/admin-api.ts:132（supabase.functions.invoke）与 parcels.tsx:146
 * （unwrapInvokeError 从 error.context 取状态码 + 后端原文），不新造第三套 fetch 封装；
 * 唯一多出来的是自定义头 X-Thalvior-Portal-Token。
 *
 * 契约与后端逐字对齐（functions/forwarder-portal/index.ts）：
 *   login → {ok, token, token_type, expires_at, ttl_seconds, forwarder, account, scopes}
 *   whoami / stats / shipments / shipment_detail / receive / advance / declare_fees / intercept_report
 *   失败统一 HTTP 4xx/5xx + {ok:false, code, message, details}
 *   —— 因此前端只需处理一条错误路径（PortalError），不用同时兜「200 里带 error」。
 *
 * 四态分离沿用 _layout.logistics.parcels.tsx 的色彩语义（PUSH_TONE / STAGE_TONE / DOC_TONE /
 * NORM_TONE），同一个枚举值在卖家看板和货代门户里长一个样、说同一句话（词条也复用 shp.* 既有 key，
 * 不为同一状态再编一套中文）。门户侧独有域（包裹入库状态、费用类型、计费单位）走 pfp.* 新词条。
 *
 * 幂等提示：后端对「重复签收 / 重复推进 / 重复报费」一律返回 200 + already_applied，
 * 前端如实标成灰色"重复提交"，不报成功也不报失败 —— 妙手那类"点一次生成两条单"的坑就靠这条口径暴露出来。
 * ------------------------------------------------------------------ */

const PORTAL_EF = "forwarder-portal";
const TOKEN_KEY = "thalvior.portal.token";
const TOKEN_EXP_KEY = "thalvior.portal.exp";
const TOKEN_HEADER = "X-Thalvior-Portal-Token";
const MAX_BATCH = 100;         // 与后端 MAX_BATCH 同口径
const PAGE_SIZE = 20;          // 与后端 PAGE_SIZE_DEFAULT 同口径

type Variant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "muted";

// 域取自 shipments 的 CHECK 约束实测（与 forwarder-portal/index.ts 同一份）
const STAGES = ["wait_inbound", "received", "ready_pack", "label_ready", "picking", "packed", "handover", "shipped", "closed"];
const PUSH_STATES = ["not_pushed", "pending", "pushing", "pushed", "push_failed", "dead"];
const DOC_STATUSES = ["valid", "held", "cancelled"];
const NORM_STATUSES = ["sending", "success", "cancel", "failed"];
const INTERCEPT_STATES = ["none", "requested", "succeeded", "failed"];
const LABEL_STATES = ["none", "requested", "ready", "failed", "updated"];
const INBOUND_STATUSES = ["not_inbound", "in_transit", "signed", "partial_signed", "rejected", "lost"];
const FEE_TYPES = ["handling", "domestic_freight", "intl_freight", "packaging", "storage", "duty",
  "volumetric_diff", "surcharge", "vas", "return_fee", "insurance", "adjustment"];
const CHARGE_UNITS = ["piece", "order", "kg", "cbm", "manhour", "flat"];
const SEARCH_COLS = ["batch_no", "wms_order_no", "tracking_no", "platform_order_no", "order_id"];
const SORTS = ["created_at_desc", "created_at_asc", "received_asc"];
// work_orders 四个域照抄 _layout.logistics.parcels.tsx:45-52（同源同词条 shp.wo*.*）
const WO_TYPES = [
  "no_head", "wrong_item", "lost", "damaged", "stuck_customs", "return_check",
  "overdue_inbound", "out_of_stock", "balance_insufficient", "sku_unmapped",
  "label_failed", "handover_failed", "weight_dispute", "other",
];
const WO_STATUSES = ["pending", "assigned", "processing", "suspended", "processed", "closed"];
const WO_PRIORITIES = ["low", "normal", "urgent", "critical"];
const WO_ASSIGNEES = ["forwarder", "seller", "platform_ops", "logistics"];

const PUSH_TONE: Record<string, Variant> = {
  not_pushed: "muted", pending: "warning", pushing: "info",
  pushed: "success", push_failed: "destructive", dead: "destructive",
};
const STAGE_TONE: Record<string, Variant> = {
  wait_inbound: "muted", received: "info", ready_pack: "info", label_ready: "info",
  picking: "secondary", packed: "secondary", handover: "warning", shipped: "success", closed: "muted",
};
const DOC_TONE: Record<string, Variant> = { valid: "success", held: "warning", cancelled: "muted" };
const NORM_TONE: Record<string, Variant> = { sending: "info", success: "success", cancel: "muted", failed: "destructive" };
const LABEL_TONE: Record<string, Variant> = { none: "muted", requested: "warning", ready: "success", failed: "destructive", updated: "info" };
const INTERCEPT_TONE: Record<string, Variant> = { none: "muted", requested: "warning", succeeded: "destructive", failed: "info" };
const INBOUND_TONE: Record<string, Variant> = {
  not_inbound: "muted", in_transit: "info", signed: "success", partial_signed: "warning", rejected: "destructive", lost: "destructive",
};
const WO_STATUS_TONE: Record<string, Variant> = {
  pending: "warning", assigned: "info", processing: "info", suspended: "muted", processed: "success", closed: "muted",
};
const WO_PRIORITY_TONE: Record<string, Variant> = { low: "muted", normal: "secondary", urgent: "warning", critical: "destructive" };
const FEE_STATUS_TONE: Record<string, Variant> = {
  pending_audit: "warning", approved: "success", rejected: "destructive", voided: "muted",
};
// 门禁 code → 既有条词条（shp.gate.*），与卖家看板同一句话
const GATE_KEY: Record<string, string> = {
  all_parcels_signed: "shp.gate.allSigned",
  label_ready: "shp.gate.labelReady",
  tracking_no: "shp.gate.trackingNo",
};

/* ────────────── 契约类型（字段名与后端响应逐字一致） ────────────── */

interface LoginResp {
  ok: boolean;
  token: string;
  token_type: string;
  expires_at: string;
  ttl_seconds: number;
  forwarder: { id: string; name: string; code: string };
  account: { username: string; forwarder_auth_id: string; protocol: string };
  scopes: { stage_filter: string[]; push_state_filter: string[]; doc_status_filter: string[]; search_cols: string[] };
}

interface WhoamiResp {
  ok: boolean;
  forwarder: { id: string; name: string };
  account: { username: string; forwarder_auth_id: string; protocol: string };
}

interface StatsResp {
  ok: boolean;
  tz: string;
  today: string;
  queue: { to_receive: number; to_pack: number; to_handover: number; open_work_orders: number };
  stage_counts: Record<string, number>;
  today_done: { received: number; packed: number; handed_over: number; closed: number };
  abnormal: { doc_cancelled: number; intercept_requested: number; push_failed_or_dead: number };
  agg_capped: boolean;
  agg_window: number;
  valid_total: number;
  note: string;
}

interface NextStage { to_stage: string; requires_gate: string | null; note: string | null }

interface QueueRow {
  shipment_id: string;
  order_id: string | null;
  platform_order_no: string | null;
  batch_no: string | null;
  wms_order_no: string | null;
  tracking_no: string | null;
  carrier: string | null;
  destination: string | null;
  stage: string;
  push_state: string;
  doc_status: string;
  norm_status: string;
  raw_status: string | null;
  intercept_state: string;
  label_state: string;
  label_source: string | null;
  forwarder_name: string | null;
  warehouse_name: string | null;
  channel_name: string | null;
  parcel_total: number;
  parcel_signed: number;
  open_work_orders: number;
  estimated_amount: number | null;
  actual_amount: number | null;
  fee_currency: string | null;
  charged_weight_g: number | null;
  declared_weight_g: number | null;
  received_at: string | null;
  packed_at: string | null;
  handover_at: string | null;
  closed_at: string | null;
  pushed_at: string | null;
  created_at: string | null;
  remark: string | null;
  next_stages: NextStage[];
}

interface ShipmentsResp {
  ok: boolean;
  page: number;
  page_size: number;
  total: number;
  rows: QueueRow[];
  stage_counts: Record<string, number>;
  agg_capped: boolean;
  filter: { stage: string | null; push_state: string | null; doc_status: string | null; keyword: string; search_col: string | null };
  search_cols: string[];
  rejected: { field: string; reason: string }[];
}

interface DetailParcel {
  id: string; parcel_no: string | null; package_number: string | null; waybill_no: string | null;
  forwarder_parcel_no: string | null; inbound_tracking_no: string | null; inbound_status: string | null;
  weight: number | null; length: number | null; width: number | null; height: number | null;
  signed_at: string | null; signed_by: string | null; status: string | null;
}

interface DetailFeeLine {
  id: string; fee_type: string; charge_type: string | null; charge_unit: string | null;
  charge_qty: number | null; unit_price: number | null; amount: number | null; currency: string | null;
  weight_charged_g: number | null; weight_declared_g: number | null; diff_flag: boolean;
  source: string | null; status: string | null; external_ref: string | null;
  period: string | null; statement_id: string | null; voided_reason: string | null; created_at: string | null;
}

interface DetailWorkOrder {
  id: string; type?: string | null; title?: string | null; description?: string | null;
  status?: string | null; priority?: string | null; stage_when_detected?: string | null;
  assignee_type?: string | null; due_at?: string | null; resolution?: string | null;
  created_at?: string | null; updated_at?: string | null;
}

interface DetailPushLog {
  id: number | string; direction?: string | null; action?: string | null; batch_no?: string | null;
  status?: string | null; error_code?: string | null; error_message?: string | null;
  attempt?: number | null; created_at?: string | null; finished_at?: string | null;
}

interface DetailEvent {
  id: number | string; raw_status?: string | null; norm_status?: string | null; stage?: string | null;
  tracking_no?: string | null; carrier_name?: string | null; failed_reason?: string | null;
  operator?: string | null; source?: string | null; occurred_at?: string | null; created_at?: string | null;
}

interface AdvanceOption { to_stage: string; allowed: boolean; reason: string | null; gate: string | null; note: string | null }

interface DetailResp {
  ok: boolean;
  shipment: QueueRow & { platform: string | null; site: string | null };
  parcels: DetailParcel[];
  billing_lines: DetailFeeLine[];
  work_orders: DetailWorkOrder[];
  push_logs: DetailPushLog[];
  timeline: DetailEvent[];
  advance_options: AdvanceOption[];
  fee_summary: { declared_total: number; pending_audit: number; diff_flag_lines: number };
  domains: { stages: string[]; fee_types: string[]; charge_units: string[]; inbound_statuses: string[] };
}

interface ParcelResult {
  parcel_id: string; parcel_no: string | null; shipment_id: string;
  result: string; inbound_status: string; applied: string[];
}

interface ReceiveShipmentResult {
  shipment_id: string; batch_no: string | null; stage_before: string | null; stage_after: string | null;
  auto_advanced: boolean; parcel_total: number; parcel_signed: number; received_at: string | null;
}

interface ReceiveResp {
  ok: boolean; action: string; signed: number; already_applied: number; failed: number;
  parcels: ParcelResult[]; shipments: ReceiveShipmentResult[];
  rejected: { field: string; reason: string }[]; not_found: string[];
  status_event_ids: string[]; note: string;
}

interface AdvanceResultRow {
  shipment_id: string; batch_no?: string | null; stage_before?: string | null; to_stage?: string | null;
  stage_after?: string | null; result?: string | null; reason?: string | null; gate?: string | null;
  code?: string | null; tracking_no?: string | null; status_event_id?: string | null;
}

interface AdvanceResp {
  ok: boolean; action: string; to_stage: string; total: number;
  applied: number; rejected: number; already_applied: number;
  not_found: string[]; results: AdvanceResultRow[]; code: string | null; note: string;
}

interface FeeInsert {
  id: string; fee_type: string; amount: number | null; currency: string | null;
  diff_flag: boolean; status: string | null; source: string | null;
}

interface DeclareFeesResp {
  ok: boolean; action: string; shipment_id: string; already_applied: boolean;
  first_event_id?: string; inserted: FeeInsert[]; rejected: { field: string; reason: string }[];
  actual_amount: number | null; fee_currency: string | null; currency_mixed: boolean;
  charged_weight_g: number | null; declared_weight_g: number | null;
  diff_flag_count: number; status_event_id?: string | null; code?: string | null; note: string;
}

interface InterceptResp {
  ok: boolean; action: string; shipment_id: string;
  applied?: boolean; already_applied: boolean; result?: string;
  applied_list?: string[]; rejected?: { field: string; reason: string }[];
  doc_status: string; intercept_state: string; stage?: string;
  status_event_id?: string | null; code?: string | null; note: string | null;
}

/* ────────────── EF 调用层（照 admin-api.ts / parcels.tsx 的既有范式） ────────────── */

/** 后端失败体 {ok:false, code, message, details}；HTTP 状态码原样带上来，401 是唯一需要特殊反应的值 */
class PortalError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details: unknown) {
    super(message);
    this.name = "PortalError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** supabase-js 把原始 Response 藏在 error.context 里：与 parcels.tsx:146 unwrapPushError 同一取法，多取 code/details */
async function unwrapPortalError(err: unknown): Promise<{ status: number; message: string; code: string; details: unknown }> {
  const e = err as {
    message?: string; statusCode?: number; status?: number;
    context?: { status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  let status = Number(e?.statusCode ?? e?.status ?? e?.context?.status ?? 0);
  let message = "";
  let code = "";
  let details: unknown = null;
  const ctx = e?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json() as Record<string, unknown> | null;
      message = String(body?.message ?? body?.error ?? body?.msg ?? "");
      code = String(body?.code ?? "");
      details = body?.details ?? null;
    } catch {
      // 非 JSON 错误体（网关 404 常是纯文本 / HTML）：退回原文截断，不假装解析成功
      if (ctx && typeof ctx.text === "function") {
        message = String(await ctx.text().catch(() => "")).slice(0, 400);
      }
    }
  }
  if (!message) message = String(e?.message ?? "");
  if (!message && typeof err === "string") message = err;
  return { status, message, code, details };
}

async function callPortal<T>(token: string | null, body: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers[TOKEN_HEADER] = token;
  const { data, error } = await supabase.functions.invoke(PORTAL_EF, { body, headers });
  if (error) {
    const unwrapped = await unwrapPortalError(error);
    throw new PortalError(unwrapped.status, unwrapped.code, unwrapped.message, unwrapped.details);
  }
  // 后端所有失败都带 HTTP 状态码（走上面的 error 分支），这里只兜「200 但 ok:false」这种不该出现的情况
  const payload = data as (T & { ok?: boolean; code?: string; message?: string; details?: unknown }) | null;
  if (payload && payload.ok === false) {
    throw new PortalError(200, String(payload.code ?? ""), String(payload.message ?? ""), payload.details ?? null);
  }
  return data as T;
}

/* ────────────── 显示helper ────────────── */

/** 枚举值 → 词条：域外的值原样显示（库里加了新枚举时不假装翻译，也不渲染成 key 路径） */
function enumLabel(prefix: string, value: string | null | undefined, domain: string[]): string {
  const v = (value ?? "").trim();
  if (!v) return tt("pfp.fld.none");
  if (!domain.includes(v)) return v;
  return tk(`${prefix}${v}`);
}

/** 账单行审核态：DB 实测 4 值（pending_audit/approved/rejected/voided），域外原样显示 */
function feeStatusLabel(status: string | null | undefined): string {
  const v = (status ?? "").trim();
  if (!v) return tt("pfp.fld.none");
  if (v === "pending_audit") return tt("pfp.fee.statusPending");
  if (v === "approved") return tt("pfp.fee.statusApproved");
  if (v === "rejected") return tt("pfp.fee.statusRejected");
  if (v === "voided") return tt("pfp.fee.statusVoided");
  return v;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return tt("pfp.fld.none");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtMoney(n: number | null | undefined, cur?: string | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return tt("pfp.fld.none");
  return `${n.toFixed(2)}${cur ? ` ${cur}` : ""}`;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return tt("pfp.fld.none");
  return n.toFixed(digits);
}

function toNumOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 状态事件归类：PORTAL:（门户人工）/ ERP:（推单）/ 其余为货代系统原文 */
function eventKind(raw: string | null | undefined): { tone: Variant; label: string } {
  const v = (raw ?? "").trim();
  if (v.startsWith("PORTAL:")) return { tone: "info", label: tt("pfp.detail.portalEvent") };
  if (v.startsWith("ERP:")) return { tone: "secondary", label: tt("pfp.detail.erpEvent") };
  if (v) return { tone: "muted", label: tt("pfp.detail.callbackEvent") };
  return { tone: "muted", label: tt("pfp.detail.rawEvent") };
}

function readToken(): string | null {
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) return null;
    const exp = sessionStorage.getItem(TOKEN_EXP_KEY);
    // 本地时钟只能算粗筛（令牌真伪由后端验签 + 回查授权决定），这里只省一次必败请求
    if (exp && Number.isFinite(Date.parse(exp)) && Date.parse(exp) <= Date.now()) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_EXP_KEY);
      return null;
    }
    return t;
  } catch {
    return null;   // 隐私模式下 sessionStorage 会抛：按未登录处理，不让页面白屏
  }
}

function saveSession(token: string, expiresAt: string) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(TOKEN_EXP_KEY, expiresAt);
  } catch {
    /* 存不下去也不影响本次会话内的使用 */
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_EXP_KEY);
  } catch {
    /* ignore */
  }
}

/* ────────────── 页面 ────────────── */

type Phase = "checking" | "login" | "ready";

interface Identity { forwarderName: string; username: string; expiresAt: string | null }

function ForwarderPortal() {
  // useLanguage 只负责两件事：语言切换按钮 + 切 lang 时整页重渲染（tt/tk 读的是模块快照）
  const { lang, toggleLang } = useLanguage();
  const [phase, setPhase] = useState<Phase>("checking");
  const [token, setToken] = useState<string | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);

  const signOut = useCallback(() => {
    clearSession();
    setToken(null);
    setIdentity(null);
    setPhase("login");
  }, []);

  /** 任何请求返回 401/403（撤销、过期、改绑）都回到登录态：令牌可能在本页打开期间被卖家撤掉 */
  const handleAuthFailure = useCallback((err: unknown): boolean => {
    if (err instanceof PortalError && (err.status === 401 || err.status === 403)) {
      toast.error(err.status === 401 ? tt("pfp.err.sessionGone") : tt("pfp.err.revoked"));
      signOut();
      return true;
    }
    return false;
  }, [signOut]);

  // 首屏：有令牌就先 whoami 恢复身份，不重复签发、也不直接假定登录态有效
  useEffect(() => {
    const t = readToken();
    if (!t) {
      setPhase("login");
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const who = await callPortal<WhoamiResp>(t, { action: "whoami" });
        if (!alive) return;
        const exp = (() => { try { return sessionStorage.getItem(TOKEN_EXP_KEY); } catch { return null; } })();
        setToken(t);
        setIdentity({ forwarderName: who.forwarder.name || "", username: who.account.username || "", expiresAt: exp });
        setPhase("ready");
      } catch (err) {
        if (!alive) return;
        if (!handleAuthFailure(err)) {
          // 网络/未部署等故障：保留令牌让用户重试，只把错误摆出来
          toast.error(err instanceof Error ? err.message : String(err));
          setToken(t);
          setIdentity(null);
          setPhase("ready");
        }
      }
    })();
    return () => { alive = false; };
  }, [handleAuthFailure]);

  const onLoggedIn = useCallback((resp: LoginResp) => {
    saveSession(resp.token, resp.expires_at);
    setToken(resp.token);
    setIdentity({
      forwarderName: resp.forwarder.name || resp.forwarder.code || "",
      username: resp.account.username,
      expiresAt: resp.expires_at,
    });
    setPhase("ready");
  }, []);

  if (phase === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 size={20} className="animate-spin text-fg-muted" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-fg">
      <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-6">
          <span className="manifest-eyebrow shrink-0">{tt("pfp.brand")}</span>
          {phase === "ready" && identity ? (
            <span className="min-w-0 truncate text-[13px] text-fg-muted" title={`${identity.forwarderName} · ${identity.username}`}>
              {tt("pfp.shell.account", { forwarder: identity.forwarderName || tt("pfp.common.unknown"), username: identity.username })}
            </span>
          ) : null}
          {identity?.expiresAt ? (
            <span className="hidden text-[11px] text-fg-subtle sm:inline" title={tt("pfp.shell.tokenHint", { time: fmtTime(identity.expiresAt) })}>
              {tt("pfp.shell.tokenExpiredAt", { time: fmtTime(identity.expiresAt) })}
            </span>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => toggleLang()} title={lang === "zh" ? "English" : "中文"}>
              {tt("pfp.shell.lang")}
            </Button>
            {phase === "ready" ? (
              <Button size="sm" variant="outline" onClick={signOut}>
                <LogOut size={13} className="mr-1.5" />{tt("pfp.shell.logout")}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1400px] px-3 py-4 sm:px-6 sm:py-6">
        {phase === "login"
          ? <LoginPanel onLoggedIn={onLoggedIn} />
          : <PortalWorkspace token={token} identity={identity} onAuthFailure={handleAuthFailure} />}
        <p className="mt-6 text-[11px] leading-relaxed text-fg-subtle">{tt("pfp.shell.apiHint")}</p>
      </main>
    </div>
  );
}

/* ────────────── 登录卡 ────────────── */

function LoginPanel({ onLoggedIn }: { onLoggedIn: (r: LoginResp) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (!username.trim() || !password) {
      setError(tt("pfp.login.errEmpty"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      // 登录是唯一不带令牌的 action（后端对 login 单独放行并做 IP+用户名限流）
      const resp = await callPortal<LoginResp>(null, { action: "login", username: username.trim(), password });
      setPassword("");
      onLoggedIn(resp);
    } catch (err) {
      const e = err as PortalError;
      const msg = e instanceof Error ? e.message : String(err);
      setError(msg || tt("pfp.login.failHint"));
      if (e instanceof PortalError && e.status === 429) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto mt-6 w-full max-w-[420px] sm:mt-14">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <PageHeader title={tt("pfp.login.title")} description={tt("pfp.login.desc")} code="FORWARDER PORTAL" />
        <form
          className="mt-5 space-y-4"
          onSubmit={(e) => { e.preventDefault(); void submit(); }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="pfp-user">{tt("pfp.login.username")}</Label>
            <Input
              id="pfp-user" autoComplete="username" value={username}
              onChange={(e) => setUsername(e.target.value)} disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pfp-pwd">{tt("pfp.login.password")}</Label>
            <Input
              id="pfp-pwd" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} disabled={busy}
            />
          </div>
          {error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-[12px] text-destructive">
              <div className="mb-1 flex items-center gap-1.5 font-medium">
                <AlertTriangle size={14} className="shrink-0" />{tt("pfp.login.failTitle")}
              </div>
              <p className="min-w-0 break-words">{error}</p>
              <p className="mt-1 text-[11px] text-fg-subtle">{tt("pfp.login.failHint")}</p>
            </div>
          ) : null}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
            {busy ? tt("pfp.login.submitting") : tt("pfp.login.submit")}
          </Button>
          <p className="text-[11px] leading-relaxed text-fg-subtle">{tt("pfp.login.secureHint")}</p>
        </form>
      </div>
    </div>
  );
}

/* ────────────── 登录后工作台 ────────────── */

interface FeeLineForm {
  fee_type: string; amount: string; currency: string; charge_unit: string;
  charge_qty: string; unit_price: string; weight_charged_g: string; weight_declared_g: string;
}

const emptyFeeLine = (currency: string): FeeLineForm => ({
  fee_type: "intl_freight", amount: "", currency, charge_unit: "piece",
  charge_qty: "", unit_price: "", weight_charged_g: "", weight_declared_g: "",
});

function PortalWorkspace({
  token, identity, onAuthFailure,
}: {
  token: string | null;
  identity: Identity | null;
  onAuthFailure: (e: unknown) => boolean;
}) {
  const [stats, setStats] = useState<StatsResp | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsErr, setStatsErr] = useState("");

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [total, setTotal] = useState(0);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueErr, setQueueErr] = useState("");
  const [queueRejected, setQueueRejected] = useState<{ field: string; reason: string }[]>([]);

  const [stage, setStage] = useState("all");
  const [parcelFilter, setParcelFilter] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [searchCol, setSearchCol] = useState("batch_no");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState("created_at_desc");
  const [page, setPage] = useState(1);

  const [sel, setSel] = useState<string[]>([]);

  // 抽屉与对话框
  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiveIds, setReceiveIds] = useState<string[] | null>(null);
  const [receiveNote, setReceiveNote] = useState("");
  const [receiveResp, setReceiveResp] = useState<ReceiveResp | null>(null);
  const [advanceIds, setAdvanceIds] = useState<string[] | null>(null);
  const [advanceTo, setAdvanceTo] = useState("");
  const [advanceTracking, setAdvanceTracking] = useState("");
  const [advanceCarrier, setAdvanceCarrier] = useState("");
  const [advanceNote, setAdvanceNote] = useState("");
  const [advanceResp, setAdvanceResp] = useState<AdvanceResp | null>(null);
  const [feeRow, setFeeRow] = useState<QueueRow | null>(null);
  const [feeLines, setFeeLines] = useState<FeeLineForm[]>([]);
  const [feeShipCharged, setFeeShipCharged] = useState("");
  const [feeShipDeclared, setFeeShipDeclared] = useState("");
  const [feeNote, setFeeNote] = useState("");
  const [feeResp, setFeeResp] = useState<DeclareFeesResp | null>(null);
  const [interceptRow, setInterceptRow] = useState<QueueRow | null>(null);
  const [interceptResult, setInterceptResult] = useState<"succeeded" | "failed">("succeeded");
  const [interceptNote, setInterceptNote] = useState("");
  const [interceptResp, setInterceptResp] = useState<InterceptResp | null>(null);

  const [busy, setBusy] = useState(false);
  // 抽屉里的详情由 DetailPanel 自己按 refreshToken 重新拉，避免操作完看到旧费用行
  const [detailRefresh, setDetailRefresh] = useState(0);

  const guarded = useCallback((err: unknown) => {
    if (onAuthFailure(err)) return true;
    const msg = err instanceof Error ? err.message : String(err);
    toast.error(msg || tt("pfp.err.noDetail"));
    return false;
  }, [onAuthFailure]);

  const loadStats = useCallback(async () => {
    setStatsBusy(true);
    try {
      setStats(await callPortal<StatsResp>(token, { action: "stats" }));
      setStatsErr("");
    } catch (err) {
      if (!onAuthFailure(err)) setStatsErr(err instanceof Error ? err.message : String(err));
    } finally {
      setStatsBusy(false);
    }
  }, [token, onAuthFailure]);

  const loadQueue = useCallback(async () => {
    setQueueBusy(true);
    const body: Record<string, unknown> = {
      action: "shipments", page, page_size: PAGE_SIZE, sort, search_col: searchCol, keyword,
    };
    if (stage !== "all") body.stage = stage;
    if (parcelFilter) body.parcel_filter = parcelFilter;
    if (includeCancelled) body.include_cancelled = true;
    try {
      const resp = await callPortal<ShipmentsResp>(token, body);
      setRows(resp.rows ?? []);
      setTotal(Number(resp.total ?? 0));
      setQueueRejected(resp.rejected ?? []);
      setQueueErr("");
      setSel((prev) => prev.filter((id) => (resp.rows ?? []).some((r) => r.shipment_id === id)));
    } catch (err) {
      if (onAuthFailure(err)) return;
      const e = err as PortalError;
      // EF 未部署（404）单独说一句：否则运维只看到 "Not Found" 会以为是数据问题
      setQueueErr(e instanceof PortalError && e.status === 404
        ? `${tt("pfp.err.notDeployed")}（${e.message || tt("pfp.err.noDetail")}）`
        : (err instanceof Error ? err.message : String(err)));
    } finally {
      setQueueBusy(false);
    }
  }, [token, page, sort, searchCol, keyword, stage, parcelFilter, includeCancelled, onAuthFailure]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => { void loadQueue(); }, [loadQueue]);

  const reloadAll = useCallback(() => {
    void loadStats();
    void loadQueue();
  }, [loadStats, loadQueue]);

  const refresh = () => {
    reloadAll();
    setDetailRefresh((n) => n + 1);
  };

  const pageIds = rows.map((r) => r.shipment_id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => sel.includes(id));
  const toggleAll = () => {
    setSel(allPageSelected ? [] : pageIds.slice(0, MAX_BATCH));
  };
  const toggleOne = (id: string) => {
    setSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, MAX_BATCH)));
  };

  const applyFilters = (patch: { stage?: string; parcelFilter?: string; keyword?: string; page?: number }) => {
    if (patch.stage !== undefined) setStage(patch.stage);
    if (patch.parcelFilter !== undefined) setParcelFilter(patch.parcelFilter);
    if (patch.keyword !== undefined) setKeyword(patch.keyword);
    setPage(patch.page ?? 1);
  };

  /* ---------- 写动作 ---------- */

  const openReceive = (ids: string[]) => {
    if (!ids.length) return;
    setReceiveIds(ids.slice(0, MAX_BATCH));
    setReceiveNote("");
    setReceiveResp(null);
  };

  const submitReceive = async () => {
    if (!receiveIds?.length) return;
    setBusy(true);
    try {
      const resp = await callPortal<ReceiveResp>(token, {
        action: "receive", shipment_ids: receiveIds, note: receiveNote.trim() || undefined,
      });
      setReceiveResp(resp);
      toast.success(tt("pfp.receive.done", {
        signed: resp.signed, already: resp.already_applied, failed: resp.failed,
      }));
      reloadAll();
    } catch (err) {
      guarded(err);
    } finally {
      setBusy(false);
    }
  };

  const openAdvance = (ids: string[], preferred?: string) => {
    if (!ids.length) return;
    setAdvanceIds(ids.slice(0, MAX_BATCH));
    setAdvanceTo(preferred ?? "");
    setAdvanceTracking("");
    setAdvanceCarrier("");
    setAdvanceNote("");
    setAdvanceResp(null);
  };

  const submitAdvance = async () => {
    if (!advanceIds?.length) return;
    if (!advanceTo) { toast.error(tt("pfp.advance.to")); return; }
    setBusy(true);
    const body: Record<string, unknown> = {
      action: "advance", shipment_ids: advanceIds, to_stage: advanceTo,
      note: advanceNote.trim() || undefined,
      tracking_no: advanceTracking.trim() || undefined,
      carrier: advanceCarrier.trim() || undefined,
    };
    try {
      const resp = await callPortal<AdvanceResp>(token, body);
      setAdvanceResp(resp);
      toast.success(tt("pfp.advance.result", {
        applied: resp.applied, already: resp.already_applied, rejected: resp.rejected,
      }));
      reloadAll();
    } catch (err) {
      guarded(err);
    } finally {
      setBusy(false);
    }
  };

  const openFees = (row: QueueRow) => {
    setFeeRow(row);
    setFeeLines([emptyFeeLine(row.fee_currency ?? "CNY")]);
    setFeeShipCharged("");
    setFeeShipDeclared("");
    setFeeNote("");
    setFeeResp(null);
  };

  const submitFees = async () => {
    if (!feeRow) return;
    const usable = feeLines.filter((l) => l.fee_type && toNumOrNull(l.amount) !== null && toNumOrNull(l.amount) !== 0);
    if (!usable.length) { toast.error(tt("pfp.fee.errEmpty")); return; }
    if (usable.length !== feeLines.length) toast.warning(tt("pfp.fee.errAmount"));
    const fees = usable.map((l) => {
      const f: Record<string, unknown> = { fee_type: l.fee_type, amount: toNumOrNull(l.amount) };
      if (l.currency.trim()) f.currency = l.currency.trim().toUpperCase();
      if (l.charge_unit) f.charge_unit = l.charge_unit;
      const qty = toNumOrNull(l.charge_qty); if (qty !== null) f.charge_qty = qty;
      const price = toNumOrNull(l.unit_price); if (price !== null) f.unit_price = price;
      const wc = toNumOrNull(l.weight_charged_g); if (wc !== null) f.weight_charged_g = wc;
      const wd = toNumOrNull(l.weight_declared_g); if (wd !== null) f.weight_declared_g = wd;
      return f;
    });
    const body: Record<string, unknown> = {
      action: "declare_fees", shipment_id: feeRow.shipment_id, fees,
      note: feeNote.trim() || undefined,
    };
    const cw = toNumOrNull(feeShipCharged); if (cw !== null) body.charged_weight_g = cw;
    const dw = toNumOrNull(feeShipDeclared); if (dw !== null) body.declared_weight_g = dw;
    setBusy(true);
    try {
      const resp = await callPortal<DeclareFeesResp>(token, body);
      setFeeResp(resp);
      if (resp.already_applied) toast.info(tt("pfp.fee.dup"));
      else toast.success(tt("pfp.fee.submitted", {
        count: resp.inserted.length,
        amount: fmtMoney(resp.actual_amount, "").trim(),
        currency: resp.fee_currency ?? "",
      }));
      reloadAll();
    } catch (err) {
      guarded(err);
    } finally {
      setBusy(false);
    }
  };

  const openIntercept = (row: QueueRow) => {
    setInterceptRow(row);
    setInterceptResult("succeeded");
    setInterceptNote("");
    setInterceptResp(null);
  };

  const submitIntercept = async () => {
    if (!interceptRow) return;
    setBusy(true);
    try {
      const resp = await callPortal<InterceptResp>(token, {
        action: "intercept_report", shipment_id: interceptRow.shipment_id,
        result: interceptResult, note: interceptNote.trim() || undefined,
      });
      setInterceptResp(resp);
      if (resp.already_applied) toast.info(tt("pfp.intercept.dup"));
      else if (resp.applied) toast.success(tt("pfp.intercept.applied", { doc: enumLabel("shp.doc.", resp.doc_status, DOC_STATUSES) }));
      else toast.error(tt("pfp.intercept.refused", { reason: resp.note || tt("pfp.err.noDetail") }));
      reloadAll();
    } catch (err) {
      guarded(err);
    } finally {
      setBusy(false);
    }
  };

  /* ---------- 渲染 ---------- */

  const stageTabs = useMemo(() => ["all", ...STAGES], []);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <PageHeader
        title={tt("pfp.page.title")}
        description={tt("pfp.page.desc")}
        code="FORWARDER QUEUE"
        actions={(
          <Button size="sm" variant="outline" onClick={refresh} disabled={queueBusy || statsBusy}>
            <RefreshCw size={13} className={cn("mr-1.5", (queueBusy || statsBusy) && "animate-spin")} />
            {tt("pfp.shell.refreshAll")}
          </Button>
        )}
      />

      {/* 今日统计卡：口径来自后端 stats，前端不自己数行数 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
          <span>{stats ? tt("pfp.stats.dateLabel", { date: stats.today }) : tt("pfp.stats.dateLabel", { date: tt("pfp.common.soon") })}</span>
          {statsBusy ? <Loader2 size={12} className="animate-spin" /> : null}
          {stats?.agg_capped ? (
            <Badge variant="warning" title={tt("pfp.stats.capped", { window: stats.agg_window })}>
              <AlertTriangle size={11} />{tt("pfp.stats.capped", { window: stats.agg_window })}
            </Badge>
          ) : null}
        </div>
        {statsErr ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
            {tt("pfp.stats.err")}：{statsErr}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label={tt("pfp.stats.toReceive")} value={String(stats?.queue.to_receive ?? "-")}
            icon={<Boxes size={14} />} tone="blue"
            footer={<p className="mt-1.5 text-[11px] text-fg-subtle">{tt("pfp.stats.toReceiveHint")}</p>}
          />
          <StatCard
            label={tt("pfp.stats.toPack")} value={String(stats?.queue.to_pack ?? "-")}
            icon={<PackageCheck size={14} />} tone="primary"
            footer={<p className="mt-1.5 text-[11px] text-fg-subtle">{tt("pfp.stats.toPackHint")}</p>}
          />
          <StatCard
            label={tt("pfp.stats.toHandover")} value={String(stats?.queue.to_handover ?? "-")}
            icon={<Truck size={14} />} tone="warning"
            footer={<p className="mt-1.5 text-[11px] text-fg-subtle">{tt("pfp.stats.toHandoverHint")}</p>}
          />
          <StatCard
            label={tt("pfp.stats.openWo")} value={String(stats?.queue.open_work_orders ?? "-")}
            icon={<ShieldAlert size={14} />} tone="danger"
            footer={<p className="mt-1.5 text-[11px] text-fg-subtle">{tt("pfp.stats.openWoHint")}</p>}
          />
        </div>
        {stats ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-[12px] text-fg-muted">
            <span>{tt("pfp.stats.todayDone", {
              received: stats.today_done.received, packed: stats.today_done.packed, handed: stats.today_done.handed_over,
            })}</span>
            <span>{tt("pfp.stats.todayClosed", { count: stats.today_done.closed })}</span>
            <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
              <span title={tt("pfp.stats.abnormalHint")}>{tt("pfp.stats.abnormal")}：</span>
              <span>{tt("pfp.stats.abnormalCancelled", { count: stats.abnormal.doc_cancelled })}</span>
              <span>{tt("pfp.stats.abnormalIntercept", { count: stats.abnormal.intercept_requested })}</span>
              <span>{tt("pfp.stats.abnormalPush", { count: stats.abnormal.push_failed_or_dead })}</span>
            </span>
          </div>
        ) : null}
      </section>

      {/* 队列：阶段标签 + 快捷队列 + 搜索 + 分页 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-display text-[16px] font-semibold tracking-[-0.02em]">{tt("pfp.queue.title")}</h2>
          <p className="text-[12px] text-fg-subtle">{tt("pfp.queue.desc")}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
          {stageTabs.map((s) => {
            const active = stage === s && !parcelFilter;
            const n = s === "all" ? stats?.valid_total : (stats?.stage_counts[s] ?? 0);
            return (
              <button
                key={s}
                type="button"
                onClick={() => applyFilters({ stage: s, parcelFilter: "" })}
                className={cn(
                  "shrink-0 rounded-full border px-2.5 py-1 text-[12px] transition-colors",
                  active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-fg-muted hover:bg-muted/40",
                )}
              >
                {s === "all" ? tt("pfp.queue.tabAll") : enumLabel("shp.stage.", s, STAGES)}
                <span className="ml-1 font-data tabular-nums text-fg-subtle">{n ?? "-"}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-fg-subtle">{tt("pfp.queue.quick")}</span>
          {([
            ["to_receive", tt("pfp.queue.quickToReceive")],
            ["to_pack", tt("pfp.queue.quickToPack")],
            ["to_handover", tt("pfp.queue.quickToHandover")],
          ] as [string, string][]).map(([k, label]) => (
            <Button
              key={k} size="sm" variant={parcelFilter === k ? "default" : "outline"}
              onClick={() => applyFilters({ stage: "all", parcelFilter: parcelFilter === k ? "" : k })}
            >
              {label}
            </Button>
          ))}
          <label
            className="ml-auto flex cursor-pointer items-center gap-1.5 text-[12px] text-fg-muted"
            title={tt("pfp.queue.includeCancelledHint")}
          >
            <input
              type="checkbox" className="h-3.5 w-3.5" checked={includeCancelled}
              onChange={(e) => { setIncludeCancelled(e.target.checked); setPage(1); }}
            />
            {tt("pfp.queue.includeCancelled")}
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-fg-subtle">{tt("pfp.queue.searchCol")}</span>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-[12px] text-fg"
            value={searchCol} title={tt("pfp.queue.searchColHint")}
            onChange={(e) => setSearchCol(e.target.value)}
          >
            {SEARCH_COLS.map((c) => <option key={c} value={c}>{enumLabel("pfp.search.", c, SEARCH_COLS)}</option>)}
          </select>
          <Input
            className="h-8 w-[220px] text-[12px]" value={keywordInput}
            placeholder={tt("pfp.queue.searchPh")}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyFilters({ keyword: keywordInput.trim() }); }}
          />
          <Button size="sm" variant="outline" onClick={() => applyFilters({ keyword: keywordInput.trim() })}>
            {tt("pfp.queue.searchBtn")}
          </Button>
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-[12px] text-fg"
            value={sort} title={tt("pfp.queue.sort")}
            onChange={(e) => { setSort(e.target.value); setPage(1); }}
          >
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {s === "created_at_desc" ? tt("pfp.queue.sortCreatedDesc")
                  : s === "created_at_asc" ? tt("pfp.queue.sortCreatedAsc") : tt("pfp.queue.sortReceivedAsc")}
              </option>
            ))}
          </select>
          {keyword || parcelFilter || stage !== "all" || includeCancelled ? (
            <Button size="sm" variant="ghost" onClick={() => {
              setStage("all"); setParcelFilter(""); setKeyword(""); setKeywordInput(""); setIncludeCancelled(false); setPage(1);
            }}>
              <X size={13} className="mr-1" />{tt("pfp.queue.clear")}
            </Button>
          ) : null}
          <span className="ml-auto text-[12px] text-fg-muted" title={tt("pfp.queue.countHint")}>
            {tt("pfp.queue.count", { count: total })}
          </span>
        </div>

        {/* 批量操作条：只在有勾选时出现，上限与后端 MAX_BATCH 一致 */}
        {sel.length ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[12px]">
            <span className="font-medium text-fg">{tt("pfp.queue.selected", { count: sel.length })}</span>
            <span className="text-fg-subtle" title={tt("pfp.queue.selectHint")}>{tt("pfp.queue.selectHint")}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => openReceive(sel)}>
                <PackageCheck size={13} className="mr-1.5" />{tt("pfp.act.receiveBatch")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => openAdvance(sel)}>
                <CheckCircle2 size={13} className="mr-1.5" />{tt("pfp.act.advance")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSel([])}>{tt("pfp.queue.clear")}</Button>
            </div>
          </div>
        ) : null}

        {queueRejected.length ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[12px] text-warning">
            {tt("pfp.queue.rejected", { count: queueRejected.length })}
            <ul className="mt-1 list-disc pl-5">
              {queueRejected.map((r, i) => <li key={`${r.field}-${i}`}>{r.field}：{r.reason}</li>)}
            </ul>
          </div>
        ) : null}

        {queueErr ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
            {tt("pfp.queue.err")}：{queueErr}
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="w-9 px-3 py-2.5">
                    <input
                      type="checkbox" className="h-4 w-4 cursor-pointer" checked={allPageSelected}
                      onChange={toggleAll} disabled={queueBusy || pageIds.length === 0}
                      aria-label={tt("pfp.queue.selectHint")}
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">{tt("pfp.col.shipment")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("pfp.col.stage")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("pfp.col.pushState")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("pfp.col.docStatus")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("pfp.col.callback")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("pfp.col.parcels")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("pfp.col.fee")}</th>
                  <th className="px-3 py-2.5 font-medium">{tt("pfp.col.time")}</th>
                  <th className="px-3 py-2.5 text-right font-medium">{tt("pfp.col.action")}</th>
                </tr>
              </thead>
              <tbody>
                {queueBusy && !rows.length ? (
                  <tr><td colSpan={10} className="px-4 py-14 text-center text-muted-foreground">
                    <Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt("pfp.detail.loading")}
                  </td></tr>
                ) : !rows.length ? (
                  <tr><td colSpan={10}>
                    <EmptyState text={tt("pfp.queue.empty")} hint={tt("pfp.queue.emptyHint")} />
                  </td></tr>
                ) : rows.map((r) => (
                  <tr key={r.shipment_id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2.5 align-top">
                      <input
                        type="checkbox" className="h-4 w-4 cursor-pointer" checked={sel.includes(r.shipment_id)}
                        onChange={() => toggleOne(r.shipment_id)} aria-label={r.batch_no ?? r.shipment_id}
                      />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-mono text-[12px] text-fg">{r.batch_no || r.order_id || r.shipment_id}</div>
                      <div className="mt-0.5 text-[11px] text-fg-subtle">
                        {r.platform_order_no || r.wms_order_no || tt("pfp.fld.none")}
                      </div>
                      <div className="mt-0.5 text-[11px] text-fg-subtle">
                        {r.tracking_no ? `${tt("pfp.fld.trackingNo")} ${r.tracking_no}${r.carrier ? ` · ${r.carrier}` : ""}` : tt("pfp.fld.trackingNo")}
                      </div>
                      <div className="mt-0.5 text-[11px] text-fg-subtle">
                        {r.warehouse_name || tt("pfp.fld.warehouse")} · {r.channel_name || tt("pfp.fld.channel")} · {r.destination || tt("pfp.fld.none")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Badge variant={STAGE_TONE[r.stage] ?? "outline"}>{enumLabel("shp.stage.", r.stage, STAGES)}</Badge>
                      <div className="mt-1 text-[11px] text-fg-subtle">
                        {r.next_stages.length
                          ? `${tt("pfp.queue.nextStage")}：${r.next_stages.map((n) => enumLabel("shp.stage.", n.to_stage, STAGES)).join(" / ")}`
                          : tt("pfp.queue.noNext")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Badge variant={PUSH_TONE[r.push_state] ?? "outline"}>{enumLabel("shp.push.", r.push_state, PUSH_STATES)}</Badge>
                      {r.pushed_at ? <div className="mt-1 text-[11px] text-fg-subtle">{fmtTime(r.pushed_at)}</div> : null}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Badge variant={DOC_TONE[r.doc_status] ?? "outline"}>{enumLabel("shp.doc.", r.doc_status, DOC_STATUSES)}</Badge>
                      <div className="mt-1 text-[11px] text-fg-subtle">
                        {enumLabel("shp.intercept.", r.intercept_state, INTERCEPT_STATES)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <Badge variant={NORM_TONE[r.norm_status] ?? "outline"}>{enumLabel("shp.norm.", r.norm_status, NORM_STATUSES)}</Badge>
                      <div className="mt-1 max-w-[150px] truncate text-[11px] text-fg-subtle" title={r.raw_status ?? ""}>
                        {r.raw_status || tt("pfp.fld.none")}
                      </div>
                      <Badge className="mt-1" variant={LABEL_TONE[r.label_state] ?? "outline"}>
                        {enumLabel("shp.labelState.", r.label_state, LABEL_STATES)}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className={cn("font-data tabular-nums", r.parcel_total > 0 && r.parcel_signed >= r.parcel_total ? "text-success" : "")}>
                        {r.parcel_signed}/{r.parcel_total}
                      </span>
                      {r.open_work_orders ? (
                        <Badge className="ml-1" variant="warning">
                          <ClipboardList size={11} />{tt("pfp.wo.count", { count: r.open_work_orders })}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="font-data tabular-nums text-[12px]">{tt("pfp.fld.actual", { amount: fmtMoney(r.actual_amount, r.fee_currency) })}</div>
                      <div className="mt-0.5 text-[11px] text-fg-subtle">{tt("pfp.fld.estimated", { amount: fmtMoney(r.estimated_amount, "").trim() })}</div>
                      <div className="text-[11px] text-fg-subtle">
                        {tt("pfp.fld.chargedWeight", { g: fmtNum(r.charged_weight_g) })} / {tt("pfp.fld.declaredWeight", { g: fmtNum(r.declared_weight_g) })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-[11px] leading-relaxed text-fg-subtle">
                      <div>{tt("pfp.fld.receivedAt")} {fmtTime(r.received_at)}</div>
                      <div>{tt("pfp.fld.packedAt")} {fmtTime(r.packed_at)}</div>
                      <div>{tt("pfp.fld.handoverAt")} {fmtTime(r.handover_at)}</div>
                      <div>{tt("pfp.fld.createdAt")} {fmtTime(r.created_at)}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => openReceive([r.shipment_id])}>
                          <PackageCheck size={12} className="mr-1" />{tt("pfp.act.receive")}
                        </Button>
                        <Button
                          size="sm" variant="outline"
                          onClick={() => openAdvance([r.shipment_id], r.next_stages[0]?.to_stage)}
                          disabled={!r.next_stages.length}
                        >
                          <CheckCircle2 size={12} className="mr-1" />{tt("pfp.act.advance")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openFees(r)}>
                          <Coins size={12} className="mr-1" />{tt("pfp.act.fees")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openIntercept(r)}
                          title={r.intercept_state !== "requested" ? tt("pfp.intercept.noRequest") : undefined}
                        >
                          <ShieldAlert size={12} className="mr-1" />{tt("pfp.act.intercept")}
                        </Button>
                        <Button size="sm" onClick={() => setDetailId(r.shipment_id)}>
                          <History size={12} className="mr-1" />
                          {r.open_work_orders ? tt("pfp.act.workOrders") : tt("pfp.act.detail")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[12px] text-fg-muted">
            <span>{tt("pfp.common.total")} {total} · {tt("pfp.queue.count", { count: rows.length })}</span>
            <span className="ml-auto">{tt("pfp.queue.page", { page, pages: pageCount })}</span>
            <Button size="sm" variant="outline" disabled={page <= 1 || queueBusy} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft size={13} className="mr-1" />{tt("pfp.queue.prev")}
            </Button>
            <Button size="sm" variant="outline" disabled={page >= pageCount || queueBusy} onClick={() => setPage((p) => p + 1)}>
              {tt("pfp.queue.next")}<ChevronRight size={13} className="ml-1" />
            </Button>
          </div>
        </div>
      </section>

      {/* ---------- 签收对话框 ---------- */}
      <Dialog open={receiveIds !== null} onOpenChange={(o) => { if (!o) setReceiveIds(null); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{tt("pfp.receive.title")}</DialogTitle>
            <DialogDescription>{tt("pfp.receive.desc")}</DialogDescription>
          </DialogHeader>
          <p className="text-[12px] text-fg-muted">
            {tt("pfp.receive.target", {
              count: receiveIds?.length ?? 0,
              parcels: rows.filter((r) => receiveIds?.includes(r.shipment_id)).reduce((a, r) => a + r.parcel_total, 0),
            })}
            {" / "}{tt("pfp.receive.unknownParcels")}
          </p>
          <Textarea
            rows={2} value={receiveNote} placeholder={tt("pfp.receive.notePh")}
            onChange={(e) => setReceiveNote(e.target.value)}
          />
          {receiveResp ? <ReceiveResultPanel resp={receiveResp} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveIds(null)}>{receiveResp ? tt("pfp.common.close") : tt("pfp.common.cancel")}</Button>
            {!receiveResp ? (
              <Button onClick={() => void submitReceive()} disabled={busy}>
                {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                {tt("pfp.receive.confirm")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- 推进对话框 ---------- */}
      <Dialog open={advanceIds !== null} onOpenChange={(o) => { if (!o) setAdvanceIds(null); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>{tt("pfp.advance.title")}</DialogTitle>
            <DialogDescription>{tt("pfp.advance.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pfp-adv-to">{tt("pfp.advance.to")} · {tt("pfp.queue.selected", { count: advanceIds?.length ?? 0 })}</Label>
              <select
                id="pfp-adv-to"
                className="h-9 w-full rounded-md border border-border bg-card px-2 text-[13px]"
                value={advanceTo} onChange={(e) => setAdvanceTo(e.target.value)}
              >
                <option value="">—</option>
                {Array.from(new Set(
                  (advanceIds?.length === 1
                    ? (rows.find((r) => r.shipment_id === advanceIds[0])?.next_stages.map((n) => n.to_stage) ?? [])
                    : STAGES)
                )).map((s) => <option key={s} value={s}>{enumLabel("shp.stage.", s, STAGES)}</option>)}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pfp-adv-track">{tt("pfp.advance.tracking")}</Label>
                <Input id="pfp-adv-track" value={advanceTracking} onChange={(e) => setAdvanceTracking(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pfp-adv-carrier">{tt("pfp.advance.carrier")}</Label>
                <Input id="pfp-adv-carrier" value={advanceCarrier} onChange={(e) => setAdvanceCarrier(e.target.value)} />
              </div>
            </div>
            <Textarea rows={2} value={advanceNote} placeholder={tt("pfp.advance.notePh")} onChange={(e) => setAdvanceNote(e.target.value)} />
            <p className="text-[11px] leading-relaxed text-fg-subtle">{tt("pfp.advance.hint")}</p>
          </div>
          {advanceResp ? <AdvanceResultPanel resp={advanceResp} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdvanceIds(null)}>{advanceResp ? tt("pfp.common.close") : tt("pfp.common.cancel")}</Button>
            {!advanceResp ? (
              <Button onClick={() => void submitAdvance()} disabled={busy || !advanceTo}>
                {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                {tt("pfp.advance.submit")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- 费用申报对话框 ---------- */}
      <Dialog open={feeRow !== null} onOpenChange={(o) => { if (!o) setFeeRow(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>{tt("pfp.fee.title")}</DialogTitle>
            <DialogDescription>{tt("pfp.fee.desc")}</DialogDescription>
          </DialogHeader>
          {feeRow ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                <span className="font-mono">{feeRow.batch_no || feeRow.order_id || feeRow.shipment_id}</span>
                <Badge variant={STAGE_TONE[feeRow.stage] ?? "outline"}>{enumLabel("shp.stage.", feeRow.stage, STAGES)}</Badge>
                <span>{tt("pfp.fee.currentTotal", { amount: fmtMoney(feeRow.actual_amount, feeRow.fee_currency) })}</span>
              </div>

              <div className="space-y-2">
                {feeLines.map((l, i) => (
                  <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-border bg-muted/20 p-2 sm:grid-cols-8">
                    <div className="col-span-2 space-y-1 sm:col-span-2">
                      <Label className="text-[11px]">{tt("pfp.fee.line", { n: i + 1 })} · {tt("pfp.fee.type")}</Label>
                      <select
                        className="h-8 w-full rounded-md border border-border bg-card px-1.5 text-[12px]"
                        value={l.fee_type} onChange={(e) => setFeeLines((prev) => prev.map((x, j) => (j === i ? { ...x, fee_type: e.target.value } : x)))}
                      >
                        {FEE_TYPES.map((f) => <option key={f} value={f}>{enumLabel("pfp.feeType.", f, FEE_TYPES)}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">{tt("pfp.fee.amount")}</Label>
                      <Input
                        className="h-8 text-[12px]" inputMode="decimal" value={l.amount}
                        onChange={(e) => setFeeLines((prev) => prev.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">{tt("pfp.fee.currency")}</Label>
                      <Input
                        className="h-8 text-[12px]" value={l.currency}
                        onChange={(e) => setFeeLines((prev) => prev.map((x, j) => (j === i ? { ...x, currency: e.target.value } : x)))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">{tt("pfp.fee.chargeUnit")}</Label>
                      <select
                        className="h-8 w-full rounded-md border border-border bg-card px-1.5 text-[12px]"
                        value={l.charge_unit} onChange={(e) => setFeeLines((prev) => prev.map((x, j) => (j === i ? { ...x, charge_unit: e.target.value } : x)))}
                      >
                        {CHARGE_UNITS.map((u) => <option key={u} value={u}>{enumLabel("pfp.unit.", u, CHARGE_UNITS)}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">{tt("pfp.fee.chargeQty")}</Label>
                      <Input
                        className="h-8 text-[12px]" inputMode="decimal" value={l.charge_qty}
                        onChange={(e) => setFeeLines((prev) => prev.map((x, j) => (j === i ? { ...x, charge_qty: e.target.value } : x)))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">{tt("pfp.fee.unitPrice")}</Label>
                      <Input
                        className="h-8 text-[12px]" inputMode="decimal" value={l.unit_price}
                        onChange={(e) => setFeeLines((prev) => prev.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">{tt("pfp.fee.weightCharged")}</Label>
                      <Input
                        className="h-8 text-[12px]" inputMode="decimal" value={l.weight_charged_g}
                        onChange={(e) => setFeeLines((prev) => prev.map((x, j) => (j === i ? { ...x, weight_charged_g: e.target.value } : x)))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">{tt("pfp.fee.weightDeclared")}</Label>
                      <Input
                        className="h-8 text-[12px]" inputMode="decimal" value={l.weight_declared_g}
                        onChange={(e) => setFeeLines((prev) => prev.map((x, j) => (j === i ? { ...x, weight_declared_g: e.target.value } : x)))}
                      />
                    </div>
                    <Button size="sm" variant="ghost" className="justify-self-end" onClick={() => setFeeLines((prev) => prev.filter((_, j) => j !== i))}>
                      <X size={13} />{tt("pfp.fee.removeLine")}
                    </Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setFeeLines((prev) => [...prev, emptyFeeLine(feeRow.fee_currency ?? "CNY")])}>
                  {tt("pfp.fee.addLine")}
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="pfp-fee-cw">{tt("pfp.fee.shipCharged")}</Label>
                  <Input
                    id="pfp-fee-cw" inputMode="decimal" placeholder={fmtNum(feeRow.charged_weight_g)}
                    value={feeShipCharged} onChange={(e) => setFeeShipCharged(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pfp-fee-dw">{tt("pfp.fee.shipDeclared")}</Label>
                  <Input
                    id="pfp-fee-dw" inputMode="decimal" placeholder={fmtNum(feeRow.declared_weight_g)}
                    value={feeShipDeclared} onChange={(e) => setFeeShipDeclared(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-[11px] text-fg-subtle">{tt("pfp.fee.weightHint")}</p>
              <Textarea rows={2} value={feeNote} placeholder={tt("pfp.receive.notePh")} onChange={(e) => setFeeNote(e.target.value)} />
            </div>
          ) : null}
          {feeResp ? <FeeResultPanel resp={feeResp} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeeRow(null)}>{feeResp ? tt("pfp.common.close") : tt("pfp.common.cancel")}</Button>
            {!feeResp ? (
              <Button onClick={() => void submitFees()} disabled={busy}>
                {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                {tt("pfp.fee.submit")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- 拦截回执对话框 ---------- */}
      <Dialog open={interceptRow !== null} onOpenChange={(o) => { if (!o) setInterceptRow(null); }}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{tt("pfp.intercept.title")}</DialogTitle>
            <DialogDescription>{tt("pfp.intercept.desc")}</DialogDescription>
          </DialogHeader>
          {interceptRow ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                <span className="font-mono">{interceptRow.batch_no || interceptRow.shipment_id}</span>
                <span>{tt("pfp.intercept.state")}：</span>
                <Badge variant={INTERCEPT_TONE[interceptRow.intercept_state] ?? "outline"}>
                  {enumLabel("shp.intercept.", interceptRow.intercept_state, INTERCEPT_STATES)}
                </Badge>
                {interceptRow.intercept_state !== "requested" ? (
                  <span className="text-warning">{tt("pfp.intercept.noRequest")}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={interceptResult === "succeeded" ? "default" : "outline"} onClick={() => setInterceptResult("succeeded")}>
                  {tt("pfp.intercept.succeeded")}
                </Button>
                <Button size="sm" variant={interceptResult === "failed" ? "default" : "outline"} onClick={() => setInterceptResult("failed")}>
                  {tt("pfp.intercept.failed")}
                </Button>
              </div>
              <Textarea rows={2} value={interceptNote} placeholder={tt("pfp.intercept.notePh")} onChange={(e) => setInterceptNote(e.target.value)} />
            </div>
          ) : null}
          {interceptResp ? (
            <div className="mt-3 rounded-lg border border-border bg-muted/20 p-2.5 text-[12px]">
              {interceptResp.already_applied ? tt("pfp.intercept.dup")
                : interceptResp.applied ? tt("pfp.intercept.applied", { doc: enumLabel("shp.doc.", interceptResp.doc_status, DOC_STATUSES) })
                : tt("pfp.intercept.refused", { reason: interceptResp.note || tt("pfp.err.noDetail") })}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInterceptRow(null)}>{interceptResp ? tt("pfp.common.close") : tt("pfp.common.cancel")}</Button>
            {!interceptResp ? (
              <Button onClick={() => void submitIntercept()} disabled={busy}>
                {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                {tt("pfp.intercept.submit")}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- 详情抽屉 ---------- */}
      {detailId ? (
        <DetailPanel
          token={token} shipmentId={detailId} refreshToken={detailRefresh} identity={identity}
          onClose={() => setDetailId(null)}
          onReceived={() => { reloadAll(); setDetailRefresh((n) => n + 1); }}
          onAuthFailure={onAuthFailure}
        />
      ) : null}
    </div>
  );
}

/* ────────────── 结果面板 ────────────── */

const RESULT_TONE: Record<string, Variant> = {
  applied: "success", already_applied: "muted", rejected: "destructive", failed: "destructive",
};

function ResultRow({ result, main, sub }: { result: string; main: string; sub?: string | null }) {
  const tone = RESULT_TONE[result] ?? "outline";
  return (
    <div className="flex items-start gap-2 border-b border-border/50 py-1.5 last:border-0">
      <Badge variant={tone} className="shrink-0">
        {result === "applied" ? tt("pfp.result.applied")
          : result === "already_applied" ? tt("pfp.result.already")
          : result === "rejected" ? tt("pfp.result.rejected") : tt("pfp.result.failed")}
      </Badge>
      <span className="min-w-0 break-words text-[12px] text-fg">{main}</span>
      {sub ? <span className="ml-auto shrink-0 text-[11px] text-warning">{sub}</span> : null}
    </div>
  );
}

function ReceiveResultPanel({ resp }: { resp: ReceiveResp }) {
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{tt("pfp.receive.done", { signed: resp.signed, already: resp.already_applied, failed: resp.failed })}</Badge>
        {resp.shipments.filter((s) => s.auto_advanced).length ? (
          <Badge variant="info">{tt("pfp.receive.autoAdvanced", { count: resp.shipments.filter((s) => s.auto_advanced).length })}</Badge>
        ) : null}
        {resp.not_found.length ? (
          <Badge variant="muted">{tt("pfp.receive.notFound", { count: resp.not_found.length })}</Badge>
        ) : null}
      </div>
      <ul className="max-h-[220px] space-y-1 overflow-y-auto">
        {resp.not_found.map((n) => <li key={n} className="text-fg-subtle">{tt("pfp.result.notFound")}：{n}</li>)}
        {resp.rejected.map((r, i) => <li key={`${r.field}-${i}`} className="text-destructive">{r.field}：{r.reason}</li>)}
        {resp.shipments.map((s) => (
          <li key={s.shipment_id} className="font-mono text-[11px] text-fg-muted">
            {s.batch_no || s.shipment_id}：{enumLabel("shp.stage.", s.stage_before, STAGES)} → {enumLabel("shp.stage.", s.stage_after, STAGES)}
            （{s.parcel_signed}/{s.parcel_total}）
          </li>
        ))}
      </ul>
      <p className="text-[11px] leading-relaxed text-fg-subtle">{resp.note}</p>
    </div>
  );
}

function AdvanceResultPanel({ resp }: { resp: AdvanceResp }) {
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <Badge variant={resp.applied ? "success" : resp.already_applied ? "muted" : "destructive"}>
          {tt("pfp.advance.result", { applied: resp.applied, already: resp.already_applied, rejected: resp.rejected })}
        </Badge>
        {resp.not_found.length ? <Badge variant="muted">{tt("pfp.receive.notFound", { count: resp.not_found.length })}</Badge> : null}
      </div>
      <div className="max-h-[240px] overflow-y-auto">
        {resp.results.map((r, i) => (
          <ResultRow
            key={`${r.shipment_id}-${i}`}
            result={String(r.result ?? "failed")}
            main={`${r.batch_no || r.shipment_id}：${enumLabel("shp.stage.", r.stage_before, STAGES)} → ${enumLabel("shp.stage.", r.stage_after ?? r.to_stage, STAGES)}`}
            sub={r.result === "rejected" ? `${tt("pfp.advance.gateBlocked")}${r.gate ? `（${tk(GATE_KEY[r.gate] ?? r.gate)}）` : ""}：${r.reason ?? ""}` : null}
          />
        ))}
        {resp.not_found.map((n) => (
          <ResultRow key={n} result="rejected" main={`${tt("pfp.result.notFound")}：${n}`} sub={null} />
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-fg-subtle">{resp.note}</p>
    </div>
  );
}

function FeeResultPanel({ resp }: { resp: DeclareFeesResp }) {
  return (
    <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-[12px]">
      {resp.already_applied ? (
        <Badge variant="muted">{tt("pfp.fee.dup")}</Badge>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">{tt("pfp.fee.submitted", {
            count: resp.inserted.length, amount: fmtMoney(resp.actual_amount, "").trim(), currency: resp.fee_currency ?? "",
          })}</Badge>
          {resp.diff_flag_count ? <Badge variant="warning">{tt("pfp.fee.diffFlagged", { count: resp.diff_flag_count })}</Badge> : null}
          {resp.currency_mixed ? <Badge variant="destructive">{tt("pfp.fee.mixedCurrency", { currency: resp.fee_currency ?? "" })}</Badge> : null}
        </div>
      )}
      <ul className="max-h-[180px] space-y-1 overflow-y-auto">
        {resp.rejected.length ? (
          <li className="text-destructive">{tt("pfp.fee.rejectedLines", { count: resp.rejected.length })}</li>
        ) : null}
        {resp.inserted.map((f) => (
          <li key={f.id} className="font-mono text-[11px] text-fg-muted">
            {enumLabel("pfp.feeType.", f.fee_type, FEE_TYPES)} · {fmtMoney(f.amount, f.currency)}
            {f.diff_flag ? " · ⚠" : ""} · {feeStatusLabel(f.status)}
          </li>
        ))}
        {resp.rejected.map((r, i) => <li key={`${r.field}-${i}`} className="text-destructive">{r.field}：{r.reason}</li>)}
      </ul>
      <p className="text-[11px] leading-relaxed text-fg-subtle">{resp.note}</p>
    </div>
  );
}

/* ────────────── 详情抽屉：包裹 / 费用行 / 工单 / 时间线 ────────────── */

function DetailPanel({
  token, shipmentId, refreshToken, identity, onClose, onReceived, onAuthFailure,
}: {
  token: string | null;
  shipmentId: string;
  refreshToken: number;
  identity: Identity | null;
  onClose: () => void;
  onReceived: () => void;
  onAuthFailure: (e: unknown) => boolean;
}) {
  const [data, setData] = useState<DetailResp | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState((prev) => (prev === "ready" ? "ready" : "loading"));
    setBusy(true);
    try {
      const resp = await callPortal<DetailResp>(token, { action: "shipment_detail", shipment_id: shipmentId });
      setData(resp);
      setState("ready");
      setErr("");
    } catch (e) {
      if (!onAuthFailure(e)) {
        setErr(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    } finally {
      setBusy(false);
    }
  }, [token, shipmentId, onAuthFailure]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const signParcels = async () => {
    setBusy(true);
    try {
      const resp = await callPortal<ReceiveResp>(token, { action: "receive", shipment_ids: [shipmentId] });
      toast.success(tt("pfp.receive.done", { signed: resp.signed, already: resp.already_applied, failed: resp.failed }));
      onReceived();   // refreshToken 变化会让上面的 effect 重拉一次，这里不再手动 load
    } catch (e) {
      if (!onAuthFailure(e)) toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sh = data?.shipment;

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[min(900px,100vw)] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {tt("pfp.detail.title")}
            <span className="font-mono text-[13px] text-fg-muted">{sh?.batch_no || sh?.order_id || shipmentId}</span>
          </SheetTitle>
          <SheetDescription>
            {identity ? `${identity.forwarderName} · ${identity.username}` : ""}
            {sh ? ` / ${sh.warehouse_name || tt("pfp.fld.warehouse")} · ${sh.channel_name || tt("pfp.fld.channel")}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={busy}>
            <RefreshCw size={13} className={cn("mr-1.5", busy && "animate-spin")} />{tt("pfp.act.reload")}
          </Button>
          {sh ? (
            <>
              <Button size="sm" onClick={() => void signParcels()} disabled={busy}>
                <PackageCheck size={13} className="mr-1.5" />{tt("pfp.act.receive")}
              </Button>
              <Badge variant={STAGE_TONE[sh.stage] ?? "outline"}>{enumLabel("shp.stage.", sh.stage, STAGES)}</Badge>
              <Badge variant={PUSH_TONE[sh.push_state] ?? "outline"}>{enumLabel("shp.push.", sh.push_state, PUSH_STATES)}</Badge>
              <Badge variant={DOC_TONE[sh.doc_status] ?? "outline"}>{enumLabel("shp.doc.", sh.doc_status, DOC_STATUSES)}</Badge>
              <Badge variant={NORM_TONE[sh.norm_status] ?? "outline"}>{enumLabel("shp.norm.", sh.norm_status, NORM_STATUSES)}</Badge>
            </>
          ) : null}
        </div>

        {state === "error" ? (
          <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12px] text-destructive">
            {tt("pfp.detail.err")}：{err}
          </div>
        ) : null}
        {state === "loading" && !data ? (
          <div className="mt-10 flex items-center justify-center gap-2 text-[13px] text-fg-muted">
            <Loader2 size={15} className="animate-spin" />{tt("pfp.detail.loading")}
          </div>
        ) : null}

        {data && sh ? (
          <div className="mt-4 space-y-5">
            {/* 主单字段 */}
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">{tt("pfp.detail.base")}</h3>
              <div className="grid gap-x-4 gap-y-1.5 rounded-xl border border-border bg-card p-3 text-[12px] sm:grid-cols-2">
                <Field label={tt("pfp.fld.batchNo")} value={sh.batch_no} mono />
                <Field label={tt("pfp.fld.orderId")} value={sh.order_id} mono />
                <Field label={tt("pfp.fld.platformOrderNo")} value={sh.platform_order_no} mono />
                <Field label={tt("pfp.fld.wmsOrderNo")} value={sh.wms_order_no} mono />
                <Field label={tt("pfp.fld.trackingNo")} value={sh.tracking_no} mono />
                <Field label={tt("pfp.fld.carrier")} value={sh.carrier} />
                <Field label={tt("pfp.fld.forwarder")} value={sh.forwarder_name} />
                <Field label={tt("pfp.fld.warehouse")} value={sh.warehouse_name} />
                <Field label={tt("pfp.fld.channel")} value={sh.channel_name} />
                <Field label={tt("pfp.fld.destination")} value={sh.destination} />
                <Field label={tt("pfp.fld.platform")} value={sh.platform} />
                <Field label={tt("pfp.fld.rawStatus")} value={sh.raw_status} />
                <Field label={tt("pfp.fld.interceptState")} value={enumLabel("shp.intercept.", sh.intercept_state, INTERCEPT_STATES)} />
                <Field
                  label={tt("pfp.col.fee")}
                  value={`${tt("pfp.fld.actual", { amount: fmtMoney(sh.actual_amount, sh.fee_currency) })} · ${tt("pfp.fld.estimated", { amount: fmtMoney(sh.estimated_amount, "").trim() })}`}
                />
                <Field
                  label={tt("pfp.col.fee") + " / " + tt("pfp.fld.weight")}
                  value={`${tt("pfp.fld.chargedWeight", { g: fmtNum(sh.charged_weight_g) })} · ${tt("pfp.fld.declaredWeight", { g: fmtNum(sh.declared_weight_g) })}`}
                />
                <Field label={tt("pfp.fld.receivedAt")} value={fmtTime(sh.received_at)} />
                <Field label={tt("pfp.fld.packedAt")} value={fmtTime(sh.packed_at)} />
                <Field label={tt("pfp.fld.handoverAt")} value={fmtTime(sh.handover_at)} />
                <Field label={tt("pfp.fld.closedAt")} value={fmtTime(sh.closed_at)} />
                <Field label={tt("pfp.fld.createdAt")} value={fmtTime(sh.created_at)} />
                <Field label={tt("pfp.fld.remark")} value={sh.remark} />
              </div>
            </section>

            {/* 可推进阶段与门禁（后端逐条调 shipment_can_advance 的真实结果） */}
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">{tt("pfp.detail.advanceOptions")}</h3>
              {data.advance_options.length ? data.advance_options.map((o) => (
                <div key={o.to_stage} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[12px]">
                  <Badge variant={o.allowed ? "success" : "warning"}>{o.allowed ? tt("pfp.detail.allowed") : tt("pfp.detail.blocked")}</Badge>
                  <span>{enumLabel("shp.stage.", o.to_stage, STAGES)}</span>
                  {o.gate ? <span className="text-fg-subtle">{tk(GATE_KEY[o.gate] ?? o.gate)}</span> : null}
                  {o.reason ? <span className="text-warning">{o.reason}</span> : null}
                </div>
              )) : <p className="text-[12px] text-fg-subtle">{tt("pfp.queue.noNext")}</p>}
            </section>

            {/* 包裹明细 */}
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">
                {tt("pfp.detail.parcels", { signed: sh.parcel_signed, total: sh.parcel_total })}
              </h3>
              {data.parcels.length ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-[11px] text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.parcelNo")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.waybillNo")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.inboundStatus")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.weight")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.dims")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.signedAt")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.signedBy")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.parcels.map((p) => (
                        <tr key={p.id} className="border-b border-border/50 last:border-0">
                          <td className="px-2 py-1.5 font-mono">{p.parcel_no || p.package_number || tt("pfp.fld.none")}</td>
                          <td className="px-2 py-1.5 font-mono">{p.waybill_no || p.inbound_tracking_no || tt("pfp.fld.none")}</td>
                          <td className="px-2 py-1.5">
                            <Badge variant={INBOUND_TONE[p.inbound_status ?? ""] ?? "outline"}>
                              {enumLabel("pfp.inbound.", p.inbound_status, data.domains.inbound_statuses.length ? data.domains.inbound_statuses : INBOUND_STATUSES)}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5 font-data tabular-nums">{fmtNum(p.weight)}</td>
                          <td className="px-2 py-1.5 font-data tabular-nums">
                            {p.length || p.width || p.height ? `${p.length ?? "-" }×${p.width ?? "-"}×${p.height ?? "-"}` : tt("pfp.fld.none")}
                          </td>
                          <td className="px-2 py-1.5">{fmtTime(p.signed_at)}</td>
                          <td className="px-2 py-1.5 break-all text-fg-subtle">{p.signed_by || tt("pfp.fld.none")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-[12px] text-fg-subtle">{tt("pfp.fee.none")}</p>}
            </section>

            {/* 费用行 */}
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">{tt("pfp.detail.fees")}</h3>
              <p className="text-[12px] text-fg-muted">
                {tt("pfp.fee.existing", { amount: fmtMoney(data.fee_summary.declared_total, sh.fee_currency), pending: data.fee_summary.pending_audit })}
              </p>
              {data.billing_lines.length ? (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-[11px] text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.feeType")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.amount")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.status")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.source")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.diffFlag")}</th>
                        <th className="px-2 py-1.5 font-medium">{tt("pfp.fld.createdAt")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.billing_lines.map((b) => (
                        <tr key={b.id} className="border-b border-border/50 last:border-0">
                          <td className="px-2 py-1.5">{enumLabel("pfp.feeType.", b.fee_type, data.domains.fee_types.length ? data.domains.fee_types : FEE_TYPES)}</td>
                          <td className="px-2 py-1.5 font-data tabular-nums">{fmtMoney(b.amount, b.currency)}</td>
                          <td className="px-2 py-1.5">
                            <Badge variant={FEE_STATUS_TONE[b.status ?? ""] ?? "outline"}>
                              {feeStatusLabel(b.status)}
                            </Badge>
                          </td>
                          <td className="px-2 py-1.5">{enumLabel("pfp.source.", b.source, ["rate_card", "wms_returned", "auto_fetch", "manual_import"])}</td>
                          <td className="px-2 py-1.5">{b.diff_flag ? <Badge variant="warning">⚠</Badge> : tt("pfp.fld.none")}</td>
                          <td className="px-2 py-1.5">{fmtTime(b.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-[12px] text-fg-subtle">{tt("pfp.fee.none")}</p>}
            </section>

            {/* 工单 */}
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">{tt("pfp.detail.workOrders", { count: sh.open_work_orders })}</h3>
              {data.work_orders.length ? (
                <ul className="space-y-1.5">
                  {data.work_orders.map((w) => (
                    <li key={String(w.id)} className="rounded-lg border border-border bg-card px-3 py-2 text-[12px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={WO_STATUS_TONE[w.status ?? ""] ?? "outline"}>{enumLabel("shp.woStatus.", w.status, WO_STATUSES)}</Badge>
                        <Badge variant={WO_PRIORITY_TONE[w.priority ?? ""] ?? "outline"}>{enumLabel("shp.woPriority.", w.priority, WO_PRIORITIES)}</Badge>
                        <span className="min-w-0 break-words font-medium">{w.title || tt("pfp.fld.none")}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
                        <span>{tt("pfp.fld.woType")}：{enumLabel("shp.woType.", w.type, WO_TYPES)}</span>
                        <span>{tt("pfp.fld.woAssignee")}：{enumLabel("shp.woAssignee.", w.assignee_type, WO_ASSIGNEES)}</span>
                        <span>{tt("pfp.fld.woDue")}：{fmtTime(w.due_at)}</span>
                        <span>{tt("pfp.fld.createdAt")}：{fmtTime(w.created_at)}</span>
                      </div>
                      {w.description ? <p className="mt-1 break-words text-[11px] text-fg-subtle">{w.description}</p> : null}
                      {w.resolution ? <p className="mt-1 break-words text-[11px] text-success">{w.resolution}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12px] text-fg-subtle">{tt("pfp.detail.noWo")}</p>}
            </section>

            {/* 状态时间线：PORTAL: / ERP: / 货代原文 分色，来源一眼可辨 */}
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">{tt("pfp.detail.timeline")}</h3>
              <p className="text-[11px] leading-relaxed text-fg-subtle">{tt("pfp.detail.eventPrefixHint")}</p>
              {data.timeline.length ? (
                <ul className="space-y-1">
                  {data.timeline.map((ev) => {
                    const k = eventKind(ev.raw_status);
                    return (
                      <li key={String(ev.id)} className="flex flex-wrap items-center gap-2 border-b border-border/50 py-1.5 text-[12px] last:border-0">
                        <Badge variant={k.tone}>{k.label}</Badge>
                        <span className="font-mono text-[11px]">{ev.raw_status || tt("pfp.fld.none")}</span>
                        <span className="text-fg-subtle" title={tt("pfp.fld.occurredAt")}>{fmtTime(ev.occurred_at ?? ev.created_at)}</span>
                        {ev.stage ? <span className="text-fg-subtle">{enumLabel("shp.stage.", ev.stage, STAGES)}</span> : null}
                        {ev.operator ? <span className="text-fg-subtle" title={tt("pfp.fld.operator")}>{ev.operator}</span> : null}
                        {ev.failed_reason ? <span className="text-destructive">{tt("pfp.fld.failedReason")}：{ev.failed_reason}</span> : null}
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="text-[12px] text-fg-subtle">{tt("pfp.detail.noTimeline")}</p>}
            </section>

            {/* 推单日志：门户动作也会在这里留痕（push_logs direction=in / action=portal_*） */}
            <section className="space-y-1.5">
              <h3 className="text-[13px] font-semibold">{tt("pfp.detail.logs", { n: data.push_logs.length })}</h3>
              {data.push_logs.length ? (
                <ul className="space-y-1">
                  {data.push_logs.map((l) => (
                    <li key={String(l.id)} className="flex flex-wrap items-center gap-2 border-b border-border/50 py-1.5 text-[12px] last:border-0">
                      <span className="font-mono text-[11px]">{l.action || tt("pfp.fld.none")}</span>
                      <Badge variant={l.status === "success" ? "success" : l.status === "dead" || l.status === "failed" ? "destructive" : "muted"}>
                        {l.status ?? tt("pfp.fld.none")}
                      </Badge>
                      {l.error_code ? <span className="text-destructive">{l.error_code}</span> : null}
                      {l.error_message ? <span className="text-fg-subtle">{l.error_message}</span> : null}
                      <span className="ml-auto text-[11px] text-fg-subtle">{fmtTime(l.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[12px] text-fg-subtle">{tt("pfp.fld.none")}</p>}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 text-[11px] text-fg-subtle">{label}</span>
      <span className={cn("min-w-0 break-all text-[12px]", mono && "font-mono")}>{value || tt("pfp.fld.none")}</span>
    </div>
  );
}
