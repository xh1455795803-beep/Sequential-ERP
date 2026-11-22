// tracking.ts — 前端物流轨迹封装（17TRACK 聚合代理）
// 所有请求走 supabaseUrl + /functions/v1/track17，携带 OneDay-App-Id 与登录态
// 2026-10-20：替代快递鸟，改用 17TRACK 聚合 API
// 2026-10-20 track2：EF 函数名改为 track17，前端 URL 同步更新
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";
import { tt } from "@/i18n/tts";

export class TrackingUnavailableError extends Error {
  constructor(public readonly errorCode: string) {
    super(errorCode);
    this.name = "TrackingUnavailableError";
  }
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function callTracking(body: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(await getAuthHeaders()),
  };
  const resp = await fetch(`${supabaseUrl}/functions/v1/track17`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (resp.status === 503) {
    const code = (data as { error_code?: string })?.error_code ?? "TRACK17_KEY_NOT_CONFIGURED";
    throw new TrackingUnavailableError(code);
  }
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || tt('track.apiFail', { v1: String(resp.status) }));
  }
  return data;
}

export async function checkTrackingStatus(): Promise<{
  configured: boolean;
  status: "active" | "inactive" | "invalid_key" | string;
  quota?: { total: number; used: number; remain: number };
}> {
  try {
    const data = (await callTracking({ action: "status" })) as {
      configured: boolean;
      status: string;
      quota?: { total: number; used: number; remain: number };
    };
    return data;
  } catch {
    return { configured: false, status: "error" };
  }
}

export async function registerTracking(trackingNos: string[]): Promise<unknown> {
  return callTracking({ action: "register", tracking_numbers: trackingNos });
}

export async function queryTrackingBatch(trackingNos: string[]): Promise<unknown> {
  return callTracking({ action: "track", tracking_numbers: trackingNos });
}

export async function queryTracking(trackingNo: string): Promise<unknown> {
  return callTracking({ action: "track", tracking_no: trackingNo });
}

export async function syncActiveTracking(): Promise<unknown> {
  return callTracking({ action: "sync-active" });
}
