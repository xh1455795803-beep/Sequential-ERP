// 前端通途 ERP 对接封装：统一通过 Edge Function 调用通途开放平台
// 所有请求走 supabaseUrl + /functions/v1/tongtool，携带 OneDay-App-Id 与登录态
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

async function callTongtool(body: Record<string, unknown>): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(await getAuthHeaders()),
  };
  const resp = await fetch(`${supabaseUrl}/functions/v1/tongtool`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || `通途接口调用失败 (${resp.status})`);
  }
  return data;
}

// 获取 app_token（用于调试/验证鉴权是否打通）
export async function getTongtoolToken(): Promise<string> {
  const data = (await callTongtool({ action: "getToken" })) as { app_token?: string };
  if (!data.app_token) throw new Error("未获取到 app_token");
  return data.app_token;
}

// 订单查询
export async function queryTongtoolOrders(params: Record<string, unknown>): Promise<unknown> {
  return callTongtool({ action: "orders", urlKey: "ordersQuery", params });
}

// 店铺账号列表
export async function queryTongtoolAccounts(params: Record<string, unknown>): Promise<unknown> {
  return callTongtool({ action: "accounts", urlKey: "saleAccountsQuery", params });
}

// 商品列表
export async function queryTongtoolProducts(params: Record<string, unknown>): Promise<unknown> {
  return callTongtool({ action: "products", urlKey: "productsQuery", params });
}

// 平台及站点信息
export async function queryTongtoolPlatforms(): Promise<unknown> {
  return callTongtool({ action: "platforms", urlKey: "platformsQuery", params: {} });
}