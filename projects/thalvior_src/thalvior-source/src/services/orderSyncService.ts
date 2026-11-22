// 订单自动同步引擎前端服务：统一走 /functions/v1/sync-orders
// action: sync-shop / sync-all / sync-status
// 对应 P0-3 订单自动同步引擎（第一平台：WooCommerce）
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

import { tt } from "@/i18n/tts";
export interface SyncLogRow {
  id: string;
  shop_auth_id: string | null;
  shop_name: string;
  trigger_type: "manual" | "cron" | string;
  status: "成功" | "部分成功" | "失败" | string;
  fetched_count: number;
  inserted_count: number;
  updated_count: number;
  failed_count: number;
  error_message: string | null;
  duration_ms: number;
  created_at: string | null;
}

export interface ShopSyncState {
  id: string;
  shop_name: string;
  status: string;
  platform: string;
  shop_sync_state:
    | { last_synced_at: string | null; last_status: string | null; last_error: string | null }
    | null;
}

export interface SyncStatusResult {
  recent_logs: SyncLogRow[];
  shops: ShopSyncState[];
  // 已接通订单同步引擎的平台标签（sync-orders 适配器注册表，前端据此如实标注徽标）
  supported_platforms?: string[];
}

export interface ShopSyncResult {
  shop_auth_id: string;
  shop_name: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  failed: number;
  error?: string;
  duration_ms: number;
}

export interface SyncAllResult {
  ok: boolean;
  shops: ShopSyncResult[];
  total: { ok: boolean; fetched: number; inserted: number; updated: number; failed: number; duration_ms: number };
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

async function callSyncOrders(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/sync-orders`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || tt("svc.syncOrdersFail"));
  return data;
}

// 立即同步：遍历当前用户所有已授权 WooCommerce 店增量拉单
export async function syncAllShops(): Promise<SyncAllResult> {
  return (await callSyncOrders("sync-all", { mode: "manual" })) as unknown as SyncAllResult;
}

// 同步状态：最近批次 + 各店水位
export async function getSyncStatus(): Promise<SyncStatusResult> {
  return (await callSyncOrders("sync-status")) as unknown as SyncStatusResult;
}

// 单店立即同步：授权页「立即同步」按钮调用，返回本次拉单结果
export async function syncShopNow(shopAuthId: string): Promise<ShopSyncResult> {
  return (await callSyncOrders("sync-shop", { shop_auth_id: shopAuthId, mode: "manual" })) as unknown as ShopSyncResult;
}

// 已接通订单同步引擎的平台清单（来自 sync-orders 适配器注册表，前端据此如实标注，不写死平台名）
export async function listSyncPlatforms(): Promise<{ key: string; label: string }[]> {
  const data = await callSyncOrders("list-platforms");
  return (data.supported ?? []) as { key: string; label: string }[];
}
