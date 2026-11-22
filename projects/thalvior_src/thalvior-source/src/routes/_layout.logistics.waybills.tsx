import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, FileText, Download, Loader2, PackageOpen, RefreshCw,
  Repeat2, Search, ShieldAlert, Tag, Unlink,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { SearchField } from "@/components/filter-bar";
import { queryTable, type ExtRow, type TableFilter } from "@/lib/data-access";
import { tt, tk } from "@/i18n/tts";
import { cn } from "@/lib/utils"
import { fmtDateTime } from "@/lib/datetime";

export const Route = createFileRoute("/_layout/logistics/waybills")({
  component: Page_LogisticsWaybills,
});

/* ------------------------------------------------------------------ *
 * 面单与文件中心
 * 数据源：label_files（8 种 file_type + is_update 两段式面单 + file_url/storage_path）
 *        v_shipment_progress（tracking_no / label_state / label_source / apply_count，33 列视图，不再查 shipments）
 *        tracking_subscriptions（订阅状态 sub_status + stop_reason）
 * 所有过滤 / 分页 / 计数均下推给数据库（queryTable），前端不再全量拉取后切片。
 * ------------------------------------------------------------------ */

type Variant = "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "muted";

const FILE_TYPES = ["WAYBILL", "INVOICE", "CARTON_LABEL", "PACKING_LIST", "PRODUCT_LABEL", "PALLET_LABEL", "PICKING_LIST", "OTHER"] as const;
const FILE_STATUSES = ["requested", "ready", "failed", "superseded"] as const;
const LABEL_SOURCES = ["attachment", "api", "pre_file", "wms_gen"] as const;

const FILE_STATUS_TONE: Record<string, Variant> = { requested: "warning", ready: "success", failed: "destructive", superseded: "muted" };
const SUB_TONE: Record<string, Variant> = { pending: "warning", subscribed: "success", paused: "muted", stopped: "destructive", removed: "muted" };
const STOP_TONE: Record<string, Variant> = { delivered: "success", exception_timeout: "destructive", no_info: "warning", removed: "muted", none: "secondary" };
const LABEL_STATE_TONE: Record<string, Variant> = { none: "muted", requested: "warning", ready: "success", failed: "destructive", updated: "info" };

const st = (r: ExtRow, k: string) => (r[k] == null ? "" : String(r[k]));
const sb = (r: ExtRow, k: string) => r[k] === true || r[k] === "true";
const fmtTime = (v: string | null) => (v ? fmtDateTime(v, lang) : "—");

interface FileRow {
  id: string;
  shipment_id: string;
  parcel_id: string;
  file_type: string;
  source: string;
  storage_path: string;
  file_url: string;
  page_count: number | null;
  is_update: boolean;
  version: number;
  status: string;
  created_at: string | null;
}

interface SubRow {
  id: string;
  provider: string;
  tracking_no: string;
  carrier_code: string;
  carrier_confirmed: boolean;
  status: string;
  sub_status: string;
  stop_reason: string;
  online_at: string | null;
  delivered_at: string | null;
  last_check_at: string | null;
  next_check_at: string | null;
  check_count: number;
  error_count: number;
}

interface Picker {
  shipment_id: string;
  order_id: string;
  platform_order_no: string;
  tracking_no: string;
  stage: string;
  label_state: string;
  label_source: string;
  apply_count: number | null;
  created_at: string | null;
}

// 视图列裁剪：选择器只需要这些字段
const PICKER_SELECT = "shipment_id,order_id,platform_order_no,tracking_no,stage,label_state,label_source,apply_count,created_at";
const PICKER_WINDOW = 200;   // 无关键字时只取最近 N 条
const PICKER_HIT_CAP = 50;   // 关键字下推时每个候选列最多取 N 条
const FILE_PAGE_SIZE = 20;   // 文件列表每页条数（由数据库 range 决定）
const SUB_WINDOW = 50;       // 单货件订阅上限，超出说明数据异常
// TableQuery 的 filters 只会 AND，跨列 OR 表达不了，故关键字按列各下一次 ilike
const PICKER_SEARCH_COLS = ["order_id", "platform_order_no", "tracking_no"] as const;

// PostgREST 把 ilike 的 pattern 原样交给 LIKE，先转义 % _ \ 避免用户输入变成通配符
const likePattern = (kw: string) => `%${kw.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const mapPicker = (r: ExtRow): Picker => ({
  shipment_id: st(r, "shipment_id"),
  order_id: st(r, "order_id"),
  platform_order_no: st(r, "platform_order_no"),
  tracking_no: st(r, "tracking_no"),
  stage: st(r, "stage"),
  label_state: st(r, "label_state"),
  label_source: st(r, "label_source"),
  apply_count: r.apply_count == null ? null : Number(r.apply_count),
  created_at: r.created_at ? String(r.created_at) : null,
});

const mapFile = (r: ExtRow): FileRow => ({
  id: r.id,
  shipment_id: st(r, "shipment_id"),
  parcel_id: st(r, "parcel_id"),
  file_type: st(r, "file_type"),
  source: st(r, "source"),
  storage_path: st(r, "storage_path"),
  file_url: st(r, "file_url"),
  page_count: r.page_count == null ? null : Number(r.page_count),
  is_update: sb(r, "is_update"),
  version: Number(r.version ?? 1),
  status: st(r, "status"),
  created_at: r.created_at ? String(r.created_at) : null,
});

const mapSub = (r: ExtRow): SubRow => ({
  id: r.id,
  provider: st(r, "provider"),
  tracking_no: st(r, "tracking_no"),
  carrier_code: st(r, "carrier_code"),
  carrier_confirmed: sb(r, "carrier_confirmed"),
  status: st(r, "status"),
  sub_status: st(r, "sub_status"),
  stop_reason: st(r, "stop_reason"),
  online_at: r.online_at ? String(r.online_at) : null,
  delivered_at: r.delivered_at ? String(r.delivered_at) : null,
  last_check_at: r.last_check_at ? String(r.last_check_at) : null,
  next_check_at: r.next_check_at ? String(r.next_check_at) : null,
  check_count: Number(r.check_count ?? 0),
  error_count: Number(r.error_count ?? 0),
});

// 只有真实可访问的 http(s) URL 才允许打开，绝不给"假下载"按钮
const openableUrl = (f: FileRow): string => (
  /^https?:\/\//i.test(f.file_url) ? f.file_url : ""
);
const downloadBlockedReason = (f: FileRow): string => {
  if (openableUrl(f)) return "";
  if (f.status === "requested") return tt("shp.wb.dl.pending");
  if (f.status === "failed") return tt("shp.wb.dl.failed");
  if (f.storage_path && !f.file_url) return tt("shp.wb.dl.storageOnly");
  return tt("shp.wb.dl.noUrl");
};

function Page_LogisticsWaybills() {
  const [picker, setPicker] = useState<Picker[]>([]);
  const [pickerLoading, setPickerLoading] = useState(true);
  const [pickCapped, setPickCapped] = useState(false);   // 选择器窗口是否被截断
  const [selected, setSelected] = useState<string>("");   // shipment_id，"" = 全部货件
  const [shipQuery, setShipQuery] = useState("");
  const [shipKw, setShipKw] = useState("");               // 防抖后才下推给数据库的关键字
  const [tnQuery, setTnQuery] = useState("");
  const [tnSearching, setTnSearching] = useState(false);

  const [files, setFiles] = useState<FileRow[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState("");
  const [filePage, setFilePage] = useState(1);
  const [fileTotal, setFileTotal] = useState<number | null>(null);   // 数据库 count:"exact"

  const [subs, setSubs] = useState<SubRow[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [subsError, setSubsError] = useState("");

  // 计数全部走数据库 count:"exact"，不依赖当前页的行
  const [cnt, setCnt] = useState({ scope: 0, updates: 0, noUrl: 0 });
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [onlyUpdate, setOnlyUpdate] = useState(false);

  // 关键字防抖：检索由数据库执行，不能每次按键都发请求
  useEffect(() => {
    const t = setTimeout(() => setShipKw(shipQuery.trim()), 400);
    return () => clearTimeout(t);
  }, [shipQuery]);

  const loadPicker = useCallback(async () => {
    setPickerLoading(true);
    const kw = shipKw;
    try {
      if (!kw) {
        // 无关键字：最近 PICKER_WINDOW 条，列裁剪 + range 限定，绝不全量
        const res = await queryTable("v_shipment_progress", {
          select: PICKER_SELECT,
          order: { field: "created_at", ascending: false },
          range: { from: 0, to: PICKER_WINDOW - 1 },
        });
        setPicker(res.rows.map(mapPicker));
        setPickCapped(res.rows.length >= PICKER_WINDOW);
        return;
      }
      // 有关键字：filters 只能 AND，故按候选列各下一次数据库 ilike，命中集合由数据库决定
      const lists = await Promise.all(PICKER_SEARCH_COLS.map((col) => queryTable("v_shipment_progress", {
        select: PICKER_SELECT,
        filters: [{ field: col, value: likePattern(kw), op: "ilike" }],
        order: { field: "created_at", ascending: false },
        range: { from: 0, to: PICKER_HIT_CAP - 1 },
      })));
      const byId = new Map<string, Picker>();
      let capped = false;
      for (const res of lists) {
        if (res.rows.length >= PICKER_HIT_CAP) capped = true;
        for (const p of res.rows.map(mapPicker)) if (!byId.has(p.shipment_id)) byId.set(p.shipment_id, p);
      }
      setPicker([...byId.values()].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")));
      setPickCapped(capped);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("shp.wb.err.loadShipments"));
      setPicker([]);
    } finally {
      setPickerLoading(false);
    }
  }, [shipKw]);

  const loadFiles = useCallback(async () => {
    setFilesLoading(true);
    setFilesError("");
    try {
      const filters: TableFilter[] = [];
      if (selected) filters.push({ field: "shipment_id", value: selected, op: "eq" });
      if (typeFilter !== "all") filters.push({ field: "file_type", value: typeFilter, op: "eq" });
      if (statusFilter !== "all") filters.push({ field: "status", value: statusFilter, op: "eq" });
      if (onlyUpdate) filters.push({ field: "is_update", value: true, op: "eq" });
      const from = (filePage - 1) * FILE_PAGE_SIZE;
      const res = await queryTable("label_files", {
        filters,
        order: { field: "created_at", ascending: false },
        range: { from, to: from + FILE_PAGE_SIZE - 1 },
        count: "exact",
      });
      setFiles(res.rows.map(mapFile));
      setFileTotal(res.count ?? res.rows.length);
    } catch (e) {
      const m = e instanceof Error ? e.message : tt("shp.wb.err.loadFiles");
      setFilesError(m);
      toast.error(m); // 数据库原文
      setFiles([]);
      setFileTotal(null);
    } finally {
      setFilesLoading(false);
    }
  }, [selected, typeFilter, statusFilter, onlyUpdate, filePage]);

  const loadCounts = useCallback(async () => {
    // 只按货件范围统计，不受类型 / 状态筛选影响；每次只取 1 行 + count
    const count = async (extra?: TableFilter) => {
      const filters: TableFilter[] = [];
      if (selected) filters.push({ field: "shipment_id", value: selected, op: "eq" });
      if (extra) filters.push(extra);
      const res = await queryTable("label_files", {
        select: "id",
        filters,
        range: { from: 0, to: 0 },
        count: "exact",
      });
      return res.count ?? res.rows.length;
    };
    try {
      const [scope, updates, noUrl] = await Promise.all([
        count(),
        count({ field: "is_update", value: true, op: "eq" }),
        count({ field: "file_url", value: null, op: "is" }),
      ]);
      setCnt({ scope, updates, noUrl });
    } catch {
      // 计数失败不打断主流程，保留上一次数字
    }
  }, [selected]);

  const loadSubs = useCallback(async () => {
    if (!selected) { setSubs([]); return; }
    setSubsLoading(true);
    setSubsError("");
    try {
      const res = await queryTable("tracking_subscriptions", {
        filters: [{ field: "shipment_id", value: selected, op: "eq" }],
        order: { field: "updated_at", ascending: false },
        range: { from: 0, to: SUB_WINDOW - 1 },
      });
      setSubs(res.rows.map(mapSub));
    } catch (e) {
      const m = e instanceof Error ? e.message : tt("shp.wb.err.loadSubs");
      setSubsError(m);
      toast.error(m);
      setSubs([]);
    } finally {
      setSubsLoading(false);
    }
  }, [selected]);

  useEffect(() => { void loadPicker(); }, [loadPicker]);
  useEffect(() => { void loadFiles(); }, [loadFiles]);
  useEffect(() => { void loadCounts(); }, [loadCounts]);
  useEffect(() => { void loadSubs(); }, [loadSubs]);
  // 筛选条件变化时回到第 1 页（渲染期重置，避免先用旧页码发一次请求）
  const fileSig = JSON.stringify([selected, typeFilter, statusFilter, onlyUpdate]);
  const [prevFileSig, setPrevFileSig] = useState(fileSig);
  if (fileSig !== prevFileSig) {
    setPrevFileSig(fileSig);
    setFilePage(1);
  }

  const fileTotalPages = Math.max(1, Math.ceil((fileTotal ?? files.length) / FILE_PAGE_SIZE));
  useEffect(() => { if (filePage > fileTotalPages) setFilePage(1); }, [filePage, fileTotalPages]);

  // 按运单号精确查货件（视图等值过滤，命中后交给选择器检索显示）
  const searchByTrackingNo = async () => {
    const q = tnQuery.trim();
    if (!q) { void loadPicker(); return; }
    setTnSearching(true);
    try {
      const res = await queryTable("v_shipment_progress", {
        select: "shipment_id",
        filters: [{ field: "tracking_no", value: q, op: "eq" }],
        order: { field: "created_at", ascending: false },
        range: { from: 0, to: 9 },
      });
      if (res.rows.length === 0) {
        toast.info(tt("shp.wb.trackingNotFound"));
        return;
      }
      setSelected(st(res.rows[0], "shipment_id"));
      setShipQuery(q);
      toast.success(tt("shp.wb.trackingMatched", { count: res.rows.length }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt("shp.wb.err.loadShipments"));
    } finally {
      setTnSearching(false);
    }
  };

  // 两段式面单：同一货件里 is_update=true 的版本生效，其余旧版视为作废
  // 注意：判断范围是当前页（数据库 range 取回的 files），跨页时页面会明确提示
  const updateByShipment = useMemo(() => {
    const m = new Map<string, FileRow>();
    for (const f of files) {
      if (!f.is_update) continue;
      const cur = m.get(f.shipment_id);
      if (!cur || f.version > cur.version) m.set(f.shipment_id, f);
    }
    return m;
  }, [files]);

  const isStaleVersion = (f: FileRow) => {
    const u = updateByShipment.get(f.shipment_id);
    return !!u && !f.is_update && f.file_type === u.file_type && f.version < u.version;
  };

  const open = (f: FileRow) => {
    const url = openableUrl(f);
    if (!url) { toast.error(downloadBlockedReason(f)); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const current = picker.find((p) => p.shipment_id === selected);
  const refreshAll = () => { void loadPicker(); void loadFiles(); void loadCounts(); void loadSubs(); };

  return (
    <div className="space-y-5">
      <PageHeader
        code="LABELS & DOCUMENTS"
        title={tt("shp.wb.title")}
        description={tt("shp.wb.desc")}
        actions={
          <Button size="sm" variant="outline" onClick={refreshAll} disabled={filesLoading || pickerLoading}>
            <RefreshCw size={15} className={cn("mr-1.5", (filesLoading || pickerLoading) && "animate-spin")} />{tt("common.refresh")}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={tt("shp.wb.stat.total")} value={String(cnt.scope)} icon={<FileText size={17} />} tone="blue" footer={<p className="mt-1 text-[11px] text-fg-subtle">{tt("shp.wb.stat.totalHint")}</p>} />
        <StatCard label={tt("shp.wb.stat.updates")} value={String(cnt.updates)} icon={<Repeat2 size={17} />} tone="warning" footer={<p className="mt-1 text-[11px] text-fg-subtle">{tt("shp.wb.stat.updatesHint")}</p>} />
        <StatCard label={tt("shp.wb.stat.noUrl")} value={String(cnt.noUrl)} icon={<ShieldAlert size={17} />} tone="danger" footer={<p className="mt-1 text-[11px] text-fg-subtle">{tt("shp.wb.stat.noUrlHint")}</p>} />
        <StatCard label={tt("shp.wb.stat.activeSubs")} value={String(subs.filter((s) => s.sub_status === "subscribed").length)} icon={<Unlink size={17} />} tone="success" footer={<p className="mt-1 text-[11px] text-fg-subtle">{selected ? tt("shp.wb.stat.activeSubsHint") : tt("shp.wb.stat.pickFirst")}</p>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* 货件选择器 */}
        <div className="flex max-h-[640px] flex-col overflow-x-auto rounded-2xl border border-border bg-card">
          <div className="space-y-2 border-b border-border px-3 py-3">
            <h3 className="text-sm font-semibold text-ink">{tt("shp.wb.pickShipment")}</h3>
            <SearchField value={shipQuery} onChange={setShipQuery} placeholder={tt("shp.wb.pickSearchPh")} width="w-full" />
            <p className="text-[10.5px] leading-snug text-fg-subtle">{tt("shp.wb.pickSearchTitle")}</p>
            <div className="flex gap-1.5">
              <Input value={tnQuery} onChange={(e) => setTnQuery(e.target.value)} placeholder={tt("shp.wb.trackingPh")}
                onKeyDown={(e) => { if (e.key === "Enter") void searchByTrackingNo(); }} className="h-8 text-xs" />
              <Button size="sm" variant="outline" className="h-8 shrink-0 px-2" disabled={tnSearching} onClick={() => void searchByTrackingNo()} title={tt("shp.wb.trackingSearchTip")}>
                {tnSearching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
              </Button>
            </div>
            <button type="button" onClick={() => setSelected("")}
              className={cn("w-full rounded-md border px-2 py-1.5 text-left text-xs",
                selected === "" ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-fg-muted hover:bg-surface-hover")}>
              {tt("shp.wb.allShipments")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {pickerLoading ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground"><Loader2 size={15} className="mx-auto mb-1.5 animate-spin" />{tt("common.loading")}</div>
            ) : picker.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">{shipKw ? tt("shp.wb.noMatchPick") : tt("shp.wb.emptyPick")}</div>
            ) : picker.map((p) => (
              <button key={p.shipment_id} type="button" onClick={() => setSelected(p.shipment_id)}
                className={cn("block w-full border-b border-border px-3 py-2 text-left text-xs transition-colors last:border-0 hover:bg-muted/50",
                  selected === p.shipment_id && "bg-primary/5")}>
                <div className="truncate font-medium text-ink">{p.order_id || p.platform_order_no || p.shipment_id}</div>
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{p.tracking_no || tt("shp.wb.noTrackingNo")}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{tk(`shp.stage.${p.stage}`)}</Badge>
                  <Badge variant={LABEL_STATE_TONE[p.label_state] ?? "muted"} className="px-1.5 py-0 text-[10px]">{tk(`shp.labelState.${p.label_state}`)}</Badge>
                </div>
              </button>
            ))}
            {pickCapped && !pickerLoading && (
              <div className="px-3 py-2 text-[10.5px] leading-snug text-warning">{tt("shp.wb.pickCapped", { n: shipKw ? PICKER_HIT_CAP : PICKER_WINDOW })}</div>
            )}
          </div>
        </div>

        {/* 面单文件 */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <FileText size={15} />{tt("shp.wb.filesTitle")}
                <span className="font-data text-xs text-fg-muted" title={tt("shp.count.hint")}>{tt("shp.count", { count: fileTotal ?? files.length })}</span>
              </h3>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
                  <option value="all">{tt("shp.wb.filter.typeAll")}</option>
                  {FILE_TYPES.map((x) => <option key={x} value={x}>{tk(`shp.wb.type.${x}`)}</option>)}
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded-md border border-input bg-transparent px-2 text-xs">
                  <option value="all">{tt("shp.wb.filter.statusAll")}</option>
                  {FILE_STATUSES.map((x) => <option key={x} value={x}>{tk(`shp.wb.fileStatus.${x}`)}</option>)}
                </select>
                <button type="button" onClick={() => setOnlyUpdate((v) => !v)}
                  className={cn("h-8 rounded-md border px-2 text-xs", onlyUpdate ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-fg-muted hover:bg-surface-hover")}>
                  <Repeat2 size={11} className="mr-1 inline" />{tt("shp.wb.filter.onlyUpdate")}
                </button>
              </div>
            </div>

            {/* 当前货件的面单来源摘要（label_source 是枚举不是布尔，取自 v_shipment_progress） */}
            {selected && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface-sunken/50 px-4 py-2 text-[11.5px] text-fg-muted">
                <span>{tt("shp.wb.head.shipment")}: <span className="font-mono text-ink">{current?.order_id || current?.platform_order_no || selected}</span></span>
                <span>{tt("shp.wb.head.trackingNo")}: <span className="font-mono text-ink">{current?.tracking_no || "—"}</span></span>
                <span>{tt("shp.wb.head.labelSource")}: {current && LABEL_SOURCES.includes(current.label_source as (typeof LABEL_SOURCES)[number])
                  ? <Badge variant="secondary">{tk(`shp.labelSource.${current.label_source}`)}</Badge> : "—"}</span>
                <span>{tt("shp.wb.head.labelState")}: <Badge variant={LABEL_STATE_TONE[current?.label_state ?? "none"] ?? "muted"}>{tk(`shp.labelState.${current?.label_state ?? "none"}`)}</Badge></span>
                <span>{tt("shp.applyCount", { count: current?.apply_count ?? 0 })}</span>
                {!current && <span className="text-warning">{tt("shp.wb.head.notInPick")}</span>}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">{tt("shp.wb.col.type")}</th>
                    {!selected && <th className="px-3 py-2.5 font-medium">{tt("shp.col.shipment")}</th>}
                    <th className="px-3 py-2.5 font-medium">{tt("shp.wb.col.version")}</th>
                    <th className="px-3 py-2.5 font-medium">{tt("shp.wb.col.source")}</th>
                    <th className="px-3 py-2.5 font-medium">{tt("shp.wb.col.status")}</th>
                    <th className="px-3 py-2.5 font-medium">{tt("shp.wb.col.ref")}</th>
                    <th className="px-3 py-2.5 font-medium">{tt("shp.wb.col.created")}</th>
                    <th className="px-3 py-2.5 text-right font-medium">{tt("common.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filesLoading ? (
                    <tr><td colSpan={8} className="px-4 py-14 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt("common.loading")}</td></tr>
                  ) : filesError ? (
                    <tr><td colSpan={8}>
                      <div className="flex items-start justify-between gap-3 px-4 py-8 text-left">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-[13px] font-medium text-destructive"><AlertTriangle size={14} />{tt("shp.wb.err.title")}</p>
                          <p className="mt-0.5 break-words font-mono text-[12px] text-destructive/90">{filesError}</p>
                        </div>
                        <Button size="sm" variant="outline" onClick={refreshAll}>{tt("shp.err.retry")}</Button>
                      </div>
                    </td></tr>
                  ) : (fileTotal ?? files.length) === 0 ? (
                    <tr><td colSpan={8}>
                      <EmptyState
                        text={cnt.scope === 0
                          ? (selected ? tt("shp.wb.emptyForShipment") : tt("shp.wb.emptyAll"))
                          : tt("shp.wb.emptyFiltered")}
                        hint={cnt.scope === 0 ? tt("shp.wb.emptyNextStep") : tt("shp.empty.filterHint")}
                        iconSize={28}
                      />
                    </td></tr>
                  ) : files.map((f) => {
                    const url = openableUrl(f);
                    const reason = downloadBlockedReason(f);
                    const stale = isStaleVersion(f);
                    return (
                      <tr key={f.id} className={cn("border-b border-border align-top transition-colors last:border-0 hover:bg-muted/50",
                        (f.status === "superseded" || stale) && "opacity-60")}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink"><Tag size={12} className="text-fg-subtle" />{tk(`shp.wb.type.${f.file_type}`)}</div>
                          {f.page_count != null && <div className="mt-0.5 text-[11px] text-muted-foreground">{tt("shp.wb.pages", { count: f.page_count })}</div>}
                        </td>
                        {!selected && <td className="px-3 py-2.5"><span className="font-mono text-[11px] text-muted-foreground">{f.shipment_id.slice(0, 8)}</span></td>}
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="font-data text-[12px] text-fg-muted">v{f.version}</span>
                            {f.is_update && (
                              <Badge variant="info" className="gap-1"><Repeat2 size={10} />{tt("shp.wb.badge.updated")}</Badge>
                            )}
                            {stale && <Badge variant="muted">{tt("shp.wb.badge.voidByUpdate")}</Badge>}
                          </div>
                          {f.is_update && (
                            <p className="mt-1 max-w-[220px] text-[11px] leading-snug text-info">{tt("shp.wb.hint.updatedIs")}</p>
                          )}
                          {!f.parcel_id && <p className="mt-0.5 text-[10.5px] text-fg-subtle">{tt("shp.wb.hint.shipmentLevel")}</p>}
                          {f.parcel_id && <p className="mt-0.5 text-[10.5px] text-fg-subtle">{tt("shp.wb.hint.parcelLevel", { id: f.parcel_id.slice(0, 8) })}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-[12px] text-muted-foreground">
                          <Badge variant="outline">{f.source ? tk(`shp.wb.source.${f.source}`) : "—"}</Badge>
                        </td>
                        <td className="px-3 py-2.5"><Badge variant={FILE_STATUS_TONE[f.status] ?? "muted"}>{tk(`shp.wb.fileStatus.${f.status}`)}</Badge></td>
                        <td className="px-3 py-2.5">
                          {url
                            ? <a href={url} target="_blank" rel="noreferrer" className="block max-w-[240px] truncate font-mono text-[11px] text-primary hover:underline" title={url}>{url}</a>
                            : <span className="block max-w-[240px] truncate font-mono text-[11px] text-fg-subtle" title={f.storage_path || "—"}>{f.storage_path || "—"}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-[11.5px] text-muted-foreground">{fmtTime(f.created_at)}</td>
                        <td className="px-3 py-2.5 text-right">
                          <Button size="sm" variant={url ? "outline" : "ghost"} className="h-7 text-xs" disabled={!url}
                            title={url ? tt("shp.wb.dl.open") : reason}
                            onClick={() => open(f)}>
                            <Download size={12} className="mr-1" />
                            {url ? tt("shp.wb.dl.open") : tt("shp.wb.dl.disabled")}
                          </Button>
                          {!url && <p className="mt-1 max-w-[180px] text-right text-[10.5px] leading-snug text-destructive/80">{reason}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 分页由数据库 range + count 决定 */}
            {(fileTotal ?? files.length) > FILE_PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5 text-xs text-fg-muted">
                <span title={tt("shp.page.serverHint")}>
                  {tt("shp.page.info", { page: filePage, total: fileTotalPages, count: fileTotal ?? files.length })}
                </span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={filePage <= 1 || filesLoading} onClick={() => setFilePage((p) => p - 1)}>{tt("shp.page.prev")}</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={filePage >= fileTotalPages || filesLoading} onClick={() => setFilePage((p) => p + 1)}>{tt("shp.page.next")}</Button>
                </div>
              </div>
            )}
            {fileTotal !== null && fileTotal > FILE_PAGE_SIZE && (
              <p className="border-t border-border px-4 py-2 text-[10.5px] leading-snug text-warning">{tt("shp.wb.pageNote")}</p>
            )}
          </div>

          {/* 追踪订阅 */}
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><PackageOpen size={15} />{tt("shp.wb.subs.title")}</h3>
              <span className="text-xs text-fg-muted">{selected ? tt("shp.wb.subs.ofShipment") : tt("shp.wb.subs.needPick")}</span>
            </div>
            {!selected ? (
              <EmptyState iconSize={28} text={tt("shp.wb.subs.pickHint")} />
            ) : subsLoading ? (
              <div className="px-4 py-10 text-center text-xs text-muted-foreground"><Loader2 size={15} className="mx-auto mb-1.5 animate-spin" />{tt("common.loading")}</div>
            ) : subsError ? (
              <div className="px-4 py-6 text-center font-mono text-[12px] text-destructive">{subsError}</div>
            ) : subs.length === 0 ? (
              <EmptyState iconSize={28} text={tt("shp.wb.subs.empty")} hint={tt("shp.wb.subs.emptyHint")} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2.5 font-medium">{tt("shp.wb.subs.col.provider")}</th>
                      <th className="px-3 py-2.5 font-medium">{tt("common.trackingNo")}</th>
                      <th className="px-3 py-2.5 font-medium">{tt("shp.wb.subs.col.subStatus")}</th>
                      <th className="px-3 py-2.5 font-medium">{tt("shp.wb.subs.col.stopReason")}</th>
                      <th className="px-3 py-2.5 font-medium">{tt("shp.wb.subs.col.carrier")}</th>
                      <th className="px-3 py-2.5 font-medium">{tt("shp.wb.subs.col.checks")}</th>
                      <th className="px-3 py-2.5 font-medium">{tt("shp.wb.subs.col.times")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subs.map((s) => (
                      <tr key={s.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2.5 text-[12px] text-ink">{s.provider || "—"}</td>
                        <td className="px-3 py-2.5 font-mono text-[11.5px] text-fg-muted">
                          {s.tracking_no}
                          {s.status && <span className="ml-1.5 rounded bg-surface-sunken px-1 py-0.5 text-[10px]" title={`${tt("shp.wb.subs.rawStatusTitle")}: ${s.status}`}>raw: {s.status}</span>}
                        </td>
                        <td className="px-3 py-2.5"><Badge variant={SUB_TONE[s.sub_status] ?? "muted"}>{tk(`shp.wb.subStatus.${s.sub_status}`)}</Badge></td>
                        <td className="px-3 py-2.5">
                          <Badge variant={STOP_TONE[s.stop_reason] ?? "muted"}>{tk(`shp.wb.stopReason.${s.stop_reason}`)}</Badge>
                          {s.stop_reason === "exception_timeout" && <p className="mt-1 text-[10.5px] text-destructive/80">{tt("shp.wb.stopReason.exceptionTimeoutHint")}</p>}
                          {s.stop_reason === "no_info" && <p className="mt-1 text-[10.5px] text-warning">{tt("shp.wb.stopReason.noInfoHint")}</p>}
                        </td>
                        <td className="px-3 py-2.5 text-[12px] text-muted-foreground">
                          {s.carrier_code || "—"}
                          <span className={cn("ml-1 text-[10.5px]", s.carrier_confirmed ? "text-success" : "text-fg-subtle")}>
                            {s.carrier_confirmed ? tt("shp.wb.subs.carrierConfirmed") : tt("shp.wb.subs.carrierGuessed")}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-[11.5px] text-muted-foreground">
                          {tt("shp.wb.subs.checkCount", { count: s.check_count })}
                          {s.error_count > 0 && <span className="ml-1 text-destructive">{tt("shp.wb.subs.errorCount", { count: s.error_count })}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-[11px] text-muted-foreground">
                          <div>{tt("shp.wb.subs.lastCheck")}: {fmtTime(s.last_check_at)}</div>
                          <div>{tt("shp.wb.subs.nextCheck")}: {fmtTime(s.next_check_at)}</div>
                          <div>{tt("shp.wb.subs.onlineAt")}: {fmtTime(s.online_at)} · {tt("shp.wb.subs.deliveredAt")}: {fmtTime(s.delivered_at)}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] leading-relaxed text-fg-subtle">{tt("shp.wb.footNote")}</p>
        </div>
      </div>
    </div>
  );
}
