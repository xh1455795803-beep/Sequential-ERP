// 店铺授权前端服务：统一切到 /functions/v1/authorize-shop
// side-effect marker: prevent rollup/tree-shaker from dropping shopOAuth exports
import "./shopOAuth.side-effect";
// —— OAuth 型平台：oauth-url → 跳转平台授权页；oauth-callback → code 换 token 入库
// —— 手动型平台：cred-save → 凭据校验 + 加密入库
// —— list / delete：管理当前用户的所有授权
import { projectUrlId, supabase, supabaseUrl } from "@/supabase/client";

import { tt } from "@/i18n/tts";
async function authHeaders(): Promise<Record<string, string>> {
  const session = (await supabase.auth.getSession()).data.session;
  return {
    "Content-Type": "application/json",
    "OneDay-App-Id": projectUrlId,
    ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
  };
}

async function callAuthorizeShop(action: string, body: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`${supabaseUrl}/functions/v1/authorize-shop`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json();
  if (!res.ok) {
    // 保留服务端错误码，前端据此映射双语文案（英文界面不得直接显示中文错误原文）
    const err = new Error(data?.error || tt("svc.authorizeFail")) as Error & { code?: string };
    if (data?.code) err.code = String(data.code);
    throw err;
  }
  return data;
}

// 获取第三方平台 OAuth 授权跳转 URL
export async function getOAuthUrl(platform: string, shop?: string): Promise<string> {
  const data = await callAuthorizeShop("oauth-url", { platform, shop: shop || undefined });
  return data.url as string;
}

// 回调：用 code 换取 token 并入库
export async function completeOAuth(platform: string, code: string, shop?: string): Promise<void> {
  await callAuthorizeShop("oauth-callback", { platform, code, shop: shop || undefined });
}

// 手动授权：校验 + 加密入库
export async function saveManualAuth(params: {
  platform: string;
  shop_name: string;
  region?: string;
  credentials: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return callAuthorizeShop("cred-save", params);
}

// 仅校验手动凭据（不入库）
export async function verifyManualAuth(
  platform: string,
  credentials: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return callAuthorizeShop("cred-verify", { platform, credentials });
}

// 当前用户所有授权
export async function listMyAuth(): Promise<Record<string, unknown>[]> {
  const data = await callAuthorizeShop("list");
  return (data.items ?? []) as Record<string, unknown>[];
}

// 授权额度（额度口径由服务端统一：免费额度读 platform_auth_config.free_shop_limit，已购额度读 shop_licenses）
export type AuthQuota = { quota: number; used: number; freeLimit: number; purchased: number };

// 带额度的授权列表：与 listMyAuth 分开，避免影响只取 items 的调用方（如刊登发布弹窗）
export async function listMyAuthWithQuota(): Promise<{
  items: Record<string, unknown>[];
  quota: AuthQuota | null;
}> {
  const data = await callAuthorizeShop("list");
  const q = (data.quota ?? null) as AuthQuota | null;
  return {
    items: (data.items ?? []) as Record<string, unknown>[],
    quota: q
      ? {
          quota: Number(q.quota ?? 0),
          used: Number(q.used ?? 0),
          freeLimit: Number(q.freeLimit ?? 0),
          purchased: Number(q.purchased ?? 0),
        }
      : null,
  };
}

// 删除一个授权
export async function deleteMyAuth(id: string): Promise<void> {
  await callAuthorizeShop("delete", { id });
}

// 店铺状态检测：转调 shop-status-check（未部署时服务端返回 STATUS_CHECK_UNAVAILABLE，前端如实提示）
export async function statusScanShop(ids: string[]): Promise<Record<string, unknown>> {
  return callAuthorizeShop("status-scan", { ids });
}

// 编辑店铺档案：仅白名单字段（shop_alias / shop_type / region / remark / notify_enabled 等）
export async function updateShopProfile(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  return callAuthorizeShop("shop-update", { id, patch });
}
