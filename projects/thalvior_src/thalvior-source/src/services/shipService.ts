// P0-6 打单发货引擎前端服务：统一走 /functions/v1/ship-orders
// action: mark-shipped（批量发货标记，服务端负责 Woo 回写）
//         audit（发货前自动审单预检，只读；权威拦截以 mark-shipped 服务端为准）
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

export interface ShipOrderResult {
  order_id: string;
  ok: boolean;
  tracking_no?: string;
  shipment_id?: string;
  waybill_id?: string;
  woo_writeback?: "completed" | "failed" | "skipped";
  woo_detail?: string;
  blocked?: boolean;
  audit_failures?: AuditFailure[];
  error?: string;
}

export interface ShipResult {
  ok: boolean;
  total: number;
  shipped: number;
  skipped: number;
  failed: number;
  blocked?: number;
  results: ShipOrderResult[];
}

export interface AuditFailure {
  code: string;
  reason: string;      // 中文原因（服务端返回）
  reason_en: string;   // 英文原因（服务端返回）
}

export interface AuditOrderResult {
  order_id: string;
  ok: boolean;
  failures: AuditFailure[];
}

export interface AuditResult {
  ok: boolean;
  total: number;
  results: AuditOrderResult[];
}

async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

async function callShipOrders(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/ship-orders`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "ship-orders request failed");
  return data;
}

// 发货前自动审单（只读预检）：返回逐单拦截原因（服务端双语文案）
export async function auditOrders(orderIds: string[]): Promise<AuditResult> {
  return (await callShipOrders("audit", { order_ids: orderIds })) as unknown as AuditResult;
}

// 标记发货：批量（含单笔）。tracking_no 留空则服务端按订单逐一生成 TL 运单号
export async function markShipped(orderIds: string[], carrier: string, trackingNo = ""): Promise<ShipResult> {
  return (await callShipOrders("mark-shipped", { order_ids: orderIds, carrier, tracking_no: trackingNo })) as unknown as ShipResult;
}
