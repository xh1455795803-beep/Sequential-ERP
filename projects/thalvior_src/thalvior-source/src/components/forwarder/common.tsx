// 货代管理（/logistics）五个 tab 的共享层：字段读取、枚举元数据、状态徽章、筛选控件、加载 hook
// 约定：本模块只依赖 @/lib/data-access 与 ui 组件，不直接拼 SQL、不绕过数据网关取数
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { supabase } from "@/supabase/client";
import { cn } from "@/lib/utils";
import { tk, tt } from "@/i18n/tts";
import { fetchTable } from "@/lib/data-access";
import type { ExtRow } from "@/lib/data-access";

export type Tone = "ok" | "warn" | "bad" | "info" | "mute";
export type EnumMeta = Record<string, { key: string; tone: Tone }>;
export type Option = { code: string; key: string };

// ── ExtRow 取值（数据库列类型不受 TS 约束，统一在这里做安全转换）──
export function str(r: ExtRow, k: string): string {
  const v = r[k];
  if (v == null) return "";
  return typeof v === "string" ? v : String(v);
}
export function num(r: ExtRow, k: string): number {
  const v = r[k];
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
export function boolv(r: ExtRow, k: string): boolean {
  const v = r[k];
  return v === true || v === "true";
}
export function strarr(r: ExtRow, k: string): string[] {
  const v = r[k];
  return Array.isArray(v) ? (v as unknown[]).map((x) => (x == null ? "" : String(x))).filter(Boolean) : [];
}
/** 时间戳展示：ISO 串截到分钟，无值显示破折号（不引入 date-fns locale 差异） */
export function fmtTs(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 枚举：以下取值域均来自生产库 CHECK 约束实测，不是猜的 ──
export const AUTH_STATE_META: EnumMeta = {
  unregistered: { key: "fw.auth.unregistered", tone: "mute" },
  registered: { key: "fw.auth.registered", tone: "info" },
  pending_review: { key: "fw.auth.pendingReview", tone: "warn" },
  approved: { key: "fw.auth.approved", tone: "info" },
  authorized: { key: "fw.auth.authorized", tone: "ok" },
  expired: { key: "fw.auth.expired", tone: "warn" },
  revoked: { key: "fw.auth.revoked", tone: "bad" },
};
export const AUTH_STATES = Object.keys(AUTH_STATE_META);

// 可用态与授权态是两条独立状态：授权成功 ≠ 库存/接口可调用（妙手已发生的事故）
export const AVAIL_STATE_META: EnumMeta = {
  available: { key: "fw.avail.available", tone: "ok" },
  unavailable: { key: "fw.avail.unavailable", tone: "bad" },
  unknown: { key: "fw.avail.unknown", tone: "mute" },
};
export const AVAIL_STATES = Object.keys(AVAIL_STATE_META);

export const PROTOCOL_META: EnumMeta = {
  auth_code: { key: "fw.proto.authCode", tone: "info" },
  redirect_login: { key: "fw.proto.redirectLogin", tone: "info" },
  appkey_token: { key: "fw.proto.appkeyToken", tone: "info" },
  manual_invite: { key: "fw.proto.manualInvite", tone: "mute" },
};
export const PROTOCOLS = Object.keys(PROTOCOL_META);
export const PROTOCOL_DESC_KEYS: Record<string, string> = {
  auth_code: "fw.proto.authCodeDesc",
  redirect_login: "fw.proto.redirectLoginDesc",
  appkey_token: "fw.proto.appkeyTokenDesc",
  manual_invite: "fw.proto.manualInviteDesc",
};

// 货代跑的是哪一套接口系统（forwarder_auths.provider，明文列，可进列表页）。
// 它决定 forwarder-push 用哪个适配器：tfop1=我方开放协议直连；huoxiaoyi=货小易商家端
// （授权码 + AppKey/AppSecret，如慧航货运）；other=其他第三方货代系统。
// 与 protocol 的区别：protocol 描述「怎么拿到授权」，provider 描述「推单时敲谁的接口」。
export const PROVIDER_META: EnumMeta = {
  tfop1: { key: "fw.provider.tfop1", tone: "ok" },
  huoxiaoyi: { key: "fw.provider.huoxiaoyi", tone: "info" },
  other: { key: "fw.provider.other", tone: "mute" },
};
export const PROVIDERS = Object.keys(PROVIDER_META);
export const PROVIDER_DESC_KEYS: Record<string, string> = {
  tfop1: "fw.provider.tfop1Desc",
  huoxiaoyi: "fw.provider.huoxiaoyiDesc",
  other: "fw.provider.otherDesc",
};

export const WH_STATUS_META: EnumMeta = {
  active: { key: "fw.whs.active", tone: "ok" },
  inactive: { key: "fw.whs.inactive", tone: "mute" },
  pending_confirm: { key: "fw.whs.pendingConfirm", tone: "warn" },
};
export const WH_STATUSES = Object.keys(WH_STATUS_META);

// 新写入统一用 code；存量行里 status 可能还是历史中文值，交给 EnumBadge 兜底 tk()
// （全局字典已为这些历史值准备了词条，双语都能出词，本文件不重复声明）
export const FORWARDER_STATUS_META: EnumMeta = {
  active: { key: "fw.fws.active", tone: "ok" },
  evaluating: { key: "fw.fws.evaluating", tone: "warn" },
  terminated: { key: "fw.fws.terminated", tone: "mute" },
};
export const FORWARDER_STATUSES = ["active", "evaluating", "terminated"];

export const PACKING_FLOW_META: EnumMeta = {
  simple: { key: "fw.flow.simple", tone: "info" },
  task_based: { key: "fw.flow.taskBased", tone: "info" },
};

export const SOURCE_META: EnumMeta = {
  manual: { key: "fw.src.manual", tone: "mute" },
  preset_catalog: { key: "fw.src.presetCatalog", tone: "info" },
  market: { key: "fw.src.market", tone: "info" },
  api_onboarded: { key: "fw.src.apiOnboarded", tone: "ok" },
};

export const KIND_META: EnumMeta = {
  carrier: { key: "fw.kind.carrier", tone: "info" },
  overseas_warehouse: { key: "fw.kind.overseasWarehouse", tone: "info" },
  forwarder_pack: { key: "fw.kind.forwarderPack", tone: "ok" },
};
export const KINDS = Object.keys(KIND_META);

export const SWITCH_SCOPE_META: EnumMeta = {
  global: { key: "fw.scope.global", tone: "info" },
  shop: { key: "fw.scope.shop", tone: "mute" },
  platform: { key: "fw.scope.platform", tone: "mute" },
  warehouse: { key: "fw.scope.warehouse", tone: "mute" },
  channel: { key: "fw.scope.channel", tone: "mute" },
  forwarder: { key: "fw.scope.forwarder", tone: "mute" },
};
export const SWITCH_SCOPES = Object.keys(SWITCH_SCOPE_META);

// 四维筛选中的三维：平台 / 站点 / 服务（值以稳定 code 入库，展示走词条）
export const PLATFORM_OPTIONS: Option[] = [
  { code: "shopee", key: "fw.plat.shopee" },
  { code: "lazada", key: "fw.plat.lazada" },
  { code: "tiktok", key: "fw.plat.tiktok" },
  { code: "ozon", key: "fw.plat.ozon" },
  { code: "amazon", key: "fw.plat.amazon" },
  { code: "ebay", key: "fw.plat.ebay" },
  { code: "wish", key: "fw.plat.wish" },
  { code: "aliexpress", key: "fw.plat.aliexpress" },
  { code: "temu", key: "fw.plat.temu" },
  { code: "shein", key: "fw.plat.shein" },
  { code: "mercadolibre", key: "fw.plat.mercadolibre" },
  { code: "independent", key: "fw.plat.independent" },
];
export const SITE_OPTIONS: Option[] = [
  { code: "th", key: "fw.site.th" },
  { code: "my", key: "fw.site.my" },
  { code: "sg", key: "fw.site.sg" },
  { code: "ph", key: "fw.site.ph" },
  { code: "vn", key: "fw.site.vn" },
  { code: "id", key: "fw.site.id" },
  { code: "br", key: "fw.site.br" },
  { code: "mx", key: "fw.site.mx" },
  { code: "us", key: "fw.site.us" },
  { code: "ca", key: "fw.site.ca" },
  { code: "uk", key: "fw.site.uk" },
  { code: "de", key: "fw.site.de" },
  { code: "fr", key: "fw.site.fr" },
  { code: "es", key: "fw.site.es" },
  { code: "it", key: "fw.site.it" },
  { code: "jp", key: "fw.site.jp" },
  { code: "kr", key: "fw.site.kr" },
  { code: "au", key: "fw.site.au" },
  { code: "sa", key: "fw.site.sa" },
  { code: "ae", key: "fw.site.ae" },
  { code: "ru", key: "fw.site.ru" },
  { code: "pl", key: "fw.site.pl" },
];
export const SERVICE_OPTIONS: Option[] = [
  { code: "packing", key: "fw.svc.packing" },
  { code: "labeling", key: "fw.svc.labeling" },
  { code: "inspection", key: "fw.svc.inspection" },
  { code: "photo", key: "fw.svc.photo" },
  { code: "storage", key: "fw.svc.storage" },
  { code: "kitting", key: "fw.svc.kitting" },
  { code: "fba_headhaul", key: "fw.svc.fbaHeadhaul" },
  { code: "customs", key: "fw.svc.customs" },
  { code: "returns", key: "fw.svc.returns" },
  { code: "trunk_line", key: "fw.svc.trunkLine" },
];
export const CAPABILITY_OPTIONS: Option[] = [
  { code: "inbound", key: "fw.cap.inbound" },
  { code: "outbound", key: "fw.cap.outbound" },
  { code: "relabel", key: "fw.cap.relabel" },
  { code: "qc", key: "fw.cap.qc" },
  { code: "photo", key: "fw.cap.photo" },
  { code: "kitting", key: "fw.cap.kitting" },
  { code: "returns", key: "fw.cap.returns" },
];

export function optionLabel(options: Option[], code: string): string {
  const hit = options.find((o) => o.code === code);
  return hit ? tt(hit.key) : tk(code);
}

/** text[] 下推给 PostgREST 的 overlaps/contains 需数组字面量 {a,b}；code 来自固定选项表，仍过滤分隔符 */
export function pgArray(values: string[]): string {
  const clean = values.map((v) => v.replace(/[{}",\\]/g, "")).filter(Boolean);
  return `{${clean.join(",")}}`;
}

/** 枚举元数据 → 下拉/多选选项（同一批词条 key，避免两处维护） */
export function toOptions(meta: EnumMeta): Option[] {
  return Object.keys(meta).map((code) => ({ code, key: meta[code].key }));
}

// ── 行类型（生产库列实测）──
export interface Forwarder {
  id: string;
  name: string;
  code: string;
  status: string;
  contact: string;
  phone: string;
  wechat: string;
  channel: string;
  province: string;
  city: string;
  platforms: string[];
  sites: string[];
  services: string[];
  tags: string[];
  intro: string;
  source: string;
  sla_hours: number;
  packing_flow: string;
  auth_state: string;
  available_state: string;
  remark: string;
  is_deleted: boolean;
  updated_at: string;
}
export function mapForwarder(r: ExtRow): Forwarder {
  return {
    id: r.id,
    name: str(r, "name"),
    code: str(r, "code"),
    status: str(r, "status"),
    contact: str(r, "contact"),
    phone: str(r, "phone"),
    wechat: str(r, "wechat"),
    channel: str(r, "channel"),
    province: str(r, "province"),
    city: str(r, "city"),
    platforms: strarr(r, "platforms"),
    sites: strarr(r, "sites"),
    services: strarr(r, "services"),
    tags: strarr(r, "tags"),
    intro: str(r, "intro"),
    source: str(r, "source"),
    sla_hours: num(r, "sla_hours"),
    packing_flow: str(r, "packing_flow"),
    auth_state: str(r, "auth_state"),
    available_state: str(r, "available_state"),
    remark: str(r, "remark"),
    is_deleted: boolv(r, "is_deleted"),
    updated_at: str(r, "updated_at"),
  };
}

// 视图 v_forwarder_readiness：没有 id 列（forwarder_id 即货代 id），且不是安全视图
export interface Readiness {
  forwarder_id: string;
  protocol: string;
  auth_state_mirror: string;
  auth_state_real: string;
  available_state: string;
  unavailable_reason: string;
  warehouse_count: number;
  channel_count: number;
  mapped_sku_count: number;
  total_sku_count: number;
  city: string;
}
export function mapReadiness(r: ExtRow): Readiness {
  return {
    forwarder_id: str(r, "forwarder_id"),
    protocol: str(r, "protocol"),
    auth_state_mirror: str(r, "auth_state"),
    auth_state_real: str(r, "auth_state_real"),
    available_state: str(r, "available_state"),
    unavailable_reason: str(r, "unavailable_reason"),
    warehouse_count: num(r, "warehouse_count"),
    channel_count: num(r, "channel_count"),
    mapped_sku_count: num(r, "mapped_sku_count"),
    total_sku_count: num(r, "total_sku_count"),
    city: str(r, "city"),
  };
}
export type ReadinessMap = Map<string, Readiness>;

export interface Auth {
  id: string;
  forwarder_id: string;
  protocol: string;
  external_account: string;
  external_tenant_id: string;
  app_key: string;
  callback_url: string;
  auth_state: string;
  available_state: string;
  unavailable_reason: string;
  push_enabled: boolean;
  registered_at: string;
  reviewed_at: string;
  authorized_at: string;
  expires_at: string;
  last_error: string;
  created_at: string;
  provider: string;
  has_credentials: boolean;
}
export function mapAuth(r: ExtRow): Auth {
  return {
    id: r.id,
    forwarder_id: str(r, "forwarder_id"),
    protocol: str(r, "protocol"),
    external_account: str(r, "external_account"),
    external_tenant_id: str(r, "external_tenant_id"),
    app_key: str(r, "app_key"),
    callback_url: str(r, "callback_url"),
    auth_state: str(r, "auth_state"),
    available_state: str(r, "available_state"),
    unavailable_reason: str(r, "unavailable_reason"),
    push_enabled: boolv(r, "push_enabled"),
    registered_at: str(r, "registered_at"),
    reviewed_at: str(r, "reviewed_at"),
    authorized_at: str(r, "authorized_at"),
    expires_at: str(r, "expires_at"),
    last_error: str(r, "last_error"),
    created_at: str(r, "created_at"),
    // 存量行没有 provider 列值时按 tfop1 处理（迁移默认值就是它）
    provider: str(r, "provider") || "tfop1",
    // 服务端生成列：密文本身永不下发到浏览器
    has_credentials: r.has_credentials === true,
  };
}

export interface Warehouse {
  id: string;
  forwarder_id: string;
  code: string;
  external_warehouse_id: string;
  name: string;
  country: string;
  province: string;
  city: string;
  address: string;
  contact: string;
  phone: string;
  capabilities: string[];
  platform_sites: string[];
  promise: string;
  distance_to_official: string;
  status: string;
  is_default: boolean;
  synced_at: string;
}
export function mapWarehouse(r: ExtRow): Warehouse {
  return {
    id: r.id,
    forwarder_id: str(r, "forwarder_id"),
    code: str(r, "code"),
    external_warehouse_id: str(r, "external_warehouse_id"),
    name: str(r, "name"),
    country: str(r, "country"),
    province: str(r, "province"),
    city: str(r, "city"),
    address: str(r, "address"),
    contact: str(r, "contact"),
    phone: str(r, "phone"),
    capabilities: strarr(r, "capabilities"),
    platform_sites: strarr(r, "platform_sites"),
    promise: str(r, "promise"),
    distance_to_official: str(r, "distance_to_official"),
    status: str(r, "status"),
    is_default: boolv(r, "is_default"),
    synced_at: str(r, "synced_at"),
  };
}

export interface CatalogItem {
  id: string;
  name: string;
  channel: string;
  region: string;
  days: string;
  scale: string;
  kind: string;
  intro: string;
  is_active: boolean;
}
export function mapCatalog(r: ExtRow): CatalogItem {
  return {
    id: r.id,
    name: str(r, "name"),
    channel: str(r, "channel"),
    region: str(r, "region"),
    days: str(r, "days"),
    scale: str(r, "scale"),
    kind: str(r, "kind"),
    intro: str(r, "intro"),
    is_active: boolv(r, "is_active"),
  };
}

export interface SwitchRow {
  id: string;
  scope: string;
  scope_ref: string;
  auto_push_forwarder: boolean;
  auto_mark_ship: boolean;
  auto_deduct_inventory: boolean;
  retry_max: number;
  dedupe_window_hours: number;
  fee_auto_update_days: number;
  bill_import_max_days: number;
  updated_at: string;
}
export function mapSwitch(r: ExtRow): SwitchRow {
  return {
    id: r.id,
    scope: str(r, "scope"),
    scope_ref: str(r, "scope_ref"),
    auto_push_forwarder: boolv(r, "auto_push_forwarder"),
    auto_mark_ship: boolv(r, "auto_mark_ship"),
    auto_deduct_inventory: boolv(r, "auto_deduct_inventory"),
    retry_max: num(r, "retry_max"),
    dedupe_window_hours: num(r, "dedupe_window_hours"),
    fee_auto_update_days: num(r, "fee_auto_update_days"),
    bill_import_max_days: num(r, "bill_import_max_days"),
    updated_at: str(r, "updated_at"),
  };
}

// ── 就绪度：五项门禁，任一不满足都不能推单 ──
export type ReadinessItem = { key: string; ok: boolean };
export function readinessItems(a: Forwarder, rd: Readiness | undefined): ReadinessItem[] {
  const authState = rd?.auth_state_real || a.auth_state;
  const availState = rd ? rd.available_state : a.available_state;
  return [
    { key: "fw.rdItem.auth", ok: authState === "approved" || authState === "authorized" },
    { key: "fw.rdItem.available", ok: availState === "available" },
    { key: "fw.rdItem.warehouse", ok: (rd?.warehouse_count ?? 0) > 0 },
    { key: "fw.rdItem.channel", ok: (rd?.channel_count ?? 0) > 0 },
    { key: "fw.rdItem.sku", ok: (rd?.mapped_sku_count ?? 0) > 0 },
  ];
}

// ── 会话用户：v_forwarder_readiness 是普通视图（非 security_barrier），必须显式按 user_id 下推，
//    否则会拿到别的租户的行；这是安全过滤，不是给用户的筛选项 ──
export async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? "";
}

// ── 加载 hook：依赖变化自动重取，错误统一 toast.error 并保留行内错误态 ──
export function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[], fallback: T) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((res) => {
        if (!alive) return;
        setData(res);
        setLoading(false);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (!alive) return;
        setError(msg);
        setLoading(false);
        toast.error(msg);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

// ── 我的货代下拉（B/C/D 三个 tab 都要用，一次取全量：RLS 已按 user_id 收窄，量级 = 用户自己的货代数）
export function useForwarderOptions() {
  const { data, loading, error, reload } = useAsyncData<Forwarder[]>(
    async () => {
      const rows = await fetchTable("freight_forwarders", { field: "is_deleted", value: "false" });
      return rows.map(mapForwarder).sort((a, b) => a.name.localeCompare(b.name));
    },
    [],
    [],
  );
  return { forwarders: data, loading, error, reload };
}

// ── 通用 UI 片段 ──
const toneClass: Record<Tone, string> = {
  ok: "bg-success-bg text-success",
  warn: "bg-warning-bg text-warning",
  bad: "bg-danger-bg text-destructive",
  info: "bg-info-bg text-info",
  mute: "bg-muted text-muted-foreground",
};

export function EnumBadge({ value, meta }: { value: string; meta: EnumMeta }) {
  const hit = meta[value];
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium leading-[18px]",
        toneClass[hit ? hit.tone : "mute"],
      )}
    >
      {hit ? tt(hit.key) : tk(value) || "—"}
    </span>
  );
}

export function Chip({ children, tone = "mute" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-[16px]",
        toneClass[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Sel({
  value,
  onChange,
  children,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60",
        className,
      )}
    >
      {children}
    </select>
  );
}

/** 多选：以 code 入库，展示走词条（平台 / 站点 / 服务 / 能力都用它） */
export function ChipMulti({
  options,
  value,
  onChange,
}: {
  options: Option[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (code: string) => {
    onChange(value.includes(code) ? value.filter((x) => x !== code) : [...value, code]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.code);
        return (
          <button
            key={o.code}
            type="button"
            onClick={() => toggle(o.code)}
            className={cn(
              "rounded-md border px-2 py-1 text-[11.5px] transition-colors",
              on
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/30",
            )}
          >
            {tt(o.key)}
          </button>
        );
      })}
    </div>
  );
}

export function Panel({
  title,
  meta,
  actions,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-ink">
          {title}
          {meta ? <span className="text-xs font-normal text-muted-foreground">{meta}</span> : null}
        </h3>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-muted-foreground">
        <Loader2 size={18} className="mx-auto mb-2 animate-spin" />
        {tt("fw.ui.loading")}
      </td>
    </tr>
  );
}

export function ErrorRow({ colSpan, message, onRetry }: { colSpan: number; message: string; onRetry: () => void }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center">
        <p className="text-sm font-medium text-destructive">{tt("fw.ui.loadFail")}</p>
        <p className="mx-auto mt-1 max-w-lg break-words text-xs text-muted-foreground">{message}</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
          {tt("fw.ui.retry")}
        </Button>
      </td>
    </tr>
  );
}

export function EmptyRow({
  colSpan,
  text,
  hint,
  action,
}: {
  colSpan: number;
  text: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <EmptyState iconSize={28} text={text} hint={hint} action={action} />
      </td>
    </tr>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("px-3 py-3 font-medium", className)}>{children}</th>;
}
export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-3 align-top", className)}>{children}</td>;
}

/** 分页控件：页码与总数都来自服务端（queryTable 的 range + count），不在前端切片 */
export function Pager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {tt("fw.ui.prevPage")}
      </Button>
      <span className="font-data tabular-nums">
        {page} / {pageCount}
      </span>
      <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
        {tt("fw.ui.nextPage")}
      </Button>
    </div>
  );
}
