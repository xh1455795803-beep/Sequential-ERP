// 库存同步推送引擎前端服务：统一走 /functions/v1/sync-stock
// action: process-queue / sync-status
// 对应 P0-4 库存同步推送 MVP（第一平台：WooCommerce）
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

import { tt } from "@/i18n/tts";
export interface StockPushRow {
  id: string;
  local_sku: string;
  old_qty: number;
  new_qty: number;
  status: "待推送" | "部分成功" | "失败" | "已跳过" | string;
  retry_count: number;
  error: string | null;
  created_at: string | null;
  pushed_at: string | null;
  shop_auths: { shop_name: string } | null;
}

export interface StockSyncLogRow {
  id: string;
  trigger_type: "manual" | "cron" | string;
  status: "成功" | "部分成功" | "失败" | string;
  pushed_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  error_message: string | null;
  duration_ms: number;
  created_at: string | null;
}

export interface StockSyncStatusResult {
  queue_summary: { pending: number; failed: number };
  recent_pushes: StockPushRow[];
  recent_logs: StockSyncLogRow[];
}

export interface StockPushResult {
  ok: boolean;
  pushed: number;
  success: number;
  failed: number;
  skipped: number;
  status: string;
  duration_ms: number;
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

async function callSyncStock(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/sync-stock`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || tt("svc.syncStockFail"));
  return data;
}

// 同步状态：队列统计 + 最近推送明细 + 最近批次
export async function getStockSyncStatus(): Promise<StockSyncStatusResult> {
  return (await callSyncStock("sync-status")) as unknown as StockSyncStatusResult;
}

// 立即推送：处理当前用户队列中的待推送变更
export async function pushStockQueueNow(): Promise<StockPushResult> {
  return (await callSyncStock("process-queue", { mode: "manual" })) as unknown as StockPushResult;
}
