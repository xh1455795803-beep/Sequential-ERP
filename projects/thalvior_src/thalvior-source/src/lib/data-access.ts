// 数据访问层：封装 Supabase 查询，供各页面调用
// 所有业务数据读写统一走这里，禁止在页面里直接裸调 supabase
import { supabase } from "@/supabase/client";

import { tt } from "@/i18n/tts";
export interface ProductRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  stock: number;
  status: string;
  image: string;
  sales: number;
  shop_id?: string | null;
  extras?: Record<string, unknown> | null;
  description?: string;
  created_at?: string | null;
  updated_at?: string | null;
  cost?: number | null;
  images?: string[];
  primary_image?: string | null;
  source_platform?: string | null;
  source_url?: string | null;
}

export interface OrderRow {
  id: string;
  buyer: string;
  product: string;
  sku: string;
  channel: string;
  amount: number;
  currency: string;
  status: string;
  created_at: string;
  address: string;
  shop_id?: string | null;
  shop_name?: string;
  remark?: string; // 行内编辑：订单备注（vis2）
  // P0-6 打单供数
  phone?: string;
  items?: { name: string; sku?: string; qty: number }[];
  external_order_id?: string | null;
}

export interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  warehouse: string;
  available: number;
  locked: number;
  in_transit: number;
  safety_stock: number;
  status: string;
}

export interface ShopRow {
  id: string;
  name: string;
  platform: string;
  region: string;
  status: string;
  today_sales: number;
  today_orders: number;
  product_count: number;
  rating: number;
}

export interface PurchaseSuggestionRow {
  id: string;
  sku: string;
  name: string;
  available: number;
  safety_stock: number;
  daily_sales: number;
  suggest_qty: number;
  level: string;
}

export interface AfterSaleRow {
  id: string;
  order_id: string;
  buyer: string;
  product: string;
  reason: string;
  status: string;
  amount: number;
}

export interface ShipmentRow {
  id: string;
  tracking_no: string;
  carrier: string | null;
  destination: string | null;
  origin: string | null;
  status: string | null;
  // 四态模型字段：列表页徽章以此为准（status 是历史自由文本，仅兼容旧数据）
  stage?: string | null;
  doc_status?: string | null;
  tracking_events: TrackingEvent[] | null;
  tracking_status: string | null;
  tracking_last_check: string | null;
  order_id: string | null;
  created_at: string | null;
}

export interface TrackingEvent {
  time: string;
  location: string;
  description: string;
  status: string;
}

// 物流轨迹映射：order_id → tracking_status（订单列表徽章用）
export async function fetchTrackingMap(): Promise<Record<string, { tracking_status: string; tracking_no: string }>> {
  const { data, error } = await supabase
    .from("shipments")
    .select("order_id, tracking_status, tracking_no")
    .not("order_id", "is", null);
  if (error) return {};
  const map: Record<string, { tracking_status: string; tracking_no: string }> = {};
  for (const s of data ?? []) {
    if (s.order_id && !map[s.order_id]) {
      map[s.order_id] = { tracking_status: s.tracking_status ?? "created", tracking_no: s.tracking_no ?? "" };
    }
  }
  return map;
}

// 商品
export async function fetchProducts(): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("sales", { ascending: false });
  if (error) throw new Error(tt('lib.da.queryProductFail', { v1: error.message }));
  return (data ?? []) as unknown as ProductRow[];
}

// 订单
export async function fetchOrders(): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(tt('lib.da.queryOrderFail', { v1: error.message }));
  return (data ?? []) as OrderRow[];
}

// 库存
export async function fetchInventory(): Promise<InventoryRow[]> {
  const { data, error } = await supabase.from("inventory").select("*");
  if (error) throw new Error(tt('lib.da.queryStockFail', { v1: error.message }));
  return data ?? [];
}

// 店铺
export async function fetchShops(): Promise<ShopRow[]> {
  const { data, error } = await supabase.from("shops").select("*");
  if (error) throw new Error(tt('lib.da.queryShopFail', { v1: error.message }));
  return data ?? [];
}

// 店铺刊登规则（统一刊登编辑页：字段显隐 / 必填 / 报错文案）
export interface ShopListingRuleRow {
  id: string;
  shop_id: string;
  region: string;
  enabled: boolean;
  fields: Record<string, { visible?: boolean; required?: boolean; error_text?: string }>;
  uploads: Record<string, { enabled?: boolean; required?: boolean; error_text?: string }>;
}

export async function fetchShopListingRules(): Promise<ShopListingRuleRow[]> {
  const { data, error } = await dyn.from("shop_listing_rules").select("*");
  if (error) throw new Error(tt('lib.da.queryShopRuleFail', { v1: error.message }));
  return (data ?? []) as ShopListingRuleRow[];
}

// 采购建议
export async function fetchPurchaseSuggestions(): Promise<PurchaseSuggestionRow[]> {
  const { data, error } = await supabase
    .from("purchase_suggestions")
    .select("*")
    .order("suggest_qty", { ascending: false });
  if (error) throw new Error(tt('lib.da.querySuggestFail', { v1: error.message }));
  return data ?? [];
}

// 售后单
export async function fetchAfterSales(): Promise<AfterSaleRow[]> {
  const { data, error } = await supabase
    .from("after_sales")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(tt('lib.da.queryAftersaleFail', { v1: error.message }));
  return data ?? [];
}

// ===== 通用 CRUD 辅助（扩展业务表） =====
// 所有扩展表结构一致：id UUID + user_id + 若干业务字段
export type ExtRow = Record<string, unknown> & { id: string };

// 表名由运行时决定，无法走生成的强类型客户端，这里退化为非类型化句柄
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dyn = supabase as any;

// 通用查询条件。op 覆盖列表页实际需要的比较符：
// - in / overlaps 给 text[] 维度（platforms、sites、services）下推用
// - is 只用于 is null / not null 之外的 is(null) 场景
export type FilterOp =
  | "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
  | "like" | "ilike" | "in" | "is" | "contains" | "overlaps";

export interface TableFilter {
  field: string;
  value: unknown;
  op?: FilterOp;
}

export interface TableOrder {
  field: string;
  ascending?: boolean;
}

export interface TableQuery {
  filters?: TableFilter[];
  /** 支持多字段：数组按先后次序逐级排序（PostgREST 会拼成 order=a.desc,b.asc） */
  order?: TableOrder | TableOrder[];
  /** 服务端分页，0 起、两端闭区间（对应 PostgREST 的 offset/limit） */
  range?: { from: number; to: number };
  limit?: number;
  /** 默认 "*"；只取部分列能显著降低列表页传输量 */
  select?: string;
  /** 需要总条数时才传 "exact"，会多发一次 head count，别默认打开 */
  count?: "exact" | "planned" | "estimated";
}

export interface TableResult<T> {
  rows: T[];
  /** 未请求 count 时为 null，不要用 0 代替"不知道" */
  count: number | null;
}

async function runQuery(table: string, q: TableQuery): Promise<TableResult<ExtRow>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = dyn.from(table).select(q.select ?? "*", q.count ? { count: q.count } : undefined);
  for (const f of q.filters ?? []) {
    const op: FilterOp = f.op ?? "eq";
    query = query[op](f.field, f.value as never);
  }
  if (q.order) {
    const orders: TableOrder[] = Array.isArray(q.order) ? q.order : [q.order];
    for (const o of orders) query = query.order(o.field, { ascending: o.ascending ?? false });
  }
  if (q.range) query = query.range(q.range.from, q.range.to);
  else if (q.limit) query = query.limit(q.limit);
  const { data, error, count } = await query;
  if (error) throw new Error(tt('lib.da.queryFail', { v1: error.message }));
  return { rows: (data ?? []) as ExtRow[], count: count ?? null };
}

/**
 * 简单列表查询：单条过滤或一个完整 TableQuery。
 * 需要分页/总数请用 queryTable，不要在页面里拉全量再切片。
 */
export async function fetchTable(
  table: string,
  filter?: TableFilter | TableQuery
): Promise<ExtRow[]> {
  let q: TableQuery = {};
  if (filter) q = "field" in filter ? { filters: [filter] } : filter;
  return (await runQuery(table, q)).rows;
}

/** 列表页统一入口：多条件下推 + 服务端分页 + 可选总数 */
export async function queryTable(
  table: string,
  q: TableQuery
): Promise<TableResult<ExtRow>> {
  return runQuery(table, q);
}

export async function insertRow(table: string, row: Record<string, unknown>): Promise<string> {
  // 自动注入 user_id（多租户隔离），避免前端漏传导致 RLS 拦截
  const payload = { ...row };
  if (!payload.user_id) {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;
    if (uid) payload.user_id = uid;
  }
  const { data, error } = await dyn.from(table).insert(payload).select();
  if (error) throw new Error(tt('lib.da.createFail', { v1: error.message }));
  if (!data || data.length === 0) throw new Error(tt('lib.da.createFailRls'));
  return data[0]?.id as string;
}

export async function updateRow(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await dyn.from(table).update(patch).eq("id", id).select();
  if (error) throw new Error(tt('lib.da.updateFail', { v1: error.message }));
  if (!data || data.length === 0) throw new Error(tt('lib.da.updateFailRls'));
}

// 批量更新：按 id 列表更新同一字段（如批量发货）
export async function updateRows(table: string, ids: string[], patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await dyn.from(table).update(patch).in("id", ids).select();
  if (error) throw new Error(tt('lib.da.batchUpdateFail', { v1: error.message }));
  if (!data || data.length === 0) throw new Error(tt('lib.da.batchUpdateFailRls'));
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { data, error } = await dyn.from(table).delete().eq("id", id).select();
  if (error) throw new Error(tt('lib.da.deleteFail', { v1: error.message }));
  if (!data || data.length === 0) throw new Error(tt('ai.svc.err.deleteBlocked'));
}

// RPC 调用：统一薄封装，权限由数据库 RLS / SECURITY DEFINER 函数控制
export async function callRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  // Database 类型仅收录部分函数，动态 fn 需绕过 rpc 的字面量类型限制
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw new Error(tt('lib.da.invokeFail', { v1: error.message }));
  return data as T;
}
