// 运费报价：T1 运费试算（真调数据库函数 calc_freight_quote）+ T2 价卡管理（rate_cards / rate_zones / rate_bands）
// 铁律：价卡 status=active 后数据库触发器禁止原地改价，改价只能新建版本（version+1）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 【calc_freight_quote 实测契约】（2026-11-17 用 pg_get_function_arguments + 只读
//   `select * from calc_freight_quote(...)` 在生产库核验；Edge Function / 货代门户
//   请按同一契约实现，不要再猜）
//   入参（第一个是**报价卡 id，不是渠道 id**）：
//     p_rate_card_id uuid 必填 · p_country text · p_postal text · p_city text
//     p_weight_g numeric（恒为克）· p_length / p_width / p_height numeric（cm）
//   返回：RETURNS TABLE → PostgREST 给的是**对象数组**（长度恒为 1），12 列按序：
//     channel_id uuid · channel_name text · carrier text · zone_name text
//     charged_weight_g numeric · base_fee numeric · inc_fee numeric · total_fee numeric
//     currency text · rate_card_version integer · matched boolean · fail_reason text
//   语义：matched=false 时 fail_reason 必非空，且前 9 列里除 channel_id/channel_name/
//     carrier/currency/rate_card_version/charged_weight_g 外可能为 NULL；
//     计费重（体积重 = L×W×H ÷ volumetric_divisor × 1000）与取大规则都在**服务端**算，
//     前端只显示口径，不参与计算。
//   fail_reason 实测 8 种原文前缀：报价卡不存在（rate_cards.id=…）/ 报价卡已失效（status=…）/
//     报价卡不在生效区间（…）/ 计费重量缺失（p_weight_g 必须 > 0，单位克）/
//     报价卡 calc_mode=volumetric 但未配置 volumetric_divisor，无法计泡 /
//     计费重为 0（…）/ 无匹配分区（…）/ 无匹配重量段（…）——见下方 REASON_RULES。
//   函数是 STABLE + SECURITY INVOKER（跨租户拿不到别人的卡），只读、无副作用。
// ─────────────────────────────────────────────────────────────────────────────
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Ban, Calculator, Copy, Layers, Loader2, Lock, Pencil, Plus, RefreshCw, Trash2,
} from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/page-header";
import { callRpc, deleteRow, fetchTable, insertRow, queryTable, updateRow, type ExtRow } from "@/lib/data-access";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { tt, tk } from "@/i18n/tts";

export const Route = createFileRoute("/_layout/logistics/quote")({
  component: Quote,
});

// ============================ 通用工具 ============================
// 价卡列表服务端分页页大小 / 试算下拉的最大条数
const CARD_PAGE_SIZE = 20;
const CARD_PICKER_LIMIT = 200;

const selCls =
  "h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60";
const labelCls = "mb-1 block text-xs font-medium text-fg-muted";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const sv = (o: ExtRow, k: string): string => {
  const v = o[k];
  return v == null ? "" : String(v);
};
const nsv = (o: ExtRow, k: string): number | null => {
  const v = o[k];
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const av = (o: ExtRow, k: string): string[] => {
  const v = o[k];
  return Array.isArray(v) ? v.map((x) => (x == null ? "" : String(x))).filter(Boolean) : [];
};
const num = (v: number | string | null | undefined, digits = 4): string => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  let t = n.toFixed(digits);
  if (t.includes(".")) t = t.replace(/0+$/, "").replace(/\.$/, "");
  return t;
};
const dmy = (v: string): string => v || "—";
const shortId = (v: string): string => (v ? v.slice(0, 8) : "—");
const today = (): string => new Date().toISOString().slice(0, 10);
const splitList = (v: string): string[] =>
  v.split(/[,，;；\s]+/).map((x) => x.trim()).filter(Boolean);

// ============================ 行类型 ============================
interface ChannelRef { id: string; name: string; carrier: string }
interface WarehouseRef { id: string; name: string }
interface Card {
  id: string; channel_id: string; warehouse_id: string; name: string; version: number;
  currency: string; calc_mode: string; volumetric_divisor: number | null; weight_unit: string;
  billing_weight_rule: string; effective_from: string; effective_to: string; status: string;
  min_fee: number | null; notes: string; approved_by: string;
}
interface Zone {
  id: string; rate_card_id: string; name: string; zone_type: string; priority: number;
  countries: string[]; postal_patterns: string[]; cities: string[];
}
interface Band {
  id: string; zone_id: string; weight_from_g: number | null; weight_to_g: number | null;
  reg_fee: number | null; inc_fee: number | null; inc_unit_g: number | null;
  flat_price: number | null; min_fee: number | null; currency: string;
}
// calc_freight_quote 返回的 12 列（RETURNS TABLE，故 data 是数组）
interface QuoteRes {
  channel_id: string | null; channel_name: string | null; carrier: string | null;
  zone_name: string | null; charged_weight_g: number | null; base_fee: number | null;
  inc_fee: number | null; total_fee: number | null; currency: string | null;
  rate_card_version: number | null; matched: boolean; fail_reason: string | null;
}

const mapCard = (r: ExtRow): Card => ({
  id: r.id,
  channel_id: sv(r, "channel_id"),
  warehouse_id: sv(r, "warehouse_id"),
  name: sv(r, "name"),
  version: nsv(r, "version") ?? 1,
  currency: sv(r, "currency"),
  calc_mode: sv(r, "calc_mode"),
  volumetric_divisor: nsv(r, "volumetric_divisor"),
  weight_unit: sv(r, "weight_unit"),
  billing_weight_rule: sv(r, "billing_weight_rule"),
  effective_from: sv(r, "effective_from"),
  effective_to: sv(r, "effective_to"),
  status: sv(r, "status"),
  min_fee: nsv(r, "min_fee"),
  notes: sv(r, "notes"),
  approved_by: sv(r, "approved_by"),
});
const mapZone = (r: ExtRow): Zone => ({
  id: r.id,
  rate_card_id: sv(r, "rate_card_id"),
  name: sv(r, "name"),
  zone_type: sv(r, "zone_type"),
  priority: nsv(r, "priority") ?? 0,
  countries: av(r, "countries"),
  postal_patterns: av(r, "postal_patterns"),
  cities: av(r, "cities"),
});
const mapBand = (r: ExtRow): Band => ({
  id: r.id,
  zone_id: sv(r, "zone_id"),
  weight_from_g: nsv(r, "weight_from_g"),
  weight_to_g: nsv(r, "weight_to_g"),
  reg_fee: nsv(r, "reg_fee"),
  inc_fee: nsv(r, "inc_fee"),
  inc_unit_g: nsv(r, "inc_unit_g"),
  flat_price: nsv(r, "flat_price"),
  min_fee: nsv(r, "min_fee"),
  currency: sv(r, "currency"),
});
const mapQuoteRes = (r: ExtRow): QuoteRes => ({
  channel_id: sv(r, "channel_id") || null,
  channel_name: sv(r, "channel_name") || null,
  carrier: sv(r, "carrier") || null,
  zone_name: sv(r, "zone_name") || null,
  charged_weight_g: nsv(r, "charged_weight_g"),
  base_fee: nsv(r, "base_fee"),
  inc_fee: nsv(r, "inc_fee"),
  total_fee: nsv(r, "total_fee"),
  currency: sv(r, "currency") || null,
  rate_card_version: nsv(r, "rate_card_version"),
  matched: String(r["matched"]) === "true",
  fail_reason: sv(r, "fail_reason") || null,
});

// ============================ 枚举文案 ============================
const CARD_STATUS = ["draft", "active", "superseded", "retired"] as const;
const CALC_MODES = ["first_increment", "tiered", "flat", "volumetric"] as const;
const WEIGHT_RULES = ["max_actual_volumetric", "actual", "volumetric"] as const;
const ZONE_TYPES = ["country", "country_postal", "country_city", "postal_prefix", "fixed"] as const;

const cardStatusLabel = (v: string): string => tt(`lg.quote.status.${v}`);
const cardStatusTone = (v: string): BadgeProps["variant"] =>
  v === "active" ? "success" : v === "draft" ? "info" : v === "superseded" ? "warning" : "muted";
const calcModeLabel = (v: string): string =>
  CALC_MODES.includes(v as (typeof CALC_MODES)[number]) ? tt(`lg.quote.mode.${v}`) : v || "—";
const ruleLabel = (v: string): string =>
  WEIGHT_RULES.includes(v as (typeof WEIGHT_RULES)[number]) ? tt(`lg.quote.rule.${v}`) : v || "—";
const zoneTypeLabel = (v: string): string =>
  ZONE_TYPES.includes(v as (typeof ZONE_TYPES)[number]) ? tt(`lg.quote.zoneType.${v}`) : v || "—";

// ============================ 试算失败原因中文化 ============================
// 下面数组里的是「匹配数据库返回原文」的关键字（数据库 fail_reason 由 plpgsql 拼字符串，
// 可能中文也可能带英文 code），不是界面文案，故不进 i18n 字典。
const REASON_RULES: Array<{ match: string[]; titleKey: string; tipKey: string }> = [
  { match: ["报价卡不存在", "CARD_NOT_FOUND", "rate_card not found"], titleKey: "lg.quote.fail.cardMissing", tipKey: "lg.quote.fail.cardMissing.tip" },
  { match: ["已失效", "superseded", "retired", "EXPIRED", "INACTIVE"], titleKey: "lg.quote.fail.expired", tipKey: "lg.quote.fail.expired.tip" },
  { match: ["不在生效区间", "OUT_OF_RANGE", "not effective"], titleKey: "lg.quote.fail.outOfRange", tipKey: "lg.quote.fail.outOfRange.tip" },
  { match: ["计费重量缺失", "WEIGHT_MISSING", "p_weight_g"], titleKey: "lg.quote.fail.noWeight", tipKey: "lg.quote.fail.noWeight.tip" },
  { match: ["计费重为 0", "计费重为0", "ZERO_CHARGE"], titleKey: "lg.quote.fail.zeroCharge", tipKey: "lg.quote.fail.zeroCharge.tip" },
  { match: ["无法计泡", "volumetric_divisor", "NO_DIVISOR"], titleKey: "lg.quote.fail.noDivisor", tipKey: "lg.quote.fail.noDivisor.tip" },
  { match: ["无匹配分区", "NO_ZONE", "no matching zone"], titleKey: "lg.quote.fail.noZone", tipKey: "lg.quote.fail.noZone.tip" },
  { match: ["无匹配重量段", "重量段", "NO_BAND", "no matching band"], titleKey: "lg.quote.fail.noBand", tipKey: "lg.quote.fail.noBand.tip" },
];
function explainReason(raw: string): { title: string; tip: string } {
  const low = (raw || "").toLowerCase();
  for (const r of REASON_RULES) {
    if (r.match.some((m) => raw.includes(m) || low.includes(m.toLowerCase()))) {
      return { title: tt(r.titleKey), tip: tt(r.tipKey) };
    }
  }
  return { title: tt("lg.quote.fail.generic"), tip: tt("lg.quote.fail.generic.tip") };
}
// 同上：数据库触发器拒绝改价时的原文关键字
const isPriceLockError = (m: string): boolean =>
  m.includes("禁止原地改价") || m.includes("不可增删改") || m.includes("不可改挂") || m.includes("报价卡已生效");

// 数据库原文一律进 toast；命中改价铁律时补一句「请新建版本」
const toastDbError = (m: string) => {
  if (isPriceLockError(m)) toast.error(m, { description: tt("lg.quote.lockedNext"), duration: 9000 });
  else toast.error(m);
};

function Quote() {
  const [tab, setTab] = useState("calc");

  // 基础引用数据
  const [channels, setChannels] = useState<ChannelRef[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRef[]>([]);
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  // 数据列表
  const [calcCards, setCalcCards] = useState<Card[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadingCards, setLoadingCards] = useState(true);
  // 服务端分页：页码 0 起，总条数来自 PostgREST 的 exact count（不是本页行数）
  const [cardPage, setCardPage] = useState(0);
  const [cardTotal, setCardTotal] = useState<number | null>(null);

  // T1 试算表单
  const [channelId, setChannelId] = useState("");
  const [cardId, setCardId] = useState("");
  const [form, setForm] = useState({ country: "", postal: "", city: "", weight_g: "", length: "", width: "", height: "" });
  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState("");
  const [result, setResult] = useState<QuoteRes | null>(null);

  // T2 价卡弹窗
  const [cardDlg, setCardDlg] = useState(false);
  const [cardMode, setCardMode] = useState<"new" | "edit" | "version">("new");
  const [editingId, setEditingId] = useState("");
  const [cardForm, setCardForm] = useState(emptyCardForm());
  const [cardErr, setCardErr] = useState("");
  const [savingCard, setSavingCard] = useState(false);
  const [retiring, setRetiring] = useState<Card | null>(null);

  // 分区 / 重量段下钻
  const [drill, setDrill] = useState<Card | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneLoading, setZoneLoading] = useState(false);
  const [zoneId, setZoneId] = useState("");
  const [bands, setBands] = useState<Band[]>([]);
  const [bandLoading, setBandLoading] = useState(false);
  const [zoneForm, setZoneForm] = useState<ZoneForm | null>(null);
  const [bandForm, setBandForm] = useState<BandForm | null>(null);
  const [savingLine, setSavingLine] = useState(false);
  const [deletingZone, setDeletingZone] = useState<Zone | null>(null);
  const [deletingBand, setDeletingBand] = useState<Band | null>(null);

  function emptyCardForm() {
    return {
      channel_id: "", warehouse_id: "", name: "", version: "1", currency: "CNY",
      calc_mode: "first_increment", volumetric_divisor: "", weight_unit: "g",
      billing_weight_rule: "max_actual_volumetric", effective_from: today(), effective_to: "",
      status: "draft", min_fee: "0", notes: "",
    };
  }
  interface ZoneForm { id: string; name: string; zone_type: string; priority: string; countries: string; postal_patterns: string; cities: string }
  interface BandForm { id: string; weight_from_g: string; weight_to_g: string; reg_fee: string; inc_fee: string; inc_unit_g: string; flat_price: string; min_fee: string; currency: string }
  const emptyZoneForm = (): ZoneForm => ({ id: "", name: "", zone_type: "country", priority: "0", countries: "", postal_patterns: "", cities: "" });
  const emptyBandForm = (): BandForm => ({ id: "", weight_from_g: "", weight_to_g: "", reg_fee: "", inc_fee: "", inc_unit_g: "1000", flat_price: "", min_fee: "", currency: "" });

  const channelName = useCallback((id: string) => channels.find((c) => c.id === id)?.name || shortId(id), [channels]);
  const warehouseName = useCallback((id: string) => (id ? warehouses.find((w) => w.id === id)?.name || shortId(id) : tt("lg.quote.globalPrice")), [warehouses]);
  const userLabel = useCallback((id: string) => (id ? userNames[id] || shortId(id) : "—"), [userNames]);

  // ---------------- 加载 ----------------
  useEffect(() => {
    fetchTable("logistics_channels")
      .then((d) => setChannels(d.map((r) => ({ id: r.id, name: sv(r, "name"), carrier: sv(r, "carrier") }))))
      .catch((e) => toast.error(errMsg(e)));
    fetchTable("forwarder_warehouses")
      .then((d) => setWarehouses(d.map((r) => ({ id: r.id, name: sv(r, "name") }))))
      .catch(() => setWarehouses([]));
    fetchTable("profiles")
      .then((d) => {
        const m: Record<string, string> = {};
        for (const r of d) m[r.id] = sv(r, "username") || shortId(r.id);
        setUserNames(m);
      })
      .catch(() => setUserNames({}));
  }, []);

  // 试算下拉用的卡列表：渠道条件作为查询参数下推，limit 兜住传输量（不是全量拉取）
  const loadCalcCards = useCallback(() => {
    queryTable("rate_cards", {
      filters: channelId ? [{ field: "channel_id", value: channelId }] : [],
      order: { field: "created_at", ascending: false },
      limit: CARD_PICKER_LIMIT,
    })
      .then(({ rows }) => setCalcCards(rows.map(mapCard)))
      .catch((e) => toast.error(errMsg(e)));
  }, [channelId]);

  // 价卡管理列表：筛选 + 排序 + 分页 + 总条数全部在数据库完成
  const loadCards = useCallback(() => {
    setLoadingCards(true);
    queryTable("rate_cards", {
      filters: statusFilter === "all" ? [] : [{ field: "status", value: statusFilter }],
      order: { field: "created_at", ascending: false },
      range: { from: cardPage * CARD_PAGE_SIZE, to: cardPage * CARD_PAGE_SIZE + CARD_PAGE_SIZE - 1 },
      count: "exact",
    })
      .then(({ rows, count }) => { setCards(rows.map(mapCard)); setCardTotal(count); })
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoadingCards(false));
  }, [statusFilter, cardPage]);

  useEffect(() => { setCardPage(0); }, [statusFilter]);
  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { loadCalcCards(); }, [loadCalcCards]);

  const refreshAll = useCallback(() => { loadCards(); loadCalcCards(); }, [loadCards, loadCalcCards]);
  const cardTotalPages = Math.max(1, Math.ceil((cardTotal ?? 0) / CARD_PAGE_SIZE));

  // ---------------- T1：试算 ----------------
  // calcCards 已由服务端按渠道过滤（见 loadCalcCards），这里不再前端 filter
  const channelCards = calcCards;
  const card = useMemo(() => calcCards.find((c) => c.id === cardId) ?? null, [calcCards, cardId]);
  useEffect(() => {
    if (cardId && channelCards.some((c) => c.id === cardId)) return;
    setCardId(channelCards[0]?.id ?? "");
  }, [channelCards, cardId]);

  // 体积重口径展示（真正生效的计费重以数据库返回的 charged_weight_g 为准）
  const derived = useMemo(() => {
    const actual = Number(form.weight_g) || 0;
    const l = Number(form.length) || 0, w = Number(form.width) || 0, h = Number(form.height) || 0;
    const cm3 = l * w * h;
    const divisor = card?.volumetric_divisor ?? null;
    const volG = divisor && divisor > 0 && cm3 > 0 ? (cm3 / divisor) * 1000 : null;
    return { actual, cm3, divisor, volG };
  }, [form, card]);

  const runQuote = async () => {
    if (!cardId) { toast.error(tt("lg.quote.needCard")); return; }
    if (derived.actual <= 0) { toast.error(tt("lg.quote.needWeight")); return; }
    setQuoting(true);
    setQuoteErr("");
    setResult(null);
    try {
      const resp = await callRpc<ExtRow[] | ExtRow>("calc_freight_quote", {
        p_rate_card_id: cardId,
        p_country: form.country.trim() || null,
        p_postal: form.postal.trim() || null,
        p_city: form.city.trim() || null,
        p_weight_g: derived.actual,
        p_length: Number(form.length) || null,
        p_width: Number(form.width) || null,
        p_height: Number(form.height) || null,
      });
      // RETURNS TABLE 正常返回数组；万一只回一个对象也兼容掉，避免误报「没有返回行」
      const rows = Array.isArray(resp) ? resp : resp ? [resp] : [];
      const first = rows.length > 0 ? mapQuoteRes(rows[0]) : null;
      if (!first) { setQuoteErr(tt("lg.quote.emptyRpc")); return; }
      setResult(first);
    } catch (e) {
      setQuoteErr(errMsg(e));
      toast.error(errMsg(e));
    } finally {
      setQuoting(false);
    }
  };

  // ---------------- T2：价卡 CRUD ----------------
  const openNewCard = () => {
    setCardMode("new"); setEditingId(""); setCardErr("");
    setCardForm({ ...emptyCardForm(), channel_id: channelId || channels[0]?.id || "" });
    setCardDlg(true);
  };
  const openEditCard = (c: Card) => {
    setCardMode("edit"); setEditingId(c.id); setCardErr("");
    setCardForm({
      channel_id: c.channel_id, warehouse_id: c.warehouse_id, name: c.name, version: String(c.version),
      currency: c.currency, calc_mode: c.calc_mode, volumetric_divisor: c.volumetric_divisor == null ? "" : String(c.volumetric_divisor),
      weight_unit: c.weight_unit, billing_weight_rule: c.billing_weight_rule, effective_from: c.effective_from,
      effective_to: c.effective_to, status: c.status, min_fee: c.min_fee == null ? "0" : String(c.min_fee), notes: c.notes,
    });
    setCardDlg(true);
  };
  const openVersionCard = async (c: Card) => {
    // 下一版本号按渠道向数据库要（列表已分页，不能拿本页数据猜）
    let next = c.version + 1;
    try {
      const { rows } = await queryTable("rate_cards", {
        filters: [{ field: "channel_id", value: c.channel_id }],
        order: { field: "version", ascending: false },
        limit: 1,
      });
      if (rows.length > 0) next = (nsv(rows[0], "version") ?? c.version) + 1;
    } catch (e) { toast.error(errMsg(e)); }
    setCardMode("version"); setEditingId(""); setCardErr("");
    setCardForm({
      channel_id: c.channel_id, warehouse_id: c.warehouse_id, name: c.name, version: String(next),
      currency: c.currency, calc_mode: c.calc_mode, volumetric_divisor: c.volumetric_divisor == null ? "" : String(c.volumetric_divisor),
      weight_unit: c.weight_unit, billing_weight_rule: c.billing_weight_rule, effective_from: today(),
      effective_to: c.effective_to, status: "draft", min_fee: c.min_fee == null ? "0" : String(c.min_fee), notes: c.notes,
    });
    setCardDlg(true);
  };

  const locked = cardMode === "edit" && cardForm.status === "active";

  const saveCard = async () => {
    setCardErr("");
    if (!cardForm.channel_id) { setCardErr(tt("lg.quote.needChannel")); return; }
    if (!cardForm.name.trim()) { setCardErr(tt("lg.quote.needName")); return; }
    if (!cardForm.effective_from) { setCardErr(tt("lg.quote.needEffective")); return; }
    if (cardForm.effective_to && cardForm.effective_to < cardForm.effective_from) { setCardErr(tt("lg.quote.badRange")); return; }
    setSavingCard(true);
    try {
      const full: Record<string, unknown> = {
        channel_id: cardForm.channel_id,
        warehouse_id: cardForm.warehouse_id || null,
        name: cardForm.name.trim(),
        version: Number(cardForm.version) || 1,
        currency: cardForm.currency.trim() || "CNY",
        calc_mode: cardForm.calc_mode,
        volumetric_divisor: cardForm.volumetric_divisor === "" ? null : Number(cardForm.volumetric_divisor),
        weight_unit: cardForm.weight_unit,
        billing_weight_rule: cardForm.billing_weight_rule,
        effective_from: cardForm.effective_from,
        effective_to: cardForm.effective_to || null,
        status: cardForm.status,
        min_fee: cardForm.min_fee === "" ? 0 : Number(cardForm.min_fee),
        notes: cardForm.notes.trim() || null,
      };
      if (cardMode === "edit") {
        // active 卡：数据库冻结价格结构字段，这里只提交允许改的列，避免无谓的触发器报错
        const patch = locked
          ? { name: full.name, notes: full.notes, status: full.status }
          : full;
        await updateRow("rate_cards", editingId, patch);
        toast.success(tt("lg.quote.updated"));
      } else {
        await insertRow("rate_cards", full);
        toast.success(cardMode === "version" ? tt("lg.quote.versionCreated") : tt("lg.quote.created"));
      }
      setCardDlg(false);
      refreshAll();
    } catch (e) {
      const m = errMsg(e);
      setCardErr(m);
      toastDbError(m);
    } finally {
      setSavingCard(false);
    }
  };
  const doRetire = async () => {
    if (!retiring) return;
    try {
      await updateRow("rate_cards", retiring.id, { status: "retired" });
      toast.success(tt("lg.quote.retired"));
      refreshAll();
    } catch (e) { toastDbError(errMsg(e)); }
    finally { setRetiring(null); }
  };

  // ---------------- 分区 / 重量段 ----------------
  // 子表按父键 eq 下推 + 数据库排序（父键唯一，量小，不分页）
  const loadZones = useCallback((cardPk: string): Promise<Zone[]> =>
    queryTable("rate_zones", {
      filters: [{ field: "rate_card_id", value: cardPk }],
      order: { field: "priority", ascending: false },
    })
      .then(({ rows }) => {
        const list = rows.map(mapZone);
        setZones(list);
        return list;
      })
      .catch((e) => { toast.error(errMsg(e)); return [] as Zone[]; }), []);

  const loadBands = useCallback((zonePk: string) => {
    if (!zonePk) { setBands([]); return; }
    setBandLoading(true);
    queryTable("rate_bands", {
      filters: [{ field: "zone_id", value: zonePk }],
      order: { field: "weight_from_g", ascending: true },
    })
      .then(({ rows }) => setBands(rows.map(mapBand)))
      .catch((e) => { toast.error(errMsg(e)); setBands([]); })
      .finally(() => setBandLoading(false));
  }, []);

  const openDrill = async (c: Card) => {
    setDrill(c); setZones([]); setBands([]); setZoneId(""); setZoneForm(null); setBandForm(null);
    setZoneLoading(true);
    try {
      const list = await loadZones(c.id);
      if (list.length > 0) { setZoneId(list[0].id); loadBands(list[0].id); }
    } finally { setZoneLoading(false); }
  };

  const saveZone = async () => {
    if (!drill || !zoneForm) return;
    setSavingLine(true);
    const payload: Record<string, unknown> = {
      rate_card_id: drill.id,
      name: zoneForm.name.trim() || tt("lg.quote.zoneDefaultName"),
      zone_type: zoneForm.zone_type,
      priority: Number(zoneForm.priority) || 0,
      countries: splitList(zoneForm.countries),
      postal_patterns: splitList(zoneForm.postal_patterns),
      cities: splitList(zoneForm.cities),
    };
    try {
      if (zoneForm.id) await updateRow("rate_zones", zoneForm.id, payload);
      else await insertRow("rate_zones", payload);
      toast.success(tt("lg.quote.zoneSaved"));
      setZoneForm(null);
      const list = await loadZones(drill.id);
      if (!zoneForm.id && list.length > 0) {
        const created = [...list].reverse().find((z) => z.name === payload.name);
        if (created) { setZoneId(created.id); loadBands(created.id); }
      }
    } catch (e) { toastDbError(errMsg(e)); }
    finally { setSavingLine(false); }
  };

  const saveBand = async () => {
    if (!zoneId || !bandForm) return;
    const from = Number(bandForm.weight_from_g), to = Number(bandForm.weight_to_g);
    if (!Number.isFinite(from) || !Number.isFinite(to) || bandForm.weight_from_g === "" || bandForm.weight_to_g === "") {
      toast.error(tt("lg.quote.band.needRange")); return;
    }
    if (to <= from) { toast.error(tt("lg.quote.band.badRange")); return; }
    setSavingLine(true);
    const n = (v: string): number | null => (v === "" ? null : Number(v));
    const payload: Record<string, unknown> = {
      zone_id: zoneId,
      weight_from_g: from,
      weight_to_g: to,
      reg_fee: n(bandForm.reg_fee),
      inc_fee: n(bandForm.inc_fee),
      inc_unit_g: bandForm.inc_unit_g === "" ? 1000 : Number(bandForm.inc_unit_g),
      flat_price: n(bandForm.flat_price),
      min_fee: n(bandForm.min_fee),
      currency: bandForm.currency.trim() || null,
    };
    try {
      if (bandForm.id) await updateRow("rate_bands", bandForm.id, payload);
      else await insertRow("rate_bands", payload);
      toast.success(tt("lg.quote.bandSaved"));
      setBandForm(null);
      loadBands(zoneId);
    } catch (e) { toastDbError(errMsg(e)); }
    finally { setSavingLine(false); }
  };

  const doDeleteZone = async () => {
    if (!drill || !deletingZone) return;
    try {
      await deleteRow("rate_zones", deletingZone.id);
      toast.success(tt("lg.quote.zoneDeleted"));
      if (zoneId === deletingZone.id) { setZoneId(""); setBands([]); }
      loadZones(drill.id);
    } catch (e) { toastDbError(errMsg(e)); }
    finally { setDeletingZone(null); }
  };
  const doDeleteBand = async () => {
    if (!deletingBand) return;
    try {
      await deleteRow("rate_bands", deletingBand.id);
      toast.success(tt("lg.quote.bandDeleted"));
      loadBands(deletingBand.zone_id);
    } catch (e) { toastDbError(errMsg(e)); }
    finally { setDeletingBand(null); }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={tt("lg.quote.title")}
        description={tt("lg.quote.desc")}
        code="FREIGHT RATE"
        actions={
          <Button variant="outline" size="sm" onClick={() => { refreshAll(); toast.success(tt("lg.quote.reloaded")); }}>
            <RefreshCw size={14} className="mr-1.5" />{tt("lg.quote.reload")}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="calc">{tt("lg.quote.tab.calc")}</TabsTrigger>
          <TabsTrigger value="cards">{tt("lg.quote.tab.cards")}</TabsTrigger>
        </TabsList>

        {/* ============== T1 运费试算 ============== */}
        <TabsContent value="calc" className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className={labelCls}>{tt("lg.quote.channel")}</Label>
                <select className={selCls} value={channelId} onChange={(e) => { setChannelId(e.target.value); setCardId(""); setResult(null); }}>
                  <option value="">{tt("lg.quote.allChannels")}</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{tk(c.name)}{c.carrier ? ` · ${tk(c.carrier)}` : ""}</option>)}
                </select>
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.quote.rateCard")}</Label>
                <select className={selCls} value={cardId} onChange={(e) => { setCardId(e.target.value); setResult(null); }} disabled={channelCards.length === 0}>
                  {channelCards.length === 0
                    ? <option value="">{tt("lg.quote.noCardOption")}</option>
                    : channelCards.map((c) => (
                      <option key={c.id} value={c.id}>{tk(c.name)} · v{c.version} · {c.currency} · {cardStatusLabel(c.status)}</option>
                    ))}
                </select>
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.quote.country")}</Label>
                <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder={tt("lg.quote.countryPh")} />
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.quote.postal")}</Label>
                <Input value={form.postal} onChange={(e) => setForm({ ...form, postal: e.target.value })} placeholder={tt("lg.quote.postalPh")} />
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.quote.city")}</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder={tt("lg.quote.cityPh")} />
              </div>
              <div>
                <Label className={labelCls}>{tt("lg.quote.weightG")} <span className="text-destructive">*</span></Label>
                <Input type="number" min="0" value={form.weight_g} onChange={(e) => setForm({ ...form, weight_g: e.target.value })} placeholder="350" />
              </div>
              <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                {(["length", "width", "height"] as const).map((k) => (
                  <div key={k}>
                    <Label className={labelCls}>{tt(`lg.quote.${k}`)} (cm)</Label>
                    <Input type="number" min="0" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} placeholder="0" />
                  </div>
                ))}
              </div>
            </div>

            {/* 选中价卡的计费口径 */}
            {card && (
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-xl bg-muted/40 px-4 py-3 text-xs text-fg-muted sm:grid-cols-3 lg:grid-cols-6">
                <div><span className="block text-[11px]">{tt("lg.quote.calcMode")}</span><span className="font-medium text-fg">{calcModeLabel(card.calc_mode)}</span></div>
                <div><span className="block text-[11px]">{tt("lg.quote.billingRule")}</span><span className="font-medium text-fg">{ruleLabel(card.billing_weight_rule)}</span></div>
                <div><span className="block text-[11px]">{tt("lg.quote.divisor")}</span><span className="font-medium text-fg">{card.volumetric_divisor == null ? tt("lg.quote.divisorOff") : `${num(card.volumetric_divisor, 2)} cm³/kg`}</span></div>
                <div><span className="block text-[11px]">{tt("lg.quote.cardMinFee")}</span><span className="font-medium text-fg">{num(card.min_fee)} {card.currency}</span></div>
                <div><span className="block text-[11px]">{tt("lg.quote.effective")}</span><span className="font-medium text-fg">{dmy(card.effective_from)} ~ {card.effective_to ? dmy(card.effective_to) : tt("lg.quote.longRun")}</span></div>
                <div><span className="block text-[11px]">{tt("lg.quote.weightUnit")}</span><span className="font-medium text-fg">{card.weight_unit || "g"}</span></div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={runQuote} disabled={quoting || !cardId}>
                {quoting ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Calculator size={15} className="mr-1.5" />}
                {tt("lg.quote.doCalc")}
              </Button>
              <span className="text-xs text-fg-muted">{tt("lg.quote.rpcNote")}</span>
            </div>

            {channels.length === 0 && (
              <p className="mt-3 text-xs text-warning">{tt("lg.quote.noChannelHint")}</p>
            )}
            {channels.length > 0 && calcCards.length === 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning">
                <AlertTriangle size={13} />{tt("lg.quote.noCardHint")}
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { setTab("cards"); openNewCard(); }}>{tt("lg.quote.goNewCard")}</Button>
              </div>
            )}
          </div>

          {/* 计费重推导（口径解释，数值以数据库返回为准） */}
          {card && (
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h3 className="mb-2 font-display text-sm font-semibold text-ink">{tt("lg.quote.deriveTitle")}</h3>
              <div className="space-y-1 font-data text-xs text-fg-muted">
                <p>{tt("lg.quote.derive.actual")}：<span className="font-medium text-fg">{num(derived.actual, 3)} g</span></p>
                <p>
                  {tt("lg.quote.derive.volume")}：<span className="font-medium text-fg">
                    {derived.cm3 > 0 ? `${num(derived.cm3, 2)} cm³` : tt("lg.quote.derive.noDims")}
                  </span>
                </p>
                <p>
                  {tt("lg.quote.derive.volWeight")} = {tt("lg.quote.derive.formula")}
                  <span className="font-medium text-fg">
                    {derived.volG == null
                      ? (derived.divisor == null ? tt("lg.quote.derive.noDivisor") : tt("lg.quote.derive.noDims"))
                      : `${num(derived.volG, 3)} g`}
                  </span>
                </p>
                <p>
                  {tt("lg.quote.derive.rule")}：<span className="font-medium text-fg">{ruleLabel(card.billing_weight_rule)}</span>
                  {" → "}
                  <span className="font-medium text-fg">
                    {card.calc_mode === "volumetric" || card.billing_weight_rule === "volumetric"
                      ? tt("lg.quote.derive.onlyVol")
                      : card.billing_weight_rule === "actual"
                        ? tt("lg.quote.derive.onlyActual")
                        : `max(${num(derived.actual, 3)} g, ${derived.volG == null ? "0 g" : `${num(derived.volG, 3)} g`})`}
                  </span>
                </p>
                <p className="pt-1 text-[11px] text-fg-muted">{tt("lg.quote.derive.footnote")}</p>
              </div>
            </div>
          )}

          {/* 试算结果 */}
          {quoting && (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-card py-10 text-sm text-muted-foreground">
              <Loader2 size={18} className="mr-2 animate-spin" />{tt("lg.quote.calcLoading")}
            </div>
          )}
          {!quoting && quoteErr && (
            <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive"><AlertTriangle size={15} />{tt("lg.quote.calcFailed")}</div>
              <pre className="mt-2 whitespace-pre-wrap break-all font-data text-xs text-destructive/90">{quoteErr}</pre>
            </div>
          )}
          {!quoting && !quoteErr && !result && (
            <div className="rounded-2xl border border-dashed border-border bg-card py-12 text-center text-sm text-muted-foreground">
              {tt("lg.quote.calcIdle")}
            </div>
          )}

          {!quoting && result && (
            <div className={cn("rounded-2xl border bg-card p-5 shadow-sm", result.matched ? "border-success/40" : "border-warning/50")}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant={result.matched ? "success" : "warning"}>{result.matched ? tt("lg.quote.matched") : tt("lg.quote.unmatched")}</Badge>
                <span className="text-sm font-medium text-ink">{result.matched ? tt("lg.quote.matchedTitle") : explainReason(result.fail_reason ?? "").title}</span>
              </div>

              {!result.matched && (
                <div className="mb-4 rounded-xl bg-warning-bg px-4 py-3 text-xs text-warning">
                  <p className="font-medium">{explainReason(result.fail_reason ?? "").title}</p>
                  <p className="mt-1">{explainReason(result.fail_reason ?? "").tip}</p>
                  <p className="mt-2 break-all font-data text-[11px] text-warning/80">{tt("lg.quote.rawReason")}：{result.fail_reason || "—"}</p>
                </div>
              )}

              {/* 数据库返回的 12 列 */}
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3 lg:grid-cols-4">
                {[
                  { label: tt("lg.quote.col.channelName"), value: result.channel_name ? tk(result.channel_name) : "—" },
                  { label: tt("lg.quote.col.carrier"), value: result.carrier ? tk(result.carrier) : "—" },
                  { label: tt("lg.quote.col.zoneName"), value: result.zone_name || "—" },
                  { label: tt("lg.quote.col.chargedWeight"), value: result.charged_weight_g == null ? "—" : `${num(result.charged_weight_g, 3)} g` },
                  { label: tt("lg.quote.col.baseFee"), value: num(result.base_fee) },
                  { label: tt("lg.quote.col.incFee"), value: num(result.inc_fee) },
                  { label: tt("lg.quote.col.totalFee"), value: num(result.total_fee), strong: true },
                  { label: tt("lg.quote.col.currency"), value: result.currency || "—" },
                  { label: tt("lg.quote.col.version"), value: result.rate_card_version == null ? "—" : `v${result.rate_card_version}` },
                  { label: tt("lg.quote.col.channelId"), value: shortId(result.channel_id ?? "") },
                  { label: tt("lg.quote.col.matched"), value: String(result.matched) },
                  { label: tt("lg.quote.col.failReason"), value: result.fail_reason || "—" },
                ].map((c) => (
                  <div key={c.label} className="bg-card px-3 py-2.5">
                    <div className="text-[11px] text-fg-muted">{c.label}</div>
                    <div className={cn("mt-0.5 break-all font-data text-[13px]", (c as { strong?: boolean }).strong ? "text-[16px] font-semibold text-primary" : "text-fg")}>{c.value}</div>
                  </div>
                ))}
              </div>

              {result.matched && (
                <p className="mt-3 text-xs text-fg-muted">
                  {tt("lg.quote.formulaNote", { v1: calcModeLabel(card?.calc_mode ?? "") })}
                  {" · "}
                  {tt("lg.quote.totalFormula")}：{num(result.base_fee)} + {num(result.inc_fee)} = {num(result.total_fee)} {result.currency ?? ""}
                  （{tt("lg.quote.cardMinFee")} {num(card?.min_fee)} {card?.currency ?? ""}）
                </p>
              )}
            </div>
          )}
        </TabsContent>

        {/* ============== T2 价卡管理 ============== */}
        <TabsContent value="cards" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-end gap-2">
              <div>
                <Label className={labelCls}>{tt("lg.quote.statusFilter")}</Label>
                <select className={cn(selCls, "w-40")} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">{tt("lg.quote.status.all")}</option>
                  {CARD_STATUS.map((x) => <option key={x} value={x}>{cardStatusLabel(x)}</option>)}
                </select>
              </div>
              <p className="pb-2 text-xs text-fg-muted">{tt("lg.quote.filterDbNote")}</p>
            </div>
            <Button size="sm" onClick={openNewCard}><Plus size={15} className="mr-1.5" />{tt("lg.quote.newCard")}</Button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
            <table className="w-full min-w-[1080px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  {[tt("lg.quote.col.channel"), tt("lg.quote.col.cardName"), tt("lg.quote.col.ver"), tt("lg.quote.col.currency"),
                    tt("lg.quote.col.calcMode"), tt("lg.quote.col.effective"), tt("lg.common.status"), tt("lg.quote.col.minFee"),
                    tt("lg.quote.col.approver"), tt("lg.quote.col.warehouse"), tt("lg.common.actions")].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingCards ? (
                  <tr><td colSpan={11} className="px-4 py-12 text-center text-muted-foreground"><Loader2 size={18} className="mx-auto mb-2 animate-spin" />{tt("lg.common.loading")}</td></tr>
                ) : cards.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center text-muted-foreground">
                      <p>{cardTotal === 0 ? tt("lg.quote.cardsEmpty") : tt("lg.quote.cardsEmptyFiltered")}</p>
                      <p className="mt-1 text-xs">{tt("lg.quote.cardsEmptyNext")}</p>
                      <Button size="sm" variant="outline" className="mt-3" onClick={openNewCard}><Plus size={14} className="mr-1" />{tt("lg.quote.newCard")}</Button>
                    </td>
                  </tr>
                ) : cards.map((c) => (
                  <tr key={c.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/50">
                    <td className="px-3 py-2.5 font-medium text-ink">{tk(channelName(c.channel_id))}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-ink">{tk(c.name)}</div>
                      {c.notes && <div className="max-w-[220px] truncate text-[11px] text-fg-muted" title={c.notes}>{c.notes}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-data">v{c.version}</td>
                    <td className="px-3 py-2.5 font-data">{c.currency}</td>
                    <td className="px-3 py-2.5">{calcModeLabel(c.calc_mode)}<span className="ml-1 text-[11px] text-fg-muted">{ruleLabel(c.billing_weight_rule)}</span></td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-data text-xs">{dmy(c.effective_from)} ~ {c.effective_to ? dmy(c.effective_to) : tt("lg.quote.longRun")}</td>
                    <td className="px-3 py-2.5"><Badge variant={cardStatusTone(c.status)}>{cardStatusLabel(c.status)}</Badge></td>
                    <td className="px-3 py-2.5 font-data">{num(c.min_fee)}</td>
                    <td className="px-3 py-2.5 text-xs text-fg-muted">{userLabel(c.approved_by)}</td>
                    <td className="px-3 py-2.5 text-xs text-fg-muted">{warehouseName(c.warehouse_id)}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => openDrill(c)}><Layers size={13} className="mr-1" />{tt("lg.quote.zoneBand")}</Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title={tt("lg.quote.edit")} onClick={() => openEditCard(c)}><Pencil size={14} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title={tt("lg.quote.newVersion")} disabled={c.status === "retired"} onClick={() => void openVersionCard(c)}><Copy size={14} /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title={tt("lg.quote.retire")} disabled={c.status === "retired"} onClick={() => setRetiring(c)}><Ban size={14} /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* 服务端分页：页码只翻数据库 range，总条数来自 count:"exact" */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
              <span className="font-data text-xs text-fg-muted">
                {tt("lg.common.pageInfo", { v1: cardPage + 1, v2: cardTotalPages, v3: cardTotal ?? cards.length })}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={cardPage === 0 || loadingCards} onClick={() => setCardPage((v) => v - 1)}>{tt("lg.common.prev")}</Button>
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={cardPage + 1 >= cardTotalPages || loadingCards} onClick={() => setCardPage((v) => v + 1)}>{tt("lg.common.next")}</Button>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-muted/50 px-4 py-3 text-xs text-fg-muted">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <span>{tt("lg.quote.immutableRule")}</span>
          </div>
        </TabsContent>
      </Tabs>

      {/* ============== 价卡 新建/编辑/新建版本 弹窗 ============== */}
      <Dialog open={cardDlg} onOpenChange={setCardDlg}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {cardMode === "new" ? tt("lg.quote.dlg.new") : cardMode === "version" ? tt("lg.quote.dlg.version") : tt("lg.quote.dlg.edit")}
            </DialogTitle>
            <DialogDescription>{cardMode === "version" ? tt("lg.quote.dlg.versionDesc") : tt("lg.quote.dlg.desc")}</DialogDescription>
          </DialogHeader>

          {cardMode === "version" && (
            <div className="rounded-lg bg-info-bg px-3 py-2 text-xs text-info">{tt("lg.quote.ukHint")}</div>
          )}
          {locked && (
            <div className="flex items-start justify-between gap-3 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning">
              <span className="flex items-start gap-1.5"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{tt("lg.quote.lockedBanner")}</span>
              <Button size="sm" variant="outline" className="h-7 shrink-0 px-2 text-xs" onClick={() => {
                const src = cards.find((x) => x.id === editingId);
                if (src) openVersionCard(src);
              }}>{tt("lg.quote.switchToVersion")}</Button>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label className={labelCls}>{tt("lg.quote.channel")} *</Label>
              <select className={selCls} value={cardForm.channel_id} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, channel_id: e.target.value })}>
                <option value="">{tt("lg.quote.pleasePick")}</option>
                {channels.map((c) => <option key={c.id} value={c.id}>{tk(c.name)}</option>)}
              </select>
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.col.warehouse")}</Label>
              <select className={selCls} value={cardForm.warehouse_id} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, warehouse_id: e.target.value })}>
                <option value="">{tt("lg.quote.globalPrice")}</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{tk(w.name)}</option>)}
              </select>
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.col.cardName")} *</Label>
              <Input value={cardForm.name} onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })} placeholder={tt("lg.quote.namePh")} />
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.col.ver")}</Label>
              <Input type="number" min="1" value={cardForm.version} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, version: e.target.value })} />
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.col.currency")}</Label>
              <Input value={cardForm.currency} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, currency: e.target.value })} placeholder="CNY / USD" />
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.calcMode")}</Label>
              <select className={selCls} value={cardForm.calc_mode} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, calc_mode: e.target.value })}>
                {CALC_MODES.map((m) => <option key={m} value={m}>{calcModeLabel(m)}</option>)}
              </select>
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.billingRule")}</Label>
              <select className={selCls} value={cardForm.billing_weight_rule} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, billing_weight_rule: e.target.value })}>
                {WEIGHT_RULES.map((m) => <option key={m} value={m}>{ruleLabel(m)}</option>)}
              </select>
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.divisor")}</Label>
              <Input type="number" min="0" value={cardForm.volumetric_divisor} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, volumetric_divisor: e.target.value })} placeholder="5000 / 6000 / 8000" />
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.weightUnit")}</Label>
              <select className={selCls} value={cardForm.weight_unit} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, weight_unit: e.target.value })}>
                {["g", "kg", "lb"].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.effFrom")} *</Label>
              <Input type="date" value={cardForm.effective_from} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, effective_from: e.target.value })} />
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.effTo")}</Label>
              <Input type="date" value={cardForm.effective_to} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, effective_to: e.target.value })} />
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.quote.col.minFee")}</Label>
              <Input type="number" min="0" value={cardForm.min_fee} disabled={locked} onChange={(e) => setCardForm({ ...cardForm, min_fee: e.target.value })} />
            </div>
            <div>
              <Label className={labelCls}>{tt("lg.common.status")}</Label>
              <select className={selCls} value={cardForm.status} onChange={(e) => setCardForm({ ...cardForm, status: e.target.value })}>
                {CARD_STATUS.map((m) => <option key={m} value={m}>{cardStatusLabel(m)}</option>)}
              </select>
            </div>
            <div className="sm:col-span-3">
              <Label className={labelCls}>{tt("lg.quote.notes")}</Label>
              <Textarea rows={2} value={cardForm.notes} onChange={(e) => setCardForm({ ...cardForm, notes: e.target.value })} />
            </div>
          </div>

          {cardErr && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <p className="font-medium">{isPriceLockError(cardErr) && cardMode === "edit" ? tt("lg.quote.lockedTitle") : tt("lg.quote.saveFailed")}</p>
              <pre className="mt-1 whitespace-pre-wrap break-all font-data">{cardErr}</pre>
              {isPriceLockError(cardErr) && <p className="mt-1 text-warning">{tt("lg.quote.lockedNext")}</p>}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCardDlg(false)}>{tt("lg.common.cancel")}</Button>
            <Button onClick={saveCard} disabled={savingCard}>
              {savingCard ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : null}{tt("lg.common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============== 分区 / 重量段 下钻弹窗 ============== */}
      <Dialog open={!!drill} onOpenChange={(o) => { if (!o) { setDrill(null); setZoneForm(null); setBandForm(null); } }}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tt("lg.quote.drillTitle")}{drill ? ` · ${tk(drill.name)} v${drill.version}` : ""}</DialogTitle>
            <DialogDescription>{tt("lg.quote.drillDesc")}</DialogDescription>
          </DialogHeader>

          {drill?.status === "active" && (
            <div className="flex items-start gap-1.5 rounded-lg bg-warning-bg px-3 py-2 text-xs text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />{tt("lg.quote.lockedZoneBanner")}
            </div>
          )}
          <div className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-fg-muted">
            {tt("lg.quote.zoneOrderHint")} {ZONE_TYPES.map((z) => zoneTypeLabel(z)).join(" > ")}
          </div>

          {/* 分区 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-ink">{tt("lg.quote.zones")}（{zones.length}）</h4>
              <Button size="sm" variant="outline" disabled={drill?.status === "active" || !!zoneForm} onClick={() => setZoneForm(emptyZoneForm())}>
                <Plus size={14} className="mr-1" />{tt("lg.quote.addZone")}
              </Button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    {[tt("lg.quote.zone.name"), tt("lg.quote.zone.type"), tt("lg.quote.zone.countries"), tt("lg.quote.zone.postals"),
                      tt("lg.quote.zone.cities"), tt("lg.quote.zone.priority"), tt("lg.quote.zone.bands"), tt("lg.common.actions")].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {zoneLoading ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground"><Loader2 size={16} className="mx-auto mb-1 animate-spin" />{tt("lg.common.loading")}</td></tr>
                  ) : (
                    <>
                      {zoneForm && !zoneForm.id && (
                        <ZoneRowEditor form={zoneForm} setForm={setZoneForm} onSave={saveZone} onCancel={() => setZoneForm(null)} saving={savingLine} />
                      )}
                      {zones.length === 0 && !(zoneForm && !zoneForm.id) ? (
                        <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          <p>{tt("lg.quote.zoneEmpty")}</p>
                          <p className="mt-1 text-xs">{tt("lg.quote.zoneEmptyNext")}</p>
                        </td></tr>
                      ) : zones.map((z) => zoneForm?.id === z.id ? (
                        <ZoneRowEditor key={z.id} form={zoneForm} setForm={setZoneForm} onSave={saveZone} onCancel={() => setZoneForm(null)} saving={savingLine} />
                      ) : (
                    <tr key={z.id} className={cn("border-b border-border last:border-0", zoneId === z.id ? "bg-primary/5" : "hover:bg-muted/40")}>
                      <td className="px-3 py-2 font-medium text-ink">{tk(z.name)}</td>
                      <td className="px-3 py-2"><Badge variant="outline">{zoneTypeLabel(z.zone_type)}</Badge></td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{z.countries.join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{z.postal_patterns.join(", ") || "—"}</td>
                      <td className="px-3 py-2 text-xs text-fg-muted">{z.cities.join(", ") || "—"}</td>
                      <td className="px-3 py-2 font-data">{z.priority}</td>
                      <td className="px-3 py-2"><Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setZoneId(z.id); setBandForm(null); loadBands(z.id); }}>{z.id === zoneId ? tt("lg.quote.zone.selected") : tt("lg.quote.zone.viewBands")}</Button></td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={drill?.status === "active"} onClick={() => setZoneForm({ id: z.id, name: z.name, zone_type: z.zone_type, priority: String(z.priority), countries: z.countries.join(", "), postal_patterns: z.postal_patterns.join(", "), cities: z.cities.join(", ") })}><Pencil size={13} /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={drill?.status === "active"} onClick={() => setDeletingZone(z)}><Trash2 size={13} /></Button>
                        </div>
                      </td>
                    </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* 重量段 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-ink">
                {tt("lg.quote.bands")}{zoneId ? ` · ${tk(zones.find((z) => z.id === zoneId)?.name ?? "")}` : ""}
              </h4>
              <Button size="sm" variant="outline" disabled={!zoneId || drill?.status === "active" || !!bandForm} onClick={() => setBandForm(emptyBandForm())}>
                <Plus size={14} className="mr-1" />{tt("lg.quote.addBand")}
              </Button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                    {[tt("lg.quote.band.from"), tt("lg.quote.band.to"), tt("lg.quote.band.regFee"), tt("lg.quote.band.incFee"),
                      tt("lg.quote.band.incUnit"), tt("lg.quote.band.flat"), tt("lg.quote.band.minFee"), tt("lg.quote.col.currency"), tt("lg.common.actions")].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bandLoading ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground"><Loader2 size={16} className="mx-auto mb-1 animate-spin" />{tt("lg.common.loading")}</td></tr>
                  ) : (
                    <>
                      {bandForm && !bandForm.id && (
                        <BandRowEditor form={bandForm} setForm={setBandForm} onSave={saveBand} onCancel={() => setBandForm(null)} saving={savingLine} />
                      )}
                      {bands.length === 0 && !(bandForm && !bandForm.id) ? (
                        <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">
                          {zoneId ? tt("lg.quote.bandEmpty") : tt("lg.quote.bandPickZone")}
                          <p className="mt-1 text-xs">{tt("lg.quote.bandEmptyNext")}</p>
                        </td></tr>
                      ) : bands.map((b) => bandForm?.id === b.id ? (
                        <BandRowEditor key={b.id} form={bandForm} setForm={setBandForm} onSave={saveBand} onCancel={() => setBandForm(null)} saving={savingLine} />
                      ) : (
                    <tr key={b.id} className="border-b border-border font-data last:border-0 hover:bg-muted/40">
                      <td className="px-3 py-2">{num(b.weight_from_g, 3)}</td>
                      <td className="px-3 py-2">{num(b.weight_to_g, 3)}</td>
                      <td className="px-3 py-2">{num(b.reg_fee)}</td>
                      <td className="px-3 py-2">{num(b.inc_fee)}</td>
                      <td className="px-3 py-2">{num(b.inc_unit_g, 3)}</td>
                      <td className="px-3 py-2">{num(b.flat_price)}</td>
                      <td className="px-3 py-2">{num(b.min_fee)}</td>
                      <td className="px-3 py-2 text-xs">{b.currency || "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={drill?.status === "active"} onClick={() => setBandForm({
                            id: b.id, weight_from_g: b.weight_from_g == null ? "" : String(b.weight_from_g),
                            weight_to_g: b.weight_to_g == null ? "" : String(b.weight_to_g),
                            reg_fee: b.reg_fee == null ? "" : String(b.reg_fee), inc_fee: b.inc_fee == null ? "" : String(b.inc_fee),
                            inc_unit_g: b.inc_unit_g == null ? "1000" : String(b.inc_unit_g),
                            flat_price: b.flat_price == null ? "" : String(b.flat_price),
                            min_fee: b.min_fee == null ? "" : String(b.min_fee), currency: b.currency,
                          })}><Pencil size={13} /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" disabled={drill?.status === "active"} onClick={() => setDeletingBand(b)}><Trash2 size={13} /></Button>
                        </div>
                      </td>
                    </tr>
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-fg-muted">{tt("lg.quote.bandRuleHint")}</p>
          </div>
        </DialogContent>
      </Dialog>

      {/* 停用确认 */}
      <AlertDialog open={!!retiring} onOpenChange={(o) => { if (!o) setRetiring(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tt("lg.quote.retireConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tt("lg.quote.retireConfirmDesc", { v1: retiring ? tk(retiring.name) : "", v2: retiring ? `v${retiring.version}` : "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt("lg.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={doRetire}>{tt("lg.common.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 分区删除确认 */}
      <AlertDialog open={!!deletingZone} onOpenChange={(o) => { if (!o) setDeletingZone(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tt("lg.quote.zoneDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tt("lg.quote.zoneDeleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt("lg.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={doDeleteZone}>{tt("lg.common.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 重量段删除确认 */}
      <AlertDialog open={!!deletingBand} onOpenChange={(o) => { if (!o) setDeletingBand(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tt("lg.quote.bandDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tt("lg.quote.bandDeleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tt("lg.common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={doDeleteBand}>{tt("lg.common.confirm")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============================ 行内编辑器 ============================
type ZoneFormT = { id: string; name: string; zone_type: string; priority: string; countries: string; postal_patterns: string; cities: string };
type BandFormT = { id: string; weight_from_g: string; weight_to_g: string; reg_fee: string; inc_fee: string; inc_unit_g: string; flat_price: string; min_fee: string; currency: string };

function ZoneRowEditor(props: {
  form: ZoneFormT;
  setForm: (v: ZoneFormT) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { form, setForm, onSave, onCancel, saving } = props;
  const cell = "px-2 py-2 align-top";
  return (
    <tr className="border-b border-border bg-primary/5">
      <td className={cell}><Input className="h-8" value={form.name} placeholder={tt("lg.quote.zone.namePh")} onChange={(e) => setForm({ ...form, name: e.target.value })} /></td>
      <td className={cell}>
        <select className={cn(selCls, "h-8")} value={form.zone_type} onChange={(e) => setForm({ ...form, zone_type: e.target.value })}>
          {ZONE_TYPES.map((z) => <option key={z} value={z}>{zoneTypeLabel(z)}</option>)}
        </select>
      </td>
      <td className={cell}><Input className="h-8" value={form.countries} placeholder="US, CA, DE" onChange={(e) => setForm({ ...form, countries: e.target.value })} /></td>
      <td className={cell}><Input className="h-8" value={form.postal_patterns} placeholder="0100*, 10000-05999" onChange={(e) => setForm({ ...form, postal_patterns: e.target.value })} /></td>
      <td className={cell}><Input className="h-8" value={form.cities} placeholder="Berlin, Munich" onChange={(e) => setForm({ ...form, cities: e.target.value })} /></td>
      <td className={cell}><Input className="h-8 w-16" type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></td>
      <td className={cn(cell, "text-xs text-fg-muted")}>—</td>
      <td className={cell}>
        <div className="flex justify-end gap-1">
          <Button size="sm" className="h-8 px-2 text-xs" onClick={onSave} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : tt("lg.common.save")}</Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onCancel}>{tt("lg.common.cancel")}</Button>
        </div>
      </td>
    </tr>
  );
}

function BandRowEditor(props: {
  form: BandFormT;
  setForm: (v: BandFormT) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { form, setForm, onSave, onCancel, saving } = props;
  const cell = "px-2 py-2 align-top";
  const cols: Array<{ k: keyof BandFormT; ph: string; type?: string }> = [
    { k: "weight_from_g", ph: "100", type: "number" },
    { k: "weight_to_g", ph: "500", type: "number" },
    { k: "reg_fee", ph: "28.00", type: "number" },
    { k: "inc_fee", ph: "12.00", type: "number" },
    { k: "inc_unit_g", ph: "1000", type: "number" },
    { k: "flat_price", ph: "—", type: "number" },
    { k: "min_fee", ph: "—", type: "number" },
    { k: "currency", ph: "CNY" },
  ];
  return (
    <tr className="border-b border-border bg-primary/5">
      {cols.map((c) => (
        <td key={c.k} className={cell}>
          <Input className="h-8" type={c.type} value={form[c.k]} placeholder={c.ph} onChange={(e) => setForm({ ...form, [c.k]: e.target.value })} />
        </td>
      ))}
      <td className={cell}>
        <div className="flex justify-end gap-1">
          <Button size="sm" className="h-8 px-2 text-xs" onClick={onSave} disabled={saving}>{saving ? <Loader2 size={13} className="animate-spin" /> : tt("lg.common.save")}</Button>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={onCancel}>{tt("lg.common.cancel")}</Button>
        </div>
      </td>
    </tr>
  );
}
