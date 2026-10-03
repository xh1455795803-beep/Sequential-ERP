// 前端物流轨迹封装：统一通过 Edge Function 调用 17TRACK
// 所有请求走 supabaseUrl + /functions/v1/tracking，携带 OneDay-App-Id 与登录态
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

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
  const resp = await fetch(`${supabaseUrl}/functions/v1/tracking`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || `物流接口调用失败 (${resp.status})`);
  }
  return data;
}

// 注册运单号到 17TRACK
export async function registerTracking(trackingNo: string): Promise<unknown> {
  return callTracking({ action: "register", tracking_no: trackingNo });
}

// 查询轨迹，返回 17TRACK 原始结果
export async function queryTracking(trackingNo: string): Promise<unknown> {
  return callTracking({ action: "track", tracking_no: trackingNo });
}