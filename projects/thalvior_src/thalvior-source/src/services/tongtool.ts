// 前端通途 ERP2.0 对接封装：统一通过 Edge Function 调用通途开放平台
// 所有请求走 supabaseUrl + /functions/v1/tongtool，携带 OneDay-App-Id 与登录态
// urlKey 已按官方文档树核对（ERP2.0 产品线下的真实地址）：
//   ordersQuery 订单查询 / packagesQuery 包裹查询 / merchantPlatformQuery 平台及站点
//   goodsQuery 商品信息 / warehouseQuery 仓库
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

import { tt } from "@/i18n/tts";
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
  const data = (await resp.json()) as { error?: string; message?: string };
  if (!resp.ok) {
    throw new Error(data.error || data.message || tt('tongtool.apiFail', { v1: resp.status }));
  }
  return data;
}

// 获取 app_token（用于调试/验证鉴权是否打通）
export async function getTongtoolToken(): Promise<string> {
  const data = (await callTongtool({ action: "getToken" })) as { app_token?: string };
  if (!data.app_token) throw new Error(tt("svc.appTokenMissing"));
  return data.app_token;
}

// 订单查询
export async function queryTongtoolOrders(params: Record<string, unknown>): Promise<unknown> {
  return callTongtool({ urlKey: "ordersQuery", params });
}

// 包裹查询
export async function queryTongtoolPackages(params: Record<string, unknown>): Promise<unknown> {
  return callTongtool({ urlKey: "packagesQuery", params });
}

// 商户平台及站点信息（ERP2.0 无独立店铺列表接口，平台/站点信息走这个）
export async function queryTongtoolPlatforms(): Promise<unknown> {
  return callTongtool({ urlKey: "merchantPlatformQuery", params: {} });
}

// 商品信息查询
export async function queryTongtoolProducts(params: Record<string, unknown>): Promise<unknown> {
  return callTongtool({ urlKey: "goodsQuery", params });
}

// 仓库查询
export async function queryTongtoolWarehouses(params: Record<string, unknown> = {}): Promise<unknown> {
  return callTongtool({ urlKey: "warehouseQuery", params });
}
