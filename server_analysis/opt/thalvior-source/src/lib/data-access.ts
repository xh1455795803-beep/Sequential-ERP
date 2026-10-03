// 数据访问层：封装 Supabase 查询，供各页面调用
// 所有业务数据读写统一走这里，禁止在页面里直接裸调 supabase
import { supabase } from "@/supabase/client";

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
  extras?: Record<string, unknown>;
  description?: string;
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
  tracking_events: TrackingEvent[] | null;
  created_at: string | null;
}

export interface TrackingEvent {
  time: string;
  location: string;
  description: string;
  status: string;
}

// 商品
export async function fetchProducts(): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("sales", { ascending: false });
  if (error) throw new Error(`查询商品失败: ${error.message}`);
  return data ?? [];
}

// 订单
export async function fetchOrders(): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`查询订单失败: ${error.message}`);
  return (data ?? []) as OrderRow[];
}

// 库存
export async function fetchInventory(): Promise<InventoryRow[]> {
  const { data, error } = await supabase.from("inventory").select("*");
  if (error) throw new Error(`查询库存失败: ${error.message}`);
  return data ?? [];
}

// 店铺
export async function fetchShops(): Promise<ShopRow[]> {
  const { data, error } = await supabase.from("shops").select("*");
  if (error) throw new Error(`查询店铺失败: ${error.message}`);
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
  if (error) throw new Error(`查询店铺规则失败: ${error.message}`);
  return (data ?? []) as ShopListingRuleRow[];
}

// 采购建议
export async function fetchPurchaseSuggestions(): Promise<PurchaseSuggestionRow[]> {
  const { data, error } = await supabase
    .from("purchase_suggestions")
    .select("*")
    .order("suggest_qty", { ascending: false });
  if (error) throw new Error(`查询采购建议失败: ${error.message}`);
  return data ?? [];
}

// 售后单
export async function fetchAfterSales(): Promise<AfterSaleRow[]> {
  const { data, error } = await supabase
    .from("after_sales")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`查询售后单失败: ${error.message}`);
  return data ?? [];
}

// ===== 通用 CRUD 辅助（扩展业务表） =====
// 所有扩展表结构一致：id UUID + user_id + 若干业务字段
export type ExtRow = Record<string, unknown> & { id: string };

// 表名由运行时决定，无法走生成的强类型客户端，这里退化为非类型化句柄
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dyn = supabase as any;

export async function fetchTable(
  table: string,
  filter?: { field: string; value: string | number; op?: "eq" | "gt" | "gte" | "lt" | "lte" }
): Promise<ExtRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = dyn.from(table).select("*");
  if (filter) {
    if (filter.op && filter.op !== "eq") {
      q = q[filter.op](filter.field, filter.value);
    } else {
      q = q.eq(filter.field, filter.value);
    }
  }
  const { data, error } = await q;
  if (error) throw new Error(`查询失败: ${error.message}`);
  return (data ?? []) as ExtRow[];
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
  if (error) throw new Error(`新增失败: ${error.message}`);
  if (!data || data.length === 0) throw new Error("新增失败：可能被权限策略拦截");
  return data[0]?.id as string;
}

export async function updateRow(table: string, id: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await dyn.from(table).update(patch).eq("id", id).select();
  if (error) throw new Error(`更新失败: ${error.message}`);
  if (!data || data.length === 0) throw new Error("更新失败：可能被权限策略拦截");
}

// 批量更新：按 id 列表更新同一字段（如批量发货）
export async function updateRows(table: string, ids: string[], patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await dyn.from(table).update(patch).in("id", ids).select();
  if (error) throw new Error(`批量更新失败: ${error.message}`);
  if (!data || data.length === 0) throw new Error("批量更新失败：可能被权限策略拦截");
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { data, error } = await dyn.from(table).delete().eq("id", id).select();
  if (error) throw new Error(`删除失败: ${error.message}`);
  if (!data || data.length === 0) throw new Error("删除失败：可能被权限策略拦截");
}