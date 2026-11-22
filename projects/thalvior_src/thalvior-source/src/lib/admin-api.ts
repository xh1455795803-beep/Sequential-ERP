// 平台运营后台（/admin/*）统一 EF 调用层 —— Batch A 地基，Batch B/C/D 的前端唯一入口
// 约定：所有后台读写都走 admin-api 这一个 Edge Function，body = { action, ...params }。
//   · 鉴权由 admin-api 侧做（jose 验签 + profiles.role='admin'），前端只带用户 JWT
//   · 403 一律 toast（后端文案已是中文可操作语句，与其他 EF 同一口径）
//   · 失败同时抛 Error，调用方可以 catch 做局部降级（列表页通常只在页面内显示错误条）
import { toast } from "sonner";
import { supabase } from "@/supabase/client";

/** admin-api 支持的 action（与 functions/admin-api/index.ts 的路由一一对应） */
export type AdminAction =
  | "list_platform_health"
  | "list_sync_runs"
  | "get_audit_log"
  | "set_platform_enabled"
  | "rotate_credential"
  | "get_credential"
  | "force_resync"
  | "test_adapter"
  | "write_audit";

/** list_platform_health 的单平台行：最新快照 + 窗口累计 + 平台/店铺/凭据实况 */
export interface PlatformHealthRow {
  platform_key: string;
  enabled: boolean;
  auth_state: string | null;
  adapter_connected: boolean;
  active_shops: number;
  latest_snapshot: AdapterHealthSnapshot | null;
  window_totals: { calls: number; ok: number; fail: number; skipped: number };
  credential: {
    has_app_key: boolean;
    app_key: string | null;
    has_secret: boolean;
    redirect_uri: string | null;
    extra: Record<string, unknown>;
    key_version: number;
    updated_at: string | null;
  } | null;
}

export interface AdapterHealthSnapshot {
  ts: string;
  platform_key: string;
  calls: number;
  ok: number;
  fail: number;
  skipped: number;
  avg_ms: number | null;
  p95_ms: number | null;
  errors: Array<{ msg: string; n: number }>;
}

/** sync_run_logs 行（一次同步、一个店铺一行） */
export interface SyncRunLogRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  user_id: string | null;
  shop_id: string | null;
  platform_key: string;
  status: "success" | "partial" | "failed" | "skipped" | "auth_required" | "no_credentials";
  pulled: number | null;
  inserted: number | null;
  updated: number | null;
  unchanged: number | null;
  error_msg: string | null;
  error_code: string | null;
  duration_ms: number | null;
}

/** admin_audit_log 行 */
export interface AuditLogRow {
  id: number;
  ts: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

/** get_credential 只回「有没有密钥」，明文/密文永不出服务器 */
export interface CredentialView {
  ok: boolean;
  found: boolean;
  platform_key: string;
  app_key: string | null;
  redirect_uri: string | null;
  extra: Record<string, unknown>;
  has_secret: boolean;
  key_version: number;
  updated_at: string | null;
  created_at?: string | null;
}

interface Unwrapped {
  status: number;
  message: string;
}

/** supabase-js 的 functions 错误把原始 Response 藏在 context 里，这里统一取出状态码与后端文案 */
async function unwrapInvokeError(err: unknown): Promise<Unwrapped> {
  const anyErr = err as any;
  let status = Number(anyErr?.statusCode ?? anyErr?.status ?? 0);
  let message = "";
  const ctx = anyErr?.context;
  if (ctx && typeof ctx.json === "function") {
    status = status || Number(ctx.status ?? 0);
    try {
      const body = await ctx.json();
      message = String(body?.error ?? body?.message ?? body?.msg ?? "");
    } catch {
      /* 非 JSON 错误体：退回 SDK 自带的 message */
    }
  }
  if (!message) message = String(anyErr?.message ?? "");
  if (!message && typeof anyErr === "string") message = anyErr;
  return { status, message };
}

/**
 * 调用 admin-api。返回已解析的 JSON（按 action 的响应结构断言为 T）。
 * 任何失败（HTTP 错误 / 网络错误 / 200 但 body 里带 error）都会 toast 并抛 Error。
 */
export async function callAdmin<T = unknown>(
  action: AdminAction | string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-api", {
    body: { action, ...body },
  });

  if (error) {
    const { status, message } = await unwrapInvokeError(error);
    if (status === 403) {
      toast.error(message || "仅管理员可访问后台 API");
    } else if (status === 401) {
      toast.error("登录已过期，请重新登录后再操作后台");
    } else {
      toast.error(message || `后台接口 ${action} 调用失败`);
    }
    throw new Error(message || `admin-api ${action} failed`);
  }

  // admin-api 用 { error: "..." } 表达业务失败（HTTP 仍为 200 的场景也在这一层兜住）
  const payload = data as (T & { error?: string }) | null;
  if (payload && typeof payload.error === "string" && payload.error) {
    toast.error(payload.error);
    throw new Error(payload.error);
  }
  return payload as T;
}
