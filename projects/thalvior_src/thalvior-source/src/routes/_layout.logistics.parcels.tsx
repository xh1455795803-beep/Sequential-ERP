import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle, ArrowRight, Boxes, ChevronDown, ChevronRight, ClipboardList, Copy, History,
  Loader2, PackageSearch, Plus, RefreshCw, Send, ShieldAlert, Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SearchField } from "@/components/filter-bar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { queryTable, fetchTable, insertRow, callRpc, type ExtRow, type TableFilter } from "@/lib/data-access";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";
import { tt, tk } from "@/i18n/tts";
import { cn } from "@/lib/utils"
import { fmtDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/_layout/logistics/parcels")({
  component: Page_LogisticsParcels,
});

/* ------------------------------------------------------------------ *
 * 货件履约看板：数据源 v_shipment_progress（视图，聚合包裹/工单计数）
 *                + shipments（补 batch_no / label_source 等视图没有的列）
 *                + shipment_stage_transitions（合法转移与门禁）
 *                + work_orders（异常工单，只新增，不改货件 stage）
 * 四态分离：push_state / stage / doc_status / norm_status(+raw_status)
 * ------------------------------------------------------------------ */

type Variant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "muted";

const STAGES = ["wait_inbound", "received", "ready_pack", "label_ready", "picking", "packed", "handover", "shipped", "closed"] as const;
const PUSH_STATES = ["not_pushed", "pending", "pushing", "pushed", "push_failed", "dead"] as const;
const DOC_STATUSES = ["valid", "held", "cancelled"] as const;

const WO_TYPES = [
  "no_head", "wrong_item", "lost", "damaged", "stuck_customs", "return_check",
  "overdue_inbound", "out_of_stock", "balance_insufficient", "sku_unmapped",
  "label_failed", "handover_failed", "weight_dispute", "other",
] as const;
const WO_PRIORITIES = ["low", "normal", "urgent", "critical"] as const;
const WO_STATUSES = ["pending", "assigned", "processing", "suspended", "processed", "closed"] as const;
const WO_ASSIGNEES = ["forwarder", "seller", "platform_ops", "logistics"] as const;

const PUSH_TONE: Record<string, Variant> = {
  not_pushed: "muted", pending: "warning", pushing: "info",
  pushed: "success", push_failed: "destructive", dead: "destructive",
};
// push_state 三种需要解释的态：pending=还没外呼、pushing=外呼进行中、dead=重试耗尽不再自动重试
const PUSH_SEMANTIC: Record<string, string> = {
  pending: "shp.pushSem.pending", pushing: "shp.pushSem.pushing", dead: "shp.pushSem.dead",
};
const DOC_TONE: Record<string, Variant> = { valid: "success", held: "warning", cancelled: "muted" };
const NORM_TONE: Record<string, Variant> = { sending: "info", success: "success", cancel: "muted", failed: "destructive" };
const STAGE_TONE: Record<string, Variant> = {
  wait_inbound: "muted", received: "info", ready_pack: "info", label_ready: "info",
  picking: "secondary", packed: "secondary", handover: "warning", shipped: "success", closed: "muted",
};
const LABEL_TONE: Record<string, Variant> = { none: "muted", requested: "warning", ready: "success", failed: "destructive", updated: "info" };
const WO_STATUS_TONE: Record<string, Variant> = {
  pending: "warning", assigned: "info", processing: "info", suspended: "muted", processed: "success", closed: "muted",
};
const WO_PRIORITY_TONE: Record<string, Variant> = { low: "muted", normal: "secondary", urgent: "warning", critical: "destructive" };

// 门禁 code → i18n key（shipment_can_advance / shipment_stage_transitions.requires_gate）
const GATE_KEY: Record<string, string> = {
  all_parcels_signed: "shp.gate.allSigned",
  label_ready: "shp.gate.labelReady",
  tracking_no: "shp.gate.trackingNo",
};

/* ------------------------------------------------------------------ *
 * M2 外呼入口：Edge Function `forwarder-push`（后端并行开发，契约已定死）
 *   {action:"create_from_orders", order_ids, forwarder_id, warehouse_id?, channel_id?}
 *     -> { created:[{shipment_id,order_id,batch_no}], skipped:[{order_id,reason}] }
 *   {action:"push", shipment_ids}
 *     -> [{shipment_id, ok, dup, state, batch_no, error_code, error_message, attempt}]
 *        dup=true 是 24h 幂等窗口命中，属于正常结果，不能显示成失败
 *   {action:"list-logs", shipment_id}
 *     -> push_logs 倒序 <=50：[{attempt, request_snapshot, response_snapshot,
 *                              status, error_code, created_at}]
 * 调用范式照抄 src/lib/admin-api.ts:132（supabase.functions.invoke）与
 * src/lib/admin-api.ts:105-119（unwrapInvokeError 从 error.context 取状态码+后端原文），
 * 因此页面里不出现裸 fetch / 手拼 URL；EF 未部署时 404 原样透出，不假装成功。
 * ------------------------------------------------------------------ */
const PUSH_EF = "forwarder-push";
const PUSH_LOG_LIMIT = 50;
// push_logs.status 的域来自 information_schema + pg_get_constraintdef 实测：
// pending | success | failed | dead | skipped
const PUSH_LOG_TONE: Record<string, Variant> = {
  pending: "warning", success: "success", failed: "destructive", dead: "destructive", skipped: "muted",
};
const SNAPSHOT_SNIP = 4000;

// orders.status 无数据库 CHECK 约束，域取自生产数据与既有页面口径
// （_layout.orders.to-ship.tsx:50：待发货 + 部分发货 才进发货工作台）
const TO_SHIP_STATUSES = ["待发货", "部分发货"];
const ORDER_PAGE_SIZE = 50;
// 订单可选投影列（关键字只能单列 ilike：PostgREST 条件之间只能 AND）
const ORDER_SEARCH_COLS = ["external_order_id", "id", "buyer", "sku"] as const;
type OrderSearchCol = (typeof ORDER_SEARCH_COLS)[number];

interface PushRowResult {
  shipment_id?: string | null;
  ok?: boolean | null;
  dup?: boolean | null;
  state?: string | null;
  batch_no?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  attempt?: number | null;
}

interface CreatedRow { shipment_id?: string | null; order_id?: string | null; batch_no?: string | null }
interface SkippedRow { order_id?: string | null; reason?: string | null }
interface CreateFromOrdersResult { created?: CreatedRow[] | null; skipped?: SkippedRow[] | null }

interface PushLogRow {
  attempt?: number | null;
  request_snapshot?: unknown;
  response_snapshot?: unknown;
  status?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  created_at?: string | null;
}

// push_error_codes 字典行（生产 18 条：code / message_cn / message_en / retryable / category）
interface ErrorCodeEntry { code: string; message: string; retryable: boolean; category: string }
type ErrorCodeMap = Record<string, ErrorCodeEntry>;

/** supabase-js 把原始 Response 藏在 error.context 里：照 admin-api.ts 取状态码与后端原文 */
async function unwrapPushError(err: unknown): Promise<{ status: number; message: string }> {
  const e = err as {
    message?: string; statusCode?: number; status?: number;
    context?: { status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> };
  };
  let status = Number(e?.statusCode ?? e?.status ?? e?.context?.status ?? 0);
  let message = "";
  const ctx = e?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.json() as Record<string, unknown> | null;
      message = String(body?.error ?? body?.message ?? body?.msg ?? "");
    } catch {
      // 非 JSON 错误体（网关 404 常是纯文本 / HTML）：退回原文，截断后透出
      if (ctx && typeof ctx.text === "function") {
        message = String(await ctx.text().catch(() => "")).slice(0, 400);
      }
    }
  }
  if (!message) message = String(e?.message ?? "");
  if (!message && typeof err === "string") message = err;
  return { status, message };
}

async function callForwarderPush<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(PUSH_EF, { body });
  if (error) {
    const { status, message } = await unwrapPushError(error);
    // 404 = EF 还没部署；其余 = 后端原样错误。两类都不粉饰。
    throw new Error(status
      ? `HTTP ${status} · ${PUSH_EF} · ${message || tt("shp.push.err.noDetail")}`
      : (message || `${PUSH_EF}: ${tt("shp.push.err.noDetail")}`));
  }
  const payload = data as (T & { error?: string }) | null;
  if (payload && typeof payload.error === "string" && payload.error) throw new Error(payload.error);
  return data as T;
}

/** 错误码字典：真读 push_error_codes，只取启用行 */
async function loadPushErrorCodes(lang: "zh" | "en"): Promise<ErrorCodeMap> {
  const res = await queryTable("push_error_codes", {
    filters: [{ field: "is_active", value: true, op: "eq" }],
    order: { field: "code", ascending: true },
    select: "code,message_cn,message_en,retryable,category",
    limit: 50,
  });
  const m: ErrorCodeMap = {};
  for (const r of res.rows) {
    const code = st(r, "code");
    if (!code) continue;
    const zh = st(r, "message_cn");
    const en = st(r, "message_en");
    m[code] = {
      code,
      message: (lang === "en" ? en || zh : zh || en),
      retryable: r.retryable === true,
      category: st(r, "category"),
    };
  }
  return m;
}

// 错误码 + 字典原文 + 货代原话，三件一起给，避免只显示"推单失败"
function errText(code: string, msg: string, dict?: ErrorCodeMap | null): string {
  const entry = code ? dict?.[code] : undefined;
  const parts = [code || tt("shp.push.noCode"), entry?.message || "", msg].filter(Boolean);
  return parts.join(" · ");
}

function prettyJson(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") {
    try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
  }
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

const st = (r: ExtRow, k: string) => (r[k] == null ? "" : String(r[k]));
const sn = (r: ExtRow, k: string) => (r[k] == null ? null : Number(r[k]));
const isToday = (v: string | null) => {
  if (!v) return false;
  const d = new Date(v);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
};
const fmtTime = (v: string | null) => (v ? fmtDateTime(v, lang) : "—");
const money = (v: number | null, cur: string) => (v == null || Number.isNaN(v) ? "—" : `${cur || ""} ${Number(v).toFixed(2)}`.trim());

interface Shipment {
  shipment_id: string;
  order_id: string;
  platform_order_no: string;
  forwarder_name: string;
  warehouse_name: string;
  channel_name: string;
  push_state: string;
  stage: string;
  doc_status: string;
  norm_status: string;
  raw_status: string;
  tracking_no: string;
  label_state: string;
  label_source: string;
  batch_no: string;
  apply_count: number | null;
  push_attempt: number | null;
  apply_failed_code: string;
  apply_failed_reason: string;
  intercept_state: string;
  estimated_amount: number | null;
  actual_amount: number | null;
  fee_currency: string;
  parcel_total: number;
  parcel_signed: number;
  open_work_orders: number;
  created_at: string | null;
  pushed_at: string | null;
  received_at: string | null;
  packed_at: string | null;
  handover_at: string | null;
  closed_at: string | null;
}

interface Transition { from: string; to: string; gate: string; note: string }
interface GateCheck { allowed: boolean; reason: string; gate: string }
// shipment_can_advance 返回 TABLE(allowed boolean, reason text, gate text)，PostgREST 给行数组
type GateRow = { allowed?: boolean | null; reason?: string | null; gate?: string | null };
type ResultRow = { ok?: boolean | null; message?: string | null; new_stage?: string | null; action?: string | null };

const PAGE_SIZE = 15;

// 阶段流水线 / 统计卡的聚合来源：只投影计数需要的三列，窗口之外不再拉取
const AGG_SELECT = "stage,push_state,created_at";
const AGG_WINDOW = 1000;

// queryTable 的 filters 只会 AND，无法跨列 OR，因此关键字必须由用户指定单列做数据库 ilike
const SEARCH_COLS = ["order_id", "platform_order_no", "tracking_no", "batch_no"] as const;
type SearchCol = (typeof SEARCH_COLS)[number];

// PostgREST 把 ilike 的 pattern 原样透传给 LIKE，先转义 % _ \ 避免用户输入变成通配符
const likePattern = (kw: string) => `%${kw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

interface Agg { stage: string; push_state: string; created_at: string | null }

// v_shipment_progress 现共 33 列，label_source / batch_no / push_attempt 为第 31~33 列，
// 与其余字段同一条查询返回，不再二次合并 shipments 表。
function mapShipment(v: ExtRow): Shipment {
  return {
    shipment_id: st(v, "shipment_id"),
    order_id: st(v, "order_id"),
    platform_order_no: st(v, "platform_order_no"),
    forwarder_name: st(v, "forwarder_name"),
    warehouse_name: st(v, "warehouse_name"),
    channel_name: st(v, "channel_name"),
    push_state: st(v, "push_state"),
    stage: st(v, "stage"),
    doc_status: st(v, "doc_status"),
    norm_status: st(v, "norm_status"),
    raw_status: st(v, "raw_status"),
    tracking_no: st(v, "tracking_no"),
    label_state: st(v, "label_state"),
    label_source: st(v, "label_source"),
    batch_no: st(v, "batch_no"),
    apply_count: sn(v, "apply_count"),
    push_attempt: sn(v, "push_attempt"),
    apply_failed_code: st(v, "apply_failed_code"),
    apply_failed_reason: st(v, "apply_failed_reason"),
    intercept_state: st(v, "intercept_state"),
    estimated_amount: sn(v, "estimated_amount"),
    actual_amount: sn(v, "actual_amount"),
    fee_currency: st(v, "fee_currency"),
    parcel_total: Number(sn(v, "parcel_total") ?? 0),
    parcel_signed: Number(sn(v, "parcel_signed") ?? 0),
    open_work_orders: Number(sn(v, "open_work_orders") ?? 0),
    created_at: v.created_at ? String(v.created_at) : null,
    pushed_at: v.pushed_at ? String(v.pushed_at) : null,
    received_at: v.received_at ? String(v.received_at) : null,
    packed_at: v.packed_at ? String(v.packed_at) : null,
    handover_at: v.handover_at ? String(v.handover_at) : null,
    closed_at: v.closed_at ? String(v.closed_at) : null,
  };
}

function Page_LogisticsParcels() {
  // 聚合投影（列裁剪，三列）：只服务阶段流水线计数与统计卡
  const [agg, setAgg] = useState<Agg[]>([]);
  const [aggCapped, setAggCapped] = useState(false);   // 聚合是否被窗口截断
  // 列表：过滤、排序、分页、总条数全部由数据库决定
  const [rows, setRows] = useState<Shipment[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [stageTab, setStageTab] = useState<string>("all");
  const [pushFilter, setPushFilter] = useState<string>("all");
  const [docFilter, setDocFilter] = useState<string>("all");
  const [searchCol, setSearchCol] = useState<SearchCol>("order_id");
  const [keyword, setKeyword] = useState("");
  const [kwApplied, setKwApplied] = useState("");
  const [page, setPage] = useState(1);

  const [detail, setDetail] = useState<Shipment | null>(null);

  // ---- M2 外呼入口状态 ----
  const { lang } = useLanguage();
  const [selected, setSelected] = useState<string[]>([]);        // 跨页保留，批量推单用
  const [createOpen, setCreateOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<Shipment | null>(null);
  const [pushBusy, setPushBusy] = useState<string>("");          // "" | "batch" | shipment_id
  const [pushOutcome, setPushOutcome] = useState<{ ids: string[]; results: PushRowResult[]; raw: string } | null>(null);
  const [codes, setCodes] = useState<ErrorCodeMap | null>(null);
  const [codesError, setCodesError] = useState<string>("");

  // 错误码字典：真读 push_error_codes（生产 18 条），切语言重新取一次双语原文
  useEffect(() => {
    let alive = true;
    loadPushErrorCodes(lang as "zh" | "en")
      .then((m) => { if (alive) { setCodes(m); setCodesError(""); } })
      .catch((e) => {
        if (!alive) return;
        setCodes({});
        setCodesError(e instanceof Error ? e.message : tt("shp.push.err.dictFail"));
      });
    return () => { alive = false; };
  }, [lang]);

  // 关键字输入防抖：下推查询由数据库执行，不能每次按键都发请求
  useEffect(() => {
    const t = setTimeout(() => setKwApplied(keyword.trim()), 400);
    return () => clearTimeout(t);
  }, [keyword]);

  const loadAgg = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // select 裁剪到三列 + range 限定窗口；不请求 count，超窗口由行数判断
      const res = await queryTable("v_shipment_progress", {
        select: AGG_SELECT,
        order: { field: "created_at", ascending: false },
        range: { from: 0, to: AGG_WINDOW - 1 },
      });
      setAgg(res.rows.map((r) => ({
        stage: st(r, "stage"),
        push_state: st(r, "push_state"),
        created_at: r.created_at ? String(r.created_at) : null,
      })));
      setAggCapped(res.rows.length >= AGG_WINDOW);
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("shp.err.loadFail"));
      toast.error(e instanceof Error ? e.message : tt("shp.err.loadFail"));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    setListLoading(true);
    setError("");
    try {
      const filters: TableFilter[] = [];
      if (stageTab !== "all") filters.push({ field: "stage", value: stageTab, op: "eq" });
      if (pushFilter !== "all") filters.push({ field: "push_state", value: pushFilter, op: "eq" });
      if (docFilter !== "all") filters.push({ field: "doc_status", value: docFilter, op: "eq" });
      if (kwApplied) filters.push({ field: searchCol, value: likePattern(kwApplied), op: "ilike" });
      const from = (page - 1) * PAGE_SIZE;
      // 主查询：四态 + label_source / batch_no / push_attempt 均来自 v_shipment_progress（33 列）
      const res = await queryTable("v_shipment_progress", {
        filters,
        order: { field: "created_at", ascending: false },
        range: { from, to: from + PAGE_SIZE - 1 },
        count: "exact",
      });
      setRows(res.rows.map((r) => mapShipment(r)));
      setTotal(res.count ?? res.rows.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : tt("shp.err.loadFail"));
      toast.error(e instanceof Error ? e.message : tt("shp.err.loadFail"));
      setRows([]);
      setTotal(null);
    } finally {
      setListLoading(false);
    }
  }, [stageTab, pushFilter, docFilter, kwApplied, searchCol, page]);

  useEffect(() => { void loadAgg(); }, [loadAgg]);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    fetchTable("shipment_stage_transitions")
      .then((d) => setTransitions(d.map((r) => ({
        from: st(r, "from_stage"), to: st(r, "to_stage"), gate: st(r, "requires_gate"), note: st(r, "note"),
      }))))
      .catch(() => setTransitions([]));
  }, []);

  // 条件变化时回到第 1 页。放在渲染期而不是 effect：否则本页会先用旧 page 发一次请求，
  // 两个请求并发返回顺序不定，列表可能停在旧页的数据上。
  const sig = JSON.stringify([stageTab, pushFilter, docFilter, kwApplied, searchCol]);
  const [prevSig, setPrevSig] = useState(sig);
  if (sig !== prevSig) {
    setPrevSig(sig);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil((total ?? rows.length) / PAGE_SIZE));
  // 条件变化后可能落在空页上：回到第 1 页重新向数据库取数
  useEffect(() => { if (page > totalPages) setPage(1); }, [page, totalPages]);

  const stageCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of STAGES) m[s] = 0;
    for (const r of agg) if (m[r.stage] !== undefined) m[r.stage] += 1;
    return m;
  }, [agg]);

  const stats = useMemo(() => ({
    inboundToday: agg.filter((r) => r.stage === "wait_inbound" && isToday(r.created_at)).length,
    readyPack: agg.filter((r) => r.stage === "ready_pack").length,
    toHandover: agg.filter((r) => r.stage === "packed" || r.stage === "handover").length,
    pushFailed: agg.filter((r) => r.push_state === "push_failed" || r.push_state === "dead").length,
  }), [agg]);

  const copy = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(tt("shp.copied"));
    } catch {
      toast.error(tt("shp.err.copyFail"));
    }
  };

  const reload = () => { void loadAgg(); void loadList(); };

  // 推单：走 EF 的 action=push，逐单结果分 ok / dup（幂等命中，正常） / 失败 三类
  const runPush = async (ids: string[]) => {
    const list = ids.filter(Boolean);
    if (list.length === 0) { toast.error(tt("shp.push.err.noSelection")); return; }
    setPushBusy(list.length > 1 ? "batch" : list[0]);
    try {
      const data = await callForwarderPush<PushRowResult[]>({ action: "push", shipment_ids: list });
      const results = Array.isArray(data) ? data : [];
      setPushOutcome({ ids: list, results, raw: "" });
      if (results.length === 0) {
        // 后端没给逐单结果：不能当成成功，原样提示
        toast.error(tt("shp.push.err.emptyResult"));
      } else {
        const okRows = results.filter((x) => x.ok === true && x.dup !== true);
        const dupRows = results.filter((x) => x.dup === true);
        const badRows = results.filter((x) => x.ok !== true && x.dup !== true);
        if (okRows.length > 0) toast.success(tt("shp.push.toast.ok", { n: okRows.length }));
        // dup=true 是 24h 幂等窗口命中：正常结果，不写失败语气
        if (dupRows.length > 0) toast.message(tt("shp.push.toast.dup", { n: dupRows.length }));
        if (badRows.length > 0) {
          const first = badRows[0];
          toast.error(errText(first?.error_code ?? "", first?.error_message ?? "", codes));
        }
      }
      setSelected((prev) => prev.filter((id) => !list.includes(id)));
      reload();
    } catch (e) {
      const m = e instanceof Error ? e.message : tt("shp.push.err.fail");
      setPushOutcome({ ids: list, results: [], raw: m });
      toast.error(m); // EF 未部署 / 网络失败：原始错误直接上屏，不假装已推单
    } finally {
      setPushBusy("");
    }
  };

  // 当前页全选（选中集跨页保留，因此只增删本页）
  const pageIds = useMemo(() => rows.map((r) => r.shipment_id).filter(Boolean), [rows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const toggleAllOnPage = () => {
    setSelected((prev) => (allPageSelected
      ? prev.filter((id) => !pageIds.includes(id))
      : Array.from(new Set([...prev, ...pageIds]))));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-5">
      <PageHeader
        code="SHIPMENT FULFILMENT"
        title={tt("shp.board.title")}
        description={tt("shp.board.desc")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* 1) 下单→生成货件：真调 EF action=create_from_orders */}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={15} className="mr-1.5" />{tt("shp.create.title")}
            </Button>
            {/* 2) 批量推单：真调 EF action=push（未勾选时禁用，不给假按钮） */}
            <Button
              size="sm" variant="outline"
              disabled={pushBusy !== "" || selected.length === 0}
              title={selected.length === 0 ? tt("shp.push.batchNeedSel") : tt("shp.push.batchTitle")}
              onClick={() => void runPush(selected)}
            >
              {pushBusy === "batch"
                ? <Loader2 size={15} className="mr-1.5 animate-spin" />
                : <Send size={15} className="mr-1.5" />}
              {tt("shp.push.batch")}
              {selected.length > 0 && <span className="ml-1 font-data tabular-nums">({selected.length})</span>}
            </Button>
            <Button size="sm" variant="outline" onClick={reload} disabled={loading || listLoading}>
              <RefreshCw size={15} className={cn("mr-1.5", (loading || listLoading) && "animate-spin")} />{tt("common.refresh")}
            </Button>
          </div>
        }
      />

      {/* 真实统计卡（来自 v_shipment_progress 查询结果聚合） */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={tt("shp.stat.inboundToday")} value={String(stats.inboundToday)} icon={<Truck size={17} />} tone="blue" footer={<p className="mt-1 text-[11px] text-fg-subtle">{tt("shp.stat.inboundTodayHint")}</p>} />
        <StatCard label={tt("shp.stat.readyPack")} value={String(stats.readyPack)} icon={<Boxes size={17} />} tone="success" footer={<p className="mt-1 text-[11px] text-fg-subtle">{tt("shp.stat.readyPackHint")}</p>} />
        <StatCard label={tt("shp.stat.toHandover")} value={String(stats.toHandover)} icon={<PackageSearch size={17} />} tone="warning" footer={<p className="mt-1 text-[11px] text-fg-subtle">{tt("shp.stat.toHandoverHint")}</p>} />
        <StatCard label={tt("shp.stat.pushFailed")} value={String(stats.pushFailed)} icon={<AlertTriangle size={17} />} tone="danger" footer={<p className="mt-1 text-[11px] text-fg-subtle">{tt("shp.stat.pushFailedHint")}</p>} />
      </div>

      {/* 数据库错误原文（不吞异常，不前端放行） */}
      {error && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/40 bg-danger-bg px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-destructive"><AlertTriangle size={14} />{tt("shp.err.dbTitle")}</p>
            <p className="mt-0.5 break-words font-mono text-[12px] text-destructive/90">{error}</p>
          </div>
          <Button size="sm" variant="outline" onClick={reload}>{tt("shp.err.retry")}</Button>
        </div>
      )}

      {/* stage 横向流水线（点击即数据库按 stage 过滤） */}
      <div className="rounded-2xl border border-border bg-card px-3 py-3">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => setStageTab("all")}
            className={cn(
              "shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              stageTab === "all" ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-fg-muted hover:bg-surface-hover",
            )}
          >
            {tt("shp.stage.all")} <span className="ml-1 font-data tabular-nums">{agg.length}</span>
          </button>
          {STAGES.map((s, i) => (
            <div key={s} className="flex shrink-0 items-center gap-1.5">
              {i > 0 && <ArrowRight size={12} className="text-fg-subtle" />}
              <button
                type="button"
                onClick={() => setStageTab(s)}
                title={tt("shp.stage.filterHint")}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  stageTab === s ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-card text-fg-muted hover:bg-surface-hover",
                )}
              >
                <span className="mr-1 font-data text-[10px] text-fg-subtle">{i + 1}</span>
                {tk(`shp.stage.${s}`)}
                <span className="ml-1 font-data tabular-nums">{stageCounts[s]}</span>
              </button>
            </div>
          ))}
        </div>
        {aggCapped && (
          <p className="mt-2 text-[11px] text-warning">{tt("shp.agg.capped", { n: AGG_WINDOW })}</p>
        )}
      </div>

      {/* 次级筛选：全部条件下推到数据库（stage / push_state / doc_status / 关键字 ilike） */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={searchCol}
          onChange={(e) => setSearchCol(e.target.value as SearchCol)}
          title={tt("shp.searchCol.hint")}
          className="h-8 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {SEARCH_COLS.map((c) => <option key={c} value={c}>{tk(`shp.searchCol.${c}`)}</option>)}
        </select>
        <SearchField value={keyword} onChange={setKeyword} placeholder={tt("shp.searchPh")} width="w-72" />
        <select
          value={pushFilter}
          onChange={(e) => setPushFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">{tt("shp.col.pushState")}: {tt("shp.filter.all")}</option>
          {PUSH_STATES.map((p) => <option key={p} value={p}>{tk(`shp.push.${p}`)}</option>)}
        </select>
        <select
          value={docFilter}
          onChange={(e) => setDocFilter(e.target.value)}
          className="h-8 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">{tt("shp.col.docStatus")}: {tt("shp.filter.all")}</option>
          {DOC_STATUSES.map((d) => <option key={d} value={d}>{tk(`shp.doc.${d}`)}</option>)}
        </select>
        <span className="ml-auto text-xs text-fg-muted" title={tt("shp.count.hint")}>
          {tt("shp.count", { count: total ?? rows.length })}
        </span>
      </div>

      {/* 推单逐单结果：ok / dup（幂等命中，正常） / 失败 三类分列，失败带 code + 字典原文 */}
      {pushOutcome && (
        <PushResultPanel
          outcome={pushOutcome}
          rows={rows}
          codes={codes}
          codesError={codesError}
          onClose={() => setPushOutcome(null)}
        />
      )}

      {/* 列表：四态各占一列，绝不合并 */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="w-9 px-3 py-3">
                  <input
                    type="checkbox"
                    aria-label={tt("shp.push.selectAllHint")}
                    title={tt("shp.push.selectAllHint")}
                    checked={allPageSelected}
                    onChange={toggleAllOnPage}
                    disabled={listLoading || pageIds.length === 0}
                    className="h-4 w-4 cursor-pointer"
                  />
                </th>
                <th className="px-3 py-3 font-medium">{tt("shp.col.shipment")}</th>
                <th className="px-3 py-3 font-medium">{tt("shp.col.pushState")}</th>
                <th className="px-3 py-3 font-medium">{tt("shp.col.stage")}</th>
                <th className="px-3 py-3 font-medium">{tt("shp.col.docStatus")}</th>
                <th className="px-3 py-3 font-medium">{tt("shp.col.callback")}</th>
                <th className="px-3 py-3 font-medium">{tt("shp.col.parcels")}</th>
                <th className="px-3 py-3 font-medium">{tt("shp.col.amount")}</th>
                <th className="px-3 py-3 text-right font-medium">{tt("common.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr><td colSpan={9} className="px-4 py-14 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt("common.loading")}</td></tr>
              ) : (total ?? rows.length) === 0 ? (
                <tr><td colSpan={9}>
                  <EmptyState
                    text={agg.length === 0 ? tt("shp.empty.title") : tt("shp.empty.filtered")}
                    hint={agg.length === 0 ? tt("shp.empty.nextStep") : tt("shp.empty.filterHint")}
                    action={agg.length === 0 ? (
                      <div className="flex justify-center gap-2">
                        <Button size="sm" onClick={() => setCreateOpen(true)}>
                          <Plus size={14} className="mr-1.5" />{tt("shp.create.title")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={reload}><RefreshCw size={14} className="mr-1.5" />{tt("shp.empty.reload")}</Button>
                      </div>
                    ) : undefined}
                  />
                </td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.shipment_id} className={cn(
                    "border-b border-border align-top transition-colors last:border-0 hover:bg-muted/50",
                    // dead=重试耗尽：整行给醒目底色，不会再自动重试，必须人工处理
                    r.push_state === "dead" && "bg-danger-bg",
                  )}>
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={tt("shp.push.selectRow")}
                        title={tt("shp.push.selectRow")}
                        checked={selected.includes(r.shipment_id)}
                        onChange={() => toggleOne(r.shipment_id)}
                        className="mt-0.5 h-4 w-4 cursor-pointer"
                      />
                    </td>
                    <td className="px-3 py-3">
                      <button type="button" className="text-left" onClick={() => setDetail(r)}>
                        <div className="font-medium text-ink hover:text-primary">{r.order_id || r.platform_order_no || r.shipment_id}</div>
                      </button>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {tk(r.forwarder_name) || "—"} · {tk(r.warehouse_name) || "—"} · {tk(r.channel_name) || "—"}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {r.batch_no ? (
                          <button type="button" onClick={() => copy(r.batch_no)} title={tt("shp.tip.batchNo")}
                            className="inline-flex max-w-[190px] items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted hover:text-primary">
                            <Copy size={10} className="shrink-0" /><span className="truncate">{r.batch_no}</span>
                          </button>
                        ) : <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10.5px]">{tt("shp.noBatchNo")}</span>}
                        <span title={tt("shp.tip.applyCount")} className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10.5px]">{tt("shp.applyCount", { count: r.apply_count ?? 0 })}</span>
                        {r.tracking_no && (
                          <button type="button" onClick={() => copy(r.tracking_no)} title={tt("shp.tip.trackingNo")}
                            className="inline-flex items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[10.5px] text-fg-muted hover:text-primary">
                            <Copy size={10} />{r.tracking_no}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 态 1：推单 */}
                    <td className="px-3 py-3">
                      <Badge variant={PUSH_TONE[r.push_state] ?? "muted"}>{tk(`shp.push.${r.push_state}`)}</Badge>
                      <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                        <div>{tt("shp.label.pushedAt")}: {fmtTime(r.pushed_at)}</div>
                        <div>{tt("shp.label.attempt", { count: r.push_attempt ?? 0 })}</div>
                        {/* pending / pushing / dead 的语义直接写在这一列，不再只有一个标签 */}
                        {PUSH_SEMANTIC[r.push_state] && (
                          <div
                            className={cn(
                              "max-w-[190px] break-words rounded-md border px-1.5 py-1 leading-snug",
                              r.push_state === "dead"
                                ? "border-destructive/50 bg-card font-medium text-destructive"
                                : "border-border bg-surface-sunken text-fg-muted",
                            )}
                          >
                            {tk(PUSH_SEMANTIC[r.push_state])}
                          </div>
                        )}
                        {(r.push_state === "push_failed" || r.push_state === "dead") && (r.apply_failed_code || r.apply_failed_reason) && (
                          <div className="max-w-[190px] break-words text-destructive" title={`${r.apply_failed_code} ${r.apply_failed_reason}`}>
                            {errText(r.apply_failed_code, r.apply_failed_reason, codes)}
                          </div>
                        )}
                        {r.push_state === "dead" && (
                          <button
                            type="button"
                            onClick={() => setLogsFor(r)}
                            className="mt-0.5 inline-flex items-center gap-1 rounded-md border border-destructive/50 bg-card px-1.5 py-1 text-[10.5px] font-medium text-destructive hover:bg-danger-bg"
                          >
                            <AlertTriangle size={10} />{tt("shp.push.viewLogsDead")}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 态 2：仓内作业 */}
                    <td className="px-3 py-3">
                      <Badge variant={STAGE_TONE[r.stage] ?? "outline"}>
                        <span className="font-data text-[10px] opacity-70">{STAGES.indexOf(r.stage as (typeof STAGES)[number]) + 1}/{STAGES.length}</span>
                        {tk(`shp.stage.${r.stage}`)}
                      </Badge>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        <div>{tt("shp.label.labelState")}: <Badge variant={LABEL_TONE[r.label_state] ?? "muted"} className="px-1.5 py-0 text-[10.5px]">{tk(`shp.labelState.${r.label_state}`)}</Badge></div>
                        <div className="mt-0.5" title={tt("shp.tip.labelSource")}>
                          {tt("shp.label.labelSource")}: {r.label_source ? tk(`shp.labelSource.${r.label_source}`) : "—"}
                        </div>
                      </div>
                    </td>

                    {/* 态 3：单据有效性 */}
                    <td className="px-3 py-3">
                      <Badge variant={DOC_TONE[r.doc_status] ?? "muted"}>{tk(`shp.doc.${r.doc_status}`)}</Badge>
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground" title={tt("shp.tip.intercept")}>
                        <ShieldAlert size={11} className={r.intercept_state === "none" ? "opacity-40" : "text-warning"} />
                        {tt("shp.label.intercept")}: {tk(`shp.intercept.${r.intercept_state}`)}
                      </div>
                    </td>

                    {/* 态 4：回传状态（norm + raw 原始值可见） */}
                    <td className="px-3 py-3">
                      <Badge variant={NORM_TONE[r.norm_status] ?? "muted"}>{tk(`shp.norm.${r.norm_status}`)}</Badge>
                      <div className="mt-1 max-w-[170px] truncate font-mono text-[10.5px] text-fg-subtle" title={`${tt("shp.tip.rawStatus")}: ${r.raw_status || "—"}`}>
                        raw: {r.raw_status || "—"}
                      </div>
                    </td>

                    <td className="px-3 py-3 text-[12px]">
                      <div className="text-fg-muted">{tt("shp.signedOf", { signed: r.parcel_signed, total: r.parcel_total })}</div>
                      <button type="button" onClick={() => setDetail(r)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                        <ClipboardList size={11} />
                        {tt("shp.workOrders.count", { count: r.open_work_orders })}
                      </button>
                    </td>

                    <td className="px-3 py-3 text-[12px] text-fg-muted">
                      <div>{tt("shp.label.estimated")}: {money(r.estimated_amount, r.fee_currency)}</div>
                      <div>{tt("shp.label.actual")}: {money(r.actual_amount, r.fee_currency)}</div>
                    </td>

                    <td className="px-3 py-3 text-right">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDetail(r)}>
                          {tt("shp.action.open")}
                        </Button>
                        {/* 行内推单：真调 EF；EF 未部署时按钮仍可点，失败原样报错（不做假禁用） */}
                        <Button
                          size="sm" className="h-7 text-xs"
                          disabled={pushBusy !== ""}
                          onClick={() => void runPush([r.shipment_id])}
                        >
                          {pushBusy === r.shipment_id
                            ? <Loader2 size={12} className="mr-1 animate-spin" />
                            : <Send size={12} className="mr-1" />}
                          {tt("shp.push.run")}
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 text-xs"
                          title={tt("shp.push.logsTitle")}
                          onClick={() => setLogsFor(r)}
                        >
                          <History size={12} className="mr-1" />{tt("shp.push.logs")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {(total ?? rows.length) > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-xs text-fg-muted">
            <span title={tt("shp.page.serverHint")}>{tt("shp.page.info", { page, total: totalPages, count: total ?? rows.length })}</span>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page <= 1 || listLoading} onClick={() => setPage((p) => p - 1)}>{tt("shp.page.prev")}</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={page >= totalPages || listLoading} onClick={() => setPage((p) => p + 1)}>{tt("shp.page.next")}</Button>
            </div>
          </div>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-[12px] text-fg-muted">
          <Send size={13} className="text-primary" />
          <span>{tt("shp.push.selected", { count: selected.length })}</span>
          <span className="text-fg-subtle">{tt("shp.push.selectedScope")}</span>
          <button type="button" onClick={() => setSelected([])} className="ml-auto text-[11.5px] text-primary hover:underline">
            {tt("shp.push.clear")}
          </button>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-fg-subtle">{tt("shp.wo.semantic")}</p>

      {detail && (
        <ShipmentDetailDialog
          key={detail.shipment_id}
          row={detail}
          transitions={transitions}
          onClose={() => setDetail(null)}
          onChanged={reload}
        />
      )}

      {createOpen && (
        <CreateShipmentDialog
          onClose={() => setCreateOpen(false)}
          onChanged={reload}
        />
      )}

      {logsFor && (
        <PushLogsSheet
          key={logsFor.shipment_id}
          shipment={logsFor}
          codes={codes}
          onClose={() => setLogsFor(null)}
        />
      )}
    </div>
  );
}

/* ============================= 货件详情 / 推进 / 工单 ============================= */

function ShipmentDetailDialog({
  row, transitions, onClose, onChanged,
}: {
  row: Shipment;
  transitions: Transition[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const legal = useMemo(() => transitions.filter((x) => x.from === row.stage), [transitions, row.stage]);
  const [toStage, setToStage] = useState<string>(legal[0]?.to ?? "");
  const [operator, setOperator] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [checks, setChecks] = useState<GateCheck[]>([]);
  const [precheckOf, setPrecheckOf] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [wos, setWos] = useState<ExtRow[]>([]);
  const [woLoading, setWoLoading] = useState(true);
  const [woError, setWoError] = useState<string>("");
  const [woForm, setWoForm] = useState({ type: "other", priority: "normal", assignee_type: "forwarder", title: "", description: "", due_at: "" });
  const [woSaving, setWoSaving] = useState(false);

  const [interceptReason, setInterceptReason] = useState("");
  const [interceptResult, setInterceptResult] = useState<{ ok: boolean; message: string; action: string } | null>(null);

  const loadWorkOrders = useCallback(() => {
    setWoLoading(true);
    setWoError("");
    fetchTable("work_orders", { field: "shipment_id", value: row.shipment_id })
      .then(setWos)
      .catch((e) => { const m = e instanceof Error ? e.message : tt("shp.err.loadWoFail"); setWoError(m); toast.error(m); })
      .finally(() => setWoLoading(false));
  }, [row.shipment_id]);

  useEffect(() => { loadWorkOrders(); }, [loadWorkOrders]);

  // 审计要求：p_operator 记录真实操作人，默认预填当前登录邮箱（可改），取不到再退回 user id
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!alive) return;
        const who = data.session?.user?.email || data.session?.user?.id || "";
        if (who) setOperator((prev) => prev || who);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const chosen = legal.find((x) => x.to === toStage);

  // 阶段转移表是异步加载的：到达后补一次默认目标阶段，避免下拉框空选
  useEffect(() => {
    if (!toStage && legal.length > 0) setToStage(legal[0].to);
  }, [legal, toStage]);

  /* 推进：必须先过 shipment_can_advance 预检，门禁不过绝不放行 */
  const runPrecheck = async (silent = false): Promise<GateCheck[]> => {
    if (!toStage) { if (!silent) toast.error(tt("shp.err.pickStage")); return []; }
    try {
      const res = await callRpc<GateRow | GateRow[]>("shipment_can_advance", {
        p_shipment_id: row.shipment_id, p_to_stage: toStage,
      });
      // 现网契约（zz_20261117_fw02b_gate_return_fix.sql 之后）：任何输入只返回一行。
      // 因此以首行为准：rows[0].allowed === true 才允许推进；reason 原文直接展示，前端不自造文案。
      const list = (Array.isArray(res) ? res : [res]).filter(Boolean)
        .map((x) => ({ allowed: x.allowed === true, reason: x.reason ?? "", gate: x.gate ?? "" }));
      setChecks(list);
      setPrecheckOf(toStage);
      if (!silent && list[0]?.allowed !== true) toast.error(list[0]?.reason || tt("shp.precheck.blocked"));
      return list;
    } catch (e) {
      const m = e instanceof Error ? e.message : tt("shp.err.precheckFail");
      setChecks([{ allowed: false, reason: m, gate: "" }]);
      setPrecheckOf(toStage);
      toast.error(m); // 数据库/服务原文，不吞
      return [];
    }
  };

  const advance = async () => {
    if (!toStage) { toast.error(tt("shp.err.pickStage")); return; }
    setBusy(true);
    try {
      const list = await runPrecheck(true);
      if (list.length === 0 || list[0].allowed !== true) {
        setBusy(false);
        return; // 门禁未过：不调用 shipment_advance，前端不放行
      }
      const res = await callRpc<ResultRow | ResultRow[]>("shipment_advance", {
        p_shipment_id: row.shipment_id, p_to_stage: toStage,
        p_operator: operator.trim() || "erp", // 输入框已预填登录账号，正常不会落到兜底值
        p_note: note.trim() || null,
      });
      const r = (Array.isArray(res) ? res[0] : res);
      if (!r?.ok) {
        toast.error(r?.message || tt("shp.err.advanceRejected")); // 数据库拒绝原文
        return;
      }
      toast.success(tt("shp.advanced", { stage: tk(`shp.stage.${r.new_stage ?? toStage}`) }));
      setNote("");
      onChanged();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("shp.err.advanceFail")); // 原文透出
    } finally {
      setBusy(false);
    }
  };

  const requestIntercept = async () => {
    if (!interceptReason.trim()) { toast.error(tt("shp.err.pickInterceptReason")); return; }
    setBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const res = await callRpc<ResultRow | ResultRow[]>("shipment_request_intercept", {
        p_shipment_id: row.shipment_id, p_reason: interceptReason.trim(), p_by: data.session?.user?.id ?? null,
      });
      const r = (Array.isArray(res) ? res[0] : res);
      setInterceptResult({ ok: !!r?.ok, message: r?.message ?? "", action: r?.action ?? "" });
      if (!r?.ok) toast.error(r?.message || tt("shp.err.interceptFail"));
      else if (r.action === "work_order") toast.warning(r.message || tt("shp.intercept.toWo"));
      else toast.success(r.message || tt("shp.intercept.ok"));
      loadWorkOrders();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("shp.err.interceptFail"));
    } finally {
      setBusy(false);
    }
  };

  const createWorkOrder = async () => {
    if (!woForm.title.trim()) { toast.error(tt("shp.err.woTitle")); return; }
    setWoSaving(true);
    try {
      const { data } = await supabase.auth.getSession();
      await insertRow("work_orders", {
        shipment_id: row.shipment_id,
        order_id: row.order_id || null,
        type: woForm.type,
        stage_when_detected: row.stage, // 异常被发现时所处阶段（决定能否回退），不改动货件 stage
        title: woForm.title.trim(),
        description: woForm.description.trim() || null,
        priority: woForm.priority,
        assignee_type: woForm.assignee_type,
        status: "pending",
        due_at: woForm.due_at ? new Date(woForm.due_at).toISOString() : null,
        created_by: data.session?.user?.id ?? null,
      });
      toast.success(tt("shp.wo.created"));
      setWoForm({ ...woForm, title: "", description: "" });
      loadWorkOrders();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("shp.err.woCreateFail"));
    } finally {
      setWoSaving(false);
    }
  };

  const stepIndex = STAGES.indexOf(row.stage as (typeof STAGES)[number]);
  const shownChecks = precheckOf === toStage ? checks : [];
  const blockedChecks = shownChecks.filter((x) => !x.allowed);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {tt("shp.detail.title")}
            <span className="font-mono text-[13px] text-fg-muted">{row.order_id || row.platform_order_no || row.shipment_id}</span>
          </DialogTitle>
          <DialogDescription>{tk(row.forwarder_name) || "—"} · {tk(row.warehouse_name) || "—"} · {tk(row.channel_name) || "—"}</DialogDescription>
        </DialogHeader>

        {/* 四态分离：四块独立信息，永不合并 */}
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-sunken/40 p-3 lg:grid-cols-4">
          <StateBox title={tt("shp.col.pushState")} badge={<Badge variant={PUSH_TONE[row.push_state] ?? "muted"}>{tk(`shp.push.${row.push_state}`)}</Badge>}
            lines={[`${tt("shp.label.pushedAt")}: ${fmtTime(row.pushed_at)}`, tt("shp.label.attempt", { count: row.push_attempt ?? 0 }), `${tt("shp.applyCount", { count: row.apply_count ?? 0 })}`]} />
          <StateBox title={tt("shp.col.stage")} badge={<Badge variant={STAGE_TONE[row.stage] ?? "outline"}>{tk(`shp.stage.${row.stage}`)}</Badge>}
            lines={[`${tt("shp.label.receivedAt")}: ${fmtTime(row.received_at)}`, `${tt("shp.label.packedAt")}: ${fmtTime(row.packed_at)}`, `${tt("shp.label.handoverAt")}: ${fmtTime(row.handover_at)}`]} />
          <StateBox title={tt("shp.col.docStatus")} badge={<Badge variant={DOC_TONE[row.doc_status] ?? "muted"}>{tk(`shp.doc.${row.doc_status}`)}</Badge>}
            lines={[`${tt("shp.label.intercept")}: ${tk(`shp.intercept.${row.intercept_state}`)}`, `${tt("shp.label.closedAt")}: ${fmtTime(row.closed_at)}`]} />
          <StateBox title={tt("shp.col.callback")} badge={<Badge variant={NORM_TONE[row.norm_status] ?? "muted"}>{tk(`shp.norm.${row.norm_status}`)}</Badge>}
            lines={[`raw: ${row.raw_status || "—"}`, `${tt("shp.label.labelState")}: ${tk(`shp.labelState.${row.label_state}`)}`, `${tt("shp.label.labelSource")}: ${row.label_source ? tk(`shp.labelSource.${row.label_source}`) : "—"}`]} />
        </div>

        {/* 仓内流水线进度 */}
        <div className="mt-4 overflow-x-auto">
          <div className="flex min-w-[720px] items-center gap-1">
            {STAGES.map((s, i) => (
              <div key={s} className="flex flex-1 items-center gap-1">
                <div className={cn(
                  "flex-1 rounded-md border px-2 py-1.5 text-center text-[11px]",
                  i < stepIndex && "border-success/40 bg-success-bg text-success",
                  i === stepIndex && "border-primary bg-primary/10 font-medium text-primary",
                  i > stepIndex && "border-border bg-card text-fg-subtle",
                )}>
                  {tk(`shp.stage.${s}`)}
                </div>
                {i < STAGES.length - 1 && <ArrowRight size={11} className="shrink-0 text-fg-subtle" />}
              </div>
            ))}
          </div>
        </div>

        {/* 推进（真调 RPC，先预检） */}
        <div className="mt-4 rounded-xl border border-border p-4">
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink"><ArrowRight size={14} />{tt("shp.advance.title")}</h4>
          <p className="mb-3 text-[11.5px] text-fg-muted">{tt("shp.advance.desc")}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label>{tt("shp.advance.target")}</Label>
              <select value={toStage} onChange={(e) => { setToStage(e.target.value); setChecks([]); setPrecheckOf(""); }}
                className="h-8 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring">
                {legal.length === 0 && <option value="">{tt("shp.advance.noTransition")}</option>}
                {legal.map((x) => (
                  <option key={x.to} value={x.to}>
                    {tk(`shp.stage.${x.to}`)}{x.gate ? ` · ${tt("shp.advance.gatePrefix")}${tk(GATE_KEY[x.gate] ?? "") || tk(x.gate)}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("shp.advance.operator")}</Label>
              <Input value={operator} onChange={(e) => setOperator(e.target.value)} placeholder={tt("shp.advance.operatorPh")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tt("shp.advance.note")}</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tt("shp.advance.notePh")} />
            </div>
          </div>

          {chosen?.note && (
            <p className="mt-2 text-[11.5px] text-fg-muted">{tt("shp.advance.transitionNote")}: {tk(chosen.note)}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy || !toStage} onClick={() => void runPrecheck()}>
              {tt("shp.advance.precheck")}
            </Button>
            <Button size="sm" disabled={busy || !toStage} onClick={() => void advance()}>
              {busy && <Loader2 size={13} className="mr-1 animate-spin" />}{tt("shp.advance.run")}
            </Button>
          </div>

          {shownChecks.length > 0 && (
            <div className={cn("mt-3 rounded-lg border px-3 py-2.5 text-[12px]", blockedChecks.length ? "border-destructive/40 bg-danger-bg" : "border-success/40 bg-success-bg")}>
              <p className={cn("mb-1 font-medium", blockedChecks.length ? "text-destructive" : "text-success")}>
                {blockedChecks.length ? tt("shp.precheck.blockedTitle") : tt("shp.precheck.passedTitle")}
              </p>
              <ul className="space-y-1">
                {shownChecks.map((c, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-1.5">
                    <span className={cn("inline-block h-1.5 w-1.5 rounded-full", c.allowed ? "bg-success" : "bg-destructive")} />
                    {c.gate ? <span className="rounded bg-card px-1.5 py-0.5 text-[10.5px] text-fg-muted">{tk(GATE_KEY[c.gate] ?? "") || c.gate}</span> : null}
                    <span className={c.allowed ? "text-success" : "text-destructive"}>{c.allowed ? tt("shp.precheck.ok") : (c.reason || tt("shp.precheck.noReason"))}</span>
                  </li>
                ))}
              </ul>
              {blockedChecks.length > 0 && <p className="mt-1.5 text-[11px] text-fg-muted">{tt("shp.precheck.blockedDesc")}</p>}
            </div>
          )}
        </div>

        {/* 拦截请求（真调 RPC；已出库由数据库自动转理赔工单） */}
        <div className="mt-4 rounded-xl border border-border p-4">
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink"><ShieldAlert size={14} />{tt("shp.intercept.title")}</h4>
          <p className="mb-2 text-[11.5px] text-fg-muted">{tt("shp.intercept.desc")} {tt("shp.intercept.curState")}: {tk(`shp.intercept.${row.intercept_state}`)}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid min-w-[260px] flex-1 gap-1.5">
              <Label>{tt("shp.intercept.reason")}</Label>
              <Input value={interceptReason} onChange={(e) => setInterceptReason(e.target.value)} placeholder={tt("shp.intercept.reasonPh")} />
            </div>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void requestIntercept()}>{tt("shp.intercept.run")}</Button>
          </div>
          {interceptResult && (
            <p className={cn("mt-2 text-[12px]", interceptResult.ok ? "text-success" : "text-destructive")}>
              {tt("shp.intercept.reply")}: {interceptResult.message}
              {interceptResult.action ? ` (${interceptResult.action === "work_order" ? tt("shp.intercept.toWo") : tt("shp.intercept.toIntercept")})` : ""}
            </p>
          )}
        </div>

        {/* 异常工单：只登记，不改货件 stage / 订单状态 */}
        <div className="mt-4 rounded-xl border border-border p-4">
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-ink"><ClipboardList size={14} />{tt("shp.wo.title")}</h4>
          <p className="mb-3 text-[11.5px] text-fg-muted">{tt("shp.wo.semantic")}</p>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[11px] text-muted-foreground">
                  <th className="px-2.5 py-2 font-medium">{tt("shp.wo.col.type")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.wo.col.priority")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.wo.col.status")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.wo.col.stageWhen")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.wo.col.title")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.wo.col.assignee")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.wo.col.created")}</th>
                </tr>
              </thead>
              <tbody>
                {woLoading ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground"><Loader2 size={15} className="mx-auto mb-1 animate-spin" />{tt("common.loading")}</td></tr>
                ) : woError ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-destructive">{woError}</td></tr>
                ) : wos.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{tt("shp.wo.empty")}</td></tr>
                ) : wos.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className="px-2.5 py-2">{tk(`shp.woType.${st(w, "type")}`)}</td>
                    <td className="px-2.5 py-2"><Badge variant={WO_PRIORITY_TONE[st(w, "priority")] ?? "muted"}>{tk(`shp.woPriority.${st(w, "priority")}`)}</Badge></td>
                    <td className="px-2.5 py-2"><Badge variant={WO_STATUS_TONE[st(w, "status")] ?? "muted"}>{tk(`shp.woStatus.${st(w, "status")}`)}</Badge></td>
                    <td className="px-2.5 py-2 text-muted-foreground">{st(w, "stage_when_detected") ? tk(`shp.stage.${st(w, "stage_when_detected")}`) : "—"}</td>
                    <td className="px-2.5 py-2 text-ink">{tk(st(w, "title"))}</td>
                    <td className="px-2.5 py-2 text-muted-foreground">{tk(`shp.woAssignee.${st(w, "assignee_type")}`)}</td>
                    <td className="px-2.5 py-2 text-muted-foreground">{fmtTime(w.created_at ? String(w.created_at) : null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <div className="grid gap-1"><Label className="text-[11.5px]">{tt("shp.wo.f.type")}</Label>
              <select className="h-8 rounded-md border border-input bg-transparent px-2 text-[12.5px]" value={woForm.type} onChange={(e) => setWoForm({ ...woForm, type: e.target.value })}>
                {WO_TYPES.map((x) => <option key={x} value={x}>{tk(`shp.woType.${x}`)}</option>)}
              </select>
            </div>
            <div className="grid gap-1"><Label className="text-[11.5px]">{tt("shp.wo.f.priority")}</Label>
              <select className="h-8 rounded-md border border-input bg-transparent px-2 text-[12.5px]" value={woForm.priority} onChange={(e) => setWoForm({ ...woForm, priority: e.target.value })}>
                {WO_PRIORITIES.map((x) => <option key={x} value={x}>{tk(`shp.woPriority.${x}`)}</option>)}
              </select>
            </div>
            <div className="grid gap-1"><Label className="text-[11.5px]">{tt("shp.wo.f.assignee")}</Label>
              <select className="h-8 rounded-md border border-input bg-transparent px-2 text-[12.5px]" value={woForm.assignee_type} onChange={(e) => setWoForm({ ...woForm, assignee_type: e.target.value })}>
                {WO_ASSIGNEES.map((x) => <option key={x} value={x}>{tk(`shp.woAssignee.${x}`)}</option>)}
              </select>
            </div>
            <div className="grid gap-1 sm:col-span-2"><Label className="text-[11.5px]">{tt("shp.wo.f.title")}<span className="text-destructive"> *</span></Label>
              <Input value={woForm.title} onChange={(e) => setWoForm({ ...woForm, title: e.target.value })} placeholder={tt("shp.wo.f.titlePh")} />
            </div>
            <div className="grid gap-1"><Label className="text-[11.5px]">{tt("shp.wo.f.dueAt")}</Label>
              <Input type="date" value={woForm.due_at} onChange={(e) => setWoForm({ ...woForm, due_at: e.target.value })} />
            </div>
            <div className="grid gap-1 lg:col-span-3"><Label className="text-[11.5px]">{tt("shp.wo.f.desc")}</Label>
              <Textarea rows={2} value={woForm.description} onChange={(e) => setWoForm({ ...woForm, description: e.target.value })} placeholder={tt("shp.wo.f.descPh")} />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] text-fg-subtle">{tt("shp.wo.detectedAt", { stage: tk(`shp.stage.${row.stage}`) })}</p>
            <Button size="sm" disabled={woSaving} onClick={() => void createWorkOrder()}>
              {woSaving && <Loader2 size={13} className="mr-1 animate-spin" />}{tt("shp.wo.create")}
            </Button>
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose}>{tt("common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StateBox({ title, badge, lines }: { title: string; badge: ReactNode; lines: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-2">
      <p className="text-[10.5px] uppercase tracking-wide text-fg-subtle">{title}</p>
      <div className="mt-1">{badge}</div>
      <div className="mt-1 space-y-0.5 text-[11px] text-fg-muted">
        {lines.map((l, i) => <div key={i} className="truncate" title={l}>{l}</div>)}
      </div>
    </div>
  );
}

/* ============================= M2 · 从订单生成货件（EF action=create_from_orders） ============================= */

// 件数：orders.items 是 jsonb 数组 [{sku,name,qty}]，只做求和（分页/筛选一律在数据库）
function itemQty(r: ExtRow): number {
  const items = r.items;
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, it) => sum + (Number((it as { qty?: unknown })?.qty) || 0), 0);
}

function CreateShipmentDialog({ onClose, onChanged }: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [forwarders, setForwarders] = useState<ExtRow[]>([]);
  const [fwdState, setFwdState] = useState<"loading" | "ready" | "error">("loading");
  const [fwdError, setFwdError] = useState("");
  const [forwarderId, setForwarderId] = useState("");

  const [warehouses, setWarehouses] = useState<ExtRow[]>([]);
  const [whState, setWhState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [whError, setWhError] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  const [channels, setChannels] = useState<ExtRow[]>([]);
  const [chState, setChState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [chError, setChError] = useState("");
  const [channelId, setChannelId] = useState("");

  const [orders, setOrders] = useState<ExtRow[]>([]);
  const [orderTotal, setOrderTotal] = useState<number | null>(null);
  const [orderPage, setOrderPage] = useState(1);
  const [orderState, setOrderState] = useState<"loading" | "ready" | "error">("loading");
  const [orderError, setOrderError] = useState("");
  const [orderCol, setOrderCol] = useState<OrderSearchCol>("external_order_id");
  const [orderKw, setOrderKw] = useState("");
  const [orderKwApplied, setOrderKwApplied] = useState("");
  const [picked, setPicked] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateFromOrdersResult | null>(null);
  const [rawError, setRawError] = useState("");

  const fwd = forwarders.find((f) => st(f, "id") === forwarderId);

  // 货代：available_state 域为 available|unavailable|unknown（生产 CHECK 约束实测），
  // 字典序升序正好把"可用"排在最前；is_deleted 软删排除；auth_state 独立显示（授权通过≠当前可用）
  useEffect(() => {
    let alive = true;
    setFwdState("loading");
    queryTable("freight_forwarders", {
      filters: [{ field: "is_deleted", value: false, op: "eq" }],
      order: [{ field: "available_state", ascending: true }, { field: "name", ascending: true }],
      select: "id,name,available_state,auth_state,channel,status,region,code",
      limit: 200,
    })
      .then((res) => {
        if (!alive) return;
        setForwarders(res.rows);
        setFwdState("ready");
        const first = res.rows.find((r) => st(r, "available_state") === "available") ?? res.rows[0];
        if (first && !forwarderId) setForwarderId(st(first, "id"));
      })
      .catch((e) => {
        if (!alive) return;
        setForwarders([]);
        setFwdState("error");
        const m = e instanceof Error ? e.message : tt("shp.create.err.fwdFail");
        setFwdError(m);
        toast.error(m);
      });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 货代仓与渠道都按货代下推过滤（forwarder_id eq），默认仓排前（is_default desc）
  useEffect(() => {
    if (!forwarderId) { setWarehouses([]); setChannels([]); setWhState("idle"); setChState("idle"); return; }
    let alive = true;
    setWarehouseId("");
    setChannelId("");
    setWarehouses([]);
    setChannels([]);
    setWhState("loading");
    setChState("loading");

    queryTable("forwarder_warehouses", {
      filters: [{ field: "forwarder_id", value: forwarderId, op: "eq" }],
      order: [{ field: "is_default", ascending: false }, { field: "name", ascending: true }],
      select: "id,name,code,status,is_default,country,city",
      limit: 200,
    })
      .then((res) => {
        if (!alive) return;
        setWarehouses(res.rows);
        setWhState("ready");
        const def = res.rows.find((r) => r.is_default === true && st(r, "status") === "active") ?? res.rows[0];
        if (def) setWarehouseId(st(def, "id"));
      })
      .catch((e) => {
        if (!alive) return;
        setWhState("error");
        const m = e instanceof Error ? e.message : tt("shp.create.err.whFail");
        setWhError(m);
        toast.error(m);
      });

    // 渠道：logistics_channels 无 status CHECK 约束，因此只按 is_active + 软删 deleted_at is null 过滤
    queryTable("logistics_channels", {
      filters: [
        { field: "forwarder_id", value: forwarderId, op: "eq" },
        { field: "is_active", value: true, op: "eq" },
        { field: "deleted_at", value: null, op: "is" },
      ],
      order: [{ field: "priority", ascending: true }, { field: "name", ascending: true }],
      select: "id,name,code,priority,status,transport_type,label_source_default",
      limit: 200,
    })
      .then((res) => { if (alive) { setChannels(res.rows); setChState("ready"); } })
      .catch((e) => {
        if (!alive) return;
        setChState("error");
        const m = e instanceof Error ? e.message : tt("shp.create.err.chFail");
        setChError(m);
        toast.error(m);
      });

    return () => { alive = false; };
  }, [forwarderId]);

  // 关键字防抖：数据库 ilike，单列（PostgREST 条件之间只能 AND）
  useEffect(() => {
    const t = setTimeout(() => setOrderKwApplied(orderKw.trim()), 400);
    return () => clearTimeout(t);
  }, [orderKw]);

  const ordSig = JSON.stringify([orderKwApplied, orderCol]);
  const [prevOrdSig, setPrevOrdSig] = useState(ordSig);
  if (ordSig !== prevOrdSig) { setPrevOrdSig(ordSig); setOrderPage(1); }

  const ordTotalPages = Math.max(1, Math.ceil((orderTotal ?? orders.length) / ORDER_PAGE_SIZE));
  useEffect(() => { if (orderPage > ordTotalPages) setOrderPage(1); }, [orderPage, ordTotalPages]);

  useEffect(() => {
    let alive = true;
    setOrderState("loading");
    const filters: TableFilter[] = [{ field: "status", value: TO_SHIP_STATUSES, op: "in" }];
    if (orderKwApplied) filters.push({ field: orderCol, value: likePattern(orderKwApplied), op: "ilike" });
    const from = (orderPage - 1) * ORDER_PAGE_SIZE;
    queryTable("orders", {
      filters,
      order: { field: "created_at", ascending: false },
      range: { from, to: from + ORDER_PAGE_SIZE - 1 },
      count: "exact",
      select: "id,external_order_id,buyer,product,sku,amount,currency,status,items,created_at",
    })
      .then((res) => {
        if (!alive) return;
        setOrders(res.rows);
        setOrderTotal(res.count ?? res.rows.length);
        setOrderState("ready");
      })
      .catch((e) => {
        if (!alive) return;
        setOrders([]);
        setOrderTotal(null);
        setOrderState("error");
        const m = e instanceof Error ? e.message : tt("shp.create.err.ordersFail");
        setOrderError(m);
        toast.error(m);
      });
    return () => { alive = false; };
  }, [orderPage, orderKwApplied, orderCol]);

  const ordIds = orders.map((o) => st(o, "id")).filter(Boolean);
  const allOrdPicked = ordIds.length > 0 && ordIds.every((id) => picked.includes(id));
  const toggleAllOrders = () => setPicked((prev) => (allOrdPicked
    ? prev.filter((id) => !ordIds.includes(id))
    : Array.from(new Set([...prev, ...ordIds]))));
  const toggleOrder = (id: string) => setPicked((prev) => (prev.includes(id)
    ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async () => {
    if (!forwarderId) { toast.error(tt("shp.create.err.noForwarder")); return; }
    if (picked.length === 0) { toast.error(tt("shp.create.err.noOrder")); return; }
    setSubmitting(true);
    setRawError("");
    setResult(null);
    try {
      const body: Record<string, unknown> = {
        action: "create_from_orders",
        order_ids: picked,
        forwarder_id: forwarderId,
      };
      if (warehouseId) body.warehouse_id = warehouseId;
      if (channelId) body.channel_id = channelId;
      const data = await callForwarderPush<CreateFromOrdersResult>(body);
      setResult(data ?? {});
      onChanged();
    } catch (e) {
      const m = e instanceof Error ? e.message : tt("shp.create.err.fail");
      setRawError(m);
      toast.error(m); // EF 未部署就是 HTTP 404，原文上屏，不弹"成功 N 条"
    } finally {
      setSubmitting(false);
    }
  };

  const created = result?.created ?? [];
  const skipped = result?.skipped ?? [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !submitting) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tt("shp.create.title")}</DialogTitle>
          <DialogDescription>{tt("shp.create.desc")}</DialogDescription>
        </DialogHeader>

        {/* 三级选择：货代 → 货代仓 → 渠道（后两级都按 forwarder_id 下推过滤，可留空） */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>{tt("shp.create.fwd")}<span className="text-destructive"> *</span></Label>
            {fwdState === "loading" ? (
              <p className="flex items-center gap-1.5 text-[11.5px] text-fg-muted"><Loader2 size={12} className="animate-spin" />{tt("common.loading")}</p>
            ) : fwdState === "error" ? (
              <p className="break-words text-[11.5px] text-destructive">{fwdError}</p>
            ) : forwarders.length === 0 ? (
              <p className="text-[11.5px] text-fg-muted">{tt("shp.create.fwdEmpty")}</p>
            ) : (
              <select
                value={forwarderId}
                onChange={(e) => setForwarderId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {forwarders.map((f) => (
                  <option key={st(f, "id")} value={st(f, "id")}>
                    {tk(st(f, "name"))} · {tk(`shp.available.${st(f, "available_state")}`)} · {tk(`shp.auth.${st(f, "auth_state")}`)}
                  </option>
                ))}
              </select>
            )}
            {fwd && (
              <p className="text-[10.5px] leading-snug text-fg-subtle" title={tt("shp.create.twoStateHint")}>
                {tt("shp.create.fwdAvailable")}: {tk(`shp.available.${st(fwd, "available_state")}`)}
                {" / "}
                {tt("shp.create.fwdAuth")}: {tk(`shp.auth.${st(fwd, "auth_state")}`)}
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>{tt("shp.create.wh")}</Label>
            {!forwarderId ? (
              <p className="text-[11.5px] text-fg-muted">{tt("shp.create.pickFwdFirst")}</p>
            ) : whState === "loading" ? (
              <p className="flex items-center gap-1.5 text-[11.5px] text-fg-muted"><Loader2 size={12} className="animate-spin" />{tt("common.loading")}</p>
            ) : whState === "error" ? (
              <p className="break-words text-[11.5px] text-destructive">{whError}</p>
            ) : warehouses.length === 0 ? (
              <>
                <p className="text-[11.5px] text-fg-muted">{tt("shp.create.whEmpty")}</p>
                <select value="" disabled className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm opacity-60">
                  <option value="">{tt("shp.create.whNone")}</option>
                </select>
              </>
            ) : (
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{tt("shp.create.whNone")}</option>
                {warehouses.map((w) => (
                  <option key={st(w, "id")} value={st(w, "id")}>
                    {tk(st(w, "name"))}{w.is_default === true ? ` · ${tt("shp.create.whDefaultTag")}` : ""} · {tk(`shp.whStatus.${st(w, "status")}`)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label>{tt("shp.create.ch")}</Label>
            {!forwarderId ? (
              <p className="text-[11.5px] text-fg-muted">{tt("shp.create.pickFwdFirst")}</p>
            ) : chState === "loading" ? (
              <p className="flex items-center gap-1.5 text-[11.5px] text-fg-muted"><Loader2 size={12} className="animate-spin" />{tt("common.loading")}</p>
            ) : chState === "error" ? (
              <p className="break-words text-[11.5px] text-destructive">{chError}</p>
            ) : channels.length === 0 ? (
              <p className="text-[11.5px] text-fg-muted">{tt("shp.create.chEmpty")}</p>
            ) : (
              <select
                value={channelId}
                onChange={(e) => setChannelId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">{tt("shp.create.chNone")}</option>
                {channels.map((c) => (
                  <option key={st(c, "id")} value={st(c, "id")}>
                    {tk(st(c, "name"))}{st(c, "code") ? ` (${st(c, "code")})` : ""} · {tk(`shp.transport.${st(c, "transport_type")}`)}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* 待处理订单：status in (待发货|部分发货)，服务端分页 50 条/页 */}
        <div className="mt-4 rounded-xl border border-border">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Label className="text-[12px]">{tt("shp.create.orders")}（{tt("shp.create.picked", { count: picked.length })}）</Label>
            <select
              value={orderCol}
              onChange={(e) => setOrderCol(e.target.value as OrderSearchCol)}
              className="h-8 rounded-md border border-input bg-transparent px-2 text-[12px]"
            >
              {ORDER_SEARCH_COLS.map((c) => <option key={c} value={c}>{tk(`shp.orderCol.${c}`)}</option>)}
            </select>
            <SearchField value={orderKw} onChange={setOrderKw} placeholder={tt("shp.create.orderSearchPh")} width="w-56" />
            <span className="ml-auto text-[11px] text-fg-subtle" title={tt("shp.create.orderScopeHint")}>
              {tt("shp.count", { count: orderTotal ?? orders.length })}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-[11px] text-muted-foreground">
                  <th className="px-2.5 py-2">
                    <input
                      type="checkbox"
                      aria-label={tt("shp.create.pickAllPage")}
                      title={tt("shp.create.pickAllPage")}
                      checked={allOrdPicked}
                      onChange={toggleAllOrders}
                      disabled={ordIds.length === 0}
                      className="h-4 w-4"
                    />
                  </th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.create.col.platformNo")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.create.col.buyer")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.create.col.amount")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.create.col.qty")}</th>
                  <th className="px-2.5 py-2 font-medium">{tt("shp.create.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {orderState === "loading" ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground"><Loader2 size={15} className="mx-auto mb-1 animate-spin" />{tt("common.loading")}</td></tr>
                ) : orderState === "error" ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-destructive">{orderError}</td></tr>
                ) : orders.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{tt("shp.create.ordersEmpty")}</td></tr>
                ) : orders.map((o) => (
                  <tr key={st(o, "id")} className="border-b border-border last:border-0">
                    <td className="px-2.5 py-2">
                      <input
                        type="checkbox"
                        aria-label={st(o, "id")}
                        checked={picked.includes(st(o, "id"))}
                        onChange={() => toggleOrder(st(o, "id"))}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className="px-2.5 py-2">
                      <div className="font-mono text-[11.5px] text-ink">{st(o, "external_order_id") || st(o, "id") || "—"}</div>
                      <div className="text-[10.5px] text-fg-subtle">{tk(st(o, "product")) || "—"}</div>
                    </td>
                    <td className="px-2.5 py-2 text-fg-muted">{st(o, "buyer") || "—"}</td>
                    <td className="px-2.5 py-2 font-data text-fg-muted">{money(sn(o, "amount"), st(o, "currency"))}</td>
                    <td className="px-2.5 py-2 font-data text-fg-muted">{itemQty(o)}</td>
                    <td className="px-2.5 py-2 text-fg-muted">{tk(st(o, "status"))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(orderTotal ?? orders.length) > ORDER_PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-fg-muted">
              <span title={tt("shp.create.orderPageHint")}>{tt("shp.page.info", { page: orderPage, total: ordTotalPages, count: orderTotal ?? orders.length })}</span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={orderPage <= 1 || orderState !== "ready"} onClick={() => setOrderPage((p) => p - 1)}>{tt("shp.page.prev")}</Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={orderPage >= ordTotalPages || orderState !== "ready"} onClick={() => setOrderPage((p) => p + 1)}>{tt("shp.page.next")}</Button>
              </div>
            </div>
          )}
        </div>

        {/* 结果：created / skipped 逐条列出（skipped 必须显示原因），失败显示后端原文 */}
        {rawError && (
          <div className="mt-3 rounded-xl border border-destructive/40 bg-danger-bg px-3 py-2.5">
            <p className="text-[12px] font-medium text-destructive">{tt("shp.create.errTitle")}</p>
            <p className="mt-0.5 break-words font-mono text-[11.5px] text-destructive/90">{rawError}</p>
            <p className="mt-1 text-[11px] text-fg-muted">{tt("shp.create.errNone")}</p>
          </div>
        )}
        {result && (
          <div className="mt-3 space-y-2">
            <p className="text-[12px] text-fg-muted">{tt("shp.create.resultSummary", { created: created.length, skipped: skipped.length })}</p>
            {created.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-success/40 bg-success-bg px-3 py-2.5 text-[11.5px]">
                {created.map((c, i) => (
                  <li key={`${c.shipment_id ?? i}`} className="break-words text-success">
                    {tt("shp.create.createdOne", { order: c.order_id ?? "—", shipment: c.shipment_id ?? "—", batch: c.batch_no || tt("shp.noBatchNo") })}
                  </li>
                ))}
              </ul>
            )}
            {skipped.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-warning/40 bg-warning-bg px-3 py-2.5 text-[11.5px]">
                {skipped.map((s, i) => (
                  <li key={`${s.order_id ?? i}`} className="break-words text-warning">
                    {tt("shp.create.skippedOne", { order: s.order_id ?? "—", reason: s.reason || tt("shp.create.noReason") })}
                  </li>
                ))}
              </ul>
            )}
            {created.length === 0 && skipped.length === 0 && (
              <p className="text-[11.5px] text-fg-muted">{tt("shp.create.resultNone")}</p>
            )}
            <p className="text-[11px] text-fg-subtle">{tt("shp.create.pushNext")}</p>
          </div>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onClose} disabled={submitting}>{tt("common.close")}</Button>
          <Button onClick={() => void submit()} disabled={submitting || picked.length === 0 || !forwarderId}>
            {submitting && <Loader2 size={13} className="mr-1 animate-spin" />}
            {tt("shp.create.submit")}
            {picked.length > 0 ? ` (${picked.length})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================= M2 · 推单结果（ok / dup / 失败） ============================= */

function PushResultPanel({ outcome, rows, codes, codesError, onClose }: {
  outcome: { ids: string[]; results: PushRowResult[]; raw: string };
  rows: Shipment[];
  codes: ErrorCodeMap | null;
  codesError: string;
  onClose: () => void;
}) {
  const nameOf = (id: string) => {
    const r = rows.find((x) => x.shipment_id === id);
    if (!r) return id;
    return r.platform_order_no || r.order_id || id;
  };
  const results = outcome.results;
  const okRows = results.filter((x) => x.ok === true && x.dup !== true);
  const dupRows = results.filter((x) => x.dup === true);
  const badRows = results.filter((x) => x.ok !== true && x.dup !== true);

  const Line = ({ x, tone }: { x: PushRowResult; tone: "ok" | "dup" | "bad" }) => (
    <li className="break-words">
      <span className="font-mono text-[11px]">{nameOf(x.shipment_id ?? "")}</span>
      {" — "}
      {tk(x.state ? `shp.push.${x.state}` : "shp.push.noState")}
      {x.batch_no ? ` · ${x.batch_no}` : ""}
      {x.attempt != null ? ` · ${tt("shp.push.attemptOf", { n: x.attempt })}` : ""}
      {tone === "bad" && (
        <span className="text-destructive">
          {" · "}
          {errText(x.error_code ?? "", x.error_message ?? "", codes)}
        </span>
      )}
      {tone === "dup" && <span className="text-fg-subtle"> · {tt("shp.push.dupWhy")}</span>}
    </li>
  );

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
          <Send size={14} />{tt("shp.push.resultTitle")}
          <span className="font-data text-[11px] font-normal text-fg-subtle">{tt("shp.push.resultRequested", { n: outcome.ids.length })}</span>
        </h4>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onClose}>{tt("shp.push.resultClose")}</Button>
      </div>

      {outcome.raw ? (
        <div className="rounded-xl border border-destructive/40 bg-danger-bg px-3 py-2.5">
          <p className="text-[12px] font-medium text-destructive">{tt("shp.push.resultFailTitle")}</p>
          <p className="mt-0.5 break-words font-mono text-[11.5px] text-destructive/90">{outcome.raw}</p>
          <p className="mt-1 text-[11px] text-fg-muted">{tt("shp.push.resultRawHint")}</p>
        </div>
      ) : results.length === 0 ? (
        <p className="rounded-xl border border-warning/40 bg-warning-bg px-3 py-2.5 text-[11.5px] text-warning">{tt("shp.push.err.emptyResult")}</p>
      ) : (
        <div className="grid gap-2 lg:grid-cols-3">
          {okRows.length > 0 && (
            <div className="rounded-xl border border-success/40 bg-success-bg px-3 py-2.5">
              <p className="mb-1 text-[11.5px] font-medium text-success">{tt("shp.push.resultOk", { n: okRows.length })}</p>
              <ul className="space-y-1 text-[11.5px] text-success/90">{okRows.map((x, i) => <Line key={i} x={x} tone="ok" />)}</ul>
            </div>
          )}
          {dupRows.length > 0 && (
            <div className="rounded-xl border border-border bg-surface-sunken px-3 py-2.5">
              <p className="mb-1 text-[11.5px] font-medium text-fg">{tt("shp.push.resultDup", { n: dupRows.length })}</p>
              <ul className="space-y-1 text-[11.5px] text-fg-muted">{dupRows.map((x, i) => <Line key={i} x={x} tone="dup" />)}</ul>
              <p className="mt-1 text-[10.5px] text-fg-subtle" title={tt("shp.push.dupWhyHint")}>{tt("shp.push.dupNormal")}</p>
            </div>
          )}
          {badRows.length > 0 && (
            <div className="rounded-xl border border-destructive/40 bg-danger-bg px-3 py-2.5">
              <p className="mb-1 text-[11.5px] font-medium text-destructive">{tt("shp.push.resultBad", { n: badRows.length })}</p>
              <ul className="space-y-1 text-[11.5px] text-destructive/90">{badRows.map((x, i) => <Line key={i} x={x} tone="bad" />)}</ul>
            </div>
          )}
        </div>
      )}

      {codesError && (
        <p className="break-words text-[11px] text-warning">{tt("shp.push.dictMissing", { msg: codesError })}</p>
      )}
      <p className="text-[10.5px] text-fg-subtle">{tt("shp.push.dictSource")}</p>
    </div>
  );
}

/* ============================= M2 · 推单日志抽屉（EF action=list-logs） ============================= */

function PushLogsSheet({ shipment, codes, onClose }: {
  shipment: Shipment;
  codes: ErrorCodeMap | null;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<PushLogRow[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setState("loading");
    setErr("");
    try {
      const data = await callForwarderPush<PushLogRow[]>({ action: "list-logs", shipment_id: shipment.shipment_id });
      setLogs(Array.isArray(data) ? data : []);
      setState("ready");
    } catch (e) {
      const m = e instanceof Error ? e.message : tt("shp.logs.errFail");
      setLogs(null);
      setErr(m);
      setState("error");
      toast.error(m); // EF 未部署：404 原文直接显示在抽屉里
    }
  }, [shipment.shipment_id]);

  useEffect(() => { void load(); }, [load]);

  const snapBlock = (key: string, label: string, value: unknown) => {
    const text = prettyJson(value);
    if (!text) return (
      <p className="mt-1 text-[10.5px] text-fg-subtle">{tt("shp.logs.noSnapshot")}</p>
    );
    const cut = text.length > SNAPSHOT_SNIP;
    const shown = cut ? text.slice(0, SNAPSHOT_SNIP) : text;
    const open = expanded[key] === true;
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setExpanded((prev) => ({ ...prev, [key]: !open }))}
          className="inline-flex items-center gap-1 text-[10.5px] text-primary hover:underline"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          {label}
          <span className="font-data text-fg-subtle">({tt("shp.logs.chars", { n: text.length })})</span>
        </button>
        {open && (
          <pre className={cn(
            "mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-surface-sunken px-2 py-1.5 font-mono text-[10.5px] text-fg-muted",
            cut && "border-warning/40",
          )}>
            {shown}
            {cut && `\n… ${tt("shp.logs.truncated", { n: text.length, snip: SNAPSHOT_SNIP })}`}
          </pre>
        )}
      </div>
    );
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-[min(820px,100vw)] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {tt("shp.logs.title")}
            <span className="font-mono text-[13px] text-fg-muted">
              {shipment.platform_order_no || shipment.order_id || shipment.shipment_id}
            </span>
          </SheetTitle>
          <SheetDescription>
            {tk(shipment.forwarder_name) || "—"} · {tk(shipment.warehouse_name) || "—"} · {tk(shipment.channel_name) || "—"}
            {" / "}
            {tk(`shp.push.${shipment.push_state}`)}
            {shipment.batch_no ? ` · ${shipment.batch_no}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={state === "loading"}>
              <RefreshCw size={13} className={cn("mr-1.5", state === "loading" && "animate-spin")} />{tt("shp.logs.reload")}
            </Button>
            <span className="text-[11px] text-fg-subtle" title={tt("shp.logs.limitHint")}>
              {tt("shp.logs.limit", { n: PUSH_LOG_LIMIT })}
            </span>
          </div>

          {state === "loading" && (
            <p className="flex items-center gap-1.5 text-[12px] text-fg-muted"><Loader2 size={14} className="animate-spin" />{tt("common.loading")}</p>
          )}

          {state === "error" && (
            <div className="rounded-xl border border-destructive/40 bg-danger-bg px-3 py-2.5">
              <p className="text-[12px] font-medium text-destructive">{tt("shp.logs.errTitle")}</p>
              <p className="mt-0.5 break-words font-mono text-[11.5px] text-destructive/90">{err}</p>
              <p className="mt-1 text-[11px] text-fg-muted">{tt("shp.logs.errHint")}</p>
            </div>
          )}

          {state === "ready" && (logs?.length ?? 0) === 0 && (
            <p className="rounded-xl border border-border bg-surface-sunken px-3 py-2.5 text-[11.5px] text-fg-muted">{tt("shp.logs.empty")}</p>
          )}

          {state === "ready" && (logs ?? []).map((l, i) => {
            const code = l.error_code ?? "";
            const entry = code ? (codes?.[code] ?? undefined) : undefined;
            const status = l.status ?? "";
            const key = `${l.attempt ?? i}-${status}-${i}`;
            return (
              <div key={key} className={cn(
                "rounded-xl border px-3 py-2.5",
                status === "failed" || status === "dead" ? "border-destructive/40 bg-danger-bg" : "border-border bg-card",
              )}>
                <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  <Badge variant={PUSH_LOG_TONE[status] ?? "muted"}>{tk(`shp.logStatus.${status}`)}</Badge>
                  <span className="text-fg-muted">{tt("shp.logs.attempt", { n: l.attempt ?? 0 })}</span>
                  <span className="text-fg-subtle">{fmtTime(l.created_at ?? null)}</span>
                  {code && (
                    <span className="break-all font-mono text-[11px] text-destructive" title={entry?.message ?? ""}>
                      {errText(code, l.error_message ?? "", codes)}
                    </span>
                  )}
                  {entry && (
                    <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10.5px] text-fg-muted">
                      {tk(`shp.errCategory.${entry.category}`)} · {entry.retryable ? tt("shp.logs.retryable") : tt("shp.logs.notRetryable")}
                    </span>
                  )}
                </div>
                {snapBlock(`${key}-req`, tt("shp.logs.request"), l.request_snapshot)}
                {snapBlock(`${key}-res`, tt("shp.logs.response"), l.response_snapshot)}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>{tt("common.close")}</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
